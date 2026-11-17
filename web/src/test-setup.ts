import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(async () => {
  cleanup()
  // Cook mode and the app save their place as they go; one test's must not carry into the next.
  localStorage.clear()
  // Closing what was open steps history back a moment later; let that land before the next test.
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
})

// jsdom has no scrolling
window.scrollTo = () => {}
