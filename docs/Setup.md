# Setup

Status: MVP source and migration implemented; hosted migration application and manual acceptance checks pending. Updated: 2026-11-08.

This document explains the technology choices for the first usable release. Product behavior is defined in [001 — MVP leaderboard](specs/001-mvp-leaderboard.md). Proposed choices below describe the target; they do not imply that the repository already implements them.

## Goals behind the choices

The application should be small, easy to maintain, inexpensive to operate, and publishable on GitHub Pages. It serves one active LAN party, a modest player roster, a shared display, and visitors checking scores on their phones. A separate application server would add deployment and maintenance work without a current product need.

## Current mockup versus target stack

| Responsibility | Current repository | Target for the first implementation | Rationale |
| --- | --- | --- | --- |
| Interface | HTML, CSS, vanilla JavaScript ES modules | Keep HTML, CSS, and vanilla JavaScript | The screens and interactions do not require a UI framework. |
| Development/build | Vite/npm application scaffold; mockup uses a static HTTP server | Vite, npm, and a committed lockfile | A small toolchain provides module bundling, dependency pinning, local development, and reproducible deployment. |
| Hosting | Local application; CI and manual Pages workflow defined | GitHub Pages, deployed with GitHub Actions | Matches the chosen hosting destination and serves the built static assets. |
| Persistence | In-memory sample data | Supabase Postgres and its Data API | Relational data suits players, game-specific teams, memberships, and score history. |
| Client integration | Supabase client factory and public configuration; no feature queries | `@supabase/supabase-js` | One client covers database calls, authentication, image storage, and live subscriptions. |
| Admin identity | Public demo passcode checked in JavaScript | Supabase Auth | Supabase validates credentials and supplies an identity the database can authorize. |
| Authorization | Demo UI gating | Postgres grants and Row Level Security (RLS) | Permissions must hold when someone calls the API directly, outside the interface. |
| Complex writes | Local score and draw helpers | Transactional Postgres functions exposed as RPCs | Multi-player awards, result corrections, draws, and resets must succeed together. |
| Player artwork | Original SVG placeholders | PNG files in Supabase Storage | Admins can maintain player artwork without committing files or redeploying the site. |
| Live updates | Updates in the current tab only | Supabase Realtime plus authoritative refetches | A shared display should reflect an admin's changes from another device. |
| Verification | Production environment tests; no automated tests for the mockup | Add domain logic tests and database permission/transaction checks as implemented | Production scoring, randomization, and authorization deserve checks beyond visual review. |

The production application includes Vite/npm tooling, public configuration, Supabase reads and authorized RPC calls, a compact leaderboard with highlighted leaders, admin workflows, game-specific draft presentation, and archive reporting. Node 24 is specified in `.nvmrc`. Vite and `@supabase/supabase-js` are pinned through the lockfile. CI runs lightweight unit checks and builds the app; deployment remains manually triggered. The local prototype remains gitignored and independent of production code.

Use `.env.local` for local public settings, starting from `.env.example`. Only valid paired project URL/publishable-key settings initialize the client. The app then calls `read_board` and subscribes to `board_updates`. Admin sessions use tab-scoped storage, falling back to memory if browser storage is unavailable. Future pick sequences and request deduplication records are kept in an unexposed `scoreboard_private` schema. Apply the migration and enroll the organizer account as described in [database setup](../supabase/README.md).

## Runtime and data flow

### Knockout tournament activation

Knockout source is included with spec 004. Apply `supabase/migrations/202611110001_knockout_tournament.sql` after the four existing migrations, then rebuild/deploy using Node 24 and the existing Pages workflow. See [database setup](../supabase/README.md) for migration order, the added RPCs, and the rollback-only acceptance script. The coding agent has not applied the migration to the hosted database or performed browser/database acceptance checks. The standalone HTML mockup remains independent of the app.

GitHub Pages serves the application to the browser. The browser reads public scoreboard data from Supabase and displays player images from Storage. Admins authenticate through Supabase Auth, then submit authorized changes to the Data API or database RPCs. Postgres remains the source of truth; Realtime notifications trigger fresh reads after committed changes.

