import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import GioUnix from "gi://GioUnix?version=2.0"
import { createState } from "gnim"

export type InputState = {
  date: string
  startedAt: number
  left: number
  right: number
  keys: number
  leftMouse: number
  rightMouse: number
  leftPad: number
  rightPad: number
  scrollUp: number
  scrollDown: number
  scrollLeft: number
  scrollRight: number
  keyCounts: Record<string, number>
}

type DeviceType = "mouse" | "touchpad" | "keyboard" | "unknown"

const STATE_DIR = `${GLib.get_home_dir()}/.local/state/ags`
const STATE_PATH = `${STATE_DIR}/input-counts.json`
const SAVE_DELAY_MS = 2000
const DAY_CHECK_MS = 60000

const todayKey = () => {
  const dt = GLib.DateTime.new_now_local()
  return dt?.format("%Y-%m-%d") ?? ""
}

const defaultState = (): InputState => ({
  date: todayKey(),
  startedAt: Date.now(),
  left: 0,
  right: 0,
  keys: 0,
  leftMouse: 0,
  rightMouse: 0,
  leftPad: 0,
  rightPad: 0,
  scrollUp: 0,
  scrollDown: 0,
  scrollLeft: 0,
  scrollRight: 0,
  keyCounts: {},
})

const toNumber = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0

const normalizeKeyCounts = (value: unknown) => {
  if (!value || typeof value !== "object") return {}
  const entries = Object.entries(value as Record<string, unknown>)
  const out: Record<string, number> = {}
  for (const [key, raw] of entries) {
    const num = toNumber(raw)
    if (num > 0) out[key] = num
  }
  return out
}

const normalizeState = (raw: Partial<InputState> | null): InputState => {
  const base = defaultState()
  if (!raw) return base
  if (!raw.date || raw.date !== todayKey()) return base
  const startedAt =
    typeof raw.startedAt === "number" && raw.startedAt > 0
      ? raw.startedAt
      : base.startedAt
  return {
    date: raw.date,
    startedAt,
    left: toNumber(raw.left),
    right: toNumber(raw.right),
    keys: toNumber(raw.keys),
    leftMouse: toNumber(raw.leftMouse),
    rightMouse: toNumber(raw.rightMouse),
    leftPad: toNumber(raw.leftPad),
    rightPad: toNumber(raw.rightPad),
    scrollUp: toNumber(raw.scrollUp),
    scrollDown: toNumber(raw.scrollDown),
    scrollLeft: toNumber(raw.scrollLeft),
    scrollRight: toNumber(raw.scrollRight),
    keyCounts: normalizeKeyCounts(raw.keyCounts),
  }
}

const ensureStateDir = () => {
  try {
    GLib.mkdir_with_parents(STATE_DIR, 0o755)
  } catch (_) {}
}

const loadState = (): InputState => {
  try {
    const [ok, contents] = GLib.file_get_contents(STATE_PATH)
    if (!ok || !contents) return defaultState()
    const parsed = JSON.parse(new TextDecoder().decode(contents)) as InputState
    return normalizeState(parsed)
  } catch (_) {
    return defaultState()
  }
}

const saveState = (state: InputState) => {
  try {
    ensureStateDir()
    GLib.file_set_contents(STATE_PATH, JSON.stringify(state))
  } catch (_) {}
}

const classifyDevice = (text: string): DeviceType => {
  const lower = text.toLowerCase()
  if (lower.includes("touchpad") || lower.includes("trackpad")) return "touchpad"
  if (lower.includes("keyboard")) return "keyboard"
  if (
    lower.includes("mouse") ||
    lower.includes("trackball") ||
    lower.includes("trackpoint")
  ) {
    return "mouse"
  }
  return "unknown"
}

type PressedState = { left: boolean; right: boolean }

const deviceTypes = new Map<string, DeviceType>()
const pressedByEvent = new Map<string, PressedState>()

const [state, setState] = createState<InputState>(loadState())
const [available, setAvailable] = createState(true)
let saveSource: number | null = null

const queueSave = () => {
  if (saveSource !== null) return
  saveSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
    saveSource = null
    saveState(state())
    return GLib.SOURCE_REMOVE
  })
}

