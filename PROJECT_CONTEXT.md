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
- Settings can disconnect the current sync code and start a fresh local dashboard memory; the API key remains local.
- Sync setup presents a named dashboard account, refuses to overwrite an existing remote account during creation, and uses an explicit sign-in action to connect existing data.
- JSON backup and restore are available in Settings.
- Settings lives on its own top-level dashboard page at `#/settings`.
- Existing saved data must survive code and architecture changes.

## Current dashboard capabilities

- Configurable tile library with date-aware active-tile history.
- New dashboards start Today with only Goals, Habits, Weather, Word, and World; existing customized Today layouts are preserved.
- Active tiles determine daily progress and perfect-day requirements.
- Habits may use an emoji, text label, or both; emoji-only habits remain valid.
- Goals, habits, shopping list, Health import bridge, task reminders, positive event countdowns, notes, weather, timer, Knowledge, Recall, Academic, Memory, Philosophy, People Met, and weekly review.
- AI-generated content uses a user-provided Anthropic API key.
- Memory stores a recursively rendered knowledge tree and can globally reorganise note placement.
- The live dashboard exposes an installable web-app manifest and uses the user's black line-art “D” as its browser, desktop, Android, and iOS home-screen icon.
- Breathing is a guided one-minute daily widget: six rounds of a 4-second nasal inhale and 6-second gentle exhale, shown through an expanding/contracting visual, phase countdown, and round progress.
- GMAT is a dashboard tile plus focused overlay workspace. It provides original adaptive Quant, Verbal, and Data Insights sprints; records accuracy, pacing, confidence and error causes; schedules broad skills with FSRS; tracks exam date, weekly minutes and official mock scores; and never presents its local practice as official material or invents a predicted GMAT score.

## Durable design preferences

