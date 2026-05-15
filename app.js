// ----- Helpers ---------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function svg(tag, attrs = {}, parent = null) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.appendChild(el);
  return el;
}

function formatTime(seconds) {
  seconds = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ----- State -----------------------------------------------------
const state = {
  duration: 300,
  remaining: 300,
  startedAt: 0,
  pausedAt: 0,
  pausedTotal: 0,
  paused: false,
  vizId: 'barclassic',
  running: false,
  done: false,
  soundOn: true,
  keepAwake: true,
};

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('toddler-timer-prefs') || '{}');
    if (typeof p.soundOn === 'boolean') state.soundOn = p.soundOn;
    if (typeof p.keepAwake === 'boolean') state.keepAwake = p.keepAwake;
  } catch { /* no-op */ }
}
function savePrefs() {
  try {
    localStorage.setItem('toddler-timer-prefs', JSON.stringify({
      soundOn: state.soundOn,
      keepAwake: state.keepAwake,
    }));
  } catch { /* no-op */ }
}

let currentViz = null;
let wakeLock = null;

// ----- Audio -----------------------------------------------------
let audioCtx = null;
function audio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  return audioCtx;
}

function playTone(freq, dur = 0.2, type = 'sine', gain = 0.18, when = 0) {
  if (!state.soundOn) return;
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function playDoneChime() {
  // C E G C — bright happy arpeggio
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((f, i) => playTone(f, 0.45, 'triangle', 0.22, i * 0.12));
  // Soft sparkle bell on top
  setTimeout(() => playTone(2093, 0.6, 'sine', 0.1), 600);
}

function playSelectTick() {
  playTone(880, 0.06, 'square', 0.08);
}

// ----- Wake lock -------------------------------------------------
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* no-op */ }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (state.running && state.keepAwake && document.visibilityState === 'visible') acquireWakeLock();
});

// ----- Setup screen ---------------------------------------------
function setupScreenInit() {
  $$('.duration-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.duration-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.duration = parseInt(btn.dataset.seconds, 10);
      $('#custom-min').value = '';
      playSelectTick();
    });
  });
  $('#custom-min').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v) && v > 0) {
      state.duration = v * 60;
      $$('.duration-btn').forEach((b) => b.classList.remove('selected'));
    }
  });
  $$('.viz-card').forEach((card) => {
    card.addEventListener('click', () => {
      $$('.viz-card').forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      state.vizId = card.dataset.viz;
      playSelectTick();
    });
  });
  const soundEl = $('#sound-toggle');
  const awakeEl = $('#awake-toggle');
  soundEl.checked = state.soundOn;
  awakeEl.checked = state.keepAwake;
  soundEl.addEventListener('change', (e) => {
    state.soundOn = e.target.checked;
    savePrefs();
  });
  awakeEl.addEventListener('change', (e) => {
    state.keepAwake = e.target.checked;
    if (!state.keepAwake) releaseWakeLock();
    else if (state.running) acquireWakeLock();
    savePrefs();
  });
  $('#start-btn').addEventListener('click', startTimer);
  $('#pause-btn').addEventListener('click', togglePause);
  $('#reset-btn').addEventListener('click', backToSetup);
}

// ----- Timer flow -----------------------------------------------
function startTimer() {
  audio(); // create on user gesture
  state.remaining = state.duration;
  state.startedAt = performance.now();
  state.pausedTotal = 0;
  state.paused = false;
  state.running = true;
  state.done = false;
  $('#setup-screen').classList.remove('visible');
  $('#run-screen').classList.add('visible');
  $('#done-overlay').classList.remove('visible');
  $('#pause-btn').textContent = 'Pause';
  loadViz(state.vizId);
  if (state.keepAwake) acquireWakeLock();
}

function togglePause() {
  if (state.done) return;
  if (state.paused) {
    state.pausedTotal += performance.now() - state.pausedAt;
    state.paused = false;
    $('#pause-btn').textContent = 'Pause';
  } else {
    state.pausedAt = performance.now();
    state.paused = true;
    $('#pause-btn').textContent = 'Resume';
  }
}

