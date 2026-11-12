# 003 — Themed player picker

Status: Application source and SQL migration implemented; hosted migration application and manual browser/speaker acceptance checks pending. Updated: 2026-11-10.

The approved visual and interaction reference is the standalone showcase at `mockup/gun-picker.html`, including both modes, larger artwork, impact effects, and spinning audio. The production picker uses a larger arena and only a sound on/off toggle, following the subsequent visual review. That file is local, gitignored working material; this specification captures the requirements independently of it. Production uses its own bundled artwork, rendering, and audio modules.

This feature replaces the wheel presentation in the **Assign teams** step of [002 — Guided game flow](002-guided-game-flow.md). Game setup, team naming, the active-game tile, result entry, and the existing server-authoritative draw rules remain in place.

## 1. Purpose

Turn the team draw into a shared moment on the projector. Players watch a rifle or race car spin around their avatars, settle on someone, and reveal that person's team through a short themed animation.

The presentation must clearly identify the chosen player and destination team without changing how a draw is decided.

## 2. Modes and controls

Provide two picker modes, selectable on the team-assignment screen:

| Mode | Centerpiece | Selection sequence | Primary action |
| --- | --- | --- | --- |
| **Call of Duty 2** | COD 2–style rifle from the approved showcase | Spin → lock onto an avatar → fire → reveal assignment | **Spin & fire** |
| **TrackMania** | Classic Nations Forever–style stadium car: white and green, open wheels, exposed cockpit, and rear wing | Spin → line up with an avatar → accelerate into it → reveal assignment | **Spin & race** |

- Default new team draws to the rifle mode. The mode is a presentation choice, independent of the game's name or free-for-all/team format; selecting TrackMania does not convert a team game to free-for-all.
- Only admins can change the shared mode, start a spin, or operate autoplay.
- Allow changing mode before the first pick and between completed picks. Preserve all participants, assignments, the next destination team, and the remaining draw sequence.
- Disable mode changes while a pick is reserved or animating. Pause autoplay when changing modes.
- Retain **Auto draw / Pause auto draw**. Pausing lets the current pick finish and prevents another from starting.
- Retain the existing confirmed redraw flow when changing participants or team count. Do not copy the showcase's immediate **Reset** behavior into production.
- Provide **Sound on/off** as a local playback control, available to viewers as well as admins. Do not include a separate test-sound button. They must not change shared game state.

## 3. Layout and artwork

- Arrange the game's participating players around a central picker, with prominent avatars and legible names. Use saved game-roster artwork and image fallbacks, not sample players or replacement military portraits.
- Keep up to 20 players in one evenly spaced circle. Balance larger groups across staggered rings by their circumference, reserving space for each avatar, two-line name, and team badge. Cards must stay separated and inside the arena at every supported roster size.
- Place typical rosters farther inward, using the saved space for larger portraits. Offset groups divisible by four between the cardinal directions to avoid crowded stacks at the top, bottom, and sides. Measure centerpiece clearance against the actual avatar and name rectangles, including badges and rifle recoil.
- Keep player positions stable during a pick. Assigned players remain identifiable in their positions, visibly dimmed and marked with their team; they cannot be selected again.
- Display the destination team and one compact assignment-progress count. Default to a full-width picker with team rosters underneath. On wider screens, provide an **Assignments below / Assignments beside** toggle and remember that local display preference within the tab. Small screens always stack the rosters below. Disable layout changes during a pick animation; changing layout must not change assignments or shared game state.
- Fit the complete picker, including every player and the draw controls, within the available viewport without scrolling. Account for the page header and picker controls, then uniformly scale the arena to the remaining width and height, including dense rosters. Recalculate on resize/fullscreen and keep the existing spacing and target geometry. Team rosters below may extend the page; the picker itself must never need scrolling or scroll to a chosen player.
- On laptop and wider screens, use a compact brand header, put setup navigation and the page heading on one row, and combine mode/sound controls with assignment progress on another. Reclaim vertical space for the arena before reducing its scale.
- Size the rifle and car from the actual picker dimensions, not the browser width alone. The full centerpiece must remain visible and clear of avatars and names during rotation. Account for rifle recoil when calculating clearance.
- The car may reach the chosen avatar during its deliberate collision animation; this must not cause general overlap while spinning.
- Support the existing 2–64 participants and 2–8 teams. Do not assume the showcase's eight-player roster. Adapt dense layouts so participants and the chosen player remain readable and inspectable without changing eligibility or odds.
- Keep the app's existing dark military palette, lime accents, party title, and restrained interface copy.
- Do not add the “M1 GARAND” label, a weapon-information footer, idle instructions, slogans, or duplicate selected-player boxes.
- Bundle artwork with the app. The showcase's inline SVG approach is suitable; production must not depend on the gitignored mockup, hotlinked images, or external audio downloads at runtime.

