// ============================================================
//  교차로 대전 — 로블록스 라이벌 스타일 FPS
//  무기: 돌격소총 / 샷건 / 저격소총 / RPG / 얼음 광선 / 수류탄
// ============================================================
import * as THREE from 'three';

// ------------------------------------------------------------
// 기본 설정
// ------------------------------------------------------------
const WIN_SCORE = 25;
const GRAVITY = 26;
const STEP_HEIGHT = 0.62;

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c5eb);
scene.fog = new THREE.Fog(0x87c5eb, 90, 190);

const BASE_FOV = 75, ZOOM_FOV = 20;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.08, 400);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 조명
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x7a8a5a, 0.85));
const sun = new THREE.DirectionalLight(0xfff3d6, 1.35);
sun.position.set(45, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -75; sun.shadow.camera.right = 75;
sun.shadow.camera.top = 75; sun.shadow.camera.bottom = -75;
sun.shadow.camera.far = 200;
scene.add(sun);

// ------------------------------------------------------------
// 간단 효과음 (WebAudio 합성 — 외부 파일 불필요)
// ------------------------------------------------------------
let AC = null;
function audio() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); return AC; }
function envGain(t0, peak, dur) {
  const g = audio().createGain();
  g.gain.setValueAtTime(peak, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(audio().destination);
  return g;
}
function noiseBurst(dur, peak, filterHz) {
  const ac = audio(), t0 = ac.currentTime;
  const len = Math.floor(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ac.createBufferSource(); src.buffer = buf;
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz;
  src.connect(f); f.connect(envGain(t0, peak, dur));
  src.start(t0);
}
function tone(freq, dur, peak, type = 'square', slideTo = null) {
  const ac = audio(), t0 = ac.currentTime;
  const o = ac.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  o.connect(envGain(t0, peak, dur));
  o.start(t0); o.stop(t0 + dur);
}
const SFX = {
  ar:      () => { noiseBurst(0.09, 0.25, 2600); tone(190, 0.06, 0.12, 'square', 90); },
  shotgun: () => { noiseBurst(0.22, 0.45, 1400); tone(120, 0.14, 0.2, 'square', 55); },
  sniper:  () => { noiseBurst(0.3, 0.4, 3200); tone(240, 0.2, 0.15, 'sawtooth', 60); },
  rpg:     () => { noiseBurst(0.35, 0.35, 900); tone(90, 0.3, 0.2, 'sawtooth', 40); },
  ice:     () => { tone(950 + Math.random() * 250, 0.08, 0.05, 'sine', 1400); },
  throwG:  () => { tone(300, 0.1, 0.1, 'sine', 500); },
  boom:    () => { noiseBurst(0.6, 0.6, 500); tone(70, 0.5, 0.35, 'sine', 28); },
  hit:     () => { tone(1000, 0.06, 0.12, 'square', 700); },
  kill:    () => { tone(600, 0.09, 0.15, 'square'); setTimeout(() => tone(900, 0.12, 0.15, 'square'), 90); },
  hurt:    () => { tone(160, 0.15, 0.2, 'sawtooth', 90); },
  reload:  () => { tone(400, 0.07, 0.1, 'square', 250); },
  freeze:  () => { tone(1300, 0.35, 0.12, 'sine', 300); },
  step:    () => { noiseBurst(0.05, 0.05, 700); },
};

// ------------------------------------------------------------
// 맵: "교차로" — 두 도로가 십자로 교차하는 대칭 맵
// ------------------------------------------------------------
const colliders = []; // THREE.Box3 목록 (총알/이동 충돌용)
const mat = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough });

function addBox(w, h, d, x, y, z, material, { collide = true, shadow = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  scene.add(m);
  if (collide) colliders.push(new THREE.Box3(
    new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
    new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)));
  return m;
}

function buildMap() {
  const grass = mat(0x6fae4a), road = mat(0x54555c), curb = mat(0x9fa3ab);
  const crate = mat(0xb98a4d), crateTop = mat(0xa1723a);

  // 바닥 (잔디)
  const ground = new THREE.Mesh(new THREE.BoxGeometry(130, 1, 130), grass);
  ground.position.y = -0.5; ground.receiveShadow = true; scene.add(ground);

  // 십자 도로
  addBox(130, 0.12, 13, 0, 0.06, 0, road, { collide: false, shadow: false });
  addBox(13, 0.1, 130, 0, 0.05, 0, road, { collide: false, shadow: false }); // 살짝 낮게(겹침 깜빡임 방지)
  // 도로 중앙 점선
  const lineM = mat(0xe8e6df);
  for (let i = -60; i <= 60; i += 6) {
    if (Math.abs(i) < 8) continue;
    addBox(2.4, 0.14, 0.28, i, 0.09, 0, lineM, { collide: false, shadow: false });
    addBox(0.28, 0.14, 2.4, 0, 0.09, i, lineM, { collide: false, shadow: false });
  }

  // 코너 건물 4개 (지붕에 올라갈 수 있음)
  const bColors = [0xd96a6a, 0x6a8dd9, 0xd9b26a, 0x7ac47a];
  const roofM = mat(0x555061);
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sz], i) => {
    const bx = 23 * sx, bz = 23 * sz;
    addBox(16, 4.6, 16, bx, 2.3, bz, mat(bColors[i]));          // 본체
    addBox(17, 0.5, 17, bx, 4.85, bz, roofM);                    // 지붕 테두리
    // 창문 (장식)
    const winM = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.2, metalness: 0.4 });
    for (const wz of [-4, 0, 4]) {
      addBox(0.15, 1.6, 2.2, bx - 8.05 * sx, 2.6, bz + wz, winM, { collide: false });
      addBox(2.2, 1.6, 0.15, bx + wz, 2.6, bz - 8.05 * sz, winM, { collide: false });
    }
  });

  // 각 건물 앞(교차로 중심 방향)에 지붕으로 오르는 직선 계단
  const stepM = mat(0x8d8f96);
  [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sz]) => {
    const bx = 23 * sx, bz = 23 * sz;
    for (let s = 0; s < 9; s++) {
      const h = 0.5 * (s + 1);
      // 위로 갈수록 건물 벽면(z = bz - 8*sz)에 가까워지도록 배치
      const z = bz - sz * (8.55 + 1.05 * (8 - s));
      addBox(3, h, 1.05, bx - sx * 4, h / 2, z, stepM);
    }
  });

  // 중앙 교차점의 점령 플랫폼
  const platM = mat(0xc9c3b8);
  addBox(10, 1.1, 10, 0, 0.55, 0, platM);
  addBox(3.4, 0.5, 2.2, 0, 0.25, 6.1, stepM);
  addBox(3.4, 0.5, 2.2, 0, 0.25, -6.1, stepM);
  addBox(2.2, 0.5, 3.4, 6.1, 0.25, 0, stepM);
  addBox(2.2, 0.5, 3.4, -6.1, 0.25, 0, stepM);
  // 플랫폼 위 장식 깃발
  const poleM = mat(0x777777, 0.4);
  addBox(0.18, 4, 0.18, 0, 3.1, 0, poleM, { collide: false });
  addBox(2, 1.1, 0.1, 1.05, 4.4, 0, new THREE.MeshStandardMaterial({ color: 0xffd34d, roughness: 0.7, side: THREE.DoubleSide }), { collide: false });

  // 도로 위 엄폐물 (상자들)
  const cratesAt = [
    [7, -14], [-7, 14], [14, 7], [-14, -7],
    [4, -30], [-4, 30], [30, 4], [-30, -4],
    [8, 33], [-8, -33], [33, -8], [-33, 8],
    [3, -44], [-3, 44], [44, 3], [-44, -3],
  ];
  cratesAt.forEach(([x, z], i) => {
    addBox(1.7, 1.7, 1.7, x, 0.85, z, crate);
    if (i % 3 === 0) addBox(1.7, 1.7, 1.7, x, 2.55, z, crateTop);      // 2단
    if (i % 4 === 0) addBox(1.7, 1.7, 1.7, x + 1.75, 0.85, z, crateTop); // 옆 붙임
  });

  // 외곽 벽
  const wallM = mat(0x7d8290);
  addBox(132, 6, 2, 0, 3, -65, wallM);
  addBox(132, 6, 2, 0, 3, 65, wallM);
  addBox(2, 6, 132, -65, 3, 0, wallM);
  addBox(2, 6, 132, 65, 3, 0, wallM);

  // 가로등 (장식)
  const lampM = mat(0x3d3f45, 0.5);
  [[8.5, 8.5], [-8.5, 8.5], [8.5, -8.5], [-8.5, -8.5]].forEach(([x, z]) => {
    addBox(0.25, 5, 0.25, x, 2.5, z, lampM, { collide: false });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffe27a, emissiveIntensity: 0.9 }));
    bulb.position.set(x, 5.1, z); scene.add(bulb);
  });

  // 잔디 지역 나무들 (장식)
  const trunkM = mat(0x7a5230), leafM = mat(0x3f8f3f);
  [[40, 40], [45, 32], [32, 45], [-40, 40], [-45, 32], [-32, -45], [40, -40], [-40, -38], [-33, 44], [36, -47]].forEach(([x, z]) => {
    addBox(0.7, 3, 0.7, x, 1.5, z, trunkM, { collide: false });
    const leaf = new THREE.Mesh(new THREE.DodecahedronGeometry(2.2, 0), leafM);
    leaf.position.set(x, 4.2, z); leaf.castShadow = true; scene.add(leaf);
  });
}
buildMap();

