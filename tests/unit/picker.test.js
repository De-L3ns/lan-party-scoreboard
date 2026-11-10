import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickerLayout, fitPickerArena, rotationTo, normalizeAngle } from '../../src/domain/picker.js';
import { PickerView } from '../../src/features/teams/view.js';
import { animate, wait } from '../../src/features/teams/motion.js';

test('every supported roster size has one stable slot per participant with correct aim and car travel', () => {
  for (let count = 2; count <= 64; count++) {
    const players = Array.from({ length: count }, (_, i) => ({ player_id: `p${i}` }));
    for (const width of [280, 360, 640, 840, 1000, 1100]) {
      const layout = pickerLayout(players, width);
      assert.equal(new Set(layout.slots.map((slot) => slot.id)).size, count);
      for (const slot of layout.slots) {
        const x = slot.x - layout.size / 2, y = slot.y - layout.size / 2;
        assert.ok(Math.abs(normalizeAngle(Math.atan2(y, x) * 180 / Math.PI) - normalizeAngle(slot.angle)) < 1e-8);
        assert.ok(Math.abs(Math.hypot(x, y) - slot.radius) < 1e-8);
        assert.ok(slot.driveDistance > 0 && slot.driveDistance < slot.radius);
        assert.ok(Math.abs(slot.driveDistance + layout.carWidth * .48 - (slot.radius - layout.avatarWidth * .2)) < 1e-8);
      }
      const rifleRadius = Math.max(Math.hypot(layout.rifleWidth * .55, layout.rifleWidth / 7.2), Math.hypot(layout.rifleWidth * .45 + 12, layout.rifleWidth / 7.2));
      assert.ok(rifleRadius <= layout.clearRadius, `Rifle clearance: ${count} players at ${width}`);
      assert.ok(Math.hypot(layout.carWidth / 2, layout.carWidth * .58333 / 2) < layout.clearRadius);
      assert.deepEqual(pickerLayout(players, width).slots, layout.slots);
    }
  }
});
test('rotation ends at the server target at any starting angle without choosing another player', () => {
  for (const start of [-90, 0, 180, 720, 1777]) for (const target of [-90, 11.25, 45, 180, 270]) {
    const end = rotationTo(start, target);
    assert.equal(normalizeAngle(end), normalizeAngle(target)); assert.ok(end >= start + 1800);
  }
  assert.throws(() => rotationTo(NaN, 0));
  assert.throws(() => pickerLayout([{ player_id: 'a' }, { player_id: 'a' }]));
});
test('typical laptop rosters use larger portraits and tighter player positions within the same screen space', () => {
  for (const count of [4, 6, 8]) {
    const layout = pickerLayout(Array.from({ length:count }, (_, i) => ({ player_id:`p${i}` })), 1100);
    const fitted = fitPickerArena(layout, 1100, 500);
    assert.ok(layout.avatarWidth * fitted.scale >= 75, `${count} players should have prominent portraits`);
    assert.ok(layout.radii[0] / layout.size < .34, `${count} players should sit farther inward`);
    assert.ok(layout.rifleWidth * fitted.scale >= 90, `${count} players should retain visible center artwork`);
    assert.equal(fitted.size, 500);
  }
});
test('player cards and two-line names stay separated and inside the arena for every roster size', () => {
  for (let count = 2; count <= 64; count++) {
    const players = Array.from({ length: count }, (_, i) => ({ player_id: `p${i}` }));
    const reference = pickerLayout(players, 1100);
    if (count <= 20) assert.equal(reference.radii.length, 1);
    for (const width of [280, 640, 1100]) {
      const layout = pickerLayout(players, width);
      const cards = layout.slots.map((slot) => ({
        left: slot.x - layout.nameWidth / 2 - 12,
        right: slot.x + layout.nameWidth / 2 + 12,
        top: slot.y - layout.avatarHeight / 2 - 12,
        bottom: slot.y + layout.avatarHeight / 2 + 6 + layout.nameSize * 2.6 + 12,
      }));
      assert.deepEqual(layout.slots.map((slot) => slot.angle), reference.slots.map((slot) => slot.angle));
      for (let i = 0; i < cards.length; i++) {
        const a = cards[i];
        assert.ok(a.left >= 0 && a.top >= 0 && a.right <= layout.size && a.bottom <= layout.size, `Card bounds: ${count} players at ${width}`);
        for (let j = i + 1; j < cards.length; j++) {
          const b = cards[j];
          assert.ok(a.right <= b.left + 1e-8 || b.right <= a.left + 1e-8 || a.bottom <= b.top + 1e-8 || b.bottom <= a.top + 1e-8, `Cards ${i}/${j} overlap: ${count} players at ${width}`);
        }
      }
    }
  }
});
test('the entire arena fits narrow and short spaces for all roster sizes', () => {
  for (let count = 2; count <= 64; count++) {
    const players = Array.from({ length: count }, (_, i) => ({ player_id: `p${i}` }));
    for (const [width, height] of [[240, 160], [360, 320], [1100, 260], [1400, 700]]) {
      const layout = pickerLayout(players, width);
      const fitted = fitPickerArena(layout, width, height);
      assert.ok(fitted.size <= width + 1e-8 && fitted.size <= height + 1e-8);
      for (const slot of layout.slots) {
        assert.ok((slot.x + layout.nameWidth / 2 + 12) * fitted.scale <= fitted.size);
        assert.ok((slot.y + layout.avatarHeight / 2 + 6 + layout.nameSize * 2.6 + 12) * fitted.scale <= fitted.size);
      }
    }
  }
});
test('view fitting reserves header, controls and padding, responds to height changes, and never grows on page scroll', () => {
  const globals = ['getComputedStyle', 'innerHeight', 'visualViewport', 'scrollY'];
  const descriptors = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  try {
    Object.defineProperty(globalThis, 'getComputedStyle', { configurable:true, value:() => ({ paddingLeft:'8px', paddingRight:'8px', paddingTop:'8px', paddingBottom:'8px' }) });
    for (const [key, value] of [['innerHeight', 800], ['visualViewport', undefined], ['scrollY', 0]]) Object.defineProperty(globalThis, key, { configurable:true, writable:true, value });
    const element = () => ({ style:{ setProperty() {} }, dataset:{} });
    const stage = element(), arena = element(), orbits = element();
    const frame = { clientWidth:600, getBoundingClientRect:() => ({ width:600, height:200 }) };
    const view = Object.create(PickerView.prototype);
    view.game = {}; view.participants = Array.from({ length:32 }, (_, i) => ({ player_id:`p${i}` }));
    view.nodes = new Map(view.participants.map((row) => [row.player_id, element()]));
    view.root = { hidden:false, getBoundingClientRect:() => ({ top:250 - globalThis.scrollY, height:380 }) };
    view.$ = (selector) => ({ '.picker-scroll':frame, '.picker-stage':stage, '.arena':arena, '.picker-orbits':orbits })[selector];
    view.measure();
    assert.equal(parseFloat(stage.style.height), 338); // 800 - 250 header - 180 controls - 16 padding - 16 margin.
    const initialSize = stage.style.height;
    globalThis.scrollY = 150; view.measure();
    assert.equal(stage.style.height, initialSize);
    globalThis.innerHeight = 600; view.measure();
    assert.equal(parseFloat(stage.style.height), 138);
    assert.equal(stage.style.width, stage.style.height);
    assert.match(arena.style.transform, /^scale\(/);
  } finally {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
test('animation cancellation prevents its final position being applied and cancels its handle', async () => {
  const control = new AbortController(); let reject, cancelled = 0;
  const element = { style: { transform: 'rotate(0deg)' }, animate() { return { finished: new Promise((_, fail) => { reject = fail; }), cancel() { cancelled++; reject(new DOMException('Cancelled', 'AbortError')); } }; } };
  const pending = animate(element, [{ transform: 'rotate(0deg)' }, { transform: 'rotate(90deg)' }], { duration: 4200 }, control.signal);
  control.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(element.style.transform, 'rotate(0deg)'); assert.ok(cancelled > 0);
});
test('cancelled pauses cannot resume the following animation phase', async () => {
  const control = new AbortController(); const pause = wait(1000, control.signal); control.abort();
  await assert.rejects(pause, { name: 'AbortError' });
});
