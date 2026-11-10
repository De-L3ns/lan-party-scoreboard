# Lander & Fabn's LAN Party

A LAN-party scoreboard for tracking individual points across free-for-all and team games.

## Follow the action

Open the scoreboard to see the live standings. The top three appear on a podium; everyone else stays in the player list. Select a game to view its participants, teams, draft progress, or results. No sign-in is needed to watch.

## Organize a LAN

Select **Admin** and sign in with your organizer account.

1. **Add players** — Open **Admin → Players** to add names, profile titles, and PNG avatars.
2. **Start a game** — Select **Start new game** on the scoreboard. Choose the participants, game format, and ranking on one screen.
3. **Assign and name teams** — Choose the **Call of Duty 2** rifle or **TrackMania** car picker, then spin or use **Auto draw**. Changing themes keeps the assignments. Once everyone is assigned, select **Name the teams**, enter their names, and click **Start game**. Free-for-all skips the team steps.
4. **Play** — The scoreboard shows an **Active game** tile. Click it to see the players and named teams. Participants and teams are locked during play.
5. **Record results** — In the active game, select **End game**, enter the results and point awards, then **Preview awards → Save results**. The updated scoreboard is ready for another game.

Games support 2–64 players. Team games support 2–8 teams.

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
