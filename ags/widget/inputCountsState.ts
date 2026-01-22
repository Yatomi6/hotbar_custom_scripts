import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import GioUnix from "gi://GioUnix?version=2.0"
import { Gdk } from "ags/gtk3"
import { createState } from "gnim"

export type InputState = {
  date: string
  startedAt: number
  screenWidth: number
  screenHeight: number
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
  distancePx: number
  clickHeatmapLeft: number[]
  clickHeatmapRight: number[]
  keyCounts: Record<string, number>
}

type DeviceType = "mouse" | "touchpad" | "keyboard" | "unknown"

const STATE_DIR = `${GLib.get_home_dir()}/.local/state/ags`
const STATE_PATH = `${STATE_DIR}/input-counts.json`
const ACTIVE_PATH = `${STATE_DIR}/input-stats-active`
const SAVE_DELAY_MS = 2000
const DAY_CHECK_MS = 60000
const POINTER_POLL_MS = 400
const ACTIVE_WINDOW_MS = 6000

export const HEATMAP_COLS = 96
export const HEATMAP_ROWS = 54

const todayKey = () => {
  const dt = GLib.DateTime.new_now_local()
  return dt?.format("%Y-%m-%d") ?? ""
}

const runCommand = (command: string): string | null => {
  try {
    const [ok, stdout] = GLib.spawn_command_line_sync(command)
    if (!ok || !stdout) return null
    return new TextDecoder().decode(stdout).trim()
  } catch (_) {
    return null
  }
}

const defaultHeatmap = () =>
  Array.from({ length: HEATMAP_COLS * HEATMAP_ROWS }, () => 0)

