# Learn module

The Culture G learning experience is live in the standalone runtime while the safe module extraction remains pending.

Current ownership:

- Finite knowledge runs
- Adaptive session composition
- Interactive learning formats and games
- Interest and difficulty controls
- Learning-session presentation

## Runtime contract

- Storage key: `fefe_learnDB`
- Schema version: `2` (v1 data is normalized in place)
- Inputs: self-contained curated Core Atlas (personal Academic and Second Brain data are not used for gameplay)
- Outputs: 6/10/12-card game modes, review history, daily seconds, calibrated confidence, combos, boss victories, XP, mastery, and learning streak
- Scheduler: stability/difficulty updates with a 90% target-retention interval

## Game modes

- **Sugar Rush:** six fast adaptive questions.
- **Knowledge Quest:** twelve due/new/strengthening questions.
- **Mega Boss:** ten questions, three lives, combo-scaled damage, and a finite win/loss state.

## Challenge mechanics

- Adaptive multiple choice
- Knowledge-map connection classification
- Sentence reconstruction in the Memory Forge
- Timeline discrimination when three or more dated memories exist
- Cached daily AI boss remix using only the curated atlas, with a local fallback

## Knowledge quality

The launch atlas is an offline, source-labelled collection of stable mechanisms and foundational ideas—not generated trivia. Optional AI boss remixes are constrained to its existing cards and fall back to local play if unavailable.

The implementation currently lives in `index.html` to preserve the established file origin and browser data. Extract it here only as part of a tested runtime migration.

It must consume shared mastery and recall contracts rather than reaching into dashboard state.
