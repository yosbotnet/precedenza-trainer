// Game modes.
import { S_, E_, N_, W_, OUT, HW, ZEB, RB, pathsConflict, turnOf } from './geo.js';
import {
  W, VTYPES, TYPE_NAME, setScene, randomJunction, roundaboutJunction, addVehicle, addPed, enableSpawning, step, canGo, isDeadlocked,
  priorityOver, lightOf, entryThreat, rbSafe, rbRoom, emergencyComing, stopPos, frontS, cleared, distToLine, validExits, isFront,
  pick, rand, wpick, randomType, blinkOf, sync,
} from './sim.js';
import { R, buildEnv, setLabel, setRing, sideTag, ribbon, clearRibbons, clearDynamic } from './render.js';
import { ui, stats, saveStats } from './ui.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const nm = e => e.isPlayer ? 'you' : e.name;
const Nm = e => cap(nm(e));
const poss = e => e.isPlayer ? 'your' : e.name + '’s';
const is = e => e.isPlayer ? 'are' : 'is';
const has = e => e.isPlayer ? 'have' : 'has';
const vs = (e, verb) => e.isPlayer ? verb : verb + 's';
const SIGN_NAME = { yield: '“Dare precedenza”', stop: 'STOP', priority: 'priority-road' };
const TURN_TXT = { 1: 'turning right', 2: 'going straight on', 3: 'turning left', 0: 'making a U-turn' };
const ARM_FROM = { 0: 'behind you', 1: 'from your right', 2: 'from the front (oncoming)', 3: 'from your left' };
const EXIT_REL = { 0: 'into <b>your road</b>, toward you', 1: 'into the road on <b>your right</b>', 2: 'into the road <b>straight ahead</b>', 3: 'into the road on <b>your left</b>' };
const blinkTxt = b => b === 'L' ? 'left' : b === 'R' ? 'right' : 'no blinker';

export function reasonText(v, r) {
  const o = r.o;
  switch (r.code) {
    case 'right': return `${nm(o)} ${vs(o, 'come')} from ${poss(v)} <b>right</b>: <i>precedenza a destra</i>`;
    case 'left': return `${nm(v)} ${vs(v, 'turn')} <b>left</b>, so ${nm(v)} must let the <b>oncoming</b> ${nm(o)} go first`;
    case 'sign': return `${nm(v)} ${has(v)} a <b>${SIGN_NAME[W.J.signs[v.arm]]}</b> sign, and ${nm(o)} ${is(o)} on the main road`;
    case 'red': return o ? `${nm(v)} ${has(v)} a <b>red light</b>. ${Nm(o)} ${has(o)} green` : `${nm(v)} ${has(v)} a <b>red light</b>`;
    case 'amber': return `the light is <b>amber</b>: if you're standing at the line, you stay`;
    case 'emergency': return `an <b>ambulance with its siren on</b> is coming. Let it through first`;
    case 'inside': return `${nm(o)} ${is(o)} <b>already in the junction</b> on a crossing path`;
    case 'ped': return `a <b>pedestrian</b> is on (or stepping onto) a zebra crossing on ${poss(v)} route: pedestrians first`;
    case 'queue': return `${nm(v)} ${is(v)} <b>behind ${nm(o)}</b> in the same lane`;
    case 'stop': return `STOP sign: come to a <b>complete stop</b> first`;
  }
  return r.code;
}
function vehicleName(v, letter) { return (v.type === 'car' || v.type === 'small' ? 'car ' : TYPE_NAME[v.type] + ' ') + letter; }

// ------------------------------------------------------------------ common helpers
function prewarm(sec) { const f = W.frozen; W.frozen = false; for (let t = 0; t < sec; t += 0.05) step(0.05); W.frozen = f; }
function newScene(J) { clearDynamic(); clearRibbons(); setScene(J); buildEnv(J); }
const playerExitTxt = b => ({ 1: 'turn <b>right</b>', 2: 'go <b>straight on</b>', 3: 'turn <b>left</b>' })[turnOf(S_, b)];

