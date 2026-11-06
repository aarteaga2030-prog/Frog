import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SFX } from './audio.js';
import { buildWorld, ARENA_RADIUS } from './world.js';

// ============================================================
// Config
// ============================================================
const ASSET_CFG = window.FROG_JEDI_ASSETS || {};
const FROG_URL = ASSET_CFG.frog || encodeURI('RainFrog_FreeDownload 2.obj');
const SABER_URL = ASSET_CFG.saber || 'anakin_skywalkers_lightsaber.glb';
const SABER_BASE64 = !!ASSET_CFG.saberBase64; // GLB shipped as base64 text
const FROG_HEIGHT = 0.9;          // meters
const FROG_YAW = 0;         // rotates the OBJ so its face points along +Z
const SABER_COLORS = { blue: 0x3b8cff, green: 0x3dff5a, purple: 0xb04dff, yellow: 0xffd02e };
const ENEMY_RED = 0xff2a2a;
const BLADE_LEN = 1.05;

const GRAVITY = -20;
const MOVE_SPEED = 6.2;
const MOUSE_SENS = 0.0024;
const TOUCH_SENS = 0.006;

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

// ============================================================
// Renderer / scene
// ============================================================
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 500);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2), 0.85, 0.45, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

const world = buildWorld(scene);
const sfx = new SFX();

// ============================================================
// DOM
// ============================================================
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), hp: $('hp-fill'), force: $('force-fill'), wave: $('wave'), score: $('score'),
  boss: $('boss'), bossFill: $('boss-fill'), banner: $('banner'), popup: $('popup'), flash: $('flash'),
  loading: $('loading'), loadPct: $('load-pct'), menu: $('menu'), pause: $('pause'), gameover: $('gameover'),
  cdPush: $('cd-push'), cdThrow: $('cd-throw'), cdSlash: $('cd-slash'), cdBlock: $('cd-block'),
};

let bannerTimer = 0;
function banner(text, secs = 2) {
  ui.banner.textContent = text;
  ui.banner.classList.add('show');
  bannerTimer = secs;
}
function popup(text) {
  ui.popup.textContent = text;
  ui.popup.classList.remove('show');
  void ui.popup.offsetWidth; // restart animation
  ui.popup.classList.add('show');
}
let flashTimer = 0;
function hurtFlash() {
  ui.flash.style.opacity = 1;
  flashTimer = 0.15;
}

// ============================================================
// Asset loading
// ============================================================
const manager = new THREE.LoadingManager();
manager.onProgress = (url, loaded, total) => {
  ui.loadPct.textContent = Math.round((loaded / total) * 100) + '%';
};

function loadFrog() {
  return new Promise((resolve) => {
    new OBJLoader(manager).load(FROG_URL, resolve, (e) => {
      if (e.lengthComputable) ui.loadPct.textContent = Math.round((e.loaded / e.total) * 100) + '%';
    }, (err) => { console.warn('Frog failed to load, using fallback', err); resolve(null); });
  });
}
function loadSaber() {
  if (SABER_BASE64) {
    return fetch(SABER_URL)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then((b64) => {
        const bin = atob(b64.trim());
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Promise((resolve, reject) => new GLTFLoader().parse(bytes.buffer, '', resolve, reject));
      })
      .catch((err) => { console.warn('Saber failed to load, using fallback', err); return null; });
  }
  return new Promise((resolve) => {
    new GLTFLoader(manager).load(SABER_URL, resolve, undefined,
      (err) => { console.warn('Saber failed to load, using fallback', err); resolve(null); });
  });
}

// Turn the raw OBJ into a single, centered, scaled, vertex-colored geometry.
function prepareFrogGeometry(obj) {
  let geo;
  if (obj) {
    const geos = [];
    obj.traverse((c) => { if (c.isMesh) geos.push(c.geometry); });
    geo = geos[0];
    geo.clearGroups();
  } else {
    // Fallback: a blobby sphere frog
    geo = new THREE.SphereGeometry(1, 32, 24).toNonIndexed();
    geo.scale(1, 0.8, 1.2);
  }
  geo.rotateY(FROG_YAW);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const h = bb.max.y - bb.min.y;
  const s = FROG_HEIGHT / h;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale(s, s, s);
  geo.computeBoundingBox();
  if (!geo.attributes.normal) geo.computeVertexNormals();

  // Procedural skin: green back, pale belly, darker spots.
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const back = new THREE.Color(0x4f9a32), belly = new THREE.Color(0xd9d48c), spot = new THREE.Color(0x2b5a1c);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = nor.getY(i);
    const bellyAmt = THREE.MathUtils.smoothstep(-ny, 0.1, 0.7);
    c.copy(back).lerp(belly, bellyAmt);
    const n = Math.sin(x * 23 + Math.sin(z * 17) * 2) * Math.sin(z * 19 + Math.cos(y * 21) * 2) * Math.sin(y * 15 + x * 7);
    if (n > 0.35 && bellyAmt < 0.3) c.lerp(spot, 0.75);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Normalise the GLB hilt so that the blade points along +Y and the grip sits at the origin.
function prepareHilt(gltf) {
  const holder = new THREE.Group();
  if (!gltf) {
    const hilt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.025, 0.26, 12),
      new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.9, roughness: 0.3 })
    );
    hilt.position.y = -0.02;
    holder.add(hilt);
    return holder;
  }
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  let laser = null;
  model.traverse((o) => {
    if (o.isMesh && /laser/i.test(o.name + (o.material && o.material.name))) laser = o;
    if (o.isMesh) { o.castShadow = true; }
  });
  const laserBox = laser ? new THREE.Box3().setFromObject(laser) : null;
  if (laser) laser.parent.remove(laser);
  const hiltBox = new THREE.Box3().setFromObject(model);
  const hiltCenter = hiltBox.getCenter(new THREE.Vector3());
  // Direction from hilt to blade
  const dir = new THREE.Vector3();
  if (laserBox) dir.copy(laserBox.getCenter(new THREE.Vector3())).sub(hiltCenter).normalize();
  else {
    const size = hiltBox.getSize(new THREE.Vector3());
    dir.set(size.x > size.y && size.x > size.z ? 1 : 0, size.y >= size.x && size.y >= size.z ? 1 : 0, size.z > size.x && size.z > size.y ? 1 : 0);
  }
  const orient = new THREE.Group();
  orient.add(model);
  orient.quaternion.setFromUnitVectors(dir, UP);
  orient.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(orient);
  const size = box.getSize(new THREE.Vector3());
  const s = 0.27 / size.y;
  const scaled = new THREE.Group();
  scaled.add(orient);
  scaled.scale.setScalar(s);
  scaled.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(scaled);
  const c2 = box2.getCenter(new THREE.Vector3());
  scaled.position.set(-c2.x, 0.11 - box2.max.y, -c2.z);
  holder.add(scaled);
  return holder;
}

// ============================================================
// Saber (hilt + glowing blade + light)
// ============================================================
function makeSaber(hiltTemplate, colorHex) {
  const group = new THREE.Group();
  group.rotation.order = 'YXZ';
  group.add(hiltTemplate.clone(true));

  const blade = new THREE.Group();
  blade.position.y = 0.105;
  group.add(blade);

  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, BLADE_LEN, 4, 10).translate(0, BLADE_LEN / 2, 0), coreMat);
  const glow = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, BLADE_LEN + 0.02, 4, 12).translate(0, BLADE_LEN / 2, 0), glowMat);
  blade.add(core, glow);

  const light = new THREE.PointLight(0xffffff, 2.2, 5, 2);
  light.position.y = 0.5;
  blade.add(light);

  const saber = {
    group, blade, light, coreMat, glowMat, extend: 0, target: 0,
    setColor(hex) {
      const c = new THREE.Color(hex);
      glowMat.color.copy(c).multiplyScalar(3.0);
      coreMat.color.copy(c).lerp(new THREE.Color(0xffffff), 0.45).multiplyScalar(2.2);
      light.color.copy(c);
      saber.color = hex;
    },
    update(dt) {
      saber.extend = THREE.MathUtils.damp(saber.extend, saber.target, 9, dt);
      const e = Math.max(0.001, saber.extend);
      blade.scale.set(1, e, 1);
      blade.visible = saber.extend > 0.01;
      // a real blade never sits still: subtle hum flicker
      const fl = 0.94 + 0.04 * Math.sin(performance.now() * 0.06) + Math.random() * 0.04;
      light.intensity = 2.2 * saber.extend * fl;
      glowMat.opacity = 0.5 * fl + 0.05;
      glow.scale.set(fl, 1, fl);
    },
    // world-space base and tip of the blade
    getSegment(base, tip) {
      group.updateWorldMatrix(true, false);
      base.set(0, 0.105, 0).applyMatrix4(group.matrixWorld);
      tip.set(0, 0.105 + BLADE_LEN * saber.extend, 0).applyMatrix4(group.matrixWorld);
    },
  };
  saber.setColor(colorHex);
  return saber;
}

