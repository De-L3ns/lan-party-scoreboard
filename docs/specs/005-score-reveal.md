# 005 — Score entry and leaderboard reveal

Status: Application source implemented; manual browser/projector acceptance checks pending. Updated: 2026-11-12.

The approved interaction reference is `mockup/score-reveal.html`: a simple score-entry form followed by a popup in which players slide up or down into their new leaderboard positions. This local, gitignored mockup is unavailable in a fresh clone; this document defines the feature independently of it. Its sample data and standalone save behavior are not production dependencies.

Requirements superseding the mockup: **show the awarded points and resulting totals directly, without counting numbers up or simulating addition. Row movement is always enabled; omit the animation toggle.**

This specification replaces the **Preview awards → Save results** interaction in [002 — Guided game flow](002-guided-game-flow.md) and the final-awards interaction in [004 — Knockout tournament](004-knockout-tournament.md). Scoring, bracket rules, authorization, corrections, and persistence from those specifications and [001 — MVP leaderboard](001-mvp-leaderboard.md) remain in effect unless explicitly changed below.

## 1. Purpose and flow

Make the effect of a completed game clear: who gained places, who dropped places, and where everyone stands afterward. Keep entering scores simple; show the movement after saving.

**Finish a game:**

**Active game → End game → Enter results and points → Save results → Leaderboard changes popup → Done → Updated scoreboard.**

**Correct an award:**

**Completed game → Correct result → Enter corrected awards and reason → Save results → Leaderboard changes popup → Done → Updated scoreboard.**

- Use one result-entry screen and one post-save popup. Remove the separate **Preview awards** submission and confirmation state.
- The popup opens only after the server confirms the save. It is not a preview or another confirmation step.
- The successful save completes a playing game, updates points, and makes the next game available under the existing lifecycle rules. Closing or replaying the popup has no effect on that saved outcome.
- Do not add a workflow stepper, highlight panels, largest-climber cards, celebratory headlines, sound, or confetti. Player movement is the presentation.

## 2. Score entry

- Keep the existing application shell and dedicated results route. Show the game name, format, relevant scoring direction, saved participants, and saved team names.
- Use compact labeled rows or groups. Show player names and existing avatars with the normal image fallback. Preserve readable long names and usable controls on phones and projectors.
- Enter the game result and leaderboard-points award separately. A race time or game score must not silently determine the points award.
- Preserve the existing optional note, required correction reason, numeric bounds, two-decimal precision, and validation messages. Do not introduce an automatic points schedule.
- Keep entry order stable while typing. Updating a result must not move the focused row or lose an input value.
- Do not show a live leaderboard, rank-change preview, or a second current/award/new-total table on the entry screen. Those results belong in the post-save popup.
- The primary action is **Save results**. Validate all required values before submitting; show specific errors next to the relevant input/group or in the existing form error area.
- Returning to the scoreboard without saving leaves the game and leaderboard unchanged. A failed save preserves the entered values for correction or retry.

Preserve the input rules for every format:

| Format | Result entry | Points entry |
| --- | --- | --- |
| Free-for-all | One editable result per participant, using the saved higher/lower ranking direction. | One individual award per participant. |
| Teams | One editable result per saved team. | Retain points per player, split total pool, and custom per-player award modes, with their existing allocation rules. |
| Knockout | Read-only bracket-derived finishing places, including ties. A champion must already be confirmed. | One points field per finishing rank, listing its players. Each listed player receives the full entered amount. Preserve the existing handling of mixed previous awards during a correction. |

The entry layout may adapt to the format; all three feed the same leaderboard-reveal component. Knockout finishing places and overall LAN leaderboard ranks are separate concepts.

## 3. Save boundary and reliable comparison