// ------------------------------------------------------------
// 로블록스 스타일 블록 캐릭터
// ------------------------------------------------------------
function makeFaceTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f5c542'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1a1a1a';
  g.beginPath(); g.ellipse(42, 52, 9, 13, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(86, 52, 9, 13, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.arc(64, 68, 26, Math.PI * 0.18, Math.PI * 0.82); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const FACE_TEX = makeFaceTexture();
const SKIN = 0xf5c542;

function makeCharacterMesh(team) {
  const shirt = team === 'blue' ? 0x2b6df2 : 0xe33b3b;
  const pants = team === 'blue' ? 0x1c3f8f : 0x8f1c1c;
  const g = new THREE.Group();
  const box = (w, h, d, color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, 0.75));
    m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  };
  box(0.42, 0.85, 0.42, pants, -0.23, 0.425, 0); // 다리
  box(0.42, 0.85, 0.42, pants, 0.23, 0.425, 0);
  box(1.0, 0.95, 0.5, shirt, 0, 1.325, 0);        // 몸통
  const armL = box(0.38, 0.9, 0.38, SKIN, -0.71, 1.35, 0);
  const armR = box(0.38, 0.9, 0.38, SKIN, 0.71, 1.35, 0);
  // 머리 (앞면에 얼굴)
  const headMats = [];
  for (let i = 0; i < 6; i++) headMats.push(mat(SKIN, 0.7));
  headMats[4] = new THREE.MeshStandardMaterial({ map: FACE_TEX, roughness: 0.7 }); // +z 앞면
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.72), headMats);
  head.position.set(0, 2.18, 0); head.castShadow = true; g.add(head);

  // 이름표 + 체력바 스프라이트
  const tagCanvas = document.createElement('canvas'); tagCanvas.width = 256; tagCanvas.height = 64;
  const tagTex = new THREE.CanvasTexture(tagCanvas);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, depthTest: false }));
  tag.scale.set(2.1, 0.52, 1); tag.position.set(0, 2.95, 0);
  g.add(tag);

  // 얼음 (빙결 시 표시)
  const ice = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.7, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.55, roughness: 0.1 }));
  ice.position.y = 1.35; ice.visible = false; g.add(ice);

  return { group: g, armL, armR, head, tagCanvas, tagTex, ice };
}

function drawTag(bot) {
  const g = bot.parts.tagCanvas.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.font = 'bold 26px sans-serif'; g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(28, 2, 200, 32);
  g.fillStyle = bot.team === 'blue' ? '#7db0ff' : '#ff8585';
  g.fillText(bot.name, 128, 27);
  g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(48, 42, 160, 12);
  g.fillStyle = '#57e04b'; g.fillRect(50, 44, 156 * Math.max(0, bot.hp) / 100, 8);
  bot.parts.tagTex.needsUpdate = true;
}

// ------------------------------------------------------------
// 충돌 처리 유틸
// ------------------------------------------------------------
const _box = new THREE.Box3();
function groundHeightAt(x, z, feetY, r) {
  let gy = 0;
  for (const b of colliders) {
    if (x + r < b.min.x || x - r > b.max.x || z + r < b.min.z || z - r > b.max.z) continue;
    if (b.max.y <= feetY + STEP_HEIGHT && b.max.y > gy) gy = b.max.y;
  }
  return gy;
}
function resolveHorizontal(pos, r, h) {
  for (const b of colliders) {
    if (b.max.y <= pos.y + STEP_HEIGHT) continue;     // 밟고 올라설 수 있는 높이는 무시
    if (b.min.y >= pos.y + h) continue;               // 머리 위
    const ox = Math.min(pos.x + r - b.min.x, b.max.x - (pos.x - r));
    const oz = Math.min(pos.z + r - b.min.z, b.max.z - (pos.z - r));
    if (ox <= 0 || oz <= 0) continue;
    if (ox < oz) pos.x += (pos.x < (b.min.x + b.max.x) / 2 ? -ox : ox);
    else pos.z += (pos.z < (b.min.z + b.max.z) / 2 ? -oz : oz);
  }
  pos.x = Math.max(-63, Math.min(63, pos.x));
  pos.z = Math.max(-63, Math.min(63, pos.z));
}
const _ray = new THREE.Ray();
const _v1 = new THREE.Vector3();
function raycastWorld(origin, dir, maxDist) {
  _ray.origin.copy(origin); _ray.direction.copy(dir);
  let best = maxDist;
  for (const b of colliders) {
    const p = _ray.intersectBox(b, _v1);
    if (p) { const d = p.distanceTo(origin); if (d < best) best = d; }
  }
  // 바닥
  if (dir.y < -1e-6) {
    const d = -origin.y / dir.y;
    if (d > 0 && d < best) best = d;
  }
  return best;
}
// ------------------------------------------------------------
// HUD 참조
// ------------------------------------------------------------
const $ = id => document.getElementById(id);
const hud = {
  healthBar: $('health-bar'), healthNum: $('health-num'),
  weaponName: $('weapon-name'), ammoCount: $('ammo-count'), reloadHint: $('reload-hint'),
  slots: $('weapon-slots'), scoreBlue: $('score-blue'), scoreRed: $('score-red'),
  killfeed: $('killfeed'), centerMsg: $('center-msg'), hitmarker: $('hitmarker'),
  vignette: $('damage-vignette'), scope: $('scope'), crosshair: $('crosshair'),
  freezeTint: $('freeze-tint'),
};

