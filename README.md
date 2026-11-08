# LAN // LOCAL

A lightweight LAN-party scoreboard with individual points, randomly balanced teams per game, and admin-managed results. The application foundation uses HTML/CSS/JavaScript, Vite, and a Supabase client, targeting GitHub Pages.

## Application setup

Use Node 24 (see `.nvmrc`). If you use nvm:

```sh
nvm install
nvm use
npm ci
```

Copy `.env.example` to `.env.local` and fill in your Supabase project URL and **publishable** key. `VITE_ADMIN_EMAIL` is the public login identifier for the future admin interface; do not put the admin password in an environment variable. All `VITE_` values are public in the browser build.

```sh
npm run dev
```

Open the local URL printed by Vite. The app can start without Supabase settings and displays a setup notice. Configured settings initialize the client, but this scaffold does not yet query a database, authenticate admins, or implement scores.

```sh
npm test
npm run build
npm run preview
```

The build writes `dist/`, with relative asset paths for the GitHub Pages repository URL. CI runs production configuration tests and builds the app; the ignored mockup has no tests.

## Folder structure

```text
.github/workflows/  CI and manually triggered GitHub Pages deployment
docs/              Setup notes and numbered feature specifications
public/            Static application assets copied into the build
src/
  main.js          Browser entry point
  app.js           Application shell
  config/          Public environment configuration
  domain/          Pure production scoring and team rules, when implemented
  features/        Feature modules, starting with the leaderboard empty view
  lib/             Shared Supabase client
  styles/          Design tokens and shared styles
supabase/
  migrations/      Versioned SQL, RLS policies, and RPCs, when implemented
  tests/           Database permission and transaction checks, when implemented
tests/unit/        Production logic tests
mockup/            Local prototype, gitignored
```

## GitHub Pages

Once the repository is pushed, select **GitHub Actions** as the Pages source in repository settings. Add `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and optionally `VITE_ADMIN_EMAIL` as repository Actions variables. Run **Deploy to GitHub Pages** manually when ready to publish. No deployment is performed by local setup or by the CI workflow.

## Documentation

- [Setup](docs/Setup.md): stack choices and rationale, hosting, security, and Supabase free-tier preparation.
- [001 — MVP leaderboard](docs/specs/001-mvp-leaderboard.md): first implementation specification, acceptance scenarios, and open decisions.

## Local mockup

The prototype lives in `mockup/`. This folder is gitignored and will not be present in a fresh clone. Continue prototype experiments there, independently of the production foundation in `src/`.

To preview the local mockup, run from the repository root:

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory mockup
```

Open http://localhost:8000. Demo admin passcode: `lanparty`. Sample scores and practice draws last until refresh.

The mockup has no automated tests. Additional prototype instructions are in `mockup/README.md` locally.
