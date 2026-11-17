import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { clearPlace } from './lib/place'

afterEach(async () => {
  cleanup()
  // Each test starts with nowhere remembered, and after history has stepped back over what closed.
  clearPlace()
  // (the step back is asked for after this tick starts, so it lands in the next one)
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
})

// jsdom has no scrolling
window.scrollTo = () => {}