// Ribbon trail that follows the blade while it moves fast.
class SaberTrail {
  constructor(n = 12) {
    this.n = n;
    this.bases = Array.from({ length: n }, () => new THREE.Vector3());
    this.tips = Array.from({ length: n }, () => new THREE.Vector3());
    this.count = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 3);
    const idx = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    this.color = new THREE.Color();
    this.strength = 0;
    scene.add(this.mesh);
  }
  push(base, tip, active, dt) {
    this.strength = THREE.MathUtils.damp(this.strength, active ? 1 : 0, active ? 30 : 10, dt);
    for (let i = this.n - 1; i > 0; i--) {
      this.bases[i].copy(this.bases[i - 1]);
      this.tips[i].copy(this.tips[i - 1]);
    }
    this.bases[0].copy(base);
    this.tips[0].copy(tip);
    this.count = Math.min(this.n, this.count + 1);
    for (let i = 0; i < this.n; i++) {
      const j = Math.min(i, this.count - 1);
      const b = this.bases[j], t = this.tips[j];
      // Trail sits mostly on the outer part of the blade
      tmpV.copy(b).lerp(t, 0.25);
      this.pos.set([tmpV.x, tmpV.y, tmpV.z, t.x, t.y, t.z], i * 6);
      const f = Math.pow(1 - i / (this.n - 1), 2) * this.strength * 0.55;
      const r = this.color.r * f, g = this.color.g * f, bl = this.color.b * f;
      this.col.set([r * 0.3, g * 0.3, bl * 0.3, r, g, bl], i * 6);
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
    this.mesh.visible = this.strength > 0.01;
  }
}

// ============================================================
// Saber poses (pivot position + YXZ euler)
// ============================================================
const P = (x, y, z, yaw, pitch, roll = 0) => ({ p: new THREE.Vector3(x, y, z), yaw, pitch, roll });
const POSES = {
  idle: P(-0.62, 0.36, 0.66, -0.25, 0.45, 0.15),
  block: P(0.5, 0.6, 1.0, -1.45, 1.25, 0),
  swingA0: P(-0.72, 0.6, 0.35, -1.9, 0.6),
  swingA1: P(0.45, 0.42, 0.85, 1.6, 1.95),
  swingB0: P(0.45, 0.6, 0.7, 1.7, 0.85),
  swingB1: P(-0.72, 0.45, 0.65, -1.7, 1.75),
  throw: P(-0.6, 0.5, 0.75, 0, 1.4),
  // boss specific
  raised: P(-0.55, 0.75, 0.3, -0.6, -0.35, 0.4),
  strike: P(0.35, 0.4, 0.85, 0.9, 1.95),
  slump: P(-0.6, 0.3, 0.6, -0.3, 2.3),
};
const poseTmp = P(0, 0, 0, 0, 0);
function lerpPose(a, b, t, out = poseTmp) {
  out.p.copy(a.p).lerp(b.p, t);
  out.yaw = a.yaw + (b.yaw - a.yaw) * t;
  out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  out.roll = a.roll + (b.roll - a.roll) * t;
  return out;
}
function applyPose(pivot, pose) {
  pivot.position.copy(pose.p);
  pivot.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
}
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// ============================================================
// Particles (sparks)
// ============================================================
const sparkGeo = new THREE.BoxGeometry(0.03, 0.03, 0.12);
const sparks = [];
function spawnSparks(pos, colorHex, count = 14, speed = 6) {
  const color = new THREE.Color(colorHex).multiplyScalar(2.5);
  for (let i = 0; i < count; i++) {
    let s = sparks.find((p) => !p.alive);
    if (!s) {
      if (sparks.length > 300) return;
      const mesh = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      s = { mesh, vel: new THREE.Vector3(), life: 0, max: 1, alive: false };
      sparks.push(s);
      scene.add(mesh);
    }
    s.alive = true;
    s.mesh.visible = true;
    s.mesh.material.color.copy(color);
    s.mesh.position.copy(pos);
    s.vel.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.4 + Math.random()));
    s.life = s.max = 0.25 + Math.random() * 0.4;
  }
}
function updateSparks(dt) {
  for (const s of sparks) {
    if (!s.alive) continue;
    s.life -= dt;
    if (s.life <= 0) { s.alive = false; s.mesh.visible = false; continue; }
    s.vel.y -= 12 * dt;
    s.mesh.position.addScaledVector(s.vel, dt);
    s.mesh.lookAt(tmpV.copy(s.mesh.position).add(s.vel));
    s.mesh.material.opacity = s.life / s.max;
  }
}

// Expanding flashes / shockwaves
const flashes = [];
function spawnFlash(pos, colorHex, size = 1.5, dur = 0.35, ring = false) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex).multiplyScalar(2), transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const geo = ring ? new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2) : new THREE.SphereGeometry(1, 16, 12);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(pos);
  scene.add(mesh);
  flashes.push({ mesh, t: 0, dur, size });
}
function updateFlashes(dt) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.t += dt;
    const k = f.t / f.dur;
    if (f.beam) {
      const w = f.radius * (1 - k) * (1 + 0.15 * Math.sin(f.t * 40));
      f.mesh.scale.set(w, 1, w);
      f.mesh.material.opacity = 0.5 * (1 - k);
    } else {
      f.mesh.scale.setScalar(0.1 + easeOut(Math.min(1, k)) * f.size);
      f.mesh.material.opacity = 0.8 * (1 - k);
    }
    if (k >= 1) {
      scene.remove(f.mesh);
      if (f.ownGeo !== false) f.mesh.geometry.dispose();
      f.mesh.material.dispose();
      flashes.splice(i, 1);
    }
  }
}

// Vertical teleport beam shown where an enemy drops in
const beamGeo = new THREE.CylinderGeometry(1, 1, 14, 20, 1, true).translate(0, 7, 0);
function spawnBeam(pos, colorHex, radius) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex).multiplyScalar(1.5), transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(beamGeo, mat);
  mesh.position.copy(pos);
  mesh.scale.set(radius, 1, radius);
  scene.add(mesh);
  flashes.push({ mesh, t: 0, dur: 1.2, beam: true, radius, ownGeo: false });
  spawnFlash(pos.clone().setY(0.05), colorHex, radius * 2.5, 1.0, true);
}

// Broken enemy parts that tumble, bounce and sink away
const debris = [];
function spawnDebris(e) {
  e.group.updateMatrixWorld(true);
  let n = 0;
  e.group.traverse((o) => {
    if (!o.isMesh || n > 10 || !o.material || o.material.transparent) return;
    n++;
    const piece = new THREE.Mesh(o.geometry, o.material);
    o.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
    piece.castShadow = true;
    scene.add(piece);
    debris.push({
      mesh: piece, t: 0,
      vel: new THREE.Vector3((Math.random() - 0.5) * 7, 3 + Math.random() * 5, (Math.random() - 0.5) * 7),
      spin: new THREE.Vector3(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6),
    });
  });
}
function updateDebris(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.t += dt;
    d.vel.y += GRAVITY * dt;
    d.mesh.position.addScaledVector(d.vel, dt);
    d.mesh.rotation.x += d.spin.x * dt;
    d.mesh.rotation.y += d.spin.y * dt;
    d.mesh.rotation.z += d.spin.z * dt;
    if (d.mesh.position.y < 0.05 && d.t < 1.8) {
      d.mesh.position.y = 0.05;
      d.vel.y = Math.abs(d.vel.y) * 0.35;
      d.vel.x *= 0.6; d.vel.z *= 0.6;
      d.spin.multiplyScalar(0.6);
    }
    if (d.t > 1.8) d.mesh.position.y -= dt * 0.4; // sink into the mud
    if (d.t > 2.6) { scene.remove(d.mesh); debris.splice(i, 1); }
  }
}

