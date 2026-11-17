"""Tests for the Dinner Planner scripts. Run from the repo root:

    python3 -m unittest discover -s claude/dinner-planner/scripts/tests

planner.json is the skill's planner query run on a household made from the seeded examples
(week of 2026-11-23, Monday start; fish tacos cooked Tue 10 Nov; Aldi's chicken thigh, pork mince
and beef mince on special).
"""

import copy
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import choose_shop  # noqa: E402
import plan_week  # noqa: E402

with open(HERE / 'planner.json', encoding='utf-8') as f:
    PLANNER = json.load(f)


def picks(result):
    return [x['slug'] for s in result['slots'] for x in (s['pick'] or {}).get('nights', [])]


class PlanWeekTest(unittest.TestCase):
    def run_plan(self, data=None, specials=(), free=('sat',)):
        return plan_week.plan(copy.deepcopy(data or PLANNER), list(specials), list(free))

    def test_pairs_follow_week_order_and_skip_free_nights(self):
        r = self.run_plan()
        self.assertEqual([s['nights'] for s in r['slots']], [['mon', 'tue'], ['wed', 'thu'], ['fri'], ['sun']])
        self.assertEqual(r['free'], ['sat'])

    def test_saturday_start_gives_sun_mon_pairs(self):
        data = copy.deepcopy(PLANNER)
        data['week_start'] = '2026-11-21'   # a Saturday
        order = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']
        data['nights'] = sorted(data['nights'], key=lambda n: order.index(n['day']))
        r = self.run_plan(data)
        self.assertEqual([s['nights'] for s in r['slots']], [['sun', 'mon'], ['tue', 'wed'], ['thu', 'fri']])

    def test_locked_and_cooked_nights_are_kept_and_break_pairs(self):
        data = copy.deepcopy(PLANNER)
        data['nights'][1]['locked'] = True   # tue
        r = self.run_plan(data)
        self.assertEqual(r['kept'], ['tue'])
        self.assertEqual(r['slots'][0]['nights'], ['mon'])
        self.assertEqual(r['slots'][1]['nights'], ['wed', 'thu'])

    def test_no_recipe_twice_in_a_week_and_an_asian_dinner(self):
        r = self.run_plan()
        slugs = picks(r)
        twice = {s['pick']['nights'][0]['slug'] for s in r['slots'] if s['pick']['kind'] == 'twice'}
        self.assertEqual(len([x for x in slugs if x not in twice]), len(set(slugs) - twice))
        self.assertTrue(r['asian_in_week'])

    def test_disliked_recipe_is_left_out(self):
        data = copy.deepcopy(PLANNER)
        for rec in data['recipes']:
            if rec['slug'] == 'pork-cabbage-stir-fry':
                rec['dislikes'] = 1
        r = self.run_plan(data)
        for s in r['slots']:
            for opt in (s['pick'], s['alternative']):
                self.assertNotIn('pork-cabbage-stir-fry', [x['slug'] for x in (opt or {}).get('nights', [])])

    def test_recently_cooked_waits_two_weeks(self):
        recipes = plan_week.load(copy.deepcopy(PLANNER), [], plan_week.date(2026, 11, 23))
        tacos = next(r for r in recipes if r.slug == 'fish-tacos')
        night = {'day': 'mon', 'minutes': 45}
        self.assertFalse(plan_week.eligible(tacos, night, plan_week.date(2026, 11, 23)))   # 13 days
        self.assertTrue(plan_week.eligible(tacos, night, plan_week.date(2026, 11, 24)))    # 14 days

    def test_quicker_method_only_on_short_nights(self):
        recipes = plan_week.load(copy.deepcopy(PLANNER), [], plan_week.date(2026, 11, 23))
        ragu = next(r for r in recipes if r.slug == 'beef-ragu')
        self.assertEqual(plan_week.way(ragu, 45)[0], 'Pressure cooker')
        self.assertIsNone(plan_week.way(ragu, 120)[0])

    def test_specials_and_cost(self):
        recipes = plan_week.load(copy.deepcopy(PLANNER), ['pork mince'], plan_week.date(2026, 11, 23))
        stir_fry = next(r for r in recipes if r.slug == 'pork-cabbage-stir-fry')
        self.assertIn('pork mince', stir_fry.specials)
        self.assertIsNotNone(stir_fry.cost)
        self.assertTrue(stir_fry.asian)

    def test_roast_makes_leftovers(self):
        recipes = plan_week.load(copy.deepcopy(PLANNER), [], plan_week.date(2026, 11, 23))
        self.assertIn('makes-leftovers', next(r for r in recipes if r.slug == 'roast-chicken').tags)

    def test_new_ideas_every_pair_under_fifty_recipes(self):
        r = self.run_plan()
        self.assertTrue(all(s['new_idea']['wanted'] for s in r['slots']))
        data = copy.deepcopy(PLANNER)
        data['recipe_count'] = 60
        r = self.run_plan(data)
        self.assertEqual([s['new_idea']['wanted'] for s in r['slots']], [True, True, False, False])

    def test_text_runs(self):
        self.assertIn('Free: sat', plan_week.text(self.run_plan()))


