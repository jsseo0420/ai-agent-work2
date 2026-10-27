'use strict';

/* =========================================================
 * 설정
 * ========================================================= */
const IMG_SRC = 'lottescreen.png';
const IMG_W = 1920;
const IMG_H = 911;

const USES_PER_WEAPON = 3;
const HP_PER_AREA = 1 / 40;      // 이미지 면적 40px² 당 내구도 1 → 큰 건물일수록 튼튼
const MIN_HP = 60;
const DESTROY_BONUS_RATIO = 0.5; // 파괴 시 최대 내구도의 50%를 보너스 점수로
const CRACK_COUNT = 16;

// 3D 시점: 지도를 뒤로 눕혀 먼 곳이 작게 보이게 함
const DEFAULT_TILT = 42;      // 처음 기울기 (0 = 위에서 내려다보는 위성 시점)
const MAX_TILT = 60;
const TILT_STEP = 10;
const ROTATE_STEP = Math.PI / 6; // 회전 버튼 한 번에 30°
const FOCUS_Y = 0.6;          // 회전·기울기 때 화면에서 고정되는 지점 (화면 높이 비율)
const CAMERA_DIST = 1.3;      // 화면 높이 대비 카메라 거리 (작을수록 원근이 강함)
const HORIZON_TOP = 0.08;     // 지도 끝이 화면 위에서 얼마나 내려와 보이는지 (하늘 영역)
const MAX_CANVAS_PIXELS = 9e6;

// 피해량: 핵폭탄 > 운석 > 미사일 > 레이저 > 폭탄
// splashRadius/splashRatio 가 있으면 주변 건물에도 범위 피해
const WEAPONS = [
  { id: 'bomb',    name: '폭탄',   icon: '💣', damage: 40,  blast: 34 },
  { id: 'laser',   name: '레이저', icon: '🛰️', damage: 70,  blast: 26 },
  { id: 'missile', name: '미사일', icon: '🚀', damage: 110, blast: 48 },
  { id: 'meteor',  name: '운석',   icon: '☄️', damage: 180, blast: 80,  splashRadius: 150, splashRatio: 0.5 },
  { id: 'nuke',    name: '핵폭탄', icon: '☢️', damage: 400, blast: 170, splashRadius: 330, splashRatio: 0.6 },
];

// lottescreen.png(1920×911) 위의 건물 영역. ellipse: [cx, cy, rx, ry] 또는 poly: [[x, y], ...]
const BUILDINGS = [
  { name: '돔 공연장',     ellipse: [315, 200, 142, 95] },
  { name: '파란 큐브',     poly: [[92, 152], [128, 145], [152, 175], [140, 198], [100, 192]] },
  { name: '청록 지붕 건물', poly: [[55, 312], [118, 280], [168, 318], [162, 372], [102, 382], [60, 348]] },
  { name: '성문 쌍둥이탑', poly: [[855, 90], [925, 85], [928, 188], [858, 190]] },
  { name: '크림색 돔 궁전', ellipse: [672, 392, 90, 96] },
  { name: '보라 지붕 저택', poly: [[790, 300], [855, 285], [905, 320], [935, 455], [890, 462], [812, 400]] },
  { name: '푸른 성',       ellipse: [1095, 380, 100, 92] },
  { name: '옥상 광장 건물', poly: [[1105, 185], [1180, 160], [1275, 140], [1360, 210], [1335, 265], [1250, 285], [1110, 280]] },
  { name: '자이로 타워',   poly: [[1535, 210], [1585, 225], [1445, 495], [1385, 485]] },
  { name: '하늘색 별관',   poly: [[1455, 410], [1545, 305], [1590, 340], [1585, 470], [1525, 520], [1455, 480]] },
  { name: '하늘색 대궁전', poly: [[1175, 570], [1265, 530], [1370, 525], [1435, 580], [1415, 700], [1340, 752], [1230, 742], [1172, 675]] },
  { name: '원형 전망대',   ellipse: [842, 655, 52, 48] },
  { name: '파란 지붕 상점', ellipse: [1108, 622, 40, 48] },
  { name: '파란 매표소',   ellipse: [1020, 668, 38, 32] },
  { name: '갈색 오두막',   poly: [[1040, 512], [1085, 512], [1085, 562], [1040, 562]] },
  { name: '초록 정원 건물', poly: [[1048, 745], [1108, 720], [1138, 778], [1085, 805]] },
  { name: '헬리패드 건물', poly: [[905, 758], [1020, 730], [1052, 810], [975, 862], [912, 832]] },
  { name: '분홍 상점',     ellipse: [1308, 418, 38, 32] },
  { name: '분홍 카페',     ellipse: [1398, 318, 46, 26] },
  { name: '라벤더 상점',   ellipse: [1400, 428, 30, 26] },
  { name: '돔 부스',       ellipse: [1225, 305, 38, 24] },
  { name: '선착장 창고',   poly: [[655, 636], [748, 632], [750, 688], [658, 690]] },
];

const RUBBLE_COLORS = ['#6b6259', '#857a6e', '#4a423b', '#9a8f82', '#5c544c', '#3d3833'];

/* =========================================================
 * 상태
 * ========================================================= */
const stage = document.getElementById('stage');
const worldEl = document.getElementById('world');
const canvas = document.getElementById('game'); // 기울어진 지도 (바닥)
const ctx = canvas.getContext('2d');
const fxCanvas = document.getElementById('fx'); // 화면 기준 효과 + 입력
const fx = fxCanvas.getContext('2d');
const fogEl = document.querySelector('.fog');
const needleEl = document.querySelector('#compass .needle');
const topViewBtn = document.getElementById('topView');
const img = new Image();

// heading/scale/ox/oy: 이미지 → 지도 캔버스 좌표 (회전·확대·이동), cw/ch: 지도 캔버스 크기,
// tilt/proj: 지도 캔버스 → 화면 원근 투영
const view = {
  w: 0, h: 0, dpr: 1, rs: 1, cw: 0, ch: 0,
  scale: 1, ox: 0, oy: 0, heading: 0, tilt: DEFAULT_TILT,
  minScale: 0.1, maxScale: 4, proj: null, inv: null,
};
// 버튼으로 바꾼 시점은 이 값을 향해 부드럽게 움직임
const cam = { heading: 0, tilt: DEFAULT_TILT };

let buildings = [];
let uses = {};
let selectedId = 'bomb';
let score = 0;
let totalDamage = 0;
let totalBonus = 0;
let destroyedCount = 0;
let gameOver = false;
let gameOverAt = 0;

let projectiles = [];
let blasts = [];
let rings = [];
let particles = [];
let decals = [];
let texts = [];
let shake = null;
let flash = null;
let hoverBuilding = null;

/* =========================================================
 * 유틸
 * ========================================================= */
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

