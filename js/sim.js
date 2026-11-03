// Traffic simulation + Italian right-of-way rule engine.
import { S_, E_, N_, W_, OUT, HW, ZEB, RB, interPath, rbPath, pathsConflict, turnOf, armWorld } from './geo.js';

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = a => a[Math.floor(Math.random() * a.length)];
export function wpick(items) { let t = items.reduce((s, i) => s + i[1], 0) * Math.random(); for (const [v, w] of items) { if ((t -= w) <= 0) return v; } return items[0][0]; }

export const VTYPES = {
  car:   { L: 4.1, W: 1.76, H: 1.45, vmax: 12.5, acc: 2.6 },
  small: { L: 3.6, W: 1.64, H: 1.52, vmax: 12, acc: 2.4 },
  van:   { L: 5.0, W: 1.98, H: 2.25, vmax: 11, acc: 2.0 },
  bus:   { L: 11,  W: 2.5,  H: 3.1, vmax: 10, acc: 1.3 },
  moto:  { L: 2.1, W: 0.8,  H: 1.45, vmax: 13, acc: 3.4 },
  amb:   { L: 5.4, W: 2.05, H: 2.55, vmax: 14, acc: 3.0 },
};
export const TYPE_NAME = { car: 'car', small: 'car', van: 'van', bus: 'bus', moto: 'scooter', amb: 'ambulance' };

export const W = {
  J: null, kind: 'inter', vehicles: [], peds: [], t: 0, idSeq: 1, lights: null, player: null,
  spawn: null, scripted: false, frozen: false, lightsFrozen: false,
};

// ------------------------------------------------------------------ scene
export function randomJunction(opts = {}) {
  const r = Math.random();
  const isT = r < (opts.pT ?? 0.35);
  const arms = [true, true, true, true]; let missing = -1;
  if (isT) { missing = pick([E_, N_, W_]); arms[missing] = false; }
  const signs = ['none', 'none', 'none', 'none'];
  const lights = opts.lights ?? (Math.random() < (opts.pLights ?? 0.2));
  if (!lights && Math.random() < (opts.pSigned ?? 0.55)) {
    const mainNS = isT ? missing !== N_ : Math.random() < 0.5;
    const minor = pick(['yield', 'stop', 'yield']);
    for (let a = 0; a < 4; a++) {
      if (!arms[a]) continue;
      const onMain = mainNS ? (a === S_ || a === N_) : (a === E_ || a === W_);
      signs[a] = onMain ? 'priority' : (Math.random() < 0.8 ? minor : pick(['yield', 'stop']));
    }
  }
  const zebra = arms.map(a => a && Math.random() < (opts.pZebra ?? 0.6));
  return { type: isT ? 'T' : 'cross', arms, signs, lights, zebra, missing, signed: signs.some(s => s !== 'none') };
}
export function roundaboutJunction(opts = {}) {
  return { type: 'rb', arms: [true, true, true, true], signs: ['yield', 'yield', 'yield', 'yield'], lights: false, zebra: [0, 1, 2, 3].map(() => Math.random() < (opts.pZebra ?? 0.6)), missing: -1, signed: true };
}

export function setScene(J) {
  W.J = J; W.kind = J.type === 'rb' ? 'rb' : 'inter';
  W.vehicles = []; W.peds = []; W.player = null; W.t = 0; W.scripted = false; W.frozen = false; W.lightsFrozen = false;
  W.lights = J.lights ? { axis: Math.random() < 0.5 ? 0 : 1, stage: 'G', t: rand(0, 8) } : null;
  W.spawn = null;
}
export const pathFor = (a, b) => W.kind === 'rb' ? rbPath(a, b) : interPath(a, b);
export const validExits = a => [0, 1, 2, 3].filter(b => b !== a && W.J.arms[b]);

