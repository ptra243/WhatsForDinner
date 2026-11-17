#!/usr/bin/env python3
"""Suggest a week of dinners in pairs of nights, for the Dinner Planner skill.

Reads the planner query's JSON (SKILL.md, "Everything the planner needs") and prints, for each
pair of open nights, Claude's top pick, one alternative from the household's recipes, and a brief
for a new recipe idea. Claude still checks sides, the meal rule, allergens and notes, and decides.

    python3 plan_week.py planner.json [--specials "pork shoulder,broccoli"] [--plan-saturday]
                                      [--free sat,...] [--json]

Standard library only. It never reads or writes the database: Claude runs the query and saves
the plan the owner approves.
"""

from __future__ import annotations

import argparse
import itertools
import json
import statistics
import sys
from dataclasses import dataclass, field
from datetime import date, timedelta

DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
REPEAT_DAYS = 14          # don't repeat anything cooked in the last two weeks
NEW_RECIPE_TARGET = 50    # new ideas every pair until the household has about this many recipes
REHEAT_MINS = 10          # hands-on time for the second night of a "twice" pair
ASIAN_TAGS = {'asian', 'chinese', 'thai', 'japanese', 'korean', 'vietnamese', 'malaysian', 'indonesian'}
ASIAN_WORDS = ('stir-fry', 'stir fry', 'fried rice', 'noodle', 'dumpling', 'bao', 'char siu', 'kung pao',
               'teriyaki', 'pho', 'laksa', 'satay', 'hoisin', 'chow mein', 'congee', 'ramen', 'larb')
CHINESE_WORDS = ('fried rice', 'dumpling', 'bao', 'char siu', 'kung pao', 'hoisin', 'chow mein', 'congee',
                 'sweet and sour', 'mapo', 'szechuan', 'sichuan')
REHEATS_TAGS = {'leftovers-ok', 'freezes well', 'makes-leftovers'}
LONG_NIGHT = 90           # a night with this many minutes or more can take a long cook the usual way
NOT_WORTH_SHARING = {'garlic clove', 'garlic', 'onion', 'ginger'}
SHAREABLE_SECTIONS = {'meat and seafood', 'fruit and veg', 'dairy and fridge'}
PROTEIN_WORDS = ('chicken', 'beef', 'pork', 'lamb', 'veal', 'turkey', 'duck', 'salmon', 'tuna', 'prawn',
                 'fish', 'sausage', 'bacon', 'ham', 'chorizo', 'squid', 'mussel', 'tofu')


@dataclass
class Recipe:
    slug: str
    name: str
    active: int
    total: int
    alt: tuple[str, int, int] | None   # the household's quickest other method: name, active, total
    serves: int
    rating: float | None
    tags: set[str]
    provides: list[str]
    last_cooked: date | None
    likes: int
    dislikes: int
    ingredients: list[tuple[str, float | None, str]]
    protein: str | None = None
    asian: bool = False
    chinese: bool = False
    specials: list[str] = field(default_factory=list)
    cost: float | None = None   # estimated cost of the recipe as written, cheapest store
    score: float = 0.0


@dataclass
class Option:
    kind: str                   # twice, remake, shared, separate, single
    dishes: list[Recipe]        # one per night (twice: the same recipe on both)
    score: float
    note: str


def to_base(qty: float, unit: str) -> tuple[float, str]:
    """g and ml for weights and volumes, as the shopping list compares them."""
    if unit == 'kg':
        return qty * 1000, 'g'
    if unit == 'l':
        return qty * 1000, 'ml'
    return qty, unit


def price_of(qty: float | None, unit: str, prices: dict) -> float | None:
    """Cheapest store's cost of an amount, from latest unit prices ([price, per, special])."""
    if qty is None or not prices:
        return None
    amount, base = to_base(qty, unit)
    costs = []
    for unit_price, per, _special in prices.values():
        if unit_price is None:
            continue
        if per in ('kg', 'l') and base in ('g', 'ml'):
            costs.append(float(unit_price) * amount / 1000)
        elif per == 'each' and base == 'each':
            costs.append(float(unit_price) * amount)
    return min(costs) if costs else None


def protein_of(r: dict, sections: dict) -> str | None:
    """The main protein: the first meat or seafood ingredient's first word, else 'veg' if it provides one."""
    for name, _qty, _unit in r['ingredients']:
        if sections.get(name) == 'meat and seafood':
            words = name.split()
            return next((w for w in words if w in PROTEIN_WORDS), words[-1])
    return 'veg' if 'protein' in (r.get('provides') or []) else None