function ellipseToPoly(cx, cy, rx, ry, n = 28) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function randomPointIn(b) {
  for (let i = 0; i < 60; i++) {
    const x = rand(b.minX, b.maxX);
    const y = rand(b.minY, b.maxY);
    if (pointInPoly(x, y, b.poly)) return [x, y];
  }
  return [b.cx, b.cy];
}

function tracePoly(c, pts) {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.closePath();
}

function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/* ---------- 좌표 변환: 이미지(world) ↔ 지도 캔버스 ↔ 화면 ---------- */
function worldToCanvas(wx, wy) {
  const cos = Math.cos(view.heading);
  const sin = Math.sin(view.heading);
  return { x: (wx * cos - wy * sin) * view.scale + view.ox, y: (wx * sin + wy * cos) * view.scale + view.oy };
}

function canvasToWorld(cx, cy) {
  const cos = Math.cos(view.heading);
  const sin = Math.sin(view.heading);
  const rx = (cx - view.ox) / view.scale;
  const ry = (cy - view.oy) / view.scale;
  return [rx * cos + ry * sin, -rx * sin + ry * cos];
}

// 이미지의 (wx, wy) 지점이 지도 캔버스의 (cx, cy)에 오도록 이동
function anchor(wx, wy, cx, cy) {
  const cos = Math.cos(view.heading);
  const sin = Math.sin(view.heading);
  view.ox = cx - (wx * cos - wy * sin) * view.scale;
  view.oy = cy - (wx * sin + wy * cos) * view.scale;
}

// 이미지 좌표 → 화면 좌표. k 는 원근에 따른 크기 배율(이미지 1px 이 화면에서 몇 px 인지)
function project(wx, wy) {
  const c = worldToCanvas(wx, wy);
  const m = view.proj;
  const w = m[6] * c.x + m[7] * c.y + m[8];
  return { x: (m[0] * c.x + m[1] * c.y + m[2]) / w, y: (m[3] * c.x + m[4] * c.y + m[5]) / w, k: view.scale / w };
}

// 화면 좌표 → 지도 캔버스 좌표 (지도 바깥 하늘이면 null)
function screenToCanvas(sx, sy) {
  const m = view.inv;
  const w = m[6] * sx + m[7] * sy + m[8];
  if (w <= 0) return null;
  return { x: (m[0] * sx + m[1] * sy + m[2]) / w, y: (m[3] * sx + m[4] * sy + m[5]) / w };
}

function screenToWorld(sx, sy) {
  const c = screenToCanvas(sx, sy);
  if (!c || c.x < 0 || c.y < 0 || c.x > view.cw || c.y > view.ch) return null;
  return canvasToWorld(c.x, c.y);
}

/* =========================================================
 * 건물
 * ========================================================= */
function makeCracks(b) {
  const cracks = [];
  const size = b.radius;
  for (let i = 0; i < CRACK_COUNT; i++) {
    const [sx, sy] = randomPointIn(b);
    const pts = [[sx, sy]];
    let a = rand(0, Math.PI * 2);
    const segs = 4 + Math.floor(rand(0, 5));
    for (let s = 0; s < segs; s++) {
      a += rand(-0.7, 0.7);
      const len = size * rand(0.12, 0.24);
      const [px, py] = pts[pts.length - 1];
      pts.push([px + Math.cos(a) * len, py + Math.sin(a) * len]);
    }
    const crack = { pts, width: Math.max(2.2, size * 0.045), branch: null };
    if (Math.random() < 0.6) {
      const from = pts[Math.floor(pts.length / 2)];
      const ba = a + rand(-1.6, 1.6);
      const bl = size * rand(0.15, 0.3);
      crack.branch = [from, [from[0] + Math.cos(ba) * bl, from[1] + Math.sin(ba) * bl]];
    }
    cracks.push(crack);
  }
  return cracks;
}