// ------------------------------------------------------------------ vehicles
export function addVehicle(a, b, type = 'car', o = {}) {
  const T = VTYPES[type], path = pathFor(a, b);
  const v = {
    id: W.idSeq++, type, ...T, path, arm: a, exit: b, turn: path.turn,
    s: o.s ?? 0, v: o.v ?? Math.min(T.vmax, 10), stopAt: null, committed: false,
    isPlayer: !!o.player, passive: !!o.passive, name: o.name || 'a car', color: o.color,
    emergency: type === 'amb', stopT: 0, waitT: 0, manualBlink: undefined, mesh: null, gone: false,
    zebras: path.zebras.filter(z => W.J.zebra[z.arm]), phase: Math.random() * 0.6, circ: [],
  };
  if (o.stopped) { v.s = stopPos(v); v.v = 0; v.stopAt = v.s; }
  W.vehicles.push(v);
  if (v.isPlayer) W.player = v;
  sync(v);
  return v;
}
export const stopPos = v => v.path.s.in - v.L / 2 - 0.35;
export const frontS = v => v.s + v.L / 2;
export const cleared = v => W.kind === 'rb' ? (v.s - v.L / 2 > v.path.s.out) : (v.s - v.L / 2 > v.path.s.out + 0.5);
export function sync(v) {
  const p = v.path.at(v.s), a = v.path.at(v.s - 0.9), b = v.path.at(v.s + 0.9);
  let dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
  v.x = p.x; v.z = p.z; v.dx = dx; v.dz = dz;
  const n = Math.max(1, Math.round(v.L / (v.W * 1.25))), r = v.W / 2 + 0.05;
  v.circ.length = 0;
  for (let i = 0; i < n; i++) {
    const off = n === 1 ? 0 : -v.L / 2 + r + (v.L - 2 * r) * i / (n - 1);
    const q = v.path.at(v.s + off); v.circ.push([q.x, q.z, r]);
  }
}
// blinker logic (what an honest driver shows)
export function blinkOf(v) {
  if (v.manualBlink !== undefined) return v.manualBlink;
  const P = v.path, s = v.s;
  if (P.kind === 'inter') { if (s > P.s.out + 4) return null; return P.turn === 1 ? 'R' : P.turn === 3 ? 'L' : null; }
  if (s > P.s.out + 6) return null;
  if (s >= P.s.exit || P.turn === 1) return 'R';
  if (P.s.prevExit !== undefined && s >= P.s.prevExit) return 'R';
  return P.turn === 2 ? null : 'L';
}
export function leaderUncommitted(v) {
  for (const o of W.vehicles) if (o !== v && !o.gone && o.arm === v.arm && !o.committed && o.s > v.s) return o;
  return null;
}
export const isFront = v => !W.vehicles.some(o => o !== v && !o.gone && o.arm === v.arm && !o.committed && o.s > v.s);

// ------------------------------------------------------------------ lights
const LT = { G: 13, A: 3, AR: 2 };
export function lightOf(arm) {
  const L = W.lights; if (!L) return null;
  if (L.stage === 'AR') return 'R';
  return (arm % 2) === L.axis ? (L.stage === 'G' ? 'G' : 'A') : 'R';
}
function stepLights(dt) {
  const L = W.lights; if (!L || W.lightsFrozen) return;
  L.t += dt;
  if (L.stage === 'G' && L.t > LT.G) { L.stage = 'A'; L.t = 0; }
  else if (L.stage === 'A' && L.t > LT.A) { L.stage = 'AR'; L.t = 0; }
  else if (L.stage === 'AR' && L.t > LT.AR) { L.stage = 'G'; L.t = 0; L.axis = 1 - L.axis; }
}

