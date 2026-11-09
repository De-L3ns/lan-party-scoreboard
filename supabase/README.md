# Supabase MVP setup

Apply migrations in order: `migrations/202611080001_mvp.sql`, then `migrations/202611090001_game_formats.sql`. The first creates the application tables, public read policies, admin-checked transactional functions, a private draft/request schema, the `player-images` bucket configuration, and an initial active LAN. The second adds free-for-all games; existing games remain team-based.

## Apply to your project

1. Open your project in the Supabase Dashboard and open **SQL Editor**.
2. Run each unapplied migration **once**, as the database owner, in the order above. For an existing MVP database, run only `migrations/202611090001_game_formats.sql`. Each migration uses one transaction: a failure rolls the whole change back. If an error occurs, stop and resolve it rather than running fragments independently.
3. In **Authentication → Users**, find the organizer account already created during project setup. Enroll it through SQL Editor:

   ```sql
   insert into public.admin_users(user_id)
   select id from auth.users where email = 'your-admin-email@example.com'
   on conflict do nothing;
   ```

   Substitute your actual organizer email and verify that one row exists in `admin_users`. Do not enter the account password in SQL or frontend configuration. To enroll an additional organizer, run this statement for that existing Auth account.
4. Keep self-service signup and anonymous sign-in disabled. A signed-in account is not automatically an admin: authorization depends on `admin_users`.
5. Keep `scoreboard_private` out of the Data API's exposed schemas. Never grant client access to its tables.
6. Under Database replication/Realtime settings, verify `public.board_updates` belongs to `supabase_realtime`. The migration adds it when that publication exists; it is the only table the frontend subscribes to. The 15-second refetch fallback still works if Realtime is unavailable.
7. Keep the Storage bucket `player-images` public for downloads. The migration sets PNG-only uploads and a 2 MiB limit. Only enrolled admins receive insert access; uploads use unique filenames rather than overwriting old artwork. Earlier profile/game snapshots retain those files.
8. Verify local or GitHub Actions values for `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_ADMIN_EMAIL`, then rebuild/deploy through the existing Pages workflow.

Do not change the app to use a secret/service-role key to bypass a permission error. Do not add blanket table write grants. Public writes are denied; the app uses specifically authorized RPCs.

## API contract

All mutations take `p_input` (JSON) and `p_request_id` (UUID). The client retains pending request IDs in tab storage so a retry uses the same ID and payload. Requests with reused IDs but different payloads are rejected. The database checks admin identity first.

| Function | Behavior |
| --- | --- |
| `read_board(p_session_id)` | Public active LAN snapshot, or an archived snapshot for an admin. Includes standings, games, participant/team snapshots, and published picks. Only admins receive roster management data, archive choices, and score history. |
| `is_admin()` | Checks the current Auth user's enrollment. |
| `save_player` | Add/edit/archive a player, using profile revision checks. Updates active LAN profile snapshots without changing prior games or archived LANs. |
| `create_game` | Creates a game in the explicitly selected active session, with `format` (`teams` by default, or `ffa`) and higher/lower result ranking. |
| `prepare_draw` | Validates 2–64 participants. Team games create 2–8 teams and privately save a shuffled player sequence. Free-for-all games immediately become ready, using one result entry per player. Replacing setup requires confirmation and a matching revision. |
| `begin_roll` | Reserves or resumes the next private pick for an admin. Public viewers receive only progress metadata. |
| `commit_roll` | Reveals that reserved player into the next round-robin team exactly once; advances draft revision and progress. |
| `start_game` | Locks ready participants or teams against further setup changes. |
| `save_result` | Validates complete individual/team results and allocations, records an audit event, updates current awards, and inserts only the difference from the previous award into the score ledger. Checks both game result and board preview revisions. |
| `adjust_points` | Records a reasoned individual adjustment or a single reversal of a previous adjustment. |
| `reset_lan` | Privately archives the specified active LAN and starts a fresh session with zero points and the retained active roster. |

Each state-changing request locks the active LAN before changing its game or score rows. Result corrections preserve earlier ledger events. Totals are derived from the ledger, not directly editable totals.

Free-for-all games reuse the result and correction pipeline by storing each participant as a single-member result entry in `teams`. The UI presents individual players. `read_board` includes `games.format` automatically; free-for-all setup creates no private wheel sequence. Team-count validation remains capped at eight for team-based games.

## Manual acceptance checklist

No local database test harness is installed. The migration has not been executed against the hosted project by the coding agent. Use a disposable first LAN for these checks before entering real event scores.

- Open the app signed out: read standings and reports; no player/draft/score actions should be available. A non-admin Auth user must also be denied all mutation RPCs, including direct calls.
- Sign in with the enrolled organizer. Add at least five players; upload a PNG and enter a profile title. Refresh and check persistence, then edit a profile. Bad MIME types or files above 2 MiB should be rejected.
- Create/select a game, prepare five players and two teams, and spin through it. Picks must alternate A/B/A/B/A with no duplicate players. Check the public view in another browser or private window: it may see participants, never the private future sequence.
- Interrupt an unfinished roll, refresh, and resume. It must select the same reserved player. Try a second admin tab: stale operations must fail/reload without double assignments.
- Start the game. It must no longer allow a redraw. Record team results and preview/apply equal, split-pool, and custom awards. Use a three-member split of 10 to check 3.33/3.33/3.34.
- Create a free-for-all game, select participants, and check that it becomes ready without spinning. Change its participants before starting, then start it and verify further changes are rejected. Enter separate results and points for each player; preview, save, and correct an award. Test lower-is-better times and more than eight participants. Confirm existing team games still use their draft and award rules.
- Correct an awarded result with a reason. Verify that it replaces the earlier contribution and leaves an audit record. A stale second result form should be rejected and require reopening.
- Add a negative individual adjustment, then reverse it from Score history. Check that the original event remains and cannot be reversed twice.
- Change a player's name/artwork after a game. The leaderboard can update, but that game's roster must retain its snapshot.
- Export a report, then archive/reset the disposable LAN. The new session should have zero scores and retained players; only the admin may select the old session. A direct anonymous `read_board` request for that archive must fail.
- Briefly disconnect a client. It must show stale/offline state, disable writes, and refetch on reconnect. Repeat the key read/admin flows on a phone.

The JSON report export is for inspection and audit, not a complete recovery backup. Use Supabase database exports and a separate copy of Storage files before material maintenance.

## Operational notes

To revoke an organizer, delete its enrollment from `admin_users` in SQL Editor. Subsequent mutation/read checks will use the new authorization state. Archived data must not be exposed by adding broad read policies.

SQL migrations, grants, and authorization changes should remain versioned here. Never commit passwords, access tokens, production database dumps, or player artwork uploads.
