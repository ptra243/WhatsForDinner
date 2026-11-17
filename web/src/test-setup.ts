import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
  // Cook mode saves its place as it goes; one test's cooking must not carry into the next.
  localStorage.clear()
})

// jsdom has no scrolling
window.scrollTo = () => {}