def row(name, qty, unit, *latest):
    return {'name': name, 'qty': qty, 'unit': unit, 'latest': list(latest)}


class ChooseShopTest(unittest.TestCase):
    def test_packs_round_up_like_the_list(self):
        c = choose_shop.item_costs(row('chicken thigh', 1200, 'g',
                                       'aldi $10.50 (1 kg) $10.50/kg special', 'coles –', 'woolworths $7.50 (500 g) $15.00/kg'))
        self.assertEqual(c, {'aldi': 21.0, 'coles': None, 'woolworths': 22.5})

    def test_no_amount_or_other_unit_is_one_pack(self):
        self.assertEqual(choose_shop.item_costs(row('coriander', None, 'bunch', 'coles $3.00 (1 bunch)')), {'coles': 3.0})
        self.assertEqual(choose_shop.item_costs(row('lime', 2, 'each', 'coles $1.00 (500 g)')), {'coles': 1.0})

    def test_discount_can_change_the_cheapest_shop(self):
        rows = [row('beef mince', 1000, 'g', 'coles $10.00 (1 kg)', 'woolworths $10.40 (1 kg)', 'aldi $10.20 (1 kg)')]
        self.assertEqual(choose_shop.choose(rows, {}, 15)['single']['stores'], ['coles'])
        r = choose_shop.choose(rows, {'woolworths': 5}, 15)
        self.assertEqual(r['single']['stores'], ['woolworths'])
        self.assertEqual(r['single']['total'], 9.88)

    def test_split_only_above_the_threshold(self):
        rows = [row('a', 1, 'each', 'coles $20.00 (1 each)', 'woolworths $40.00 (1 each)', 'aldi $30.00 (1 each)'),
                row('b', 1, 'each', 'coles $40.00 (1 each)', 'woolworths $40.00 (1 each)', 'aldi $30.00 (1 each)')]
        self.assertEqual(choose_shop.choose(rows, {}, 15)['recommend'], 'single')   # $60 vs $50 split
        self.assertEqual(choose_shop.choose(rows, {}, 5)['recommend'], 'split')

    def test_split_when_one_shop_lacks_items(self):
        rows = [row('rice noodle', 400, 'g', 'aldi –', 'coles $3.00 (400 g)', 'woolworths $3.20 (400 g)'),
                row('onion', 1, 'each', 'aldi $0.50 (1 each)', 'coles $0.90 (1 each)', 'woolworths $0.90 (1 each)')]
        r = choose_shop.choose(rows, {}, 15)
        self.assertEqual(r['single']['stores'], ['coles'])     # covers both
        self.assertEqual(r['recommend'], 'single')
        self.assertIn('Shop at Coles', choose_shop.text(r))

    def test_unpriced_items_are_named(self):
        r = choose_shop.choose([row('saffron', 1, 'g', 'coles –', 'aldi –')], {}, 15)
        self.assertEqual(r['unpriced'], ['saffron'])


if __name__ == '__main__':
    unittest.main()
