# 001 — MVP leaderboard

Status: MVP application source and SQL migration implemented; hosted migration and manual acceptance checks pending. Updated: 2026-11-08.

[002 — Guided game flow](002-guided-game-flow.md) supersedes the game-starting and navigation flow below. It also includes free-for-all games and required team naming before a team game starts. Other MVP requirements continue to apply.

This document consolidates the product direction discussed so far. “First implementation” means the first usable version with Supabase persistence, rather than the existing in-memory mockup. [Setup](../Setup.md) explains the technical direction. Requirements already expressed by the user are separated from proposed defaults and questions still to resolve.

Mockup iteration is paused. The retained prototype is a visual reference; this specification takes precedence where the prototype differs, particularly for top-three emphasis, admin-only drafting, game selection, and team assignment order.

## 1. Purpose and audience

Provide a small LAN-party scoreboard that tracks individual player points, creates temporary teams for each game, and lets an organizer distribute points from team results to players. Public viewers should understand the standings at a glance; organizers should be able to run the event without editing repository files.

The main display is a shared monitor or TV. Phones must still support reading standings and operating admin controls. The visual direction draws on mid-2000s PC games such as Call of Duty 2 and TrackMania Nations, using an original interface rather than copied game assets.

## 2. Established product requirements

### Access

- Anyone with the published URL can read the active scoreboard without signing in.
- Score entry and management actions require admin access through a passcode experience.
- Only admins can add/edit/archive players, manage their artwork and profile titles, or create/control a team draft. Public viewers can watch an authorized draft but cannot start, spin, pause, redraw, or change it.
- Production permissions must be enforced by Supabase, not by a JavaScript passcode comparison. The current `lanparty` demo credential is not a production credential.

### LAN sessions and roster

- There is one reusable public board and one active LAN session at a time.
- Players have individual point totals and a custom PNG supplied by the organizer. Player artwork is uploaded in the app and stored in Supabase.
- Give each player a compact card showing their portrait, name, points, and short personal titles or achievements, such as “Cannon fodder” or “Winner LAN Party 2023.” These are admin-maintained profile details, not titles automatically assigned from current standings.
- Resetting for another LAN archives the old session privately rather than deleting it or making it publicly browsable.
- Previous sessions are visible only to the admin. The public URL continues to show the active session.

### Games and teams

- Each played game has its own teams and team leaderboard. Teams do not form a permanent leaderboard across games.
- Teams are shuffled for each new game. Balance means player count, not skill ratings: team sizes differ by at most one.
- The admin must select a game before configuring or starting its team draft. Every draft and resulting team belongs to that game; there is no standalone public team builder in the MVP.
- The admin selects participating players and a team count. Players are selected randomly without replacement, with no manual reassignment.
- Assign one player per roll in a fixed repeating team order: A → B → C → … → A. With two teams, roll a player into A, then another into B, then another into A. Do not fill all of A before B, and do not randomize the destination team for each roll.
- Use a spinner to select and reveal each player, then add the selected player's card to the destination team's roster. Show which team receives the current pick. Do not show the complete assignment immediately.
- The public individual leaderboard remains separate from each game's team leaderboard. A team's score is not the sum of its members' overall individual points.

### Leaderboard hierarchy

- Make ranks 1, 2, and 3 stand out clearly. Give them a dedicated leading group or podium treatment, with first place the strongest emphasis; present the remaining ranks beneath it without duplicating the top-three entries.
- Keep the rest of the interface quiet: prioritize player names, ranks, points, and compact profile information. Remove redundant slogans, repeated statistics, oversized decorative headings, and unrelated status copy.
- Keep player cards compact even when highlighting leaders. Preserve prominent scores and readable personal titles on both the shared display and phones.

### Scoring

- An admin can enter results for a game that has already been played.
- The admin chooses how team results translate into individual awards, rather than relying on a fixed placement-to-points table.
- Show a preview of the exact affected players and their new totals before applying an award.
- Keep distribution flexible. The mockup currently demonstrates equal points per member, splitting a total pool, and custom amounts per player; these are the proposed initial production modes.

