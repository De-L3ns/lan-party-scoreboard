# 002 — Guided game flow

Status: Application source and SQL migration implemented; hosted migration application and manual browser acceptance checks pending. Updated: 2026-11-09.

The approved HTML showcase is the visual reference for this feature, with the copy reductions below. The local reference is `mockup/game-flow.html`; it is gitignored and unavailable in a fresh clone. This document captures the approved behavior independently of that file.

This specification replaces the game-starting and game-navigation flow in [001 — MVP leaderboard](001-mvp-leaderboard.md). Existing scoring, authorization, archive, and draft rules continue to apply unless explicitly changed here.

[003 — Themed player picker](003-themed-player-picker.md) specifies the approved replacement for the **Assign teams** wheel presentation, controls, effects, and sound. The guided flow and naming/completion behavior defined here remain in place.

[005 — Score entry and leaderboard reveal](005-score-reveal.md) replaces the **Preview awards → Save results** interaction below with direct saving followed by a popup with animated rank changes. Application source is implemented; browser/projector checks are pending. The remaining guided flow stays in place.

## 1. Purpose

Make starting and finishing a game easy for an admin operating the scoreboard on a projector while everyone watches. Each screen should make the players, current action, and next step clear without explanatory paragraphs.

The scoreboard is the home screen. Starting a game is a short setup sequence; the app returns to the scoreboard once the game is active.

## 2. Approved flow

**Team game:**

Scoreboard → **Start new game** → Select players → Assign teams → Name teams → **Start game** → Scoreboard with an **Active game** tile.

**Free-for-all:**

Scoreboard → **Start new game** → Select players → **Start game** → Scoreboard with an **Active game** tile.

**Finish either format:**

**Active game** tile → Game in progress and player rosters → **End game** → Enter results → **Preview awards** → **Save results** → Updated scoreboard.

There is no additional ready screen, countdown, or separate start confirmation after team naming.

## 3. Screens and actions

### Main scoreboard

- Preserve the individual standings: larger avatars and a gold, silver, and bronze podium for the top three; remaining players in the list. Do not display the words “Gold,” “Silver,” or “Bronze.” Preserve tied ranks.
- Give admins a prominent **Start new game** button on the main screen. Visitors see the standings without organizer controls.
- Support one active game at a time in the active LAN. Disable **Start new game** while a game is active; the existing game remains accessible through its tile.
- Show the **Active game** tile only when a game is active. Include the game name, **In progress**, named teams or free-for-all format, and a compact participant summary.
- Make the whole tile clickable. It opens the active game's rosters and controls.
- When there is no active game, omit the tile. Do not replace it with an idle status, “Between games,” “Ready for the next round?”, or an instructional placeholder panel.
- Completed games remain accessible as reports, separate from the active-game tile.

### Select players

- **Start new game** opens the player selection screen directly.
- Show all eligible, non-archived players with clearly visible avatars and names. Selected and unselected states must be obvious from the projector and usable by keyboard.
- Initially select all eligible players. Allow individual selection and **Select all / Deselect all**.
- Show one selected-player count.
- Keep game setup on this screen: game name/selection, free-for-all or team-based format, result ranking, and team count where applicable. Do not introduce a separate game-selection landing screen.
- Support 2–64 participants. Team games support 2–8 nonempty teams.
- For team games, the primary action is **Assign teams**. For free-for-all, it is **Start game**, which starts the game and returns to the scoreboard.
- Disable progression when the participant selection or required game details are invalid. Show a short, specific validation message where needed.
- Returning to the scoreboard before starting must not create an active-game tile or award points.

### Assign teams

- Make the picker and accumulating team rosters the main content.
- Select one remaining player per spin and assign them in the existing fixed cycle: Team A → Team B → next team → Team A.
- Show the destination team, selected player's avatar and name, and assignment progress. Players appear in their teams as assignments are committed.
- Provide **Spin for a player** and **Auto draw / Pause auto draw**. Allow only one spin at a time.
- Every selected player must appear exactly once. Team sizes differ by at most one.
- During assignment, use temporary labels such as Team A and Team B.
- Once all players are assigned, replace the spin action with **Name the teams**. Do not automatically advance before viewers can see the final assignment.
- Returning to this screen from team naming preserves the assignment. Changing participants or team count requires an explicit redraw; it must not silently reshuffle players.

### Name teams

- Show every team's assigned players, with avatars and names, alongside a team-name field.
- Require a name for every team. Placeholder suggestions do not count as entered names; temporary Team A/B labels do not satisfy the requirement.
- Names must contain 1–40 characters after trimming and be distinct within the game, ignoring case. Show a concise validation error for missing or duplicate names.
- Use **Start game** as the primary action. Save the team names and start the game together, then return to the main scoreboard after success.
- If saving fails, preserve the names and assignments on the naming screen so the admin can retry.
- Display the saved team names consistently in the active-game tile, game view, result entry, and completed report. Names belong to this game, not permanent teams.

### Active game