function backToSetup() {
  state.running = false;
  state.done = false;
  state.paused = false;
  releaseWakeLock();
  $('#run-screen').classList.remove('visible');
  $('#setup-screen').classList.add('visible');
  $('#done-overlay').classList.remove('visible');
  // Clear stage style
  $('#stage').style.background = '';
  const s = $('#viz-svg');
  while (s.firstChild) s.removeChild(s.firstChild);
}

function finishTimer() {
  if (state.done) return;
  state.done = true;
  state.running = false;
  $('#done-overlay').classList.add('visible');
  $('#pause-btn').textContent = 'Pause';
  playDoneChime();
  fireConfetti();
  releaseWakeLock();
}

// ----- Visualization registry ----------------------------------
const vizRegistry = {};
function registerViz(id, def) { vizRegistry[id] = def; }

function loadViz(id) {
  const def = vizRegistry[id];
  if (!def) return;
  const s = $('#viz-svg');
  while (s.firstChild) s.removeChild(s.firstChild);
  $('#stage').style.background = def.background || '';
  currentViz = def;
  def.init(s);
}

// ----- Main loop ------------------------------------------------
function tick(t) {
  if (state.running) {
    let elapsedMs = performance.now() - state.startedAt - state.pausedTotal;
    if (state.paused) elapsedMs -= (performance.now() - state.pausedAt);
    const elapsed = elapsedMs / 1000;
    state.remaining = Math.max(0, state.duration - elapsed);
    $('#time-readout').textContent = formatTime(state.remaining);
    const progressDone = clamp(elapsed / state.duration, 0, 1);
    if (currentViz) currentViz.render($('#viz-svg'), progressDone, t / 1000);
    if (state.remaining <= 0) finishTimer();
  } else if (state.done && currentViz) {
    currentViz.render($('#viz-svg'), 1, t / 1000);
  }
  requestAnimationFrame(tick);
}

// =================================================================
// VISUALIZATIONS
// =================================================================

