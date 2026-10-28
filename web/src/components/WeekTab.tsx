import { Fragment, useEffect, useState, type MouseEvent } from 'react'
import { nightPrompt, planWeekPrompt, weekPrompt } from '../lib/claude'
import { mins } from '../lib/format'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  loadWeek,
  nightInfo,
  removeDish,
  setNightFlags,
  setServings,
  startBy,
  subscribePlan,
  suggestSides,
  type Night,
  type Settings,
  type Week,
} from '../lib/plan'
import { addToNight, loadRecipes, matches, type Course, type Recipe } from '../lib/recipes'
import { DAY_FULL, DAY_NAMES, DAYS, dateOf, dayLabel, parseYmd, weekStartOf, ymd, type Day } from '../lib/week'
import { AskClaudeButton } from './AskClaude'
import { CookMode } from './CookMode'
import { RecipeView } from './RecipeView'
import { Sheet } from './Sheet'
import { WeekNav } from './WeekNav'

const errorText = (e: unknown) => (e as { message?: string }).message ?? String(e)

/** A dish to open from the card: its recipe at the night's servings. */
type Opened = { recipeId: string; servings: number }

/**
 * The Week tab: seven nights on a ruled card, starting on this week. Tapping a dish opens its
 * recipe at the night's servings, Cook on tonight opens cook mode for tonight's main, and tapping
 * the rest of a night opens its sheet. Changes from anywhere (this app or Claude) reload the week
 * as they happen; `settingsVersion` goes up when the settings sheet saves or clears the examples.
 */
export function WeekTab({ householdId, settingsVersion = 0 }: { householdId: string; settingsVersion?: number }) {
  const [week, setWeek] = useState(() => weekStartOf(new Date()))
  const [plan, setPlan] = useState<{ week: string; nights: Week }>()
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [error, setError] = useState<string>()
  const [version, setVersion] = useState(0)
  const [openDay, setOpenDay] = useState<Day>()
  const [viewing, setViewing] = useState<Opened>()
  const [cooking, setCooking] = useState<Opened>()
  const [status, setStatus] = useState<string>()

  useEffect(() => {
    let live = true
    Promise.all([loadWeek(householdId, week), loadRecipes(householdId), loadSettings(householdId)]).then(
      ([nights, rs, s]) => {
        if (!live) return
        setPlan({ week, nights })
        setRecipes(rs)
        setSettings(s)
        setError(undefined)
      },
      (e) => live && setError(errorText(e)),
    )
    return () => {
      live = false
    }
  }, [householdId, week, version, settingsVersion])

  // One save from Claude is many row changes; reload once they settle.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = subscribePlan(householdId, () => {
      clearTimeout(timer)
      timer = setTimeout(() => setVersion((v) => v + 1), 250)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [householdId])

  const reload = () => setVersion((v) => v + 1)
  const nights = plan?.week === week ? plan.nights : undefined
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const today = ymd(new Date())
  const viewed = viewing && byId.get(viewing.recipeId)
  const cooked = cooking && byId.get(cooking.recipeId)
  const changeRecipe = (next: Recipe) => setRecipes((rs) => rs.map((r) => (r.id === next.id ? next : r)))

  /** Shows a change on a night straight away, before the database confirms it. */
  const patchNight = (day: Day, change: (n: Night) => Night) =>
    setPlan((p) => p && { ...p, nights: { ...p.nights, [day]: change(p.nights[day]) } })

  return (
    <>
      <WeekNav week={week} onChange={setWeek} />
      {error && (
        <p className="small warn" role="alert">
          Could not load the week: {error}
        </p>
      )}
      {status && (
        <p className="small muted" role="status">
          {status}
        </p>
      )}
      {!nights ? (
        !error && (
          <p className="muted" role="status">
            Loading the week…
          </p>
        )
      ) : (
        <>
          {DAYS.every((d) => !nights[d].dishes.length) && (
            <div className="empty-state gapped">
              <h2>Nothing planned for this week</h2>
              <p className="muted small">Ask Claude to plan it from your recipes, or tap a night to pick dishes yourself.</p>
              <AskClaudeButton className="btn" prompt={planWeekPrompt(week)}>
                Plan this week with Claude
              </AskClaudeButton>
            </div>
          )}
          <div className="paper week">
            {DAYS.map((d) => {
              const date = dateOf(week, d)
              return (
                <NightRow
                  key={d}
                  day={d}
                  date={date}
                  tonight={date === today}
                  night={nights[d]}
                  recipes={byId}
                  settings={settings}
                  onOpen={() => setOpenDay(d)}
                  onView={(recipeId, servings) => setViewing({ recipeId, servings })}
                  onCook={(recipeId, servings) => {
                    setStatus(undefined)
                    setCooking({ recipeId, servings })
                  }}
                />
              )
            })}
          </div>
          {DAYS.some((d) => nights[d].dishes.length) && (
            <AskClaudeButton className="btn ghost wide gap-top" prompt={weekPrompt(week)}>
              Ask Claude about this week
            </AskClaudeButton>
          )}
        </>
      )}
      {openDay && nights && (
        <NightSheet
          key={`${week}-${openDay}`}
          householdId={householdId}
          weekStart={week}
          day={openDay}
          night={nights[openDay]}
          recipes={recipes}
          settings={settings}
          onPatch={(change) => patchNight(openDay, change)}
          onSaved={reload}
          onClose={() => setOpenDay(undefined)}
        />
      )}
      {viewing && viewed && (
        <RecipeView
          key={viewed.id}
          householdId={householdId}
          recipe={viewed}
          servings={viewing.servings}
          onChange={changeRecipe}
          onDeleted={() => {
            setViewing(undefined)
            reload()
          }}
          onClose={() => {
            setViewing(undefined)
            reload()
          }}
        />
      )}
      {cooking && cooked && (
        <CookMode
          householdId={householdId}
          recipe={cooked}
          servings={cooking.servings}
          onChange={changeRecipe}
          onExit={() => setCooking(undefined)}
          onDone={(message) => {
            setCooking(undefined)
            setStatus(message)
            reload()
          }}
        />
      )}
    </>
  )
}