function makeRubble(b) {
  const pieces = [];
  const n = clamp(Math.round(b.area / 220), 18, 180);
  for (let i = 0; i < n; i++) {
    const [x, y] = randomPointIn(b);
    const r = b.radius * rand(0.05, 0.16);
    const sides = 3 + Math.floor(rand(0, 3));
    const rot = rand(0, Math.PI * 2);
    const pts = [];
    for (let s = 0; s < sides; s++) {
      const a = rot + (s / sides) * Math.PI * 2;
      const rr = r * rand(0.6, 1.1);
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    pieces.push({ pts, color: RUBBLE_COLORS[Math.floor(Math.random() * RUBBLE_COLORS.length)] });
  }
  return pieces;
}

function createBuildings() {
  buildings = BUILDINGS.map((def) => {
    const poly = def.ellipse ? ellipseToPoly(...def.ellipse) : def.poly.map((p) => [...p]);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const area = polyArea(poly);
    const maxHp = Math.max(MIN_HP, Math.round((area * HP_PER_AREA) / 10) * 10);
    const b = {
      name: def.name,
      poly,
      area,
      radius: Math.sqrt(area / Math.PI),
      cx: xs.reduce((a, v) => a + v, 0) / xs.length,
      cy: ys.reduce((a, v) => a + v, 0) / ys.length,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
      maxHp,
      hp: maxHp,
      destroyed: false,
      hitFlash: 0,
      showHpUntil: 0,
      smokeUntil: 0,
      rubble: null,
    };
    b.cracks = makeCracks(b);
    return b;
  });
}

function buildingAt(wx, wy) {
  // 작은 건물이 큰 건물 위에 겹쳐 있으면 작은 건물을 우선
  let best = null;
  for (const b of buildings) {
    if (pointInPoly(wx, wy, b.poly) && (!best || b.area < best.area)) best = b;
  }
  return best;
}

/* =========================================================
 * 화면 / 3D 시점 (회전·기울기) / 확대
 * ========================================================= */
function resize() {
  const rect = stage.getBoundingClientRect();
  view.w = rect.width;
  view.h = rect.height;
  view.dpr = window.devicePixelRatio || 1;
  fxCanvas.width = Math.round(view.w * view.dpr);
  fxCanvas.height = Math.round(view.h * view.dpr);
  view.minScale = Math.min(view.w / IMG_W, view.h / IMG_H) * 0.8;
  view.maxScale = Math.max(view.w / IMG_W, view.h / IMG_H) * 6;
  computeProjection();
  fitView();
}

// 원근 투영 계산: 지도 캔버스의 아래쪽 가장자리는 화면 맨 아래에 1:1 크기로,
// 위쪽 가장자리는 기울기에 따라 화면 위쪽에 작게 보이도록 캔버스 크기를 정함
function computeProjection() {
  const { w, h } = view;
  const t = (view.tilt * Math.PI) / 180;
  const s = Math.sin(t);
  const c = Math.cos(t);
  const P = h * CAMERA_DIST;
  const ey = h * 0.5;
  const q = s / P;
  const top = h * HORIZON_TOP * (view.tilt / DEFAULT_TILT);
  const ch = ((h - top) * P) / ((top - ey) * s + c * P);
  const farScale = 1 / (1 + q * ch);
  const cw = Math.max(w, (w / farScale) * 0.92);
  view.cw = cw;
  view.ch = ch;

  // 지도 캔버스 좌표 (x, y) → 화면 (X/W, Y/W)
  const a = c - ey * q;
  view.proj = [
    1, -(w / 2) * q, w / 2 - cw / 2 + (w / 2) * q * ch,
    0, a, h - ch * a,
    0, -q, 1 + q * ch,
  ];
  view.inv = invert3(view.proj);
  const m = view.proj;
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;
  canvas.style.transform = `matrix3d(${m[0]},${m[3]},0,${m[6]},${m[1]},${m[4]},0,${m[7]},0,0,1,0,${m[2]},${m[5]},0,${m[8]})`;

  view.rs = Math.min(view.dpr, Math.sqrt(MAX_CANVAS_PIXELS / (cw * ch)));
  canvas.width = Math.round(cw * view.rs);
  canvas.height = Math.round(ch * view.rs);
  fogEl.style.opacity = clamp(view.tilt / DEFAULT_TILT, 0, 1);
}

function fitView() {
  // 지도 캔버스 높이에 맞춰 시작 (가운데 정렬)
  view.scale = clamp(view.ch / IMG_H, view.minScale, view.maxScale);
  anchor(IMG_W / 2, IMG_H / 2, view.cw / 2, view.ch / 2);
  clampView();
}

// 처음 시점(북쪽 위, 기본 기울기)으로 되돌림
function resetCamera() {
  view.heading = cam.heading = 0;
  view.tilt = cam.tilt = DEFAULT_TILT;
  computeProjection();
  fitView();
  updateCameraUI();
}

// 화면 가운데 아래쪽(FOCUS_Y)이 늘 지도 안을 보도록 이동 범위를 제한
function clampView() {
  view.scale = clamp(view.scale, view.minScale, view.maxScale);
  const f = screenToCanvas(view.w / 2, view.h * FOCUS_Y);
  if (!f) return;
  const [wx, wy] = canvasToWorld(f.x, f.y);
  const cx = clamp(wx, 0, IMG_W);
  const cy = clamp(wy, 0, IMG_H);
  if (cx !== wx || cy !== wy) anchor(cx, cy, f.x, f.y);
}

// 화면의 (sx, sy) 지점을 고정한 채 확대/축소
function zoomAt(sx, sy, factor) {
  const c = screenToCanvas(sx, sy) || screenToCanvas(view.w / 2, view.h * FOCUS_Y);
  const [wx, wy] = canvasToWorld(c.x, c.y);
  view.scale = clamp(view.scale * factor, view.minScale, view.maxScale);
  anchor(wx, wy, c.x, c.y);
  clampView();
}

// 화면의 FOCUS_Y 지점을 중심으로 회전(heading)·기울기(tilt)를 바꿈
function setCamera(heading, tilt) {
  const fs = { x: view.w / 2, y: view.h * FOCUS_Y };
  const before = screenToCanvas(fs.x, fs.y);
  const [wx, wy] = canvasToWorld(before.x, before.y);
  view.heading = heading;
  if (tilt !== view.tilt) {
    view.tilt = tilt;
    computeProjection();
  }
  const after = screenToCanvas(fs.x, fs.y);
  anchor(wx, wy, after.x, after.y);
  clampView();
  updateCameraUI();
}

function updateCameraUI() {
  needleEl.style.transform = `rotate(${view.heading}rad)`;
  const flat = cam.tilt < 1;
  topViewBtn.querySelector('small').textContent = flat ? '3D' : '위성';
  topViewBtn.setAttribute('aria-label', flat ? '3D 시점으로 전환' : '위성(위에서 보기) 시점으로 전환');
}

// 버튼·키보드로 바꾼 목표 시점을 향해 매 프레임 조금씩 이동
function updateCamera(dt) {
  const dh = cam.heading - view.heading;
  const dtilt = cam.tilt - view.tilt;
  if (Math.abs(dh) < 1e-4 && Math.abs(dtilt) < 0.01) return;
  const k = Math.min(1, dt * 9);
  setCamera(
    Math.abs(dh) < 2e-3 ? cam.heading : view.heading + dh * k,
    Math.abs(dtilt) < 0.1 ? cam.tilt : view.tilt + dtilt * k,
  );
}

function rotateBy(delta) {
  cam.heading += delta;
}

function tiltBy(delta) {
  cam.tilt = clamp(cam.tilt + delta, 0, MAX_TILT);
  updateCameraUI();
}

/* =========================================================
 * 입력 (탭 = 발사, 드래그 = 이동, 두 손가락 = 확대·회전, 휠 = 확대,
 *       오른쪽 버튼·Shift 드래그 = 회전·기울기)
 * ========================================================= */
const pointers = new Map();
let gesture = null;

function localPoint(e) {
  const rect = fxCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// 손가락이 잡은 지도 지점 (이동하는 동안 계속 손가락 아래에 있게 함)
function grab(sx, sy) {
  const c = screenToCanvas(sx, sy);
  if (!c) return null;
  const [wx, wy] = canvasToWorld(c.x, c.y);
  return { wx, wy };
}

function startPan(p) {
  gesture = { type: 'pan', sx: p.x, sy: p.y, hold: grab(p.x, p.y) };
}

function startPinch() {
  const [a, b] = [...pointers.values()];
  const ca = screenToCanvas(a.x, a.y);
  const cb = screenToCanvas(b.x, b.y);
  if (!ca || !cb) {
    gesture = null;
    return;
  }
  gesture = {
    type: 'pinch',
    dist: Math.hypot(ca.x - cb.x, ca.y - cb.y) || 1,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
    heading: view.heading,
    scale: view.scale,
    hold: grab((a.x + b.x) / 2, (a.y + b.y) / 2),
  };
}

fxCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

fxCanvas.addEventListener('pointerdown', (e) => {
  fxCanvas.setPointerCapture(e.pointerId);
  const p = localPoint(e);
  pointers.set(e.pointerId, p);
  if (e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey || e.ctrlKey)) {
    gesture = { type: 'orbit', sx: p.x, sy: p.y, heading: view.heading, tilt: view.tilt };
  } else if (pointers.size === 1) {
    gesture = { type: 'tap', sx: p.x, sy: p.y, hold: grab(p.x, p.y) };
  } else if (pointers.size === 2) {
    startPinch();
  }
});

fxCanvas.addEventListener('pointermove', (e) => {
  const p = localPoint(e);
  if (e.pointerType === 'mouse' && (!pointers.has(e.pointerId) || e.buttons === 0)) {
    const wpt = screenToWorld(p.x, p.y);
    hoverBuilding = wpt ? buildingAt(wpt[0], wpt[1]) : null;
    return;
  }
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, p);
  if (!gesture) return;

  if (gesture.type === 'tap' && Math.hypot(p.x - gesture.sx, p.y - gesture.sy) > 8) {
    gesture.type = 'pan';
  }
  if (gesture.type === 'orbit') {
    // 좌우로 끌면 회전, 위아래로 끌면 기울기
    const heading = gesture.heading + (p.x - gesture.sx) * 0.008;
    const tilt = clamp(gesture.tilt - (p.y - gesture.sy) * 0.2, 0, MAX_TILT);
    cam.heading = heading;
    cam.tilt = tilt;
    setCamera(heading, tilt);
  } else if (gesture.type === 'pan' && gesture.hold) {
    const c = screenToCanvas(p.x, p.y);
    if (!c) return;
    anchor(gesture.hold.wx, gesture.hold.wy, c.x, c.y);
    clampView();
  } else if (gesture.type === 'pinch' && gesture.hold && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const ca = screenToCanvas(a.x, a.y);
    const cb = screenToCanvas(b.x, b.y);
    if (!ca || !cb) return;
    // 두 손가락을 벌리면 확대, 비틀면 회전
    const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y) || 1;
    view.scale = clamp(gesture.scale * (dist / gesture.dist), view.minScale, view.maxScale);
    view.heading = cam.heading = gesture.heading + (Math.atan2(b.y - a.y, b.x - a.x) - gesture.angle);
    anchor(gesture.hold.wx, gesture.hold.wy, (ca.x + cb.x) / 2, (ca.y + cb.y) / 2);
    clampView();
    updateCameraUI();
  }
});

