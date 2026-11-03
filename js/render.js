// Rendering: scene, environment (Italian town), vehicles, pedestrians, cameras, overlays.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { S_, OUT, ARM_ANG, ARM_ROT, HW, LANE, STOP_R, ZEB, RB, FAR, TAU, armWorld, Cpt } from './geo.js';
import { W, blinkOf, lightOf, rand, pick } from './sim.js';

const MOBILE = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
export const R = { view: { mode: 'map', userYaw: 0, autoYaw: 0, yawS: 0, orbitAz: 0, zoom: 22, cz: 2, aspect: 1.5 } };
let renderer, scene, mapCam, persCam, sun, envGroup, dynGroup, ribbonGroup, cockpit;
const meshes = new Map(); // entity id -> object3d

// ------------------------------------------------------------------ helpers
export function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
const seedRand = (() => { let s = 1; return { set(v) { s = v; }, next() { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; } }; })();

// ------------------------------------------------------------------ init
export function initRender(stage) {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.5 : 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  stage.prepend(renderer.domElement);
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc9dcea, 110, 330);
  // sky dome
  const skyGeo = new THREE.SphereGeometry(500, 32, 16);
  const cols = []; const pos = skyGeo.attributes.position; const top = new THREE.Color(0x5d93d6), hor = new THREE.Color(0xd8e6f0), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i) / 500; c.copy(hor).lerp(top, Math.pow(Math.max(0, y), 0.6)); cols.push(c.r, c.g, c.b); }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  scene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false })));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.45;
  scene.add(new THREE.HemisphereLight(0xdfeeff, 0x6b7a55, 1.25));
  sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.set(-45, 80, 30);
  sun.castShadow = true; const sc = sun.shadow.camera; sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 10; sc.far = 220;
  sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun); scene.add(sun.target);
  // far ground
  const far = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: 0x7d9a5c, roughness: 1 }));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.06; far.receiveShadow = true; scene.add(far);
  mapCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 300); mapCam.up.set(0, 0, -1);
  persCam = new THREE.PerspectiveCamera(62, 1, 0.05, 900); scene.add(persCam);
  cockpit = makeCockpit(); persCam.add(cockpit);
  envGroup = new THREE.Group(); dynGroup = new THREE.Group(); ribbonGroup = new THREE.Group();
  scene.add(envGroup, dynGroup, ribbonGroup);
  initGround();
  return renderer;
}
export function resize(w, h) {
  renderer.setSize(w, h); persCam.aspect = w / h; persCam.updateProjectionMatrix(); R.view.aspect = w / h;
}
export const canvasEl = () => renderer.domElement;