// =================================================================== 1 · READ THE SIGNAL
export const M1 = {
  id: 'm1', defaultView: 'map',
  start() { this.next(); },
  next() {
    ui.timer(0); ui.feedbackKeep();
    this.kind = wpick([['where', 4], ['cross', 3], ['rbpass', 2]]);
    const J = this.kind === 'rbpass' ? roundaboutJunction({ pZebra: 0.4 }) : randomJunction({ pZebra: 0.45 });
    newScene(J);
    const pb = pick(validExits(S_));
    const me = addVehicle(S_, pb, 'car', { player: true, passive: true, stopped: true });
    enableSpawning({ level: this.kind === 'where' ? 2 : 3, arms: [1, 2, 3].filter(a => J.arms[a]), peds: 0.5, amb: 0 });
    prewarm(this.kind === 'cross' ? 14 : 10);
    this.state = 'watch'; this.liveT = 0; this.sel = new Set();
    ui.answers([]);
    R.view.autoYaw = this.kind === 'rbpass' ? 0.6 : 0;
    ui.prompt(this.kind === 'where' ? 'Watch the traffic. In a moment one car will be marked <b>?</b>' : this.kind === 'cross' ? `You will ${playerExitTxt(pb)}. Watch the traffic…` : 'You are waiting to enter the roundabout. Watch the traffic…',
      'Blinkers flash orange. Brake lights are red.');
  },
  update(dt) {
    if (this.state === 'watch') {
      step(dt); this.liveT += dt;
      if (this.liveT > 2.5) this.tryFreeze();
    } else if (this.state === 'reveal') step(dt);
    if (this.state === 'ask' && this.kind === 'where') ui.timer((performance.now() - this.askAt) / 1000);
  },
  tryFreeze() {
    const me = W.player;
    if (this.kind === 'where') {
      let c = W.vehicles.filter(v => !v.isPlayer && v.arm !== S_ && !v.committed && distToLine(v) > 5 && distToLine(v) < 30 && v.v > 1.5);
      if (!c.length && this.liveT > 14) { const a = pick([1, 2, 3].filter(x => W.J.arms[x])); const v = addVehicle(a, pick(validExits(a)), randomType(), { s: 0 }); v.s = stopPos(v) - 20; v.v = 8; sync(v); c = [v]; }
      if (!c.length) return;
      const withBlink = c.filter(v => v.turn !== 2);
      this.target = (withBlink.length && Math.random() < 0.75) ? pick(withBlink) : pick(c);
      this.target.name = 'the ? ' + TYPE_NAME[this.target.type];
      setRing(this.target, '#ffd400'); setLabel(this.target, '?', '#ffd400', '#111');
      this.freeze();
      const a = this.target.arm;
      const opts = [[3, '⬅ road on my LEFT', 'ArrowLeft', '←'], [2, '⬆ straight ahead', 'ArrowUp', '↑'], [1, '➡ road on my RIGHT', 'ArrowRight', '→'], [0, '⬇ into MY road', 'ArrowDown', '↓']].filter(([b]) => b !== a && W.J.arms[b]);
      ui.prompt('⏸ Where is the <b>?</b> vehicle going?', 'Answer from YOUR point of view (arrow keys work).');
      this.opts = ui.answers(opts.map(([b, txt, key, k]) => ({ html: txt, key: k, hot: key, val: b, fn: () => this.answer(b) })));
    } else if (this.kind === 'cross') {
      const c = W.vehicles.filter(v => !v.isPlayer && !cleared(v) && (v.committed || distToLine(v) < 32));
      const crossing = c.filter(v => pathsConflict(me.path, v.path));
      if (c.length < 3 || !crossing.length || crossing.length === c.length) { if (this.liveT < 25) return; if (!c.length) return; }
      this.cands = c.slice(0, 6);
      this.cands.forEach((v, i) => { v.letter = 'ABCDEF'[i]; v.name = vehicleName(v, v.letter); setLabel(v, v.letter); });
      this.freeze();
      ui.prompt(`⏸ You will ${playerExitTxt(me.path.b)}. Tap <b>every</b> vehicle whose route <b>crosses or merges into yours</b>.`, 'Then press Done. It doesn’t matter who has priority here, only whose paths meet.');
      this.renderSel();
    } else {
      const c = W.vehicles.filter(v => !v.isPlayer && v.committed && v.s > v.path.s.merge - 3 && v.s < v.path.s.exit);
      if (c.length < 2 && this.liveT < 20) return;
      if (!c.length) return;
      this.cands = c.slice(0, 6);
      this.cands.forEach((v, i) => { v.letter = 'ABCDEF'[i]; v.name = vehicleName(v, v.letter); setLabel(v, v.letter); });
      this.freeze();
      ui.prompt('⏸ Tap every vehicle that will <b>pass in front of your entry</b>.', 'The others leave the roundabout before reaching you. Read their blinkers. Then press Done.');
      this.renderSel();
    }
  },
  freeze() { W.frozen = true; W.lightsFrozen = true; this.state = 'ask'; this.askAt = performance.now(); },
  renderSel() {
    this.opts = ui.answers([...this.cands.map(v => ({ html: v.letter, key: v.letter, hot: v.letter.toLowerCase(), cls: this.sel.has(v) ? 'on' : '', fn: () => this.toggle(v) })),
      { html: 'Done ✓', key: '⏎', hot: 'Enter', cls: 'go', fn: () => this.answerSel() }]);
  },
  toggle(v) { if (this.state !== 'ask' || !this.cands?.includes(v)) return; this.sel.has(v) ? this.sel.delete(v) : this.sel.add(v); setRing(v, this.sel.has(v) ? '#3b82f6' : null); this.renderSel(); },
  click(e) { if (this.kind !== 'where') this.toggle(e); },
  key(k) {
    if (this.state === 'ask') { const o = this.opts?.find(o => o.hot === k || o.hot === k.toLowerCase()); if (o) o.fn(); }
    else if (this.state === 'reveal' && (k === ' ' || k === 'Enter')) this.next();
  },
  unfreeze() { W.frozen = false; W.lightsFrozen = false; this.state = 'reveal'; ui.timer(0); },
  answer(b) {
    if (this.state !== 'ask') return;
    const t = this.target, secs = (performance.now() - this.askAt) / 1000, ok = b === t.path.b;
    stats.m1.n++; if (ok) { stats.m1.ok++; stats.m1.t += secs; } saveStats();
    ui.flash(ok ? (secs < 2 ? `✓ ${secs.toFixed(1)} s, sharp!` : `✓ ${secs.toFixed(1)} s`) : '✗ Not quite', ok ? 'ok' : 'bad');
    for (const o of this.opts) { o.el.disabled = o.val !== t.path.b; if (o.val === t.path.b) o.el.classList.add('on'); }
    if (t.blink) sideTag(t, t.blink);
    ribbon(t.path, t.s, t.path.s.out + 14, 0xffd400, 1.0);
    const me = W.player; ribbon(me.path, me.s, me.path.s.out + 12, 0x1d6ff2, 0.8, 0.5);
    const a = t.arm, turn = t.turn;
    const bl = turn === 1 ? 'its <b>RIGHT</b> blinker on' : turn === 3 ? 'its <b>LEFT</b> blinker on' : '<b>no blinker</b>';
    let look = '';
    if (a === N_ && turn !== 2) look = `It faces you, so the picture is <b>mirrored</b>: its ${turn === 3 ? 'left' : 'right'} blinker flashes on <b>your ${turn === 3 ? 'right' : 'left'}</b> side.`;
    if (a === E_) look = `It comes from your right, so you mostly see its <b>left</b> side${turn === 1 ? '. Its right blinker shows at its <b>front corner</b>' : ''}.`;
    if (a === W_) look = `It comes from your left, so you mostly see its <b>right</b> side${turn === 3 ? '. Its left blinker shows at its <b>front corner</b>' : ''}.`;
    let you;
    const meE = { ...me, isPlayer: true };
    if (pathsConflict(me.path, t.path)) {
      const r1 = priorityOver(meE, t), r2 = priorityOver(t, meE);
      you = `You'll be ${TURN_TXT[me.turn]}, so <b>your paths meet</b>. ` + (r1 ? `You give way, because ${reasonText(meE, { code: r1, o: t })}.` : r2 ? `It gives way to you, because ${reasonText(t, { code: r2, o: meE })}.` : '');
    } else you = `You'll be ${TURN_TXT[me.turn]}: your paths <b>don't meet</b> (blue vs yellow arrows).`;
    ui.feedback(`<h3 class="${ok ? 'ok' : 'bad'}">${ok ? 'Correct' : 'Not quite'}: it goes ${EXIT_REL[t.path.b]}.</h3><ul>
      <li>It comes ${ARM_FROM[a]} with ${bl}, so it ${turn === 2 ? 'goes <b>straight</b>' : `turns to <b>its ${turn === 1 ? 'right' : 'left'}</b>`}.</li>
      ${look ? `<li>${look}</li>` : ''}
      ${turn === 2 ? '<li class="it">No blinker usually means straight on, but people forget, so watch the wheels and the car’s line too.</li>' : ''}
      <li><b>What it means for you:</b> ${you}</li></ul>`);
    this.unfreeze(); this.nextBtn();
    ui.prompt(ok ? '✓ Correct, watch it go.' : '✗ Watch where it actually goes.');
  },
  answerSel() {
    if (this.state !== 'ask') return;
    const me = W.player;
    const truth = new Set(this.cands.filter(v => this.kind === 'cross' ? pathsConflict(me.path, v.path) : (v.path.pass[S_] !== undefined && frontS(v) < v.path.pass[S_] + 1)));
    const wrong = this.cands.filter(v => truth.has(v) !== this.sel.has(v));
    const ok = wrong.length === 0;
    const key = this.kind === 'cross' ? 'm1c' : 'm1r';
    stats[key].n++; if (ok) stats[key].ok++; saveStats();
    ui.flash(ok ? '✓ Exactly right' : `✗ ${wrong.length} wrong`, ok ? 'ok' : 'bad');
    clearRibbons();
    if (this.kind === 'cross') ribbon(me.path, me.s, me.path.s.out + 12, 0x1d6ff2, 1.0, 0.7);
    for (const v of this.cands) {
      const t = truth.has(v), mistake = t !== this.sel.has(v);
      setRing(v, mistake ? '#ff3b30' : t ? '#ff9f0a' : '#34c759');
      ribbon(v.path, v.s, this.kind === 'cross' ? v.path.s.out + 12 : v.path.s.out + 4, t ? 0xff7a1a : 0x8fd19e, 0.8, 0.6);
    }
    const lines = this.cands.map(v => {
      const t = truth.has(v), mistake = t !== this.sel.has(v);
      let why;
      if (this.kind === 'cross') why = t ? `${v.name}: ${TURN_TXT[v.turn]} ${ARM_FROM[v.arm]}. It <b>meets your path</b>.` : `${v.name}: ${TURN_TXT[v.turn]} ${ARM_FROM[v.arm]}. It <b>doesn't meet</b> your path.`;
      else why = t ? `${v.name}: ${v.blink === 'R' ? 'right blinker, but it has <b>already passed</b> your road’s exit, so it’s going further.' : v.blink === 'L' ? '<b>left</b> blinker: staying in the roundabout.' : '<b>no blinker</b>: not leaving at your road.'} It passes in front of you.` : `${v.name}: ${v.path.b === S_ ? '<b>right blinker</b>, leaving into <b>your</b> road' : 'leaving before it reaches you'}. It doesn't block you.`;
      return `<li class="${mistake ? 'bad' : ''}">${mistake ? '✗ ' : ''}${why}</li>`;
    });
    ui.feedback(`<h3 class="${ok ? 'ok' : 'bad'}">${ok ? 'All correct!' : 'Some mistakes (red rings)'}</h3><div class="it">Orange = ${this.kind === 'cross' ? 'meets your path' : 'passes in front of you'}, green = doesn't.</div><ul>${lines.join('')}</ul>`);
    this.unfreeze(); this.nextBtn();
    ui.prompt('Watch what happens…');
  },
  nextBtn() { this.opts = ui.answers([{ html: 'Next ▸', key: 'space', hot: ' ', cls: 'go', fn: () => this.next() }]); },
};