function endPointer(e, canceled) {
  if (!pointers.has(e.pointerId)) return;
  const p = localPoint(e);
  pointers.delete(e.pointerId);
  if (gesture && gesture.type === 'tap' && !canceled && pointers.size === 0) {
    fire(p.x, p.y);
  }
  if (pointers.size === 0) {
    gesture = null;
  } else if (pointers.size === 1) {
    // 핀치 후 남은 손가락은 이동만 (실수로 발사되지 않게)
    startPan([...pointers.values()][0]);
  }
}

fxCanvas.addEventListener('pointerup', (e) => endPointer(e, false));
fxCanvas.addEventListener('pointercancel', (e) => endPointer(e, true));
fxCanvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') hoverBuilding = null;
});

fxCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = localPoint(e);
  zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') rotateBy(-ROTATE_STEP);
  else if (e.key === 'ArrowRight') rotateBy(ROTATE_STEP);
  else if (e.key === 'ArrowUp') tiltBy(TILT_STEP);
  else if (e.key === 'ArrowDown') tiltBy(-TILT_STEP);
  else return;
  e.preventDefault();
});

document.getElementById('zoomIn').addEventListener('click', () => zoomAt(view.w / 2, view.h * FOCUS_Y, 1.5));
document.getElementById('zoomOut').addEventListener('click', () => zoomAt(view.w / 2, view.h * FOCUS_Y, 1 / 1.5));
document.getElementById('zoomReset').addEventListener('click', resetCamera);
document.getElementById('rotLeft').addEventListener('click', () => rotateBy(-ROTATE_STEP));
document.getElementById('rotRight').addEventListener('click', () => rotateBy(ROTATE_STEP));
document.getElementById('tiltUp').addEventListener('click', () => tiltBy(TILT_STEP));
document.getElementById('tiltDown').addEventListener('click', () => tiltBy(-TILT_STEP));
document.getElementById('topView').addEventListener('click', () => {
  cam.tilt = cam.tilt < 1 ? DEFAULT_TILT : 0;
  updateCameraUI();
});
document.getElementById('compass').addEventListener('click', () => {
  // 가장 가까운 '북쪽이 위' 방향으로
  cam.heading = Math.round(view.heading / (Math.PI * 2)) * Math.PI * 2;
});
window.addEventListener('resize', resize);

/* =========================================================
 * UI
 * ========================================================= */
const weaponsEl = document.getElementById('weapons');
const scoreEl = document.getElementById('score');
const destroyedEl = document.getElementById('destroyed');
const shotsEl = document.getElementById('shots');
const shotsBox = document.getElementById('shotsBox');
const toastEl = document.getElementById('toast');
const resultEl = document.getElementById('result');
let toastTimer = 0;

function buildWeaponButtons() {
  weaponsEl.innerHTML = '';
  for (const w of WEAPONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'weapon';
    btn.dataset.id = w.id;
    btn.innerHTML = `
      <span class="w-icon">${w.icon}</span>
      <span class="w-name">${w.name}</span>
      <span class="w-power">피해 ${w.damage}</span>
      <span class="w-dots">${'<i></i>'.repeat(USES_PER_WEAPON)}</span>
      <span class="w-left"></span>`;
    btn.addEventListener('click', () => selectWeapon(w.id));
    weaponsEl.appendChild(btn);
  }
}

function selectWeapon(id) {
  if (gameOver) return;
  const w = WEAPONS.find((x) => x.id === id);
  if (uses[id] <= 0) {
    showToast(`${w.name}은(는) 모두 소진했어요`);
    return;
  }
  selectedId = id;
  showToast(`${w.icon} ${w.name} 선택! 건물을 터치하세요`);
  updateUI();
}

function updateUI() {
  for (const btn of weaponsEl.children) {
    const left = uses[btn.dataset.id];
    btn.dataset.left = left;
    btn.classList.toggle('selected', btn.dataset.id === selectedId && left > 0);
    btn.setAttribute('aria-pressed', btn.dataset.id === selectedId);
    btn.querySelectorAll('.w-dots i').forEach((dot, i) => dot.classList.toggle('on', i < left));
    btn.querySelector('.w-left').textContent = left > 0 ? `${left}회 남음` : '소진';
  }
  const totalLeft = Object.values(uses).reduce((a, v) => a + v, 0);
  const totalMax = WEAPONS.length * USES_PER_WEAPON;
  const ratio = totalLeft / totalMax;
  shotsEl.textContent = `${totalLeft} / ${totalMax}`;
  shotsBox.dataset.level = totalLeft === 0 ? 'empty' : ratio > 0.66 ? 'full' : ratio > 0.33 ? 'mid' : 'low';
  scoreEl.textContent = score.toLocaleString();
  destroyedEl.textContent = `${destroyedCount} / ${buildings.length}`;
}

function bumpScore() {
  scoreEl.classList.remove('bump');
  void scoreEl.offsetWidth;
  scoreEl.classList.add('bump');
}

function showToast(text, ms = 1800) {
  toastEl.textContent = text;
  toastEl.classList.remove('hide');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hide'), ms);
}

function showResult() {
  const ratio = destroyedCount / buildings.length;
  const rank =
    ratio >= 0.7 ? '🏆 도시 파괴자' :
    ratio >= 0.45 ? '🔥 철거 전문가' :
    ratio >= 0.2 ? '💥 숙련 철거반' : '🔨 견습 철거반';
  document.getElementById('rank').textContent = rank;
  document.getElementById('finalScore').textContent = score.toLocaleString();
  document.getElementById('sumDestroyed').textContent = `${destroyedCount} / ${buildings.length}`;
  document.getElementById('sumDamage').textContent = totalDamage.toLocaleString();
  document.getElementById('sumBonus').textContent = totalBonus.toLocaleString();
  resultEl.classList.remove('hidden');
  document.getElementById('restart').focus();
}

