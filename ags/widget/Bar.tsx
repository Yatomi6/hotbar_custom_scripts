import app from "ags/gtk3/app"
import { Astal, Gtk, Gdk } from "ags/gtk3"
import Battery from "./Battery"
import Brightness from "./Brightness"
import Clock from "./Clock"
import Audio from "./Audio"
import HoverPanel from "./HoverPanel"
import InputCounts from "./InputCounts"
import Workspaces from "./Workspaces"
import Wifi from "./Wifi"
import {
  BAR_CONTENT_HEIGHT,
  BAR_CSS,
  BAR_HEIGHT,
  BAR_ITEM_PAD,
  BAR_ITEM_PAD_TIGHT,
  MODULE_SPACING,
} from "../barConfig"

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor
  const ITEM_PAD = BAR_ITEM_PAD
  const BATTERY_PAD_RIGHT = BAR_ITEM_PAD_TIGHT
  const RightItem = ({
    children,
    padLeft = ITEM_PAD,
    padRight = ITEM_PAD,
  }: {
    children: JSX.Element | JSX.Element[]
    padLeft?: number
    padRight?: number
  }) => (
    <box
      class="bar-item"
      valign={Gtk.Align.CENTER}
      css={`min-height: ${BAR_CONTENT_HEIGHT}px; padding: 0 ${padRight}px 0 ${padLeft}px;`}
    >
      {children}
    </box>
  )
  return (
    <window
      name="main-bar"
      class="bar-window"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.EXCLUSIVE}
      anchor={TOP | LEFT | RIGHT}
      layer={Astal.Layer.TOP}
      application={app}
    >
        <centerbox class="bar" css={BAR_CSS} height_request={BAR_HEIGHT}>
        <box $type="start" class="bar-left" spacing={0}>
          <HoverPanel />
          <Workspaces monitor={gdkmonitor} />
          </box>
        <box $type="center" class="bar-center" spacing={MODULE_SPACING}>
          <Clock />
        </box>
        <box
          $type="end"
          class="bar-right"
          spacing={0}
          halign={Gtk.Align.END}
        >
          <RightItem>
            <InputCounts />
          </RightItem>
          <RightItem>
            <Wifi />
          </RightItem>
          <RightItem>
            <box
              class="meters"
              orientation={Gtk.Orientation.VERTICAL}
              spacing={0}
              valign={Gtk.Align.CENTER}
            >
              <Brightness />
              <Audio />
            </box>
          </RightItem>
          <RightItem padRight={BATTERY_PAD_RIGHT}>
            <Battery />
          </RightItem>
        </box>
      </centerbox>
    </window>
  )
}
