import { useSyncExternalStore } from 'react'

const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

/** Whether the browser has a connection. Offline, the service worker shows the last-loaded data. */
export const useOnline = () => useSyncExternalStore(subscribe, () => navigator.onLine)