document.getElementById('restart').addEventListener('click', resetGame);

/* =========================================================
 * 발사 / 피해
 * ========================================================= */
function fire(sx, sy) {
  if (gameOver) return;
  const wpt = screenToWorld(sx, sy);
  if (!wpt) return;
  const [wx, wy] = wpt;
  if (wx < 0 || wy < 0 || wx > IMG_W || wy > IMG_H) return;

  const w = WEAPONS.find((x) => x.id === selectedId);
  if (!w || uses[w.id] <= 0) {
    showToast('남은 무기를 선택하세요');
    return;
  }
  uses[w.id]--;
  launch(w, wx, wy);
  toastEl.classList.add('hide');

  if (uses[w.id] === 0) {
    const next = WEAPONS.find((x) => uses[x.id] > 0);
    if (next) {
      selectedId = next.id;
      showToast(`${w.name} 소진! ${next.icon} ${next.name}(으)로 바꿨어요`);
    }
  }
  updateUI();
}

const FLIGHT = { bomb: [900, 900], laser: [450, 1200], missile: [800, 800], meteor: [950, 950], nuke: [1300, 1300] };

function launch(weapon, wx, wy) {
  const [flight, life] = FLIGHT[weapon.id];
  projectiles.push({
    weapon, wx, wy, flight, life,
    start: performance.now(),
    impacted: false,
    // 폭탄·미사일은 화면 아래(사용자 눈앞)에서 출발
    side: rand(-1, 1),
    spin: rand(-1, 1) < 0 ? -1 : 1,
    trail: [],
  });
}

function damageBuilding(b, amount, now) {
  if (b.destroyed || amount <= 0) return 0;
  const dealt = Math.min(Math.round(amount), b.hp);
  b.hp -= dealt;
  b.hitFlash = 1;
  b.showHpUntil = now + 2500;
  score += dealt;
  totalDamage += dealt;
  texts.push({ wx: b.cx, wy: b.minY, text: `-${dealt}`, color: '#fde68a', size: 18, start: now, dur: 1100 });

  if (b.hp <= 0) {
    b.destroyed = true;
    b.rubble = makeRubble(b);
    b.smokeUntil = now + 7000;
    destroyedCount++;
    const bonus = Math.round(b.maxHp * DESTROY_BONUS_RATIO);
    score += bonus;
    totalBonus += bonus;
    texts.push({ wx: b.cx, wy: b.cy, text: `💥 ${b.name} 파괴! +${bonus}`, color: '#fb923c', size: 20, start: now + 150, dur: 1800 });
    // 위로 튀어 오르는 파편과 먼지
    for (let i = 0; i < 40; i++) {
      const [x, y] = randomPointIn(b);
      const a = Math.atan2(y - b.cy, x - b.cx) + rand(-0.5, 0.5);
      const sp = rand(30, 120);
      particles.push({ kind: 'debris', x, y, z: rand(0, 20), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(80, 220), g: 400, size: rand(3, 7), life: rand(0.8, 1.4), max: 1.4, color: RUBBLE_COLORS[i % RUBBLE_COLORS.length] });
    }
    for (let i = 0; i < 18; i++) {
      const [x, y] = randomPointIn(b);
      particles.push({ kind: 'smoke', x, y, z: rand(0, 30), vx: rand(-15, 15), vy: rand(-15, 15), vz: rand(20, 50), size: b.radius * rand(0.2, 0.4), grow: 18, life: rand(1.5, 2.8), max: 2.8, color: '120,110,100' });
    }
    addShake(8, 400);
  }
  return dealt;
}

function impact(p, now) {
  const w = p.weapon;
  const target = buildingAt(p.wx, p.wy);
  let dealt = 0;

  if (target && !target.destroyed) dealt += damageBuilding(target, w.damage, now);

  if (w.splashRadius) {
    for (const b of buildings) {
      if (b === target || b.destroyed) continue;
      const d = Math.max(0, Math.hypot(b.cx - p.wx, b.cy - p.wy) - b.radius * 0.5);
      if (d < w.splashRadius) dealt += damageBuilding(b, w.damage * w.splashRatio * (1 - d / w.splashRadius), now);
    }
  }

  if (dealt > 0) bumpScore();
  else texts.push({ wx: p.wx, wy: p.wy, text: '빗나감', color: '#cbd5e1', size: 16, start: now, dur: 900 });

  spawnExplosion(p.wx, p.wy, w, now);
  updateUI();
}

/* =========================================================
 * 효과
 * ========================================================= */
function addShake(amp, dur) {
  const now = performance.now();
  if (!shake || amp >= shake.amp * (1 - (now - shake.start) / shake.dur)) shake = { amp, dur, start: now };
}

function spawnExplosion(x, y, w, now) {
  const r = w.blast;
  decals.push({ x, y, r: r * 0.9 });
  blasts.push({ x, y, r, start: now, dur: w.id === 'nuke' ? 1400 : 600 });

  const sparks = w.id === 'nuke' ? 90 : w.id === 'meteor' ? 50 : 26;
  for (let i = 0; i < sparks; i++) {
    const a = rand(0, Math.PI * 2);
    const sp = rand(0.4, 1.2) * r * 2;
    particles.push({ kind: 'spark', x, y, z: r * 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(0.5, 2) * r * 2, g: r * 6, size: rand(1.5, 3.5) * (r / 40 + 0.6), life: rand(0.4, 0.8), max: 0.8, color: Math.random() < 0.5 ? '#fde047' : '#fb923c' });
  }
  const smokes = w.id === 'nuke' ? 50 : 12;
  for (let i = 0; i < smokes; i++) {
    const a = rand(0, Math.PI * 2);
    const dist = rand(0, r * 0.6);
    particles.push({ kind: 'smoke', x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist, z: rand(0, r * 0.6), vx: Math.cos(a) * rand(5, 30), vy: Math.sin(a) * rand(5, 30), vz: rand(15, 45) * (w.id === 'nuke' ? 3 : 1), size: r * rand(0.25, 0.5), grow: r * 0.5, life: rand(1, 2.2), max: 2.2, color: '70,64,60' });
  }

  if (w.id === 'nuke') {
    flash = { start: now, dur: 1000 };
    rings.push({ x, y, r: w.splashRadius, start: now, dur: 1100 });
    addShake(22, 1100);
  } else if (w.id === 'meteor') {
    rings.push({ x, y, r: w.splashRadius, start: now, dur: 700 });
    addShake(12, 600);
  } else {
    addShake(w.id === 'missile' ? 6 : 4, 300);
  }
}

/* =========================================================
 * 무기 궤적 (화면 좌표)
 * ========================================================= */
