import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Member, OpenInvite } from '../lib/invites'
import { HouseholdMembers } from './HouseholdMembers'

const api = vi.hoisted(() => ({
  loadMembers: vi.fn<() => Promise<Member[]>>(),
  loadOpenInvites: vi.fn<() => Promise<OpenInvite[]>>(async () => []),
  createInvite: vi.fn(async () => 'http://localhost:3000/?invite=tok'),
  cancelInvite: vi.fn(async () => {}),
  removeMember: vi.fn(async () => {}),
  shareInvite: vi.fn(async () => 'copied' as const),
}))
vi.mock('../lib/invites', async (actual) => ({ ...(await actual<typeof import('../lib/invites')>()), ...api }))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

const OWNER: Member = { userId: 'u1', email: 'owner@example.test', role: 'owner' }
const PARTNER: Member = { userId: 'u2', email: 'partner@example.test', role: 'member' }

beforeEach(() => {
  vi.clearAllMocks()
  api.loadMembers.mockResolvedValue([OWNER, PARTNER])
})

describe('HouseholdMembers, as the owner', () => {
  const onLeft = vi.fn()
  const open = async () => {
    render(<HouseholdMembers householdId="h1" userId="u1" isOwner onLeft={onLeft} />)
    expect(await screen.findByText('owner@example.test')).toBeInTheDocument()
  }

  it('lists members with their roles', async () => {
    await open()
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('owner@example.test (you) owner')
    expect(rows[1]).toHaveTextContent('partner@example.test member')
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Leave household' })).not.toBeInTheDocument()
  })

  it('invites someone: makes the link, copies or shares it, and shows it', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }))
    expect(await screen.findByLabelText('Invite link')).toHaveValue('http://localhost:3000/?invite=tok')
    expect(api.createInvite).toHaveBeenCalledWith('h1')
    expect(api.shareInvite).toHaveBeenCalledWith('http://localhost:3000/?invite=tok')
    expect(screen.getByRole('status')).toHaveTextContent('Invite link copied.')
    expect(api.loadOpenInvites).toHaveBeenCalledTimes(2)
  })

  it('cancels an open invite', async () => {
    api.loadOpenInvites.mockResolvedValueOnce([{ id: 'i1', expiresAt: '2026-11-10T09:00:00Z' }])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel invite' }))
    expect(api.cancelInvite).toHaveBeenCalledWith('i1')
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel invite' })).not.toBeInTheDocument())
  })

  it('removes a member after asking', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.getByText('Remove partner@example.test?')).toBeInTheDocument()
    api.loadMembers.mockResolvedValue([OWNER])
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1)!)
    await vi.waitFor(() => expect(screen.queryByText('partner@example.test')).not.toBeInTheDocument())
    expect(api.removeMember).toHaveBeenCalledWith('h1', 'u2')
    expect(onLeft).not.toHaveBeenCalled()
  })

  it('shows why an invite could not be made', async () => {
    api.createInvite.mockRejectedValueOnce({ message: 'Only the owner can invite people' })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Invite someone' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the owner can invite people')
  })
})

describe('HouseholdMembers, as a member', () => {
  it('cannot invite or remove, and can leave', async () => {
    const onLeft = vi.fn()
    render(<HouseholdMembers householdId="h1" userId="u2" isOwner={false} onLeft={onLeft} />)
    expect(await screen.findByText('partner@example.test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Invite someone' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(api.loadOpenInvites).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Leave household' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }))
    await vi.waitFor(() => expect(onLeft).toHaveBeenCalled())
    expect(api.removeMember).toHaveBeenCalledWith('h1', 'u2')
  })
})
