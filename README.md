# Music of the Primes

**Hear the zeros of the Riemann zeta function.** A three-minute generative composition and an
immersive WebGL journey up the critical line Re(s) = ½, through the first 1,000 nontrivial zeros
of ζ(s), with the primes ringing as bells.

**Live:** https://music-of-the-primes.pages.dev

## What you hear

The piece is a sonification of the Riemann–von Mangoldt explicit formula, which ties the
distribution of the primes to the nontrivial zeros ρ = ½ + iγ of ζ(s).

| Layer | Mapping |
|---|---|
| **Pitch** | Each zero γ_k becomes a sine partial at f_k = 130.81 Hz · γ_k / γ_1 (γ_1 ≈ 14.1347 ↦ C3). The spectrum is inharmonic, which makes it sound metallic and otherworldly. |
| **Loudness** | Riemann's weight A_k = 1 / √(0.25 + γ_k²). Low zeros are warm and high zeros shimmer. |
| **Space** | The first 100 zeros fade in as the camera passes them. Each voice has its own slow LFO, stereo position and detuned chorus, plus reverb and a C2 drone. |
| **Rhythm** | Every prime p ≤ 1093 strikes an FM bell at T = 1 + 0.15·p seconds. Twin primes (11–13, 17–19, …) are double strikes exactly 0.30 s apart. |
| **Journey** | Zeros 101–1000 sound as short glints, octave-folded into an audible range, as the view climbs to Im(s) ≈ 1419. |

The background is a domain-coloured rendering of a zero-product approximation with the
Riemann–Siegel θ phase, plus prime shockwaves and a particle field. It is an artistic rendering,
not the exact ζ function.

## Run locally

No build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Handy URL parameters:

- `?t=1:35` starts at that moment.
- `?lite=1` forces the low-power profile that phones get automatically.

Tests (Node ≥ 18):

```sh
node tests/composition.test.js && node tests/audio.test.js
```

## How it's built

- `js/zeros.js`: the first 1,000 zeros, computed with `mpmath.zetazero`
- `js/composition.js`: the deterministic timeline shared by audio and visuals
- `js/audio.js`: the Web Audio graph (live and offline) and the WAV encoder
- `js/visual.js`: the WebGL2 field, bloom and particles
- `js/main.js`: UI, HUD and transport

## Context

In November 2026 a machine-checked proof of the Riemann Hypothesis in Lean was announced
([Wikipedia](https://en.wikipedia.org/wiki/Alp%C3%B6ge%27s_proof_of_the_Riemann_hypothesis),
[verification status](https://github.com/nasqret/riemann-rev)). Independent review is ongoing.
The 1,000 zeros used here were verified to lie on the critical line numerically long before that.

## License

MIT. See [LICENSE](LICENSE).
