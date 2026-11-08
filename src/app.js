import { createLeaderboardView } from './features/leaderboard/view.js';

export function mountApp(root, { config, supabase }) {
  root.innerHTML = `
    <a class="skip-link" href="#main">Skip to leaderboard</a>
    <div class="app-shell">
      <header class="app-header">
        <a class="wordmark" href="#leaderboard" aria-label="LAN Local home">LAN<span>//</span>LOCAL</a>
        <span class="header-caption">THE LOCAL ARENA</span>
      </header>
      <main id="main">
        <section class="page-heading" aria-labelledby="page-title">
          <p class="eyebrow">LAN PARTY SCOREBOARD</p>
          <h1 id="page-title">GOOD GAMES.<br><span>GREAT COMPANY.</span></h1>
          <p>Individual standings. Fresh teams. Friendly rivalry.</p>
        </section>
        <section class="setup-status" aria-labelledby="setup-title">
          <h2 id="setup-title"></h2>
          <p id="setup-description"></p>
        </section>
        <div id="leaderboard"></div>
      </main>
      <footer>LAN // LOCAL <span>APPLICATION FOUNDATION</span></footer>
    </div>`;

  const title = root.querySelector('#setup-title');
  const description = root.querySelector('#setup-description');
  if (config.issues.length > 0) {
    title.textContent = 'Configuration needs attention';
    description.textContent = config.issues.join(' ');
  } else if (!supabase) {
    title.textContent = 'Supabase setup pending';
    description.textContent = 'Add your project URL and publishable key to .env.local, then restart the development server.';
  } else {
    title.textContent = 'Supabase client configured';
    description.textContent = 'The application foundation is ready. Database connectivity and leaderboard data are not loaded in this scaffold.';
  }

  root.querySelector('#leaderboard').append(createLeaderboardView());
}