## 4. Rifle sequence

1. Reserve the next pick through the existing authorized draw operation.
2. Rotate the rifle through several turns, then decelerate toward the reserved player's avatar. The rifle's barrel must point at that player when it stops.
3. Highlight the targeted avatar with a clear reticle and a short locked-on pause.
4. Fire with a brief muzzle flash, tracer, recoil, and cartridge-ejection effect.
5. Show a short stylized red blood-splatter burst behind the chosen avatar. Keep the avatar and name readable; the effect must fade and be removed.
6. Once the assignment is confirmed, mark the player as assigned and add them to the destination team's roster.

Retain the approved rifle appearance and effects. Do not substitute a generic arrow, replace the rifle with a different theme, or leave the last selected player's portrait in the spinner area after completion.

## 5. TrackMania sequence

1. Reserve the next pick through the same draw operation used by the rifle.
2. Spin the stadium car in the center, decelerating until its nose faces the reserved player's avatar.
3. Briefly line up, then accelerate outward along that direction. The car must visibly drive into the chosen avatar rather than remain stationary while only an impact effect plays.
4. Show tyre marks, exhaust/smoke, collision sparks, and a brief avatar bump. Use these racing effects in this mode; keep the rifle's gunfire and blood splatter exclusive to rifle mode.
5. Once the assignment is confirmed, mark the player as assigned and add them to the destination team's roster.
6. Fade/reset the car to the center before enabling the next pick. Its outward position, tyre marks, smoke, and impact effects must not carry into the next animation.

Keep the approved classic white-and-green stadium-car silhouette recognizable, including its exposed wheels, cockpit, and rear wing.

## 6. Sound

### Playback and controls

- Sound is enabled by default as a preference, but audio begins only after a browser-permitted user action. Initialize/resume audio directly from the first **Spin**, **Auto draw**, or sound-on interaction; do not require a separate sound-toggle click before it works.
- **Sound on/off** must clearly communicate the current preference. Muting immediately silences spinning and impact effects; it must not stop the draw.
- Switching sound on may play a short mode-specific confirmation without choosing a player or changing assignments.
- Keep an explicit mute choice across mode changes, successive picks, and game navigation within the current tab. Sound preference is local, not a shared admin setting.
- Resume a suspended audio context when permitted. If playback cannot start, show a short visible message with switching sound off and on as the retry action. Audio failure must not fail or delay the assignment indefinitely.
- Use clearly audible levels with controlled output gain and limiting. Do not rely on barely audible effects or compensate with uncontrolled clipping.

### Mode-specific audio

- **Rifle:** a mechanical whirr during rotation, clicks as the pointer passes candidates, and a gunshot when the shot lands. The spinning sound slows with the visual rotation and stops when the target locks.
- **TrackMania:** an engine sound during rotation that follows the slowing spinner, followed by an accelerating rev during the outward drive and an impact sound at the collision.
- Start and stop sounds with their corresponding animation phases. Do not play a gunshot or collision at the start of a spin, leave a spinning loop running after lock-on, or overlap audio from previous picks.
- Stop audio when the tab is hidden, the picker is left, a mode is changed, or the controller is disposed. If an interrupted pick resumes, resume only the relevant sound phase.

