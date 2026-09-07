/*
 * pst_core.js — faithful JS port of the core math of
 *   "A Hough Voting-Based 2-Point RANSAC Solution to the Perspective-n-Point Problem"
 *   (IEEE TIP 2025), following cpp_version/src/hough_voting.cpp.
 *
 * Exposes global `PST` with:
 *   makeRng(seed)                 -> seeded PRNG () => float in [0,1)
 *   generateData(opts)            -> synthetic 3D points + observation rays (+ outliers)
 *   houghTrial(X, V, i0, i1, o)   -> one RANSAC trial: PST coefficients, Hough heatmap,
 *                                    smoothing, NMS peaks
 *   poseFromPeak(...)             -> hypothetical pose (R, t) recovered from a peak
 *   swgnRefine(R, t, X, V, o)     -> the final [3, 4, inf] DSW-GN refinement
 */
(function (global) {
  'use strict';

  // ---------- small vector helpers (arrays [x,y,z]) ----------
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const norm = (a) => Math.sqrt(dot(a, a));
  function normalize(a) {
    const n = norm(a);
    return n < 1e-12 ? [0, 0, 0] : mul(a, 1 / n);
  }
  const clip = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
  function safeAcos(c) {
    return Math.acos(clip(c, -1, 1));
  }
  function normalizeAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }
  // 3x3 matrix helpers (row-major nested arrays)
  const mIdentity = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  function mMul(A, B) {
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    return C;
  }
  function mTranspose(A) {
    return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]];
  }
  function mApply(R, v) {
    return [
      R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
      R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
      R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
    ];
  }
  function rotErrorDeg(Ra, Rb) {
    // err = max_k arccos(col_k(A) . col_k(B))   (paper, Sec. IV)
    let m = 0;
    for (let k = 0; k < 3; k++) {
      const ca = [Ra[0][k], Ra[1][k], Ra[2][k]];
      const cb = [Rb[0][k], Rb[1][k], Rb[2][k]];
      m = Math.max(m, safeAcos(dot(ca, cb)));
    }
    return (m * 180) / Math.PI;
  }

  // ---------- seeded RNG ----------
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- synthetic data generation (paper Sec. IV-A) ----------
  // Points are generated directly in the camera frame => ground truth pose is identity,
  // observations are perspective projections; a fraction of them are replaced by
  // random false matches (outliers).
  function generateData(opts) {
    const n = opts.n || 100;
    const outlierRate = opts.outlierRate || 0;
    const config = opts.config || 'ordinary';   // 'ordinary' | 'quasi' | 'planar'
    const noise = opts.noise != null ? opts.noise : 0.0; // px-equivalent on norm. plane
    const rng = makeRng(opts.seed != null ? opts.seed : 12345);

    const X = new Array(n);
    if (config === 'ordinary') {
      for (let i = 0; i < n; i++)
        X[i] = [-2 + 4 * rng(), -2 + 4 * rng(), 4 + 4 * rng()];
    } else if (config === 'quasi') {
      for (let i = 0; i < n; i++)
        X[i] = [1 + rng(), 1 + rng(), 4 + 4 * rng()];
    } else { // planar: random plane through view frustum
      const nrm = normalize([rng() - 0.5, rng() - 0.5, 0.6 + 0.8 * rng()]);
      const a = normalize(cross(nrm, [0, 0, 1]));
      const b = cross(nrm, a);
      // Choose the plane offset so the complete sampled patch remains in
      // front of the camera; do not clip individual z coordinates, which
      // would destroy the planar configuration.
      const off = mul(nrm, 7.0);
      for (let i = 0; i < n; i++) {
        let u = -2.2 + 4.4 * rng(), w = -2.2 + 4.4 * rng();
        let p = add(add(off, mul(a, u)), mul(b, w));
        X[i] = p;
      }
    }

    // observation rays v_i = normalize(Pc_i / z) direction; outliers get random rays
    const V = new Array(n);
    const mask = new Array(n).fill(true);
    const nOut = Math.round(n * outlierRate);
    const idx = [...Array(n).keys()];
    for (let i = idx.length - 1; i > 0; i--) { // shuffle
      const j = Math.floor(rng() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (let i = 0; i < n; i++) {
      let p = X[i].slice();
      if (noise > 0) {
        p[0] += (rng() - 0.5) * noise;
        p[1] += (rng() - 0.5) * noise;
      }
      V[i] = normalize(p);
    }
    for (let q = 0; q < nOut; q++) {
      const i = idx[q];
      mask[i] = false;
      // random ray in front of camera
      let r;
      do {
        r = normalize([rng() * 2 - 1, rng() * 2 - 1, rng()]);
      } while (r[2] < 0.08);
      V[i] = r;
    }
    return { X, V, mask, gtR: mIdentity(), gtt: [0, 0, 0] };
  }

  // ---------- one RANSAC trial: PST-Hough (port of rpnp_trial) ----------
  /*
   * X : world/model points  (array of [x,y,z])
   * V : observation rays    (unit arrays)
   * i0,i1 : sampled pair indices
   * opts: nr1 (theta bins, default 30), thCons (loss threshold xi, default 0.01),
   *       minDepth (default 0.05)
   * Returns { H, votes, peaks, t1s, coef, i0, i1 } where
   *   H     : nr1 x (2*nr1) smoothed vote counts (row-major flat array)
   *   votes : [{i, j, k}] raw votes (point index, theta bin, omega bin)
   *   peaks : [{j, k, score}] local maxima after NMS filtering
   */
  function houghTrial(X, V, i0in, i1in, opts) {
    const o = opts || {};
    const nr1 = o.nr1 || 30;
    const nr2 = nr1 * 2;
    const thCons = o.thCons != null ? o.thCons : 0.01;
    const minDepth = o.minDepth != null ? o.minDepth : 0.05;
    const smooth = o.smooth !== false;

    let i0 = i0in, i1 = i1in;
    // keep the convention of the C++ code
    const xy0 = Math.hypot(V[i0][0], V[i0][1]);
    const xy1 = Math.hypot(V[i1][0], V[i1][1]);
    if (xy0 > xy1) { const tmp = i0; i0 = i1; i1 = tmp; }

    const n = X.length;
    const v0 = V[i0], v1 = V[i1];
    const X0 = X[i0], X1 = X[i1];

    // gather remaining correspondences
    const idxs = [];
    for (let i = 0; i < n; i++) if (i !== i0 && i !== i1) idxs.push(i);

    const D1 = norm(sub(X1, X0));
    if (!(D1 > 1e-12)) return null;
    const items = [];
    for (const i of idxs) {
      const D2 = norm(sub(X[i], X0));
      const D3 = norm(sub(X[i], X1));
      const edge1 = sub(X1, X0);
      const edge2 = sub(X[i], X0);
      const area = norm(cross(edge1, edge2));
      const areaScale = Math.max(D1 * D2, 1.0);
      if (D2 > 1e-5 && D3 > 1e-5 && Number.isFinite(area) &&
          area > 1e-10 * areaScale) items.push({ i, D2, D3 });
    }
    if (items.length < 4) return null;

    // ---- PST coefficients (Eq. 1 of the paper) ----
    const m = items.length;
    const cg1 = clip(dot(v0, v1), -1, 1);
    const sg1 = Math.sqrt(Math.max(0, 1 - cg1 * cg1));
    const l1 = cg1, C1 = sg1;

    const A1 = new Float64Array(m), A2 = new Float64Array(m),
          A3 = new Float64Array(m), A4 = new Float64Array(m),
          A5 = new Float64Array(m), A6 = new Float64Array(m),
          A7 = new Float64Array(m);
    // model-frame dihedral angles beta_i, matching param_r2_base() in the C++
    // implementation: the sign is determined by n_first · (Xi - X1).
    const betaM = new Float64Array(m);
    const cg2 = new Float64Array(m), cg3 = new Float64Array(m),
          l2 = new Float64Array(m), C2 = new Float64Array(m);

    const modelEdge = sub(X1, X0);
    const nmF = normalize(cross(modelEdge, sub(X[items[0].i], X1)));
    for (let q = 0; q < m; q++) {
      const it = items[q];
      const vi = V[it.i], Xi = X[it.i];
      const c2 = clip(dot(v0, vi), -1, 1);
      const c3 = clip(dot(v1, vi), -1, 1);
      const s2 = Math.sqrt(Math.max(0, 1 - c2 * c2));
      cg2[q] = c2; cg3[q] = c3; l2[q] = c2; C2[q] = s2;

      const k = it.D2 / D1;
      A1[q] = k * k;
      A2[q] = A1[q] * C1 * C1 - s2 * s2;
      A3[q] = c2 * c3 - l1;
      A4[q] = l1 * c3 - c2;
      A5[q] = c3;
      A6[q] = (it.D3 * it.D3 - D1 * D1 - it.D2 * it.D2) / (2 * D1 * D1);
      A7[q] = 1 - l1 * l1 - c2 * c2 + l1 * c2 * c3 + C1 * C1 * A6[q];

      const nmI = normalize(cross(modelEdge, sub(Xi, X1)));
      const sign = dot(nmF, sub(Xi, X1)) >= 0 ? 1 : -1;
      betaM[q] = sign * safeAcos(dot(nmF, nmI));
    }

    // ---- theta grid & per-column evaluation ----
    const stepR1 = Math.PI / nr1, stepR2 = (2 * Math.PI) / nr2;
    const t1s = new Float64Array(nr1);
    for (let j = 0; j < nr1; j++) {
      const theta = stepR1 * 0.5 - Math.PI / 2 + stepR1 * j;  // (-pi/2, pi/2)
      t1s[j] = Math.tan(theta) * C1;                          // t1 = tan(theta)*sin(gamma1)
    }

    const votes = [];
    let filteredCandidates = 0;
    const Hraw = new Float64Array(nr1 * nr2);
    // normal of the projection plane Pi_p (plane through Oc, e0, e1)
    const nVBase = normalize(cross(v0, v1));
    if (norm(nVBase) < 1e-12) return null;

    for (let q = 0; q < m; q++) {
      const vi = V[items[q].i];
      for (let j = 0; j < nr1; j++) {
        const t1 = t1s[j];
        // First apply the same polynomial consistency residual as C++:
        // |B4*t^4 + B3*t^3 + B2*t^2 + B1*t + B0| /
        // max((A4 + A5*t)^2, 1e-12) < thCons.
        const den = A4[q] + A5[q] * t1;
        const B4 = A6[q] * A6[q] - A1[q] * A5[q] * A5[q];
        const B3 = 2 * (A3[q] * A6[q] - A1[q] * A4[q] * A5[q]);
        const B2 = A3[q] * A3[q] + 2 * A6[q] * A7[q] - A1[q] * A4[q] * A4[q] - A2[q] * A5[q] * A5[q];
        const B1 = 2 * (A3[q] * A7[q] - A2[q] * A4[q] * A5[q]);
        const B0 = A7[q] * A7[q] - A2[q] * A4[q] * A4[q];
        const poly = ((((B4 * t1 + B3) * t1 + B2) * t1 + B1) * t1 + B0);
        const loss = Math.abs(poly) / Math.max(den * den, 1e-12);
        if (loss >= thCons) continue;
        if (Math.abs(den) <= 1e-9) continue;
        // solve eq.(1)-row2 for t_i :  t2 = -(A6 t1^2 + A3 t1 + A7)/(A4 + A5 t1)
        const ti = -(A6[q] * t1 * t1 + A3[q] * t1 + A7[q]) / den;
        if (!Number.isFinite(ti)) continue;
        // depth validity of the two control points
        const d1 = l1 + t1, d2 = l2[q] + ti;
        if (!(d1 > minDepth && d2 > minDepth)) continue;

        // camera-frame triangle plane normal & edge direction
        const vd1 = sub(mul(v1, d1), v0);       // e0 -> e1
        const vd2 = sub(mul(vi, d2), v0);       // e0 -> ei
        const nXRaw = cross(vd1, vd2);
        if (!nXRaw.every(Number.isFinite) || norm(nXRaw) < 1e-12) continue;
        const nX = normalize(nXRaw);            // matches model-side vertex ordering
        if (!nX.every(Number.isFinite)) continue;
        // alpha_i: signed angle from the projection plane to this triangle
        // plane. The sign convention matches the C++ dir_r_val guard,
        // including its zero-dot fallback.
        const dir = dot(nVBase, vi);
        const sign = Math.abs(dir) < 1e-12 ? -1 : (dir < 0 ? -1 : 1);
        const alphaI = sign * safeAcos(dot(nVBase, nX));
        // consensus coordinate: omega = alpha_i - beta_i  (constant over inliers)
        const omega = normalizeAngle(alphaI - betaM[q]);
        const kBin = clip(Math.floor((omega + Math.PI) / stepR2), 0, nr2 - 1);
        votes.push({ i: items[q].i, j, k: kBin, loss });
        Hraw[j * nr2 + kBin] += 1;
        filteredCandidates++;
      }
    }
    // C++ rejects a trial before Hough voting when fewer than three candidates
    // survive the depth/consistency filters. The nX check above can reduce the
    // final vote count further, so retain the same practical null behavior.
    if (filteredCandidates < 3 || !votes.length) return null;

    // ---- smoothing (circular 3-tap gaussian along flattened bins, as in C++) ----
    let H = Hraw;
    if (smooth) {
      const sigma = 0.5, sigma2 = 2 * sigma * sigma;
      const g0 = Math.exp(-1 / sigma2), g1 = 1;
      const gs = g0 + g1 + g0;
      const Hs = new Float64Array(nr1 * nr2);
      const total = nr1 * nr2;
      for (let b = 0; b < total; b++) {
        const bm = (b - 1 + total) % total;
        const bp = (b + 1) % total;
        Hs[b] = (g0 * Hraw[bm] + g1 * Hraw[b] + g0 * Hraw[bp]) / gs;
      }
      H = Hs;
    }

    // ---- non-maximum suppression + threshold (Algorithm 2) ----
    let maxH = 0;
    for (let b = 0; b < H.length; b++) maxH = Math.max(maxH, H[b]);
    const thH = Math.max(o.minThH != null ? o.minThH : 5, n * (o.thHFactor != null ? o.thHFactor : 0.005));
    const thr = Math.max(thH, 0.7 * maxH);
    const peaks = [];
    for (let jj = 0; jj < nr1; jj++) {
      for (let kk = 0; kk < nr2; kk++) {
        const val = H[jj * nr2 + kk];
        if (val < thr) continue;
        let isMax = true;
        for (let dj = -1; dj <= 1 && isMax; dj++) {
          for (let dk = -1; dk <= 1; dk++) {
            const nj = clip(jj + dj, 0, nr1 - 1), nk = clip(kk + dk, 0, nr2 - 1);
            if (H[nj * nr2 + nk] > val + 1e-10) { isMax = false; break; }
          }
        }
        if (isMax) peaks.push({ j: jj, k: kk, score: val });
      }
    }
    peaks.sort((a, b) => b.score - a.score);

    return {
      H, votes, peaks, t1s, nr1, nr2,
      coef: { A1, A2, A3, A4, A5, A6, A7, l1, l2, C1, cg3, betaM, D1 },
      i0, i1, v0, v1, X0, X1, items,
    };
  }

  // ---------- recover a hypothetical pose from a heatmap peak ----------
  // This is the same integer-bin pose construction as rpnp_trial in the C++
  // implementation. In particular, omega is used directly as the twist about
  function poseFromPeak(trial, X, V, peak) {
    const { nr1, nr2 } = trial;
    const theta = -Math.PI / 2 + (peak.j + 0.5) * (Math.PI / nr1);
    const omega = -Math.PI + (peak.k + 0.5) * ((2 * Math.PI) / nr2);
    return poseFromThetaOmega(trial, X, V, theta, omega);
  }

  function poseFromThetaOmega(trial, X, V, theta, omega) {
    const { v0, v1, X0, X1, coef } = trial;
    const d1 = coef.l1 + Math.tan(theta) * coef.C1;
    if (!(d1 > 0.05)) return null;
    const xc = normalize(cross(v0, v1));
    const yc0 = sub(mul(v1, d1), v0);
    const ny = norm(yc0), scale = ny / coef.D1;
    if (!(ny > 1e-12) || !(scale > 1e-12) || !Number.isFinite(scale)) return null;
    const yc = mul(yc0, 1 / ny), zc = normalize(cross(xc, yc));
    const Rc0 = [
      [xc[0], yc[0], zc[0]],
      [xc[1], yc[1], zc[1]],
      [xc[2], yc[2], zc[2]],
    ];

    const first = trial.items[0].i;
    const ym = normalize(sub(X1, X0));
    let zm = normalize(sub(X[first], X0));
    const xm = normalize(cross(ym, zm));
    zm = normalize(cross(xm, ym));
    const Rm0 = [
      [xm[0], ym[0], zm[0]],
      [xm[1], ym[1], zm[1]],
      [xm[2], ym[2], zm[2]],
    ];

    const c = Math.cos(omega), s = Math.sin(omega);
    const Rcy = [[c, 0, s], [0, 1, 0], [-s, 0, c]];
    const R = mMul(Rc0, mMul(Rcy, mTranspose(Rm0)));
    const t = sub(mul(v0, 1 / scale), mApply(R, X0));
    return { R, t, scale };
  }

  // ---------- C++-compatible DSW-GN refinement ----------
  // The production solver measures residuals as unit-ray chord distances and
  // runs the final dynamic soft-weight schedule [3, 4, inf]. The implementation
  // below mirrors dsw_gn(), sw_gn(), and optimize_gn() in cpp_version.
  function projectDErr(R, t, X, V) {
    const d = new Float64Array(X.length), err = new Float64Array(X.length);
    for (let i = 0; i < X.length; i++) {
      const y = add(mApply(R, X[i]), t);
      const depth = norm(y);
      d[i] = depth;
      const vp = mul(y, 1 / Math.max(depth, 1e-12));
      err[i] = norm(sub(V[i], vp));
    }
    return { d, err };
  }

  function calcWeight(err, th, order) {
    const w = new Float64Array(err.length);
    for (let i = 0; i < err.length; i++) {
      w[i] = order < 0 ? (err[i] < th ? 1 : 0) : Math.pow(th / Math.max(err[i], th), order);
    }
    return w;
  }

  function weightedMean(X, w) {
    let sw = 0;
    const out = [0, 0, 0];
    for (let i = 0; i < X.length; i++) {
      sw += w[i];
      out[0] += X[i][0] * w[i]; out[1] += X[i][1] * w[i]; out[2] += X[i][2] * w[i];
    }
    if (sw < 1e-12) {
      out[0] = 0; out[1] = 0; out[2] = 0;
      for (const p of X) { out[0] += p[0]; out[1] += p[1]; out[2] += p[2]; }
      sw = X.length;
    }
    return out.map(v => v / sw);
  }

  function constraintVector(s) {
    const [a, b, c] = s;
    return [
      a*a - b*b - c*c + 1, 2*a*b - 2*c, 2*a*c + 2*b,
      2*a*b + 2*c, -a*a + b*b - c*c + 1, 2*b*c - 2*a,
      2*a*c - 2*b, 2*b*c + 2*a, -a*a - b*b + c*c + 1, 1,
    ];
  }

  function solveLinear(A, b) {
    const n = A.length;
    const M = A.map((row, i) => Array.from(row).concat(b[i]));
    for (let c = 0; c < n; c++) {
      let pivot = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
      if (!Number.isFinite(M[pivot][c]) || Math.abs(M[pivot][c]) < 1e-14) return null;
      [M[c], M[pivot]] = [M[pivot], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        for (let k = c + 1; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let v = M[r][n];
      for (let c = r + 1; c < n; c++) v -= M[r][c] * x[c];
      x[r] = v / M[r][r];
    }
    return x.every(Number.isFinite) ? x : null;
  }

  function optimizeGn(X, V, t0, th, wIn, errIn, order, maxIter, converge, onState) {
    const n = V.length;
    if (n < 5 || X.length !== n || wIn.length !== n || errIn.length !== n) return null;
    let cw = 0;
    for (const w of wIn) if (w > 0.99999) cw++;
    if (cw < 5) return null;

    const uu = new Array(n), vv = new Array(n);
    for (let i = 0; i < n; i++) {
      let vz = V[i][2];
      if (Math.abs(vz) < 1e-12) vz = vz === 0 ? 1e-12 : Math.sign(vz) * 1e-12;
      uu[i] = V[i][0] / vz; vv[i] = V[i][1] / vz;
    }
    const Ap = Array.from({ length: 20 }, () => new Float64Array(n));
    const Bp = Array.from({ length: 6 }, () => new Float64Array(n));
    for (let i = 0; i < n; i++) {
      for (let q = 0; q < 3; q++) {
        Ap[q][i] = X[i][q];
        Ap[6 + q][i] = -uu[i] * X[i][q];
        Ap[13 + q][i] = X[i][q];
        Ap[16 + q][i] = -vv[i] * X[i][q];
      }
      Ap[9][i] = t0[0] - t0[2] * uu[i];
      Ap[19][i] = t0[1] - t0[2] * vv[i];
      Bp[0][i] = -1; Bp[2][i] = uu[i]; Bp[4][i] = -1; Bp[5][i] = vv[i];
    }

    let s = [0, 0, 0], w = new Float64Array(wIn);
    let bestR = mIdentity(), bestT = t0.slice(), bestW = new Float64Array(wIn), bestErr = new Float64Array(errIn);
    let bestScore = Array.from(wIn).reduce((sum, value) => sum + value, 0);
    for (let iter = 0; iter < maxIter; iter++) {
      const A = Array.from({ length: 2 * n }, () => new Float64Array(10));
      const B = Array.from({ length: 2 * n }, () => new Float64Array(3));
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 10; j++) {
          A[i][j] = Ap[j][i] * w[i]; A[i + n][j] = Ap[10 + j][i] * w[i];
        }
        for (let j = 0; j < 3; j++) {
          B[i][j] = Bp[j][i] * w[i]; B[i + n][j] = Bp[3 + j][i] * w[i];
        }
      }
      const BTB = Array.from({ length: 3 }, () => new Float64Array(3));
      const BTA = Array.from({ length: 3 }, () => new Float64Array(10));
      for (let row = 0; row < 2 * n; row++) {
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) BTB[a][b] += B[row][a] * B[row][b];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 10; b++) BTA[a][b] += B[row][a] * A[row][b];
      }
      for (let i = 0; i < 3; i++) BTB[i][i] += 1e-3;
      const C = Array.from({ length: 3 }, () => new Float64Array(10));
      for (let j = 0; j < 10; j++) {
        const col = solveLinear(BTB, [BTA[0][j], BTA[1][j], BTA[2][j]]);
        if (!col) return null;
        for (let i = 0; i < 3; i++) C[i][j] = col[i];
      }
      const M = Array.from({ length: 2 * n }, () => new Float64Array(10));
      for (let row = 0; row < 2 * n; row++) for (let j = 0; j < 10; j++)
        M[row][j] = A[row][j] - B[row][0] * C[0][j] - B[row][1] * C[1][j] - B[row][2] * C[2][j];
      const MTM = Array.from({ length: 10 }, () => new Float64Array(10));
      for (let row = 0; row < 2 * n; row++) for (let a = 0; a < 10; a++) for (let b = 0; b < 10; b++) MTM[a][b] += M[row][a] * M[row][b];

      const [a, b, c] = s;
      const J = [
        [2*a, -2*b, -2*c], [2*b, 2*a, -2], [2*c, 2, 2*a],
        [2*b, 2*a, 2], [-2*a, 2*b, -2*c], [-2, 2*c, 2*b],
        [2*c, -2, 2*a], [2, 2*c, 2*b], [-2*a, -2*b, 2*c], [0, 0, 0],
      ];
      const normal = Array.from({ length: 3 }, () => new Float64Array(3));
      const rhs = new Float64Array(3), rv = constraintVector(s);
      for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) {
        for (let j = 0; j < 10; j++) for (let k = 0; k < 10; k++) normal[p][q] += J[j][p] * MTM[j][k] * J[k][q];
        normal[p][q] += p === q ? 1e-3 : 0;
      }
      for (let p = 0; p < 3; p++) for (let j = 0; j < 10; j++) for (let k = 0; k < 10; k++) rhs[p] -= rv[j] * MTM[j][k] * J[k][p];
      const ds = solveLinear(normal, Array.from(rhs));
      if (!ds) break;
      const nds = norm(ds);
      if (nds < converge) break;

      const s0 = s.slice();
      let found = false;
      for (const lstep of [0.1, 0.05, 0.025]) {
        let dsStep = ds.slice();
        if (nds > lstep) dsStep = ds.map(v => v / nds * lstep);
        const sTry = s0.map((v, i) => v + dsStep[i]);
        const rTry = constraintVector(sTry);
        const scale = 1 + sTry[0]*sTry[0] + sTry[1]*sTry[1] + sTry[2]*sTry[2];
        const RTry = [rTry.slice(0, 3), rTry.slice(3, 6), rTry.slice(6, 9)].map(row => row.map(v => v / scale));
        const Cr = [0, 0, 0];
        for (let row = 0; row < 3; row++) for (let j = 0; j < 10; j++) Cr[row] += C[row][j] * rTry[j];
        const tTry = [0, 1, 2].map(i => (t0[i] + Cr[i]) / scale);
        const errTry = projectDErr(RTry, tTry, X, V).err;
        const wTry = calcWeight(errTry, th, order);
        const score = Array.from(wTry).reduce((sum, value) => sum + value, 0);
        if (score >= bestScore) {
          bestScore = score; bestR = RTry; bestT = tTry; bestW = wTry; bestErr = errTry;
          s = sTry; w = wTry; found = true;
          if (onState) onState({ R: bestR, t: bestT, w: bestW, err: bestErr, iter });
          break;
        }
        s = s0.slice();
      }
      if (!found) break;
    }
    return { R: bestR, t: bestT, w: bestW, err: bestErr, success: true };
  }

  function swGn(R0, t0, X, V, th, errIn, order, maxIter, converge, onState) {
    const err = errIn ? new Float64Array(errIn) : projectDErr(R0, t0, X, V).err;
    const w = calcWeight(err, th, order);
    const z = normalize(weightedMean(V, w));
    if (norm(z) < 1e-12) return null;
    let x, y;
    if (z[0] > z[1]) { x = normalize(cross([0, 1, 0], z)); y = normalize(cross(z, x)); }
    else { y = normalize(cross(z, [1, 0, 0])); x = normalize(cross(y, z)); }
    if (norm(x) < 1e-12 || norm(y) < 1e-12) return null;
    const Rvc = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
    const RvcT = mTranspose(Rvc), Vvc = V.map(v => mApply(RvcT, v));
    const Xbar = weightedMean(X, w), Rtmp = mMul(RvcT, R0);
    const Xvc = X.map(p => mApply(Rtmp, sub(p, Xbar)));
    const tvc = mApply(RvcT, add(mApply(R0, Xbar), t0));
    const toGlobal = (Rlocal, tlocal) => {
      const Rglobal = mMul(mMul(mMul(Rvc, Rlocal), RvcT), R0);
      return { R: Rglobal, t: sub(mApply(Rvc, tlocal), mApply(Rglobal, Xbar)) };
    };
    const opt = optimizeGn(Xvc, Vvc, tvc, th, w, err, order, maxIter, converge,
      state => {
        const pose = toGlobal(state.R, state.t);
        if (onState) onState({ R: pose.R, t: pose.t, w: state.w, err: state.err, iter: state.iter });
      });
    if (!opt) return null;
    const R = mMul(mMul(mMul(Rvc, opt.R), RvcT), R0);
    const t = sub(mApply(Rvc, opt.t), mApply(R, Xbar));
    return { R, t, w: opt.w, err: opt.err, success: true };
  }

  function fullState(R, t, Xall, Vall, idx, wSub, stage, order, iteration) {
    const err = projectDErr(R, t, Xall, Vall).err;
    const wf = new Float64Array(Xall.length);
    for (let i = 0; i < idx.length; i++) wf[idx[i]] = wSub[i];
    return { R: R.map(row => row.slice()), t: t.slice(), err, wf, stage, order, iteration,
      meanErr: Array.from(err).reduce((sum, value) => sum + value, 0) / err.length };
  }

  function swgnRefine(R0, t0, Xall, Vall, opts) {
    const o = opts || {}, th = o.eps != null ? o.eps : 0.01;
    const maxIter = o.iters != null ? o.iters : 4;
    const initialErr = projectDErr(R0, t0, Xall, Vall).err;
    let nInlier = 0;
    for (const e of initialErr) if (e < th) nInlier++;
    if (nInlier < 5) return { R: R0, t: t0, history: [], success: false, err: initialErr, wf: new Float64Array(Xall.length) };
    const idx = [];
    for (let i = 0; i < initialErr.length; i++) if (initialErr[i] < th * 7) idx.push(i);
    const X = idx.map(i => Xall[i]), V = idx.map(i => Vall[i]), errSub0 = idx.map(i => initialErr[i]);
    let R = R0.map(row => row.slice()), t = t0.slice(), errSub = new Float64Array(errSub0);
    const history = [], orders = [3, 4, -1];
    history.push(fullState(R, t, Xall, Vall, idx, calcWeight(errSub, th, orders[0]), 0, orders[0], 0));
    for (let si = 0; si < orders.length; si++) {
      const order = orders[si], states = [];
      const refined = swGn(R, t, X, V, th, errSub, order, maxIter,
        o.converge != null ? o.converge : 1e-4, state => states.push(state));
      if (!refined) return { R: R0, t: t0, history: [], success: false, err: initialErr, wf: new Float64Array(Xall.length) };
      R = refined.R; t = refined.t; errSub = refined.err;
      for (const state of states) history.push(fullState(state.R, state.t, Xall, Vall, idx, state.w, si, order, state.iter + 1));
      if (!states.length) history.push(fullState(R, t, Xall, Vall, idx, refined.w, si, order, 0));
    }
    const finalErr = projectDErr(R, t, Xall, Vall).err, finalW = new Float64Array(Xall.length);
    for (let i = 0; i < idx.length; i++) finalW[idx[i]] = errSub[i] < th ? 1 : 0;
    return { R, t, history, success: true, err: finalErr, wf: finalW };
  }

  // Lambda descriptor (paper Sec. IV-B): ratio of extreme eigenvalues of the
  // centered scatter matrix; distinguishes planar (<0.01), quasi-singular
  // (0.01-0.1) and ordinary (>0.1) configurations.
  function lambdaRatio(X) {
    const c = [0, 0, 0];
    for (const p of X) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    const m = X.length;
    c[0] /= m; c[1] /= m; c[2] /= m;
    let S = [[0,0,0],[0,0,0],[0,0,0]];
    for (const p of X) {
      const q = [p[0]-c[0], p[1]-c[1], p[2]-c[2]];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i][j] += q[i] * q[j];
    }
    // closed-form eigenvalues of symmetric 3x3
    const [s00,s01,s02,s10,s11,s12,s20,s21,s22] = [S[0][0],S[0][1],S[0][2],S[1][0],S[1][1],S[1][2],S[2][0],S[2][1],S[2][2]];
    const p1 = s01*s01 + s02*s02 + s12*s12;
    let ev = [];
    if (p1 === 0) { ev = [s00, s11, s22]; }
    else {
      const q = (s00+s11+s22)/3;
      const p2 = (s00-q)**2 + (s11-q)**2 + (s22-q)**2 + 2*p1;
      const p = Math.sqrt(p2/6);
      const Binv = [[0,0,0],[0,0,0],[0,0,0]];
      for (let r = 0; r < 3; r++) for (let cc2 = 0; cc2 < 3; cc2++) Binv[r][cc2] = S[r][cc2]/p - (r===cc2?1:0)*(q/p);
      const detB = (r)=> r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1]) - r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0]) + r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0]);
      const rr = clip(detB(Binv)/2, -1, 1);
      const phi = Math.acos(rr)/3;
      const eig1 = q + 2*p*Math.cos(phi);
      const eig3 = q + 2*p*Math.cos(phi + 2*Math.PI/3);
      const eig2 = 3*q - eig1 - eig3;
      ev = [eig1, eig2, eig3];
    }
    const lmax = Math.max(...ev), lmin = Math.max(Math.min(...ev), 0);
    return lmax > 1e-12 ? lmin / lmax : 0;
  }

  global.PST = {
    makeRng, generateData, houghTrial, poseFromPeak, poseFromThetaOmega, swgnRefine,
    rotErrorDeg, lambdaRatio,
    vec: { sub, add, mul, dot, cross, norm, normalize },
  };
})(typeof window !== 'undefined' ? window : globalThis);
