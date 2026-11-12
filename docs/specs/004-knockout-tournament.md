# 004 — Knockout tournament

Status: Application source and SQL migration implemented; hosted migration application and manual browser/database acceptance checks pending. Updated: 2026-11-11.

The approved fundamentals and visual reference are in `mockup/knockout-tournament.html`, revised to match the existing application's olive-and-lime theme. This is a local, gitignored HTML mockup, unavailable in a fresh clone. This specification captures the required behavior independently of that file. Its sample players, character portraits, local photo picker, in-memory results, and immediate redraw behavior are demonstration conveniences, not production requirements.

This feature adds a third game format to [002 — Guided game flow](002-guided-game-flow.md), alongside free-for-all and team games. [001 — MVP leaderboard](001-mvp-leaderboard.md) continues to define scoring, player profiles, authorization, archives, and persistence. [003 — Themed player picker](003-themed-player-picker.md) continues to apply to team assignment; its rifle/car picker is not used for knockout tournaments.

[005 — Score entry and leaderboard reveal](005-score-reveal.md) replaces the final **Preview awards → Save results** interaction below. It preserves bracket-derived places and per-rank awards while adding a post-save leaderboard-change popup. Application source is implemented; browser/projector checks are pending.

## 1. Purpose

Run a single-elimination tournament between the selected players. Each played match is 1v1: the winner advances, the loser is out, and the final winner becomes champion. Make the draw and each newly confirmed matchup a shared moment through a focused, Tekken-inspired **versus** reveal showing both players' pictures, names, and profile tags.

Keep the rest of the interface consistent with the current application. The bracket and player identities should be the main content, without additional decorative panels or slogans.

## 2. Flow and lifecycle

**Set up and start:**

Scoreboard → **Start new game** → Select players and **Knockout Tournament** → **Draw tournament** → Reveal opening matchups → Review bracket → **Start game** → Scoreboard with an **Active game** tile.

**Play:**

**Active game** tile → Tournament bracket → Select a ready match → Select winner → **Confirm winner** → Persist result and advance winner → Show versus reveal if the next opponent is known → Continue playing.

**Finish:**

Final winner confirmed → Champion and final bracket → **End game** → Review finishing places and enter points per rank → **Preview awards** → **Save results** → Updated scoreboard.

Use the existing game lifecycle:

| State | Knockout meaning | Allowed progression |
| --- | --- | --- |
| `setup` | Game details/participants have not yet produced a valid draw. | Save valid setup and prepare the draw. |
| `drafting` | The server has prepared the bracket; opening slots are still being revealed. | Reveal or resume the next saved pairing/bye. |
| `ready` | Every opening slot is published and the bracket can be reviewed. | Start the game, or explicitly replace the draw before starting. |
| `playing` | Participants and bracket structure are locked; match winners can be recorded. | Advance winners, undo the last match result, or enter awards once the final is decided. |
| `completed` | The champion and leaderboard awards have been saved. | Read the report or correct awards through the existing correction flow. |

- Finishing the draw does not start the game automatically. **Start game** is the explicit boundary and returns to the scoreboard, as in feature 002.
- Finishing the final does not automatically save leaderboard points or complete the game. It remains the active game until **Save results** succeeds.
- Preserve the single-active-game rule across all three formats. An active knockout tournament blocks starting another game, including while its final awards are being reviewed.
- Knockout skips team assignment and team naming. Its setup indicator is **Players → Tournament bracket**.

## 3. Player selection and setup

- Add **Knockout Tournament** beside the existing free-for-all and team format choices on the current player-selection screen. Do not introduce a new landing page or change the existing formats' flows.
- Use the same eligible, non-archived players, default selection of all eligible players, individual checkboxes, selected count, and **Select all / Deselect all** controls.
- Support 2–64 distinct selected players. Reject invalid selections on both the client and server.
- Keep game name and map/details fields. Hide team count, team award modes, team naming, and highest/lower-score ranking controls for knockout. Match winners are selected explicitly; finishing places are derived from the bracket.
- The primary action is **Draw tournament**. Disable it while the selection or required game name is invalid or a command is pending.
- Snapshot each participant's name, profile titles/tags, and image path when preparing the draw, using the existing game-roster snapshot model. Later profile edits must not change this tournament's identities or artwork.
- Use saved player PNGs from the existing image pipeline and existing fallbacks. In this feature, “tags” means the profile titles already stored by the app; do not create a separate tag system.
- Production photo/title changes stay in **Admin → Players**. Do not add the mockup's local **Change picture** upload controls to tournament setup.
- Before starting, changing participants or format requires explicit confirmation that the old draw will be replaced. A game-name/details edit alone must preserve the bracket. Navigation, refetches, and opening an existing setup never reroll it.
- Once started, participants, format, and seeded positions are locked. There is no redraw or reassignment during play.