- Capture an immutable baseline for the exact board revision being submitted: session, game, score revision, all players currently included in that session's leaderboard, their identities and totals, and the game's previous awards when correcting a result.
- Capture the submitted allocation and correction values. Subsequent realtime updates must not mutate these snapshots or silently rebase an open form to a newer revision.
- Submit through the existing authorized `save_result` operation, including request deduplication, game score revision, board revision, and tournament revision where applicable. Keep the current transactional ledger and server-side validation.
- Disable repeated submission and conflicting navigation while the request is pending. Do not display a successful result, remove the active-game state, or start the reveal before acknowledgement.
- If the server rejects stale state, keep the inputs and explain that scores must be refreshed and reviewed before resubmission. Do not replace their revision silently and apply an award against an unreviewed baseline.
- A timeout with an unknown outcome follows the existing retry/reconciliation contract using the same request identity. A retry must not award points again or open duplicate popups for one result.
- After acknowledgement, construct the confirmed transition for this operation only. Use the captured baseline and the same allocation/correction calculations the server validates; retain the returned score-event ID as the local save identity.
- Do not build the after-state by comparing the baseline with an arbitrary later board refresh: another organizer's subsequent award or adjustment must not appear as movement caused by this game.
- Refresh the application board through its normal read path. A refresh failure after a confirmed save is a refresh error, not a failed save: keep the acknowledged outcome, show the connection feedback, and do not invite another award submission.
- Returning to the scoreboard and disposing the entry form must not dispose the newly opened reveal. Its owner and lifetime belong to the application, not the departing form.

The current `save_result` acknowledgement returns a score-event ID, not a before/after roster. Implementation must explicitly preserve the baseline and submitted allocations across the asynchronous save. The existing revision checks and allocation helpers allow a confirmed transition without a new server-side animation system. If implementation needs additional authoritative response data, add it through a new migration; never modify an already applied migration or infer unrelated changes from the latest board.

## 4. Leaderboard changes popup

### Content

- Open a modal over the scoreboard in the browser that saved the results. Use **Leaderboard changes** as its title and identify the game with a short subtitle.
- Show a single leaderboard list using the same player set and identity rules as the main scoreboard. Include nonparticipants: they can drop places even when their points do not change.
- Each row contains the player's rank, avatar, name, net point change, resulting total, and position change. Keep these two changes distinct: **+12 pts** is an award effect; **↑ 2** is a rank gain.
- Use an upward arrow and lime accent for a rank gain, a downward arrow and muted warm/red accent for a drop, and a dash for an unchanged rank. For a changed rank, show **#5 → #2** as compact supporting text.
- Show actual awarded/net points and final totals from the first visible frame. They remain static throughout the reveal. There is no count-up animation, changing-digit simulation, progress meter, or separate “Adding game points” stage.
- Retain the app's olive surfaces, cream text, lime accent, rectangular controls, saved PNGs, and fallback images. Do not copy the mockup's sample identities or replace the main scoreboard's podium.

### Sliding sequence

1. Mount each player row once, keyed by player ID, in its pre-save visual position. Its rank initially shows the pre-save rank; its points already show the confirmed resulting values.
2. Hold the old row order briefly, approximately 400–600 ms, so viewers can recognize it.
3. Slide rows vertically to their new sorted positions over approximately 1.5–2 seconds. Players gaining places travel upward; players dropping places travel downward. Unchanged visual positions remain stationary. Show the direction and old/new rank labels during this movement.
4. Once movement finishes, show final rank numbers and keep the final list visible until dismissed. Do not auto-close it or start another game.

- Animate the position of the actual player rows through visible intermediate coordinates. Replacing HTML with a sorted list, updating arrows, fading between states, or jumping directly to final transforms does not satisfy this requirement.
- Coordinate moving rows with appropriate stacking so they remain identifiable as they pass. Preserve their avatars, names, and values throughout the slide.
- Measure current row geometry; do not hard-code the eight-player mockup's dimensions. Keep layout correct after resizing, fullscreen changes, wrapped names, or a changed list length.
- Calculate final ordering before the animation starts. The animation presents the confirmed result; it never calculates or persists an outcome.

### Controls

- **Done** closes the popup and leaves the updated scoreboard visible. Allow dismissal during the animation; the already-saved points remain applied.
- **Replay** resets the rows to the same captured before-state, then repeats their movement to the same after-state. It makes no save request and does not derive another transition from current live scores. Disable replay while a run is active or safely cancel the prior run before restarting.
- Always animate the player movement on opening and replaying the popup. There is no **Animate movement** checkbox or saved motion preference for this presentation.
- As explicitly requested, a system reduced-motion setting or a legacy saved disabled preference must not silently skip this popup's slide. Users can dismiss it at any time with **Done** or Escape.
- Replaying must never cycle point digits. Only the player positions animate.