// ============================================================
// Bolts
// ============================================================
const bolts = [];
const boltGeo = new THREE.CapsuleGeometry(0.045, 0.55, 3, 8);
const boltMats = {};
function boltMat(hex) {
  if (!boltMats[hex]) boltMats[hex] = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(3) });
  return boltMats[hex];
}
function fireBolt(from, dir, speed, owner, shooter, colorHex, damage = 10, big = false) {
  const mesh = new THREE.Mesh(boltGeo, boltMat(colorHex));
  if (big) mesh.scale.set(2.2, 0.8, 2.2);
  mesh.position.copy(from);
  scene.add(mesh);
  const b = { mesh, pos: mesh.position, vel: dir.clone().normalize().multiplyScalar(speed), owner, shooter, life: 4, damage, big, dead: false };
  orientBolt(b);
  bolts.push(b);
  return b;
}
function orientBolt(b) {
  tmpV.copy(b.vel).normalize();
  b.mesh.quaternion.setFromUnitVectors(UP, tmpV);
}
function killBolt(b, sparksColor) {
  if (b.dead) return;
  b.dead = true;
  scene.remove(b.mesh);
  if (sparksColor !== undefined) spawnSparks(b.pos, sparksColor, 8, 4);
}
// Send a bolt back toward a target (or straight back if none)
function redirectBolt(b, target, spread = 0) {
  const speed = 28;
  if (target) {
    tmpV.copy(target.center()).sub(b.pos);
  } else {
    tmpV.copy(b.vel).negate();
    tmpV.y = Math.abs(tmpV.y) * 0.2 + 0.5;
  }
  tmpV.normalize();
  if (spread) {
    tmpV.x += (Math.random() - 0.5) * spread;
    tmpV.y += (Math.random() - 0.5) * spread * 0.5;
    tmpV.z += (Math.random() - 0.5) * spread;
    tmpV.normalize();
  }
  b.vel.copy(tmpV).multiplyScalar(speed);
  b.owner = 'player';
  b.life = 3;
  b.mesh.material = boltMat(player.saber.color);
  orientBolt(b);
}

// ============================================================
// Player
// ============================================================
let frogGeo = null;
let hiltTemplate = null;
const player = {
  root: new THREE.Group(),
  model: new THREE.Group(),
  pivot: new THREE.Group(),
  mesh: null,
  saber: null,
  trail: null,
  vel: new THREE.Vector3(),
  yaw: 0,
  onGround: true,
  jumps: 0,
  flip: 0,
  hopPhase: 0,
  squash: 0,
  hp: 100,
  force: 100,
  swing: null,       // { t, dir, hits:Set }
  swingDir: 0,
  blocking: false,
  blockStart: 0,
  blockBlend: 0,
  invuln: 0,
  pushCd: 0,
  throw: null,
  hurtT: 0,
  get pos() { return this.root.position; },
  center(out = new THREE.Vector3()) { return out.copy(this.root.position).setY(this.root.position.y + 0.45); },
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); },
};
const FROG_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.0 });

function makeFrogMesh(material) {
  const mesh = new THREE.Mesh(frogGeo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildPlayer(colorHex) {
  player.root.add(player.model);
  player.mesh = makeFrogMesh(FROG_MAT);
  player.model.add(player.mesh);
  player.model.add(player.pivot);
  player.saber = makeSaber(hiltTemplate, colorHex);
  player.pivot.add(player.saber.group);
  player.trail = new SaberTrail();
  player.trail.color.set(colorHex);
  applyPose(player.pivot, POSES.idle);
  scene.add(player.root);
}

function resetPlayer() {
  player.pos.set(0, 0, 0);
  player.vel.set(0, 0, 0);
  player.yaw = 0;
  camYaw = 0;
  camPitch = 0.4;
  player.hp = 100;
  player.force = 100;
  player.swing = null;
  player.blocking = false;
  player.invuln = 0;
  player.pushCd = 0;
  player.flip = 0;
  if (player.throw) catchSaber();
  player.saber.extend = 0;
  player.saber.target = 1;
}

// ============================================================
// Enemies
// ============================================================
const enemies = [];
const droneBodyMat = new THREE.MeshStandardMaterial({ color: 0x8a949c, metalness: 0.85, roughness: 0.35 });
const droneDarkMat = new THREE.MeshStandardMaterial({ color: 0x2a2f35, metalness: 0.7, roughness: 0.5 });
const buzzerMat = new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 0.8, roughness: 0.4 });

function enemyEyeMat(hex) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(2.5) });
}

function makeDroneMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), droneBodyMat);
  body.castShadow = true;
  g.add(body);
  const fins = [], ants = [];
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.05, 8, 24), droneDarkMat);
  band.rotation.x = Math.PI / 2;
  g.add(band);
  const eyeMat = enemyEyeMat(ENEMY_RED);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), eyeMat);
  eye.position.set(0, 0.03, 0.3);
  g.add(eye);
  const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.35, 8), droneDarkMat);
  gun.rotation.x = Math.PI / 2;
  gun.position.set(0, -0.2, 0.25);
  g.add(gun);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.18), droneDarkMat);
    fin.position.set(s * 0.45, 0, -0.05);
    fin.rotation.z = s * 0.3;
    g.add(fin);
    fins.push(fin);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3).translate(0, 0.15, 0), droneDarkMat);
    ant.position.set(s * 0.12, 0.28, -0.05);
    ant.rotation.z = -s * 0.3;
    g.add(ant);
    ants.push(ant);
  }
  g.rotation.order = 'YXZ';
  return { g, eyeMat, band, fins, ants, eye };
}

function makeBuzzerMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 10), buzzerMat);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  g.add(body);
  const eyeMat = enemyEyeMat(0xffaa22);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), eyeMat);
    eye.position.set(s * 0.08, 0.06, 0.12);
    g.add(eye);
  }
  const rotor = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.01, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.5 })
  );
  rotor.position.y = 0.16;
  g.add(rotor);
  const stinger = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.25, 6), droneDarkMat);
  stinger.rotation.x = Math.PI / 2;
  stinger.position.z = 0.38;
  g.add(stinger);
  g.rotation.order = 'YXZ';
  return { g, eyeMat, rotor };
}

class Enemy {
  constructor(type, x, z) {
    this.type = type;
    this.alive = true;
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.flash = 0;
    this.t = Math.random() * 10;
    this.spawnT = 0;
    if (type === 'drone') {
      const m = makeDroneMesh();
      this.group = m.g; this.eyeMat = m.eyeMat; this.parts = m;
      this.group.scale.setScalar(1.5);
      this.hp = 2; this.radius = 0.6; this.hover = 1.3 + Math.random() * 0.6;
      this.shootCd = 1.5 + Math.random() * 2;
      this.strafe = Math.random() > 0.5 ? 1 : -1;
      this.prefDist = 8 + Math.random() * 4;
      this.score = 100;
    } else if (type === 'buzzer') {
      const m = makeBuzzerMesh();
      this.group = m.g; this.eyeMat = m.eyeMat; this.rotor = m.rotor;
      this.group.scale.setScalar(1.4);
      this.hp = 1; this.radius = 0.45; this.hover = 0.6;
      this.attackCd = 1 + Math.random();
      this.score = 50;
    } else if (type === 'boss') {
      this.group = new THREE.Group();
      this.body = new THREE.Group();
      this.body.scale.setScalar(1.6);
      this.group.add(this.body);
      this.mat = new THREE.MeshStandardMaterial({ color: 0x6a3a50, roughness: 0.5, vertexColors: true, emissive: 0x200000 });
      this.body.add(makeFrogMesh(this.mat));
      this.pivot = new THREE.Group();
      this.body.add(this.pivot);
      this.saber = makeSaber(hiltTemplate, ENEMY_RED);
      this.saber.target = 1;
      this.pivot.add(this.saber.group);
      applyPose(this.pivot, POSES.idle);
      this.hp = this.maxHp = 16; this.radius = 0.9; this.hover = 0;
      this.state = 'chase'; this.stateT = 0; this.orbCd = 3;
      this.vy = 0; this.y = 0; this.hop = 0;
      this.score = 1000;
      this.didStrike = false;
    }
    this.group.position.set(x, type === 'boss' ? 12 : 10, z);
    scene.add(this.group);
  }
  get pos() { return this.group.position; }
  center(out = tmpV2) {
    out.copy(this.group.position);
    if (this.type === 'boss') out.y += 0.8;
    return out;
  }
}