const defaultState = (): InputState => ({
  date: todayKey(),
  startedAt: Date.now(),
  screenWidth: 0,
  screenHeight: 0,
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
  distancePx: 0,
  clickHeatmapLeft: defaultHeatmap(),
  clickHeatmapRight: defaultHeatmap(),
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
  const date = typeof raw.date === "string" && raw.date ? raw.date : base.date
  const startedAt =
    typeof raw.startedAt === "number" && raw.startedAt > 0
      ? raw.startedAt
      : base.startedAt
  const screenWidth = toNumber(raw.screenWidth)
  const screenHeight = toNumber(raw.screenHeight)
  const leftMap =
    Array.isArray(raw.clickHeatmapLeft) &&
    raw.clickHeatmapLeft.length === HEATMAP_COLS * HEATMAP_ROWS
      ? raw.clickHeatmapLeft.map((value) => toNumber(value))
      : base.clickHeatmapLeft
  const rightMap =
    Array.isArray(raw.clickHeatmapRight) &&
    raw.clickHeatmapRight.length === HEATMAP_COLS * HEATMAP_ROWS
      ? raw.clickHeatmapRight.map((value) => toNumber(value))
      : base.clickHeatmapRight
  return {
    date,
    startedAt,
    screenWidth,
    screenHeight,
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
    distancePx: toNumber(raw.distancePx),
    clickHeatmapLeft: leftMap,
    clickHeatmapRight: rightMap,
    keyCounts: normalizeKeyCounts(raw.keyCounts),
  }
}

const isHeatmapActive = () => {
  try {
    const [ok, contents] = GLib.file_get_contents(ACTIVE_PATH)
    if (!ok || !contents) return false
    const text = new TextDecoder().decode(contents).trim()
    const ts = Number(text)
    if (!Number.isFinite(ts) || ts <= 0) return false
    return Date.now() - ts <= ACTIVE_WINDOW_MS
  } catch (_) {
    return false
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
type PointerPos = { x: number; y: number }

const deviceTypes = new Map<string, DeviceType>()
const pressedByEvent = new Map<string, PressedState>()
let lastPointer: PointerPos | null = null

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

const getPointerPosition = () => {
  const display = Gdk.Display.get_default()
  if (display) {
    const seat = display.get_default_seat()
    const device = seat?.get_pointer()
    if (device) {
      try {
        const [, x, y] = device.get_position()
        if (Number.isFinite(x) && Number.isFinite(y)) {
          return { x, y }
        }
      } catch (_) {}
    }
  }
  const hyprJson = runCommand("hyprctl -j cursorpos")
  if (hyprJson) {
    try {
      const parsed = JSON.parse(hyprJson)
      const x = Number(parsed?.x)
      const y = Number(parsed?.y)
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return { x, y }
      }
    } catch (_) {}
  }
  const hyprText = runCommand("hyprctl cursorpos")
  if (hyprText) {
    const match = hyprText.match(/(-?\\d+)\\s*,\\s*(-?\\d+)/)
    if (match) {
      const x = Number(match[1])
      const y = Number(match[2])
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return { x, y }
      }
    }
  }
  return null
}

const getDisplayBounds = () => {
  const display = Gdk.Display.get_default()
  if (!display) return null
  const count = display.get_n_monitors?.() ?? 0
  if (count <= 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (let i = 0; i < count; i += 1) {
    const monitor = display.get_monitor(i)
    if (!monitor) continue
    const geom = monitor.get_geometry()
    minX = Math.min(minX, geom.x)
    minY = Math.min(minY, geom.y)
    maxX = Math.max(maxX, geom.x + geom.width)
    maxY = Math.max(maxY, geom.y + geom.height)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

const recordClickAtPointer = (side: "left" | "right") => {
  if (!isHeatmapActive()) return
  const pos = getPointerPosition() ?? lastPointer
  const bounds = getDisplayBounds()
  if (!pos || !bounds) return
  lastPointer = pos
  updateScreenSize(bounds)
  const relX = (pos.x - bounds.x) / bounds.width
  const relY = (pos.y - bounds.y) / bounds.height
  const col = Math.min(
    HEATMAP_COLS - 1,
    Math.max(0, Math.floor(relX * HEATMAP_COLS)),
  )
  const row = Math.min(
    HEATMAP_ROWS - 1,
    Math.max(0, Math.floor(relY * HEATMAP_ROWS)),
  )
  const index = row * HEATMAP_COLS + col
  setState((prev) => {
    const next = { ...prev }
    if (side === "left") {
      const updated = prev.clickHeatmapLeft.slice()
      updated[index] = (updated[index] ?? 0) + 1
      next.clickHeatmapLeft = updated
    } else {
      const updated = prev.clickHeatmapRight.slice()
      updated[index] = (updated[index] ?? 0) + 1
      next.clickHeatmapRight = updated
    }
    return next
  })
  queueSave()
}

const updateScreenSize = (bounds: { width: number; height: number }) => {
  if (!bounds.width || !bounds.height) return
  setState((prev) => {
    if (
      prev.screenWidth === bounds.width &&
      prev.screenHeight === bounds.height
    ) {
      return prev
    }
    return {
      ...prev,
      screenWidth: bounds.width,
      screenHeight: bounds.height,
    }
  })
}

const ensureToday = () => {
  setState((prev) => {
    if (prev.date) return prev
    const next = { ...prev, date: todayKey() }
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
  const argv = [
    "libinput",
    "debug-events",
    "--show-keycodes",
    "--compress-motion-events",
  ]
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
  if (!text.startsWith("{")) {
    const upper = text.toUpperCase()
    if (
      !upper.includes("DEVICE_") &&
      !upper.includes("POINTER_BUTTON") &&
      !upper.includes("POINTER_SCROLL") &&
      !upper.includes("POINTER_TAP") &&
      !upper.includes("TOUCHPAD_TAP") &&
      !upper.includes("GESTURE_TAP") &&
      !upper.includes("GESTURE_HOLD_BEGIN") &&
      !upper.includes("KEYBOARD_KEY") &&
      !upper.includes("BTN_") &&
      !upper.includes("BUTTON")
    ) {
      return
    }
  }

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
      if (button === 272) {
        bumpClick("left", "mouse")
        recordClickAtPointer("left")
      } else if (button === 273) {
        bumpClick("right", "mouse")
        recordClickAtPointer("right")
      }
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

  if (
    (/POINTER_BUTTON/i.test(text) ||
      /BTN_LEFT|BTN_RIGHT/i.test(text) ||
      /button\s+(?:272|273|1|3)/i.test(text)) &&
    /(pressed|released)/i.test(text)
  ) {
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
        recordClickAtPointer("left")
      }
      pressed.left = isPressed ? true : isReleased ? false : pressed.left
    } else if (isRight) {
      if (isPressed || (isReleased && !pressed.right)) {
        bumpClick("right", source)
        recordClickAtPointer("right")
      }
      pressed.right = isPressed ? true : isReleased ? false : pressed.right
    } else {
      const match = text.match(/button\s+(\d+)/i)
      const fallback = match ? Number(match[1]) : NaN
      if (fallback === 272 || fallback === 1) {
        if (isPressed || (isReleased && !pressed.left)) {
          bumpClick("left", source)
          recordClickAtPointer("left")
        }
        pressed.left = isPressed ? true : isReleased ? false : pressed.left
      } else if (fallback === 273 || fallback === 3) {
        if (isPressed || (isReleased && !pressed.right)) {
          bumpClick("right", source)
          recordClickAtPointer("right")
        }
        pressed.right = isPressed ? true : isReleased ? false : pressed.right
      }
    }
    pressedByEvent.set(eventId, pressed)
  }

  if (/POINTER_TAP|TOUCHPAD_TAP|GESTURE_TAP/i.test(text)) {
    const isRight = /finger\s+2/i.test(text) || /finger\s+3/i.test(text)
    const side = isRight ? "right" : "left"
    bumpClick(side, "touchpad")
    recordClickAtPointer(side)
  }

  if (/GESTURE_HOLD_BEGIN/i.test(text)) {
    const fingerMatch = text.match(/(\d+)\s*$/)
    const fingers = fingerMatch ? Number(fingerMatch[1]) : 1
    const isRight = Number.isFinite(fingers) && fingers >= 2
    const side = isRight ? "right" : "left"
    bumpClick(side, "touchpad")
    recordClickAtPointer(side)
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

GLib.timeout_add(GLib.PRIORITY_DEFAULT, POINTER_POLL_MS, () => {
  const current = getPointerPosition()
  const bounds = getDisplayBounds()
  if (bounds) updateScreenSize(bounds)
  if (!current) return GLib.SOURCE_CONTINUE
  if (!lastPointer) {
    lastPointer = current
    return GLib.SOURCE_CONTINUE
  }
  const dx = current.x - lastPointer.x
  const dy = current.y - lastPointer.y
  const distance = Math.hypot(dx, dy)
  if (distance > 0) {
    setState((prev) => ({ ...prev, distancePx: prev.distancePx + distance }))
    queueSave()
  }
  lastPointer = current
  return GLib.SOURCE_CONTINUE
})

export const inputCounts = state
export const inputCountsAvailable = available
