(function () {
  'use strict';
  const RM = window.RM = window.RM || {};
  const C = RM.composition;
  const $ = id => document.getElementById(id);
  let ctx = null, graph = null, playing = false, begun = false, offset = 0;
  let volume = .75, muted = false, rendering = false, scrubbing = false;
  let queue = Promise.resolve(), lastActivity = performance.now(), lastFrame = 0, lastHud = -Infinity;
  let lastPrime = null, lastCount = -1, lastAct = '', statusTimer = 0, returnFocus = null;
  let introTimer = 0, autoHidden = [];
  const bins = new Uint8Array(1024);
  const intro = $('intro'), drawer = $('info-drawer');
  const subscript = value => String(value).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[Number(d)]);
  const timeText = T => `${Math.floor(T / 60)}:${String(Math.floor(T % 60)).padStart(2, '0')}`;
  const clock = () => graph ? graph.time() : offset;

  function notice(message, persistent = false) {
    clearTimeout(statusTimer);
    $('status').textContent = message;
    $('status').hidden = !message;
    if (message && !persistent) statusTimer = setTimeout(() => { $('status').hidden = true; }, 7000);
  }
  function activity() {
    lastActivity = performance.now();
    document.body.classList.remove('immersive');
    // Hidden controls leave the tab order, then return on the first key/pointer
    // activity. Existing focused controls prevent auto-hiding entirely.
    autoHidden.forEach(el => el.removeAttribute('tabindex'));
    autoHidden = [];
  }
  function syncTransport() {
    $('play-icon').setAttribute('href', playing ? '#icon-pause' : clock() >= 180 ? '#icon-replay' : '#icon-play');
    $('play').setAttribute('aria-label', playing ? 'Pause' : clock() >= 180 ? 'Replay' : 'Play');
    document.body.classList.toggle('playing', playing);
    activity();
  }
  function ensureContext() {
    if (!ctx) {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('Web Audio is unavailable in this browser. Try a current browser to listen.');
      // iOS: without this, Web Audio is muted when the ring/silent switch is on.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { /* unsupported */ }
      ctx = new Audio({latencyHint: 'playback'});
      ctx.addEventListener('statechange', () => {
        if (ctx.state === 'interrupted' || ctx.state === 'closed') {
          offset = clock(); playing = false; syncTransport();
          notice('Audio was interrupted. Press Play to continue.');
        }
      });
    }
    return ctx;
  }
  function setUserVolume() {
    const amount = muted ? 0 : volume;
    if (graph && ctx) graph.volume.gain.setTargetAtTime(amount, ctx.currentTime, .025);
    $('volume').value = volume;
    $('volume').style.setProperty('--progress', `${volume * 100}%`);
    $('volume').setAttribute('aria-valuetext', `${Math.round(volume * 100)} percent`);
    $('mute').setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    $('mute').setAttribute('aria-pressed', String(muted));
    $('volume-icon').setAttribute('href', muted || volume === 0 ? '#icon-muted' : '#icon-volume');
  }
  function dismissIntro() {
    clearTimeout(introTimer);
    intro.classList.add('leaving');
    intro.inert = true;
    introTimer = setTimeout(() => { intro.hidden = true; }, 1250);
  }
  function enqueue(task) {
    queue = queue.then(task).catch(error => {
      playing = false;
      syncTransport();
      notice(error.message || 'Audio could not start. Please try again.');
    });
    return queue;
  }
  function prepareAudio() {
    // Called synchronously from a trusted interaction, before queued awaits.
    try { ensureContext(); return true; }
    catch (error) { notice(error.message); return false; }
  }
  async function togglePlayback() {
    if (playing) {
      await ctx.suspend(); offset = clock(); playing = false;
    } else {
      if (!ctx) ensureContext();
      if (clock() >= 180) { if (graph) graph.dispose(); graph = null; offset = 0; visual.reset(0, true); }
      if (!graph) {
        await ctx.suspend();
        graph = RM.audio.buildGraph(ctx, ctx.destination, offset, {lazy: true, lite: RM.lowPower});
        graph.volume.gain.value = muted ? 0 : volume;
      }
      await ctx.resume();
      playing = true; begun = true;
      document.body.classList.add('begun');
      dismissIntro();
      // A vanished Begin button must not retain keyboard focus.
      if (document.activeElement === $('begin')) document.activeElement.blur();
    }
    syncTransport();
  }
  async function seekTo(T) {
    const resume = playing;
    if (ctx) await ctx.suspend();
    if (graph) { graph.dispose(); graph = null; }
    offset = C.clamp(T, 0, C.duration);
    if (ctx && offset < 180) {
      graph = RM.audio.buildGraph(ctx, ctx.destination, offset, {lazy: true, lite: RM.lowPower});
      graph.volume.gain.value = muted ? 0 : volume;
    }
    begun = true; document.body.classList.add('begun'); dismissIntro();
    visual.reset(offset, true);
    playing = resume && offset < 180;
    if (playing) await ctx.resume();
    scrubbing = false;
    updateHud(offset, true); syncTransport();
  }

  const visual = RM.visual.create($('field'), $('ruler'), message => {
    $('visual-notice').textContent = message;
    $('visual-notice').hidden = !message;
  });
  const tickFragment = document.createDocumentFragment();
  C.primes.forEach(event => {
    const tick = document.createElement('i');
    tick.style.left = `${event.T / 180 * 100}%`;
    if (event.twinOf) tick.className = 'twin';
    tickFragment.appendChild(tick);
  });
  $('prime-ticks').appendChild(tickFragment);

  function updateHud(T, force = false) {
    $('height-readout').textContent = C.camera(T).toFixed(2);
    const count = C.crossedCount(T);
    if (force || count !== lastCount) {
      lastCount = count;
      $('count-readout').textContent = count;
      $('zero-readout').textContent = count ? `ρ${subscript(count)} = ½ + ${C.zeros[count - 1].toFixed(3)} i` : 'ρ₁ = ½ + 14.135 i · ahead';
    }
    const act = C.act(T);
    if (force || act.name !== lastAct) {
      lastAct = act.name; $('act-readout').textContent = `${act.number} · ${act.name}`;
    }
    if (!scrubbing) {
      $('seek').value = T;
      $('seek').style.setProperty('--progress', `${T / 180 * 100}%`);
      $('seek').setAttribute('aria-valuetext', `${timeText(T)} of 3:00, ${act.name}`);
      $('time-readout').firstChild.textContent = `${timeText(T)} `;
    }
    const prime = C.lastPrimeBefore(T);
    if (force || prime !== lastPrime) {
      lastPrime = prime;
      $('prime-readout').textContent = `p = ${prime ? prime.p : '—'}`;
      $('twin-readout').textContent = prime && prime.twinOf
        ? `TWIN · ${Math.min(prime.p, prime.twinOf)} ↔ ${Math.max(prime.p, prime.twinOf)}`
        : prime ? 'A PRIME, A BELL, A RIPPLE' : 'LISTEN FOR THE DOUBLE STRIKE';
      $('twin-readout').classList.toggle('is-twin', Boolean(prime && prime.twinOf));
      const ticker = $('prime-ticker'); ticker.replaceChildren();
      if (prime) C.primes.slice(Math.max(0, prime.index - 6), prime.index).forEach((p, index, arr) => {
        const item = document.createElement('b');
        item.textContent = p.p; item.style.fontWeight = '400'; item.style.opacity = .2 + .8 * (index + 1) / arr.length;
        ticker.appendChild(item);
      });
      if (prime && playing && !force) {
        const panel = document.querySelector('.prime-panel');
        panel.classList.remove('strike');
        // Restart one small CSS animation only on bell events.
        void panel.offsetWidth; panel.classList.add('strike');
      }
    }
  }

  function renderMath() {
    if (typeof window.renderMathInElement !== 'function') return;
    try { window.renderMathInElement(drawer, {delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}], throwOnError: false}); }
    catch (_) { /* Readable source formulas are the offline fallback. */ }
  }
  function openInfo() {
    activity(); returnFocus = document.activeElement;
    drawer.hidden = false; $('drawer-backdrop').hidden = false;
    $('info').setAttribute('aria-expanded', 'true');
    document.querySelector('main').inert = true;
    document.querySelector('header').inert = true;
    document.querySelector('.hud').inert = true;
    renderMath(); $('close-info').focus();
  }
  function closeInfo() {
    drawer.hidden = true; $('drawer-backdrop').hidden = true;
    $('info').setAttribute('aria-expanded', 'false');
    document.querySelector('main').inert = false;
    document.querySelector('header').inert = false;
    document.querySelector('.hud').inert = false;
    if (returnFocus && !returnFocus.closest('[hidden]') && !returnFocus.closest('[inert]')) returnFocus.focus();
    else $('info').focus();
    activity();
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else notice('Fullscreen is not supported in this browser.');
    } catch (_) { notice('Fullscreen could not open. The player is still ready.'); }
  }
  $('begin').addEventListener('click', () => { if (prepareAudio()) enqueue(togglePlayback); });
  $('play').addEventListener('click', () => { if (prepareAudio()) enqueue(togglePlayback); });
  $('seek').addEventListener('input', () => {
    scrubbing = true;
    const value = Number($('seek').value);
    $('seek').style.setProperty('--progress', `${value / 180 * 100}%`);
    $('seek').setAttribute('aria-valuetext', `${timeText(value)} of 3:00`);
    $('time-readout').firstChild.textContent = `${timeText(value)} `;
    activity();
  });
  $('seek').addEventListener('change', () => { const T = Number($('seek').value); enqueue(() => seekTo(T)); });
  $('seek').addEventListener('pointercancel', () => { scrubbing = false; });
  $('volume').addEventListener('input', () => { volume = Number($('volume').value); muted = false; setUserVolume(); });
  $('mute').addEventListener('click', () => { muted = !muted; setUserVolume(); });
  // iPhone Safari has no element fullscreen; hide the button instead of showing an error.
  if (!document.documentElement.requestFullscreen) $('fullscreen').style.display = 'none';
  $('fullscreen').addEventListener('click', fullscreen);
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
  });
  $('info').addEventListener('click', openInfo);
  $('close-info').addEventListener('click', closeInfo);
  $('drawer-backdrop').addEventListener('click', closeInfo);
  $('home-link').addEventListener('click', event => {
    event.preventDefault(); activity();
    if (playing) enqueue(togglePlayback);
    clearTimeout(introTimer); intro.hidden = false; intro.inert = false; intro.classList.remove('leaving');
    $('begin').focus();
  });
  $('download').addEventListener('click', async () => {
    if (rendering) return;
    rendering = true; $('download').disabled = true; activity();
    notice('Rendering the full composition. Playback can continue.');
    try {
      const result = await RM.audio.renderWav(percent => {
        $('download-label').textContent = `${percent}%`;
        $('download').setAttribute('aria-label', `Rendering WAV, ${percent} percent`);
      });
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'music-of-the-primes.wav';
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      notice(`WAV ready · 44.1 kHz stereo · measured peak ${result.peakDb.toFixed(2)} dBFS.`, true);
    } catch (error) {
      notice(`WAV export failed: ${error.message}. You can try again.`, true);
    } finally {
      rendering = false; $('download').disabled = false;
      $('download-label').textContent = 'WAV';
      $('download').setAttribute('aria-label', 'Download the full composition as WAV');
    }
  });

  document.addEventListener('keydown', event => {
    activity();
    if (!drawer.hidden) {
      if (event.key === 'Escape' || event.key.toLowerCase() === 'i') { event.preventDefault(); closeInfo(); }
      if (event.key === 'Tab') {
        const items = Array.from(drawer.querySelectorAll('button, a[href], input, [tabindex="0"]'));
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const target = event.target;
    if (target.isContentEditable || /TEXTAREA|SELECT/.test(target.tagName)) return;
    if (target.tagName === 'INPUT' && target !== $('seek')) return;
    if (event.code === 'Space') {
      if (target.closest('button,a')) return; // Preserve native keyboard activation.
      event.preventDefault(); if (prepareAudio()) enqueue(togglePlayback);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault(); const delta = event.key === 'ArrowRight' ? 5 : -5;
      enqueue(() => seekTo(clock() + delta));
    } else if (event.key.toLowerCase() === 'f') { event.preventDefault(); fullscreen(); }
    else if (event.key.toLowerCase() === 'i') { event.preventDefault(); openInfo(); }
    else if (event.key.toLowerCase() === 'm') { event.preventDefault(); muted = !muted; setUserVolume(); }
  });
  ['pointermove', 'pointerdown', 'touchstart', 'focusin'].forEach(type => document.addEventListener(type, activity, {passive: true}));
  document.addEventListener('visibilitychange', () => { lastFrame = 0; activity(); });
  window.addEventListener('load', renderMath);

  // ?capture=1: no live loop; RM.captureFrame(T) renders one deterministic frame (used to make the teaser video).
  const captureMode = new URLSearchParams(location.search).get('capture') === '1';
  if (captureMode) {
    RM.captureFrame = T => {
      if (!playing) { playing = true; syncTransport(); }
      begun = true; document.body.classList.add('begun'); dismissIntro();
      const bass = 0.45 * C.bassAt(T), high = 0.12;
      visual.update(T, 1 / 30, true, true, bass, high, T);
      updateHud(T, true);
    };
  }
  function frame(ms) {
    if (captureMode) return;
    // Cap at ~60 fps (~30 fps on low-power devices): skips every other frame on 120/60 Hz displays.
    if (lastFrame && ms - lastFrame < (RM.lowPower ? 1000 / 40 : 1000 / 90)) { requestAnimationFrame(frame); return; }
    const dt = lastFrame ? (ms - lastFrame) / 1000 : 1 / 60;
    lastFrame = ms;
    const T = clock();
    let bass = 0, high = 0;
    if (playing && graph) {
      graph.analyser.getByteFrequencyData(bins);
      const hz = ctx.sampleRate / graph.analyser.fftSize;
      const bassEnd = Math.max(1, Math.floor(180 / hz));
      for (let i = 1; i <= bassEnd; i++) bass += bins[i] / 255;
      bass /= bassEnd;
      const highStart = Math.floor(4000 / hz), highEnd = Math.min(bins.length, Math.ceil(12000 / hz));
      for (let i = highStart; i < highEnd; i++) high += bins[i] / 255;
      high /= Math.max(1, highEnd - highStart);
    }
    visual.update(T, dt, playing, begun, bass, high, ms / 1000);
    if (ms - lastHud > 80) { updateHud(T); lastHud = ms; }
    if (playing && T >= 180) {
      playing = false; offset = 180;
      if (graph) { graph.dispose(); graph = null; }
      ctx.suspend().catch(() => {});
      updateHud(180, true); syncTransport();
      notice('The horizon. Press Replay to begin again.');
    }
    if (playing && ms - lastActivity > 4000 && drawer.hidden && !rendering && !scrubbing
      && !(document.activeElement.closest('.chrome') && document.activeElement.matches(':focus-visible'))
      && !document.body.classList.contains('immersive')) {
      if (document.activeElement.closest('.chrome')) document.activeElement.blur();
      document.body.classList.add('immersive');
      autoHidden = Array.from(document.querySelectorAll('.chrome button, .chrome input, .chrome a'));
      autoHidden.forEach(el => el.setAttribute('tabindex', '-1'));
    }
    requestAnimationFrame(frame);
  }
  // Deep link: ?t=95 or ?t=1:35 starts the piece at that moment when Begin is pressed.
  (function applyDeepLink() {
    const raw = new URLSearchParams(location.search).get('t');
    if (!raw) return;
    const parts = raw.split(':').map(Number);
    const T = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
    if (Number.isFinite(T) && T > 0 && T < C.duration) offset = T;
  })();
  setUserVolume(); updateHud(offset, true); requestAnimationFrame(frame);
})();