function showCenterMsg(text, ms = 2000) {
  hud.centerMsg.innerHTML = text;
  hud.centerMsg.style.opacity = 1;
  clearTimeout(showCenterMsg._t);
  showCenterMsg._t = setTimeout(() => hud.centerMsg.style.opacity = 0, ms);
}
function addKillFeed(killerName, killerTeam, victimName, victimTeam, weapon) {
  const item = document.createElement('div');
  item.className = 'kf-item';
  item.innerHTML = `<span class="${killerTeam}">${killerName}</span> ${weapon} <span class="${victimTeam}">${victimName}</span>`;
  hud.killfeed.prepend(item);
  while (hud.killfeed.children.length > 5) hud.killfeed.lastChild.remove();
  setTimeout(() => item.remove(), 5000);
}
let hitmarkerTimer = null;
function showHitmarker(kill) {
  hud.hitmarker.classList.toggle('kill', !!kill);
  hud.hitmarker.style.opacity = 1;
  clearTimeout(hitmarkerTimer);
  hitmarkerTimer = setTimeout(() => hud.hitmarker.style.opacity = 0, 120);
  SFX.hit();
}

// ------------------------------------------------------------
// 무기 정의
// ------------------------------------------------------------
const WEAPONS = [
  { id: 'ar',      name: '돌격소총',   mag: 30,  interval: 0.1,  reload: 1.6, dmg: 8,  spread: 0.02, auto: true,  range: 120 },
  { id: 'shotgun', name: '샷건',       mag: 6,   interval: 0.85, reload: 2.2, dmg: 7,  spread: 0.065, auto: false, range: 45, pellets: 8 },
  { id: 'sniper',  name: '저격소총',   mag: 5,   interval: 1.35, reload: 2.4, dmg: 90, spread: 0.0,  auto: false, range: 250, zoom: true },
  { id: 'rpg',     name: 'RPG',        mag: 1,   interval: 0.5,  reload: 2.6, dmg: 95, spread: 0.0,  auto: false, projectile: 'rocket' },
  { id: 'ice',     name: '얼음 광선',  mag: 100, interval: 0.055, reload: 1.8, dmg: 1.3, spread: 0.01, auto: true, range: 38, beam: true },
  { id: 'grenade', name: '수류탄',     mag: 1,   interval: 0.4,  reload: 1.7, dmg: 100, spread: 0.0, auto: false, projectile: 'grenade' },
];

// 무기 뷰모델 (1인칭 블록 모델)
function makeViewModel(id) {
  const g = new THREE.Group();
  const box = (w, h, d, color, x, y, z, rough = 0.5) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, rough));
    m.position.set(x, y, z); g.add(m); return m;
  };
  // 로블록스 팔뚝
  box(0.13, 0.13, 0.42, SKIN, 0.05, -0.06, 0.12, 0.75);
  const DARK = 0x2e3138, GRAY = 0x6b7078, WOOD = 0x8a5a2e;
  if (id === 'ar') {
    box(0.07, 0.1, 0.55, DARK, 0, 0, -0.15);
    box(0.06, 0.06, 0.3, GRAY, 0, 0.0, -0.5);
    box(0.05, 0.16, 0.1, DARK, 0, -0.11, 0.02);      // 탄창
    box(0.06, 0.05, 0.12, DARK, 0, 0.07, -0.05);     // 조준기
  } else if (id === 'shotgun') {
    box(0.09, 0.11, 0.5, WOOD, 0, 0, -0.1);
    box(0.07, 0.07, 0.45, DARK, 0, 0.03, -0.45);
    box(0.07, 0.06, 0.2, WOOD, 0, -0.07, -0.35);     // 펌프
  } else if (id === 'sniper') {
    box(0.07, 0.1, 0.6, 0x274d33, 0, 0, -0.1);
    box(0.05, 0.05, 0.55, DARK, 0, 0.01, -0.6);
    box(0.06, 0.08, 0.22, DARK, 0, 0.1, -0.15);      // 스코프
    box(0.05, 0.14, 0.08, DARK, 0, -0.1, 0.05);
  } else if (id === 'rpg') {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.9, 12), mat(0x4d5a3a, 0.6));
    tube.rotation.x = Math.PI / 2; tube.position.set(0, 0.02, -0.2); g.add(tube);
    const warhead = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 12), mat(0xb03a2e, 0.5));
    warhead.rotation.x = -Math.PI / 2; warhead.position.set(0, 0.02, -0.75); g.add(warhead);
  } else if (id === 'ice') {
    box(0.1, 0.12, 0.42, 0x2f7fb8, 0, 0, -0.1);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.09),
      new THREE.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0x62b8ff, emissiveIntensity: 0.7, roughness: 0.15 }));
    crystal.position.set(0, 0.03, -0.42); g.add(crystal);
    box(0.05, 0.05, 0.2, 0x9fdcff, 0, 0.09, -0.2, 0.2);
  } else if (id === 'grenade') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), mat(0x3d6b35, 0.6));
    body.position.set(0, -0.02, -0.18); g.add(body);
    box(0.05, 0.07, 0.05, GRAY, 0, 0.09, -0.18);
  }
  return g;
}

// ------------------------------------------------------------
// 플레이어
// ------------------------------------------------------------
const player = {
  name: '나', team: 'blue',
  pos: new THREE.Vector3(0, 0, -50),
  vel: new THREE.Vector3(),
  yaw: Math.PI, pitch: 0, // 맵 중앙(+z)을 바라보고 시작
  hp: 100, alive: true, onGround: true,
  weaponIdx: 0,
  ammo: WEAPONS.map(w => w.mag),
  reloading: 0, fireCooldown: 0, lastDamagedAt: -99,
  zoomed: false, recoil: 0, bobT: 0,
};

