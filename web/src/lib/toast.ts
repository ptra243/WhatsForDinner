// One toast for the whole app, shown by <Toast /> in the app shell; the last message wins.

let listener: ((text: string | undefined) => void) | undefined
let timer: ReturnType<typeof setTimeout> | undefined

export function showToast(text: string) {
  clearTimeout(timer)
  listener?.(text)
  timer = setTimeout(() => listener?.(undefined), 4000)
}

/** Sets where toasts go; returns a function that stops it. */
export function onToast(show: (text: string | undefined) => void): () => void {
  listener = show
  return () => {
    if (listener === show) listener = undefined
  }
}
