import { escapeHtml as h, imageMarkup, installImageFallbacks, formatPoints, setHtml } from '../../lib/html.js';
import { knockoutMatches, knockoutRounds, knockoutChampion, knockoutPlaces, roundLabel, matchLabel } from '../../domain/knockout.js';

const stateLabel = (match) => ({ waiting: 'Waiting', ready: 'Ready', complete: 'Finished', bye: 'Advances' })[match.status];
const advanceLabel = (game, match) => `Direct to ${roundLabel(match.round + 1, knockoutRounds(game).length).toLowerCase()}`;
export function playerProfile(player, api, className = '') {
  return `<div class="ko-profile ${className}">${imageMarkup(api.imageUrl(player.image_path), player.name)}<strong>${h(player.name)}</strong><div class="ko-tags">${(player.titles || []).map((title) => `<span>${h(title)}</span>`).join('')}</div></div>`;
}
export function bracketMarkup(game, selected, api) {
  const matches = knockoutMatches(game), rounds = knockoutRounds(game);
  const player = (id) => game.participants.find((row) => row.player_id === id);
  const slot = (match, id, index) => {
    const profile = player(id);
    if (!profile) return `<span class="ko-slot waiting">${match.round ? `Winner of match ${match.position * 2 + index + 1}` : 'Not revealed'}</span>`;
    const done = ['complete', 'bye'].includes(match.status), won = done && id === match.winner_id;
    return `<span class="ko-slot ${done ? won ? 'winner' : 'eliminated' : ''}">${imageMarkup(api.imageUrl(profile.image_path), profile.name, 'small-portrait')}<span>${h(profile.name)}</span><small>${won ? '↗' : done ? 'OUT' : ''}</small></span>`;
  };
  const champion = player(knockoutChampion(game));
  const matchCard = (match) => {
    const automatic = match.status === 'bye';
    const name = player(match.winner_id)?.name || '';
    const description = automatic
      ? `${name}. ${advanceLabel(game, match)}. No opening match needed.`
      : `${player(match.player1)?.name || 'To be decided'} versus ${player(match.player2)?.name || 'To be decided'}. ${stateLabel(match)}`;
    return `<div class="ko-match-wrap"><button class="ko-match ${automatic ? 'ko-auto-match' : ''} ${selected === match.id ? 'selected' : ''}" data-ko="match" data-id="${match.id}" aria-pressed="${selected === match.id}" aria-label="${h(matchLabel(game, match))}: ${h(description)}"><span class="ko-match-label">${automatic ? 'Automatic advance' : `Match ${match.position + 1}`}<small>${automatic ? '↗' : stateLabel(match)}</small></span>${automatic
      ? `${slot(match, match.winner_id, 0)}<span class="ko-advance-destination">${h(advanceLabel(game, match))}</span>`
      : `${slot(match, match.player1, 0)}${slot(match, match.player2, 1)}`}</button></div>`;
  };
  return `<div class="ko-bracket" style="--ko-columns:${rounds.length};--ko-height:${Math.max(450, matches.filter((row) => row.round === 0).length * 115)}px">${rounds.map((round) => {
    const rows = matches.filter((match) => match.round === round);
    return `<section class="ko-round ${round === rounds.length - 1 ? 'last' : ''}" aria-label="${roundLabel(round, rounds.length)}"><h2>${roundLabel(round, rounds.length)}</h2><div class="ko-round-stack" style="--ko-matches:${rows.length}">${rows.map(matchCard).join('')}</div></section>`;
  }).join('')}<section class="ko-champion"><h2>Champion</h2><div>${champion ? `${imageMarkup(api.imageUrl(champion.image_path), champion.name)}<strong>${h(champion.name)}</strong>` : '<strong>To be decided</strong>'}</div></section></div>`;
}

