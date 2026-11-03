// DOM helpers + persistent stats.
const $ = s => document.querySelector(s);
let flashT = 0;

export const ui = {
  prompt(html, sub = '') { $('#prompt').innerHTML = html + (sub ? `<div class="sub">${sub}</div>` : ''); },
  feedback(html) { $('#feedback').innerHTML = html; },
  feedbackKeep() { /* keep previous explanation visible until the next answer */ },
  flash(text, cls = 'ok', ms = 1100) {
    const el = $('#flash'); el.textContent = text; el.className = cls + ' show';
    clearTimeout(flashT); flashT = setTimeout(() => el.className = cls, ms);
  },
  timer(sec) {
    const el = $('#timer');
    if (!sec) { el.style.width = '0'; return; }
    el.style.width = Math.min(1, sec / 6) * 100 + '%';
    el.style.background = sec < 2 ? '#4ade80' : sec < 4 ? '#facc15' : '#f87171';
  },
  answers(list) {
    const box = $('#answers'); box.innerHTML = '';
    for (const o of list) {
      const b = document.createElement('button');
      b.innerHTML = o.html + (o.key ? `<kbd>${o.key}</kbd>` : '');
      if (o.cls) b.className = o.cls;
      if (o.disabled) b.disabled = true;
      b.onclick = e => { e.stopPropagation(); o.fn(); };
      o.el = b; box.appendChild(b);
    }
    return list;
  },
  traffic() { return +$('#traffic').value; },
  hints() { return $('#hints').checked; },
};

const DEF = {
  m1: { n: 0, ok: 0, t: 0 }, m1c: { n: 0, ok: 0 }, m1r: { n: 0, ok: 0 },
  m2: { n: 0, perfect: 0, streak: 0, best: 0 },
  m3: { n: 0, good: 0, tight: 0, bad: 0, missed: 0 },
  m4: { n: 0, good: 0, tight: 0, bad: 0, missed: 0 },
};
let saved = {};
try { saved = JSON.parse(localStorage.getItem('precedenza-v2')) || {}; } catch (e) { }
export const stats = {};
for (const k in DEF) stats[k] = Object.assign({}, DEF[k], saved[k] || {});
let currentId = null;
export function setStatsMode(id) { currentId = id; showStats(); }
export function saveStats() { try { localStorage.setItem('precedenza-v2', JSON.stringify(stats)); } catch (e) { } showStats(); }
export function showStats() {
  const el = $('#stats'), s = stats;
  const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
  if (currentId === 'm1') el.textContent = `Blinkers ${s.m1.ok}/${s.m1.n}${s.m1.ok ? ` (avg ${(s.m1.t / s.m1.ok).toFixed(1)} s)` : ''} · crossing paths ${s.m1c.ok}/${s.m1c.n} · roundabout ${s.m1r.ok}/${s.m1r.n}`;
  else if (currentId === 'm2') el.textContent = `Perfect rounds ${s.m2.perfect}/${s.m2.n} (${pct(s.m2.perfect, s.m2.n)}) · streak ${s.m2.streak} · best ${s.m2.best}`;
  else if (currentId === 'm3' || currentId === 'm4') { const m = s[currentId]; el.textContent = `${m.good} good · ${m.tight} risky · ${m.bad} wrong · ${m.missed} chances missed`; }
  else el.textContent = '';
}