## 4. Bracket rules and byes

- The server randomly shuffles the selected participants once when preparing a new draw. Do not seed by leaderboard position, name, skill, profile tag, or client-side randomness.
- Build a bracket with the smallest power-of-two capacity that contains the roster: 2, 4, 8, 16, 32, or 64 slots.
- Place every selected player in exactly one opening slot. Unused opening slots are byes, not placeholder players or eliminations.
- Distribute byes across the opening round using a consistent seed-position layout. Never create a bye-versus-bye match or require a preliminary elimination round. Because players are shuffled before placement, no named player is preferentially assigned a bye.
- A player paired with a bye advances automatically when that opening slot is published. Label the bye and automatic advancement clearly; require no winner selection and show no versus reveal against an empty opponent.
- Present this as **Automatic advance** with one player and **Direct to [next round]**. Do not display a fake opponent named “Bye,” a question-mark player card, or a versus layout for this slot. Explain in the selected details that the player has no opening opponent and advances directly.
- Later matches obtain their participants only from the winners of their two fixed feeder matches. Do not redraw between rounds, move a winner to a different branch, or allow an eliminated player to return.
- A match becomes ready only when both participants are known and distinct. One known winner may appear in the next round while the other slot reads **Winner of [source match]**.
- There are no drawn results. Every played match requires exactly one winner who is one of its two saved participants.
- Exactly `participant count − 1` played match results are needed to determine the champion. Byes do not count as wins, played matches, or eliminated opponents.

Examples:

| Players | Capacity | Opening-round byes | Played matches in the full tournament |
| --- | --- | --- | --- |
| 2 | 2 | 0 | 1 |
| 3 | 4 | 1 | 2 |
| 5 | 8 | 3 | 4 |
| 8 | 8 | 0 | 7 |
| 12 | 16 | 4 | 11 |
| 64 | 64 | 0 | 63 |

## 5. Opening draw and versus reveal

### Opening draw

- **Draw tournament** prepares/resumes the persisted server draw and opens the first pairing reveal. Reveal actual opening matches in bracket order; publish byes with a concise automatic-advance state.
- Show one pairing at a time. **Next matchup** reveals the next saved pairing; after the last one, offer **Back to bracket**, then **Start game** on the completed bracket.
- The admin may return to the bracket during the draw without discarding progress. Provide **Continue draw** while opening slots remain unpublished; starting is unavailable until the draw is complete.
- Each published pairing must come from the server's prepared bracket. Repeated clicks, retries, interruption, and two admin tabs must not choose a replacement opponent or publish a pair twice.
- Reserve/resume and commit the next opening reveal using the same integrity principles as the existing team picker. Keep the prepared sequence and unpublished positions private; do not expose future pairings through public tables or API responses.
- Only show a definitive versus pairing and update public bracket slots after the server confirms its publication. Before acknowledgement, use a neutral pending state. A failed publication preserves the same reserved pairing and offers retry/resume.
- On refresh, preserve all published slots and resume any reserved reveal. Published matchups remain inspectable without replaying the entire opening sequence.

### Shared versus component

Use the same presentation for an opening pairing, a newly confirmed later-round pairing, and an explicit **Show versus** replay:

