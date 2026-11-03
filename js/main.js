// Boot, mode switching, input, main loop.
import { initRender, resize, renderFrame, syncDynamic, setViewMode, pickAt, canvasEl, R } from './render.js';
import { W } from './sim.js';
import { M1, M2, M3, M4 } from './modes.js';
import { ui, setStatsMode } from './ui.js';

const $ = s => document.querySelector(s);
const stage = $('#stage');
const MODES = { m1: M1, m2: M2, m3: M3, m4: M4 };
let current = null, T = 0, lastCam = null;

initRender(stage);

function doResize() {
  const w = stage.clientWidth || 800;
  const h = w < 600 ? Math.min(680, Math.max(420, Math.round(w * 1.25))) : Math.min(680, Math.max(400, Math.round(w * 0.6)));
  stage.style.height = h + 'px'; resize(w, h);
}
new ResizeObserver(doResize).observe(stage);

let viewPrefs = {};
try { viewPrefs = JSON.parse(localStorage.getItem('precedenza-views')) || {}; } catch (e) { }
function setView(v, save = true) {
  setViewMode(v);
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  const look = v === 'chase' || v === 'driver';
  $('#look').style.display = look ? 'flex' : 'none'; stage.classList.toggle('looking', look);
  if (save && current) { viewPrefs[current.id] = v; try { localStorage.setItem('precedenza-views', JSON.stringify(viewPrefs)); } catch (e) { } }
}

function setMode(id) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.m === id));
  const rules = id === 'rules';
  $('#rules').style.display = rules ? 'block' : 'none';
  $('#play').style.display = rules ? 'none' : 'block';
  if (rules) { current = null; return; }
  $('#optHints').style.display = (id === 'm3' || id === 'm4') ? '' : 'none';
  $('#optTraffic').style.display = (id === 'm3' || id === 'm4') ? '' : 'none';
  current = MODES[id];
  setStatsMode(id);
  ui.feedback(INTRO[id] || ''); ui.flash('', 'ok', 1);
  setView(viewPrefs[id] || current.defaultView, false);
  doResize();
  current.start();
  if (INTRO[id]) setTimeout(() => { if (current?.id === id && !$('#feedback').innerHTML.includes('<h3')) ui.feedback(INTRO[id]); }, 0);
}
const INTRO = {
  m1: `<h3>Read the signal</h3><ul><li><b>Where is it going?</b> Predict a car's exit from its blinker, from <i>your</i> point of view (arrow keys).</li><li><b>Whose path crosses mine?</b> Tap every vehicle whose route meets yours.</li><li><b>Roundabout:</b> tap the cars that will pass in front of your entry.</li></ul>`,
  m2: `<h3>Who goes first?</h3><ul><li>Tap every road user (cars, scooters, buses, pedestrians P1/P2) <b>in the order they go</b>.</li><li>Signs, lights, <i>precedenza a destra</i>, left turns, queues, pedestrians and ambulances all count.</li></ul>`,
  m3: `<h3>Junction live</h3><ul><li>Real traffic, and every AI driver follows the rules. You arrive (maybe in a queue), set your blinker, and press <b>GO</b> when it's <i>your</i> turn.</li><li>Going early is wrong; hesitating when it's clearly your turn is also marked.</li></ul>`,
  m4: `<h3>Roundabout live</h3><ul><li>Set your blinker for your exit, then pick a safe gap. Read the blinkers of cars coming from your left.</li><li>Then switch to the right blinker at the right moment before your exit.</li></ul>`,
};

// ------------------------------------------------------------------ input
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setMode(b.dataset.m));
document.querySelectorAll('#views button').forEach(b => b.onclick = e => { e.stopPropagation(); setView(b.dataset.v); });
document.querySelectorAll('#look button').forEach(b => b.onclick = e => { e.stopPropagation(); const l = +b.dataset.l; R.view.userYaw = l === 0 ? -R.view.autoYaw : R.view.userYaw + l * 0.6; });
$('#traffic').onchange = () => { if (current?.id === 'm3' || current?.id === 'm4') { /* applies next round */ } };
window.addEventListener('keydown', e => {
  if (!current || e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  if (e.key === 'v' || e.key === 'V') { const o = ['map', 'orbit', 'chase', 'driver']; setView(o[(o.indexOf(R.view.mode) + 1) % o.length]); return; }
  if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
  current.key?.(e.key);
});
let drag = null;
canvasEl().addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: R.view.userYaw, moved: false }; });
window.addEventListener('pointermove', e => {
  if (!drag) return; const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 6) drag.moved = true;
  if (drag.moved && R.view.mode !== 'map') R.view.userYaw = drag.yaw + dx * (R.view.mode === 'orbit' ? -0.008 : 0.006);
});
window.addEventListener('pointerup', e => {
  if (!drag) return; const d = drag; drag = null;
  if (d.moved || !current?.click || !lastCam) return;
  const ent = pickAt(e.clientX, e.clientY, lastCam);
  if (ent) current.click(ent);
});

// ------------------------------------------------------------------ loop
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (current) {
    T += dt;
    current.update(dt);
    syncDynamic(T);
    lastCam = renderFrame(dt, T);
  }
  requestAnimationFrame(loop);
}
doResize();
setMode('m1');
requestAnimationFrame(loop);
window.__debug = { W, MODES, get current() { return current; }, R };
