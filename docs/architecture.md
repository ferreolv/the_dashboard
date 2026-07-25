# Target architecture

```text
Dashboard/
├── index.html              Live standalone dashboard during migration
├── PROJECT_CONTEXT.md      Compact durable context
├── AGENTS.md               Scope router for Codex
├── docs/
│   └── architecture.md
└── src/
    ├── app/                Future shell and route composition
    ├── dashboard/          Daily dashboard feature
    ├── learn/              General-knowledge feature
    └── shared/             Explicit cross-feature contracts
```

## Runtime target

```text
App shell
├── Today / Library -> Dashboard bundle
├── Learn -> Learn bundle
└── Knowledge -> Shared knowledge-map surface
```

Feature bundles should be lazy-loaded once a build system is introduced. Until then, `index.html` remains operational so browser storage and the user's opening workflow are not disrupted.

## State ownership

```text
dashboard.*  goals, habits, reminders, notes, layout
learn.*      sessions, interests, game performance, learning history
shared.*     profile, mastery, recall queue, knowledge graph, backup schema
```

The existing `fefe_` keys remain supported. Future namespacing requires a versioned migration rather than destructive replacement.

## Migration sequence

1. Establish boundaries and context routing without changing runtime behaviour.
2. Extract shared persistence behind a compatibility layer.
3. Extract dashboard code into its feature module with regression tests.
4. Introduce a small application shell and lazy route loading.
5. Scaffold Learn independently. **Implemented in the standalone runtime.**
6. Connect features only through versioned shared contracts. **Implemented for Academic and Second Brain via `fefe_learnDB` v1.**

## Current integration

```text
Academic course ──┐
                  ├─> source-keyed concept/card ingestion ─> adaptive Learn runs
Second Brain ─────┘                                  │
                                                    └─> 5-minute learning streak
```

The learning streak is intentionally separate from dashboard perfect-day scoring. The dashboard is the surface and launcher; Learn remains an independent play activity.

The standalone shell supports `#/dashboard`, `#/library`, and `#/learn`, allowing direct feature entry while retaining the same file origin and `fefe_` storage namespace.