function spawnEnemy(type) {
  const a = Math.random() * Math.PI * 2;
  const r = ARENA_RADIUS - 2;
  const e = new Enemy(type, Math.cos(a) * r, Math.sin(a) * r);
  spawnBeam(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), type === 'boss' ? ENEMY_RED : 0xff7744, type === 'boss' ? 1.6 : 0.6);
  enemies.push(e);
  return e;
}

function damageEnemy(e, amount, knockDir, knockAmt = 4) {
  if (!e.alive) return;
  if (e.type === 'boss' && e.state === 'stunned') amount *= 2;
  e.hp -= amount;
  e.flash = 0.15;
  if (knockDir) e.knock.addScaledVector(knockDir, knockAmt * (e.type === 'boss' ? 0.4 : 1));
  spawnSparks(e.center(), e.type === 'buzzer' ? 0xffaa22 : 0xffcc66, 12, 5);
  sfx.hit();
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  e.alive = false;
  score += e.score;
  const c = e.center().clone();
  spawnFlash(c, e.type === 'boss' ? ENEMY_RED : 0xffaa44, e.type === 'boss' ? 4 : 1.6, 0.4);
  spawnSparks(c, 0xffaa44, e.type === 'boss' ? 60 : 26, 8);
  sfx.explode();
  shake = Math.max(shake, e.type === 'boss' ? 0.6 : 0.2);
  spawnDebris(e);
  scene.remove(e.group);
  if (e.type === 'boss') {
    popup('SITH TOAD DEFEATED!');
    ui.boss.classList.add('hidden');
  }
}

function updateEnemies(dt) {
  const ppos = player.pos;
  const pc = player.center(new THREE.Vector3());
  for (const e of enemies) {
    if (!e.alive) continue;
    e.t += dt;
    e.flash = Math.max(0, e.flash - dt);

    // Spawn descent
    if (e.spawnT < 1) {
      e.spawnT += dt * 0.9;
      const targetY = e.type === 'boss' ? 0 : e.hover;
      e.pos.y = THREE.MathUtils.lerp(e.type === 'boss' ? 12 : 10, targetY, easeOut(Math.min(1, e.spawnT)));
      if (e.type === 'boss' && e.spawnT >= 1) {
        shake = 0.5;
        spawnFlash(e.pos.clone().setY(0.05), ENEMY_RED, 5, 0.6, true);
        sfx.explode();
      }
      faceTowards(e.group, ppos, dt, 10);
      continue;
    }

    const toP = tmpV.copy(ppos).sub(e.pos).setY(0);
    const dist = toP.length();
    const dirP = toP.clone().normalize();

    if (e.type === 'drone') {
      // Keep preferred distance and strafe around the player
      const radial = dist > e.prefDist + 1 ? 1 : dist < e.prefDist - 1 ? -1 : 0;
      if (Math.random() < dt * 0.3) e.strafe *= -1;
      const side = new THREE.Vector3(-dirP.z, 0, dirP.x).multiplyScalar(e.strafe);
      const desired = dirP.clone().multiplyScalar(radial * 2.8).addScaledVector(side, 2.0);
      e.vel.lerp(desired, Math.min(1, dt * 2));
      e.pos.y = e.hover + Math.sin(e.t * 2) * 0.15;
      faceTowards(e.group, ppos, dt, 8);
      animateDrone(e, dt);

      e.shootCd -= dt;
      const charge = THREE.MathUtils.clamp(1 - e.shootCd / 0.5, 0, 1);
      e.eyeMat.color.setHex(ENEMY_RED).multiplyScalar(2.5 + charge * 4);
      if (e.shootCd <= 0 && dist < 26) {
        const fireRate = Math.max(1.1, 3.0 - wave * 0.15);
        e.shootCd = fireRate * (0.7 + Math.random() * 0.6);
        // aim with a little lead and inaccuracy
        const muzzle = new THREE.Vector3(0, -0.2, 0.5).applyMatrix4(e.group.matrixWorld);
        const target = pc.clone().addScaledVector(player.vel, Math.min(0.5, dist / 18) * 0.6);
        target.x += (Math.random() - 0.5) * 0.6;
        target.z += (Math.random() - 0.5) * 0.6;
        fireBolt(muzzle, target.sub(muzzle), 15 + wave * 0.4, 'enemy', e, ENEMY_RED, 10);
        sfx.blaster();
        spawnFlash(muzzle, ENEMY_RED, 0.45, 0.12);
        e.recoil = 1;
        e.knock.addScaledVector(dirP, -1.2);
      }
    } else if (e.type === 'buzzer') {
      e.attackCd -= dt;
      e.rotor.rotation.y += dt * 40;
      e.group.rotation.z = Math.sin(e.t * 18) * 0.12;
      e.group.rotation.x = e.attackCd <= 0 ? 0.35 : Math.sin(e.t * 4) * 0.1;
      let desired;
      if (e.attackCd <= 0) {
        desired = dirP.clone().multiplyScalar(7.5);
        e.pos.y = THREE.MathUtils.damp(e.pos.y, 0.55, 4, dt);
      } else {
        const side = new THREE.Vector3(-dirP.z, 0, dirP.x);
        desired = side.multiplyScalar(4).addScaledVector(dirP, dist > 5 ? 3 : -2);
        e.pos.y = THREE.MathUtils.damp(e.pos.y, 1.6 + Math.sin(e.t * 3) * 0.3, 3, dt);
      }
      e.vel.lerp(desired, Math.min(1, dt * 3));
      faceTowards(e.group, tmpV2.copy(e.pos).add(e.vel), dt, 12);
      // contact damage
      if (e.pos.distanceTo(pc) < e.radius + 0.6) {
        damagePlayer(8, dirP);
        e.knock.addScaledVector(dirP, -8);
        e.attackCd = 1.5 + Math.random();
      }
    } else if (e.type === 'boss') {
      updateBoss(e, dt, dist, dirP);
    }

    // Separation from other enemies
    for (const o of enemies) {
      if (o === e || !o.alive) continue;
      const d = tmpV2.copy(e.pos).sub(o.pos).setY(0);
      const l = d.length();
      const min = e.radius + o.radius + 0.3;
      if (l < min && l > 0.001) e.pos.addScaledVector(d.normalize(), (min - l) * 0.5);
    }

    e.pos.addScaledVector(e.vel, dt);
    e.pos.addScaledVector(e.knock, dt);
    e.knock.multiplyScalar(Math.exp(-4 * dt));
    clampToArena(e.pos, ARENA_RADIUS, e.radius);
    pushOutOfObstacles(e.pos, e.radius);

    // Hit flash
    const flashOn = e.flash > 0;
    if (e.type === 'boss') e.mat.emissive.setHex(flashOn ? 0xff4040 : 0x200000);
    else e.group.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(flashOn ? 0x884444 : 0x000000); });
  }
  // Remove dead
  for (let i = enemies.length - 1; i >= 0; i--) if (!enemies[i].alive) enemies.splice(i, 1);
}

