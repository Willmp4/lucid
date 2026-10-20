#!/usr/bin/env node
// Generates a before/after(/intended) data-flow diagram as an .excalidraw scene.
//
// Written by Andrew Forsyth, who also designed the .flow spec format and the
// authoring rules hooks/diagram.ts gives the model. Published here under this
// repository's MIT licence with his permission.
// Input is a compact panel/node/edge spec; layout, colors and arrows are derived.

const FONT_MONO = 3;
const NODE_FONT = 16;
const EDGE_FONT = 14;
const PANEL_LABEL_FONT = 20;
const TITLE_FONT = 20;
const LINE_HEIGHT = 1.25;
const CHAR_RATIO = 0.6;

const NODE_W = 200; // default; a spec may override via nodeWidth
const NODE_W_MIN = 120;
const NODE_W_MAX = 600;
const DETAIL_FONT = 12; // subordinate line under the concept
const DETAIL_GAP = 6;
const DETAIL_COLOR = "#6b7280";
const NODE_H = 72;
const NODE_PAD = 12;
const COL_GAP = 48;
const ROW_GAP = 88;
const PANEL_PAD = 28;
const PANEL_GAP = 64;
const PANEL_MIN_W = 260;

const TITLE_Y = 0;
const PANEL_LABEL_Y = 46;
const FRAME_Y = 84;
const LEGEND_GAP = 44;
const BYPASS_LANE_STEP = 40;
const DETOUR_NUDGE = 14;
const LABEL_GAP = 10;
const STRIP = 3;
const BOUNDS_INSET = 10;
// Shared run below this is a shared port or a corner touch, not an ambiguous path.
const COLLINEAR_TOLERANCE = 6; // keep labels off the panel's dashed border

// Distinct hues for independent flows through one system (an overview diagram):
// which path a box or arrow belongs to, as opposed to KINDS, which marks what a
// change did to it. Order is the auto-assignment order.
const FLOW_PALETTE = [
  "#e03131", // red
  "#1971c2", // blue
  "#2f9e44", // green
  "#6741d9", // violet
  "#f08c00", // orange
  "#0c8599", // teal
  "#c2255c", // pink
  "#846358", // brown
];

const KINDS = {
  normal: { stroke: "#1e1e1e", fill: "transparent", dash: "solid" },
  added: { stroke: "#2f9e44", fill: "#d3f9d8", dash: "solid" },
  removed: { stroke: "#e03131", fill: "#ffe3e3", dash: "dashed" },
  problem: { stroke: "#f08c00", fill: "#fff3bf", dash: "solid" },
};

// Legend captions per kind; a kind only appears in the legend when it is used
// AND listed here, in this order.
const LEGEND_LABELS = {
  added: "added in this panel",
  removed: "removed in this panel",
  problem: "problem path",
};
const LEGEND_ORDER = Object.keys(LEGEND_LABELS);
// The before/after diff markers, as opposed to the palette entries used for
// grouping. Only these reserve a colour against declared flows.
const DIFF_KINDS = new Set(["added", "removed", "problem"]);

const textWidth = (lines, fontSize) =>
  Math.max(0, ...lines.map((l) => l.length)) * fontSize * CHAR_RATIO;
const textHeight = (lines, fontSize) => lines.length * fontSize * LINE_HEIGHT;

function wrap(text, maxChars) {
  const words = [];
  for (const raw of String(text).split(/\s+/).filter(Boolean)) {
    let word = raw;
    while (word.length > maxChars) {
      words.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    words.push(word);
  }
  if (!words.length) return [""];
  const lines = [];
  let cur = "";
  for (const word of words) {
    if (!cur) cur = word;
    else if (`${cur} ${word}`.length <= maxChars) cur += ` ${word}`;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  lines.push(cur);
  return lines;
}

function styleOf(kind, where) {
  const style = KINDS[kind || "normal"];
  if (!style) {
    throw new Error(
      `unknown kind "${kind}" on ${where}; expected one of ${Object.keys(KINDS).join(", ")}`,
    );
  }
  return style;
}

// Flows are declared once at the top of the spec and referenced by key. Colours are
// assigned here rather than per element, so two flows can never collide and a
// flow can never quietly reuse a KIND colour that is also on show.
function resolveFlows(spec) {
  const declared = spec.flows ?? {};
  const usedKindColours = new Set();
  for (const panel of spec.panels ?? []) {
    for (const el of [...(panel.nodes ?? []), ...(panel.edges ?? [])]) {
      if (el.kind && el.flow) {
        const what = el.id
          ? `node "${el.id}"`
          : `edge "${el.from}"->"${el.to}"`;
        throw new Error(
          `${what} sets both kind "${el.kind}" and flow "${el.flow}" — a kind says ` +
            `what a change did to an element, a flow says which path it belongs to. Pick one.`,
        );
      }
      if (el.kind && el.kind !== "normal" && DIFF_KINDS.has(el.kind)) {
        usedKindColours.add(KINDS[el.kind].stroke);
      }
    }
  }

  const flows = new Map();
  const taken = new Set(usedKindColours);
  const explicit = new Map();
  for (const [key, value] of Object.entries(declared)) {
    const label = typeof value === "string" ? value : value?.label;
    if (!label) throw new Error(`flow "${key}" needs a label`);
    const color = typeof value === "string" ? undefined : value?.color;
    if (color) {
      if (explicit.has(color)) {
        throw new Error(
          `flows "${explicit.get(color)}" and "${key}" both use colour ${color} — ` +
            `two flows must be told apart at a glance`,
        );
      }
      explicit.set(color, key);
      taken.add(color);
    }
    flows.set(key, { label, color });
  }

  for (const [key, flow] of flows) {
    if (flow.color) continue;
    const free = FLOW_PALETTE.find((c) => !taken.has(c));
    if (!free) {
      throw new Error(
        `ran out of distinct flow colours at "${key}" — ${FLOW_PALETTE.length} is the ` +
          `limit, and an overview with that many flows will not read anyway`,
      );
    }
    flow.color = free;
    taken.add(free);
  }
  return flows;
}

function flowStyle(flow) {
  return { stroke: flow.color, fill: "transparent", dash: "solid" };
}

function styleForElement(el, flows, where) {
  if (el.flow) {
    const flow = flows.get(el.flow);
    if (!flow) {
      throw new Error(
        `${where} references undeclared flow "${el.flow}" — declare it in the spec's ` +
          `top-level "flows" object`,
      );
    }
    return flowStyle(flow);
  }
  return styleOf(el.kind, where);
}

function makeFactory() {
  let seq = 0;
  const next = () => ++seq;
  const base = (type, x, y, width, height, style, customData) => ({
    id: `${type}-${next()}`,
    type,
    x,
    y,
    width,
    height,
    angle: 0,
    strokeColor: style.stroke,
    backgroundColor: style.fill,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: style.dash,
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 100000 + seq,
    version: 1,
    versionNonce: 100000 + seq,
    isDeleted: false,
    boundElements: [],
    updated: 1,
    link: null,
    locked: false,
    customData,
  });

  return {
    rect(x, y, width, height, style, customData) {
      return {
        ...base("rectangle", x, y, width, height, style, customData),
        roundness: { type: 3 },
      };
    },
    text(x, y, lines, fontSize, color, customData, align = "center") {
      const width = textWidth(lines, fontSize);
      const height = textHeight(lines, fontSize);
      const value = lines.join("\n");
      return {
        ...base(
          "text",
          x,
          y,
          width,
          height,
          { stroke: color, fill: "transparent", dash: "solid" },
          customData,
        ),
        strokeWidth: 1,
        text: value,
        originalText: value,
        fontSize,
        fontFamily: FONT_MONO,
        textAlign: align,
        verticalAlign: "top",
        containerId: null,
        lineHeight: LINE_HEIGHT,
        autoResize: true,
      };
    },
    arrow(x, y, points, style, customData) {
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      return {
        ...base(
          "arrow",
          x,
          y,
          Math.max(...xs) - Math.min(...xs),
          Math.max(...ys) - Math.min(...ys),
          style,
          customData,
        ),
        points,
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead: null,
        endArrowhead: "arrow",
        elbowed: false,
      };
    },
  };
}

const rectOf = (o) => ({
  x1: o.x,
  y1: o.y,
  x2: o.x + o.width,
  y2: o.y + o.height,
});
const rectsOverlap = (a, b) =>
  a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

// Axis-aligned segments only (every route we emit is orthogonal), so a segment
// hits a rect exactly when its own bounding strip overlaps that rect.
const segRect = (p, q) => ({
  x1: Math.min(p.x, q.x) - STRIP,
  y1: Math.min(p.y, q.y) - STRIP,
  x2: Math.max(p.x, q.x) + STRIP,
  y2: Math.max(p.y, q.y) + STRIP,
});
const segHitsRect = (p, q, r) =>
  rectsOverlap(
    {
      x1: Math.min(p.x, q.x),
      y1: Math.min(p.y, q.y),
      x2: Math.max(p.x, q.x),
      y2: Math.max(p.y, q.y),
    },
    r,
  );

const toPoints = (x, y, rel) =>
  rel.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));

