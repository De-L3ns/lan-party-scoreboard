# 001 — MVP leaderboard

Status: working draft, not an implementation checklist. Updated: 2026-11-08.

This document consolidates the product direction discussed so far. “First implementation” means the first usable version with Supabase persistence, rather than the existing in-memory mockup. [Setup](../Setup.md) explains the technical direction. Requirements already expressed by the user are separated from proposed defaults and questions still to resolve.

## 1. Purpose and audience

Provide a small LAN-party scoreboard that tracks individual player points, creates temporary teams for each game, and lets an organizer distribute points from team results to players. Public viewers should understand the standings at a glance; organizers should be able to run the event without editing repository files.

The main display is a shared monitor or TV. Phones must still support reading standings and operating admin controls. The visual direction draws on mid-2000s PC games such as Call of Duty 2 and TrackMania Nations, using an original interface rather than copied game assets.

## 2. Established product requirements

### Access

- Anyone with the published URL can read the active scoreboard without signing in.
- Score entry and management actions require admin access through a passcode experience.
- Production permissions must be enforced by Supabase, not by a JavaScript passcode comparison. The current `lanparty` demo credential is not a production credential.

### LAN sessions and roster

- There is one reusable public board and one active LAN session at a time.
- Players have individual point totals and a custom PNG supplied by the organizer. Player artwork is uploaded in the app and stored in Supabase.
- Resetting for another LAN archives the old session privately rather than deleting it or making it publicly browsable.
- Previous sessions are visible only to the admin. The public URL continues to show the active session.

### Games and teams

- Each played game has its own teams and team leaderboard. Teams do not form a permanent leaderboard across games.
- Teams are shuffled for each new game. Balance means player count, not skill ratings: team sizes differ by at most one.
- The organizer selects participating players and a team count. Team membership is assigned randomly, with no manual reassignment.
- The draw is an entertaining reveal: each player's artwork appears and the player is assigned to a team one by one. Do not show the complete assignment immediately.
- The public individual leaderboard remains separate from each game's team leaderboard. A team's score is not the sum of its members' overall individual points.

### Scoring

- An admin can enter results for a game that has already been played.
- The admin chooses how team results translate into individual awards, rather than relying on a fixed placement-to-points table.
- Show a preview of the exact affected players and their new totals before applying an award.
- Keep distribution flexible. The mockup currently demonstrates equal points per member, splitting a total pool, and custom amounts per player; these are the proposed initial production modes.

## 3. Proposed first-release behavior

These defaults make the initial release concrete but remain open to revision as this specification develops.

### Public screens

- Home: active LAN name, individual standings, a top-three presentation, and recent games. Use player artwork with a fallback if an image is missing or fails to load.
- Match report: game title/details, game-specific team rankings, roster snapshots, results, and whether individual awards have been applied.
- Draw view: the current game's staged player reveal and accumulating team rosters, suitable for presentation on the shared screen.
- Display loading, empty, failed-load, and stale/offline states. Never silently substitute mockup data when Supabase is unavailable.
- Receive committed updates from other devices and refetch authoritative standings. Display equal scores as ties; alphabetical ordering may stabilize the display but must not imply a competitive tiebreaker.

### Admin workflow

1. Unlock admin access and manage the roster: add/edit/archive players and upload/replace their PNGs. Archiving excludes a player from future selections while preserving existing game history.
2. Create a game, select participants, and choose the team count. Keep at least two teams, with no empty teams. The simulator currently offers two to four teams; the production maximum is still open.
3. Generate and persist a complete balanced draw before revealing it. Save reveal progress so a refresh or second screen does not produce a different assignment. The admin controls reveal-next, autoplay, and pause; public viewers watch.
4. Allow a confirmed redraw before a game starts; lock membership once the game begins. Never edit an old game's teams to prepare the next game.
5. Record the played game's team results and individual award amounts separately. Preview allocations using the roster belonging to that game.
6. Confirm the result once. Save team results and player awards atomically. Reopening an awarded result allows a correction that replaces the earlier contribution, without awarding it twice.
7. Reset the LAN through an explicit confirmation. Archive the old session and create a fresh one atomically, retaining the player roster and artwork and starting individual totals at zero.

The practice simulator remains separate from real games and scores. It may stay publicly accessible as a sandbox; starting a persisted game draw is admin-only.

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
- Provide responsive layouts, visible keyboard focus, semantic controls/tables/dialogs, and reduced-motion support. Autoplay must be pausable and preserve the same final teams when motion is reduced.

## 4. Data boundaries and interfaces

