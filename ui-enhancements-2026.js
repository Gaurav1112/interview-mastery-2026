/**
 * UI Enhancements 2026 — interview-mastery dark app
 * Self-contained additions; requires existing: render(), setTab(), toggleExp(),
 * renderCard(), renderStats(), renderSidebar(), randomQ()
 */

/* ─── 1. VIEW TRANSITIONS API TAB SWITCHING ─────────────────────────────── */

// Inject CSS for view transitions
(function injectViewTransitionCSS() {
  const style = document.createElement('style');
  style.textContent = `
    ::view-transition-old(tab-content) {
      animation: 160ms cubic-bezier(.4,0,1,1) both vt-slide-out;
    }
    ::view-transition-new(tab-content) {
      animation: 200ms cubic-bezier(0,0,.2,1) both vt-slide-in;
    }
    @keyframes vt-slide-out {
      to { opacity: 0; transform: translateX(var(--vt-dir, -24px)); }
    }
    @keyframes vt-slide-in {
      from { opacity: 0; transform: translateX(calc(var(--vt-dir, -24px) * -1)); }
    }
    .tab-content { view-transition-name: tab-content; }
  `;
  document.head.appendChild(style);
})();

// Tab order for direction detection
const TAB_ORDER = ['guide', 'questions', 'flashcards', 'bookmarks', 'stats'];
let _activeTabIndex = 0;

const _origSetTab = typeof setTab === 'function' ? setTab : null;

function setTabWithTransition(name, el) {
  const nextIndex = TAB_ORDER.indexOf(name);
  const dir = nextIndex > _activeTabIndex ? -24 : 24; // negative = slide left
  document.documentElement.style.setProperty('--vt-dir', `${dir}px`);
  _activeTabIndex = nextIndex !== -1 ? nextIndex : _activeTabIndex;

  if (document.startViewTransition) {
    document.startViewTransition(() => {
      if (_origSetTab) _origSetTab(name, el);
    });
  } else {
    if (_origSetTab) _origSetTab(name, el);
  }
}

// Patch all tab click handlers to use transition wrapper
document.querySelectorAll('.tab').forEach(tab => {
  const clone = tab.cloneNode(true);
  tab.parentNode.replaceChild(clone, tab);
  clone.addEventListener('click', () => {
    const name = clone.dataset.tab || clone.textContent.trim().toLowerCase().split(' ')[0];
    setTabWithTransition(name, clone);
  });
});


/* ─── 2. STAGGERED CARD APPEAR ANIMATION ────────────────────────────────── */