## 7. Production draw integrity

The showcase chooses players locally for demonstration. Production must continue using the database's private reserved sequence and fixed destination order.

- Obtain the next player and destination through `begin_roll`; animate toward that reserved player. Never use local randomness to choose a different outcome or choose a player based on where an uncontrolled animation stops.
- Preserve the fixed team cycle: A → B → C → … → A. Each selected player is assigned once, team sizes differ by at most one, and extra players go to the earliest teams in the cycle.
- Allow one pick in flight. Repeated clicks, mode changes, autoplay callbacks, or concurrent admin tabs must not reserve or commit extra players.
- Keep **Spin & fire / Spin & race**, mode changes, and setup navigation unavailable while the pick is in flight; keep the autoplay pause and local sound controls usable.
- Align the centerpiece with the reserved player before the final impact. Coordinate the final effect with a successful `commit_roll` acknowledgement. Do not present a definitive successful selection, dim the player as assigned, or update team membership until the server confirms the assignment.
- If committing fails, stop autoplay and sounds, retain the pending player, and offer a concise retry/resume action. Do not select a replacement player or award points.
- Refreshing, navigating back, or reconnecting must use saved progress. A pending pick resumes/reconciles to the same player and team; committed picks must not be assigned or celebrated again merely because data refetched.
- Store the picker mode on the game, using validated values such as `rifle` and `trackmania`, with `rifle` as the default for existing games. Mode updates must be authorized, revision-checked, and rejected during a pending pick. They must not redraw teams or change scoring.
- Public viewers see the saved mode, revealed assignments, and draft progress. They may animate generically while a pick is pending and finish toward the player once that assignment is published. Never expose the private pending target or future sequence just to synchronize the animation.
- Exact animation-frame and audio synchronization across devices is not required. Every device must agree on player identity, destination team, mode, and committed progress.

## 8. Completion, accessibility, and recovery

- After the final pick, stop all animation, autoplay, and audio; remove temporary effects and collapse the picker.
- Expand the completed team rosters and offer **Name the teams**, continuing feature 002. Do not automatically advance, leave a single-player reveal box, or keep a completed spinner consuming half the screen.
- Returning from team naming preserves the assignments and completed overview.
- Free-for-all continues to skip team assignment entirely; this feature does not introduce a draft into its start flow.
- As explicitly requested, an organizer starting **Spin & fire**, **Spin & race**, or **Auto draw** opts into the full picker presentation: the normal 4.2-second rotation, lock-on pause, drive where applicable, and impact effects must not be skipped by a system reduced-motion preference. Scope this override to that active organizer pick and clear it on completion, cancellation, or disposal.
- Passive viewer presentations continue to respect reduced-motion preferences: skip or substantially shorten rotation and suppress muzzle flashes, recoil, splatter bursts, collision movement, and avatar shaking. Preserve the exact reserved player, team order, and confirmation rules.
- Spinning audio may be omitted when rotation is skipped. Final sounds still follow the local sound preference; reduced motion is not an instruction to force sound on or off.
- Keep keyboard-operable controls, visible focus, accessible mode states, readable name fallbacks, and one concise live announcement per committed assignment. Do not announce every frame or tracking reticle change.
- Recalculate layout when resized or entering fullscreen. Rotation must still align with the correct avatar and the car's travel distance must reach that same player.
- Dispose of animation handles, audio sources, scheduled callbacks, and temporary effect elements when leaving the view. Background tabs must not keep making audible picks or accumulate a backlog of autoplay actions.

## 9. Acceptance scenarios