// =================================================================== 2 · WHO GOES FIRST
function staticBlockers(V, ents) {
  const bl = [];
  const veh = ents.filter(e => !e.isPed);
  const lead = veh.filter(o => o.arm === V.arm && o.s > V.s).sort((a, b) => a.s - b.s)[0];
  if (lead) bl.push({ o: lead, code: 'queue' });
  for (const O of veh) {
    if (O === V || O.arm === V.arm) continue;
    if (O.emergency && !V.emergency) { bl.push({ o: O, code: 'emergency' }); continue; }
    if (V.emergency) continue;
    const conflict = pathsConflict(V.path, O.path), rel = (O.arm - V.arm + 4) % 4;
    if (W.J.lights) {
      const lv = lightOf(V.arm), lo = lightOf(O.arm);
      if (lv === 'R' && lo === 'G') { bl.push({ o: O, code: 'red' }); continue; }
      if (lv === 'G' && lo === 'R') continue;
      if (conflict && rel === 2 && V.turn === 3 && O.turn !== 3) bl.push({ o: O, code: 'left' });
      continue;
    }
    if (!conflict) continue;
    const code = priorityOver(V, O);
    if (code) bl.push({ o: O, code });
  }
  if (!V.emergency) for (const P of ents.filter(e => e.isPed)) if (V.zebras.some(z => z.arm === P.arm)) bl.push({ o: P, code: 'ped' });
  return bl;
}
export const M2 = {
  id: 'm2', defaultView: 'map',
  start() { this.next(); },
  gen() {
    for (let tries = 0; tries < 300; tries++) {
      const J = randomJunction({ pT: 0.35, pLights: 0.22, pSigned: 0.6, pZebra: 0.55 });
      setScene(J); W.scripted = true; W.frozen = true; W.lightsFrozen = true;
      if (J.lights) W.lights = { axis: Math.random() < 0.5 ? 0 : 1, stage: 'G', t: 0 };
      const others = [1, 2, 3].filter(a => J.arms[a]).sort(() => Math.random() - 0.5);
      const k = Math.min(others.length, wpick([[1, 2], [2, 4], [3, 3]]));
      const arms = [S_, ...others.slice(0, k)];
      let budget = 7;
      for (const a of arms) {
        const n = a === S_ ? (Math.random() < 0.18 ? 2 : 1) : (Math.random() < 0.32 ? 2 : 1);
        let sPrev = null, Lprev = 0;
        for (let i = 0; i < n && budget > 0; i++, budget--) {
          const isPlayer = a === S_ && i === n - 1;
          const type = isPlayer ? 'car' : wpick([['car', 6], ['small', 2], ['van', 1.5], ['moto', 1.2], ['bus', i === 0 ? 0.6 : 0]]);
          const v = addVehicle(a, pick(validExits(a)), type, { player: isPlayer, stopped: true });
          if (sPrev !== null) { v.s = sPrev - Lprev / 2 - 1.6 - v.L / 2; v.stopAt = stopPos(v); sync(v); }
          v.v = 0; sPrev = v.s; Lprev = v.L;
        }
      }
      // ambulance on an empty arm
      const empty = [1, 2, 3].filter(a => J.arms[a] && !arms.includes(a));
      if (empty.length && Math.random() < 0.14) { const a = pick(empty); const v = addVehicle(a, pick(validExits(a)), 'amb', { stopped: true }); v.s -= 14; v.stopAt = stopPos(v); sync(v); }
      // pedestrians crossing
      const zArms = [0, 1, 2, 3].filter(a => J.zebra[a]);
      if (zArms.length && Math.random() < 0.45) {
        const np = Math.random() < 0.3 ? 2 : 1;
        for (let i = 0; i < np; i++) addPed(pick(zArms), { state: 'crossing', lat: rand(-HW + 0.6, HW - 0.6) });
      }
      for (const v of W.vehicles) { const lights = W.lights; v.committed = false; }
      const ents = [...W.vehicles, ...W.peds];
      const bl = new Map(ents.map(e => [e, e.isPed ? [] : staticBlockers(e, ents)]));
      // acyclic?
      const level = new Map(); let changed = true, guard = 0;
      while (changed && guard++ < 20) { changed = false; for (const e of ents) { if (level.has(e)) continue; const b = bl.get(e); if (b.every(x => level.has(x.o))) { level.set(e, b.length ? 1 + Math.max(...b.map(x => level.get(x.o))) : 0); changed = true; } } }
      if (level.size < ents.length) continue;
      const me = W.player, meInvolved = bl.get(me).some(x => x.code !== 'queue') || ents.some(e => bl.get(e).some(x => x.o === me && x.code !== 'queue'));
      if (!meInvolved && Math.random() < 0.85) continue;
      if (ents.length < 3 && Math.random() < 0.6) continue;
      return { J, ents, bl, level };
    }
  },
  next() {
    clearDynamic(); clearRibbons();
    const G = this.gen(); this.G = G; buildEnv(G.J);
    let li = 0, pi = 1;
    for (const a of [W_, N_, E_, S_]) for (const v of W.vehicles.filter(v => v.arm === a && !v.isPlayer).sort((x, y) => y.s - x.s)) { v.letter = 'ABCDEFGH'[li++]; v.name = v.emergency ? 'the ambulance' : vehicleName(v, v.letter); setLabel(v, v.letter, v.emergency ? '#c8102e' : '#111'); }
    for (const p of W.peds) { p.letter = 'P' + pi++; p.name = 'pedestrian ' + p.letter; setLabel(p, p.letter, '#7c3aed'); }
    const ext = [...W.vehicles.map(v => [v.x, v.z]), ...W.peds.map(p => [p.x, p.z])];
    R.view.fit = { x: Math.max(...ext.map(e => Math.abs(e[0]))), zmin: Math.min(...ext.map(e => e[1])), zmax: Math.max(...ext.map(e => e[1])) };
    this.picked = []; this.mistakes = 0; this.state = 'pick';
    R.view.autoYaw = 0;
    ui.prompt('Who goes first? Tap everyone <b>in the order they go</b>.', 'Road users whose paths don’t cross can go together, so either order counts.');
    const J = G.J, bits = [];
    if (J.lights) bits.push('Traffic lights (the coloured dots by each stop line).');
    else if (J.signed) bits.push('Read the signs by each road first.'); else bits.push('No signs at this junction.');
    if (W.peds.length) bits.push('Pedestrians are crossing.');
    if (W.vehicles.some(v => v.emergency)) bits.push('🚑 Siren on!');
    ui.feedback(`<span class="it">${bits.join(' ')}</span>`);
    this.renderChips();
  },
  renderChips() {
    const ents = this.G.ents;
    const order = [...ents.filter(e => !e.isPed && !e.isPlayer).sort((a, b) => a.letter < b.letter ? -1 : 1), W.player, ...ents.filter(e => e.isPed)];
    this.chips = ui.answers(order.map(e => ({ html: e.isPlayer ? 'YOU' : e.letter, key: e.isPlayer ? 'Y' : e.letter.length > 1 ? '' : e.letter, hot: e.isPlayer ? 'y' : e.letter.toLowerCase(), ent: e, disabled: this.picked.includes(e), fn: () => this.pick(e) })));
  },
  pick(e) {
    if (this.state !== 'pick' || this.picked.includes(e) || !this.G.ents.includes(e)) return;
    const blockers = this.G.bl.get(e).filter(x => !this.picked.includes(x.o));
    if (blockers.length) {
      this.mistakes++;
      const B = blockers[0].o;
      ui.flash(`✗ ${Nm(e)} must wait`, 'bad');
      setRing(B, '#ff3b30'); setTimeout(() => { if (!this.picked.includes(B) && this.state === 'pick') setRing(B, null); }, 1700);
      ui.feedback(`<h3 class="bad">${Nm(e)} can't go yet.</h3><ul><li>${cap(reasonText(e, blockers[0]))}.</li></ul>`);
      return;
    }
    this.picked.push(e);
    setLabel(e, String(this.picked.length), '#16a34a'); setRing(e, '#16a34a');
    if (this.picked.length === this.G.ents.length) this.finish(); else { ui.flash('✓', 'ok', 450); this.renderChips(); }
  },
  click(e) { this.pick(e); },
  key(k) {
    if (this.state === 'pick') { const ch = this.chips.find(o => o.hot === k.toLowerCase()); if (ch) ch.fn(); }
    else if (k === ' ' || k === 'Enter') this.next();
  },
  finish() {
    this.state = 'play'; this.playT = 0;
    const perfect = this.mistakes === 0;
    stats.m2.n++; if (perfect) { stats.m2.perfect++; stats.m2.streak++; stats.m2.best = Math.max(stats.m2.best, stats.m2.streak); } else stats.m2.streak = 0; saveStats();
    ui.flash(perfect ? '✓ Perfect order!' : `Done, ${this.mistakes} mistake${this.mistakes > 1 ? 's' : ''}`, perfect ? 'ok' : 'warn');
    const G = this.G;
    const waves = []; for (const e of G.ents) (waves[G.level.get(e)] ||= []).push(e);
    const waveTxt = waves.filter(Boolean).map((w, i) => `<b>${i + 1}.</b> ${w.map(e => Nm(e)).join(' + ')}`).join(' &nbsp;→&nbsp; ');
    const lines = [];
    for (const e of G.ents) {
      const b = G.bl.get(e);
      const who = e.isPed ? Nm(e) : `${Nm(e)} (${TURN_TXT[e.turn]})`;
      if (b.length) lines.push(`<li>${who} waits: ${b.map(x => reasonText(e, x)).join('; ')}.</li>`);
      else lines.push(`<li>${who} goes ${G.level.get(e) === 0 ? 'first' : ''}: nobody has priority over ${e.isPlayer ? 'you' : 'it'}${e.isPed ? ' (already on the crossing)' : ''}.</li>`);
    }
    if (W.J.signs[S_] === 'stop' && !W.J.lights) lines.push(`<li><b>Your STOP sign:</b> come to a full stop even if you go first.</li>`);
    if (!W.J.signed && !W.J.lights) lines.unshift(`<li class="it">No signs, so: precedenza a destra, and a left turn gives way to oncoming traffic.</li>`);
    ui.feedback(`<h3 class="${perfect ? 'ok' : 'warn'}">${perfect ? 'Perfect!' : 'The right order'}</h3><div>${waveTxt}</div><ul>${lines.join('')}</ul>`);
    const cols = [0x22c55e, 0x3b82f6, 0xf59e0b, 0xa855f7, 0xef4444, 0x14b8a6];
    for (const v of W.vehicles) ribbon(v.path, v.s, v.path.s.out + 10, cols[G.level.get(v) % cols.length], 0.8, 0.55);
    ui.answers([{ html: 'Next ▸', key: 'space', hot: ' ', cls: 'go', fn: () => this.next() }]);
    ui.prompt('Watch everyone go in the right order…');
    W.frozen = false;
  },
  update(dt) {
    if (this.state !== 'play') return;
    this.playT += dt;
    if (this.playT < 0.6) return;
    const done = x => x.o.isPed ? (x.o.state === 'leaving' || x.o.gone) : x.code === 'queue' ? x.o.committed : (x.o.gone || cleared(x.o));
    for (const v of W.vehicles) {
      if (v.committed) continue;
      const b = this.G.bl.get(v) || [];
      if (b.every(done)) { v.readyAt ??= this.playT; if (this.playT - v.readyAt > (b.some(x => x.code === 'queue') ? 0.2 : 0.45)) { v.committed = true; v.stopAt = null; } }
    }
    // switch the lights once the green road is empty
    if (W.lights && !this.switched && W.vehicles.filter(v => lightOf(v.arm) === 'G').every(v => v.committed && cleared(v))) { this.switched = true; W.lights.axis = 1 - W.lights.axis; }
    step(dt);
  },
};
M2.switched = false;
const _m2next = M2.next; M2.next = function () { this.switched = false; _m2next.call(this); };

