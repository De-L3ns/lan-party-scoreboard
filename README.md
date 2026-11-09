# LAN // LOCAL

A LAN-party scoreboard for tracking individual points across free-for-all and team games.

## Follow the action

Open the scoreboard to see the live standings. The top three appear on a podium; everyone else stays in the player list. Select a game to view its participants, teams, draft progress, or results. No sign-in is needed to watch.

## Organize a LAN

Select **Admin** and sign in with your organizer account.

1. **Add players** — Open **Players** to add names, profile titles, and PNG avatars. Archive players who should no longer join new games.
2. **Create a game** — Select **New game**, choose free-for-all or team-based, and set whether the highest or lowest score/time wins.
3. **Choose participants** — For free-for-all, select the players directly. For team games, select players and the number of teams, then spin the wheel or use autoplay to fill the teams.
4. **Play** — Select **Start game** when everyone is ready. Participants and teams are locked once play starts.
5. **Record results** — Select **Enter result**, enter the scores and points to award, review the preview, then confirm. The leaderboard updates automatically.

Games support 2–64 players. Team games support 2–8 teams.

## Award and correct points

Game results and leaderboard points are entered separately. For timed games, enter results in seconds. Scores and points support up to two decimal places.

For team games, award the same points to each player, split a total pool, or assign custom points per player. Free-for-all games have a separate result and points award for each participant.

Use **Correct result** to fix an earlier award; the correction replaces that game's previous points. Use **Adjust points** for an individual bonus or penalty. **Score history** shows past changes and lets you reverse an adjustment.

## Start the next LAN

Select **New LAN** to archive the current event and start with zero points while keeping active players and their artwork. Organizers can revisit previous events using the session selector and download a report with **Export report**.

## Setup and development

- [Setup guide](docs/Setup.md) — local configuration, hosting, and development details.
- [Database setup](supabase/README.md) — Supabase migrations and organizer access.
- [Feature specification](docs/specs/001-mvp-leaderboard.md) — detailed requirements and acceptance checks.
