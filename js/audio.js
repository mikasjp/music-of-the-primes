(function () {
  'use strict';
  const RM = window.RM = window.RM || {};
  const C = RM.composition;
  const TAU = 2 * Math.PI;
  const irCache = new Map();
  const CEILING = Math.pow(10, -1 / 20);
  // Phones/tablets and low-core devices get a lighter profile (read by visual.js and main.js too).
  RM.lowPower = (() => {
    try { return /[?&]lite=1/.test(location.search) || matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4; }
    catch (_) { return false; }
  })();

  function impulse(ctx) {
    if (irCache.has(ctx.sampleRate)) return irCache.get(ctx.sampleRate);
    const length = Math.ceil(ctx.sampleRate * 4.5);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    const random = C.mulberry32(0x5EED ^ 0x1A2B);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      const delay = Math.round(ctx.sampleRate * (0.025 + ch * 0.007));
      let smoothNoise = 0;
      for (let i = delay; i < length; i++) {
        smoothNoise = 0.55 * smoothNoise + 0.45 * (random() * 2 - 1);
        data[i] = smoothNoise * Math.exp(-7 * (i - delay) / (length - delay));
      }
    }
    irCache.set(ctx.sampleRate, buffer);
    return buffer;
  }

  // options.lazy: create bell/glint nodes just ahead of time (live playback) instead of all
  // ~1,100 events up front, which keeps thousands of idle nodes out of the render graph.
  function buildGraph(ctx, destination, offsetT = 0, options = {}) {
    offsetT = C.clamp(offsetT, 0, C.duration);
    const now = ctx.currentTime, end = now + C.duration - offsetT;
    const at = T => now + Math.max(0, T - offsetT);
    const nodes = [], sources = [];
    const own = node => { nodes.push(node); return node; };
    function gain(value, target) {
      const node = own(ctx.createGain());
      node.gain.value = value;
      if (target) node.connect(target);
      return node;
    }
    function osc(frequency, target, start, stop, detune = 0, phase = 0, transient = null) {
      const node = transient ? transient(ctx.createOscillator()) : own(ctx.createOscillator());
      node.frequency.value = frequency;
      node.detune.value = detune;
      if (phase) node.setPeriodicWave(ctx.createPeriodicWave(
        new Float32Array([0, Math.sin(phase)]), new Float32Array([0, Math.cos(phase)]),
        {disableNormalization: true}));
      node.connect(target);
      node.start(start);
      node.stop(Math.max(start + 0.001, stop));
      if (!transient) sources.push(node);
      return node;
    }
    function pan(value, target, transient = null) {
      const node = transient ? transient(ctx.createStereoPanner()) : own(ctx.createStereoPanner());
      node.pan.value = C.clamp(value, -1, 1);
      node.connect(target);
      return node;
    }
    const volume = gain(1, destination);
    const analyser = own(ctx.createAnalyser());
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.85;
    analyser.connect(volume);
    const master = gain(C.masterAt(offsetT), analyser);
    master.gain.setValueAtTime(C.masterAt(offsetT), now);
    if (offsetT < 165) master.gain.setValueAtTime(0.7, at(165));
    master.gain.linearRampToValueAtTime(0, end);
    const compressor = own(ctx.createDynamicsCompressor());
    compressor.threshold.value = -14;
    compressor.knee.value = 16;
    compressor.ratio.value = 2.5;
    compressor.attack.value = 0.012;
    compressor.release.value = 0.3;
    compressor.connect(master);
    const reverb = own(ctx.createConvolver());
    reverb.buffer = impulse(ctx);
    reverb.connect(compressor);
    const chord = own(ctx.createBiquadFilter());
    chord.type = 'lowpass';
    chord.Q.value = 0.45;
    const cutoffAt = T => 1800 * Math.pow(6000 / 1800, C.clamp((T - 15) / 145, 0, 1));
    chord.frequency.setValueAtTime(cutoffAt(offsetT), now);
    if (offsetT < 15) chord.frequency.setValueAtTime(1800, at(15));
    if (offsetT < 160) chord.frequency.exponentialRampToValueAtTime(6000, at(160));
    chord.connect(compressor);
    chord.connect(gain(0.35, reverb));
    const bells = gain(1, compressor);
    bells.connect(gain(0.55, reverb));
    const glints = gain(1, compressor);
    glints.connect(gain(0.65, reverb));

    C.voices.forEach(v => {
      if (offsetT >= C.duration) return;
      const startT = Math.max(offsetT, v.T), start = at(startT);
      // Envelope and multiplicative LFO are separate gains. A pair of half-
      // amplitude sines sums to one baseGain, not twice the specified weight.
      const envelope = gain(0, chord);
      envelope.gain.setValueAtTime(v.baseGain * C.clamp((startT - v.T) / 3.5, 0, 1), start);
      if (startT < v.T + 3.5) envelope.gain.linearRampToValueAtTime(v.baseGain, at(v.T + 3.5));
      const tremolo = gain(1 - v.lfoDepth / 2, envelope);
      const lfoDepth = gain(v.lfoDepth / 2);
      lfoDepth.connect(tremolo.gain);
      osc(v.lfoRate, lfoDepth, start, end, 0, v.lfoPhase + TAU * v.lfoRate * startT);
      // options.lite: one oscillator per voice (no chorus pair) — ~100 fewer oscillators and panners.
      for (const side of options.lite ? [0] : [-1, 1]) {
        const detune = side * v.detune;
        const frequency = v.frequency * Math.pow(2, detune / 1200);
        osc(v.frequency, gain(options.lite ? 1 : 0.5, pan(v.pan + side * 0.08, tremolo)), start, end, detune,
          (TAU * frequency * startT) % TAU);
      }
    });

    if (offsetT < C.duration) {
      const bassEnvelope = gain(1, compressor);
      bassEnvelope.connect(gain(0.22, reverb));
      // Sample the pure swell function at 20 Hz, including the exact seek value.
      bassEnvelope.gain.setValueAtTime(C.bassAt(offsetT), now);
      for (let T = offsetT + 0.05; T < C.duration; T += 0.05) {
        bassEnvelope.gain.linearRampToValueAtTime(C.bassAt(T), at(T));
      }
      bassEnvelope.gain.linearRampToValueAtTime(C.bassAt(C.duration), end);
      osc(65.4064, gain(0.065, bassEnvelope), now, end, 0, TAU * 65.4064 * offsetT % TAU);
      osc(130.8128, gain(0.018, bassEnvelope), now, end, 0, TAU * 130.8128 * offsetT % TAU);
    }

    // Live mode: one-shot nodes are tracked in a Set and released when the carrier ends.
    const live = new Set();
    function fm(event, bus, ratio, index, amplitude, attack, decay) {
      if (event.T < offsetT || event.T >= C.duration) return;
      const start = at(event.T), stop = Math.min(end, start + decay + 0.06);
      const local = [];
      const transient = options.lazy ? node => { local.push(node); return node; } : null;
      const g = (value, target) => {
        if (!transient) return gain(value, target);
        const node = transient(ctx.createGain()); node.gain.value = value;
        if (target) node.connect(target);
        return node;
      };
      const amp = g(0, pan(event.pan, bus, transient));
      amp.gain.setValueAtTime(0, start);
      amp.gain.linearRampToValueAtTime(amplitude, start + attack);
      amp.gain.exponentialRampToValueAtTime(amplitude * Math.exp(-6), Math.min(stop, start + decay));
      amp.gain.linearRampToValueAtTime(0, stop);
      const carrier = osc(event.frequency, amp, start, stop, 0, 0, transient);
      const modulation = g(event.frequency * index);
      modulation.connect(carrier.frequency);
      modulation.gain.setValueAtTime(event.frequency * index, start);
      modulation.gain.exponentialRampToValueAtTime(0.001, Math.min(stop, start + 0.4));
      const modulator = osc(event.frequency * ratio, modulation, start, stop, 0, 0, transient);
      if (transient) {
        const entry = {local, sources: [carrier, modulator]};
        live.add(entry);
        carrier.onended = () => { local.forEach(node => node.disconnect()); live.delete(entry); };
      }
    }
    const bell = e => fm(e, bells, 3.5, 1.1 * (e.twinSecond ? 1.4 : 1), 0.075, 0.004, 1.8);
    const glint = e => fm(e, glints, 1, 0.18, 0.018, 0.005, 1.2);
    let timer = null;
    if (options.lazy) {
      const events = C.primes.map(e => [e, bell]).concat(C.glints.map(e => [e, glint]))
        .filter(([e]) => e.T >= offsetT && e.T < C.duration).sort((a, b) => a[0].T - b[0].T);
      let cursor = 0;
      const pump = () => {
        const horizon = offsetT + (ctx.currentTime - now) + 1.5;
        while (cursor < events.length && events[cursor][0].T < horizon) { const [e, play] = events[cursor++]; play(e); }
        if (cursor >= events.length && timer) { clearInterval(timer); timer = null; }
      };
      pump();
      timer = setInterval(pump, 250);
    } else {
      C.primes.forEach(bell);
      C.glints.forEach(glint);
    }
    let disposed = false;
    return {
      analyser, volume, startedAt: now, offsetT,
      time: () => C.clamp(offsetT + (ctx.currentTime - now), 0, C.duration),
      dispose() {
        if (disposed) return;
        disposed = true;
        if (timer) { clearInterval(timer); timer = null; }
        live.forEach(({local, sources: one}) => {
          one.forEach(source => { source.onended = null; try { source.stop(); } catch (_) { /* Already stopped. */ } });
          local.forEach(node => node.disconnect());
        });
        live.clear();
        sources.forEach(source => { try { source.stop(); } catch (_) { /* Already stopped. */ } });
        nodes.forEach(node => node.disconnect());
      }
    };
  }

  function measurePeak(buffer) {
    let peak = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    if (!Number.isFinite(peak)) throw new Error('The audio render contains non-finite samples.');
    return peak;
  }

  function encodeWav(buffer, scale = 1) {
    const channels = buffer.numberOfChannels;
    const bytes = buffer.length * channels * 2;
    const view = new DataView(new ArrayBuffer(44 + bytes));
    const str = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    str(0, 'RIFF'); view.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, channels, true); view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, bytes, true);
    const data = Array.from({length: channels}, (_, ch) => buffer.getChannelData(ch));
    for (let i = 0, offset = 44; i < buffer.length; i++) {
      for (let ch = 0; ch < channels; ch++, offset += 2) {
        const sample = C.clamp(data[ch][i] * scale, -1, 1);
        // Truncate toward zero so 16-bit quantization cannot exceed the ceiling.
        view.setInt16(offset, Math.trunc(sample * 32767), true);
      }
    }
    return new Blob([view.buffer], {type: 'audio/wav'});
  }

  async function renderWav(onProgress = () => {}) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) throw new Error('Offline audio rendering is unavailable in this browser.');
    const offline = new Offline(2, 44100 * C.duration, 44100);
    const graph = buildGraph(offline, offline.destination, 0);
    const suspensions = [];
    onProgress(0);
    // Register all suspension points before startRendering; never schedule a
    // suspension in the already-rendered past from a delayed UI callback.
    if (typeof offline.suspend === 'function') {
      for (let t = 5; t < C.duration; t += 5) {
        suspensions.push(offline.suspend(t).then(() => {
          onProgress(Math.floor(t / C.duration * 95));
          return offline.resume();
        }));
      }
    }
    try {
      const rendering = offline.startRendering();
      const [buffer] = await Promise.all([rendering, ...suspensions]);
      onProgress(96);
      await new Promise(resolve => setTimeout(resolve, 0));
      const rawPeak = measurePeak(buffer);
      const scale = rawPeak > CEILING ? CEILING / rawPeak : 1;
      // Apply attenuation to the actual rendered samples, then measure again.
      if (scale < 1) {
        for (let ch = 0; ch < 2; ch++) {
          const samples = buffer.getChannelData(ch);
          for (let i = 0; i < samples.length; i++) samples[i] *= scale * (1 - 1e-7);
        }
      }
      const peak = measurePeak(buffer);
      if (peak > CEILING) throw new Error('The rendered audio exceeded the export ceiling.');
      onProgress(98);
      await new Promise(resolve => setTimeout(resolve, 0));
      const blob = encodeWav(buffer);
      const peakDb = peak ? 20 * Math.log10(peak) : -Infinity;
      console.info(`[RM] WAV: 180 s, 44100 Hz, stereo PCM16; raw peak ${rawPeak.toFixed(6)}; exported peak ${peakDb.toFixed(3)} dBFS.`);
      onProgress(100);
      return {blob, peakDb, rawPeak, scale};
    } finally {
      graph.dispose();
    }
  }

  RM.audio = {buildGraph, renderWav, encodeWav, measurePeak};
})();