GitHub Pages hosts static HTML, CSS, and JavaScript and can serve build output; it does not provide the application with a private server runtime. Project sites also use a repository path, so assets, navigation, and Vite's base path must work under `/lan-party-scoreboard/`. Use in-page/hash navigation initially to avoid server-side routing requirements. See [GitHub Pages hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) and [Vite's GitHub Pages deployment guidance](https://vite.dev/guide/static-deploy).

## Credentials and admin access

Visitors need no account. The intended admin experience is a passcode field. The proposed implementation maps that passcode to the password of one manually provisioned Supabase Auth user, using a configured email address. The email is not a secret; the password is. Use a strong password rather than a short numeric PIN. Keep self-service signup and anonymous sign-in disabled.

Authorize the specific provisioned admin user ID, rather than granting edits to every authenticated user. Store that authorization in administrator-controlled database configuration; users must not be able to grant themselves admin access. Add an explicit sign-out action and use tab-scoped session storage as the proposed default.

The browser receives the project URL and a **publishable key**. It must never receive the admin password in source/configuration, a database password, or a secret/service-role key. Build-time variables are visible in the resulting JavaScript; putting a value in GitHub Actions secrets does not keep it private once bundled. RLS and grants protect public reads, admin writes, and admin-only archives. RPC execution must have explicit grants and authorization checks too. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [password authentication](https://supabase.com/docs/guides/auth/passwords), and [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Why Postgres functions and score history

An award can affect several players at once. Updating each total through separate browser requests could leave a half-applied result. A database transaction can record the award and its allocations together, with request deduplication and revision checks to prevent duplicate or stale submissions.

The proposed model retains score entries and corrections instead of treating the displayed total as the only record. That makes awards explainable and allows an edited result to replace its earlier contribution. The existing JavaScript helpers remain useful for previews, but the database must validate and calculate authoritative values independently.

A custom REST server, ORM, and Supabase Edge Functions are not needed for the initial architecture. Reconsider that choice if later integrations need secrets or processing that does not fit database functions.

## Supabase free-tier preparation

Use one Free project initially, in an available region near the event's users. Keep schema changes, policies, and functions as versioned SQL migrations in the repository when implementation starts.

1. Create the project and keep the database password in a password manager.
2. Record its project URL and publishable key for future frontend configuration. Do not add privileged credentials to the application.
3. Enable email/password Auth, manually provision the organizer account, record its user ID for authorization, and disable new signups and anonymous sign-in. Configure the intended site URL and allowed development/production redirects where needed by Auth flows.
4. Create the application schema through reviewed migrations, with RLS, least-privilege grants, and admin-checked RPCs. Do not expose real data before permission checks are in place.
5. Create a public `player-images` bucket for PNG artwork, with admin-only write policies. Proposed upload limit: 2 MiB per image. Public bucket files remain accessible by URL even when a LAN session is archived; player images are intentionally public roster assets. See [Storage bucket access](https://supabase.com/docs/guides/storage/buckets/fundamentals).
6. Enable Realtime only for the tables needed for scoreboard and draw updates, respecting their read policies. Refetch on reconnect, and show a stale/offline state if fresh data cannot be loaded. See [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).
7. Check project availability before each LAN and retain a database export before material maintenance or reset operations.

As checked on 2026-11-08, the Free plan lists 500 MB database size, 1 GB file storage, 5 GB egress, and 50,000 monthly active users, with two active projects and pausing after one week of inactivity. These quotas are expected to suit this small event, but artwork downloads and idle-project pausing need attention. Recheck [Supabase pricing](https://supabase.com/pricing) before launch; this document is not a guarantee of future quotas or availability.

## Repository and maintenance conventions

- Keep UI rendering, Supabase access, and pure scoring/draw logic in separate modules.
- Commit SQL migrations, dependency versions, and deployment configuration alongside the source.
- Define public configuration in an example environment file; exclude local environment files and credentials.
- Use local CSS effects and original assets for the retro game style. The mockup currently loads Google Fonts; a local font bundle or system fallbacks are reasonable production defaults.
- Test permission boundaries and transactional writes before publishing. Use a separate dataset for development rather than experimenting against a live LAN.

The user has completed external Supabase project and Pages setup. The MVP migration has not been applied remotely by this implementation. No embedded database dependency or local database test harness was added, per the user's direction; run the manual acceptance checklist before using live scores.
