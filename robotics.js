/* Robot learning page.
 *
 * ⚠️ FIGURES ARE RECONSTRUCTIONS, NUMBERS ARE MEASURED. Nothing here reads a
 *    log or a video. Every curve and trajectory is generated in the browser to
 *    show a mechanism, because the lab's data is not mine to publish. Where the
 *    prose quotes a figure, that figure came out of the work.
 *
 * Utilities are duplicated from platform.js rather than shared. That is a wart
 * and it is deliberate for now, because factoring them out means touching a
 * page that already works to fix a problem nobody has.
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
  const ease = (u) => u * u * (3 - 2 * u);            // smooth at both ends

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

  /* ⚠️ A DRAWING AUTHORED AT A FIXED SIZE NEEDS A PROPORTIONAL BOX. Both plate
     drawings are laid out at 720 wide and scale x by the canvas width, so
     holding the height at a constant number of pixels crops the bottom of the
     frame off at any width above 720. The bench line, the base and the counters
     were all being drawn below the visible area. Pass the authored size and the
     canvas takes the matching height. */
  function fitAspect(canvas, authoredW, authoredH) {
    const w = canvas.clientWidth || authoredW;
    return fitCanvas(canvas, Math.round(w * authoredH / authoredW));
  }

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

  function axes(svg, W, H, pad, yr, yfmt, ylab) {
    const faint = cssVar("--ink-faint"), grid = cssVar("--grid");
    for (let i = 0; i <= 4; i++) {
      const v = lerp(yr[0], yr[1], i / 4);
      const y = pad.t + (1 - i / 4) * (H - pad.t - pad.b);
      el("line", { x1: pad.l, y1: y, x2: W - pad.r, y2: y, stroke: grid, "stroke-width": 1 }, svg);
      const t = el("text", { x: pad.l - 8, y: y + 4, "text-anchor": "end",
        "font-size": 11, fill: faint }, svg);
      t.textContent = yfmt(v);
    }
    if (ylab) {
      const t = el("text", { x: pad.l, y: pad.t - 8, "font-size": 11, fill: faint }, svg);
      t.textContent = ylab;
    }
  }

  /* ------------------------------------------------------------- the arm --

     A drawn schematic rather than a chart, because the subject is hardware and
     a reader should be able to see the thing being described. It is a planar
     four-link stand-in for a seven-axis arm, posed by inverse kinematics onto a
     reach point, with the wrist camera and its field of view drawn on.

     Not a rendering. The proportions are a sketch, the joint count is reduced
     so the linkage is legible, and every annotation on it is a real number from
     the work. */

  /* ⚠️ THE TARGET HAS TO BE INSIDE THE REACH. The first version put the
     handover path 408 units from a base with 300 units of link, so the solver
     did the only thing it could and stretched every joint straight at it. The
     drawing was a stick. Link lengths sum to 314 and the path sits between 199
     and 297 away, which keeps the elbow bent through the whole sweep. */
  /* Five segments rather than four, laid out closer to the real proportions.
     An FR3 in side view reads as a base column, an upper arm, a forearm, a
     short wrist and the hand, and giving each of those its own segment is what
     makes the silhouette recognisable rather than generic.

     Link widths taper the way the real arm does, which matters more to whether
     it looks like an arm than the joint count does. */
  const ARM = {
    base: { x: 150, y: 300 },
    links: [64, 96, 86, 42, 34],
    widths: [17, 15, 13, 11, 9],
    camFov: 0.72,
  };

  /* Cyclic coordinate descent. Simple, converges fast enough to run on every
     frame of a drag, and needs no Jacobian. */
  function poseArm(target, seedAngles, base) {
    base = base || ARM.base;
    const a = seedAngles.slice();
    const fk = (angles) => {
      const pts = [{ x: base.x, y: base.y }];
      let th = 0;
      angles.forEach((d, i) => {
        th += d;
        pts.push({
          x: pts[i].x + Math.cos(th) * ARM.links[i],
          y: pts[i].y + Math.sin(th) * ARM.links[i],
        });
      });
      return pts;
    };
    for (let iter = 0; iter < 24; iter++) {
      for (let j = a.length - 1; j >= 0; j--) {
        const pts = fk(a);
        const piv = pts[j], end = pts[pts.length - 1];
        const a1 = Math.atan2(end.y - piv.y, end.x - piv.x);
        const a2 = Math.atan2(target.y - piv.y, target.x - piv.x);
        let d = a2 - a1;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        a[j] += clamp(d, -0.35, 0.35);
      }
    }
    return { angles: a, pts: fk(a) };
  }

  /* Two arms now, because handover is two of them and a sketch of a second one
     was not carrying its half of the idea.

     ⚠️ THE PATH HAS TO BE INSIDE BOTH REACHES, which is a tighter constraint
     than one arm. Bases are 470 apart and each reaches 322, so the overlap is a
     lens in the middle, and the path runs from 415,155 to 355,205, which sits
     inside it end to end. Move either base or either endpoint without checking
     and one of the two arms starts stretching straight at a point it cannot
     get to, which is the failure this plate had on its first day. */
  const ARM_B = { base: { x: 620, y: 300 }, seed: [-1.85, -0.55, -0.62, -0.3, -0.1] };

  /* The handover as a sequence rather than as one frozen instant.

     Posing both arms onto the object at every slider position left the two
     hands welded together for the whole sweep, which is the one thing a
     handover is not. The giving arm now carries the object in from its own
     side, the two meet, it releases, and it withdraws, so the drawing shows
     the approach and the separation that make it a handover.

     ⚠️ ALL THREE POINTS HAVE TO BE INSIDE THE REACH THAT USES THEM. Links sum
     to 322 and the bases are 470 apart. meet is 264 from both bases, giver is
     192 from the giving base, taker is 175 from the receiving base. Move any
     of them without redoing that arithmetic and the solver stretches a joint
     straight at a point it cannot get to, which is how this plate broke the
     first time. */
  const SEQ = {
    meet:  { x: 385, y: 180 },   // where the two hands come together
    giver: { x: 500, y: 150 },   // where the giving arm starts and returns to
    taker: { x: 300, y: 210 },   // where the receiving arm waits before closing in
    closed: 0.42,                // the hands have met
    released: 0.58,              // the giving arm has let go
  };

  const mix = (p, q, u) => ({ x: lerp(p.x, q.x, u), y: lerp(p.y, q.y, u) });

  const heroState = { t: 0.55, seed: [-1.35, 0.55, 0.62, 0.3, 0.1] };

  function drawArmPlate() {
    const canvas = document.getElementById("arm-canvas");
    if (!canvas) return;
    const { ctx, w, h } = fitAspect(canvas, 720, 380);
    ctx.clearRect(0, 0, w, h);

    const S = w / 720;                        // the drawing is authored at 720
    const sx = (x) => x * S, sy = (y) => y * S;

    const ink = cssVar("--ink"), soft = cssVar("--ink-soft"),
          faint = cssVar("--ink-faint"), rule = cssVar("--rule"),
          accent = cssVar("--accent"), blue = cssVar("--series-1");

    const mono = (px) => `${px * S}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

    /* Where everything is at this point in the sequence. The object rides with
       the giving arm until the release, and with the receiving arm after it. */
    const t = heroState.t;
    const inbound = ease(clamp(t / SEQ.closed, 0, 1));
    const outbound = ease(clamp((t - SEQ.released) / (1 - SEQ.released), 0, 1));

    const object = mix(SEQ.giver, SEQ.meet, inbound);
    const target = mix(SEQ.taker, SEQ.meet, inbound);   // the receiving hand
    const sol = poseArm(target, heroState.seed);
    const pts = sol.pts;

    // The receiving hand closes as it arrives, the giving hand opens to let go.
    const gripA = clamp((t - SEQ.closed) / (SEQ.released - SEQ.closed), 0, 1);
    const gripB = 1 - gripA;

    /* ---- the table, with a thickness rather than a single line ---------- */
    ctx.fillStyle = cssVar("--surface-panel");
    ctx.strokeStyle = rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(sx(40), sy(340), sx(650), sy(9));
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = faint;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.moveTo(sx(46 + i * 25), sy(349));
      ctx.lineTo(sx(40 + i * 25), sy(358));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    /* ---- capsules and housings ------------------------------------------

       An outlined capsule rather than a stick. Stroke once fat in the outline
       colour and once thinner in the body colour, which gives a filled link
       with a clean edge and costs one path. A stick reads as a linkage
       diagram. This reads as a robot, and the difference is most of what the
       plate is for. */
    const capsule = (a, b, halfW, body, edge) => {
      ctx.lineCap = "round";
      ctx.strokeStyle = edge;
      ctx.lineWidth = (halfW * 2 + 2) * S;
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sy(a.y)); ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
      ctx.strokeStyle = body;
      ctx.lineWidth = halfW * 2 * S;
      ctx.beginPath();
      ctx.moveTo(sx(a.x), sy(a.y)); ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
    };

    const body = cssVar("--surface-panel"), edge = ink, band = soft;

    /* One arm, given its solved points. Both arms are the same machine, so the
       drawing is the same code, and the second one is drawn faintly because a
       page with two equally loud robots on it has no subject. */
    function drawArm(pts, base, dim, grip) {
      const a = dim ? 0.45 : 1;
      // 1 is closed on the object, 0 is open and clear of it.
      const span = 13 - 4 * clamp(grip === undefined ? 1 : grip, 0, 1);
      ctx.globalAlpha = a;

      // Pedestal, two stacked cylinders, the way the arm is actually mounted.
      capsule({ x: base.x, y: 338 }, { x: base.x, y: 318 }, 26, body, edge);
      capsule({ x: base.x, y: 322 }, { x: base.x, y: 306 }, 19, body, edge);

      ctx.lineCap = "round";
      for (let i = 0; i < pts.length - 1; i++) {
        capsule(pts[i], pts[i + 1], ARM.widths[i] / 2, body, edge);
      }

      // Joint housings, drawn across the link rather than along it, which is
      // what makes the elbow look like an elbow.
      pts.slice(0, -1).forEach((p, i) => {
        const nxt = pts[i + 1];
        const ang = Math.atan2(nxt.y - p.y, nxt.x - p.x);
        const hw = ARM.widths[i] / 2 + 2.5;
        const ux = Math.cos(ang + Math.PI / 2), uy = Math.sin(ang + Math.PI / 2);
        capsule({ x: p.x - ux * hw * 0.55, y: p.y - uy * hw * 0.55 },
                { x: p.x + ux * hw * 0.55, y: p.y + uy * hw * 0.55 }, hw, body, edge);
        ctx.strokeStyle = band;
        ctx.globalAlpha = a * 0.5;
        ctx.lineWidth = 1.6 * S;
        ctx.beginPath();
        ctx.arc(sx(p.x), sy(p.y), hw * 0.62 * S, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = a;
      });

      // The hand, drawn BACK from the solved point by its own length, so the
      // fingertips land on the object rather than reaching past it.
      const tipL = pts[pts.length - 1], wristL = pts[pts.length - 2];
      const thL = Math.atan2(tipL.y - wristL.y, tipL.x - wristL.x);
      const nxL = -Math.sin(thL), nyL = Math.cos(thL);
      const alongL = (p, d) => ({ x: p.x + Math.cos(thL) * d, y: p.y + Math.sin(thL) * d });
      const HAND = 33;
      const hbL = alongL(tipL, -HAND);

      capsule(alongL(hbL, -2), alongL(hbL, 4), 11, body, edge);
      capsule(alongL(hbL, 4), alongL(hbL, 15), 9, body, edge);
      capsule({ x: hbL.x + Math.cos(thL) * 15 + nxL * (span + 1), y: hbL.y + Math.sin(thL) * 15 + nyL * (span + 1) },
              { x: hbL.x + Math.cos(thL) * 15 - nxL * (span + 1), y: hbL.y + Math.sin(thL) * 15 - nyL * (span + 1) },
              3, body, edge);
      [-1, 1].forEach((sgn) => {
        const root = { x: hbL.x + Math.cos(thL) * 15 + nxL * span * sgn,
                       y: hbL.y + Math.sin(thL) * 15 + nyL * span * sgn };
        capsule(root, alongL(root, 18), 3, body, edge);
        ctx.strokeStyle = band;
        ctx.lineWidth = 2 * S;
        ctx.beginPath();
        ctx.moveTo(sx(root.x - nxL * 2.5 * sgn + Math.cos(thL) * 6),
                   sy(root.y - nyL * 2.5 * sgn + Math.sin(thL) * 6));
        ctx.lineTo(sx(root.x - nxL * 2.5 * sgn + Math.cos(thL) * 16),
                   sy(root.y - nyL * 2.5 * sgn + Math.sin(thL) * 16));
        ctx.stroke();
      });

      ctx.globalAlpha = 1;
      return { tip: tipL, th: thL, nx: nxL, ny: nyL, hb: hbL };
    }

    /* The giving arm holds the object from its own side rather than reaching
       the identical point, or the two hands occupy the same space and the
       drawing turns into one knot. Its target is the object, pulled 17 units
       back along the line to its own base. */
    const holdB = (p) => {
      const dx = ARM_B.base.x - p.x, dy = ARM_B.base.y - p.y;
      const n = Math.hypot(dx, dy) || 1;
      return { x: p.x + dx / n * 17, y: p.y + dy / n * 17 };
    };
    // Carrying the object in, then backing off to where it started.
    const targetB = outbound > 0
      ? mix(holdB(SEQ.meet), holdB(SEQ.giver), outbound)
      : holdB(object);

    const solB = poseArm(targetB, ARM_B.seed, ARM_B.base);
    drawArm(solB.pts, ARM_B.base, true, gripB);
    const handA = drawArm(pts, ARM.base, false, gripA);
    const tip = handA.tip, th = handA.th, nx = handA.nx, ny = handA.ny, hb = handA.hb;

    // Wrist camera and its cone.
    /* The camera sits on the far side of the hand and BEHIND the fingers, on
       the hand body where it actually mounts. Forward of the fingers it landed
       on the object and inside the tolerance ring, which is both wrong and
       unreadable. From back here the cone opens along the tool axis and
       contains the grasp, which is what a wrist camera is for. */
    const camAt = { x: hb.x + Math.cos(th) * 7 - nx * 14,
                    y: hb.y + Math.sin(th) * 7 - ny * 14 };
    ctx.fillStyle = blue;
    ctx.beginPath();
    ctx.arc(sx(camAt.x), sy(camAt.y), 4 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    ctx.moveTo(sx(camAt.x), sy(camAt.y));
    ctx.lineTo(sx(camAt.x + Math.cos(th - ARM.camFov / 2) * 150),
               sy(camAt.y + Math.sin(th - ARM.camFov / 2) * 150));
    ctx.lineTo(sx(camAt.x + Math.cos(th + ARM.camFov / 2) * 150),
               sy(camAt.y + Math.sin(th + ARM.camFov / 2) * 150));
    ctx.closePath();
    ctx.fillStyle = blue;
    ctx.fill();
    ctx.globalAlpha = 1;

    // The object, and the grasp tolerance drawn to the same scale.
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(sx(object.x), sy(object.y), 6 * S, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([3 * S, 3 * S]);
    ctx.beginPath();
    ctx.arc(sx(object.x), sy(object.y), 17 * S, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // The handover path the object is traveling along.
    ctx.strokeStyle = faint;
    ctx.setLineDash([2 * S, 4 * S]);
    ctx.beginPath();
    ctx.moveTo(sx(SEQ.giver.x), sy(SEQ.giver.y));
    ctx.lineTo(sx(SEQ.meet.x), sy(SEQ.meet.y));
    ctx.stroke();
    ctx.setLineDash([]);


    // ---- annotation, in the drafting register
    ctx.font = mono(9.5);
    ctx.fillStyle = faint;

    function leader(x1, y1, x2, y2, text, align) {
      ctx.strokeStyle = faint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx(x1), sy(y1));
      ctx.lineTo(sx(x2), sy(y2));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx(x1), sy(y1), 1.6 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = align || "left";
      ctx.fillText(text, sx(x2 + (align === "right" ? -4 : 4)), sy(y2 + 3));
      ctx.textAlign = "left";
    }

    leader(camAt.x, camAt.y, 250, 78, "WRIST CAMERA");
    leader(object.x, object.y - 17, 450, 64, "GRASP TOLERANCE 30 MM");
    leader(pts[1].x, pts[1].y, 54, 196, "7 AXES, SHOWN AS 5", "left");
    leader(ARM_B.base.x - 36, 240, 700, 276, "SECOND ARM, GIVING", "right");
    leader(ARM.base.x, 322, 232, 366, "IMPEDANCE CONTROL 1 KHZ");

    ctx.textAlign = "right";
    ctx.fillText("POLICY INFERENCE 125 MS", sx(700), sy(30));
    ctx.fillText("ACTION CHUNK, SUBSAMPLED", sx(700), sy(44));
    ctx.textAlign = "left";
  }

  function heroControls() {
    const host = document.getElementById("arm-controls");
    if (!host) return;
    host.innerHTML = '<span class="control-label">Handover</span>'
      + '<input type="range" id="arm-slide" min="0" max="100" value="55" '
      + 'aria-label="Position along the handover path">'
      + '<span class="control-label" id="arm-read"></span>';
    const slide = document.getElementById("arm-slide");
    const read = document.getElementById("arm-read");
    const upd = () => {
      heroState.t = slide.value / 100;
      const t = heroState.t;
      read.textContent = t < 0.42 ? "the giving arm brings it in"
        : t < 0.58 ? "both hands on it"
        : t < 0.9 ? "released, and backing off"
        : "clear, and the object has changed hands";
      drawArmPlate();
    };
    slide.addEventListener("input", upd);
    upd();
  }

  /* ------------------------------------------------------- 01 the problem */

  function renderStats() {
    const host = document.getElementById("stat-row");
    if (!host) return;
    // A specification table rather than stat tiles. The finance page uses
    // tiles, and this page should not look like that page.
    host.className = "spec";
    host.innerHTML = [
      ["Demonstrations", "collected by hand, handheld gripper", "215"],
      ["Frames", "after per-step validation", "265,000"],
      ["Policy", "vision-language-action, on the arm", "3B params"],
      ["Inference", "on a workstation GPU", "125 ms"],
      ["Controller", "Cartesian impedance", "1 kHz"],
      ["Tolerance", "grasp, on the target object", "30 mm"],
    ].map(([k, v, n]) => `
      <div class="spec-row">
        <span class="k">${k}</span>
        <span class="v">${v}</span>
        <span class="n">${n}</span>
      </div>`).join("");
  }

  function renderConstraints() {
    const host = document.getElementById("constraints");
    if (!host) return;
    host.innerHTML = `
      <dl class="constraint-list">
        <div><dt>No operator</dt>
          <dd>Nobody can step in and re-seat a grasp that went wrong.</dd></div>
        <div><dt>Latency</dt>
          <dd>Teleoperation is not available at the moment it would be needed.</dd></div>
        <div><dt>Power and compute</dt>
          <dd>A workstation GPU is not a spacecraft budget.</dd></div>
        <div><dt>Almost no data</dt>
          <dd>You cannot collect a thousand demonstrations in the environment
              you actually care about.</dd></div>
        <div><dt>Failure is expensive</dt>
          <dd>A dropped object does not fall to the floor and wait.</dd></div>
        <div><dt>Contact is unavoidable</dt>
          <dd>Handover is a contact task, so stiff position control is the wrong
              instrument.</dd></div>
      </dl>`;
  }

  /* ---------------------------------------------- 03 the model change ---- */

  const modelState = { view: "both" };

  function drawModel() {
    const canvas = document.getElementById("model-canvas");
    if (!canvas) return;
    const { ctx, w, h } = fitCanvas(canvas, 300);
    ctx.clearRect(0, 0, w, h);

    // Illustrative. Both policies are strong in distribution. The 171M policy
    // falls away where the object starts outside what the demonstrations cover.
    const rows = [
      { name: "171M diffusion policy", inD: 0.86, ood: 0.24, c: cssVar("--muted-mark") },
      { name: "3B vision-language-action", inD: 0.88, ood: 0.67, c: cssVar("--series-1") },
    ];
    const padL = 210, padR = 70, padT = 46, padB = 34;
    const barH = 20, groupGap = 54;
    const X = (v) => padL + v * (w - padL - padR);

    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = cssVar("--ink-faint");
    ctx.fillText("success rate, illustrative", padL, 20);

    let y = padT;
    rows.forEach((r) => {
      const show = [];
      if (modelState.view !== "ood") show.push({ k: "in distribution", v: r.inD, alpha: 0.45 });
      if (modelState.view !== "id") show.push({ k: "out of distribution", v: r.ood, alpha: 1 });

      ctx.fillStyle = cssVar("--ink-soft");
      ctx.textAlign = "right";
      ctx.fillText(r.name, padL - 14, y + 14);
      ctx.textAlign = "left";

      show.forEach((s, i) => {
        const yy = y + i * (barH + 8);
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = r.c;
        ctx.beginPath();
        ctx.roundRect(padL, yy, Math.max(2, X(s.v) - padL), barH, [0, 3, 3, 0]);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = cssVar("--ink-faint");
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(`${(s.v * 100).toFixed(0)}%  ${s.k}`, X(s.v) + 8, yy + 14);
        ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      });
      y += show.length * (barH + 8) + groupGap - 20;
    });

    ctx.strokeStyle = cssVar("--grid");
    ctx.beginPath();
    ctx.moveTo(padL, padT - 10);
    ctx.lineTo(padL, h - padB);
    ctx.stroke();
  }

  function modelControls() {
    const host = document.getElementById("model-controls");
    if (!host) return;
    host.innerHTML = '<span class="control-label">Show</span>'
      + [["both", "Both"], ["id", "In distribution"], ["ood", "Out of distribution"]]
        .map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${k === modelState.view}">${l}</button>`).join("");
    host.querySelectorAll("[data-v]").forEach((b) =>
      b.addEventListener("click", () => {
        modelState.view = b.dataset.v;
        host.querySelectorAll("[data-v]").forEach((o) =>
          o.setAttribute("aria-pressed", String(o === b)));
        drawModel();
      }));
  }

  /* ------------------------------------------------ 04 the control loop -- */

  const loopState = { chunk: 16, playing: true, t: 0 };

  function drawLoop() {
    const canvas = document.getElementById("loop-canvas");
    if (!canvas) return;
    const { ctx, w, h } = fitCanvas(canvas, 260);
    ctx.clearRect(0, 0, w, h);
    const faint = cssVar("--ink-faint"), rule = cssVar("--rule"),
          accent = cssVar("--accent"), s1 = cssVar("--series-1");

    const padL = 120, padR = 20;
    const span = w - padL - padR;
    const WINDOW_MS = 500;
    const X = (ms) => padL + (ms / WINDOW_MS) * span;

    ctx.font = "11.5px ui-sans-serif, system-ui, sans-serif";
    const lanes = [
      { y: 44, name: "inference" },
      { y: 104, name: "action chunk" },
      { y: 164, name: "controller" },
    ];
    lanes.forEach((L) => {
      ctx.fillStyle = faint;
      ctx.textAlign = "right";
      ctx.fillText(L.name, padL - 12, L.y + 5);
      ctx.textAlign = "left";
      ctx.strokeStyle = rule;
      ctx.beginPath();
      ctx.moveTo(padL, L.y + 16.5);
      ctx.lineTo(w - padR, L.y + 16.5);
      ctx.stroke();
    });

    // Inference blocks of 125 ms, each producing a chunk the client pays out.
    for (let start = 0; start < WINDOW_MS; start += 125) {
      ctx.fillStyle = s1;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.roundRect(X(start), lanes[0].y, X(125) - X(0) - 4, 16, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = cssVar("--paper");
      ctx.fillText("125 ms", X(start) + 8, lanes[0].y + 12);

      // The chunk lands one inference later and is spent over the next window.
      const cs = start + 125;
      if (cs < WINDOW_MS) {
        for (let i = 0; i < loopState.chunk; i++) {
          const x = X(cs + (i / loopState.chunk) * 125);
          ctx.fillStyle = accent;
          ctx.globalAlpha = 0.75;
          ctx.fillRect(x, lanes[1].y + 2, Math.max(1.5, (X(125) - X(0)) / loopState.chunk - 2), 12);
          ctx.globalAlpha = 1;
        }
      }
    }

    // The controller runs regardless, interpolating between commanded points.
    ctx.strokeStyle = faint;
    ctx.globalAlpha = 0.5;
    for (let ms = 0; ms < WINDOW_MS; ms += 4) {
      const x = X(ms);
      ctx.beginPath();
      ctx.moveTo(x, lanes[2].y + 4);
      ctx.lineTo(x, lanes[2].y + 14);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = faint;
    ctx.fillText("1 kHz, every millisecond, drawn every fourth", padL, lanes[2].y + 34);
    ctx.fillText(`${loopState.chunk} actions per chunk, subsampled and rate limited`, padL, lanes[1].y + 34);
    ctx.fillText("0 ms", padL, h - 10);
    ctx.textAlign = "right";
    ctx.fillText("500 ms", w - padR, h - 10);
    ctx.textAlign = "left";
  }

  function loopControls() {
    const host = document.getElementById("loop-controls");
    if (!host) return;
    host.innerHTML = '<span class="control-label">Actions per chunk</span>'
      + [8, 16, 32].map((n) =>
        `<button type="button" data-c="${n}" aria-pressed="${n === loopState.chunk}">${n}</button>`).join("")
      + '<span class="control-label">a longer chunk rides through a slow inference and reacts later</span>';
    host.querySelectorAll("[data-c]").forEach((b) =>
      b.addEventListener("click", () => {
        loopState.chunk = parseInt(b.dataset.c, 10);
        host.querySelectorAll("[data-c]").forEach((o) =>
          o.setAttribute("aria-pressed", String(o === b)));
        drawLoop();
      }));
  }

  window.__robotics = { rng, gauss, clamp, lerp, ease, cssVar, el, clear, showTip,
    hideTip, fitCanvas, fitAspect, axes, renderStats, renderConstraints,
    drawModel, modelControls, drawLoop, loopControls,
    drawArmPlate, heroControls, poseArm, ARM };
})();