## 5. Ranking and point-change rules

- Use `rankPlayers` for the before and after leaderboard. Preserve descending total points, alphabetical ordering within equal totals, and dense/consecutive ranks: **1, 2, 3, 3, 4**, not **1, 2, 3, 3, 5**.
- Compute **position change = before rank − after rank**. A positive value is a gain; a negative value is a drop. Use actual list indices separately to calculate the travel distance of each row.
- Equal-ranked players can change visual row positions due to the deterministic tie ordering without gaining or losing a rank. Do not label an alphabetical row swap as a rank gain.
- Include the complete leaderboard, not just award recipients. A player with a zero award or no participation can still change rank.
- Use integer-cent calculations and the existing `allocate`, `previewAwards`, and formatting helpers. Preserve decimal awards, supported penalties/negative totals, and split-pool remainder behavior.
- For a first result, **after total = before total + new award**.
- For a correction, **after total = before total − previous award + replacement award**. Display the net difference in the popup, rather than presenting the replacement award as an additional award.
- If no ranks change, still show the resulting totals and point changes. Stationary rows are valid; do not invent movement or claim someone gained a place.

Examples:

| Case | Expected presentation |
| --- | --- |
| A player goes from rank 5 to rank 2. | Their row slides upward to the new list position; show **↑ 3** and **#5 → #2**. |
| A nonparticipant goes from rank 2 to rank 3. | Their points stay unchanged; show zero point change and **↓ 1**. |
| A player enters a tie for rank 3. | Show the dense shared rank and compute movement from rank numbers, not the number of rows passed. |
| A previous award of 15 is corrected to 25 when the current total is 100. | The new total is **110** and the net point change is **+10 pts**. |
| All players retain their ranks. | Show the confirmed totals and unchanged-position marks; no row movement is necessary. |

## 6. Local presentation, accessibility, and lifecycle

- The automatic popup is local to the browser performing the save. Existing realtime updates still refresh other devices normally. Do not automatically navigate public viewers, broadcast overlays, or replay historical reveals on page load/reconnect.
- Freeze the popup's comparison while it is open. New board updates can refresh the underlying scoreboard but must not retarget a running animation or change a replay's meaning. **Done** returns to the latest loaded scoreboard, which may include later results.
- Use an accessible named modal with focus moved inside, focus containment, keyboard-operable controls, Escape dismissal, and visible focus. Restore focus to the scoreboard heading or another sensible surviving control when the entry form no longer exists.
- Do not depend on color alone. Keep names, numeric totals, arrows, and before/after ranks readable. Announce one concise final result summary; do not announce animation frames or each digit.
- Keep screen-reader list order and position metadata consistent with the settled visual order. Replay resets the presentation without duplicating accessible rows.
- Support the full leaderboard and 2–64 game participants. On a phone or short window, allow the list to scroll within the popup while its title and dismissal controls remain reachable. Do not require all players to fit at once or drop players to fit the sample layout.
- Cancel animation frames, timers, resize observers/listeners, and pending presentation callbacks when closed, replaced, unmounted, signed out, or switched to another LAN. Late callbacks must not reopen a popup or touch disposed rows.
- Navigation, dialog closure, replay, image failures, and animation errors must never reverse a committed award or leave the application waiting for animation before it can use saved data. If animation fails, settle on the final list and keep **Done** usable.

## 7. Application integration

- Refactor both `src/features/admin/forms.js` and `src/features/knockout/awards.js` to submit validated awards directly, retaining all format-specific rules and correction reasons.
- Add a shared reveal view/controller under the leaderboard feature. Keep immutable transition calculation separate from DOM rendering, animation scheduling, and API access.
- Integrate save acknowledgement, route changes, refresh, and reveal ownership in `src/app.js`. Avoid opening the reveal through a generic form presenter that subsequently closes it as part of finishing the save.
- Preserve the existing page-form busy/error contract, dialog accessibility behavior, `createApi` deduplication, and server authorization. Presentation-only controls must not call mutation RPCs.
- Keep the main podium/list renderer and completed-game reports intact. This feature changes the results interaction and adds the post-save comparison.
- Do not introduce a UI framework, animation service, new persistent reveal table, or a cross-device event queue solely for this feature. Reuse the current application stack.
- At implementation time, update user-facing result-entry instructions in `README.md` and the relevant feature/domain documentation. Record database prerequisites accurately if a new migration is actually needed.