// 뷰모델 장착
const viewRoot = new THREE.Group();
camera.add(viewRoot);
scene.add(camera);
const viewModels = WEAPONS.map(w => {
  const m = makeViewModel(w.id);
  m.visible = false;
  viewRoot.add(m);
  return m;
});
viewRoot.position.set(0.32, -0.3, -0.55);

function switchWeapon(idx) {
  if (idx === player.weaponIdx || !player.alive) return;
  player.weaponIdx = idx;
  player.reloading = 0;
  player.fireCooldown = Math.max(player.fireCooldown, 0.25);
  stopBeam();
  viewModels.forEach((m, i) => m.visible = i === idx);
  setZoom(false);
  updateWeaponHUD();
}

function updateWeaponHUD() {
  const w = WEAPONS[player.weaponIdx];
  hud.weaponName.textContent = w.name;
  const a = Math.ceil(player.ammo[player.weaponIdx]);
  hud.ammoCount.innerHTML = `${a} <small>/ ∞</small>`;
  hud.reloadHint.textContent = player.reloading > 0 ? '재장전 중...' : (a === 0 ? 'R키로 재장전!' : '');
  [...hud.slots.children].forEach((el, i) => el.classList.toggle('active', i === player.weaponIdx));
}
WEAPONS.forEach((w, i) => {
  const el = document.createElement('div');
  el.className = 'wslot';
  el.innerHTML = `<b>${i + 1}</b>${w.name}`;
  hud.slots.appendChild(el);
});

function setZoom(on) {
  player.zoomed = on;
  camera.fov = on ? ZOOM_FOV : BASE_FOV;
  camera.updateProjectionMatrix();
  hud.scope.style.display = on ? 'block' : 'none';
  hud.crosshair.style.display = on ? 'none' : 'block';
  viewRoot.visible = !on;
}

// ------------------------------------------------------------
// 봇
// ------------------------------------------------------------
const WAYPOINTS = [
  [0, 0], [0, 15], [0, -15], [15, 0], [-15, 0],
  [0, 32], [0, -32], [32, 0], [-32, 0],
  [0, 48], [0, -48], [48, 0], [-48, 0],
  [4, 12], [-4, -12], [12, -4], [-12, 4],
];
const bots = [];
const BOT_DEFS = [
  { name: '용감한기사', team: 'blue', weapon: 'ar' },
  { name: '피자소년',   team: 'blue', weapon: 'shotgun' },
  { name: '어둠의닌자', team: 'red',  weapon: 'ar' },
  { name: '킹크랩',     team: 'red',  weapon: 'shotgun' },
  { name: '번개늑대',   team: 'red',  weapon: 'ar' },
];
function spawnPointFor(team) {
  const z = team === 'blue' ? -50 : 50;
  return new THREE.Vector3((Math.random() - 0.5) * 8, 0, z + (Math.random() - 0.5) * 6);
}
function makeBot(def) {
  const parts = makeCharacterMesh(def.team);
  scene.add(parts.group);
  const bot = {
    ...def, parts,
    pos: spawnPointFor(def.team), vel: new THREE.Vector3(),
    hp: 100, alive: true, onGround: true,
    target: null, waypoint: null, repathT: 0,
    fireT: 1 + Math.random() * 2, strafeDir: 1, strafeT: 0,
    freeze: 0, frozenT: 0, respawnT: 0, yaw: 0,
  };
  drawTag(bot);
  return bot;
}
BOT_DEFS.forEach(d => bots.push(makeBot(d)));

const score = { blue: 0, red: 0 };

// ------------------------------------------------------------
// 이펙트: 파티클 / 트레이서 / 폭발 / 투사체
// ------------------------------------------------------------
const effects = [];   // {mesh, vel?, life, maxLife, kind}
const projectiles = []; // {mesh, vel, kind, owner, life, trailT}

function spawnParticles(pos, color, count, speed, life = 0.6, size = 0.12, gravity = true) {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size),
      new THREE.MeshBasicMaterial({ color }));
    m.position.copy(pos);
    const v = new THREE.Vector3((Math.random() - 0.5), Math.random() * 0.9, (Math.random() - 0.5))
      .normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
    scene.add(m);
    effects.push({ mesh: m, vel: v, life, maxLife: life, kind: 'particle', gravity });
  }
}
function spawnTracer(from, to, color = 0xffe38a) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, len),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  m.position.copy(from).addScaledVector(dir.normalize(), len / 2);
  m.lookAt(to);
  scene.add(m);
  effects.push({ mesh: m, life: 0.07, maxLife: 0.07, kind: 'tracer' });
}
function spawnBeamSegment(from, to) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, len, 8),
    new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.75 }));
  m.position.copy(from).addScaledVector(dir.clone().normalize(), len / 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  scene.add(m);
  effects.push({ mesh: m, life: 0.06, maxLife: 0.06, kind: 'tracer' });
}
let shakeAmp = 0;
function explode(pos, radius, maxDmg, attacker) {
  SFX.boom();
  // 폭발 시각 효과
  const flash = new THREE.PointLight(0xffb347, 60, radius * 3.5);
  flash.position.copy(pos); scene.add(flash);
  effects.push({ mesh: flash, life: 0.25, maxLife: 0.25, kind: 'light' });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa940, transparent: true, opacity: 0.9 }));
  ball.position.copy(pos); scene.add(ball);
  effects.push({ mesh: ball, life: 0.35, maxLife: 0.35, kind: 'boomball', targetR: radius * 0.8 });
  spawnParticles(pos, 0xff8c42, 26, 12, 0.9, 0.2);
  spawnParticles(pos, 0x555555, 14, 7, 1.3, 0.25);

  // 범위 피해
  const hitEnt = (ent, isPlayer) => {
    if (attacker && attacker !== ent && attacker.team === ent.team) return; // 아군 피해 없음
    const center = _v1.set(ent.pos.x, ent.pos.y + 1.2, ent.pos.z);
    const d = center.distanceTo(pos);
    if (d > radius) return;
    let dmg = maxDmg * (1 - d / radius * 0.75);
    if (attacker === ent) dmg *= 0.45; // 자폭 데미지 감소
    applyDamage(ent, dmg, attacker, isPlayer, attacker && attacker.weaponLabel || '💥');
  };
  if (player.alive) hitEnt(player, true);
  bots.forEach(b => b.alive && hitEnt(b, false));
  const pd = camera.position.distanceTo(pos);
  if (pd < radius * 2.5) shakeAmp = Math.max(shakeAmp, 0.35 * (1 - pd / (radius * 2.5)));
}

