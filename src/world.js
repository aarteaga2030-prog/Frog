import * as THREE from 'three';

// Deterministic pseudo-random so the swamp looks the same every run.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const ARENA_RADIUS = 24;

// Builds the swamp: island, water, trees, reeds, lily pads, fireflies.
// Returns { obstacles, update(dt, t) }
export function buildWorld(scene) {
  const rand = rng(1337);
  const obstacles = []; // { x, z, r } circles that block movement and bolts
  const crowns = [];     // tree tops that sway
  const mossList = [];   // hanging moss strands
  const pads = [];       // floating lily pads

  scene.background = new THREE.Color(0x0a1719);
  scene.fog = new THREE.FogExp2(0x0d2124, 0.028);

  // ---- Lights ----
  const hemi = new THREE.HemisphereLight(0x9cc4b4, 0x1b2a12, 0.75);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xcfe0ff, 1.6);
  moon.position.set(-18, 30, 12);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera;
  sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30;
  sc.near = 1; sc.far = 80;
  moon.shadow.bias = -0.0005;
  moon.shadow.normalBias = 0.03;
  scene.add(moon);

  // Moon disc in the sky
  const moonDisc = new THREE.Mesh(
    new THREE.SphereGeometry(4, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xdfe9ff, fog: false })
  );
  moonDisc.position.set(-90, 70, 60);
  scene.add(moonDisc);

  // ---- Island ground ----
  const groundGeo = new THREE.CircleGeometry(36, 96, 0, Math.PI * 2);
  groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position;
  const gcol = new Float32Array(gp.count * 3);
  const cA = new THREE.Color(0x2c4a1f), cB = new THREE.Color(0x3d5a26), cMud = new THREE.Color(0x3a3020);
  const tmp = new THREE.Color();
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const r = Math.hypot(x, z);
    let y = 0.02 * Math.sin(x * 1.3) * Math.cos(z * 1.1);
    if (r > 26) y -= Math.pow((r - 26) / 10, 1.5) * 0.9;
    gp.setY(i, y);
    const n = 0.5 + 0.5 * Math.sin(x * 0.7 + Math.cos(z * 0.5) * 2) * Math.cos(z * 0.6);
    tmp.copy(cA).lerp(cB, n);
    if (r > 25) tmp.lerp(cMud, Math.min(1, (r - 25) / 4));
    gcol[i * 3] = tmp.r; gcol[i * 3 + 1] = tmp.g; gcol[i * 3 + 2] = tmp.b;
  }
  groundGeo.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // ---- Water ----
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400, 1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x12302e, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.92,
    })
  );
  water.position.y = -0.25;
  water.receiveShadow = true;
  scene.add(water);

  // ---- Trees ----
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3a2c1f, roughness: 1, flatShading: true });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x1e3a1b, roughness: 0.9, flatShading: true });
  const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x27461f, roughness: 0.9, flatShading: true });
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x4f6a3a, roughness: 1, side: THREE.DoubleSide });

  function makeTree(x, z, scale, blocking) {
    const g = new THREE.Group();
    const h = (6 + rand() * 4) * scale;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35 * scale, 0.7 * scale, h, 7, 4),
      trunkMat
    );
    // twist the trunk a bit
    const tp = trunk.geometry.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      tp.setX(i, tp.getX(i) + Math.sin(y * 0.6 + x) * 0.25 * scale);
      tp.setZ(i, tp.getZ(i) + Math.cos(y * 0.5 + z) * 0.25 * scale);
    }
    trunk.geometry.computeVertexNormals();
    trunk.position.y = h / 2;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    g.add(trunk);

    // roots
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + rand();
      const root = new THREE.Mesh(new THREE.ConeGeometry(0.22 * scale, 1.8 * scale, 5), trunkMat);
      root.position.set(Math.cos(a) * 0.7 * scale, 0.35 * scale, Math.sin(a) * 0.7 * scale);
      root.rotation.z = Math.cos(a) * 1.1;
      root.rotation.x = -Math.sin(a) * 1.1;
      root.castShadow = true;
      g.add(root);
    }

    // canopy blobs live in a crown group that sways in the wind
    const crown = new THREE.Group();
    g.add(crown);
    crowns.push({ obj: crown, phase: rand() * 6.28, amp: 0.012 + rand() * 0.01 });
    const blobs = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < blobs; i++) {
      const r = (1.6 + rand() * 1.4) * scale;
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), rand() > 0.5 ? leafMat : leafMat2);
      blob.position.set((rand() - 0.5) * 3 * scale, h + (rand() - 0.2) * 1.5 * scale, (rand() - 0.5) * 3 * scale);
      blob.scale.y = 0.65;
      blob.castShadow = true;
      crown.add(blob);
      // hanging moss strands
      for (let k = 0; k < 3; k++) {
        const len = (1 + rand() * 2.5) * scale;
        // pivot at the top so the strand swings like a pendulum
        const moss = new THREE.Mesh(new THREE.PlaneGeometry(0.25 * scale, len).translate(0, -len / 2, 0), mossMat);
        moss.position.set(
          blob.position.x + (rand() - 0.5) * r,
          blob.position.y - r * 0.5,
          blob.position.z + (rand() - 0.5) * r
        );
        moss.rotation.y = rand() * Math.PI;
        crown.add(moss);
        mossList.push({ obj: moss, phase: rand() * 6.28, speed: 0.8 + rand() * 0.8 });
      }
    }
    g.position.set(x, 0, z);
    g.rotation.y = rand() * Math.PI * 2;
    scene.add(g);
    if (blocking) obstacles.push({ x, z, r: 0.75 * scale });
  }

  // Ring of trees outside the arena
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.15;
    const r = 27 + rand() * 7;
    makeTree(Math.cos(a) * r, Math.sin(a) * r, 1 + rand() * 0.6, false);
  }
  // A few trees inside the arena to use as cover
  const inner = [[9, 6], [-11, 3], [3, -12], [-6, -9], [14, -8], [-4, 14]];
  for (const [x, z] of inner) makeTree(x, z, 0.85 + rand() * 0.3, true);

  // ---- Rocks ----
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4a5246, roughness: 1, flatShading: true });
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2;
    const r = 6 + rand() * 18;
    const s = 0.3 + rand() * 0.6;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat);
    rock.position.set(Math.cos(a) * r, s * 0.3, Math.sin(a) * r);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  // ---- Reeds (instanced) ----
  const reedGeo = new THREE.ConeGeometry(0.03, 1.4, 4);
  reedGeo.translate(0, 0.7, 0);
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x5b7a35, roughness: 1 });
  const windUniform = { value: 0 };
  reedMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniform;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.27;
      #else
        float ph = 0.0;
      #endif
      float bend = position.y * position.y * 0.06;
      transformed.x += sin(uTime * 1.6 + ph) * bend;
      transformed.z += cos(uTime * 1.2 + ph * 1.3) * bend * 0.6;`
    );
  };
  const REEDS = 700;
  const reeds = new THREE.InstancedMesh(reedGeo, reedMat, REEDS);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  for (let i = 0; i < REEDS; i++) {
    const a = rand() * Math.PI * 2;
    const r = 23 + rand() * 6;
    p3.set(Math.cos(a) * r, -0.2, Math.sin(a) * r);
    e.set((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4);
    q.setFromEuler(e);
    const sc2 = 0.6 + rand() * 0.9;
    s3.set(1, sc2, 1);
    m.compose(p3, q, s3);
    reeds.setMatrixAt(i, m);
  }
  scene.add(reeds);

  // ---- Lily pads ----
  const padGeo = new THREE.CircleGeometry(0.7, 16, 0.3, Math.PI * 2 - 0.6).rotateX(-Math.PI / 2);
  const padMat = new THREE.MeshStandardMaterial({ color: 0x3f7a2e, roughness: 0.6, side: THREE.DoubleSide });
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xf4a6c8, emissive: 0x401020, roughness: 0.5 });
  for (let i = 0; i < 60; i++) {
    const a = rand() * Math.PI * 2;
    const r = 30 + rand() * 25;
    const pad = new THREE.Mesh(padGeo, padMat);
    const s = 0.6 + rand() * 1.2;
    pad.scale.setScalar(s);
    pad.position.set(Math.cos(a) * r, -0.23, Math.sin(a) * r);
    pad.rotation.y = rand() * Math.PI * 2;
    scene.add(pad);
    pads.push({ obj: pad, baseY: pad.position.y, phase: rand() * 6.28, spin: (rand() - 0.5) * 0.1 });
    if (rand() > 0.7) {
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.2, 6, 1, true), flowerMat);
      fl.position.set(pad.position.x, -0.12, pad.position.z);
      fl.rotation.x = Math.PI;
      scene.add(fl);
      pads[pads.length - 1].flower = fl;
    }
  }

  // ---- Glowing mushrooms ----
  const capMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: 0x55ffe0 }));
  const capBase = new THREE.Color(0x55ffe0);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0xc8d0b0, roughness: 0.8 });
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = 4 + rand() * 20;
    const g = new THREE.Group();
    const h = 0.15 + rand() * 0.2;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, h, 5), stemMat);
    stem.position.y = h / 2;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1 + rand() * 0.06, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), capMats[i % 3]);
    cap.position.y = h;
    g.add(stem, cap);
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    scene.add(g);
  }

  // ---- Drifting ground mist ----
  const mistCanvas = document.createElement('canvas');
  mistCanvas.width = mistCanvas.height = 128;
  const mctx = mistCanvas.getContext('2d');
  const grad = mctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(170,200,190,0.35)');
  grad.addColorStop(1, 'rgba(190,220,210,0)');
  mctx.fillStyle = grad;
  mctx.fillRect(0, 0, 128, 128);
  const mistTex = new THREE.CanvasTexture(mistCanvas);
  const mists = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: mistTex, transparent: true, opacity: 0.1, depthWrite: false })
    );
    const size = 8 + rand() * 10;
    m.scale.set(size, 1, size * 0.7);
    m.position.set((rand() - 0.5) * 50, 0.15 + rand() * 0.5, (rand() - 0.5) * 50);
    m.renderOrder = 2;
    scene.add(m);
    mists.push({ obj: m, vx: 0.3 + rand() * 0.4, vz: (rand() - 0.5) * 0.3, spin: (rand() - 0.5) * 0.05, phase: rand() * 6.28 });
  }

  // ---- Water ripples ----
  const rippleGeo = new THREE.RingGeometry(0.9, 1, 40).rotateX(-Math.PI / 2);
  const ripples = [];
  let rippleTimer = 0;
  function spawnRipple() {
    let r = ripples.find((x) => !x.alive);
    if (!r) {
      if (ripples.length > 24) return;
      const mesh = new THREE.Mesh(rippleGeo, new THREE.MeshBasicMaterial({ color: 0x9fd8c8, transparent: true, depthWrite: false }));
      r = { mesh, alive: false };
      ripples.push(r);
      scene.add(mesh);
    }
    const a = rand() * Math.PI * 2;
    const d = 27 + rand() * 20;
    r.mesh.position.set(Math.cos(a) * d, -0.24, Math.sin(a) * d);
    r.t = 0; r.dur = 2 + rand() * 1.5; r.size = 1 + rand() * 1.5; r.alive = true; r.mesh.visible = true;
  }

  // ---- Fireflies ----
  const FF = 120;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FF * 3);
  const ffSeed = new Float32Array(FF * 3);
  for (let i = 0; i < FF; i++) {
    const a = rand() * Math.PI * 2;
    const r = 3 + rand() * 30;
    ffSeed[i * 3] = Math.cos(a) * r;
    ffSeed[i * 3 + 1] = 0.5 + rand() * 4;
    ffSeed[i * 3 + 2] = Math.sin(a) * r;
  }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  const fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({
    color: 0xd8ff7a, size: 0.12, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  scene.add(fireflies);

  function update(dt, t) {
    for (let i = 0; i < FF; i++) {
      ffPos[i * 3] = ffSeed[i * 3] + Math.sin(t * 0.3 + i) * 1.2;
      ffPos[i * 3 + 1] = ffSeed[i * 3 + 1] + Math.sin(t * 0.8 + i * 2.1) * 0.4;
      ffPos[i * 3 + 2] = ffSeed[i * 3 + 2] + Math.cos(t * 0.25 + i * 1.3) * 1.2;
    }
    ffGeo.attributes.position.needsUpdate = true;
    fireflies.material.opacity = 0.6 + 0.4 * Math.sin(t * 3);

    // wind gusts: a slow wave plus a faster flutter
    const gust = 0.6 + 0.4 * Math.sin(t * 0.35);
    windUniform.value = t * gust;
    for (const c of crowns) {
      c.obj.rotation.z = Math.sin(t * 0.7 + c.phase) * c.amp * gust;
      c.obj.rotation.x = Math.cos(t * 0.55 + c.phase) * c.amp * 0.7 * gust;
    }
    for (const m of mossList) {
      m.obj.rotation.x = Math.sin(t * m.speed + m.phase) * 0.18 * gust;
      m.obj.rotation.z = Math.cos(t * m.speed * 0.8 + m.phase) * 0.1 * gust;
    }
    for (const p of pads) {
      p.obj.position.y = p.baseY + Math.sin(t * 1.1 + p.phase) * 0.025;
      p.obj.rotation.y += p.spin * dt;
      if (p.flower) p.flower.position.y = p.obj.position.y + 0.11;
    }
    capMats.forEach((m, i) => m.color.copy(capBase).multiplyScalar(0.8 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 2.1))));
    for (const m of mists) {
      m.obj.position.x += m.vx * dt;
      m.obj.position.z += m.vz * dt;
      m.obj.rotation.y += m.spin * dt;
      if (m.obj.position.x > 30) m.obj.position.x = -30;
      if (Math.abs(m.obj.position.z) > 30) m.vz *= -1;
      m.obj.material.opacity = 0.07 + 0.04 * Math.sin(t * 0.4 + m.phase);
    }
    rippleTimer -= dt;
    if (rippleTimer <= 0) { spawnRipple(); rippleTimer = 0.25 + rand() * 0.5; }
    for (const r of ripples) {
      if (!r.alive) continue;
      r.t += dt;
      const k = r.t / r.dur;
      r.mesh.scale.setScalar(0.1 + k * r.size);
      r.mesh.material.opacity = 0.35 * (1 - k);
      if (k >= 1) { r.alive = false; r.mesh.visible = false; }
    }
    moonDisc.material.color.setScalar(0.85 + 0.05 * Math.sin(t * 0.2));
  }

  return { obstacles, update, moon };
}
