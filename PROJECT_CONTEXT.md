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
- Optional Cloudflare sync stores a snapshot while excluding API and sync credentials. The Worker can also serve the live dashboard from the public `SYNC` key `__html__`; publishing must update that HTML copy as well as GitHub.
- Settings presents a classic Account section with sign out, password change, account deletion, and separate backup/restore; legacy sync-code controls are no longer exposed.
- Password recovery uses a registered email, a 20-minute single-use reset link and a fresh sign-in. A reset keeps dashboard data and invalidates existing sessions. Credentials and token consumption use the durable coordinator; real recovery email requires a configured sender.
- JSON backup and restore are available in Settings.
- Settings lives on its own top-level dashboard page at `#/settings`.
- Existing saved data must survive code and architecture changes.

## Current dashboard capabilities

- Configurable tile library with date-aware active-tile history.
- New dashboards start Today with only Goals, Habits, Weather, Word, and World; existing customized Today layouts are preserved.
- Active tiles determine daily progress and perfect-day requirements.
- A validated daily tile freezes at its first success for the profile’s logical day (1am rollover). Reload retries gaps only; it never replaces saved content or resets answers/streaks. Missing content cannot be marked complete. Shared and account-specific daily records use a durable coordinator; provider failures remain retryable.
- Habits may use an emoji, text label, or both; emoji-only habits remain valid.
- Goals, habits, shopping list, Health import bridge, task reminders, positive event countdowns, notes, weather, timer, Knowledge, Recall, Academic, Memory, Philosophy, People Met, and weekly review.
- Shared daily content uses the Worker’s Anthropic service key. Private Study capsules, Memory filing and Philosophy conversations use the user’s personal key.
- Memory stores a recursively rendered knowledge tree and can globally reorganise note placement.
- The live dashboard exposes an installable web-app manifest and uses the user's black line-art “D” as its browser, desktop, Android, and iOS home-screen icon.
- Breathing is a guided one-minute daily widget: six rounds of a 4-second nasal inhale and 6-second gentle exhale, shown through an expanding/contracting visual, phase countdown, and round progress.
- GMAT is a dashboard tile plus focused overlay workspace. It provides original adaptive Quant, Verbal, and Data Insights sprints; records accuracy, pacing, confidence and error causes; schedules broad skills with FSRS; tracks exam date, weekly minutes and official mock scores; and never presents its local practice as official material or invents a predicted GMAT score.

## Durable design preferences