function NightRow({
  day,
  date,
  tonight,
  night,
  recipes,
  settings,
  onOpen,
  onView,
  onCook,
}: {
  day: Day
  date: string
  tonight: boolean
  night: Night
  recipes: Map<string, Recipe>
  settings: Settings
  onOpen: () => void
  onView: (recipeId: string, servings: number) => void
  onCook: (recipeId: string, servings: number) => void
}) {
  const i = nightInfo(night, day, recipes, settings)
  const label = `${DAY_NAMES[day]} ${parseYmd(date).getDate()}`
  /** A dish's name, a button to its recipe when the recipe is still there. */
  const dish = (d: (typeof i.dishes)[number], className?: string) =>
    d.recipe ? (
      <button key={d.id} type="button" className={className} onClick={() => onView(d.recipeId, d.servings)}>
        {d.recipe.name}
      </button>
    ) : (
      <span key={d.id} className={className}>
        Missing recipe
      </span>
    )
  // Taps between the dish names (the margin, the times) edit the night like the day button does.
  const openFromRow = (e: MouseEvent) => {
    if (!(e.target as Element).closest('button')) onOpen()
  }
  return (
    <div
      role="group"
      aria-label={label}
      className={`night${tonight ? ' now' : ''}${night.cooked ? ' cooked' : ''}`}
      onClick={openFromRow}
    >
      <button type="button" className="dn" aria-label={`${label}, edit night`} onClick={onOpen}>
        <b>{DAY_NAMES[day]}</b>{' '}
        <span>{parseYmd(date).getDate()}</span>
      </button>
      <span className="nm">
        {tonight && <span className="tonight">Tonight</span>}
        {i.main ? (
          dish(i.main, 'dt')
        ) : (
          <button type="button" className="empty" onClick={onOpen}>
            Nothing planned
          </button>
        )}
        {i.sides.length > 0 && (
          <span className="ds">
            {i.sides.map((d, ix) => (
              <Fragment key={d.id}>
                {ix > 0 && ' · '}
                {dish(d)}
              </Fragment>
            ))}
          </span>
        )}
        {tonight && i.total > 0 && !night.cooked && (
          <span className="startby">Start by {startBy(i.total, settings.dinnerTime)}</span>
        )}
        {i.gaps.length > 0 && <span className="gap">No {i.gaps.join(' or ')} yet</span>}
      </span>
      <span className="nt">
        {night.cooked && (
          <span className="ck">
            <span aria-hidden="true">✓</span> cooked
          </span>
        )}
        {i.total > 0 && !night.cooked && <span>{mins(i.total)}</span>}
        {i.over && !night.cooked && <span className="over">{i.active} min hands-on</span>}
        {tonight && i.main?.recipe && !night.cooked && (
          <button
            type="button"
            className="cook"
            aria-label={`Cook ${i.main.recipe.name}`}
            onClick={() => i.main && onCook(i.main.recipeId, i.main.servings)}
          >
            Cook
          </button>
        )}
      </span>
    </div>
  )
}