- Dashboard uses a softly atmospheric pastel canvas so transparent clear-glass tiles visibly refract the background. Resting tile surfaces stay translucent white glass (never hue-filled), but each tile commits hard to ONE vivid hue that shows up in a thick coloured border, the label/heading, the body text, the glow, and chunky interactive objects. Typeface is Nunito (rounded, neutral-playful).
- Dense tile content follows a natural top/left reading flow. Centering is reserved for compact utilities, empty states, and content that is intentionally poster-like.
- Tile internals respond to the tile's own width and height, not only to the browser window. Long controls reflow as readable rows, and mobile uses the page scroll instead of nested tile scrolling.
- A tile title is ordinary content at the top of the tile's scroll area: it never pins, overlays, or remains visible after the rest of that tile has scrolled away.
- Arrange and resize affordances stay on the right edge of every tile. Habit controls remain true circles at every responsive size.
- Reminders are practical recurring or one-off tasks: later items stay subdued, due items become prominent, and completed items are crossed through without checkbox UI. Events are a separate, non-scoring space for positive plans, presented as countdowns rather than tasks.
- Default Reminders are: suggest an app improvement/recommendation to the creator daily, call your mum weekly, and an example doctor appointment. One-off reminders can include an optional time, future reminders should stay subdued but readable, and the tile combines a navigable month calendar with its complete upcoming list; selecting a calendar date highlights the matching reminder without filtering or hiding the rest. Birthday gift planning does not appear in Reminders.
- In the Library, both Add-to-Today “+” and Remove-from-Today “×” are direct, absolutely positioned tile children centred half-inside/half-outside the top-right corner; neither action appears in the tile body or title wrapper. Compact Birthdays shows only today’s cake/name or the next birthday; its complete list and import controls live in a separate overlay.
- Timer Stop pauses and preserves the remaining time for Resume; Reset alone starts it over. Every positive Event uses the same full countdown-card hierarchy rather than a primary/secondary split.
- Birthday import lives in Settings with a short tutorial; the Birthdays tile stays focused on the compact summary and hidden full list.
- Compact utility tiles retain their title and adapt to tile shape: wide Timer and Push-ups layouts move controls to the right, Weather gives Tomorrow equal visual weight, completed due Reminders receive the tile’s full-colour completion state, and Event cards stay comparatively compact.
- Flat Timer tiles reserve a separate title row, keep the time on the left, keep adjustment/Stop/Resume/Reset controls on the right, and show no state-caption text. When nothing is due, an unlabeled empty area in Reminders toggles the full-colour completion state; completed reminder text never receives an opaque white pressed field.
- Library widgets should match their Today widget bodies. AI-capable widgets can be generated individually from the Library without being added to Today.
- Visible stored dates render as `dd/mm/yyyy`.
- Note defaults to a compact one-row writing card with a visually hidden textarea scrollbar and stacked actions. Flat Timer controls use a four-adjustment row plus a separate balanced action row; compact Push-ups stretches its count and controls through the tile’s available height.
- The user’s editable display name is stored as `fefe_profileName`, appears in the dashboard greeting, and participates in the same sync, backup, and restore flow as other dashboard memory.
- Settings saves the display name and API key in place without reloading the dashboard or deleting today’s generated content.
- Dashboard Recall uses FSRS-6 at 90% desired retention, presented as flashcards: prompt first, reveal answer, then emoji-only grading. Existing fixed-ladder cards migrate into FSRS memory state without losing their due date or content, review history remains local, and at most eight due items are shown per session.
- Goals use a light list style: completing a goal only ticks a small box; the goal text is not struck through and goal rows avoid heavy separators.
- A saved location profile (city + timezone) drives the dashboard clock and weather tile.
- Health data uses the no-native-app bridge: an iOS Shortcut exports selected Apple Health daily summaries as JSON, and the dashboard imports/stores them locally under the same backup/sync memory contract.
- Philosophy keeps its standard below-the-surface Socratic mode and also offers a per-topic philosopher dropdown with a distinct relevant icon for every mode. Named-philosopher replies must reconstruct only textually grounded views, admit when the source basis is unclear, and end with short source notes rather than inventing positions.
- Song recommendations name an exact recording and retain complete performer/ensemble/conductor credits plus a separate classical composer when relevant. Apple Music links use conservative catalog matching on both title and credits; an uncertain result opens a precise search instead of linking to a different recording.
- Learn deliberately keeps a more expressive game-like visual world than the dashboard.
- Accents (borders, text, icons, buttons, chips) use the tile's vivid hue at rest — not pastel, and text is never plain black/grey. On completion the whole tile fills with its hue as coloured glass and every accent flips to white.
- No visible scrollbars; scrolling must still work.
- Never underline interface text.
- Inputs must always inherit readable contrast from their tile.
- Minimal note-like writing: few words, little filler.
- No unnecessary application branding or invented product name in the UI.
- Preserve colour identity, tactile completion reward, and individual character without inconsistency.
- Every dashboard tile follows one reversible visual-state contract: informative tiles can be tapped to toggle full colour, task tiles return to clear glass when their answer, button, or checkbox is undone, and no tile type is excluded from the full-colour treatment.
- Resized widgets use deliberate compact summaries and edge-to-edge internal layouts. At every supported tile shape, controls either reflow or secondary detail progressively hides; borders must never slice through buttons, text, or cards.
- Delete and close glyphs inside widgets are bare, centred, minimalist crosses rather than pill or rounded-rectangle buttons.
- Full-colour tiles use a deeper hue-aware glass fill with high-contrast content and translucent internal surfaces, including for naturally light accents such as yellow, mint, and cyan.

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
- Dashboard pages support direct hash routes `#/dashboard`, `#/library`, and `#/settings`; Learn uses the separate `learn/` path.
- Learn sessions should mix new concepts, due retrieval, connections, and games.
- Prefer finite knowledge runs with conscious continuation over harmful infinite-scroll mechanics.
- Recall and Second Brain should become shared infrastructure.
- Creator video/community features are later-stage due to moderation, sourcing, copyright, and quality costs.

## Working convention

Prefix requests with `DASHBOARD:`, `LEARN:`, `SHARED:`, or `APP:`. This lets Codex inspect only the relevant module and reduces future context usage.