1. An admin opens a team draw and sees the rifle mode, real participant avatars, destination team, progress, and **Spin & fire**. A visitor sees the same shared mode and revealed progress without draft controls.
2. A rifle pick rotates and slows, locks its barrel onto the reserved avatar, then fires with recoil, muzzle flash, and a fading splatter. Exactly that player is committed to the displayed team.
3. Switching to TrackMania changes the centerpiece, action label, effects, and sounds while preserving every existing assignment and the next destination team.
4. A TrackMania pick rotates and lines up, then visibly drives into the reserved avatar with smoke, tyre marks, and sparks. The car returns to the center before the next pick.
5. Five players and two teams finish A/B/A/B/A; seven players and three teams finish A/B/C/A/B/C/A in either mode. No player is duplicated, skipped, or eligible again after assignment.
6. Double-clicking spin, using two admin tabs, or attempting a mode change during a reserved pick cannot create another assignment or change the pending outcome.
7. The first spin produces audio after the initiating user action. Both modes have audible spinning and impact sounds; spinner pitch/click cadence follows deceleration and ends at lock-on.
8. The sound toggle works independently in both modes, with no separate test button. Muting during a spin silences it immediately, remains muted after switching modes, and leaves assignment behavior intact. A blocked audio context shows a retry message while the draw continues.
9. Pause autoplay during a spin: the current confirmed pick finishes and no next pick starts. Hide the tab or leave the picker: sounds stop and no unseen autoplay picks accumulate.
10. Interrupt a pick before commitment, refresh, and resume it. The same player and team are used. Repeated live refetches do not replay already committed shots/collisions.
11. After the final pick, the picker and effects disappear, completed teams occupy the available width, and **Name the teams** is immediately usable. Returning from naming does not restore a stale player box.
12. On a projector, phone, and short browser window, the rifle remains fully visible throughout rotation/recoil; names and avatars are not obscured by it. In TrackMania, overlap occurs only for the intentional collision.
13. Test small rosters, more than eight players, and the 64-player limit. Every participant remains represented and eligible until assigned, with correct targeting and readable identity.
14. With reduced motion, both modes reach the same confirmed outcomes without long spins or flashing impact effects. Missing artwork and unavailable audio do not block the draw.
15. Reloading the game preserves its saved picker mode, participants, and assignments. Direct unauthorized mode/draw requests are rejected. Free-for-all, game starting, result awards/corrections, and LAN archives retain their existing behavior.

## 10. Implementation and verification boundaries

- Replace/refactor the production team-picker renderer and its animation lifecycle; integrate with the existing draft controller rather than introducing a separate local draft engine.
- Keep layout/artwork, audio, effects, and outcome calculation separate enough to cancel and verify independently. Preserve current request deduplication, revision checks, image fallback handling, and server-side authorization.
- Version any game-mode field and authorized update operation in a new Supabase migration. Do not edit already applied migrations. Update setup instructions with its prerequisites when implementation is ready.
- Add focused verification for target-angle/travel geometry, 2–64-player eligibility, mode changes without redraws, commit retries, animation/audio cleanup, mute/unlock behavior, and completion. Preserve existing scoring and draft tests.
- Browser and speaker verification are manual unless the user requests automated browser testing. Do not introduce headless browser runs or a local database harness based solely on this specification.
- Game-server integration, new scoring rules, skill balancing, manual reassignment, additional picker themes, and changes to the rest of the guided flow are outside this feature.

## 11. Activation

Apply `supabase/migrations/202611100001_themed_picker.sql` after the MVP, game-format, and guided-flow migrations. It adds the saved picker mode and authorized, revision-checked `set_picker_mode` operation. Existing games default to the rifle; mode changes leave private draw sequences and assignments intact.

The migration has not been run against the hosted database by the coding agent. No browser or speaker verification or local database harness was introduced. Automated checks cover the existing scoring rules plus picker geometry, lifecycle/commit ordering, mode changes, cancellation, audio startup, and cleanup. Use the acceptance scenarios above for manual testing after applying the migration.