const bumpClick = (side: "left" | "right", source: "mouse" | "touchpad") => {
  setState((prev) => {
    const next = { ...prev }
    if (side === "left") {
      next.left = prev.left + 1
      next.leftMouse =
        prev.leftMouse + (source === "mouse" ? 1 : 0)
      next.leftPad = prev.leftPad + (source === "touchpad" ? 1 : 0)
    } else {
      next.right = prev.right + 1
      next.rightMouse =
        prev.rightMouse + (source === "mouse" ? 1 : 0)
      next.rightPad = prev.rightPad + (source === "touchpad" ? 1 : 0)
    }
    return next
  })
  queueSave()
}

const bumpKey = (keyName: string) => {
  setState((prev) => {
    const keyCounts = { ...prev.keyCounts }
    keyCounts[keyName] = (keyCounts[keyName] ?? 0) + 1
    return {
      ...prev,
      keys: prev.keys + 1,
      keyCounts,
    }
  })
  queueSave()
}

const bumpScroll = (vertical: number | null, horizontal: number | null) => {
  if (!vertical && !horizontal) return
  setState((prev) => {
    const next = { ...prev }
    if (vertical && Number.isFinite(vertical)) {
      if (vertical > 0) next.scrollUp = prev.scrollUp + vertical
      else next.scrollDown = prev.scrollDown + Math.abs(vertical)
    }
    if (horizontal && Number.isFinite(horizontal)) {
      if (horizontal > 0) next.scrollRight = prev.scrollRight + horizontal
      else next.scrollLeft = prev.scrollLeft + Math.abs(horizontal)
    }
    return next
  })
  queueSave()
}

const ensureToday = () => {
  setState((prev) => {
    const today = todayKey()
    if (prev.date === today) return prev
    const next = { ...defaultState(), date: today }
    saveState(next)
    return next
  })
}

