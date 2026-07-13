/**
 * Graph renderer for FOL models.
 * Draws domain elements as nodes, unary predicates as coloured fills/rings,
 * binary predicates (relations) as directed edges.
 */

const PRED_COLORS = [
  '#7a1a3a', '#006666', '#2e7d32', '#b45309', '#6b21a8', '#0369a1', '#b71c1c', '#005f5f'
];

// Mutable positions — persisted across re-renders so dragging sticks
let _nodePositions = {};
let _lastDomain    = [];

// Drag state — module-level, set up once
let _dragState = null;
let _dragRenderFn = null;  // set by initDrag, called on every mousemove

// ── Force-directed layout ─────────────────────────────────────────────────────
function forceLayout(domain, W, H, iterations = 120) {
  const n  = domain.length;
  const cx = W / 2, cy = H / 2;

  const domainKey = domain.slice().sort().join(',');
  const prevKey   = _lastDomain.slice().sort().join(',');
  const needReset = domainKey !== prevKey;

  const positions = {};
  if (needReset) {
    const R = Math.min(cx, cy) * 0.60;
    if (n === 1) {
      positions[domain[0]] = { x: cx, y: cy };
    } else {
      domain.forEach((el, i) => {
        const angle = (2 * Math.PI * i / n) - Math.PI / 2;
        positions[el] = { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) };
      });
    }
    _nodePositions = positions;
    _lastDomain    = domain.slice();
  } else {
    domain.forEach(el => {
      const p = _nodePositions[el];
      if (p) {
        positions[el] = { x: Math.max(64, Math.min(W - 64, p.x)), y: Math.max(64, Math.min(H - 64, p.y)) };
      } else {
        positions[el] = { x: cx + (Math.random() - 0.5) * W * 0.5, y: cy + (Math.random() - 0.5) * H * 0.5 };
      }
    });
  }

  if (n <= 1 || !needReset) return positions;

  // Fruchterman-Reingold repulsion + center gravity
  const k = Math.sqrt((W * H) / n) * 0.8;

  for (let iter = 0; iter < iterations; iter++) {
    const cooling = 1 - iter / iterations;
    const forces  = {};
    domain.forEach(el => { forces[el] = { x: 0, y: 0 }; });

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = domain[i], b = domain[j];
        const dx   = positions[b].x - positions[a].x;
        const dy   = positions[b].y - positions[a].y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const rep  = (k * k) / dist;
        forces[a].x -= rep * dx / dist;
        forces[a].y -= rep * dy / dist;
        forces[b].x += rep * dx / dist;
        forces[b].y += rep * dy / dist;
      }
    }

    domain.forEach(el => {
      forces[el].x += (cx - positions[el].x) * 0.03;
      forces[el].y += (cy - positions[el].y) * 0.03;
    });

    const maxDisp = k * cooling;
    domain.forEach(el => {
      const fx   = forces[el].x, fy = forces[el].y;
      const flen = Math.max(Math.sqrt(fx * fx + fy * fy), 0.001);
      const disp = Math.min(flen, maxDisp);
      const pad  = 90;  // must exceed loop bulge (~85) so self-loop arcs aren't clipped
      positions[el].x = Math.max(pad, Math.min(W - pad, positions[el].x + (fx / flen) * disp));
      positions[el].y = Math.max(pad, Math.min(H - pad, positions[el].y + (fy / flen) * disp));
    });
  }

  _nodePositions = { ..._nodePositions, ...positions };
  return positions;
}