export function selectedMatchMarkup(game, { selected, choice, busy, canWrite }, api) {
  const match = game.knockout_matches?.find((row) => row.id === selected);
  const champion = knockoutChampion(game);
  const player = (id) => game.participants.find((row) => row.player_id === id);
  if (champion && (!match || match.round === knockoutRounds(game).length - 1)) {
    return `<h2>Tournament winner</h2>${playerProfile(player(champion), api)}<p class="muted">Champion</p>${match ? '<button class="text-button" data-ko="replay">Show versus ↗</button>' : ''}`;
  }
  if (!match) return '<p class="muted">Select a match.</p>';
  if (match.status === 'bye') {
    const advanced = player(match.winner_id);
    return `<h2>Automatic advance</h2><p class="ko-advance-round">${h(advanceLabel(game, match))}</p>${playerProfile(advanced, api, 'ko-advanced-player')}<p class="ko-instruction">${h(advanced.name)} has no opening opponent and goes straight to the next round.</p>`;
  }
  const canChoose = canWrite && game.status === 'playing' && match.status === 'ready';
  const emptySlot = match.round === 0 ? 'Not revealed' : 'To be decided';
  const profiles = [match.player1, match.player2].map((id) => player(id)
    ? `${playerProfile(player(id), api)}`
    : `<div class="ko-profile ko-unknown"><strong>?</strong><small>${emptySlot}</small></div>`);
  return `<h2>${h(matchLabel(game, match))}</h2><p class="muted">${stateLabel(match)}</p>
    <div class="ko-pair">${profiles.join('<span class="ko-vs" aria-hidden="true"><span>VS</span></span>')}</div>
    ${canChoose ? `<p class="ko-instruction">Select the winner.</p><div class="ko-winner-buttons">${[match.player1, match.player2].map((id) =>
      `<button class="button ${choice === id ? 'chosen' : ''}" data-ko="choose" data-id="${id}" aria-pressed="${choice === id}" ${busy ? 'disabled' : ''}>${h(player(id).name)}</button>`).join('')}</div>
      <button class="button primary ko-confirm" data-ko="confirm" ${busy || !choice ? 'disabled' : ''}>Confirm winner →</button>` : ''}
    ${match.player1 && match.player2 ? '<button class="text-button" data-ko="replay">Show versus ↗</button>' :
      '<p class="ko-instruction">Waiting for the other match to finish.</p>'}`;
}