const parseAxis = (text: string, token: string) => {
  const regex = new RegExp(`${token}\\s+(-?\\d+(?:\\.\\d+)?)`, "i")
  const match = text.match(regex)
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function spawnInputStream(onLine: (line: string) => void) {
  const argv = ["libinput", "debug-events", "--show-keycodes"]
  try {
    const [ok, pid, stdinFd, stdoutFd, stderrFd] =
      GLib.spawn_async_with_pipes(
        null,
        argv,
        null,
        GLib.SpawnFlags.SEARCH_PATH | GLib.SpawnFlags.DO_NOT_REAP_CHILD,
        null,
      )
    if (!ok) return null
    if (stdinFd >= 0) {
      try {
        GLib.close(stdinFd)
      } catch (_) {}
    }
    const makeStream = (fd: number) =>
      new Gio.DataInputStream({
        base_stream: new GioUnix.InputStream({ fd, close_fd: true }),
      })

    const readNext = (stream: Gio.DataInputStream) => {
      stream.read_line_async(GLib.PRIORITY_DEFAULT, null, (source, res) => {
        try {
          const [line] = source.read_line_finish(res)
          if (line === null) return
          const text = new TextDecoder().decode(line).trim()
          if (text) onLine(text)
          readNext(stream)
        } catch (_) {}
      })
    }

    if (stdoutFd >= 0) readNext(makeStream(stdoutFd))
    if (stderrFd >= 0) readNext(makeStream(stderrFd))

    return () => {
      try {
        GLib.spawn_command_line_sync(`kill ${pid}`)
      } catch (_) {}
    }
  } catch (_) {
    return null
  }
}

const watcher = spawnInputStream((line) => {
  const text = line.trim()
  if (!text) return

  if (text.startsWith("{")) {
    let payload:
      | { type?: string; state?: string; button?: number; key?: number }
      | null = null
    try {
      payload = JSON.parse(text)
    } catch (_) {
      payload = null
    }
    if (!payload || typeof payload !== "object") return

    if (payload.type === "pointer_button" && payload.state === "pressed") {
      const button = Number(payload.button)
      if (button === 272) bumpClick("left", "mouse")
      else if (button === 273) bumpClick("right", "mouse")
    }

    if (
      (payload.type === "key" || payload.type === "keyboard_key") &&
      payload.state === "pressed"
    ) {
      bumpKey(`KEY_${payload.key ?? "UNKNOWN"}`)
    }

    return
  }

  const eventMatch = text.match(/^event(\d+)/i)
  const eventId = eventMatch ? eventMatch[1] : "unknown"

  if (/DEVICE_ADDED/i.test(text)) {
    deviceTypes.set(eventId, classifyDevice(text))
    return
  }

  if (/DEVICE_REMOVED/i.test(text)) {
    deviceTypes.delete(eventId)
    pressedByEvent.delete(eventId)
    return
  }

  if (/POINTER_SCROLL_/i.test(text)) {
    const vertical = parseAxis(text, "vert") ?? parseAxis(text, "vertical")
    const horizontal = parseAxis(text, "horiz") ?? parseAxis(text, "horizontal")
    bumpScroll(vertical, horizontal)
  }

  if (/POINTER_BUTTON/i.test(text) && /(pressed|released)/i.test(text)) {
    const isPressed = /pressed/i.test(text)
    const isReleased = /released/i.test(text)
    const isLeft = /BTN_LEFT/i.test(text)
    const isRight = /BTN_RIGHT/i.test(text)
    const deviceType = deviceTypes.get(eventId) ?? "unknown"
    const source = deviceType === "touchpad" ? "touchpad" : "mouse"
    const pressed = pressedByEvent.get(eventId) ?? {
      left: false,
      right: false,
    }

    if (isLeft) {
      if (isPressed || (isReleased && !pressed.left)) {
        bumpClick("left", source)
      }
      pressed.left = isPressed ? true : isReleased ? false : pressed.left
    } else if (isRight) {
      if (isPressed || (isReleased && !pressed.right)) {
        bumpClick("right", source)
      }
      pressed.right = isPressed ? true : isReleased ? false : pressed.right
    } else {
      const match = text.match(/button\s+(\d+)/i)
      const fallback = match ? Number(match[1]) : NaN
      if (fallback === 272 || fallback === 1) {
        if (isPressed || (isReleased && !pressed.left)) {
          bumpClick("left", source)
        }
        pressed.left = isPressed ? true : isReleased ? false : pressed.left
      } else if (fallback === 273 || fallback === 3) {
        if (isPressed || (isReleased && !pressed.right)) {
          bumpClick("right", source)
        }
        pressed.right = isPressed ? true : isReleased ? false : pressed.right
      }
    }
    pressedByEvent.set(eventId, pressed)
  }

  if (/POINTER_TAP|TOUCHPAD_TAP|GESTURE_TAP/i.test(text)) {
    const isRight = /finger\s+2/i.test(text) || /finger\s+3/i.test(text)
    bumpClick(isRight ? "right" : "left", "touchpad")
  }

  if (/GESTURE_HOLD_BEGIN/i.test(text)) {
    const fingerMatch = text.match(/(\d+)\s*$/)
    const fingers = fingerMatch ? Number(fingerMatch[1]) : 1
    const isRight = Number.isFinite(fingers) && fingers >= 2
    bumpClick(isRight ? "right" : "left", "touchpad")
  }

  if (/KEYBOARD_KEY/i.test(text) && /pressed/i.test(text)) {
    const parenMatch = text.match(/\((KEY_[A-Z0-9_]+)\)/)
    const directMatch = text.match(/\bKEY_[A-Z0-9_]+\b/)
    const codeMatch = text.match(/\bkey\s+(\d+)\b/i)
    const keyName =
      parenMatch?.[1] ||
      directMatch?.[0] ||
      (codeMatch ? `KEY_${codeMatch[1]}` : "KEY_UNKNOWN")
    bumpKey(keyName)
  }
})

if (!watcher) {
  setAvailable(false)
}

GLib.timeout_add(GLib.PRIORITY_DEFAULT, DAY_CHECK_MS, () => {
  ensureToday()
  return GLib.SOURCE_CONTINUE
})

export const inputCounts = state
export const inputCountsAvailable = available
