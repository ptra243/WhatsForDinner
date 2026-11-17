import { useEffect, useRef, useState } from 'react'

// The phone's back button closes what is open (a sheet, cook mode, a recipe, a tab other than
// Week) before it leaves the app. Each open thing is a layer with a history entry of its own;
// the entry's state says how many layers are open at it. Back lands on an entry with fewer,
// so the layers above that close. Closing one from its own button steps history back instead.

type Layer = { order: number; close: () => void }

/** Open layers, outermost first. */
const layers: Layer[] = []
let nextOrder = 0
/** Entries to step back over for layers closed from the page, taken in one go. */
let leaving = 0
let listening = false

const depthOf = (state: unknown): number => {
  const d = (state as { wfdDepth?: unknown } | null)?.wfdDepth
  return typeof d === 'number' ? d : 0
}

function onPop(e: PopStateEvent) {
  const depth = depthOf(e.state)
  while (layers.length > depth) layers.pop()!.close()
  // An entry left over from before a reload, or reached with Forward: nothing to show for it.
  if (depth > layers.length) window.history.go(layers.length - depth)
}

function listen() {
  if (listening) return
  listening = true
  // Layers open over the page, so stepping between their entries must not move it; the browser
  // would put it back to where it was when each entry was made. The app keeps the scroll itself.
  window.history.scrollRestoration = 'manual'
  // After a reload nothing is open yet, whatever the entry said before.
  if (depthOf(window.history.state)) window.history.replaceState({ ...window.history.state, wfdDepth: 0 }, '')
  window.addEventListener('popstate', onPop)
}

function enter(layer: Layer) {
  listen()
  // A screen and something inside it can open together (when the app reopens where it was);
  // effects run inner first, so the order comes from when each was first drawn.
  const at = layers.findIndex((l) => l.order > layer.order)
  layers.splice(at < 0 ? layers.length : at, 0, layer)
  window.history.pushState({ ...window.history.state, wfdDepth: layers.length }, '')
}

function exit(layer: Layer) {
  const at = layers.indexOf(layer)
  // Not there when Back closed it: history has moved already.
  if (at < 0) return
  layers.splice(at, 1)
  leaving++
  queueMicrotask(() => {
    if (!leaving) return
    const n = leaving
    leaving = 0
    window.history.go(-n)
  })
}

/** Added to the order of a layer that is drawn in front of every other, so it closes first. */
const FRONT = 1e9

/**
 * While `open`, the phone's back button calls `close` instead of leaving the app. Whatever
 * opened last closes first; a `front` layer (cook mode, which the app can reopen by itself
 * over anything) closes before the rest.
 */
export function useBackCloses(close: () => void, open = true, front = false): void {
  const [order] = useState(() => nextOrder++ + (front ? FRONT : 0))
  const latest = useRef(close)
  useEffect(() => {
    latest.current = close
  })
  useEffect(() => {
    if (!open) return
    const layer: Layer = { order, close: () => latest.current() }
    enter(layer)
    return () => exit(layer)
  }, [open, order])
}