// ------------------------------------------------------------------ rules
const RANK = { none: 1, priority: 1, yield: 0, stop: 0 };
// reason code if v must give way to o (paths assumed to conflict), else null
export function priorityOver(v, o) {
  if (o.emergency && !v.emergency) return 'emergency';
  if (v.emergency) return null;
  const rel = (o.arm - v.arm + 4) % 4;
  if (W.J.lights) {
    const lo = lightOf(o.arm), lv = lightOf(v.arm);
    if (lo === 'R') return null;
    if (lv === 'R') return 'red';
    return (rel === 2 && v.turn === 3 && o.turn !== 3) ? 'left' : null;
  }
  const ra = RANK[W.J.signs[v.arm]], rb = RANK[W.J.signs[o.arm]];
  if (ra < rb) return 'sign';
  if (ra > rb) return null;
  if (rel === 1) return 'right';
  if (rel === 2 && v.turn === 3 && o.turn !== 3) return 'left';
  return null;
}
const pedActive = p => p.state === 'crossing' || (p.state === 'waiting' && p.waitT > 0.3 && pedLightOk(p));
function pedStillAhead(p, z) { // has the pedestrian not yet passed the lane this zebra span is on?
  if (p.state === 'waiting') return true;
  return (p.lat - z.lat) * p.dir < 1.6;
}
export function distToLine(o) { return o.path.s.in - frontS(o); }

// Can intersection vehicle v legally go now? Returns all reasons it must wait.
export function canGo(v, all = false) {
  const J = W.J, R = [];
  const add = (code, o = null, sev = 'bad') => { R.push({ code, o, sev }); return !all; };
  const done = () => ({ ok: R.length === 0, reasons: R });
  const dLine = distToLine(v);
  if (J.lights && !v.emergency) {
    const c = lightOf(v.arm);
    if (c === 'R' && add('red')) return done();
    if (c === 'A' && dLine > v.v * v.v / 8 + 0.5 && add('amber')) return done();
  }
  if (!v.emergency) for (const o of W.vehicles) {
    if (o !== v && emergencyComing(o)) { if (add('emergency', o)) return done(); }
  }
  if (!J.lights && J.signs[v.arm] === 'stop' && v.stopT < 1.0 && !v.emergency && !v.isPlayer) { if (add('stop')) return done(); }
  for (const o of W.vehicles) {
    if (o === v || o.gone || o.passive || o.arm === v.arm || cleared(o)) continue;
    if (o.emergency) continue; // handled above
    if (!pathsConflict(v.path, o.path)) continue;
    if (o.committed) { if (add('inside', o)) return done(); continue; }
    if (!isFront(o)) continue;
    const dO = distToLine(o), eta = dO <= 0.8 ? 0 : dO / Math.max(o.v, 1.5);
    if (dO > 45 || eta > 5) continue;
    if (J.lights && lightOf(o.arm) === 'A' && dO > o.v * o.v / 8 + 0.5) continue; // it will stop on amber
    const code = priorityOver(v, o);
    if (code && code !== 'red') { if (add(code, o, eta > 2.6 ? 'tight' : 'bad')) return done(); }
  }
  for (const z of v.zebras) {
    if (frontS(v) > z.s0 + 0.3) continue;
    for (const p of W.peds) if (p.arm === z.arm && pedActive(p) && pedStillAhead(p, z)) { if (add('ped', p)) return done(); }
  }
  return done();
}
const PRIO_CODES = new Set(['right', 'left', 'sign']);
function stuck(v) { return !v.committed && isFront(v) && v.v < 0.15 && distToLine(v) < 1.2 && v.waitT > 2.5; }
export function isDeadlocked(v) { // every reason is a priority car that is itself stuck only on priority cars
  const r = canGo(v, true);
  if (r.ok || !r.reasons.every(x => PRIO_CODES.has(x.code) && x.o && stuck(x.o))) return false;
  return r.reasons.every(x => { const rr = canGo(x.o, true); return !rr.ok && rr.reasons.every(y => PRIO_CODES.has(y.code)); });
}