function fireProjectile(kind, from, dir, owner) {
  let mesh, vel;
  if (kind === 'rocket') {
    mesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.55, 10), mat(0x4d5a3a, 0.5));
    body.rotation.x = Math.PI / 2; mesh.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.25, 10), mat(0xb03a2e, 0.5));
    tip.rotation.x = -Math.PI / 2; tip.position.z = -0.4; mesh.add(tip);
    vel = dir.clone().multiplyScalar(42);
  } else { // grenade
    mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(0x3d6b35, 0.6));
    vel = dir.clone().multiplyScalar(22);
    vel.y += 5.5;
  }
  mesh.position.copy(from);
  mesh.lookAt(from.clone().add(dir));
  scene.add(mesh);
  projectiles.push({ mesh, vel, kind, owner, life: kind === 'rocket' ? 5 : 2.3, trailT: 0, bounced: false });
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    const prev = p.mesh.position.clone();
    if (p.kind === 'grenade') p.vel.y -= GRAVITY * 0.85 * dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.kind === 'rocket') {
      p.trailT -= dt;
      if (p.trailT <= 0) { spawnParticles(p.mesh.position, 0xffc07a, 1, 1.2, 0.4, 0.1, false); p.trailT = 0.02; }
      p.mesh.lookAt(p.mesh.position.clone().add(p.vel));
    }
    const pos = p.mesh.position;
    let boom = p.life <= 0;

    // 엔티티 명중 (로켓만 직격)
    if (!boom && p.kind === 'rocket') {
      const targets = [player, ...bots];
      for (const t of targets) {
        if (!t.alive || t === p.owner) continue;
        if (Math.abs(pos.x - t.pos.x) < 0.75 && Math.abs(pos.z - t.pos.z) < 0.75 &&
            pos.y > t.pos.y - 0.2 && pos.y < t.pos.y + 2.6) { boom = true; break; }
      }
    }
    // 지형 충돌
    if (!boom) {
      let hitWorld = pos.y <= 0.12;
      if (!hitWorld) for (const b of colliders) {
        if (pos.x > b.min.x && pos.x < b.max.x && pos.y > b.min.y && pos.y < b.max.y && pos.z > b.min.z && pos.z < b.max.z) { hitWorld = true; break; }
      }
      if (hitWorld) {
        if (p.kind === 'rocket') boom = true;
        else {
          // 수류탄 바운스
          p.mesh.position.copy(prev);
          if (pos.y <= 0.12) p.vel.y = Math.abs(p.vel.y) * 0.45;
          else { p.vel.x *= -0.5; p.vel.z *= -0.5; }
          p.vel.multiplyScalar(0.75);
        }
      }
    }
    if (boom) {
      const owner = p.owner;
      owner.weaponLabel = p.kind === 'rocket' ? '🚀' : '💣';
      explode(pos, p.kind === 'rocket' ? 6 : 7, p.kind === 'rocket' ? 95 : 100, owner);
      scene.remove(p.mesh);
      projectiles.splice(i, 1);
    }
  }
}

function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life -= dt;
    if (e.kind === 'particle') {
      if (e.gravity) e.vel.y -= GRAVITY * 0.6 * dt;
      e.mesh.position.addScaledVector(e.vel, dt);
      e.mesh.material.opacity = e.life / e.maxLife;
      e.mesh.material.transparent = true;
    } else if (e.kind === 'tracer') {
      e.mesh.material.opacity = 0.85 * e.life / e.maxLife;
    } else if (e.kind === 'light') {
      e.mesh.intensity = 60 * e.life / e.maxLife;
    } else if (e.kind === 'boomball') {
      const t = 1 - e.life / e.maxLife;
      const s = 1 + (e.targetR - 1) * t;
      e.mesh.scale.setScalar(s);
      e.mesh.material.opacity = 0.9 * (1 - t);
    }
    if (e.life <= 0) { scene.remove(e.mesh); effects.splice(i, 1); }
  }
}

// ------------------------------------------------------------
// 데미지 / 킬 / 리스폰
// ------------------------------------------------------------
function applyDamage(ent, dmg, attacker, isPlayer, weaponLabel) {
  if (dmg <= 0) return;
  const wasAlive = ent.hp > 0;
  ent.hp -= dmg;
  if (isPlayer) {
    player.lastDamagedAt = gameTime;
    hud.vignette.style.opacity = Math.min(1, 0.4 + (1 - player.hp / 100));
    setTimeout(() => { if (player.hp > 0) hud.vignette.style.opacity = Math.max(0, 1 - player.hp / 60) * 0.5; }, 320);
    SFX.hurt();
    updateHealthHUD();
  } else {
    drawTag(ent);
    if (attacker === player) showHitmarker(ent.hp <= 0);
  }
  if (wasAlive && ent.hp <= 0) {
    onKill(attacker, ent, isPlayer, weaponLabel);
  }
}

function onKill(attacker, victim, victimIsPlayer, weaponLabel) {
  const aName = attacker ? attacker.name : '???';
  const aTeam = attacker ? attacker.team : 'red';
  addKillFeed(aName, aTeam, victim.name, victim.team, weaponLabel || '🔫');
  if (attacker && attacker.team !== victim.team) {
    score[attacker.team]++;
    hud.scoreBlue.textContent = score.blue;
    hud.scoreRed.textContent = score.red;
  }
  if (attacker === player) { SFX.kill(); showCenterMsg(`💥 <span style="color:#ffd34d">${victim.name}</span> 처치!`, 1400); }

  // 사망 연출
  const deathPos = victimIsPlayer ? player.pos : victim.pos;
  spawnParticles(_v1.set(deathPos.x, deathPos.y + 1.2, deathPos.z), victim.team === 'blue' ? 0x4b8bff : 0xff5555, 20, 6, 0.8, 0.18);

  if (victimIsPlayer) {
    player.alive = false;
    stopBeam();
    setZoom(false);
    document.exitPointerLock();
    startRespawnCountdown();
  } else {
    victim.alive = false;
    victim.parts.group.visible = false;
    victim.respawnT = 3;
  }
  checkGameOver();
}

function checkGameOver() {
  if (gameState !== 'playing') return;
  if (score.blue >= WIN_SCORE || score.red >= WIN_SCORE) {
    gameState = 'over';
    const playerWon = score.blue >= WIN_SCORE;
    const title = $('result-title');
    title.textContent = playerWon ? '🏆 승리!' : '패배...';
    title.className = playerWon ? 'win' : 'lose';
    $('result-detail').textContent = `파랑팀 ${score.blue} : ${score.red} 빨강팀`;
    $('end-screen').style.display = 'flex';
    document.exitPointerLock();
  }
}

let respawnInterval = null;
function startRespawnCountdown() {
  let t = 3;
  $('respawn-timer').textContent = t;
  $('respawn-screen').style.display = 'flex';
  respawnInterval = setInterval(() => {
    t--;
    if (t <= 0) {
      clearInterval(respawnInterval);
      $('respawn-screen').style.display = 'none';
      if (gameState === 'playing') respawnPlayer();
    } else $('respawn-timer').textContent = t;
  }, 1000);
}
function respawnPlayer() {
  player.pos.copy(spawnPointFor('blue'));
  player.vel.set(0, 0, 0);
  player.yaw = Math.PI; player.pitch = 0;
  player.hp = 100; player.alive = true;
  player.ammo = WEAPONS.map(w => w.mag);
  player.reloading = 0;
  hud.vignette.style.opacity = 0;
  updateHealthHUD(); updateWeaponHUD();
  tryLockPointer();
}
function tryLockPointer() {
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* 사용자 제스처 필요 시 캔버스 클릭으로 재시도 */ }
}
canvas.addEventListener('click', () => {
  if (gameState === 'playing' && player.alive && document.pointerLockElement !== canvas) tryLockPointer();
});
function updateHealthHUD() {
  const hp = Math.max(0, Math.ceil(player.hp));
  hud.healthNum.textContent = hp;
  hud.healthBar.style.width = hp + '%';
  hud.healthBar.style.background = hp > 50 ? 'linear-gradient(#7CFC5A,#37b524)'
    : hp > 25 ? 'linear-gradient(#ffd34d,#d69a1e)' : 'linear-gradient(#ff6b6b,#c22525)';
}

