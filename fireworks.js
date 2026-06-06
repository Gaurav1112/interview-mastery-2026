/**
 * fireworks.js — Production-quality HTML5 Canvas fireworks animation
 * Dark Scholar palette: gold, saffron, teal, pink, white, lavender
 *
 * Public API:
 *   startFireworks(canvasId)  — begin autonomous loop
 *   stopFireworks()           — cancel loop, clear canvas
 *   burst(x, y)               — single explosion at canvas coords
 */

(function (global) {
  'use strict';

  // ─────────────────────────────────────────────
  // Constants & palette
  // ─────────────────────────────────────────────
  const PALETTE = [
    '#F5A623', // gold
    '#E85D26', // saffron
    '#17C492', // teal
    '#FF6B9D', // pink
    '#ECE8FF', // white-lavender
    '#C9B8FF', // lavender
    '#FDB813', // bright gold
    '#FF9F43', // warm orange
    '#1DD1A1', // mint teal
  ];

  const GRAVITY        = 0.15;
  const FRICTION       = 0.985;  // mild air resistance on particles
  const TRAIL_ALPHA    = 0.18;   // rocket trail fade factor (lower = longer trail)
  const FADE_OVERLAY   = 0.18;   // per-frame alpha overlay (controls trail length)

  // Rockets per second range
  const ROCKETS_PER_SEC_MIN = 2;
  const ROCKETS_PER_SEC_MAX = 3;

  // Particles per explosion range
  const PARTICLES_MIN = 80;
  const PARTICLES_MAX = 120;

  // ─────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────
  let _canvas   = null;
  let _ctx      = null;
  let _raf      = null;
  let _running  = false;
  let _lastRocketTime = 0;
  let _nextRocketInterval = 0;

  const _rockets    = [];
  const _explosions = [];   // arrays of particles per explosion

  // ─────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }

  function randColor() {
    return PALETTE[Math.floor(Math.random() * PALETTE.length)];
  }

  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  }

  // ─────────────────────────────────────────────
  // Rocket class
  // ─────────────────────────────────────────────
  function Rocket(x, targetY) {
    this.x       = x;
    this.y       = _canvas.height + 10;
    this.targetY = targetY;
    this.vy      = -rand(14, 20);   // upward speed
    this.vx      = rand(-1.2, 1.2); // slight horizontal drift
    this.color   = randColor();
    this.rgb     = hexToRgb(this.color);
    this.size    = rand(2.5, 4);
    this.trail   = [];
    this.dead    = false;
  }

  Rocket.prototype.update = function () {
    // Store trail point
    this.trail.push({ x: this.x, y: this.y, alpha: 1 });
    if (this.trail.length > 18) this.trail.shift();

    this.x += this.vx;
    this.y += this.vy;
    this.vy += GRAVITY * 0.35; // rockets experience less gravity

    // Explode when near target or when upward momentum exhausted
    if (this.y <= this.targetY || this.vy >= -1.5) {
      this.dead = true;
      createExplosion(this.x, this.y, this.color);
    }
  };

  Rocket.prototype.draw = function (ctx) {
    // Draw glowing trail
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i];
      const progress = i / this.trail.length;
      const alpha = progress * 0.7;
      const radius = this.size * progress * 0.8;

      ctx.beginPath();
      ctx.arc(t.x, t.y, Math.max(0.5, radius), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.rgb.r},${this.rgb.g},${this.rgb.b},${alpha})`;
      ctx.fill();
    }

    // Rocket head — bright glowing dot
    const grd = ctx.createRadialGradient(
      this.x, this.y, 0,
      this.x, this.y, this.size * 3
    );
    grd.addColorStop(0, `rgba(${this.rgb.r},${this.rgb.g},${this.rgb.b},1)`);
    grd.addColorStop(0.4, `rgba(${this.rgb.r},${this.rgb.g},${this.rgb.b},0.6)`);
    grd.addColorStop(1, `rgba(${this.rgb.r},${this.rgb.g},${this.rgb.b},0)`);

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * 3, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  };

  // ─────────────────────────────────────────────
  // Particle class
  // ─────────────────────────────────────────────
  function Particle(x, y, color, vx, vy, opts) {
    opts = opts || {};
    this.x      = x;
    this.y      = y;
    this.color  = color;
    this.rgb    = hexToRgb(color);
    this.vx     = vx;
    this.vy     = vy;
    this.alpha  = 1;
    this.size   = opts.size   || rand(1.5, 3.5);
    this.decay  = opts.decay  || rand(0.012, 0.022);
    this.shrink = opts.shrink || rand(0.96, 0.99);
    this.dead   = false;
    this.tail   = opts.tail   !== undefined ? opts.tail : true;
    this.tailPoints = [];
  }

  Particle.prototype.update = function () {
    if (this.tail) {
      this.tailPoints.push({ x: this.x, y: this.y, alpha: this.alpha });
      if (this.tailPoints.length > 6) this.tailPoints.shift();
    }

    this.x   += this.vx;
    this.y   += this.vy;
    this.vx  *= FRICTION;
    this.vy  *= FRICTION;
    this.vy  += GRAVITY;
    this.alpha -= this.decay;
    this.size  *= this.shrink;

    if (this.alpha <= 0 || this.size < 0.3) this.dead = true;
  };

  Particle.prototype.draw = function (ctx) {
    // Subtle tail
    if (this.tail && this.tailPoints.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this.tailPoints[0].x, this.tailPoints[0].y);
      for (let i = 1; i < this.tailPoints.length; i++) {
        ctx.lineTo(this.tailPoints[i].x, this.tailPoints[i].y);
      }
      ctx.strokeStyle = `rgba(${this.rgb.r},${this.rgb.g},${this.rgb.b},${this.alpha * 0.3})`;
      ctx.lineWidth = this.size * 0.5;
      ctx.stroke();
    }

    // Glowing particle
    const grd = ctx.createRadialGradient(
      this.x, this.y, 0,
      this.x, this.y, this.size * 2
    );
    grd.addColorStop(0, `rgba(255,255,255,${this.alpha * 0.9})`);
    grd.addColorStop(0.3, `rgba(${this.rgb.r},${this.rgb.g},${this.rgb.b},${this.alpha})`);
    grd.addColorStop(1, `rgba(${this.rgb.r},${this.rgb.g},${this.rgb.b},0)`);

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * 2, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
  };

  // ─────────────────────────────────────────────
  // Explosion factory
  // ─────────────────────────────────────────────
  function createExplosion(x, y, color) {
    const count = randInt(PARTICLES_MIN, PARTICLES_MAX);
    const particles = [];
    const baseColor = color || randColor();
    const secondColor = randColor();

    // Choose explosion shape
    const shapeRoll = Math.random();

    for (let i = 0; i < count; i++) {
      let vx, vy;
      const speed = rand(1.5, 9);

      if (shapeRoll < 0.5) {
        // Classic radial burst
        const angle = (i / count) * Math.PI * 2 + rand(-0.1, 0.1);
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
      } else if (shapeRoll < 0.75) {
        // Chrysanthemum — tight clustered burst with variation
        const angle = rand(0, Math.PI * 2);
        const r = rand(0.3, 1) * speed;
        vx = Math.cos(angle) * r;
        vy = Math.sin(angle) * r * rand(0.4, 1.2);
      } else {
        // Willow — drooping, fast initial then falls
        const angle = rand(0, Math.PI * 2);
        vx = Math.cos(angle) * speed * rand(0.5, 1);
        vy = Math.sin(angle) * speed * rand(0.3, 0.8) - rand(0, 2);
      }

      const pColor = Math.random() < 0.3 ? secondColor : baseColor;
      const p = new Particle(x, y, pColor, vx, vy, {
        size: rand(1.5, 4),
        decay: rand(0.010, 0.020),
        shrink: rand(0.97, 0.995),
        tail: true,
      });
      particles.push(p);
    }

    // Add sparkle particles (smaller, faster decay)
    const sparkCount = randInt(15, 30);
    for (let i = 0; i < sparkCount; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed2 = rand(0.5, 4);
      const p = new Particle(x, y, '#ECE8FF', Math.cos(angle) * speed2, Math.sin(angle) * speed2, {
        size: rand(0.8, 1.8),
        decay: rand(0.025, 0.045),
        shrink: rand(0.94, 0.98),
        tail: false,
      });
      particles.push(p);
    }

    _explosions.push(particles);
  }

  // ─────────────────────────────────────────────
  // Heart pattern (one-shot on load)
  // ─────────────────────────────────────────────
  function burstHeart(cx, cy, scale) {
    scale = scale || 1;
    const pts = 36;
    const colors = ['#FF6B9D', '#F5A623', '#C9B8FF', '#ECE8FF', '#E85D26'];

    for (let i = 0; i < pts; i++) {
      const t = (i / pts) * Math.PI * 2;
      // Parametric heart
      const hx = cx + (16 * Math.pow(Math.sin(t), 3)) * scale * 3;
      const hy = cy - (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * scale * 3;

      setTimeout(function (px, py) {
        const color = colors[Math.floor(Math.random() * colors.length)];
        createExplosion(px, py, color);
      }, i * 45, hx, hy);
    }
  }

  // ─────────────────────────────────────────────
  // Rocket spawn
  // ─────────────────────────────────────────────
  function spawnRocket() {
    if (!_canvas) return;
    const x       = rand(_canvas.width * 0.1, _canvas.width * 0.9);
    const targetY = rand(_canvas.height * 0.1, _canvas.height * 0.55);
    _rockets.push(new Rocket(x, targetY));
    _lastRocketTime = performance.now();
    // Schedule next rocket
    const rps = rand(ROCKETS_PER_SEC_MIN, ROCKETS_PER_SEC_MAX);
    _nextRocketInterval = 1000 / rps;
  }

  // ─────────────────────────────────────────────
  // Animation loop
  // ─────────────────────────────────────────────
  function loop(timestamp) {
    if (!_running) return;

    const ctx = _ctx;
    const W   = _canvas.width;
    const H   = _canvas.height;

    // Transparent fade-trail effect (not full clear — leave ghost)
    ctx.clearRect(0, 0, W, H);

    // Draw dim overlay to fade previous frame trails
    ctx.fillStyle = `rgba(8,6,26,${FADE_OVERLAY})`;
    ctx.fillRect(0, 0, W, H);

    // Spawn rockets on schedule
    if (timestamp - _lastRocketTime >= _nextRocketInterval) {
      spawnRocket();
    }

    // Update + draw rockets
    for (let i = _rockets.length - 1; i >= 0; i--) {
      const r = _rockets[i];
      r.update();
      r.draw(ctx);
      if (r.dead) _rockets.splice(i, 1);
    }

    // Update + draw explosion particles
    for (let e = _explosions.length - 1; e >= 0; e--) {
      const particles = _explosions[e];
      let allDead = true;

      for (let p = particles.length - 1; p >= 0; p--) {
        const particle = particles[p];
        particle.update();
        if (!particle.dead) {
          particle.draw(ctx);
          allDead = false;
        }
      }

      if (allDead) _explosions.splice(e, 1);
    }

    _raf = requestAnimationFrame(loop);
  }

  // ─────────────────────────────────────────────
  // Resize handler — keeps canvas full-window
  // ─────────────────────────────────────────────
  function onResize() {
    if (!_canvas) return;
    _canvas.width  = window.innerWidth;
    _canvas.height = window.innerHeight;
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  /**
   * startFireworks(canvasId)
   * Begins the autonomous fireworks loop on the given canvas element.
   * The canvas should be positioned as an overlay (position:fixed, top:0, left:0,
   * width:100vw, height:100vh, pointer-events:none, z-index:9999).
   *
   * @param {string} canvasId — id of the <canvas> element
   */
  function startFireworks(canvasId) {
    if (_running) stopFireworks();

    _canvas = document.getElementById(canvasId);
    if (!_canvas) {
      console.warn('[fireworks] Canvas not found:', canvasId);
      return;
    }

    _ctx = _canvas.getContext('2d');
    _canvas.width  = window.innerWidth;
    _canvas.height = window.innerHeight;

    // Make transparent overlay if not already styled
    _canvas.style.pointerEvents = 'none';
    _canvas.style.background    = 'transparent';

    window.addEventListener('resize', onResize);

    _running = true;
    _lastRocketTime = performance.now();
    _nextRocketInterval = rand(300, 500);

    // Kick off first rocket immediately
    spawnRocket();

    // Heart burst after a short delay (300ms) so first rockets are visible
    setTimeout(function () {
      if (!_running || !_canvas) return;
      const cx = _canvas.width  / 2;
      const cy = _canvas.height / 2;
      burstHeart(cx, cy, 1);
    }, 300);

    _raf = requestAnimationFrame(loop);
  }

  /**
   * stopFireworks()
   * Cancels the animation loop and clears the canvas.
   */
  function stopFireworks() {
    _running = false;

    if (_raf) {
      cancelAnimationFrame(_raf);
      _raf = null;
    }

    if (_ctx && _canvas) {
      _ctx.clearRect(0, 0, _canvas.width, _canvas.height);
    }

    window.removeEventListener('resize', onResize);

    _rockets.length    = 0;
    _explosions.length = 0;
    _canvas = null;
    _ctx    = null;
  }

  /**
   * burst(x, y)
   * Triggers a single manual explosion at the given canvas-space coordinates.
   * If the loop is not running, call startFireworks() first.
   *
   * @param {number} x — horizontal position in pixels
   * @param {number} y — vertical position in pixels
   */
  function burst(x, y) {
    createExplosion(x, y, null);
  }

  // ─────────────────────────────────────────────
  // Export to global scope
  // ─────────────────────────────────────────────
  global.startFireworks = startFireworks;
  global.stopFireworks  = stopFireworks;
  global.burst          = burst;

}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this));
