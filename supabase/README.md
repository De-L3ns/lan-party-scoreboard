# Supabase MVP setup

Apply migrations in order: `migrations/202611080001_mvp.sql`, `migrations/202611090001_game_formats.sql`, `migrations/202611090002_guided_game_flow.sql`, `migrations/202611100001_themed_picker.sql`, `migrations/202611110001_knockout_tournament.sql`, then `migrations/202611120001_game_mvp.sql`. The first creates the application tables, public read policies, admin-checked transactional functions, a private draft/request schema, the `player-images` bucket configuration, and an initial active LAN. The second adds free-for-all games; existing games remain team-based. The third adds the guided setup/start flow and required team names. The fourth saves the picker theme and authorizes changes between picks. The fifth adds knockout tournaments, private seed layouts/reveal reservations, published matches/events, audited winner/undo operations, and bracket-validated individual awards. The sixth adds an optional saved MVP from the game's participants, without extra points.

## Apply to your project

1. Open your project in the Supabase Dashboard and open **SQL Editor**.
2. Run each unapplied migration **once**, as the database owner, in the order above. If the first five migrations are already installed, run only `migrations/202611120001_game_mvp.sql`; otherwise apply all remaining migrations in order. Do not rerun installed migrations. Each migration uses one transaction: a failure rolls the whole change back. If an error occurs, stop and resolve it rather than running fragments independently.
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
| `setup_game` | Saves game details and 2–64 selected players together. Team games prepare or resume a draft; changed assignments require confirmation. Free-for-all prepares and starts atomically. Knockout prepares or resumes a private shuffled bracket for pair-by-pair publication, without starting. Rejects setup while another game is active. |
| `create_game` | Creates a game in the explicitly selected active session, with `format` (`teams` by default, `ffa`, or `knockout`) and higher/lower result ranking. |
| `prepare_draw` | Validates 2–64 participants. Team games create 2–8 teams and privately save a shuffled player sequence. Free-for-all games immediately become ready, using one result entry per player. Knockout creates singleton award entries plus a private seeded layout and unpublished opening slots; byes publish/advance with their opening slot. Replacing setup requires confirmation and a matching revision. |
| `set_picker_mode` | Saves `rifle` or `trackmania` for a team draft with admin, active-LAN, lifecycle, and revision checks. Rejects changes during a reserved pick; leaves assignments and the private sequence unchanged. |
| `begin_roll` | Reserves or resumes the next private pick for an admin. Public viewers receive only progress metadata. |
| `commit_roll` | Reveals that reserved player into the next round-robin team exactly once; advances draft revision and progress. |
| `begin_knockout_reveal` | Reserves/resumes the next opening bracket position. Requires knockout drafting state, active LAN, admin, and matching tournament revision. Returns a reservation token, never a new client-selected pair. |
| `commit_knockout_reveal` | Publishes that reserved pairing/bye once, updates progress, advances byes, and publishes its event atomically. Requires the reservation token and matching tournament revision. |
| `record_knockout_winner` | Records a participant of a ready, started knockout match, advances the winner through fixed feeder links, publishes newly ready pairings, and preserves an audit record. Requires the tournament revision. No leaderboard points change. |
| `undo_knockout_result` | Confirms and reverses only the latest unreversed played result during `playing`, clears invalidated downstream slots/events, and retains the original audit record and reversal actor/time. Requires the expected result ID and tournament revision. |
| `start_game` | Requires every assignment to be complete, validates and saves distinct team names (1–40 characters), then starts the game and locks setup. Knockout requires every opening slot published and skips naming. Serializes competing starts using the active LAN lock. |
| `save_result` | Requires a started or completed game and validates complete individual/team results and allocations, records an audit event, updates current awards, and inserts only the difference from the previous award into the score ledger. Checks both game result and board preview revisions. Knockout additionally requires its tournament revision and a decided final, and validates read-only finishing places and individual awards against the bracket. |
| `adjust_points` | Records a reasoned individual adjustment or a single reversal of a previous adjustment. |
| `reset_lan` | Privately archives the specified active LAN and starts a fresh session with zero points and the retained active roster. |

Each state-changing request locks the active LAN before changing its game or score rows. Result corrections preserve earlier ledger events. Totals are derived from the ledger, not directly editable totals.

`save_result` also accepts optional `mvp_player_id`: a UUID from the game's saved participants, or JSON null/empty to clear it. An omitted field preserves an existing MVP for older clients. The selection is saved atomically with the results and included in the audited input; all existing authorization, lifecycle, correction reason, revision, and retry rules apply. `games.mvp_player_id` has a composite foreign key to that game's participant snapshot and can be non-null only for a completed game. `read_board` and the JSON report export include the field automatically. It contributes no leaderboard points.

Free-for-all games reuse the result and correction pipeline by storing each participant as a single-member result entry in `teams`. The UI presents individual players. Knockout also uses single-member award entries (up to 64), with bracket matches stored separately. `read_board` includes published `knockout_matches`, `knockout_events` with string event IDs, and admin-only `knockout_last_result`/`knockout_history`. Seed layout and pending reservations are never exposed through the board or public tables. All match commands check `tournament_revision`; point awards still use result/board revisions too. `read_board` includes `games.format` automatically; free-for-all setup creates no private wheel sequence. Team-count validation remains capped at eight for team-based games.