// ------------------------------------------------------------
// 사격 (히트스캔 공용)
// ------------------------------------------------------------
function hitscan(origin, dir, range, dmg, attacker, opts = {}) {
  const worldDist = raycastWorld(origin, dir, range);
  let bestDist = worldDist, bestEnt = null, headshot = false;
  const targets = attacker === player ? bots : [player, ...bots.filter(b => b !== attacker)];
  for (const t of targets) {
    if (!t.alive || t.team === attacker.team) continue;
    const tb = new THREE.Box3(
      new THREE.Vector3(t.pos.x - 0.55, t.pos.y, t.pos.z - 0.55),
      new THREE.Vector3(t.pos.x + 0.55, t.pos.y + 2.5, t.pos.z + 0.55));
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    const p = _ray.intersectBox(tb, _v1);
    if (p) {
      const d = p.distanceTo(origin);
      if (d < bestDist) { bestDist = d; bestEnt = t; headshot = p.y > t.pos.y + 1.75; }
    }
  }
  const end = origin.clone().addScaledVector(dir, bestDist);
  if (!opts.noTracer) spawnTracer(origin.clone().addScaledVector(dir, 0.6), end, opts.tracerColor);
  if (bestEnt) {
    let final = dmg * (headshot && opts.headshotMult ? opts.headshotMult : 1);
    if (opts.falloffRange && bestDist > opts.falloffRange) final *= Math.max(0.3, 1 - (bestDist - opts.falloffRange) / opts.falloffRange);
    applyDamage(bestEnt, final, attacker, bestEnt === player, opts.label || '🔫');
    if (opts.freeze && bestEnt !== player) {
      bestEnt.freeze = Math.min(1.4, bestEnt.freeze + opts.freeze);
      if (bestEnt.freeze >= 1.2 && bestEnt.frozenT <= 0) { bestEnt.frozenT = 2.5; SFX.freeze(); }
    }
  } else if (bestDist < range) {
    spawnParticles(end, 0xcccccc, 3, 3, 0.35, 0.08);
  }
  return bestEnt;
}

// ------------------------------------------------------------
// 플레이어 발사 처리
// ------------------------------------------------------------
const input = { fwd: 0, right: 0, jump: false, sprint: false, fire: false, aim: false };
let beamActive = false;
function stopBeam() { beamActive = false; }

function getAimDir(spread) {
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  if (spread > 0) {
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
  }
  return dir;
}

function tryFire(dt) {
  const w = WEAPONS[player.weaponIdx];
  if (!player.alive || player.reloading > 0) return;
  if (player.fireCooldown > 0) return;
  if (!input.fire) return;
  if (player.ammo[player.weaponIdx] < (w.beam ? dt * 25 : 1)) {
    startReload();
    return;
  }
  const origin = camera.position.clone();
  player.weaponLabel = w.id === 'rpg' ? '🚀' : w.id === 'grenade' ? '💣' : w.id === 'ice' ? '❄️' : '🔫';

  if (w.beam) {
    // 얼음 광선: 지속 빔
    beamActive = true;
    player.ammo[player.weaponIdx] -= dt * 25;
    player.fireCooldown = w.interval;
    const dir = getAimDir(w.spread);
    const dist = raycastWorld(origin, dir, w.range);
    const end = origin.clone().addScaledVector(dir, dist);
    spawnBeamSegment(origin.clone().addScaledVector(dir, 0.5).add(new THREE.Vector3(0, -0.15, 0)), end);
    hitscan(origin, dir, w.range, w.dmg, player, { noTracer: true, freeze: dt * 1.15, label: '❄️' });
    if (Math.random() < 0.3) SFX.ice();
    if (Math.random() < 0.5) spawnParticles(end, 0xbfe8ff, 1, 2, 0.4, 0.09, false);
    updateWeaponHUD();
    return;
  }
  beamActive = false;
  player.ammo[player.weaponIdx]--;
  player.fireCooldown = w.interval;
  player.recoil = 1;

  if (w.projectile) {
    const dir = getAimDir(0);
    fireProjectile(w.projectile, origin.clone().addScaledVector(dir, 0.7), dir, player);
    if (w.projectile === 'rocket') SFX.rpg(); else SFX.throwG();
  } else if (w.pellets) {
    SFX.shotgun();
    for (let i = 0; i < w.pellets; i++)
      hitscan(origin, getAimDir(w.spread), w.range, w.dmg, player, { falloffRange: 18, label: '🔫' });
  } else {
    if (w.id === 'sniper') SFX.sniper(); else SFX.ar();
    const spread = w.id === 'sniper' && !player.zoomed ? 0.06 : w.spread;
    hitscan(origin, getAimDir(spread), w.range, w.dmg, player, { headshotMult: 2, label: w.id === 'sniper' ? '🎯' : '🔫' });
  }
  if (player.ammo[player.weaponIdx] <= 0) startReload();
  updateWeaponHUD();
}

function startReload() {
  const w = WEAPONS[player.weaponIdx];
  if (player.reloading > 0 || player.ammo[player.weaponIdx] >= w.mag) return;
  player.reloading = w.reload;
  stopBeam();
  SFX.reload();
  updateWeaponHUD();
}