- Clicking the **Active game** tile opens a dedicated game view.
- Show the game name, useful game details, and a clear **In progress** status.
- For team games, show named teams with all assigned players and their avatars. For free-for-all, show the individual participants without team labels.
- Lock participants, assignments, and team names once the game starts.
- Give admins a prominent **End game** action. Visitors may view the rosters but cannot end the game or enter results.
- Provide a simple return to the scoreboard. Returning does not end the game or remove its tile.

### End game and results

- **End game** opens result entry for that game, using its saved participants and team names.
- Enter game results and leaderboard points separately. Preserve higher/lower result ranking, decimal precision, team award rules, and individual free-for-all awards.
- **Preview awards** shows each affected player's current points, award, and resulting total.
- **Save results** applies the reviewed awards, completes the game, removes its active-game tile, and returns to the updated scoreboard. Starting another game becomes available again.
- Opening result entry alone does not complete the game or award points. Returning without saving preserves the active game; it can be reopened to finish results.
- Failed saves preserve the editable results and active game. Retrying must not award points twice.
- Keep existing result correction and score history behavior available through completed-game reports and organizer tools.

## 4. Presentation and copy

- Prioritize names, avatars, team assignments, results, and the current action. Keep these readable across the room and on smaller screens.
- Keep one prominent primary action per step. Secondary actions, such as back and autoplay, should be visually quieter.
- During setup, a compact progress indicator may show **Players → Team assignment → Team names**. Hide irrelevant steps for free-for-all and remove the setup indicator on the scoreboard and active-game view.
- Remove “Between games,” “Game night,” “Tonight’s LAN,” idle-status cards, repeated counts, decorative slogans, and paragraphs explaining an obvious button or next screen.
- Do not add persistent footer instructions such as “Next: back to the scoreboard” or “Everyone can follow the draw live.” Labels and layout should communicate the flow.
- Keep text that helps a decision or resolves a problem: field labels, game/map details, ranking direction, selection count, draw progress, validation errors, and connection/save failures.
- Use short labels such as **Highest score wins** and **Lowest score/time wins**.
- Keep roster management, adjustments, score history, exports, and LAN reset in organizer controls outside the primary game flow.
- Preserve visible keyboard focus, accessible selected states, image fallbacks, and reduced-motion support.

## 5. Saved state and access

- Persist setup, committed assignments, team names, active-game state, and results. Refreshing must not reroll a draft, lose a started game, or require re-entering saved team names.
- Existing live updates keep standings, revealed assignments, and active-game information consistent across devices. Automatic screen navigation on other devices is outside this feature.
- Only admins can start games, operate the picker, name teams, end games, or save results. Enforce these restrictions on the server as well as in the interface.
- Enforce the single-active-game rule when concurrent admin tabs attempt to start games. A rejected attempt must leave the existing active game intact.
- Preserve the existing protections against stale edits, duplicate picks, duplicate awards, and public access to unrevealed draw information or archived LANs.

## 6. Acceptance scenarios

1. An admin opens the scoreboard and sees **Start new game**. There is no idle-game status or instructional placeholder card.
2. Clicking **Start new game** immediately shows the eligible players with visible avatars, names, and selection states. Game setup is available on that same screen.
3. Assigning five selected players to two teams reveals one player at a time in A/B/A/B/A order. No player is missing or duplicated.
4. After the final assignment, **Name the teams** opens the naming screen with the final rosters intact. Returning to the picker does not redraw them.
5. Blank, whitespace-only, or duplicate team names prevent starting. Valid names allow **Start game** to return to the scoreboard with an **Active game** tile.
6. The tile displays the saved team names and **In progress**. Clicking it shows every participant and an admin-only **End game** button.
7. Returning from the active-game view to the scoreboard leaves the game active. Refreshing preserves the same teams, names, and tile.
8. **End game** opens results for the correct game. Leaving without saving changes no scores and keeps the game available through its tile.
9. Previewing and saving results updates individual totals once, completes the game, removes the active tile, and enables starting another game.
10. A failed start or result save preserves the relevant inputs. A retry cannot produce a second active game or duplicate awards.
11. A free-for-all game follows selection → start → scoreboard, skipping team assignment and naming. Its active-game view and result entry show individual players.
12. Public viewers can see standings and active-game rosters but cannot operate organizer actions, including through direct requests.
13. Projector and phone layouts retain legible names, avatars, controls, and validation feedback. Reduced motion preserves the actual draw outcome.

## 7. Scope

This feature changes game setup, team naming, active-game navigation, and the route to result entry. It preserves the existing individual scoring and LAN archive model. Player accounts, skill balancing, manual reassignment, countdowns, game-server control, and additional presentation modes are outside its scope.

## 8. Activation and verification

Apply `supabase/migrations/202611090002_guided_game_flow.sql` after the MVP and game-formats migrations. It adds transactional setup, required team names when starting team games, and a single-active-game check serialized by the LAN lock. Existing historical games are retained. Result entry completes only a started game; corrections of completed games remain available.

The migration has not been applied remotely by the coding agent. No local database harness was introduced. Run the acceptance scenarios above against a disposable LAN after applying it; browser verification is left to the user as requested.
