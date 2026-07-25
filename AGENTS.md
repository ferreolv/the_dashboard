# Workspace routing

Read `PROJECT_CONTEXT.md` first. Keep work scoped to the feature named by the user.

## Scope labels

- `DASHBOARD:` Work only on the personal daily dashboard. The live implementation is currently `index.html`; consult `src/dashboard/README.md` for boundaries.
- `LEARN:` Work only inside `src/learn/` and shared contracts explicitly required by the feature.
- `SHARED:` Work only on storage, knowledge, recall, UI contracts, or integration code shared by both products.
- `APP:` Cross-feature navigation, application shell, architecture, or changes intentionally affecting both products.

If no label is supplied, infer the narrowest scope from the request. Do not inspect the other feature merely for background.

## Context discipline

- Do not reread the complete chat to reconstruct product decisions; use `PROJECT_CONTEXT.md`.
- Do not load planning documents unrelated to the active scope.
- Update `PROJECT_CONTEXT.md` only when a durable product decision changes.
- Keep feature-specific detail in that feature's folder.
- Preserve existing browser data and the `fefe_` storage namespace unless a migration is explicitly implemented.
- The root `index.html` remains the live standalone entry until a tested build/runtime migration replaces it.

## Product boundaries

- Dashboard owns daily life management and launches learning.
- Learn owns adaptive learning sessions and games.
- Shared owns user profile, recall scheduling, knowledge graph, persistence, backup, and common UI primitives.
- Do not turn every Learn capability into a dashboard tile.

