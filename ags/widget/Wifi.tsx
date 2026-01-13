import { Gtk, Gdk } from "ags/gtk3"
import GLib from "gi://GLib?version=2.0"
import Gio from "gi://Gio?version=2.0"
import DbusmenuGtk3 from "gi://DbusmenuGtk3?version=0.4"
import { createPoll } from "ags/time"
import { execAsync } from "ags/process"
import {
  BAR_TEXT_COLOR,
  BAR_HEIGHT,
  BAR_PADDING_Y,
  WIDGET_COMPRESS_Y,
  WIDGET_SCALE,
} from "../barConfig"

const UPDATE_MS = 1000
const ICONS = ["󰤯", "󰤟", "󰤢", "󰤥", "󰤨"]
const ICON_DISCONNECTED = "󰤮"
const NM_APPLET_DEST = "org.freedesktop.network-manager-applet"
const NM_APPLET_MENU_PATH = "/org/ayatana/NotificationItem/nm_applet/Menu"
const DBUSMENU_IFACE = "com.canonical.dbusmenu"

const CONTENT_HEIGHT = Math.max(10, BAR_HEIGHT - BAR_PADDING_Y * 2)
const LINE_SPACING = 0
const FONT_SCALE = Math.max(1, WIDGET_SCALE)
const TOP_LINE_PX = Math.max(6, Math.round(CONTENT_HEIGHT * 0.55))
const BOTTOM_LINE_PX = Math.max(5, CONTENT_HEIGHT - TOP_LINE_PX)

const ICON_FONT = Math.max(6, Math.round(TOP_LINE_PX * 1.0 * FONT_SCALE))
const RATE_FONT = Math.max(5, Math.round(BOTTOM_LINE_PX * 1.0 * FONT_SCALE))

type WifiState = {
  visible: boolean
  connected: boolean
  ssid: string
  security: string
  signal: number
  icon: string
  rxText: string
  txText: string
  tooltip: string
}

let lastRx: number | null = null
let lastTx: number | null = null
let lastTs: number | null = null
let lastDevice: string | null = null

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function runCommand(command: string): string | null {
  try {
    const [ok, stdout] = GLib.spawn_command_line_sync(command)
    if (!ok || !stdout) return null
    return new TextDecoder().decode(stdout).trim()
  } catch (_) {
    return null
  }
}

function readNumber(path: string): number | null {
  try {
    const [ok, contents] = GLib.file_get_contents(path)
    if (!ok) return null
    const text = new TextDecoder().decode(contents).trim()
    const value = Number(text)
    return Number.isFinite(value) ? value : null
  } catch (_) {
    return null
  }
}

function formatRate(bytesPerSecond: number) {
  const value = Number.isFinite(bytesPerSecond) ? Math.max(0, bytesPerSecond) : 0
  const units = ["B/s", "KB/s", "MB/s", "GB/s"]
  let unit = 0
  let scaled = value
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024
    unit += 1
  }
  if (unit === 0) return `${Math.round(scaled)}${units[unit]}`
  const digits = scaled < 10 ? 1 : 0
  return `${scaled.toFixed(digits)}${units[unit]}`
}

function signalToBars(signal: number) {
  if (signal <= 0) return 0
  if (signal < 25) return 1
  if (signal < 50) return 2
  if (signal < 75) return 3
  return 4
}

type MenuNode = {
  id: number
  props: Record<string, unknown>
  children: MenuNode[]
}

let menuProxy: Gio.DBusProxy | null = null
let activeMenu: Gtk.Menu | null = null
let trayMenu: Gtk.Menu | null = null

function getTrayMenu() {
  if (trayMenu) return trayMenu
  try {
    const menu = DbusmenuGtk3.Menu.new(NM_APPLET_DEST, NM_APPLET_MENU_PATH)
    menu.get_style_context().add_class("wifi-tray-menu")
    menu.connect("deactivate", () => {
      menu.popdown()
    })
    trayMenu = menu
    return trayMenu
  } catch (_) {
    trayMenu = null
    return null
  }
}

function getMenuProxy(): Gio.DBusProxy | null {
  if (menuProxy) return menuProxy
  try {
    menuProxy = Gio.DBusProxy.new_sync(
      Gio.DBus.session,
      Gio.DBusProxyFlags.NONE,
      null,
      NM_APPLET_DEST,
      NM_APPLET_MENU_PATH,
      DBUSMENU_IFACE,
      null,
    )
    return menuProxy
  } catch (_) {
    menuProxy = null
    return null
  }
}

