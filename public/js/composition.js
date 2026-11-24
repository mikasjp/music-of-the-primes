(function () {
  'use strict';
  const RM = (typeof window !== 'undefined' ? (window.RM = window.RM || {}) : {});
  const DURATION = 180;
  const TAU = Math.PI * 2;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

  function mulberry32(seed) {
    return function () {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Fritsch–Carlson Hermite interpolation, using its full monotonicity
  // region instead of the more restrictive radius-three sufficient condition.
  // This retains the steepest admissible arrival at the Horizon anchor.
  function monotoneSpline(xs, ys) {
    const slopes = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
    const m = [slopes[0], ...slopes.slice(1).map((d, i) => (d + slopes[i]) / 2), slopes[slopes.length - 1]];
    function monotonic(a, b) {
      if (a < 0 || b < 0) return false;
      const A = 3 * (a + b - 2), B = 6 - 4 * a - 2 * b;
      const u = A > 0 ? -B / (2 * A) : -1;
      return u <= 0 || u >= 1 || (A * u + B) * u + a > 1e-7;
    }
    slopes.forEach((d, i) => {
      if (!monotonic(m[i] / d, m[i + 1] / d)) {
        const a = m[i], b = m[i + 1];
        let lo = 0, hi = 1;
        for (let j = 0; j < 60; j++) {
          const f = (lo + hi) / 2;
          if (monotonic(1 + f * (a / d - 1), 1 + f * (b / d - 1))) lo = f;
          else hi = f;
        }
        m[i] = d + lo * 0.999 * (a - d);
        m[i + 1] = d + lo * 0.999 * (b - d);
      }
    });
    return T => {
      T = clamp(T, xs[0], xs[xs.length - 1]);
      let i = 0;
      while (i < xs.length - 2 && T > xs[i + 1]) i++;
      const h = xs[i + 1] - xs[i], u = (T - xs[i]) / h;
      return (2 * u ** 3 - 3 * u ** 2 + 1) * ys[i]
        + (u ** 3 - 2 * u ** 2 + u) * h * m[i]
        + (-2 * u ** 3 + 3 * u ** 2) * ys[i + 1]
        + (u ** 3 - u ** 2) * h * m[i + 1];
    };
  }

  function create(data, seed = 0x5EED) {
    if (!data || data.length !== 1000 || data.some((v, i) => !Number.isFinite(v) || (i && v <= data[i - 1]))) {
      throw new Error('The composition requires 1,000 ordered zeta zeros.');
    }
    const zeros = Object.freeze(Array.from(data));
    const random = mulberry32(seed);
    const camera = monotoneSpline([0, 15, 160, 180], [0, zeros[99] + 1, zeros[999] + 1, zeros[999] + 12]);
    const crossTime = Object.freeze(zeros.map(gamma => {
      let lo = 0, hi = DURATION;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (camera(mid) < gamma) lo = mid; else hi = mid;
      }
      return (lo + hi) / 2;
    }));
    const weight = gamma => 1 / Math.hypot(0.5, gamma);
    const voices = Object.freeze(zeros.slice(0, 100).map((gamma, i) => Object.freeze({
      k: i + 1, gamma, T: crossTime[i], frequency: 130.8128 * gamma / zeros[0],
      weight: weight(gamma), baseGain: 0.09 * weight(gamma) / weight(zeros[0]),
      pan: clamp(Math.sin((i + 1) * 0.7) * 0.85 + (random() * 2 - 1) * 0.1, -0.92, 0.92),
      lfoRate: 0.03 + random() * 0.11, lfoPhase: random() * TAU,
      lfoDepth: 0.35 + random() * 0.3, detune: 2 + random() * 3
    })));
    const glints = Object.freeze(zeros.slice(100).map((gamma, i) => {
      let frequency = 130.8128 * gamma / zeros[0];
      while (frequency >= 2093) frequency /= 2;
      while (frequency < 523.25) frequency *= 2;
      return Object.freeze({k: i + 101, T: crossTime[i + 100], frequency, pan: (random() * 2 - 1) * 0.9});
    }));
    const isPrime = p => {
      if (p < 2) return false;
      for (let d = 2; d * d <= p; d++) if (p % d === 0) return false;
      return true;
    };
    const primes = [];
    for (let p = 2; 1 + 0.15 * p <= 165; p++) {
      if (!isPrime(p)) continue;
      // 5 belongs to both (3,5) and (5,7). Prefer the preceding twin for
      // its label; consecutive twin-second bells still alternate their pans.
      const twinSecond = isPrime(p - 2);
      const twinOf = twinSecond ? p - 2 : isPrime(p + 2) ? p + 2 : null;
      const index = primes.length;
      const pan = twinSecond ? -primes[index - 1].pan : (random() * 2 - 1) * 0.65;
      primes.push(Object.freeze({p, T: 1 + 0.15 * p, index, twinOf, twinSecond, pan,
        frequency: 2 * 130.8128 * zeros[index % 25] / zeros[0]}));
    }
    Object.freeze(primes);
    // Array indices are zero-based everywhere; k on voice/event objects is the
    // human-readable one-based zero number.
    const lfoAt = (i, T) => {
      const v = voices[i];
      return v ? (1 + Math.sin(TAU * v.lfoRate * T + v.lfoPhase)) / 2 : 0.5;
    };
    const voiceGainAt = (i, T) => {
      if (i < 0 || i >= zeros.length) return 0;
      const age = T - crossTime[i];
      if (age < 0 || T >= DURATION) return 0;
      if (i >= 100) {
        if (age < 0.005) return age / 0.005;
        if (age <= 1.2) return Math.exp(-6 * (age - 0.005) / 1.195);
        return Math.exp(-6) * clamp(1 - (age - 1.2) / 0.06, 0, 1);
      }
      const v = voices[i];
      return clamp(age / 3.5, 0, 1) * (1 - v.lfoDepth + v.lfoDepth * lfoAt(i, T));
    };
    function upperBound(values, T, key) {
      let lo = 0, hi = values.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((key ? values[mid][key] : values[mid]) <= T) lo = mid + 1; else hi = mid;
      }
      return lo;
    }
    return Object.freeze({
      duration: DURATION, zeros, voices, glints, primes, crossTime, camera, lfoAt, voiceGainAt,
      viewSpan: T => 40 + 100 * smooth((T - 160) / 16),
      act: T => T < 15 ? {number: 'I', name: 'Emergence'} : T < 160 ? {number: 'II', name: 'Ascent'} : {number: 'III', name: 'Horizon'},
      primesBetween: (T0, T1) => primes.slice(upperBound(primes, T0, 'T'), upperBound(primes, T1, 'T')),
      lastPrimeBefore: T => primes[upperBound(primes, T, 'T') - 1] || null,
      crossedCount: T => upperBound(crossTime, T),
      zeroIndexAt: gamma => upperBound(zeros, gamma),
      bassAt: T => clamp(T / 4, 0, 1) * (0.76 + 0.24 * Math.sin(TAU * 0.017 * T)),
      masterAt: T => 0.7 * (1 - clamp((T - 165) / 15, 0, 1)),
      clamp, smooth, mulberry32, create
    });
  }

  RM.composition = RM.ZETA_ZEROS ? create(RM.ZETA_ZEROS) : {create, mulberry32};
  if (typeof module !== 'undefined') module.exports = RM.composition;
})();