This is a conceptual model, not the final SQL schema.

| Concept | Responsibility |
| --- | --- |
| Player | Persistent identity, display name, artwork reference, archived status. Not a single lifetime point total. |
| LAN session | Active or archived event context; owns the individual scoreboard and games. |
| Game | Named played activity, lifecycle state, result details, and session reference. |
| Team and membership | Temporary game-specific grouping and a fixed record of participating player IDs. |
| Draw | Random assignment, reveal order, revealed count, and whether membership is locked. |
| Score entry and allocation | Team result or individual award/adjustment, affected players, author, time, and correction relationship. |
| Admin authorization | Provisioned Auth user allowed to mutate data or inspect archived sessions. |

Public reads expose the active session's standings, games, teams, and published draw progress. They must not expose private archives or unrevealed assignments through direct API calls. A hidden UI card alone does not protect a pending reveal.

Admin operations include roster/image management, game creation, draw generation/reveal/redraw, result application/correction, individual adjustments, and session reset/archive access. Multi-row operations use authorized transactions. Exact table names, RPC signatures, and subscription events will be specified with the database design.

Keep score history even when display names or artwork change. Whether past reports preserve historical names/images as snapshots, rather than showing current profile details, is an open decision. Public image files themselves are not made private when a session is archived.

## 5. Current implementation and release boundaries

The production application has a Vite/vanilla JavaScript foundation in `src/`, a public configuration module, a shared Supabase client, a minimal empty leaderboard screen, and production configuration tests. CI and a manual GitHub Pages deployment workflow are defined. No Supabase schema, feature queries, or production admin/score workflows have been implemented yet.

The local, gitignored `mockup/` folder contains a front-end prototype with eight sample players, two sample games, public standings, match reports, a demo admin score desk, and a practice team simulator. It uses in-memory state, original SVG artwork placeholders, and no Supabase connection. Refreshing restores sample scores and clears simulator progress. Mockup source is local working material and will not be included in a fresh clone.

Existing score logic covers equal/split/custom allocations and replacement of a game's award contribution. Draw logic randomizes assignments and reveal order, keeps sizes balanced, and supports manual reveal or autoplay/pause. The mockup has no automated tests; the UI has not been browser-tested at the user's request. Production verification remains part of the first implementation.

The first usable release adds real persistence, secure admin access, roster/artwork management, persisted games/draws, cross-device updates, and private reset archives. It does not include player accounts, participant editing, skill balancing, manual team assignment, multiple simultaneous public LANs, automated game-server integrations, or offline write queues.

## 6. Acceptance scenarios

- A visitor opens the GitHub Pages URL on a shared display or phone and sees the same active standings without logging in.
- A direct unauthenticated API request cannot mutate a player, result, draw, image, or session; an unrelated authenticated account cannot do so either.
- The admin creates a player with a PNG, refreshes, and sees the saved player and image. Archiving the player does not erase a prior game.
- Drawing seven players into three teams produces sizes 3/2/2 in some random order, with no missing or duplicate player. Reveals occur individually and finish with the saved assignment.
- Refreshing or opening another display during a draw preserves progress; public API reads cannot reveal pending player/team assignments ahead of the presentation.
- Giving a four-player team 10 points each adds 10 to each member; splitting 10 over three members allocates 3.33, 3.33, and 3.34 under the proposed rounding rule.
- Saving or retrying the same result twice does not double points. A correction updates only that result's contribution and retains a record of the change.
- A failed transactional save leaves all affected totals unchanged and the editable form available for retry. Reconnecting refreshes stale data.
- Resetting creates a zero-score active session while retaining the roster. Archived results remain available to the admin and inaccessible to public queries.
- Published assets work beneath the GitHub Pages repository path; admin credentials and privileged Supabase keys are absent from published files.

## 7. Questions to settle before the corresponding implementation

- Are all team results higher-is-better numbers, or must v1 support times and lower-is-better rankings for games such as TrackMania?
- Should individual/free-for-all games be a first-class mode, or is the initial release limited to team games plus individual point adjustments?
- What is the maximum expected player count and team count? The present simulator's two-to-four-team limit is a mockup choice.
- Does a completed draw need a separate full-screen presentation, or is the embedded arena sufficient?
- Should old reports preserve names/artwork exactly as they were played? How should archived LANs be labeled and exported for backup?
- Confirm the proposed three award modes, decimal/rounding behavior, admin session lifetime, and upload limit before making them database constraints.

Resolve these questions incrementally; this draft records the starting specification rather than treating unanswered questions as approved decisions.