## 3. Proposed first-release behavior

The behavior below combines established requirements with proposed implementation defaults. Requirements in section 2 take precedence; open defaults are listed in section 7.

### Public screens

- Home: active LAN name, a clearly highlighted top three, remaining individual standings, and concise recent-game summaries. Use compact player cards with prominent points and short profile titles; artwork gets a fallback when missing or unavailable.
- Match report: game title/details, game-specific team rankings, roster snapshots, results, and whether individual awards have been applied.
- Draw view: the selected game's spinner and accumulating team rosters, suitable for presentation on the shared screen. Visitors see the current pick and committed assignments, while only admins see operational controls.
- Display loading, empty, failed-load, and stale/offline states. Never silently substitute mockup data when Supabase is unavailable.
- Receive committed updates from other devices and refetch authoritative standings. Display equal scores as ties; alphabetical ordering may stabilize the display but must not imply a competitive tiebreaker.

### Admin workflow

1. Unlock admin access and manage the roster: add/edit/archive players, maintain their personal titles/achievements, and upload/replace their PNGs. Archiving excludes a player from future selections while preserving existing game history.
2. Select an existing game or create and select a new one, then select participants and choose the team count. Disable draft setup/start until a game is selected. Only a game in the active LAN that has not started can accept a new draft. Support 2–64 participating players and 2–8 teams, with no empty teams.
3. Shuffle the selected player IDs and persist the private draw sequence before revealing it. Destination teams follow fixed round-robin order, starting with A. The admin spins one player at a time, or uses autoplay/pause. After a spin lands, commit that player's assignment and advance the next destination team. Persist progress so a refresh or second display does not reroll or repeat a pick; public viewers watch.
4. Allow a confirmed redraw before a game starts; lock membership once the game begins. Never edit an old game's teams to prepare the next game.
5. Record the played game's team results and individual award amounts separately. Preview allocations using the roster belonging to that game.
6. Confirm the result once. Save team results and player awards atomically. Reopening an awarded result allows a correction that replaces the earlier contribution, without awarding it twice.
7. Reset the LAN through an explicit confirmation. Archive the old session and create a fresh one atomically, retaining the player roster and artwork and starting individual totals at zero.

The prototype's public practice simulator is not part of the production MVP. All production drafts require admin authorization and a selected game. Switching games loads that game's saved draft or its own empty setup; it never carries assignments across games. Changing participants or team count after drafting begins requires a confirmed redraw before the game starts.

### Draft order and spinner behavior

- For two teams and five players, destination order is A, B, A, B, A; final sizes are A=3 and B=2. For three teams and seven players, order is A, B, C, A, B, C, A; final sizes are A=3, B=2, C=2. Extra players therefore go to the earliest teams in the cycle.
- Each spinner selects from the remaining players only. Keep the next player's identity hidden until the roll lands; then show their portrait, name, profile title, and destination team.
- Allow at most one roll in flight. Repeated clicks, request retries, or another admin tab must not assign another player for the same pick. Advance the destination only when the assignment is committed successfully.
- Pause autoplay after the current roll. If the tab is hidden or a connection fails before a pick is committed, preserve the pending pick and resume/reconcile from saved progress rather than selecting a replacement player.
- Reduced motion skips or shortens spinning without changing the selected player or team. Public updates expose revealed picks, not the private future draw sequence.

### Score rules and corrections

- Use up to two decimal places, calculated with fixed precision. Proposed baseline: higher numeric game scores rank ahead; racing times or lower-is-better results require a separate decision below.
- Equal-per-player gives the entered amount to every member. Split-pool divides the entered total over the game's team members. Custom allocation accepts an explicit amount for each member.
- Split allocations must sum to the entered pool exactly. The mockup assigns any remaining cents to the final member; retain this as the proposed deterministic rounding rule.
- Permit signed player adjustments, including penalties, with a reason. A separate adjustment does not rewrite a game's team result.
- Retain the original award and a traceable correction/reversal. Reject non-finite values and unsupported precision; enforce the same checks on the database side as in the preview.
- Repeated submissions must not duplicate an award. Conflicting edits from two admin tabs must prompt a reload/review rather than silently overwrite newer results.

