# Dashboard module

Owns the Today and Tile Library experiences: goals, habits, reminders, notes, weather, timer, daily progress, personal utility tiles, arrangement, and completion presentation.

The live implementation remains in the root `index.html` during the compatibility-preserving migration. Dashboard-only work should not inspect `src/learn/`.


## Interface conventions

- The “Dashboard finish” CSS block in `index.html` controls the shell; the final “Coloured liquid glass” block owns tile materials. Tile-specific container rules retain their individual layouts. Desktop uses six columns from 1000 px so four/two and three/three spans pair without changing stored sizes.
- Hash routes track browser Back/Forward. Navigation exposes the current page and the main region has a skip link.
- `DashboardModal` owns dialog focus, Escape, return focus, background isolation, and scroll locking. New overlays should reuse it.
- Settings labels belong to their controls. Profile, appearance, keys and city use Save changes; daily content preferences and health connections retain their separate actions. Layout reset offers Undo.
- The Library searches tile metadata, preserves Today membership controls, and never searches personal note contents. Notes save each edit before a route change or filter can hide them.

## Liquid-glass material

- `themeVars` provides each tile’s hue, deep tint, and readable foreground. The rounded tile shell stays transparent; `::before` owns the translucent coloured surface and backdrop refraction, and `::after` adds a restrained edge reflection. Content is never filtered.
- The embedded `dashboard-glass-refraction` SVG adapts the supplied design helper’s turbulence/displacement method at a gentler scale. A CSS blur fallback remains when SVG backdrop filtering is unavailable.
- Resting tiles use dark ink over coloured glass; completed tiles retain alpha transparency with a deeper tint and white text. Nested panels should not introduce opaque white backgrounds.
