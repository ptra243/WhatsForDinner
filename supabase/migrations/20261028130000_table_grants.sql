-- Table privileges for the app's signed-in role. The live project does not give
-- anon and authenticated default privileges on new public tables (the local stack
-- does), so without these every app query is "permission denied" before Row Level
-- Security is even checked. Grants match the policies; anon gets nothing.

revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant select, update on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select, insert, update on public.ingredients to authenticated;
grant select, insert, update, delete on
  public.household_settings,
  public.recipes,
  public.recipe_ingredients,
  public.recipe_steps,
  public.meal_plan_nights,
  public.meal_plan_dishes,
  public.list_marks,
  public.list_extras
  to authenticated;