function updateBoss(e, dt, dist, dirP) {
  e.stateT += dt;
  e.saber.update(dt);
  const ppos = player.pos;
  const pc = player.center(new THREE.Vector3());
  // gravity for hops
  e.vy += GRAVITY * dt;
  e.y += e.vy * dt;
  if (e.y <= 0) { e.y = 0; e.vy = 0; }
  if (e.y <= 0 && e.wasAir) e.squash = 1;
  e.wasAir = e.y > 0;
  e.squash = Math.max(0, (e.squash || 0) - dt * 4);
  const br = Math.sin(e.t * 2) * 0.025;
  e.body.scale.set(1.6 * (1 + br + e.squash * 0.12), 1.6 * (1 + br * 0.5 - e.squash * 0.18), 1.6 * (1 + br + e.squash * 0.12));
  e.pos.y = e.y;
  ui.bossFill.style.width = Math.max(0, (e.hp / e.maxHp) * 100) + '%';

  const reach = 3.0;
  switch (e.state) {
    case 'chase': {
      faceTowards(e.group, ppos, dt, 6);
      const speed = dist > 6 ? 3.6 : 2.6;
      e.vel.lerp(dirP.clone().multiplyScalar(dist > reach - 0.4 ? speed : 0), Math.min(1, dt * 4));
      if (e.y === 0 && e.vel.lengthSq() > 0.5) { e.vy = 3.2; } // hop
      applyPose(e.pivot, POSES.idle);
      e.orbCd -= dt;
      if (dist < reach) { e.state = 'windup'; e.stateT = 0; e.didStrike = false; }
      else if (e.orbCd <= 0 && dist > 6) {
        e.orbCd = 3.5 + Math.random() * 2;
        e.state = 'cast'; e.stateT = 0;
      }
      break;
    }
    case 'windup': {
      e.vel.multiplyScalar(Math.exp(-8 * dt));
      faceTowards(e.group, ppos, dt, 5);
      const k = Math.min(1, e.stateT / 0.55);
      applyPose(e.pivot, lerpPose(POSES.idle, POSES.raised, easeOut(k)));
      e.mat.emissive.setRGB(0.15 + k * 0.4, 0, 0);
      if (e.stateT >= 0.55) { e.state = 'strike'; e.stateT = 0; sfx.swing(); }
      break;
    }
    case 'strike': {
      const k = Math.min(1, e.stateT / 0.18);
      applyPose(e.pivot, lerpPose(POSES.raised, POSES.strike, easeInOut(k)));
      if (!e.didStrike && k > 0.6) {
        e.didStrike = true;
        const fwd = new THREE.Vector3(Math.sin(e.group.rotation.y), 0, Math.cos(e.group.rotation.y));
        const toPlayer = tmpV.copy(ppos).sub(e.pos).setY(0);
        const d = toPlayer.length();
        toPlayer.normalize();
        if (d < reach + 0.6 && fwd.dot(toPlayer) > 0.2 && player.pos.y < 1.5) {
          const pf = player.forward(new THREE.Vector3());
          const facing = pf.dot(toPlayer.clone().negate()) > 0.35;
          if (player.blocking && facing && !player.throw) {
            // Parry!
            const mid = e.center().clone().lerp(pc, 0.5).setY(1.0);
            spawnSparks(mid, 0xffffff, 30, 7);
            spawnFlash(mid, 0xffffff, 1.2, 0.25);
            sfx.clash();
            shake = 0.35;
            e.state = 'stunned'; e.stateT = 0;
            e.knock.addScaledVector(toPlayer, -6);
            score += 100;
            popup('PARRY! STRIKE NOW!');
            break;
          }
          damagePlayer(20, toPlayer, 9);
        }
      }
      if (e.stateT >= 0.18) { e.state = 'recover'; e.stateT = 0; }
      break;
    }
    case 'recover': {
      e.vel.multiplyScalar(Math.exp(-6 * dt));
      applyPose(e.pivot, lerpPose(POSES.strike, POSES.idle, easeInOut(Math.min(1, e.stateT / 0.6))));
      if (e.stateT >= 0.6) { e.state = 'chase'; e.stateT = 0; }
      break;
    }
    case 'stunned': {
      e.vel.multiplyScalar(Math.exp(-6 * dt));
      applyPose(e.pivot, lerpPose(POSES.idle, POSES.slump, Math.min(1, e.stateT * 5)));
      e.body.rotation.z = Math.sin(e.stateT * 20) * 0.08;
      if (e.stateT >= 1.5) { e.state = 'chase'; e.stateT = 0; e.body.rotation.z = 0; }
      break;
    }
    case 'cast': {
      e.vel.multiplyScalar(Math.exp(-8 * dt));
      faceTowards(e.group, ppos, dt, 8);
      applyPose(e.pivot, lerpPose(POSES.idle, POSES.raised, Math.min(1, e.stateT * 3)));
      if (e.stateT >= 0.5) {
        const from = e.center().clone().setY(1.6);
        for (let i = -1; i <= 1; i++) {
          const dir = pc.clone().sub(from).normalize();
          dir.applyAxisAngle(UP, i * 0.22);
          fireBolt(from, dir, 12, 'enemy', e, 0xff3366, 15, true);
        }
        sfx.blaster();
        e.state = 'recover'; e.stateT = 0.3;
      }
      break;
    }
  }
  if (e.state !== 'stunned') e.body.rotation.z = 0;
}

function animateDrone(e, dt) {
  const p = e.parts;
  p.band.rotation.z += dt * 2.5;
  p.fins.forEach((f, i) => { const s = i ? 1 : -1; f.rotation.z = s * (0.3 + Math.sin(e.t * 14 + i) * 0.25); });
  p.ants.forEach((a, i) => { const s = i ? 1 : -1; a.rotation.x = Math.sin(e.t * 6 + i * 1.7) * 0.25; a.rotation.z = -s * 0.3 + Math.cos(e.t * 5 + i) * 0.1; });
  // bank into the strafe, pitch on recoil
  const yaw = e.group.rotation.y;
  const side = e.vel.x * Math.cos(yaw) - e.vel.z * Math.sin(yaw);
  const fwd = e.vel.x * Math.sin(yaw) + e.vel.z * Math.cos(yaw);
  e.recoil = Math.max(0, (e.recoil || 0) - dt * 5);
  e.group.rotation.z = THREE.MathUtils.damp(e.group.rotation.z, side * 0.12, 5, dt);
  e.group.rotation.x = THREE.MathUtils.damp(e.group.rotation.x, fwd * 0.08, 5, dt) - e.recoil * 0.25;
  p.eye.scale.setScalar(1 + Math.sin(e.t * 9) * 0.08 + (e.recoil * 0.5));
}

function faceTowards(obj, target, dt, rate) {
  const desired = Math.atan2(target.x - obj.position.x, target.z - obj.position.z);
  let diff = desired - obj.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  obj.rotation.y += diff * Math.min(1, rate * dt);
}

function clampToArena(p, R, r) {
  const l = Math.hypot(p.x, p.z);
  if (l > R - r) { p.x *= (R - r) / l; p.z *= (R - r) / l; }
}
function pushOutOfObstacles(p, r) {
  for (const o of world.obstacles) {
    const dx = p.x - o.x, dz = p.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + r;
    if (d < min && d > 0.0001) {
      p.x = o.x + (dx / d) * min;
      p.z = o.z + (dz / d) * min;
    }
  }
}

// ============================================================
// Game state
// ============================================================
let state = 'loading';
let score = 0;
let wave = 0;
let waveDelay = 0;
let shake = 0;
let camYaw = 0, camPitch = 0.4;
let saberColorName = 'blue';
let bestScore = 0;
try { bestScore = Number(localStorage.getItem('frogjedi.best') || 0); } catch (e) { /* storage unavailable */ }

function startWave(n) {
  wave = n;
  ui.wave.textContent = n;
  const isBoss = n % 4 === 0;
  if (isBoss) {
    banner(`WAVE ${n}: SITH TOAD`, 2.5);
    const boss = spawnEnemy('boss');
    boss.hp = boss.maxHp = 14 + n;
    ui.boss.classList.remove('hidden');
    for (let i = 0; i < Math.floor(n / 4); i++) spawnEnemy('drone');
  } else {
    banner(`WAVE ${n}`, 2);
    const drones = 1 + Math.floor(n * 0.9);
    const buzzers = Math.floor((n - 1) * 0.8);
    for (let i = 0; i < drones; i++) spawnEnemy('drone');
    for (let i = 0; i < buzzers; i++) spawnEnemy('buzzer');
  }
  sfx.wave();
}

function startGame() {
  sfx.init();
  for (const e of enemies) scene.remove(e.group);
  enemies.length = 0;
  for (const b of bolts) scene.remove(b.mesh);
  bolts.length = 0;
  score = 0;
  player.saber.setColor(SABER_COLORS[saberColorName]);
  player.trail.color.set(SABER_COLORS[saberColorName]);
  resetPlayer();
  sfx.ignite();
  ui.boss.classList.add('hidden');
  state = 'playing';
  waveDelay = 1.2;
  wave = 0;
  ui.wave.textContent = 1;
  ui.hud.classList.remove('hidden');
  ui.menu.classList.add('hidden');
  ui.gameover.classList.add('hidden');
  ui.pause.classList.add('hidden');
  lockPointer();
}

