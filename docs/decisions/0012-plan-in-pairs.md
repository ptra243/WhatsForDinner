# 0012 · Plan the week in pairs, with three choices each

**Date:** 2026-11-17 · **Status:** accepted; changes how [0005](0005-planning-in-claude-chat.md)'s planning chat proposes a week

**Context.** Claude proposed one plan, night by night, and the owner had to come up with any alternative. Prices only arrived after the plan was saved, so cost couldn't shape the choice, and buying in bulk or cooking once for two nights was left to chance (#92).

**Decision.** (Owner, 2026-11-17.) Claude plans the week as pairs of nights (Saturday free by default), each pair one of twice, remake, shared or separate, and offers three choices per pair: its top pick, another of the household's recipes and a new recipe idea (every pair while under about 50 recipes). It checks WhichGrocer specials before choosing, estimates each choice's cost from cached prices, and after pricing recommends the cheapest single shop after the household's Woolworths discounts, splitting only to save more than $15. Filtering and scoring can run in a stdlib Python script in `claude/dinner-planner/scripts/`, fetched from GitHub when the chat can run code; it never touches the database or a connector.

**Consequences.** Three decisions plan six dinners, and new recipes come in steadily. Proposals are longer, and a changed pick means rechecking the whole week. Planned-overs between two dinners aren't stored until #91, so a remake pair's leftover item stays on the list for the shopper to mark. Discounts, free nights and the split amount are skill defaults until #93 makes them settings. The scripts' rules must stay in step with `SKILL.md`.
