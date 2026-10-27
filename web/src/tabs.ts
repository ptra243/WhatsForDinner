export const TABS = ['week', 'list', 'recipes'] as const
export type Tab = (typeof TABS)[number]

export const TAB_NAMES: Record<Tab, string> = { week: 'Week', list: 'List', recipes: 'Recipes' }