// ----- BAR CLASSIC ----------------------------------------------
registerViz('barclassic', (() => {
  const x0 = 100, x1 = 900, midY = 350, h = 160;
  let fillBar, fillTop, faceG;
  return {
    background: 'linear-gradient(180deg, #fff7ec 0%, #ffe5b0 100%)',
    init(s) {
      const defs = svg('defs', {}, s);
      const grad = svg('linearGradient', { id: 'bc-grad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      svg('stop', { offset: '0%', 'stop-color': '#7ee0c8', id: 'bc-stop-1' }, grad);
      svg('stop', { offset: '100%', 'stop-color': '#5aa9e6', id: 'bc-stop-2' }, grad);
      svg('rect', {
        x: x0 - 14, y: midY - h / 2 - 14, width: (x1 - x0) + 28, height: h + 28,
        rx: 94, ry: 94, fill: '#fff', opacity: 0.55,
        stroke: '#d6c8a8', 'stroke-width': 6
      }, s);
      svg('rect', {
        x: x0, y: midY - h / 2, width: x1 - x0, height: h,
        rx: 80, ry: 80, fill: '#ecd9b3', opacity: 0.7
      }, s);
      fillBar = svg('rect', {
        x: x0, y: midY - h / 2, width: x1 - x0, height: h,
        rx: 80, ry: 80, fill: 'url(#bc-grad)'
      }, s);
      fillTop = svg('rect', {
        x: x0 + 14, y: midY - h / 2 + 16, width: x1 - x0 - 28, height: 26,
        rx: 13, fill: 'rgba(255,255,255,0.4)'
      }, s);
      faceG = svg('g', {}, s);
      svg('circle', { cx: -18, cy: -8, r: 8, fill: '#2d2a3a' }, faceG);
      svg('circle', { cx: 18, cy: -8, r: 8, fill: '#2d2a3a' }, faceG);
      svg('circle', { cx: -15, cy: -12, r: 3, fill: 'white' }, faceG);
      svg('circle', { cx: 21, cy: -12, r: 3, fill: 'white' }, faceG);
      svg('path', { d: 'M -18 14 Q 0 30 18 14', stroke: '#2d2a3a', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round' }, faceG);
      svg('circle', { cx: -38, cy: 8, r: 10, fill: 'rgba(255,180,160,0.7)' }, faceG);
      svg('circle', { cx: 38, cy: 8, r: 10, fill: 'rgba(255,180,160,0.7)' }, faceG);
    },
    render(s, progressDone, t) {
      const remain = clamp(1 - progressDone, 0, 1);
      const newWidth = Math.max(0.01, (x1 - x0) * remain);
      fillBar.setAttribute('width', newWidth);
      fillTop.setAttribute('width', Math.max(0.01, newWidth - 28));
      const c1 = mixHex('#7ee0c8', '#ffd166', progressDone);
      const c2 = mixHex('#5aa9e6', '#ff7a9b', progressDone);
      s.querySelector('#bc-stop-1').setAttribute('stop-color', c1);
      s.querySelector('#bc-stop-2').setAttribute('stop-color', c2);
      const bob = Math.sin(t * 2) * 4;
      faceG.setAttribute('transform', `translate(${x0 + 90} ${midY + bob})`);
      faceG.setAttribute('opacity', remain > 0.05 ? 1 : 0);
    }
  };
})());

// ----- BAR LIQUID (juice glass) --------------------------------
registerViz('barliquid', (() => {
  const x0 = 120, x1 = 880, midY = 360, h = 200;
  let liquidPath;
  const bubbles = [];
  return {
    background: 'linear-gradient(180deg, #f0e6ff 0%, #ffe6f3 100%)',
    init(s) {
      bubbles.length = 0;
      const defs = svg('defs', {}, s);
      const clip = svg('clipPath', { id: 'bl-clip' }, defs);
      svg('rect', { x: x0, y: midY - h / 2, width: x1 - x0, height: h, rx: 100, ry: 100 }, clip);
      const grad = svg('linearGradient', { id: 'bl-grad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      svg('stop', { offset: '0%', 'stop-color': '#b88aff' }, grad);
      svg('stop', { offset: '100%', 'stop-color': '#7a4fcc' }, grad);
      svg('rect', {
        x: x0, y: midY - h / 2, width: x1 - x0, height: h,
        rx: 100, ry: 100, fill: 'rgba(255,255,255,0.55)',
        stroke: '#5a4080', 'stroke-width': 7
      }, s);
      const liquidLayer = svg('g', { 'clip-path': 'url(#bl-clip)' }, s);
      liquidPath = svg('path', { d: '', fill: 'url(#bl-grad)' }, liquidLayer);
      const bubbleLayer = svg('g', { 'clip-path': 'url(#bl-clip)' }, s);
      for (let i = 0; i < 10; i++) {
        const bx = x0 + Math.random() * (x1 - x0);
        const by = midY + (Math.random() - 0.5) * h * 0.8;
        const r = 4 + Math.random() * 8;
        const c = svg('circle', { cx: bx, cy: by, r, fill: 'rgba(255,255,255,0.55)' }, bubbleLayer);
        bubbles.push({ el: c, x: bx, y: by, r, vy: 8 + Math.random() * 16, phase: Math.random() * 6.28 });
      }
      svg('rect', {
        x: x0 + 18, y: midY - h / 2 + 14, width: x1 - x0 - 36, height: 14,
        rx: 7, fill: 'rgba(255,255,255,0.55)'
      }, s);
      const straw = svg('g', { transform: `rotate(10 ${x1 - 70} ${midY - h / 2})` }, s);
      svg('rect', {
        x: x1 - 80, y: midY - h / 2 - 130, width: 18, height: 170, rx: 8,
        fill: '#ff5a5a', stroke: '#a83333', 'stroke-width': 3
      }, straw);
      svg('rect', {
        x: x1 - 80, y: midY - h / 2 - 130, width: 18, height: 80, rx: 8,
        fill: '#ffe5e5', opacity: 0.75
      }, straw);
    },
    render(s, progressDone, t) {
      const remain = clamp(1 - progressDone, 0, 1);
      const leadingX = x0 + (x1 - x0) * remain;
      const yTop = midY - h / 2;
      const yBot = midY + h / 2;
      const segs = 14;
      const amp = 16;
      let d = `M ${x0} ${yBot} L ${x0} ${yTop} `;
      for (let i = 0; i <= segs; i++) {
        const x = lerp(x0, leadingX, i / segs);
        const dy = Math.sin(t * 2 + i * 0.5) * 3 * (i / segs);
        d += `L ${x} ${yTop + dy} `;
      }
      for (let i = 1; i <= segs; i++) {
        const ty = lerp(yTop, yBot, i / segs);
        const dx = Math.sin(t * 3 + i * 0.55) * amp;
        d += `L ${leadingX + dx} ${ty} `;
      }
      for (let i = segs - 1; i >= 0; i--) {
        const x = lerp(x0, leadingX, i / segs);
        const dy = Math.sin(t * 1.6 + i * 0.4) * 2 * (i / segs);
        d += `L ${x} ${yBot + dy} `;
      }
      d += 'Z';
      liquidPath.setAttribute('d', d);
      const dt = 1 / 60;
      bubbles.forEach((b) => {
        b.y -= b.vy * dt;
        b.x += Math.sin(t * 1.4 + b.phase) * 0.6;
        if (b.y < yTop + 12 || b.x > leadingX - b.r - 8) {
          b.y = yBot - 12 - Math.random() * 30;
          b.x = x0 + 16 + Math.random() * Math.max(20, leadingX - x0 - 40);
        }
        b.el.setAttribute('cx', b.x);
        b.el.setAttribute('cy', b.y);
      });
    }
  };
})());

// ----- PIE CLOCK ------------------------------------------------
registerViz('pieclock', (() => {
  const cx = 500, cy = 350, R = 230;
  let pieEl, faceG;
  const circ = 2 * Math.PI * (R / 2);
  return {
    background: 'linear-gradient(180deg, #fff7d6 0%, #ffe9a8 100%)',
    init(s) {
      svg('circle', {
        cx, cy, r: R + 10, fill: '#fff5cc', stroke: '#dba14a', 'stroke-width': 5
      }, s);
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI * 2 / 12 - Math.PI / 2;
        const dx = cx + Math.cos(a) * (R + 38);
        const dy = cy + Math.sin(a) * (R + 38);
        svg('circle', { cx: dx, cy: dy, r: i % 3 === 0 ? 8 : 5, fill: '#a87420' }, s);
      }
      const pieGroup = svg('g', { transform: `rotate(-90 ${cx} ${cy})` }, s);
      pieEl = svg('circle', {
        cx, cy, r: R / 2,
        fill: 'none',
        stroke: '#ff9a3c',
        'stroke-width': R,
        'stroke-dasharray': `${circ} ${circ}`
      }, pieGroup);
      faceG = svg('g', {}, s);
      svg('circle', { cx, cy, r: 52, fill: '#fff4cc', stroke: '#a87420', 'stroke-width': 4 }, faceG);
      svg('circle', { cx: cx - 16, cy: cy - 8, r: 6, fill: '#2d2a3a' }, faceG);
      svg('circle', { cx: cx + 16, cy: cy - 8, r: 6, fill: '#2d2a3a' }, faceG);
      svg('circle', { cx: cx - 13, cy: cy - 11, r: 2, fill: 'white' }, faceG);
      svg('circle', { cx: cx + 19, cy: cy - 11, r: 2, fill: 'white' }, faceG);
      svg('path', {
        d: `M ${cx - 16} ${cy + 12} Q ${cx} ${cy + 26} ${cx + 16} ${cy + 12}`,
        stroke: '#2d2a3a', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round'
      }, faceG);
    },
    render(s, progressDone, t) {
      const visible = circ * (1 - progressDone);
      if (visible < 1.5) {
        pieEl.style.display = 'none';
      } else {
        pieEl.style.display = '';
        pieEl.setAttribute('stroke-dasharray', `${visible} ${circ}`);
      }
      const bob = Math.sin(t * 2) * 2;
      faceG.setAttribute('transform', `translate(0 ${bob})`);
    }
  };
})());

// ----- PIE RING (donut) -----------------------------------------
registerViz('piering', (() => {
  const cx = 500, cy = 350;
  const outerR = 260, ringW = 84;
  const r = outerR - ringW / 2;
  const circ = 2 * Math.PI * r;
  let ringEl, sunG;
  return {
    background: 'linear-gradient(180deg, #ffe6f3 0%, #fff5ec 100%)',
    init(s) {
      svg('circle', {
        cx, cy, r,
        fill: 'none', stroke: '#f7d6e3', 'stroke-width': ringW
      }, s);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.2;
        const sx = cx + Math.cos(a) * (outerR + 56);
        const sy = cy + Math.sin(a) * (outerR + 56);
        svg('circle', {
          cx: sx, cy: sy, r: 5 + Math.random() * 4,
          fill: '#ffd166', opacity: 0.7,
          class: 'pr-sparkle', 'data-phase': i * 0.7
        }, s);
      }
      const ringGroup = svg('g', { transform: `rotate(-90 ${cx} ${cy})` }, s);
      ringEl = svg('circle', {
        cx, cy, r,
        fill: 'none',
        stroke: '#ff7a9b',
        'stroke-width': ringW,
        'stroke-linecap': 'round',
        'stroke-dasharray': `${circ} ${circ}`
      }, ringGroup);
      sunG = svg('g', {}, s);
      svg('circle', { cx, cy, r: 108, fill: '#ffe066', stroke: '#ffc94a', 'stroke-width': 4 }, sunG);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        const x1r = cx + Math.cos(a) * 74, y1r = cy + Math.sin(a) * 74;
        const x2r = cx + Math.cos(a) * 100, y2r = cy + Math.sin(a) * 100;
        svg('line', { x1: x1r, y1: y1r, x2: x2r, y2: y2r, stroke: '#ffb84a', 'stroke-width': 5, 'stroke-linecap': 'round' }, sunG);
      }
      svg('circle', { cx: cx - 22, cy: cy - 10, r: 8, fill: '#2d2a3a' }, sunG);
      svg('circle', { cx: cx + 22, cy: cy - 10, r: 8, fill: '#2d2a3a' }, sunG);
      svg('circle', { cx: cx - 18, cy: cy - 14, r: 2.5, fill: 'white' }, sunG);
      svg('circle', { cx: cx + 26, cy: cy - 14, r: 2.5, fill: 'white' }, sunG);
      svg('path', {
        d: `M ${cx - 22} ${cy + 18} Q ${cx} ${cy + 36} ${cx + 22} ${cy + 18}`,
        stroke: '#2d2a3a', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round'
      }, sunG);
      svg('circle', { cx: cx - 40, cy: cy + 14, r: 10, fill: '#ffb0a0', opacity: 0.7 }, sunG);
      svg('circle', { cx: cx + 40, cy: cy + 14, r: 10, fill: '#ffb0a0', opacity: 0.7 }, sunG);
    },
    render(s, progressDone, t) {
      const visible = circ * (1 - progressDone);
      if (visible < 1.5) {
        ringEl.style.display = 'none';
      } else {
        ringEl.style.display = '';
        ringEl.setAttribute('stroke-dasharray', `${visible} ${circ}`);
      }
      const pulse = 1 + Math.sin(t * 2) * 0.03;
      sunG.setAttribute('transform', `translate(${cx} ${cy}) scale(${pulse}) translate(${-cx} ${-cy})`);
      s.querySelectorAll('.pr-sparkle').forEach((sp) => {
        const phase = parseFloat(sp.dataset.phase);
        sp.setAttribute('opacity', 0.4 + 0.4 * Math.sin(t * 2 + phase));
      });
    }
  };
})());

// ----- RAINBOW ---------------------------------------------------
registerViz('rainbow', (() => {
  const cx = 500, cy = 350;
  const colors = ['#ff4757', '#ff9a3c', '#ffd84a', '#5fcf83', '#5aa9e6', '#7a6cd6', '#b88aff'];
  const radii = [280, 248, 216, 184, 152, 120, 88];
  const STROKE_WIDTH = 28;
  let rings = [];
  let sun, sparkleG, cloudA, cloudB;
  const sparkles = [];
  let sunFlashUntil = 0;
  const ringVanishAt = Array(7).fill(false);

  function makeSparkle(parent, x, y, size) {
    const g = svg('g', { class: 'rainbow-sparkle', transform: `translate(${x} ${y})` }, parent);
    const d = `M 0 ${-size} L ${size * 0.28} ${-size * 0.28} L ${size} 0 L ${size * 0.28} ${size * 0.28} L 0 ${size} L ${-size * 0.28} ${size * 0.28} L ${-size} 0 L ${-size * 0.28} ${-size * 0.28} Z`;
    svg('path', { d, fill: '#ffffff' }, g);
    return g;
  }

  return {
    background: 'linear-gradient(180deg, #f0e6ff 0%, #ffe6f3 60%, #fff7ec 100%)',
    init(s) {
      rings = [];
      sparkles.length = 0;
      sunFlashUntil = 0;
      for (let i = 0; i < 7; i++) ringVanishAt[i] = false;

      // Soft fluffy clouds at base
      cloudA = svg('g', {}, s);
      svg('ellipse', { cx: 200, cy: 600, rx: 140, ry: 44, fill: 'rgba(255,255,255,0.9)' }, cloudA);
      svg('ellipse', { cx: 140, cy: 590, rx: 70, ry: 36, fill: 'rgba(255,255,255,0.9)' }, cloudA);
      svg('ellipse', { cx: 260, cy: 590, rx: 70, ry: 36, fill: 'rgba(255,255,255,0.9)' }, cloudA);

      cloudB = svg('g', {}, s);
      svg('ellipse', { cx: 800, cy: 620, rx: 160, ry: 48, fill: 'rgba(255,255,255,0.95)' }, cloudB);
      svg('ellipse', { cx: 740, cy: 608, rx: 80, ry: 38, fill: 'rgba(255,255,255,0.95)' }, cloudB);
      svg('ellipse', { cx: 860, cy: 608, rx: 80, ry: 38, fill: 'rgba(255,255,255,0.95)' }, cloudB);

      // Ring group rotated so the depletion starts from 12 o'clock
      const ringGroup = svg('g', { transform: `rotate(-90 ${cx} ${cy})` }, s);
      for (let i = 0; i < 7; i++) {
        const r = radii[i];
        const circ = 2 * Math.PI * r;
        const ring = svg('circle', {
          cx, cy, r,
          fill: 'none',
          stroke: colors[i],
          'stroke-width': STROKE_WIDTH,
          'stroke-linecap': 'round',
          'stroke-dasharray': `${circ} ${circ}`,
        }, ringGroup);
        rings.push({ el: ring, circ });
      }

      // Sun in center
      sun = svg('g', {}, s);
      svg('circle', { cx, cy, r: 56, fill: '#ffe066', stroke: '#ffc94a', 'stroke-width': 3 }, sun);
      svg('circle', { cx: cx - 14, cy: cy - 6, r: 5, fill: '#2d2a3a' }, sun);
      svg('circle', { cx: cx + 14, cy: cy - 6, r: 5, fill: '#2d2a3a' }, sun);
      svg('circle', { cx: cx - 12, cy: cy - 8, r: 1.5, fill: 'white' }, sun);
      svg('circle', { cx: cx + 16, cy: cy - 8, r: 1.5, fill: 'white' }, sun);
      svg('path', { d: `M ${cx - 14} ${cy + 14} Q ${cx} ${cy + 28} ${cx + 14} ${cy + 14}`, stroke: '#2d2a3a', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }, sun);
      svg('circle', { cx: cx - 26, cy: cy + 14, r: 7, fill: '#ffb0a0', opacity: 0.7 }, sun);
      svg('circle', { cx: cx + 26, cy: cy + 14, r: 7, fill: '#ffb0a0', opacity: 0.7 }, sun);

      // Sparkles around the rainbow
      sparkleG = svg('g', {}, s);
      const positions = [
        { x: 140, y: 180, s: 10 }, { x: 860, y: 160, s: 12 }, { x: 80, y: 360, s: 8 },
        { x: 920, y: 380, s: 10 }, { x: 180, y: 90, s: 7 }, { x: 780, y: 90, s: 9 },
        { x: 60, y: 220, s: 6 }, { x: 940, y: 260, s: 7 }, { x: 320, y: 50, s: 8 },
        { x: 680, y: 50, s: 8 }, { x: 500, y: 30, s: 9 }, { x: 40, y: 480, s: 6 },
        { x: 960, y: 500, s: 7 },
      ];
      positions.forEach((p) => {
        const star = makeSparkle(sparkleG, p.x, p.y, p.s);
        sparkles.push({ el: star, x: p.x, y: p.y, size: p.s, phase: Math.random() * 6.28 });
      });
    },
    render(s, progressDone, t) {
      rings.forEach(({ el, circ }, i) => {
        const localProgress = clamp(progressDone * 7 - i, 0, 1);
        if (localProgress >= 1) {
          if (!ringVanishAt[i]) {
            ringVanishAt[i] = true;
            sunFlashUntil = t + 0.35;
            playTone(300 + i * 80, 0.18, 'sine', 0.18);
          }
          el.style.display = 'none';
        } else {
          el.style.display = '';
          if (localProgress <= 0) {
            el.setAttribute('stroke-dasharray', `${circ} ${circ}`);
          } else {
            el.setAttribute('stroke-dasharray', `${circ * (1 - localProgress)} ${circ}`);
          }
        }
      });

      const flashing = t < sunFlashUntil;
      const flashScale = flashing ? 1 + 0.22 * Math.sin((t - (sunFlashUntil - 0.35)) / 0.35 * Math.PI) : 1;
      const pulse = flashScale * (1 + Math.sin(t * 2) * 0.04);
      const float = Math.sin(t * 1.2) * 4;
      sun.setAttribute('transform', `translate(0 ${float}) translate(${cx} ${cy}) scale(${pulse}) translate(${-cx} ${-cy})`);

      // Sparkles twinkle and slowly rotate (transforms compose left-to-right around translated origin)
      sparkles.forEach((sp) => {
        const tw = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.8 + sp.phase));
        const rot = (t * 40 + sp.phase * 60) % 360;
        const sc = 0.7 + tw * 0.5;
        sp.el.setAttribute('opacity', tw);
        sp.el.setAttribute('transform', `translate(${sp.x} ${sp.y}) rotate(${rot}) scale(${sc})`);
      });

      // Clouds drift slowly
      const dxA = Math.sin(t * 0.3) * 14;
      const dxB = Math.sin(t * 0.35 + 1.2) * 18;
      cloudA.setAttribute('transform', `translate(${dxA} 0)`);
      cloudB.setAttribute('transform', `translate(${dxB} 0)`);
    }
  };
})());

// ----- Color helpers --------------------------------------------
function mixHex(a, b, t) {
  const pa = hexToRgb(a), pb = hexToRgb(b);
  const r = Math.round(lerp(pa.r, pb.r, t));
  const g = Math.round(lerp(pa.g, pb.g, t));
  const bl = Math.round(lerp(pa.b, pb.b, t));
  return `rgb(${r},${g},${bl})`;
}
function hexToRgb(h) {
  const v = h.replace('#', '');
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16) };
}