def load(data: dict, specials: list[str], week_start: date) -> list[Recipe]:
    meta = data.get('ingredients') or {}
    sections = {name: m.get('section') for name, m in meta.items()}
    specials = [s.strip().lower() for s in specials if s.strip()]
    recipes = []
    for r in data.get('recipes') or []:
        method = r.get('best_method')
        alt = (method['name'], method['active_mins'] or 0, method['total_mins'] or 0) if method else None
        tags = {t.lower() for t in (r.get('tags') or [])}
        name = r['name'].lower()
        rec = Recipe(
            slug=r['slug'], name=r['name'], active=r['active_mins'] or 0, total=r['total_mins'] or 0, alt=alt, serves=r.get('serves') or 4,
            rating=r.get('rating'), tags=tags, provides=r.get('provides') or [],
            last_cooked=date.fromisoformat(r['last_cooked']) if r.get('last_cooked') else None,
            likes=r.get('likes') or 0, dislikes=r.get('dislikes') or 0,
            ingredients=[(n, q, u) for n, q, u in r.get('ingredients') or []],
        )
        rec.protein = protein_of(r, sections)
        if name.startswith('roast') and rec.protein not in (None, 'veg'):
            rec.tags.add('makes-leftovers')   # a roast makes leftovers unless tagged otherwise
        rec.chinese = 'chinese' in tags or any(w in name for w in CHINESE_WORDS)
        rec.asian = rec.chinese or bool(tags & ASIAN_TAGS) or any(w in name for w in ASIAN_WORDS)
        on_special = {n for n, m in meta.items() if any(p[2] for p in (m.get('prices') or {}).values())}
        rec.specials = sorted({n for n, _q, _u in rec.ingredients
                               if n in on_special or any(s in n or n in s for s in specials)})
        costs = [price_of(q, u, (meta.get(n) or {}).get('prices') or {}) for n, q, u in rec.ingredients]
        known = [c for c in costs if c is not None]
        rec.cost = round(sum(known), 2) if known else None
        recipes.append(rec)
    score_all(recipes, week_start)
    return recipes


def score_all(recipes: list[Recipe], week_start: date) -> None:
    """Rating, votes, time since last cooked, specials, and cost per serve against the household's median."""
    per_serve = [r.cost / r.serves for r in recipes if r.cost]
    median = statistics.median(per_serve) if per_serve else None
    for r in recipes:
        s = r.rating if r.rating is not None else 3.0
        s += 1.5 * r.likes
        s += 1.0 if r.last_cooked is None else min((week_start - r.last_cooked).days, 56) / 28
        s += 1.5 if r.specials else 0
        if median and r.cost:
            s -= max(-1.0, min(1.0, (r.cost / r.serves - median) / median))
        r.score = round(s, 2)


def way(r: Recipe, minutes: int | None) -> tuple[str | None, int]:
    """How to cook it on a night: the usual way, or on a short night the quicker method when there is one."""
    if r.alt and minutes is not None and minutes < LONG_NIGHT and r.alt[2] < r.total and r.alt[1] <= minutes:
        return r.alt[0], r.alt[1]
    return None, r.active


def eligible(r: Recipe, night: dict, night_date: date) -> bool:
    if r.dislikes:
        return False
    if r.last_cooked and (night_date - r.last_cooked).days < REPEAT_DAYS:
        return False
    budget = night.get('minutes')
    return budget is None or way(r, budget)[1] <= budget


def shared_fresh(a: Recipe, b: Recipe, meta: dict) -> list[str]:
    """Fresh ingredients both use where sharing matters: any meat or seafood, or a pack the first
    recipe doesn't use up (half a bunch of coriander, the rest of the cream). Not loose onions."""
    need = {}
    for n, q, u in a.ingredients:
        if q is not None:
            amount, base = to_base(float(q), u)
            need[n] = need.get(n, (0, base))[0] + amount, base
    names_b = {n for n, _q, _u in b.ingredients}
    out = []
    for n in sorted({n for n, _q, _u in a.ingredients} & names_b):
        m = meta.get(n) or {}
        if m.get('section') not in SHAREABLE_SECTIONS or n in NOT_WORTH_SHARING:
            continue
        if m.get('section') == 'meat and seafood':
            out.append(n)
            continue
        pack = m.get('pack')
        if not pack or (float(pack[0]) <= 1 and pack[1] == 'each') or n not in need:
            continue
        p_amount, p_base = to_base(float(pack[0]), pack[1])
        if p_base == need[n][1] and need[n][0] < p_amount:
            out.append(n)
    return out


