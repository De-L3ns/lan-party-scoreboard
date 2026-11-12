import { escapeHtml as h, formatPoints, imageMarkup, installImageFallbacks } from '../../lib/html.js';

const pointsLabel = (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatPoints(Math.abs(value))} pts`;

export class ScoreRevealView {
  constructor({ api, onReplay, onClose }) {
    Object.assign(this, { api, onReplay, onClose });
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'score-reveal-modal';
    this.dialog.setAttribute('aria-labelledby', 'score-reveal-title');
    this.dialog.setAttribute('aria-describedby', 'score-reveal-context');
    document.body.append(this.dialog);
    this.closed = () => {
      if (this.dialog.open) return;
      this.unobserve(); this.onClose();
    };
    this.dialog.addEventListener('close', this.closed);
  }

  open(transition) {
    this.transition = transition;
    this.dialog.innerHTML = `<header><p id="score-reveal-context">${h(transition.gameName)}</p><h2 id="score-reveal-title">Leaderboard changes</h2></header>
      <div class="score-reveal-scroll" tabindex="0" role="region" aria-label="Leaderboard changes">
        <div class="score-reveal-head" aria-hidden="true"><span>#</span><span>Player</span><span>Point change</span><span>Total</span><span>Place change</span></div>
        <ol class="score-reveal-list" aria-label="Overall LAN standings">${transition.rows.map((row) => `<li class="score-reveal-row" data-player="${h(row.id)}" data-direction="${row.placeChange > 0 ? 'up' : row.placeChange < 0 ? 'down' : 'same'}">
          <span class="score-reveal-rank">${row.beforeRank}</span><span class="score-reveal-identity">${imageMarkup(this.api.imageUrl(row.image_path), row.name, 'small-portrait')}<strong>${h(row.name)}</strong></span>
          <span class="score-reveal-points ${row.pointChange < 0 ? 'negative' : row.pointChange === 0 ? 'unchanged' : ''}">${pointsLabel(row.pointChange)}</span>
          <strong class="score-reveal-total">${formatPoints(row.afterPoints)}</strong>
          <span class="score-reveal-change">${row.placeChange ? `${row.placeChange > 0 ? '↑' : '↓'} ${Math.abs(row.placeChange)}<small>#${row.beforeRank} → #${row.afterRank}</small>` : '<span aria-label="Same place">—</span>'}</span>
        </li>`).join('')}</ol>
      </div>
      <footer><button class="button" type="button" data-replay>↻ Replay</button><button class="button primary" type="button" data-done autofocus>Done</button></footer>
      <p class="sr-only" data-summary role="status" aria-live="polite" aria-atomic="true"></p>`;
    this.list = this.dialog.querySelector('.score-reveal-list');
    this.rows = new Map([...this.list.children].map((row) => [row.dataset.player, row]));
    this.replayButton = this.dialog.querySelector('[data-replay]');
    this.dialog.querySelector('[data-done]').onclick = () => this.dialog.close();
    this.replayButton.onclick = () => this.onReplay();
    installImageFallbacks(this.dialog);
    this.dialog.showModal();
    this.measure();
    this.observe();
  }

  observe() {
    this.resized = () => {
      if (!this.dialog.open) return;
      try { this.measure(); this.position(this.progress ?? 0); }
      catch { this.settle(); }
    };
    window.addEventListener('resize', this.resized);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.resized);
      this.observer.observe(this.list);
      for (const row of this.rows.values()) this.observer.observe(row);
    }
  }

  unobserve() {
    this.observer?.disconnect(); this.observer = null;
    if (this.resized) window.removeEventListener('resize', this.resized);
    this.resized = null;
  }

  measure() {
    const gap = 6;
    const heights = new Map([...this.rows].map(([id, row]) => [id, row.getBoundingClientRect().height]));
    const offsets = (order) => {
      let y = 0;
      return new Map(order.map(({ id }) => { const top = y; y += heights.get(id) + gap; return [id, top]; }));
    };
    this.beforeOffsets = offsets(this.transition.before);
    this.afterOffsets = offsets(this.transition.after);
    this.list.style.height = `${Math.max(0, [...heights.values()].reduce((sum, height) => sum + height + gap, -gap))}px`;
    this.list.dataset.positioned = 'true';
  }

  before() {
    this.list.classList.remove('is-moving');
    this.list.classList.remove('is-settled');
    this.dialog.querySelector('[data-summary]').textContent = '';
    this.replayButton.disabled = true;
    for (const row of this.transition.rows) {
      const element = this.rows.get(row.id);
      element.querySelector('.score-reveal-rank').textContent = row.beforeRank;
      element.setAttribute('aria-posinset', String(row.beforeIndex + 1));
      element.setAttribute('aria-setsize', String(this.rows.size));
      element.setAttribute('aria-label', `${row.name}, previously rank ${row.beforeRank}, new total ${formatPoints(row.afterPoints)} points, ${pointsLabel(row.pointChange)}, new rank ${row.afterRank}`);
      this.list.append(element);
    }
    this.position(0);
  }

  position(progress) {
    this.progress = progress;
    this.list.classList.toggle('is-moving', progress > 0 && progress < 1);
    for (const [id, element] of this.rows) {
      const old = this.beforeOffsets.get(id), next = this.afterOffsets.get(id);
      element.style.transform = `translateY(${old + (next - old) * progress}px)`;
    }
  }

  settle() {
    // Also the fallback if animation/layout work fails: ordinary document flow
    // still provides a complete, correctly ordered, scrollable result.
    try { this.position(1); }
    catch {
      delete this.list.dataset.positioned;
      this.list.style.height = '';
      for (const element of this.rows.values()) element.style.transform = '';
    }
    for (const row of [...this.transition.rows].sort((a, b) => a.afterIndex - b.afterIndex)) {
      const element = this.rows.get(row.id);
      element.querySelector('.score-reveal-rank').textContent = row.afterRank;
      element.setAttribute('aria-posinset', String(row.afterIndex + 1));
      element.setAttribute('aria-setsize', String(this.rows.size));
      element.setAttribute('aria-label', `${row.name}, rank ${row.afterRank}, ${formatPoints(row.afterPoints)} points, ${pointsLabel(row.pointChange)}, ${row.placeChange > 0 ? `up ${row.placeChange}` : row.placeChange < 0 ? `down ${Math.abs(row.placeChange)}` : 'unchanged'} places`);
      this.list.append(element);
    }
    this.list.classList.remove('is-moving'); this.list.classList.add('is-settled');
    this.replayButton.disabled = false;
    const up = this.transition.rows.filter((row) => row.placeChange > 0).length;
    const down = this.transition.rows.filter((row) => row.placeChange < 0).length;
    this.dialog.querySelector('[data-summary]').textContent = `Standings updated for ${this.transition.gameName}. ${up || down ? `${up} players gained places and ${down} dropped places.` : 'All players retained their rank.'}`;
  }

  close() {
    this.unobserve();
    if (this.dialog.open) this.dialog.close();
    this.dialog.replaceChildren(); this.rows?.clear();
    this.transition = this.list = null;
  }

  dispose() {
    this.close();
    this.dialog.removeEventListener('close', this.closed);
    this.dialog.remove();
  }
}