function pathHitsAny(points, obstacles) {
  for (let i = 1; i < points.length; i++) {
    for (const o of obstacles) {
      if (segHitsRect(points[i - 1], points[i], o)) return true;
    }
  }
  return false;
}

// Route that leaves through a row gap, runs out to a clear vertical lane to the
// right of all columns, and re-enters through the target's row gap. Row gaps and
// the lane hold no boxes by construction, so this never crosses a node.

// Attachment points ("ports"). Several edges meeting one box must not all land
// on its centre, or they stack into one line on approach and their paths become
// indistinguishable. Each side spreads its edges across the middle 60% of it.
const PORT_LO = 0.2;
const PORT_HI = 0.8;

function portPoint(box, side, frac) {
  switch (side) {
    case "top":
      return { x: box.x + box.width * frac, y: box.y };
    case "bottom":
      return { x: box.x + box.width * frac, y: box.y + box.height };
    case "left":
      return { x: box.x, y: box.y + box.height * frac };
    default:
      return { x: box.x + box.width, y: box.y + box.height * frac };
  }
}

// Which side each end of an edge leaves/enters by, from the relative geometry.
function edgeSides(from, to) {
  if (to.y > from.y + from.height) return { fromSide: "bottom", toSide: "top" };
  if (to.y + to.height < from.y) return { fromSide: "right", toSide: "right" };
  const leftToRight = to.x + to.width / 2 >= from.x + from.width / 2;
  return leftToRight
    ? { fromSide: "right", toSide: "left" }
    : { fromSide: "left", toSide: "right" };
}

// Spread n items across the middle of a side, deterministically.
const spread = (i, n) =>
  n <= 1 ? 0.5 : PORT_LO + ((PORT_HI - PORT_LO) * i) / (n - 1);

// A vertical run between two rows travels the row gap. Two edges crossing the
// same gap get different y for their horizontal leg, so their lines never merge.
function bandY(gapTop, i, n) {
  return gapTop + (ROW_GAP * (i + 1)) / (n + 1);
}

// Orthogonal route from one port to another: out, across the band, in.
function routeThroughBand(start, end, band) {
  if (Math.abs(end.x - start.x) < 1) return [start, end];
  return [start, { x: start.x, y: band }, { x: end.x, y: band }, end];
}

function routeSameRow(start, end) {
  if (Math.abs(end.y - start.y) < 1) return [start, end];
  const midX = (start.x + end.x) / 2;
  return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
}

function routeUpward(start, end, laneX) {
  return [start, { x: laneX, y: start.y }, { x: laneX, y: end.y }, end];
}

function bypassRoute(from, to, laneX, start, end, slottedBand) {
  const down = to.y >= from.y;
  const sOff = down ? ROW_GAP / 2 : -ROW_GAP / 2;
  const tOff = down ? -ROW_GAP / 2 : ROW_GAP / 2;
  // Use the slotted band for the exit leg. Without it a bypassing edge always
  // leaves at mid-gap and collides with whichever band-routed edge holds that y.
  const exitY =
    down && slottedBand !== undefined ? slottedBand : start.y + sOff;
  return [
    start,
    { x: start.x, y: exitY },
    { x: laneX, y: exitY },
    { x: laneX, y: end.y + tOff },
    { x: end.x, y: end.y + tOff },
    end,
  ];
}

function segmentsByLength(path) {
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1];
    const q = path[i];
    segs.push({
      p,
      q,
      len: Math.abs(q.x - p.x) + Math.abs(q.y - p.y),
      vertical: Math.abs(q.y - p.y) >= Math.abs(q.x - p.x),
    });
  }
  // longest first, vertical winning ties: labels read better beside a vertical run
  return segs.sort(
    (a, b) => b.len - a.len || (b.vertical ? 1 : 0) - (a.vertical ? 1 : 0),
  );
}

// Preferred spots first (mid-right of a vertical run, above a horizontal one),
// then a bounded local search outward from the segment. The search is what saves
// crowded panels: a short hop across a 48px gutter has almost no obvious spot
// free, but there is usually one a little further along the same band.
function labelCandidates(seg, w, h) {
  const mid = { x: (seg.p.x + seg.q.x) / 2, y: (seg.p.y + seg.q.y) / 2 };
  const preferred = [];
  if (seg.vertical) {
    const y0 = Math.min(seg.p.y, seg.q.y);
    const span = Math.abs(seg.q.y - seg.p.y);
    for (const dx of [LABEL_GAP, -LABEL_GAP - w]) {
      for (const t of [0.5, 0.35, 0.65]) {
        preferred.push({ x: seg.p.x + dx, y: y0 + span * t - h / 2 });
      }
    }
  } else {
    for (const dy of [-h - 8, 8]) {
      for (const t of [0, -40, 40]) {
        preferred.push({ x: mid.x - w / 2 + t, y: seg.p.y + dy });
      }
    }
  }

  const ring = [];
  const maxDx = Math.round(NODE_W * 1.5);
  const maxDy = ROW_GAP;
  for (let dy = -maxDy; dy <= maxDy; dy += 10) {
    for (let dx = -maxDx; dx <= maxDx; dx += 12) {
      ring.push({
        x: mid.x + dx - w / 2,
        y: mid.y + dy - h / 2,
        d: Math.abs(dx) + Math.abs(dy) * 1.4, // prefer sideways over vertical drift
      });
    }
  }
  ring.sort((a, b) => a.d - b.d);
  return [...preferred, ...ring];
}

// Wrap widths to try, widest first. A narrow wrap is taller but fits the 48px
// gutters between columns, where a single long line never can.
const LABEL_WRAPS = [22, 16, 12, 9];
// A label that fits nowhere at the normal size is retried smaller before the
// build fails. A failed build costs a whole spec rewrite; a 12px label costs
// nothing and is flagged in the report, so it can still be shortened by choice.
const EDGE_FONT_SMALL = 12;
// At 12px a 26-char line is as wide as a 22-char line at 14px, so the smaller
// font buys fewer lines in the same footprint — which is what helps, since a
// crowded label is usually short of height in the row gap, not of width.
const LABEL_WRAPS_SMALL = [26, 22, 16, 12, 9];
const wrapsFor = (font) => (font < EDGE_FONT ? LABEL_WRAPS_SMALL : LABEL_WRAPS);

