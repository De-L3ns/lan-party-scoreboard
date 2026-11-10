# Domain logic

`scoring.js` handles fixed-precision award previews and tied rankings. `draft.js` validates participant counts for both game formats, team draft sizes, and the fixed round-robin destination order. The database independently validates and applies authoritative values. Keep DOM, environment configuration, and Supabase access outside this folder.

The ignored mockup is a reference, not a dependency of the production application.

`game-flow.js` resolves lifecycle screens, detects setup changes that require a confirmed redraw, and validates team names. Starting and naming games is also validated transactionally in the database.

`picker.js` calculates stable avatar slots, rotation endpoints, artwork clearance, and car travel for 2–64 participants. These are presentation calculations: they never choose the next player or destination team.
