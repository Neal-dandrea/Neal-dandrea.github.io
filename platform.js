/* Market data platform walkthrough.
 *
 * ⚠️ EVERYTHING HERE IS SYNTHETIC. No request leaves the page, no real quote,
 *    trade, position or parameter appears anywhere in this file, and none of
 *    the production logic is reproduced. The numbers come from a seeded
 *    generator and from published textbook models, so the page renders the same
 *    for every visitor and can be read as an illustration rather than a result.
 *
 * No framework and no build step, to match the rest of the site. Charts are
 * SVG where they want hover and hit testing, canvas where they want to redraw
 * every frame.
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- utils */

  // Deterministic, so the "market" is the same for everyone who visits and a
  // screenshot always matches the page. mulberry32.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gauss(r) {
    let u = 0, v = 0;
    while (u === 0) u = r();
    while (v === 0) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fmt = (n, d = 2) => n.toFixed(d);
  const comma = (n) => n.toLocaleString("en-US");

  const root = document.querySelector(".viz-root");
  function cssVar(name) {
    return getComputedStyle(root).getPropertyValue(name).trim();
  }

  const SVG_NS = "http://www.w3.org/2000/svg";
  function el(name, attrs, parent) {
    const n = document.createElementNS(SVG_NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* One tooltip, shared. Charts hand it HTML and a client position. */
  const tip = document.createElement("div");
  tip.className = "viz-tip";
  tip.setAttribute("role", "status");
  document.body.appendChild(tip);

  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.dataset.open = "true";
    const w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = clamp(x + 14, 8, window.innerWidth - w - 8) + "px";
    tip.style.top = clamp(y - h - 12, 8, window.innerHeight - h - 8) + "px";
  }
  function hideTip() { tip.dataset.open = "false"; }

  /* Canvases are sized in CSS pixels but drawn at device resolution, or every
     line on a retina screen looks soft. */
  function fitCanvas(canvas, cssHeight) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 640;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.height = cssHeight + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h: cssHeight };
  }

  function seqColor(t) {
    const stops = [cssVar("--seq-1"), cssVar("--seq-2"), cssVar("--seq-3"),
                   cssVar("--seq-4"), cssVar("--seq-5")];
    const x = clamp(t, 0, 1) * (stops.length - 1);
    const i = Math.min(Math.floor(x), stops.length - 2);
    return mixHex(stops[i], stops[i + 1], x - i);
  }

  function hexToRgb(h) {
    const s = h.replace("#", "");
    const v = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }
  function mixHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
  }

  /* -------------------------------------------------------- the model ---- */

  /* SVI, in the raw parameterization from Gatheral's published work. Total
     implied variance for log-moneyness k:
         w(k) = a + b ( rho (k - m) + sqrt((k - m)^2 + sigma^2) )
     Implied vol is sqrt(w / T). This is the textbook form, and it is here
     because it produces the right SHAPE — a skewed smile that flattens with
     maturity — not because it is anybody's calibration. */
  /* A market context. The panels used to pass a regime name; they now pass one
     of these, so a symbol and a date can move the surface independently.
       base   ATM level at the short end
       term   how fast ATM vol rises with maturity
       skew   vol per unit log-moneyness, the steepness of the smile
       evt    a bump localised near one expiry, an earnings date or a vote
       str    a short-dated add-on, what a selloff does to the front of the curve
  */
  const CTX = (o) => Object.assign({ base: 0.175, term: 0.045, skew: 0.42, evt: 0, str: 0 }, o);

  const REGIMES = {
    calm:   CTX({}),
    event:  CTX({ evt: 0.075 }),
    stress: CTX({ str: 0.10, skew: 0.54 }),
  };

  function sviParams(T, ctx) {
    ctx = ctx || REGIMES.calm;
    const ev = ctx.evt ? Math.exp(-Math.pow((T - 0.06) / 0.05, 2)) * ctx.evt : 0;
    const stress = ctx.str ? ctx.str * Math.exp(-T * 0.9) : 0;
    const atm = ctx.base + ctx.term * Math.sqrt(T) + ev + stress;      // ATM vol

    // ⚠️ b SCALES WITH T, and getting this wrong is the classic way to draw a
    //    surface that looks plausible and is nonsense. Total variance w is
    //    roughly T·(atm + s·k)^2, so the wing slope in w is of order T, and a b
    //    that does not carry that factor sends sqrt(w/T) to the moon at the
    //    short end. A first pass here held b nearly constant and produced a
    //    284% one-week wing, which is the sort of number a real surface fitter
    //    rejects rather than plots.
    const b = 2 * T * atm * ctx.skew;
    const rho = clamp(-0.72 + 0.26 * T - (ctx.str ? 0.12 : 0), -0.92, -0.18);
    const m = -0.012;
    const sigma = 0.055 + 0.16 * Math.sqrt(T);
    const w0 = T * atm * atm;
    const a = w0 - b * (rho * (0 - m) + Math.sqrt(m * m + sigma * sigma));
    return { a, b, rho, m, sigma };
  }

  function sviVol(k, T, ctx) {
    const p = sviParams(T, ctx);
    const w = p.a + p.b * (p.rho * (k - p.m) + Math.sqrt((k - p.m) * (k - p.m) + p.sigma * p.sigma));
    return Math.sqrt(Math.max(w, 1e-6) / T);
  }

  const K_MIN = -0.42, K_MAX = 0.32, T_MIN = 0.02, T_MAX = 1.5;

  /* ------------------------------------------------------- 01 stat tiles - */

  function renderStats() {
    const host = document.getElementById("stat-row");
    if (!host) return;
    const stats = [
      { v: "505", u: "", l: "symbols on the stream" },
      { v: "17.2", u: "M", l: "quote updates a session" },
      { v: "500", u: "ms", l: "capture resolution" },
      { v: "12", u: "", l: "bar intervals derived" },
      { v: "76", u: "M", l: "option rows in history" },
    ];
    host.innerHTML = stats.map((s) => `
      <div class="stat">
        <span class="value">${s.v}<span class="unit">${s.u}</span></span>
        <span class="label">${s.l}</span>
      </div>`).join("");
  }

  /* -------------------------------------------------- 01 pipeline diagram */

  function renderPipeline() {
    const host = document.getElementById("pipeline");
    if (!host) return;
    clear(host);
    const W = 720, H = 200;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": "A quote arriving over a WebSocket, entering a tick buffer, "
        + "being written to the time series store and aggregated into bars" }, host);

    const ink = cssVar("--ink-soft") || "#4c515a";
    const faint = cssVar("--ink-faint") || "#686f79";
    const rule = cssVar("--rule") || "#dcdcd6";
    const accent = cssVar("--accent") || "#9e1b32";

    const stages = [
      { x: 18,  t: "Venue", s: "WebSocket" },
      { x: 158, t: "Tick buffer", s: "in memory" },
      { x: 298, t: "Time-series store", s: "date partitioned" },
      { x: 448, t: "Bar engine", s: "any interval" },
      { x: 590, t: "Surface fit", s: "per expiry" },
    ];

    stages.forEach((st, i) => {
      const w = i === 2 ? 128 : i === 3 ? 118 : 112;
      el("rect", { x: st.x, y: 56, width: w, height: 52, rx: 4,
        fill: "none", stroke: i === 1 ? accent : rule, "stroke-width": i === 1 ? 1.5 : 1 }, svg);
      const t1 = el("text", { x: st.x + w / 2, y: 80, "text-anchor": "middle",
        "font-size": 13, fill: ink }, svg);
      t1.textContent = st.t;
      const t2 = el("text", { x: st.x + w / 2, y: 96, "text-anchor": "middle",
        "font-size": 11, fill: faint }, svg);
      t2.textContent = st.s;

      if (i < stages.length - 1) {
        const x1 = st.x + w + 4, x2 = stages[i + 1].x - 4;
        el("line", { x1, y1: 82, x2, y2: 82, stroke: rule, "stroke-width": 1 }, svg);
        el("path", { d: `M${x2 - 5},78 L${x2},82 L${x2 - 5},86`, fill: "none",
          stroke: rule, "stroke-width": 1 }, svg);
        // The packet that travels the wire. Pure decoration, so it is skipped
        // when the visitor has asked for less motion.
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const dot = el("circle", { r: 2.6, cy: 82, fill: accent, opacity: 0.85 }, svg);
          // All five start together. Staggering them made the diagram look like
          // five unrelated animations rather than one packet moving through a
          // pipeline in step.
          const an = el("animate", { attributeName: "cx", from: x1, to: x2,
            dur: "1.5s", begin: "0s", repeatCount: "indefinite" }, dot);
          an.setAttribute("keyTimes", "0;1");
        }
      }
    });

    const note = el("text", { x: 18, y: 140, "font-size": 11.5, fill: faint }, svg);
    note.textContent = "Sub-minute bars are assembled from the buffer, because the vendor does not publish them.";
    const note2 = el("text", { x: 18, y: 158, "font-size": 11.5, fill: faint }, svg);
    note2.textContent = "Every stage is idempotent, so a replay after an outage cannot double-count a quote.";
  }

  /* -------------------------------------------------------- 02 live tape - */

  const tape = {
    bars: [], forming: null, price: 100, playing: true, r: rng(90210), ticks: 0,
  };

  function newBar(px) {
    return { o: px, h: px, l: px, c: px, n: 0 };
  }

  function tapeInit() {
    tape.bars = [];
    tape.price = 208.4;
    for (let i = 0; i < 34; i++) {
      const b = newBar(tape.price);
      for (let j = 0; j < 30; j++) {
        tape.price += gauss(tape.r) * 0.06 + 0.004;
        b.h = Math.max(b.h, tape.price);
        b.l = Math.min(b.l, tape.price);
      }
      b.c = tape.price;
      tape.bars.push(b);
    }
    tape.forming = newBar(tape.price);
  }

  function tapeStep() {
    tape.price += gauss(tape.r) * 0.06 + 0.004;
    const f = tape.forming;
    f.c = tape.price;
    f.h = Math.max(f.h, tape.price);       // high and low only ever ratchet out
    f.l = Math.min(f.l, tape.price);
    f.n++;
    if (f.n >= 30) {                        // the minute rolls over
      tape.bars.push(f);
      if (tape.bars.length > 34) tape.bars.shift();
      tape.forming = newBar(tape.price);
    }
  }

  function drawTape() {
    const canvas = document.getElementById("tape-canvas");
    if (!canvas) return;
    const { ctx, w, h } = fitCanvas(canvas, 320);
    const all = tape.bars.concat([tape.forming]);
    const padL = 8, padR = 56, padT = 14, padB = 26;
    const lo = Math.min.apply(null, all.map((b) => b.l));
    const hi = Math.max.apply(null, all.map((b) => b.h));
    const pad = (hi - lo) * 0.12 || 1;
    const y = (p) => padT + (hi + pad - p) / (hi - lo + 2 * pad) * (h - padT - padB);
    const bw = (w - padL - padR) / all.length;

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = cssVar("--grid");
    ctx.lineWidth = 1;
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = cssVar("--ink-faint");
    const step = (hi - lo + 2 * pad) / 4;
    for (let i = 0; i <= 4; i++) {
      const p = lo - pad + step * i;
      const yy = Math.round(y(p)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillText(p.toFixed(2), w - padR + 8, yy + 4);
    }

    all.forEach((b, i) => {
      const isForming = i === all.length - 1;
      const x = padL + i * bw + bw / 2;
      const up = b.c >= b.o;
      const col = isForming ? cssVar("--forming")
                            : (up ? cssVar("--good") : cssVar("--muted-mark"));
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, y(b.h));
      ctx.lineTo(Math.round(x) + 0.5, y(b.l));
      ctx.stroke();
      const bodyTop = y(Math.max(b.o, b.c));
      const bodyH = Math.max(1.5, Math.abs(y(b.o) - y(b.c)));
      const bwid = Math.max(2, bw * 0.62);
      if (isForming) {
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x - bwid / 2, bodyTop, bwid, bodyH);
        ctx.globalAlpha = 1;
        ctx.setLineDash([3, 2]);
        ctx.strokeRect(x - bwid / 2, bodyTop, bwid, bodyH);
        ctx.setLineDash([]);
      } else if (up) {
        ctx.fillRect(x - bwid / 2, bodyTop, bwid, bodyH);
      } else {
        ctx.strokeRect(x - bwid / 2 + 0.5, bodyTop + 0.5, bwid - 1, bodyH - 1);
      }
    });

    // The forming bar is labelled rather than left to the legend, because it is
    // the whole point of the panel.
    const fx = padL + (all.length - 1) * bw + bw / 2;
    ctx.fillStyle = cssVar("--forming");
    ctx.textAlign = "right";
    ctx.fillText("forming", Math.min(fx - 6, w - padR - 4), padT + 10);
    ctx.textAlign = "left";
    ctx.fillStyle = cssVar("--ink-faint");
    ctx.fillText(`tick ${tape.forming.n}/30 of this bar`, padL, h - 8);
  }

  function tapeControls() {
    const host = document.getElementById("tape-controls");
    if (!host) return;
    host.innerHTML = '<span class="control-label">Simulated tape</span>'
      + '<button type="button" id="tape-play" aria-pressed="true">Pause</button>'
      + '<button type="button" id="tape-step">Single tick</button>';
    document.getElementById("tape-play").addEventListener("click", function () {
      tape.playing = !tape.playing;
      this.textContent = tape.playing ? "Pause" : "Play";
      this.setAttribute("aria-pressed", String(tape.playing));
    });
    document.getElementById("tape-step").addEventListener("click", function () {
      tapeStep(); drawTape();
    });
  }

  window.__platform = { rng, gauss, clamp, lerp, fmt, comma, cssVar, el, clear,
    showTip, hideTip, fitCanvas, seqColor, mixHex, sviVol, sviParams, CTX, REGIMES,
    K_MIN, K_MAX, T_MIN, T_MAX, renderStats, renderPipeline,
    tape, tapeInit, tapeStep, drawTape, tapeControls, tip };
})();

