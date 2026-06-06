/**
 * particles.js — Organic golden-dust ambient particle system
 * For romantic splash pages. Coexists with fireworks on a lower z-index canvas.
 *
 * Movement: layered sin/cos wave displacement (organic, not linear)
 * Each particle rides a slow drift field + its own breathing oscillation.
 * Soft radial-gradient glow per particle — no hard circles.
 *
 * Public API:
 *   startParticles(canvasId)   — begin ambient loop
 *   stopParticles()            — cancel loop, clear canvas
 */

(function (global) {
  'use strict';

  // ─────────────────────────────────────────────
  // Palette — warm amber/gold, very soft rose, whisper lavender
  // ─────────────────────────────────────────────
  var COLORS = [
    { r: 245, g: 192, b: 122, a: 0.72 },  // #F5C07A  warm amber
    { r: 253, g: 184, b: 19,  a: 0.65 },  // #FDB813  bright gold
    { r: 255, g: 158, b: 189, a: 0.30 },  // #FF9EBD  soft rose (low opacity)
    { r: 201, g: 184, b: 255, a: 0.18 },  // #C9B8FF  whisper lavender
    { r: 250, g: 210, b: 140, a: 0.55 },  // warm buff — bridges amber/gold
    { r: 245, g: 192, b: 122, a: 0.50 },  // second amber entry, slightly dimmer
    { r: 253, g: 184, b: 19,  a: 0.42 },  // dimmer gold for variety
  ];

  // Particle count — feels like drifting dust, not a snowstorm
  var COUNT = 68;

  // ─────────────────────────────────────────────
  // Module state
  // ─────────────────────────────────────────────
  var _canvas  = null;
  var _ctx     = null;
  var _raf     = null;
  var _running = false;
  var _t       = 0;      // global time accumulator (seconds equivalent)
  var _pool    = [];

  // ─────────────────────────────────────────────
  // Utility
  // ─────────────────────────────────────────────
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ─────────────────────────────────────────────
  // Particle factory
  // Each particle has:
  //   - A slow base drift velocity (vx, vy) — very gentle
  //   - Three independent oscillation layers (organic "breathing")
  //     Layer A: slow large wave  — the main drift shimmer
  //     Layer B: medium wave      — secondary wobble
  //     Layer C: fast tiny tremor — lifelike micro-vibration
  //   - Phase offsets so every particle moves differently
  //   - Size pulse: particle breathes in/out gently
  //   - Alpha pulse: fades in and out like a firefly
  // ─────────────────────────────────────────────
  function createParticle(W, H) {
    var col = pick(COLORS);
    return {
      // Position — spread across canvas
      x: rand(0, W),
      y: rand(0, H),

      // Base drift — very slow, barely perceptible direction
      vx: rand(-0.08, 0.08),
      vy: rand(-0.12, -0.04),  // slight upward bias (warmth rising)

      // Color
      r: col.r, g: col.g, b: col.b,
      baseAlpha: col.a,

      // Size — small, dust-like
      baseSize: rand(1.8, 4.2),

      // --- Oscillation layer A (slow large sway) ---
      freqAx:   rand(0.18, 0.35),   // Hz-ish
      freqAy:   rand(0.15, 0.28),
      ampAx:    rand(22, 55),        // pixels
      ampAy:    rand(18, 42),
      phaseAx:  rand(0, Math.PI * 2),
      phaseAy:  rand(0, Math.PI * 2),

      // --- Oscillation layer B (medium secondary wobble) ---
      freqBx:   rand(0.55, 0.9),
      freqBy:   rand(0.5, 0.85),
      ampBx:    rand(7, 18),
      ampBy:    rand(6, 14),
      phaseBx:  rand(0, Math.PI * 2),
      phaseBy:  rand(0, Math.PI * 2),

      // --- Oscillation layer C (micro-tremor) ---
      freqCx:   rand(1.8, 3.2),
      freqCy:   rand(1.6, 2.8),
      ampCx:    rand(1.5, 4),
      ampCy:    rand(1.5, 3.5),
      phaseCx:  rand(0, Math.PI * 2),
      phaseCy:  rand(0, Math.PI * 2),

      // --- Alpha breath (firefly pulse) ---
      alphaFreq:  rand(0.2, 0.55),
      alphaPhase: rand(0, Math.PI * 2),
      alphaDepth: rand(0.25, 0.55),  // how much alpha varies (fraction of baseAlpha)

      // --- Size breath ---
      sizeFreq:  rand(0.25, 0.5),
      sizePhase: rand(0, Math.PI * 2),
      sizeDepth: rand(0.12, 0.28),

      // Wrap padding — particles re-enter smoothly from opposite edge
      // (set after canvas size known, calculated in reset)
      _ox: 0,  // origin x — used for oscillation anchor
      _oy: 0,  // origin y
    };
  }

  function resetParticleOrigins(W, H) {
    for (var i = 0; i < _pool.length; i++) {
      var p = _pool[i];
      p._ox = p.x;
      p._oy = p.y;
    }
  }

  // ─────────────────────────────────────────────
  // Per-frame update — NO random jitter
  // Position = (drifted origin) + wave displacement
  // The origin advances by vx/vy each frame; waves are pure sin/cos.
  // This is fully deterministic from phase offsets — organic not random.
  // ─────────────────────────────────────────────
  function updateParticle(p, t, W, H) {
    // Advance the drift origin
    p._ox += p.vx;
    p._oy += p.vy;

    // Wrap origin at canvas edges (with margin so glow doesn't pop)
    var margin = 60;
    if (p._ox < -margin)  p._ox = W + margin;
    if (p._ox > W + margin) p._ox = -margin;
    if (p._oy < -margin)  p._oy = H + margin;
    if (p._oy > H + margin) p._oy = -margin;

    // Layer A — slow large sway
    var wax = p.ampAx * Math.sin(t * p.freqAx + p.phaseAx);
    var way = p.ampAy * Math.cos(t * p.freqAy + p.phaseAy);

    // Layer B — medium secondary wobble
    var wbx = p.ampBx * Math.sin(t * p.freqBx + p.phaseBx);
    var wby = p.ampBy * Math.cos(t * p.freqBy + p.phaseBy);

    // Layer C — micro-tremor
    var wcx = p.ampCx * Math.sin(t * p.freqCx + p.phaseCx);
    var wcy = p.ampCy * Math.cos(t * p.freqCy + p.phaseCy);

    // Final rendered position
    p.x = p._ox + wax + wbx + wcx;
    p.y = p._oy + way + wby + wcy;

    // Alpha breath — firefly pulse
    var alphaMod = 1 + p.alphaDepth * Math.sin(t * p.alphaFreq + p.alphaPhase);
    p.currentAlpha = Math.max(0, Math.min(1, p.baseAlpha * alphaMod));

    // Size breath
    var sizeMod = 1 + p.sizeDepth * Math.sin(t * p.sizeFreq + p.sizePhase);
    p.currentSize = p.baseSize * sizeMod;
  }

  // ─────────────────────────────────────────────
  // Draw — soft radial gradient glow, not a plain circle
  // The glow is 3.5× the particle radius, fading to transparent.
  // Inner hot-white core for specular highlight (tiny, optional).
  // ─────────────────────────────────────────────
  function drawParticle(ctx, p) {
    var x    = p.x;
    var y    = p.y;
    var r    = p.currentSize;
    var glow = r * 3.8;
    var a    = p.currentAlpha;

    // Skip if nearly invisible — saves fillStyle + gradient creation
    if (a < 0.02) return;

    // Outer soft glow
    var grad = ctx.createRadialGradient(x, y, 0, x, y, glow);
    grad.addColorStop(0,    'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + a + ')');
    grad.addColorStop(0.35, 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + (a * 0.6) + ')');
    grad.addColorStop(0.65, 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + (a * 0.18) + ')');
    grad.addColorStop(1,    'rgba(' + p.r + ',' + p.g + ',' + p.b + ',0)');

    ctx.beginPath();
    ctx.arc(x, y, glow, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Tiny specular core (brighter hot spot)
    if (r > 2.2) {
      var coreAlpha = Math.min(1, a * 1.4);
      var core = ctx.createRadialGradient(x, y, 0, x, y, r * 0.9);
      core.addColorStop(0,   'rgba(255,248,230,' + coreAlpha + ')');
      core.addColorStop(0.5, 'rgba(' + p.r + ',' + p.g + ',' + p.b + ',' + (coreAlpha * 0.7) + ')');
      core.addColorStop(1,   'rgba(' + p.r + ',' + p.g + ',' + p.b + ',0)');

      ctx.beginPath();
      ctx.arc(x, y, r * 0.9, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.fill();
    }
  }

  // ─────────────────────────────────────────────
  // Main loop
  // ─────────────────────────────────────────────
  function loop(timestamp) {
    if (!_running) return;

    var W = _canvas.width;
    var H = _canvas.height;

    // Advance time — scale so frequencies feel natural at any FPS
    // ~60 FPS target: each frame advances by ~0.016s worth of time
    _t += 0.016;

    // Full clear — particles have soft glow that must not trail
    _ctx.clearRect(0, 0, W, H);

    for (var i = 0; i < _pool.length; i++) {
      updateParticle(_pool[i], _t, W, H);
      drawParticle(_ctx, _pool[i]);
    }

    _raf = requestAnimationFrame(loop);
  }

  // ─────────────────────────────────────────────
  // Resize
  // ─────────────────────────────────────────────
  function onResize() {
    if (!_canvas) return;
    _canvas.width  = window.innerWidth;
    _canvas.height = window.innerHeight;
    // Re-anchor origins so particles don't suddenly teleport
    resetParticleOrigins(_canvas.width, _canvas.height);
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  /**
   * startParticles(canvasId)
   *
   * The canvas should be:
   *   position: fixed; top: 0; left: 0;
   *   width: 100vw; height: 100vh;
   *   pointer-events: none;
   *   z-index: [below fireworks canvas]
   *
   * @param {string} canvasId
   */
  function startParticles(canvasId) {
    if (_running) stopParticles();

    _canvas = document.getElementById(canvasId);
    if (!_canvas) {
      console.warn('[particles] Canvas not found:', canvasId);
      return;
    }

    _ctx = _canvas.getContext('2d');
    _canvas.width  = window.innerWidth;
    _canvas.height = window.innerHeight;
    _canvas.style.pointerEvents = 'none';
    _canvas.style.background    = 'transparent';

    // Build particle pool
    _pool = [];
    _t    = 0;
    for (var i = 0; i < COUNT; i++) {
      var p = createParticle(_canvas.width, _canvas.height);
      // Seed the drift origin at the particle's spawn position
      p._ox = p.x;
      p._oy = p.y;
      _pool.push(p);
    }

    window.addEventListener('resize', onResize);

    _running = true;
    _raf = requestAnimationFrame(loop);
  }

  /**
   * stopParticles()
   * Cancels the animation loop and clears the canvas.
   */
  function stopParticles() {
    _running = false;

    if (_raf) {
      cancelAnimationFrame(_raf);
      _raf = null;
    }

    if (_ctx && _canvas) {
      _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    }

    window.removeEventListener('resize', onResize);

    _pool  = [];
    _canvas = null;
    _ctx    = null;
  }

  // Export
  global.startParticles = startParticles;
  global.stopParticles  = stopParticles;

}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this));