## 8. Acceptance and verification

1. **Simple entry:** Each game format has labeled result/award fields and one **Save results** action. There is no **Preview awards** submission, extra preview screen, or live leaderboard preview while typing.
2. **Confirmed save:** Saving a valid new result applies the awards once, completes the game, and opens the popup over the scoreboard. Neither the popup nor its animation appears while the save is pending or rejected.
3. **Visible movement:** Use a baseline where at least one player rises and one falls. Observe each row at the old position, at intermediate positions during the slide, and at the final position. Changing labels or observing only the final order is not sufficient verification.
4. **Static digits:** Final totals and net awards are correct on the popup's first visible frame and do not change while rows move, including during replay. There is no “adding points” simulation.
5. **Replay and dismissal:** Replay restores the same old order and repeats the slide without changing scores or sending another save. Done/Escape during a run closes it, stops callbacks, and preserves the committed totals.
6. **Always-on movement regression:** Test with system reduced motion enabled and disabled and a legacy saved disabled preference. Opening and replaying the popup always produces visible intermediate positions. There is no animation toggle; Done/Escape remains available throughout.
7. **All formats:** Verify individual awards, all three team award modes including split remainders, and knockout awards shared per finishing rank. Bracket-derived places remain read-only and independent of LAN rank changes.
8. **Corrections:** Correct an existing award with a reason. Verify the replacement formula and net point difference, and confirm that the before/after ranking reflects only this correction. Knockout bracket outcomes stay locked.
9. **Ties and unaffected players:** Check dense ties, joining/leaving a tie, nonparticipants dropping places, zero awards, decimal/negative awards, and a save with no rank changes. There are no missing/duplicate players or false rank-gain labels.
10. **Failures and retries:** Invalid inputs and stale revisions preserve editable values. A rejected request shows no success popup. Double-clicks and acknowledgement-loss retries apply one award and generate one automatic reveal for the acknowledged save. A failed post-save refresh does not resubmit points.
11. **Concurrent updates:** Update scores in a second organizer tab before submission and after acknowledgement. Stale submissions are rejected; later changes refresh the underlying board without being attributed to this result or changing the frozen replay.
12. **Refetch and navigation:** Realtime refetches, reconnects, report navigation, and browser refresh do not replay old reveals. Session changes, sign-out, and disposal clean up active presentation work. Other viewers receive normal standings updates without forced navigation.
13. **Scale and access:** Check phone, laptop, and projector layouts with 2, 8, and 64 participants, long names, missing pictures, scrolling, resizing mid-slide, and keyboard-only use. Popup controls remain reachable and focus returns sensibly.

Add focused automated checks for transition calculations, correction deltas, ties, nonparticipants, acknowledgement/retry ordering, intermediate animation positions, replay, always-on movement, static point labels, and cancellation. Run the existing application checks during implementation. Browser/projector verification remains manual unless the user requests automated browser testing; do not introduce a local database harness just for this feature.

## 9. Activation

The application source implements this interaction using the existing `save_result` RPC. No new database migration is required. Build with Node 24 and deploy through the existing workflow when ready; this implementation has not deployed the app or changed the hosted database.

Automated unit checks cover direct entry across all formats, award corrections and allocation rules, frozen baselines, dense ties and nonparticipants, acknowledgement/retry ordering, intermediate row positions, static point labels, measured layout, replay, always-on movement, dismissal, and cleanup. Production build verification is part of implementation. These checks do not constitute browser/projector verification; run the manual acceptance scenarios above against the configured application.

Broadcast reveals, persisted replay history, automatic award schedules, audio, and changes to the underlying scoring model are outside this feature's scope.