function placeLabel(...args) {
  const [path, rawLabel, fontSize, hard, soft, bounds, keepOut, what] = args;
  for (const font of [fontSize, EDGE_FONT_SMALL]) {
    const pos = tryPlaceLabel(
      path,
      rawLabel,
      font,
      hard,
      soft,
      bounds,
      keepOut,
      wrapsFor(font),
    );
    if (pos) return { ...pos, font };
  }
  // Fail with the longest length that would have fitted, verified by placing it,
  // so the retry is a one-line edit rather than a guess.
  let lo = 0;
  let hi = rawLabel.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const cut = rawLabel.slice(0, mid).trim();
    const ok =
      cut &&
      tryPlaceLabel(
        path,
        cut,
        EDGE_FONT_SMALL,
        hard,
        soft,
        bounds,
        keepOut,
        LABEL_WRAPS_SMALL,
      );
    if (ok) lo = mid;
    else hi = mid - 1;
  }
  throw new Error(
    lo > 0
      ? `label ${what} has no free spot — shorten it to ≤ ${lo} chars, or put ` +
        `its two nodes on rows or cols further apart`
      : `label ${what} has no free spot at any length — put its two nodes on ` +
        `rows or cols further apart, or drop the label`,
  );
}

function tryPlaceLabel(
  path,
  rawLabel,
  fontSize,
  hard,
  soft,
  bounds,
  keepOut,
  wraps,
) {
  const segs = segmentsByLength(path).filter((seg) => seg.len >= 8);
  const inside = (r) =>
    r.x1 >= bounds.x1 + BOUNDS_INSET &&
    r.x2 <= bounds.x2 - BOUNDS_INSET &&
    r.y1 >= bounds.y1 + BOUNDS_INSET &&
    r.y2 <= bounds.y2 - BOUNDS_INSET;
  // Off-canvas text is clipped and unreadable; text sitting in a neighbouring
  // panel reads as belonging to that panel. Both are hard limits. Overhanging
  // this panel's own dashed frame by a few px is only cosmetic, so it is the
  // constraint that gets relaxed last.
  const legal = (r) =>
    r.x1 >= 0 && r.y1 >= 0 && !keepOut.some((k) => rectsOverlap(r, k));
  const tiers = [
    (r, obs) => inside(r) && legal(r) && !obs.some((o) => rectsOverlap(r, o)),
    (r, obs) => legal(r) && !obs.some((o) => rectsOverlap(r, o)),
  ];
  for (const [obstacles, accept] of [
    [[...hard, ...soft], tiers[0]],
    [[...hard, ...soft], tiers[1]],
    [hard, tiers[0]],
    [hard, tiers[1]],
  ]) {
    for (const maxChars of wraps) {
      const lines = wrap(rawLabel, maxChars);
      const w = textWidth(lines, fontSize);
      const h = textHeight(lines, fontSize);
      for (const seg of segs) {
        for (const c of labelCandidates(seg, w, h)) {
          const r = { x1: c.x, y1: c.y, x2: c.x + w, y2: c.y + h };
          // Caller records the placement — this list may be a temporary.
          if (accept(r, obstacles)) {
            return { x: c.x, y: c.y, w, h, lines, wrap: maxChars };
          }
        }
      }
    }
  }
  return null;
}

