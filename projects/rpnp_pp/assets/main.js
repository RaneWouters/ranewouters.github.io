/* ============================================================
   main.js — interactive figures for the RPnP++ project page
   Faithful JS port of the paper's algorithm (pst_core.js)
   on top of three.js r128. All scenes render unconditionally
   (no visibility gating) so animations are always live.
   ============================================================ */
(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const NAVY = 0x23406e, ACCENT = 0xa63d2f, GREEN = 0x2e7d32, RED = 0xc0392b,
      GRAY = 0x8b93a1, GOLD = 0xc98a1b, INK = 0x1d2534;
const DEG = 180 / Math.PI;
const SELFTEST = location.search.indexOf('selftest') >= 0;

/* ============================ utilities ============================ */

function makeRenderer(holder) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: SELFTEST,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(holder.clientWidth, holder.clientHeight);
  holder.appendChild(renderer.domElement);
  return renderer;
}

function makeScene(bg) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg != null ? bg : 0xfdfdfc);
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(6, 10, 6);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  return scene;
}

class Orbit {
  constructor(camera, dom, target, opts) {
    this.camera = camera; this.dom = dom;
    this.target = target || new THREE.Vector3();
    this.opts = opts || {};
    this.theta = this.opts.theta != null ? this.opts.theta : -0.9;
    this.phi = this.opts.phi != null ? this.opts.phi : 1.15;
    this.radius = this.opts.radius || 14;
    this.autoSpeed = this.opts.autoSpeed || 0;
    this.dragging = false;
    this.dragEnabled = true;
    let px = 0, py = 0;
    dom.addEventListener('pointerdown', (e) => {
      if (!this.dragEnabled) return;
      this.dragging = true; px = e.clientX; py = e.clientY;
      dom.setPointerCapture(e.pointerId);
      dom.style.cursor = 'grabbing';
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragEnabled || !this.dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      px = e.clientX; py = e.clientY;
      // Match the intuitive drag direction: moving the mouse right rotates
      // the view to the right (the previous sign made it feel reversed).
      this.theta += dx * 0.0055;
      this.phi = Math.min(Math.PI - 0.08, Math.max(0.12, this.phi - dy * 0.0055));
    });
    const stop = () => { this.dragging = false; dom.style.cursor = this.dragEnabled ? 'grab' : 'default'; };
    dom.addEventListener('pointerup', stop);
    dom.addEventListener('pointercancel', stop);
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.radius *= e.deltaY > 0 ? 1.09 : 0.92;
      this.radius = Math.min(this.opts.maxR || 60, Math.max(this.opts.minR || 3, this.radius));
    }, { passive: false });
    dom.style.cursor = 'grab';
    this.update();
  }
  setDragEnabled(enabled) {
    this.dragEnabled = !!enabled;
    if (!this.dragEnabled) this.dragging = false;
    this.dom.style.cursor = this.dragEnabled ? 'grab' : 'default';
  }
  update(dt) {
    // A paused Task passes dt=0. Preserve that zero instead of treating it as
    // a missing value, otherwise the camera keeps rotating by 0.016 s/frame.
    if (this.autoSpeed && !this.dragging && dt != null) this.theta += this.autoSpeed * dt;
    this.camera.position.set(
      this.target.x + this.radius * Math.sin(this.phi) * Math.cos(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * Math.sin(this.phi) * Math.sin(this.theta)
    );
    this.camera.lookAt(this.target);
  }
}

