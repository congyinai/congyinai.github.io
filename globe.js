/*
 * Hero: a rotating cubed-sphere globe. Six equiangular faces, wind particles
 * advected over the surface, and convolution kernels sliding across the grid
 * (crossing face edges the way a halo exchange does).
 */
(() => {
  const gridCv = document.getElementById('globeCanvas');
  const flowCv = document.getElementById('flowCanvas');
  if (!gridCv || !flowCv) return;

  const hero = gridCv.parentElement;
  const g = gridCv.getContext('2d');
  const f = flowCv.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const N = 12;                 // cells per face edge (display resolution)
  const Q = Math.PI / 4;
  const D = (2 * Q) / N;        // equiangular cell width
  const SAMPLES = 20;           // points per grid line

  // Each face: outward normal n and in-plane axes a, b.
  const FACES = [
    { n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] },
    { n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] },
    { n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
    { n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] },
    { n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, 1] },
    { n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, -1] },
  ];

  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 1;
  let yaw = 0.6, tilt = 0.38, t = 0, running = false, visible = true;
  let col = {};

  // ---------- geometry ----------
  function facePoint(fi, al, be) {
    const F = FACES[fi], ta = Math.tan(al), tb = Math.tan(be);
    const x = F.n[0] + ta * F.a[0] + tb * F.b[0];
    const y = F.n[1] + ta * F.a[1] + tb * F.b[1];
    const z = F.n[2] + ta * F.a[2] + tb * F.b[2];
    const l = Math.hypot(x, y, z);
    return [x / l, y / l, z / l];
  }

  // Which face/cell contains a point on the sphere.
  function snap(p) {
    let fi = 0, best = -Infinity;
    for (let k = 0; k < 6; k++) {
      const d = p[0] * FACES[k].n[0] + p[1] * FACES[k].n[1] + p[2] * FACES[k].n[2];
      if (d > best) { best = d; fi = k; }
    }
    const F = FACES[fi];
    const al = Math.atan((p[0] * F.a[0] + p[1] * F.a[1] + p[2] * F.a[2]) / best);
    const be = Math.atan((p[0] * F.b[0] + p[1] * F.b[1] + p[2] * F.b[2]) / best);
    const i = Math.min(N - 1, Math.max(0, Math.floor((al + Q) / D)));
    const j = Math.min(N - 1, Math.max(0, Math.floor((be + Q) / D)));
    return { fi, i, j };
  }

  // Precomputed polylines: interior grid lines and face edges.
  const gridLines = [], edgeLines = [], faceOutlines = [];
  for (let fi = 0; fi < 6; fi++) {
    for (let k = 0; k <= N; k++) {
      const c = -Q + k * D;
      const l1 = [], l2 = [];
      for (let s = 0; s <= SAMPLES; s++) {
        const u = -Q + (s / SAMPLES) * 2 * Q;
        l1.push(facePoint(fi, c, u));
        l2.push(facePoint(fi, u, c));
      }
      const target = k === 0 || k === N ? edgeLines : gridLines;
      target.push(l1, l2);
    }
    const o = [];
    for (let s = 0; s < SAMPLES; s++) o.push(facePoint(fi, -Q + (s / SAMPLES) * 2 * Q, -Q));
    for (let s = 0; s < SAMPLES; s++) o.push(facePoint(fi, Q, -Q + (s / SAMPLES) * 2 * Q));
    for (let s = 0; s < SAMPLES; s++) o.push(facePoint(fi, Q - (s / SAMPLES) * 2 * Q, Q));
    for (let s = 0; s < SAMPLES; s++) o.push(facePoint(fi, -Q, Q - (s / SAMPLES) * 2 * Q));
    faceOutlines.push(o);
  }

  // World -> view rotation (yaw about the polar axis, then tilt toward the viewer).
  let cyw = 1, syw = 0, ctl = 1, stl = 0;
  function setRotation() { cyw = Math.cos(yaw); syw = Math.sin(yaw); ctl = Math.cos(tilt); stl = Math.sin(tilt); }
  const V = [0, 0, 0];
  function view(p) {
    const x = cyw * p[0] + syw * p[2];
    const z = -syw * p[0] + cyw * p[2];
    V[0] = x; V[1] = ctl * p[1] - stl * z; V[2] = stl * p[1] + ctl * z;
    return V;
  }
  function unview(v) {
    const y = ctl * v[1] + stl * v[2];
    const z = -stl * v[1] + ctl * v[2];
    return [cyw * v[0] - syw * z, y, syw * v[0] + cyw * z];
  }
  const sx = (v) => cx + R * v[0];
  const sy = (v) => cy - R * v[1];

  // ---------- colours ----------
  const hex = (s) => {
    s = s.trim().replace('#', '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    const n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const get = (n) => hex(cs.getPropertyValue(n));
    col = {
      ink: get('--ink'), edge: get('--flow-2'), warm: get('--warm'),
      f1: get('--flow-1'), f2: get('--flow-2'), f3: get('--flow-3'),
      globe: get('--bg-elev'), bg: get('--hero-bg'),
    };
    col.flow = [];
    for (let b = 0; b < 8; b++) {
      const k = b / 7;
      const c = mix(col.f1, col.f2, 0.35 + 0.65 * k);
      col.flow.push([rgba(c, 0.2 + 0.3 * k), rgba(c, 0.35 + 0.55 * k)]); // [near limb, facing viewer]
    }
  }

  // ---------- convolution kernels ----------
  const kernels = [{}];

  function pickPath(k) {
    // Start somewhere on the visible hemisphere, head off along a great circle.
    const th = Math.random() * Math.PI * 2, r = Math.random() * 0.6;
    const v = [r * Math.cos(th), r * Math.sin(th), 0];
    v[2] = Math.sqrt(1 - v[0] * v[0] - v[1] * v[1]);
    const a = unview(v);
    let d = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const dot = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
    d = d.map((x, i) => x - dot * a[i]);
    const l = Math.hypot(...d);
    k.a = a; k.b = d.map((x) => x / l); k.s = -0.7; k.cells = [];
  }
  kernels.forEach(pickPath);

  function stepKernel(k) {
    k.s += D;
    if (k.s > 0.9) pickPath(k);
    const c = Math.cos(k.s), s = Math.sin(k.s);
    const p = [c * k.a[0] + s * k.b[0], c * k.a[1] + s * k.b[1], c * k.a[2] + s * k.b[2]];
    const ctr = snap(p);
    const al0 = -Q + (ctr.i + 0.5) * D, be0 = -Q + (ctr.j + 0.5) * D;
    const seen = new Set();
    k.cells = [];
    // 3x3 stencil laid out on the centre cell's face plane; neighbours past the
    // face edge land on the adjacent face, just like a halo exchange.
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const q = snap(facePoint(ctr.fi, al0 + di * D, be0 + dj * D));
        const key = q.fi + ',' + q.i + ',' + q.j;
        if (seen.has(key)) continue;
        seen.add(key);
        k.cells.push(q);
      }
    }
  }

  function cellPath(ctx, q) {
    const a0 = -Q + q.i * D, b0 = -Q + q.j * D;
    const corners = [[a0, b0], [a0 + D, b0], [a0 + D, b0 + D], [a0, b0 + D]];
    let ok = true;
    ctx.beginPath();
    corners.forEach(([al, be], n) => {
      const v = view(facePoint(q.fi, al, be));
      if (v[2] < 0.05) ok = false;
      n ? ctx.lineTo(sx(v), sy(v)) : ctx.moveTo(sx(v), sy(v));
    });
    ctx.closePath();
    return ok;
  }

  // ---------- wind particles ----------
  let particles = [];
  function spawn(p) {
    p.lat = Math.asin(2 * Math.random() - 1) * 0.95;
    p.lon = Math.random() * Math.PI * 2;
    p.age = 0; p.life = 50 + Math.random() * 90;
  }
  function initParticles() {
    const n = Math.round(Math.min(1200, Math.max(400, R * R * 0.009)));
    particles = Array.from({ length: n }, () => { const p = {}; spawn(p); p.age = Math.random() * p.life; return p; });
  }

  let wLon = 0, wLat = 0;
  function wind(lat, lon) {
    const m = 0.12 * Math.sin(4 * lon - 0.25 * t) + 0.05 * Math.sin(7 * lon + 0.18 * t);
    const dm = 0.48 * Math.cos(4 * lon - 0.25 * t) + 0.35 * Math.cos(7 * lon + 0.18 * t);
    const dn = (lat - (0.7 + m)) / 0.2, ds = (lat + 0.7 + 0.8 * m) / 0.2;
    const jn = Math.exp(-dn * dn), js = Math.exp(-ds * ds);
    const cl = Math.max(0.25, Math.cos(lat));
    const u = jn + js - 0.35 * Math.exp(-((lat / 0.32) ** 2)) + 0.12 * Math.sin(5 * lat + 3 * lon + 0.2 * t);
    wLon = u / cl;
    wLat = (jn * dm - 0.8 * js * dm) / cl + 0.18 * Math.sin(3 * lon + 2 * lat + 0.2 * t) * Math.cos(5 * lat - 0.1 * t);
    return Math.hypot(u, wLat);
  }

  const segs = Array.from({ length: 16 }, () => []);
  function advect() {
    for (const s of segs) s.length = 0;
    const K = 0.0065;
    for (const p of particles) {
      const spd = wind(p.lat, p.lon);
      const cl0 = Math.cos(p.lat);
      const x0 = cl0 * Math.cos(p.lon), y0 = Math.sin(p.lat), z0 = cl0 * Math.sin(p.lon);
      p.lon += wLon * K; p.lat += wLat * K; p.age++;
      const cl1 = Math.cos(p.lat);
      const a = view([x0, y0, z0]); const ax = sx(a), ay = sy(a), az = a[2];
      const b = view([cl1 * Math.cos(p.lon), Math.sin(p.lat), cl1 * Math.sin(p.lon)]);
      if (az > 0.2 && b[2] > 0.2) {
        const sb = Math.min(7, Math.floor((spd / 1.3) * 8));
        segs[sb * 2 + (az > 0.45 ? 1 : 0)].push(ax, ay, sx(b), sy(b));
      }
      if (p.age > p.life || Math.abs(p.lat) > 1.45) spawn(p);
    }
  }

  function drawFlow(fade) {
    f.globalCompositeOperation = 'destination-out';
    f.fillStyle = `rgba(0,0,0,${fade})`;
    f.fillRect(0, 0, W, H);
    f.globalCompositeOperation = 'source-over';
    f.lineWidth = 1.4;
    f.lineCap = 'round';
    for (let b = 0; b < 16; b++) {
      const s = segs[b];
      if (!s.length) continue;
      f.strokeStyle = col.flow[b >> 1][b & 1];
      f.beginPath();
      for (let j = 0; j < s.length; j += 4) { f.moveTo(s[j], s[j + 1]); f.lineTo(s[j + 2], s[j + 3]); }
      f.stroke();
    }
  }

  // ---------- globe ----------
  function strokeLines(lines, color, width) {
    g.lineWidth = width;
    const bands = [[], [], []];
    for (const line of lines) {
      let prev = null;
      for (const p of line) {
        const v = view(p);
        const cur = [sx(v), sy(v), v[2]];
        if (prev && prev[2] > 0 && cur[2] > 0) {
          const z = (prev[2] + cur[2]) / 2;
          bands[z < 0.3 ? 0 : z < 0.65 ? 1 : 2].push(prev[0], prev[1], cur[0], cur[1]);
        }
        prev = cur;
      }
    }
    bands.forEach((s, k) => {
      if (!s.length) return;
      g.strokeStyle = color[k];
      g.beginPath();
      for (let j = 0; j < s.length; j += 4) { g.moveTo(s[j], s[j + 1]); g.lineTo(s[j + 2], s[j + 3]); }
      g.stroke();
    });
  }

  function drawGlobe() {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.clearRect(0, 0, W, H);

    // thin atmosphere: bright at the limb, gone within a few percent of R
    const halo = g.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.08);
    halo.addColorStop(0, rgba(col.f2, 0.22));
    halo.addColorStop(0.35, rgba(col.f2, 0.07));
    halo.addColorStop(1, rgba(col.f2, 0));
    g.fillStyle = halo;
    g.beginPath(); g.arc(cx, cy, R * 1.08, 0, Math.PI * 2); g.fill();

    // body lit from the upper left; the far side falls into shade
    const lx = cx - R * 0.45, ly = cy - R * 0.5;
    const body = g.createRadialGradient(lx, ly, 0, lx, ly, R * 1.75);
    body.addColorStop(0, rgba(col.globe, 1));
    body.addColorStop(0.5, rgba(mix(col.globe, col.f2, 0.07), 1));
    body.addColorStop(1, rgba(mix(col.globe, col.f2, 0.3), 1));
    g.fillStyle = body;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();

    // face tints (points behind the limb are pushed onto it)
    faceOutlines.forEach((o, fi) => {
      let any = false;
      g.beginPath();
      o.forEach((p, n) => {
        const v = view(p);
        let x = v[0], y = v[1];
        if (v[2] < 0) { const l = Math.hypot(x, y) || 1; x /= l; y /= l; } else any = true;
        n ? g.lineTo(cx + R * x, cy - R * y) : g.moveTo(cx + R * x, cy - R * y);
      });
      if (!any) return;
      g.fillStyle = rgba(col.f2, fi % 2 ? 0.05 : 0.015);
      g.fill();
    });

    const ink = col.ink;
    strokeLines(gridLines, [rgba(ink, 0.04), rgba(ink, 0.07), rgba(ink, 0.1)], 0.7);

    // live kernels
    g.lineWidth = 0.8;
    for (const k of kernels) {
      for (const q of k.cells) {
        if (!cellPath(g, q)) continue;
        g.fillStyle = rgba(col.warm, 0.3);
        g.fill();
        g.strokeStyle = rgba(col.warm, 0.85);
        g.stroke();
      }
    }

    strokeLines(edgeLines, [rgba(col.edge, 0.2), rgba(col.edge, 0.55), rgba(col.edge, 0.9)], 1.3);

    // fresnel: the limb brightens softly instead of being outlined
    const rim = g.createRadialGradient(cx, cy, R * 0.8, cx, cy, R);
    rim.addColorStop(0, rgba(col.f2, 0));
    rim.addColorStop(1, rgba(col.f2, 0.28));
    g.fillStyle = rim;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  }

  // ---------- lifecycle ----------
  function layout() {
    const r = hero.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    DPR = Math.min(2, window.devicePixelRatio || 1);
    if (W >= 900) {
      R = Math.min(H * 0.36, W * 0.24);
      cx = Math.min(W * 0.72, W / 2 + 560 - R * 0.6);
      cy = H * 0.52;
    } else {
      R = Math.min(W * 0.42, H * 0.22);
      cx = W * 0.62; cy = 70 + R * 1.05;
    }
    for (const cv of [gridCv, flowCv]) { cv.width = W * DPR; cv.height = H * DPR; }
    f.setTransform(DPR, 0, 0, DPR, 0, 0);
    readTheme();
    setRotation();
    initParticles();
  }

  let lastStep = 0, dragging = false;
  function tick() {
    const dt = 1 / 60;
    t += dt;
    if (!dragging) { yaw += 0.07 * dt; setRotation(); }
    if (t - lastStep > 0.2) {
      lastStep = t;
      kernels.forEach(stepKernel);
    }
    advect();
    drawFlow(dragging ? 0.3 : 0.055);
    drawGlobe();
  }

  function loop() { if (!running) return; tick(); requestAnimationFrame(loop); }
  function start() { if (!running && visible && !document.hidden) { running = true; requestAnimationFrame(loop); } }
  function stop() { running = false; }

  function renderStatic() {
    f.clearRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { t += 1 / 60; advect(); drawFlow(0.08); }
    for (let i = 0; i < 12; i++) kernels.forEach(stepKernel);
    drawGlobe();
  }

  layout();
  if (reduceMotion) renderStatic(); else start();

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { layout(); if (reduceMotion) renderStatic(); }, 150);
  });
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? (!reduceMotion && start()) : stop(); }).observe(hero);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : !reduceMotion && start()));

  // Drag to spin the globe.
  let px = 0, py = 0;
  hero.addEventListener('pointerdown', (e) => {
    if (e.target.closest('a, button') || e.pointerType === 'touch') return;
    dragging = true; px = e.clientX; py = e.clientY;
    hero.classList.add('is-dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yaw += (e.clientX - px) * 0.006;
    tilt = Math.max(-0.9, Math.min(1.1, tilt + (e.clientY - py) * 0.006));
    px = e.clientX; py = e.clientY;
    setRotation();
    if (reduceMotion) renderStatic();
  });
  window.addEventListener('pointerup', () => { dragging = false; hero.classList.remove('is-dragging'); });

  const recolor = () => { readTheme(); f.clearRect(0, 0, W, H); if (reduceMotion) renderStatic(); };
  new MutationObserver(recolor).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
})();