function layoutPanel(panel, index, nodeWidth, flows) {
  if (!Array.isArray(panel.nodes) || !panel.nodes.length) {
    throw new Error(`panel ${index} ("${panel.label}") has no nodes`);
  }
  const fit = (fontSize) =>
    Math.floor((nodeWidth - 2 * NODE_PAD) / (fontSize * CHAR_RATIO));
  const maxChars = fit(NODE_FONT);
  const seen = new Set();
  const nodes = panel.nodes.map((node) => {
    if (!node.id) throw new Error(`panel ${index} has a node without an id`);
    if (seen.has(node.id)) {
      throw new Error(`panel ${index} has duplicate node id "${node.id}"`);
    }
    seen.add(node.id);
    const lines = wrap(node.text ?? node.id, maxChars);
    const detailLines = node.detail
      ? wrap(node.detail, fit(DETAIL_FONT))
      : null;
    const stack =
      textHeight(lines, NODE_FONT) +
      (detailLines ? DETAIL_GAP + textHeight(detailLines, DETAIL_FONT) : 0);
    return {
      ...node,
      row: Number(node.row ?? 0),
      col: Number(node.col ?? 0),
      lines,
      detailLines,
      style: styleForElement(node, flows, `node "${node.id}"`),
      needH: stack + 2 * NODE_PAD,
    };
  });

  const cols = [...new Set(nodes.map((n) => n.col))].sort((a, b) => a - b);
  const rows = [...new Set(nodes.map((n) => n.row))].sort((a, b) => a - b);
  const colX = new Map(cols.map((c, i) => [c, i * (nodeWidth + COL_GAP)]));
  const rowY = new Map();
  const rowH = new Map();
  let cursor = 0;
  for (const row of rows) {
    const height = Math.max(
      NODE_H,
      ...nodes.filter((n) => n.row === row).map((n) => n.needH),
    );
    rowH.set(row, height);
    rowY.set(row, cursor);
    cursor += height + ROW_GAP;
  }
  const contentW = cols.length * nodeWidth + (cols.length - 1) * COL_GAP;
  const contentH = cursor - ROW_GAP;

  for (const node of nodes) {
    node.localX = colX.get(node.col);
    node.localY = rowY.get(node.row);
    node.h = rowH.get(node.row);
    node.rel = {
      x: node.localX,
      y: node.localY,
      width: nodeWidth,
      height: node.h,
    };
  }

  // Decide each edge's route here, in panel-relative space, so the number of
  // bypass lanes is known before the frame width is fixed.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let lanes = 0;
  const plan = (panel.edges ?? []).map((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from) {
      throw new Error(
        `panel ${index} edge references unknown node "${edge.from}"${at(edge)}`,
      );
    }
    if (!to) {
      throw new Error(
        `panel ${index} edge references unknown node "${edge.to}"${at(edge)}`,
      );
    }
    const style = styleForElement(
      edge,
      flows,
      `edge "${edge.from}"->"${edge.to}"`,
    );
    const [sx, sy, rel] = edgePoints(from.rel, to.rel);
    const obstacles = nodes
      .filter((n) => n !== from && n !== to)
      .map((n) => rectOf(n.rel));
    const straight = toPoints(sx, sy, rel);
    const bypass = pathHitsAny(straight, obstacles);
    const sides = edgeSides(from.rel, to.rel);
    return {
      edge,
      style,
      from,
      to,
      bypass,
      ...sides,
      lane: bypass ? lanes++ : null,
    };
  });

  // A blocked edge steps around the obstacle through the nearest free lane.
  // Sending it out past every column is what makes it cross unrelated flows on
  // the way there and back. Interior gaps carry traffic between columns; the
  // lanes outside the first and last column carry none, so on a tie the outside
  // lane is the quieter choice.
  const colXs = cols.map((c) => colX.get(c));
  const detourLanes = [
    ...colXs
      .slice(0, -1)
      .map((x) => ({ x: x + nodeWidth + COL_GAP / 2, interior: true })),
    { x: colXs[colXs.length - 1] + nodeWidth + COL_GAP / 2, interior: false },
    { x: colXs[0] - COL_GAP / 2, interior: false },
  ];
  const takenDetours = [];
  const freeOf = (x, y0, y1) =>
    !takenDetours.some(
      (t) =>
        Math.abs(t.x - x) < 8 && Math.min(t.y1, y1) - Math.max(t.y0, y0) > 6,
    );
  for (const step of plan) {
    if (!step.bypass) continue;
    const obstacles = nodes
      .filter((n) => n !== step.from && n !== step.to)
      .map((n) => rectOf(n.rel));
    const midRef = (step.from.localX + step.to.localX) / 2 + nodeWidth / 2;
    const candidates = [...detourLanes]
      .sort(
        (a, b) =>
          Math.abs(a.x - midRef) - Math.abs(b.x - midRef) ||
          Number(a.interior) - Number(b.interior),
      )
      .flatMap(({ x }) => [x, x - DETOUR_NUDGE, x + DETOUR_NUDGE]);
    const exitY = step.from.localY + step.from.h + ROW_GAP / 2;
    const entryY = step.to.localY - ROW_GAP / 2;
    const sxc = step.from.localX + nodeWidth / 2;
    const txc = step.to.localX + nodeWidth / 2;
    step.detourX = candidates.find(
      (x) =>
        freeOf(x, Math.min(exitY, entryY), Math.max(exitY, entryY)) &&
        !pathHitsAny(
          [
            { x: sxc, y: step.from.localY + step.from.h },
            { x: sxc, y: exitY },
            { x, y: exitY },
            { x, y: entryY },
            { x: txc, y: entryY },
            { x: txc, y: step.to.localY },
          ],
          obstacles,
        ),
    );
    if (step.detourX === undefined) {
      // Nothing local worked — fall back to a dedicated lane outside the columns.
      step.lane = lanes++;
    } else {
      step.lane = null;
      takenDetours.push({
        x: step.detourX,
        y0: Math.min(exitY, entryY),
        y1: Math.max(exitY, entryY),
      });
    }
  }
  lanes = plan.filter((st) => st.lane !== null && st.lane !== undefined).length;
  plan
    .filter((st) => st.lane !== null && st.lane !== undefined)
    .forEach((st, i) => {
      st.lane = i;
    });

  // Slot the horizontal legs. Each edge registers in the gap it leaves through
  // and, when they differ, the gap it enters through, so no two edges share a y.
  const rowIndex = new Map(rows.map((r, i) => [r, i]));
  const gapMembers = new Map();
  const register = (gap, step, which) => {
    if (!gapMembers.has(gap)) gapMembers.set(gap, []);
    gapMembers.get(gap).push({ step, which });
  };
  for (const step of plan) {
    if (step.fromSide !== "bottom") continue;
    step.exitGap = rowIndex.get(step.from.row);
    step.entryGap = rowIndex.get(step.to.row) - 1;
    register(step.exitGap, step, "exitY");
    if (step.entryGap !== step.exitGap) register(step.entryGap, step, "entryY");
  }
  for (const [gap, members] of gapMembers) {
    const ref = (m) => (m.step.from.localX + m.step.to.localX) / 2;
    members.sort((a, b) => ref(a) - ref(b));
    const rowAbove = rows[gap];
    const anchorNode = nodes.find((n) => n.row === rowAbove);
    const gapTop = anchorNode.localY + anchorNode.h;
    members.forEach((m, i) => {
      m.step[m.which] = bandY(gapTop, i, members.length);
    });
  }

  // Ports last, ordered by the direction each edge actually approaches from, so
  // an edge coming from the right lands on the right and the lines do not cross
  // on the way in.
  const bySide = new Map();
  for (const step of plan) {
    for (const end of ["from", "to"]) {
      const node = step[end];
      const side = end === "from" ? step.fromSide : step.toSide;
      const key = `${node.id}|${side}`;
      if (!bySide.has(key)) bySide.set(key, []);
      bySide.get(key).push({ step, end, side });
    }
  }
  for (const group of bySide.values()) {
    const approach = (m) => {
      if (m.step.detourX !== undefined) return m.step.detourX;
      const other = m.end === "from" ? m.step.to.rel : m.step.from.rel;
      return m.side === "top" || m.side === "bottom"
        ? other.x + nodeWidth / 2
        : other.y;
    };
    group.sort((a, b) => approach(a) - approach(b));
    group.forEach((m, i) => {
      const jitter = (((m.step.exitGap ?? 0) % 3) - 1) * 0.04;
      const frac = spread(i, group.length) + jitter;
      if (m.end === "from") m.step.fromFrac = frac;
      else m.step.toFrac = frac;
    });
  }

  // Two vertical legs in the same column, overlapping in y, must not share an x.
  // Port order is set by approach direction, which cannot see this: the legs may
  // belong to different boxes (one leaving, one arriving) that happen to line up.
  const legs = plan.flatMap((step) => {
    if (step.fromSide !== "bottom" || step.exitY === undefined) return [];
    const entry = step.entryY ?? step.exitY;
    return [
      {
        step,
        end: "from",
        col: step.from.col,
        y0: step.from.localY + step.from.h,
        y1: step.exitY,
      },
      { step, end: "to", col: step.to.col, y0: entry, y1: step.to.localY },
    ];
  });
  const fracOf = (leg) =>
    leg.end === "from" ? leg.step.fromFrac : leg.step.toFrac;
  const setFrac = (leg, v) => {
    if (leg.end === "from") leg.step.fromFrac = v;
    else leg.step.toFrac = v;
  };
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i < legs.length; i++) {
      for (let j = i + 1; j < legs.length; j++) {
        const a = legs[i];
        const b = legs[j];
        if (a.step === b.step || a.col !== b.col) continue;
        const yOverlap =
          Math.min(Math.max(a.y0, a.y1), Math.max(b.y0, b.y1)) -
          Math.max(Math.min(a.y0, a.y1), Math.min(b.y0, b.y1));
        if (yOverlap <= 6) continue;
        if (Math.abs(fracOf(a) - fracOf(b)) * nodeWidth >= 8) continue;
        const push = fracOf(b) >= fracOf(a) ? 0.12 : -0.12;
        setFrac(b, Math.min(0.92, Math.max(0.08, fracOf(b) + push)));
        moved = true;
      }
    }
    if (!moved) break;
  }

  const laneRoom = lanes ? COL_GAP / 2 + lanes * BYPASS_LANE_STEP : 0;
  return {
    panel,
    index,
    nodes,
    plan,
    baseContentW: contentW,
    contentW: contentW + laneRoom,
    contentH,
  };
}

function edgePoints(from, to) {
  const fromCx = from.x + from.width / 2;
  const toCx = to.x + to.width / 2;
  const downward = to.y > from.y + from.height;
  const upward = to.y + to.height < from.y;

  if (downward) {
    const sx = fromCx;
    const sy = from.y + from.height;
    const dx = toCx - sx;
    const dy = to.y - sy;
    if (Math.abs(dx) < 1)
      return [
        sx,
        sy,
        [
          [0, 0],
          [0, dy],
        ],
      ];
    const mid = dy / 2;
    return [
      sx,
      sy,
      [
        [0, 0],
        [0, mid],
        [dx, mid],
        [dx, dy],
      ],
    ];
  }
  if (upward) {
    const sx = from.x + from.width;
    const sy = from.y + from.height / 2;
    const lane = COL_GAP / 2 + 12;
    const ex = to.x + to.width;
    const ey = to.y + to.height / 2;
    return [
      sx,
      sy,
      [
        [0, 0],
        [lane, 0],
        [lane, ey - sy],
        [ex - sx, ey - sy],
      ],
    ];
  }
  // same band: straight horizontal, entering the nearer side
  const leftToRight = toCx >= fromCx;
  const sx = leftToRight ? from.x + from.width : from.x;
  const sy = from.y + from.height / 2;
  const ex = leftToRight ? to.x : to.x + to.width;
  const ey = to.y + to.height / 2;
  return [
    sx,
    sy,
    [
      [0, 0],
      [ex - sx, ey - sy],
    ],
  ];
}