def pair_options(n1: dict, n2: dict, d1: date, d2: date, recipes: list[Recipe], meta: dict) -> list[Option]:
    first = [r for r in recipes if eligible(r, n1, d1)]
    second = [r for r in recipes if eligible(r, n2, d2)]
    options = []
    for r in first:
        if r.tags & REHEATS_TAGS and (n2.get('minutes') is None or REHEAT_MINS <= n2['minutes']):
            options.append(Option('twice', [r, r], r.score + 0.5, f'cook once, eat both nights (different sides on {n2["day"].title()})'))
    for a, b in itertools.product(first, second):
        if a.slug == b.slug:
            continue
        base = (a.score + b.score) / 2
        if 'makes-leftovers' in a.tags and 'uses-leftovers' in b.tags:
            options.append(Option('remake', [a, b], base + 0.8, f'{b.name} from {a.name} leftovers'))
            continue
        shared = shared_fresh(a, b, meta)
        if shared:
            options.append(Option('shared', [a, b], base + min(1.5, 0.5 * len(shared)), 'share ' + ', '.join(shared)))
        else:
            penalty = 0.5 if a.protein and a.protein == b.protein and a.protein != 'veg' else 0
            options.append(Option('separate', [a, b], base - penalty, ''))
    options.sort(key=lambda o: -o.score)
    return options


def single_options(n: dict, d: date, recipes: list[Recipe]) -> list[Option]:
    return sorted((Option('single', [r], r.score, '') for r in recipes if eligible(r, n, d)), key=lambda o: -o.score)


def proteins(o: Option) -> set[str]:
    return {r.protein for r in o.dishes if r.protein and r.protein != 'veg'}


def choose_week(slots: list[list[Option]]) -> list[Option] | None:
    """Best total score with no recipe in two slots, proteins and pair types spread, and an Asian dinner."""
    tops = [s[:15] for s in slots]
    best, best_score = None, float('-inf')
    for combo in itertools.product(*tops):
        slugs = [r.slug for o in combo for r in {x.slug: x for x in o.dishes}.values()]
        if len(slugs) != len(set(slugs)):
            continue
        score = sum(o.score for o in combo)
        seen: list[str] = []
        for o in combo:
            seen += sorted(proteins(o))
        score -= 1.0 * (len(seen) - len(set(seen)))
        kinds = [o.kind for o in combo if o.kind in ('twice', 'remake', 'shared')]
        score -= 0.75 * (len(kinds) - len(set(kinds)))     # a mix of pair types, not three stews
        if not any(r.asian for o in combo for r in o.dishes):
            score -= 3.0
        if any(r.chinese for o in combo for r in o.dishes):
            score += 0.5
        if score > best_score:
            best, best_score = list(combo), score
    return best


def alternative(slot: list[Option], pick: Option, others: list[Option]) -> Option | None:
    """The best option for the slot using none of the week's other recipes and not just the pick again."""
    taken = {r.slug for o in others for r in o.dishes}
    pick_slugs = {r.slug for r in pick.dishes}
    for o in slot:
        slugs = {r.slug for r in o.dishes}
        if slugs & taken or slugs == pick_slugs or slugs <= pick_slugs:
            continue
        return o
    return None


def plan(data: dict, specials: list[str], free: list[str]) -> dict:
    week_start = date.fromisoformat(data['week_start'])
    start = week_start.weekday()
    nights = data['nights']
    dates = {n['day']: week_start + timedelta(days=(DAYS.index(n['day']) - start) % 7) for n in nights}
    meta = data.get('ingredients') or {}
    recipes = load(data, specials, week_start)

    kept = [n['day'] for n in nights if n.get('locked') or n.get('cooked')]
    open_days = [n for n in nights if n['day'] not in free and n['day'] not in kept]

    # Pairs of open nights next to each other in week order; a night left over is a single.
    groups: list[list[dict]] = []
    order = [n['day'] for n in nights]
    for n in open_days:
        last = groups[-1] if groups else None
        if last and len(last) == 1 and order.index(n['day']) == order.index(last[0]['day']) + 1:
            last.append(n)
        else:
            groups.append([n])

    slots = []
    for g in groups:
        if len(g) == 2:
            a, b = g
            opts = pair_options(a, b, dates[a['day']], dates[b['day']], recipes, meta)
            # When the second night has more time, the big cook can go there instead (no leftovers pair then).
            if (b.get('minutes') or 0) > (a.get('minutes') or 0):
                flipped = pair_options(b, a, dates[b['day']], dates[a['day']], recipes, meta)
                opts += [Option(o.kind, list(reversed(o.dishes)), o.score - 0.1, o.note)
                         for o in flipped if o.kind in ('shared', 'separate')]
                opts.sort(key=lambda o: -o.score)
        else:
            opts = single_options(g[0], dates[g[0]['day']], recipes)
        slots.append(opts)

    week = choose_week(slots) if slots and all(slots) else None
    new_every = data.get('recipe_count', 0) < NEW_RECIPE_TARGET
    used_proteins = sorted({p for o in (week or []) for p in proteins(o)})
    out = {'week_start': data['week_start'], 'free': [d for d in order if d in free], 'kept': kept,
           'asian_in_week': bool(week) and any(r.asian for o in week for r in o.dishes), 'slots': []}
    for i, g in enumerate(groups):
        days = [n['day'] for n in g]
        pick = week[i] if week else (slots[i][0] if slots[i] else None)
        others = [o for j, o in enumerate(week or []) if j != i]
        alt = alternative(slots[i], pick, others) if pick else None
        out['slots'].append({
            'nights': days,
            'minutes': [n.get('minutes') for n in g],
            'pick': describe(pick, g),
            'alternative': describe(alt, g),
            'new_idea': {
                'wanted': new_every or i < 2,
                'fits': {d: n.get('minutes') for d, n in zip(days, g)},
                'avoid_proteins': [p for p in used_proteins if p not in (proteins(pick) if pick else set())],
                'specials': specials,
                'kinds': ['twice', 'remake', 'shared'] if len(g) == 2 else ['single'],
            },
        })
    return out


