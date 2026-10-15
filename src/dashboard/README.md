# Dashboard module

Owns the Today and Tile Library experiences: goals, habits, reminders, notes, weather, timer, daily progress, personal utility tiles, arrangement, and completion presentation.

The live implementation remains in the root `index.html` during the compatibility-preserving migration. Dashboard-only work should not inspect `src/learn/`.


## Interface conventions

- The final “Dashboard finish” CSS block in `index.html` controls the shell and shared polish; tile-specific container rules retain their individual layouts. Desktop uses six columns from 1000 px so four/two and three/three spans pair without changing stored sizes.
- Hash routes track browser Back/Forward. Navigation exposes the current page and the main region has a skip link.
- `DashboardModal` owns dialog focus, Escape, return focus, background isolation, and scroll locking. New overlays should reuse it.
- Settings labels belong to their controls. Profile, appearance, keys and city use Save changes; daily content preferences and health connections retain their separate actions. Layout reset offers Undo.
- The Library searches tile metadata, preserves Today membership controls, and never searches personal note contents. Notes save each edit before a route change or filter can hide them.
