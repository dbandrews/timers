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
  vizId: 'pizza',
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

// ----- PIZZA -----------------------------------------------------
registerViz('pizza', (() => {
  const slices = [];
  const cx = 500, cy = 360, R = 270;
  const N = 8;
  let pepperoniData = [];

  let biteLayer = null;
  let biteSliceIdx = -1;
  const biteEls = [];
  const bitePlayed = [false, false, false];
  const BITE_THRESHOLDS = [0.25, 0.5, 0.75];
  const BITE_R = 30;

  function makePepperoni(sliceIdx) {
    const angle = (sliceIdx + 0.5) * (2 * Math.PI / N) - Math.PI / 2;
    const pts = [];
    const count = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const r = 60 + Math.random() * (R - 90);
      const da = (Math.random() - 0.5) * 0.5;
      const a = angle + da;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), r: 12 + Math.random() * 6 });
    }
    return pts;
  }

  function biteCenter(sliceIdx, biteN) {
    const sliceArc = 2 * Math.PI / N;
    const a1 = sliceIdx * sliceArc - Math.PI / 2;
    const frac = (biteN + 1) / (BITE_THRESHOLDS.length + 1);
    const angle = a1 + frac * sliceArc;
    const bx = cx + R * Math.cos(angle);
    const by = cy + R * Math.sin(angle);
    return { bx, by };
  }

  function rebuildBiteLayer(s, sliceIdx) {
    if (biteLayer) biteLayer.remove();
    biteEls.length = 0;
    for (let b = 0; b < bitePlayed.length; b++) bitePlayed[b] = false;
    biteLayer = svg('g', { class: 'pizza-bites' }, s);
    for (let b = 0; b < BITE_THRESHOLDS.length; b++) {
      const { bx, by } = biteCenter(sliceIdx, b);
      const el = svg('circle', {
        cx: bx, cy: by, r: 0,
        fill: '#f5e6d3'
      }, biteLayer);
      biteEls.push(el);
    }
    biteSliceIdx = sliceIdx;
  }

  return {
    background: 'radial-gradient(circle at 50% 40%, #fff5dd 0%, #ffe5b0 100%)',
    init(s) {
      slices.length = 0;
      biteLayer = null;
      biteSliceIdx = -1;
      biteEls.length = 0;
      for (let b = 0; b < bitePlayed.length; b++) bitePlayed[b] = false;
      pepperoniData = Array.from({ length: N }, (_, i) => makePepperoni(i));

      svg('circle', { cx, cy, r: R + 30, fill: '#f5e6d3', stroke: '#d9bf99', 'stroke-width': 4 }, s);
      svg('circle', { cx, cy, r: R + 14, fill: '#fff', opacity: 0.4 }, s);

      const crust = svg('circle', { cx, cy, r: R, fill: '#dba14a', stroke: '#b87b2a', 'stroke-width': 5 }, s);

      const sliceGroup = svg('g', { id: 'pizza-slices' }, s);

      for (let i = 0; i < N; i++) {
        const a1 = i * 2 * Math.PI / N - Math.PI / 2;
        const a2 = (i + 1) * 2 * Math.PI / N - Math.PI / 2;
        const x1 = cx + R * Math.cos(a1);
        const y1 = cy + R * Math.sin(a1);
        const x2 = cx + R * Math.cos(a2);
        const y2 = cy + R * Math.sin(a2);
        const sliceG = svg('g', { class: 'pizza-slice' }, sliceGroup);
        const innerR = R - 24;
        const x1i = cx + innerR * Math.cos(a1);
        const y1i = cy + innerR * Math.sin(a1);
        const x2i = cx + innerR * Math.cos(a2);
        const y2i = cy + innerR * Math.sin(a2);
        svg('path', {
          d: `M ${cx},${cy} L ${x1},${y1} A ${R},${R} 0 0 1 ${x2},${y2} Z`,
          fill: '#ffd56b'
        }, sliceG);
        svg('path', {
          d: `M ${cx},${cy} L ${x1i},${y1i} A ${innerR},${innerR} 0 0 1 ${x2i},${y2i} Z`,
          fill: '#ffe18a'
        }, sliceG);
        pepperoniData[i].forEach((p) => {
          svg('circle', { cx: p.x, cy: p.y, r: p.r, fill: '#c93b1d' }, sliceG);
          svg('circle', { cx: p.x - p.r * 0.25, cy: p.y - p.r * 0.25, r: p.r * 0.3, fill: '#e85a3a', opacity: 0.7 }, sliceG);
        });
        svg('line', { x1: cx, y1: cy, x2: x1, y2: y1, stroke: '#cf8838', 'stroke-width': 2, opacity: 0.5 }, sliceG);
        slices.push(sliceG);
      }

      for (let i = 0; i < 3; i++) {
        svg('path', {
          d: 'M 0 0 q 8 -20 0 -40 q -8 -20 0 -40',
          stroke: 'rgba(255,255,255,0.55)',
          'stroke-width': 6,
          'stroke-linecap': 'round',
          fill: 'none',
          class: 'steam',
          'data-i': i,
          transform: `translate(${cx - 60 + i * 60}, ${cy - R - 30})`
        }, s);
      }
    },
    render(s, progressDone, t) {
      const slicesGone = Math.floor(progressDone * N);
      const sliceProgress = (progressDone * N) - slicesGone;

      if (slicesGone < N && slicesGone !== biteSliceIdx) {
        rebuildBiteLayer(s, slicesGone);
      }
      if (slicesGone >= N && biteLayer) {
        biteLayer.style.display = 'none';
      }

      for (let i = 0; i < N; i++) {
        const el = slices[i];
        if (i < slicesGone) {
          el.style.display = 'none';
        } else if (i === slicesGone && slicesGone < N) {
          const wob = Math.sin(t * 6) * (sliceProgress > 0.85 ? 6 : 1.5);
          const fade = sliceProgress > 0.9 ? 1 - (sliceProgress - 0.9) / 0.1 : 1;
          const scale = sliceProgress > 0.9 ? 1 - (sliceProgress - 0.9) * 1.0 : 1;
          el.style.display = '';
          el.setAttribute('transform', `rotate(${wob} ${cx} ${cy}) translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`);
          el.setAttribute('opacity', fade);
        } else {
          el.style.display = '';
          el.setAttribute('transform', '');
          el.setAttribute('opacity', 1);
        }
      }

      if (biteLayer && slicesGone < N) {
        const wob = Math.sin(t * 6) * (sliceProgress > 0.85 ? 6 : 1.5);
        const fade = sliceProgress > 0.9 ? 1 - (sliceProgress - 0.9) / 0.1 : 1;
        const scale = sliceProgress > 0.9 ? 1 - (sliceProgress - 0.9) * 1.0 : 1;
        biteLayer.setAttribute('transform', `rotate(${wob} ${cx} ${cy}) translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`);
        biteLayer.setAttribute('opacity', fade);

        for (let b = 0; b < BITE_THRESHOLDS.length; b++) {
          const thresh = BITE_THRESHOLDS[b];
          const biteEl = biteEls[b];
          if (sliceProgress >= thresh) {
            const popWindow = 0.08;
            const localT = clamp((sliceProgress - thresh) / popWindow, 0, 1);
            const popScale = easeOutCubic(localT);
            biteEl.setAttribute('r', BITE_R * popScale);
            if (!bitePlayed[b]) {
              bitePlayed[b] = true;
              playTone(600 + b * 120, 0.07, 'sine', 0.07);
            }
          } else {
            biteEl.setAttribute('r', 0);
          }
        }
      }

      s.querySelectorAll('.steam').forEach((el) => {
        const i = parseInt(el.dataset.i, 10);
        const phase = t + i * 1.3;
        const dy = -Math.sin(phase * 1.4) * 4;
        const dx = Math.sin(phase * 0.9 + i) * 8;
        el.setAttribute('transform', `translate(${cx - 60 + i * 60 + dx}, ${cy - R - 30 + dy})`);
        el.setAttribute('opacity', 0.4 + 0.3 * Math.sin(phase * 1.1));
      });
    }
  };
})());