// Final gate. Routing and label placement should make these impossible; this
// catches the case they did not, so a broken diagram fails loudly instead of
// being written to disk and spotted by eye later.
export function findCollisions(scene) {
  const els = scene.elements.filter((e) => !e.isDeleted);
  const nodes = els.filter((e) => e.customData?.role === "node");
  const texts = els.filter(
    (e) =>
      e.type === "text" &&
      ["nodeLabel", "nodeDetail", "edgeLabel"].includes(e.customData?.role),
  );
  const arrows = els.filter((e) => e.type === "arrow");
  const found = [];
  const soft = [];

  for (const a of arrows) {
    const path = a.points.map(([dx, dy]) => ({ x: a.x + dx, y: a.y + dy }));
    const ends = [a.customData?.from, a.customData?.to];
    const where = `${a.customData?.from} -> ${a.customData?.to} (panel ${a.customData?.panel})${at(a.customData)}`;
    for (let i = 1; i < path.length; i++) {
      for (const n of nodes) {
        if (n.customData.panel !== a.customData?.panel) continue;
        if (ends.includes(n.customData.key)) continue;
        if (segHitsRect(path[i - 1], path[i], rectOf(n))) {
          found.push(
            `arrow ${where} crosses node "${n.customData.key}" — move ` +
              `"${n.customData.key}" to another col, or put ${a.customData?.from} ` +
              `and ${a.customData?.to} on adjacent rows`,
          );
        }
      }
      for (const t of texts) {
        if (t.customData?.panel !== a.customData?.panel) continue;
        if (t.customData?.of === a.id) continue;
        const owner = nodes.find((n) => n.id === t.customData?.of);
        if (owner && ends.includes(owner.customData.key)) continue;
        if (segHitsRect(path[i - 1], path[i], rectOf(t))) {
          soft.push(
            `arrow ${where} crosses text "${t.text.replace(/\n/g, " ")}"`,
          );
        }
      }
    }
  }

  // Two arrows sharing a stretch of the same line is the worst kind of collision:
  // where the shared run is long enough, the two paths become interchangeable to
  // a reader, and colour does not save it when both edges are the same colour.
  const segsOf = (a) => {
    const pts = a.points.map(([dx, dy]) => ({ x: a.x + dx, y: a.y + dy }));
    const out = [];
    for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]]);
    return out;
  };
  const overlap = (lo1, hi1, lo2, hi2) =>
    Math.min(hi1, hi2) - Math.max(lo1, lo2);
  for (let i = 0; i < arrows.length; i++) {
    for (let j = i + 1; j < arrows.length; j++) {
      const a = arrows[i];
      const b = arrows[j];
      if (a.customData?.panel !== b.customData?.panel) continue;
      const name =
        `${a.customData?.from} -> ${a.customData?.to}${at(a.customData)}` +
        ` and ${b.customData?.from} -> ${b.customData?.to}${at(b.customData)}`;
      for (const [ap, aq] of segsOf(a)) {
        for (const [bp, bq] of segsOf(b)) {
          const aVert = Math.abs(aq.x - ap.x) < 1;
          const bVert = Math.abs(bq.x - bp.x) < 1;
          const aHoriz = Math.abs(aq.y - ap.y) < 1;
          const bHoriz = Math.abs(bq.y - bp.y) < 1;
          if (aVert && bVert && Math.abs(ap.x - bp.x) < 2) {
            const shared = overlap(
              Math.min(ap.y, aq.y),
              Math.max(ap.y, aq.y),
              Math.min(bp.y, bq.y),
              Math.max(bp.y, bq.y),
            );
            if (shared > COLLINEAR_TOLERANCE) {
              found.push(
                `${name} share ${Math.round(shared)}px of one vertical line — ` +
                  `move one of their nodes to a different col`,
              );
            }
          }
          if (aHoriz && bHoriz && Math.abs(ap.y - bp.y) < 2) {
            const shared = overlap(
              Math.min(ap.x, aq.x),
              Math.max(ap.x, aq.x),
              Math.min(bp.x, bq.x),
              Math.max(bp.x, bq.x),
            );
            if (shared > COLLINEAR_TOLERANCE) {
              found.push(
                `${name} share ${Math.round(shared)}px of one horizontal line — ` +
                  `move one of their nodes to a different row`,
              );
            }
          }
        }
      }
    }
  }

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (rectsOverlap(rectOf(texts[i]), rectOf(texts[j]))) {
        found.push(
          `text "${texts[i].text.replace(/\n/g, " ")}" overlaps ` +
            `"${texts[j].text.replace(/\n/g, " ")}"`,
        );
      }
    }
  }
  return { errors: [...new Set(found)], warnings: [...new Set(soft)] };
}

export function assertNoCollisions(scene) {
  const { errors, warnings } = findCollisions(scene);
  if (errors.length) {
    throw new Error(
      `diagram has ${errors.length} collision(s):\n  - ${errors.join("\n  - ")}\n` +
        `Fix the spec: shorten labels, or move nodes to different rows/cols.`,
    );
  }
  scene.warnings = warnings;
  return scene;
}

// ---------------------------------------------------------------------------
// .flow — a line-based spec format. The same diagram costs roughly half the
// tokens to write as JSON, because there are no keys, quotes or braces, and
// layout falls out of line order: each row line is the next row, and each
// comma-separated cell on it is the next column.
//
//   title: <text>            width: <n>            out: <path>
//   flow <key>: <label> [#rrggbb]
//   node <id>: <text> [| <detail>]     (inside a panel: overrides for that panel)
//   panel <label>
//     <id> [mods], _, <id> [mods]      (a row; _ holds a column open)
//     <id> -> <id> [mods] [: <label>]  (an edge)
//   // comment
//
// mods: added | removed | problem | @<flow>
// ---------------------------------------------------------------------------
const FLOW_ID = /^[A-Za-z0-9_]+$/;
const FLOW_KINDS = new Set(["added", "removed", "problem", "normal"]);

const at = (el) => (el?.src ? ` (spec line ${el.src})` : "");

function splitText(value) {
  const i = value.indexOf("|");
  return i === -1
    ? { text: value.trim() }
    : { text: value.slice(0, i).trim(), detail: value.slice(i + 1).trim() };
}

function parseMods(tokens, lineNo, what) {
  const mods = {};
  for (const token of tokens) {
    if (FLOW_KINDS.has(token)) {
      if (token !== "normal") mods.kind = token;
    } else if (/^@[A-Za-z0-9_]+$/.test(token)) {
      mods.flow = token.slice(1);
    } else {
      throw new Error(
        `line ${lineNo}: unknown modifier "${token}" on ${what} — ` +
          `expected added, removed, problem or @<flow>`,
      );
    }
  }
  return mods;
}