- The dashboard shell stays quiet: lighter headings, inline summary metrics, plain language, restrained shadows and modest control shapes; vivid tile identities and glass completion states remain the visual focus. Settings uses labelled fields, a visible save state, optional setup details, and reversible layout resets.
- Dashboard tiles are transparent, hue-tinted liquid glass: the tile surface carries its colour, while text sits sharply over it in deep, readable ink. Use a thin luminous glass rim, softly refracted backdrop, and generous round corners rather than coloured outlines and white panels. Inner surfaces remain transparent. Completed tiles keep a stronger, vivid transparent hue and readable dark ink; the background must remain visible through both states. Typeface remains Nunito.
- Routine widget actions use accessible icon controls with 44px touch targets; Today expansion is a quiet corner icon. Keep actual content titles and actionable setup/error explanations. Reminders uses a broad desktop calendar/list composition and stacks on phones. The wallpaper stays a quiet mineral canvas without decorative stripes or rings.
- Dense tile content follows a natural top/left reading flow. Centering is reserved for compact utilities, empty states, and content that is intentionally poster-like.
- Tile internals respond to the tile's own width and height, not only to the browser window. Long controls reflow as readable rows, and mobile uses the page scroll instead of nested tile scrolling.
- Today omits redundant tile headings; accessible names remain. Library and expanded views retain a clear title. Titles follow the normal reading flow.
- Tiles have authored desktop and phone compositions; users rearrange with a handle or arrow keys instead of freely resizing. Legacy saved sizes remain preserved. Events is a large square and Philosophy is wide. Habit controls remain true circles.
- Reminders are practical recurring or one-off tasks: later items stay subdued, due items become prominent, and completed items are crossed through without checkbox UI. Events are a separate, non-scoring space for positive plans, presented as countdowns rather than tasks.
- Default Reminders are: suggest an app improvement/recommendation to the creator daily, call your mum weekly, and an example doctor appointment. One-off reminders can include an optional time, future reminders should stay subdued but readable, and the tile combines a navigable month calendar with its complete upcoming list; selecting a calendar date highlights the matching reminder without filtering or hiding the rest. Birthday gift planning does not appear in Reminders.
- In the Library, both Add-to-Today “+” and Remove-from-Today “×” are direct, absolutely positioned tile children centred half-inside/half-outside the top-right corner; neither action appears in the tile body or title wrapper. Compact Birthdays shows only today’s cake/name or the next birthday; its complete list and import controls live in a separate overlay.
- Timer Stop pauses and preserves the remaining time for Resume; Reset alone starts it over. Every positive Event uses the same full countdown-card hierarchy rather than a primary/secondary split.
- Birthday import lives in Settings with a short tutorial; the Birthdays tile stays focused on the compact summary and hidden full list.
- Compact utility tiles retain their title and adapt to tile shape: wide Timer and Push-ups layouts move controls to the right, Weather gives Tomorrow equal visual weight, completed due Reminders receive the tile’s full-colour completion state, and Event cards stay comparatively compact.
- Timer previews keep the time and Start/Stop/Resume controls prominent; duration adjustments live in the expanded view. When nothing is due, an unlabeled empty area in Reminders toggles the full-colour completion state; completed reminder text never receives an opaque white pressed field.
- Library widgets should match their Today widget bodies. AI-capable widgets can be generated individually from the Library without being added to Today.
- Visible stored dates render as `dd/mm/yyyy`.
- Note defaults to a compact one-row writing card with a visually hidden textarea scrollbar and stacked actions. Flat Timer controls use a four-adjustment row plus a separate balanced action row; compact Push-ups stretches its count and controls through the tile’s available height.
- The user’s editable display name is stored as `fefe_profileName`, appears in the dashboard greeting, and participates in the same sync, backup, and restore flow as other dashboard memory.
- Settings saves the display name and API key in place without reloading the dashboard or deleting today’s generated content.
- Loading failures show a grouped, actionable popup and a reason in each affected tile (personal/service key, disabled content, missing notes, connection, account, provider or storage failure). The main load control names its actual action and count; Library membership and daily generation settings are distinct.
- Dashboard Recall uses FSRS-6 at 90% desired retention, presented as flashcards: prompt first, reveal answer, then emoji-only grading. Existing fixed-ladder cards migrate into FSRS memory state without losing their due date or content, review history remains local, and at most eight due items are shown per session.
- Goals use a light list style: completing a goal only ticks a small box; the goal text is not struck through and goal rows avoid heavy separators.
- A saved location profile (city + timezone) drives the dashboard clock and weather tile.
- Health data uses the no-native-app bridge: an iOS Shortcut exports selected Apple Health daily summaries as JSON, and the dashboard imports/stores them locally under the same backup/sync memory contract. Garmin can instead be pulled automatically: a scheduled script (`scripts/garmin_to_dashboard.py`) pushes daily summaries — including Garmin-only Body Battery, stress, and HRV — to a token-keyed ingest Worker (`worker/health-ingest.js`), and the dashboard pulls and merges them on load. The health token is stored locally as `fefe_healthToken` and is deliberately excluded from cross-device sync, so a scripted write can never clobber the whole-state snapshot.
- Philosophy keeps its standard below-the-surface Socratic mode and also offers a per-topic philosopher dropdown with a distinct relevant icon for every mode. Named-philosopher replies must reconstruct only textually grounded views, admit when the source basis is unclear, and end with short source notes rather than inventing positions.
- Song recommendations name an exact recording and retain complete performer/ensemble/conductor credits plus a separate classical composer when relevant. Apple Music links use conservative catalog matching on both title and credits; an uncertain result opens a precise search instead of linking to a different recording.
- Learn deliberately keeps a more expressive game-like visual world than the dashboard.
- Tile colour comes from transparent glass. Resting tiles have a very light tint; completion increases the vivid hue while retaining transparency and dark ink. Dark buttons keep white text.
- No visible scrollbars; scrolling must still work.
- Never underline interface text.
- Inputs must always inherit readable contrast from their tile.
- Minimal note-like writing: few words, little filler.
- No unnecessary application branding or invented product name in the UI.
- Preserve colour identity, tactile completion reward, and individual character without inconsistency.
- Every dashboard tile follows one reversible visual-state contract: informative tiles can be tapped to toggle full colour, task tiles return to lighter tinted glass when their answer, button, or checkbox is undone, and no tile type is excluded from the full-colour treatment.
- Resized widgets use deliberate compact summaries and edge-to-edge internal layouts. At every supported tile shape, controls either reflow or secondary detail progressively hides; borders must never slice through buttons, text, or cards.
- Content reflows without horizontal scrolling. Dashboard uses page scrolling; long content opens in a focused view with Escape, backdrop close, focus return and preserved drafts/answers.
- Delete and close glyphs inside widgets are bare, centred, minimalist crosses rather than pill or rounded-rectangle buttons.
- Full-colour tiles use a vivid hue-aware transparent fill with high-contrast dark content and translucent internal surfaces, including for yellow, mint and cyan.

- Responsive sizing follows available window width and browser zoom. Individual tile spans grow for content without stretching neighbours. Compact/Comfortable/Large display size is stored per device and excluded from account sync.

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