// ----- BALLOON ---------------------------------------------------
registerViz('balloon', (() => {
  let balloonG, stringPath, cloudGroup;
  const cx = 500, cy = 340;

  const DOT_COUNT = 5;
  // Dot positions on balloon body, avoiding the face area (face is ~y -40..+60, x -70..+70)
  const DOT_POSITIONS = [
    { x: -75, y: -70 },
    { x:  75, y: -70 },
    { x: -85, y:  80 },
    { x:  85, y:  80 },
    { x:   0, y: 110 },
  ];
  const DOT_COLORS = ['#ffe066', '#b2f7a0', '#a0d4ff', '#ffb3e6', '#ffd1a0'];

  let dotEls = [];
  let puffEls = [];
  let prevStep = 0;
  let popTimes = {};

  return {
    background: 'linear-gradient(180deg, #b8e0ff 0%, #e0f1ff 60%, #fff7ec 100%)',
    init(s) {
      dotEls = [];
      puffEls = [];
      prevStep = 0;
      popTimes = {};

      // Clouds (drifting)
      cloudGroup = svg('g', {}, s);
      const clouds = [
        { x: 120, y: 100, scale: 1 },
        { x: 800, y: 140, scale: 0.7 },
        { x: 300, y: 220, scale: 0.55 },
        { x: 900, y: 380, scale: 0.9 },
        { x: 90, y: 480, scale: 0.8 },
      ];
      clouds.forEach((c, i) => {
        const g = svg('g', { class: 'cloud', 'data-i': i, 'data-x': c.x, 'data-y': c.y, 'data-scale': c.scale }, cloudGroup);
        const fill = 'rgba(255,255,255,0.85)';
        svg('ellipse', { cx: 0, cy: 0, rx: 60, ry: 28, fill }, g);
        svg('ellipse', { cx: -36, cy: 6, rx: 32, ry: 22, fill }, g);
        svg('ellipse', { cx: 36, cy: 6, rx: 32, ry: 22, fill }, g);
        svg('ellipse', { cx: 0, cy: -16, rx: 30, ry: 22, fill }, g);
      });

      // Balloon group
      balloonG = svg('g', { id: 'balloon-group' }, s);
      // string (path so we can sway it)
      stringPath = svg('path', { d: '', stroke: '#5b576d', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, s);

      // Balloon body
      svg('ellipse', { cx: 0, cy: 0, rx: 130, ry: 165, fill: '#ff7a59', id: 'balloon-body' }, balloonG);
      // gloss highlight
      svg('ellipse', { cx: -40, cy: -55, rx: 30, ry: 50, fill: 'rgba(255,255,255,0.5)' }, balloonG);
      svg('circle', { cx: -55, cy: -80, r: 12, fill: 'rgba(255,255,255,0.6)' }, balloonG);
      // knot
      svg('path', { d: 'M -10 160 L 0 180 L 10 160 Z', fill: '#d65a3a' }, balloonG);

      // Polka dots (added before face so face renders on top)
      for (let i = 0; i < DOT_COUNT; i++) {
        const pos = DOT_POSITIONS[i];
        const el = svg('circle', { cx: pos.x, cy: pos.y, r: 18, fill: DOT_COLORS[i], opacity: 1 }, balloonG);
        dotEls.push(el);
      }

      // Cute face
      svg('circle', { cx: -38, cy: -10, r: 9, fill: '#2d2a3a' }, balloonG);
      svg('circle', { cx: 38, cy: -10, r: 9, fill: '#2d2a3a' }, balloonG);
      svg('circle', { cx: -34, cy: -14, r: 3, fill: 'white' }, balloonG);
      svg('circle', { cx: 42, cy: -14, r: 3, fill: 'white' }, balloonG);
      // cheeks
      svg('circle', { cx: -55, cy: 22, r: 14, fill: '#ffc4b3', opacity: 0.85 }, balloonG);
      svg('circle', { cx: 55, cy: 22, r: 14, fill: '#ffc4b3', opacity: 0.85 }, balloonG);
      // smile
      svg('path', { d: 'M -22 28 Q 0 50 22 28', stroke: '#2d2a3a', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round' }, balloonG);

      // Puff sparkle elements (one per dot, rendered in balloon-group coord space)
      for (let i = 0; i < DOT_COUNT; i++) {
        const g = svg('g', { opacity: 0 }, balloonG);
        const pos = DOT_POSITIONS[i];
        // 6 sparkle rays
        for (let r = 0; r < 6; r++) {
          const angle = (r / 6) * Math.PI * 2;
          const x2 = pos.x + Math.cos(angle) * 32;
          const y2 = pos.y + Math.sin(angle) * 32;
          svg('line', { x1: pos.x, y1: pos.y, x2, y2, stroke: DOT_COLORS[i], 'stroke-width': 4, 'stroke-linecap': 'round' }, g);
        }
        svg('circle', { cx: pos.x, cy: pos.y, r: 22, fill: DOT_COLORS[i], opacity: 0.35 }, g);
        puffEls.push(g);
      }
    },
    render(s, progressDone, t) {
      // How many dots have popped (step boundary: 0.2, 0.4, 0.6, 0.8, 1.0)
      const poppedCount = Math.min(DOT_COUNT, Math.floor(progressDone * DOT_COUNT));
      const dotsRemaining = DOT_COUNT - poppedCount;

      // Detect newly popped dots and fire chirp + record pop time
      if (poppedCount > prevStep) {
        for (let i = prevStep; i < poppedCount; i++) {
          popTimes[i] = t;
          // Dot index maps to popping order: dot (DOT_COUNT-1-i) pops first
          const popIdx = DOT_COUNT - 1 - i;
          const freq = 600 + popIdx * 120;
          playTone(freq, 0.18, 'triangle', 0.1);
        }
        prevStep = poppedCount;
      }

      // Stepped balloon scale: base scale snaps at each boundary, then eases in ~0.4s
      const POP_DURATION = 0.4;
      const stepProgress = (poppedCount / DOT_COUNT);
      const stepFrac = clamp((progressDone - stepProgress) * DOT_COUNT / POP_DURATION, 0, 1);
      const targetScale = lerp(1, 0.3, stepProgress);
      const nextScale = lerp(1, 0.3, Math.min(1, stepProgress + 1 / DOT_COUNT));
      const scale = lerp(targetScale, nextScale, easeOutCubic(stepFrac));

      const bob = Math.sin(t * 1.6) * 8;
      const sway = Math.sin(t * 1.1) * 4;
      const rot = Math.sin(t * 0.9) * 3;
      const x = cx + sway;
      const y = cy + bob;
      balloonG.setAttribute('transform', `translate(${x} ${y}) rotate(${rot}) scale(${scale})`);

      // Color shift coral → muted purple
      const hue = lerp(12, 320, progressDone);
      const sat = lerp(95, 65, progressDone);
      const light = lerp(65, 70, progressDone);
      const body = s.querySelector('#balloon-body');
      if (body) body.setAttribute('fill', `hsl(${hue} ${sat}% ${light}%)`);

      // Animate dots: visible if not yet popped, pop-scale-up then hide when popped
      const POP_ANIM = 0.35;
      for (let i = 0; i < DOT_COUNT; i++) {
        const dotIdx = DOT_COUNT - 1 - i;
        const el = dotEls[dotIdx];
        const puff = puffEls[dotIdx];
        if (i < poppedCount) {
          // This dot has popped
          const elapsed = popTimes[i] !== undefined ? t - popTimes[i] : POP_ANIM + 1;
          if (elapsed < POP_ANIM) {
            const frac = elapsed / POP_ANIM;
            const popScale = lerp(1, 2.2, frac);
            const opacity = lerp(1, 0, frac);
            const pos = DOT_POSITIONS[dotIdx];
            el.setAttribute('transform', `translate(${pos.x} ${pos.y}) scale(${popScale}) translate(${-pos.x} ${-pos.y})`);
            el.setAttribute('opacity', opacity);
            // Puff sparkle grows then fades
            puff.setAttribute('opacity', lerp(0.9, 0, frac));
            puff.setAttribute('transform', `scale(${lerp(0.5, 1.4, frac)})`);
          } else {
            el.setAttribute('opacity', 0);
            puff.setAttribute('opacity', 0);
          }
        } else {
          el.setAttribute('opacity', 1);
          el.setAttribute('transform', '');
          puff.setAttribute('opacity', 0);
        }
      }

      // String path (curvy)
      const sx = x;
      const sy = y + 180 * scale;
      const endX = cx + Math.sin(t * 0.7) * 4;
      const endY = 640;
      const c1x = sx + Math.sin(t * 1.3) * 30;
      const c1y = (sy + endY) / 2;
      stringPath.setAttribute('d', `M ${sx} ${sy} Q ${c1x} ${c1y} ${endX} ${endY}`);

      // Drift clouds slowly
      cloudGroup.querySelectorAll('.cloud').forEach((g) => {
        const i = parseInt(g.dataset.i, 10);
        const baseX = parseFloat(g.dataset.x);
        const baseY = parseFloat(g.dataset.y);
        const sc = parseFloat(g.dataset.scale);
        const dx = ((t * 8 * (0.6 + i * 0.15)) % 1100) - 50;
        const cx2 = ((baseX + dx) % 1100) + 0;
        g.setAttribute('transform', `translate(${cx2 - 50} ${baseY}) scale(${sc})`);
      });
    }
  };
})());

// ----- GARDEN (sun across sky) ----------------------------------
registerViz('garden', (() => {
  let sky, sun, sunGlow, butterfly;
  let flowerGroups = [];
  let flowerPetals = [];
  let flowerDisks = [];

  const FLOWER_DEFS = [
    { x: 120, color: '#ff7a9b' },
    { x: 264, color: '#ffd166' },
    { x: 408, color: '#b88aff' },
    { x: 592, color: '#ff7a9b' },
    { x: 736, color: '#fff' },
    { x: 880, color: '#ffd166' }
  ];

  function buildSunPathD() {
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const at = k / 20;
      const px = lerp(80, 920, at);
      const py = 380 - Math.sin(at * Math.PI) * 280;
      pts.push(`${k === 0 ? 'M' : 'L'} ${px.toFixed(1)} ${py.toFixed(1)}`);
    }
    return pts.join(' ');
  }

  return {
    background: 'linear-gradient(180deg, #b8e0ff 0%, #d8f0e8 60%, #a6d785 100%)',
    init(s) {
      sky = svg('rect', { x: 0, y: 0, width: 1000, height: 480, fill: '#b8e0ff' }, s);

      // Distant hills
      svg('path', { d: 'M 0 420 Q 250 320 500 420 T 1000 420 L 1000 480 L 0 480 Z', fill: '#94c1a3' }, s);
      svg('path', { d: 'M 0 460 Q 200 380 500 460 T 1000 460 L 1000 500 L 0 500 Z', fill: '#7eb389' }, s);

      // Faint dotted sun-path arc
      svg('path', { d: buildSunPathD(), stroke: 'rgba(255,255,255,0.6)', 'stroke-width': 2,
        'stroke-dasharray': '6 10', fill: 'none', 'stroke-linecap': 'round' }, s);

      // Sun
      sunGlow = svg('circle', { cx: 120, cy: 460, r: 90, fill: '#ffe066', opacity: 0.35 }, s);
      sun = svg('g', {}, s);
      svg('circle', { cx: 0, cy: 0, r: 55, fill: '#ffd84a', id: 'sun-body' }, sun);
      svg('circle', { cx: -16, cy: -6, r: 5, fill: '#2d2a3a' }, sun);
      svg('circle', { cx: 16, cy: -6, r: 5, fill: '#2d2a3a' }, sun);
      svg('path', { d: 'M -14 12 Q 0 26 14 12', stroke: '#2d2a3a', 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }, sun);
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        const x1 = 70 * Math.cos(a), y1 = 70 * Math.sin(a);
        const x2 = 90 * Math.cos(a), y2 = 90 * Math.sin(a);
        svg('line', { x1, y1, x2, y2, stroke: '#ffd84a', 'stroke-width': 6, 'stroke-linecap': 'round' }, sun);
      }

      // Ground
      svg('rect', { x: 0, y: 480, width: 1000, height: 220, fill: '#a6d785' }, s);
      svg('rect', { x: 0, y: 480, width: 1000, height: 16, fill: '#8fc06d' }, s);

      // Grass blades
      for (let i = 0; i < 40; i++) {
        const x = 20 + Math.random() * 960;
        const h = 8 + Math.random() * 16;
        svg('path', { d: `M ${x} 500 Q ${x + 2} ${500 - h * 0.6} ${x + 4} ${500 - h}`,
          stroke: '#6ea552', 'stroke-width': 2, fill: 'none' }, s);
      }

      // Flowers — start as closed buds, petals/disk stored for render updates
      flowerGroups = [];
      flowerPetals = [];
      flowerDisks = [];
      FLOWER_DEFS.forEach((f, i) => {
        const g = svg('g', {}, s);
        flowerGroups.push(g);

        // Stem
        svg('path', { d: `M ${f.x} 580 Q ${f.x - 4} 540 ${f.x} 515`, stroke: '#4a8a3a',
          'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }, g);
        // Leaf
        svg('ellipse', { cx: f.x - 8, cy: 555, rx: 8, ry: 4, fill: '#6ea552',
          transform: `rotate(-30 ${f.x - 8} 555)` }, g);
        // Bud tip — small green oval visible when closed
        svg('ellipse', { cx: f.x, cy: 510, rx: 5, ry: 8, fill: '#5aaa40' }, g);

        // Petals — grouped so we can scale from center with transform-origin workaround
        const petalGroup = svg('g', { transform: `translate(${f.x} 510) scale(0)` }, g);
        flowerPetals.push(petalGroup);
        for (let p = 0; p < 6; p++) {
          const a = p * Math.PI / 3;
          svg('ellipse', { cx: Math.cos(a) * 14, cy: Math.sin(a) * 14, rx: 12, ry: 8, fill: f.color,
            transform: `rotate(${p * 60} ${Math.cos(a) * 14} ${Math.sin(a) * 14})` }, petalGroup);
        }

        // Center disk — same scale trick
        const disk = svg('circle', { cx: f.x, cy: 510, r: 7, fill: '#ffd84a',
          transform: `translate(0 0) scale(0)`, 'transform-origin': `${f.x} 510` }, g);
        flowerDisks.push(disk);
      });

      // Butterfly
      butterfly = svg('g', { id: 'butterfly' }, s);
      svg('ellipse', { cx: -12, cy: 0, rx: 12, ry: 16, fill: '#ff7a59' }, butterfly);
      svg('ellipse', { cx: 12, cy: 0, rx: 12, ry: 16, fill: '#ff7a59' }, butterfly);
      svg('ellipse', { cx: -10, cy: 8, rx: 8, ry: 10, fill: '#ffd166' }, butterfly);
      svg('ellipse', { cx: 10, cy: 8, rx: 8, ry: 10, fill: '#ffd166' }, butterfly);
      svg('rect', { x: -1.5, y: -8, width: 3, height: 18, fill: '#2d2a3a' }, butterfly);

      // Birds (distant Vs)
      const birds = svg('g', { id: 'birds' }, s);
      for (let i = 0; i < 4; i++) {
        svg('path', { d: 'M 0 0 q 6 -6 12 0 m 0 0 q 6 -6 12 0',
          stroke: '#3a3a4f', 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round',
          class: 'bird', 'data-i': i }, birds);
      }
    },
    render(s, progressDone, t) {
      const arcT = progressDone;
      const sx = lerp(80, 920, arcT);
      const arcY = 380 - Math.sin(arcT * Math.PI) * 280;
      sun.setAttribute('transform', `translate(${sx} ${arcY}) rotate(${t * 12})`);
      sunGlow.setAttribute('cx', sx);
      sunGlow.setAttribute('cy', arcY);
      sunGlow.setAttribute('opacity', 0.3 + 0.1 * Math.sin(t * 2));

      // Sky color shift: morning blue → midday → sunset
      let skyColor;
      if (arcT < 0.5) {
        skyColor = mixHex('#b8e0ff', '#f6e2b4', arcT * 2);
      } else {
        skyColor = mixHex('#f6e2b4', '#ffb38a', (arcT - 0.5) * 2);
      }
      sky.setAttribute('fill', skyColor);

      // Bloom each flower as the sun passes overhead
      FLOWER_DEFS.forEach((f, i) => {
        const bloomT = easeOutCubic(clamp((progressDone - i / 6) / (1 / 6), 0, 1));
        flowerPetals[i].setAttribute('transform', `translate(${f.x} 510) scale(${bloomT})`);
        flowerDisks[i].setAttribute('transform', `translate(${f.x} 510) scale(${bloomT}) translate(${-f.x} -510)`);
      });

      // Butterfly figure-8
      const bx = 500 + Math.sin(t * 0.8) * 280;
      const by = 380 + Math.sin(t * 1.6) * 50;
      const flap = 1 + Math.sin(t * 14) * 0.15;
      butterfly.setAttribute('transform', `translate(${bx} ${by}) scale(${flap} 1)`);

      // Birds
      s.querySelectorAll('.bird').forEach((b) => {
        const i = parseInt(b.dataset.i, 10);
        const bx = ((t * 30 + i * 280) % 1100) - 50;
        const by = 110 + i * 18 + Math.sin(t * 0.6 + i) * 6;
        b.setAttribute('transform', `translate(${bx} ${by})`);
      });
    }
  };
})());

// ----- ROCKET ----------------------------------------------------
registerViz('rocket', (() => {
  let rocket, trail, stars, moon, earth;
  const trailPts = [];

  const CHECKPOINT_COLORS = ['#ffd166', '#4ec196', '#5aa9e6', '#b88aff', '#ff7a9b', '#ff7a59'];
  const checkpoints = [];

  function pathPos(frac) {
    const p = easeOutCubic(frac);
    return {
      x: lerp(100, 850, p),
      y: lerp(580, 130, p) - Math.sin(frac * Math.PI) * 80
    };
  }

  return {
    background: 'linear-gradient(180deg, #0a0e2a 0%, #2a1b5a 60%, #5a3a8a 100%)',
    init(s) {
      trailPts.length = 0;
      checkpoints.length = 0;

      stars = [];
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * 1000;
        const y = Math.random() * 700;
        const r = 1 + Math.random() * 2.5;
        const c = svg('circle', { cx: x, cy: y, r, fill: 'white', opacity: 0.7, 'data-phase': Math.random() * 6.28 }, s);
        stars.push(c);
      }

      // Earth (bottom-left)
      earth = svg('g', {}, s);
      svg('circle', { cx: 100, cy: 660, r: 140, fill: '#3a6fb0' }, earth);
      svg('path', { d: 'M 30 620 Q 60 580 100 600 Q 140 590 180 620 Q 160 660 100 650 Q 50 660 30 620', fill: '#5fa75a' }, earth);
      svg('path', { d: 'M 60 700 Q 100 680 180 700 Q 220 720 100 730 Q 60 720 60 700', fill: '#5fa75a' }, earth);

      // Moon (top-right)
      moon = svg('g', {}, s);
      svg('circle', { cx: 880, cy: 110, r: 80, fill: '#f5ebd6' }, moon);
      svg('circle', { cx: 855, cy: 90, r: 12, fill: '#dcd0b5', opacity: 0.7 }, moon);
      svg('circle', { cx: 905, cy: 130, r: 8, fill: '#dcd0b5', opacity: 0.7 }, moon);
      svg('circle', { cx: 870, cy: 145, r: 14, fill: '#dcd0b5', opacity: 0.7 }, moon);
      svg('circle', { cx: 920, cy: 95, r: 5, fill: '#dcd0b5', opacity: 0.7 }, moon);

      // Flag waving on moon for the end celebration
      const flagG = svg('g', { id: 'moon-flag', opacity: 0 }, s);
      svg('line', { x1: 850, y1: 30, x2: 850, y2: 90, stroke: '#888', 'stroke-width': 3 }, flagG);
      svg('path', { d: 'M 850 30 L 890 38 L 850 50 Z', fill: '#ff7a59' }, flagG);

      for (let i = 0; i < 6; i++) {
        const frac = (i + 1) / 7;
        const pos = pathPos(frac);
        const color = CHECKPOINT_COLORS[i];
        const g = svg('g', { transform: `translate(${pos.x} ${pos.y})` }, s);
        const glow = svg('circle', { cx: 0, cy: 0, r: 26, fill: color, opacity: 0 }, g);
        const orb = svg('circle', { cx: 0, cy: 0, r: 15, fill: '#3a4a7a', opacity: 0.4, stroke: '#5a6a9a', 'stroke-width': 2 }, g);
        const highlight = svg('circle', { cx: -4, cy: -4, r: 5, fill: 'white', opacity: 0 }, g);
        checkpoints.push({ g, glow, orb, highlight, color, lit: false, litAt: -1 });
      }

      // Trail container drawn above checkpoints so it layers correctly
      trail = svg('g', { id: 'rocket-trail' }, s);

      // Rocket
      rocket = svg('g', {}, s);
      svg('path', { d: 'M -8 28 Q 0 80 8 28 Q 0 40 -8 28', fill: '#ffd166', id: 'flame-outer' }, rocket);
      svg('path', { d: 'M -5 28 Q 0 56 5 28 Q 0 36 -5 28', fill: '#ff7a59', id: 'flame-inner' }, rocket);
      svg('path', { d: 'M -16 -50 Q 0 -70 16 -50 L 16 28 L -16 28 Z', fill: '#f5f5f5' }, rocket);
      svg('rect', { x: -16, y: -10, width: 32, height: 8, fill: '#ff7a59' }, rocket);
      svg('circle', { cx: 0, cy: -25, r: 8, fill: '#5aa9e6', stroke: '#2d2a3a', 'stroke-width': 2 }, rocket);
      svg('path', { d: 'M -16 10 L -28 28 L -16 28 Z', fill: '#ff7a59' }, rocket);
      svg('path', { d: 'M 16 10 L 28 28 L 16 28 Z', fill: '#ff7a59' }, rocket);
    },
    render(s, progressDone, t) {
      const p = easeOutCubic(progressDone);
      const x = lerp(100, 850, p);
      const y = lerp(580, 130, p) - Math.sin(progressDone * Math.PI) * 80;
      const nextX = lerp(100, 850, Math.min(1, p + 0.01));
      const nextY = lerp(580, 130, Math.min(1, p + 0.01)) - Math.sin(Math.min(1, progressDone + 0.01) * Math.PI) * 80;
      const angle = Math.atan2(nextY - y, nextX - x) * 180 / Math.PI + 90;

      const flicker = 1 + Math.sin(t * 30) * 0.15;
      rocket.setAttribute('transform', `translate(${x} ${y}) rotate(${angle})`);
      const flameOuter = s.querySelector('#flame-outer');
      const flameInner = s.querySelector('#flame-inner');
      if (flameOuter) flameOuter.setAttribute('transform', `scale(1 ${flicker})`);
      if (flameInner) flameInner.setAttribute('transform', `scale(1 ${flicker * 1.1})`);

      // Trail particles
      if (Math.random() < 0.7 && progressDone < 1) {
        const px = x + (Math.random() - 0.5) * 8;
        const py = y + 30;
        const c = svg('circle', { cx: px, cy: py, r: 4 + Math.random() * 3, fill: '#ffd166', opacity: 0.9 }, trail);
        trailPts.push({ el: c, life: 0, maxLife: 1.2 + Math.random() * 0.6, vx: (Math.random() - 0.5) * 20, vy: 30 + Math.random() * 20 });
      }
      const dt = 1 / 60;
      for (let i = trailPts.length - 1; i >= 0; i--) {
        const p2 = trailPts[i];
        p2.life += dt;
        if (p2.life >= p2.maxLife) {
          p2.el.remove(); trailPts.splice(i, 1); continue;
        }
        const cx = parseFloat(p2.el.getAttribute('cx')) + p2.vx * dt;
        const cy = parseFloat(p2.el.getAttribute('cy')) + p2.vy * dt;
        p2.el.setAttribute('cx', cx);
        p2.el.setAttribute('cy', cy);
        p2.el.setAttribute('opacity', 1 - p2.life / p2.maxLife);
      }

      // Twinkle stars
      stars.forEach((c) => {
        const phase = parseFloat(c.dataset.phase);
        c.setAttribute('opacity', 0.5 + 0.4 * Math.sin(t * 2 + phase));
      });

      // Checkpoint orbs
      checkpoints.forEach((cp, i) => {
        const thresh = (i + 1) / 7;
        const shouldBeLit = progressDone >= thresh;
        if (shouldBeLit && !cp.lit) {
          cp.lit = true;
          cp.litAt = t;
          playTone(440 + i * 80, 0.18, 'sine', 0.25);
        }
        if (cp.lit) {
          const age = t - cp.litAt;
          const popDur = 0.35;
          let scale;
          if (age < popDur) {
            const pop = Math.sin((age / popDur) * Math.PI);
            scale = 1 + pop * 0.55;
          } else {
            scale = 1 + Math.sin(t * 2.5 + i) * 0.08;
          }
          const pos = pathPos((i + 1) / 7);
          cp.g.setAttribute('transform', `translate(${pos.x} ${pos.y}) scale(${scale})`);
          cp.orb.setAttribute('fill', cp.color);
          cp.orb.setAttribute('opacity', '1');
          cp.orb.setAttribute('stroke', 'white');
          cp.orb.setAttribute('stroke-width', '2.5');
          const glowPulse = 0.18 + Math.sin(t * 2.5 + i) * 0.07;
          cp.glow.setAttribute('opacity', glowPulse);
          cp.highlight.setAttribute('opacity', '0.7');
        } else {
          const pos = pathPos((i + 1) / 7);
          cp.g.setAttribute('transform', `translate(${pos.x} ${pos.y})`);
          cp.orb.setAttribute('fill', '#3a4a7a');
          cp.orb.setAttribute('opacity', '0.4');
          cp.orb.setAttribute('stroke', '#5a6a9a');
          cp.orb.setAttribute('stroke-width', '2');
          cp.glow.setAttribute('opacity', '0');
          cp.highlight.setAttribute('opacity', '0');
        }
      });

      // Show flag near the end
      const flag = s.querySelector('#moon-flag');
      if (flag) flag.setAttribute('opacity', clamp((progressDone - 0.95) * 20, 0, 1));
    }
  };
})());

// ----- MARBLE JAR -----------------------------------------------
registerViz('jar', (() => {
  const N = 12;
  const marbles = [];
  const colors = ['#ff7a59', '#5aa9e6', '#4ec196', '#ffd166', '#b88aff', '#ff7a9b', '#5acdb3', '#f78da7', '#7ec8e3'];
  let jarG, popG;

  return {
    background: 'linear-gradient(180deg, #fff7ec 0%, #ffe5b0 100%)',
    init(s) {
      marbles.length = 0;
      // Jar
      jarG = svg('g', {}, s);
      // Shadow
      svg('ellipse', { cx: 500, cy: 600, rx: 210, ry: 18, fill: 'rgba(0,0,0,0.15)' }, jarG);
      // Glass body
      svg('rect', { x: 320, y: 200, width: 360, height: 400, rx: 30, ry: 30, fill: 'rgba(184,224,255,0.35)', stroke: '#7a8fa3', 'stroke-width': 6 }, jarG);
      // Neck
      svg('rect', { x: 360, y: 130, width: 280, height: 70, rx: 14, ry: 14, fill: 'rgba(184,224,255,0.45)', stroke: '#7a8fa3', 'stroke-width': 6 }, jarG);
      // Lid
      svg('rect', { x: 340, y: 100, width: 320, height: 40, rx: 10, ry: 10, fill: '#c98643', stroke: '#8b5a26', 'stroke-width': 4 }, jarG);
      // Highlight
      svg('rect', { x: 340, y: 210, width: 22, height: 380, rx: 11, fill: 'rgba(255,255,255,0.6)' }, jarG);

      // Marbles arranged in grid bottom-up
      const cols = 4;
      const rows = Math.ceil(N / cols);
      const startX = 380;
      const startY = 540;
      const dx = 60, dy = -60;
      for (let i = 0; i < N; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const x = startX + col * dx + (row % 2 ? 30 : 0);
        const y = startY + row * dy;
        const color = colors[i % colors.length];
        const g = svg('g', { class: 'marble' }, jarG);
        svg('circle', { cx: x, cy: y, r: 22, fill: color }, g);
        svg('circle', { cx: x - 7, cy: y - 7, r: 7, fill: 'white', opacity: 0.7 }, g);
        marbles.push({ el: g, x, y, removed: false });
      }

      // Pop layer (on top of jar) for floating marbles
      popG = svg('g', {}, s);

      // Cute face on jar
      const face = svg('g', {}, s);
      svg('circle', { cx: 440, cy: 380, r: 10, fill: '#2d2a3a' }, face);
      svg('circle', { cx: 560, cy: 380, r: 10, fill: '#2d2a3a' }, face);
      svg('path', { d: 'M 460 420 Q 500 450 540 420', stroke: '#2d2a3a', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round' }, face);
    },
    render(s, progressDone, t) {
      const gone = Math.floor(progressDone * N);
      // Remove from top of pile first (highest index)
      for (let i = 0; i < N; i++) {
        const m = marbles[N - 1 - i];
        if (!m) continue;
        if (i < gone) {
          if (!m.removed) {
            m.removed = true;
            // Animate up + fade
            animateMarbleOut(m, t);
          }
        }
      }
      // Subtle bob on remaining marbles (settling effect)
      marbles.forEach((m, i) => {
        if (m.removed) return;
        const off = Math.sin(t * 2 + i) * 1.5;
        m.el.setAttribute('transform', `translate(0 ${off})`);
      });
    }
  };

  function animateMarbleOut(m, t0) {
    const c = m.el.querySelector('circle');
    const color = c.getAttribute('fill');
    const float = svg('g', {}, popG);
    const circ = svg('circle', { cx: m.x, cy: m.y, r: 22, fill: color }, float);
    svg('circle', { cx: m.x - 7, cy: m.y - 7, r: 7, fill: 'white', opacity: 0.7 }, float);
    m.el.style.display = 'none';

    let start = null;
    const duration = 1100;
    function step(t) {
      if (start === null) start = t;
      const elapsed = t - start;
      const p = Math.min(1, elapsed / duration);
      const dy = -160 * easeOutCubic(p);
      const opacity = 1 - p;
      const scale = 1 + p * 0.4;
      float.setAttribute('transform', `translate(0 ${dy}) scale(${scale}) translate(0 ${-dy * (1 - 1 / scale) / scale})`);
      float.setAttribute('opacity', opacity);
      if (p < 1) requestAnimationFrame(step);
      else float.remove();
    }
    requestAnimationFrame(step);
    playTone(440 + Math.random() * 220, 0.18, 'sine', 0.12);
  }
})());

// ----- SUNSET ----------------------------------------------------
registerViz('sunset', (() => {
  let skyG, sun, moon, starsG, hills1, hills2, sea;
  return {
    background: '#0a0e2a',
    init(s) {
      // Sky gradient defined via defs
      const defs = svg('defs', {}, s);
      const grad = svg('linearGradient', { id: 'sky-grad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      svg('stop', { offset: '0%', 'stop-color': '#5aa9e6', id: 'sky-stop-1' }, grad);
      svg('stop', { offset: '50%', 'stop-color': '#a7c9e8', id: 'sky-stop-2' }, grad);
      svg('stop', { offset: '100%', 'stop-color': '#ffd6a5', id: 'sky-stop-3' }, grad);
      skyG = svg('rect', { x: 0, y: 0, width: 1000, height: 700, fill: 'url(#sky-grad)' }, s);

      // Stars (initially hidden)
      starsG = svg('g', { opacity: 0 }, s);
      for (let i = 0; i < 60; i++) {
        svg('circle', { cx: Math.random() * 1000, cy: Math.random() * 380, r: 1 + Math.random() * 2,
          fill: 'white', opacity: 0.6 + Math.random() * 0.4, 'data-phase': Math.random() * 6.28, class: 'sunset-star' }, starsG);
      }

      // Moon (initially below horizon)
      moon = svg('circle', { cx: 720, cy: 800, r: 60, fill: '#f5ebd6' }, s);

      // Sun
      sun = svg('circle', { cx: 280, cy: 200, r: 80, fill: '#ffd84a' }, s);
      // Reflection on water
      svg('ellipse', { cx: 280, cy: 580, rx: 60, ry: 8, fill: 'rgba(255,224,102,0.5)', id: 'sun-reflection' }, s);

      // Sea (gradient)
      const grad2 = svg('linearGradient', { id: 'sea-grad', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      svg('stop', { offset: '0%', 'stop-color': '#5aa9e6', id: 'sea-stop-1' }, grad2);
      svg('stop', { offset: '100%', 'stop-color': '#1c4778', id: 'sea-stop-2' }, grad2);
      sea = svg('rect', { x: 0, y: 540, width: 1000, height: 160, fill: 'url(#sea-grad)' }, s);

      // Hills
      hills1 = svg('path', { d: 'M 0 540 Q 200 470 400 530 T 800 510 T 1000 530 L 1000 580 L 0 580 Z',
        fill: '#3a4f7a' }, s);
      hills2 = svg('path', { d: 'M 0 560 Q 250 500 500 555 T 1000 555 L 1000 600 L 0 600 Z',
        fill: '#283a5a' }, s);

      // Birds
      for (let i = 0; i < 3; i++) {
        svg('path', { d: 'M 0 0 q 6 -6 12 0 m 0 0 q 6 -6 12 0',
          stroke: '#2a2a3a', 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round',
          class: 'sunset-bird', 'data-i': i }, s);
      }
    },
    render(s, progressDone, t) {
      // Sun sets from y=120 to y=580 (below horizon at end)
      const sy = lerp(140, 620, easeOutCubic(progressDone));
      sun.setAttribute('cy', sy);
      // Sun color shifts yellow → orange → red
      const sunColor = mixHex('#ffd84a', '#ff5a3a', clamp(progressDone * 1.5, 0, 1));
      sun.setAttribute('fill', sunColor);
      sun.setAttribute('opacity', clamp(1.5 - progressDone, 0, 1));

      // Reflection mirror
      const refl = s.querySelector('#sun-reflection');
      if (refl) {
        refl.setAttribute('opacity', clamp(0.3 + progressDone * 0.5, 0, 0.7));
        refl.setAttribute('fill', sunColor);
        refl.setAttribute('rx', 40 + Math.sin(t * 2) * 6);
      }

      // Sky stops shift
      const s1 = s.querySelector('#sky-stop-1');
      const s2 = s.querySelector('#sky-stop-2');
      const s3 = s.querySelector('#sky-stop-3');
      const e = easeOutCubic(progressDone);
      s1.setAttribute('stop-color', mixHex('#5aa9e6', '#1c2a5a', e));
      s2.setAttribute('stop-color', mixHex('#a7c9e8', '#a04060', e));
      s3.setAttribute('stop-color', mixHex('#ffd6a5', '#5a2e6e', e));

      // Sea darkens
      const se1 = s.querySelector('#sea-stop-1');
      const se2 = s.querySelector('#sea-stop-2');
      se1.setAttribute('stop-color', mixHex('#5aa9e6', '#2a1f4a', e));
      se2.setAttribute('stop-color', mixHex('#1c4778', '#0a0e2a', e));

      // Stars fade in after halfway
      starsG.setAttribute('opacity', clamp((progressDone - 0.4) * 2, 0, 1));
      s.querySelectorAll('.sunset-star').forEach((c) => {
        const phase = parseFloat(c.dataset.phase);
        c.setAttribute('opacity', 0.4 + 0.5 * Math.sin(t * 2 + phase));
      });

      // Moon rises near the end
      const my = lerp(800, 130, clamp((progressDone - 0.5) * 2, 0, 1));
      moon.setAttribute('cy', my);

      // Birds drift
      s.querySelectorAll('.sunset-bird').forEach((b) => {
        const i = parseInt(b.dataset.i, 10);
        const bx = ((t * 18 + i * 260) % 1100) - 50;
        const by = 160 + i * 22;
        b.setAttribute('transform', `translate(${bx} ${by})`);
        b.setAttribute('opacity', clamp(1 - progressDone, 0, 1));
      });
    }
  };
})());

// ----- TRAIN -----------------------------------------------------
registerViz('train', (() => {
  let trainG, smokeG, treesG, sunG;
  const smokePuffs = [];
  return {
    background: 'linear-gradient(180deg, #b8e0ff 0%, #e6f6da 70%, #a6d785 100%)',
    init(s) {
      smokePuffs.length = 0;
      // Sun
      sunG = svg('circle', { cx: 820, cy: 150, r: 50, fill: '#ffd84a' }, s);
      svg('circle', { cx: 820, cy: 150, r: 80, fill: '#ffe066', opacity: 0.3 }, s);

      // Mountains
      svg('path', { d: 'M 0 360 L 200 180 L 400 360 Z', fill: '#7aa68b' }, s);
      svg('path', { d: 'M 280 360 L 480 220 L 680 360 Z', fill: '#6a9579' }, s);
      svg('path', { d: 'M 560 360 L 800 200 L 1000 360 Z', fill: '#7aa68b' }, s);
      // Snow caps
      svg('path', { d: 'M 180 200 L 200 180 L 220 200 L 210 215 L 200 205 L 190 215 Z', fill: 'white' }, s);
      svg('path', { d: 'M 460 240 L 480 220 L 500 240 L 490 250 L 480 240 L 470 250 Z', fill: 'white' }, s);

      // Clouds
      for (let i = 0; i < 4; i++) {
        const cx = 80 + i * 250 + Math.random() * 40;
        const cy = 80 + Math.random() * 60;
        const g = svg('g', { class: 'train-cloud', 'data-base-x': cx, 'data-y': cy, 'data-speed': 0.3 + Math.random() * 0.5 }, s);
        svg('ellipse', { cx: 0, cy: 0, rx: 40, ry: 18, fill: 'white', opacity: 0.9 }, g);
        svg('ellipse', { cx: -22, cy: 4, rx: 22, ry: 14, fill: 'white', opacity: 0.9 }, g);
        svg('ellipse', { cx: 22, cy: 4, rx: 22, ry: 14, fill: 'white', opacity: 0.9 }, g);
      }

      // Ground
      svg('rect', { x: 0, y: 360, width: 1000, height: 340, fill: '#a6d785' }, s);

      // Tracks
      svg('rect', { x: 0, y: 540, width: 1000, height: 8, fill: '#7a5e3a' }, s);
      svg('rect', { x: 0, y: 560, width: 1000, height: 8, fill: '#7a5e3a' }, s);
      for (let x = 0; x < 1000; x += 40) {
        svg('rect', { x, y: 548, width: 24, height: 14, fill: '#5e4628' }, s);
      }

      // Trees (foreground, scrolling)
      treesG = svg('g', {}, s);
      for (let i = 0; i < 8; i++) {
        const tx = i * 140;
        const g = svg('g', { class: 'train-tree', 'data-base-x': tx }, treesG);
        // shadow
        svg('ellipse', { cx: tx, cy: 660, rx: 30, ry: 6, fill: 'rgba(0,0,0,0.15)' }, g);
        // trunk
        svg('rect', { x: tx - 6, y: 580, width: 12, height: 80, fill: '#6b4426' }, g);
        // leaves
        svg('circle', { cx: tx, cy: 580, r: 36, fill: '#4a8a3a' }, g);
        svg('circle', { cx: tx - 18, cy: 590, r: 28, fill: '#5fa75a' }, g);
        svg('circle', { cx: tx + 18, cy: 590, r: 28, fill: '#5fa75a' }, g);
      }

      // Smoke
      smokeG = svg('g', {}, s);

      // Train
      trainG = svg('g', {}, s);
      // Engine
      const engineG = svg('g', {}, trainG);
      // body
      svg('rect', { x: -60, y: -50, width: 100, height: 50, rx: 8, fill: '#e74c3c' }, engineG);
      // cabin
      svg('rect', { x: -90, y: -80, width: 50, height: 50, rx: 6, fill: '#c0392b' }, engineG);
      // roof
      svg('rect', { x: -95, y: -85, width: 60, height: 10, rx: 4, fill: '#7d2418' }, engineG);
      // stack
      svg('rect', { x: 14, y: -75, width: 18, height: 28, fill: '#34495e' }, engineG);
      svg('ellipse', { cx: 23, cy: -75, rx: 12, ry: 5, fill: '#34495e' }, engineG);
      // window
      svg('rect', { x: -82, y: -70, width: 32, height: 24, rx: 3, fill: '#a7c9e8' }, engineG);
      // wheels
      svg('circle', { cx: -50, cy: 8, r: 14, fill: '#2d2a3a' }, engineG);
      svg('circle', { cx: 20, cy: 8, r: 14, fill: '#2d2a3a' }, engineG);
      svg('circle', { cx: -50, cy: 8, r: 6, fill: '#f5f5f5' }, engineG);
      svg('circle', { cx: 20, cy: 8, r: 6, fill: '#f5f5f5' }, engineG);
      // cowcatcher
      svg('path', { d: 'M 40 -10 L 60 -10 L 50 18 L 30 18 Z', fill: '#7d2418' }, engineG);
      // lamp
      svg('circle', { cx: 36, cy: -38, r: 8, fill: '#ffe066' }, engineG);

      // Car 1
      const car1 = svg('g', { transform: 'translate(-150 0)' }, trainG);
      svg('rect', { x: -50, y: -55, width: 100, height: 55, rx: 6, fill: '#4ec196' }, car1);
      svg('rect', { x: -42, y: -48, width: 18, height: 18, rx: 2, fill: '#a7c9e8' }, car1);
      svg('rect', { x: -18, y: -48, width: 18, height: 18, rx: 2, fill: '#a7c9e8' }, car1);
      svg('rect', { x: 6, y: -48, width: 18, height: 18, rx: 2, fill: '#a7c9e8' }, car1);
      svg('rect', { x: 30, y: -48, width: 18, height: 18, rx: 2, fill: '#a7c9e8' }, car1);
      svg('circle', { cx: -30, cy: 8, r: 12, fill: '#2d2a3a' }, car1);
      svg('circle', { cx: 30, cy: 8, r: 12, fill: '#2d2a3a' }, car1);
      svg('circle', { cx: -30, cy: 8, r: 5, fill: '#f5f5f5' }, car1);
      svg('circle', { cx: 30, cy: 8, r: 5, fill: '#f5f5f5' }, car1);

      // Car 2
      const car2 = svg('g', { transform: 'translate(-265 0)' }, trainG);
      svg('rect', { x: -50, y: -50, width: 100, height: 50, rx: 6, fill: '#f1c40f' }, car2);
      svg('rect', { x: -40, y: -42, width: 80, height: 30, fill: '#b58c08', opacity: 0.5 }, car2);
      svg('circle', { cx: -30, cy: 8, r: 12, fill: '#2d2a3a' }, car2);
      svg('circle', { cx: 30, cy: 8, r: 12, fill: '#2d2a3a' }, car2);
      svg('circle', { cx: -30, cy: 8, r: 5, fill: '#f5f5f5' }, car2);
      svg('circle', { cx: 30, cy: 8, r: 5, fill: '#f5f5f5' }, car2);
    },
    render(s, progressDone, t) {
      // Train moves left to right
      const tx = lerp(-200, 1100, progressDone);
      const ty = 540;
      // Tiny bob
      const bob = Math.sin(t * 6) * 1.5;
      trainG.setAttribute('transform', `translate(${tx} ${ty + bob})`);

      // Emit smoke puffs
      if (Math.random() < 0.5 && progressDone < 1) {
        const px = tx + 23;
        const py = ty - 90;
        const c = svg('circle', { cx: px, cy: py, r: 10, fill: 'white', opacity: 0.85 }, smokeG);
        smokePuffs.push({ el: c, life: 0, maxLife: 2.5, vx: 10 + Math.random() * 10, vy: -15 - Math.random() * 10 });
      }
      const dt = 1 / 60;
      for (let i = smokePuffs.length - 1; i >= 0; i--) {
        const p = smokePuffs[i];
        p.life += dt;
        if (p.life > p.maxLife) { p.el.remove(); smokePuffs.splice(i, 1); continue; }
        const cx = parseFloat(p.el.getAttribute('cx')) + p.vx * dt;
        const cy = parseFloat(p.el.getAttribute('cy')) + p.vy * dt;
        const r = parseFloat(p.el.getAttribute('r')) + 8 * dt;
        p.el.setAttribute('cx', cx);
        p.el.setAttribute('cy', cy);
        p.el.setAttribute('r', r);
        p.el.setAttribute('opacity', 0.85 * (1 - p.life / p.maxLife));
      }

      // Scroll trees (parallax — faster as train moves, but they're foreground)
      const treeOffset = progressDone * 1400;
      treesG.querySelectorAll('.train-tree').forEach((tree) => {
        const baseX = parseFloat(tree.dataset.baseX);
        const x = ((baseX - treeOffset) % 1280 + 1280) % 1280 - 140;
        tree.setAttribute('transform', `translate(${x - baseX} 0)`);
      });

      // Clouds drift
      s.querySelectorAll('.train-cloud').forEach((cl) => {
        const baseX = parseFloat(cl.dataset.baseX);
        const baseY = parseFloat(cl.dataset.y);
        const speed = parseFloat(cl.dataset.speed);
        const x = (baseX + t * 8 * speed) % 1100;
        cl.setAttribute('transform', `translate(${x} ${baseY})`);
      });
    }
  };
})());

// ----- BUBBLES (BATH) -------------------------------------------
registerViz('bath', (() => {
  let waterG, bubblesG, duckG;
  const bubbles = [];
  return {
    background: 'linear-gradient(180deg, #d6efff 0%, #b8e0ff 100%)',
    init(s) {
      bubbles.length = 0;
      // Tile pattern (subtle)
      for (let y = 50; y < 700; y += 80) {
        for (let x = 0; x < 1000; x += 80) {
          svg('rect', { x, y, width: 78, height: 78, fill: 'none', stroke: 'rgba(255,255,255,0.5)', 'stroke-width': 1 }, s);
        }
      }

      // Tub
      const tub = svg('g', {}, s);
      svg('rect', { x: 100, y: 380, width: 800, height: 280, rx: 60, fill: '#fff5ec', stroke: '#dba88a', 'stroke-width': 6 }, tub);
      // Tub feet
      svg('ellipse', { cx: 180, cy: 670, rx: 40, ry: 18, fill: '#dba88a' }, tub);
      svg('ellipse', { cx: 820, cy: 670, rx: 40, ry: 18, fill: '#dba88a' }, tub);

      // Water surface
      waterG = svg('g', {}, s);
      svg('rect', { x: 110, y: 450, width: 780, height: 200, rx: 50, fill: '#a7d8ff' }, waterG);
      // Water surface ripple
      svg('path', { d: 'M 110 450 Q 200 440 300 450 T 500 450 T 700 450 T 900 450',
        stroke: 'rgba(255,255,255,0.7)', 'stroke-width': 3, fill: 'none', id: 'ripple-1' }, waterG);
      svg('path', { d: 'M 110 470 Q 220 460 350 470 T 600 470 T 900 470',
        stroke: 'rgba(255,255,255,0.5)', 'stroke-width': 2, fill: 'none', id: 'ripple-2' }, waterG);

      // Bubbles container
      bubblesG = svg('g', {}, s);

      // Duck
      duckG = svg('g', {}, s);
      svg('ellipse', { cx: 0, cy: 0, rx: 60, ry: 40, fill: '#ffe066' }, duckG);
      svg('circle', { cx: 30, cy: -30, r: 30, fill: '#ffe066' }, duckG);
      svg('path', { d: 'M 55 -28 L 75 -22 L 55 -16 Z', fill: '#ff8c42' }, duckG);
      svg('circle', { cx: 38, cy: -35, r: 4, fill: '#2d2a3a' }, duckG);
      svg('circle', { cx: 39, cy: -36, r: 1.5, fill: 'white' }, duckG);
      // tail
      svg('path', { d: 'M -50 -10 L -70 -20 L -55 0 Z', fill: '#ffe066' }, duckG);
      // wing
      svg('ellipse', { cx: -10, cy: 0, rx: 26, ry: 16, fill: '#ffd84a' }, duckG);

      // Seed initial bubbles
      for (let i = 0; i < 30; i++) {
        spawnBubble(true);
      }
    },
    render(s, progressDone, t) {
      // Target bubble count goes from 40 (start) to 5 (end)
      const target = Math.round(lerp(40, 5, progressDone));
      // Add or remove gently
      while (bubbles.length < target && Math.random() < 0.5) spawnBubble(false);
      // Update bubbles
      const dt = 1 / 60;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.y -= b.vy * dt;
        b.x += Math.sin(t * b.wob + b.phase) * 0.4;
        const popY = 120 + Math.random() * 40;
        if (b.y < 200) {
          // Pop
          b.el.remove();
          bubbles.splice(i, 1);
          // Spawn replacement if still need bubbles
          if (bubbles.length < target) spawnBubble(false);
        } else {
          b.el.setAttribute('cx', b.x);
          b.el.setAttribute('cy', b.y);
        }
      }
      // If over target, pop one occasionally
      if (bubbles.length > target && Math.random() < 0.05) {
        const b = bubbles.shift();
        if (b) b.el.remove();
      }

      // Duck bobbing
      const dx = 500 + Math.sin(t * 0.5) * 80;
      const dy = 430 + Math.sin(t * 1.6) * 6;
      const dr = Math.sin(t * 0.8) * 4;
      duckG.setAttribute('transform', `translate(${dx} ${dy}) rotate(${dr})`);

      // Water ripples
      const r1 = s.querySelector('#ripple-1');
      const r2 = s.querySelector('#ripple-2');
      if (r1) r1.setAttribute('d', wavePath(110, 450, 900, 14, t, 0));
      if (r2) r2.setAttribute('d', wavePath(110, 470, 900, 10, t * 0.7, 1));
    }
  };

  function wavePath(x1, y, x2, amp, t, off) {
    const pts = [`M ${x1} ${y}`];
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const x = x1 + (x2 - x1) * (i / steps);
      const dy = Math.sin(t * 2 + i * 0.8 + off) * amp * 0.3;
      pts.push(`L ${x} ${y + dy}`);
    }
    return pts.join(' ');
  }

  function spawnBubble(initial) {
    const x = 130 + Math.random() * 740;
    const y = initial ? 200 + Math.random() * 440 : 650 + Math.random() * 30;
    const r = 8 + Math.random() * 18;
    const g = svg('g', {}, bubblesG);
    const c = svg('circle', { cx: x, cy: y, r, fill: 'rgba(255,255,255,0.85)', stroke: 'rgba(180,220,255,0.9)', 'stroke-width': 2 }, g);
    svg('circle', { cx: x - r * 0.4, cy: y - r * 0.4, r: r * 0.3, fill: 'white', opacity: 0.85 }, g);
    bubbles.push({ el: c, x, y, vy: 30 + Math.random() * 40, wob: 1.5 + Math.random() * 2, phase: Math.random() * 6.28 });
  }
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
      // Each ring's visible arc shrinks from full circle to nothing
      rings.forEach(({ el, circ }) => {
        const visible = circ * (1 - progressDone);
        if (visible < 1.5) {
          el.style.display = 'none';
        } else {
          el.style.display = '';
          el.setAttribute('stroke-dasharray', `${visible} ${circ}`);
        }
      });

      // Sun gentle pulse + tiny float
      const pulse = 1 + Math.sin(t * 2) * 0.04;
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