// 진행도 k(0~1)일 때 무기의 화면 위치와 크기 배율
function projectileScreen(p, k) {
  const t = project(p.wx, p.wy);
  const endSize = clamp(t.k * 1.6, 0.45, 1.6);
  const id = p.weapon.id;

  if (id === 'bomb' || id === 'missile') {
    // 사용자 눈앞(화면 아래)에서 출발해 포물선을 그리며 멀어짐
    const sx = view.w / 2 + p.side * view.w * 0.2;
    const sy = view.h + 70;
    const e = id === 'missile' ? k * k * 0.45 + k * 0.55 : k;
    const arc = id === 'missile' ? 0.18 : 0.4;
    const x = lerp(sx, t.x, e);
    const y = lerp(sy, t.y, e) - Math.sin(Math.PI * e) * (Math.abs(sy - t.y) * arc + 40);
    // 원근감: 눈앞에서는 크게(4.5배) 시작해 건물에 가까워질수록 일정한 비율로 계속 작아짐.
    // 도착 크기는 건물이 멀리 있을수록 더 작음
    const start = 4.5;
    const end = clamp(t.k * 0.9, 0.22, 0.8);
    const size = start * Math.pow(end / start, e);
    return { x, y, size };
  }
  if (id === 'meteor') {
    return { x: lerp(t.x + view.w * 0.6, t.x, k), y: lerp(-90, t.y, k), size: lerp(1.6, endSize * 1.2, k) };
  }
  // 핵폭탄: 하늘에서 수직 낙하
  return { x: t.x, y: lerp(-90, t.y, k * k), size: lerp(1.3, endSize * 1.1, k) };
}

/* =========================================================
 * 루프
 * ========================================================= */
let last = performance.now();

function update(now, dt) {
  updateCamera(dt);

  for (const p of projectiles) {
    const t = now - p.start;
    if (!p.impacted && t >= p.flight) {
      p.impacted = true;
      impact(p, now);
    }
    if (!p.impacted && (p.weapon.id === 'missile' || p.weapon.id === 'meteor')) {
      const s = projectileScreen(p, t / p.flight);
      p.trail.push({ x: s.x, y: s.y, size: s.size, born: now });
    } else if (p.impacted && p.weapon.id === 'laser' && t < p.life - 200) {
      particles.push({ kind: 'spark', x: p.wx, y: p.wy, z: 2, vx: rand(-80, 80), vy: rand(-80, 80), vz: rand(40, 160), g: 400, size: rand(1.5, 3), life: 0.35, max: 0.35, color: Math.random() < 0.5 ? '#fecaca' : '#f87171' });
    }
    p.trail = p.trail.filter((tr) => now - tr.born < 450);
  }
  projectiles = projectiles.filter((p) => now - p.start < Math.max(p.flight, p.life) || p.trail.length);
  blasts = blasts.filter((b) => now - b.start < b.dur);
  rings = rings.filter((b) => now - b.start < b.dur);
  texts = texts.filter((t) => now - t.start < t.dur);

  for (const pt of particles) {
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.z += pt.vz * dt;
    if (pt.g) pt.vz -= pt.g * dt;
    if (pt.z < 0) {
      pt.z = 0;
      pt.vz *= -0.3;
      pt.vx *= 0.6;
      pt.vy *= 0.6;
    }
    const drag = pt.kind === 'smoke' ? 0.97 : 0.95;
    pt.vx *= drag;
    pt.vy *= drag;
    if (pt.grow) pt.size += pt.grow * dt;
  }
  particles = particles.filter((pt) => pt.life > 0);
  if (particles.length > 1500) particles.splice(0, particles.length - 1500);

  for (const b of buildings) {
    b.hitFlash = Math.max(0, b.hitFlash - dt * 3);
    const ratio = 1 - b.hp / b.maxHp;
    const smoky = (b.destroyed && now < b.smokeUntil) || (!b.destroyed && ratio >= 0.5);
    if (smoky && Math.random() < (b.destroyed ? 0.35 : 0.06)) {
      const [x, y] = randomPointIn(b);
      particles.push({ kind: 'smoke', x, y, z: 0, vx: rand(-6, 6), vy: rand(-6, 6), vz: rand(25, 50), size: b.radius * 0.12, grow: b.radius * 0.25, life: 2, max: 2, color: '90,85,80' });
    }
  }

  const pending = projectiles.some((p) => !p.impacted);
  if (!gameOver && !pending && Object.values(uses).every((v) => v === 0)) {
    gameOver = true;
    gameOverAt = now + 1500;
  }
  if (gameOver && gameOverAt && now >= gameOverAt) {
    gameOverAt = 0;
    showResult();
  }
}

