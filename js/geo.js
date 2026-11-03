// Geometry: arms, lanes, vehicle paths through junctions and roundabouts.
// World: x = east, z = south (screen-down in map view). Right-hand traffic.
// Arms: 0 = South (where you come from), 1 = East (your right), 2 = North (ahead), 3 = West (your left).

export const S_ = 0, E_ = 1, N_ = 2, W_ = 3;
export const TAU = Math.PI * 2;
export const OUT = [[0, 1], [1, 0], [0, -1], [-1, 0]];
export const ARM_ANG = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];
export const ARM_ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2]; // canvas rotation that maps the S arm onto arm a
export const LANE = 1.75, HW = 3.5, STOP_R = 10.5, FAR = 70;
export const ZEB = [6.4, 9.4];                 // zebra band (distance from centre) on junction arms
export const RB = { R: 12.5, island: 9.5, outer: 15.5, d: 0.42, yieldR: 17, zeb: [23.2, 26.2] };
export const turnOf = (a, b) => (b - a + 4) % 4; // 1 right, 2 straight, 3 left, 0 U-turn

export function lanePt(a, inbound, s) {
  const [ox, oz] = OUT[a];
  const dx = inbound ? -ox : ox, dz = inbound ? -oz : oz;
  return [ox * s - dz * LANE, oz * s + dx * LANE];
}
// local coordinates along arm a: s = distance from centre, lat = offset to the right of inbound traffic
export function armLocal(a, x, z) { const [ox, oz] = OUT[a]; return { s: x * ox + z * oz, lat: x * oz - z * ox }; }
export function armWorld(a, s, lat) { const [ox, oz] = OUT[a]; return [ox * s + oz * lat, oz * s - ox * lat]; }
function lineIntersect(p, d, q, e) {
  const cr = d[0] * e[1] - d[1] * e[0];
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / cr;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}
export const Cpt = (t, R = RB.R) => [R * Math.cos(t), R * Math.sin(t)];
export const Tan = t => [Math.sin(t), -Math.cos(t)]; // travel direction on the ring (anticlockwise on screen)

export class Path {
  constructor() { this.p = []; this.mk = {}; }
  add(x, z) { const n = this.p.length; if (n) { const q = this.p[n - 1]; if (Math.abs(q[0] - x) + Math.abs(q[1] - z) < 1e-6) return this; } this.p.push([x, z]); return this; }
  line(a, b, step = 0.5) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)); for (let i = 0; i <= n; i++) { const t = i / n; this.add(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); } return this; }
  quad(a, c, b, n = 32) { for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; this.add(u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]); } return this; }
  cubic(a, b, c, d, n = 32) { for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t; this.add(w0 * a[0] + w1 * b[0] + w2 * c[0] + w3 * d[0], w0 * a[1] + w1 * b[1] + w2 * c[1] + w3 * d[1]); } return this; }
  arc(R, t0, t1) { const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) * R / 0.4)); for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n; this.add(R * Math.cos(t), R * Math.sin(t)); } return this; }
  mark(n) { this.mk[n] = this.p.length - 1; return this; }
  done() {
    const c = [0];
    for (let i = 1; i < this.p.length; i++) c.push(c[i - 1] + Math.hypot(this.p[i][0] - this.p[i - 1][0], this.p[i][1] - this.p[i - 1][1]));
    this.cum = c; this.len = c[c.length - 1]; this.s = {};
    for (const k in this.mk) this.s[k] = c[this.mk[k]];
    return this;
  }
  at(s) {
    const p = this.p, c = this.cum; let i;
    if (s <= 0) i = 0; else if (s >= this.len) i = p.length - 2;
    else { let lo = 0, hi = c.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; } i = lo; }
    const a = p[i], b = p[i + 1], L = (c[i + 1] - c[i]) || 1e-6, t = (s - c[i]) / L;
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / L, dz: (b[1] - a[1]) / L };
  }
  closestS(x, z, s0 = 0, s1 = Infinity) {
    let best = { s: 0, d: Infinity };
    for (let i = 0; i < this.p.length; i++) { const s = this.cum[i]; if (s < s0 || s > s1) continue; const d = Math.hypot(this.p[i][0] - x, this.p[i][1] - z); if (d < best.d) best = { s, d }; }
    return best;
  }
}

