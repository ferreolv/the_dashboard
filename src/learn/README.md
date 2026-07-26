# Learn app

The memorising game is a separate standalone application at `learn/index.html`. It links back to the Dashboard, but does not load Dashboard or Library code.

Current ownership:

- Finite knowledge runs
- Adaptive session composition
- Interactive learning formats and games
- Interest and difficulty controls
- Learning-session presentation

## Runtime contract

- Storage key: `fefe_learnDB`
- Schema version: `3` (older data is normalized in place)
- Dashboard read model: `fefe_learnSummary` (`date`, `seconds`, `minutes`, `streak`, `due`, `updatedAt`)
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

The game owns and updates its database directly. Dashboard reads only the summary contract and never reaches into the game engine. Both entries keep the established `fefe_` namespace, so existing progress survives the split when served from the same origin.