// roundabout: worst incoming car for an entry
export function entryThreat(arm, self) {
  let worst = null;
  for (const o of W.vehicles) {
    if (o === self || o.gone || !o.committed || o.passive) continue;
    const sp = o.path.pass?.[arm]; if (sp === undefined) continue;
    const d = sp - frontS(o); if (d < -(o.L + 2.5)) continue;
    const t = d <= 0 ? 0 : d / Math.max(o.v, 4);
    if (!worst || t < worst.t) worst = { o, t, d };
  }
  return worst;
}
export const rbSafe = w => !w || (w.t >= 3.2 && w.d >= 8);
// is there room to enter? (no stopped car just past our merge point)
export function rbRoom(arm, self) {
  for (const o of W.vehicles) {
    if (o === self || o.gone || !o.committed) continue;
    const sp = o.path.pass?.[arm]; if (sp === undefined || o.s - o.L / 2 < sp - 1) continue;
    if (o.s - o.L / 2 - sp < 7 && o.v < 2) return false;
  }
  return true;
}
// an ambulance that is actually coming through (not stuck behind other cars)
export function emergencyComing(o) { return o.emergency && !o.gone && !cleared(o) && distToLine(o) < 60 && !leaderUncommitted(o); }
function emergencyNear(v) { return W.vehicles.some(o => o !== v && emergencyComing(o)); }

// ------------------------------------------------------------------ AI decisions
function decide(v, dt) {
  if (v.isPlayer || v.passive || W.scripted) return;
  if (v.committed) {
    // keep re-checking until the line: if things changed and we can still stop, stop.
    const d = distToLine(v);
    if (v.emergency || v.courtesy || d < 0.5 || d < v.v * v.v / (2 * 5)) return;
    const ok = W.kind === 'rb' ? (!emergencyNear(v) && rbSafe(entryThreat(v.arm, v))) : canGo(v).ok;
    if (!ok) { v.committed = false; v.stopAt = stopPos(v); }
    return;
  }
  if (leaderUncommitted(v)) { v.stopAt = stopPos(v); return; }
  const dLine = distToLine(v), dd = Math.max(7, v.v * v.v / (2 * 2.2) + 3);
  if (dLine > dd) { v.stopAt = null; return; }
  let ok;
  if (W.kind === 'rb') ok = v.emergency || (!emergencyNear(v) && rbSafe(entryThreat(v.arm, v)) && rbRoom(v.arm, v));
  else {
    ok = canGo(v).ok;
    if (!ok && v.waitT > 4 && isDeadlocked(v)) {
      // deadlock: drivers sort it out by gesture. The longest-waiting non-player goes.
      const cands = W.vehicles.filter(o => !o.isPlayer && stuck(o) && isDeadlocked(o));
      if (cands.length && cands.reduce((a, b) => (b.waitT > a.waitT ? b : a)) === v) { ok = true; v.courtesy = W.t; }
    }
  }
  if (ok) { v.committed = true; v.stopAt = null; } else v.stopAt = stopPos(v);
}

// ------------------------------------------------------------------ motion
function obstacleAhead(v) {
  const look = Math.min(45, 6 + v.v * 2.6);
  const base = v.s + v.L / 2 - v.W / 2;
  let best = Infinity, who = null;
  for (const o of W.vehicles) {
    if (o === v || o.gone) continue;
    if (Math.hypot(o.x - v.x, o.z - v.z) > look + o.L / 2 + v.L / 2 + 3) continue;
    if (o.blocker === v && v.id < o.id && v.v < 0.5 && o.v < 0.5) continue; // break mutual blocks
    for (let k = 0; k <= look && k < best; k += 0.9) {
      const p = v.path.at(base + k);
      let hit = false;
      for (const c of o.circ) { const rr = v.W / 2 + c[2] + 0.25; if ((p.x - c[0]) ** 2 + (p.z - c[1]) ** 2 < rr * rr) { hit = true; break; } }
      if (hit) { if (k < best) { best = k; who = o; } break; }
    }
  }
  // pedestrians physically in front of us (safety net)
  for (const p of W.peds) {
    if (p.state !== 'crossing' || Math.hypot(p.x - v.x, p.z - v.z) > look + v.L) continue;
    for (let k = 0; k <= look && k < best; k += 0.9) {
      const q = v.path.at(base + k), rr = v.W / 2 + 0.7;
      if ((q.x - p.x) ** 2 + (q.z - p.z) ** 2 < rr * rr) { if (k < best) { best = k; who = p; } break; }
    }
  }
  // pedestrians on zebras ahead
  const fs = frontS(v);
  for (const z of v.zebras) {
    const d = z.s0 - fs;
    if (d < -0.4 || d > look) continue;
    const canStop = d > v.v * v.v / (2 * 6.5) - 0.6;
    if (!canStop) continue;
    for (const p of W.peds) if (p.arm === z.arm && pedActive(p) && pedStillAhead(p, z)) { const k = Math.max(0, d - 0.4); if (k < best) { best = k; who = p; } break; }
  }
  return { d: best, who };
}

