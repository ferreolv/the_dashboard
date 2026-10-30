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
- GMAT has been deleted from the product entirely (tile, workspace, question bank, daily generation, stats). Stored `fefe_gmat*` data stays untouched in browsers but nothing reads it. Default worker generation is word + german.

## Durable design preferences

- The default dashboard background is "Woven white": an embossed white-on-white isometric cube weave (each cube face striped in its own direction), drawn as a generated inline SVG rather than a stock image. Users still on the old default grey move to it once; any deliberate background choice is kept.
- The dashboard shell stays quiet: lighter headings, inline summary metrics, plain language, restrained shadows and modest control shapes; vivid tile identities and glass completion states remain the visual focus. Settings uses labelled fields, a visible save state, optional setup details, and reversible layout resets.
- Dashboard tiles are transparent, hue-tinted liquid glass: the tile surface carries its colour, while text sits sharply over it in deep, readable ink. Use a thin luminous glass rim, softly refracted backdrop, and generous round corners rather than coloured outlines and white panels. Inner surfaces remain transparent. Completed tiles keep a stronger, vivid transparent hue and readable dark ink; the background must remain visible through both states. Typeface remains Nunito.
- Routine widget actions use accessible icon controls with 44px touch targets; Today expansion is a quiet corner icon. Keep actual content titles and actionable setup/error explanations. Reminders stacks its calendar and list in a standard large tile and keeps full phone width. The wallpaper stays a quiet mineral canvas without decorative stripes or rings.
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
- Visible dates use en-US formatting: `MM/DD/YYYY` for numeric dates and "Wednesday, October 28" style for long dates.
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
- Tiles carry no visible name label on Today: each tile's own design carries its identity (the label stays for screen readers, in edit/library states and on unloaded tiles). The footer shows no "saved" tick; saved state is communicated by the content itself. No buttons-for-buttons (if tapping the tile already completes it, there is no separate mark button — World and Song complete by whole-tile tap) and no text-for-text.
- Word renders as a dictionary entry: serif headword, IPA, italic part of speech, numbered sense, FR gloss as sub-entry; the synonym quiz lives in the expanded view.
- Song's identity is one big tilted bold note; tapping the note opens the exact track in Apple Music (conservative catalog match on the FR storefront, geo.music.apple.com links so the song opens in the listener's own storefront; uncertain matches fall back to a precise search).
- Recall is a single-flashcard deck: the front shows only the prompt (never title/meta, which can leak the answer), tapping flips it, an emoji grade advances; the tile's built-in expand shows the same session big with undo, counter, per-grade intervals and segmented progress. FSRS-6 scheduling, the 8-card cap and undo/restore semantics are unchanged.
- Breathing is only its dial: the ring and orb fill the whole square tile, tapping the orb starts or stops it, and there is no visible text (the phase is announced to screen readers).
- Deutsch is a daily tile mirroring Español one level down (A1–A2 for a French native): explanations and questions in French, vocabulary with article + French-respelled pronunciation, recall fed like Spanish. German is never assumed guessable from French.
- Movies is a manual watch-list with a film-strip marquee showing only the next title; tapping the tile marks it watched today (tap again undoes), the expanded view manages the queue and seen history. Deliberately no AI.
- Tiles are frosted, vivid glass: a strong backdrop blur with extra saturation and a tint in the tile's own hue (vivid, never washed out or neon), a soft top sheen and a hairline edge — no thick rim band. Tile entrance animations must not animate opacity: that makes the tile a backdrop root and silently disables the frost.
- The expand control (⤢) appears only when a tile's preview, at the current size and zoom, actually hides content (expanded-only blocks, clamped text, collapsed rows); Recall keeps it for its focused session. Purely decorative captions opt out with `data-preview-optional`. Prefer putting short content on the main tile over adding an expand.
- Habits show emoji-only circles at Goals' size and shape; names, deleting and adding live in the expanded editor. Text-only habits keep their name.
- Goals use round checkboxes, a minimal underline "add a goal" field and no done/total counters.
- Push-ups is a loose pile of weight plates sized by value (+10 > +5 > +1) with the day's count in the corner; Timer is a small square dial (tap to start/pause/resume, adaptive −/＋ while idle).
- World news is set as a small newspaper page (masthead, dateline, lead story, ruled columns).
- Reminders recur every n days, weeks, months or years (calendar maths with month-end clamping); legacy day counts still work. The tile stays a compact calendar beside a single-line list.
- Brainflex rotates daily through owner-chosen challenge kinds (Fermi estimate, case interview, logic, probability, pattern, mental math, lateral riddle) picked with a ⚙ on the tile and stored in the worker's `shared_config` alongside the tile checklist.
- Daily-content progress is a compact pill with one dot per daily tile, not an explanatory banner.
- Weather is drawn, not emoji: custom gradient illustrations per WMO code bleed off the tile edge beside a large temperature, with tomorrow as a quiet pill. Song is the same size as Weather.
- Language tiles put the lesson's main point in a speech bubble beside a small waving flag; Español (flag right, two-column vocab) and Deutsch (flag left, rows with pronunciation) mirror each other.
- Knowledge shows a minimal line watering can pouring onto the day's field label.
- Insights is a dashboard page (`#/insights`) derived from all tile logs: records (perfect-day streak, best, perfect days, 30-day success), a month of completion rings (full days joined), a habit + tile history table with streak connectors and ice days (week or 4 weeks), per-section strict streak cards in each tile's colour (one missed day resets to 0), ice, push-ups and learning numbers.
- Further tile identities: Events render as admission tickets (day-count stub, perforation, then the plan, stacked vertically); Note is ruled notebook paper with a red margin; Philosophy sets the day's question as a serif quotation with an oversized opening quote mark; Push-up add-buttons are round weight plates sized by their value with a bare reset glyph; People are "HELLO" name badges grouped under their place; the next Birthday is a tear-off calendar leaf (month band + day) with the name and days-to-go beside it.
- Brainflex puzzles must be solved and verified by the generator before being emitted, with a ≤55-word prompt containing every needed fact and nothing decorative.
- Philosophy chat requests try the current Sonnet model and fall back to Haiku on a 4xx (retired model id), so the tile keeps working across model retirements.
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

