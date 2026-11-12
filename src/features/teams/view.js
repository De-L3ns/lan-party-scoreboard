import { pickerLayout, fitPickerArena, rotationTo, normalizeAngle } from '../../domain/picker.js';
import { escapeHtml as h, imageMarkup, installImageFallbacks } from '../../lib/html.js';
import { rifleSvg, carSvg, muzzleSvg, bloodSvg, sparksSvg } from './artwork.js';
import { animate, checkSignal, wait } from './motion.js';

export class PickerView {
  constructor(root, api) {
    this.root = root; this.api = api; this.angle = -90; this.mode = 'rifle'; this.membership = new Map(); this.nodes = new Map();
    this.assignmentsBelow = true;
    try { this.assignmentsBelow = globalThis.sessionStorage?.getItem('lan-picker-layout') !== 'beside'; } catch { /* Keep the default when storage is blocked. */ }
    root.classList.add('themed-picker'); root.dataset.mode = 'rifle';
    root.innerHTML = `<div class="picker-tools"><div class="mode-switch" role="group" aria-label="Spinner mode"><button type="button" data-picker-mode="rifle">Call of Duty 2</button><button type="button" data-picker-mode="trackmania">TrackMania</button></div><span class="picker-mode-label"></span><div class="picker-sound-controls"><button type="button" class="button assignment-layout-button" aria-pressed="true">Assignments below</button><button type="button" class="button sound-button">Sound on</button></div></div>
      <div class="picker-top"><span class="draft-target destination"></span><span class="draft-count pick-count"></span></div>
      <div class="picker-scroll" role="group" aria-label="Player picker"><div class="picker-stage"><div class="arena"><div class="arena-grid"></div><div class="axis horizontal"></div><div class="axis vertical"></div><div class="picker-orbits"></div><div class="center-ring"></div><div class="impact-layer" aria-hidden="true"></div><div class="picker-players"></div>
        <div class="rotor" aria-hidden="true"><div class="tracer"></div><div class="weapon">${rifleSvg}</div>${muzzleSvg}<span class="shell-case"></span><div class="skid-trail"></div><div class="car-motion"><span class="exhaust"></span><div class="stadium-car">${carSvg}</div></div></div>
        <div class="phase-strip" aria-hidden="true"><span data-phase="spin">SPIN</span><span>·</span><span data-phase="lock">LOCK</span><span>·</span><span data-phase="fire">FIRE</span></div>
      </div></div></div><p class="pick-result sr-only" role="status" aria-live="polite"></p><p class="audio-error" role="status" hidden></p>
      <div class="draft-buttons"><button type="button" class="button primary spin-button">Spin &amp; fire</button><button type="button" class="button auto-button" aria-pressed="false">Auto draw</button></div>`;
    this.$ = (selector) => root.querySelector(selector);
    this.setAssignmentLayout(this.assignmentsBelow, false);
    this.$('.assignment-layout-button').onclick = () => this.setAssignmentLayout(!this.assignmentsBelow);
    this.onResize = () => this.measure();
    this.resize = new ResizeObserver(this.onResize);
    this.resize.observe(root);
    root.closest('.app-shell')?.querySelectorAll('.app-header, .flow-toolbar, .flow-heading, .connection-notice, .app-message').forEach((node) => this.resize.observe(node));
    globalThis.addEventListener('resize', this.onResize);
    globalThis.visualViewport?.addEventListener('resize', this.onResize);
  }
  setAssignmentLayout(below, persist = true) {
    this.assignmentsBelow = below;
    this.root.closest('.draft-layout')?.setAttribute('data-assignments', below ? 'below' : 'beside');
    const button = this.$('.assignment-layout-button');
    button.textContent = below ? 'Assignments below' : 'Assignments beside';
    button.setAttribute('aria-pressed', String(below));
    button.title = below ? 'Place team assignments beside the picker' : 'Place team assignments below the picker';
    if (persist) { try { globalThis.sessionStorage?.setItem('lan-picker-layout', below ? 'below' : 'beside'); } catch { /* The current view still works without storage. */ } }
    this.measuredWidth = null; this.measure();
  }
  bind({ spin, autoplay, mode, sound }) {
    this.$('.spin-button').onclick = spin; this.$('.auto-button').onclick = autoplay;
    this.$('.sound-button').onclick = sound;
    this.root.querySelectorAll('[data-picker-mode]').forEach((button) => { button.onclick = () => mode(button.dataset.pickerMode); });
  }
  setFullMotion(enabled) {
    this.fullMotion = Boolean(enabled);
    this.root.dataset.fullMotion = String(this.fullMotion);
  }
  reduced() { return !this.fullMotion && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  get remainingDuration() { return Math.max(.1, ((this.spinDuration || 4200) - (performance.now() - (this.spinStart || 0))) / 1000); }
  update(game) {
    this.game = game; this.setMode(game.picker_mode || 'rifle');
    this.participants = [...game.participants].sort((a, b) => a.name.localeCompare(b.name) || a.player_id.localeCompare(b.player_id));
    const signature = JSON.stringify(this.participants);
    this.membership = new Map(game.teams.flatMap((team) => team.members.map((member) => [member.player_id, team])));
    if (signature !== this.rosterSignature) {
      this.rosterSignature = signature; this.measuredWidth = null;
      this.$('.picker-players').innerHTML = this.participants.map((player) => `<div class="orbit-player" data-player-id="${h(player.player_id)}" role="group" tabindex="0" title="${h(player.name)}">${imageMarkup(this.api.imageUrl(player.image_path), player.name, 'avatar')}<span class="orbit-name">${h(player.name)}</span><span class="orbit-team" aria-hidden="true"></span></div>`).join('');
      this.nodes = new Map([...this.root.querySelectorAll('[data-player-id]')].map((node) => [node.dataset.playerId, node]));
      installImageFallbacks(this.root);
    }
    for (const player of game.participants) {
      const node = this.nodes.get(player.player_id), team = this.membership.get(player.player_id);
      node.classList.toggle('assigned', Boolean(team));
      node.setAttribute('aria-label', `${player.name}${team ? `, ${team.name}` : ', unassigned'}`);
      if (team) { node.style.setProperty('--assigned-color', `var(--team-${team.position % 4})`); node.querySelector('.orbit-team').textContent = String.fromCharCode(65 + team.position); }
    }
    this.$('.draft-count').textContent = `${game.pick_count} / ${game.total_players}`;
    const position = game.pick_count % game.team_count;
    this.$('.draft-target').textContent = game.status === 'ready' ? 'Teams assigned' : `Picking for ${game.teams.find((team) => team.position === position)?.name || `Team ${String.fromCharCode(65 + position)}`}`;
    this.$('.draft-target').style.color = `var(--team-${position % 4})`;
    this.measure();
  }
  setMode(mode) {
    this.mode = mode; this.root.dataset.mode = mode; this.$('.arena').classList.toggle('trackmania', mode === 'trackmania');
    this.$('[data-phase=lock]').textContent = mode === 'rifle' ? 'LOCK' : 'LINE UP';
    this.$('[data-phase=fire]').textContent = mode === 'rifle' ? 'FIRE' : 'DRIVE';
    this.$('.picker-mode-label').textContent = mode === 'rifle' ? 'Call of Duty 2' : 'TrackMania';
    this.root.querySelectorAll('[data-picker-mode]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.pickerMode === mode)));
  }
  controls({ canWrite, busy, pending, autoplay, complete, saving }) {
    this.root.hidden = complete && !busy;
    this.$('.mode-switch').hidden = !canWrite; this.$('.picker-mode-label').hidden = canWrite;
    this.$('.assignment-layout-button').disabled = busy;
    this.root.querySelectorAll('[data-picker-mode]').forEach((button) => { button.disabled = busy || pending || complete; });
    this.$('.draft-buttons').hidden = !canWrite || complete;
    this.$('.spin-button').disabled = busy;
    this.$('.spin-button').textContent = saving ? 'Saving…' : busy ? 'Picking…' : pending ? 'Resume pick' : this.mode === 'rifle' ? 'Spin & fire' : 'Spin & race';
    this.$('.auto-button').disabled = saving;
    this.$('.auto-button').textContent = autoplay ? 'Pause auto draw' : 'Auto draw';
    this.$('.auto-button').setAttribute('aria-pressed', String(autoplay));
  }
  audio({ enabled, error }) {
    this.$('.sound-button').textContent = enabled ? 'Sound on' : 'Sound off';
    this.$('.sound-button').classList.toggle('sound-on', enabled); this.$('.sound-button').setAttribute('aria-pressed', String(enabled));
    this.$('.audio-error').textContent = error; this.$('.audio-error').hidden = !error;
  }
  measure() {
    if (!this.game || this.root.hidden) return;
    const frame = this.$('.picker-scroll'), frameStyle = getComputedStyle(frame);
    const rootRect = this.root.getBoundingClientRect(), frameRect = frame.getBoundingClientRect();
    if (!frameRect.width) return;
    const paddingX = parseFloat(frameStyle.paddingLeft) + parseFloat(frameStyle.paddingRight);
    const paddingY = parseFloat(frameStyle.paddingTop) + parseFloat(frameStyle.paddingBottom);
    const viewportHeight = globalThis.visualViewport?.height || globalThis.innerHeight;
    // Use document position so scrolling the roster cannot enlarge the picker again.
    const top = Math.max(0, rootRect.top + globalThis.scrollY);
    const chromeHeight = rootRect.height - frameRect.height;
    const width = Math.max(1, Math.floor(frame.clientWidth - paddingX));
    const height = Math.max(1, Math.floor(viewportHeight - top - chromeHeight - paddingY - 16));
    const measurement = `${width}:${height}`;
    if (measurement === this.measuredWidth) return;
    this.measuredWidth = measurement; this.layout = pickerLayout(this.participants, width);
    const fitted = fitPickerArena(this.layout, width, height);
    const stage = this.$('.picker-stage'); stage.style.width = `${fitted.size}px`; stage.style.height = `${fitted.size}px`;
    const { size, avatarWidth, avatarHeight, nameSize, nameWidth, rifleWidth, carWidth, slots, radii, dense } = this.layout;
    const arena = this.$('.arena'); arena.style.width = `${size}px`; arena.style.height = `${size}px`; arena.style.transform = `scale(${fitted.scale})`; arena.dataset.dense = String(dense);
    for (const [key, value] of Object.entries({ 'avatar-width': avatarWidth, 'avatar-height': avatarHeight, 'avatar-name-size': nameSize, 'avatar-name-width': nameWidth, 'gun-size': rifleWidth, 'car-size': carWidth })) arena.style.setProperty(`--${key}`, `${value}px`);
    this.$('.picker-orbits').innerHTML = radii.map((radius) => `<div class="orbit" style="width:${radius * 2}px;height:${radius * 2}px"></div>`).join('');
    for (const slot of slots) { const node = this.nodes.get(slot.id); node.style.left = `${slot.x}px`; node.style.top = `${slot.y}px`; }
  }
  phase(name) { this.root.querySelectorAll('[data-phase]').forEach((node) => { node.classList.toggle('active', node.dataset.phase === name); }); }
  clearTargets() { for (const node of this.nodes.values()) node.classList.remove('tracking', 'locked', 'picked'); }
  announce(message) { this.$('.pick-result').textContent = message; }
  captureAngle() {
    try { const matrix = new DOMMatrix(getComputedStyle(this.$('.rotor')).transform); return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI; }
    catch { return this.angle; }
  }
  stopGeneric() {
    if (!this.generic) return;
    this.angle = this.captureAngle(); this.generic.cancel(); this.generic = null; this.$('.rotor').style.transform = `rotate(${this.angle}deg)`;
  }
  pending(startedAt) {
    if (this.generic || this.reduced() || document.hidden || Date.now() - Date.parse(startedAt) > 12000) return;
    this.phase('spin');
    this.generic = this.$('.rotor').animate?.([{ transform: `rotate(${this.angle}deg)` }, { transform: `rotate(${this.angle + 360}deg)` }], { duration: 1800, iterations: Infinity });
  }
  async aim(id, { signal, duration = 4200, tick = () => {} } = {}) {
    this.stopGeneric(); checkSignal(signal); this.measure(); this.activeTarget = id;
    const slot = this.layout.slots.find((row) => row.id === id);
    if (!slot) throw new Error('The reserved player is missing. Refresh the draft.');
    this.clearTargets(); this.phase('spin');
    this.spinning = !this.reduced(); this.spinStart = performance.now(); this.spinDuration = duration;
    const end = rotationTo(this.angle, slot.angle, duration < 1000 ? 1 : 5);
    let frame, last;
    const track = () => {
      if (signal?.aborted) return;
      const current = normalizeAngle(this.captureAngle());
      const closest = this.layout.slots.filter((row) => !this.membership.has(row.id)).sort((a, b) => {
        const distance = (row) => { const delta = Math.abs(normalizeAngle(row.angle) - current); return Math.min(delta, 360 - delta); };
        return distance(a) - distance(b);
      })[0];
      if (closest?.id !== last) { last = closest?.id; if (this.mode === 'rifle') tick(); }
      for (const [key, node] of this.nodes) node.classList.toggle('tracking', key === last);
      frame = requestAnimationFrame(track);
    };
    try {
      if (this.reduced()) this.$('.rotor').style.transform = `rotate(${end}deg)`;
      else { frame = requestAnimationFrame(track); await animate(this.$('.rotor'), [{ transform: `rotate(${this.angle}deg)` }, { transform: `rotate(${end}deg)` }], { duration, easing: 'cubic-bezier(.12,.68,.12,1)' }, signal); }
      checkSignal(signal); this.angle = end; this.clearTargets(); this.nodes.get(id).classList.add('locked'); this.phase('lock');
    } finally { cancelAnimationFrame(frame); this.spinning = false; }
  }
  async drive(id, signal) {
    checkSignal(signal); this.phase('fire');
    const slot = this.layout.slots.find((row) => row.id === id);
    this.$('.arena').classList.add('launching'); this.$('.arena').style.setProperty('--drive-distance', `${slot.driveDistance}px`);
    if (!this.reduced()) await animate(this.$('.car-motion'), [{ transform: 'translateX(0px)' }, { transform: `translateX(${slot.driveDistance}px)` }], { duration: 680, easing: 'cubic-bezier(.55,.05,.9,.7)' }, signal);
  }
  async impact(id, signal) {
    checkSignal(signal); this.phase('fire'); this.nodes.get(id).classList.add('picked');
    const slot = this.layout.slots.find((row) => row.id === id); let impact;
    if (!this.reduced()) {
      if (this.mode === 'rifle') { this.$('.arena').classList.add('firing'); this.$('.weapon').classList.add('recoil'); }
      impact = document.createElement('div'); impact.className = this.mode === 'rifle' ? 'blood-impact' : 'crash-impact';
      impact.style.left = `${slot.x}px`; impact.style.top = `${slot.y}px`; impact.style.setProperty('--impact-angle', `${slot.angle}deg`);
      impact.innerHTML = this.mode === 'rifle' ? bloodSvg : sparksSvg; this.$('.impact-layer').append(impact);
    }
    try { await wait(this.reduced() ? 80 : 850, signal); }
    finally { impact?.remove(); }
    if (this.mode === 'trackmania' && !this.reduced()) { this.$('.car-motion').style.opacity = '0'; await wait(180, signal); }
    this.resetEffects();
  }
  resetEffects() {
    this.$('.arena').classList.remove('firing', 'launching'); this.$('.weapon').classList.remove('recoil');
    this.$('.car-motion').style.transform = 'translateX(0px)'; this.$('.car-motion').style.opacity = '1';
    this.$('.impact-layer').replaceChildren(); this.clearTargets(); this.phase(''); this.activeTarget = null;
  }
  cancel() { this.spinning = false; this.stopGeneric(); this.resetEffects(); }
  complete() { this.cancel(); this.$('.pick-result').replaceChildren(); }
  dispose() { this.cancel(); this.resize.disconnect(); globalThis.removeEventListener('resize', this.onResize); globalThis.visualViewport?.removeEventListener('resize', this.onResize); }
}