function unpack(value: unknown): unknown {
  if (value && typeof value === "object" && "deepUnpack" in value) {
    try {
      return (value as { deepUnpack: () => unknown }).deepUnpack()
    } catch (_) {
      return value
    }
  }
  return value
}

function parseMenuNode(raw: unknown): MenuNode | null {
  const unpacked = unpack(raw)
  if (!Array.isArray(unpacked) || unpacked.length < 3) return null
  const [id, rawProps, rawChildren] = unpacked
  const props: Record<string, unknown> = {}
  const propsObj = (unpack(rawProps) ?? {}) as Record<string, unknown>
  for (const [key, value] of Object.entries(propsObj)) {
    props[key] = unpack(value)
  }
  const childrenRaw = (unpack(rawChildren) as unknown[]) ?? []
  const children = childrenRaw
    .map((child) => parseMenuNode(child))
    .filter(Boolean) as MenuNode[]
  return { id: Number(id), props, children }
}

function fetchMenuLayout(): MenuNode | null {
  const proxy = getMenuProxy()
  if (!proxy) return null

  try {
    const about = proxy.call_sync(
      "AboutToShow",
      new GLib.Variant("(i)", [0]),
      Gio.DBusCallFlags.NONE,
      1000,
      null,
    )
    const [needUpdate] = about?.deepUnpack?.() ?? [false]
    if (needUpdate) {
      // fall through to reload layout
    }
  } catch (_) {}

  const result = proxy.call_sync(
    "GetLayout",
    new GLib.Variant("(iias)", [0, -1, []]),
    Gio.DBusCallFlags.NONE,
    1000,
    null,
  )
  const unpacked = result?.deepUnpack?.()
  if (!unpacked || !Array.isArray(unpacked) || unpacked.length < 2) return null
  const layout = parseMenuNode(unpacked[1])
  return layout
}

function sendMenuEvent(id: number) {
  const proxy = getMenuProxy()
  if (!proxy) return
  try {
    proxy.call_sync(
      "Event",
      new GLib.Variant("(isvu)", [id, "clicked", new GLib.Variant("s", ""), 0]),
      Gio.DBusCallFlags.NONE,
      1000,
      null,
    )
  } catch (_) {}
}

function buildMenuItem(node: MenuNode): Gtk.MenuItem | Gtk.SeparatorMenuItem | null {
  const props = node.props
  const visible = props.visible !== false
  if (!visible) return null

  const type = String(props.type ?? "")
  if (type === "separator") {
    return new Gtk.SeparatorMenuItem()
  }

  const rawLabel = String(props.label ?? "")
  const label = rawLabel.replace(/_/g, "")
  const toggleType = String(props["toggle-type"] ?? "")
  const toggleState = Number(props["toggle-state"] ?? 0)

  let item: Gtk.MenuItem
  if (toggleType === "checkmark" || toggleType === "radio") {
    const checkItem = new Gtk.CheckMenuItem({ label })
    if (toggleType === "radio") {
      checkItem.draw_as_radio = true
    }
    checkItem.active = toggleState === 1
    item = checkItem
  } else {
    item = new Gtk.MenuItem({ label })
  }

  item.set_sensitive(props.enabled !== false)

  if (node.children.length > 0) {
    const submenu = new Gtk.Menu()
    for (const child of node.children) {
      const childItem = buildMenuItem(child)
      if (childItem) submenu.append(childItem)
    }
    submenu.show_all()
    item.set_submenu(submenu)
  } else {
    item.connect("activate", () => sendMenuEvent(node.id))
  }

  return item
}

