'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/zeros.js'), 'utf8'), sandbox);
const {create, mulberry32} = require('../public/js/composition.js');
const zeros = Array.from(sandbox.window.RM.ZETA_ZEROS);
const c = create(zeros), again = create(zeros);
assert.equal(zeros.length, 1000);
for (let i = 1; i <= 18000; i++) assert(c.camera(i / 100) > c.camera((i - 1) / 100), `camera at ${i / 100}`);
c.crossTime.forEach((T, i) => assert(Math.abs(c.camera(T) - zeros[i]) < 1e-6));
assert(c.crossTime[0] >= 0.5 && c.crossTime[0] <= 2);
assert(Math.abs(c.crossTime[99] - 15) <= 0.5);
assert(Math.abs(c.crossTime[999] - 160) <= 0.5);
assert.deepEqual(c.primes.slice(0, 6).map(e => e.p), [2, 3, 5, 7, 11, 13]);
assert.equal(c.primes.filter(e => e.p < 180).length, 41);
assert(c.primes.at(-1).p <= 1093);
const trialPrime = n => n >= 2 && Array.from({length: Math.max(0, Math.floor(Math.sqrt(n)) - 1)}, (_, i) => i + 2).every(d => n % d);
assert.deepEqual(c.primes.map(e => e.p), Array.from({length: 1092}, (_, i) => i + 2).filter(trialPrime));
for (const [a, b] of [[11, 13], [17, 19], [29, 31]]) {
  const first = c.primes.find(e => e.p === a), second = c.primes.find(e => e.p === b);
  assert.equal(first.twinOf, b);
  assert.equal(first.twinSecond, false);
  assert.equal(second.twinOf, a);
  assert.equal(second.twinSecond, true);
  assert(Math.abs(second.T - first.T - 0.3) < 1e-12);
  assert.equal(second.pan, -first.pan);
}
assert.equal(c.primes.find(e => e.p === 23).twinOf, null);
assert.notEqual(c.primes.find(e => e.p === 29).twinOf, 23);
assert.equal(c.voices[0].frequency, 130.8128);
assert(Math.abs(c.voices[99].frequency - 2188.8) < 1);
c.glints.forEach(g => assert(g.frequency >= 523.25 && g.frequency < 2093));
assert.deepEqual(c.voices, again.voices);
assert.deepEqual(c.glints, again.glints);
assert.deepEqual(c.primes, again.primes);
assert.deepEqual(c.crossTime, again.crossTime);
const r1 = mulberry32(0x5EED), r2 = mulberry32(0x5EED);
for (let i = 0; i < 1000; i++) assert.equal(r1(), r2());
assert.notDeepEqual(c.voices, create(zeros, 42).voices);
assert.equal(c.viewSpan(160), 40);
assert.equal(c.viewSpan(176), 140);
assert.equal(c.camera(0), 0);
assert.equal(c.camera(15), zeros[99] + 1);
assert.equal(c.camera(160), zeros[999] + 1);
assert.equal(c.camera(180), zeros[999] + 12);
assert.equal(c.act(15).name, 'Ascent');
assert.equal(c.act(160).name, 'Horizon');
assert.equal(c.lastPrimeBefore(0), null);
assert.equal(c.lastPrimeBefore(1.3).p, 2);
assert.equal(c.primesBetween(1.3, 1.45)[0].p, 3);
for (let i = 0; i < 1000; i++) {
  assert.equal(c.voiceGainAt(i, c.crossTime[i] - 0.01), 0);
  for (const age of [0, 0.003, 0.5, 2, 4, 20]) {
    const gain = c.voiceGainAt(i, c.crossTime[i] + age);
    assert(gain >= 0 && gain <= 1);
  }
}
// Two chorus oscillators are each halved, so their combined bound is baseGain.
// Each LFO ranges [1-depth, 1]. Bass is 0.065 + 0.018 at maximum swell.
const chordBound = c.voices.reduce((sum, v) => sum + v.baseGain, 0);
const bassBound = 0.065 + 0.018;
console.log(`Analytical dry chord bound: ${chordBound.toFixed(6)}; with bass: ${(chordBound + bassBound).toFixed(6)}`);
console.log(`Before compression/reverb, at master 0.7: ${((chordBound + bassBound) * 0.7).toFixed(6)}. This is not a rendered peak measurement.`);
console.log(`Crossings: T1=${c.crossTime[0].toFixed(6)}, T100=${c.crossTime[99].toFixed(6)}, T1000=${c.crossTime[999].toFixed(6)} s`);
console.log(`PASS: 18,000 monotonic steps; 1,000 inverses; ${c.primes.length} primes; twins; pitches; envelopes; deterministic parameters.`);