// ── SVG drawing helpers ───────────────────────────────────────────────────────
function svgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ── Main render function ──────────────────────────────────────────────────────
// Accepts an optional `positions` override (used during drag redraws).
function renderGraph(model, sig, posOverride) {
  const svg          = document.getElementById('graph-svg');
  const edgeG        = document.getElementById('graph-edges');
  const nodeG        = document.getElementById('graph-nodes');
  const legendItems  = document.getElementById('legend-items');
  const graphEmpty   = document.getElementById('graph-empty');
  const graphLegend  = document.getElementById('graph-legend');
  const graphSubtitle = document.getElementById('graph-subtitle');

  edgeG.innerHTML    = '';
  nodeG.innerHTML    = '';
  legendItems.innerHTML = '';

  // Rebuild <defs> from scratch to prevent marker color leaks
  let defs = svg.querySelector('defs');
  if (defs) defs.remove();
  defs = svgEl('defs', {});
  svg.insertBefore(defs, svg.firstChild);

  const domain = model.domain;
  if (!domain || domain.length === 0) {
    graphEmpty.hidden  = true;
    graphLegend.hidden = true;
    graphSubtitle.textContent = '';
    _dragRenderFn = () => renderGraph(model, sig);
    return;
  }

  graphEmpty.hidden = true;

  const W     = svg.parentElement.clientWidth  || 400;
  const H     = svg.parentElement.clientHeight || 420;
  const n     = domain.length;
  const nodeR = Math.min(26, Math.max(16, Math.round(140 / Math.max(n, 1))));

  // Use override positions during drag, otherwise compute/retrieve
  const positions = posOverride || forceLayout(domain, W, H);

  // ── Classify & color predicates ───────────────────────────────────────────
  const unaryPreds  = Object.entries(sig.predicates).filter(([, ar]) => ar === 1).map(([nm]) => nm);
  const binaryPreds = Object.entries(sig.predicates).filter(([, ar]) => ar === 2).map(([nm]) => nm);
  const higherPreds = Object.entries(sig.predicates).filter(([, ar]) => ar >= 3);  // [name, arity]

  const predColors = {};
  let colorIdx = 0;
  [...unaryPreds, ...binaryPreds].forEach(p => {
    predColors[p] = PRED_COLORS[colorIdx++ % PRED_COLORS.length];
  });

  // ── Per-node outward direction (away from all neighbours) ──────────────────
  // Used for: self-loop placement, constant labels, predicate labels.
  const nodeOutDir = {};
  const hasSelfLoop = new Set();
  domain.forEach(el => {
    let sx = 0, sy = 0, count = 0;
    binaryPreds.forEach(relName => {
      (model.interp[relName] || []).forEach(([a, b]) => {
        if (a === el && b === el) { hasSelfLoop.add(el); return; }  // self-loop
        const other = a === el ? b : (b === el ? a : null);
        if (other && other !== el && positions[other]) {
          const dx = positions[other].x - positions[el].x;
          const dy = positions[other].y - positions[el].y;
          const d  = Math.sqrt(dx * dx + dy * dy) || 1;
          sx += dx / d; sy += dy / d; count++;
        }
      });
    });
    if (count > 0) {
      const len = Math.sqrt(sx * sx + sy * sy) || 1;
      nodeOutDir[el] = { dx: -sx / len, dy: -sy / len };
    } else {
      nodeOutDir[el] = { dx: 0, dy: -1 };  // default: straight up
    }
  });

  // ── Per-node label direction ──────────────────────────────────────────────
  // When a node has a self-loop, the loop arc occupies the outward direction.
  // Rotate 90° to keep labels clear of the loop. Choose the rotation that
  // points most upward (negative y) so labels stay near the top of the node.
  const nodeLabelDir = {};
  domain.forEach(el => {
    const { dx, dy } = nodeOutDir[el];
    if (hasSelfLoop.has(el)) {
      // Two perpendicular candidates: (-dy, dx) and (dy, -dx)
      const c1 = { dx: -dy, dy:  dx };
      const c2 = { dx:  dy, dy: -dx };
      // Pick the one pointing more upward (smaller dy)
      nodeLabelDir[el] = (c1.dy <= c2.dy) ? c1 : c2;
    } else {
      nodeLabelDir[el] = { dx, dy };
    }
  });

  // ── Arrowhead markers ─────────────────────────────────────────────────────
  binaryPreds.forEach(relName => {
    const marker = svgEl('marker', {
      id: `arrow-${relName}`, markerWidth: '9', markerHeight: '6',
      refX: '8', refY: '3', orient: 'auto',
    });
    const poly = svgEl('polygon', { points: '0 0, 9 3, 0 6', fill: predColors[relName] });
    marker.appendChild(poly);
    defs.appendChild(marker);
  });

  // ── Edges ─────────────────────────────────────────────────────────────────
  binaryPreds.forEach(relName => {
    const tuples = model.interp[relName] || [];
    const color  = predColors[relName];

    tuples.forEach(([a, b]) => {
      if (!positions[a] || !positions[b]) return;
      const pa = positions[a], pb = positions[b];

      if (a === b) {
        // Self-loop — wide, circular, pointing away from neighbours, no label
        const { dx: ldx, dy: ldy } = nodeOutDir[a];
        const perp = { dx: -ldy, dy: ldx };  // perpendicular
        const r  = nodeR;
        // Wide spread on the node surface (≈80° either side of outward axis)
        const spread = 1.3;
        const ox = pa.x + (ldx * Math.cos( spread) - ldy * Math.sin( spread)) * r;
        const oy = pa.y + (ldy * Math.cos( spread) + ldx * Math.sin( spread)) * r;
        const ex = pa.x + (ldx * Math.cos(-spread) - ldy * Math.sin(-spread)) * r;
        const ey = pa.y + (ldy * Math.cos(-spread) + ldx * Math.sin(-spread)) * r;
        // Control points far out and wide — makes a big round loop
        const bulge = r * 3.2;
        const wing  = r * 2.4;
        const cx1 = pa.x + ldx * bulge + perp.dx * wing;
        const cy1 = pa.y + ldy * bulge + perp.dy * wing;
        const cx2 = pa.x + ldx * bulge - perp.dx * wing;
        const cy2 = pa.y + ldy * bulge - perp.dy * wing;
        const path = svgEl('path', {
          d: `M ${ox} ${oy} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${ex} ${ey}`,
          fill: 'none', stroke: color, 'stroke-width': '1.8', opacity: '0.75',
          'marker-end': `url(#arrow-${relName})`,
        });
        edgeG.appendChild(path);  // no label for self-loops
      } else {
        const dx  = pb.x - pa.x, dy = pb.y - pa.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const ux = dx / dist, uy = dy / dist;

        const hasReverse = tuples.some(([x, y]) => x === b && y === a);
        const off = hasReverse ? 9 : 0;
        const nx = -uy * off, ny = ux * off;

        const x1 = pa.x + ux * (nodeR + 1) + nx, y1 = pa.y + uy * (nodeR + 1) + ny;
        const x2 = pb.x - ux * (nodeR + 9) + nx, y2 = pb.y - uy * (nodeR + 9) + ny;

        const line = svgEl('line', {
          x1, y1, x2, y2,
          class: 'graph-edge', stroke: color, 'stroke-width': '1.8',
          'marker-end': `url(#arrow-${relName})`,
        });
        edgeG.appendChild(line);

        const lbl = svgEl('text', {
          x: (x1 + x2) / 2 + nx + (-uy * 18),
          y: (y1 + y2) / 2 + ny + (ux * 18),
          class: 'graph-edge-label', fill: color,
        });
        lbl.textContent = relName;
        edgeG.appendChild(lbl);
      }
    });
  });

  // ── Nodes ─────────────────────────────────────────────────────────────────
  domain.forEach(el => {
    const { x, y } = positions[el];
    const g = svgEl('g', { class: 'graph-node-group', 'data-el': el });
    g.style.cursor = 'grab';

    const activePreds = unaryPreds.filter(p => (model.interp[p] || []).includes(el));

    // Outer dashed rings
    activePreds.forEach((p, i) => {
      const r    = nodeR + 5 + i * 6;
      const circ = 2 * Math.PI * r;
      const ring = svgEl('circle', {
        cx: x, cy: y, r,
        fill: 'none', stroke: predColors[p], 'stroke-width': '2', opacity: '0.55',
        'stroke-dasharray': `${circ * 0.55} ${circ * 0.45}`,
        'stroke-dashoffset': `${circ * 0.15}`,
      });
      g.appendChild(ring);
    });

    // Node fill
    const fillColor = activePreds.length === 1
      ? predColors[activePreds[0]] + '28'
      : activePreds.length > 1
        ? 'rgba(120,120,120,0.15)'
        : 'var(--color-node-fill)';

    g.appendChild(svgEl('circle', {
      cx: x, cy: y, r: nodeR,
      class: 'graph-node-circle', fill: fillColor,
    }));

    // Node label
    const lbl = svgEl('text', { x, y, class: 'graph-node-label' });
    lbl.textContent = el;
    g.appendChild(lbl);

    // Constant annotations
    const mappedConsts = Object.entries(model.interp || {})
      .filter(([k, v]) => v === el && /^[a-w]$/.test(k))
      .map(([k]) => k);
    // Label direction: away from neighbours, rotated 90° for nodes with self-loops
    const { dx: ldx, dy: ldy } = nodeLabelDir[el];
    // Choose text-anchor based on horizontal direction
    const anchor = ldx > 0.15 ? 'start' : ldx < -0.15 ? 'end' : 'middle';

    // Stack pred and const labels outward from the node, one per line.
    // Base offset is just past the outermost predicate ring.
    const baseOff = nodeR + 5 + (activePreds.length > 0 ? (activePreds.length - 1) * 6 + 5 : 0);
    // Line height for stacked labels (px between baselines)
    const LINE_H = 13;
    // The label y-baseline is shifted so text reads above the anchor point
    // when going upward and below when going downward.
    const ySign = ldy >= 0 ? 1 : -1;

    if (activePreds.length > 0) {
      const dist = baseOff + 12;
      const plbl = svgEl('text', {
        x: x + ldx * dist,
        y: y + ldy * dist + ySign * 4,
        class: 'graph-pred-label',
        'text-anchor': anchor
      });
      if (activePreds.length === 1) plbl.setAttribute('fill', predColors[activePreds[0]]);
      plbl.textContent = activePreds.join(', ');
      g.appendChild(plbl);
    }

    if (mappedConsts.length > 0) {
      // Place the const label one line further out than the pred label.
      const predLines = activePreds.length > 0 ? 1 : 0;
      const dist = baseOff + 12 + predLines * LINE_H;
      const clbl = svgEl('text', {
        x: x + ldx * dist,
        y: y + ldy * dist + ySign * 4,
        class: 'graph-const-label',
        'text-anchor': anchor
      });
      clbl.textContent = mappedConsts.join(', ');
      g.appendChild(clbl);
    }

    nodeG.appendChild(g);
  });

  // ── Legend ────────────────────────────────────────────────────────────────
  const legendEntries = [
    ...unaryPreds.map(p  => ({ label: `${p} (predicate)`, color: predColors[p], type: 'circle' })),
    ...binaryPreds.map(p => ({ label: `${p} (relation)`,  color: predColors[p], type: 'line'   })),
  ];

  if (legendEntries.length > 0 || higherPreds.length > 0) {
    graphLegend.hidden = false;
    legendEntries.forEach(e => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      const icon = document.createElement('div');
      if (e.type === 'circle') {
        icon.className    = 'legend-dot';
        icon.style.background = e.color + '28';
        icon.style.border = `2px solid ${e.color}`;
      } else {
        icon.className    = 'legend-line';
        icon.style.background = e.color;
      }
      item.appendChild(icon);
      const lbl = document.createElement('span');
      lbl.textContent    = e.label;
      lbl.style.fontFamily = 'var(--font-mono)';
      item.appendChild(lbl);
      legendItems.appendChild(item);
    });

    // Note for n-ary relations that can't be shown as arrows
    if (higherPreds.length > 0) {
      const note = document.createElement('div');
      note.className = 'legend-nary-note';
      const names = higherPreds.map(([nm, ar]) => `${nm} (${ar}-place)`).join(', ');
      note.textContent = `${names} not shown in graph`;
      legendItems.appendChild(note);
    }
  } else {
    graphLegend.hidden = true;
  }

  graphSubtitle.textContent = '';

  // Store the re-render function for the drag handler to call
  _dragRenderFn = (overridePos) => renderGraph(model, sig, overridePos);
}

