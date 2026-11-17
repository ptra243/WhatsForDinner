#!/usr/bin/env python3
"""Pick where to shop for a week, for the Dinner Planner skill.

Reads the rows of the skill's items-to-price query as JSON (name, qty, unit, latest) after the
week is priced, counts each item as packs to buy x pack price (as the app's list does), takes the
household's discounts off, and recommends one shop unless splitting saves more than a set amount.

    python3 choose_shop.py items.json [--woolworths 5] [--monthly] [--split-above 15] [--json]

--monthly uses the once-a-month 10% Woolworths shop instead of the everyday discount.
Standard library only; it never reads or writes the database or a grocery connector.
"""

from __future__ import annotations

import argparse
import itertools
import json
import math
import re
import sys

STORES = ['coles', 'woolworths', 'aldi']
NAMES = {'coles': 'Coles', 'woolworths': 'Woolies', 'aldi': 'Aldi'}
LATEST = re.compile(r'^(\w+) (?:–|\$([\d.]+) \(([\d.]+) (\w+)\))')


def base(qty: float, unit: str) -> tuple[float, str]:
    if unit == 'kg':
        return qty * 1000, 'g'
    if unit == 'l':
        return qty * 1000, 'ml'
    return qty, unit


def item_costs(row: dict) -> dict[str, float | None]:
    """Each store's cost for an item: packs to buy x pack price, or None when not found."""
    out: dict[str, float | None] = {}
    for entry in row.get('latest') or []:
        m = LATEST.match(entry)
        if not m:
            continue
        store, price, pack_qty, pack_unit = m.groups()
        if price is None:
            out[store] = None
            continue
        packs = 1
        if row.get('qty') is not None:
            need, need_unit = base(float(row['qty']), row['unit'])
            have, have_unit = base(float(pack_qty), pack_unit)
            if need_unit == have_unit and have > 0:
                packs = max(1, math.ceil(round(need / have, 6)))
        out[store] = round(packs * float(price), 2)
    return out


def choose(rows: list[dict], discounts: dict[str, float], split_above: float) -> dict:
    costs = {r['name']: item_costs(r) for r in rows}
    factor = {s: 1 - discounts.get(s, 0) / 100 for s in STORES}
    priced = {n: c for n, c in costs.items() if any(v is not None for v in c.values())}
    unpriced = sorted(n for n in costs if n not in priced)

    def plan(stores: tuple[str, ...]) -> dict:
        total, where, missing = 0.0, {}, []
        for name, c in priced.items():
            options = [(c[s] * factor[s], s) for s in stores if c.get(s) is not None]
            if not options:
                missing.append(name)
                continue
            cost, store = min(options)
            total += cost
            where[name] = store
        return {'stores': list(stores), 'total': round(total, 2), 'missing': sorted(missing),
                'items': {s: sorted(n for n, w in where.items() if w == s) for s in stores}}

    singles = sorted((plan((s,)) for s in STORES), key=lambda p: (len(p['missing']), p['total']))
    splits = sorted((plan(c) for c in itertools.combinations(STORES, 2)), key=lambda p: (len(p['missing']), p['total']))
    single, split = singles[0], splits[0]
    better_cover = len(split['missing']) < len(single['missing'])
    saving = round(single['total'] - split['total'], 2)
    use_split = better_cover or saving > split_above
    return {
        'discounts': {s: d for s, d in discounts.items() if d},
        'per_store': [{'store': p['stores'][0], 'total': p['total'],
                       'covers': len(priced) - len(p['missing']), 'of': len(priced)}
                      for p in sorted(singles, key=lambda p: STORES.index(p['stores'][0]))],
        'single': single, 'split': split, 'split_saves': saving,
        'recommend': 'split' if use_split else 'single',
        'unpriced': unpriced,
    }


def text(r: dict) -> str:
    lines = []
    disc = ', '.join(f'{NAMES[s]} −{d:g}%' for s, d in r['discounts'].items())
    lines.append('Totals' + (f' after {disc}' if disc else '') + ': ' + ' · '.join(
        f'{NAMES[p["store"]]} ${p["total"]:.2f} ({p["covers"]} of {p["of"]})' for p in r['per_store']))
    s, sp = r['single'], r['split']
    one = NAMES[s['stores'][0]]
    if r['recommend'] == 'single':
        lines.append(f'Shop at {one}: ${s["total"]:.2f}.' + (
            f' Splitting would save only ${r["split_saves"]:.2f}.' if r['split_saves'] > 0 else ''))
    else:
        a, b = sp['stores']
        lines.append(f'Split: {NAMES[a]} and {NAMES[b]}, ${sp["total"]:.2f}, saves ${r["split_saves"]:.2f} on {one} alone.')
        for st in (a, b):
            lines.append(f'  {NAMES[st]}: ' + ', '.join(sp['items'][st]))
    chosen = sp if r['recommend'] == 'split' else s
    if chosen['missing']:
        lines.append('Not found there: ' + ', '.join(chosen['missing']))
    if r['unpriced']:
        lines.append('Not priced anywhere: ' + ', '.join(r['unpriced']))
    return '\n'.join(lines)


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('file', help="the items-to-price query's rows as JSON")
    p.add_argument('--woolworths', type=float, default=5, help='everyday Woolworths discount, percent (default 5)')
    p.add_argument('--monthly', action='store_true', help="this is the month's 10%% Woolworths shop")
    p.add_argument('--monthly-percent', type=float, default=10)
    p.add_argument('--split-above', type=float, default=15, help='split only when it saves more than this (default $15)')
    p.add_argument('--json', action='store_true')
    a = p.parse_args(argv)
    with open(a.file, encoding='utf-8') as f:
        rows = json.load(f)
    discounts = {'woolworths': a.monthly_percent if a.monthly else a.woolworths}
    result = choose(rows, discounts, a.split_above)
    print(json.dumps(result, indent=1) if a.json else text(result))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