/* ---------- 지도(바닥) 그리기 ---------- */
function drawBuildingDamage(b) {
  const ratio = 1 - b.hp / b.maxHp;
  if (ratio <= 0 && b.hitFlash <= 0) return;

  ctx.save();
  tracePoly(ctx, b.poly);
  ctx.clip();

  if (b.destroyed) {
    tracePoly(ctx, b.poly);
    ctx.fillStyle = 'rgba(52, 46, 40, 0.94)';
    ctx.fill();
    for (const piece of b.rubble) {
      tracePoly(ctx, piece.pts);
      ctx.fillStyle = piece.color;
      ctx.fill();
    }
    const g = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, b.radius * 1.2);
    g.addColorStop(0, 'rgba(10, 8, 6, 0.55)');
    g.addColorStop(1, 'rgba(10, 8, 6, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  } else {
    // 내구도가 줄수록 그을음 + 균열이 늘어남
    tracePoly(ctx, b.poly);
    ctx.fillStyle = `rgba(20, 14, 8, ${ratio * 0.35})`;
    ctx.fill();
    const visible = Math.ceil(ratio * b.cracks.length);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < visible; i++) {
      const c = b.cracks[i];
      const lines = c.branch ? [c.pts, c.branch] : [c.pts];
      for (const pts of lines) {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
        ctx.strokeStyle = 'rgba(255, 245, 230, 0.55)';
        ctx.lineWidth = c.width * (0.9 + ratio * 1.1);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(10, 6, 3, 0.95)';
        ctx.lineWidth = c.width * (0.5 + ratio * 0.7);
        ctx.stroke();
      }
    }
    if (b.hitFlash > 0) {
      tracePoly(ctx, b.poly);
      ctx.fillStyle = `rgba(255, 220, 180, ${b.hitFlash * 0.45})`;
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawGround(now) {
  const { rs } = view;
  // 지도 밖은 투명하게 두어 뒤의 하늘이 보이게 함
  ctx.setTransform(rs, 0, 0, rs, 0, 0);
  ctx.clearRect(0, 0, view.cw, view.ch);

  const cos = Math.cos(view.heading) * view.scale * rs;
  const sin = Math.sin(view.heading) * view.scale * rs;
  ctx.setTransform(cos, sin, -sin, cos, rs * view.ox, rs * view.oy);
  ctx.drawImage(img, 0, 0, IMG_W, IMG_H);

  for (const d of decals) {
    const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
    g.addColorStop(0, 'rgba(15, 10, 5, 0.6)');
    g.addColorStop(1, 'rgba(15, 10, 5, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const b of buildings) drawBuildingDamage(b);

  // 땅에 퍼지는 충격파
  for (const rg of rings) {
    const k = (now - rg.start) / rg.dur;
    ctx.beginPath();
    ctx.arc(rg.x, rg.y, rg.r * easeOut(k), 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2 / view.scale, rg.r * 0.06 * (1 - k));
    ctx.strokeStyle = `rgba(255, 245, 220, ${(1 - k) * 0.8})`;
    ctx.stroke();
  }

  // 땅에 찍히는 조준 표시
  for (const p of projectiles) {
    if (p.impacted) continue;
    const r = (16 + 4 * Math.sin(now / 90)) / view.scale;
    ctx.save();
    ctx.translate(p.wx, p.wy);
    ctx.rotate(now / 300);
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.95)';
    ctx.lineWidth = 3 / view.scale;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    for (let i = 0; i < 4; i++) {
      ctx.moveTo(r * 0.6, 0);
      ctx.lineTo(r * 1.5, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.stroke();
    ctx.restore();
  }
}

/* ---------- 화면(효과) 그리기 ---------- */
function drawBomb(c, size, rot) {
  c.save();
  c.scale(size, size);
  c.rotate(rot);
  c.fillStyle = '#374151';
  c.beginPath();
  c.moveTo(-7, -14);
  c.lineTo(-11, -24);
  c.lineTo(11, -24);
  c.lineTo(7, -14);
  c.fill();
  c.fillStyle = '#111827';
  c.beginPath();
  c.ellipse(0, 0, 11, 16, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255, 255, 255, 0.35)';
  c.beginPath();
  c.ellipse(-4, -5, 3, 6, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function drawMissile(c, size, angle) {
  c.save();
  c.scale(size, size);
  c.rotate(angle);
  c.fillStyle = `rgba(255, ${150 + Math.random() * 80}, 40, 0.95)`;
  c.beginPath();
  c.moveTo(-16, -5);
  c.lineTo(-30 - Math.random() * 12, 0);
  c.lineTo(-16, 5);
  c.fill();
  c.fillStyle = '#e5e7eb';
  c.fillRect(-16, -5, 28, 10);
  c.fillStyle = '#dc2626';
  c.beginPath();
  c.moveTo(12, -5);
  c.lineTo(22, 0);
  c.lineTo(12, 5);
  c.fill();
  c.fillStyle = '#6b7280';
  c.fillRect(-16, -10, 7, 20);
  c.restore();
}

function drawProjectile(p, now) {
  const t = now - p.start;
  const k = clamp(t / p.flight, 0, 1);
  const id = p.weapon.id;

  // 연기/불꽃 꼬리
  for (const tr of p.trail) {
    const a = 1 - (now - tr.born) / 450;
    const r = (id === 'meteor' ? 14 : 7) * tr.size * (1.6 - a * 0.6);
    fx.fillStyle = id === 'meteor' ? `rgba(255, 130, 40, ${a * 0.5})` : `rgba(230, 230, 230, ${a * 0.5})`;
    fx.beginPath();
    fx.arc(tr.x, tr.y, r, 0, Math.PI * 2);
    fx.fill();
  }

  if (id === 'laser') {
    const tp = project(p.wx, p.wy);
    const sx = tp.x;
    const sy = 26;
    fx.save();
    fx.translate(sx, sy);
    fx.fillStyle = '#1e3a8a';
    fx.fillRect(-30, -6, 20, 12);
    fx.fillRect(10, -6, 20, 12);
    fx.strokeStyle = '#93c5fd';
    fx.lineWidth = 1;
    fx.strokeRect(-30, -6, 20, 12);
    fx.strokeRect(10, -6, 20, 12);
    fx.fillStyle = '#e5e7eb';
    fx.fillRect(-9, -9, 18, 18);
    fx.fillStyle = '#ef4444';
    fx.beginPath();
    fx.arc(0, 10, 4, 0, Math.PI * 2);
    fx.fill();
    fx.restore();

    if (!p.impacted) {
      fx.strokeStyle = `rgba(255, 80, 80, ${0.3 + 0.4 * Math.sin(now / 40) ** 2})`;
      fx.lineWidth = 1.5;
      fx.setLineDash([6, 6]);
      fx.beginPath();
      fx.moveTo(sx, sy + 12);
      fx.lineTo(tp.x, tp.y);
      fx.stroke();
      fx.setLineDash([]);
    } else if (t < p.life) {
      const fk = (t - p.flight) / (p.life - p.flight);
      const width = 16 * (1 - fk) + 2;
      const g = fx.createLinearGradient(sx - width, 0, sx + width, 0);
      g.addColorStop(0, 'rgba(255, 0, 0, 0)');
      g.addColorStop(0.5, 'rgba(255, 60, 60, 0.9)');
      g.addColorStop(1, 'rgba(255, 0, 0, 0)');
      fx.fillStyle = g;
      fx.fillRect(sx - width, sy + 12, width * 2, tp.y - sy - 12);
      fx.fillStyle = `rgba(255, 255, 255, ${0.9 * (1 - fk)})`;
      fx.fillRect(sx - width * 0.18, sy + 12, width * 0.36, tp.y - sy - 12);
      fx.fillStyle = `rgba(255, 220, 220, ${1 - fk})`;
      fx.beginPath();
      fx.arc(tp.x, tp.y, width * 1.2, 0, Math.PI * 2);
      fx.fill();
    }
    return;
  }

  if (p.impacted) return;
  const s = projectileScreen(p, k);

  // 바닥 그림자(땅에 가까울수록 진해짐) - 폭탄·미사일만
  if (id === 'bomb' || id === 'missile') {
    const tp = project(p.wx, p.wy);
    fx.fillStyle = `rgba(0, 0, 0, ${0.15 + 0.35 * k})`;
    fx.beginPath();
    fx.ellipse(lerp(s.x, tp.x, 0.5 + k * 0.5), tp.y, 12 * s.size, 5 * s.size, 0, 0, Math.PI * 2);
    fx.fill();
  }

  fx.save();
  fx.translate(s.x, s.y);
  if (id === 'bomb') {
    drawBomb(fx, s.size, p.spin * k * Math.PI * 3);
  } else if (id === 'missile') {
    const n = projectileScreen(p, Math.min(1, k + 0.02));
    drawMissile(fx, s.size, Math.atan2(n.y - s.y, n.x - s.x));
  } else if (id === 'nuke') {
    fx.scale(s.size, s.size);
    fx.rotate(Math.sin(now / 150) * 0.08);
    fx.fillStyle = '#4b5563';
    fx.fillRect(-10, -36, 20, 12);
    fx.fillStyle = '#facc15';
    fx.beginPath();
    fx.ellipse(0, 0, 16, 26, 0, 0, Math.PI * 2);
    fx.fill();
    fx.fillStyle = '#111';
    fx.font = 'bold 20px sans-serif';
    fx.textAlign = 'center';
    fx.textBaseline = 'middle';
    fx.fillText('☢', 0, 2);
  } else if (id === 'meteor') {
    fx.scale(s.size, s.size);
    const glow = fx.createRadialGradient(0, 0, 4, 0, 0, 36);
    glow.addColorStop(0, 'rgba(255, 220, 120, 0.95)');
    glow.addColorStop(0.5, 'rgba(255, 120, 30, 0.6)');
    glow.addColorStop(1, 'rgba(255, 60, 0, 0)');
    fx.fillStyle = glow;
    fx.beginPath();
    fx.arc(0, 0, 36, 0, Math.PI * 2);
    fx.fill();
    fx.fillStyle = '#57534e';
    fx.beginPath();
    fx.arc(0, 0, 15, 0, Math.PI * 2);
    fx.fill();
    fx.fillStyle = '#292524';
    fx.beginPath();
    fx.arc(-5, -3, 4, 0, Math.PI * 2);
    fx.arc(5, 5, 3, 0, Math.PI * 2);
    fx.fill();
  }
  fx.restore();
}

function drawEffects(now) {
  // 폭발 불덩이: 땅 위로 솟아 보이게 화면 기준으로 그림
  for (const bl of blasts) {
    const k = (now - bl.start) / bl.dur;
    const p = project(bl.x, bl.y);
    const r = bl.r * p.k * (0.35 + 0.65 * easeOut(k));
    const cy = p.y - r * 0.45;
    const a = 1 - k;
    const g = fx.createRadialGradient(p.x, cy, 0, p.x, cy, r);
    g.addColorStop(0, `rgba(255, 255, 230, ${a})`);
    g.addColorStop(0.35, `rgba(255, 200, 60, ${a * 0.95})`);
    g.addColorStop(0.7, `rgba(240, 90, 20, ${a * 0.7})`);
    g.addColorStop(1, 'rgba(120, 30, 10, 0)');
    fx.fillStyle = g;
    fx.beginPath();
    fx.arc(p.x, cy, r, 0, Math.PI * 2);
    fx.fill();
  }

  for (const pt of particles) {
    const p = project(pt.x, pt.y);
    const x = p.x;
    const y = p.y - pt.z * p.k;
    const a = clamp(pt.life / pt.max, 0, 1);
    const size = pt.size * p.k;
    if (pt.kind === 'smoke') {
      fx.fillStyle = `rgba(${pt.color}, ${a * 0.45})`;
      fx.beginPath();
      fx.arc(x, y, size, 0, Math.PI * 2);
      fx.fill();
    } else {
      const sz = Math.max(1.5, size);
      fx.globalAlpha = a;
      fx.fillStyle = pt.color;
      fx.fillRect(x - sz / 2, y - sz / 2, sz, sz);
      fx.globalAlpha = 1;
    }
  }

  // 체력바: 맞은 직후 또는 마우스를 올린 건물
  for (const b of buildings) {
    if (b.destroyed || (now > b.showHpUntil && b !== hoverBuilding)) continue;
    const p = project(b.cx, b.minY);
    const w = 70;
    const h = 8;
    const ratio = b.hp / b.maxHp;
    const bx = p.x - w / 2;
    const by = Math.max(22, p.y - 14);
    fx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    fx.fillRect(bx - 2, by - 18, w + 4, h + 20);
    fx.fillStyle = '#334155';
    fx.fillRect(bx, by, w, h);
    fx.fillStyle = ratio > 0.6 ? '#22c55e' : ratio > 0.3 ? '#eab308' : '#ef4444';
    fx.fillRect(bx, by, w * ratio, h);
    fx.fillStyle = '#fff';
    fx.font = 'bold 11px sans-serif';
    fx.textAlign = 'center';
    fx.textBaseline = 'alphabetic';
    fx.fillText(`${b.hp} / ${b.maxHp}`, p.x, by - 5);
  }

  for (const p of projectiles) drawProjectile(p, now);

  for (const t of texts) {
    const k = (now - t.start) / t.dur;
    if (k < 0) continue;
    const p = project(t.wx, t.wy);
    fx.globalAlpha = 1 - k * k;
    fx.font = `900 ${t.size}px sans-serif`;
    fx.textAlign = 'center';
    fx.textBaseline = 'middle';
    fx.lineWidth = 4;
    fx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    fx.strokeText(t.text, p.x, p.y - 20 - 40 * k);
    fx.fillStyle = t.color;
    fx.fillText(t.text, p.x, p.y - 20 - 40 * k);
    fx.globalAlpha = 1;
  }
}

function render(now) {
  let sx = 0;
  let sy = 0;
  if (shake) {
    const k = (now - shake.start) / shake.dur;
    if (k >= 1) shake = null;
    else {
      sx = rand(-1, 1) * shake.amp * (1 - k);
      sy = rand(-1, 1) * shake.amp * (1 - k);
    }
  }
  worldEl.style.transform = sx || sy ? `translate(${sx}px, ${sy}px)` : '';

  drawGround(now);

  const { dpr } = view;
  fx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fx.clearRect(0, 0, view.w, view.h);
  drawEffects(now);

  if (flash) {
    const k = (now - flash.start) / flash.dur;
    if (k >= 1) flash = null;
    else {
      const a = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
      fx.fillStyle = `rgba(255, 250, 235, ${a * 0.9})`;
      fx.fillRect(-50, -50, view.w + 100, view.h + 100);
    }
  }
}

function frame(now) {
  const dt = Math.min(50, now - last) / 1000;
  last = now;
  update(now, dt);
  render(now);
  requestAnimationFrame(frame);
}

/* =========================================================
 * 시작
 * ========================================================= */
function resetGame() {
  createBuildings();
  uses = Object.fromEntries(WEAPONS.map((w) => [w.id, USES_PER_WEAPON]));
  selectedId = WEAPONS[0].id;
  score = 0;
  totalDamage = 0;
  totalBonus = 0;
  destroyedCount = 0;
  gameOver = false;
  gameOverAt = 0;
  projectiles = [];
  blasts = [];
  rings = [];
  particles = [];
  decals = [];
  texts = [];
  shake = null;
  flash = null;
  resultEl.classList.add('hidden');
  resetCamera();
  updateUI();
  showToast('무기를 고르고 건물을 터치하세요!', 2500);
}

buildWeaponButtons();
img.onload = () => {
  document.getElementById('loading').classList.add('hidden');
  resize();
  resetGame();
  requestAnimationFrame(frame);
};
img.onerror = () => {
  document.getElementById('loading').textContent = `${IMG_SRC} 파일을 찾을 수 없어요. index.html과 같은 폴더에 두세요.`;
};
img.src = IMG_SRC;
