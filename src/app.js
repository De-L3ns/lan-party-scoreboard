import { renderLeaderboard } from './features/leaderboard/view.js';
import { renderGames, renderTeams, statusLabel, formatLabel } from './features/games/view.js';
import { DraftController } from './features/teams/controller.js';
import { createAdminForms } from './features/admin/forms.js';
import { createApi } from './lib/api.js';
import { createDialog } from './lib/dialog.js';
import { escapeHtml as h } from './lib/html.js';

export function mountApp(root, { config, supabase }) {
  root.innerHTML = `
    <a class="skip-link" href="#main">Skip to standings</a>
    <div class="app-shell">
      <header class="app-header">
        <a class="wordmark" href="#main">LAN<span>//</span>LOCAL</a>
        <span class="session-name"></span>
        <button class="button" data-action="login">Admin</button>
        <button class="button" data-action="logout" hidden>Sign out</button>
      </header>
      <main id="main">
        <div class="page-heading"><h1>Leaderboard<span>.</span></h1><span class="board-summary muted"></span></div>
        <div class="connection-notice" role="status"><span class="connection-text"></span><button class="button" data-action="refresh">Refresh</button></div>
        <p class="app-message" role="alert" hidden></p>
        <div class="archive-controls" hidden><label>LAN session<select id="session-select" aria-label="LAN session"></select></label><button class="button" data-action="export">Export report</button></div>
        <div class="admin-actions" hidden>
          <button class="button primary" data-action="players">Players</button>
          <button class="button" data-action="create-game">New game</button>
          <button class="button" data-action="adjust">Adjust points</button>
          <button class="button" data-action="history">Score history</button>
          <button class="button danger" data-action="reset">New LAN</button>
        </div>
        <div class="dashboard">
          <section aria-labelledby="leaderboard-heading"><h2 id="leaderboard-heading" class="sr-only">Individual standings</h2><div id="leaderboard"><p class="empty-state">Loading standings…</p></div></section>
          <aside aria-labelledby="games-heading"><h2 id="games-heading">Games</h2><div id="game-list"></div></aside>
        </div>
        <section class="game-section" aria-labelledby="selected-game-title">
          <div class="section-heading"><div><h2 id="selected-game-title">Select a game</h2><p class="game-description muted">Choose a game to view its players, teams or results.</p></div><span class="game-status status-label"></span></div>
          <div id="game-actions"></div>
          <div id="game-draft"></div>
          <div id="team-rosters" class="team-grid"></div>
        </section>
      </main>
      <footer><span>LAN // LOCAL</span><span>Individual points. Free-for-all or teams.</span></footer>
    </div>`;
  const $ = (selector) => root.querySelector(selector);
  let board = null;
  let selectedSession = null;
  let selectedGame = new URLSearchParams(location.hash.slice(1)).get('game');
  let draw;
  let drawGame;
  let stale = false;
  let commandBusy = false;
  let fetchId = 0;
  let liveChannel;
  let refreshTimer;
  let latestFetch = Promise.resolve();
  const dialog = createDialog();
  const api = supabase ? createApi(supabase) : null;

  function notify(message, error = false) {
    $('.app-message').textContent = message;
    $('.app-message').hidden = !message;
    $('.app-message').classList.toggle('error', error);
  }

  function connection(message) {
    $('.connection-text').textContent = message;
    $('.connection-notice').hidden = !message;
  }

  const mutable = () => Boolean(board?.is_admin && board.session.active && (!selectedSession || selectedSession === board.session.id) && !stale && navigator.onLine);
  const currentGame = () => board?.games.find((game) => game.id === selectedGame);
  function selectGame(id) {
    if (id !== selectedGame) { draw?.dispose(); draw = null; drawGame = null; }
    selectedGame = id;
    history.replaceState(null, '', id ? `#game=${encodeURIComponent(id)}` : location.pathname + location.search);
  }
  function selectSession(id) { selectedSession = id; }

  function renderGame() {
    const game = currentGame();
    const canWrite = mutable();
    if (!game) {
      draw?.dispose(); draw = null; drawGame = null;
      $('#selected-game-title').textContent = 'Select a game';
      $('.game-description').textContent = 'Choose a game to view its players, teams or results.';
      $('.game-status').textContent = '';
      $('#team-rosters').innerHTML = '';
      $('#game-draft').innerHTML = '';
      $('#game-actions').innerHTML = canWrite ? '<button class="button" disabled>Select a game before setup</button>' : '';
      return;
    }
    $('#selected-game-title').textContent = game.name;
    const freeForAll = game.format === 'ffa';
    $('.game-description').textContent = [formatLabel(game), game.details, game.direction === 'lower' ? 'Lower result wins' : 'Higher result wins', !board.session.active ? 'Archived LAN — read only' : ''].filter(Boolean).join(' · ');
    $('.game-status').textContent = statusLabel(game);
    $('#game-actions').innerHTML = canWrite ? [
      ['setup', 'drafting', 'ready'].includes(game.status) ? `<button class="button" data-action="draft" ${board.roster.filter((player) => !player.archived).length < 2 ? 'disabled' : ''}>${freeForAll ? (game.total_players ? 'Edit participants' : 'Select participants') : (game.total_players ? 'Redraw teams' : 'Set up teams')}</button>` : '',
      game.status === 'ready' ? '<button class="button primary" data-action="start-game">Start game</button>' : '',
      ['ready', 'playing', 'completed'].includes(game.status) ? `<button class="button" data-action="result">${game.score_revision ? 'Correct result' : 'Enter result'}</button>` : '',
    ].join('') : '';
    renderTeams($('#team-rosters'), game, api);
    if (!freeForAll && game.total_players > 0 && ['drafting', 'ready'].includes(game.status)) {
      $('#game-draft').hidden = false;
      if (drawGame !== game.id || !draw) {
        draw?.dispose();
        draw = new DraftController($('#game-draft'), { api, refresh, notify });
        drawGame = game.id;
      }
      draw.update(game, canWrite);
    } else {
      draw?.dispose(); draw = null; drawGame = null;
      $('#game-draft').innerHTML = game.status === 'setup' ? `<p class="empty-state">${freeForAll ? 'No participants yet. An admin can select players for this free-for-all.' : 'No draft yet. An admin can select players and prepare teams for this game.'}</p>` : '';
    }
  }

  function render() {
    if (!board) return;
    $('.session-name').textContent = board.session.name;
    $('.board-summary').textContent = `${board.players.length} players · ${board.games.length} games${board.session.active ? '' : ' · Archive'}`;
    $('[data-action=login]').hidden = board.is_admin;
    $('[data-action=logout]').hidden = !board.is_admin;
    $('.archive-controls').hidden = !board.is_admin;
    $('.admin-actions').hidden = !board.is_admin;
    $('.admin-actions').querySelectorAll('button').forEach((button) => {
      button.disabled = commandBusy || (button.dataset.action !== 'history' && !mutable());
    });
    $('[data-action=adjust]').disabled = commandBusy || !mutable() || !board.players.length;
    $('#session-select').innerHTML = board.sessions.map((session) => `<option value="${session.id}" ${session.id === board.session.id ? 'selected' : ''}>${h(session.name)}${session.active ? ' (active)' : ' (archived)'}</option>`).join('');
    renderLeaderboard($('#leaderboard'), board.players, api);
    renderGames($('#game-list'), board.games, selectedGame);
    renderGame();
  }

  async function loadBoard(id) {
    try {
      const next = await api.board(selectedSession);
      if (id !== fetchId) return;
      if (!next) throw new Error('No LAN session found. Apply the MVP migration to initialize the board.');
      if (board?.is_admin && !next.is_admin) clearPrivateView();
      board = next; stale = false;
      if (selectedGame && !currentGame()) selectGame(null);
      connection(navigator.onLine ? '' : 'Offline — showing the last loaded standings.');
      render();
    } catch (error) {
      if (id !== fetchId) return;
      if (selectedSession && error.code === '42501') {
        clearPrivateView();
        await refresh();
        return;
      }
      stale = true;
      connection(`${board ? 'Showing the last loaded data. ' : ''}${error.message} If read_board is missing, apply the MVP migration.`);
      if (!board) $('#leaderboard').innerHTML = '<p class="empty-state">Standings could not be loaded. Check the database setup and try Refresh.</p>';
      render();
    }
  }

  function refresh() {
    if (!api) return Promise.resolve();
    const id = ++fetchId;
    const request = loadBoard(id);
    latestFetch = request;
    // A mutation caller must wait for the newest read if Realtime supersedes its read.
    return request.then(async () => {
      let observed = id;
      while (observed !== fetchId) {
        observed = fetchId;
        await latestFetch;
      }
    });
  }

  async function perform(operation, input) {
    if (commandBusy || !mutable()) return;
    commandBusy = true; render();
    try { await api.mutate(operation, input); await refresh(); notify('Saved.'); }
    catch (error) { notify(error.message, true); await refresh(); }
    finally { commandBusy = false; render(); }
  }

  function clearPrivateView() {
    fetchId += 1; draw?.dispose(); draw = null; drawGame = null;
    board = null; selectedSession = null; selectGame(null);
    dialog.clear();
    $('.admin-actions').hidden = true;
    $('.archive-controls').hidden = true;
    $('#session-select').replaceChildren();
    $('[data-action=logout]').hidden = true;
    $('[data-action=login]').hidden = false;
    $('.session-name').textContent = '';
    $('.board-summary').textContent = '';
    $('#leaderboard').innerHTML = '<p class="empty-state">Loading public standings…</p>';
    $('#game-list').innerHTML = '';
    $('#game-actions').innerHTML = '';
    $('#game-draft').innerHTML = '';
    $('#team-rosters').innerHTML = '';
    $('#selected-game-title').textContent = 'Select a game';
    $('.game-description').textContent = '';
    $('.game-status').textContent = '';
    notify('');
  }

  if (!api || config.issues.length) {
    connection(config.issues.length ? config.issues.join(' ') : 'Add your Supabase project URL and publishable key, then restart or rebuild the app.');
    $('#leaderboard').innerHTML = '<p class="empty-state">Supabase configuration is needed to load the leaderboard.</p>';
    $('[data-action=login]').disabled = true;
    $('[data-action=refresh]').disabled = true;
    return () => {};
  }

  const forms = createAdminForms({ dialog, api, client: supabase, config, getBoard: () => board, refresh, notify, selectGame, selectSession });

  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'refresh') { await refresh(); return; }
    if (action === 'login') { forms.login(); return; }
    if (action === 'logout') {
      clearPrivateView();
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) notify(error.message, true);
      await refresh(); return;
    }
    if (action === 'select-game') {
      selectGame(button.dataset.id); render();
      $('.game-section').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      return;
    }
    if (!board?.is_admin) return;
    if (action === 'history') { forms.history(); return; }
    if (action === 'export') {
      const blob = new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `lan-${board.session.id}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); return;
    }
    if (!mutable() || commandBusy) return;
    notify('');
    if (action === 'players') forms.roster();
    if (action === 'create-game') forms.game();
    if (action === 'adjust') forms.adjust();
    if (action === 'reset') { draw?.stop(); forms.reset(); }
    if (action === 'draft' && currentGame()) { draw?.stop(); forms.draft(currentGame()); }
    if (action === 'result' && currentGame()) forms.result(currentGame());
    if (action === 'start-game' && currentGame()) await perform('start_game', { game_id: currentGame().id, revision: currentGame().draft_revision });
  });
  $('#session-select').addEventListener('change', async (event) => {
    draw?.dispose(); draw = null; drawGame = null;
    selectSession(event.target.value); selectGame(null);
    stale = true; render(); connection('Loading selected LAN…');
    await refresh();
  });

  const onOffline = () => { stale = true; draw?.stop(); connection('Offline — showing the last loaded data. Reconnect before editing.'); render(); };
  const onOnline = () => void refresh();
  const onVisibility = () => { if (document.hidden) draw?.stop(); else void refresh(); };
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);
  const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') clearPrivateView();
    // Keep SDK callbacks synchronous to avoid deadlocks with Auth's session lock.
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refresh(), 0);
  });
  liveChannel = supabase.channel('scoreboard-updates')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'board_updates' }, () => {
      clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void refresh(), 100);
    })
    .subscribe((status) => { if (status === 'SUBSCRIBED') void refresh(); });
  // A bounded fallback also reconciles reset/archive changes after a missed event.
  const poll = setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
  void refresh();

  return () => {
    fetchId += 1; draw?.dispose(); clearInterval(poll); clearTimeout(refreshTimer);
    authListener.subscription.unsubscribe(); void supabase.removeChannel(liveChannel);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
