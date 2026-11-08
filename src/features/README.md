# Feature modules

Group screen rendering, event handlers, and feature-specific data access by capability. `leaderboard/` contains the initial empty view. Add `players/`, `games/`, `teams/`, and `admin/` as those features are implemented rather than creating unused abstractions now.

Use the shared client from `src/lib/supabase.js` for persistence and `src/domain/` for calculations. Rendering should not decide database permissions.
