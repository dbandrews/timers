// =================================================================
// AI TIMER DESIGNER
// Calls the OpenAI API from the browser and turns the response into
// a brand-new visualization registered in vizRegistry (see app.js).
// Loaded after app.js, so all its top-level helpers are in scope.
// =================================================================

// Where your API key lives, in priority order:
//   1. EMBEDDED_OPENAI_API_KEY below — ONLY for a private fork. This repo
//      is published via GitHub Pages, so anything committed here is public
//      and OpenAI will auto-revoke a leaked key within minutes.
//   2. The "OpenAI API key" box on the setup screen — saved to this
//      browser's localStorage only, never sent anywhere except api.openai.com.
const EMBEDDED_OPENAI_API_KEY = '';
const OPENAI_MODEL = 'gpt-5.4';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const AI_KEY_STORE = 'toddler-timer-openai-key';
const AI_DESIGN_STORE = 'toddler-timer-ai-designs';
const MAX_SAVED_DESIGNS = 6;

const SYSTEM_PROMPT = `You write JavaScript for a toddler visual countdown timer. Invent ONE new, original SVG visualization that has never been seen before.

Respond with ONLY raw JavaScript — no markdown fences, no commentary — that ends with a return statement of this exact shape:

return {
  name: 'Short Fun Name',              // 1-2 playful toddler-friendly words
  background: 'linear-gradient(180deg, #??? 0%, #??? 100%)', // CSS background for the stage behind the SVG
  init(s) { /* build the scene */ },
  render(s, progressDone, t) { /* update every frame */ }
};

How it is used:
- s is an empty <svg viewBox="0 0 1000 700"> element. Draw everything inside it in init.
- render runs ~60 times per second. progressDone goes 0 (timer starts) to 1 (time is up). t is seconds elapsed, for ambient animation.
- The picture MUST show time remaining as one big solid mass that visibly shrinks, drains, retracts, or vanishes piece-by-piece as progressDone goes 0 to 1. A toddler must see at a glance how much is left.

Rules:
- Big bold shapes, cheerful colors, and a cute smiling face somewhere.
- Gentle ambient motion driven by t (bobbing, twinkling, drifting clouds).
- These helpers exist as variables: svg(tag, attrs, parent) creates and appends a namespaced SVG element (attrs is a plain object); lerp(a, b, t); clamp(v, lo, hi); mixHex('#aabbcc', '#ddeeff', t) blends two hex colors; SVG_NS.
- Keep element references in closure variables declared before the return statement.
- Draw ONLY inside s. No HTML DOM access, no document/window, no fetch, no setTimeout/setInterval/requestAnimationFrame, no external images or fonts, no CSS classes.
- init can be called again after a reset: re-initialize any closure arrays at the top of init.
- render must be cheap and must not throw at progressDone 0, 0.5, or 1 (e.g. guard against zero-size shapes).`;

// ----- Key handling ----------------------------------------------
function getApiKey() {
  if (EMBEDDED_OPENAI_API_KEY) return EMBEDDED_OPENAI_API_KEY;
  try { return localStorage.getItem(AI_KEY_STORE) || ''; } catch { return ''; }
}
function setApiKey(key) {
  try {
    if (key) localStorage.setItem(AI_KEY_STORE, key);
    else localStorage.removeItem(AI_KEY_STORE);
  } catch { /* no-op */ }
}

