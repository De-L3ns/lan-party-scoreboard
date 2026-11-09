# Feature modules

Feature modules are grouped by capability: `leaderboard/` renders standings and the top three; `games/` renders game reports and rosters; `teams/` owns the wheel and draft controller; `admin/` provides organizer forms. `src/app.js` coordinates selection, authentication state, updates, and archive access.

Use the shared client from `src/lib/supabase.js` for persistence and `src/domain/` for calculations. Rendering should not decide database permissions.