- Desktop tile sizes come from a fixed module set — square 2×2, wide 4×2, large 4×3, tall 4×4, thin list 2×4 (plus the slim 4×1 note) — and a tile NEVER changes size. Nothing may visibly spill out of a preview: whole items hide (newspaper-style) with the rest behind ⤢, and the bottom fade is only a last resort. World, Spanish and German are 4×4; Shopping is the thin 2×4 list; Goals is 4×4 with three day sections. Library tiles never show a name, even while loading.
- The ⤢ expand control overlays the tile's top-right corner and must never shift tile content down; tiles keep that corner visually free. The expanded pop-up has no header bar: the expanded tile IS the dialog, with the close cross embedded in its top-right corner.
- No tile shows a title or section caption (e.g. shopping's "Your list" is gone); identity comes from the design itself. Loading/error states may still name the tile.
- Text inputs show no focus container anywhere: no focus rings, boxes, dashed circles or dotted underlines — just the caret (Goals' add field is the reference).
- Tile identities, round 3: Music is a slowly spinning grooved vinyl disc (the disc is the Apple Music link; it spins faster while matching) whose centre hole carries a ♫; the text column sits vertically centred beside it. Languages embed their flag as a vertical stripe bar beside the day's point (ES left/DE right, mirrored layouts) instead of a pole flag and tailed bubble. Knowledge's watering can is a small upright line icon resting quietly in the top-right corner — no drip animation — and the category is plain dim uppercase text, not a highlighted chip. Brainflex has no user choice of puzzle kinds: daily rotation across all kinds, the day's type shown as a label, and a decorative solid cog (ring + blocky teeth, unmistakably a gear) half-buried in the lower-right corner. Breathe releases soft ripple rings on each exhale and shows a soft rounded play glyph in the idle orb. The movie film strip runs diagonally across the whole tile, full bleed. The birthday cake sways gently on someone's birthday. The Note tile is a slim 4×1 whose ruled paper (lines in the tile's own colour) fills the whole tile. Reminders marks "due today" with a small accent dot + bold text, not a pill. World previews the lead plus exactly two column stories; the rest opens via ⤢.
- Recall grade buttons show the FSRS-scheduled interval ("1 d", "2 w", …) with the grade name beneath in the expanded view — no emoji faces — and an item's translation/meta is part of the answer face itself.
- Insights is laid out like a second dashboard: a 12-column grid of compact cards (stat band, calendar + ice + mini numbers, history + push-ups chart, then small per-tile streak cards), never near-full-width sections.
- German (and any shared daily tile) falls back to the user's personal Claude key when the shared worker cannot produce it; generation preferences stored before GMAT's removal are migrated once (gmat → german) so Deutsch is not silently skipped. German targets A2–B1 (no absolute-beginner content); the philosophy question is at most 12 words.

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