export class KnockoutView {
  constructor(root, api) {
    this.root = root; this.api = api;
    this.dialog = document.createElement('dialog'); this.dialog.className = 'ko-versus-modal';
    this.dialog.setAttribute('aria-labelledby', 'ko-versus-title');
    document.body.append(this.dialog);
    this.onClick = (event) => {
      const button = event.target.closest('[data-ko]');
      if (!button || button.disabled) return;
      const action = button.dataset.ko;
      this.handlers?.[action]?.(button.dataset.id);
    };
    root.addEventListener('click', this.onClick);
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.dismiss(); });
  }
  bind(handlers) { this.handlers = handlers; }
  update(game, { selected, choice, busy, canWrite, canSetup }) {
    if (!this.root.querySelector('.ko-layout')) {
      this.root.innerHTML = '<div class="ko-layout"><section class="ko-arena"><header></header><div class="ko-bracket-scroll" tabindex="0" role="region" aria-label="Scrollable tournament bracket"></div><p class="ko-legend">↗ Winner advances <span>OUT · Eliminated</span></p></section><aside class="ko-selected" aria-label="Selected match"></aside></div><div class="ko-results" hidden></div><div class="flow-actions ko-actions"></div>';
    }
    const patch = (selector, html) => {
      const node = this.root.querySelector(selector);
      if (setHtml(node, html)) installImageFallbacks(node);
      return node;
    };
    const scroll = this.root.querySelector('.ko-bracket-scroll');
    const position = scroll ? { left: scroll.scrollLeft, top: scroll.scrollTop } : null;
    const focused = this.root.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = focused?.dataset.ko, focusId = focused?.dataset.id;
    const champion = knockoutChampion(game);
    const playing = game.status === 'playing', setup = ['drafting', 'ready'].includes(game.status);
    const places = knockoutPlaces(game);
    patch('.ko-arena > header', `<div><h2>Tournament bracket</h2><p>${game.total_players} players · Single elimination</p></div>${setup ? `<button class="button" data-action="edit-setup" ${!canSetup || busy ? 'disabled' : ''}>Edit players</button>` : ''}`);
    patch('.ko-bracket-scroll', bracketMarkup(game, null, this.api));
    for (const button of this.root.querySelectorAll('[data-ko=match]')) {
      button.classList.toggle('selected', button.dataset.id === selected);
      button.setAttribute('aria-pressed', String(button.dataset.id === selected));
    }
    patch('.ko-selected', selectedMatchMarkup(game, { selected, choice: null, busy: false, canWrite }, this.api));
    for (const button of this.root.querySelectorAll('[data-ko=choose]')) {
      button.classList.toggle('chosen', button.dataset.id === choice);
      button.setAttribute('aria-pressed', String(button.dataset.id === choice));
      button.disabled = busy;
    }
    const confirm = this.root.querySelector('[data-ko=confirm]');
    if (confirm) confirm.disabled = busy || !choice;
    const report = patch('.ko-results', game.status === 'completed' ? `<h2>Final standings</h2><table><thead><tr><th>Place</th><th>Player</th><th>Points</th></tr></thead><tbody>${[...game.participants].sort((a, b) => places.get(a.player_id) - places.get(b.player_id) || a.name.localeCompare(b.name)).map((row) => `<tr><td>${places.get(row.player_id)}</td><td>${h(row.name)}</td><td>${formatPoints(game.awards?.find((award) => award.player_id === row.player_id)?.points ?? 0)}</td></tr>`).join('')}</tbody></table>` : '');
    report.hidden = game.status !== 'completed';
    patch('.ko-actions', `${playing && canWrite ? `<button class="button" data-ko="undo" ${busy || !game.knockout_last_result ? 'disabled' : ''}>Undo last result</button>` : ''}${setup && canSetup ? game.status === 'drafting' ? `<button class="button primary" data-ko="draw" ${busy ? 'disabled' : ''}>${game.rolling ? 'Resume reveal' : 'Continue draw'} →</button>` : `<button class="button primary" data-ko="start" ${busy ? 'disabled' : ''}>Start game</button>` : ''}${playing && canWrite ? `<button class="button primary" data-action="result" ${busy || !champion ? 'disabled' : ''}>End game</button>` : ''}${game.status === 'completed' && canWrite ? '<button class="button primary" data-action="result">Correct result</button>' : ''}<span class="ko-command-status" role="status">${busy ? 'Saving…' : ''}</span>`);
    if (position && scroll) { scroll.scrollLeft = position.left; scroll.scrollTop = position.top; }
    if (focusKey && !this.root.contains(focused)) [...this.root.querySelectorAll('[data-ko]')].find((node) => node.dataset.ko === focusKey && node.dataset.id === focusId)?.focus({ preventScroll: true });
  }
  focusMatch(id) {
    const match = [...this.root.querySelectorAll('[data-ko=match]')].find((node) => node.dataset.id === id);
    if (match) { match.scrollIntoView({ block: 'nearest', inline: 'nearest' }); match.focus({ preventScroll: true }); }
  }
  reveal(game, match, { context, next, hasNext, onNext, onClose }) {
    this.close(); this.onDismiss = onClose;
    this.dialog.innerHTML = `<div class="ko-reveal-context">${h(context)}</div><h2 id="ko-versus-title">${h(game.name)}</h2><p class="muted">${h(matchLabel(game, match))}</p><div class="ko-reveal-pair">${[match.player1, match.player2].map((id) => playerProfile(game.participants.find((row) => row.player_id === id), this.api)).join('<span class="ko-reveal-vs" aria-hidden="true"><span class="ko-vs-mark">VS</span></span>')}</div><p class="sr-only" role="status">${h(game.participants.find((row) => row.player_id === match.player1).name)} versus ${h(game.participants.find((row) => row.player_id === match.player2).name)}</p><div class="ko-reveal-actions"><button class="button primary" data-next>${h(next)}</button>${hasNext ? '<button class="text-button" data-close>Back to bracket</button>' : ''}</div>`;
    installImageFallbacks(this.dialog);
    this.dialog.querySelector('[data-next]').onclick = onNext;
    this.dialog.querySelector('[data-close]')?.addEventListener('click', () => this.dismiss());
    this.dialog.showModal(); this.dialog.querySelector('[data-next]').focus();
  }
  dismiss() { const callback = this.onDismiss; this.close(); callback?.(); }
  close() { this.onDismiss = null; if (this.dialog.open) this.dialog.close(); }
  dispose() { this.close(); this.dialog.remove(); this.root.removeEventListener('click', this.onClick); }
}