export function parseFlow(text) {
  const spec = { panels: [] };
  const shared = {};
  let panel = null;
  let row = -1;

  String(text)
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const n = i + 1;
      const line = raw.trim();
      if (!line || line.startsWith("//")) return;
      let m;
      if ((m = /^title:\s*(.+)$/.exec(line))) {
        spec.title = m[1].trim();
      } else if ((m = /^width:\s*(\d+)$/.exec(line))) {
        spec.nodeWidth = Number(m[1]);
      } else if ((m = /^out:\s*(.+)$/.exec(line))) {
        spec.out = m[1].trim();
      } else if (
        (m = /^flow\s+([A-Za-z0-9_]+):\s*(.+?)(?:\s+(#[0-9a-fA-F]{6}))?$/.exec(
          line,
        ))
      ) {
        spec.flows ??= {};
        spec.flows[m[1]] = m[3] ? { label: m[2], color: m[3] } : m[2];
      } else if ((m = /^node\s+([A-Za-z0-9_]+):\s*(.+)$/.exec(line))) {
        const def = { ...splitText(m[2]), src: n };
        if (panel) panel.overrides[m[1]] = def;
        else shared[m[1]] = def;
      } else if ((m = /^panel\s+(.+)$/.exec(line))) {
        panel = { label: m[1].trim(), nodes: [], edges: [], overrides: {} };
        spec.panels.push(panel);
        row = -1;
      } else if (!panel) {
        throw new Error(
          `line ${n}: "${line}" is not a title, width, out, flow, node or panel line`,
        );
      } else if (
        (m =
          /^([A-Za-z0-9_]+)\s*->\s*([A-Za-z0-9_]+)((?:\s+[^:\s]+)*)\s*(?::\s*(.*))?$/.exec(
            line,
          ))
      ) {
        const mods = parseMods(
          m[3].trim().split(/\s+/).filter(Boolean),
          n,
          `edge ${m[1]} -> ${m[2]}`,
        );
        const edge = { from: m[1], to: m[2], ...mods, src: n };
        if (m[4]?.trim()) edge.label = m[4].trim();
        panel.edges.push(edge);
      } else {
        row += 1;
        line.split(",").forEach((cell, col) => {
          const tokens = cell.trim().split(/\s+/).filter(Boolean);
          if (!tokens.length) {
            throw new Error(
              `line ${n}: empty cell — write _ to leave a cell empty`,
            );
          }
          if (tokens[0] === "_") return;
          if (!FLOW_ID.test(tokens[0])) {
            throw new Error(
              `line ${n}: "${tokens[0]}" is not a node id (letters, digits, _)`,
            );
          }
          const mods = parseMods(tokens.slice(1), n, `node ${tokens[0]}`);
          panel.nodes.push({ id: tokens[0], row, col, ...mods, src: n });
        });
      }
    });

  for (const p of spec.panels) {
    for (const node of p.nodes) {
      const def = p.overrides[node.id] ?? shared[node.id];
      if (!def) {
        throw new Error(
          `line ${node.src}: node "${node.id}" has no "node ${node.id}: <text>" line`,
        );
      }
      node.text = def.text;
      if (def.detail) node.detail = def.detail;
    }
    delete p.overrides;
  }
  return spec;
}

// Accepts a .flow string or a JSON spec. JSON may declare `nodes` once at the
// top (id → "text | detail" or { text, detail }) and reference them by id in each
// panel; an omitted row means the row after the previous node, an omitted col 0.
function normalizeSpec(input) {
  const spec = typeof input === "string" ? parseFlow(input) : input;
  if (!spec || !Array.isArray(spec.panels)) return spec;
  const shared =
    spec.nodes && typeof spec.nodes === "object" && !Array.isArray(spec.nodes)
      ? spec.nodes
      : {};
  const defOf = (v) => (typeof v === "string" ? splitText(v) : (v ?? {}));
  return {
    ...spec,
    panels: spec.panels.map((panel) => {
      let lastRow = -1;
      return {
        ...panel,
        nodes: (panel.nodes ?? []).map((node) => {
          const def = defOf(shared[node.id]);
          const row = node.row ?? lastRow + 1;
          lastRow = Number(row);
          return {
            ...node,
            text: node.text ?? def.text,
            detail: node.detail ?? def.detail,
            row,
            col: node.col ?? 0,
          };
        }),
      };
    }),
  };
}

