import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import { createComputed } from "gnim"
import { createPoll } from "ags/time"
import GLib from "gi://GLib?version=2.0"
import {
  BAR_COLOR,
  BAR_TEXT_COLOR,
  WIDGET_COMPRESS_Y,
  WIDGET_SCALE,
} from "../barConfig"
import { inputCounts, inputCountsAvailable } from "./inputCountsState"
import { closeInputStats, inputStatsOpen } from "./inputStatsState"

type KeyCellDef = {
  id: string
  label: string
  span?: number
}

const KEY_ROWS: KeyCellDef[][] = [
  [
    { id: "KEY_ESC", label: "Esc" },
    { id: "KEY_F1", label: "F1" },
    { id: "KEY_F2", label: "F2" },
    { id: "KEY_F3", label: "F3" },
    { id: "KEY_F4", label: "F4" },
    { id: "KEY_F5", label: "F5" },
    { id: "KEY_F6", label: "F6" },
    { id: "KEY_F7", label: "F7" },
    { id: "KEY_F8", label: "F8" },
    { id: "KEY_F9", label: "F9" },
    { id: "KEY_F10", label: "F10" },
    { id: "KEY_F11", label: "F11" },
    { id: "KEY_F12", label: "F12" },
  ],
  [
    { id: "KEY_GRAVE", label: "²" },
    { id: "KEY_1", label: "&" },
    { id: "KEY_2", label: "é" },
    { id: "KEY_3", label: "\"" },
    { id: "KEY_4", label: "'" },
    { id: "KEY_5", label: "(" },
    { id: "KEY_6", label: "-" },
    { id: "KEY_7", label: "è" },
    { id: "KEY_8", label: "_" },
    { id: "KEY_9", label: "ç" },
    { id: "KEY_0", label: "à" },
    { id: "KEY_MINUS", label: ")" },
    { id: "KEY_EQUAL", label: "=" },
    { id: "KEY_BACKSPACE", label: "Back", span: 2 },
  ],
  [
    { id: "KEY_TAB", label: "Tab", span: 1.4 },
    { id: "KEY_Q", label: "A" },
    { id: "KEY_W", label: "Z" },
    { id: "KEY_E", label: "E" },
    { id: "KEY_R", label: "R" },
    { id: "KEY_T", label: "T" },
    { id: "KEY_Y", label: "Y" },
    { id: "KEY_U", label: "U" },
    { id: "KEY_I", label: "I" },
    { id: "KEY_O", label: "O" },
    { id: "KEY_P", label: "P" },
    { id: "KEY_LEFTBRACE", label: "^" },
    { id: "KEY_RIGHTBRACE", label: "$" },
    { id: "KEY_BACKSLASH", label: "*" },
  ],
  [
    { id: "KEY_CAPSLOCK", label: "Caps", span: 1.6 },
    { id: "KEY_A", label: "Q" },
    { id: "KEY_S", label: "S" },
    { id: "KEY_D", label: "D" },
    { id: "KEY_F", label: "F" },
    { id: "KEY_G", label: "G" },
    { id: "KEY_H", label: "H" },
    { id: "KEY_J", label: "J" },
    { id: "KEY_K", label: "K" },
    { id: "KEY_L", label: "L" },
    { id: "KEY_SEMICOLON", label: "M" },
    { id: "KEY_APOSTROPHE", label: "ù" },
    { id: "KEY_ENTER", label: "Enter", span: 2 },
  ],
  [
    { id: "KEY_LEFTSHIFT", label: "Shift", span: 2.2 },
    { id: "KEY_102ND", label: "<" },
    { id: "KEY_Z", label: "W" },
    { id: "KEY_X", label: "X" },
    { id: "KEY_C", label: "C" },
    { id: "KEY_V", label: "V" },
    { id: "KEY_B", label: "B" },
    { id: "KEY_N", label: "N" },
    { id: "KEY_M", label: "," },
    { id: "KEY_COMMA", label: ";" },
    { id: "KEY_DOT", label: ":" },
    { id: "KEY_SLASH", label: "!" },
    { id: "KEY_RIGHTSHIFT", label: "Shift", span: 2.2 },
  ],
  [
    { id: "KEY_LEFTCTRL", label: "Ctrl", span: 1.4 },
    { id: "KEY_LEFTMETA", label: "Meta", span: 1.4 },
    { id: "KEY_LEFTALT", label: "Alt", span: 1.4 },
    { id: "KEY_SPACE", label: "Space", span: 6 },
    { id: "KEY_RIGHTALT", label: "Alt", span: 1.4 },
    { id: "KEY_RIGHTMETA", label: "Meta", span: 1.4 },
    { id: "KEY_MENU", label: "Menu", span: 1.4 },
    { id: "KEY_RIGHTCTRL", label: "Ctrl", span: 1.4 },
  ],
]