(function injectCardAnimCSS() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes card-fade-up {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .card-anim {
      animation: card-fade-up 260ms cubic-bezier(0,0,.2,1) both;
      animation-delay: calc(var(--i, 0) * 40ms);
    }
  `;
  document.head.appendChild(style);
})();

/**
 * Call after render() injects cards into the DOM.
 * container: CSS selector or element for the card list, default '#q-list'
 */
function animateCards(container) {
  const parent = typeof container === 'string'
    ? document.querySelector(container)
    : (container || document.querySelector('#q-list') || document.querySelector('.tab-pane.active'));
  if (!parent) return;
  const cards = parent.querySelectorAll('.card');
  cards.forEach((card, i) => {
    card.style.setProperty('--i', i);
    card.classList.remove('card-anim');
    // Force reflow so re-adding the class restarts animation
    void card.offsetWidth;
    card.classList.add('card-anim');
  });
}

// Wrap render() to auto-animate after it runs
const _origRender = typeof render === 'function' ? render : null;
function render(...args) {
  if (_origRender) _origRender(...args);
  // Schedule after DOM update
  requestAnimationFrame(() => animateCards());
}


/* ─── 3. SEARCH DEBOUNCE ────────────────────────────────────────────────── */

function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

const searchEl = document.getElementById('search');
if (searchEl) {
  // Remove any inline oninput / existing listener by replacing node
  const newSearch = searchEl.cloneNode(true);
  searchEl.parentNode.replaceChild(newSearch, searchEl);

  newSearch.addEventListener('input', debounce(() => {
    if (typeof render === 'function') render();
  }, 200));
}


/* ─── 4. RIPPLE EFFECT ON BUTTON CLICK ──────────────────────────────────── */

(function injectRippleCSS() {
  const style = document.createElement('style');
  style.textContent = `
    .ls-btn, .btn, .act-btn { position: relative; overflow: hidden; }
    .ripple-wave {
      position: absolute;
      border-radius: 50%;
      background: rgba(255,255,255,0.18);
      transform: scale(0);
      animation: ripple-expand 500ms linear;
      pointer-events: none;
    }
    @keyframes ripple-expand {
      to { transform: scale(4); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
})();

document.addEventListener('click', function (e) {
  const btn = e.target.closest('.ls-btn, .btn, .act-btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const wave = document.createElement('span');
  wave.className = 'ripple-wave';
  wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(wave);
  wave.addEventListener('animationend', () => wave.remove());
}, true);


/* ─── 5. SMOOTH PROGRESS RING (JS-DRIVEN) ───────────────────────────────── */

/**
 * Animate SVG stroke-dashoffset from current value to target.
 * Call this instead of directly setting the attribute.
 * ringEl: the .progress-ring-fill element
 * targetOffset: numeric dashoffset value (0 = full, 100.53 = empty)
 * duration: ms, default 700
 */
function animateRing(ringEl, targetOffset, duration) {
  if (!ringEl) return;
  duration = duration || 700;
  const start = parseFloat(ringEl.getAttribute('stroke-dashoffset') || '100.53');
  const delta = targetOffset - start;
  if (Math.abs(delta) < 0.5) return; // already at target
  let startTime = null;

  function ease(t) { return t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t; } // ease-in-out

  function step(ts) {
    if (!startTime) startTime = ts;
    const progress = Math.min((ts - startTime) / duration, 1);
    ringEl.setAttribute('stroke-dashoffset', start + delta * ease(progress));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Wrap renderSidebar() to use animateRing
const _origRenderSidebar = typeof renderSidebar === 'function' ? renderSidebar : null;
function renderSidebar(...args) {
  // Capture pre-render offset
  const ringFill = document.querySelector('.progress-ring-fill');
  const before = ringFill ? parseFloat(ringFill.getAttribute('stroke-dashoffset') || '100.53') : null;

  if (_origRenderSidebar) _origRenderSidebar(...args);

  // After render, grab new offset, reset to before, then animate
  if (ringFill && before !== null) {
    const after = parseFloat(ringFill.getAttribute('stroke-dashoffset') || '100.53');
    if (Math.abs(after - before) > 0.5) {
      ringFill.setAttribute('stroke-dashoffset', before);
      animateRing(ringFill, after);
    }
  }
}


/* ─── 6. CATEGORY COLOR MAP ─────────────────────────────────────────────── */

const CAT_COLORS = {
  'System Design':        '#E85D26',
  'Java Core':            '#4B9FFF',
  'Spring Boot':          '#17C492',
  'Microservices':        '#A78BFA',
  'Database & JPA':       '#F5A623',
  'Kafka & Messaging':    '#FF5757',
  'AWS & Cloud':          '#17C492',
  'Performance & Tuning': '#F5A623',
  'Security':             '#FF5757',
  'Behavioral':           '#A78BFA',
  'Alisha Scenarios':     '#E85D26',
  'DSA':                  '#4B9FFF',
  'Concurrency':          '#17C492',
  'Testing':              '#F5A623',
  'DevOps & CI/CD':       '#A78BFA',
};

/**
 * Sets --cat-color CSS custom property on each card based on its category badge.
 * Call after render().
 */
function applyCatColors(container) {
  const parent = typeof container === 'string'
    ? document.querySelector(container)
    : (container || document.querySelector('#q-list') || document.querySelector('.tab-pane.active'));
  if (!parent) return;
  parent.querySelectorAll('.card').forEach(card => {
    const badge = card.querySelector('.cat-badge');
    if (!badge) return;
    const cat = badge.textContent.trim();
    const color = CAT_COLORS[cat] || '#E85D26';
    card.style.setProperty('--cat-color', color);
    // Override answered border-left to use category color when not answered
    if (!card.classList.contains('answered')) {
      card.style.borderLeft = `2px solid var(--cat-color)`;
    }
  });
}

// Re-patch render() to also apply category colors after animation
const _renderWithAnim = render;
function render(...args) {
  _renderWithAnim(...args);
  requestAnimationFrame(() => applyCatColors());
}


/* ─── 7. KEYBOARD SHORTCUTS ─────────────────────────────────────────────── */

document.addEventListener('keydown', function (e) {
  // Skip if focus is in an input/textarea (except for Escape)
  const active = document.activeElement;
  const inInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);

  const search = document.getElementById('search');

  // `/` — focus search
  if (e.key === '/' && !inInput) {
    e.preventDefault();
    if (search) { search.focus(); search.select(); }
    return;
  }

  // `Escape` — clear and blur search
  if (e.key === 'Escape' && search) {
    search.value = '';
    search.blur();
    if (typeof render === 'function') render();
    return;
  }

  // `R` — random question (not in input)
  if ((e.key === 'r' || e.key === 'R') && !inInput) {
    if (typeof randomQ === 'function') randomQ();
    return;
  }
});