/* ---------------------------------------------------------------------- */
(function () {
  "use strict";
  const R = window.__robotics;
  const { rng, gauss, clamp, lerp, ease, cssVar, el, clear, showTip, hideTip,
          fitCanvas, fitAspect, axes } = R;

  /* ------------------------------------------------ 02 the pipeline, moving

     The plate used to be five labeled boxes with arrows, which says the order
     of the steps and nothing about what happens inside any of them. This runs
     instead. Four stages, each drawn from the same state the prose describes,
     cycling on a timer.

     It respects a reduced-motion preference by not starting itself, since an
     animation that loops forever beside body text is exactly what that setting
     is asking not to have. The stage buttons still work. */

  const FLOW = [
    { key: "collect",  name: "Collection",  ms: 5200 },
    { key: "validate", name: "Validation",  ms: 4600 },
    { key: "train",    name: "Training",    ms: 5000 },
    { key: "simulate", name: "Simulation",  ms: 5600 },
  ];

  const flow = {
    i: 0, t0: 0, playing: true, manual: false,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };

  function flowStrip(ctx, w, S, p) {
    const faint = cssVar("--ink-faint"), rule = cssVar("--rule"),
          accent = cssVar("--accent");
    const cw = (w - 24 * S) / FLOW.length;
    ctx.font = `${9.5 * S}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    FLOW.forEach((st, i) => {
      const x = 12 * S + i * cw;
      const on = i === flow.i, done = i < flow.i;
      ctx.strokeStyle = on ? accent : rule;
      ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 26 * S);
      ctx.lineTo(x + cw - 10 * S, 26 * S);
      ctx.stroke();
      if (on) {                                  // progress along the current stage
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x, 26 * S);
        ctx.lineTo(x + (cw - 10 * S) * p, 26 * S);
        ctx.stroke();
      }
      ctx.fillStyle = on ? accent : (done ? cssVar("--ink-soft") : faint);
      ctx.fillText(`0${i + 1}  ${st.name.toUpperCase()}`, x, 18 * S);
    });
  }

  function drawFlow(now) {
    const canvas = document.getElementById("flow-canvas");
    if (!canvas) return;
    const { ctx, w, h } = fitAspect(canvas, 720, 360);
    const S = w / 720;
    const sx = (x) => x * S, sy = (y) => y * S;
    ctx.clearRect(0, 0, w, h);

    const st = FLOW[flow.i];
    const p = flow.playing && !flow.manual
      ? clamp((now - flow.t0) / st.ms, 0, 1)
      : 0.62;                                    // a representative frame when paused

    flowStrip(ctx, w, S, p);

    const ink = cssVar("--ink"), soft = cssVar("--ink-soft"),
          faint = cssVar("--ink-faint"), rule = cssVar("--rule"),
          accent = cssVar("--accent"), blue = cssVar("--series-1"),
          good = cssVar("--good");
    const mono = (px) => `${px * S}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.font = mono(10);

    const say = (lines) => {
      ctx.fillStyle = faint;
      lines.forEach((l, i) => ctx.fillText(l, sx(14), sy(330 + i * 14)));
    };

    if (st.key === "collect") {
      /* The handheld gripper, drawn after the Universal Manipulation Interface
         rather than as a generic pair of jaws, because the specific design is
         the reason the data is worth anything.

         What is on it and why, from the UMI paper:
           155 degree fisheye on a wrist-mounted action camera, so the view
             carries context without undistortion
           mirrors in the camera's peripheral view, which act as virtual
             cameras and give implicit stereo from one monocular image
           the camera's own IMU, for tracking through fast motion and for
             recovering absolute scale
           a fiducial on the finger, so width is tracked continuously instead
             of as open or closed
           soft printed fingers, ribbed to stay rigid at the tip while
             conforming to the object
         The same fingers and the same camera position go onto the robot, which
         is the whole trick. The observation does not change embodiment. */

      /* ---- the real gripper -------------------------------------------

         Not a drawing of a gripper. These outlines come out of the STL meshes
         and the URDF joint transforms, traced and simplified, so the fingers
         taper the way the printed ones taper and the rib slots are where the
         slots are. See gripper-outline.js.

         Everything below just places it. Translate to the point on the
         demonstration, rotate to the heading, scale, and slide the two finger
         groups apart to open the jaws. */
      const UMI = window.UMI_GRIPPER;
      const shell = cssVar("--surface-panel");
      const TOOL_R = 1.05;                     // tool units to canvas units

      const path = (u) => ({
        x: 170 + u * 300,
        y: 205 - Math.sin(u * Math.PI) * 62 + Math.sin(u * 9) * 4,
      });

      // The demonstration, and the samples already recorded along it.
      ctx.strokeStyle = rule;
      ctx.setLineDash([2 * S, 4 * S]);
      ctx.beginPath();
      for (let u = 0; u <= 1.001; u += 0.01) {
        const q = path(u);
        u === 0 ? ctx.moveTo(sx(q.x), sy(q.y)) : ctx.lineTo(sx(q.x), sy(q.y));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = blue;
      for (let u = 0; u <= p; u += 0.025) {
        const q = path(u);
        ctx.beginPath();
        ctx.arc(sx(q.x), sy(q.y), 2 * S, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* The object the demonstration ends on. A demonstration reaching for
         nothing is a gripper waving, and the whole point of the stage is that
         somebody picked something up. It sits at the end of the path because
         the traced outline puts the grasp point at its own origin, so the
         gripper arrives with the object already between the fingers. */
      /* The traced fingers run from the body out to x = 0, so the grasp point
         is the very fingertip. An object centered there sits half outside the
         jaws. Setting it back along the tool axis puts it in the mouth, where
         a gripper actually holds something. */
      const OBJ_R = 12;                        // tool units, so 24 across
      const OBJ_BACK = 14;
      const e0 = path(0.98), e1 = path(1);
      const eth = Math.atan2(e1.y - e0.y, e1.x - e0.x);
      const objAt = { x: e1.x - Math.cos(eth) * OBJ_BACK * TOOL_R,
                      y: e1.y - Math.sin(eth) * OBJ_BACK * TOOL_R };
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.arc(sx(objAt.x), sy(objAt.y), (OBJ_R + 7) * TOOL_R * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(sx(objAt.x), sy(objAt.y), OBJ_R * TOOL_R * S, 0, Math.PI * 2);
      ctx.fill();

      const g = path(p);
      /* Take the heading from a step that is always inside the path. Sampling
         forward from p clamps to the same point at the end, and atan2(0, 0) is
         zero, so the tool used to snap flat on the last frame. */
      const hb0 = Math.min(p, 0.98);
      const h0 = path(hb0), h1 = path(hb0 + 0.02);
      const th = Math.atan2(h1.y - h0.y, h1.x - h0.x);
      const fx = Math.cos(th), fy = Math.sin(th);
      const ux = -Math.sin(th), uy = Math.cos(th);
      const TOOL = TOOL_R;                     // the tool is 100 units long
      const at = (f, a) => ({ x: g.x + (fx * f + ux * a) * TOOL,
                              y: g.y + (fy * f + uy * a) * TOOL });

      // The fisheye, drawn before the hardware so the hardware sits on it.
      const lens = at(-70, 0);
      const FOV = 155 * Math.PI / 180;
      ctx.fillStyle = blue;
      ctx.globalAlpha = 0.07;
      ctx.beginPath();
      ctx.moveTo(sx(lens.x), sy(lens.y));
      ctx.lineTo(sx(lens.x + Math.cos(th - FOV / 2) * 135), sy(lens.y + Math.sin(th - FOV / 2) * 135));
      ctx.lineTo(sx(lens.x + Math.cos(th + FOV / 2) * 135), sy(lens.y + Math.sin(th + FOV / 2) * 135));
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;

      // Mirrors, sitting in the camera's peripheral view.
      [-1, 1].forEach((sg) => {
        const m0 = at(-58, 44 * sg), m1 = at(-44, 54 * sg);
        ctx.strokeStyle = blue;
        ctx.lineWidth = 2.4 * S;
        ctx.beginPath();
        ctx.moveTo(sx(m0.x), sy(m0.y)); ctx.lineTo(sx(m1.x), sy(m1.y));
        ctx.stroke();
        ctx.globalAlpha = 0.1;
        ctx.fillStyle = blue;
        ctx.beginPath();
        ctx.moveTo(sx(m1.x), sy(m1.y));
        ctx.lineTo(sx(m1.x + Math.cos(th - 0.3 * sg) * 80), sy(m1.y + Math.sin(th - 0.3 * sg) * 80));
        ctx.lineTo(sx(m1.x + Math.cos(th + 0.16 * sg) * 80), sy(m1.y + Math.sin(th + 0.16 * sg) * 80));
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      });

      // Place the traced outlines. The canvas transform does the posing, so the
      // path data stays in the frame it was generated in.
      /* Larger values here bring the fingers TOGETHER, because each group is
         translated toward the tool axis. Wide on the way in, closed on the
         object by the end. At 11 the faces sit at about 12 either side, which
         is the object's radius. */
      const open = 2 + 9 * ease(clamp((p - 0.78) / 0.22, 0, 1));
      ctx.save();
      ctx.translate(sx(g.x), sy(g.y));
      ctx.rotate(th);
      ctx.scale(TOOL * S, TOOL * S);
      ctx.lineJoin = "round";
      const draw = (list, dy) => {
        ctx.save();
        ctx.translate(0, dy);
        list.forEach((d) => {
          const pth = new Path2D(d);
          ctx.fillStyle = shell;
          ctx.fill(pth, "evenodd");
          ctx.strokeStyle = ink;
          ctx.lineWidth = 1.1 / (TOOL * S);
          ctx.stroke(pth);
        });
        ctx.restore();
      };
      if (UMI) {
        draw(UMI.body, 0);
        draw(UMI.left, open);
        draw(UMI.right, -open);
      }
      ctx.restore();

      // The lens itself, on top of the body.
      ctx.fillStyle = shell; ctx.strokeStyle = ink; ctx.lineWidth = 1.3 * S;
      ctx.beginPath();
      ctx.arc(sx(lens.x), sy(lens.y), 7 * TOOL * S, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = blue;
      ctx.beginPath();
      ctx.arc(sx(lens.x), sy(lens.y), 3.4 * TOOL * S, 0, Math.PI * 2);
      ctx.fill();

      // The fiducial the finger width is read from.
      const fid = at(-24, 30);
      ctx.save();
      ctx.translate(sx(fid.x), sy(fid.y));
      ctx.rotate(th);
      ctx.fillStyle = ink;
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          if ((a + b) % 2 === 0) {
            ctx.fillRect((a - 1.5) * 3 * TOOL * S, (b - 1.5) * 3 * TOOL * S,
                         3 * TOOL * S, 3 * TOOL * S);
          }
        }
      }
      ctx.restore();

      // ---- annotation
      ctx.font = mono(9);
      const lead = (from, to, text, align) => {
        ctx.strokeStyle = faint;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sx(from.x), sy(from.y)); ctx.lineTo(sx(to.x), sy(to.y));
        ctx.stroke();
        ctx.fillStyle = faint;
        ctx.textAlign = align || "left";
        ctx.fillText(text, sx(to.x + (align === "right" ? -4 : 4)), sy(to.y + 3));
        ctx.textAlign = "left";
      };
      lead(lens, { x: 120, y: 58 }, "155\u00b0 FISHEYE, IMU FOR SCALE");
      lead(at(-44, 54), { x: 486, y: 70 }, "MIRRORS, IMPLICIT STEREO");
      lead(fid, { x: 560, y: 296 }, "FIDUCIAL, CONTINUOUS FINGER WIDTH", "right");
      lead(at(6, -34), { x: 120, y: 296 }, "SOFT RIBBED FINGERS", "left");

      ctx.fillStyle = faint;
      ctx.fillText("NO ROBOT PRESENT. THE SAME FINGERS AND THE SAME CAMERA POSITION GO ONTO THE ARM.",
                   sx(14), sy(316));
      say([
        `DEMONSTRATION ${Math.round(1 + p * 214)} OF 215`,
        `FRAMES CAPTURED ${Math.round(p * 265000).toLocaleString("en-US")}`,
      ]);
    }

    if (st.key === "validate") {
      // A strip of frames, some of which fail tracking and fall out.
      const n = 26, fw = 22, gap = 4;
      const r0 = rng(31);
      const bad = [];
      for (let i = 0; i < n; i++) bad.push(r0() < 0.16);
      const shown = Math.floor(p * n);
      for (let i = 0; i < n; i++) {
        const x = 60 + i * (fw + gap);
        const fell = bad[i] && i < shown;
        const drop = fell ? Math.min(1, (p * n - i) / 3) : 0;
        const y = 140 + drop * 90;
        ctx.globalAlpha = i <= shown ? (fell ? 1 - drop * 0.7 : 1) : 0.18;
        ctx.strokeStyle = fell ? accent : rule;
        ctx.fillStyle = fell ? accent : cssVar("--surface-panel");
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(sx(x), sy(y), sx(fw), sy(30), 2);
        fell ? (ctx.globalAlpha *= 0.25, ctx.fill(), ctx.globalAlpha /= 0.25) : ctx.fill();
        ctx.stroke();
        if (fell) {
          ctx.strokeStyle = accent;
          ctx.beginPath();
          ctx.moveTo(sx(x + 5), sy(y + 8));
          ctx.lineTo(sx(x + fw - 5), sy(y + 22));
          ctx.moveTo(sx(x + fw - 5), sy(y + 8));
          ctx.lineTo(sx(x + 5), sy(y + 22));
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = faint;
      ctx.fillText("TRACKING VALIDATED PER STEP", sx(60), sy(120));
      // Below where a dropped frame lands. Frames fall to y 230 and stand 30
      // tall, so a label at 264 sat on the bottom edge of the first one.
      ctx.fillStyle = accent;
      ctx.fillText("DROPPED, POSE DRIFTED", sx(60), sy(292));
      say([
        "A DROPPED FRAME IS OBVIOUS. A DRIFTED POSE IS NOT,",
        "AND IT TEACHES A POSE THE GRIPPER WAS NEVER AT.",
      ]);
    }

    if (st.key === "train") {
      const padL = 70, padR = 60, padT = 70, padB = 90;
      const X = (u) => sx(padL + u * (720 - padL - padR));
      const Y = (v) => sy(padT + (1 - v) * (360 - padT - padB));
      ctx.strokeStyle = rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(1), Y(0));
      ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(0), Y(1));
      ctx.stroke();

      const r0 = rng(7);
      ctx.strokeStyle = blue;
      ctx.lineWidth = 2 * S;
      ctx.beginPath();
      for (let u = 0; u <= p; u += 0.004) {
        const loss = 0.12 + 0.82 * Math.exp(-4.2 * u) + (r0() - 0.5) * 0.035;
        u === 0 ? ctx.moveTo(X(u), Y(loss)) : ctx.lineTo(X(u), Y(loss));
      }
      ctx.stroke();

      [0.25, 0.5, 0.75, 1].forEach((u) => {
        if (p < u) return;
        ctx.strokeStyle = faint;
        ctx.lineWidth = 1;
        ctx.setLineDash([2 * S, 3 * S]);
        ctx.beginPath();
        ctx.moveTo(X(u), Y(0)); ctx.lineTo(X(u), Y(1));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = faint;
        ctx.fillText("CKPT", X(u) + 3 * S, Y(1) - 4 * S);
      });

      ctx.fillStyle = faint;
      ctx.fillText("LOSS", sx(24), sy(padT + 10));
      ctx.fillText(`EPOCH ${Math.round(1 + p * 39)} OF 40`, X(0), sy(360 - padB + 22));
      say([
        "CHECKPOINTS ARE KEPT SO A LATER COMPARISON",
        "CAN BE RUN AT EVERY ONE RATHER THAN ONLY AT THE END.",
      ]);
    }

    if (st.key === "simulate") {
      // The solved arm runs a reach against a held-out episode.
      const target = { x: 330 + Math.cos(p * 4) * 4, y: 215 };
      const sol = R.poseArm(target, [-0.9, 0.7, 0.5, 0.2]);
      const pts = sol.pts;
      const reach = clamp(p * 1.35, 0, 1);

      ctx.strokeStyle = rule;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx(40), sy(56), sx(640), sy(230));
      ctx.fillStyle = faint;
      ctx.fillText("SIMULATION, HELD-OUT EPISODE", sx(48), sy(72));

      ctx.lineCap = "round";
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const bx = lerp(a.x, b.x, reach), by = lerp(a.y, b.y, reach);
        ctx.strokeStyle = ink;
        ctx.lineWidth = Math.max(2, (10 - i * 1.7) * S);
        ctx.beginPath();
        ctx.moveTo(sx(a.x), sy(a.y));
        ctx.lineTo(sx(reach >= 1 ? b.x : bx), sy(reach >= 1 ? b.y : by));
        ctx.stroke();
      }
      pts.slice(0, -1).forEach((q, i) => {
        ctx.fillStyle = cssVar("--paper");
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1.4 * S;
        ctx.beginPath();
        ctx.arc(sx(q.x), sy(q.y), Math.max(3, (6.5 - i) * S), 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      });

      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(sx(target.x), sy(target.y), 5 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3 * S, 3 * S]);
      ctx.beginPath();
      ctx.arc(sx(target.x), sy(target.y), 17 * S, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      const err = Math.max(4, 120 * Math.exp(-3.4 * p));
      ctx.fillStyle = err <= 30 ? good : accent;
      ctx.font = mono(12);
      ctx.fillText(`${err.toFixed(0)} MM FROM THE OBJECT`, sx(430), sy(96));
      ctx.font = mono(10);
      ctx.fillStyle = faint;
      ctx.fillText(`TOLERANCE 30 MM  ${err <= 30 ? "INSIDE" : "OUTSIDE"}`, sx(430), sy(112));
      ctx.fillText(`EPISODE ${Math.round(1 + p * 19)} OF 20`, sx(430), sy(128));
      say([
        "TWENTY HELD-OUT EPISODES, NOT ONE, BECAUSE A POLICY",
        "THAT SAMPLES GIVES A DIFFERENT ANSWER EACH RUN.",
      ]);
    }

    const nm = document.getElementById("flow-stage-name");
    if (nm) nm.textContent = st.name;
  }

  function flowControls() {
    const host = document.getElementById("flow-controls");
    if (!host) return;
    host.innerHTML = '<span class="control-label">Stage</span>'
      + FLOW.map((s, i) =>
        `<button type="button" data-f="${i}" aria-pressed="${i === 0}">${s.name}</button>`).join("")
      + `<button type="button" id="flow-play" aria-pressed="${!flow.reduced}">${
          flow.reduced ? "Play" : "Pause"}</button>`;

    host.querySelectorAll("[data-f]").forEach((b) =>
      b.addEventListener("click", () => {
        flow.i = parseInt(b.dataset.f, 10);
        flow.manual = true;
        flow.playing = false;
        document.getElementById("flow-play").textContent = "Play";
        document.getElementById("flow-play").setAttribute("aria-pressed", "false");
        host.querySelectorAll("[data-f]").forEach((o) =>
          o.setAttribute("aria-pressed", String(o === b)));
        drawFlow(performance.now());
      }));

    document.getElementById("flow-play").addEventListener("click", function () {
      flow.playing = !flow.playing;
      flow.manual = !flow.playing;
      if (flow.playing) flow.t0 = performance.now();
      this.textContent = flow.playing ? "Pause" : "Play";
      this.setAttribute("aria-pressed", String(flow.playing));
    });

    if (flow.reduced) { flow.playing = false; flow.manual = true; }
    flow.t0 = performance.now();
  }

  function markFlowStage() {
    const host = document.getElementById("flow-controls");
    if (!host) return;
    host.querySelectorAll("[data-f]").forEach((o) =>
      o.setAttribute("aria-pressed", String(parseInt(o.dataset.f, 10) === flow.i)));
  }

  /* ------------------------------------------- 05 train-deploy mismatch --

     A closed loop, in millimeters, reaching for a target at the origin from
     400 mm away. The policy sees where it is, works out a step toward where it
     thinks the target is, and the client executes that step.

     Each defect enters at a different point in that sentence, which is the
     reason they behave so differently and the reason none of them looks like
     what it is:

       rotation   corrupts the EXECUTION. The step taken is not the step asked
                  for, so the loop closes around the wrong axis and spirals.
       stale      corrupts the OBSERVATION TIME. The policy answers the
                  question it was asked three cycles ago, which is overshoot.
       mask       corrupts the OBSERVATION ITSELF. The target is perceived
                  slightly off, so the loop converges accurately onto the wrong
                  point, which is the hardest of the three to see. */

  const bugs = { rotate: false, stale: false, mask: false };

  /* ⚠️ THE HORIZON IS PART OF THE PROBLEM. An episode is not open ended. The
     arm gets a fixed number of cycles before it closes on the object, and a
     defect that would settle out eventually still misses inside that window.
     Run this for ninety steps rather than twenty-six and every defect here
     converges, which would say the opposite of what actually happened.

     The stale gain is tuned so the oscillation is visible rather than
     arithmetically minimal. Loop gain genuinely sets that amplitude, so the
     shape is real and the magnitude is chosen for legibility. */
  const SIM = {
    steps: 26,
    start: { x: -400, y: 130 },
    gain: 0.16,
    maxStep: 26,
    tolerance: 30,          // the grasp tolerance, in millimeters
    delay: 3,               // control cycles of staleness
    staleGain: 2.6,
    rotation: Math.PI / 4,  // the tool-frame error, 45 degrees
    maskBias: { x: 18, y: -38 },
  };

  function rollout(opts) {
    const r = rng(opts.seed || 7);
    const hist = [{ x: SIM.start.x, y: SIM.start.y }];
    let p = { x: SIM.start.x, y: SIM.start.y };

    for (let i = 0; i < SIM.steps; i++) {
      // What the policy is looking at. Stale observations are simply an older
      // entry in the same history.
      const obs = opts.stale
        ? hist[Math.max(0, hist.length - 1 - SIM.delay)]
        : p;

      // Where it thinks the target is.
      const tgt = opts.mask
        ? { x: SIM.maskBias.x, y: SIM.maskBias.y }
        : { x: 0, y: 0 };

      let dx = (tgt.x - obs.x) * SIM.gain;
      let dy = (tgt.y - obs.y) * SIM.gain;

      // Stale observations make the loop hotter, because the correction is
      // sized for an error that has already been partly worked off.
      if (opts.stale) { dx *= SIM.staleGain; dy *= SIM.staleGain; }

      const n = Math.hypot(dx, dy);
      if (n > SIM.maxStep) { dx *= SIM.maxStep / n; dy *= SIM.maxStep / n; }

      if (opts.rotate) {
        const c = Math.cos(SIM.rotation), s = Math.sin(SIM.rotation);
        const rx = dx * c - dy * s, ry = dx * s + dy * c;
        dx = rx; dy = ry;
      }

      p = { x: p.x + dx + gauss(r) * 1.1, y: p.y + dy + gauss(r) * 1.1 };
      hist.push(p);
    }
    return hist;
  }

  const finalError = (h) => Math.hypot(h[h.length - 1].x, h[h.length - 1].y);

  function drawTraj() {
    const canvas = document.getElementById("traj-canvas");
    if (!canvas) return;
    const { ctx, w, h } = fitCanvas(canvas, 380);
    ctx.clearRect(0, 0, w, h);

    const demo = rollout({ seed: 7 });
    const run = rollout(Object.assign({ seed: 7 }, bugs));

    // Fit both paths into the box.
    const all = demo.concat(run);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    all.forEach((p) => {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    });
    const pad = 46;
    const sc = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1),
                        (h - 2 * pad) / Math.max(y1 - y0, 1));
    const X = (x) => pad + (x - x0) * sc + ((w - 2 * pad) - (x1 - x0) * sc) / 2;
    const Y = (y) => pad + (y - y0) * sc + ((h - 2 * pad) - (y1 - y0) * sc) / 2;

    // The grasp tolerance, drawn to scale.
    ctx.strokeStyle = cssVar("--muted-mark");
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(X(0), Y(0), SIM.tolerance * sc, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const path = (pts, style, dash, width) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
      ctx.stroke();
      ctx.setLineDash([]);
    };

    path(demo, cssVar("--muted-mark"), [4, 4], 1.5);
    const any = bugs.rotate || bugs.stale || bugs.mask;
    path(run, any ? cssVar("--accent") : cssVar("--good"), [], 2);

    // Start, target and the point it actually finished at.
    const last = run[run.length - 1];
    ctx.fillStyle = cssVar("--ink-faint");
    ctx.beginPath(); ctx.arc(X(SIM.start.x), Y(SIM.start.y), 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = "11.5px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("start", X(SIM.start.x) + 8, Y(SIM.start.y) + 4);

    ctx.fillStyle = cssVar("--ink");
    ctx.beginPath(); ctx.arc(X(0), Y(0), 3.5, 0, Math.PI * 2); ctx.fill();
    // The object often sits near the right edge, where a label placed to its
    // right runs off the canvas.
    const near = X(0) > w - 90;
    ctx.textAlign = near ? "right" : "left";
    ctx.fillText("object", X(0) + (near ? -10 : 10), Y(0) - 8);
    ctx.textAlign = "left";

    ctx.fillStyle = any ? cssVar("--accent") : cssVar("--good");
    ctx.beginPath(); ctx.arc(X(last.x), Y(last.y), 5, 0, Math.PI * 2); ctx.fill();

    const err = finalError(run);
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = err <= SIM.tolerance ? cssVar("--good") : cssVar("--accent");
    ctx.fillText(`${err.toFixed(0)} mm from the object`, 12, 22);
    ctx.fillStyle = cssVar("--ink-faint");
    ctx.font = "11.5px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(`grasp tolerance ${SIM.tolerance} mm`, 12, 40);
    ctx.fillText(err <= SIM.tolerance ? "inside" : "outside", 12, 58);
  }

  const BUG_TEXT = {
    rotate: {
      name: "45 degree tool-frame rotation",
      body: "The step the arm takes is not the step the policy asked for. The "
        + "loop still closes, but around the wrong axis, so the path spirals "
        + "and arrives late or not at all. This one looked exactly like a "
        + "policy that had learned a slightly wrong approach.",
    },
    stale: {
      name: "Stale observations",
      body: "The camera frame is a few control cycles old, so the policy "
        + "answers a question about where the arm used to be. At low speed it "
        + "is nearly invisible, and faster it becomes overshoot and then "
        + "oscillation.",
    },
    mask: {
      name: "Observation mask, 5.6 percent of the image",
      body: "The picture the policy sees at deployment is not the picture it "
        + "trained on. It converges tightly and accurately onto a point that "
        + "is not where the object is, which is the hardest of the three to "
        + "notice.",
    },
  };

  function renderBugNotes() {
    const host = document.getElementById("bug-notes");
    if (!host) return;
    host.innerHTML = Object.keys(BUG_TEXT).map((k) => {
      const solo = rollout(Object.assign({ seed: 7 }, { [k]: true }));
      return `<div class="${bugs[k] ? "bug-on" : "bug-off"}">
        <dt>${BUG_TEXT[k].name}</dt>
        <dd>${BUG_TEXT[k].body}
          <span class="bug-err">On its own it finishes ${finalError(solo).toFixed(0)} mm out.</span>
        </dd>
      </div>`;
    }).join("");
  }

  function bugControls() {
    const host = document.getElementById("bug-controls");
    if (!host) return;
    host.innerHTML = '<span class="control-label">Defects</span>'
      + Object.keys(BUG_TEXT).map((k) =>
        `<button type="button" data-bug="${k}" aria-pressed="false">${
          k === "rotate" ? "Frame rotation" : k === "stale" ? "Stale frames" : "Observation mask"
        }</button>`).join("")
      + '<button type="button" data-bug="none">All off</button>';

    host.querySelectorAll("[data-bug]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = b.dataset.bug;
        if (k === "none") { bugs.rotate = bugs.stale = bugs.mask = false; }
        else bugs[k] = !bugs[k];
        host.querySelectorAll("[data-bug]").forEach((o) => {
          if (o.dataset.bug !== "none") {
            o.setAttribute("aria-pressed", String(bugs[o.dataset.bug]));
          }
        });
        drawTraj();
        renderBugNotes();
      }));
  }

  /* --------------------------------------------- 06 compression as shift */

  function drawCheckpoints() {
    const svg = document.getElementById("checkpoints-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 300, pad = { l: 58, r: 120, t: 28, b: 36 };
    const r = rng(4242);
    const n = 12;
    const series = [
      { name: "original pipeline", c: cssVar("--muted-mark"), base: 46, floor: 26 },
      { name: "rebuilt at 3x fidelity", c: cssVar("--series-1"), base: 40, floor: 16 },
    ].map((s) => {
      s.pts = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        s.pts.push(s.floor + (s.base - s.floor) * Math.exp(-2.6 * t) + Math.abs(gauss(r)) * 1.4);
      }
      return s;
    });

    const yr = [10, 52];
    const X = (i) => pad.l + (i / (n - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - pad.t - pad.b);
    axes(svg, W, H, pad, yr, (v) => v.toFixed(0) + " mm", "prediction error on 20 held-out episodes");

    series.forEach((s) => {
      el("path", { d: s.pts.map((v, i) => `${i ? "L" : "M"}${X(i)},${Y(v)}`).join(""),
        fill: "none", stroke: s.c, "stroke-width": 2 }, svg);
      s.pts.forEach((v, i) => el("circle", { cx: X(i), cy: Y(v), r: 2.5, fill: s.c }, svg));
      const t = el("text", { x: W - pad.r + 8, y: Y(s.pts[n - 1]) + 4,
        "font-size": 11.5, fill: s.c }, svg);
      t.textContent = s.name;
    });

    const faint = cssVar("--ink-faint");
    const lab = el("text", { x: pad.l, y: H - 10, "font-size": 11, fill: faint }, svg);
    lab.textContent = "training checkpoints →";
  }

  /* ------------------------------------------------- 07 rollout variance */

  const evalState = { n: 1 };

  function drawRollouts() {
    const svg = document.getElementById("rollouts-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 320, pad = { l: 58, r: 130, t: 28, b: 40 };
    const r = rng(99 + evalState.n);
    const arms = [
      { name: "policy A", mean: 31, sd: 11, c: cssVar("--muted-mark") },
      { name: "policy B", mean: 22, sd: 10, c: cssVar("--series-1") },
    ];
    const xr = [0, 70];
    const X = (v) => pad.l + (v - xr[0]) / (xr[1] - xr[0]) * (W - pad.l - pad.r);
    const grid = cssVar("--grid"), faint = cssVar("--ink-faint");

    for (let v = 0; v <= 70; v += 10) {
      el("line", { x1: X(v), y1: pad.t, x2: X(v), y2: H - pad.b, stroke: grid }, svg);
      const t = el("text", { x: X(v), y: H - pad.b + 16, "text-anchor": "middle",
        "font-size": 11, fill: faint }, svg);
      t.textContent = v + " mm";
    }

    arms.forEach((a, ai) => {
      const y0 = pad.t + 24 + ai * 120;
      const draws = [];
      for (let i = 0; i < evalState.n; i++) {
        draws.push(Math.max(2, a.mean + gauss(r) * a.sd));
      }
      const rows = Math.min(draws.length, 9);
      draws.forEach((v, i) => {
        el("circle", { cx: X(v), cy: y0 + (i % 9) * 8, r: 3.5,
          fill: a.c, opacity: 0.55 }, svg);
      });
      const m = draws.reduce((s, v) => s + v, 0) / draws.length;
      // The mean line spans the dots it summarizes. Drawn at a fixed height it
      // towers over a single rollout and implies a spread that is not there.
      el("line", { x1: X(m), y1: y0 - 12, x2: X(m), y2: y0 + (rows - 1) * 8 + 12,
        stroke: a.c, "stroke-width": 2 }, svg);
      const t = el("text", { x: W - pad.r + 8, y: y0 + 4, "font-size": 11.5, fill: a.c }, svg);
      t.textContent = a.name;
      const mm = el("text", { x: W - pad.r + 8, y: y0 + 20, "font-size": 11, fill: faint }, svg);
      mm.textContent = `mean ${m.toFixed(1)} mm`;
    });

    const note = el("text", { x: pad.l, y: pad.t - 10, "font-size": 11, fill: faint }, svg);
    note.textContent = evalState.n === 1
      ? "one rollout each, and the wrong policy can win"
      : `${evalState.n} rollouts each, final error per rollout`;
  }

  function evalControls() {
    const host = document.getElementById("eval-controls");
    if (!host) return;
    host.innerHTML = '<span class="control-label">Rollouts per policy</span>'
      + [1, 3, 9, 27].map((n) =>
        `<button type="button" data-n="${n}" aria-pressed="${n === evalState.n}">${n}</button>`).join("")
      + '<span class="control-label">the means separate long before any single pair does</span>';
    host.querySelectorAll("[data-n]").forEach((b) =>
      b.addEventListener("click", () => {
        evalState.n = parseInt(b.dataset.n, 10);
        host.querySelectorAll("[data-n]").forEach((o) =>
          o.setAttribute("aria-pressed", String(o === b)));
        drawRollouts();
      }));
  }

  /* ------------------------------------------------ 08 the width ladder -- */

  const ladderState = { show: "both" };

  function drawLadder() {
    const svg = document.getElementById("ladder-svg");
    if (!svg) return;
    clear(svg);
    const W = 720, H = 340, pad = { l: 62, r: 130, t: 30, b: 42 };
    const r = rng(2027);
    const widths = [1, 1.8, 3.2, 5.6, 9, 13];      // a 13x parameter range
    const arms = [
      { key: "classical", name: "classical control", c: cssVar("--muted-mark") },
      { key: "quantum", name: "quantum attention", c: cssVar("--series-1") },
    ];
    const yr = [12, 42];
    const X = (p) => pad.l + (Math.log(p) / Math.log(13)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - yr[0]) / (yr[1] - yr[0])) * (H - pad.t - pad.b);

    axes(svg, W, H, pad, yr, (v) => v.toFixed(0) + " mm", "held-out error");
    widths.forEach((p) => {
      const t = el("text", { x: X(p), y: H - pad.b + 16, "text-anchor": "middle",
        "font-size": 11, fill: cssVar("--ink-faint") }, svg);
      t.textContent = p + "x";
    });
    const xl = el("text", { x: pad.l, y: H - 10, "font-size": 11, fill: cssVar("--ink-faint") }, svg);
    xl.textContent = "parameter count, relative to the narrowest →";

    arms.forEach((a) => {
      if (ladderState.show !== "both" && ladderState.show !== a.key) return;
      const means = [];
      widths.forEach((p) => {
        const base = 17 + 16 * Math.exp(-1.1 * (p - 1));
        const seeds = [];
        for (let s = 0; s < 3; s++) seeds.push(base + gauss(r) * 1.5);
        const m = seeds.reduce((x, y) => x + y, 0) / 3;
        means.push({ p, m, seeds });
        seeds.forEach((v) => el("circle", { cx: X(p), cy: Y(v), r: 3,
          fill: a.c, opacity: 0.5 }, svg));
        el("line", { x1: X(p), y1: Y(Math.min.apply(null, seeds)),
          x2: X(p), y2: Y(Math.max.apply(null, seeds)),
          stroke: a.c, "stroke-width": 1, opacity: 0.6 }, svg);
      });
      el("path", { d: means.map((d, i) => `${i ? "L" : "M"}${X(d.p)},${Y(d.m)}`).join(""),
        fill: "none", stroke: a.c, "stroke-width": 2 }, svg);
      const t = el("text", { x: W - pad.r + 8, y: Y(means[means.length - 1].m) + (a.key === "quantum" ? 14 : -4),
        "font-size": 11.5, fill: a.c }, svg);
      t.textContent = a.name;
    });

    const note = el("text", { x: W - pad.r + 8, y: pad.t + 6, "font-size": 11,
      fill: cssVar("--ink-faint") }, svg);
    note.textContent = "3 seeds per point";
  }

  function ladderControls() {
    const host = document.getElementById("ladder-controls");
    if (!host) return;
    host.innerHTML = '<span class="control-label">Arms</span>'
      + [["both", "Both"], ["quantum", "Quantum only"], ["classical", "Classical only"]]
        .map(([k, l]) => `<button type="button" data-a="${k}" aria-pressed="${k === ladderState.show}">${l}</button>`).join("")
      + '<span class="control-label">matched parameter count, identical episode splits</span>';
    host.querySelectorAll("[data-a]").forEach((b) =>
      b.addEventListener("click", () => {
        ladderState.show = b.dataset.a;
        host.querySelectorAll("[data-a]").forEach((o) =>
          o.setAttribute("aria-pressed", String(o === b)));
        drawLadder();
      }));
  }

  /* -------------------------------------------------------------- wiring */

  function drawAll() {
    R.drawArmPlate();
    drawFlow(performance.now());
    R.renderStats();
    R.renderConstraints();
    R.drawModel();
    R.drawLoop();
    drawTraj();
    renderBugNotes();
    drawCheckpoints();
    drawRollouts();
    drawLadder();
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
    R.heroControls();
    flowControls();
    R.modelControls();
    R.loopControls();
    bugControls();
    evalControls();
    ladderControls();
    drawAll();

    let t = null;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(drawAll, 150);
    });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    (mq.addEventListener ? mq.addEventListener.bind(mq, "change")
                         : mq.addListener.bind(mq))(drawAll);

    // The sequence runs only while it is on screen and the tab is visible.
    // A loop animating behind a reader who has scrolled past it is a battery
    // bill and nothing else.
    let onScreen = false;
    const flowEl = document.getElementById("flow-canvas");
    if (window.IntersectionObserver && flowEl) {
      new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; },
        { threshold: 0.15 }).observe(flowEl);
    } else {
      onScreen = true;
    }

    (function tick(now) {
      if (onScreen && !document.hidden) {
        if (flow.playing && !flow.manual) {
          if (now - flow.t0 > FLOW[flow.i].ms) {
            flow.i = (flow.i + 1) % FLOW.length;
            flow.t0 = now;
            markFlowStage();
          }
          drawFlow(now);
        }
      }
      requestAnimationFrame(tick);
    })(performance.now());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
