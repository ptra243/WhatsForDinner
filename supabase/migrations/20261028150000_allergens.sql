-- Allergens to avoid per household (#62). Each ingredient lists the allergens it usually
-- contains, from a fixed list (Australia's mandatory allergens) enforced here like units and
-- sections. Tags are generic, not per brand, and err towards tagging: `egg noodle` is `egg`
-- even though some brands aren't. The household's allergens to avoid live in
-- household_settings.settings.avoid (no column; the app keeps keys it doesn't show).

create or replace function private.allergens()
returns text[] language sql immutable set search_path = '' as $$
  select array['egg','milk','peanut','tree nut','sesame','soy','wheat','gluten',
               'fish','crustacean','mollusc','lupin']
$$;

alter table public.ingredients
  add column allergens text[] not null default '{}' check (allergens <@ private.allergens());

-- Tag the ingredients already in use. Names not listed here contain none of the allergens.
update public.ingredients i
set allergens = v.allergens
from (values
  ('beef stock', array['wheat','gluten']),
  ('butter', array['milk']),
  ('chicken stock', array['wheat','gluten']),
  ('chipotle in adobo', array['wheat','gluten']),
  ('cream', array['milk']),
  ('crusty loaf', array['wheat','gluten']),
  ('egg', array['egg']),
  ('egg noodle', array['egg','wheat','gluten']),
  ('egg-free wonton wrapper', array['wheat','gluten']),
  ('feta', array['milk']),
  ('greek yoghurt', array['milk']),
  ('hoisin sauce', array['soy','wheat','gluten','sesame']),
  ('oyster sauce', array['mollusc','soy','wheat','gluten']),
  ('pappardelle', array['egg','wheat','gluten']),
  ('parmesan', array['milk']),
  ('prawn', array['crustacean']),
  ('sesame oil', array['sesame']),
  ('sesame seed', array['sesame']),
  ('soy sauce', array['soy','wheat','gluten']),
  ('tortilla', array['wheat','gluten']),
  ('white fish fillet', array['fish']),
  ('wonton wrapper', array['egg','wheat','gluten'])
) as v(name, allergens)
where i.name = v.name;
