'use strict';
// Graph-contract tests using a scheduling recorder, NOT a Web Audio renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = {window: {}, console, Blob, setTimeout};
for (const file of ['zeros', 'composition', 'audio']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, `../public/js/${file}.js`), 'utf8'), sandbox);
}
const C = sandbox.window.RM.composition, A = sandbox.window.RM.audio;
class Param {
  constructor() { this.value = 0; this.events = []; }
  setValueAtTime(value, time) { this.events.push({kind: 'set', value, time}); }
  linearRampToValueAtTime(value, time) { this.events.push({kind: 'linear', value, time}); }
  exponentialRampToValueAtTime(value, time) { assert(value > 0); this.events.push({kind: 'exp', value, time}); }
}
class Node {
  constructor(kind) {
    this.kind = kind; this.connections = []; this.disconnected = false;
    for (const p of ['gain', 'frequency', 'detune', 'pan', 'Q', 'threshold', 'knee', 'ratio', 'attack', 'release']) this[p] = new Param();
  }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.disconnected = true; }
  start(time) { this.startTime = time; }
  stop(time) { if (time !== undefined) this.stopTime = time; this.stopped = true; }
  setPeriodicWave(wave) { this.wave = wave; }
}
class Context {
  constructor(currentTime) { this.currentTime = currentTime; this.sampleRate = 44100; this.nodes = []; this.destination = new Node('destination'); }
  node(kind) { const node = new Node(kind); this.nodes.push(node); return node; }
  createGain() { return this.node('gain'); }
  createOscillator() { return this.node('oscillator'); }
  createStereoPanner() { return this.node('pan'); }
  createAnalyser() { return this.node('analyser'); }
  createConvolver() { return this.node('convolver'); }
  createBiquadFilter() { return this.node('filter'); }
  createDynamicsCompressor() { return this.node('compressor'); }
  createPeriodicWave(real, imag) { return {real, imag}; }
  createBuffer(channels, length, rate) {
    const data = Array.from({length: channels}, () => new Float32Array(length));
    return {numberOfChannels: channels, length, sampleRate: rate, getChannelData: ch => data[ch]};
  }
}
for (const offset of [0, 2, 15, 72.5, 159.8, 170, 179.95]) {
  const ctx = new Context(1000), graph = A.buildGraph(ctx, ctx.destination, offset);
  assert.equal(graph.time(), offset);
  ctx.currentTime += .01;
  assert(Math.abs(graph.time() - offset - .01) < 1e-10);
  const sources = ctx.nodes.filter(n => n.kind === 'oscillator');
  const primes = C.primes.filter(e => e.T >= offset).length;
  const glints = C.glints.filter(e => e.T >= offset).length;
  assert.equal(sources.length, 302 + 2 * (primes + glints));
  for (const node of ctx.nodes) {
    if (node.kind === 'oscillator') {
      assert(node.startTime >= 1000);
      assert(node.stopTime > node.startTime && node.stopTime <= 1000 + 180 - offset + 1e-8);
    }
    for (const value of Object.values(node)) if (value instanceof Param) {
      let previous = 1000;
      for (const event of value.events) {
        assert(Number.isFinite(event.value));
        assert(event.time >= previous - 1e-8, `Automation time ordering at offset ${offset}`);
        assert(event.time <= 1000 + 180 - offset + 1e-8);
        previous = event.time;
      }
    }
  }
  const analyser = ctx.nodes.find(n => n.kind === 'analyser');
  const master = ctx.nodes.find(n => n.connections.includes(analyser));
  assert.equal(master.gain.events[0].value, C.masterAt(offset));
  assert.equal(master.gain.events[0].time, 1000);
  assert.equal(graph.analyser.fftSize, 2048);
  // Confirm resumed chord gain and LFO phase match the pure composition.
  const chord = ctx.nodes.find(n => n.kind === 'filter');
  const envelopes = ctx.nodes.filter(n => n.connections.includes(chord));
  assert.equal(envelopes.length, 100);
  envelopes.forEach((node, i) => {
    const v = C.voices[i], startT = Math.max(offset, v.T);
    const expected = v.baseGain * C.clamp((startT - v.T) / 3.5, 0, 1);
    assert.equal(node.gain.events[0].value, expected);
    const tremolo = ctx.nodes.find(n => n.connections.includes(node));
    const depth = ctx.nodes.find(n => n.connections.includes(tremolo.gain));
    const lfo = ctx.nodes.find(n => n.connections.includes(depth));
    const initialLfo = tremolo.gain.value + depth.gain.value * lfo.wave.real[1];
    assert(Math.abs(expected * initialLfo / v.baseGain - C.voiceGainAt(i, startT)) < 1e-7);
  });
  graph.dispose(); graph.dispose();
  assert(ctx.nodes.every(n => n.disconnected));
}
const ctx = new Context(0), buffer = ctx.createBuffer(2, 4, 44100);
buffer.getChannelData(0).set([0, .5, -.5, 1]);
buffer.getChannelData(1).set([-.25, .25, 0, -1]);
assert.equal(A.measurePeak(buffer), 1);
(async () => {
  const blob = A.encodeWav(buffer, Math.pow(10, -1 / 20));
  const view = new DataView(await blob.arrayBuffer());
  const text = (start, length) => String.fromCharCode(...new Uint8Array(view.buffer, start, length));
  assert.equal(text(0, 4), 'RIFF'); assert.equal(text(8, 4), 'WAVE');
  assert.equal(view.byteLength, 60); assert.equal(view.getUint32(4, true), 52);
  assert.equal(view.getUint16(20, true), 1); assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 16);
  assert.equal(view.getInt16(44, true), 0); assert(view.getInt16(46, true) < 0);
  let peak = 0;
  for (let offset = 44; offset < view.byteLength; offset += 2) peak = Math.max(peak, Math.abs(view.getInt16(offset, true)) / 32768);
  assert(20 * Math.log10(peak) <= -1);
  buffer.getChannelData(0)[0] = NaN;
  assert.throws(() => A.measurePeak(buffer), /non-finite/);
  console.log('PASS: graph scheduling at 7 offsets; no past events; seek envelopes/LFO phases; disposal; stereo PCM16 WAV header/interleaving/ceiling.');
  console.log('Scheduling uses a test double. Synthetic WAV samples are tested; no real audio was rendered.');
})().catch(error => { console.error(error); process.exitCode = 1; });