- Two prominent player pictures, side by side, with **VS** between them.
- Each player's saved name and all saved profile tags directly below the picture. Preserve readable wrapping for long names and the existing maximum of five titles; do not crop important identity text to fit the mockup's short examples.
- A compact game name and round/match label. For later rounds, a short **Next opponent confirmed** context is sufficient.
- A brief entrance for the two player cards and the VS mark, inspired by a fighting-game matchup screen. Keep the app's olive background, cream text, lime accents, fonts, and rectangular cards.
- Align both portraits at the same top edge and center the VS mark between the portraits themselves, independent of name wrapping, tag count, or card height. A restrained angled lime badge and brief impact animation give the mark emphasis; retain this alignment on phones and with reduced motion.
- Hold the confirmed pairing until the viewer continues or closes it. Do not flash through pictures, names, or tags on a timer.
- With reduced motion, show the same complete pairing immediately. Missing or failed pictures use the existing portrait fallback and never prevent progression.
- Use contained portraits so uploaded PNG artwork is not stretched or unintentionally cropped. Pictures remain the visual focus without replacing real players with sample fighters.
- Do not introduce a separate red/neon theme, slogans, weapon effects, character art, unnecessary metrics, or persistent decorative panels. Do not require new sound effects or licensed Tekken assets.
- **Show versus** is a local replay for a match with both players known. It does not redraw, publish another reveal, change the selected winner, or save a match result. Visitors may use it too.
- Closing/replaying a presentation is local UI state. During an opening draw, only an authorized admin's **Next matchup** may publish the next unpublished pair; visitor controls only dismiss/replay already published content.

## 6. Active bracket and winner progression

- The active-game tile identifies **Knockout Tournament**, the game name, **In progress**, and a compact participant summary. It opens the saved bracket.
- Show rounds as connected bracket columns leading to a clearly identified champion slot. Use appropriate labels: **Round of 64/32/16**, **Quarterfinals**, **Semifinals**, and **Final**. A two-player tournament consists of the final only.
- Show each known participant's picture and name in match cards. Distinguish ready, waiting, automatic advance, and finished matches. Mark winners and eliminated players with text/icons as well as color; keep eliminated players visible in their original matches.
- Select a match to show its two players, pictures, names, and tags beside or below the bracket. Keep the actual winner-entry controls simple: select either player, then **Confirm winner**. Do not save merely because a player card was selected.
- Any ready match may be played; do not require unrelated branches or an entire round to finish first.
- Only admins may record winners, and only in a started tournament. The server rejects results for waiting, bye, finished, or foreign matches and rejects a winner outside the saved pair.
- Confirming a winner atomically saves the result, eliminates the opponent, populates the fixed next-round slot, updates readiness, and emits any newly confirmed pairing. Do not advance the UI optimistically before acknowledgement.
- If the next opponent is still unknown, show the winner in their next slot and concise waiting feedback. Do not show a versus reveal with a question mark or invent an opponent.
- When a result makes both players in a later match known, automatically show the shared versus reveal for that exact new pairing, including both players' pictures, names, and tags.
- If one player advances first, wait. When the other feeder match finishes, show the reveal once, with the two confirmed winners. This applies equally when one participant came through a bye.
- A reveal cannot record or automatically decide the new match. Dismissing it returns to the saved bracket and winner-entry controls.
- After the final, show the champion using their saved identity and the complete bracket. There is no next-opponent reveal. Enable **End game** and retain **Undo last result** until final awards are saved.

### Result undo before completion

- Provide admin-only **Undo last result** during `playing`, including after the final but before **Save results**. It reverses the most recently committed played-match result, not a bye or an arbitrary earlier match.
- Require a concise confirmation because this changes the shared tournament. The server validates the expected last result and tournament revision.
- Clear that match's winner, restore both participants' eligibility in that match, and remove the invalidated next-round slot/readiness and champion if applicable. Keep all other valid results and the original draw.
- Chronological undo ensures no subsequently recorded descendant result remains attached to a reversed winner. To correct an earlier result, undo later recorded results in reverse order, then select the correct winner and play forward.
- Log the reversal; do not erase the original audit event. Correcting/confirming the winner again may generate a new next-opponent reveal when that pairing becomes ready again.

## 7. Finishing places, points, and reports