def describe(o: Option | None, group: list[dict]) -> dict | None:
    if o is None:
        return None
    days = [n['day'] for n in group]
    mins = [n.get('minutes') for n in group]
    dishes = o.dishes if len(o.dishes) == len(days) else o.dishes * len(days)
    cost = sum(r.cost for r in {r.slug: r for r in o.dishes}.values() if r.cost)
    return {
        'kind': o.kind, 'note': o.note, 'score': round(o.score, 2), 'est_cost': round(cost, 2) if cost else None,
        'nights': [{'day': d, 'slug': r.slug, 'name': r.name,
                    'method': None if reheat else way(r, m)[0],
                    'active_mins': REHEAT_MINS if reheat else way(r, m)[1],
                    'protein': r.protein, 'asian': r.asian, 'specials': r.specials, 'reheat': reheat}
                   for k, (d, r, m) in enumerate(zip(days, dishes, mins))
                   for reheat in [o.kind == 'twice' and k == 1]],
    }


def text(result: dict) -> str:
    lines = []
    for s in result['slots']:
        label = '–'.join(d.title() for d in s['nights'])
        lines.append(f'{label} ({", ".join(str(m) for m in s["minutes"])} min)')
        for n, opt in ((1, s['pick']), (2, s['alternative'])):
            if not opt:
                lines.append(f'  {n} (nothing fits)')
                continue
            dishes = ' → '.join(f'{x["day"].title()} {x["name"]}' + (' (reheat)' if x['reheat'] else '')
                                + (f' [{x["method"]}]' if x['method'] else '') for x in opt['nights'])
            extra = [opt['kind']] + ([opt['note']] if opt['note'] else [])
            if opt['est_cost']:
                extra.append(f'~${opt["est_cost"]:.0f}')
            if any(x['specials'] for x in opt['nights']):
                extra.append('special: ' + ', '.join(sorted({y for x in opt['nights'] for y in x['specials']})))
            lines.append(f'  {n} {dishes}  ({"; ".join(extra)})')
        idea = s['new_idea']
        if idea['wanted']:
            lines.append(f'  3 new idea: fits {idea["fits"]}, avoid {idea["avoid_proteins"] or "nothing"}, kinds {idea["kinds"]}')
    lines.append(f'Free: {", ".join(result["free"]) or "none"}. Kept: {", ".join(result["kept"]) or "none"}. '
                 f'Asian dinner in the picks: {"yes" if result["asian_in_week"] else "NO, fix this"}.')
    return '\n'.join(lines)


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('file', help="the planner query's JSON (the planner_input value)")
    p.add_argument('--specials', default='', help='comma-separated ingredient names on special this week')
    p.add_argument('--free', default=None, help='comma-separated nights left free (default: settings.freeNights, else sat)')
    p.add_argument('--plan-saturday', action='store_true', help='plan Saturday too')
    p.add_argument('--json', action='store_true', help='print JSON instead of text')
    a = p.parse_args(argv)
    with open(a.file, encoding='utf-8') as f:
        data = json.load(f)
    if isinstance(data, list):           # a result row copied whole
        data = data[0]
    if 'planner_input' in data:
        data = data['planner_input']
    free = a.free.split(',') if a.free else (data.get('settings') or {}).get('freeNights', ['sat'])
    if a.plan_saturday:
        free = [d for d in free if d != 'sat']
    result = plan(data, a.specials.split(','), [d.strip().lower() for d in free if d.strip()])
    print(json.dumps(result, indent=1) if a.json else text(result))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