export function buildScene(input) {
  const spec = normalizeSpec(input);
  if (!spec || !Array.isArray(spec.panels) || !spec.panels.length) {
    throw new Error("spec needs at least one panel");
  }
  const nodeWidth = spec.nodeWidth ?? NODE_W;
  if (
    typeof nodeWidth !== "number" ||
    !Number.isFinite(nodeWidth) ||
    nodeWidth < NODE_W_MIN ||
    nodeWidth > NODE_W_MAX
  ) {
    throw new Error(
      `nodeWidth ${nodeWidth} is out of range — expected ${NODE_W_MIN}..${NODE_W_MAX}`,
    );
  }
  const f = makeFactory();
  const flows = resolveFlows(spec);
  const laid = spec.panels.map((panel, i) =>
    layoutPanel(panel, i, nodeWidth, flows),
  );
  const frameH = Math.max(...laid.map((p) => p.contentH)) + 2 * PANEL_PAD;
  const frameStyle = { stroke: "#adb5bd", fill: "transparent", dash: "dashed" };

  let frameX = 0;
  const elements = [];
  const usedKinds = new Set();
  const usedFlows = new Set();

  if (spec.title) {
    elements.push(
      f.text(
        0,
        TITLE_Y,
        wrap(spec.title, 200),
        TITLE_FONT,
        "#1e1e1e",
        { role: "title" },
        "left",
      ),
    );
  }

  // Frame rects are fully determined by content width, so precompute them all:
  // label placement needs to know where the neighbouring panels are.
  const frameRects = [];
  {
    let x = 0;
    for (const p of laid) {
      const w = Math.max(PANEL_MIN_W, p.contentW + 2 * PANEL_PAD);
      frameRects.push({ x1: x, y1: FRAME_Y, x2: x + w, y2: FRAME_Y + frameH });
      x += w + PANEL_GAP;
    }
  }

  for (const p of laid) {
    const frameW = Math.max(PANEL_MIN_W, p.contentW + 2 * PANEL_PAD);
    const otherFrames = frameRects.filter((_, i) => i !== p.index);
    elements.push(
      f.rect(frameX, FRAME_Y, frameW, frameH, frameStyle, {
        role: "panel",
        panel: p.index,
        label: p.panel.label ?? `panel ${p.index}`,
      }),
    );
    elements.push(
      f.text(
        frameX,
        PANEL_LABEL_Y,
        [String(p.panel.label ?? `panel ${p.index}`)],
        PANEL_LABEL_FONT,
        "#495057",
        { role: "panelLabel", panel: p.index },
        "left",
      ),
    );

    const boxes = new Map();
    for (const node of p.nodes) {
      if (node.flow) usedFlows.add(node.flow);
      else usedKinds.add(node.kind || "normal");
      const box = f.rect(
        frameX + PANEL_PAD + node.localX,
        FRAME_Y + PANEL_PAD + node.localY,
        nodeWidth,
        node.h,
        node.style,
        { role: "node", panel: p.index, key: node.id },
      );
      elements.push(box);
      boxes.set(node.id, box);

      // Concept and optional detail are centred as one stack, so a two-part
      // label still sits in the middle of its box.
      const lw = textWidth(node.lines, NODE_FONT);
      const lh = textHeight(node.lines, NODE_FONT);
      const dw = node.detailLines
        ? textWidth(node.detailLines, DETAIL_FONT)
        : 0;
      const dh = node.detailLines
        ? textHeight(node.detailLines, DETAIL_FONT)
        : 0;
      const stackH = lh + (node.detailLines ? DETAIL_GAP + dh : 0);
      const top = box.y + (box.height - stackH) / 2;
      elements.push(
        f.text(
          box.x + (box.width - lw) / 2,
          top,
          node.lines,
          NODE_FONT,
          node.style.stroke === "transparent" ? "#1e1e1e" : node.style.stroke,
          { role: "nodeLabel", panel: p.index, of: box.id },
        ),
      );
      if (node.detailLines) {
        elements.push(
          f.text(
            box.x + (box.width - dw) / 2,
            top + lh + DETAIL_GAP,
            node.detailLines,
            DETAIL_FONT,
            DETAIL_COLOR,
            { role: "nodeDetail", panel: p.index, of: box.id },
          ),
        );
      }
    }

    // Route every edge first, then place labels against the finished picture, so
    // a label can never be dropped onto a box or another edge's line.
    const routed = [];
    for (const step of p.plan) {
      const from = boxes.get(step.from.id);
      const to = boxes.get(step.to.id);
      if (step.edge.flow) usedFlows.add(step.edge.flow);
      else usedKinds.add(step.edge.kind || "normal");
      const start = portPoint(from, step.fromSide, step.fromFrac ?? 0.5);
      const end = portPoint(to, step.toSide, step.toFrac ?? 0.5);
      const abs = (rel) =>
        rel === undefined ? undefined : FRAME_Y + PANEL_PAD + rel;
      const exitY = abs(step.exitY);
      const entryY = abs(step.entryY) ?? exitY;
      let path;
      let route;
      if (step.detourX !== undefined) {
        route = "detour";
        const lane = frameX + PANEL_PAD + step.detourX;
        path = [
          start,
          { x: start.x, y: exitY },
          { x: lane, y: exitY },
          { x: lane, y: entryY },
          { x: end.x, y: entryY },
          end,
        ];
      } else if (step.lane !== null && step.lane !== undefined) {
        const laneX =
          frameX +
          PANEL_PAD +
          p.baseContentW +
          COL_GAP / 2 +
          step.lane * BYPASS_LANE_STEP;
        route = "lane";
        path = bypassRoute(from, to, laneX, start, end, exitY);
      } else if (step.fromSide === "bottom") {
        path = routeThroughBand(
          start,
          end,
          exitY === undefined ? (start.y + end.y) / 2 : exitY,
        );
        route = path.length === 2 ? "straight" : "band";
      } else if (step.fromSide === "right" && step.toSide === "right") {
        route = "upward";
        const laneX =
          Math.max(from.x + from.width, to.x + to.width) + COL_GAP / 2 + 12;
        path = routeUpward(start, end, laneX);
      } else {
        route = "same-row";
        path = routeSameRow(start, end);
      }
      const origin = path[0];
      const arrow = f.arrow(
        origin.x,
        origin.y,
        path.map((pt) => [pt.x - origin.x, pt.y - origin.y]),
        step.style,
        {
          role: "edge",
          panel: p.index,
          from: step.edge.from,
          to: step.edge.to,
          route,
          ...(step.edge.src ? { src: step.edge.src } : {}),
        },
      );
      elements.push(arrow);
      routed.push({ ...step, arrow, path });
    }

    const occupied = p.nodes.map((n) => rectOf(boxes.get(n.id)));
    const stripsOf = (path) => {
      const out = [];
      for (let i = 1; i < path.length; i++)
        out.push(segRect(path[i - 1], path[i]));
      return out;
    };
    for (const r of routed) {
      if (!r.edge.label) continue;
      const others = routed
        .filter((o) => o !== r)
        .flatMap((o) => stripsOf(o.path));
      const pos = placeLabel(
        r.path,
        r.edge.label,
        EDGE_FONT,
        occupied,
        others,
        { x1: frameX, y1: FRAME_Y, x2: frameX + frameW, y2: FRAME_Y + frameH },
        otherFrames,
        `"${r.edge.label}" (${r.edge.from} -> ${r.edge.to}, panel ${p.index})${at(r.edge)}`,
      );
      occupied.push({
        x1: pos.x,
        y1: pos.y,
        x2: pos.x + pos.w,
        y2: pos.y + pos.h,
      });
      elements.push(
        f.text(
          pos.x,
          pos.y,
          pos.lines,
          pos.font,
          r.style.stroke,
          {
            role: "edgeLabel",
            panel: p.index,
            of: r.arrow.id,
            wrap: pos.wrap,
            font: pos.font,
          },
          "left",
        ),
      );
    }

    frameX += frameW + PANEL_GAP;
  }

  const entries = [];
  for (const [key, flow] of flows) {
    if (usedFlows.has(key)) {
      entries.push({
        style: flowStyle(flow),
        label: flow.label,
        meta: { flow: key },
      });
    }
  }
  for (const kind of LEGEND_ORDER) {
    if (usedKinds.has(kind)) {
      entries.push({
        style: KINDS[kind],
        label: LEGEND_LABELS[kind],
        meta: { kind },
      });
    }
  }
  if (entries.length) {
    // Wrap rather than let a long legend run off past the panels.
    const limit = Math.max(frameX - PANEL_GAP, PANEL_MIN_W);
    let x = 0;
    let y = FRAME_Y + frameH + LEGEND_GAP;
    for (const entry of entries) {
      const w = 26 + textWidth([entry.label], EDGE_FONT) + 32;
      if (x > 0 && x + w > limit) {
        x = 0;
        y += 30;
      }
      elements.push(
        f.rect(x, y, 18, 18, entry.style, { role: "legend", ...entry.meta }),
      );
      elements.push(
        f.text(
          x + 26,
          y,
          [entry.label],
          EDGE_FONT,
          "#495057",
          { role: "legend", ...entry.meta },
          "left",
        ),
      );
      x += w;
    }
  }

  return assertNoCollisions({
    type: "excalidraw",
    version: 2,
    source: "https://excalidraw.com",
    elements,
    appState: { gridSize: null, viewBackgroundColor: "#ffffff" },
    files: {},
  });
}

// The extent an element actually covers. An arrow's x/y is its first point and
// its width/height only the span of its points, so for a path that heads left or
// up, x + width overshoots what is drawn by up to the whole span.
export function drawnBounds(e) {
  if (Array.isArray(e.points) && e.points.length) {
    const xs = e.points.map((pt) => e.x + pt[0]);
    const ys = e.points.map((pt) => e.y + pt[1]);
    return {
      x1: Math.min(...xs),
      y1: Math.min(...ys),
      x2: Math.max(...xs),
      y2: Math.max(...ys),
    };
  }
  return { x1: e.x, y1: e.y, x2: e.x + e.width, y2: e.y + e.height };
}

// A short text account of a built scene: shape, how edges were routed, which
// labels had to compromise, and the layout smells a reader would otherwise need
// the rendered image to notice. Printed after every build, so most iterations
// never need a render at all.
// A render was mostly read to spot arrows crossing each other, which the
// collision gate allows. Counting proper crossings answers that in one line.
function segmentsOf(a) {
  const pts = a.points.map(([px, py]) => [a.x + px, a.y + py]);
  return pts.slice(1).map((p, i) => [pts[i], p]);
}

function crossesInside([[ax, ay], [bx, by]], [[cx, cy], [dx, dy]]) {
  const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
  const slack = (len) => 2 / Math.max(len, 1e-9);
  const lenAB = Math.hypot(bx - ax, by - ay);
  const lenCD = Math.hypot(dx - cx, dy - cy);
  return (
    t > slack(lenAB) &&
    t < 1 - slack(lenAB) &&
    u > slack(lenCD) &&
    u < 1 - slack(lenCD)
  );
}

function crossingPairs(arrows) {
  const pairs = [];
  arrows.forEach((a, i) => {
    for (const b of arrows.slice(i + 1)) {
      if (a.customData?.panel !== b.customData?.panel) continue;
      let count = 0;
      for (const s of segmentsOf(a)) {
        for (const t of segmentsOf(b)) if (crossesInside(s, t)) count += 1;
      }
      if (count) pairs.push({ a, b, count });
    }
  });
  return pairs;
}