/* ---------------------------------------------------------------------- */
(function () {
  "use strict";
  const P = window.__platform;
  const { clamp, lerp, fmt, comma, cssVar, el, clear, showTip, hideTip,
          fitCanvas, seqColor, sviVol, rng, gauss, CTX, REGIMES,
          K_MIN, K_MAX, T_MIN, T_MAX } = P;

  /* ------------------------------------------------------------ markets --
     Five names and five dates, months apart. The dates are chosen so the
     surfaces do not look like each other: a quiet tape, a selloff, the run-up
     to an earnings print, the collapse after it, and a nervous drift. Spot
     levels are round numbers and are not anybody's marks. */

  const NAMES = {
    SPX:  { label: "SPX",  spot: 5480, base: 0.135, term: 0.055, skew: 0.62,
            note: "An index, so the steepest skew on the board, because everyone hedges the same way" },
    AAPL: { label: "AAPL", spot: 232,  base: 0.225, term: 0.040, skew: 0.34,
            note: "A large-cap single name with a moderate tilt" },
    XLE:  { label: "XLE",  spot: 92,   base: 0.255, term: 0.030, skew: 0.28,
            note: "A sector ETF, flatter than the index and higher in level" },
    NVDA: { label: "NVDA", spot: 128,  base: 0.425, term: 0.020, skew: 0.26,
            note: "A high-beta single name, a tall surface with a near-symmetric smile" },
    TSLA: { label: "TSLA", spot: 246,  base: 0.520, term: 0.010, skew: 0.20,
            note: "The highest level here and the flattest tilt, because the fear is two-sided" },
  };

  const DATES = {
    "2025-01-17": { label: "17 Jan 2025", lvl: 0.82, evt: 0,     str: 0,    skewMul: 0.95,
                    note: "a quiet tape. Low level, upward-sloping term structure, textbook shape." },
    "2025-04-04": { label: "4 Apr 2025",  lvl: 1.95, evt: 0,     str: 0.13, skewMul: 1.35,
                    note: "a selloff. The whole surface lifts, the front lifts most, and the skew steepens." },
    "2025-07-25": { label: "25 Jul 2025", lvl: 1.05, evt: 0.085, str: 0,    skewMul: 1.0,
                    note: "an earnings print inside the front month. One expiry stands proud of its neighbours." },
    "2025-10-31": { label: "31 Oct 2025", lvl: 0.74, evt: 0,     str: -0.035, skewMul: 0.9,
                    note: "the crush after the event. The front end collapses and the term structure steepens upward." },
    "2026-02-27": { label: "27 Feb 2026", lvl: 1.28, evt: 0.03,  str: 0.04, skewMul: 1.15,
                    note: "a nervous drift. Elevated everywhere without a single dominant event." },
  };

  const market = { sym: "SPX", date: "2025-01-17" };

  /* ⚠️ THE DATE MULTIPLIERS ARE DAMPED BY THE NAME'S OWN LEVEL, and without
     that the page prints numbers no surface has ever shown. A selloff roughly
     doubles index volatility, but it does not double a name already trading at
     42, because volatility of volatility falls as the level rises. Applied
     flat, the selloff date put NVDA's three-month at-the-money vol at 94%,
     which is the sort of figure that discredits everything around it. */
  function marketCtx(symKey, dateKey) {
    const n = NAMES[symKey || market.sym], d = DATES[dateKey || market.date];
    const damp = 0.22 / (0.12 + n.base);        // ~0.86 for the index, ~0.40 for NVDA
    return CTX({
      base: n.base * (1 + (d.lvl - 1) * damp),
      term: n.term * (d.str < 0 ? 1.8 : 1),     // a crushed front end steepens the slope
      skew: n.skew * d.skewMul,
      evt: d.evt * (n.base / 0.2) * damp,       // an event moves a jumpy name further
      str: d.str * damp,
    });
  }

  /* ------------------------------------------------------- 03 vol surface */

  const surf = { yaw: -0.85, tilt: 0.52, cue: null, drag: null };
  const NK = 30, NT = 20;

  function surfaceGrid() {
    const pts = [];
    for (let i = 0; i < NT; i++) {
      const row = [];
      const T = T_MIN + (T_MAX - T_MIN) * Math.pow(i / (NT - 1), 1.35);
      for (let j = 0; j < NK; j++) {
        const k = lerp(K_MIN, K_MAX, j / (NK - 1));
        row.push({ k, T, v: sviVol(k, T, marketCtx()) });
      }
      pts.push(row);
    }
    return pts;
  }

  /* Two stages on purpose. `raw` projects into abstract units and knows nothing
     about the canvas. `fitFor` measures the whole projected cloud once and
     returns the scale and offset that make it fill the box. Rotating then
     cannot walk the surface into a corner or shrink it into the middle, which
     is what hand-tuned scale factors do as soon as the angle changes. */
  function raw(k, T, v, vlo, vhi) {
    const x = (k - (K_MIN + K_MAX) / 2) / ((K_MAX - K_MIN) / 2);
    const y = (T - (T_MIN + T_MAX) / 2) / ((T_MAX - T_MIN) / 2);
    const z = (v - vlo) / Math.max(vhi - vlo, 1e-6);
    const cx = Math.cos(surf.yaw), sy = Math.sin(surf.yaw);
    return { x: x * cx - y * sy,
             y: (x * sy + y * cx) * 0.55 - z * 1.25,
             depth: x * sy + y * cx };
  }

  function fitFor(grid, w, h, vlo, vhi) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    grid.forEach((row) => row.forEach((p) => {
      const r = raw(p.k, p.T, p.v, vlo, vhi);
      x0 = Math.min(x0, r.x); x1 = Math.max(x1, r.x);
      y0 = Math.min(y0, r.y); y1 = Math.max(y1, r.y);
    }));
    const padX = 30, padTop = 34, padBot = 38;
    const availW = w - 2 * padX, availH = h - padTop - padBot;
    const s = Math.min(availW / Math.max(x1 - x0, 1e-6), availH / Math.max(y1 - y0, 1e-6));
    return {
      s,
      ox: padX - x0 * s + (availW - (x1 - x0) * s) / 2,
      oy: padTop - y0 * s + (availH - (y1 - y0) * s) / 2,
    };
  }

  function project(k, T, v, vlo, vhi, fit) {
    const r = raw(k, T, v, vlo, vhi);
    return { x: r.x * fit.s + fit.ox, y: r.y * fit.s + fit.oy, depth: r.depth };
  }

  function drawSurface() {
    const canvas = document.getElementById("surface-canvas");
    if (!canvas) return;
    const { ctx, w, h } = fitCanvas(canvas, Math.max(360, Math.min(480, canvas.clientWidth * 0.62)));
    const g = surfaceGrid();
    let vlo = Infinity, vhi = -Infinity;
    g.forEach((row) => row.forEach((p) => { vlo = Math.min(vlo, p.v); vhi = Math.max(vhi, p.v); }));

    ctx.clearRect(0, 0, w, h);
    const fit = fitFor(g, w, h, vlo, vhi);

    // Painter's algorithm. Each cell is one quad; sorting by mean depth is
    // enough here because the surface is a height field and cannot self-occlude
    // in a way that a per-quad sort gets wrong.
    const quads = [];
    for (let i = 0; i < NT - 1; i++) {
      for (let j = 0; j < NK - 1; j++) {
        const c = [g[i][j], g[i][j + 1], g[i + 1][j + 1], g[i + 1][j]];
        const pr = c.map((p) => project(p.k, p.T, p.v, vlo, vhi, fit));
        const mv = (c[0].v + c[1].v + c[2].v + c[3].v) / 4;
        quads.push({ pr, t: (mv - vlo) / Math.max(vhi - vlo, 1e-6),
                     depth: (pr[0].depth + pr[2].depth) / 2, i, j });
      }
    }
    quads.sort((a, b) => a.depth - b.depth);

    const ruleCol = cssVar("--grid");
    quads.forEach((q) => {
      ctx.beginPath();
      ctx.moveTo(q.pr[0].x, q.pr[0].y);
      for (let n = 1; n < 4; n++) ctx.lineTo(q.pr[n].x, q.pr[n].y);
      ctx.closePath();
      ctx.fillStyle = seqColor(q.t);
      ctx.fill();
      ctx.strokeStyle = ruleCol;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    });

    // The cues draw one slice proud of the surface, which is what the prose on
    // the right is pointing at.
    const accent = cssVar("--accent");
    function ribbon(points, label) {
      ctx.beginPath();
      points.forEach((p, n) => {
        const s = project(p.k, p.T, p.v, vlo, vhi, fit);
        if (n === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      });
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      const mid = points[Math.floor(points.length * 0.12)];
      const ms = project(mid.k, mid.T, mid.v, vlo, vhi, fit);
      ctx.fillStyle = accent;
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(label, clamp(ms.x - 10, 6, w - 130), ms.y - 8);
    }
    if (surf.cue === "skew") ribbon(g[3], "one expiry: the skew");
    if (surf.cue === "term") {
      const col = g.map((row) => row[Math.round(NK * 0.55)]);
      ribbon(col, "one strike: the term structure");
    }

    ctx.fillStyle = cssVar("--ink-faint");
    ctx.font = "11.5px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("strike, away from the forward →", 10, h - 8);
    ctx.fillText(`implied vol ${(vlo * 100).toFixed(0)}% to ${(vhi * 100).toFixed(0)}%`, 10, 16);
    ctx.textAlign = "right";
    ctx.fillText("← more time to expiry", w - 10, h - 8);
    ctx.textAlign = "left";
  }

  function surfaceControls() {
    const host = document.getElementById("surface-controls");
    if (!host) return;
    host.innerHTML =
      '<div class="picker"><span class="control-label">Underlying</span>'
      + Object.keys(NAMES).map((k) =>
          `<button type="button" data-sym="${k}" aria-pressed="${k === market.sym}">${NAMES[k].label}</button>`).join("")
      + '</div>'
      + '<div class="picker"><span class="control-label">As of</span>'
      + Object.keys(DATES).map((k) =>
          `<button type="button" data-date="${k}" aria-pressed="${k === market.date}">${DATES[k].label}</button>`).join("")
      + '</div>'
      + '<p class="market-note" id="market-note"></p>';

    function pick(attr, key) {
      return (b) => {
        market[key] = b.dataset[attr];
        host.querySelectorAll(`[data-${attr}]`).forEach((o) =>
          o.setAttribute("aria-pressed", String(o === b)));
        redrawMarket();
      };
    }
    host.querySelectorAll("[data-sym]").forEach((b) =>
      b.addEventListener("click", () => pick("sym", "sym")(b)));
    host.querySelectorAll("[data-date]").forEach((b) =>
      b.addEventListener("click", () => pick("date", "date")(b)));

    document.querySelectorAll(".cue").forEach((b) => {
      b.addEventListener("click", () => {
        surf.cue = surf.cue === b.dataset.cue ? null : b.dataset.cue;
        document.querySelectorAll(".cue").forEach((o) =>
          o.setAttribute("aria-pressed", String(o.dataset.cue === surf.cue)));
        drawSurface();
        document.getElementById("surface-canvas")
          .scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    });

    const canvas = document.getElementById("surface-canvas");
    canvas.addEventListener("pointerdown", (e) => {
      surf.drag = { x: e.clientX, yaw: surf.yaw };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!surf.drag) return;
      surf.yaw = surf.drag.yaw + (e.clientX - surf.drag.x) * 0.008;
      drawSurface();
    });
    const end = () => { surf.drag = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);

    // Rotation from the keyboard, so the panel is not mouse-only.
    canvas.tabIndex = 0;
    canvas.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") { surf.yaw -= 0.12; drawSurface(); e.preventDefault(); }
      if (e.key === "ArrowRight") { surf.yaw += 0.12; drawSurface(); e.preventDefault(); }
    });
  }

  function marketNote() {
    const n = document.getElementById("market-note");
    if (!n) return;
    const atm3m = sviVol(0, 0.25, marketCtx()) * 100;
    n.innerHTML = `<strong>${NAMES[market.sym].label}, ${DATES[market.date].label}.</strong> `
      + `${NAMES[market.sym].note}. ${DATES[market.date].note} `
      + `Three-month at-the-money volatility here is <strong>${atm3m.toFixed(1)}%</strong>.`;
  }

  function redrawMarket() {
    marketNote();
    drawSurface();
    drawSmile();
    drawResid();
    drawTrade();
  }

  /* --------------------------------------------------------- 04 smile fit */

  const smile = { T: 0.25, r: rng(4242) };
  const EXPIRIES = [
    { label: "1 week", T: 0.02 }, { label: "1 month", T: 0.083 },
    { label: "3 months", T: 0.25 }, { label: "6 months", T: 0.5 },
    { label: "1 year", T: 1.0 },
  ];

  function smileData() {
    const r = rng(Math.round(smile.T * 1000) + market.sym.length * 17 + market.date.length);
    const pts = [];
    for (let i = 0; i < 26; i++) {
      const k = lerp(K_MIN, K_MAX, i / 25);
      const fit = sviVol(k, smile.T, marketCtx());
      // Quotes are noisier in the wings, which is where the volume is thin.
      const wing = 1 + 2.4 * Math.pow(Math.abs(k) / 0.42, 2);
      pts.push({ k, fit, mkt: fit + gauss(r) * 0.0042 * wing });
    }
    return pts;
  }

  function axes(svg, W, H, pad, xr, yr, xlab, ylab, yfmt) {
    const faint = cssVar("--ink-faint"), grid = cssVar("--grid");
    for (let i = 0; i <= 4; i++) {
      const v = lerp(yr[0], yr[1], i / 4);
      const y = pad.t + (1 - i / 4) * (H - pad.t - pad.b);
      el("line", { x1: pad.l, y1: y, x2: W - pad.r, y2: y,
        stroke: grid, "stroke-width": 1 }, svg);
      const t = el("text", { x: pad.l - 8, y: y + 4, "text-anchor": "end",
        "font-size": 11, fill: faint }, svg);
      t.textContent = yfmt ? yfmt(v) : fmt(v, 2);
    }
    for (let i = 0; i <= 4; i++) {
      const v = lerp(xr[0], xr[1], i / 4);
      const x = pad.l + (i / 4) * (W - pad.l - pad.r);
      const t = el("text", { x, y: H - pad.b + 16, "text-anchor": "middle",
        "font-size": 11, fill: faint }, svg);
      t.textContent = typeof xlab === "function" ? xlab(v) : fmt(v, 2);
    }
    if (ylab) {
      const t = el("text", { x: pad.l, y: pad.t - 8, "font-size": 11, fill: faint }, svg);
      t.textContent = ylab;
    }
  }

  let smilePts = [];

  function drawSmile() {
    const svg = document.getElementById("smile-svg");
    if (!svg) return;
    clear(svg);
    smilePts = smileData();
    const W = 720, H = 300, pad = { l: 52, r: 96, t: 26, b: 34 };
    const ks = smilePts.map((p) => p.k);
    const vs = smilePts.flatMap((p) => [p.fit, p.mkt]);
    const yr = [Math.min.apply(null, vs) * 0.97, Math.max.apply(null, vs) * 1.03];
    const X = (k) => pad.l + (k - K_MIN) / (K_MAX - K_MIN) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - pad.t - pad.b);

    axes(svg, W, H, pad, [K_MIN, K_MAX], yr,
      (v) => (v === 0 ? "ATM" : (v > 0 ? "+" : "") + (v * 100).toFixed(0) + "%"),
      "implied volatility", (v) => (v * 100).toFixed(1) + "%");

    el("line", { x1: X(0), y1: pad.t, x2: X(0), y2: H - pad.b,
      stroke: cssVar("--muted-mark"), "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);

    const d = smilePts.map((p, i) => `${i ? "L" : "M"}${X(p.k)},${Y(p.fit)}`).join("");
    el("path", { d, fill: "none", stroke: cssVar("--series-1"), "stroke-width": 2 }, svg);

    smilePts.forEach((p) => {
      el("circle", { cx: X(p.k), cy: Y(p.mkt), r: 4,
        fill: cssVar("--series-2"), stroke: cssVar("--surface-panel"), "stroke-width": 2 }, svg);
    });

    // Direct labels rather than a legend box, which is also the relief the
    // light-mode contrast check asks for.
    const last = smilePts[smilePts.length - 1];
    // The fit runs through the quotes, so at the right edge these two labels
    // land on the same pixel. Push them apart rather than letting them stack.
    const ly = Y(last.fit);
    const l1 = el("text", { x: X(last.k) + 10, y: ly + 14, "font-size": 12,
      fill: cssVar("--series-1") }, svg);
    l1.textContent = "SVI fit";
    const l2 = el("text", { x: X(last.k) + 10, y: ly - 6, "font-size": 12,
      fill: cssVar("--series-2") }, svg);
    l2.textContent = "quotes";

    const atm = el("text", { x: X(0), y: pad.t - 10, "text-anchor": "middle",
      "font-size": 11, fill: cssVar("--ink-faint") }, svg);
    atm.textContent = "at the money";

    const hit = el("rect", { x: pad.l, y: pad.t, width: W - pad.l - pad.r,
      height: H - pad.t - pad.b, fill: "transparent" }, svg);
    hit.addEventListener("pointermove", (e) => {
      const box = svg.getBoundingClientRect();
      const kx = K_MIN + ((e.clientX - box.left) / box.width * W - pad.l)
        / (W - pad.l - pad.r) * (K_MAX - K_MIN);
      let best = smilePts[0];
      smilePts.forEach((p) => { if (Math.abs(p.k - kx) < Math.abs(best.k - kx)) best = p; });
      showTip(
        `<span class="k">log-moneyness</span> ${fmt(best.k, 3)}<br>`
        + `<span class="k">quote</span> ${(best.mkt * 100).toFixed(2)}%<br>`
        + `<span class="k">fit</span> ${(best.fit * 100).toFixed(2)}%<br>`
        + `<span class="k">residual</span> ${((best.mkt - best.fit) * 100).toFixed(2)} vol pts`,
        e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", hideTip);
  }

  function drawResid() {
    const svg = document.getElementById("resid-svg");
    if (!svg || !smilePts.length) return;
    clear(svg);
    const W = 720, H = 120, pad = { l: 52, r: 96, t: 14, b: 26 };
    const res = smilePts.map((p) => (p.mkt - p.fit) * 100);
    const m = Math.max(0.6, Math.max.apply(null, res.map(Math.abs)) * 1.2);
    const X = (k) => pad.l + (k - K_MIN) / (K_MAX - K_MIN) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v + m) / (2 * m)) * (H - pad.t - pad.b);

    el("line", { x1: pad.l, y1: Y(0), x2: W - pad.r, y2: Y(0),
      stroke: cssVar("--muted-mark"), "stroke-width": 1 }, svg);
    const faint = cssVar("--ink-faint");
    [m, -m].forEach((v) => {
      const t = el("text", { x: pad.l - 8, y: Y(v) + 4, "text-anchor": "end",
        "font-size": 10.5, fill: faint }, svg);
      t.textContent = (v > 0 ? "+" : "") + fmt(v, 1);
    });
    const lab = el("text", { x: W - pad.r + 10, y: Y(0) + 4, "font-size": 11.5, fill: faint }, svg);
    lab.textContent = "residual, vol pts";

    smilePts.forEach((p, i) => {
      const v = res[i];
      el("line", { x1: X(p.k), y1: Y(0), x2: X(p.k), y2: Y(v),
        stroke: cssVar("--muted-mark"), "stroke-width": 1 }, svg);
      el("circle", { cx: X(p.k), cy: Y(v), r: 3, fill: cssVar("--series-2") }, svg);
    });
  }

  function smileControls() {
    const host = document.getElementById("smile-controls");
    if (!host) return;
    host.innerHTML = '<span class="control-label">Expiry</span>'
      + EXPIRIES.map((x, i) => `<button type="button" data-t="${x.T}" aria-pressed="${i === 2}">${x.label}</button>`).join("");
    host.querySelectorAll("[data-t]").forEach((b) => {
      b.addEventListener("click", () => {
        smile.T = parseFloat(b.dataset.t);
        host.querySelectorAll("[data-t]").forEach((o) =>
          o.setAttribute("aria-pressed", String(o === b)));
        drawSmile(); drawResid();
      });
    });
  }

  /* -------------------------------------------------------------- 05 skew */

  function rr25(T, ctx) {
    // A 25-delta risk reversal, approximated by reading the fitted surface a
    // fixed number of standard deviations either side of the forward. Positive
    // means downside strikes are the more expensive ones.
    const atm = sviVol(0, T, ctx);
    const k = 0.66 * atm * Math.sqrt(T);
    return (sviVol(-k, T, ctx) - sviVol(k, T, ctx)) * 100;
  }

  function drawSkew() {
    const svg = document.getElementById("skew-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 320, pad = { l: 54, r: 150, t: 26, b: 38 };
    const series = [
      { name: "calm day", ctx: REGIMES.calm, c: cssVar("--series-1") },
      { name: "front-month event", ctx: REGIMES.event, c: cssVar("--series-2") },
      { name: "selloff", ctx: REGIMES.stress, c: cssVar("--series-3") },
    ];
    const Ts = [];
    for (let i = 0; i < 40; i++) Ts.push(T_MIN + (T_MAX - T_MIN) * Math.pow(i / 39, 1.3));

    const all = series.flatMap((s) => Ts.map((T) => rr25(T, s.ctx)));
    const yr = [Math.min.apply(null, all) * 0.9, Math.max.apply(null, all) * 1.08];
    const X = (T) => pad.l + Math.pow((T - T_MIN) / (T_MAX - T_MIN), 0.55) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - pad.t - pad.b);

    const faint = cssVar("--ink-faint"), grid = cssVar("--grid");
    for (let i = 0; i <= 4; i++) {
      const v = lerp(yr[0], yr[1], i / 4);
      const y = Y(v);
      el("line", { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: grid, "stroke-width": 1 }, svg);
      const t = el("text", { x: pad.l - 8, y: y + 4, "text-anchor": "end",
        "font-size": 11, fill: faint }, svg);
      t.textContent = fmt(v, 1);
    }
    [[0.02, "1w"], [0.083, "1m"], [0.25, "3m"], [0.5, "6m"], [1.0, "1y"], [1.5, "18m"]]
      .forEach(([T, lab]) => {
        const t = el("text", { x: X(T), y: H - pad.b + 16, "text-anchor": "middle",
          "font-size": 11, fill: faint }, svg);
        t.textContent = lab;
      });
    const ylab = el("text", { x: pad.l, y: pad.t - 8, "font-size": 11, fill: faint }, svg);
    ylab.textContent = "25-delta risk reversal, vol points";

    series.forEach((s) => {
      const d = Ts.map((T, i) => `${i ? "L" : "M"}${X(T)},${Y(rr25(T, s.ctx))}`).join("");
      el("path", { d, fill: "none", stroke: s.c, "stroke-width": 2 }, svg);
    });

    // Direct labels at the right end. The three lines converge at the long end,
    // so the labels have to be pushed apart or they print on top of each other,
    // which is what happens if you just place each one at its own line's y.
    const labels = series
      .map((s) => ({ s, y: Y(rr25(T_MAX, s.ctx)) }))
      .sort((a, b) => a.y - b.y);
    const MIN_GAP = 15;
    for (let i = 1; i < labels.length; i++) {
      if (labels[i].y - labels[i - 1].y < MIN_GAP) labels[i].y = labels[i - 1].y + MIN_GAP;
    }
    labels.forEach((L) => {
      const ly = Y(rr25(T_MAX, L.s.ctx));
      if (Math.abs(ly - L.y) > 2) {
        el("line", { x1: X(T_MAX) + 3, y1: ly, x2: X(T_MAX) + 7, y2: L.y,
          stroke: L.s.c, "stroke-width": 1, opacity: 0.6 }, svg);
      }
      const t = el("text", { x: X(T_MAX) + 10, y: L.y + 4, "font-size": 11.5, fill: L.s.c }, svg);
      t.textContent = L.s.name;
    });

    const hit = el("rect", { x: pad.l, y: pad.t, width: W - pad.l - pad.r,
      height: H - pad.t - pad.b, fill: "transparent" }, svg);
    let cross = null;
    hit.addEventListener("pointermove", (e) => {
      const box = svg.getBoundingClientRect();
      const px = (e.clientX - box.left) / box.width * W;
      const frac = clamp((px - pad.l) / (W - pad.l - pad.r), 0, 1);
      const T = T_MIN + (T_MAX - T_MIN) * Math.pow(frac, 1 / 0.55);
      if (cross) cross.remove();
      cross = el("line", { x1: X(T), y1: pad.t, x2: X(T), y2: H - pad.b,
        stroke: cssVar("--muted-mark"), "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
      showTip(`<span class="k">expiry</span> ${(T * 12).toFixed(1)} months<br>`
        + series.map((s) => `<span class="k">${s.name}</span> ${fmt(rr25(T, s.ctx), 2)}`).join("<br>"),
        e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", () => { if (cross) { cross.remove(); cross = null; } hideTip(); });
  }

  /* ---------------------------------------------------------- 06 backtest */

  const bt = { costBp: 4.5 };

  function btData() {
    const r = rng(777);
    const n = 1260;                       // about five years of trading days
    const out = [];
    let g = 0, net = 0;
    for (let i = 0; i < n; i++) {
      const ret = gauss(r) * 0.0072 + 0.00028;
      const traded = r() < 0.42;          // turnover is what costs money
      g += ret;
      net += ret - (traded ? bt.costBp / 10000 : 0);
      out.push({ i, g, net });
    }
    return out;
  }

  let btSeries = btData();

  function drawEquity() {
    const svg = document.getElementById("equity-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 300, pad = { l: 54, r: 92, t: 26, b: 34 };
    const vals = btSeries.flatMap((p) => [p.g, p.net]);
    const yr = [Math.min.apply(null, vals) - 0.02, Math.max.apply(null, vals) + 0.03];
    const X = (i) => pad.l + i / (btSeries.length - 1) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - pad.t - pad.b);
    const faint = cssVar("--ink-faint"), grid = cssVar("--grid");

    for (let i = 0; i <= 4; i++) {
      const v = lerp(yr[0], yr[1], i / 4), y = Y(v);
      el("line", { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: grid, "stroke-width": 1 }, svg);
      const t = el("text", { x: pad.l - 8, y: y + 4, "text-anchor": "end",
        "font-size": 11, fill: faint }, svg);
      t.textContent = (v * 100).toFixed(0) + "%";
    }
    for (let y = 0; y <= 5; y++) {
      const t = el("text", { x: X(y * 252), y: H - pad.b + 16, "text-anchor": "middle",
        "font-size": 11, fill: faint }, svg);
      t.textContent = y === 0 ? "start" : `yr ${y}`;
    }

    [["g", cssVar("--series-1"), "gross of costs"], ["net", cssVar("--series-2"), "net of costs"]]
      .forEach(([key, col, name]) => {
        const d = btSeries.map((p, i) => `${i ? "L" : "M"}${X(i)},${Y(p[key])}`).join("");
        el("path", { d, fill: "none", stroke: col, "stroke-width": 2 }, svg);
        const lastp = btSeries[btSeries.length - 1];
        const t = el("text", { x: W - pad.r + 8, y: Y(lastp[key]) + 4, "font-size": 11.5, fill: col }, svg);
        t.textContent = name;
        const v = el("text", { x: W - pad.r + 8, y: Y(lastp[key]) + 18, "font-size": 11.5, fill: faint }, svg);
        v.textContent = (lastp[key] * 100).toFixed(1) + "%";
      });

    const hit = el("rect", { x: pad.l, y: pad.t, width: W - pad.l - pad.r,
      height: H - pad.t - pad.b, fill: "transparent" }, svg);
    let cross = null;
    hit.addEventListener("pointermove", (e) => {
      const box = svg.getBoundingClientRect();
      const px = (e.clientX - box.left) / box.width * W;
      const i = Math.round(clamp((px - pad.l) / (W - pad.l - pad.r), 0, 1) * (btSeries.length - 1));
      const p = btSeries[i];
      if (cross) cross.remove();
      cross = el("line", { x1: X(i), y1: pad.t, x2: X(i), y2: H - pad.b,
        stroke: cssVar("--muted-mark"), "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
      showTip(`<span class="k">day</span> ${i}<br>`
        + `<span class="k">gross</span> ${(p.g * 100).toFixed(1)}%<br>`
        + `<span class="k">net</span> ${(p.net * 100).toFixed(1)}%<br>`
        + `<span class="k">cost drag</span> ${((p.g - p.net) * 100).toFixed(1)} pts`,
        e.clientX, e.clientY);
    });
    hit.addEventListener("pointerleave", () => { if (cross) { cross.remove(); cross = null; } hideTip(); });
  }

  function drawDrawdown() {
    const svg = document.getElementById("dd-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 110, pad = { l: 54, r: 92, t: 14, b: 22 };
    let peak = -Infinity;
    const dd = btSeries.map((p) => { peak = Math.max(peak, p.net); return p.net - peak; });
    const lo = Math.min.apply(null, dd);
    const X = (i) => pad.l + i / (dd.length - 1) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (v / (lo || -1)) * (H - pad.t - pad.b);

    const d = dd.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join("")
      + `L${X(dd.length - 1)},${Y(0)}L${X(0)},${Y(0)}Z`;
    el("path", { d, fill: cssVar("--series-2"), opacity: 0.18 }, svg);
    el("path", { d: dd.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join(""),
      fill: "none", stroke: cssVar("--series-2"), "stroke-width": 1.5 }, svg);

    const faint = cssVar("--ink-faint");
    const t = el("text", { x: W - pad.r + 8, y: Y(lo) + 4, "font-size": 11.5, fill: faint }, svg);
    t.textContent = "worst " + (lo * 100).toFixed(1) + "%";
    const t2 = el("text", { x: pad.l, y: pad.t - 2, "font-size": 11, fill: faint }, svg);
    t2.textContent = "drawdown, net";
  }

  function btControls() {
    const host = document.getElementById("bt-controls");
    if (!host) return;
    host.innerHTML = '<span class="control-label">Assumed cost per trade</span>'
      + [1.5, 4.5, 9].map((c) => `<button type="button" data-c="${c}" aria-pressed="${c === 4.5}">${c} bp</button>`).join("")
      + '<span class="control-label">the same strategy, three cost assumptions</span>';
    host.querySelectorAll("[data-c]").forEach((b) => {
      b.addEventListener("click", () => {
        bt.costBp = parseFloat(b.dataset.c);
        host.querySelectorAll("[data-c]").forEach((o) =>
          o.setAttribute("aria-pressed", String(o === b)));
        btSeries = btData();
        drawEquity(); drawDrawdown();
      });
    });
  }

  /* --------------------------------------------------------- 07 ablation */

  const SIGNALS = [
    "Cross-sectional momentum", "Short-term reversal", "Volatility risk premium",
    "Term-structure carry", "Skew change", "Order-flow imbalance",
    "Open-interest change", "Sector relative strength", "Overnight drift",
    "Volume surprise", "Realised-implied spread", "Breadth thrust",
    "Correlation regime", "Gamma-exposure proxy",
  ];

  function ablationData() {
    const r = rng(31337);
    return SIGNALS.map((name, i) => {
      const survivor = i === 2;                  // one family clears the bar
      const mean = survivor ? 0.52 : gauss(r) * 0.16;
      const half = survivor ? 0.26 : 0.30 + Math.abs(gauss(r)) * 0.11;
      return { name, mean, lo: mean - half, hi: mean + half, survivor };
    }).sort((a, b) => b.mean - a.mean);
  }

  function drawAblation() {
    const svg = document.getElementById("ablation-svg");
    if (!svg) return;
    clear(svg);
    const data = ablationData();
    const W = 720, H = 420, pad = { l: 188, r: 30, t: 30, b: 40 };
    const xr = [-0.75, 0.9];
    const X = (v) => pad.l + (v - xr[0]) / (xr[1] - xr[0]) * (W - pad.l - pad.r);
    const rowH = (H - pad.t - pad.b) / data.length;
    const faint = cssVar("--ink-faint"), ink = cssVar("--ink-soft");

    el("line", { x1: X(0), y1: pad.t - 6, x2: X(0), y2: H - pad.b,
      stroke: cssVar("--muted-mark"), "stroke-width": 1 }, svg);
    const zl = el("text", { x: X(0), y: pad.t - 12, "text-anchor": "middle",
      "font-size": 11, fill: faint }, svg);
    zl.textContent = "no better than baseline";

    data.forEach((d, i) => {
      const y = pad.t + i * rowH + rowH / 2;
      const col = d.survivor ? cssVar("--good") : cssVar("--muted-mark");

      const lab = el("text", { x: pad.l - 12, y: y + 4, "text-anchor": "end",
        "font-size": 11.5, fill: d.survivor ? ink : faint }, svg);
      lab.textContent = d.name;

      const x0 = Math.min(X(0), X(d.mean)), w = Math.abs(X(d.mean) - X(0));
      el("rect", { x: x0, y: y - rowH * 0.22, width: Math.max(w, 1),
        height: rowH * 0.44, rx: 3, fill: col, opacity: d.survivor ? 1 : 0.55 }, svg);

      el("line", { x1: X(d.lo), y1: y, x2: X(d.hi), y2: y, stroke: col, "stroke-width": 1.5 }, svg);
      [d.lo, d.hi].forEach((v) => {
        el("line", { x1: X(v), y1: y - 4, x2: X(v), y2: y + 4, stroke: col, "stroke-width": 1.5 }, svg);
      });

      if (d.survivor) {
        const t = el("text", { x: X(d.hi) + 8, y: y + 4, "font-size": 11.5,
          fill: cssVar("--good") }, svg);
        t.textContent = "kept";
      }

      const hit = el("rect", { x: pad.l, y: y - rowH / 2, width: W - pad.l - pad.r,
        height: rowH, fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (e) => {
        showTip(`<strong>${d.name}</strong><br>`
          + `<span class="k">edge over baseline</span> ${fmt(d.mean, 2)}<br>`
          + `<span class="k">interval</span> ${fmt(d.lo, 2)} to ${fmt(d.hi, 2)}<br>`
          + (d.survivor ? "Interval clears zero. Kept."
                        : "Interval contains zero. Retired."), e.clientX, e.clientY);
      });
      hit.addEventListener("pointerleave", hideTip);
    });

    const foot = el("text", { x: pad.l, y: H - 12, "font-size": 11.5, fill: faint }, svg);
    foot.textContent = "13 of 14 retired. The one that survived is the one that was already well documented.";
  }

  /* ---------------------------------------------------------- 08 breadth */

  function renderBreadth() {
    // ⚠️ NOT "breadth". The section wrapping this figure owns that id for the
    //    nav anchor, and getElementById would hand back the section, whose
    //    innerHTML this function then replaces — taking the heading and the
    //    lede with it. It did exactly that until it was caught in a screenshot.
    const host = document.getElementById("breadth-figure");
    if (!host) return;
    const rows = [
      { n: 126756, what: "nominal bets: every signal on every name on every day", c: "--muted-mark" },
      { n: 18420, what: "after removing overlapping holding periods", c: "--muted-mark" },
      { n: 513, what: "independent bets after adjusting for correlation", c: "--accent" },
    ];
    // ⚠️ LINEAR, NOT LOG. A log scale fits all three comfortably and makes
    //    126,756 and 18,420 look like near neighbours, which is the opposite of
    //    the point. On a linear scale the last bar is a sliver, and the sliver
    //    is the finding. It is floored at two pixels so it stays visible.
    const max = rows[0].n;
    host.innerHTML = rows.map((r) => {
      const pct = (r.n / max) * 100;
      return `<div class="breadth-row">
        <span class="n">${comma(r.n)}</span>
        <span class="bar" style="width:max(2px, ${pct.toFixed(2)}%);background:var(${r.c})"></span>
        <span class="what">${r.what}</span>
      </div>`;
    }).join("")
    + `<p style="margin:1rem 0 0;font-size:0.88rem;color:var(--ink-soft)">
         The bars are linear and the last one is barely a mark, which is the
         finding rather than a drawing problem. The drop from the first number
         to the third is a factor of ${Math.round(126756 / 513)}, so the
         evidence is ${Math.round(Math.sqrt(126756 / 513))} times weaker than
         the trade count suggests, since precision goes with the square root.
       </p>`;
  }

  /* ------------------------------------------------ 09 the worked trade --

     Black-76 on the forward, which is the right frame for options on an index
     or a future and keeps the carry assumptions in one place instead of
     scattered through the greeks.

     Everything below is arithmetic the reader can check: the strikes come from
     inverting delta, the vols come from the fitted surface at those strikes,
     the prices come from the closed form, and the "what the skew is worth"
     number is the same trade repriced with the smile switched off. */

  const R = 0.043;          // financing rate, stated rather than hidden
  const Z25 = 0.6744897501960817;   // the standard normal quantile at 75%

  function normCdf(x) {
    // Abramowitz and Stegun 26.2.17, good to about 7.5e-8, which is far finer
    // than the vols this is fed.
    const s = x < 0 ? -1 : 1;
    const z = Math.abs(x) / Math.SQRT2;
    const t = 1 / (1 + 0.3275911 * z);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
      - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
    return 0.5 * (1 + s * y);
  }
  const normPdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

  function black76(F, K, T, vol, isCall) {
    const sT = vol * Math.sqrt(T);
    const d1 = (Math.log(F / K) + 0.5 * vol * vol * T) / sT;
    const d2 = d1 - sT;
    const df = Math.exp(-R * T);
    const price = isCall ? df * (F * normCdf(d1) - K * normCdf(d2))
                         : df * (K * normCdf(-d2) - F * normCdf(-d1));
    return {
      price, d1, d2,
      delta: df * (isCall ? normCdf(d1) : normCdf(d1) - 1),
      vega: df * F * Math.sqrt(T) * normPdf(d1) * 0.01,    // per vol POINT
      gamma: df * normPdf(d1) / (F * sT),
    };
  }

  /* The 25-delta strike is a fixed point, because the vol you price it at
     depends on the strike you are solving for. Six passes is plenty; it moves
     by less than a basis point after three. */
  function delta25Strike(F, T, isCall, ctx) {
    let vol = sviVol(0, T, ctx), K = F;
    for (let i = 0; i < 6; i++) {
      const d1 = isCall ? -Z25 : Z25;
      K = F * Math.exp(0.5 * vol * vol * T - d1 * vol * Math.sqrt(T));
      vol = sviVol(Math.log(K / F), T, ctx);
    }
    return { K, vol };
  }

  const TRADE_T = 0.25;
  const SPREAD_VOL_PTS = 0.35;     // half-spread per leg, in vol points

  function tradeMath() {
    const ctx = marketCtx();
    const S = NAMES[market.sym].spot;
    const F = S * Math.exp(R * TRADE_T);
    const put = delta25Strike(F, TRADE_T, false, ctx);
    const call = delta25Strike(F, TRADE_T, true, ctx);
    const atmVol = sviVol(0, TRADE_T, ctx);

    const pLeg = black76(F, put.K, TRADE_T, put.vol, false);
    const cLeg = black76(F, call.K, TRADE_T, call.vol, true);

    // Short the put, long the call: one contract each, 100 shares a contract.
    const M = 100;
    const credit = (pLeg.price - cLeg.price) * M;

    // The same two strikes priced with the smile switched off. The difference
    // is the part of the premium that exists only because the surface is
    // skewed, which is the thing the trade is actually expressing.
    const pFlat = black76(F, put.K, TRADE_T, atmVol, false);
    const cFlat = black76(F, call.K, TRADE_T, atmVol, true);
    const creditFlat = (pFlat.price - cFlat.price) * M;
    const skewValue = credit - creditFlat;

    const netDelta = (-pLeg.delta + cLeg.delta) * M;
    const netVega = (-pLeg.vega + cLeg.vega) * M;
    const netGamma = -pLeg.gamma + cLeg.gamma;          // per share, per F^2

    // Dollar gamma, stated as the P&L a 1% move produces from curvature alone:
    //   pnl = 1/2 · gamma · (dF)^2 · contract size,  with dF = 0.01F
    const gammaPnl1pct = 0.5 * netGamma * Math.pow(0.01 * F, 2) * M;

    const cost = (pLeg.vega + cLeg.vega) * SPREAD_VOL_PTS * M;

    return { ctx, S, F, put, call, atmVol, pLeg, cLeg, credit, creditFlat,
             skewValue, netDelta, netVega, netGamma, gammaPnl1pct, cost, M };
  }

  function drawTrade() {
    const host = document.getElementById("trade-steps");
    if (!host) return;
    const t = tradeMath();
    const sym = NAMES[market.sym].label;
    const money = (x) => (x < 0 ? "\u2212$" : "$") + Math.abs(x).toFixed(0);
    const money2 = (x) => (x < 0 ? "\u2212$" : "$") + Math.abs(x).toFixed(2);
    const pc = (v) => (v * 100).toFixed(2) + "%";

    host.innerHTML = `
      <ol class="steps">
        <li>
          <h4>1. Start from the forward, not the spot</h4>
          <p>Spot is ${money(t.S)}. Carry it out three months at ${(R * 100).toFixed(1)}%
             and the forward is <strong>${money2(t.F)}</strong>. Every strike below is
             quoted against that, so financing is stated once instead of leaking
             into each greek.</p>
          <pre>F = S·e^(rT) = ${t.S} × e^(${R}×${TRADE_T}) = ${t.F.toFixed(2)}</pre>
        </li>
        <li>
          <h4>2. Ask the surface for the 25-delta strikes</h4>
          <p>The strike and its volatility depend on each other, so this is
             solved rather than looked up: guess a vol, get a strike, read the
             surface at that strike, repeat. It settles in three passes.</p>
          <pre>K = F·exp(½σ²T ∓ 0.6745·σ√T)</pre>
          <table class="nums">
            <tr><th></th><th>strike</th><th>vol from the surface</th></tr>
            <tr><td>25-delta put</td><td>${t.put.K.toFixed(2)}</td><td>${pc(t.put.vol)}</td></tr>
            <tr><td>at the money</td><td>${t.F.toFixed(2)}</td><td>${pc(t.atmVol)}</td></tr>
            <tr><td>25-delta call</td><td>${t.call.K.toFixed(2)}</td><td>${pc(t.call.vol)}</td></tr>
          </table>
          <p class="aside">The gap between the first and last row is the skew:
             <strong>${((t.put.vol - t.call.vol) * 100).toFixed(2)} volatility points</strong>.
             That is the number the whole trade is about.</p>
        </li>
        <li>
          <h4>3. Price both legs</h4>
          <p>Black-76, one contract of each, 100 shares a contract.</p>
          <pre>d₁ = [ln(F/K) + ½σ²T] / σ√T        d₂ = d₁ − σ√T
call = e^(−rT)[F·N(d₁) − K·N(d₂)]
put  = e^(−rT)[K·N(−d₂) − F·N(−d₁)]</pre>
          <table class="nums">
            <tr><th></th><th>d₁</th><th>d₂</th><th>price</th><th>per contract</th></tr>
            <tr><td>put, ${t.put.K.toFixed(0)}</td><td>${t.pLeg.d1.toFixed(3)}</td>
                <td>${t.pLeg.d2.toFixed(3)}</td><td>${money2(t.pLeg.price)}</td>
                <td>${money(t.pLeg.price * t.M)}</td></tr>
            <tr><td>call, ${t.call.K.toFixed(0)}</td><td>${t.cLeg.d1.toFixed(3)}</td>
                <td>${t.cLeg.d2.toFixed(3)}</td><td>${money2(t.cLeg.price)}</td>
                <td>${money(t.cLeg.price * t.M)}</td></tr>
          </table>
        </li>
        <li>
          <h4>4. The trade, and what the skew is actually worth</h4>
          <p>Sell the put, buy the call. That is a risk reversal, and it is the
             cleanest way to be short the skew.</p>
          <table class="nums">
            <tr><td>Premium taken in</td><td class="v">${money(t.credit)}</td></tr>
            <tr><td>The same two strikes, priced flat at the ${pc(t.atmVol)} at-the-money vol</td>
                <td class="v">${money(t.creditFlat)}</td></tr>
            <tr class="hl"><td>Difference: the part that exists only because the surface is skewed</td>
                <td class="v">${money(t.skewValue)}</td></tr>
          </table>
          <p class="aside">Price the same position off a single at-the-money
             number and you misprice it by ${money(Math.abs(t.skewValue))} a
             contract. That is the answer to why anyone fits a surface instead
             of quoting one volatility.</p>
        </li>
        <li>
          <h4>5. Hedge the direction out, because that is not the bet</h4>
          <p>The package is born delta ${t.netDelta > 0 ? "long" : "short"}. Trade
             ${Math.abs(t.netDelta).toFixed(0)} shares
             ${t.netDelta > 0 ? "short" : "long"} against it and what is left is a
             position in the shape of the surface.</p>
          <table class="nums">
            <tr><td>Net delta, shares</td><td class="v">${t.netDelta.toFixed(1)}</td></tr>
            <tr><td>Vega of the short put, per vol point</td><td class="v">${money2(-t.pLeg.vega * t.M)}</td></tr>
            <tr><td>Vega of the long call, per vol point</td><td class="v">${money2(t.cLeg.vega * t.M)}</td></tr>
            <tr class="hl"><td>Net vega</td><td class="v">${money2(t.netVega)}</td></tr>
            <tr><td>Gamma P&amp;L from a 1% move, curvature alone</td>
                <td class="v">${money2(t.gammaPnl1pct)}</td></tr>
          </table>
          <p class="aside">The two vegas very nearly cancel, and that is the
             point rather than an accident. Both legs sit at the same delta, so
             they carry almost the same sensitivity to the <em>level</em> of
             volatility, and what survives the subtraction is a bet on its
             <em>shape</em>. Lift the whole surface by a point and this position
             barely notices. Flatten the skew by a point and it pays.</p>
        </li>
        <li>
          <h4>6. Now subtract what it costs to do</h4>
          <p>At ${SPREAD_VOL_PTS} of a volatility point per leg, crossing the
             spread on both legs costs <strong>${money(t.cost)}</strong>, against a
             skew premium of ${money(t.skewValue)}.</p>
          <p class="verdict">${
            Math.abs(t.skewValue) > t.cost * 2.5
              ? `Costs eat ${(100 * t.cost / Math.abs(t.skewValue)).toFixed(0)}% of the edge. Survivable, and worth carrying further.`
              : `Costs eat ${(100 * t.cost / Math.abs(t.skewValue)).toFixed(0)}% of the edge. On this surface the trade is mostly a way to pay a market maker.`
          }</p>
        </li>
        <li>
          <h4>7. What you are actually short</h4>
          <p>The premium is compensation, not a gift. Selling the ${t.put.K.toFixed(0)}
             put means below that strike the losses run one-for-one with the
             index while the call financing it expires worthless. The skew is
             steep because that outcome is the one everybody is hedging, and a
             model that says the skew is "too steep" is competing with everyone
             who has already paid to be wrong about it.</p>
          <p class="aside">Which is why the honest version of this analysis ends
             at the ablation panel above rather than at a trade ticket.</p>
        </li>
      </ol>`;

    drawPayoff(t);
  }

  function drawPayoff(t) {
    const svg = document.getElementById("payoff-svg");
    if (!svg) return;
    clear(svg);
    const W = 420, H = 300, pad = { l: 58, r: 20, t: 26, b: 34 };
    const lo = t.F * 0.80, hi = t.F * 1.20;
    const pts = [];
    for (let i = 0; i <= 120; i++) {
      const S = lerp(lo, hi, i / 120);
      // At expiry: short put, long call, plus the premium taken in.
      const pnl = (Math.max(0, S - t.call.K) - Math.max(0, t.put.K - S)) * t.M + t.credit;
      pts.push({ S, pnl });
    }
    const ys = pts.map((p) => p.pnl);
    const y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const X = (S) => pad.l + (S - lo) / (hi - lo) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
    const faint = cssVar("--ink-faint"), grid = cssVar("--grid");

    for (let i = 0; i <= 4; i++) {
      const v = lerp(y0, y1, i / 4), y = Y(v);
      el("line", { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: grid, "stroke-width": 1 }, svg);
      const tx = el("text", { x: pad.l - 8, y: y + 4, "text-anchor": "end",
        "font-size": 10.5, fill: faint }, svg);
      tx.textContent = (v < 0 ? "\u2212$" : "$") + Math.abs(Math.round(v / 100) * 100).toLocaleString("en-US");
    }
    el("line", { x1: pad.l, y1: Y(0), x2: W - pad.r, y2: Y(0),
      stroke: cssVar("--muted-mark"), "stroke-width": 1 }, svg);

    [[t.put.K, "short put"], [t.F, "forward"], [t.call.K, "long call"]].forEach(([k, lab]) => {
      if (k < lo || k > hi) return;
      el("line", { x1: X(k), y1: pad.t, x2: X(k), y2: H - pad.b,
        stroke: cssVar("--muted-mark"), "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
      const tx = el("text", { x: X(k), y: H - pad.b + 15, "text-anchor": "middle",
        "font-size": 10, fill: faint }, svg);
      tx.textContent = k.toFixed(0);
      const tl = el("text", { x: X(k), y: H - pad.b + 27, "text-anchor": "middle",
        "font-size": 9.5, fill: faint }, svg);
      tl.textContent = lab;
    });

    const d = pts.map((p, i) => `${i ? "L" : "M"}${X(p.S)},${Y(p.pnl)}`).join("");
    el("path", { d, fill: "none", stroke: cssVar("--series-1"), "stroke-width": 2 }, svg);

    const title = el("text", { x: pad.l, y: pad.t - 10, "font-size": 11, fill: faint }, svg);
    title.textContent = "profit and loss at expiry, one contract each";
  }

  /* -------------------------------------------------------------- wiring */

  function drawAll() {
    marketNote();
    P.renderStats();
    P.renderPipeline();
    P.drawTape();
    drawSurface();
    drawSmile();
    drawResid();
    drawSkew();
    drawEquity();
    drawDrawdown();
    drawAblation();
    renderBreadth();
    drawTrade();
  }

  function init() {
    P.tapeInit();
    P.tapeControls();
    surfaceControls();
    smileControls();
    btControls();
    drawAll();

    let t = null;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(drawAll, 150);
    });

    // Dark mode is a different palette, not a filter, so everything that baked
    // a colour into a canvas has to be drawn again when the mode changes.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(drawAll);

    // The tape only animates while it is on screen and the tab is visible.
    let onScreen = true;
    const tapeEl = document.getElementById("tape-canvas");
    if (window.IntersectionObserver && tapeEl) {
      new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; },
        { threshold: 0.1 }).observe(tapeEl);
    }
    let acc = 0, last = performance.now();
    (function loop(now) {
      const dt = now - last; last = now;
      if (P.tape.playing && onScreen && !document.hidden) {
        acc += dt;
        while (acc > 220) { P.tapeStep(); acc -= 220; }
        P.drawTape();
      }
      requestAnimationFrame(loop);
    })(last);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
