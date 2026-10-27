import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from './App'

describe('App shell', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'))

  it('opens on the Week tab', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('This week')
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-current', 'page')
  })

  it('switches tabs and remembers the tab in the URL', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Shopping list')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Week' })).not.toHaveAttribute('aria-current')
    expect(window.location.hash).toBe('#list')
  })

  it('starts on the tab named in the URL', () => {
    window.history.replaceState(null, '', '/#recipes')
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Recipes')
  })

  it('opens the settings sheet and closes it with Escape or the scrim', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Household settings' }))
    expect(screen.getByRole('dialog', { name: 'Household settings' })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Household settings' }))
    fireEvent.click(screen.getByTestId('scrim'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
