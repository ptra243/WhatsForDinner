import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useBackCloses } from './back'

function Layer({ name, onClose, children }: { name: string; onClose: () => void; children?: React.ReactNode }) {
  useBackCloses(onClose)
  return (
    <div role="dialog" aria-label={name}>
      <button type="button" onClick={onClose}>
        Close {name}
      </button>
      {children}
    </div>
  )
}

/** A recipe with cook mode inside it; `both` opens the two at once, as a reload does. */
function Screens({ both = false }: { both?: boolean }) {
  const [recipe, setRecipe] = useState(both)
  const [cook, setCook] = useState(both)
  return (
    <>
      <button type="button" onClick={() => setRecipe(true)}>
        Open recipe
      </button>
      {recipe && (
        <Layer name="recipe" onClose={() => setRecipe(false)}>
          <button type="button" onClick={() => setCook(true)}>
            Cook
          </button>
          {cook && <Layer name="cook" onClose={() => setCook(false)} />}
        </Layer>
      )}
    </>
  )
}

const depth = () => (window.history.state as { wfdDepth?: number } | null)?.wfdDepth ?? 0

/** The phone's back button. */
const back = async () => {
  const landed = new Promise((r) => window.addEventListener('popstate', r, { once: true }))
  act(() => window.history.back())
  await act(() => landed)
}

describe('useBackCloses', () => {
  it('closes the last thing opened first, one for each press of back', async () => {
    render(<Screens />)
    fireEvent.click(screen.getByRole('button', { name: 'Open recipe' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cook' }))
    expect(depth()).toBe(2)

    await back()
    expect(screen.queryByRole('dialog', { name: 'cook' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'recipe' })).toBeInTheDocument()

    await back()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(depth()).toBe(0)
  })

  it('steps history back when something is closed from the page', async () => {
    render(<Screens />)
    fireEvent.click(screen.getByRole('button', { name: 'Open recipe' }))
    expect(depth()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close recipe' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(depth()).toBe(0))

    // History and the page still agree: the next thing opened closes with one back.
    fireEvent.click(screen.getByRole('button', { name: 'Open recipe' }))
    await back()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('steps back over both when a screen closes with something open inside it', async () => {
    render(<Screens />)
    fireEvent.click(screen.getByRole('button', { name: 'Open recipe' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cook' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close recipe' }))
    await waitFor(() => expect(depth()).toBe(0))
  })

  it('closes the inner one first when both open at once', async () => {
    render(<Screens both />)
    expect(depth()).toBe(2)
    await back()
    expect(screen.queryByRole('dialog', { name: 'cook' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'recipe' })).toBeInTheDocument()
  })
})