## Manual acceptance checklist

No local database test harness is installed. The migration has not been executed against the hosted project by the coding agent. Use a disposable first LAN for these checks before entering real event scores.

- Open the app signed out: read standings and reports; no player/draft/score actions should be available. A non-admin Auth user must also be denied all mutation RPCs, including direct calls.
- Sign in with the enrolled organizer. Add at least five players; upload a PNG and enter a profile title. Refresh and check persistence, then edit a profile. Bad MIME types or files above 2 MiB should be rejected.
- Select **Start new game**, choose five players and two teams, and spin through it. Picks must alternate A/B/A/B/A with no duplicate players. Check the public view in another browser or private window: it may see participants, never the private future sequence.
- Switch rifle/car modes between picks, refresh, and verify the saved mode and assignments. A non-admin direct mode request, stale revision, or attempt during a pending pick must fail.
- In both themes, check the visual target against the committed roster. A failed commit must show no successful shot/collision and must resume the same player. Verify spinning/impact sound, sound on/off, mute persistence, reduced motion, and layout at 2, 8, 16, and 64 participants. Hidden tabs and completed draws must stop audio and autoplay.
- Interrupt an unfinished roll, refresh, and resume. It must select the same reserved player. Try a second admin tab: stale operations must fail/reload without double assignments.
- After the draw, enter distinct team names and start the game. Confirm it returns to the scoreboard with an active-game tile. Reopen the tile and verify named rosters and **End game**. It must no longer allow a redraw. Record team results and preview/apply equal, split-pool, and custom awards. Use a three-member split of 10 to check 3.33/3.33/3.34.
- Create a free-for-all game and select participants. **Start game** must return directly to the scoreboard without a draft or team naming; verify further participant changes are rejected. Enter separate results and points for each player; preview, save, and correct an award. Test lower-is-better times and more than eight participants. Confirm existing team games still use their draft and award rules.
- Leave result entry without saving: the game stays active and scores do not change. Save after previewing: the tile disappears and another game can start. Competing starts from two admin tabs must allow only one active game.
- Correct an awarded result with a reason. Verify that it replaces the earlier contribution and leaves an audit record. A stale second result form should be rejected and require reopening.
- In each game format, save results with no MVP, then select a participant as MVP during a reasoned correction. Verify the report's portrait/name/titles, refresh persistence, unchanged point totals, and changing/clearing the selection. The current roster may change afterward; the report must retain the saved game profile. A direct request selecting someone outside the game must fail without changing points.
- Give several players equal totals at each top-three rank. Everyone at a shared rank must appear on one podium step, exactly once; the remaining list begins at rank 4. Check a fully tied roster and mobile layout.
- Add a negative individual adjustment, then reverse it from Score history. Check that the original event remains and cannot be reversed twice.
- Change a player's name/artwork after a game. The leaderboard can update, but that game's roster must retain its snapshot.
- Export a report, then archive/reset the disposable LAN. The new session should have zero scores and retained players; only the admin may select the old session. A direct anonymous `read_board` request for that archive must fail.
- Briefly disconnect a client. It must show stale/offline state, disable writes, and refetch on reconnect. Repeat the key read/admin flows on a phone.

### Knockout database verification

The new SQL migration and the rollback-only acceptance script have been syntax-checked, not executed against a database. After applying all migrations, run `tests/004_knockout_tournament.sql` as database owner against a disposable project with an enrolled organizer and an active LAN named `TEST - ...` with no active game. It verifies representative rosters from 2 through 64 players, seed privacy/grants, non-admin RPC rejection, byes, reveal/result retry deduplication, stale winner rejection, chronological undo/audit, champion completion, forged-place rejection, and difference-only award corrections. Success ends in `ROLLBACK`; it retains no test data. This script is not a local database harness and does not apply migrations.

Use [spec 004 acceptance scenarios](../docs/specs/004-knockout-tournament.md#11-acceptance-scenarios) for the remaining manual checks, particularly cross-device reveals, competing admin tabs, private archives, long tags, projector/mobile layout, and keyboard/reduced-motion behavior.

The JSON report export is for inspection and audit, not a complete recovery backup. Use Supabase database exports and a separate copy of Storage files before material maintenance.

### Game MVP database verification

The game MVP migration and `tests/006_game_mvp.sql` have not been executed against a database by the coding agent. After applying all six migrations, run that script as database owner in a disposable project with an enrolled organizer and an active `TEST - ...` LAN with no active game. It verifies optional selection, participant validation, non-admin/stale/unreasoned correction rejection, retry deduplication, audited selection/change/clear operations, omitted-field compatibility, board visibility, and no additional point awards. Success ends in `ROLLBACK` and retains no test data. Complete the UI checks above for all formats, saved identities, and shared podium layout.

## Operational notes

To revoke an organizer, delete its enrollment from `admin_users` in SQL Editor. Subsequent mutation/read checks will use the new authorization state. Archived data must not be exposed by adding broad read policies.

SQL migrations, grants, and authorization changes should remain versioned here. Never commit passwords, access tokens, production database dumps, or player artwork uploads.
