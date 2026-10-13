// Draws the mountain, the route, the rope and the climber.
const NS = "http://www.w3.org/2000/svg";

// Route anchors: base camp, then the top of each of the five pitches.
const ANCHORS = [
  [34, 196],
  [92, 160],
  [146, 128],
  [186, 98],
  [222, 64],
  [262, 24],
];

const RIDGE =
  "M-400 210 L-400 200 L0 198 L34 192 L70 170 L92 158 L118 148 L146 126 L166 116 " +
  "L186 96 L204 88 L222 62 L244 44 L262 22 L280 40 L296 52 L316 84 " +
  "L330 96 L360 132 L420 170 L760 190 L760 210 Z";

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// On wide screens the mountain panel is tall, so zoom in on the route.
const WIDE = matchMedia("(min-width: 900px)");

export function drawMountain(svg) {
  svg.innerHTML = "";
  svg.setAttribute("viewBox", WIDE.matches ? "6 0 296 214" : "0 0 360 210");
  const defs = el("defs", {}, svg);
  const clip = el("clipPath", { id: "mtnClip" }, defs);
  el("path", { d: RIDGE }, clip);

  // Far range for depth.
  el(
    "path",
    {
      d: "M-400 210 L-400 160 L-300 120 L-200 150 L-90 110 L0 150 L40 128 L78 140 L120 104 L150 118 L200 80 L236 96 L300 70 L338 92 L360 86 L430 120 L520 90 L620 130 L760 110 L760 210 Z",
      class: "far",
    },
    svg
  );

  el("path", { d: RIDGE, class: "rock" }, svg);

  // Contour lines, like a topo map, clipped to the mountain.
  const contours = el("g", { "clip-path": "url(#mtnClip)", class: "contours" }, svg);
  for (let i = 1; i <= 9; i++) {
    const y = 210 - i * 20;
    const wobble = i % 2 ? 6 : -5;
    el(
      "path",
      {
        d: `M-400 ${y + 4} Q -200 ${y + wobble} 0 ${y + 8} Q 90 ${y - wobble} 180 ${y + 4} T 360 ${y - 2} T 760 ${y}`,
      },
      contours
    );
  }

  // Snow cap.
  el(
    "path",
    { d: "M244 44 L262 22 L280 40 L271 46 L262 40 L253 48 Z", class: "snow" },
    svg
  );

  // Faint route the climber will follow.
  el(
    "polyline",
    { points: ANCHORS.map((p) => p.join(",")).join(" "), class: "route" },
    svg
  );

  el("g", { id: "ropeLayer" }, svg);
  el("g", { id: "labelLayer" }, svg);

  const anchors = el("g", { id: "anchorLayer" }, svg);
  ANCHORS.slice(1).forEach(([x, y], i) => {
    const g = el("g", { class: "anchor", "data-i": i }, anchors);
    el("circle", { cx: x, cy: y, r: i === 4 ? 6 : 4.5 }, g);
  });

  const flag = el("g", { id: "summitFlag", class: "flag" }, svg);
  el("line", { x1: 262, y1: 22, x2: 262, y2: 4 }, flag);
  el("path", { d: "M262 4 L276 8 L262 12 Z" }, flag);

  const climber = el("g", { id: "climber", class: "climber" }, svg);
  el("circle", { r: 7, class: "halo" }, climber);
  el("circle", { r: 4 }, climber);
  placeClimber(svg, 0, false);
}

function placeClimber(svg, index, animate) {
  const climber = svg.querySelector("#climber");
  const [x, y] = ANCHORS[index];
  climber.classList.toggle("still", !animate);
  climber.style.transform = `translate(${x}px, ${y}px)`;
}

// results: array of 5 entries, each null (not yet climbed),
// "clean" (linked every clue), "part" (linked some) or "slip" (no hold).
// words: the answer for each finished step, shown beside its anchor
// on wide screens.
export function updateClimb(svg, results, current, animate = true, words = []) {
  const rope = svg.querySelector("#ropeLayer");
  rope.innerHTML = "";
  results.forEach((r, i) => {
    if (!r) return;
    const [x1, y1] = ANCHORS[i];
    const [x2, y2] = ANCHORS[i + 1];
    el("line", { x1, y1, x2, y2, class: r === "clean" ? "rope" : `rope ${r}` }, rope);
  });

  svg.querySelectorAll(".anchor").forEach((a) => {
    const i = Number(a.dataset.i);
    a.classList.toggle("done", Boolean(results[i]));
    a.classList.toggle("slip", results[i] === "slip");
    a.classList.toggle("next", i === current);
  });

  const labels = svg.querySelector("#labelLayer");
  labels.innerHTML = "";
  results.forEach((r, i) => {
    if (!r || !words[i]) return;
    const [x, y] = ANCHORS[i + 1];
    const t = el(
      "text",
      { x: x - 9, y: y + 3, class: r === "slip" ? "anchor-label slip" : "anchor-label" },
      labels
    );
    t.textContent = words[i];
  });

  svg.querySelector("#summitFlag").classList.toggle("up", results[4] === "clean");

  const reached = results.filter(Boolean).length;
  placeClimber(svg, reached, animate);
}
