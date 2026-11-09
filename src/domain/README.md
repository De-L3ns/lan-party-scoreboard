# Domain logic

`scoring.js` handles fixed-precision award previews and tied rankings. `draft.js` validates participant counts for both game formats, team draft sizes, and the fixed round-robin destination order. The database independently validates and applies authoritative values. Keep DOM, environment configuration, and Supabase access outside this folder.

The ignored mockup is a reference, not a dependency of the production application.
