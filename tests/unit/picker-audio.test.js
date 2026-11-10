import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PickerAudio } from '../../src/features/teams/audio.js';

function fixture() {
  const nodes = [], storage = new Map(); let resumes = 0, creations = 0, blocked = false;
  const parameter = () => ({ value: 0, events: [], setValueAtTime(value, time) { this.events.push(['set', value, time]); }, setTargetAtTime(value, time) { this.events.push(['target', value, time]); }, exponentialRampToValueAtTime(value, time) { this.events.push(['exponential', value, time]); }, linearRampToValueAtTime(value, time) { this.events.push(['linear', value, time]); }, cancelScheduledValues() {} });
  const node = (kind) => {
    const value = { kind, connections: [], starts: [], stops: [], gain: parameter(), frequency: parameter(), connect(other) { this.connections.push(other); }, disconnect() {}, start(time) { this.starts.push(time); }, stop(time) { this.stops.push(time); } };
    nodes.push(value); return value;
  };
  const context = { state: 'suspended', currentTime: 10, sampleRate: 44100, destination: {},
    async resume() { resumes++; if (blocked) throw Error('Blocked'); this.state = 'running'; },
    createGain: () => node('gain'), createBiquadFilter: () => node('filter'), createOscillator: () => node('oscillator'), createBufferSource: () => node('noise'),
    createBuffer: (_, length) => ({ getChannelData: () => new Float32Array(length) }),
    createDynamicsCompressor: () => { const value = node('limiter'); for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) value[key] = parameter(); return value; },
  };
  const options = { contextFactory: () => { creations++; return context; }, storage: () => ({ getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }) };
  const audio = new PickerAudio(options);
  return { audio, nodes, context, options, storage, get resumes() { return resumes; }, get creations() { return creations; }, block(value) { blocked = value; } };
}

test('audio waits for a user action and resumes a suspended context before playback', async () => {
  const f = fixture(); assert.equal(f.creations, 0);
  assert.equal(await f.audio.unlock(), true);
  assert.equal(f.creations, 1); assert.equal(f.resumes, 1);
  f.audio.shot(); assert.equal(f.nodes.filter((node) => node.starts.length).length, 2);
  f.context.state = 'suspended'; await f.audio.unlock(); assert.equal(f.resumes, 2);
  assert.ok(f.nodes.some((node) => node.kind === 'limiter' && node.connections.includes(f.context.destination)));
  f.audio.stopAll();
});
test('each mode has a slowing spinning sound and cleanup stops all sources', async () => {
  const f = fixture(); await f.audio.unlock(); f.audio.startSpin('rifle'); f.audio.tick();
  let motors = f.nodes.filter((node) => node.kind === 'oscillator');
  assert.equal(motors[0].type, 'triangle');
  assert.ok(motors[0].frequency.events.some(([kind, value, time]) => kind === 'exponential' && value === 55 && time === 14.2));
  assert.equal(motors[1].type, 'square');
  f.audio.stopSpin(); assert.equal(f.audio.spin, null);
  assert.ok(motors[0].stops.includes(10.06));
  f.audio.startSpin('trackmania', 2);
  motors = f.nodes.filter((node) => node.kind === 'oscillator');
  assert.equal(motors.at(-1).type, 'sawtooth');
  assert.ok(motors.at(-1).frequency.events.some(([kind, value, time]) => kind === 'exponential' && value === 80 && time === 12));
  f.audio.stopAll(); assert.equal(f.audio.sources.size, 0);
});
test('mute stops current sound, blocks future effects, and persists for a later game in the tab', async () => {
  const f = fixture(); await f.audio.unlock(); f.audio.startSpin('rifle'); f.audio.setEnabled(false);
  const count = f.nodes.length;
  f.audio.shot(); f.audio.drive(); f.audio.impact('trackmania'); f.audio.startSpin('trackmania');
  assert.equal(f.nodes.length, count);
  assert.ok(f.audio.output.gain.events.some(([kind, value]) => kind === 'target' && value === 0));
  assert.equal(new PickerAudio(f.options).enabled, false);
  assert.equal(f.audio.spin, null);
});
test('blocked audio is visible and re-enabling sound restores the current mode without a draw', async () => {
  const f = fixture(); f.block(true);
  assert.equal(await f.audio.unlock(), false); assert.match(f.audio.error, /sound off and on/);
  f.block(false); await f.audio.preview('trackmania');
  assert.equal(f.audio.error, ''); assert.equal(f.audio.enabled, true);
  assert.ok(f.nodes.some((node) => node.kind === 'oscillator' && node.type === 'sawtooth' && node.starts.length));
  assert.equal(f.audio.timers.size, 1);
  f.audio.stopAll(); assert.equal(f.audio.timers.size, 0);
});
test('unavailable audio and blocked storage do not prevent initialization or retry', async () => {
  const audio = new PickerAudio({ contextFactory() { throw Error('Not supported'); }, storage() { throw Error('Storage disabled'); } });
  assert.equal(audio.enabled, true); assert.equal(await audio.unlock(), false);
  assert.match(audio.error, /sound off and on/); audio.setEnabled(false); audio.stopAll();
});
