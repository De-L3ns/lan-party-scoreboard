import { renderLeaderboard } from './features/leaderboard/view.js';
import { renderGames, renderTeams, statusLabel, formatLabel } from './features/games/view.js';
import { GameSetup, TeamNames } from './features/games/setup.js';
import { DraftController } from './features/teams/controller.js';
import { createAdminForms } from './features/admin/forms.js';
import { activeGame, gameScreen } from './domain/game-flow.js';
import { createApi } from './lib/api.js';
import { createDialog } from './lib/dialog.js';
import { createPageForm } from './lib/page-form.js';
import { escapeHtml as h } from './lib/html.js';

const readRoute = () => {
  const hash = location.hash.slice(1);
  const params = new URLSearchParams(hash);
  return { id: params.get('game'), step: params.get('step') || '', newGame: hash === 'new-game' };
};

export function mountApp(root, { config, supabase }) {
  root.innerHTML = `<a class="skip-link" href="#main">Skip to main content</a><div class="app-shell">
    <header class="app-header"><a class="wordmark" href="#main" data-action="scoreboard" aria-label="Lander &amp; Fabn's LAN Party"><span class="wordmark-host">Lander &amp; Fabn's</span><span class="wordmark-title">LAN <span>Party</span></span></a><span class="session-name"></span>
      <button class="button" data-action="login">Admin</button>
      <details class="admin-menu" hidden><summary class="button">Admin</summary><div class="admin-menu-content"><div class="admin-actions">
        <button class="button" data-action="players">Players</button><button class="button" data-action="adjust">Adjust points</button><button class="button" data-action="history">Score history</button><button class="button danger" data-action="reset">New LAN</button>
      </div><div class="archive-controls"><label>LAN session<select id="session-select"></select></label><button class="button" data-action="export">Export report</button></div><button class="button" data-action="logout">Sign out</button></div></details>
    </header>
    <main id="main" tabindex="-1"><div class="connection-notice" role="status" hidden><span class="connection-text"></span><button class="button" data-action="refresh">Refresh</button></div><p class="app-message" role="alert" hidden></p>
      <div id="home-view"><div class="page-heading"><h1>Leaderboard</h1><button class="button primary start-new-game" data-action="start-new-game" hidden>Start new game <span aria-hidden="true">＋</span></button></div>
        <div class="dashboard"><section aria-label="Individual standings"><div id="leaderboard"><p class="empty-state">Loading standings…</p></div></section><aside id="games-sidebar" aria-label="Games"><div id="game-list"></div></aside></div>
      </div>
      <section id="game-view" hidden aria-labelledby="flow-title"><div class="flow-toolbar"><button class="button" data-action="scoreboard">← Scoreboard</button><nav id="setup-progress" aria-label="Game setup" hidden></nav></div>
        <div class="flow-heading"><div><h1 id="flow-title"></h1><p class="game-description muted"></p></div><span class="game-status status-label"></span></div><div id="flow-content"></div>
      </section>
    </main></div>`;
  const $ = (selector) => root.querySelector(selector);
  let board = null;
  let selectedSession = null;
  let route = readRoute();
  let workspaceKey;
  let draw;
  let setup;
  let names;
  let resultPage;
  let stale = false;
  let commandBusy = false;
  let fetchId = 0;
  let refreshTimer;
  let messageTimer;
  let latestFetch = Promise.resolve();
  const dialog = createDialog();
  const api = supabase ? createApi(supabase) : null;
  const mutable = () => Boolean(board?.is_admin && board.session.active && !stale && navigator.onLine && !commandBusy);
  const currentGame = () => board?.games.find((game) => game.id === route.id);
  const workspaceBusy = () => Boolean(draw?.navigationLocked || setup?.busy || names?.busy || resultPage?.busy);

  function notify(message, error = false) {
    clearTimeout(messageTimer);
    $('.app-message').textContent = message;
    $('.app-message').hidden = !message;
    $('.app-message').classList.toggle('error', error);
    if (message && !error) messageTimer = setTimeout(() => { $('.app-message').hidden = true; }, 4000);
  }
  function connection(message) { $('.connection-text').textContent = message; $('.connection-notice').hidden = !message; }
  function resetWorkspace() {
    draw?.dispose(); setup?.dispose(); names?.dispose(); resultPage?.dispose();
    draw = null; setup = null; names = null; resultPage = null; workspaceKey = null;
  }
  function writeRoute() {
    const hash = route.newGame ? '#new-game' : route.id ? `#game=${encodeURIComponent(route.id)}${route.step ? `&step=${route.step}` : ''}` : '';
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  }
  function selectGame(id, step = '') {
    if (route.id !== id || route.step !== step || route.newGame) resetWorkspace();
    route = { id, step, newGame: false }; writeRoute();
  }
  function selectSession(id) { selectedSession = id; }
  function focusPage() { $('#main').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function renderProgress(format, screen) {
    const steps = format === 'ffa' ? ['players'] : ['players', 'draw', 'names'];
    const index = steps.indexOf(screen);
    $('#setup-progress').hidden = index < 0;
    $('#setup-progress').innerHTML = steps.map((step, i) => `<span class="flow-step ${i === index ? 'current' : i < index ? 'done' : ''}" ${i === index ? 'aria-current="step"' : ''}><span>${i < index ? '✓' : i + 1}</span>${({ players: 'Players', draw: 'Team assignment', names: 'Team names' })[step]}</span>`).join('');
  }

  function renderWorkspace(game, screen) {
    const canWrite = mutable();
    const canSetup = canWrite && !activeGame(board.games);
    const key = `${board.session.id}:${game?.id || 'new'}:${screen}`;
    const changed = workspaceKey !== key;
    if (changed) { resetWorkspace(); workspaceKey = key; $('#flow-content').replaceChildren(); }
    $('#flow-title').textContent = ({ players: 'Who’s playing?', draw: 'Assign teams', names: 'Name the teams', results: `Results: ${game?.name}` })[screen] || game?.name;
    $('.game-description').textContent = game ? (['players', 'draw', 'names'].includes(screen) ? (screen === 'players' ? '' : game.name) : [formatLabel(game), game.details, game.direction === 'lower' ? 'Lowest score/time wins' : 'Highest score wins'].filter(Boolean).join(' · ')) : '';
    $('.game-status').textContent = ['playing', 'report'].includes(screen) ? statusLabel(game) : '';
    renderProgress(game?.format, screen);
    const content = $('#flow-content');
    if (screen === 'players') {
      if (!setup) setup = new GameSetup(content, { game, board, api, canWrite: canSetup, onFormatChange: (format) => renderProgress(format, screen), onSubmit: async (input) => {
        if (!mutable() || activeGame(board.games)) throw new Error('Finish the active game before starting another.');
        const result = await api.mutate('setup_game', input);
        selectGame(result.status === 'playing' ? null : result.id, result.status === 'playing' ? '' : 'draw');
        await refresh(); focusPage();
      } });
      else setup.update(board, canSetup);
    } else if (screen === 'draw') {
      if (changed) {
        content.innerHTML = '<div class="draft-layout"><div id="game-draft"></div><div id="team-rosters" class="team-grid"></div></div><div class="flow-actions"><button class="button" data-action="edit-setup">Edit players / teams</button><button class="button primary" data-action="name-teams" hidden>Name the teams →</button></div>';
        draw = new DraftController($('#game-draft'), { api, refresh, notify, onStateChange: () => {
          for (const action of ['name-teams', 'edit-setup']) {
            const button = $(`[data-action=${action}]`);
            if (button) button.disabled = !mutable() || Boolean(activeGame(board.games)) || Boolean(draw?.navigationLocked);
          }
        } });
      }
      draw.update(game, canSetup); renderTeams($('#team-rosters'), game, api);
      $('[data-action=name-teams]').hidden = game.status !== 'ready' || !board.is_admin;
      $('[data-action=name-teams]').disabled = !canSetup || draw.navigationLocked;
      $('[data-action=edit-setup]').hidden = !board.is_admin;
      $('[data-action=edit-setup]').disabled = !canSetup || draw.navigationLocked;
    } else if (screen === 'names') {
      if (!names) names = new TeamNames(content, { game, api, canWrite: canSetup, onSubmit: async (input) => {
        if (!mutable()) throw new Error('Reconnect and refresh before starting.');
        await api.mutate('start_game', input); selectGame(null); await refresh(); focusPage();
      } });
      else names.update(canSetup);
      if (changed) content.insertAdjacentHTML('afterbegin', '<button class="text-button back-to-draw" data-action="back-to-draw">← Team assignment</button>');
    } else if (screen === 'results') {
      if (!resultPage) { resultPage = createPageForm(content, { canSubmit: mutable }); forms.result(game, resultPage); }
      else resultPage.update();
    } else {
      if (changed) content.innerHTML = '<div id="team-rosters" class="team-grid game-rosters"></div><div id="game-actions" class="flow-actions"></div>';
      renderTeams($('#team-rosters'), game, api);
      $('#game-actions').innerHTML = canWrite ? `<button class="button primary" data-action="result">${screen === 'playing' ? 'End game' : 'Correct result'}</button>` : '';
    }
  }

  function render() {
    if (!board) return;
    $('.session-name').textContent = board.session.name;
    $('[data-action=login]').hidden = board.is_admin;
    $('.admin-menu').hidden = !board.is_admin;
    $('.admin-actions').querySelectorAll('button').forEach((button) => { button.disabled = button.dataset.action === 'history' ? false : !mutable(); });
    $('[data-action=adjust]').disabled = !mutable() || !board.players.length;
    $('#session-select').innerHTML = board.sessions.map((session) => `<option value="${session.id}" ${session.id === board.session.id ? 'selected' : ''}>${h(session.name)}${session.active ? ' (active)' : ''}</option>`).join('');
    $('[data-action=start-new-game]').hidden = !board.is_admin || !board.session.active;
    $('[data-action=start-new-game]').disabled = !mutable() || Boolean(activeGame(board.games));
    renderLeaderboard($('#leaderboard'), board.players, api);
    renderGames($('#game-list'), board.games, api, board.is_admin);
    $('#games-sidebar').hidden = !$('#game-list').childElementCount;
    $('.dashboard').classList.toggle('no-games', $('#games-sidebar').hidden);
    const game = currentGame();
    const screen = gameScreen(game, route.step, board.is_admin);
    const showGame = (route.newGame && board.is_admin && board.session.active) || (game && (board.is_admin || game.total_players > 0 || game.status === 'completed'));
    $('#home-view').hidden = Boolean(showGame); $('#game-view').hidden = !showGame;
    if (showGame) renderWorkspace(game, screen); else resetWorkspace();
  }

  async function loadBoard(id) {
    try {
      const next = await api.board(selectedSession);
      if (id !== fetchId) return;
      if (!next) throw new Error('No LAN session found. Apply the database migrations.');
      if (board?.is_admin && !next.is_admin) clearPrivateView();
      board = next; stale = false;
      if (route.id && !currentGame()) selectGame(null);
      connection(navigator.onLine ? '' : 'Offline — showing the last loaded standings.'); render();
    } catch (error) {
      if (id !== fetchId) return;
      if (selectedSession && error.code === '42501') { clearPrivateView(); await refresh(); return; }
      stale = true; connection(`${board ? 'Showing the last loaded data. ' : ''}${error.message}`);
      if (!board) $('#leaderboard').innerHTML = '<p class="empty-state">Standings could not be loaded.</p>';
      render();
    }
  }
  function refresh() {
    if (!api) return Promise.resolve();
    const id = ++fetchId;
    const request = loadBoard(id); latestFetch = request;
    return request.then(async () => { let observed = id; while (observed !== fetchId) { observed = fetchId; await latestFetch; } });
  }
  function clearPrivateView() {
    fetchId += 1; resetWorkspace(); board = null; selectedSession = null; selectGame(null); dialog.clear();
    $('.admin-menu').hidden = true; $('.admin-menu').open = false;
    $('#session-select').replaceChildren(); $('[data-action=login]').hidden = false; $('[data-action=start-new-game]').hidden = true;
    $('.session-name').textContent = ''; $('#leaderboard').innerHTML = '<p class="empty-state">Loading standings…</p>';
    $('#game-list').replaceChildren(); $('#flow-content').replaceChildren(); $('#home-view').hidden = false; $('#game-view').hidden = true; notify('');
  }

  if (!api || config.issues.length) {
    connection(config.issues.length ? config.issues.join(' ') : 'Add your Supabase project URL and publishable key.');
    $('#leaderboard').innerHTML = '<p class="empty-state">Supabase configuration is needed.</p>';
    $('[data-action=login]').disabled = true; $('[data-action=refresh]').disabled = true;
    return () => {};
  }
  const forms = createAdminForms({ dialog, api, client: supabase, config, getBoard: () => board, refresh, notify, selectGame, selectSession });
  const onClick = async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'refresh') { await refresh(); return; }
    if (workspaceBusy()) { event.preventDefault(); return; }
    if (action === 'scoreboard') { event.preventDefault(); selectGame(null); render(); focusPage(); return; }
    if (action === 'login') { forms.login(); return; }
    if (action === 'logout') {
      clearPrivateView(); commandBusy = true;
      try { const { error } = await supabase.auth.signOut({ scope: 'local' }); if (error) notify(error.message, true); }
      finally { commandBusy = false; await refresh(); }
      return;
    }
    if (action === 'select-game') { selectGame(button.dataset.id); notify(''); render(); focusPage(); return; }
    if (!board?.is_admin) return;
    $('.admin-menu').open = false;
    if (action === 'history') { forms.history(); return; }
    if (action === 'export') {
      const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `lan-${board.session.id}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
    }
    if (!mutable()) return;
    notify('');
    if (action === 'start-new-game' && !activeGame(board.games)) { resetWorkspace(); route = { id: null, step: 'players', newGame: true }; writeRoute(); render(); focusPage(); }
    if (action === 'players') forms.roster();
    if (action === 'adjust') forms.adjust();
    if (action === 'reset') forms.reset();
    if (action === 'name-teams' && currentGame()?.status === 'ready') { selectGame(route.id, 'names'); render(); focusPage(); }
    if (action === 'edit-setup' && ['setup', 'drafting', 'ready'].includes(currentGame()?.status)) { selectGame(route.id, 'players'); render(); focusPage(); }
    if (action === 'back-to-draw') { selectGame(route.id, 'draw'); render(); focusPage(); }
    if (action === 'result' && ['playing', 'completed'].includes(currentGame()?.status)) { selectGame(route.id, 'results'); render(); focusPage(); }
  };
  root.addEventListener('click', onClick);
  $('#session-select').addEventListener('change', async (event) => {
    if (workspaceBusy()) { event.target.value = board.session.id; return; }
    resetWorkspace(); selectSession(event.target.value); selectGame(null); stale = true; render(); connection('Loading LAN…'); await refresh();
  });
  const onOffline = () => { stale = true; draw?.stop(); connection('Offline — reconnect before editing.'); render(); };
  const onOnline = () => void refresh();
  const onVisibility = () => { if (document.hidden) draw?.stop(); else void refresh(); };
  const onHashChange = () => { if (workspaceBusy()) { writeRoute(); return; } resetWorkspace(); route = readRoute(); render(); };
  window.addEventListener('offline', onOffline); window.addEventListener('online', onOnline); window.addEventListener('hashchange', onHashChange); document.addEventListener('visibilitychange', onVisibility);
  const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') clearPrivateView();
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refresh(), 0);
  });
  const liveChannel = supabase.channel('scoreboard-updates').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'board_updates' }, () => {
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refresh(), 100);
  }).subscribe((status) => { if (status === 'SUBSCRIBED') void refresh(); });
  const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
  void refresh();
  return () => {
    fetchId += 1; resetWorkspace(); clearInterval(poll); clearTimeout(refreshTimer); clearTimeout(messageTimer); dialog.clear();
    authListener.subscription.unsubscribe(); void supabase.removeChannel(liveChannel); root.removeEventListener('click', onClick);
    window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); window.removeEventListener('hashchange', onHashChange); document.removeEventListener('visibilitychange', onVisibility);
  };
}