// ----- Saved designs ---------------------------------------------
function loadSavedDesigns() {
  try {
    const d = JSON.parse(localStorage.getItem(AI_DESIGN_STORE) || '[]');
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}
function saveDesigns(designs) {
  try { localStorage.setItem(AI_DESIGN_STORE, JSON.stringify(designs)); } catch { /* no-op */ }
}

// ----- Compile + validate LLM output -----------------------------
function stripFences(text) {
  return text.replace(/^\s*```(?:javascript|js)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}

function compileViz(code) {
  const factory = new Function('svg', 'lerp', 'clamp', 'mixHex', 'SVG_NS', '"use strict";\n' + code);
  const def = factory(svg, lerp, clamp, mixHex, SVG_NS);
  if (!def || typeof def.init !== 'function' || typeof def.render !== 'function') {
    throw new Error('Design is missing init() or render()');
  }
  return def;
}

// Run init + a few render frames on an offscreen SVG so a broken
// design fails here instead of on the run screen.
function smokeTest(def) {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-99999px;top:0;width:1000px;height:700px;';
  const testSvg = document.createElementNS(SVG_NS, 'svg');
  testSvg.setAttribute('viewBox', '0 0 1000 700');
  holder.appendChild(testSvg);
  document.body.appendChild(holder);
  try {
    def.init(testSvg);
    for (const p of [0, 0.5, 1]) def.render(testSvg, p, p * 3);
  } finally {
    document.body.removeChild(holder);
  }
}

// ----- Viz card creation -----------------------------------------
function addAiVizCard(id, def, select) {
  const grid = $('#viz-grid');
  const card = document.createElement('button');
  card.className = 'viz-card ai-card';
  card.dataset.viz = id;

  const thumb = document.createElement('div');
  thumb.className = 'viz-thumb ai-thumb';
  // Render a real mini-preview of the design at ~1/4 elapsed
  try {
    const mini = document.createElementNS(SVG_NS, 'svg');
    mini.setAttribute('viewBox', '0 0 1000 700');
    mini.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    mini.style.cssText = 'width:100%;height:100%;display:block;';
    if (def.background) thumb.style.background = def.background;
    def.init(mini);
    def.render(mini, 0.25, 1);
    thumb.appendChild(mini);
  } catch { /* sparkle fallback background from CSS */ }

  const label = document.createElement('span');
  label.textContent = def.name || 'Mystery';

  card.appendChild(thumb);
  card.appendChild(label);
  card.addEventListener('click', () => {
    $$('.viz-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    state.vizId = id;
    playSelectTick();
  });
  grid.appendChild(card);

  if (select) {
    $$('.viz-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    state.vizId = id;
  }
  return card;
}

function removeVizCard(id) {
  const card = document.querySelector(`.viz-card[data-viz="${id}"]`);
  if (card) card.remove();
  delete vizRegistry[id];
}

// ----- Generation flow -------------------------------------------
let generating = false;

async function requestDesign(theme, apiKey) {
  const userMsg = theme
    ? `Design theme: ${theme}. Invent a brand-new timer visualization around it.`
    : 'Surprise me with a brand-new timer visualization, unlike any classic bar or ring.';
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ],
      max_completion_tokens: 8000,
    }),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { detail = (await res.json()).error?.message || detail; } catch { /* no-op */ }
    throw new Error(detail);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from the model');
  return stripFences(text);
}

function setAiStatus(msg, kind) {
  const el = $('#ai-status');
  el.hidden = !msg;
  el.textContent = msg || '';
  el.className = 'ai-status' + (kind ? ` ai-status-${kind}` : '');
}

async function generateAiViz() {
  if (generating) return;
  const apiKey = getApiKey();
  if (!apiKey) {
    $('#ai-key-details').open = true;
    $('#ai-key').focus();
    setAiStatus('Add your OpenAI API key first (stored only in this browser).', 'error');
    return;
  }
  const theme = $('#ai-theme').value.trim();
  const btn = $('#ai-generate-btn');
  generating = true;
  btn.disabled = true;
  btn.textContent = 'Dreaming…';
  setAiStatus('Asking the robot artist for a brand-new timer…', 'busy');
  try {
    const code = await requestDesign(theme, apiKey);
    const def = compileViz(code);
    smokeTest(def);

    const id = `ai-${Date.now().toString(36)}`;
    registerViz(id, def);

    // Persist, evicting the oldest beyond the cap
    const designs = loadSavedDesigns();
    designs.push({ id, name: def.name || 'Mystery', code });
    while (designs.length > MAX_SAVED_DESIGNS) {
      const evicted = designs.shift();
      removeVizCard(evicted.id);
    }
    saveDesigns(designs);

    addAiVizCard(id, def, true);
    playSelectTick();
    setAiStatus(`Made “${def.name || 'Mystery'}”! It's selected — press Start to try it.`, 'ok');
  } catch (err) {
    setAiStatus(`Couldn't make a timer: ${err.message}`, 'error');
  } finally {
    generating = false;
    btn.disabled = false;
    btn.textContent = 'Make it!';
  }
}

// ----- Init -------------------------------------------------------
function aiInit() {
  // Restore previously generated designs as cards
  const designs = loadSavedDesigns();
  const kept = [];
  for (const d of designs) {
    try {
      const def = compileViz(d.code);
      registerViz(d.id, def);
      addAiVizCard(d.id, def, false);
      kept.push(d);
    } catch { /* drop designs that no longer compile */ }
  }
  if (kept.length !== designs.length) saveDesigns(kept);

  const keyInput = $('#ai-key');
  keyInput.value = getApiKey();
  $('#ai-key-save').addEventListener('click', () => {
    setApiKey(keyInput.value.trim());
    setAiStatus(keyInput.value.trim() ? 'Key saved in this browser.' : 'Key cleared.', 'ok');
    $('#ai-key-details').open = false;
  });

  $('#ai-generate-btn').addEventListener('click', generateAiViz);
  $('#ai-theme').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') generateAiViz();
  });
}

aiInit();