// =================================================================== 3 · JUNCTION LIVE
export const M3 = {
  id: 'm3', defaultView: 'chase',
  start() { this.newRound(); },
  newRound() {
    const J = randomJunction({ pT: 0.3, pLights: 0.25, pSigned: 0.55, pZebra: 0.6 });
    newScene(J);
    const level = ui.traffic();
    enableSpawning({ level, arms: [1, 2, 3].filter(a => J.arms[a]), peds: 0.9, amb: 0.5 });
    W.spawn.maxQueue = level === 3 ? 4 : 3;
    // some cars on your road too, ahead of you
    prewarm(6);
    const nAhead = wpick([[0, 3], [1, 3], [2, 1]]);
    for (let i = 0; i < nAhead; i++) { const v = addVehicle(S_, pick(validExits(S_)), randomType(), { s: 18 - i * 9 }); v.v = 9; }
    prewarm(10);
    const b = pick(validExits(S_));
    const lastS = Math.min(...W.vehicles.filter(v => v.arm === S_ && !v.committed).map(v => v.s - v.L / 2), 999);
    const me = addVehicle(S_, b, 'car', { player: true, s: Math.min(lastS - 9, 30), v: 7 });
    me.manualBlink = null; me.stopAt = stopPos(me);
    this.phase = 'approach'; this.r = {}; this.okRun = 0; this.blinkTouched = false;
    R.view.autoYaw = 0;
    const J2 = W.J, signTxt = J2.lights ? 'traffic lights' : J2.signs[S_] === 'stop' ? 'a <b>STOP</b> sign' : J2.signs[S_] === 'yield' ? 'a <b>Dare precedenza</b> sign' : J2.signs[S_] === 'priority' ? 'the <b>priority road</b>' : '<b>no signs</b> (precedenza a destra)';
    ui.prompt(`You will ${playerExitTxt(b)}. You have ${signTxt}.`, 'Set your blinker. When you reach the line, press GO at the right moment.');
    ui.feedback(`<span class="it">Keys: ← / → blinker, ↓ blinker off, Space = GO. Hints show red rings on vehicles you must give way to and green rings on those that must give way to you.</span>`);
    this.renderControls();
  },
  renderControls() {
    const me = W.player, b = me?.manualBlink;
    const canGo_ = this.phase === 'waiting';
    ui.answers([
      { html: '⬅ blinker', key: '←', hot: 'ArrowLeft', cls: b === 'L' ? 'on' : '', fn: () => this.setBlink('L') },
      { html: 'off', key: '↓', hot: 'ArrowDown', cls: (b === null && this.blinkTouched) ? 'on' : '', fn: () => this.setBlink(null) },
      { html: 'blinker ➡', key: '→', hot: 'ArrowRight', cls: b === 'R' ? 'on' : '', fn: () => this.setBlink('R') },
      this.phase === 'done' ? { html: 'Next ▸', key: 'space', hot: ' ', cls: 'go', fn: () => this.newRound() }
        : { html: this.phase === 'approach' ? (this.queuePos() > 1 ? `in queue (#${this.queuePos()})` : 'approaching…') : 'GO', key: 'space', hot: ' ', cls: 'go', disabled: !canGo_, fn: () => this.go() },
    ]);
  },
  queuePos() { const me = W.player; if (!me) return 0; return 1 + W.vehicles.filter(o => o !== me && o.arm === S_ && !o.committed && o.s > me.s).length; },
  setBlink(b) { const me = W.player; if (!me || this.phase === 'done' || me.committed) return; me.manualBlink = b; this.blinkTouched = true; this.renderControls(); },
  key(k) {
    if (k === 'ArrowLeft') this.setBlink('L'); else if (k === 'ArrowRight') this.setBlink('R'); else if (k === 'ArrowDown') this.setBlink(null);
    else if (k === ' ' || k === 'Enter') { if (this.phase === 'waiting') this.go(); else if (this.phase === 'done') this.newRound(); }
  },
  verdictNow() {
    const me = W.player; const r = canGo(me, true);
    if (r.ok) return { v: 'good', r };
    if (isDeadlocked(me)) return { v: 'good', r, deadlock: true };
    return { v: r.reasons.some(x => x.sev === 'bad') ? 'bad' : 'tight', r };
  },
  go() {
    const me = W.player; if (this.phase !== 'waiting') return;
    const vd = this.verdictNow();
    this.r = { ...this.r, verdict: vd.v, reasons: vd.r.reasons, deadlock: vd.deadlock, blinkAtGo: me.manualBlink, stopShort: !W.J.lights && W.J.signs[S_] === 'stop' && me.stopT < 1.0, wait: this.waitT };
    if (this.okRun > 3) this.r.missed = (this.r.missed || 0) + 1;
    me.committed = true; me.stopAt = null; this.phase = 'driving';
    const bad = vd.v === 'bad' || this.r.stopShort;
    if (bad) { ui.flash('✗ Not your turn!', 'bad'); for (const x of vd.r.reasons) if (x.o) setRing(x.o, '#ff3b30'); }
    else if (vd.v === 'tight') { ui.flash('⚠ Risky: you took priority', 'warn'); for (const x of vd.r.reasons) if (x.o) setRing(x.o, '#ff9f0a'); }
    else ui.flash(vd.deadlock ? '✓ Deadlock resolved' : '✓ Your turn: good', 'ok', 800);
    stats.m3[bad ? 'bad' : vd.v]++; stats.m3.n++; saveStats();
    ui.prompt('Drive through… (the car steers itself and still stops for pedestrians)');
    this.renderControls();
  },
  update(dt) {
    step(dt);
    const me = W.player;
    const hints = ui.hints();
    if (!me) return;
    if (this.phase === 'approach') {
      if (isFront(me) && me.v < 0.2 && Math.abs(me.s - stopPos(me)) < 0.6) { this.phase = 'waiting'; this.waitT = 0; this.renderControls(); ui.prompt('At the line. Look around: <b>GO</b> (Space) when it’s your turn.', 'Use ◀ look / look ▶ or drag to look around in Behind/Driver view.'); }
      else if (Math.random() < 0.05) this.renderControls();
    }
    let vd = null;
    if (this.phase === 'waiting') {
      this.waitT += dt;
      vd = this.verdictNow();
      if (vd.v === 'good') this.okRun += dt;
      else { if (this.okRun > 3) { this.r.missed = (this.r.missed || 0) + 1; stats.m3.missed++; saveStats(); ui.flash('You missed your turn', 'warn', 900); } this.okRun = 0; }
    }
    // hint rings
    if (this.phase === 'waiting' || this.phase === 'approach') {
      const red = new Set(), green = new Set();
      if (hints && (this.phase === 'waiting' || distToLine(me) < 25)) {
        const r = vd?.r ?? canGo(me, true);
        for (const x of r.reasons) if (x.o) red.add(x.o);
        for (const o of W.vehicles) { if (o === me || o.committed || red.has(o) || cleared(o) || !pathsConflict(me.path, o.path) || distToLine(o) > 30) continue; if (priorityOver(o, me)) green.add(o); }
      }
      for (const e of [...W.vehicles, ...W.peds]) { if (e === me) continue; setRing(e, red.has(e) ? '#ff3b30' : green.has(e) ? '#34c759' : null); }
    }
    if (this.phase === 'driving' && cleared(me) && me.s > me.path.s.out + 14) this.finish();
  },
  finish() {
    this.phase = 'done'; const r = this.r, me = W.player;
    for (const e of [...W.vehicles, ...W.peds]) if (e !== me) setRing(e, null);
    const items = [];
    if (r.stopShort) items.push(`<li class="bad">✗ STOP sign: you didn't stop long enough. Wheels completely still, count to two.</li>`);
    if (r.verdict === 'good') items.push(`<li class="ok">✓ ${r.deadlock ? 'Deadlock: everyone had someone on their right. Someone has to go, and you made a clear, careful move.' : 'You went when it was your turn.'}${r.wait > 8 ? ` (You waited ${r.wait.toFixed(0)} s at the line.)` : ''}</li>`);
    else {
      const cls = r.verdict === 'bad' ? 'bad' : 'warn';
      items.push(`<li class="${cls}">${r.verdict === 'bad' ? '✗ It was not your turn.' : '⚠ Risky: legally it was not your turn yet, although the other vehicle was still a few seconds away.'}</li>`);
      for (const x of r.reasons.slice(0, 3)) items.push(`<li class="${cls}">${cap(reasonText({ ...me, isPlayer: true }, x))}.</li>`);
    }
    if (r.missed) items.push(`<li class="warn">⚠ You let ${r.missed} chance${r.missed > 1 ? 's' : ''} go by when it was your turn. At the exam, too much hesitation is also an error.</li>`);
    const want = { 1: 'R', 2: null, 3: 'L' }[me.turn];
    items.push(r.blinkAtGo === want ? `<li class="ok">✓ Blinker: ${blinkTxt(want)}.</li>` : `<li class="bad">✗ Blinker: you had <b>${blinkTxt(r.blinkAtGo)}</b>, but ${TURN_TXT[me.turn]} needs <b>${blinkTxt(want)}</b>.</li>`);
    ui.feedback(`<h3>Round summary</h3><ul>${items.join('')}</ul>`);
    ui.prompt('Round finished. <b>Next</b> (Space) for a new junction.');
    me.manualBlink = undefined;
    this.renderControls();
  },
};