/** One night: its dishes with servings, gap suggestions, a picker, and the cooked and skip-check toggles. */
function NightSheet({
  householdId,
  weekStart,
  day,
  night,
  recipes,
  settings,
  onPatch,
  onSaved,
  onClose,
}: {
  householdId: string
  weekStart: string
  day: Day
  night: Night
  recipes: Recipe[]
  settings: Settings
  onPatch: (change: (n: Night) => Night) => void
  onSaved: () => void
  onClose: () => void
}) {
  const [picking, setPicking] = useState<Course>()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const i = nightInfo(night, day, new Map(recipes.map((r) => [r.id, r])), settings)
  const suggestions = i.gaps.length ? suggestSides(recipes, i.gaps, night.dishes) : []
  const checkName = settings.mealRule === 'veg' ? 'veg' : 'veg and carb'

  /** Writes a change; the week reloads after it, whether it worked or not. */
  const save = async (write: () => Promise<void>, patch?: (n: Night) => Night) => {
    if (patch) onPatch(patch)
    setBusy(true)
    setError(undefined)
    try {
      await write()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
      onSaved()
    }
  }

  const add = (r: Recipe, servings?: number) =>
    save(async () => {
      await addToNight(householdId, r, weekStart, day, servings)
      setPicking(undefined)
      setQuery('')
    })

  const choices = picking
    ? recipes.filter((r) => matches(r, query, picking)).sort((a, b) => a.name.localeCompare(b.name))
    : []

  return (
    <Sheet title={`${DAY_FULL[day]} ${dayLabel(dateOf(weekStart, day))}`} onClose={onClose}>
      <p className={`small flat ${i.over ? 'warn' : 'muted'}`}>
        {i.total > 0 && `${i.active} min hands-on · ${mins(i.total)} total`}
        {i.total > 0 && i.budget > 0 && ' · '}
        {i.budget > 0 && `budget ${i.budget} min`}
        {i.over && ' · over the budget'}
      </p>
      {error && (
        <p className="small warn flat" role="alert">
          {error}
        </p>
      )}

      {i.dishes.length ? (
        <div className="stack">
          {i.dishes.map((d) => {
            const name = d.recipe?.name ?? 'Missing recipe'
            const step = (n: number) => {
              const servings = Math.max(1, d.servings + n)
              if (servings === d.servings) return
              save(
                () => setServings(d.id, servings),
                (x) => ({ ...x, dishes: x.dishes.map((y) => (y.id === d.id ? { ...y, servings } : y)) }),
              )
            }
            return (
              <div className="dish" key={d.id}>
                <div className="nm">
                  <span className="strong">{name}</span>
                  <span className="pill">{d === i.main ? 'Main' : 'Side'}</span>
                </div>
                <div className="stepper">
                  <button type="button" aria-label={`Fewer servings of ${name}`} onClick={() => step(-1)}>
                    −
                  </button>
                  <span>{d.servings} serves</span>
                  <button type="button" aria-label={`More servings of ${name}`} onClick={() => step(1)}>
                    +
                  </button>
                </div>
                <button
                  className="xbtn"
                  type="button"
                  aria-label={`Remove ${name}`}
                  disabled={busy}
                  onClick={() =>
                    save(
                      () => removeDish(d.id),
                      (x) => ({ ...x, dishes: x.dishes.filter((y) => y.id !== d.id) }),
                    )
                  }
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="muted flat">Nothing planned yet.</p>
      )}

      {i.gaps.length > 0 && (
        <div className="card gapcard">
          <b className="small">No {i.gaps.join(' or ')} yet</b>
          {suggestions.length ? (
            <div className="row wrap-row">
              {suggestions.map((r) => (
                <button key={r.id} type="button" className="chip" disabled={busy} onClick={() => add(r, i.main?.servings)}>
                  + {r.name}
                </button>
              ))}
            </div>
          ) : (
            <span className="small muted">No matching sides saved yet.</span>
          )}
        </div>
      )}

      {picking ? (
        <>
          <input
            className="search"
            type="search"
            aria-label={picking === 'main' ? 'Choose a main' : 'Choose a side'}
            placeholder={picking === 'main' ? 'Search mains' : 'Search sides'}
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="pick scroll">
            {choices.length ? (
              choices.map((r) => (
                <button key={r.id} type="button" disabled={busy} onClick={() => add(r)}>
                  <span>{r.name}</span>
                  <span className="small muted">{r.totalMins ? mins(r.totalMins) : ''}</span>
                </button>
              ))
            ) : (
              <p className="muted small flat">No {picking === 'main' ? 'mains' : 'sides'} match.</p>
            )}
          </div>
          <button className="btn quiet" type="button" onClick={() => setPicking(undefined)}>
            Cancel
          </button>
        </>
      ) : (
        <div className="row">
          <button className="btn ghost grow" type="button" onClick={() => setPicking('main')}>
            Add main
          </button>
          <button className="btn ghost grow" type="button" onClick={() => setPicking('side')}>
            Add side
          </button>
        </div>
      )}

      <div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={night.cooked}
            onChange={(e) => {
              const cooked = e.target.checked
              save(() => setNightFlags(householdId, weekStart, day, { cooked }), (x) => ({ ...x, cooked }))
            }}
          />
          Cooked
        </label>
        {settings.mealRule !== 'off' && (
          <label className="toggle">
            <input
              type="checkbox"
              checked={night.skipCheck}
              onChange={(e) => {
                const skipCheck = e.target.checked
                save(
                  () => setNightFlags(householdId, weekStart, day, { skip_check: skipCheck }),
                  (x) => ({ ...x, skipCheck }),
                )
              }}
            />
            Skip the {checkName} check this night
          </label>
        )}
      </div>
      <AskClaudeButton className="btn quiet" prompt={nightPrompt(weekStart, day)}>
        Ask Claude about {DAY_FULL[day]}
      </AskClaudeButton>
      <button className="btn wide" type="button" onClick={onClose}>
        Done
      </button>
    </Sheet>
  )
}
