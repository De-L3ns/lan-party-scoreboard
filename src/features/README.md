# Feature modules

Feature modules are grouped by capability: `leaderboard/` renders standings and the top three; `games/` provides player selection, team naming, active-game tiles, and rosters; `teams/` owns the wheel and draft controller; `admin/` provides organizer and result forms. `src/app.js` coordinates the guided screens, authentication, updates, and archive access. Setup and result pages preserve entered values across live refetches.

Use the shared client from `src/lib/supabase.js` for persistence and `src/domain/` for calculations. Rendering should not decide database permissions.