function textSprite(text, opts) {
  opts = opts || {};
  const fs = opts.size || 46, pad = 12;
  const cv = document.createElement('canvas');
  let ctx = cv.getContext('2d');
  ctx.font = `${fs}px Georgia, serif`;
  cv.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  cv.height = fs + pad * 2;
  ctx = cv.getContext('2d');
  ctx.font = `${fs}px Georgia, serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts.color || '#23406e';
  ctx.fillText(text, pad, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  const sc = opts.scale || 0.55;
  spr.scale.set(sc * cv.width / cv.height, sc, 1);
  return spr;
}

function line(points, color, opts) {
  opts = opts || {};
  const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.Line(g, new THREE.LineBasicMaterial({
    color, transparent: opts.opacity != null, opacity: opts.opacity != null ? opts.opacity : 1,
  }));
}

function dotted(points, color, dashSize, gapSize, opacity) {
  const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(...p)));
  const m = new THREE.LineDashedMaterial({
    color, dashSize: dashSize || 0.12, gapSize: gapSize || 0.09,
    transparent: opacity != null, opacity: opacity != null ? opacity : 1,
  });
  const l = new THREE.Line(g, m);
  l.computeLineDistances();
  return l;
}

function sphere(pos, radius, color, opacity) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 18, 14),
    new THREE.MeshLambertMaterial({ color, transparent: opacity != null, opacity: opacity != null ? opacity : 1 })
  );
  m.position.set(pos[0], pos[1], pos[2]);
  return m;
}

function frustum(hx, hy, zf, color) {
  const c = [[hx, hy, zf], [-hx, hy, zf], [-hx, -hy, zf], [hx, -hy, zf]];
  const g = [];
  for (const k of c) { g.push(new THREE.Vector3(0, 0, 0)); g.push(new THREE.Vector3(...k)); }
  for (let i = 0; i < 4; i++) { g.push(new THREE.Vector3(...c[i])); g.push(new THREE.Vector3(...c[(i + 1) % 4])); }
  return new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(g),
    new THREE.LineBasicMaterial({ color })
  );
}

function imagePlane(hx, hy, z, color, opacity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(hx * 2, hy * 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity != null ? opacity : 0.07, side: THREE.DoubleSide, depthWrite: false })
  );
  m.position.z = z;
  return m;
}

function gridGround(size, divisions) {
  const g = new THREE.GridHelper(size, divisions, 0xdad5ca, 0xece8e0);
  g.material.transparent = true; g.material.opacity = 0.6;
  return g;
}

const m4 = (M) => new THREE.Matrix4().set(
  M[0][0], M[0][1], M[0][2], 0,
  M[1][0], M[1][1], M[1][2], 0,
  M[2][0], M[2][1], M[2][2], 0,
  0, 0, 0, 1);

/* rendering loop — every scene ticks every frame */
const liveScenes = [];
function registerScene(holder, tickFn, renderer) {
  liveScenes.push({ tick: tickFn, gl: SELFTEST && renderer ? renderer.getContext() : null });
}
let lastT = performance.now();
(function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
  for (const s of liveScenes) s.tick && s.tick(dt);
})(lastT);

if (SELFTEST) {
  window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
  setTimeout(() => {
    const out = { errors: window.__errors };
    liveScenes.forEach((sc, i) => {
      if (!sc.gl) return;
      try {
        for (let k = 0; k < 4; k++) sc.tick(0.016);
        const gl = sc.gl, W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, N = 32;
        const buf = new Uint8Array(N * N * 4);
        gl.readPixels(Math.floor(W / 2 - N / 2), Math.floor(H / 2 - N / 2), N, N, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let lit = 0;
        for (let p = 0; p < N * N; p++) {
          if ((buf[p*4] + buf[p*4+1] + buf[p*4+2]) / 3 < 246) lit++;
        }
        out['scene' + i] = { litFrac: +(lit / (N * N)).toFixed(3) };
      } catch (e) { out['scene' + i] = 'err:' + e.message; }
    });
    console.log('SELFTEST ' + JSON.stringify(out));
  }, 8000);
}

/* ==================== FLAGSHIP — the whole pipeline in one run ==================== */
(function () {
  const holder = $('viz-pipeline');
  if (!holder) return;

  const HX = 3.4, HY = 2.55, ZF = 8.5, IPZ = 2.0;
  const PHX = HX * IPZ / ZF, PHY = HY * IPZ / ZF;
  const N_POINTS = 240;
  const NR1 = 30, EPS = 0.01, VOTE_T = 0.004;        // Hough columns, consistency eps, seconds per candidate vote
  const HOLD_B = 1200;                                // ms on the completed vote view before marking it done
  const STEP_T = 0.5;                                // s per Gauss-Newton iteration

  const S = { step: 'A', running: false, cfg: 'ordinary', out: 0.5, seed: 20250601 };

  /* ---------- three stage layers ---------- */
  const stageA = document.createElement('div');
  const stageB = document.createElement('div');
  const stageC = document.createElement('div');
  [stageA, stageB, stageC].forEach(s => {
    s.style.cssText = 'position:absolute;inset:0;display:none;';
    holder.appendChild(s);
  });

  /* ----- stage A : the task (three.js) ----- */
  const rendererA = makeRenderer(stageA);
  const sceneA = makeScene();
  const cameraA = new THREE.PerspectiveCamera(42, 1, 0.05, 300);
  const orbitA = new Orbit(cameraA, stageA, new THREE.Vector3(0, 0.25, 5.2),
    { theta: -1.02, phi: 1.24, radius: 8.6, minR: 3, maxR: 45, autoSpeed: 0.09 });
  const furnA = new THREE.Group();
  furnA.add(frustum(HX, HY, ZF, NAVY));
  furnA.add(line([[0, 0, 0], [1.5, 0, 0]], 0xb0433a, { opacity: 0.8 }));
  furnA.add(line([[0, 0, 0], [0, 1.5, 0]], 0x3f7a44, { opacity: 0.8 }));
  furnA.add(line([[0, 0, 0], [0, 0, 1.5]], 0x33518b, { opacity: 0.8 }));
  const photoA = imagePlane(PHX, PHY, IPZ, 0xffffff, 0.94);
  furnA.add(photoA);
  {   /* solid black frame just in front of the image plane (4 strips) */
    const FZ = IPZ + 0.02, T = 0.035;
    const fm = new THREE.MeshBasicMaterial({ color: 0x11151d, side: THREE.DoubleSide });
    const strip = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), fm);
      m.position.set(x, y, FZ);
      return m;
    };
    furnA.add(strip(PHX*2 + T*2, T,      0,  PHY + T/2));
    furnA.add(strip(PHX*2 + T*2, T,      0, -PHY - T/2));
    furnA.add(strip(T, PHY*2,     -PHX - T/2,  0));
    furnA.add(strip(T, PHY*2,      PHX + T/2,  0));
  }
  furnA.add(gridGround(16, 16));
  sceneA.add(furnA);
  let dynA = null;

  // The refinement view reuses the same renderer for a small, clean 3D pose inset.
  const poseScene = makeScene();
  const poseCamera = new THREE.PerspectiveCamera(38, 1, 0.05, 300);
  poseCamera.position.set(8.2, 5.6, 10.5);
  poseCamera.lookAt(new THREE.Vector3(0.3, 0.15, 4.8));
  let poseStatic = null, poseDyn = null, poseKey = null;

  const legend = document.createElement('div');
  legend.style.cssText = 'position:absolute;left:12px;bottom:10px;font-size:11.5px;color:#5c6575;' +
    'background:rgba(255,253,249,.88);padding:6px 10px;border-radius:8px;border:1px solid #e6e2d9;';
  legend.innerHTML = '<span style="color:#2e7d32;font-weight:700">●</span> correct claim' +
    '&nbsp;&nbsp;<span style="color:#c0392b;font-weight:700">●</span> fabricated claim' +
    '&nbsp;&nbsp;<span style="color:#8b93a1">— the solver is never told which is which</span>';
  stageA.appendChild(legend);

  /* ----- stages B/C : 2D canvases ----- */
  const cvB = document.createElement('canvas'); cvB.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'; stageB.appendChild(cvB);
  const cvC = document.createElement('canvas'); cvC.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;'; stageC.appendChild(cvC);

  const g2 = { W: 0, H: 0, mx: 66, my: 26, pw: 0, ph: 0 };
  const g3 = { W: 0, H: 0 };

  const addv = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
  const applyM = (R, p) => [
    R[0][0]*p[0] + R[0][1]*p[1] + R[0][2]*p[2],
    R[1][0]*p[0] + R[1][1]*p[1] + R[1][2]*p[2],
    R[2][0]*p[0] + R[2][1]*p[1] + R[2][2]*p[2]
  ];

  function layout() {
    const w = holder.clientWidth, h = holder.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    rendererA.setSize(w, h);
    cameraA.aspect = w / h; cameraA.updateProjectionMatrix();
    g2.W = w; g2.H = h; g2.pw = w - g2.mx - 20; g2.ph = h - g2.my - 42;
    cvB.width = w * dpr; cvB.height = h * dpr; cvB.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    g3.W = w; g3.H = h;
    cvC.width = w * dpr; cvC.height = h * dpr; cvC.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function confineCloudToFrustum(cloud, hx, hy, zf) {
    /* Keep every model point inside the camera's four-sided pyramid.  The
       synthetic PST samples are valid mathematically but are intentionally
       wider than the explanatory frustum, which makes the 3D view look as if
       points are escaping through the side walls.  A single XY scale preserves
       each configuration's structure while giving the cloud a small interior
       margin at every depth. */
    if (!cloud || !cloud.X || !cloud.X.length) return;
    let maxRatio = 0;
    for (const p of cloud.X) {
      const z = Math.max(1e-6, p[2]);
      maxRatio = Math.max(maxRatio, Math.abs(p[0]) / (hx * z / zf), Math.abs(p[1]) / (hy * z / zf));
    }
    const scale = maxRatio > 1e-9 ? Math.min(1, 0.88 / maxRatio) : 1;
    for (const p of cloud.X) { p[0] *= scale; p[1] *= scale; }
  }

  /* ---------- shared data through all three steps ---------- */
  let data = null, baseData = null, baseKey = '', trial = null, voteEvents = [], ref = null, iBase = [0, 1];
  let frameIdx = 0, acc = 0;

  function pickBaseCandidates() {
    const X = data.X;
    const pairs = [];
    // Keep the browser demo bounded, but allow the extreme 95% outlier case
    // to reach a usable pair without consulting the explanatory mask.
    for (let a = 0; a < X.length && pairs.length < 200; a++) for (let b = a + 1; b < X.length && pairs.length < 200; b++) {
      const worldDistance = Math.hypot(X[a][0]-X[b][0], X[a][1]-X[b][1], X[a][2]-X[b][2]);
      const imageDistance = Math.hypot(data.V[a][0]-data.V[b][0], data.V[a][1]-data.V[b][1], data.V[a][2]-data.V[b][2]);
      // Select usable RANSAC samples from the correspondence data only. The
      // explanatory ground-truth mask must never choose the winning pair.
      if (worldDistance > 1e-3 && imageDistance > EPS * 7) pairs.push([a, b]);
    }
    return pairs.length ? pairs : [[0, 1]];
  }

  function run(newSeed) {
    const autoplay = S.running;
    if (newSeed) S.seed = (S.seed * 1664525 + 1013904223) >>> 0;
    const key = `${S.cfg}|${S.seed}`;
    const baseChanged = !baseData || baseKey !== key;
    if (baseChanged) {
      // Generate geometry once per configuration/seed. Changing the outlier
      // slider now only reveals additional fabricated matches on this same set.
      baseData = PST.generateData({ n: N_POINTS, outlierRate: 0, config: S.cfg, seed: S.seed });
      baseKey = key;
      confineCloudToFrustum(baseData, HX, HY, ZF);
      configurePoly(S.cfg, baseData);
      if (poseStatic) poseScene.remove(poseStatic);
      poseStatic = null;
      poseKey = null;
    }
    data = {
      X: baseData.X.map(p => p.slice()),
      V: baseData.V.map(p => p.slice()),
      mask: baseData.mask.slice(), gtR: baseData.gtR, gtt: baseData.gtt.slice()
    };
    stampShowcase();
    trial = null;
    let firstTrial = null, firstRef = null, firstPair = null;
    for (const pair of pickBaseCandidates()) {
      iBase = pair;
      const candidateTrial = PST.houghTrial(data.X, data.V, iBase[0], iBase[1], { nr1: NR1 });
      if (!candidateTrial || !candidateTrial.peaks.length) continue;
      const candidatePose = PST.poseFromPeak(candidateTrial, data.X, data.V, candidateTrial.peaks[0]);
      const candidateRef = candidatePose && PST.swgnRefine(candidatePose.R, candidatePose.t, data.X, data.V,
        { eps: EPS, iters: 4, converge: 1e-4 });
      if (!firstTrial) { firstTrial = candidateTrial; firstRef = candidateRef; firstPair = pair; }
      // Keep looking for a complete, data-driven hypothesis. This mirrors the
      // solver's RANSAC behavior at very high outlier rates without consulting
      // the explanatory inlier mask.
      if (candidateRef && candidateRef.success) {
        trial = candidateTrial; ref = candidateRef;
        break;
      }
    }
    if (!trial) { trial = firstTrial; ref = firstRef; if (firstPair) iBase = firstPair; }
    if (trial && !ref) ref = { history: [] };
    voteEvents = makeVoteEvents();
    if (!trial || !trial.peaks || !trial.peaks.length) {
      ref = { history: [] };
      poseKey = null;
      buildSceneDyn();
      frameIdx = 0; acc = 0;
      goto('A', autoplay);
      return;
    }
    poseKey = null;
    buildSceneDyn();
    frameIdx = 0; acc = 0;
    goto('A', autoplay);
  }

  /* twelve showcase correspondences: the vertices of an icosahedron (20 faces),
     placed with an arbitrary orientation and offset so it does not sit axis-aligned */
  const IFACES = [
    [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
    [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
    [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
    [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]
  ];
  const POLY_BASE = (() => {
    const t = (1 + Math.sqrt(5)) / 2;
    const raw = [[-1,t,0],[1,t,0],[-1,-t,0],[1,-t,0],
                 [0,-1,t],[0,1,t],[0,-1,-t],[0,1,-t],
                 [t,0,-1],[t,0,1],[-t,0,-1],[-t,0,1]];
    const rx = 0.42, ry = 0.78, rz = 0.25, s = 0.78, c = [0.42, 0.18, 5.55];
    const [CX,SX,CYd,SYd,CZ,SZ] = [Math.cos(rx),Math.sin(rx),Math.cos(ry),Math.sin(ry),Math.cos(rz),Math.sin(rz)];
    return raw.map(p => {
      let [x, y, z] = p;
      let y1 = y*CX - z*SX, z1 = y*SX + z*CX;          // rot X
      let x2 = x*CYd + z1*SYd, z2 = -x*SYd + z1*CYd;   // rot Y
      let x3 = x2*CZ - y1*SZ, y3 = x2*SZ + y1*CZ;      // rot Z
      return [c[0] + x3*s, c[1] + y3*s, c[2] + z2*s];
    });
  })();
  let POLY = POLY_BASE.map(p => p.slice());
  function configurePoly(config, cloud) {
    const baseCenter = [0.42, 0.18, 5.55];
    let center = baseCenter.slice();
    // Keep the same named vertices while making the conditioning cases legible:
    // quasi-singular is a narrow depth-heavy cluster; planar is a thin slab.
    if (config === 'quasi') {
      // Use the confined cloud's centroid so the showcase polyhedron remains
      // embedded in the same narrow cluster after the frustum fit.
      if (cloud && cloud.X && cloud.X.length) {
        center = cloud.X.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(v => v / cloud.X.length);
      } else {
        center = [1.5, 1.5, 6.0];
      }
      const s = [0.34, 0.34, 1.28];
      POLY = POLY_BASE.map(p => [center[0] + (p[0] - baseCenter[0]) * s[0], center[1] + (p[1] - baseCenter[1]) * s[1], center[2] + (p[2] - baseCenter[2]) * s[2]]);
      return;
    }
    if (config === 'planar' && cloud && cloud.X && cloud.X.length >= 3) {
      // Use the generated plane itself, so the showcase vertices sit in the
      // same slab as the surrounding planar points rather than floating away.
      center = cloud.X.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(v => v / cloud.X.length);
      const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1e-9; return v.map(q => q / l); };
      const u = unit(sub(cloud.X[1], cloud.X[0]));
      const n = unit(cross3(sub(cloud.X[1], cloud.X[0]), sub(cloud.X[2], cloud.X[0])));
      const v = unit(cross3(n, u));
      POLY = POLY_BASE.map(p => {
        const q = [p[0] - baseCenter[0], p[1] - baseCenter[1], p[2] - baseCenter[2]];
        return [center[0] + u[0] * q[0] * 0.86 + v[0] * q[1] * 0.86 + n[0] * q[2] * 0.035,
                center[1] + u[1] * q[0] * 0.86 + v[1] * q[1] * 0.86 + n[1] * q[2] * 0.035,
                center[2] + u[2] * q[0] * 0.86 + v[2] * q[1] * 0.86 + n[2] * q[2] * 0.035];
      });
      return;
    }
    POLY = POLY_BASE.map(p => [center[0] + (p[0] - baseCenter[0]), center[1] + (p[1] - baseCenter[1]), center[2] + (p[2] - baseCenter[2])]);
  }
  function stampShowcase() {
    /* The showcased polyhedron vertices are explanatory true matches. The
       requested outlier count is rebuilt among the remaining correspondences;
       the mask is for coloring only and never selects the RANSAC sample. */
    const n = data.X.length, NP = POLY.length;
    const k = Math.min(n - NP, Math.round(S.out * n));
    S.kOut = k;
    let seed = (S.seed ^ 0x9e3779b9) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rays = Array.from({ length: n }, () => {
      // Keep fabricated image dots inside the framed image plane so the
      // highlighted 3D point always has a visible partner on the left.
      return norm3([(rnd() * 2 - 1) * PHX / IPZ, (rnd() * 2 - 1) * PHY / IPZ, 1]);
    });
    const idx = [];
    for (let i = NP; i < n; i++) idx.push(i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0, tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp;
    }
    const isOut = new Set(idx.slice(0, k));
    for (let i = 0; i < n; i++) {
      if (i < NP) {                                     // showcase vertex: always true
        data.X[i] = POLY[i].slice();
        data.mask[i] = true;
        data.V[i] = norm3(POLY[i]);
      } else if (isOut.has(i)) {                        // fabricated match
        data.mask[i] = false;
        data.V[i] = rays[(i * 13) % rays.length].slice();
      } else {                                          // plain true inlier
        data.mask[i] = true;
        data.V[i] = norm3(data.X[i]);
      }
    }
  }
  function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1e-9; return [v[0]/l, v[1]/l, v[2]/l]; }

  function makeVoteEvents() {
    if (!trial || !trial.votes || !trial.peaks || !trial.peaks.length) return [];
    const nr2 = NR1 * 2;
    const grouped = new Map();
    trial.votes.forEach(v => {
      if (!grouped.has(v.i)) grouped.set(v.i, []);
      grouped.get(v.i).push(v);
    });
    const events = [];
    // Preserve the actual candidate multiplicity: the C++ trial evaluates every
    // valid correspondence/theta candidate, and every surviving candidate casts
    // one vote. A point can therefore appear more than once in this replay.
    const allIndices = [];
    for (let i = 0; i < data.X.length; i++) if (i !== iBase[0] && i !== iBase[1]) allIndices.push(i);
    for (const i of allIndices) {
      const candidates = grouped.get(i);
      if (!candidates || !candidates.length) {
        // A point with no valid PST candidate is still shown once in the
        // replay, as a gray rejected marker rather than silently disappearing.
        events.push({ i, j: (i * 11 + 5) % NR1, k: (i * 17 + 9) % nr2, loss: Infinity, valid: false });
        continue;
      }
      candidates.forEach(v => events.push({ i, j: v.j, k: v.k, loss: v.loss, valid: true }));
    }
    return events;
  }

  function buildSceneDyn() {
    if (dynA) sceneA.remove(dynA);
    dynA = new THREE.Group();

    /* 20 triangular faces, translucent */
    const faceIdx = IFACES;
    const pos = new Float32Array(faceIdx.length * 9);
    faceIdx.forEach((f, k) => f.forEach((vi, m) => {
      pos[k*9+m*3] = POLY[vi][0]; pos[k*9+m*3+1] = POLY[vi][1]; pos[k*9+m*3+2] = POLY[vi][2];
    }));
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dynA.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
      color: 0x8fb0d8, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false })));

    /* all 30 edges, derived from the face list */
    const eset = new Set();
    faceIdx.forEach(f => { for (let k = 0; k < 3; k++) {
      const a = f[k], b = f[(k+1)%3];
      eset.add(Math.min(a,b) + '-' + Math.max(a,b));
    }});
    eset.forEach(e => {
      const [a, b] = e.split('-').map(Number);
      dynA.add(line([POLY[a], POLY[b]], 0x33518b, { opacity: 0.85 }));
    });

    /* the twelve showcased correspondences: model point -> observed image dot
       (always green). For an outlier, the observed dot is intentionally not the
       perspective projection of X; it comes from the mismatched ray V. */
    for (let i = 0; i < POLY.length; i++) {
      const X = data.X[i];
      dynA.add(sphere(X, 0.095, GREEN, 1));
      const v = data.V[i], pz = IPZ / Math.max(1e-6, v[2]), dot = [v[0]*pz, v[1]*pz, IPZ];
      dynA.add(line([X, dot], GREEN, { opacity: 0.45 }));
      dynA.add(sphere(dot, 0.042, GREEN, 0.95));
    }

    /* the fabricated matches: many red pairs, drawn lighter than the showcase */
    for (let i = POLY.length; i < data.X.length; i++) {
      if (data.mask[i]) continue;
      const X = data.X[i];
      dynA.add(sphere(X, 0.06, RED, 0.75));
      const v = data.V[i], pz = IPZ / Math.max(1e-6, v[2]), dot = [v[0]*pz, v[1]*pz, IPZ];
      dynA.add(line([X, dot], RED, { opacity: 0.22 }));
      dynA.add(sphere(dot, 0.028, RED, 0.8));
    }
    sceneA.add(dynA);
  }

  function ensurePoseStatic() {
    if (poseStatic) return;
    poseStatic = new THREE.Group();
    const pos = new Float32Array(IFACES.length * 9);
    IFACES.forEach((f, k) => f.forEach((vi, m) => {
      pos[k * 9 + m * 3] = POLY[vi][0];
      pos[k * 9 + m * 3 + 1] = POLY[vi][1];
      pos[k * 9 + m * 3 + 2] = POLY[vi][2];
    }));
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    poseStatic.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0x8fb0d8, transparent: true, opacity: 0.11, side: THREE.DoubleSide, depthWrite: false })));
    const eset = new Set();
    IFACES.forEach(f => { for (let k = 0; k < 3; k++) eset.add(Math.min(f[k], f[(k + 1) % 3]) + '-' + Math.max(f[k], f[(k + 1) % 3])); });
    eset.forEach(e => { const [a, b] = e.split('-').map(Number); poseStatic.add(line([POLY[a], POLY[b]], 0x33518b, { opacity: 0.82 })); });
    poseStatic.add(gridGround(12, 12));
    poseScene.add(poseStatic);
  }

  function cameraCenter(st) {
    const r = st.R, t = st.t;
    const rt = [[r[0][0], r[1][0], r[2][0]], [r[0][1], r[1][1], r[2][1]], [r[0][2], r[1][2], r[2][2]]];
    return [-rt[0][0] * t[0] - rt[0][1] * t[1] - rt[0][2] * t[2],
            -rt[1][0] * t[0] - rt[1][1] * t[1] - rt[1][2] * t[2],
            -rt[2][0] * t[0] - rt[2][1] * t[1] - rt[2][2] * t[2]];
  }

  function cameraRig(st, color, opacity, scale) {
    const r = st.R;
    const rt = [[r[0][0], r[1][0], r[2][0]], [r[0][1], r[1][1], r[2][1]], [r[0][2], r[1][2], r[2][2]]];
    const rig = new THREE.Group();
    rig.add(frustum(HX * 0.30, HY * 0.30, ZF * 0.28, color));
    rig.add(line([[0, 0, 0], [0.65, 0, 0]], 0xb0433a, { opacity: opacity * 0.9 }));
    rig.add(line([[0, 0, 0], [0, 0.65, 0]], 0x3f7a44, { opacity: opacity * 0.9 }));
    rig.add(line([[0, 0, 0], [0, 0, 0.65]], 0x33518b, { opacity: opacity * 0.9 }));
    rig.position.set(...cameraCenter(st));
    rig.setRotationFromMatrix(m4(rt));
    rig.scale.setScalar(scale || 1);
    rig.traverse(o => { if (o.material) { o.material.transparent = true; o.material.opacity *= opacity; } });
    return rig;
  }

  function updatePoseScene(current, initial, key) {
    ensurePoseStatic();
    if (poseDyn && poseKey === key) return;
    poseKey = key;
    if (poseDyn) poseScene.remove(poseDyn);
    poseDyn = new THREE.Group();
    poseDyn.add(cameraRig(initial, 0x8b93a1, 0.35, 0.82));
    poseDyn.add(cameraRig(current, NAVY, 0.95, 0.82));
    poseScene.add(poseDyn);
  }

  /* ---------- captions / chrome ---------- */
  const tabs = Array.from(document.querySelectorAll('.step-tab'));
  const badge = $('pipe-badge'), cap = $('pipe-cap'), ro = $('pipe-readout');
  const runBtn = $('pp-run');
  let stepDone = false;
  const stepNames = { B: 'Vote', C: 'Refine' };
  function updateRunButton() {
    if (!runBtn) return;
    if (S.step === 'A') {
      runBtn.textContent = S.running ? '⏸ Pause motion' : '▶ Start motion';
      runBtn.title = 'Start or pause the automatic 3D motion.';
      orbitA.setDragEnabled(S.running);
      badge.textContent = S.running ? 'drag to orbit · step ①' : 'start motion to animate · step ①';
    } else {
      runBtn.textContent = S.running ? '⏸ Pause' : '↻ Replay ' + stepNames[S.step];
      runBtn.title = 'Pause or replay the current stage animation.';
    }
  }

  function capText(step) {
    if (step === 'A') {
      const k = S.kOut || 0;
      const layoutName = S.cfg === 'quasi' ? 'quasi-singular' : S.cfg === 'planar' ? 'planar' : 'ordinary';
      return `<b>① The task.</b> A calibrated camera watches a <b>${layoutName}</b> icosahedron layout at an arbitrary pose. Its <b>twelve vertices</b> are matched to twelve dots on the framed image plane &mdash; all twelve claims are correct (<span style="color:#2e7d32;font-weight:600">green</span>). Scattered around them are <b>${k} fabricated matches</b> (<span style="color:#c0392b;font-weight:600">red</span>): photo dots paired with points they never saw. Recover [R|t] without knowing which is which. Use the tabs and the replay control to inspect the same ${data ? data.X.length : N_POINTS} correspondences in steps ②&ndash;③.`;
    }
    if (step === 'B') return `<b>② Vote.</b> One usable two-point sample defines a shared edge. Every surviving correspondence/θ candidate contributes one vote in the bounded <span class="mono">(θ, ω₂ₚ)</span> space; a point can contribute several candidates, while a gray × marks a point with no valid candidate. Follow the highlighted 3D point and its observed image dot on the left into the ballot box: agreement becomes density.`;
    return `<b>③ Refine.</b> The consensus cell gives the integer-bin Hough hypothesis. The production finalizer then applies dynamic soft-weighted Gauss–Newton in three stages, <span class="mono">[3, 4, ∞]</span>. The left inset shows the fixed Hough pose in gray and the current pose in blue; on the right, compare the same observations with the changing predictions and residuals.`;
  }

  function goto(step, autoplay) {
    S.step = step;
    phaseMs = 0;
    frameIdx = 0;
    acc = 0;
    stepDone = false;
    if (autoplay !== undefined) S.running = autoplay;
    stageA.style.display = step === 'A' ? 'block' : 'none';
    stageB.style.display = step === 'B' ? 'block' : 'none';
    stageC.style.display = step === 'C' ? 'block' : 'none';
    tabs.forEach(t => t.classList.toggle('active', t.dataset.step === step));
    badge.style.display = step === 'A' ? '' : 'none';
    cap.innerHTML = capText(step);
    updateRunButton();
    // Step B/C reuse the flagship renderer as an offscreen texture. Restore the
    // full-size task viewport whenever the user returns to step A.
    if (step === 'A') layout();
    if (step === 'A') {
      ro.textContent = `${POLY.length} correct claims · ${S.kOut || 0} wrong matches`;
    }
  }

  tabs.forEach(t => t.addEventListener('click', () => goto(t.dataset.step, false)));

  /* ================= STEP B drawing : task scene → linked vote evidence ================= */
  function drawB() {
    if (!trial || !g2.W) return;
    const x = cvB.getContext('2d');
    x.clearRect(0, 0, g2.W, g2.H);
    const elapsed = phaseMs / 1000;
    const totalVotes = voteEvents.length;
    const voteIndex = Math.min(totalVotes - 1, Math.floor(elapsed / VOTE_T));
    const done = elapsed >= totalVotes * VOTE_T;
    const shownVotes = voteIndex >= 0 ? voteEvents.slice(0, voteIndex + 1) : [];
    const focus = voteIndex >= 0 ? voteEvents[voteIndex] : null;
    const compact = g2.W < 650;
    const taskX = 18, taskY = 52;
    const taskW = compact ? g2.W - 36 : Math.min(390, Math.max(300, g2.W * 0.38));
    const taskH = compact ? 128 : g2.H - 100;
    const hmX = compact ? 28 : taskX + taskW + 32;
    const hmY = compact ? 198 : 58;
    const hmW = compact ? g2.W - 56 : g2.W - hmX - 24;
    const hmH = compact ? g2.H - 246 : g2.H - 116;
    const cellW = hmW / NR1, cellH = hmH / 60;

    x.fillStyle = '#1d2534'; x.font = '600 13px Helvetica'; x.textAlign = 'left';
    x.fillText('Every surviving candidate → one vote', 18, 20);
    x.fillStyle = '#8b93a1'; x.font = '11px Helvetica';
    x.fillText(compact ? 'same task scene · candidate votes accumulate' : 'same task scene · each valid correspondence/θ candidate appears on the right', 18, 36);

    // Render the complete Task scene into the left half so the correspondence keeps its 3D context.
    // Use a cloned camera with a widened vertical FOV: the narrow panel should
    // letterbox the scene rather than crop the frustum, plane, or point cloud.
    const taskCamera = cameraA.clone();
    const sourceAspect = cameraA.aspect || (g2.W / g2.H);
    const taskAspect = taskW / Math.max(1, taskH);
    const fitFov = 2 * Math.atan(Math.tan(cameraA.fov * Math.PI / 360) * sourceAspect / taskAspect) * DEG;
    taskCamera.aspect = taskAspect;
    taskCamera.fov = Math.max(cameraA.fov, Math.min(112, fitFov));
    taskCamera.updateProjectionMatrix();
    rendererA.setSize(Math.max(1, taskW), Math.max(1, taskH), false);
    rendererA.render(sceneA, taskCamera);
    x.drawImage(rendererA.domElement, 0, 0, rendererA.domElement.width, rendererA.domElement.height, taskX, taskY, taskW, taskH);
    x.strokeStyle = '#e6e2d9'; x.lineWidth = 1.2; x.strokeRect(taskX, taskY, taskW, taskH);
    x.fillStyle = 'rgba(255,253,249,.9)'; x.fillRect(taskX + 8, taskY + 8, Math.min(245, taskW - 16), 20);
    const taskConfigLabel = S.cfg === 'quasi' ? 'quasi-singular' : S.cfg === 'planar' ? 'planar' : 'ordinary';
    x.fillStyle = '#5c6575'; x.font = '600 11px Helvetica'; x.fillText(`Task view · ${taskConfigLabel} layout · 120 correspondences`, taskX + 14, taskY + 22);

    const projectTask = (point) => {
      const q = new THREE.Vector3(point[0], point[1], point[2]).project(taskCamera);
      return { x: taskX + (q.x + 1) * 0.5 * taskW, y: taskY + (1 - q.y) * 0.5 * taskH };
    };
    const a0 = projectTask(data.X[iBase[0]]), a1 = projectTask(data.X[iBase[1]]);
    [a0, a1].forEach((pnt, q) => { x.fillStyle = '#c98a1b'; x.beginPath(); x.arc(pnt.x, pnt.y, 7, 0, 7); x.fill(); x.fillStyle = '#fffdf9'; x.font = 'bold 10px Helvetica'; x.fillText(`P${q}`, pnt.x - 6, pnt.y + 4); });
    let focusScreen = null, focusObsScreen = null;
    if (focus) {
      focusScreen = projectTask(data.X[focus.i]);
      const v = data.V[focus.i], oz = IPZ / Math.max(1e-6, v[2]);
      focusObsScreen = projectTask([v[0] * oz, v[1] * oz, IPZ]);
      x.strokeStyle = '#f2b84b'; x.lineWidth = 2.2; x.beginPath(); x.arc(focusScreen.x, focusScreen.y, 11, 0, 7); x.stroke();
      x.beginPath(); x.arc(focusObsScreen.x, focusObsScreen.y, 8, 0, 7); x.stroke();
      x.strokeStyle = 'rgba(242,184,75,.85)'; x.lineWidth = 1.4; x.setLineDash([3, 3]);
      x.beginPath(); x.moveTo(focusScreen.x, focusScreen.y); x.lineTo(focusObsScreen.x, focusObsScreen.y); x.stroke(); x.setLineDash([]);
      x.fillStyle = '#f2b84b'; x.font = '600 11px Helvetica';
      x.fillText(`Pᵢ  #${focus.i}`, Math.min(focusScreen.x + 13, taskX + taskW - 66), focusScreen.y - 11);
      x.fillText('observed dot', Math.min(focusObsScreen.x + 10, taskX + taskW - 76), focusObsScreen.y + 17);
    }

    const heat = {};
    shownVotes.forEach(v => { if (v.valid !== false) { const key = v.j + ',' + v.k; heat[key] = (heat[key] || 0) + 1; } });
    const voteSlots = {}, votePos = new Map();
    shownVotes.forEach((v, idx) => {
      const key = v.j + ',' + v.k;
      if (!voteSlots[key]) voteSlots[key] = [];
      voteSlots[key].push(idx);
    });
    x.strokeStyle = '#d9d4c8'; x.lineWidth = 1.3; x.strokeRect(hmX, hmY, hmW, hmH);
    x.fillStyle = '#5c6575'; x.font = '600 12px Helvetica'; x.fillText('Hough consensus space', hmX, hmY - 20);
    x.fillStyle = '#8b93a1'; x.font = '11px Helvetica'; x.textAlign = 'center';
    for (let j = 0; j <= NR1; j += 5) x.fillText((j / NR1 * 180 - 90) + '°', hmX + j / NR1 * hmW, hmY + hmH + 16);
    x.fillText('θ  depth angle', hmX + hmW / 2, hmY + hmH + 32);
    x.save(); x.translate(hmX - 18, hmY + hmH / 2); x.rotate(-Math.PI / 2); x.fillText('ω₂ₚ  triangle-plane orientation', 0, 0); x.restore();
    x.textAlign = 'left';
    for (const key in heat) {
      const [j, k] = key.split(',').map(Number);
      const px = hmX + (j + 0.5) * cellW, py = hmY + hmH - (k + 0.5) * cellH;
      x.fillStyle = `rgba(201,138,27,${Math.min(0.78, 0.07 + heat[key] * 0.11)})`;
      x.fillRect(px - cellW / 2, py - cellH / 2, cellW, cellH);
    }
    // Pack votes inside each cell on a tiny deterministic grid. This keeps
    // repeated candidates individually visible instead of painting one dot
    // directly over another dot at the cell center.
    for (const key in voteSlots) {
      const [j, k] = key.split(',').map(Number), slots = voteSlots[key];
      const cx = hmX + (j + 0.5) * cellW, cy = hmY + hmH - (k + 0.5) * cellH;
      const cols = Math.ceil(Math.sqrt(slots.length)), rows = Math.ceil(slots.length / cols);
      slots.forEach((idx, slot) => {
        const col = slot % cols, row = Math.floor(slot / cols);
        const dx = cols === 1 ? 0 : ((col / (cols - 1)) - 0.5) * cellW * 0.78;
        const dy = rows === 1 ? 0 : ((row / (rows - 1)) - 0.5) * cellH * 0.78;
        votePos.set(idx, { x: cx + dx, y: cy + dy });
      });
    }
    shownVotes.forEach((v, idx) => {
      const pos = votePos.get(idx);
      const px = pos.x, py = pos.y;
      const cellSlots = voteSlots[v.j + ',' + v.k] || [idx];
      const slotCols = Math.ceil(Math.sqrt(cellSlots.length)), slotRows = Math.ceil(cellSlots.length / slotCols);
      const slotGapX = slotCols === 1 ? cellW * 0.78 : cellW * 0.78 / (slotCols - 1);
      const slotGapY = slotRows === 1 ? cellH * 0.78 : cellH * 0.78 / (slotRows - 1);
      const markerR = Math.min(2.5, slotGapX, slotGapY) * 0.34;
      if (v.valid === false) {
        const r = markerR;
        x.strokeStyle = 'rgba(139,147,161,.68)'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(px - r, py - r); x.lineTo(px + r, py + r); x.moveTo(px + r, py - r); x.lineTo(px - r, py + r); x.stroke();
      } else {
        const r = markerR;
        x.fillStyle = 'rgba(35,64,110,.76)'; x.beginPath(); x.arc(px, py, r, 0, 7); x.fill();
      }
    });
    const p = trial.peaks[0];
    const ppx = hmX + (p.j + 0.5) * cellW, ppy = hmY + hmH - (p.k + 0.5) * cellH;
    if (focus) {
      const fp = votePos.get(voteIndex), fx = fp ? fp.x : hmX + (focus.j + 0.5) * cellW, fy = fp ? fp.y : hmY + hmH - (focus.k + 0.5) * cellH;
      x.strokeStyle = '#f2b84b'; x.lineWidth = 1.6; x.beginPath(); x.arc(fx, fy, Math.max(4.5, Math.min(8, Math.min(cellW, cellH) * 1.15)), 0, 7); x.stroke();
      if (focusScreen && !compact) { x.strokeStyle = 'rgba(201,138,27,.8)'; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(focusScreen.x, focusScreen.y); x.lineTo(fx, fy); x.stroke(); x.setLineDash([]); }
    }
    if (done) {
      x.strokeStyle = '#c98a1b'; x.lineWidth = 2.2; x.setLineDash([5, 4]); x.beginPath(); x.arc(ppx, ppy, 13, 0, 7); x.stroke(); x.setLineDash([]);
      x.fillStyle = '#c98a1b'; x.font = '600 11px Helvetica'; x.fillText('consensus peak → refine', Math.min(ppx + 16, hmX + hmW - 130), ppy - 10);
    }
    x.fillStyle = '#5c6575'; x.font = '11px Helvetica';
    x.fillText('blue dot = candidate vote', hmX + hmW - 168, hmY + 15);
    x.fillText('gray × = rejected point', hmX + hmW - 168, hmY + 30);
    x.fillStyle = '#c98a1b'; x.fillText('gold = local density', hmX + hmW - 168, hmY + 45);
    const occupied = Object.keys(heat).length;
    const accepted = shownVotes.filter(v => v.valid !== false).length;
    ro.textContent = `${shownVotes.length}/${totalVotes} candidate events · ${accepted} votes · ${occupied} occupied cells` + (done ? ` · peak support ${Math.round(p.score)}` : ` · Pᵢ #${focus ? focus.i : '–'} highlighted`);
  }

  /* ================= STEP C drawing : refinement ================= */
  function wei(st, i) {
    if (st.wf && st.wf[i] !== undefined) return st.wf[i];
    const e = st.err ? st.err[i] : 0;
    return e <= EPS ? 1 : Math.pow(EPS / e, 3);
  }

  function median(values) {
    const a = values.filter(Number.isFinite).slice().sort((u, v) => u - v);
    if (!a.length) return 0;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function project(st, i) {
    const pc = addv(applyM(st.R, data.X[i]), st.t);
    if (pc[2] <= 0.05) return null;
    const iz = 1 / pc[2], v = data.V[i], oiz = 1 / Math.max(1e-6, v[2]);
    return { u: [pc[0] * iz, pc[1] * iz], o: [v[0] * oiz, v[1] * oiz] };
  }

  function drawC() {
    if (!ref || !g3.W) return;
    const x = cvC.getContext('2d');
    x.clearRect(0, 0, g3.W, g3.H);
    if (!ref.history || !ref.history.length) {
      x.fillStyle = '#5c6575'; x.font = '600 13px Helvetica';
      x.fillText('The current hypothesis has too few usable correspondences to refine.', 18, 28);
      ro.textContent = 'refinement unavailable for this sample';
      return;
    }
    const hist = ref.history, LAST = hist.length - 1;
    const kk = Math.max(0, Math.min(LAST, Math.round(frameIdx))), st = hist[kk], st0 = hist[0];
    const compact = g3.W < 720;
    const UB = 1.4;
    const top = 48;
    const poseX = 18;
    const poseW = compact ? g3.W - 36 : Math.min(330, Math.max(270, g3.W * 0.30));
    const poseH = compact ? 132 : g3.H - 92;
    const panelX = compact ? 18 : poseX + poseW + 28;
    const panelW = compact ? g3.W - 36 : g3.W - panelX - 18;
    const panelY = compact ? top + poseH + 28 : top;
    const panelH = g3.H - panelY - 18;

    x.fillStyle = '#1d2534'; x.font = '600 13px Helvetica'; x.textAlign = 'left';
    const orderLabel = st.order < 0 ? 'hard inlier gate (∞)' : `soft weights (${st.order})`;
    x.fillText(`③ Refine · DSW-GN stage ${Math.min(3, (st.stage || 0) + 1)}/3 · ${orderLabel} · iteration ${st.iteration || 0}`, 18, 20);
    x.fillStyle = '#8b93a1'; x.font = '11px Helvetica';
    x.fillText('the same pose is shown in 3D and in its image residuals', 18, 35);

    /* left: an actual camera-pose inset. The gray frustum is the Hough
       hypothesis; the blue frustum is the pose after the current DSW-GN step. */
    updatePoseScene(st, st0, kk);
    rendererA.setSize(Math.max(1, poseW), Math.max(1, poseH), false);
    poseCamera.aspect = poseW / poseH; poseCamera.updateProjectionMatrix();
    rendererA.render(poseScene, poseCamera);
    x.drawImage(rendererA.domElement, 0, 0, rendererA.domElement.width, rendererA.domElement.height, poseX, top, poseW, poseH);
    x.strokeStyle = '#d9d4c8'; x.lineWidth = 1.2; x.strokeRect(poseX, top, poseW, poseH);
    x.fillStyle = 'rgba(255,253,249,.9)'; x.fillRect(poseX + 8, top + 8, Math.min(180, poseW - 16), 21);
    x.fillStyle = '#5c6575'; x.font = '600 11px Helvetica'; x.fillText('recovered camera pose', poseX + 14, top + 23);
    x.fillStyle = '#8b93a1'; x.font = '11px Helvetica';
    x.fillText('gray = fixed Hough peak', poseX + 10, top + poseH - 25);
    x.fillStyle = '#23406e'; x.fillText('blue = refined pose', poseX + 10, top + poseH - 10);

    /* right: a deliberately paired before/after image view. The left mini-panel
       is the Hough hypothesis; the right mini-panel is the current DSW-GN state.
       Gray rings never move, while colored predictions and their residuals do. */
    const titleY = panelY;
    // Keep the right-panel heading in its own band.  The canvas is only 470px
    // tall, so a fixed title/pane gap is more reliable than letting labels sit
    // against the frame at narrow widths.
    const topReserve = 52;
    const paneGap = 18;
    const paneW = Math.max(90, (panelW - paneGap) / 2);
    const bottomReserve = 58;
    const paneSize = Math.max(110, Math.min(paneW, panelH - topReserve - bottomReserve));
    const paneY = panelY + topReserve;
    x.fillStyle = '#5c6575'; x.font = '600 12px Helvetica'; x.fillText('image residuals · fixed observations', panelX, titleY);
    x.fillStyle = '#8b93a1'; x.font = '11px Helvetica'; x.fillText('colored predictions move · gray rings stay fixed', panelX, titleY + 16);

    const rows = [];
    for (let i = 0; i < data.X.length; i++) {
      const old = project(st0, i), cur = project(st, i), q = cur || old;
      if (!q) continue;
      const wOld = Math.max(0, Math.min(1, wei(st0, i))), wCur = Math.max(0, Math.min(1, wei(st, i)));
      rows.push({ i, old, cur, obs: q.o, wOld, wCur,
        // The arrows below are drawn in the normalized image plane for
        // readability; the numerical summary follows project_d_err(), i.e.
        // the unit-ray chord error used by the C++ finalizer.
        eOld: st0.err && Number.isFinite(st0.err[i]) ? st0.err[i] : 0,
        eCur: st.err && Number.isFinite(st.err[i]) ? st.err[i] : 0 });
    }

    function drawResidualPane(px, title, currentPane) {
      const boxX = px + (paneW - paneSize) / 2, boxY = paneY;
      const scale = paneSize / (2 * UB);
      const mapX = u => boxX + (u[0] + UB) * scale;
      const mapY = u => boxY + (UB - u[1]) * scale;
      x.fillStyle = '#5c6575'; x.font = '600 11px Helvetica'; x.textAlign = 'center'; x.fillText(title, px + paneW / 2, boxY - 9); x.textAlign = 'left';
      x.strokeStyle = '#d9d4c8'; x.lineWidth = 1.2; x.strokeRect(boxX, boxY, paneSize, paneSize);
      x.strokeStyle = 'rgba(139,147,161,.20)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(boxX, boxY + paneSize / 2); x.lineTo(boxX + paneSize, boxY + paneSize / 2); x.moveTo(boxX + paneSize / 2, boxY); x.lineTo(boxX + paneSize / 2, boxY + paneSize); x.stroke();
      x.fillStyle = '#8b93a1'; x.font = '9px Helvetica'; x.fillText('u', boxX + paneSize - 9, boxY + paneSize / 2 - 5); x.fillText('v', boxX + paneSize / 2 + 5, boxY + 10);
      x.save(); x.beginPath(); x.rect(boxX, boxY, paneSize, paneSize); x.clip();
      for (const row of rows) {
        const pred = currentPane ? row.cur : row.old; if (!pred) continue;
        const w = currentPane ? row.wCur : row.wOld;
        const strong = row.i < POLY.length;
        const alpha = strong ? 0.72 : Math.min(0.30, 0.045 + w * 0.24);
        const ox = mapX(row.obs), oy = mapY(row.obs), ux = mapX(pred.u), uy = mapY(pred.u);
        x.strokeStyle = currentPane ? `rgba(35,64,110,${alpha})` : `rgba(166,61,47,${alpha})`;
        x.lineWidth = strong ? 1.3 : 0.7; x.beginPath(); x.moveTo(ux, uy); x.lineTo(ox, oy); x.stroke();
        x.strokeStyle = `rgba(139,147,161,${strong ? 0.80 : 0.28})`; x.lineWidth = strong ? 1.1 : 0.7; x.beginPath(); x.arc(ox, oy, strong ? 3.9 : 2.2, 0, 7); x.stroke();
        x.fillStyle = currentPane ? '#23406e' : '#a63d2f'; x.globalAlpha = strong ? 0.92 : Math.min(0.40, 0.10 + w * 0.30); x.beginPath(); x.arc(ux, uy, strong ? 3.7 : 2.1, 0, 7); x.fill(); x.globalAlpha = 1;
        if (currentPane && row.i < 4) { x.fillStyle = '#23406e'; x.font = '600 9px Helvetica'; x.fillText(`P${row.i}`, ox + 5, oy - 4); }
      }
      x.restore();
    }
    drawResidualPane(panelX, 'Hough peak · fixed baseline', false);
    drawResidualPane(panelX + paneW + paneGap, `iteration ${kk} · current`, true);
    x.fillStyle = '#c98a1b'; x.font = '600 15px Helvetica'; x.textAlign = 'center'; x.fillText('→', panelX + paneW + paneGap / 2, paneY + paneSize / 2 + 5); x.font = '9px Helvetica'; x.fillText('DSW-GN', panelX + paneW + paneGap / 2, paneY + paneSize / 2 + 18); x.textAlign = 'left';
    const legendY = paneY + paneSize + 22;
    x.fillStyle = '#8b93a1'; x.font = '10px Helvetica'; x.fillText('○ fixed obs', panelX, legendY);
    x.fillStyle = '#a63d2f'; x.fillText('red = coarse', panelX + 90, legendY);
    x.fillStyle = '#23406e'; x.fillText('blue = current', panelX + 185, legendY);

    const med = median(rows.map(r => r.eCur));
    const initialMed = median(rows.map(r => r.eOld));
    const gain = initialMed > 1e-6 ? Math.max(0, (1 - med / initialMed) * 100) : 0;
    const strong = rows.filter(r => r.wCur > 0.5).length;
    x.fillStyle = '#5c6575'; x.font = '600 11px Helvetica';
    x.fillText(`median ε: ${med.toFixed(3)}  ·  ${gain.toFixed(0)}% smaller  ·  ${strong} strong weights`, panelX, paneY + paneSize + 47);
    ro.textContent = `iter ${kk}/${LAST} · median ε ${med.toFixed(3)} · ${gain.toFixed(0)}% smaller · ${strong} strong weights`;
  }

  /* ---------- master clock ---------- */
  let phaseMs = 0;
  function tick(dt) {
    if (S.running) phaseMs += dt * 1000;
    if (S.step === 'A') {
      orbitA.update(S.running ? dt : 0);
      rendererA.render(sceneA, cameraA);
    } else if (S.step === 'B') {
      drawB();
      if (S.running && trial && phaseMs > voteEvents.length * VOTE_T * 1000 + HOLD_B) {
        S.running = false;
        stepDone = true;
        updateRunButton();
      }
    } else {
      const LAST = ref && ref.history ? ref.history.length - 1 : -1;
      if (S.running && frameIdx < LAST) { acc += dt; frameIdx = Math.min(LAST, acc / STEP_T); }
      if (S.running && LAST >= 0 && frameIdx >= LAST) {
        S.running = false;
        stepDone = true;
        updateRunButton();
      }
      drawC();
    }
  }

  /* ---------- controls ---------- */
  $('pp-config').addEventListener('change', e => { S.cfg = e.target.value; run(false); });
  const sl = $('pp-outliers');
  sl.addEventListener('input', () => {
    $('pp-outliers-val').textContent = sl.value + '%';
    S.out = sl.value / 100; run(false);
  });
  runBtn.addEventListener('click', () => {
    if (S.running) {
      // In Task, only the automatic camera orbit is paused; the geometry and
      // correspondences remain unchanged.
      S.running = false;
    } else {
      // Vote/Refine restart their timeline; Task simply resumes motion.
      if (S.step !== 'A') { phaseMs = 0; frameIdx = 0; acc = 0; stepDone = false; }
      S.running = true;
    }
    updateRunButton();
  });
  $('pp-newdata').addEventListener('click', () => { S.running = true; run(true); });

  layout();
  new ResizeObserver(layout).observe(holder);
  run(false);
  S.running = true;
  updateRunButton();
  registerScene(holder, tick, rendererA);
})();