function openTrayWifiMenu(widget?: Gtk.Widget | null, event?: Gdk.Event | null) {
  try {
    const menu = getTrayMenu()
    if (!menu) throw new Error("tray menu unavailable")
    if (widget) {
      menu.attach_to_widget(widget, null)
    }
    const client = menu.get_client?.()
    client?.get_root?.()
    const [hasButton, button] = event?.get_button?.() ?? [false, 0]
    const time = event?.get_time?.() ?? Gtk.get_current_event_time()
    menu.popup(null, null, null, hasButton ? button : 0, time)
    return
  } catch (_) {
    // fall back to manual menu building
  }

  const layout = fetchMenuLayout()
  if (!layout) {
    execAsync("omarchy-launch-wifi").catch(() => null)
    return
  }

  if (activeMenu) {
    activeMenu.destroy()
    activeMenu = null
  }

  const menu = new Gtk.Menu()
  menu.get_style_context().add_class("wifi-tray-menu")
  for (const child of layout.children) {
    const item = buildMenuItem(child)
    if (item) menu.append(item)
  }
  menu.show_all()
  menu.connect("deactivate", () => {
    menu.destroy()
    if (activeMenu === menu) activeMenu = null
  })
  activeMenu = menu
  if (widget) {
    menu.attach_to_widget(widget, null)
  }
  try {
    menu.popup_at_pointer(event ?? null)
  } catch (_) {
    if (widget) {
      try {
        menu.popup_at_widget(widget, Gdk.Gravity.SOUTH_WEST, Gdk.Gravity.NORTH_WEST, event ?? null)
      } catch (_) {}
    }
  }
}

type WifiDeviceInfo = {
  device: string
  state: string
}

function getWifiDevice(): WifiDeviceInfo | null {
  const output = runCommand("nmcli -t -f DEVICE,TYPE,STATE dev")
  if (!output) return null
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean)
  let fallback: WifiDeviceInfo | null = null
  for (const line of lines) {
    const [device, type, state] = line.split(":")
    if (!device || type !== "wifi") continue
    if (!fallback) fallback = { device, state: state ?? "unknown" }
    if (state?.startsWith("connected")) return { device, state }
  }
  return fallback
}

function parseSignalPercentFromIw(text: string | null) {
  if (!text) return null
  const match = text.match(/signal:\s*(-?\d+)\s*dBm/i)
  if (!match) return null
  const dbm = Number(match[1])
  if (!Number.isFinite(dbm)) return null
  const clamped = clamp(dbm, -90, -30)
  return Math.round(((clamped + 90) / 60) * 100)
}

function getActiveWifi(device: string) {
  const output = runCommand(
    `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY,FREQ dev wifi list ifname ${device}`,
  )
  if (!output) return null
  const lines = output.split("\n").map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    const parts = line.split(":")
    if (parts.length < 5) continue
    const inUse = parts[0]
    const signalRaw = parts[parts.length - 3]
    const securityRaw = parts[parts.length - 2]
    const freqRaw = parts[parts.length - 1]
    const ssidRaw = parts.slice(1, -3).join(":")
    if (inUse !== "*") continue
    const ssid = ssidRaw || "<hidden>"
    const signal = clamp(Number(signalRaw), 0, 100)
    const security = securityRaw && securityRaw !== "--" ? securityRaw : "Open"
    let freq = ""
    if (freqRaw) {
      const trimmed = freqRaw.trim()
      freq = trimmed.toLowerCase().includes("mhz") ? trimmed : `${trimmed} MHz`
    }
    return { ssid, signal, security, freq }
  }
  return null
}

function getActiveConnection(device: string) {
  const output = runCommand(`nmcli -t -f GENERAL.CONNECTION dev show ${device}`)
  if (!output) return null
  const match = output.match(/GENERAL\.CONNECTION:(.*)/)
  if (!match) return null
  const value = match[1].trim()
  return value && value !== "--" ? value : null
}

function getConnectionSsid(connection: string) {
  const output = runCommand(
    `nmcli -t -f 802-11-wireless.ssid connection show ${connection}`,
  )
  if (!output) return null
  const match = output.match(/802-11-wireless\.ssid:(.*)/)
  if (!match) return null
  const value = match[1].trim()
  return value || null
}

function getConnectionSecurity(connection: string) {
  const output = runCommand(
    `nmcli -t -f 802-11-wireless-security.key-mgmt connection show ${connection}`,
  )
  if (!output) return null
  const match = output.match(/802-11-wireless-security\.key-mgmt:(.*)/)
  if (!match) return null
  const value = match[1].trim()
  return value && value !== "--" ? value : null
}

