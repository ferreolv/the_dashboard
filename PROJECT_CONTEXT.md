# Compact project context

## Product

Two intentionally separate personal applications:

1. **Dashboard**: daily command centre for goals, habits, reminders, notes, weather, timer, personal knowledge, review, and configurable tiles.
2. **Learn**: adaptive general-knowledge game combining retrieval, personalisation, mastery, and a shared knowledge graph.

They share a small storage contract and navigation, not a runtime or interface.

## Current implementation

- Dashboard + Library entry: `index.html`.
- Learn game entry: `learn/index.html`.
- React 18 and Babel are loaded from CDNs; no build step is currently required.
- Data persists in browser `localStorage` with `fefe_` keys.
- Learn owns `fefe_learnDB`; Dashboard does not load or display Learn navigation or progress.
- Optional Cloudflare sync stores a snapshot while excluding API and sync credentials.
- JSON backup and restore are available in Settings.
- Existing saved data must survive code and architecture changes.

## Current dashboard capabilities

- Configurable tile library with date-aware active-tile history.
- Active tiles determine daily progress and perfect-day requirements.
- Habits may use an emoji, text label, or both; emoji-only habits remain valid.
- Goals, habits, task reminders, positive event countdowns, notes, weather, timer, Knowledge, Recall, Academic, Memory, Philosophy, People Met, and weekly review.
- AI-generated content uses a user-provided Anthropic API key.
- Memory stores a recursively rendered knowledge tree and can globally reorganise note placement.

## Durable design preferences

- Dashboard uses a softly atmospheric pastel canvas so transparent clear-glass tiles visibly refract the background. Resting tile surfaces stay translucent white glass (never hue-filled), but each tile commits hard to ONE vivid hue that shows up in a thick coloured border, the label/heading, the body text, the glow, and chunky interactive objects. Typeface is Nunito (rounded, neutral-playful).
- Dense tile content follows a natural top/left reading flow. Centering is reserved for compact utilities, empty states, and content that is intentionally poster-like.
- Tile internals respond to the tile's own width and height, not only to the browser window. Long controls reflow as readable rows, and mobile uses the page scroll instead of nested tile scrolling.
- A tile title is ordinary content at the top of the tile's scroll area: it never pins, overlays, or remains visible after the rest of that tile has scrolled away.
- Arrange and resize affordances stay on the right edge of every tile. Habit controls remain true circles at every responsive size.
- Reminders are practical recurring or one-off tasks: later items stay subdued, due items become prominent, and completed items are crossed through without checkbox UI. Events are a separate, non-scoring space for positive plans, presented as countdowns rather than tasks.
- In the Library, tiles already on Today use a small half-outside corner cross instead of an in-tile “Remove from Today” footer. Compact Birthdays shows only today’s cake/name or the next birthday; its complete list and import controls live in a separate overlay.
- Timer Stop pauses and preserves the remaining time for Resume; Reset alone starts it over. Every positive Event uses the same full countdown-card hierarchy rather than a primary/secondary split.
- Compact utility tiles retain their title and adapt to tile shape: wide Timer and Push-ups layouts move controls to the right, Weather gives Tomorrow equal visual weight, completed due Reminders receive the tile’s full-colour completion state, and Event cards stay comparatively compact.
- Learn deliberately keeps a more expressive game-like visual world than the dashboard.
- Accents (borders, text, icons, buttons, chips) use the tile's vivid hue at rest — not pastel, and text is never plain black/grey. On completion the whole tile fills with its hue as coloured glass and every accent flips to white.
- No visible scrollbars; scrolling must still work.
- Never underline interface text.
- Inputs must always inherit readable contrast from their tile.
- Minimal note-like writing: few words, little filler.
- No unnecessary application branding or invented product name in the UI.
- Preserve colour identity, tactile completion reward, and individual character without inconsistency.

## Learn direction

- Learn is a separate standalone app at `learn/index.html`; Dashboard intentionally contains no Learn menu or launcher.
- Academic uploads and Second Brain entries stay in Dashboard + Library and do not populate Learn gameplay.
- Review scheduling uses a local FSRS-style stability/difficulty model targeting 90% retention.
- Learn v2 has three finite modes: Sugar Rush (6), Knowledge Quest (12), and Mega Boss (10 with lives).
- Confidence calibration, combos, boss damage, XP, levels, loot, runs, and best-combo stats add game depth without changing the memory schedule.
- Learn runs now mix multiple mechanics: choice, nested-knowledge connections, sentence reconstruction, and date-based timeline questions when source material supports them.
- Mega Boss can create one AI-remixed round per day from the user's own knowledge; the result is cached and local adaptive play remains the fallback.
- The Learn lobby renders top-level knowledge branches as a playful visual memory galaxy.
- Learn now uses a self-contained, curated general-knowledge Core Atlas by default. Academic and Second Brain data remain preserved but no longer feed game sessions.
- The launch atlas covers stable foundations across science, history, geography, economics, ideas & arts, technology, ecology and health; cards carry an organisation/source trail.
- Any optional AI boss remix is constrained to this curated atlas, never personal imports.
- Learn tracks its own five-minute daily streak, XP, sessions, and mastery. This does not alter perfect-day scoring.
- Dashboard pages support direct hash routes `#/dashboard` and `#/library`; Learn uses the separate `learn/` path.
- Learn sessions should mix new concepts, due retrieval, connections, and games.
- Prefer finite knowledge runs with conscious continuation over harmful infinite-scroll mechanics.
- Recall and Second Brain should become shared infrastructure.
- Creator video/community features are later-stage due to moderation, sourcing, copyright, and quality costs.

## Working convention

Prefix requests with `DASHBOARD:`, `LEARN:`, `SHARED:`, or `APP:`. This lets Codex inspect only the relevant module and reduces future context usage.