// ------------------------------------------------------------
// 입력
// ------------------------------------------------------------
let gameState = 'menu'; // menu | playing | over
let gameTime = 0;

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyW': input.fwd = 1; break;
    case 'KeyS': input.fwd = -1; break;
    case 'KeyA': input.right = -1; break;
    case 'KeyD': input.right = 1; break;
    case 'Space': input.jump = true; e.preventDefault(); break;
    case 'ShiftLeft': case 'ShiftRight': input.sprint = true; break;
    case 'KeyR': startReload(); break;
    case 'Digit1': switchWeapon(0); break;
    case 'Digit2': switchWeapon(1); break;
    case 'Digit3': switchWeapon(2); break;
    case 'Digit4': switchWeapon(3); break;
    case 'Digit5': switchWeapon(4); break;
    case 'Digit6': switchWeapon(5); break;
  }
});
document.addEventListener('keyup', e => {
  switch (e.code) {
    case 'KeyW': if (input.fwd > 0) input.fwd = 0; break;
    case 'KeyS': if (input.fwd < 0) input.fwd = 0; break;
    case 'KeyA': if (input.right < 0) input.right = 0; break;
    case 'KeyD': if (input.right > 0) input.right = 0; break;
    case 'Space': input.jump = false; break;
    case 'ShiftLeft': case 'ShiftRight': input.sprint = false; break;
  }
});
document.addEventListener('mousedown', e => {
  if (gameState !== 'playing' || document.pointerLockElement !== canvas) return;
  if (e.button === 0) input.fire = true;
  if (e.button === 2) {
    const w = WEAPONS[player.weaponIdx];
    if (w.zoom && player.alive) setZoom(!player.zoomed);
  }
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) { input.fire = false; stopBeam(); }
});
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('wheel', e => {
  if (gameState !== 'playing' || document.pointerLockElement !== canvas) return;
  const n = WEAPONS.length;
  switchWeapon(((player.weaponIdx + (e.deltaY > 0 ? 1 : -1)) % n + n) % n);
});
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || !player.alive) return;
  const sens = 0.0022 * (player.zoomed ? 0.35 : 1);
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = Math.max(-Math.PI / 2 + 0.03, Math.min(Math.PI / 2 - 0.03, player.pitch));
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && gameState === 'playing' && player.alive) {
    // 일시정지 → 시작 화면을 "계속하기"로 재활용
    $('start-screen').style.display = 'flex';
    $('start-btn').textContent = '계속하기';
    input.fire = false; stopBeam();
  }
});

$('start-btn').addEventListener('click', () => {
  audio(); // 사용자 제스처로 오디오 활성화
  $('start-screen').style.display = 'none';
  if (gameState === 'menu') {
    gameState = 'playing';
    showCenterMsg('⚔️ 교차로 대전 시작! ⚔️');
  }
  canvas.requestPointerLock();
});
$('restart-btn').addEventListener('click', () => {
  score.blue = 0; score.red = 0;
  hud.scoreBlue.textContent = 0; hud.scoreRed.textContent = 0;
  hud.killfeed.innerHTML = '';
  bots.forEach(b => {
    b.hp = 100; b.alive = true; b.freeze = 0; b.frozenT = 0;
    b.pos.copy(spawnPointFor(b.team));
    b.parts.group.visible = true;
    drawTag(b);
  });
  $('end-screen').style.display = 'none';
  gameState = 'playing';
  respawnPlayer();
  showCenterMsg('⚔️ 다시 한 판! ⚔️');
});

// ------------------------------------------------------------
// 플레이어 이동
// ------------------------------------------------------------
function updatePlayer(dt) {
  if (!player.alive) return;
  const speed = input.sprint ? 11.5 : 8;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const mx = (input.right * cos - input.fwd * sin);
  const mz = (-input.right * sin - input.fwd * cos);
  const len = Math.hypot(mx, mz) || 1;
  player.vel.x = mx / len * speed * (Math.abs(input.fwd) + Math.abs(input.right) > 0 ? 1 : 0);
  player.vel.z = mz / len * speed * (Math.abs(input.fwd) + Math.abs(input.right) > 0 ? 1 : 0);

  if (input.jump && player.onGround) {
    player.vel.y = 10.5;
    player.onGround = false;
  }
  player.vel.y -= GRAVITY * dt;

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  resolveHorizontal(player.pos, 0.45, 2.4);
  player.pos.y += player.vel.y * dt;
  const gy = groundHeightAt(player.pos.x, player.pos.z, player.pos.y, 0.42);
  if (player.pos.y <= gy && player.vel.y <= 0) {
    player.pos.y = gy; player.vel.y = 0; player.onGround = true;
  } else player.onGround = false;

  // 카메라
  camera.position.set(player.pos.x, player.pos.y + 2.05, player.pos.z);
  camera.rotation.set(0, 0, 0);
  camera.rotateY(player.yaw);
  camera.rotateX(player.pitch);
  if (shakeAmp > 0.001) {
    camera.rotateZ((Math.random() - 0.5) * shakeAmp * 0.3);
    camera.rotateX((Math.random() - 0.5) * shakeAmp * 0.3);
    shakeAmp *= Math.pow(0.02, dt);
  }

  // 뷰모델 흔들림 + 반동
  const moving = (Math.abs(input.fwd) + Math.abs(input.right)) > 0 && player.onGround;
  if (moving) player.bobT += dt * (input.sprint ? 13 : 9);
  player.recoil = Math.max(0, player.recoil - dt * 6);
  const bobX = Math.sin(player.bobT) * 0.012 * (moving ? 1 : 0);
  const bobY = Math.abs(Math.cos(player.bobT)) * 0.014 * (moving ? 1 : 0);
  viewRoot.position.set(0.32 + bobX, -0.3 + bobY, -0.55 + player.recoil * 0.09);
  viewRoot.rotation.x = player.recoil * 0.16;

  // 재장전
  if (player.reloading > 0) {
    player.reloading -= dt;
    viewRoot.rotation.x = 0.6 * Math.sin(Math.min(1, 1 - player.reloading / WEAPONS[player.weaponIdx].reload) * Math.PI);
    if (player.reloading <= 0) {
      player.reloading = 0;
      player.ammo[player.weaponIdx] = WEAPONS[player.weaponIdx].mag;
      updateWeaponHUD();
    }
  }

  // 체력 재생 (6초간 피해 없으면)
  if (player.hp < 100 && gameTime - player.lastDamagedAt > 6) {
    player.hp = Math.min(100, player.hp + 8 * dt);
    updateHealthHUD();
    if (player.hp >= 99) hud.vignette.style.opacity = 0;
  }

  player.fireCooldown -= dt;
  tryFire(dt);
}

// ------------------------------------------------------------
// 봇 AI
// ------------------------------------------------------------
function botVisibleEnemies(bot) {
  const list = [];
  const candidates = bot.team === 'red' ? [player, ...bots.filter(b => b.team === 'blue')] : bots.filter(b => b.team === 'red');
  if (bot.team === 'blue') candidates.push(...[]);
  for (const t of candidates) {
    if (!t.alive) continue;
    const from = new THREE.Vector3(bot.pos.x, bot.pos.y + 2.0, bot.pos.z);
    const to = new THREE.Vector3(t.pos.x, t.pos.y + 1.6, t.pos.z);
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist > 65) continue;
    dir.normalize();
    if (raycastWorld(from, dir, dist) < dist - 0.6) continue; // 벽에 가림
    list.push({ ent: t, dist });
  }
  list.sort((a, b) => a.dist - b.dist);
  return list;
}

