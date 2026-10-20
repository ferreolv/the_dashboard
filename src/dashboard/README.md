# Dashboard module

Owns the Today and Tile Library experiences: goals, habits, reminders, notes, weather, timer, daily progress, personal utility tiles, arrangement, and completion presentation.

The live implementation remains in the root `index.html` during the compatibility-preserving migration. Dashboard-only work should not inspect `src/learn/`.


## Interface conventions

- The “Dashboard finish” CSS block in `index.html` controls the shell; the final “Coloured liquid glass” block owns tile materials. Tile-specific container rules retain their individual layouts. The final Curated responsive compositions block owns grid geometry: 12/8/4/2/1 units by available width. CURATED_TILE_LAYOUT supplies authored compositions; legacy saved sizes remain intact.
- Hash routes track browser Back/Forward. Navigation exposes the current page and the main region has a skip link.
- `DashboardModal` owns dialog focus, Escape, return focus, background isolation, and scroll locking. New overlays should reuse it.
- Settings labels belong to their controls. Profile, appearance, keys and city use Save changes; daily content preferences and health connections retain their separate actions. Layout reset offers Undo.
- The Library searches tile metadata, preserves Today membership controls, and never searches personal note contents. Notes save each edit before a route change or filter can hide them.

## Liquid-glass material

- `themeVars` provides each tile’s hue, deep tint, and readable foreground. The rounded tile shell stays transparent; `::before` owns the translucent coloured surface and backdrop refraction, and `::after` adds a restrained edge reflection. Content is never filtered.
- The embedded `dashboard-glass-refraction` SVG adapts the supplied design helper’s turbulence/displacement method at a gentler scale. A CSS blur fallback remains when SVG backdrop filtering is unavailable.
- Resting tiles use a light coloured tint and dark ink; completion increases the vivid hue at partial alpha, retaining dark ink and a visible backdrop. Nested panels should not introduce opaque white backgrounds.

## Daily loading contract

- `validDailyTile` rejects empty or malformed results. `mergeDailyContent` preserves the first valid success; the Worker validator is tested against the same fixture matrix.
- Every load entry point uses `runGen`, date-scoped records and a day-level Web Lock. Account hydration happens before missing-content requests. Weather is a dated snapshot, including migration of a same-day legacy cache.
- Missing generated content has an honest setup/retry state and cannot count as completed. Loading never changes ritual logs or streak history. Quiz selections persist by exact day and question; partial completion and undo use those saved answers.
- `dailyIssueInfo` supplies tile and popup reasons/recovery. `dailyRefreshPlan` supplies the main action label. User-initiated retries must not suppress errors.
- Backend changes require the SQLite `DAILY_COORDINATOR` binding; use `worker/wrangler.toml` for this deployment. Also publish the live public HTML/assets, since a GitHub push alone does not update `SYNC.__html__`.

## Account recovery contract

- The head bootstrap captures and scrubs reset fragments before external resources load. DashboardEntry renders PasswordReset before mounting App, so sync cannot reload away the token. Duplicate history events retain a captured token in memory.
- Forgot-password requests use a neutral acknowledgement and a resend cooldown; missing email configuration remains an explicit error. Passwords and reset tokens never enter browser storage.
- The reset form validates confirmation, keeps the token through network retries and requires normal sign-in after success. Resetting never clears the existing dashboard.
- AuthRecovery in the existing DAILY_COORDINATOR binding imports legacy credentials/sessions, commits reset consumption with the password, and revokes older sessions. Account tombstones reject late writes after deletion. Keep the coordinator when deploying; authentication fails closed without it.
- Email sender configuration and production delivery are required before considering recovery live. See worker/README-deploy.md.

## Curated compositions and focused views

- Today hides redundant visible tile labels while retaining accessible names. Library and expanded views remain labelled. Events is a large square; Philosophy is wide.
- Tile uses one persistent portal content host moved between preview and DashboardModal. Never duplicate or remount a card merely to expand it: drafts, answers, active timers and completion must survive.
- Authored data-rows remains stable for content styling; ResizeObserver measures content and reserves extra grid rows through inline placement only. One tall card must not enlarge every grid track.
- Device display preference fefe_deviceDisplay is excluded from sync snapshots via SYNC_EXCLUDE. Reordering uses visible Today neighbors; free resize is disabled without deleting old saved dimensions.
- Reading quizzes remain mounted in hidden expanded sections. Shopping shows needed items first; full lists and product selection remain available in expansion.
- Verify node --test src/dashboard/curated-layout.test.cjs src/dashboard/tile-interaction.test.cjs plus the existing dashboard regression suites.

- Quiet widget chrome and action rules own icon-only controls (with accessible labels/tooltips), the corner expansion action, and the broad Reminders calendar/list composition. Avoid reviving legacy authored-row compaction that shrinks calendar targets or hides reminder subtitles.