- Only a bracket with a confirmed champion may enter final awards or complete. Do not use **End game** to bypass undecided matches.
- Derive finishing places from the bracket: champion is first, final loser second, semifinal losers tied third, quarterfinal losers tied fifth, then tied ninth, seventeenth, and thirty-third. Byes create no extra finishing places or credited victories.
- For a zero-based loss round `r` in an `R`-round bracket, the eliminated player's place is `2^(R − r − 1) + 1`. The champion's place is 1. Show tied places honestly; do not invent a third-place playoff or an ordering among players eliminated in the same round.
- Display derived places as read-only results with one leaderboard-points input per finishing rank, including eliminated ranks. List the saved player names and pictures in each rank group. The entered amount applies in full to each player at that rank, rather than being split. Start new awards at zero; do not award points per win, per bye, or per place automatically.
- Order rank fields and the awards preview by finishing place, champion first. List players alphabetically within a tied group. Preview one award amount per rank and each player's current/resulting total. If older tied players have different saved awards, show those values and require an explicit shared replacement instead of silently selecting one.
- Treat these placement results as lower-is-better internally: first place precedes second. There is no editable ranking-direction control for knockout, and the server rejects a result that disagrees with the saved bracket.
- Reuse **Preview awards → Save results**, two-decimal precision, per-player award validation, current/award/resulting-total preview, request deduplication, board revision checks, and transactional ledger updates.
- A match result or versus reveal changes no leaderboard points. Saving final awards completes the game and updates all affected totals exactly once.
- Leaving award entry or a failed save keeps the tournament active, preserves the confirmed champion, and retains editable award inputs for retry.
- Completed reports include the final bracket, champion, saved participants/tags/artwork, tied finishing places, and player awards. Include knockout data in the existing session report export and preserve it in admin-only LAN archives.
- The existing **Correct result** flow remains available for award corrections, with a reason and difference-only ledger updates. Bracket-derived places are not editable numeric scores.
- In this first implementation, saved match outcomes are locked once the game is `completed`; correcting a completed bracket is outside scope. Correct match outcomes through undo before final awards are saved. Award corrections must not silently rewrite the bracket or champion.

The finish/start boundaries, placement-based results, manual awards per rank, and post-completion outcome lock are implementation defaults chosen to fit the existing flow. They do not imply that the mockup already implemented persistence or that a new automatic scoring system was approved.

## 8. Persistence, authorization, and live presentation

- Persist participants/snapshots, original draw, published opening slots, byes, feeder links, match results, undo history, readiness, and champion state in Supabase. A browser refresh must never reshuffle or reconstruct a different tournament.
- Enforce admin membership, active-LAN access, lifecycle checks, and the single-active-game rule in the database, not just by hiding controls. Preserve public active-LAN reads and private archives.
- Every mutation uses the existing `p_input`/`p_request_id` deduplication contract. Lock the LAN and tournament state consistently; check a tournament revision in addition to existing setup/score/board revisions where applicable.
- A repeated request returns its original result. Reusing an ID with a different payload, submitting a stale winner, undoing an outdated last result, or recording competing winners must be rejected without partially updating the bracket.
- Advance match state and publish newly ready pairings in the same transaction. Give each published presentation event a stable identity so retries and refetches do not generate duplicate reveals.
- `read_board` and live refetches include published tournament state and enough event metadata for displays already viewing that tournament to present a new pairing. Direct public reads must not disclose unpublished seed positions, reserved targets, or the remaining opening reveal sequence.
- A visible device viewing the tournament automatically shows newly published pairings once. The scoreboard and other game views do not navigate themselves into it. Exact animation-frame synchronization is not required.
- Track handled event identities locally. Initial page loads, ordinary refetches, replaying a match, and reconnecting must not repeatedly open old reveals. A late-joining viewer sees the current bracket and may use **Show versus**.
- If multiple new events arrive while a reveal is open, queue still-valid new pairings in committed order. Refresh or discard queued presentations invalidated by an undo; never display a pair inconsistent with the current authoritative bracket.
- Leaving the tournament view or hiding the tab cancels local animation and clears its presentation backlog. On return, refetch the current bracket without replaying every missed matchup. It must not cancel a committed result or initiate further draw mutations in the background.
- Offline/stale clients may inspect their last loaded state but cannot draw, start, record/undo a winner, or save awards until refreshed. A failed operation preserves the relevant selection/reservation and supports safe retry.