function computeWifiState(): WifiState {
  const deviceInfo = getWifiDevice()
  const device = deviceInfo?.device ?? null
  const isConnected = deviceInfo?.state?.startsWith("connected") ?? false

  const active = device && isConnected ? getActiveWifi(device) : null
  const iwSignal = device ? parseSignalPercentFromIw(runCommand(`iw dev ${device} link`)) : null
  const connectionName = device && isConnected ? getActiveConnection(device) : null
  const connectionSsid = connectionName ? getConnectionSsid(connectionName) : null
  const connectionSecurity = connectionName ? getConnectionSecurity(connectionName) : null

  if (device !== lastDevice) {
    lastDevice = device
    lastRx = null
    lastTx = null
    lastTs = null
  }

  let rxRate = 0
  let txRate = 0

  if (device) {
    const rx = readNumber(`/sys/class/net/${device}/statistics/rx_bytes`)
    const tx = readNumber(`/sys/class/net/${device}/statistics/tx_bytes`)
    const now = Date.now()
    if (rx !== null && tx !== null) {
      if (lastRx !== null && lastTx !== null && lastTs !== null) {
        const dt = Math.max(0.2, (now - lastTs) / 1000)
        rxRate = Math.max(0, (rx - lastRx) / dt)
        txRate = Math.max(0, (tx - lastTx) / dt)
      }
      lastRx = rx
      lastTx = tx
      lastTs = now
    }
  }

  if (!device || !isConnected) {
    return {
      visible: true,
      connected: false,
      ssid: "",
      security: "",
      signal: 0,
      icon: ICON_DISCONNECTED,
      rxText: formatRate(rxRate),
      txText: formatRate(txRate),
      tooltip: "Wi-Fi disconnected",
    }
  }

  const ssid = active?.ssid ?? connectionSsid ?? connectionName ?? "<hidden>"
  const signal = active?.signal ?? iwSignal ?? 0
  const security = active?.security ?? connectionSecurity ?? "Open"
  const bars = signalToBars(signal)
  const icon = ICONS[bars]
  const tooltip = `${ssid}\nSignal: ${signal}%\nSecurity: ${security}${
    active?.freq ? `\nFrequency: ${active.freq}` : ""
  }`

  return {
    visible: true,
    connected: true,
    ssid,
    security,
    signal,
    icon,
    rxText: formatRate(rxRate),
    txText: formatRate(txRate),
    tooltip,
  }
}

export default function Wifi() {
  const state = createPoll<WifiState>(
    {
      visible: true,
      connected: false,
      ssid: "",
      security: "",
      signal: 0,
      icon: ICON_DISCONNECTED,
      rxText: "0B/s",
      txText: "0B/s",
      tooltip: "",
    },
    UPDATE_MS,
    computeWifiState,
  )

  return (
    <eventbox
      class="wifi"
      visible_window={false}
      visible={state.as((s) => s.visible)}
      tooltip_text={state.as((s) => s.tooltip)}
      onButtonPressEvent={(widget, event) => {
        openTrayWifiMenu(widget, event as any)
        return true
      }}
    >
      <box orientation={Gtk.Orientation.HORIZONTAL} spacing={4} valign={Gtk.Align.CENTER}>
        <box
          class="wifi-speed"
          orientation={Gtk.Orientation.VERTICAL}
          spacing={2}
          valign={Gtk.Align.CENTER}
        >
          <label
            class="wifi-down"
            label={state.as((s) => `↓${s.rxText}`)}
            width_chars={8}
            xalign={1}
            css={`font-size: ${RATE_FONT}px; margin: -${WIDGET_COMPRESS_Y}px 0; padding: 0; color: ${BAR_TEXT_COLOR};`}
          />
          <label
            class="wifi-up"
            label={state.as((s) => `↑${s.txText}`)}
            width_chars={8}
            xalign={1}
            css={`font-size: ${RATE_FONT}px; margin: -${WIDGET_COMPRESS_Y}px 0; padding: 0; color: ${BAR_TEXT_COLOR};`}
          />
        </box>
        <label
          class="wifi-icon"
          label={state.as((s) => s.icon)}
          css={`font-size: ${ICON_FONT}px; margin: -${WIDGET_COMPRESS_Y}px 0; padding: 0; color: ${BAR_TEXT_COLOR};`}
          xalign={0.5}
          valign={Gtk.Align.CENTER}
        />
      </box>
    </eventbox>
  )
}
