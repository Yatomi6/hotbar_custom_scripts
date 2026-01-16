import { createState } from "gnim"

const [open, setOpen] = createState(false)

export const inputStatsOpen = open

export const openInputStats = () => {
  setOpen(true)
}

export const closeInputStats = () => {
  setOpen(false)
}

export const toggleInputStats = () => {
  setOpen(!open())
}