function move(v, dt) {
  if (W.frozen) return;
  let vt = Math.min(v.vmax, v.path.vlim(v.s) * (v.emergency ? 1.15 : 1) * (v.type === 'bus' ? 0.85 : 1));
  if (v.stopAt != null) { const d = v.stopAt - v.s; vt = Math.min(vt, d <= 0.05 ? 0 : Math.sqrt(2 * 3.2 * d)); }
  const ob = obstacleAhead(v); v.blocker = ob.who;
  if (ob.d < Infinity) {
    let free = ob.d - 0.9;
    // never queue on a zebra crossing: stop before it if we would end up standing on it
    if (!ob.who?.isPed) {
      const fs = frontS(v), fEnd = fs + Math.max(0, free);
      for (const z of v.zebras) if (fs < z.s0 - 0.2 && fEnd > z.s0 - 0.4 && fEnd - v.L < z.s1 + 0.4) free = Math.min(free, z.s0 - 0.6 - fs);
    }
    vt = Math.min(vt, free <= 0 ? 0 : Math.sqrt(2 * 4.5 * free));
  }
  if (v.v < vt) { v.v = Math.min(vt, v.v + v.acc * dt); v.braking = false; v.hardBrake = 0; }
  else { const nv = Math.max(vt, v.v - 9 * dt); const dec = (v.v - nv) / dt; v.braking = dec > 1.0; v.hardBrake = dec > 4.5 ? dec : 0; v.v = nv; }
  if (v.v < 0.2) v.braking = true;
  const ps = v.s;
  v.s += v.v * dt;
  if (v.stopAt != null && v.s > v.stopAt && ps <= v.stopAt) v.s = v.stopAt;
  const atLine = !v.committed && v.v < 0.15 && Math.abs(stopPos(v) - v.s) < 1.2;
  v.stopT = atLine ? v.stopT + dt : 0;
  v.waitT = (!v.committed && v.v < 0.15) ? v.waitT + dt : (v.committed ? 0 : v.waitT);
  v.stillT = v.v < 0.15 ? (v.stillT || 0) + dt : 0;
  sync(v);
  if (v.s > v.path.len - 1) v.gone = true;
}

// ------------------------------------------------------------------ pedestrians
export function addPed(arm, o = {}) {
  const band = W.kind === 'rb' ? RB.zeb : ZEB;
  const dir = o.dir ?? (Math.random() < 0.5 ? 1 : -1);
  const p = {
    id: W.idSeq++, arm, dir, s: (band[0] + band[1]) / 2 + rand(-0.6, 0.6), lat: o.lat ?? -dir * (HW + 1.3),
    state: o.state || 'waiting', waitT: 0, speed: rand(1.15, 1.55), leaveT: 0, mesh: null, gone: false, walkPhase: Math.random() * 6,
    shirt: o.shirt, isPed: true, name: o.name || 'a pedestrian',
  };
  syncPed(p); W.peds.push(p); return p;
}
function syncPed(p) { const [x, z] = armWorld(p.arm, p.s, p.lat); p.x = x; p.z = z; }
function pedLightOk(p) {
  const L = W.lights; if (!L) return true;
  return lightOf(p.arm) === 'R' && L.stage === 'G' && L.axis !== p.arm % 2 && L.t < LT.G - 6;
}
function pedCanStart(p) {
  if (!pedLightOk(p)) return false;
  for (const v of W.vehicles) {
    if (v.gone) continue;
    for (const z of v.zebras) {
      if (z.arm !== p.arm) continue;
      const fs = frontS(v), rear = v.s - v.L / 2;
      if (fs > z.s0 - 0.2 && rear < z.s1 + 0.2 && v.v > 0.3) return false; // moving over the crossing
      const d = z.s0 - fs;
      if (d > 0 && d < v.v * v.v / (2 * 5) + 2 && v.v > 1) return false; // too close to stop
    }
  }
  return true;
}
function stepPed(p, dt) {
  if (W.frozen) return;
  if (p.state === 'waiting') { p.waitT += dt; if (!W.scripted && p.waitT > 0.6 && pedCanStart(p)) p.state = 'crossing'; }
  else if (p.state === 'crossing') { p.lat += p.dir * p.speed * dt; p.walkPhase += dt * 9; if (p.lat * p.dir >= HW + 1.3) { p.state = 'leaving'; } }
  else if (p.state === 'leaving') { p.s += p.speed * dt; p.walkPhase += dt * 9; p.leaveT += dt; if (p.leaveT > 9) p.gone = true; }
  syncPed(p);
}