const FLAT_KEYS = KEY_ROWS.flat().map((cell) => cell.id)

const PANEL_TEXT = Math.max(10, Math.round(12 * (WIDGET_SCALE / 1.4)))
const TITLE_TEXT = Math.max(PANEL_TEXT + 2, Math.round(PANEL_TEXT * 1.2))
const KEY_FONT = Math.max(8, Math.round(PANEL_TEXT * 0.85))
const KEY_HEIGHT = Math.max(18, Math.round(KEY_FONT * 1.8))
const KEY_GAP = Math.max(2, Math.round(KEY_FONT * 0.35))
const SECTION_GAP = Math.max(6, Math.round(PANEL_TEXT * 0.5))
const COLUMN_GAP = Math.max(10, Math.round(PANEL_TEXT * 0.9))
const PANEL_PAD_X = Math.max(12, Math.round(PANEL_TEXT * 0.9))
const PANEL_PAD_Y = Math.max(10, Math.round(PANEL_TEXT * 0.8))
const SECTION_PAD_X = Math.max(8, Math.round(PANEL_TEXT * 0.75))
const SECTION_PAD_Y = Math.max(6, Math.round(PANEL_TEXT * 0.6))

const HEAT_LOW = [46, 52, 64]
const HEAT_HIGH = [191, 97, 106]
const HEAT_MAX = [208, 122, 255]

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value))

const mix = (from: number, to: number, ratio: number) =>
  Math.round(from + (to - from) * ratio)

const heatColor = (ratio: number, isTop: boolean) => {
  const t = Math.pow(clamp(ratio), 0.7)
  const base = isTop ? HEAT_MAX : HEAT_HIGH
  const r = mix(HEAT_LOW[0], base[0], t)
  const g = mix(HEAT_LOW[1], base[1], t)
  const b = mix(HEAT_LOW[2], base[2], t)
  return `rgb(${r}, ${g}, ${b})`
}

const formatScroll = (value: number) => {
  const rounded = Math.round(value * 10) / 10
  return rounded.toString()
}

export default function InputStatsWindow(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT, BOTTOM } = Astal.WindowAnchor
  const visible = inputStatsOpen
  const geometry = gdkmonitor.get_geometry()
  const panelMaxWidth = Math.min(720, Math.max(360, geometry.width - 80))
  const rowUnits = Math.max(
    ...KEY_ROWS.map((row) =>
      row.reduce((total, cell) => total + (cell.span ?? 1), 0),
    ),
  )
  const keyboardWidth = Math.max(240, panelMaxWidth - PANEL_PAD_X * 2)
  const keyBase = Math.max(
    12,
    Math.floor((keyboardWidth - KEY_GAP * (rowUnits - 1)) / rowUnits),
  )
