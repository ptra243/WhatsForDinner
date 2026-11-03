import { createContext, useContext } from 'react'

/**
 * Whether the signed-in user gets Ask Claude buttons: only the household's owner, since they
 * open the owner's Claude project and other people's requests never go through the owner's
 * subscription (docs/architecture.md, Claude and the terms of use).
 */
export const CanAskClaude = createContext(true)
export const useCanAskClaude = () => useContext(CanAskClaude)