### Artwork and presentation

- Accept PNG uploads; proposed initial maximum is 2 MiB. Preserve transparency and aspect ratio and fit artwork inside consistent portrait frames.
- Keep names and scores readable independently of the artwork. Players without artwork remain usable through a placeholder.
- Treat personal titles/achievements as compact text within player cards. Use a restrained achievement accent so profile details support rather than compete with rank and points.
- Provide responsive layouts, visible keyboard focus, semantic controls/tables/dialogs, and reduced-motion support. Autoplay must be pausable and preserve the same final teams when motion is reduced.

## 4. Data boundaries and interfaces

This is a conceptual model, not the final SQL schema.

| Concept | Responsibility |
| --- | --- |
| Player | Persistent identity, display name, artwork reference, personal titles/achievements, and archived status. Not a single lifetime point total. |
| LAN session | Active or archived event context; owns the individual scoreboard and games. |
| Game | Named played activity, lifecycle state, result details, and session reference. |
| Team and membership | Temporary game-specific grouping and a fixed record of participating player IDs. |
| Draw | Required game reference, selected participants, private shuffled player sequence, fixed team order, committed pick count/next team, pending roll, and whether membership is locked. |
| Score entry and allocation | Team result or individual award/adjustment, affected players, author, time, and correction relationship. |
| Admin authorization | Provisioned Auth user allowed to mutate data or inspect archived sessions. |

Public reads expose the active session's standings, games, teams, and published draw progress. They must not expose private archives or unrevealed assignments through direct API calls. A hidden UI card alone does not protect a pending reveal.

Admin operations include roster/image/title management, game creation, draw generation/reveal/redraw, result application/correction, individual adjustments, and session reset/archive access. Database-side draft operations must verify admin identity, a valid selected game in the active LAN, game lifecycle, and the current pick revision; hiding controls is not authorization. Multi-row operations use authorized transactions. Exact table names, RPC signatures, and subscription events will be specified with the database design.

Keep score history even when display names or artwork change. Whether past reports preserve historical names/images as snapshots, rather than showing current profile details, is an open decision. Public image files themselves are not made private when a session is archived.

## 5. Current implementation and release boundaries

The production application in `src/` implements public standings with a highlighted top three, player profile cards, game reports, admin sign-in and roster/image management, game-bound spinner drafts, result previews/corrections, individual adjustments/reversals, and private archive/report/reset workflows. Realtime revision notifications and a 15-second polling fallback refetch authoritative data. Configuration and domain rules have lightweight unit coverage; CI and manual Pages deployment remain in place.

`supabase/migrations/202611080001_mvp.sql` defines the schema, RLS/grants, admin enrollment boundary, private draw sequences, request deduplication, revisions, transactional RPCs, initial LAN, and Storage policies. It has not been applied to or runtime-validated against the hosted Supabase project by this implementation. No embedded database dependency or local database test harness was added, per the user's direction. [Supabase setup and the manual checklist](../../supabase/README.md) cover the remaining activation steps.

The user reports that external Supabase setup and GitHub Pages deployment are complete and working. This does not imply that the remaining database schema or feature permissions have been implemented.

The local, gitignored `mockup/` folder contains a front-end prototype with eight sample players, two sample games, public standings, match reports, a demo admin score desk, and a practice team simulator. It uses in-memory state, original SVG artwork placeholders, and no Supabase connection. Refreshing restores sample scores and clears simulator progress. Mockup source is local working material and will not be included in a fresh clone.

Existing mockup score logic covers equal/split/custom allocations and replacement of a game's award contribution. The revised mockup has a quieter card-based leaderboard, personal titles, and a spinning player-selection wheel. Its draw logic randomizes both players and destination slots and exposes a public practice draw; those behaviors must be replaced by the admin-only, game-bound, fixed-team-cycle rules in this specification. Its equal-sized leaderboard cards also need a stronger top-three treatment in production. The mockup has no automated tests; the UI has not been browser-tested at the user's request. Production verification remains part of the first implementation.