const panelCss = `background: ${BAR_COLOR}; border: 1px solid #3b4252; border-radius: 10px; padding: ${PANEL_PAD_Y}px ${PANEL_PAD_X}px;`
  const sectionCss = `background: #2b303b; border: 1px solid #3b4252; border-radius: 8px; padding: ${SECTION_PAD_Y}px ${SECTION_PAD_X}px;`
  const titleCss = `font-size: ${TITLE_TEXT}px; font-weight: 600; margin: -${WIDGET_COMPRESS_Y}px 0; color: ${BAR_TEXT_COLOR};`
  const labelCss = `font-size: ${PANEL_TEXT}px; margin: -${WIDGET_COMPRESS_Y}px 0; color: ${BAR_TEXT_COLOR};`
  const metaCss = `font-size: ${Math.max(8, PANEL_TEXT - 1)}px; margin: -${WIDGET_COMPRESS_Y}px 0; color: ${BAR_TEXT_COLOR};`

  const nowMs = createPoll(0, 1000, () => Date.now())

  const totalClicks = createComputed(() => {
    if (!inputCountsAvailable()) return "-- | --"
    const current = inputCounts()
    return `${current.left} | ${current.right}`
  })
  const mouseClicks = createComputed(() => {
    if (!inputCountsAvailable()) return "-- | --"
    const current = inputCounts()
    return `${current.leftMouse} | ${current.rightMouse}`
  })
  const padClicks = createComputed(() => {
    if (!inputCountsAvailable()) return "-- | --"
    const current = inputCounts()
    return `${current.leftPad} | ${current.rightPad}`
  })
  const keyTotal = createComputed(() => {
    if (!inputCountsAvailable()) return "--"
    return `${inputCounts().keys}`
  })
  const scrollVertical = createComputed(() => {
    if (!inputCountsAvailable()) return "--"
    const current = inputCounts()
    return `↑ ${formatScroll(current.scrollUp)}  ↓ ${formatScroll(
      current.scrollDown,
    )}`
  })
  const scrollHorizontal = createComputed(() => {
    if (!inputCountsAvailable()) return "--"
    const current = inputCounts()
    return `← ${formatScroll(current.scrollLeft)}  → ${formatScroll(
      current.scrollRight,
    )}`
  })

  const keyStats = createComputed(() => {
    const counts = inputCounts().keyCounts ?? {}
    let max = 0
    let min = Number.POSITIVE_INFINITY
    for (const id of FLAT_KEYS) {
      const value = Number(counts[id]) || 0
      if (value > max) max = value
      if (value > 0 && value < min) min = value
    }
    if (!Number.isFinite(min)) min = 0
    return { counts, max, min }
  })

  const startLabel = createComputed(() => {
    if (!inputCountsAvailable()) return "Début: --"
    const startedAt = inputCounts().startedAt
    const dt =
      typeof startedAt === "number" && startedAt > 0
        ? GLib.DateTime.new_from_unix_local(startedAt / 1000)
        : null
    const display = dt?.format("%d/%m/%Y %H:%M:%S") ?? "--"
    return `Début: ${display}`
  })

  const elapsedLabel = createComputed(() => {
    if (!inputCountsAvailable()) return "Depuis: --"
    const startedAt = inputCounts().startedAt
    const now = nowMs()
    if (!startedAt || !now) return "Depuis: --"
    const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
    const days = Math.floor(elapsed / 86400)
    const hours = Math.floor(elapsed / 3600) % 24
    const minutes = Math.floor(elapsed / 60) % 60
    const seconds = elapsed % 60
    const pad = (value: number) => value.toString().padStart(2, "0")
    return `Depuis: ${days}j ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
  })

  const KeyCell = ({ id, label, span: keySpan = 1 }: KeyCellDef) => {
    const css = keyStats.as((stats) => {
      const count = Number(stats.counts[id]) || 0
      const range = stats.max - stats.min
      const ratio =
        count > 0 && stats.max > 0 && range > 0
          ? (count - stats.min) / range
          : count > 0 && stats.max > 0
            ? count / stats.max
            : 0
      const isTop = stats.max > 0 && count === stats.max
      const bg = count > 0 ? heatColor(ratio, isTop) : "#2b303b"
      const width = Math.round(keyBase * keySpan)
      const textColor = count > 0 ? BAR_TEXT_COLOR : BAR_TEXT_COLOR
      return `min-width: ${width}px; min-height: ${KEY_HEIGHT}px; background: ${bg}; border: 1px solid #3b4252; border-radius: 6px; color: ${textColor};`
    })
    const tooltip = keyStats.as((stats) => {
      const count = Number(stats.counts[id]) || 0
      return `${label}: ${count}`
    })
    return (
      <box
        class="input-key"
        halign={Gtk.Align.CENTER}
        valign={Gtk.Align.CENTER}
        css={css}
        tooltip_text={tooltip}
        width_request={Math.round(keyBase * keySpan)}
        height_request={KEY_HEIGHT}
      >
        <label
          label={label}
          xalign={0.5}
          css={`font-size: ${KEY_FONT}px; margin: -${WIDGET_COMPRESS_Y}px 0;`}
        />
      </box>
    )
  }

  const onBackdropClick = () => {
    closeInputStats()
    return true
  }

  return (
    <window
      name="input-stats"
      class="input-stats-window"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.IGNORE}
      anchor={TOP | LEFT | RIGHT | BOTTOM}
      layer={Astal.Layer.OVERLAY}
      visible={visible.as((isVisible) => isVisible)}
      application={app}
    >
      <eventbox
        class="input-stats-backdrop"
        visible_window={true}
        css="background: rgba(0,0,0,0);"
        hexpand={true}
        vexpand={true}
        onButtonPressEvent={onBackdropClick}
      >
        <box
          class="input-stats-center"
          hexpand={true}
          vexpand={true}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
        >
          <eventbox
            class="input-stats-panel"
            visible_window={true}
            onButtonPressEvent={() => true}
          >
            <box
              orientation={Gtk.Orientation.VERTICAL}
              spacing={SECTION_GAP}
              css={panelCss}
              width_request={panelMaxWidth}
            >
              <box orientation={Gtk.Orientation.HORIZONTAL} spacing={SECTION_GAP}>
                <label
                  label="Input stats"
                  xalign={0}
                  hexpand={true}
                  halign={Gtk.Align.START}
                  css={titleCss}
                />
                <box
                  orientation={Gtk.Orientation.VERTICAL}
                  spacing={1}
                  halign={Gtk.Align.END}
                >
                  <label label={startLabel} xalign={1} css={metaCss} />
                  <label label={elapsedLabel} xalign={1} css={metaCss} />
                </box>
              </box>

              <box
                orientation={Gtk.Orientation.HORIZONTAL}
                spacing={COLUMN_GAP}
                homogeneous={true}
              >
                <box
                  orientation={Gtk.Orientation.VERTICAL}
                  spacing={KEY_GAP}
                  css={sectionCss}
                  hexpand={true}
                >
                  <label label="Clicks" xalign={0} css={labelCss} />
                  <label label={totalClicks} xalign={0} css={labelCss} />
                  <label
                    label={mouseClicks.as((value) => `Mouse: ${value}`)}
                    xalign={0}
                    css={labelCss}
                  />
                  <label
                    label={padClicks.as((value) => `Touchpad: ${value}`)}
                    xalign={0}
                    css={labelCss}
                  />
                </box>

                <box
                  orientation={Gtk.Orientation.VERTICAL}
                  spacing={KEY_GAP}
                  css={sectionCss}
                  hexpand={true}
                >
                  <label label="Scroll" xalign={0} css={labelCss} />
                  <label label={scrollVertical} xalign={0} css={labelCss} />
                  <label label={scrollHorizontal} xalign={0} css={labelCss} />
                </box>

                <box
                  orientation={Gtk.Orientation.VERTICAL}
                  spacing={KEY_GAP}
                  css={sectionCss}
                  hexpand={true}
                >
                  <label label="Keys" xalign={0} css={labelCss} />
                  <label
                    label={keyTotal.as((value) => `Total: ${value}`)}
                    xalign={0}
                    css={labelCss}
                  />
                </box>
              </box>

              <box
                orientation={Gtk.Orientation.VERTICAL}
                spacing={KEY_GAP}
                hexpand={true}
                halign={Gtk.Align.FILL}
              >
                <label label="Key heatmap" xalign={0} css={labelCss} />
                <box
                  orientation={Gtk.Orientation.VERTICAL}
                  spacing={KEY_GAP}
                  hexpand={true}
                  halign={Gtk.Align.FILL}
                  width_request={keyboardWidth}
                >
                  {KEY_ROWS.map((row) => (
                    <box
                      orientation={Gtk.Orientation.HORIZONTAL}
                      spacing={KEY_GAP}
                      hexpand={true}
                      halign={Gtk.Align.FILL}
                      width_request={keyboardWidth}
                    >
                      {row.map((cell) => (
                        <KeyCell {...cell} />
                      ))}
                    </box>
                  ))}
                </box>
              </box>
            </box>
          </eventbox>
        </box>
      </eventbox>
    </window>
  )
}
