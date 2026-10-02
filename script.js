(() => {
  'use strict';

  const canvas = document.getElementById('ink-canvas');
  const ctx = canvas.getContext('2d');
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLOR_INK = [244, 239, 231];   // cream
  const COLOR_ACCENT = [200, 67, 43];  // clay red
  const COLOR_BG = [11, 10, 10];

  let width = 0, height = 0, dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- lightweight smooth noise (sum of sines, deterministic) ---
  function noise(x) {
    return Math.sin(x * 1.0) * 0.5 +
           Math.sin(x * 2.13 + 1.7) * 0.25 +
           Math.sin(x * 4.07 + 3.1) * 0.125;
  }

  // --- stage parameter table (index = narrative stage 0..7) ---
  const STAGES = [
    { radiusScale: 0.80, noiseAmp: 0.07, noiseFreq: 1.6, spikiness: 0,   dots: 0,    ring: 0,   trace: 0,   grid: 0,   dissolve: 0 },
    { radiusScale: 0.86, noiseAmp: 0.05, noiseFreq: 1.8, spikiness: 0,   dots: 1,    ring: 0,   trace: 0,   grid: 0,   dissolve: 0 },
    { radiusScale: 0.52, noiseAmp: 0.03, noiseFreq: 2.0, spikiness: 0,   dots: 0.25, ring: 1,   trace: 0,   grid: 0,   dissolve: 0 },
    { radiusScale: 0.58, noiseAmp: 0.03, noiseFreq: 2.0, spikiness: 0,   dots: 0.1,  ring: 0.3, trace: 1,   grid: 0,   dissolve: 0 },
    { radiusScale: 0.92, noiseAmp: 0.012,noiseFreq: 1.1, spikiness: 0,   dots: 0,    ring: 0,   trace: 0.1,grid: 0,   dissolve: 0 },
    { radiusScale: 0.92, noiseAmp: 0.02, noiseFreq: 1.1, spikiness: 1,   dots: 0,    ring: 0,   trace: 0,  grid: 0,   dissolve: 0 },
    { radiusScale: 0.86, noiseAmp: 0.02, noiseFreq: 1.1, spikiness: 1,   dots: 0,    ring: 0,   trace: 0,  grid: 1,   dissolve: 0.55 },
    { radiusScale: 0.46, noiseAmp: 0.02, noiseFreq: 1.0, spikiness: 0.15,dots: 0,    ring: 0,   trace: 0,  grid: 0,   dissolve: 1 },
  ];

  function lerp(a, b, t) { return a + (b - a) * t; }

  function paramsAt(s) {
    const n = STAGES.length;
    s = Math.max(0, Math.min(n - 1, s));
    const i0 = Math.floor(s);
    const i1 = Math.min(n - 1, i0 + 1);
    const t = s - i0;
    const a = STAGES[i0], b = STAGES[i1];
    const out = {};
    for (const k in a) out[k] = lerp(a[k], b[k], t);
    return out;
  }

  // --- scroll -> stage mapping, based on actual section positions ---
  const sections = Array.from(document.querySelectorAll('[data-stage]'))
    .map(el => ({ el, stage: parseFloat(el.dataset.stage) }));

  let currentStage = 0;

  function computeStage() {
    const center = window.scrollY + window.innerHeight / 2;
    let s = sections[0].stage;
    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i], b = sections[i + 1];
      const topA = a.el.offsetTop, topB = b.el.offsetTop;
      if (center >= topA && center <= topB) {
        const t = topB > topA ? (center - topA) / (topB - topA) : 0;
        s = lerp(a.stage, b.stage, t);
        return s;
      }
    }
    if (center > sections[sections.length - 1].el.offsetTop) {
      return sections[sections.length - 1].stage;
    }
    return s;
  }

  // --- boundary points for the ink blob ---
  const POINT_COUNT = 56;
  const seeds = Array.from({ length: POINT_COUNT }, () => Math.random() * 100);

  // --- ambient dust particles (reused for stage-0 ambience and stage-7 dispersal) ---
  const DUST_COUNT = 70;
  const dust = Array.from({ length: DUST_COUNT }, () => ({
    angle: Math.random() * Math.PI * 2,
    dist: 0.3 + Math.random() * 0.9,
    speed: 0.02 + Math.random() * 0.05,
    size: 0.6 + Math.random() * 1.8,
    phase: Math.random() * Math.PI * 2,
  }));

  let t = 0; // animation clock

  function mixColor(c1, c2, t) {
    return [
      Math.round(lerp(c1[0], c2[0], t)),
      Math.round(lerp(c1[1], c2[1], t)),
      Math.round(lerp(c1[2], c2[2], t)),
    ];
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.52;
    const baseR = Math.min(width, height) * 0.24;

    const p = paramsAt(currentStage);
    const col = mixColor(COLOR_INK, COLOR_ACCENT, Math.min(1, p.spikiness * 0.35 + p.dissolve * 0.25));

    // soft glow backdrop
    const glowR = baseR * (p.radiusScale + 0.9);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
    grad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.10)`);
    grad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // ambient / dissolving dust
    const dustOpacity = Math.max(0.12, p.dissolve * 0.9, (1 - p.radiusScale) * 0.15);
    ctx.save();
    for (const d of dust) {
      const drift = Math.sin(t * d.speed + d.phase) * 0.06;
      const r = baseR * (d.dist + drift) * (0.8 + p.dissolve * 0.9);
      const a = d.angle + t * 0.01 * (d.speed);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r * 0.86;
      ctx.beginPath();
      ctx.arc(x, y, d.size * dpr * 0.6 + d.size * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${COLOR_INK[0]},${COLOR_INK[1]},${COLOR_INK[2]},${dustOpacity * 0.5})`;
      ctx.fill();
    }
    ctx.restore();

    // main blob outline
    const spikeCount = 7;
    const points = [];
    for (let i = 0; i < POINT_COUNT; i++) {
      const angle = (i / POINT_COUNT) * Math.PI * 2;
      const wobble = noise(angle * p.noiseFreq + t * 0.12 + seeds[i] * 0.02);
      const spikeWave = Math.pow(Math.abs(Math.sin(angle * spikeCount / 2)), 3);
      const r = baseR * p.radiusScale *
        (1 + p.noiseAmp * wobble) *
        (1 + p.spikiness * 0.38 * spikeWave);
      points.push({
        x: cx + Math.cos(angle) * r * (1 - p.dissolve * 0.3),
        y: cy + Math.sin(angle) * r * 0.9 * (1 - p.dissolve * 0.3),
        angle, r,
      });
    }

    ctx.save();
    ctx.globalAlpha = 1 - p.dissolve * 0.75;
    ctx.beginPath();
    points.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    const fillGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseR * p.radiusScale * 1.1);
    fillGrad.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.22)`);
    fillGrad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0.05)`);
    ctx.fillStyle = fillGrad;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},0.65)`;
    ctx.stroke();
    ctx.restore();

    // dissolve particles escaping the outline
    if (p.dissolve > 0.02) {
      ctx.save();
      points.forEach((pt, i) => {
        if (i % 2 !== 0) return;
        const esc = p.dissolve * (baseR * 0.5) * (0.4 + (i % 5) * 0.12);
        const x = cx + Math.cos(pt.angle) * (pt.r + esc);
        const y = cy + Math.sin(pt.angle) * (pt.r + esc) * 0.9;
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${0.5 * p.dissolve})`;
        ctx.fill();
      });
      ctx.restore();
    }

    // internal molecular dots (stage 1)
    if (p.dots > 0.02) {
      ctx.save();
      for (let i = 0; i < 46; i++) {
        const a = (i / 46) * Math.PI * 2 + t * 0.05;
        const rr = baseR * p.radiusScale * (0.15 + 0.7 * ((i * 37) % 100) / 100);
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr * 0.9;
        ctx.beginPath();
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${COLOR_BG[0]},${COLOR_BG[1]},${COLOR_BG[2]},${p.dots * 0.6})`;
        ctx.fill();
      }
      ctx.restore();
    }

    // scan ring (stage 2)
    if (p.ring > 0.02) {
      ctx.save();
      ctx.globalAlpha = p.ring;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * p.radiusScale * 1.35, t * 0.6, t * 0.6 + Math.PI * 1.4);
      ctx.strokeStyle = `rgba(${COLOR_ACCENT[0]},${COLOR_ACCENT[1]},${COLOR_ACCENT[2]},0.8)`;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 8]);
      ctx.stroke();
      ctx.restore();
    }

    // trace lines (stage 3)
    if (p.trace > 0.02) {
      ctx.save();
      ctx.globalAlpha = p.trace;
      ctx.strokeStyle = `rgba(${COLOR_INK[0]},${COLOR_INK[1]},${COLOR_INK[2]},0.35)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([1, 7]);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + t * 0.08;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * baseR * 0.6, cy + Math.sin(a) * baseR * 0.55);
        ctx.lineTo(cx + Math.cos(a) * baseR * 1.7, cy + Math.sin(a) * baseR * 1.55);
        ctx.stroke();
      }
      ctx.restore();
    }

    // needle grid patch (stage 6)
    if (p.grid > 0.02) {
      ctx.save();
      ctx.globalAlpha = p.grid * 0.8;
      const gridSize = baseR * 1.3;
      const step = gridSize / 7;
      for (let gx = -gridSize / 2; gx <= gridSize / 2; gx += step) {
        for (let gy = -gridSize / 2; gy <= gridSize / 2; gy += step) {
          const x = cx + gx, y = cy + gy * 0.9;
          ctx.beginPath();
          ctx.moveTo(x - 2, y);
          ctx.lineTo(x + 2, y);
          ctx.moveTo(x, y - 2);
          ctx.lineTo(x, y + 2);
          ctx.strokeStyle = `rgba(${COLOR_ACCENT[0]},${COLOR_ACCENT[1]},${COLOR_ACCENT[2]},0.5)`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  function tick() {
    if (!prefersReducedMotion) t += 0.016;
    currentStage = lerp(currentStage, computeStage(), 0.08);
    draw();
    requestAnimationFrame(tick);
  }

  // --- reveal sections on scroll ---
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.classList.add('is-active');
    });
  }, { threshold: 0.45 });

  document.querySelectorAll('.story-step, .closing').forEach(el => observer.observe(el));

  // --- waitlist form (front-end only placeholder) ---
  const form = document.getElementById('waitlist-form');
  const success = document.getElementById('waitlist-success');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      form.hidden = true;
      success.hidden = false;
    });
  }

  draw();
  requestAnimationFrame(tick);
})();
