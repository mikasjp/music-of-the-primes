(function () {
  'use strict';
  const RM = window.RM = window.RM || {};
  const C = RM.composition;
  const TAU = Math.PI * 2;
  const QUAD = `#version 300 es
  precision highp float;
  out vec2 uv;
  void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    uv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;
  const FIELD = `#version 300 es
  precision highp float;
  precision highp sampler2D;
  in vec2 uv;
  out vec4 color;
  uniform sampler2D uZeros;
  uniform vec2 uResolution;
  uniform float uCenter, uSpan, uTime, uBass, uStrip, uIdle, uCalm, uReduced;
  uniform int kStart, kEnd;
  uniform vec4 uWaves[8];
  const float TAU = 6.28318530718;
  vec3 palette(float phase) {
    float h = fract(phase / TAU) * 4.0;
    vec3 a = vec3(.239,.961,.769), b = vec3(.106,.165,.369);
    vec3 c = vec3(.961,.302,.604), d = vec3(1.0,.702,.420);
    if(h < 1.0) return mix(a,b,smoothstep(0.0,1.0,h));
    if(h < 2.0) return mix(b,c,smoothstep(0.0,1.0,h-1.0));
    if(h < 3.0) return mix(c,d,smoothstep(0.0,1.0,h-2.0));
    return mix(d,a,smoothstep(0.0,1.0,h-3.0));
  }
  void main() {
    float aspect = uResolution.x / uResolution.y;
    vec2 original = (uv - .5) * vec2(aspect,1.0) * uSpan;
    vec2 p = original;
    float wave = 0.0, twin = 0.0;
    for(int j=0;j<8;j++) {
      vec4 w = uWaves[j];
      float front = abs(p.x) - w.y * uSpan * .56;
      float band = exp(-pow(front / (uSpan*.014),2.0))
        * exp(-pow((p.y-(w.x-uCenter)) / (uSpan*.12),2.0)) * w.z;
      wave += band; twin += band * w.w;
      p.x += sign(p.x) * band * uSpan * .009 * (1.0-uReduced);
    }
    float t = max(.1, p.y + uCenter);
    float phase = .5*t*log(t/TAU) - .5*t - .3926990817;
    float logField = 0.0;
    vec3 wells = vec3(0.0);
    for(int j=0;j<256;j++) {
      int k = kStart + j;
      if(k >= kEnd) break;
      vec4 z = texelFetch(uZeros, ivec2(k,0), 0);
      vec2 delta = p - vec2(0.0,z.x-uCenter);
      float r = max(length(delta), .013);
      float edge = 1.0-smoothstep(uSpan*.62,uSpan*.8,abs(z.x-uCenter));
      logField += log(r) * edge;
      phase += atan(delta.y,delta.x+1e-7) * edge;
      float strength = z.y * (.6+.4*z.z);
      float radius = .075 + .17 * strength;
      float core = exp(-r*r/(radius*radius));
      float halo = exp(-r/(.28+.95*strength));
      vec3 glowColor = mix(vec3(.25,.34,.40),vec3(.44,1.0,.85),smoothstep(.0,.2,strength));
      wells += glowColor * (core*(.2+1.7*strength)+halo*(.035+.28*strength));
      float ringRadius = .2 + (1.0-z.w)*1.7;
      float ring = exp(-pow((r-ringRadius)/.055,2.0))*z.w;
      wells += vec3(.52,.95,.86)*ring*.28;
    }
    vec3 hue = palette(phase);
    float gray = dot(hue,vec3(.2126,.7152,.0722));
    hue = mix(vec3(gray),hue,.48*(1.0-uCalm*.65)*(1.0-uIdle*.7));
    float isoline = abs(fract(logField*.22)-.5);
    float aa = max(fwidth(logField*.22),.008);
    float contour = 1.0-smoothstep(.014,.014+aa*1.1,isoline);
    float breathing = .96+.04*sin(uTime*.45);
    vec3 col = vec3(.009,.016,.023) + hue*(.035+.10*contour)*breathing;
    col += wells * (1.0-uIdle*.5) * (1.0-uCalm*.35);
    float px = uSpan/uResolution.y;
    float line = exp(-abs(original.x)/max(px*.7,.018));
    col += vec3(.239,.961,.769)*line*(.13+uBass*.14);
    float edgeX = aspect*uSpan*uStrip*.5;
    float edges = exp(-abs(abs(original.x)-edgeX)/max(px*.65,.015));
    float dash = smoothstep(.3,.5,fract((original.y+uCenter)*.28));
    col += vec3(.2,.5,.45)*edges*dash*.09;
    vec3 waveColor = mix(vec3(.961,.302,.604),vec3(1.0,.702,.420),clamp(twin/max(wave,.001),0.0,1.0));
    col += waveColor*wave*.15;
    float aberration = wave*.22*(1.0-uReduced);
    col.r += (palette(phase+aberration).r-palette(phase).r)*.12;
    col.b += (palette(phase-aberration).b-palette(phase).b)*.12;
    color = vec4(max(col,vec3(0.0)),1.0);
  }`;
  const PARTICLE_VERTEX = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 position;
  layout(location=1) in vec4 appearance;
  uniform float uCenter, uSpan, uAspect, uStrip, uDpr;
  out vec4 tint;
  void main() {
    gl_Position = vec4((position.x-.5)*uStrip*2.0,(position.y-uCenter)/uSpan*2.0,0.0,1.0);
    float speed = clamp(appearance.x,0.0,1.0);
    vec3 col = mix(vec3(.14,.22,.43),vec3(.57,1.0,.88),speed);
    if(appearance.z > .5) col = appearance.z > 1.5 ? vec3(1.0,.70,.42) : vec3(.96,.30,.60);
    tint = vec4(col,appearance.y);
    gl_PointSize = clamp((1.0+speed*1.4+appearance.w)*uDpr,1.0,7.0);
  }`;
  const PARTICLE_FRAGMENT = `#version 300 es
  precision highp float;
  in vec4 tint;
  out vec4 color;
  void main() {
    float r = length(gl_PointCoord-.5)*2.0;
    float alpha = exp(-r*r*3.5)*(1.0-smoothstep(.65,1.0,r))*tint.a;
    color = vec4(tint.rgb*alpha,alpha);
  }`;
  const FILTER = `#version 300 es
  precision highp float;
  in vec2 uv;
  out vec4 color;
  uniform sampler2D uImage;
  uniform vec2 uStep;
  uniform int uBright;
  void main() {
    if(uBright == 1) {
      vec3 c = texture(uImage,uv).rgb;
      color = vec4(c*smoothstep(.18,.65,max(c.r,max(c.g,c.b))),1.0);
    } else {
      vec3 c = texture(uImage,uv).rgb*.227027;
      c += texture(uImage,uv+uStep*1.384615).rgb*.316216;
      c += texture(uImage,uv-uStep*1.384615).rgb*.316216;
      c += texture(uImage,uv+uStep*3.230769).rgb*.070270;
      c += texture(uImage,uv-uStep*3.230769).rgb*.070270;
      color = vec4(c,1.0);
    }
  }`;
  const COMPOSITE = `#version 300 es
  precision highp float;
  in vec2 uv;
  out vec4 color;
  uniform sampler2D uImage, uBloom;
  uniform float uTime, uCenter, uSpan, uAspect, uReduced;
  uniform vec4 uWaves[8];
  void main() {
    vec2 p = (uv-.5)*vec2(uAspect,1.0)*uSpan;
    float wave = 0.0;
    for(int j=0;j<8;j++) {
      vec4 w = uWaves[j];
      float front = abs(p.x)-w.y*uSpan*.56;
      wave += exp(-pow(front/(uSpan*.025),2.0))
        * exp(-pow((p.y-(w.x-uCenter))/(uSpan*.12),2.0))*w.z;
    }
    vec2 shift = vec2(wave*.0018*(1.0-uReduced),0.0);
    vec3 c = texture(uImage,uv).rgb;
    c.r = texture(uImage,uv+shift).r;
    c.b = texture(uImage,uv-shift).b;
    c += texture(uBloom,uv).rgb*.48;
    float vignette = 1.0-.50*smoothstep(.2,.78,length((uv-.5)*vec2(.9,1.0)));
    float grain = fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233))+floor(uTime*12.0))*43758.5453)-.5;
    color = vec4(max(vec3(.004),c*vignette+grain*.003),1.0);
  }`;

  function create(canvas, ruler, onNotice) {
    let gl;
    try { gl = canvas.getContext('webgl2', {alpha: false, antialias: false, depth: false, powerPreference: 'high-performance'}); }
    catch (_) { /* CSS fallback remains underneath. */ }
    if (!gl) { onNotice('WebGL2 unavailable · audio is ready; showing a still background.'); return {update() {}, reset() {}}; }
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = reducedQuery.matches;
    let mobile = window.innerWidth < 700;
    let scale = RM.lowPower ? 0.7 : 0.8, dpr = 1, width = 1, height = 1;
    let lost = false, failed = false, avgFrame = 16.7, slowFrames = 0, ready = false;
    let field, particle, filter, composite, zeroTexture, particleBuffer, quadVao, particleVao;
    let scene, ping, pong, currentCount;
    const maxParticles = 6000;
    const positions = new Float32Array(maxParticles * 2);
    const velocity = new Float32Array(maxParticles * 2);
    const ages = new Float32Array(maxParticles);
    const life = new Float32Array(maxParticles);
    const types = new Float32Array(maxParticles);
    const attributes = new Float32Array(maxParticles * 6);
    const zeroData = new Float32Array(1000 * 4);
    const waveData = new Float32Array(8 * 4);
    const rulerCtx = ruler.getContext('2d');
    let random = C.mulberry32(0x5EED ^ 0xF13D), cursor = 0, previousT = 0, wasBegun = false;
    let center = 20, span = 40, strip = 0.22, lastRuler = '';

    function program(vertex, fragment) {
      const shaders = [vertex, fragment].map((source, i) => {
        const shader = gl.createShader(i ? gl.FRAGMENT_SHADER : gl.VERTEX_SHADER);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          const log = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(log);
        }
        return shader;
      });
      const p = gl.createProgram();
      shaders.forEach(shader => gl.attachShader(p, shader)); gl.linkProgram(p);
      shaders.forEach(shader => gl.deleteShader(shader));
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const uniforms = new Map();
      return {p, u(name) {
        if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(p, name));
        return uniforms.get(name);
      }};
    }
    function target(w, h) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete scene framebuffer');
      return {texture, fbo, w, h};
    }
    function disposeTarget(t) { if (t) { gl.deleteTexture(t.texture); gl.deleteFramebuffer(t.fbo); } }
    function resize() {
      if (lost || failed || !ready) return;
      mobile = window.innerWidth < 700;
      dpr = Math.min(window.devicePixelRatio || 1, RM.lowPower ? 1 : 1.5);
      width = Math.max(1, Math.round(window.innerWidth * dpr));
      height = Math.max(1, Math.round(window.innerHeight * dpr));
      canvas.width = width; canvas.height = height;
      ruler.width = width; ruler.height = height;
      strip = width < height ? 0.45 : 0.22;
      currentCount = Math.min(currentCount || maxParticles, reduced ? 1200 : RM.lowPower ? 1500 : mobile ? 2500 : 6000);
      disposeTarget(scene); disposeTarget(ping); disposeTarget(pong);
      scene = target(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
      ping = target(Math.max(1, scene.w >> 1), Math.max(1, scene.h >> 1));
      pong = target(ping.w, ping.h);
      lastRuler = '';
    }
    function bind(t, texture, unit) {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(t, unit);
    }
    function output(t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
      gl.viewport(0, 0, t ? t.w : width, t ? t.h : height);
    }
    function respawn(i, distributed) {
      const side = random() < 0.22;
      positions[i * 2] = 0.5 + (random() - 0.5) / strip;
      positions[i * 2 + 1] = center + (distributed ? random() - .5 : .5 + random() * .12) * span;
      if (!distributed && side) {
        positions[i * 2] = .5 + (random() < .5 ? -.49 : .49) / strip;
        positions[i * 2 + 1] = center + (random() - .5) * span;
      }
      velocity[i * 2] = (random() - .5) * .12;
      velocity[i * 2 + 1] = (random() - .5) * .3;
      ages[i] = distributed ? random() * 2 : 0;
      life[i] = 14 + random() * 24; types[i] = 0;
    }
    function reset(T = 0, begun = true) {
      previousT = T; wasBegun = begun;
      center = begun ? C.camera(T) : 20; span = begun ? C.viewSpan(T) : 40;
      random = C.mulberry32(0x5EED ^ Math.floor(T * 1000)); cursor = 0;
      for (let i = 0; i < maxParticles; i++) respawn(i, true);
    }
    function burst(gamma, count, type, ring) {
      const xScale = span * (width / height) * strip;
      for (let j = 0; j < count; j++) {
        const i = cursor++ % currentCount, angle = random() * TAU;
        positions[i * 2] = .5 + (ring ? Math.cos(angle) * .6 / xScale : 0);
        positions[i * 2 + 1] = gamma + (ring ? Math.sin(angle) * .6 : (random() - .5) * .2);
        velocity[i * 2] = ring ? Math.cos(angle) * 2 / xScale : (random() < .5 ? -1 : 1) * (8 + random() * 18) / xScale;
        velocity[i * 2 + 1] = ring ? Math.sin(angle) * 2 : (random() - .5) * 2;
        ages[i] = 0; life[i] = ring ? 1.4 : 1.8; types[i] = type;
      }
    }
    function init() {
      field = program(QUAD, FIELD); particle = program(PARTICLE_VERTEX, PARTICLE_FRAGMENT);
      filter = program(QUAD, FILTER); composite = program(QUAD, COMPOSITE);
      quadVao = gl.createVertexArray(); particleVao = gl.createVertexArray();
      zeroTexture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, zeroTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1000, 1, 0, gl.RGBA, gl.FLOAT, zeroData);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      particleBuffer = gl.createBuffer(); gl.bindVertexArray(particleVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, attributes.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
      ready = true; resize(); reset(previousT, wasBegun);
    }
    function fallback(error) {
      failed = true; canvas.style.opacity = '0'; ruler.style.opacity = '0';
      onNotice('The visual field is unavailable · audio remains ready.');
      console.warn('[RM] Visual fallback:', error.message || error);
    }
    try { init(); } catch (error) { fallback(error); }
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); lost = true; canvas.style.opacity = '0';
      onNotice('Visual context interrupted · restoring when available. Audio continues.');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      lost = false; failed = false; ready = false;
      scene = ping = pong = null;
      try { init(); canvas.style.opacity = '1'; ruler.style.opacity = '1'; onNotice(''); }
      catch (error) { fallback(error); }
    });
    window.addEventListener('resize', () => { try { resize(); } catch (error) { fallback(error); } });
    reducedQuery.addEventListener('change', e => {
      reduced = e.matches; currentCount = reduced ? 1200 : RM.lowPower ? 1500 : mobile ? 2500 : 6000;
    });

    function drawRuler() {
      if (!rulerCtx) return;
      const key = `${center.toFixed(2)}:${span.toFixed(2)}:${width}`;
      if (lastRuler === key) return;
      lastRuler = key;
      rulerCtx.clearRect(0, 0, width, height);
      rulerCtx.font = `${10 * dpr}px "Space Mono", monospace`;
      rulerCtx.fillStyle = 'rgba(140,182,172,.45)';
      rulerCtx.strokeStyle = 'rgba(104,163,145,.22)';
      rulerCtx.lineWidth = dpr;
      const lo = center - span / 2, hi = center + span / 2;
      for (let t = Math.ceil(lo / 10) * 10; t <= hi; t += 10) {
        const y = height * (1 - (t - lo) / span);
        // Keep the ruler out of the HUD and transport's text areas.
        if (y < 175 * dpr || y > height - 150 * dpr) continue;
        rulerCtx.beginPath(); rulerCtx.moveTo(width - 11 * dpr, y);
        rulerCtx.lineTo(width - 20 * dpr, y); rulerCtx.stroke();
        rulerCtx.textAlign = 'right'; rulerCtx.fillText(String(t), width - 27 * dpr, y + 3 * dpr);
      }
      rulerCtx.textAlign = 'center';
      const y = height - (mobile ? 166 : 116) * dpr;
      ['Re = 0', '½', '1'].forEach((label, i) => {
        rulerCtx.fillText(label, width * (.5 + (i - 1) * strip / 2), y);
      });
    }

    function update(T, frameDt, playing, begun, bass = 0, high = 0, wallTime = 0) {
      if (lost || failed || !ready) return;
      if (wasBegun !== begun || T < previousT || T - previousT > 0.5) reset(T, begun);
      center = begun ? C.camera(T) : 20;
      span = begun ? C.viewSpan(T) : 40;
      let kStart = Math.max(0, C.zeroIndexAt(center - span * .8) - 1);
      const kEnd = Math.min(1000, kStart + 256, C.zeroIndexAt(center + span * .8) + 1);
      for (let k = 0; k < 1000; k++) {
        const age = T - C.crossTime[k];
        zeroData[k * 4] = C.zeros[k];
        zeroData[k * 4 + 1] = begun ? C.voiceGainAt(k, T) : 0;
        zeroData[k * 4 + 2] = C.lfoAt(k, T);
        zeroData[k * 4 + 3] = begun && age >= 0 ? Math.exp(-age / .38) : 0;
      }
      const recent = begun ? C.primesBetween(T - 1.6, T).slice(-8) : [];
      waveData.fill(0);
      recent.forEach((p, i) => {
        const age = T - p.T;
        waveData.set([C.camera(p.T), age, (1 - age / 1.6) ** 2, p.twinSecond ? 1 : 0], i * 4);
      });
      if (playing && T > previousT) {
        C.primesBetween(previousT, T).forEach(p => burst(C.camera(p.T), reduced ? 35 : 150, p.twinSecond ? 2 : 1, false));
        const from = C.crossedCount(previousT), to = C.crossedCount(T);
        for (let k = from; k < to; k++) burst(C.zeros[k], reduced ? 12 : 50, 0, true);
      }
      const dt = Math.min(.04, frameDt) * (reduced ? .3 : 1) * (playing ? 1 : begun ? 0 : .15);
      const xScale = span * width / height * strip;
      for (let i = 0; i < currentCount; i++) {
        const ii = i * 2, x = (positions[ii] - .5) * xScale, y = positions[ii + 1];
        let vx = velocity[ii] * xScale, vy = velocity[ii + 1];
        if (types[i] === 0 && life[i] > 2) {
          // Curl of a smooth scalar noise-like potential; divergence-free drift.
          let ax = .16 * Math.cos(y * .17 + wallTime * .08), ay = -.12 * Math.sin(x * .22 + wallTime * .06);
          const nearest = C.zeroIndexAt(y);
          for (let k = Math.max(kStart, nearest - 2); k < Math.min(kEnd, nearest + 2); k++) {
            const gain = zeroData[k * 4 + 1];
            if (gain < .005) continue;
            const dy = C.zeros[k] - y, dx = -x, r2 = dx * dx + dy * dy + .3;
            const swirl = (k % 2 ? -1 : 1) * (1.4 + bass * 2);
            ax += gain * (dx - dy * swirl) * 2 / r2;
            ay += gain * (dy + dx * swirl) * 2 / r2;
            if (r2 < .32) ages[i] = life[i];
          }
          vx += ax * dt; vy += ay * dt;
        }
        const drag = Math.exp(-dt * (life[i] < 2 ? 1.2 : .32));
        velocity[ii] = vx * drag / xScale; velocity[ii + 1] = vy * drag;
        positions[ii] += velocity[ii] * dt; positions[ii + 1] += velocity[ii + 1] * dt;
        ages[i] += dt;
        if (positions[ii + 1] < center - span * .55 || positions[ii + 1] > center + span * .7
          || Math.abs(positions[ii] - .5) > .56 / strip || ages[i] > life[i]) respawn(i, false);
        const speed = Math.min(1, Math.hypot(vx, vy) / 5);
        const fade = Math.min(1, ages[i] * 3) * Math.min(1, (life[i] - ages[i]) * 2);
        const sparkle = .8 + high * .2 * Math.sin(i * 12.4 + wallTime * 17);
        const a = i * 6;
        attributes[a] = positions[ii]; attributes[a + 1] = positions[ii + 1];
        attributes[a + 2] = life[i] < 2 && !types[i] ? 1 : speed;
        attributes[a + 3] = Math.max(0, fade) * (.18 + speed * .45) * sparkle * (begun ? 1 : .4);
        attributes[a + 4] = types[i]; attributes[a + 5] = life[i] < 2 ? .8 : 0;
      }
      previousT = T; wasBegun = begun;

      gl.disable(gl.BLEND); gl.bindVertexArray(quadVao); output(scene); gl.useProgram(field.p);
      bind(field.u('uZeros'), zeroTexture, 0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1000, 1, gl.RGBA, gl.FLOAT, zeroData);
      gl.uniform2f(field.u('uResolution'), scene.w, scene.h);
      gl.uniform1f(field.u('uCenter'), center); gl.uniform1f(field.u('uSpan'), span);
      gl.uniform1f(field.u('uTime'), begun ? T : wallTime * .1);
      gl.uniform1f(field.u('uBass'), bass); gl.uniform1f(field.u('uStrip'), strip);
      gl.uniform1f(field.u('uIdle'), begun ? 0 : 1);
      gl.uniform1f(field.u('uCalm'), C.smooth((T - 160) / 20));
      gl.uniform1f(field.u('uReduced'), reduced ? 1 : 0);
      gl.uniform1i(field.u('kStart'), kStart); gl.uniform1i(field.u('kEnd'), kEnd);
      gl.uniform4fv(field.u('uWaves[0]'), waveData);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(particle.p); gl.bindVertexArray(particleVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, attributes.subarray(0, currentCount * 6));
      gl.uniform1f(particle.u('uCenter'), center); gl.uniform1f(particle.u('uSpan'), span);
      gl.uniform1f(particle.u('uAspect'), width / height); gl.uniform1f(particle.u('uStrip'), strip);
      gl.uniform1f(particle.u('uDpr'), dpr * scale);
      gl.drawArrays(gl.POINTS, 0, currentCount);
      gl.disable(gl.BLEND); gl.bindVertexArray(quadVao);

      gl.useProgram(filter.p); output(ping);
      bind(filter.u('uImage'), scene.texture, 0); gl.uniform1i(filter.u('uBright'), 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3); gl.uniform1i(filter.u('uBright'), 0);
      for (let iteration = 0; iteration < (RM.lowPower ? 1 : 2); iteration++) {
        output(pong); bind(filter.u('uImage'), ping.texture, 0);
        gl.uniform2f(filter.u('uStep'), 1 / ping.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        output(ping); bind(filter.u('uImage'), pong.texture, 0);
        gl.uniform2f(filter.u('uStep'), 0, 1 / ping.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      output(null); gl.useProgram(composite.p);
      bind(composite.u('uImage'), scene.texture, 0); bind(composite.u('uBloom'), ping.texture, 1);
      gl.uniform1f(composite.u('uTime'), begun ? T : wallTime * .1);
      gl.uniform1f(composite.u('uCenter'), center); gl.uniform1f(composite.u('uSpan'), span);
      gl.uniform1f(composite.u('uAspect'), width / height); gl.uniform1f(composite.u('uReduced'), reduced ? 1 : 0);
      gl.uniform4fv(composite.u('uWaves[0]'), waveData);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      drawRuler();
      // Ignore tab-return gaps and sustained low refresh-rate environments.
      if (frameDt > 0 && frameDt < .1 && !document.hidden) {
        avgFrame = avgFrame * .97 + frameDt * 1000 * .03;
        slowFrames = avgFrame > (RM.lowPower ? 45 : 22) ? slowFrames + 1 : Math.max(0, slowFrames - 1);
        if (slowFrames > 100) {
          if (scale > .5) { scale = Math.max(.5, scale - .1); resize(); }
          else currentCount = Math.max(1200, Math.floor(currentCount * .8));
          slowFrames = 0; avgFrame = 16.7;
        }
      }
    }
    return {update, reset};
  }
  RM.visual = {create};
})();