The implemented release targets real persistence, secure admin access, roster/artwork management, persisted games/draws, cross-device updates, and private reset archives once the migration is applied. It does not include player accounts, participant editing, skill balancing, manual team assignment, multiple simultaneous public LANs, automated game-server integrations, or offline write queues.

## 6. Acceptance scenarios

- A visitor opens the GitHub Pages URL on a shared display or phone and sees the same active standings without logging in.
- Ranks 1, 2, and 3 are visibly emphasized over the remaining leaderboard, with first place strongest. Each player appears once and has a compact card with name, portrait, points, and profile titles. A historic winner title remains independent of the current rank.
- A direct unauthenticated API request cannot mutate a player, result, draw, image, or session; an unrelated authenticated account cannot do so either.
- The admin adds a player with a PNG and the title “Cannon fodder,” refreshes, and sees the saved profile. A visitor cannot add a player or edit the title. Archiving the player does not erase a prior game.
- A visitor can watch the draft but cannot start, spin, pause, or redraw it through either the UI or a direct API call.
- Without a selected game, draft setup/start is disabled and a direct draft request is rejected. A started/completed game or a game from an archived LAN cannot receive a new draft.
- Drawing five players into two teams assigns them A, B, A, B, A, one spinner reveal at a time. No player is missing or duplicated, and no destination team is picked randomly.
- Drawing seven players into three teams assigns them A, B, C, A, B, C, A, ending with A=3, B=2, C=2. Repeated clicks or two concurrent tabs cannot advance the same pick twice.
- Switching from game A to game B never reuses game A's teams. Redrawing a not-yet-started game requires confirmation and does not affect another game's assignments.
- Refreshing or opening another display during a draw preserves progress; public API reads cannot reveal pending player/team assignments ahead of the presentation.
- The spinner lands on the player actually committed to the displayed destination team. Autoplay pause and reduced-motion preferences preserve the same player sequence and team order.
- Giving a four-player team 10 points each adds 10 to each member; splitting 10 over three members allocates 3.33, 3.33, and 3.34 under the proposed rounding rule.
- Saving or retrying the same result twice does not double points. A correction updates only that result's contribution and retains a record of the change.
- A failed transactional save leaves all affected totals unchanged and the editable form available for retry. Reconnecting refreshes stale data.
- Resetting creates a zero-score active session while retaining the roster. Archived results remain available to the admin and inaccessible to public queries.
- Published assets work beneath the GitHub Pages repository path; admin credentials and privileged Supabase keys are absent from published files.

## 7. Implementation defaults adopted for the first release

The following choices resolve the earlier open questions for this implementation. They are implementation defaults, rather than additional preferences attributed to the user.

- Team results are numeric with a per-game higher/lower-is-better option. Racing times use seconds with up to two decimals; formatted time strings are not a separate input mode.
- Team games and individual adjustments are in scope. A first-class free-for-all game mode is deferred.
- Drafts support 2–64 selected players and 2–8 nonempty teams. Fixed round-robin destinations give extra players to the earliest teams.
- Draft presentation is embedded in the selected game's screen and works on the shared display; a separate full-screen presentation mode is deferred.
- Archived LANs retain session profile snapshots. Game rosters snapshot names, titles, and image paths at draft preparation and remain unchanged by later profile edits. New artwork gets a new path, keeping old versions available.
- Admins supply the new LAN's name during reset and may download a JSON report of the selected session and audit records. This report does not replace a database/Storage backup.
- Equal, split-pool, and custom awards use two decimal places. The final member by pick order receives split remainders. Corrections require a reason and matching game/board revisions so stale previews cannot silently overwrite changes.
- PNG uploads are limited to 2 MiB, with up to five profile titles of 80 characters each. Admin sessions are tab-scoped, falling back to memory if browser storage is blocked.