function gameOver() {
  state = 'dead';
  player.saber.target = 0;
  sfx.gameOver();
  if (score > bestScore) {
    bestScore = score;
    try { localStorage.setItem('frogjedi.best', String(bestScore)); } catch (e) { /* ignore */ }
  }
  $('go-wave').textContent = wave;
  $('go-score').textContent = score;
  $('go-best').textContent = `Best: ${bestScore}`;
  setTimeout(() => {
    if (state === 'dead') {
      ui.gameover.classList.remove('hidden');
      document.exitPointerLock?.();
    }
  }, 1500);
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  ui.pause.classList.remove('hidden');
  sfx.hum(false);
}
function resumeGame() {
  if (state !== 'paused') return;
  state = 'playing';
  ui.pause.classList.add('hidden');
  lockPointer();
}

// ============================================================
// Input
// ============================================================
const keys = new Set();
let mouseL = false, mouseR = false;
let pointerLocked = false;
let wasLocked = false;

function lockPointer() {
  try {
    const p = canvas.requestPointerLock?.();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* not supported */ }
}

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === canvas;
  if (pointerLocked) wasLocked = true;
  else if (wasLocked && state === 'playing') pauseGame();
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (state === 'playing') {
    if (e.code === 'Space') { tryJump(); e.preventDefault(); }
    if (e.code === 'KeyF' || e.code === 'KeyE') tryPush();
    if (e.code === 'KeyQ') tryThrow();
    if (e.code === 'KeyJ') trySwing();
    if (e.code === 'Escape' || e.code === 'KeyP') pauseGame();
  } else if (state === 'paused' && (e.code === 'KeyP' || e.code === 'Enter')) {
    resumeGame();
  } else if (e.code === 'Enter' && (state === 'menu' || (state === 'dead' && !ui.gameover.classList.contains('hidden')))) {
    e.preventDefault();
    startGame();
  }
  if (e.code === 'KeyM') sfx.setMuted(!sfx.muted);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouseL = mouseR = false; });

// Mouse: click to attack/block (and capture the pointer for mouse-look).
// Touch / pen: drag anywhere on the screen to look around.
let lookPointer = null, lastLX = 0, lastLY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') {
    if (state !== 'playing') return;
    if (!pointerLocked) lockPointer();
    if (e.button === 0) { mouseL = true; trySwing(); }
    if (e.button === 2) mouseR = true;
    return;
  }
  e.preventDefault();
  if (lookPointer !== null) return;
  lookPointer = e.pointerId;
  lastLX = e.clientX; lastLY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  document.body.classList.add('touching');
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lookPointer) return;
  const dx = e.clientX - lastLX, dy = e.clientY - lastLY;
  lastLX = e.clientX; lastLY = e.clientY;
  if (state === 'playing') {
    camYaw -= dx * TOUCH_SENS;
    camPitch = THREE.MathUtils.clamp(camPitch + dy * TOUCH_SENS, -0.25, 1.1);
  }
});
function endLook(e) {
  if (e.pointerId !== lookPointer) return;
  lookPointer = null;
  document.body.classList.remove('touching');
}
canvas.addEventListener('pointerup', endLook);
canvas.addEventListener('pointercancel', endLook);
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseL = false;
  if (e.button === 2) mouseR = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || state !== 'playing') return;
  camYaw -= e.movementX * MOUSE_SENS;
  camPitch = THREE.MathUtils.clamp(camPitch + e.movementY * MOUSE_SENS, -0.25, 1.1);
});

document.querySelectorAll('.swatch').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach((x) => x.classList.remove('sel'));
    b.classList.add('sel');
    saberColorName = b.dataset.color;
    if (player.saber) {
      player.saber.setColor(SABER_COLORS[saberColorName]);
      player.trail.color.set(SABER_COLORS[saberColorName]);
    }
  });
});
$('start').addEventListener('click', startGame);
$('restart').addEventListener('click', startGame);
$('resume').addEventListener('click', resumeGame);

// ============================================================
// Player actions
// ============================================================
function tryJump() {
  if (player.onGround) {
    player.vel.y = 6.5;
    player.onGround = false;
    player.jumps = 1;
    sfx.jump(false);
  } else if (player.jumps === 1 && player.force >= 15) {
    player.force -= 15;
    player.vel.y = 7.5;
    player.jumps = 2;
    player.flip = 0.001;
    sfx.jump(true);
    spawnFlash(player.pos.clone().setY(player.pos.y + 0.2), player.saber.color, 1.2, 0.3, true);
  }
}

function trySwing() {
  if (player.swing || player.throw) return;
  player.swingDir = 1 - player.swingDir;
  player.swing = { t: 0, dir: player.swingDir, hits: new Set(), deflected: new Set() };
  sfx.swing();
  // Lunge toward an enemy in front
  const fwd = player.forward(new THREE.Vector3());
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = tmpV.copy(e.pos).sub(player.pos).setY(0);
    const l = d.length();
    if (l < 5 && l > 1.5 && d.normalize().dot(fwd) > 0.7) {
      player.vel.x += fwd.x * 5;
      player.vel.z += fwd.z * 5;
      break;
    }
  }
}

function tryPush() {
  if (player.pushCd > 0 || player.force < 30) return;
  player.force -= 30;
  player.pushCd = 1.0;
  sfx.push();
  shake = Math.max(shake, 0.3);
  const fwd = player.forward(new THREE.Vector3());
  const c = player.center(new THREE.Vector3());
  spawnFlash(c.clone().addScaledVector(fwd, 1.2), player.saber.color, 4, 0.45, true);
  spawnFlash(c.clone().addScaledVector(fwd, 0.8), 0x88aaff, 1.2, 0.3);
  for (const e of enemies) {
    if (!e.alive || e.spawnT < 1) continue;
    const d = tmpV.copy(e.pos).sub(player.pos).setY(0);
    const l = d.length();
    if (l < 9 && d.normalize().dot(fwd) > 0.45) {
      const k = d.clone().setY(0).normalize();
      damageEnemy(e, 1, k, 16 * (1 - l / 12));
      if (e.type === 'boss' && e.state !== 'stunned') { e.state = 'stunned'; e.stateT = 0.6; }
    }
  }
  for (const b of bolts) {
    if (b.dead || b.owner !== 'enemy') continue;
    const d = tmpV.copy(b.pos).sub(c);
    if (d.length() < 9 && d.setY(0).normalize().dot(fwd) > 0.3) {
      redirectBolt(b, b.shooter && b.shooter.alive ? b.shooter : null, 0.2);
    }
  }
}

function tryThrow() {
  if (player.throw || player.swing || player.force < 35) return;
  player.force -= 35;
  sfx.throwSaber();
  const s = player.saber.group;
  const start = new THREE.Vector3();
  s.getWorldPosition(start);
  scene.attach(s);
  s.rotation.set(Math.PI / 2, 0, 0, 'YXZ');
  // Throw toward where the camera looks (slightly downward), flat-ish
  const dir = player.forward(new THREE.Vector3());
  player.throw = { t: 0, start, dir, hits: new Set(), spin: 0 };
}

function catchSaber() {
  const s = player.saber.group;
  player.pivot.add(s);
  s.position.set(0, 0, 0);
  s.rotation.set(0, 0, 0, 'YXZ');
  player.throw = null;
}

function damagePlayer(amount, dir, knock = 5) {
  if (player.invuln > 0 || state !== 'playing') return;
  player.hp -= amount;
  player.invuln = 0.6;
  player.hurtT = 0.2;
  if (dir) {
    player.vel.x += dir.x * knock;
    player.vel.z += dir.z * knock;
  }
  shake = Math.max(shake, 0.25);
  hurtFlash();
  sfx.hurt();
  if (player.hp <= 0) {
    player.hp = 0;
    gameOver();
  }
}

// ============================================================
// Player update
// ============================================================
const segBase = new THREE.Vector3(), segTip = new THREE.Vector3(), lastTip = new THREE.Vector3();

