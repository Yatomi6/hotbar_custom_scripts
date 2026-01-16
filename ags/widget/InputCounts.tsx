import { Gtk } from "ags/gtk3"
import { createComputed } from "gnim"
import {
  BAR_HEIGHT,
  BAR_PADDING_Y,
  BAR_TEXT_COLOR,
  WIDGET_COMPRESS_Y,
  WIDGET_SCALE,
} from "../barConfig"
import { inputCounts, inputCountsAvailable } from "./inputCountsState"
import { toggleInputStats } from "./inputStatsState"

const CONTENT_HEIGHT = Math.max(10, BAR_HEIGHT - BAR_PADDING_Y * 2)
const FONT_SCALE = Math.max(1, WIDGET_SCALE)
const TOP_LINE_PX = Math.max(6, Math.round(CONTENT_HEIGHT * 0.55))
const BOTTOM_LINE_PX = Math.max(5, CONTENT_HEIGHT - TOP_LINE_PX)
const CLICK_FONT = Math.max(6, Math.round(TOP_LINE_PX * 0.95 * FONT_SCALE))
const KEY_FONT = Math.max(5, Math.round(BOTTOM_LINE_PX * 0.95 * FONT_SCALE))

export default function InputCounts() {
  const clicksLabel = createComputed(() => {
    if (!inputCountsAvailable()) return "-- | --"
    const current = inputCounts()
    return `${current.left} | ${current.right}`
  })
  const keysLabel = createComputed(() => {
    if (!inputCountsAvailable()) return "--"
    const current = inputCounts()
    return `${current.keys}`
  })

  return (
    <eventbox
      class="input-counts-trigger"
      visible_window={false}
      onButtonPressEvent={() => {
        toggleInputStats()
        return true
      }}
    >
      <box
        class="input-counts"
        orientation={Gtk.Orientation.VERTICAL}
        spacing={0}
        valign={Gtk.Align.CENTER}
        halign={Gtk.Align.CENTER}
      >
        <label
          class="input-clicks"
          label={clicksLabel}
          xalign={0.5}
          halign={Gtk.Align.CENTER}
          css={`font-size: ${CLICK_FONT}px; margin: -${WIDGET_COMPRESS_Y}px 0; color: ${BAR_TEXT_COLOR};`}
        />
        <label
          class="input-keys"
          label={keysLabel}
          xalign={0.5}
          halign={Gtk.Align.CENTER}
          css={`font-size: ${KEY_FONT}px; margin: -${WIDGET_COMPRESS_Y}px 0; color: ${BAR_TEXT_COLOR};`}
        />
      </box>
    </eventbox>
  )
}