// ------------------------------------------------------------------ ground texture
const WORLD = 150, GPX = MOBILE ? 2048 : 4096, PXM = GPX / WORLD;
let gCanvas, g, gTex, groundMesh;
const COL = { grass: '#6f9152', walk: '#cfc8ba', curb: '#e9e5dc', asphalt: '#4a4d52', paint: '#f2f0e8', apron: '#b9ad99' };
function initGround() {
  gCanvas = document.createElement('canvas'); gCanvas.width = gCanvas.height = GPX; g = gCanvas.getContext('2d');
  gTex = new THREE.CanvasTexture(gCanvas); gTex.colorSpace = THREE.SRGBColorSpace; gTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.95 }));
  groundMesh.rotation.x = -Math.PI / 2; groundMesh.receiveShadow = true; scene.add(groundMesh);
}
function noise(n, colors, size) { for (let i = 0; i < n; i++) { g.fillStyle = colors[i % colors.length]; const s = size * (0.5 + Math.random()); g.fillRect(rand(-75, 75), rand(-75, 75), s, s); } }
function beginGround() {
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = COL.grass; g.fillRect(0, 0, GPX, GPX);
  g.setTransform(PXM, 0, 0, PXM, GPX / 2, GPX / 2);
  noise(9000, ['rgba(40,70,25,.22)', 'rgba(160,190,110,.18)', 'rgba(90,120,60,.25)'], 0.5);
}
const withArm = (a, fn) => { g.save(); g.rotate(ARM_ROT[a]); fn(); g.restore(); };
function asphaltNoise(clipFn) {
  g.save(); g.beginPath(); clipFn(); g.clip();
  noise(26000, ['rgba(0,0,0,.10)', 'rgba(255,255,255,.05)', 'rgba(30,30,30,.12)'], 0.18);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(20,20,22,${rand(.03, .06)})`; g.beginPath(); g.ellipse(rand(-70, 70), rand(-70, 70), rand(0.6, 2), rand(0.4, 1.2), rand(0, 3), 0, TAU); g.fill(); }
  g.restore();
}
function paving(clipFn) {
  g.save(); g.beginPath(); clipFn(); g.clip();
  g.strokeStyle = 'rgba(120,110,95,.25)'; g.lineWidth = 0.04;
  for (let x = -75; x < 75; x += 0.6) { g.beginPath(); g.moveTo(x, -75); g.lineTo(x, 75); g.stroke(); g.beginPath(); g.moveTo(-75, x); g.lineTo(75, x); g.stroke(); }
  g.restore();
}
function zebra(a, s0, s1) {
  withArm(a, () => { g.fillStyle = COL.paint; for (let x = -HW + 0.35; x < HW - 0.3; x += 1.0) g.fillRect(x, s0, 0.55, s1 - s0); });
}
function yieldMarks(y) {
  g.fillStyle = COL.paint;
  for (let x = 0.2; x < HW - 0.3; x += 0.85) g.fillRect(x, y, 0.5, 0.5);
  g.strokeStyle = COL.paint; g.lineWidth = 0.28;
  g.beginPath(); g.moveTo(0.8, y + 2.6); g.lineTo(2.7, y + 2.6); g.lineTo(1.75, y + 6.2); g.closePath(); g.stroke();
}
function stopMarks(y) {
  g.fillStyle = COL.paint; g.fillRect(0.08, y, HW - 0.16, 0.55);
  g.save(); g.translate(1.75, y + 4.2); g.scale(1, 2.4); g.font = 'bold 1.1px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', 0, 0); g.restore();
}
function laneLines(a, from, to, solidTo) {
  withArm(a, () => {
    g.fillStyle = COL.paint;
    g.fillRect(-HW + 0.18, from, 0.13, to - from); g.fillRect(HW - 0.31, from, 0.13, to - from);
    g.fillRect(-0.07, from, 0.14, solidTo - from);
    for (let y = solidTo + 3; y < to; y += 9) g.fillRect(-0.07, y, 0.14, 4.5);
  });
}
function drawIntersection(J) {
  beginGround();
  const CR = 3.2, SW = 2.6, arms = J.arms;
  const roadPath = () => { g.rect(-HW, -HW, 2 * HW, 2 * HW); for (let a = 0; a < 4; a++) if (arms[a]) withArm(a, () => g.rect(-HW, 0, 2 * HW, 80)); };
  // sidewalks + plazas
  g.fillStyle = COL.walk;
  g.fillRect(-HW - SW - CR, -HW - SW - CR, 2 * (HW + SW + CR), 2 * (HW + SW + CR));
  for (let a = 0; a < 4; a++) if (arms[a]) withArm(a, () => g.fillRect(-HW - SW, 0, 2 * (HW + SW), 80));
  paving(() => { g.rect(-HW - SW - CR, -HW - SW - CR, 2 * (HW + SW + CR), 2 * (HW + SW + CR)); for (let a = 0; a < 4; a++) if (arms[a]) withArm(a, () => g.rect(-HW - SW, 0, 2 * (HW + SW), 80)); });
  // asphalt with rounded corners
  g.fillStyle = COL.curb; // curb under asphalt edge
  g.save(); g.lineWidth = 0.5; g.strokeStyle = COL.curb; g.beginPath(); roadPath(); g.stroke(); g.restore();
  g.fillStyle = COL.asphalt; g.beginPath(); roadPath(); g.fill();
  for (let a = 0; a < 4; a++) {
    const b = (a + 1) % 4; if (!arms[a] || !arms[b]) continue;
    // corner between arm a and arm b: fill square then cut quarter circle
    const [ax, az] = OUT[a], [bx, bz] = OUT[b];
    const sx = ax + bx, sz = az + bz; // diagonal direction (+-1, +-1)
    const x0 = sx > 0 ? HW : -HW - CR, z0 = sz > 0 ? HW : -HW - CR;
    g.fillStyle = COL.asphalt; g.fillRect(x0, z0, CR, CR);
    g.fillStyle = COL.walk; g.beginPath(); g.arc(sx * (HW + CR), sz * (HW + CR), CR, 0, TAU); g.fill();
    paving(() => g.arc(sx * (HW + CR), sz * (HW + CR), CR, 0, TAU));
    g.strokeStyle = COL.curb; g.lineWidth = 0.25; g.beginPath(); g.arc(sx * (HW + CR), sz * (HW + CR), CR + 0.12, 0, TAU); g.stroke();
  }
  asphaltNoise(() => { roadPath(); });
  for (let a = 0; a < 4; a++) if (arms[a]) {
    laneLines(a, STOP_R, 76, STOP_R + 14);
    withArm(a, () => {
      if (J.signs[a] === 'stop' && !J.lights) stopMarks(STOP_R);
      else if (J.signs[a] === 'yield' && !J.lights) yieldMarks(STOP_R);
      else if (J.lights) { g.fillStyle = COL.paint; g.fillRect(0.08, STOP_R, HW - 0.16, 0.45); }
      // tyre wear
      g.fillStyle = 'rgba(15,15,15,.13)'; g.fillRect(LANE - 0.95, STOP_R, 0.5, 70); g.fillRect(LANE + 0.45, STOP_R, 0.5, 70);
      g.fillRect(-LANE - 0.95, STOP_R, 0.5, 70); g.fillRect(-LANE + 0.45, STOP_R, 0.5, 70);
      // manhole
      g.fillStyle = 'rgba(30,30,30,.55)'; g.beginPath(); g.arc(-1.2, 30 + a * 3, 0.35, 0, TAU); g.fill();
    });
    if (J.zebra[a]) zebra(a, ZEB[0], ZEB[1]);
  }
  gTex.needsUpdate = true;
}
function drawRoundabout(J) {
  beginGround();
  const SW = 2.6, O = RB.outer;
  g.fillStyle = COL.walk; g.beginPath(); g.arc(0, 0, O + SW, 0, TAU); g.fill();
  for (let a = 0; a < 4; a++) withArm(a, () => g.fillRect(-HW - SW, 0, 2 * (HW + SW), 80));
  paving(() => { g.arc(0, 0, O + SW, 0, TAU); for (let a = 0; a < 4; a++) withArm(a, () => g.rect(-HW - SW, 0, 2 * (HW + SW), 80)); });
  const road = () => {
    g.moveTo(O, 0); g.arc(0, 0, O, 0, TAU);
    for (let a = 0; a < 4; a++) withArm(a, () => {
      g.rect(-HW, O - 2, 2 * HW, 80);
      g.moveTo(-HW - 2.6, O - 1.6); g.lineTo(HW + 2.6, O - 1.6); g.lineTo(HW, O + 5); g.lineTo(-HW, O + 5); g.closePath();
    });
  };
  g.fillStyle = COL.asphalt; g.beginPath(); road(); g.fill();
  asphaltNoise(() => road());
  // ring edge lines
  g.strokeStyle = COL.paint; g.lineWidth = 0.13; g.setLineDash([2.5, 2.5]); g.beginPath(); g.arc(0, 0, O - 0.35, 0, TAU); g.stroke(); g.setLineDash([]);
  // island
  g.fillStyle = COL.apron; g.beginPath(); g.arc(0, 0, RB.island + 1.2, 0, TAU); g.fill();
  g.save(); g.beginPath(); g.arc(0, 0, RB.island + 1.2, 0, TAU); g.clip(); noise(2500, ['rgba(80,70,60,.35)', 'rgba(230,220,200,.3)'], 0.22); g.restore();
  g.fillStyle = COL.curb; g.beginPath(); g.arc(0, 0, RB.island + 0.15, 0, TAU); g.fill();
  g.fillStyle = '#5f8a43'; g.beginPath(); g.arc(0, 0, RB.island - 0.1, 0, TAU); g.fill();
  for (let i = 0; i < 260; i++) { const r = rand(2.5, RB.island - 0.8), t = rand(0, TAU); g.fillStyle = pick(['#e8d14a', '#d9483b', '#f2f2f2', '#b05fc9', '#4d7a33', '#3f6b2c']); g.beginPath(); g.arc(r * Math.cos(t), r * Math.sin(t), rand(.12, .3), 0, TAU); g.fill(); }
  for (let a = 0; a < 4; a++) withArm(a, () => {
    // splitter island
    g.fillStyle = COL.curb;
    g.beginPath(); g.moveTo(0, O + 0.6); g.lineTo(0.65, 18.6); g.lineTo(0.65, 28); g.lineTo(0, 30.5); g.lineTo(-0.65, 28); g.lineTo(-0.65, 18.6); g.closePath(); g.fill();
    g.fillStyle = '#6e9a4e';
    g.beginPath(); g.moveTo(0, O + 1.5); g.lineTo(0.45, 18.8); g.lineTo(0.45, 22.8); g.lineTo(-0.45, 22.8); g.lineTo(-0.45, 18.8); g.closePath(); g.fill();
    g.fillStyle = COL.walk; g.fillRect(-0.45, 22.8, 0.9, 3.6); // refuge for the zebra
    g.fillStyle = '#6e9a4e'; g.beginPath(); g.moveTo(0.45, 26.4); g.lineTo(0.45, 27.8); g.lineTo(0, 29.6); g.lineTo(-0.45, 27.8); g.lineTo(-0.45, 26.4); g.closePath(); g.fill();
    g.fillStyle = COL.paint;
    g.fillRect(-HW + 0.18, 21, 0.13, 55); g.fillRect(HW - 0.31, 21, 0.13, 55);
    for (let y = 33; y < 76; y += 9) g.fillRect(-0.07, y, 0.14, 4.5);
    yieldMarks(RB.yieldR);
  });
  for (let a = 0; a < 4; a++) if (J.zebra[a]) zebra(a, RB.zeb[0], RB.zeb[1]);
  gTex.needsUpdate = true;
}

// ------------------------------------------------------------------ environment objects
const SIGN_TEX = {};
function triPath(x, w, h, up) { x.beginPath(); if (up) { x.moveTo(w / 2, 8); x.lineTo(w - 6, h - 14); x.lineTo(6, h - 14); } else { x.moveTo(6, 14); x.lineTo(w - 6, 14); x.lineTo(w / 2, h - 8); } x.closePath(); }
function signTex(k) {
  if (SIGN_TEX[k]) return SIGN_TEX[k];
  return SIGN_TEX[k] = canvasTex(128, 128, (x, w, h) => {
    if (k === 'yield' || k === 'priority') {
      const up = k === 'priority';
      triPath(x, w, h, up); x.fillStyle = '#c8102e'; x.fill(); x.lineJoin = 'round'; x.lineWidth = 6; x.strokeStyle = '#fff'; x.stroke();
      x.save(); x.translate(w / 2, h / 2 + (up ? 8 : -6)); x.scale(.6, .6); x.translate(-w / 2, -h / 2); triPath(x, w, h, up); x.fillStyle = '#fff'; x.fill(); x.restore();
      if (up) { x.fillStyle = '#111'; x.fillRect(w / 2 - 6, 50, 12, 50); x.fillRect(w / 2 - 21, 67, 42, 7); }
    } else if (k === 'stop') {
      x.beginPath(); for (let i = 0; i < 8; i++) { const t = (i + .5) / 8 * TAU; x.lineTo(w / 2 + Math.cos(t) * 60, h / 2 + Math.sin(t) * 60); } x.closePath(); x.fillStyle = '#c8102e'; x.fill(); x.lineWidth = 5; x.strokeStyle = '#fff'; x.stroke();
      x.fillStyle = '#fff'; x.font = 'bold 36px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('STOP', w / 2, h / 2 + 2);
    } else if (k === 'round') {
      x.beginPath(); x.arc(64, 64, 60, 0, TAU); x.fillStyle = '#1f5fbf'; x.fill(); x.lineWidth = 4; x.strokeStyle = '#fff'; x.stroke(); x.lineWidth = 11; x.strokeStyle = '#fff';
      for (let i = 0; i < 3; i++) { const a0 = i / 3 * TAU - 0.3; x.beginPath(); x.arc(64, 64, 30, a0, a0 + 1.35); x.stroke(); const a1 = a0 + 1.55; x.beginPath(); x.moveTo(64 + Math.cos(a1) * 30, 64 + Math.sin(a1) * 30); x.lineTo(64 + Math.cos(a1 - .45) * 44, 64 + Math.sin(a1 - .45) * 44); x.lineTo(64 + Math.cos(a1 - .45) * 16, 64 + Math.sin(a1 - .45) * 16); x.closePath(); x.fillStyle = '#fff'; x.fill(); }
    } else if (k === 'zebra') {
      x.fillStyle = '#1f5fbf'; x.fillRect(6, 6, w - 12, h - 12); x.fillStyle = '#fff'; triPath(x, w, h, true); x.fill();
      x.fillStyle = '#111'; x.beginPath(); x.arc(64, 48, 7, 0, TAU); x.fill(); x.fillRect(60, 56, 8, 22); x.fillRect(54, 78, 6, 16); x.fillRect(68, 78, 6, 16); for (let i = 0; i < 4; i++) x.fillRect(30 + i * 18, 98, 10, 6);
    }
  });
}
const poleGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 8);
const MAT = {
  pole: new THREE.MeshStandardMaterial({ color: 0x8c9196, metalness: 0.6, roughness: 0.4 }),
  darkPole: new THREE.MeshStandardMaterial({ color: 0x2d3033, metalness: 0.5, roughness: 0.5 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.9 }),
  pine: new THREE.MeshStandardMaterial({ color: 0x3f6a2e, roughness: 0.9 }),
  pine2: new THREE.MeshStandardMaterial({ color: 0x4c7a34, roughness: 0.9 }),
  cypress: new THREE.MeshStandardMaterial({ color: 0x2c4f26, roughness: 0.9 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.8 }),
  roof: new THREE.MeshStandardMaterial({ color: 0xa9532e, roughness: 0.8 }),
  roofFlat: new THREE.MeshStandardMaterial({ color: 0x9d8f80, roughness: 0.9 }),
  lampOff: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }),
};
function pole(x, z, h, mat = MAT.pole) { const m = new THREE.Mesh(poleGeo, mat); m.scale.y = h; m.position.set(x, h / 2, z); m.castShadow = true; return m; }
function addSign(a, dist, kinds, lat = HW + 1.4) {
  const [x, z] = armWorld(a, dist, lat);
  envGroup.add(pole(x, z, 2.9));
  kinds.forEach((k, i) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex(k), toneMapped: false })); sp.scale.set(1.5, 1.5, 1); sp.position.set(x, 3.1 - i * 1.45, z); envGroup.add(sp); });
}
// facade texture: one floor x one bay (Italian windows with shutters)
const FACADE = (() => {
  const tex = canvasTex(128, 128, (x) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(0,0,0,.06)'; for (let i = 0; i < 300; i++) x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    x.fillStyle = 'rgba(0,0,0,.12)'; x.fillRect(0, 118, 128, 4);              // string course
    x.fillStyle = '#e9e6df'; x.fillRect(38, 22, 52, 82);                      // window frame
    x.fillStyle = '#2b3440'; x.fillRect(44, 28, 40, 72);                      // glass
    x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(44, 28, 40, 20);
    x.fillStyle = '#e9e6df'; x.fillRect(62, 28, 4, 72); x.fillRect(44, 60, 40, 3);
    x.fillStyle = '#4f6e4a'; x.fillRect(20, 24, 18, 78); x.fillRect(90, 24, 18, 78); // shutters
    x.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 28; y < 100; y += 6) { x.fillRect(20, y, 18, 2); x.fillRect(90, y, 18, 2); }
    x.fillStyle = '#d8d3c8'; x.fillRect(34, 104, 60, 6);                       // sill
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex;
})();
const SHOP = (() => {
  const tex = canvasTex(128, 128, (x) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, 128, 128);
    x.fillStyle = 'rgba(0,0,0,.08)'; x.fillRect(0, 0, 128, 10);
    x.fillStyle = '#30363d'; x.fillRect(14, 30, 100, 98);
    x.fillStyle = 'rgba(255,240,200,.25)'; x.fillRect(18, 34, 92, 40);
    x.fillStyle = '#c9c4b8'; x.fillRect(62, 30, 4, 98);
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; return tex;
})();
const WALLS = [0xe8c48a, 0xd98f62, 0xf0dcb4, 0xe3a77c, 0xf3e7cf, 0xc9b28d, 0xe6b8a2, 0xd9c27a, 0xf2d1a8];
const AWNINGS = [0x2f6b4f, 0xa63d2f, 0x2c4d7a, 0x8a6d2b];
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
// ---- batching: static scenery is merged into a few meshes (vertex-coloured) for speed
const BATCH_MAT = {
  facade: new THREE.MeshStandardMaterial({ map: FACADE, vertexColors: true, roughness: 0.85 }),
  shop: new THREE.MeshStandardMaterial({ map: SHOP, vertexColors: true, roughness: 0.8 }),
  plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }),
  leaf: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }),
};
let batches = {};
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function mat4(x, y, z, ry = 0, rx = 0, sx = 1, sy = 1, sz = 1) { _e.set(rx, ry, 0, 'YXZ'); _q.setFromEuler(_e); return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)); }
function addPiece(kind, geo, matrix, color) {
  const g2 = geo.index ? geo.toNonIndexed() : geo.clone();
  g2.applyMatrix4(matrix);
  const n = g2.attributes.position.count, c = new THREE.Color(color), arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g2.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g2.attributes.uv) g2.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  for (const k of Object.keys(g2.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g2.deleteAttribute(k);
  (batches[kind] ||= []).push(g2);
}
function flushBatches() {
  for (const kind in batches) {
    const list = batches[kind]; if (!list.length) continue;
    const merged = mergeGeometries(list, false); list.forEach(x => x.dispose());
    const m = new THREE.Mesh(merged, BATCH_MAT[kind]); m.castShadow = true; m.receiveShadow = kind !== 'leaf'; m.userData.ownGeo = true;
    envGroup.add(m);
  }
  batches = {};
}
function facadeBox(w, h, d, ru, rv) {
  const gq = new THREE.BoxGeometry(w, h, d), uv = gq.attributes.uv;
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    if (f === 2 || f === 3) { uv.setXY(k, 0.05, 0.95); continue; }
    const across = f < 2 ? d : w;
    uv.setXY(k, uv.getX(k) * across / ru, uv.getY(k) * rv);
  }
  return gq;
}
const roofCache = new Map();
function building(w, d, floors, color, x, z, rotY) {
  const fh = 3.1, gh = 3.6, h = gh + (floors - 1) * fh;
  const B = mat4(x, 0, z, rotY);
  addPiece('facade', facadeBox(w, h - gh, d, 3.3, floors - 1), B.clone().multiply(mat4(0, gh + (h - gh) / 2, 0)), color);
  addPiece('shop', facadeBox(w, gh, d, 4, 1), B.clone().multiply(mat4(0, gh / 2, 0)), color);
  if (Math.random() < 0.65) {
    const rh = Math.min(3, d * 0.28);
    const shape = new THREE.Shape([new THREE.Vector2(-d / 2 - 0.4, 0), new THREE.Vector2(d / 2 + 0.4, 0), new THREE.Vector2(0, rh)]);
    const rg = new THREE.ExtrudeGeometry(shape, { depth: w + 0.6, bevelEnabled: false }); rg.translate(0, 0, -(w + 0.6) / 2); rg.rotateY(Math.PI / 2);
    addPiece('plain', rg, B.clone().multiply(mat4(0, h, 0)), new THREE.Color(0xa9532e).offsetHSL(rand(-.02, .02), 0, rand(-.06, .04)));
    rg.dispose();
  } else addPiece('plain', boxGeo, B.clone().multiply(mat4(0, h + 0.1, 0, 0, 0, w + 0.3, 0.5, d + 0.3)), 0xd8d0c0);
  if (Math.random() < 0.55) addPiece('plain', boxGeo, B.clone().multiply(mat4(0, 3.0, -d / 2 - 0.6, 0, -0.25, w * 0.7, 0.12, 1.4)), pick(AWNINGS));
}
// row of buildings along arm a on one side (side=+1: right of inbound traffic), front face at lateral 'front'
function buildingRow(a, side, s0, s1, front) {
  let s = s0;
  while (s < s1) {
    const w = rand(8, 13); if (s + w > s1 + 2) break;
    const d = rand(9, 13), floors = 2 + Math.floor(Math.random() * 4);
    const [x, z] = armWorld(a, s + w / 2, side * (front + d / 2));
    const [ox, oz] = OUT[a]; let ang = Math.atan2(-oz, ox);
    const fz = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    const [ax, az] = armWorld(a, s + w / 2, 0);
    if (fz.x * (ax - x) + fz.z * (az - z) < 0) ang += Math.PI;
    building(w, d, floors, pick(WALLS), x, z, ang);
    s += w + rand(0.2, 1.4);
  }
}
const pineGeo = { trunk: new THREE.CylinderGeometry(0.16, 0.26, 1, 7), crown: new THREE.SphereGeometry(1, 10, 7), cone: new THREE.ConeGeometry(1, 1, 10), ico: new THREE.IcosahedronGeometry(1, 1) };
const LEAF = [0x3f6a2e, 0x4c7a34, 0x56843a, 0x3a6229];
function stonePine(x, z, h = rand(7, 10)) {
  const lean = rand(-0.08, 0.08);
  addPiece('plain', pineGeo.trunk, mat4(x - lean * h / 2, h / 2, z, 0, 0, 1, h, 1).multiply(new THREE.Matrix4().makeRotationZ(lean)), 0x7a5a3c);
  for (let i = 0; i < 3; i++) { const r = rand(2.2, 3.4); addPiece('leaf', pineGeo.crown, mat4(x + rand(-1, 1) - lean * h, h + rand(-.3, .4), z + rand(-1, 1), rand(0, 3), 0, r, rand(0.9, 1.3), r * rand(.8, 1.1)), pick(LEAF)); }
}
function roundTree(x, z) {
  const h = rand(3, 4.5);
  addPiece('plain', pineGeo.trunk, mat4(x, h / 2, z, 0, 0, 0.8, h, 0.8), 0x7a5a3c);
  for (let i = 0; i < 3; i++) { const r = rand(1.4, 2); addPiece('leaf', pineGeo.ico, mat4(x + rand(-.7, .7), h + rand(.3, 1.3), z + rand(-.7, .7), rand(0, 3), 0, r, r, r), pick(LEAF)); }
}
function cypress(x, z, h = rand(6, 9)) { addPiece('leaf', pineGeo.cone, mat4(x, h / 2 + 0.4, z, 0, 0, 0.9, h, 0.9), 0x2c4f26); }
function streetLamp(a, s, lat) {
  const [x, z] = armWorld(a, s, lat); envGroup.add(pole(x, z, 6, MAT.darkPole));
  const [x2, z2] = armWorld(a, s, lat - Math.sign(lat) * 1.3);
  const arm = new THREE.Mesh(boxGeo, MAT.darkPole); arm.scale.set(0.08, 0.08, 1.4); arm.position.set((x + x2) / 2, 6, (z + z2) / 2); arm.lookAt(x2, 6, z2); envGroup.add(arm);
  const head = new THREE.Mesh(boxGeo, MAT.darkPole); head.scale.set(0.5, 0.18, 0.3); head.position.set(x2, 5.9, z2); envGroup.add(head);
}
// traffic lights
const LIGHT_MAT = {
  R: [new THREE.MeshStandardMaterial({ color: 0x3a0d0d }), new THREE.MeshBasicMaterial({ color: 0xff2a1f, toneMapped: false })],
  A: [new THREE.MeshStandardMaterial({ color: 0x3a2a0d }), new THREE.MeshBasicMaterial({ color: 0xffb21f, toneMapped: false })],
  G: [new THREE.MeshStandardMaterial({ color: 0x0d3a1a }), new THREE.MeshBasicMaterial({ color: 0x2bff6a, toneMapped: false })],
};
const lightHeads = [];
const discGeo = new THREE.CircleGeometry(0.7, 24);
function trafficLight(a, lat, dist, withDisc) {
  const [x, z] = armWorld(a, dist, lat);
  envGroup.add(pole(x, z, 3.2, MAT.darkPole));
  const head = new THREE.Group(); head.position.set(x, 3.2, z);
  const box = new THREE.Mesh(boxGeo, MAT.darkPole); box.scale.set(0.42, 1.15, 0.3); box.position.y = 0.55; head.add(box);
  const lamps = {};
  ['R', 'A', 'G'].forEach((k, i) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), LIGHT_MAT[k][0]); l.position.set(0, 0.92 - i * 0.37, 0.16); head.add(l); lamps[k] = l; });
  head.rotation.y = Math.atan2(OUT[a][0], OUT[a][1]); // face traffic arriving on arm a
  envGroup.add(head);
  let disc = null;
  if (withDisc) { const [dx, dz] = armWorld(a, STOP_R + 1.1, HW + 1.2); disc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: 0xff0000, toneMapped: false })); disc.rotation.x = -Math.PI / 2; disc.position.set(dx, 0.05, dz); envGroup.add(disc); }
  lightHeads.push({ arm: a, lamps, disc });
}
function updateTrafficLights() {
  for (const h of lightHeads) {
    const c = lightOf(h.arm);
    for (const k of ['R', 'A', 'G']) h.lamps[k].material = LIGHT_MAT[k][c === k ? 1 : 0];
    if (h.disc) h.disc.material.color.set(c === 'G' ? 0x22dd55 : c === 'A' ? 0xffaa00 : 0xee2222);
  }
}

export function buildEnv(J) {
  seedRand.set(1 + Math.floor(Math.random() * 1e6));
  while (envGroup.children.length) {
    const o = envGroup.children.pop();
    o.traverse(m => { if (m.userData?.ownGeo) m.geometry.dispose(); });
  }
  lightHeads.length = 0;
  if (J.type === 'rb') {
    drawRoundabout(J);
    for (let a = 0; a < 4; a++) {
      addSign(a, RB.yieldR + 0.8, ['yield', 'round']);
      if (J.zebra[a]) addSign(a, RB.zeb[1] + 0.8, ['zebra']);
      for (const side of [-1, 1]) buildingRow(a, side, 36, 78, HW + 5.5);
      for (let s = 30; s < 75; s += 15) stonePine(...armWorld(a, s + rand(-2, 2), (Math.random() < .5 ? -1 : 1) * (HW + 3.6)));
      streetLamp(a, 26, HW + 2.3); streetLamp(a, 52, -HW - 2.3);
      // corner gardens
      const t = ARM_ANG[a] - Math.PI / 4; roundTree(Math.cos(t) * 27, Math.sin(t) * 27); roundTree(Math.cos(t + .25) * 33, Math.sin(t + .25) * 33);
    }
    // island centerpiece: stone base + cypresses
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.7, 24), MAT.stone); base.position.y = 0.35; base.castShadow = true; base.receiveShadow = true; envGroup.add(base);
    cypress(0, 0, 9); cypress(1.2, 0.6, 7); cypress(-1.1, 0.7, 7.5); cypress(0.1, -1.2, 6.5);
    R.view.zoom = 30; R.view.cz = 2; R.view.fit = null;
  } else {
    drawIntersection(J);
    for (let a = 0; a < 4; a++) {
      if (!J.arms[a]) continue;
      if (J.lights) { trafficLight(a, HW + 0.9, STOP_R + 0.4, true); trafficLight(a, -HW - 1.0, -(HW + 1.6), false); }
      else if (J.signs[a] !== 'none') addSign(a, STOP_R + 0.8, [J.signs[a]]);
      if (J.zebra[a]) addSign(a, ZEB[1] + 0.3, ['zebra'], -HW - 1.4);
      for (const side of [-1, 1]) {
        // keep the corner open (sight lines) – buildings start further back on the second road of each corner
        buildingRow(a, side, side > 0 ? 17 : 25, 78, HW + 5.2);
        for (let s = 34; s < 75; s += 16) stonePine(...armWorld(a, s + rand(-2, 2), side * (HW + 3.7)));
      }
      streetLamp(a, 22, HW + 2.2); streetLamp(a, 48, -HW - 2.2);
    }
    if (J.missing >= 0) {
      const m = J.missing;
      for (let lat = -70; lat < 70; lat += 11) { if (Math.random() < 0.15) continue; const bw = rand(8, 11), bd = rand(9, 12); const [x, z] = armWorld(m, HW + 5.2 + bd / 2, lat + bw / 2); building(bw, bd, 2 + Math.floor(Math.random() * 4), pick(WALLS), x, z, Math.atan2(OUT[m][0], OUT[m][1])); }
      const [px, pz] = armWorld(m, HW + 3.4, 0); roundTree(px - 3, pz); roundTree(px + 3, pz);
    }
    // corner plazas: small trees
    for (let a = 0; a < 4; a++) { const b = (a + 1) % 4; if (!J.arms[a] || !J.arms[b]) continue; const sx = OUT[a][0] + OUT[b][0], sz = OUT[a][1] + OUT[b][1]; roundTree(sx * 12, sz * 12); }
    R.view.zoom = 21; R.view.cz = 3; R.view.fit = null;
  }
  flushBatches();
}

// ------------------------------------------------------------------ vehicles
const MATS = {
  glass: new THREE.MeshStandardMaterial({ color: 0x1a2430, metalness: 0.2, roughness: 0.1 }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.8, roughness: 0.3 }),
  head: new THREE.MeshBasicMaterial({ color: 0xfff6d8, toneMapped: false }),
  tailOff: new THREE.MeshStandardMaterial({ color: 0x5a0d0d, roughness: 0.4 }), tailOn: new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }),
  indOff: new THREE.MeshStandardMaterial({ color: 0x7a4a10, roughness: 0.4 }), indOn: new THREE.MeshBasicMaterial({ color: 0xffa21a, toneMapped: false }),
  black: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.7 }),
  blueOff: new THREE.MeshStandardMaterial({ color: 0x0b1d4a }), blueOn: new THREE.MeshBasicMaterial({ color: 0x3a7bff, toneMapped: false }),
  red: new THREE.MeshStandardMaterial({ color: 0xd11f1f, roughness: 0.5 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.22, depthWrite: false }),
  skin: [0xf1c9a5, 0xd9a47a, 0x8d5a3b, 0xf5d7bd].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 })),
  pants: [0x2b3a55, 0x333333, 0x6b5b45, 0x4a4a52].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })),
};
const paintCache = new Map();
const paint = c => { if (!paintCache.has(c)) paintCache.set(c, new THREE.MeshStandardMaterial({ color: c, metalness: 0.35, roughness: 0.38 })); return paintCache.get(c); };
const PALETTE = [0xe9e9e6, 0x1f1f22, 0xb2201a, 0x8a9199, 0x2f5f3a, 0x6e5a44, 0xd9d3c3, 0x3a3f6b, 0x0f6b6b, 0x8b2b55, 0x5a6b7a, 0xc9c2b0];
export const PLAYER_COLOR = 0x1d6ff2;

function profileFor(type, L, H) {
  const l = L / 2;
  switch (type) {
    case 'small': return { body: [[-l, .3], [l, .3], [l, .62], [l - .12, .82], [l - .8, .98], [l - 1.4, H], [-l + .35, H], [-l + .02, .95], [-l, .7]], glass: [[l - .86, 1.02], [l - 1.38, H - .06], [-l + .4, H - .06], [-l + .09, 1.0]] };
    case 'van': case 'amb': return { body: [[-l, .32], [l, .32], [l, .8], [l - .3, 1.05], [l - .95, H], [-l, H], [-l, .5]], glass: [[l - .36, 1.12], [l - .92, H - .14], [l - 1.95, H - .14], [l - 1.95, 1.12]] };
    case 'bus': return { body: [[-l, .35], [l, .35], [l, H - .2], [l - .2, H], [-l, H], [-l, .35]], glass: [[-l + .4, 1.25], [l - .02, 1.25], [l - .02, H - .3], [-l + .4, H - .3]] };
    default: return { body: [[-l, .3], [l, .3], [l, .6], [l - .15, .8], [l - 1.05, .95], [l - 1.75, H], [-l + .65, H], [-l + .1, .97], [-l, .72]], glass: [[l - 1.12, .99], [l - 1.72, H - .06], [-l + .7, H - .06], [-l + .16, .99]] };
  }
}
const geoCache = new Map();
function extrude(pts, width, bevel = 0.06) {
  const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const gg = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 4 });
  gg.translate(0, 0, -(width - 2 * bevel) / 2); gg.computeVertexNormals(); return gg;
}
function vehicleGeo(type, L, Wd, H) {
  const k = type + L + Wd + H; if (geoCache.has(k)) return geoCache.get(k);
  const pr = profileFor(type, L, H);
  const v = { body: extrude(pr.body, Wd), glass: extrude(pr.glass, Wd + 0.03, 0.02) };
  geoCache.set(k, v); return v;
}
const wheelGeo = new THREE.CylinderGeometry(1, 1, 1, 18), rimGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
const haloTex = canvasTex(64, 64, (x) => { const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,230,150,1)'); gr.addColorStop(.3, 'rgba(255,165,20,.85)'); gr.addColorStop(1, 'rgba(255,140,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); });
const haloMat = new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
const blueHaloMat = new THREE.SpriteMaterial({ map: haloTex, color: 0x4a7dff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });

function makeVehicle(v) {
  const grp = new THREE.Group();
  const { L, W: Wd, H, type } = v;
  const parts = { L: [], R: [], hL: [], hR: [], tails: [], blue: [], hBlue: [] };
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, shadow = false) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); if (shadow) m.castShadow = true; grp.add(m); return m; };
  const color = v.isPlayer ? PLAYER_COLOR : type === 'amb' ? 0xf4f4f0 : (v.color ?? pick(PALETTE));
  v.color = color;
  if (type === 'moto') {
    add(boxGeo, paint(color), 0.1, 0.62, 0, 1.3, 0.34, 0.34, true);
    add(boxGeo, MATS.black, -0.35, 0.86, 0, 0.7, 0.12, 0.3);
    for (const x of [0.75, -0.72]) { const w = add(wheelGeo, MATS.tyre, x, 0.32, 0, 0.32, 0.12, 0.32); w.rotation.x = Math.PI / 2; }
    const torso = add(new THREE.CapsuleGeometry(0.2, 0.42, 4, 8), MATS.pants[1], -0.22, 1.25, 0, 1, 1, 1, true); torso.rotation.z = -0.3;
    add(new THREE.SphereGeometry(0.17, 12, 8), paint(color), -0.08, 1.72, 0);
    add(boxGeo, MATS.head, 0.78, 0.82, 0, 0.06, 0.12, 0.18);
    parts.tails.push(add(boxGeo, MATS.tailOff, -0.72, 0.8, 0, 0.05, 0.08, 0.16));
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'L' : 'R';
      parts[key].push(add(boxGeo, MATS.indOff, 0.72, 0.85, side * 0.2, 0.08, 0.08, 0.08), add(boxGeo, MATS.indOff, -0.75, 0.82, side * 0.17, 0.08, 0.08, 0.08));
      for (const x of [0.85, -0.85]) { const h = new THREE.Sprite(haloMat); h.scale.set(1.1, 1.1, 1); h.position.set(x, 0.9, side * 0.3); h.visible = false; grp.add(h); parts['h' + key].push(h); }
    }
  } else {
    const gg = vehicleGeo(type, L, Wd, H);
    add(gg.body, paint(color), 0, 0, 0, 1, 1, 1, true);
    add(gg.glass, MATS.glass, 0, 0, 0);
    const wr = type === 'bus' ? 0.5 : 0.33;
    const wx = type === 'bus' ? [L / 2 - 2.2, -L / 2 + 2.6] : [L / 2 - 0.78, -L / 2 + 0.72];
    for (const x of wx) for (const z of [-1, 1]) {
      const w = add(wheelGeo, MATS.tyre, x, wr, z * (Wd / 2 - 0.13), wr, 0.24, wr); w.rotation.x = Math.PI / 2;
    }
    const ly = type === 'bus' ? 0.75 : 0.68;
    add(boxGeo, MATS.head, L / 2 + 0.02, ly, Wd / 2 - 0.32, 0.05, 0.14, 0.34); add(boxGeo, MATS.head, L / 2 + 0.02, ly, -Wd / 2 + 0.32, 0.05, 0.14, 0.34);
    parts.tails.push(add(boxGeo, MATS.tailOff, -L / 2 - 0.02, ly + 0.12, Wd / 2 - 0.28, 0.05, 0.16, 0.3), add(boxGeo, MATS.tailOff, -L / 2 - 0.02, ly + 0.12, -Wd / 2 + 0.28, 0.05, 0.16, 0.3));
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'L' : 'R', z = side * (Wd / 2 - 0.07);
      parts[key].push(
        add(boxGeo, MATS.indOff, L / 2 + 0.01, ly, z, 0.08, 0.13, 0.16),
        add(boxGeo, MATS.indOff, -L / 2 - 0.01, ly + 0.12, z, 0.08, 0.13, 0.16),
        add(boxGeo, MATS.indOff, L / 2 - (type === 'bus' ? 1.2 : 0.7), ly + 0.18, side * (Wd / 2 + 0.01), 0.18, 0.06, 0.02));
      if (type !== 'bus') add(boxGeo, paint(color), L / 2 - 1.15, 1.02, side * (Wd / 2 + 0.08), 0.1, 0.1, 0.16); // mirrors
      for (const x of [L / 2 + 0.15, -L / 2 - 0.15]) { const h = new THREE.Sprite(haloMat); h.scale.set(1.5, 1.5, 1); h.position.set(x, ly + 0.25, side * (Wd / 2 + 0.05)); h.visible = false; grp.add(h); parts['h' + key].push(h); }
    }
    if (type === 'amb') {
      add(boxGeo, MATS.red, 0, 0.95, 0, L - 0.2, 0.18, Wd + 0.02);
      for (const x of [L / 2 - 1.1, -L / 2 + 0.3]) for (const z of [-0.5, 0.5]) { parts.blue.push(add(boxGeo, MATS.blueOff, x, H + 0.08, z, 0.25, 0.14, 0.32)); }
      for (const z of [-0.6, 0.6]) { const h = new THREE.Sprite(blueHaloMat); h.scale.set(2.4, 2.4, 1); h.position.set(L / 2 - 1.1, H + 0.3, z); h.visible = false; grp.add(h); parts.hBlue.push(h); }
    }
    if (type === 'bus') { add(boxGeo, MATS.black, L / 2 + 0.03, H - 0.32, 0, 0.04, 0.3, Wd - 0.4); }
  }
  const sh = add(new THREE.PlaneGeometry(1, 1), MATS.shadow, 0, 0.025, 0, L + 0.3, Wd + 0.3, 1); sh.rotation.x = -Math.PI / 2;
  grp.userData = { parts, ent: v };
  return grp;
}

// ------------------------------------------------------------------ pedestrians
const pedGeo = { leg: new THREE.BoxGeometry(0.13, 0.8, 0.14), torso: new THREE.CapsuleGeometry(0.19, 0.42, 4, 8), head: new THREE.SphereGeometry(0.12, 12, 8), arm: new THREE.BoxGeometry(0.09, 0.6, 0.09) };
const SHIRTS = [0xd9483b, 0x2c6fbf, 0xe8c547, 0x3b9b6b, 0xf2f2f2, 0x8a4fbf, 0xe07a2f, 0x222222];
function makePed(p) {
  const grp = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: p.shirt ?? pick(SHIRTS), roughness: 0.8 }), pants = pick(MATS.pants), skin = pick(MATS.skin);
  const legs = [-1, 1].map(s => { const pv = new THREE.Group(); pv.position.set(0, 0.85, s * 0.11); const l = new THREE.Mesh(pedGeo.leg, pants); l.position.y = -0.4; l.castShadow = true; pv.add(l); grp.add(pv); return pv; });
  const arms = [-1, 1].map(s => { const pv = new THREE.Group(); pv.position.set(0, 1.42, s * 0.27); const a = new THREE.Mesh(pedGeo.arm, shirt); a.position.y = -0.28; pv.add(a); grp.add(pv); return pv; });
  const t = new THREE.Mesh(pedGeo.torso, shirt); t.position.y = 1.2; t.castShadow = true; grp.add(t);
  const h = new THREE.Mesh(pedGeo.head, skin); h.position.y = 1.67; grp.add(h);
  grp.userData = { legs, arms, ent: p };
  return grp;
}

// ------------------------------------------------------------------ labels / rings / ribbons
export function labelSprite(text, bg = '#111', fg = '#fff', size = 1.8) {
  const wide = text.length > 3, W2 = wide ? 256 : 128;
  const tex = canvasTex(W2, 128, (x) => {
    x.fillStyle = bg; x.beginPath(); x.roundRect(4, 14, W2 - 8, 100, 46); x.fill();
    x.lineWidth = 5; x.strokeStyle = 'rgba(255,255,255,.95)'; x.stroke();
    x.fillStyle = fg; x.font = `bold ${text.length > 2 ? 46 : 64}px system-ui, Arial`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, W2 / 2, 66);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false }));
  sp.scale.set(wide ? size * 2 : size, size, 1); sp.renderOrder = 20; return sp;
}
export function setLabel(e, text, bg = '#111', fg = '#fff') {
  const m = meshes.get(e.id);
  if (e.label) { e.label.parent?.remove(e.label); e.label.material.map.dispose(); e.label.material.dispose(); e.label = null; }
  e.labelText = text ? [text, bg, fg] : null;
  if (!text || !m) return;
  e.label = labelSprite(text, bg, fg, e.isPed ? 1.3 : 1.8);
  e.label.position.set(e.isPed ? 0 : -0.3, e.isPed ? 2.5 : (e.H || 1.5) + 1.8, 0); m.add(e.label);
}
const ringGeo = new THREE.RingGeometry(1, 1.17, 48);
export function setRing(e, color) {
  e.ringColor = color || null;
  const m = meshes.get(e.id); if (!m) return;
  if (!color) { if (e.ring) e.ring.visible = false; return; }
  if (!e.ring) { e.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false })); e.ring.rotation.x = -Math.PI / 2; e.ring.position.y = 0.07; const r = e.isPed ? 0.9 : Math.max(e.L, 2.6) * 0.62 + 0.4; e.ring.scale.setScalar(r); e.ring.userData.base = r; m.add(e.ring); }
  e.ring.material.color.set(color); e.ring.visible = true;
}
export function sideTag(v, side) {
  const m = meshes.get(v.id); if (!m) return;
  const sp = labelSprite(side === 'L' ? 'its LEFT' : 'its RIGHT', '#ffa21a', '#111', 1.6);
  sp.position.set(0.5, 1.4, side === 'L' ? -(v.W / 2 + 2.4) : (v.W / 2 + 2.4)); m.add(sp);
}
export function clearRibbons() { while (ribbonGroup.children.length) { const r = ribbonGroup.children.pop(); r.geometry.dispose(); r.material.dispose(); } }
export function ribbon(path, s0, s1, color, width = 0.9, opacity = 0.75) {
  const pts = []; for (let s = s0; s <= s1; s += 0.5) pts.push(path.at(s));
  if (pts.length < 3) return;
  const pos = [], idx = []; const y = 0.06 + ribbonGroup.children.length * 0.004;
  const n = pts.length, head = Math.min(6, Math.floor(n / 3));
  for (let i = 0; i < n - head; i++) {
    const p = pts[i], w = width / 2;
    pos.push(p.x - p.dz * w, y, p.z + p.dx * w, p.x + p.dz * w, y, p.z - p.dx * w);
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  // arrow head
  const b = pts[n - head - 1], tip = pts[n - 1], base = pos.length / 3, aw = width * 1.3;
  pos.push(b.x - b.dz * aw, y, b.z + b.dx * aw, b.x + b.dz * aw, y, b.z - b.dx * aw, tip.x, y, tip.z);
  idx.push(base, base + 1, base + 2);
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  m.renderOrder = 5; ribbonGroup.add(m);
}

// ------------------------------------------------------------------ cockpit (driver view)
function makeCockpit() {
  const grp = new THREE.Group(); grp.visible = false;
  const dash = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.8 });
  const d = new THREE.Mesh(boxGeo, dash); d.scale.set(2.4, 0.32, 0.7); d.position.set(0.25, -0.52, -0.72); grp.add(d);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.028, 10, 32), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }));
  wheel.position.set(0, -0.36, -0.52); wheel.rotation.x = -0.35; grp.add(wheel);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16), dash); hub.rotation.x = Math.PI / 2 - 0.35; hub.position.copy(wheel.position); grp.add(hub);
  for (const [x, rz] of [[-0.62, 0.42], [1.25, -0.42]]) { const p = new THREE.Mesh(boxGeo, dash); p.scale.set(0.07, 1.25, 0.07); p.position.set(x, 0.0, -0.72); p.rotation.z = rz; p.rotation.x = 0.25; grp.add(p); }
  const roof = new THREE.Mesh(boxGeo, dash); roof.scale.set(2.6, 0.06, 0.5); roof.position.set(0.3, 0.5, -0.55); grp.add(roof);
  const mirror = new THREE.Mesh(boxGeo, dash); mirror.scale.set(0.24, 0.07, 0.02); mirror.position.set(0.34, 0.37, -0.6); grp.add(mirror);
  const arrowShape = dir => { const s = new THREE.Shape(); s.moveTo(dir * 0.035, 0); s.lineTo(0, 0.022); s.lineTo(0, -0.022); s.closePath(); return new THREE.ShapeGeometry(s); };
  grp.userData.arrows = {};
  for (const [k, dir] of [['L', -1], ['R', 1]]) { const a = new THREE.Mesh(arrowShape(dir), new THREE.MeshBasicMaterial({ color: 0x0c2a12, toneMapped: false })); a.position.set(dir * 0.07, -0.335, -0.5); grp.add(a); grp.userData.arrows[k] = a; }
  return grp;
}

// ------------------------------------------------------------------ dynamic sync
export function syncDynamic(t) {
  const alive = new Set();
  for (const v of W.vehicles) {
    alive.add(v.id);
    let m = meshes.get(v.id);
    if (!m) { m = makeVehicle(v); meshes.set(v.id, m); dynGroup.add(m); if (v.labelText) setLabel(v, ...v.labelText); if (v.ringColor) setRing(v, v.ringColor); }
    m.position.set(v.x, 0, v.z); m.rotation.y = Math.atan2(-v.dz, v.dx);
    const P = m.userData.parts, b = blinkOf(v); v.blink = b;
    const on = ((t + v.phase) % 0.7) < 0.38;
    for (const side of ['L', 'R']) { const lit = b === side && on; for (const x of P[side]) x.material = lit ? MATS.indOn : MATS.indOff; for (const h of P['h' + side]) h.visible = lit; }
    for (const x of P.tails) x.material = v.braking ? MATS.tailOn : MATS.tailOff;
    if (v.emergency) { const ph = Math.floor(t * 6) % 2; P.blue.forEach((x, i) => x.material = (i % 2) === ph ? MATS.blueOn : MATS.blueOff); P.hBlue.forEach((h, i) => h.visible = (i % 2) === ph); }
    if (v.ring?.visible) v.ring.scale.setScalar(v.ring.userData.base * (1 + 0.06 * Math.sin(t * 7)));
  }
  for (const p of W.peds) {
    alive.add(p.id);
    let m = meshes.get(p.id);
    if (!m) { m = makePed(p); meshes.set(p.id, m); dynGroup.add(m); if (p.labelText) setLabel(p, ...p.labelText); if (p.ringColor) setRing(p, p.ringColor); }
    m.position.set(p.x, 0, p.z);
    const [ox, oz] = OUT[p.arm]; let hx, hz;
    if (p.state === 'leaving') { hx = ox; hz = oz; } else { hx = oz * p.dir; hz = -ox * p.dir; }
    m.rotation.y = Math.atan2(-hz, hx);
    const moving = p.state !== 'waiting' && !W.frozen, sw = moving ? Math.sin(p.walkPhase) * 0.5 : 0;
    m.userData.legs[0].rotation.z = sw; m.userData.legs[1].rotation.z = -sw; m.userData.arms[0].rotation.z = -sw * 0.8; m.userData.arms[1].rotation.z = sw * 0.8;
    if (p.ring?.visible) p.ring.scale.setScalar(p.ring.userData.base * (1 + 0.06 * Math.sin(t * 7)));
  }
  for (const [id, m] of meshes) if (!alive.has(id)) { dynGroup.remove(m); meshes.delete(id); }
  updateTrafficLights();
}
export function clearDynamic() { for (const [, m] of meshes) dynGroup.remove(m); meshes.clear(); }

// ------------------------------------------------------------------ cameras
export function setViewMode(mode) { R.view.mode = mode; R.view.userYaw = 0; }
function viewer() {
  const p = W.player;
  if (p) return { x: p.x, z: p.z, dx: p.dx, dz: p.dz, v: p };
  return { x: LANE, z: STOP_R + 3, dx: 0, dz: -1 };
}
export function renderFrame(dt, t) {
  const V = R.view;
  let cam;
  cockpit.visible = false;
  if (V.mode === 'map') {
    const asp = V.aspect || 1.5; let Z = V.zoom;
    if (V.fit) { // grow the view so every road user is visible (top ~30% / bottom ~20% are covered by overlays)
      const F = V.fit, half = (h) => asp < 1 ? h / asp : h;
      while (Z < 60 && ((F.x + 3) > (asp < 1 ? Z : Z * asp) || V.cz - F.zmin + 3 > half(Z) * 0.7 || F.zmax - V.cz + 3 > half(Z) * 0.8)) Z += 1;
    }
    const hh = asp < 1 ? Z / asp : Z;
    mapCam.left = -hh * asp; mapCam.right = hh * asp; mapCam.top = hh; mapCam.bottom = -hh; mapCam.updateProjectionMatrix();
    mapCam.position.set(0, 120, V.cz); mapCam.lookAt(0, 0, V.cz); cam = mapCam;
  } else if (V.mode === 'orbit') {
    const az = V.orbitAz + V.userYaw, dist = (V.zoom * 2.3) / Math.min(1, V.aspect), el = 0.82;
    persCam.fov = 50;
    persCam.position.set(Math.sin(az) * dist * Math.cos(el), dist * Math.sin(el), V.cz + Math.cos(az) * dist * Math.cos(el));
    persCam.lookAt(0, 0, V.cz + 2); cam = persCam;
  } else {
    const c = viewer(); const yaw = V.autoYaw + V.userYaw;
    V.yawS += (yaw - V.yawS) * Math.min(1, dt * 4);
    const cy = Math.cos(V.yawS), sy = Math.sin(V.yawS);
    const lx = c.dx * cy + c.dz * sy, lz = -c.dx * sy + c.dz * cy;
    if (V.mode === 'chase') {
      const L = c.v ? c.v.L : 4;
      persCam.fov = 62; persCam.position.set(c.x - c.dx * (L + 5.5), 4.4, c.z - c.dz * (L + 5.5));
      persCam.lookAt(c.x + lx * 18, 0.5, c.z + lz * 18);
    } else {
      persCam.fov = 72; const lfx = c.dz, lfz = -c.dx; // left vector
      persCam.position.set(c.x + c.dx * 0.2 - lfx * 0.36, 1.22, c.z + c.dz * 0.2 - lfz * 0.36);
      persCam.lookAt(persCam.position.x + lx * 10, 1.1, persCam.position.z + lz * 10);
      cockpit.visible = true;
      const b = W.player ? blinkOf(W.player) : null, on = (t % 0.7) < 0.38;
      for (const k of ['L', 'R']) cockpit.userData.arrows[k].material.color.set(b === k && on ? 0x34ff6a : 0x0c2a12);
    }
    persCam.updateProjectionMatrix(); cam = persCam;
  }
  // hide own vehicle in driver view
  if (W.player) { const m = meshes.get(W.player.id); if (m) { m.visible = V.mode !== 'driver'; if (W.player.label) W.player.label.visible = V.mode === 'map' || V.mode === 'orbit'; } }
  renderer.render(scene, cam);
  return cam;
}

// ------------------------------------------------------------------ picking
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
export function pickAt(clientX, clientY, cam) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  const hits = ray.intersectObjects([...meshes.values()], true);
  for (const h of hits) { let o = h.object; while (o && !o.userData?.ent) o = o.parent; if (o) return o.userData.ent; }
  // generous fallback: nearest entity to the ground point
  const pt = new THREE.Vector3(); ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt);
  let best = null, bd = 3.5;
  for (const e of [...W.vehicles, ...W.peds]) { const d = Math.hypot(e.x - pt.x, e.z - pt.z) - (e.L ? e.L / 3 : 0); if (d < bd) { bd = d; best = e; } }
  return best;
}