function updatePlayer(dt) {
  const alive = state === 'playing';

  // --- Turning ---
  if (keys.has('ArrowLeft')) camYaw += 2.6 * dt;
  if (keys.has('ArrowRight')) camYaw -= 2.6 * dt;
  if (keys.has('ArrowUp')) camPitch = Math.max(-0.25, camPitch - 1.2 * dt);
  if (keys.has('ArrowDown')) camPitch = Math.min(1.1, camPitch + 1.2 * dt);
  // the frog always faces where the camera looks
  let dy = camYaw - player.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  player.yaw += dy * Math.min(1, dt * 18);
  player.root.rotation.y = player.yaw;

  // --- Movement ---
  const fwd = player.forward(new THREE.Vector3());
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x).negate(); // camera right
  const input = new THREE.Vector3();
  if (alive) {
    if (keys.has('KeyW')) input.add(fwd);
    if (keys.has('KeyS')) input.sub(fwd);
    if (keys.has('KeyD')) input.add(right);
    if (keys.has('KeyA')) input.sub(right);
  }
  player.blocking = alive && (mouseR || keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyK')) && !player.swing && !player.throw;
  if (player.blocking && player.blockBlend < 0.05) player.blockStart = clock.elapsedTime;

  let speed = MOVE_SPEED * (player.blocking ? 0.45 : 1);
  if (input.lengthSq() > 0) input.normalize().multiplyScalar(speed);
  const accel = player.onGround ? 14 : 5;
  player.vel.x = THREE.MathUtils.damp(player.vel.x, input.x, accel, dt);
  player.vel.z = THREE.MathUtils.damp(player.vel.z, input.z, accel, dt);
  player.vel.y += GRAVITY * dt;
  player.pos.addScaledVector(player.vel, dt);
  if (player.pos.y <= 0) {
    if (!player.onGround && player.vel.y < -4) { player.squash = 1; spawnFlash(player.pos.clone().setY(0.03), 0x88aa88, 1, 0.3, true); }
    player.pos.y = 0;
    player.vel.y = 0;
    player.onGround = true;
    player.jumps = 0;
    player.flip = 0;
  }
  clampToArena(player.pos, ARENA_RADIUS, 0.6);
  pushOutOfObstacles(player.pos, 0.6);

  // --- Hop animation / squash ---
  const moving = input.lengthSq() > 0.1 && player.onGround;
  if (moving) player.hopPhase += dt * 11;
  else player.hopPhase = 0;
  const hop = moving ? Math.abs(Math.sin(player.hopPhase)) * 0.14 : 0;
  player.squash = Math.max(0, player.squash - dt * 5);
  const sq = player.squash * 0.25 + (player.onGround ? 0 : -0.08);
  player.model.position.y = hop;
  const br = moving ? 0 : Math.sin(clock.elapsedTime * 2.4) * 0.022; // breathing
  player.model.scale.set(1 + sq * 0.5 + br, 1 - sq + br * 0.5, 1 + sq * 0.5 + br);
  // little dust puff each time the feet touch down
  const hopIdx = Math.floor(player.hopPhase / Math.PI);
  if (moving && hopIdx !== player.lastHopIdx) {
    player.lastHopIdx = hopIdx;
    spawnFlash(player.pos.clone().setY(0.03), 0x5a6a44, 0.5, 0.3, true);
  }
  if (!moving) player.lastHopIdx = -1;
  // Force flip
  if (player.flip > 0) {
    player.flip = Math.min(1, player.flip + dt * 2.6);
    player.model.rotation.x = -player.flip * Math.PI * 2;
    if (player.flip >= 1) player.flip = 0;
  } else {
    player.model.rotation.x = 0;
  }
  // tilt into movement
  player.model.rotation.z = THREE.MathUtils.damp(player.model.rotation.z, -input.dot(right) * 0.02, 8, dt);

  // Hurt tint
  player.hurtT = Math.max(0, player.hurtT - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  FROG_MAT.emissive.setRGB(player.hurtT > 0 ? 0.6 : 0, 0, 0);
  player.mesh.visible = !(player.invuln > 0 && Math.floor(player.invuln * 20) % 2 === 0 && player.hurtT <= 0);

  // --- Force regen, cooldowns ---
  if (alive) player.force = Math.min(100, player.force + dt * 9);
  player.pushCd = Math.max(0, player.pushCd - dt);

  // --- Saber pose ---
  player.blockBlend = THREE.MathUtils.damp(player.blockBlend, player.blocking ? 1 : 0, 18, dt);
  let pose;
  if (player.throw) {
    pose = POSES.throw;
  } else if (player.swing) {
    const sw = player.swing;
    sw.t += dt;
    const a0 = sw.dir ? POSES.swingB0 : POSES.swingA0;
    const a1 = sw.dir ? POSES.swingB1 : POSES.swingA1;
    const W = 0.06, S = 0.2, R = 0.34;
    if (sw.t < W) pose = lerpPose(POSES.idle, a0, easeOut(sw.t / W));
    else if (sw.t < S) pose = lerpPose(a0, a1, easeInOut((sw.t - W) / (S - W)));
    else pose = lerpPose(a1, POSES.idle, easeInOut(Math.min(1, (sw.t - S) / (R - S))));
    if (sw.t >= W && sw.t <= S + 0.03) swingHits(sw);
    if (sw.t >= R) player.swing = null;
  } else {
    pose = lerpPose(POSES.idle, POSES.block, player.blockBlend);
    // idle sway
    pose.yaw += Math.sin(clock.elapsedTime * 1.5) * 0.04 * (1 - player.blockBlend);
  }
  applyPose(player.pivot, pose);

  // --- Thrown saber ---
  if (player.throw) updateThrow(dt);

  player.saber.update(dt);

  // --- Trail + hum ---
  player.saber.getSegment(segBase, segTip);
  const tipSpeed = segTip.distanceTo(lastTip) / Math.max(dt, 1e-4);
  lastTip.copy(segTip);
  player.trail.push(segBase, segTip, tipSpeed > 7 && player.saber.extend > 0.5, dt);
  sfx.hum(player.saber.extend > 0.3 && (state === 'playing' || state === 'dead'), Math.min(1, tipSpeed / 25));
}

function swingHits(sw) {
  const fwd = player.forward(new THREE.Vector3());
  const c = player.center(new THREE.Vector3());
  for (const e of enemies) {
    if (!e.alive || sw.hits.has(e) || e.spawnT < 1) continue;
    const ec = e.center(new THREE.Vector3());
    const d = ec.clone().sub(c);
    const vertical = Math.abs(d.y);
    d.setY(0);
    const l = d.length();
    if (l < 2.3 + e.radius && vertical < 1.8 && (l < 0.6 || d.normalize().dot(fwd) > 0.35)) {
      sw.hits.add(e);
      damageEnemy(e, e.type === 'drone' ? 2 : 1, d.lengthSq() ? d : fwd, 6);
      shake = Math.max(shake, 0.12);
    }
  }
  // deflect bolts in the arc
  for (const b of bolts) {
    if (b.dead || b.owner !== 'enemy') continue;
    const d = tmpV.copy(b.pos).sub(c);
    if (d.length() < 2.4) {
      d.setY(0).normalize();
      if (d.dot(fwd) > 0.0) {
        const target = nearestEnemyInFront(fwd, 0.5) || (b.shooter && b.shooter.alive ? b.shooter : null);
        redirectBolt(b, target, 0.08);
        sfx.deflect(false);
        spawnSparks(b.pos, player.saber.color, 10, 5);
        score += 10;
      }
    }
  }
}

function nearestEnemyInFront(fwd, minDot) {
  let best = null, bestD = Infinity;
  for (const e of enemies) {
    if (!e.alive || e.spawnT < 1) continue;
    const d = tmpV2.copy(e.pos).sub(player.pos).setY(0);
    const l = d.length();
    if (d.normalize().dot(fwd) > minDot && l < bestD) { bestD = l; best = e; }
  }
  return best;
}

function updateThrow(dt) {
  const th = player.throw;
  const s = player.saber.group;
  th.t += dt;
  th.spin += dt * 22;
  const OUT = 0.45, BACK = 0.5, RANGE = 11;
  const hand = new THREE.Vector3();
  player.pivot.getWorldPosition(hand);
  const outPos = th.start.clone().addScaledVector(th.dir, RANGE).setY(1.0);
  if (th.t < OUT) {
    s.position.copy(th.start).lerp(outPos, easeOut(th.t / OUT));
  } else {
    if (!th.returning) { th.returning = true; th.hits.clear(); }
    const k = Math.min(1, (th.t - OUT) / BACK);
    s.position.copy(outPos).lerp(hand, k * k);
  }
  s.rotation.set(Math.PI / 2, th.spin, 0, 'YXZ');
  // hits
  for (const e of enemies) {
    if (!e.alive || th.hits.has(e) || e.spawnT < 1) continue;
    const ec = e.center(new THREE.Vector3());
    const dxz = Math.hypot(ec.x - s.position.x, ec.z - s.position.z);
    if (dxz < 1.2 + e.radius * 0.5 && Math.abs(ec.y - s.position.y) < 1.2) {
      th.hits.add(e);
      damageEnemy(e, e.type === 'boss' ? 1 : 2, tmpV.copy(ec).sub(s.position).setY(0).normalize(), 5);
    }
  }
  for (const b of bolts) {
    if (b.dead || b.owner !== 'enemy') continue;
    if (b.pos.distanceTo(s.position) < 1.2) killBolt(b, player.saber.color);
  }
  if (th.t >= OUT + BACK) catchSaber();
}

// ============================================================
// Bolt update
// ============================================================
function updateBolts(dt) {
  const pc = player.center(new THREE.Vector3());
  const fwd = player.forward(new THREE.Vector3());
  for (const b of bolts) {
    if (b.dead) continue;
    b.life -= dt;
    b.pos.addScaledVector(b.vel, dt);
    const pulse = (b.big ? 2.2 : 1) * (1 + 0.25 * Math.sin(b.life * 50));
    b.mesh.scale.x = b.mesh.scale.z = pulse;
    if (b.life <= 0 || b.pos.y < -0.2 || Math.hypot(b.pos.x, b.pos.z) > 45) { killBolt(b); continue; }

    // trees block bolts
    let blocked = false;
    for (const o of world.obstacles) {
      if (b.pos.y < 6 && Math.hypot(b.pos.x - o.x, b.pos.z - o.z) < o.r) { blocked = true; break; }
    }
    if (blocked) { killBolt(b, 0xffaa66); continue; }

    if (b.owner === 'enemy') {
      const toBolt = tmpV.copy(b.pos).sub(pc);
      const dist = toBolt.length();
      // Blocking: deflect bolts approaching from the front
      if (player.blocking && dist < 1.4 && player.force >= 3) {
        const horiz = toBolt.clone().setY(0).normalize();
        if (horiz.dot(fwd) > -0.1) {
          const perfect = clock.elapsedTime - player.blockStart < 0.3;
          player.force -= perfect ? 0 : 3;
          const target = b.shooter && b.shooter.alive ? b.shooter : nearestEnemyInFront(fwd, 0.3);
          redirectBolt(b, target, perfect ? 0 : 0.18);
          spawnSparks(b.pos, player.saber.color, perfect ? 18 : 10, 5);
          sfx.deflect(perfect);
          score += perfect ? 35 : 10;
          if (perfect) popup('PERFECT DEFLECT');
          continue;
        }
      }
      if (dist < 0.62 + (b.big ? 0.15 : 0)) {
        damagePlayer(b.damage, b.vel.clone().setY(0).normalize(), 3);
        killBolt(b, ENEMY_RED);
      }
    } else {
      for (const e of enemies) {
        if (!e.alive || e.spawnT < 1) continue;
        if (b.pos.distanceTo(e.center(tmpV2)) < e.radius + 0.15) {
          damageEnemy(e, e.type === 'boss' ? 1 : 2, b.vel.clone().setY(0).normalize(), 4);
          if (!e.alive) score += 50; // deflect-kill bonus
          killBolt(b, player.saber.color);
          break;
        }
      }
    }
  }
  for (let i = bolts.length - 1; i >= 0; i--) if (bolts[i].dead) bolts.splice(i, 1);
}

// ============================================================
// Camera
// ============================================================
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const dist = 3.6;
  const pitch = camPitch;
  const fwd = new THREE.Vector3(Math.sin(camYaw), 0, Math.cos(camYaw));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x).negate();
  const target = tmpV.copy(player.pos).setY(player.pos.y * 0.6 + 0.9);
  camTarget.lerp(target, 1 - Math.exp(-12 * dt));
  const desired = camTarget.clone()
    .addScaledVector(fwd, -dist * Math.cos(pitch))
    .addScaledVector(right, 0.55)
    .setY(camTarget.y + dist * Math.sin(pitch) + 0.3);
  camera.position.copy(desired);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * shake * 0.5;
    shake = Math.max(0, shake - dt * 1.5);
  }
  camera.lookAt(camTarget.clone().addScaledVector(fwd, 3).addScaledVector(right, 0.45).setY(camTarget.y - 0.1));
}

