export function createLeaderboardView() {
  const section = document.createElement('section');
  section.className = 'leaderboard';
  section.setAttribute('aria-labelledby', 'leaderboard-title');
  section.innerHTML = `
    <div class="section-heading">
      <h2 id="leaderboard-title">Individual standings</h2>
      <span>AWAITING FIRST SESSION</span>
    </div>
    <div class="empty-state">
      <p class="empty-mark" aria-hidden="true">01</p>
      <h3>The arena is getting ready.</h3>
      <p>Players and scores will appear here once the leaderboard is connected.</p>
    </div>`;
  return section;
}