/* ==================== DEMO B — one parameter tests everything ==================== */
(function demoPST() {
  const holder = $('viz-pst');
  if (!holder) return;
  const EPS = 0.01;
  const data = PST.generateData({ n: 60, outlierRate: 0, config: 'ordinary', seed: 424242 });
  const X = data.X, V = data.V;
  let i0 = 0, i1 = 1;
  outer:
  for (let a = 0; a < X.length; a++)
    for (let b = a + 1; b < X.length; b++)
      if (Math.hypot(X[a][0]-X[b][0], X[a][1]-X[b][1]) > 1.1 && Math.abs(V[a][2]-V[b][2]) > 0.05) { i0 = a; i1 = b; break outer; }
  const T = PST.houghTrial(X, V, i0, i1, { nr1: 30 });
  const A = T.coef, v0 = T.v0, v1 = T.v1, items = T.items, M = items.length;
  const C1 = A.C1, l1 = A.l1;
  const depth1 = Math.hypot(X[i1][0], X[i1][1], X[i1][2]);   // true depth of P₁ along v₁

  function test(q, t1) {
    const den = A.A4[q] + A.A5[q] * t1;
    const ti = Math.abs(den) > 1e-9 ? -(A.A6[q]*t1*t1 + A.A3[q]*t1 + A.A7[q]) / den : NaN;
    const d2 = A.l2[q] + ti;
    const loss = isNaN(ti) ? Infinity : Math.abs(A.A1[q]*t1*t1 - ti*ti + A.A2[q]);
    const sat = !isNaN(ti) && d2 > 0.05 && loss < EPS;
    return { ti, d2, loss, sat };
  }

  // full consistency curve: how many of the n-2 points survive at each θ
  const GX = [], GY = [];
  for (let d = -88; d <= 88; d += 1) {
    const t1 = Math.tan(d / DEG) * C1, d1 = l1 + t1;
    let c = 0;
    if (d1 > 0.05) for (let q = 0; q < M; q++) if (test(q, t1).sat) c++;
    GX.push(d); GY.push(c);
  }
  const gMax = Math.max(...GY);
  const thetaStar = GX[GY.indexOf(gMax)];                        // consensus θ (true configuration)
  const state = { theta: thetaStar, focus: 0, sweep: false, sweepDir: 1 };

  // flatten triangle onto page, edge A->B normalized to length 1 (shape comparison, scale-free)
  function flattenWorld(A, B, C) {
    const ab = [B[0]-A[0], B[1]-A[1], B[2]-A[2]];
    const L = Math.hypot(ab[0], ab[1], ab[2]) || 1e-9;
    const u = [ab[0]/L, ab[1]/L, ab[2]/L];
    let nn = [u[1]*(C[2]-A[2])-u[2]*(C[1]-A[1]), u[2]*(C[0]-A[0])-u[0]*(C[2]-A[2]), u[0]*(C[1]-A[1])-u[1]*(C[0]-A[0])];
    const nl = Math.hypot(nn[0], nn[1], nn[2]) || 1e-9; nn = [nn[0]/nl, nn[1]/nl, nn[2]/nl];
    const w = [nn[1]*u[2]-nn[2]*u[1], nn[2]*u[0]-nn[0]*u[2], nn[0]*u[1]-nn[1]*u[0]];
    const dd = [C[0]-A[0], C[1]-A[1], C[2]-A[2]];
    return [[0,0], [1,0], [(dd[0]*u[0]+dd[1]*u[1]+dd[2]*u[2])/L, (dd[0]*w[0]+dd[1]*w[1]+dd[2]*w[2])/L]];
  }

  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  holder.appendChild(cv);
  const g = { W: 0, H: 0 };

  function layout() {
    g.W = holder.clientWidth; g.H = holder.clientHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    cv.width = g.W * dpr; cv.height = g.H * dpr;
    cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!g.W) return;
    const x = cv.getContext('2d');
    x.clearRect(0, 0, g.W, g.H);
    const t1 = Math.tan(state.theta / DEG) * C1, d1 = l1 + t1;
    const e0 = v0.slice(), e1 = [v1[0]*d1, v1[1]*d1, v1[2]*d1];
    const valid1 = d1 > 0.05;
    const q = Math.min(state.focus, M - 1), i = items[q].i;
    const tt = test(q, t1);
    const ei = tt.d2 > 0.05 ? [V[i][0]*tt.d2, V[i][1]*tt.d2, V[i][2]*tt.d2] : null;

    // ---------- Panel A : normalized similarity of the inspected triangle ----------
    const wTri = flattenWorld(X[i0], X[i1], X[i]);
    const cTri = ei ? flattenWorld(e0, e1, ei) : null;
    const S = 150, pX0 = 16, pY0 = 34;
    x.fillStyle = '#5c6575'; x.font = '600 12.5px Helvetica'; x.textAlign = 'left';
    x.fillText('Similarity test — model triangle (blue) vs camera triangle (orange, from θ)', pX0, 20);
    function triPath(tr, cx, cy) {
      x.beginPath();
      tr.forEach((p, k) => { const px = cx + p[0]*S, py = cy - p[1]*S; k ? x.lineTo(px, py) : x.moveTo(px, py); });
      x.closePath();
    }
    triPath(wTri, pX0 + 52, pY0 + 128);
    x.setLineDash([5,4]); x.strokeStyle = '#33518b'; x.lineWidth = 1.6; x.stroke();
    x.setLineDash([]);
    if (cTri) {
      triPath(cTri, pX0 + 52, pY0 + 128);
      x.fillStyle = 'rgba(166,61,47,.18)'; x.fill();
      x.strokeStyle = '#a63d2f'; x.lineWidth = 2; x.stroke();
    }
    x.font = '11px Georgia'; x.fillStyle = '#33518b'; x.textAlign = 'left';
    x.fillText('model ∆ P₀P₁Pⁱ   (the real, known shape)', pX0 + 52, pY0 + 150);
    x.fillStyle = '#a63d2f'; x.fillText('camera ∆ ê₀ê₁êⁱ   (hypothesis, scaled to same edge)', pX0 + 52, pY0 + 166);
    x.font = 'bold 12px Helvetica';
    if (cTri && tt.sat) { x.fillStyle = '#2e7d32'; x.fillText('✔ SIMILAR — this point agrees with the hypothesis θ', pX0 + 52, pY0 + 188); }
    else if (cTri) { x.fillStyle = '#a63d2f'; x.fillText('✘ NOT similar — this point disagrees (see the mismatch)', pX0 + 52, pY0 + 188); }
    else { x.fillStyle = '#a63d2f'; x.fillText('✘ invalid θ — ê¹ behind camera / no consistent depth', pX0 + 52, pY0 + 188); }

    // ---------- Panel B : the point strip ----------
    const bY = 228, bH = 40;
    x.fillStyle = '#5c6575'; x.font = '600 12.5px Helvetica'; x.textAlign = 'left';
    x.fillText(`Consistency at θ = ${state.theta.toFixed(1)}° : `, 12, bY + 20);
    let satCount = 0;
    const nPerRow = Math.max(10, Math.floor((g.W - 20) / 16));
    for (let q = 0; q < M; q++) {
      const sat = test(q, t1).sat;
      if (sat) satCount++;
      const col = q % nPerRow, row = Math.floor(q / nPerRow);
      const cx = 26 + col * 16, cy = bY + 2 + row * 10;
      x.fillStyle = sat ? '#2e7d32' : '#d98b6a';
      x.beginPath(); x.arc(cx, cy, 3.4, 0, 7); x.fill();
    }
    x.fillStyle = satCount >= M * 0.7 ? '#2e7d32' : '#a63d2f';
    x.font = 'bold 13px Helvetica'; x.textAlign = 'right';
    x.fillText(`${satCount} / ${M} survive`, g.W - 12, bY + 20);
    x.textAlign = 'left';

    // ---------- Panel C : consistency curve ----------
    const cY0 = 292, cH = g.H - cY0 - 34;
    const cL = 50, cR = g.W - 14;
    const cx = (d) => cL + (d + 88) / 176 * (cR - cL);
    const cy = (c) => cY0 + cH - (c / gMax) * cH;
    x.fillStyle = '#1d2534'; x.font = '600 12.5px Helvetica';
    x.fillText('How many of the n−2 points survive, for every θ', cL, cY0 - 8);
    x.strokeStyle = '#e6e2d9'; x.strokeRect(cL, cY0, cR - cL, cH);
    // gold true-θ band
    const gx = cx(thetaStar);
    x.fillStyle = 'rgba(201,138,27,.14)'; x.fillRect(gx - 8, cY0, 16, cH);
    x.strokeStyle = '#c98a1b'; x.setLineDash([4,3]); x.lineWidth = 1.2;
    x.beginPath(); x.moveTo(gx, cY0); x.lineTo(gx, cY0 + cH); x.stroke(); x.setLineDash([]);
    // curve
    x.strokeStyle = '#a63d2f'; x.lineWidth = 2;
    x.beginPath();
    GX.forEach((d, k) => { d == -88 ? x.moveTo(cx(d), cy(GY[k])) : x.lineTo(cx(d), cy(GY[k])); });
    x.stroke();
    // current-θ marker
    const mx = cx(state.theta);
    x.strokeStyle = '#23406e'; x.setLineDash([3,2]); x.lineWidth = 1.2;
    x.beginPath(); x.moveTo(mx, cY0); x.lineTo(mx, cY0 + cH); x.stroke(); x.setLineDash([]);
    x.fillStyle = '#23406e'; x.beginPath(); x.arc(mx, cy(GY[Math.round((state.theta + 88))]), 4, 0, 7); x.fill();
    // axis labels
    x.fillStyle = '#8b93a1'; x.font = '11px Helvetica'; x.textAlign = 'center';
    for (const d of [-80, -40, 0, 40, 80]) x.fillText(d + '°', cx(d), cY0 + cH + 14);
    x.textAlign = 'left'; x.fillText('θ (depth-hypothesis angle) →', cR - 210, cY0 + cH + 30);
    x.fillText(gMax + '', 4, cY0 + 8);
    x.textAlign = 'right'; x.fillText('0', cL - 6, cY0 + cH + 4);
    x.textAlign = 'left';
    x.save(); x.translate(14, cY0 + cH / 2); x.rotate(-Math.PI / 2); x.textAlign = 'center';
    x.fillText('# consistent', 0, 0); x.restore();

    // ---------- readouts / overlay ----------
    const good = satCount >= M * 0.7;
    $('pst-loss').textContent = `consistent: ${satCount} / ${M}`;
    $('pst-loss').className = 'readout' + (good ? ' good' : '');
    $('pst-overlay').innerHTML =
      `<b>θ = ${state.theta.toFixed(1)}°</b><br>` +
      `<span class="mono">${satCount}/${M}</span> of the other ${M} matches are consistent` +
      `${good ? ' — a single θ explains nearly all of them' : ' — this hypothesis does not work'}`;
  }

  $('pst-theta').addEventListener('input', () => {
    state.theta = +$('pst-theta').value;
    $('pst-theta-val').textContent = state.theta.toFixed(1) + '°';
    draw();
  });
  $('pst-point').addEventListener('input', () => {
    state.focus = Math.min(+$('pst-point').value - 2, M - 1);
    $('pst-point-val').textContent = '#' + $('pst-point').value;
    draw();
  });
  $('pst-point').max = String(M + 1);
  $('pst-sweep').addEventListener('click', (e) => {
    state.sweep = !state.sweep; e.currentTarget.classList.toggle('active', state.sweep);
    e.currentTarget.textContent = state.sweep ? '⏸ Stop sweep' : '▶ Auto-sweep θ';
  });

  registerScene(holder, (dt) => {
    if (state.sweep) {
      state.theta += state.sweepDir * dt * 34;
      if (state.theta > 80) { state.theta = 80; state.sweepDir = -1; }
      if (state.theta < -80) { state.theta = -80; state.sweepDir = 1; }
      $('pst-theta').value = state.theta;
      $('pst-theta-val').textContent = state.theta.toFixed(1) + '°';
      draw();
    }
  }, null);

  layout();
  draw();
  if (window.ResizeObserver) new ResizeObserver(() => { layout(); draw(); }).observe(holder);
})();


/* ==================== bibtex ==================== */
$('bib-copy')&&$('bib-copy').addEventListener('click',async()=>{
  try{
    await navigator.clipboard.writeText($('bib-text').innerText);
    const b=$('bib-copy');b.textContent='Copied ✓';
    setTimeout(()=>{b.textContent='Copy';},1600);
  }catch(e){}
});

})();