// ============================================================
// HUD
// ============================================================
function updateHUD() {
  ui.hp.style.width = player.hp + '%';
  ui.force.style.width = player.force + '%';
  if (ui.score.textContent !== String(score)) {
    ui.score.textContent = score;
    ui.score.classList.remove('bump');
    void ui.score.offsetWidth;
    ui.score.classList.add('bump');
  }
  ui.hud.classList.toggle('low', player.hp < 30);
  ui.cdSlash.classList.toggle('active', !!player.swing);
  ui.cdBlock.classList.toggle('active', player.blocking);
  ui.cdPush.style.setProperty('--p', Math.round((1 - player.pushCd) * Math.min(1, player.force / 30) * 100) + '%');
  ui.cdThrow.style.setProperty('--p', player.throw ? '0%' : Math.round(Math.min(1, player.force / 35) * 100) + '%');
  ui.cdPush.classList.toggle('off', player.pushCd > 0 || player.force < 30);
  ui.cdThrow.classList.toggle('off', !!player.throw || player.force < 35);
}

// ============================================================
// Main loop
// ============================================================
const clock = new THREE.Clock();
let menuSpin = 0;

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 1 / 30);
  const t = clock.elapsedTime;
  world.update(dt, t);

  if (state === 'playing' || state === 'dead') {
    updatePlayer(dt);
    updateEnemies(dt);
    updateBolts(dt);
    updateCamera(dt);
    if (state === 'playing') {
      if (enemies.length === 0) {
        waveDelay -= dt;
        if (waveDelay <= 0) {
          if (wave > 0) {
            player.hp = Math.min(100, player.hp + 25);
            score += 250;
          }
          startWave(wave + 1);
          waveDelay = 2.5;
        }
      }
    }
    updateHUD();
  } else if (state === 'menu' || state === 'loading') {
    // slow orbit around the frog on the menu
    menuSpin += dt * 0.25;
    const mb = Math.sin(t * 2.4) * 0.022;
    player.model.scale.set(1 + mb, 1 + mb * 0.5, 1 + mb);
    if (player.saber) {
      player.saber.update(dt);
      const fakeSway = Math.sin(t * 1.5) * 0.05;
      const pose = lerpPose(POSES.idle, POSES.idle, 0);
      pose.yaw += fakeSway;
      applyPose(player.pivot, pose);
    }
    camera.position.set(Math.sin(menuSpin) * 3.2, 1.3, Math.cos(menuSpin) * 3.2);
    camera.lookAt(0, 0.55, 0);
  }

  updateSparks(dt);
  updateFlashes(dt);
  updateDebris(dt);

  if (bannerTimer > 0) {
    bannerTimer -= dt;
    if (bannerTimer <= 0) ui.banner.classList.remove('show');
  }
  if (flashTimer > 0) {
    flashTimer -= dt;
    if (flashTimer <= 0) ui.flash.style.opacity = 0;
  }

  composer.render();
}

// ============================================================
// Boot
// ============================================================
(async function boot() {
  const [frogObj, saberGltf] = await Promise.all([loadFrog(), loadSaber()]);
  frogGeo = prepareFrogGeometry(frogObj);
  hiltTemplate = prepareHilt(saberGltf);
  buildPlayer(SABER_COLORS[saberColorName]);
  player.saber.target = 1;
  ui.loading.classList.add('hidden');
  ui.menu.classList.remove('hidden');
  state = 'menu';
  // expose a few things for debugging in the console
  window.frogJedi = { player, enemies, bolts, scene, camera, startWave, POSES, applyPose, get state() { return state; } };
})();

loop();
