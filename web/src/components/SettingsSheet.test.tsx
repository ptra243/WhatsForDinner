import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_HOUSEHOLD_SETTINGS, type HouseholdSettings } from '../lib/household'
import { SettingsSheet } from './SettingsSheet'

const api = vi.hoisted(() => ({
  loadHouseholdSettings: vi.fn<() => Promise<HouseholdSettings>>(),
  saveHouseholdSettings: vi.fn(async () => {}),
  countExamples: vi.fn(async () => 3),
  clearExamples: vi.fn(async () => 3),
  exportHousehold: vi.fn(async () => ({ app: 'whats-for-dinner' })),
  downloadJson: vi.fn(),
}))
vi.mock('../lib/household', async (actual) => ({ ...(await actual<typeof import('../lib/household')>()), ...api }))
const auth = vi.hoisted(() => ({ signOut: vi.fn(async () => ({ error: null })) }))
vi.mock('../lib/supabase', () => ({ supabase: { auth } }))

const SAVED: HouseholdSettings = {
  notes: 'no mushrooms',
  equipment: ['pressure cooker'],
  dinnerTime: '19:00',
  minutes: { ...DEFAULT_HOUSEHOLD_SETTINGS.minutes, tue: 30 },
  mealRule: 'veg',
  avoid: ['egg'],
}

const props = { householdId: 'h1', email: 'cook@example.test', onChanged: vi.fn(), onClose: vi.fn() }

const open = async () => {
  render(<SettingsSheet {...props} />)
  expect(await screen.findByLabelText('Preferences')).toHaveValue('no mushrooms')
}

beforeEach(() => {
  vi.clearAllMocks()
  api.loadHouseholdSettings.mockResolvedValue(SAVED)
})

describe('SettingsSheet', () => {
  it('shows the saved settings', async () => {
    await open()
    expect(screen.getByLabelText('Equipment')).toHaveValue('pressure cooker')
    expect(screen.getByLabelText('Dinner time')).toHaveValue('19:00')
    expect(screen.getByLabelText('Tue')).toHaveValue(30)
    expect(screen.getByLabelText('Sat')).toHaveValue(120)
    expect(screen.getByLabelText('Every night needs')).toHaveValue('veg')
    expect(screen.getByRole('button', { name: 'egg' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'milk' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('saves every field, then closes', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Preferences'), { target: { value: ' keep curries mild ' } })
    fireEvent.change(screen.getByLabelText('Equipment'), { target: { value: 'slow cooker, , air fryer ' } })
    fireEvent.change(screen.getByLabelText('Dinner time'), { target: { value: '18:15' } })
    fireEvent.change(screen.getByLabelText('Mon'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Wed'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Every night needs'), { target: { value: 'off' } })
    fireEvent.click(screen.getByRole('button', { name: 'egg' }))
    fireEvent.click(screen.getByRole('button', { name: 'sesame' }))
    fireEvent.click(screen.getByRole('button', { name: 'milk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await vi.waitFor(() => expect(props.onClose).toHaveBeenCalled())
    expect(api.saveHouseholdSettings).toHaveBeenCalledWith('h1', {
      notes: 'keep curries mild',
      equipment: ['slow cooker', 'air fryer'],
      dinnerTime: '18:15',
      minutes: { mon: 25, tue: 30, wed: 45, thu: 45, fri: 45, sat: 120, sun: 120 },
      mealRule: 'off',
      avoid: ['milk', 'sesame'],
    })
    expect(props.onChanged).toHaveBeenCalled()
  })

  it('stays open and says why when saving fails', async () => {
    api.saveHouseholdSettings.mockRejectedValueOnce({ message: 'offline' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('downloads the export as a dated JSON file', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Export all data' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Export downloaded')
    expect(api.exportHousehold).toHaveBeenCalledWith('h1')
    expect(api.downloadJson).toHaveBeenCalledWith(expect.stringMatching(/^whats-for-dinner-\d{4}-\d\d-\d\d\.json$/), {
      app: 'whats-for-dinner',
    })
  })

  it('clears the examples only after the confirmation', async () => {
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Clear example recipes' }))
    expect(screen.getByText('Delete 3 example recipes?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }))
    expect(api.clearExamples).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Clear example recipes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete examples' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Removed 3 example recipes')
    expect(api.clearExamples).toHaveBeenCalledWith('h1')
    expect(props.onChanged).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Clear example recipes' })).not.toBeInTheDocument()
  })

  it('hides clearing when there are no examples left', async () => {
    api.countExamples.mockResolvedValueOnce(0)
    await open()
    expect(screen.queryByRole('button', { name: 'Clear example recipes' })).not.toBeInTheDocument()
  })

  it('signs out', async () => {
    await open()
    expect(screen.getByText('Signed in as cook@example.test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(auth.signOut).toHaveBeenCalled()
  })
})
