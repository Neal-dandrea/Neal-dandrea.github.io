/* Models page.
 *
 * ⚠️ QUOTED NUMBERS ARE MEASURED, CHARTS ARE ILLUSTRATIVE. The ablation panel
 *    is the exception worth naming. Its in-sample and out-of-sample figures are
 *    real, and the chart plots them rather than a shape chosen to look like
 *    them. Everywhere else the chart shows the form of a tradeoff and the prose
 *    carries whatever was actually measured.
 */
(function () {
  "use strict";

  /* ---------------------------------------------------------------- utils */

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

  const root = document.querySelector(".viz-root") || document.documentElement;
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();

  const SVG_NS = "http://www.w3.org/2000/svg";
  function el(name, attrs, parent) {
    const n = document.createElementNS(SVG_NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }

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
  const hideTip = () => { tip.dataset.open = "false"; };

  function grid(svg, W, H, pad, yr, yfmt, ylab) {
    const faint = cssVar("--ink-faint"), g = cssVar("--grid");
    for (let i = 0; i <= 4; i++) {
      const v = lerp(yr[0], yr[1], i / 4);
      const y = pad.t + (1 - i / 4) * (H - pad.t - pad.b);
      el("line", { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: g }, svg);
      const t = el("text", { x: pad.l - 8, y: y + 4, "text-anchor": "end",
        "font-size": 11, fill: faint }, svg);
      t.textContent = yfmt(v);
    }
    if (ylab) {
      const t = el("text", { x: pad.l, y: pad.t - 9, "font-size": 11, fill: faint }, svg);
      t.textContent = ylab;
    }
  }

  function controls(hostId, label, items, current, onPick, trailing) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.innerHTML = `<span class="control-label">${label}</span>`
      + items.map(([k, l]) =>
        `<button type="button" data-k="${k}" aria-pressed="${k === current()}">${l}</button>`).join("")
      + (trailing ? `<span class="control-label">${trailing}</span>` : "");
    host.querySelectorAll("[data-k]").forEach((b) =>
      b.addEventListener("click", () => {
        onPick(b.dataset.k);
        host.querySelectorAll("[data-k]").forEach((o) =>
          o.setAttribute("aria-pressed", String(o === b)));
      }));
  }

  /* ---------------------------------------------------- 01 model roster -- */

  const ROSTER = [
    {
      key: "sequence", name: "Sequence and vision",
      where: "sensor data, manipulation",
      items: [
        { n: "CNN", d: "feature extraction over sensor windows" },
        { n: "LSTM, packed sequences", d: "variable-length series" },
        { n: "Autoencoder", d: "representation and reconstruction error" },
        { n: "U-Net diffusion policy", d: "manipulation, 171M parameters", shipped: true },
        { n: "Vision transformer", d: "policy backbone for the quantum comparison" },
        { n: "Vision-language-action model", d: "3B parameters, on the arm", shipped: true },
      ],
    },
    {
      key: "classical", name: "Classical and statistical",
      where: "evaluation, finance",
      items: [
        { n: "Ridge regression", d: "the ablation instrument", shipped: true },
        { n: "Mean-predictor baselines", d: "what a result has to beat" },
        { n: "SVI parametric fitting", d: "volatility surfaces", shipped: true },
        { n: "Time-series forecasting", d: "returns and volatility" },
        { n: "Effective sample size", d: "correlation-adjusted evidence" },
      ],
    },
    {
      key: "rl", name: "Reinforcement learning",
      where: "trading environments and robot control",
      items: [
        { n: "PPO", d: "cost-aware reward shaping" },
        { n: "DQN", d: "discrete action comparison" },
        { n: "Matched baselines", d: "identical bars and cost assumptions" },
      ],
    },
    {
      key: "language", name: "Language and retrieval",
      where: "coursework and tooling",
      items: [
        { n: "LoRA and QLoRA", d: "adapters through the HuggingFace trainer" },
        { n: "PEFT", d: "parameter-efficient adaptation" },
        { n: "Retrieval-augmented generation", d: "vector search in Postgres" },
        { n: "Post-training quantization", d: "deployment under a memory budget" },
      ],
    },
    {
      key: "quantum", name: "Quantum",
      where: "parameter-efficiency study",
      items: [
        { n: "Parameterized quantum circuits", d: "attention projections in PennyLane" },
      ],
    },
  ];

  const rosterState = { filter: "all" };

  function renderRoster() {
    const host = document.getElementById("roster-grid");
    if (!host) return;
    host.innerHTML = ROSTER
      .filter((g) => rosterState.filter === "all" || rosterState.filter === g.key)
      .map((g) => `
        <div class="roster-group">
          <h3>${g.name}</h3>
          <span class="where">${g.where}</span>
          <ul>${g.items.map((i) =>
            `<li class="${i.shipped ? "shipped" : ""}" title="${i.d}">${i.n}</li>`).join("")}</ul>
        </div>`).join("");
  }

  function rosterControls() {
    controls("roster-controls", "Family",
      [["all", "All"]].concat(ROSTER.map((g) => [g.key, g.name])),
      () => rosterState.filter,
      (k) => { rosterState.filter = k; renderRoster(); },
      "marked deployed means it ran somewhere real rather than in a notebook");
  }

  /* ------------------------------------------------ 02 sequence models -- */

  const archState = { metric: "error" };

  const ARCHS = [
    { n: "CNN over windows", error: 0.42, params: 0.9, hours: 0.6, c: "--series-1" },
    { n: "LSTM, packed", error: 0.31, params: 1.4, hours: 1.7, c: "--series-2" },
    { n: "Autoencoder, then ridge", error: 0.37, params: 2.1, hours: 1.1, c: "--series-3" },
  ];

  const ARCH_META = {
    error: { label: "held-out error, lower is better", fmt: (v) => v.toFixed(2), max: 0.5 },
    params: { label: "parameters, millions", fmt: (v) => v.toFixed(1) + "M", max: 2.4 },
    hours: { label: "training time, hours", fmt: (v) => v.toFixed(1) + "h", max: 2.0 },
  };

  function drawArch() {
    const svg = document.getElementById("arch-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 330, pad = { l: 190, r: 90, t: 34, b: 30 };
    const m = ARCH_META[archState.metric];
    const X = (v) => pad.l + (v / m.max) * (W - pad.l - pad.r);
    const rowH = (H - pad.t - pad.b) / ARCHS.length;
    const faint = cssVar("--ink-faint");

    const lab = el("text", { x: pad.l, y: pad.t - 12, "font-size": 11, fill: faint }, svg);
    lab.textContent = m.label;

    ARCHS.forEach((a, i) => {
      const y = pad.t + i * rowH + rowH / 2 - 12;
      const t = el("text", { x: pad.l - 14, y: y + 17, "text-anchor": "end",
        "font-size": 12, fill: cssVar("--ink-soft") }, svg);
      t.textContent = a.n;
      const v = a[archState.metric];
      el("rect", { x: pad.l, y, width: Math.max(2, X(v) - pad.l), height: 24, rx: 3,
        fill: cssVar(a.c), opacity: 0.85 }, svg);
      const val = el("text", { x: X(v) + 8, y: y + 17, "font-size": 11.5, fill: faint }, svg);
      val.textContent = m.fmt(v);

      const hit = el("rect", { x: pad.l, y: y - 6, width: W - pad.l - pad.r, height: 36,
        fill: "transparent" }, svg);
      hit.addEventListener("pointermove", (e) => showTip(
        `<strong>${a.n}</strong><br>`
        + `<span class="k">error</span> ${a.error.toFixed(2)}<br>`
        + `<span class="k">parameters</span> ${a.params.toFixed(1)}M<br>`
        + `<span class="k">training</span> ${a.hours.toFixed(1)}h`, e.clientX, e.clientY));
      hit.addEventListener("pointerleave", hideTip);
    });
  }

  /* ------------------------------------------------------- 03 ablation -- */

  /* ⚠️ MEASURED. In-sample rises from 0.0083 to 0.0145 as blocks are added.
     Out of sample falls, and every value measured was negative. Base out of
     sample was -0.00217 and all blocks together -0.00412. */
  const ABL = {
    labels: ["base", "+ temporal", "+ surface", "+ both"],
    inS: [0.0083, 0.0109, 0.0127, 0.0145],
    oos: [-0.00217, -0.00291, -0.00344, -0.00412],
  };
  const ablState = { show: "both" };

  function drawAbl() {
    const svg = document.getElementById("abl-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 320, pad = { l: 72, r: 120, t: 34, b: 44 };
    const yr = [-0.006, 0.016];
    const X = (i) => pad.l + (i / (ABL.labels.length - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - pad.t - pad.b);
    grid(svg, W, H, pad, yr, (v) => v.toFixed(3), "R²");

    el("line", { x1: pad.l, y1: Y(0), x2: W - pad.r, y2: Y(0),
      stroke: cssVar("--muted-mark"), "stroke-width": 1 }, svg);
    const zl = el("text", { x: W - pad.r + 8, y: Y(0) + 4, "font-size": 11,
      fill: cssVar("--ink-faint") }, svg);
    zl.textContent = "zero";

    ABL.labels.forEach((l, i) => {
      const t = el("text", { x: X(i), y: H - pad.b + 18, "text-anchor": "middle",
        "font-size": 11, fill: cssVar("--ink-faint") }, svg);
      t.textContent = l;
    });

    const series = [
      { k: "inS", name: "in sample", c: cssVar("--series-2") },
      { k: "oos", name: "out of sample", c: cssVar("--series-1") },
    ];
    series.forEach((s) => {
      if (ablState.show !== "both" && ablState.show !== s.k) return;
      const pts = ABL[s.k];
      el("path", { d: pts.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join(""),
        fill: "none", stroke: s.c, "stroke-width": 2 }, svg);
      pts.forEach((v, i) => {
        el("circle", { cx: X(i), cy: Y(v), r: 4, fill: s.c }, svg);
        const hit = el("circle", { cx: X(i), cy: Y(v), r: 14, fill: "transparent" }, svg);
        hit.addEventListener("pointermove", (e) => showTip(
          `<strong>${ABL.labels[i]}</strong><br>`
          + `<span class="k">${s.name}</span> ${v.toFixed(5)}`, e.clientX, e.clientY));
        hit.addEventListener("pointerleave", hideTip);
      });
      const t = el("text", { x: W - pad.r + 8, y: Y(pts[pts.length - 1]) + 4,
        "font-size": 11.5, fill: s.c }, svg);
      t.textContent = s.name;
    });

    const note = el("text", { x: pad.l, y: H - 10, "font-size": 11,
      fill: cssVar("--ink-faint") }, svg);
    note.textContent = "feature blocks added →   measured, not illustrative";
  }

  /* ------------------------------------------------------------- 04 RL -- */

  const rlState = { costs: true };

  function drawRl() {
    const svg = document.getElementById("rl-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 320, pad = { l: 66, r: 140, t: 34, b: 40 };
    const r = rng(rlState.costs ? 11 : 12);
    const n = 60;
    const yr = [-10, 70];
    const X = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - pad.t - pad.b);
    grid(svg, W, H, pad, yr, (v) => v.toFixed(0) + "%", "cumulative return over the episode");

    const hold = 24;
    el("line", { x1: pad.l, y1: Y(hold), x2: W - pad.r, y2: Y(hold),
      stroke: cssVar("--muted-mark"), "stroke-width": 1, "stroke-dasharray": "4 4" }, svg);
    const hl = el("text", { x: W - pad.r + 8, y: Y(hold) + 4, "font-size": 11.5,
      fill: cssVar("--ink-faint") }, svg);
    hl.textContent = "buy and hold";

    const agent = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const target = rlState.costs ? hold + 1.5 : 62;
      agent.push(target * (1 - Math.exp(-3.2 * t)) + gauss(r) * 3.2 - (rlState.costs ? 4 : 0));
    }
    el("path", { d: agent.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join(""),
      fill: "none", stroke: cssVar("--series-1"), "stroke-width": 2 }, svg);
    const al = el("text", { x: W - pad.r + 8, y: Y(agent[n - 1]) + 4, "font-size": 11.5,
      fill: cssVar("--series-1") }, svg);
    al.textContent = rlState.costs ? "agent, costs charged" : "agent, costs ignored";

    const note = el("text", { x: pad.l, y: H - 10, "font-size": 11,
      fill: cssVar("--ink-faint") }, svg);
    note.textContent = rlState.costs
      ? "training episodes →   it converges on roughly holding, which is the honest answer here"
      : "training episodes →   this is what a strategy looks like when nobody charges it for trading";
  }

  /* ----------------------------------------------------------- 05 PEFT -- */

  const peftState = { rank: 16 };
  const RANKS = [4, 8, 16, 32, 64];

  function drawPeft() {
    const svg = document.getElementById("peft-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 320, pad = { l: 70, r: 130, t: 34, b: 44 };
    const X = (i) => pad.l + (i / (RANKS.length - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);
    grid(svg, W, H, pad, [0, 1], (v) => (v * 100).toFixed(0) + "%",
      "relative to full fine tuning");

    const quality = RANKS.map((r) => 0.62 + 0.34 * (1 - Math.exp(-r / 12)));
    const memory = RANKS.map((r) => 0.04 + 0.5 * (r / 64));

    [[quality, "task quality", "--series-1"], [memory, "trainable parameters and memory", "--series-2"]]
      .forEach(([pts, name, c]) => {
        el("path", { d: pts.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join(""),
          fill: "none", stroke: cssVar(c), "stroke-width": 2 }, svg);
        pts.forEach((v, i) => el("circle", { cx: X(i), cy: Y(v), r: 3.5, fill: cssVar(c) }, svg));
        const t = el("text", { x: W - pad.r + 8, y: Y(pts[pts.length - 1]) + 4,
          "font-size": 11.5, fill: cssVar(c) }, svg);
        t.textContent = name;
      });

    RANKS.forEach((r, i) => {
      const on = r === peftState.rank;
      const t = el("text", { x: X(i), y: H - pad.b + 18, "text-anchor": "middle",
        "font-size": 11, fill: on ? cssVar("--accent") : cssVar("--ink-faint") }, svg);
      t.textContent = "r=" + r;
      if (on) {
        el("line", { x1: X(i), y1: pad.t, x2: X(i), y2: H - pad.b,
          stroke: cssVar("--accent"), "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
      }
    });

    const i = RANKS.indexOf(peftState.rank);
    const note = el("text", { x: pad.l, y: H - 12, "font-size": 11,
      fill: cssVar("--ink-faint") }, svg);
    note.textContent = `at rank ${peftState.rank}, quality ${(quality[i] * 100).toFixed(0)}% `
      + `for ${(memory[i] * 100).toFixed(0)}% of the cost`;
  }

  /* ------------------------------------------------------------ 06 RAG -- */

  const ragState = { chunk: 512 };
  const CHUNKS = [128, 256, 512, 1024, 2048];

  function drawRag() {
    const svg = document.getElementById("rag-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 320, pad = { l: 70, r: 150, t: 34, b: 44 };
    const X = (i) => pad.l + (i / (CHUNKS.length - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - v) * (H - pad.t - pad.b);
    grid(svg, W, H, pad, [0, 1], (v) => (v * 100).toFixed(0) + "%", "score");

    // Retrieval precision falls as chunks grow. Answer accuracy needs enough
    // context to be useful and then drowns in the irrelevant.
    const retrieval = CHUNKS.map((c) => clamp(0.95 - 0.16 * Math.log2(c / 128), 0, 1));
    const answer = CHUNKS.map((c) => {
      const x = Math.log2(c / 128);
      return clamp(0.5 + 0.34 * Math.exp(-Math.pow((x - 2) / 1.5, 2)), 0, 1);
    });

    [[retrieval, "retrieval precision", "--series-2"], [answer, "answer accuracy", "--series-1"]]
      .forEach(([pts, name, c]) => {
        el("path", { d: pts.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join(""),
          fill: "none", stroke: cssVar(c), "stroke-width": 2 }, svg);
        pts.forEach((v, i) => el("circle", { cx: X(i), cy: Y(v), r: 3.5, fill: cssVar(c) }, svg));
        const t = el("text", { x: W - pad.r + 8, y: Y(pts[pts.length - 1]) + 4,
          "font-size": 11.5, fill: cssVar(c) }, svg);
        t.textContent = name;
      });

    CHUNKS.forEach((c, i) => {
      const on = c === ragState.chunk;
      const t = el("text", { x: X(i), y: H - pad.b + 18, "text-anchor": "middle",
        "font-size": 11, fill: on ? cssVar("--accent") : cssVar("--ink-faint") }, svg);
      t.textContent = c;
      if (on) el("line", { x1: X(i), y1: pad.t, x2: X(i), y2: H - pad.b,
        stroke: cssVar("--accent"), "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
    });

    const note = el("text", { x: pad.l, y: H - 12, "font-size": 11,
      fill: cssVar("--ink-faint") }, svg);
    note.textContent = "chunk size in tokens →   the two curves do not peak in the same place";
  }

  /* -------------------------------------------------------- 07 signals -- */

  function renderSignals() {
    const host = document.getElementById("signals-fig");
    if (!host) return;
    const rows = [
      { who: "setting the model was built around", lo: 0.88, hi: 0.94 },
      { who: "adjacent population", lo: 0.79, hi: 0.91 },
      { who: "hospital setting", lo: 0.66, hi: 0.90 },
      { who: "pregnancy-related care", lo: 0.71, hi: 0.93 },
    ];
    host.innerHTML = '<div class="signal-bars">' + rows.map((r) => {
      const mid = (r.lo + r.hi) / 2;
      return `<div class="signal-row">
        <span class="who">${r.who}</span>
        <span class="track">
          <span class="band" style="left:${r.lo * 100}%;width:${(r.hi - r.lo) * 100}%"></span>
          <span class="mid" style="left:${mid * 100}%"></span>
        </span>
        <span class="num">${(mid * 100).toFixed(0)}%</span>
      </div>`;
    }).join("")
    + '</div><p style="margin:0.8rem 0 0;font-size:0.88rem;color:var(--ink-soft)">'
    + 'The chart is illustrative, and the averages are close enough to look '
    + 'interchangeable. The '
    + 'spread is not, and the spread is what decides whether a claim about '
    + 'adaptability holds.</p>';
  }

  /* -------------------------------------------------------------- wiring */

  function drawAll() {
    renderRoster();
    drawArch();
    drawAbl();
    drawRl();
    drawPeft();
    drawRag();
    renderSignals();
  }

  (function spy() {
    const links = Array.prototype.slice.call(
      document.querySelectorAll('nav.sections a[href^="#"]'));
    if (!links.length) return;
    const targets = links.map((a) => ({
      li: a.parentElement, el: document.getElementById(a.hash.slice(1)),
    })).filter((t) => t.el);
    let queued = false;
    function mark() {
      queued = false;
      const line = window.innerHeight * 0.32;
      let best = null;
      targets.forEach((t) => {
        if (t.el.getBoundingClientRect().top <= line) best = t;
      });
      if (!best) best = targets[0];
      targets.forEach((t) => t.li.classList.toggle("here", t === best));
    }
    window.addEventListener("scroll", () => {
      if (!queued) { queued = true; requestAnimationFrame(mark); }
    }, { passive: true });
    window.addEventListener("resize", mark);
    mark();
  })();

  function init() {
    rosterControls();
    controls("arch-controls", "Compare on",
      [["error", "Held-out error"], ["params", "Parameters"], ["hours", "Training time"]],
      () => archState.metric,
      (k) => { archState.metric = k; drawArch(); },
      "the LSTM wins on the only axis the problem cared about");
    controls("abl-controls", "Show",
      [["both", "Both"], ["inS", "In sample"], ["oos", "Out of sample"]],
      () => ablState.show,
      (k) => { ablState.show = k; drawAbl(); });
    controls("rl-controls", "Transaction costs",
      [["on", "Charged"], ["off", "Ignored"]],
      () => (rlState.costs ? "on" : "off"),
      (k) => { rlState.costs = k === "on"; drawRl(); });
    controls("peft-controls", "Adapter rank",
      RANKS.map((r) => [String(r), "r=" + r]),
      () => String(peftState.rank),
      (k) => { peftState.rank = parseInt(k, 10); drawPeft(); });
    controls("rag-controls", "Chunk size",
      CHUNKS.map((c) => [String(c), String(c)]),
      () => String(ragState.chunk),
      (k) => { ragState.chunk = parseInt(k, 10); drawRag(); },
      "tokens");
    drawAll();

    let t = null;
    window.addEventListener("resize", () => {
      clearTimeout(t); t = setTimeout(drawAll, 150);
    });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    (mq.addEventListener ? mq.addEventListener.bind(mq, "change")
                         : mq.addListener.bind(mq))(drawAll);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
