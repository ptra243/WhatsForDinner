// Quantities and times as the prototype shows them (prototype/dinner-planner.html).

/** Minutes as "45 min" or "1 h 30"; empty for none. */
export function mins(m: number | null | undefined): string {
  if (!m) return ''
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return `${h} h${r ? ` ${r}` : ''}`
}

/** Normalise kg to g and l to ml, as the shopping list does. */
export function toBase(qty: number | null, unit: string): { qty: number | null; unit: string } {
  if (qty == null || isNaN(qty)) return { qty: null, unit }
  if (unit === 'kg') return { qty: qty * 1000, unit: 'g' }
  if (unit === 'l') return { qty: qty * 1000, unit: 'ml' }
  return { qty, unit }
}

/** Rounded for reading: whole numbers from 20 up, quarters below. */
export function num(n: number): string {
  const r = n >= 20 ? Math.round(n) : Math.round(n * 4) / 4
  return String(+r.toFixed(2))
}

/** A base quantity for reading: back to kg or l from 1000 up; "as needed" when there is none. */
export function fmtQty(qty: number | null, unit: string): string {
  if (qty == null) return 'as needed'
  if (unit === 'g' && qty >= 1000) return `${num(qty / 1000)} kg`
  if (unit === 'ml' && qty >= 1000) return `${num(qty / 1000)} l`
  return `${num(qty)} ${unit}`
}

/** One recipe ingredient scaled from the recipe's serves to `servings`, ready to show. */
export function scaledQty(qty: number | null, unit: string, servings: number, serves: number): string {
  const b = toBase(qty == null ? null : (qty * servings) / (serves || 4), unit)
  return fmtQty(b.qty, b.unit)
}