// ── Drag — attached ONCE on page load, not per-render ─────────────────────────
function initDrag() {
  const svg = document.getElementById('graph-svg');

  function getSVGPoint(evt) {
    const rect = svg.getBoundingClientRect();
    const src  = evt.touches ? evt.touches[0] : evt;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  function getNodeGroup(target) {
    let el = target;
    while (el && el !== svg) {
      if (el.classList && el.classList.contains('graph-node-group')) return el;
      el = el.parentNode;
    }
    return null;
  }

  svg.addEventListener('mousedown', evt => {
    const group = getNodeGroup(evt.target);
    if (!group) return;
    const elName = group.getAttribute('data-el');
    if (!elName || !_nodePositions[elName]) return;
    const pt = getSVGPoint(evt);
    _dragState = { el: elName, startPt: pt, startPos: { ..._nodePositions[elName] } };
    group.style.cursor = 'grabbing';
    evt.preventDefault();
  }, { passive: false });

  svg.addEventListener('mousemove', evt => {
    if (!_dragState || !_dragRenderFn) return;
    const pt  = getSVGPoint(evt);
    const dx  = pt.x - _dragState.startPt.x;
    const dy  = pt.y - _dragState.startPt.y;
    const W   = svg.parentElement.clientWidth  || 400;
    const H   = svg.parentElement.clientHeight || 300;
    const pad = 20;
    const nx  = Math.max(pad, Math.min(W - pad, _dragState.startPos.x + dx));
    const ny  = Math.max(pad, Math.min(H - pad, _dragState.startPos.y + dy));

    // Update stored position and re-render with override positions map
    _nodePositions[_dragState.el] = { x: nx, y: ny };
    // Build a merged positions map for all domain elements
    const pos = { ..._nodePositions };
    _dragRenderFn(pos);
    evt.preventDefault();
  }, { passive: false });

  function endDrag() {
    if (!_dragState) return;
    _dragState = null;
    // Final clean render with settled positions
    if (_dragRenderFn) _dragRenderFn();
  }

  svg.addEventListener('mouseup',    endDrag);
  svg.addEventListener('mouseleave', endDrag);
  svg.addEventListener('touchstart', evt => {
    const group = getNodeGroup(evt.target);
    if (!group) return;
    const elName = group.getAttribute('data-el');
    if (!elName || !_nodePositions[elName]) return;
    const pt = getSVGPoint(evt);
    _dragState = { el: elName, startPt: pt, startPos: { ..._nodePositions[elName] } };
    evt.preventDefault();
  }, { passive: false });

  svg.addEventListener('touchmove', evt => {
    if (!_dragState || !_dragRenderFn) return;
    const pt  = getSVGPoint(evt);
    const dx  = pt.x - _dragState.startPt.x;
    const dy  = pt.y - _dragState.startPt.y;
    const W   = svg.parentElement.clientWidth  || 400;
    const H   = svg.parentElement.clientHeight || 300;
    const pad = 20;
    _nodePositions[_dragState.el] = {
      x: Math.max(pad, Math.min(W - pad, _dragState.startPos.x + dx)),
      y: Math.max(pad, Math.min(H - pad, _dragState.startPos.y + dy)),
    };
    _dragRenderFn({ ..._nodePositions });
    evt.preventDefault();
  }, { passive: false });

  svg.addEventListener('touchend', endDrag);
}

// Call once when the page loads (app.js calls refreshGraph after DOMContentLoaded)
document.addEventListener('DOMContentLoaded', initDrag);
