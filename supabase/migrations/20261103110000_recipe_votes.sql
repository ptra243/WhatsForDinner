-- Votes on candidate dinners (#17). Each member says 👍 (1) or 👎 (-1) to a recipe for a week;
-- no row means no vote. Members see the household's votes and write only their own. Claude
-- reads them when planning and never writes them.

create table public.recipe_votes (
  household_id uuid not null references public.households(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  vote smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, week_start, recipe_id, user_id)
);
create index recipe_votes_recipe_idx on public.recipe_votes(recipe_id);
create index recipe_votes_user_idx on public.recipe_votes(user_id);

create trigger recipe_votes_updated_at before update on public.recipe_votes for each row execute function private.set_updated_at();

alter table public.recipe_votes enable row level security;
create policy "members read votes" on public.recipe_votes for select to authenticated
  using ((select private.is_member(household_id)));
-- A vote is for one of the household's own recipes, and only by the member casting it.
create policy "members add own votes" on public.recipe_votes for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_member(household_id))
              and exists (select 1 from public.recipes r where r.id = recipe_id and r.household_id = recipe_votes.household_id));
create policy "members change own votes" on public.recipe_votes for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member(household_id)))
  with check (user_id = (select auth.uid()) and (select private.is_member(household_id))
              and exists (select 1 from public.recipes r where r.id = recipe_id and r.household_id = recipe_votes.household_id));
create policy "members clear own votes" on public.recipe_votes for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member(household_id)));

grant select, insert, update, delete on public.recipe_votes to authenticated;

alter publication supabase_realtime add table public.recipe_votes;