## 9. Layout and accessibility

- Reuse the current app shell, wordmark, olive surfaces, lime accent, borders, buttons, typography, setup layout, and image fallback behavior. Do not ship a separate mockup shell or a new overall visual theme.
- Prioritize the bracket and selected matchup. Use a side panel when space permits and stack the matchup below the bracket on small screens.
- Support 2–64 players rather than the mockup's sample roster. Large brackets may scroll within a clearly bounded region; keep round headings and source-match references understandable and bring a selected/newly ready match into view without losing the user's position unnecessarily.
- On phones and short projector/laptop windows, keep versus pictures, names, tags, and its continue/close controls reachable. Permit scrolling for long profiles instead of overlapping or hiding identity text.
- Preserve keyboard selection, visible focus, accessible selected/disabled states, and a logical order between matches, players, and actions.
- Treat the versus overlay as an accessible dialog: named context, focus moved inside, focus containment, keyboard-operable continue/close, Escape to dismiss, and sensible focus restoration. Dismissal does not commit another pair or alter a result.
- Announce one concise confirmed pairing/result through a live region, not every animation frame. Use semantic text for winner/eliminated/waiting states so color and connector lines are not the only source of meaning.
- Cancel animations, timers, pending presentation callbacks, and subscriptions on disposal. Reduced motion preserves the same pairs and results, including automatic later-round reveals.

## 10. Implementation boundaries

- Add a validated game format such as `knockout` and a new versioned Supabase migration after `202611100001_themed_picker.sql`. Do not modify already applied migrations or imply that the new migration has already been applied.
- Add explicit persisted match records with game, round, position, two opening/feeder slots, winner, status, and revision; preserve draw privacy and result audit events. Enforce match/participant uniqueness, valid feeder relationships, and game ownership server-side.
- Store the unpublished shuffled opening layout/reservation in the unexposed private schema. Publish only confirmed opening slots and subsequent match state through authorized operations.
- Extend setup/start/read/report/export paths and introduce authorized operations for opening-pair reserve/commit, winner recording, and last-result undo. Exact RPC names may follow implementation conventions; all must enforce the behavior above.
- Keep knockout logic explicit. Do not route it through the 2–8-team validation, team-naming requirement, rifle/car picker, or fixed A/B/C assignment cycle.
- The existing single-member result entries used by free-for-all may be reused for knockout's per-player final awards, including more than eight players. Store the bracket separately, derive places on the server, and validate those derived results when saving/correcting awards. Do not represent every 1v1 as an independently active game or a permanent team.
- Keep pure bracket calculations separate from rendering, versus presentation, controller lifecycle, and API access. The database independently validates the authoritative bracket and progression.
- Extend the current result form/pipeline for derived, read-only places and one award input per rank. Expand that rank amount into individual ledger awards for every listed player. Preserve existing free-for-all and team result/correction behavior.
- Update `README.md`, setup/database instructions, and relevant feature/domain documentation when implementation is ready. Mark the new migration prerequisites and activation status accurately.
- Add focused domain/controller checks and database permission/transaction verification as the feature is implemented. Browser/projector verification remains manual unless the user requests automated browser testing. Do not introduce a local database harness solely because of this specification.
- Double elimination, round robin, group stages, manual/skill seeding, best-of scoring, individual match scores, forfeit/disqualification flows, third-place playoffs, late entrants, game-server integration, new audio, automatic points schedules, and post-completion bracket rewrites are outside this feature.

## 11. Acceptance scenarios