function zebraSpans(P, band) {
  const spans = [];
  for (let k = 0; k < 4; k++) {
    let s0 = null, s1 = null;
    for (let s = 0; s <= P.len; s += 0.25) {
      const p = P.at(s), l = armLocal(k, p.x, p.z);
      if (l.s >= band[0] && l.s <= band[1] && Math.abs(l.lat) <= HW + 0.2) { if (s0 === null) s0 = s; s1 = s; }
    }
    if (s0 !== null) {
      const mid = P.at((s0 + s1) / 2);
      spans.push({ arm: k, s0, s1, lat: armLocal(k, mid.x, mid.z).lat });
    }
  }
  return spans;
}

const cache = {};
export function interPath(a, b) {
  const key = 'i' + a + b; if (cache[key]) return cache[key];
  const P = new Path(), t = turnOf(a, b);
  const f = lanePt(a, true, FAR), e = lanePt(a, true, STOP_R), x = lanePt(b, false, STOP_R), xf = lanePt(b, false, FAR);
  P.line(f, e).mark('in');
  if (t === 2) P.line(e, x);
  else {
    const c0 = lineIntersect(e, [-OUT[a][0], -OUT[a][1]], x, OUT[b]);
    const k = t === 3 ? 0.6 : 0.72; // left turns pass "to the left of the centre" (art. 154)
    P.quad(e, [c0[0] * k, c0[1] * k], x);
  }
  P.mark('out').line(x, xf).done();
  Object.assign(P, { kind: 'inter', a, b, turn: t, key });
  P.zebras = zebraSpans(P, ZEB);
  P.vlim = s => (t !== 2 && s > P.s.in - 9 && s < P.s.out + 3) ? 6.5 : (s > P.s.in - 4 && s < P.s.out) ? 10 : 12.5;
  return cache[key] = P;
}

export function rbPath(a, b) {
  const key = 'r' + a + b; if (cache[key]) return cache[key];
  const P = new Path();
  const te = ARM_ANG[a] - RB.d; let tx = ARM_ANG[b] + RB.d; while (tx >= te - 0.05) tx -= TAU;
  const f = lanePt(a, true, FAR), y = lanePt(a, true, RB.yieldR), y2 = lanePt(a, true, RB.yieldR - 2);
  const m = Cpt(te), T1 = Tan(te);
  P.line(f, y).mark('yield');
  P.cubic(y, y2, [m[0] - T1[0] * 3, m[1] - T1[1] * 3], m).mark('merge');
  P.arc(RB.R, te, tx).mark('exit');
  const xo = Cpt(tx), T2 = Tan(tx), q = lanePt(b, false, RB.yieldR), q2 = lanePt(b, false, RB.yieldR - 2);
  P.cubic(xo, [xo[0] + T2[0] * 3, xo[1] + T2[1] * 3], q2, q).mark('out');
  P.line(q, lanePt(b, false, FAR)).done();
  Object.assign(P, { kind: 'rb', a, b, turn: turnOf(a, b), key });
  P.s.in = P.s.yield;
  P.pass = {};
  for (let k = 0; k < 4; k++) {
    const mk = Cpt(ARM_ANG[k] - RB.d);
    const r = P.closestS(mk[0], mk[1], P.s.merge - 0.5, P.s.exit + 0.5);
    if (r.d < 0.6) P.pass[k] = r.s;
  }
  const prev = (b + 3) % 4, px = Cpt(ARM_ANG[prev] + RB.d);
  const r = P.closestS(px[0], px[1], P.s.merge + 0.5, P.s.exit - 0.5);
  if (r.d < 0.6) P.s.prevExit = r.s;
  P.zebras = zebraSpans(P, RB.zeb);
  P.vlim = s => (s > P.s.merge - 6 && s < P.s.out + 1) ? 8 : 12.5;
  return cache[key] = P;
}

// do two junction paths cross / merge inside the junction?
export function pathsConflict(P, Q) {
  if (P.a === Q.a) return false;
  const key = 'c' + P.key + Q.key;
  if (key in cache) return cache[key];
  let hit = false;
  outer: for (let s = P.s.in; s <= P.s.out + 3; s += 0.4) {
    const p = P.at(s);
    for (let u = Q.s.in; u <= Q.s.out + 3; u += 0.4) { const q = Q.at(u); if ((p.x - q.x) ** 2 + (p.z - q.z) ** 2 < 2.3 * 2.3) { hit = true; break outer; } }
  }
  return cache[key] = hit;
}