// =================================================================== 4 · ROUNDABOUT LIVE
const EXIT_NAME = { 1: '1st exit, to the <b>right</b>', 2: '2nd exit, <b>straight on</b>', 3: '3rd exit, to the <b>left</b>' };
export const M4 = {
  id: 'm4', defaultView: 'chase',
  start() { this.newRound(); },
  newRound() {
    newScene(roundaboutJunction({ pZebra: 0.55 }));
    const level = ui.traffic();
    enableSpawning({ level, arms: [E_, N_, W_], peds: 0.8, amb: 0.4 });
    W.spawn.maxQueue = 4;
    prewarm(20);
    const t = wpick([[1, 2], [2, 2], [3, 1.6]]); this.exitTurn = t;
    const me = addVehicle(S_, t, 'car', { player: true, s: 18, v: 8 });
    me.manualBlink = null; me.stopAt = stopPos(me);
    this.phase = 'approach'; this.okRun = 0; this.r = {}; this.checkedPrev = false; this.checkedExit = false; this.blinkTouched = false;
    R.view.autoYaw = 0.55;
    ui.prompt(`Your exit: ${EXIT_NAME[t]}. Set your blinker, then press <b>GO</b> when it's safe.`, 'Give way to vehicles already in the roundabout (from your left).');
    ui.feedback(`<span class="it">Keys: ← / → blinker, ↓ off, Space = GO. Hints: red = will pass in front of you, green = leaving before it reaches you.</span>`);
    this.renderControls();
  },
  renderControls: M3.renderControls,
  queuePos() { return 1; },
  setBlink(b) { const me = W.player; if (!me || this.phase === 'done') return; me.manualBlink = b; this.blinkTouched = true; this.renderControls(); },
  key(k) {
    if (k === 'ArrowLeft') this.setBlink('L'); else if (k === 'ArrowRight') this.setBlink('R'); else if (k === 'ArrowDown') this.setBlink(null);
    else if (k === ' ' || k === 'Enter') { if (this.phase === 'waiting') this.go(); else if (this.phase === 'done') this.newRound(); }
  },
  judge() {
    const me = W.player, w = entryThreat(S_, me);
    const amb = W.vehicles.find(o => o !== me && emergencyComing(o));
    if (amb) return { v: 'bad', w: { o: amb, t: 0, d: 0 }, amb: true };
    if (rbSafe(w)) return { v: rbRoom(S_, me) ? 'good' : 'tight', w, noRoom: !rbRoom(S_, me) };
    return { v: (w.t >= 2.4 && w.d >= 6) ? 'tight' : 'bad', w };
  },
  go() {
    const me = W.player; if (this.phase !== 'waiting') return;
    const j = this.judge();
    Object.assign(this.r, { verdict: j.v, threat: j.w, amb: j.amb, noRoom: j.noRoom, blinkAtEntry: me.manualBlink, wait: this.waitT });
    me.committed = true; me.stopAt = null; this.phase = 'driving'; R.view.autoYaw = 0;
    if (j.v === 'bad') { ui.flash(j.amb ? '✗ Ambulance!' : '✗ You cut it off!', 'bad'); if (j.w?.o) setRing(j.w.o, '#ff3b30'); }
    else if (j.v === 'tight') { ui.flash('⚠ Tight', 'warn'); if (j.w?.o) setRing(j.w.o, '#ff9f0a'); }
    else ui.flash('✓ Safe entry', 'ok', 700);
    stats.m4[j.v]++; stats.m4.n++; saveStats();
    ui.prompt(this.exitTurn === 1 ? 'Keep the ➡ right blinker on until you exit.' : 'Drive to your exit. Switch to <b>➡ right</b> only <b>after</b> passing the exit before yours.');
    this.renderControls();
  },
  update(dt) {
    step(dt);
    const me = W.player, hints = ui.hints();
    for (const c of W.vehicles) {
      if (c === me) continue;
      if (this.phase !== 'approach' && this.phase !== 'waiting') { if (c.ringColor === '#34c759' || c.ringColor === '#ff3b30' && !this.r.verdict) setRing(c, null); continue; }
      if (!hints || !c.committed) { setRing(c, null); continue; }
      const sp = c.path.pass[S_];
      if (sp !== undefined && frontS(c) < sp + 2 && sp - frontS(c) < 40) setRing(c, '#ff3b30');
      else if (c.path.b === S_ && c.s > c.path.s.merge - 3 && c.s < c.path.s.out && c.path.s.exit - c.s < 32) setRing(c, '#34c759');
      else setRing(c, null);
    }
    for (const p of W.peds) setRing(p, null);
    if (!me) return;
    if (this.phase === 'approach' && isFront(me) && me.v < 0.2 && Math.abs(me.s - stopPos(me)) < 0.6) { this.phase = 'waiting'; this.waitT = 0; this.renderControls(); }
    if (this.phase === 'waiting') {
      this.waitT += dt;
      if (this.judge().v === 'good') this.okRun += dt;
      else { if (this.okRun > 2.5) { this.r.missed = (this.r.missed || 0) + 1; stats.m4.missed++; saveStats(); ui.flash('Missed a safe gap', 'warn', 900); } this.okRun = 0; }
    }
    if (this.phase === 'driving') {
      const P = me.path;
      if (P.s.prevExit !== undefined && !this.checkedPrev && me.s >= P.s.prevExit - 3) { this.checkedPrev = true; this.r.earlyRight = me.manualBlink === 'R'; }
      if (!this.checkedExit && me.s >= P.s.exit - 1) { this.checkedExit = true; this.r.exitBlink = me.manualBlink; }
      if (me.s >= P.s.out + 12) this.finish();
    }
  },
  finish() {
    this.phase = 'done'; const r = this.r, me = W.player;
    for (const c of W.vehicles) if (c !== me) setRing(c, null);
    const want = { 1: 'R', 2: null, 3: 'L' }[this.exitTurn];
    const items = [];
    if (r.verdict === 'good') items.push(`<li class="ok">✓ Safe entry: nobody had to brake for you${r.wait > 8 ? `, though you waited ${r.wait.toFixed(0)} s` : ''}.</li>`);
    else if (r.amb) items.push(`<li class="bad">✗ An ambulance with its siren on was coming. Wait and let it through.</li>`);
    else if (r.noRoom && r.verdict === 'tight') items.push(`<li class="warn">⚠ The roundabout right after your entry was jammed. Don't enter until there's room to keep moving.</li>`);
    else {
      const o = r.threat.o, bl = o.blink, passedExit = o.path.b !== S_;
      let why = `A vehicle already in the roundabout reached your entry ${r.threat.t < 0.1 ? 'right then' : `in about ${r.threat.t.toFixed(1)} s`}.`;
      if (bl === 'R' && passedExit) why += ' It <b>was</b> signalling right, but for the <b>next</b> exit. It had already passed your road’s exit.';
      else if (bl === 'L') why += ' It had its <b>left</b> blinker on, so it was staying in.';
      else if (!bl) why += ' It had <b>no blinker</b>, so it wasn’t leaving before you.';
      items.push(`<li class="${r.verdict === 'bad' ? 'bad' : 'warn'}">${r.verdict === 'bad' ? '✗ Unsafe: you forced it to brake.' : '⚠ Tight: the vehicle behind had to slow down.'} ${why}</li>`);
    }
    if (r.missed) items.push(`<li class="warn">⚠ You let ${r.missed} safe gap${r.missed > 1 ? 's' : ''} go by. Too much hesitation is also an exam error.</li>`);
    items.push(r.blinkAtEntry === want ? `<li class="ok">✓ Entry blinker: ${blinkTxt(want)}.</li>` : `<li class="bad">✗ Entry blinker: you had <b>${blinkTxt(r.blinkAtEntry)}</b>, expected <b>${blinkTxt(want)}</b>.</li>`);
    if (this.exitTurn !== 1) {
      if (r.earlyRight) items.push(`<li class="bad">✗ Right blinker too early: drivers waiting at the previous entry would think you were leaving.</li>`);
      if (r.exitBlink === 'R') { if (!r.earlyRight) items.push(`<li class="ok">✓ Right blinker before your exit.</li>`); }
      else items.push(`<li class="bad">✗ No right blinker when you exited.</li>`);
    } else if (r.exitBlink !== 'R') items.push(`<li class="bad">✗ Keep the right blinker on until you've exited.</li>`);
    ui.feedback(`<h3>Round summary</h3><ul>${items.join('')}</ul>`);
    ui.prompt('Round finished. <b>Next</b> (Space) for another entry.');
    me.manualBlink = undefined;
    this.renderControls();
  },
};
