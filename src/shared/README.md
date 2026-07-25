# Shared contracts

Only genuinely cross-feature systems belong here:

- Persistence and schema migrations
- Backup and sync interfaces
- User profile and preferences
- Knowledge concept schema
- Mastery and recall scheduling
- Knowledge graph
- Common accessible UI primitives

Dashboard and Learn communicate through these small contracts, never by importing each other's internal state.

## Implemented knowledge contract

`fefe_learnDB` stores versioned `concepts`, `cards`, `sessions`, and `profile`. Each imported concept has a stable `sourceKey` (`academic:<courseId>` or `brain:<entryId>`), enabling idempotent migration and source-aware deletion without touching dashboard-owned data.