1. **Existing formats:** Team and free-for-all games retain their current setup, picker, start, result, correction, and archive flows. Knockout appears as a third format on the existing player-selection screen.
2. **Selection:** An admin selects 2–64 eligible players. Invalid counts, duplicate IDs, missing names, unauthorized callers, and archived-session writes are rejected. Team count/ranking controls and team naming do not appear for knockout.
3. **Two players:** The draw creates a single final and shows both saved pictures, names, and tags. Confirming its winner after starting produces a champion; exactly one played result is required.
4. **Eight players:** The draw produces four opening pairings, two semifinals, and a final. Every player appears exactly once in the opening slots. No reroll occurs during navigation, refetch, or refresh.
5. **Uneven rosters:** Check 3, 5, and 12 players. Byes are distributed without empty-versus-empty matches, advance automatically, receive no versus reveal or win credit, and the tournament requires exactly 2, 4, or 11 played results respectively.
6. **Draw recovery/privacy:** Interrupt an opening reveal, retry, and resume from a second admin tab. The same reserved pair is published once. Public API/table reads cannot reveal unpublished pairings or positions.
7. **Draw completion:** Opening reveals stay readable until continued. Leaving midway preserves progress and offers **Continue draw**. Only a fully published bracket enables **Start game**, which returns to the scoreboard with the correct tile.
8. **First advancing player:** Record one opening winner while their next opponent is unknown. That winner appears in the correct next-round slot; no versus reveal opens against an unknown opponent.
9. **Opponent confirmed:** Finish the other feeder match. Exactly one automatic versus reveal shows the two correct winners with their saved pictures, names, and tags. The new match remains undecided until an admin records its winner.
10. **Independent branches:** Select any ready match while another branch is unfinished. The result advances only that branch. Waiting/bye/finished matches and foreign players cannot be submitted as valid winner choices.
11. **Retry/concurrency:** Double-click **Confirm winner**, retry after a timeout, and submit conflicting winners from two admin tabs. Exactly one result is committed, one opponent is eliminated, and one set of newly ready events is published; stale state requires refetch.
12. **Undo:** Confirm a result, then undo the most recent result with confirmation. The original draw and unrelated results remain intact; affected next slots/readiness/champion are cleared, the audit retains both actions, and a corrected winner may generate a fresh valid versus reveal.
13. **Public display:** A second visible device already viewing the tournament receives a newly confirmed pairing once. Repeated live refetches do not replay it. A fresh or returning/backgrounded tab shows the current bracket without an old reveal backlog. Visitors cannot mutate any tournament state.
14. **Replay:** **Show versus** displays a known pair and its tags without changing draw progress, result selection, saved winners, points, or shared event history. Closing a reveal returns focus sensibly and changes no outcome.
15. **Champion and awards:** The final winner is clearly identified. No leaderboard points change until the separate awards preview/save succeeds. The game stays active and blocks another start while awards are pending or a save fails. A successful retry applies each award once and removes the active tile.
16. **Places and corrections:** An eight-player result has places 1, 2, 3, 3, 5, 5, 5, 5. An uneven roster follows the same elimination-round rule. Places are read-only. Each finishing rank has one points field with its players listed; tied players each receive the full value. Point corrections require a reason and replace each player's earlier contribution, without rewriting match outcomes.
17. **Saved identity/history:** Change a player's current name, tags, or picture after preparing the draw. Existing tournament cards, versus reveals, reports, and exports retain the saved profile. Archived tournaments remain accessible only under the existing archive permissions.
18. **Scale and accessibility:** Check 2, 8, 16, and 64 participants on a phone, laptop, and projector, including missing images, long names/five long tags, keyboard-only use, and reduced motion. Bracket connections remain inspectable; versus identity and controls remain readable and reachable.

## 12. Activation

Apply `supabase/migrations/202611110001_knockout_tournament.sql` after the MVP, game-format, guided-flow, and themed-picker migrations. It adds the knockout format, private saved draw/reservations and match-result audit, published bracket/events, authorized reveal/winner/undo operations, and bracket-validated individual awards. Existing team and free-for-all games are retained.

The migration has not been applied to the hosted database by the coding agent. Unit checks cover routing, finishing places, reveal deduplication/invalidation, reserve/commit recovery, winner progression presentation, authorization gating, lifecycle cleanup, and award payloads. SQL and PL/pgSQL are syntax-checked; this is not a database execution check. Run the manual scenarios above after migration application. `supabase/tests/004_knockout_tournament.sql` provides rollback-only transactional checks for a disposable LAN, including 2–64-player bracket boundaries, byes, direct authorization/grants, idempotency, stale edits, undo, and award corrections. It has not been executed against a database. No local database harness or automated browser run was introduced.

The HTML mockup remains a reference rather than a production dependency. Its local server and sample state are not evidence of application integration or persistence.
