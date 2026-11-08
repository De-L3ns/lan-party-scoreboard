# Database source

`migrations/` is reserved for versioned SQL schema, grants, RLS policies, and authorized RPC functions. `tests/` is reserved for permission and transaction checks once the schema exists.

No tables, policies, buckets, or remote project are created by this scaffold. Design the schema from `docs/specs/001-mvp-leaderboard.md`, then add migrations before connecting feature queries. Never use an unprotected example table as the production scoreboard.

Supabase CLI configuration and commands will be added with the first migration. Do not store database credentials or production data in this folder.