// ----- Confetti -------------------------------------------------
const confettiCanvas = $('#confetti-canvas');
const cctx = confettiCanvas.getContext('2d');
const confettiPieces = [];
function resizeCanvas() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function fireConfetti() {
  const w = confettiCanvas.width;
  const colors = ['#ff7a59', '#ffd166', '#4ec196', '#5aa9e6', '#b88aff', '#ff7a9b'];
  for (let i = 0; i < 140; i++) {
    confettiPieces.push({
      x: w / 2 + (Math.random() - 0.5) * 200,
      y: confettiCanvas.height * 0.4,
      vx: (Math.random() - 0.5) * 600,
      vy: -Math.random() * 700 - 200,
      g: 800,
      size: 6 + Math.random() * 8,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 10,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 0,
      maxLife: 3 + Math.random() * 1.5,
    });
  }
}

let lastConfettiT = performance.now();
function confettiLoop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastConfettiT) / 1000);
  lastConfettiT = now;
  cctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  for (let i = confettiPieces.length - 1; i >= 0; i--) {
    const p = confettiPieces[i];
    p.life += dt;
    p.vy += p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vrot * dt;
    const opacity = clamp(1 - (p.life - p.maxLife * 0.7) / (p.maxLife * 0.3), 0, 1);
    if (p.life > p.maxLife || p.y > confettiCanvas.height + 40) {
      confettiPieces.splice(i, 1);
      continue;
    }
    cctx.save();
    cctx.globalAlpha = opacity;
    cctx.translate(p.x, p.y);
    cctx.rotate(p.rot);
    cctx.fillStyle = p.color;
    cctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
    cctx.restore();
  }
  requestAnimationFrame(confettiLoop);
}
confettiLoop();

// ----- Init -----------------------------------------------------
loadPrefs();
setupScreenInit();
requestAnimationFrame(tick);
