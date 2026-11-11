# Lander & Fabn's LAN Party

A LAN-party scoreboard for tracking individual points across free-for-all, team games, and 1v1 knockout tournaments.

## Follow the action

Open the scoreboard to see the live standings. The top three appear on a podium; everyone else stays in the player list. Equal points share a rank, with consecutive ranks after ties (1, 2, 3, 3, 4, 4). Select a game to view its participants, teams, draft progress, or results. No sign-in is needed to watch.

## Organize a LAN

Select **Admin** and sign in with your organizer account.

1. **Add players** — Open **Admin → Players** to add names, profile titles, and PNG avatars.
2. **Start a game** — Select **Start new game** on the scoreboard. Choose the participants, game format, and ranking on one screen.
3. **Prepare the game** — For team games, choose the **Call of Duty 2** rifle or **TrackMania** car picker, then spin or use **Auto draw**. Changing themes keeps the assignments. Once everyone is assigned, select **Name the teams**, enter their names, and click **Start game**. Free-for-all skips the team steps. For **Knockout Tournament**, select **Draw tournament**, reveal the opening matchups, review the bracket, and select **Start game**.
4. **Play** — The scoreboard shows an **Active game** tile. Click it to see the players, named teams, or tournament bracket. Participants and assignments are locked during play. In a tournament, select a ready match, choose its winner, and **Confirm winner**. A versus reveal shows the next pairing as soon as both opponents are known.
5. **Record results** — In the active game, select **End game**, enter the results and point awards, then **Preview awards → Save results**. The updated scoreboard is ready for another game.

Games support 2–64 players. Team games support 2–8 teams.

Knockout tournaments use a random single-elimination bracket with automatic opening-round byes when needed. Versus reveals show saved player pictures, names, and profile titles. **Show versus** replays a known matchup without changing results. Admins can **Undo last result** before final awards are saved. After the final, **End game** opens one points field per bracket-derived finishing rank, with its players listed; each player at that rank receives the entered amount; points are applied only through **Preview awards → Save results**. Completed match outcomes are locked, while point awards remain correctable.

The picker includes spinning and impact sounds. Use **Sound on/off** to mute or enable them. Larger rosters use a scrollable arena; the picker brings the selected player into view.

On wider screens, **Assignments below / Assignments beside** switches the team-roster layout. Your choice is remembered for the tab.

## Award and correct points

Game results and leaderboard points are entered separately. For timed games, enter results in seconds. Scores and points support up to two decimal places.

For team games, award the same points to each player, split a total pool, or assign custom points per player. Free-for-all games have a separate result and points award for each participant.

Open a completed game's report and use **Correct result** to fix an earlier award. The correction replaces that game's previous points. The **Admin** menu contains **Adjust points** for bonuses or penalties and **Score history** for reviewing changes and reversing adjustments.

## Start the next LAN

Select **New LAN** to archive the current event and start with zero points while keeping active players and their artwork. Organizers can revisit previous events using the session selector and download a report with **Export report**.

## Setup and development

- [Setup guide](docs/Setup.md) — local configuration, hosting, and development details.
- [Database setup](supabase/README.md) — Supabase migrations and organizer access.
- [Feature specification](docs/specs/001-mvp-leaderboard.md) — detailed requirements and acceptance checks.
- [002 — Guided game flow](docs/specs/002-guided-game-flow.md) — approved projector workflow for starting games, naming teams, and entering results.
- [003 — Themed player picker](docs/specs/003-themed-player-picker.md) — rifle and TrackMania picker modes, animations, effects, and sound.
- [004 — Knockout tournament](docs/specs/004-knockout-tournament.md) — 1v1 brackets, versus reveals, winner progression, and awards per finishing rank; migration application and manual acceptance checks pending.