function updateBot(bot, dt) {
  if (!bot.alive) {
    bot.respawnT -= dt;
    if (bot.respawnT <= 0 && gameState === 'playing') {
      bot.hp = 100; bot.alive = true; bot.freeze = 0; bot.frozenT = 0;
      bot.pos.copy(spawnPointFor(bot.team));
      bot.parts.group.visible = true;
      drawTag(bot);
    }
    return;
  }

  // 빙결
  bot.freeze = Math.max(0, bot.freeze - dt * 0.35);
  const frozen = bot.frozenT > 0;
  if (frozen) bot.frozenT -= dt;
  bot.parts.ice.visible = frozen;
  const slowMul = frozen ? 0 : (1 - bot.freeze * 0.45);

  const enemies = botVisibleEnemies(bot);
  const target = enemies[0] || null;

  // 이동 목표 결정
  bot.repathT -= dt;
  if (bot.repathT <= 0 || !bot.waypoint) {
    if (target && target.dist < 30 && Math.random() < 0.6) {
      // 근접 전투: 좌우 무빙
      bot.waypoint = null;
    } else {
      const wp = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)];
      bot.waypoint = new THREE.Vector3(wp[0] + (Math.random() - 0.5) * 4, 0, wp[1] + (Math.random() - 0.5) * 4);
    }
    bot.repathT = 2.5 + Math.random() * 3;
  }

  let mvx = 0, mvz = 0;
  const speed = 6.2 * slowMul;
  if (!frozen) {
    if (bot.waypoint) {
      const dx = bot.waypoint.x - bot.pos.x, dz = bot.waypoint.z - bot.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.5) { mvx = dx / d; mvz = dz / d; }
      else bot.waypoint = null;
    } else if (target) {
      // 타겟 주위 무빙(스트레이프)
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) { bot.strafeDir = Math.random() < 0.5 ? -1 : 1; bot.strafeT = 0.7 + Math.random(); }
      const tx = target.ent.pos.x - bot.pos.x, tz = target.ent.pos.z - bot.pos.z;
      const td = Math.hypot(tx, tz) || 1;
      // 옆으로 + 거리 유지
      mvx = (-tz / td) * bot.strafeDir + (td > 20 ? tx / td * 0.6 : td < 9 ? -tx / td * 0.6 : 0);
      mvz = (tx / td) * bot.strafeDir + (td > 20 ? tz / td * 0.6 : td < 9 ? -tz / td * 0.6 : 0);
      const ml = Math.hypot(mvx, mvz) || 1;
      mvx /= ml; mvz /= ml;
    }
  }
  const prevX = bot.pos.x, prevZ = bot.pos.z;
  bot.vel.x = mvx * speed; bot.vel.z = mvz * speed;
  bot.vel.y -= GRAVITY * dt;
  bot.pos.x += bot.vel.x * dt;
  bot.pos.z += bot.vel.z * dt;
  resolveHorizontal(bot.pos, 0.45, 2.4);
  bot.pos.y += bot.vel.y * dt;
  const gy = groundHeightAt(bot.pos.x, bot.pos.z, bot.pos.y, 0.42);
  if (bot.pos.y <= gy && bot.vel.y <= 0) { bot.pos.y = gy; bot.vel.y = 0; bot.onGround = true; }
  else bot.onGround = false;

  // 막혔으면 점프 시도 + 목적지 다시 선택
  if (!frozen && (mvx || mvz)) {
    const movedSq = (bot.pos.x - prevX) ** 2 + (bot.pos.z - prevZ) ** 2;
    if (movedSq < (speed * dt * 0.25) ** 2) {
      if (bot.onGround && Math.random() < 0.35) bot.vel.y = 10.5;
      if (Math.random() < 0.1) bot.repathT = 0;
    }
  }

  // 조준 & 사격
  if (target) {
    const ty = Math.atan2(-(target.ent.pos.x - bot.pos.x), -(target.ent.pos.z - bot.pos.z));
    bot.yaw += ((ty - bot.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 7);
    bot.fireT -= dt;
    if (!frozen && bot.fireT <= 0) {
      const from = new THREE.Vector3(bot.pos.x, bot.pos.y + 2.0, bot.pos.z);
      const aim = new THREE.Vector3(target.ent.pos.x, target.ent.pos.y + 1.5, target.ent.pos.z).sub(from).normalize();
      // 부정확도
      const miss = 0.045 + target.dist * 0.0012;
      aim.x += (Math.random() - 0.5) * miss * 2;
      aim.y += (Math.random() - 0.5) * miss * 2;
      aim.z += (Math.random() - 0.5) * miss * 2;
      aim.normalize();
      bot.weaponLabel = '🔫';
      if (bot.weapon === 'shotgun') {
        if (target.dist < 30) {
          SFX.shotgun();
          for (let i = 0; i < 6; i++) {
            const a2 = aim.clone();
            a2.x += (Math.random() - 0.5) * 0.12; a2.y += (Math.random() - 0.5) * 0.12; a2.z += (Math.random() - 0.5) * 0.12;
            hitscan(from, a2.normalize(), 40, 5, bot, { falloffRange: 15, tracerColor: 0xffb07a });
          }
          bot.fireT = 1.3 + Math.random() * 0.7;
        } else bot.fireT = 0.3;
      } else {
        SFX.ar();
        hitscan(from, aim, 110, 7, bot, { tracerColor: bot.team === 'red' ? 0xff9a7a : 0x9ab8ff });
        bot.fireT = 0.16 + Math.random() * 0.2;
        if (Math.random() < 0.25) bot.fireT = 0.9 + Math.random(); // 연사 사이 숨 고르기
      }
    }
  } else {
    bot.yaw += ((Math.atan2(-mvx, -mvz) || bot.yaw) - bot.yaw) * (mvx || mvz ? Math.min(1, dt * 5) : 0);
    bot.fireT = Math.max(bot.fireT, 0.25);
  }

  // 메시 갱신
  bot.parts.group.position.copy(bot.pos);
  bot.parts.group.rotation.y = bot.yaw + Math.PI;
  const moving2 = (mvx || mvz) && !frozen;
  const t = gameTime * 9;
  bot.parts.armL.rotation.x = moving2 ? Math.sin(t) * 0.7 : 0;
  bot.parts.armR.rotation.x = moving2 ? -Math.sin(t) * 0.7 : (target ? -1.4 : 0);
}

// ------------------------------------------------------------
// 메인 루프
// ------------------------------------------------------------
let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (gameState === 'playing') {
    gameTime += dt;
    updatePlayer(dt);
    bots.forEach(b => updateBot(b, dt));
    updateProjectiles(dt);
    // 플레이어가 얼음광선류 감속을 받는 일은 없지만, 저체력 시 파란 화면 방지용
  }
  updateEffects(dt);
  renderer.render(scene, camera);
}
updateHealthHUD();
updateWeaponHUD();
viewModels[0].visible = true;
camera.position.set(0, 2.05, -50);
camera.rotation.y = Math.PI; // 메뉴 화면에서도 맵 중앙이 보이게
requestAnimationFrame(loop);

// 테스트용 디버그 훅
window.__game = {
  player, bots, score,
  damageBot: (i, d) => applyDamage(bots[i], d, player, false, '🔫'),
  damagePlayer: d => applyDamage(player, d, bots.find(b => b.team === 'red'), true, '🔫'),
};