export function describeScene(scene) {
  const els = scene.elements;
  const role = (r) => els.filter((e) => e.customData?.role === r);
  const panels = role("panel");
  const nodes = role("node");
  const arrows = els.filter((e) => e.type === "arrow");
  const labels = role("edgeLabel");
  const nodeLabels = role("nodeLabel");
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const w = Math.round(Math.max(...els.map((e) => drawnBounds(e).x2)));
  const h = Math.round(Math.max(...els.map((e) => drawnBounds(e).y2)));

  const lines = [
    `${plural(panels.length, "panel")}, ${plural(nodes.length, "node")}, ` +
      `${plural(arrows.length, "edge")} — ${w}×${h}px`,
  ];
  for (const frame of panels) {
    const i = frame.customData.panel;
    const own = nodes.filter((n) => n.customData.panel === i);
    const rows = new Set(own.map((n) => Math.round(n.y))).size;
    const cols = new Set(own.map((n) => Math.round(n.x))).size;
    const edges = arrows.filter((a) => a.customData.panel === i).length;
    lines.push(
      `  ${i + 1} "${frame.customData.label}": ${plural(own.length, "node")}, ` +
        `${plural(edges, "edge")}, ${rows}×${cols} grid`,
    );
  }

  const name = (a) =>
    `${a.customData.from}->${a.customData.to}${a.customData.src ? `@${a.customData.src}` : ""}`;
  const byRoute = {};
  for (const a of arrows) {
    const r = a.customData.route ?? "?";
    (byRoute[r] ??= []).push(a);
  }
  const counts = Object.entries(byRoute)
    .map(([r, list]) => `${list.length} ${r}`)
    .join(", ");
  const bent = [...(byRoute.detour ?? []), ...(byRoute.lane ?? [])];
  lines.push(
    `routes: ${counts || "none"}` +
      (bent.length
        ? ` — detoured: ${bent.map(name).join(", ")} (reordering cols may straighten these)`
        : ""),
  );

  const crossed = crossingPairs(arrows);
  const crossings = crossed.reduce((n, p) => n + p.count, 0);
  lines.push(
    crossings
      ? `crossings: ${crossings} — ${crossed
          .slice(0, 4)
          .map(
            (p) =>
              `${name(p.a)} × ${name(p.b)}${p.count > 1 ? ` (${p.count}×)` : ""}`,
          )
          .join(
            ", ",
          )}${crossed.length > 4 ? ", …" : ""} (moving one node a col often clears these)`
      : "crossings: none",
  );

  const small = labels.filter((l) => (l.customData.font ?? 14) < 14);
  const narrow = labels.filter((l) => (l.customData.wrap ?? 22) < 22);
  const arrowOf = (l) => arrows.find((a) => a.id === l.customData.of);
  lines.push(
    `labels: ${labels.length}` +
      (narrow.length ? `, ${narrow.length} rewrapped narrower` : "") +
      (small.length
        ? `, ${small.length} at 12px: ${small.map((l) => name(arrowOf(l))).join(", ")} (shorten to restore 14px)`
        : ""),
  );

  const tall = nodeLabels.filter((t) => t.text.split("\n").length >= 4);
  if (tall.length) {
    lines.push(
      `tall: ${tall
        .map((t) => `"${t.text.replace(/\n/g, " ").slice(0, 32)}"`)
        .join(", ")} — each lengthens every panel`,
    );
  }
  const touched = new Set(
    arrows.flatMap((a) => [
      `${a.customData.panel}|${a.customData.from}`,
      `${a.customData.panel}|${a.customData.to}`,
    ]),
  );
  const lonely = nodes.filter(
    (n) => !touched.has(`${n.customData.panel}|${n.customData.key}`),
  );
  if (lonely.length) {
    lines.push(
      `unconnected: ${lonely.map((n) => `${n.customData.key} (panel ${n.customData.panel + 1})`).join(", ")}`,
    );
  }
  // The gate never sees an arrow route around the outside of its frame, which
  // is where an edge pointing back up to an earlier row ends up.
  const escaped = arrows.filter((a) => {
    const frame = panels.find((p) => p.customData.panel === a.customData.panel);
    if (!frame) return false;
    const b = drawnBounds(a);
    return (
      b.x1 < frame.x - 1 ||
      b.y1 < frame.y - 1 ||
      b.x2 > frame.x + frame.width + 1 ||
      b.y2 > frame.y + frame.height + 1
    );
  });
  if (escaped.length) {
    lines.push(
      `outside frame: ${escaped.map(name).join(", ")} (end a repeating path in an outcome box instead of an arrow back up)`,
    );
  }
  const warnings = scene.warnings ?? [];
  lines.push(`warnings: ${warnings.length ? warnings.join("; ") : "none"}`);
  return lines.join("\n");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const args = process.argv.slice(2);
  const outFlag = args.indexOf("--out");
  const outArg = outFlag === -1 ? null : args[outFlag + 1];
  const specPath = args.filter(
    (a, i) => !a.startsWith("--") && (outFlag === -1 || i !== outFlag + 1),
  )[0];

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(HELP);
    return;
  }

  const raw = specPath ? readFileSync(specPath, "utf8") : await readStdin();
  const spec = raw.trimStart().startsWith("{")
    ? JSON.parse(raw)
    : parseFlow(raw);
  const scene = buildScene(spec);
  const json = `${JSON.stringify(scene, null, 2)}\n`;

  const out = outArg ?? spec.out;
  if (!out || args.includes("--stdout")) {
    for (const w of scene.warnings ?? []) {
      process.stderr.write(`mkflow warning: ${w}\n`);
    }
    process.stdout.write(json);
    return;
  }
  const target = resolve(out);
  const report = describeScene(scene);
  const previous = args.includes("--full")
    ? null
    : priorReport(target, readFileSync);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, json);
  process.stdout.write(`${target}\n${reportSince(previous, report)}\n`);
}

// The full report is already in context after the first build, so a rebuild
// of the same file only needs what moved.
function priorReport(target, read) {
  try {
    const old = JSON.parse(read(target, "utf8"));
    return old.elements?.some((e) => e.customData?.route)
      ? describeScene(old)
      : null;
  } catch {
    return null;
  }
}

function reportSince(previous, report) {
  if (previous === null) return report;
  const before = new Set(previous.split("\n"));
  const changed = report.split("\n").filter((l) => !before.has(l));
  return changed.length
    ? `changed since the last build (--full prints all):\n${changed.join("\n")}`
    : "report unchanged since the last build (--full prints it)";
}

const HELP = `usage: node mkflow.mjs [spec.flow|spec.json] [--out scene.excalidraw] [--stdout] [--full]
  No spec path reads stdin. Writes to --out or the spec's out:, then prints the
  path and a report; a rebuild of the same file prints only changed lines.
  --stdout  print the scene JSON instead of writing it
  --full    print the whole report on a rebuild

.flow lines (// starts a comment):
  title: <text>                    title above the panels
  width: <px>                      box width, 120-600, default 200
  out: <path>                      output file
  flow <id>: <label> [#rrggbb]     a coloured path; colour auto-assigned if omitted
  node <id>: <text> [| <detail>]   declare once at the top; inside a panel, overrides it there
  panel <label>                    starts a panel; panels run left to right
  a, b, _, c                       a row: each line is the next row, each cell the
                                   next column, _ leaves a cell empty
  a -> b [mods] [: label]          an edge; the label may contain colons
  mods, on cells and edges: added | removed | problem | @<flow> (one per element)
`;

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    const hint = /^line \d+:/.test(err.message)
      ? " (grammar: node mkflow.mjs --help)"
      : "";
    process.stderr.write(`mkflow: ${err.message}${hint}\n`);
    process.exit(1);
  });
}