// ------------------------------------------------------------------ spawning
const TRAFFIC = { 1: [7, 12], 2: [3.8, 7.5], 3: [2.0, 4.0] };
export function enableSpawning(o) {
  W.spawn = { level: o.level ?? 2, arms: o.arms, peds: o.peds ?? 1, amb: o.amb ?? 0.35, t: [0, 1, 2, 3].map(() => rand(0, 3)), pedT: rand(2, 6), ambT: rand(25, 60) };
}
export function randomType() { return wpick([['car', 62], ['small', 14], ['van', 10], ['moto', 9], ['bus', 3.5]]); }
export function randomExit(a) {
  const ex = validExits(a);
  if (W.kind === 'rb') return Math.random() < 0.04 ? a : pick(ex);
  return wpick(ex.map(b => [b, turnOf(a, b) === 2 ? 1.5 : 1]));
}
export function trySpawn(a, type, exit) {
  const P = pathFor(a, exit), T = VTYPES[type];
  for (const o of W.vehicles) if (o.arm === a && !o.gone && o.s - o.L / 2 < T.L + 8) return null;
  return addVehicle(a, exit, type, { s: 0, v: Math.min(T.vmax, 10.5) });
}
function stepSpawn(dt) {
  const S = W.spawn; if (!S) return;
  const [g0, g1] = TRAFFIC[S.level];
  for (const a of S.arms) {
    S.t[a] -= dt;
    if (S.t[a] <= 0) { S.t[a] = rand(g0, g1); if (W.vehicles.filter(o => o.arm === a && !o.committed).length < (S.maxQueue ?? 5)) trySpawn(a, randomType(), randomExit(a)); }
  }
  S.ambT -= dt;
  if (S.ambT <= 0) {
    S.ambT = rand(40, 90) / Math.max(0.05, S.amb);
    if (S.amb > 0) { const a = pick(S.arms); trySpawn(a, 'amb', randomExit(a)); }
  }
  if (S.peds > 0 && W.J.zebra.some(Boolean)) {
    S.pedT -= dt;
    if (S.pedT <= 0) {
      S.pedT = rand(4, 10) / S.peds;
      const arms = [0, 1, 2, 3].filter(k => W.J.zebra[k]);
      const k = pick(arms);
      if (W.peds.filter(p => p.arm === k && p.state !== 'leaving').length < 3) addPed(k);
    }
  }
}

// ------------------------------------------------------------------ main step
export function step(dt) {
  W.t += dt;
  stepLights(dt);
  if (!W.frozen) stepSpawn(dt);
  for (const v of W.vehicles) decide(v, dt);
  for (const v of W.vehicles) move(v, dt);
  for (const p of W.peds) stepPed(p, dt);
  W.vehicles = W.vehicles.filter(v => !v.gone);
  W.peds = W.peds.filter(p => !p.gone);
  if (W.player?.gone) W.player = null;
}
