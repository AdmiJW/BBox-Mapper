'use strict';

/* ─── Constants ──────────────────────────────────────────────────── */
const BOX_COLORS = [
  '#6366f1', // indigo
  '#22d3ee', // cyan
  '#f59e0b', // amber
  '#10b981', // emerald
  '#f43f5e', // rose
  '#a78bfa', // violet
  '#fb923c', // orange
  '#34d399', // teal-green
];

const MIN_BOX_PX   = 2;   // small enough to allow intentional tiny boxes
const HANDLE_R     = 5;
const HANDLE_HIT_R = 8;
const ZOOM_MIN     = 0.1;
const ZOOM_MAX     = 8;
const ZOOM_STEP    = 1.25;
const ZOOM_WHEEL   = 1.1;

/* ─── State ──────────────────────────────────────────────────────── */
const state = {
  image:      null,      // { naturalWidth, naturalHeight }
  boxes:      [],        // [{ id, color, label, x, y, w, h }]
  nextId:     1,
  selectedId: null,
  coordMode:  'pct',     // 'pct' | 'px'
  baseW:      0,         // image display width at zoom=1 (px) — set on load & resize
  baseH:      0,         // image display height at zoom=1 (px)

  // Draw mode
  drawMode: { active: false, startX: 0, startY: 0 },

  // Drag mode (move/resize)
  dragMode: {
    active: false, type: null,
    boxId: null, startMouseX: 0, startMouseY: 0, origBox: null,
  },

  // Zoom / Pan
  zoom:       1.0,
  panX:       0,
  panY:       0,

  // Pan interaction
  spaceDown:  false,
  isPanning:  false,
  panStart:   { mouseX: 0, mouseY: 0, panX: 0, panY: 0 },
};

/* ─── DOM Refs ───────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const openBtn      = $('open-btn');
const emptyOpenBtn = $('empty-open-btn');
const fileInput    = $('file-input');
const canvasArea   = $('canvas-area');
const emptyState   = $('empty-state');
const imageWrapper = $('image-wrapper');
const mainImage    = $('main-image');
const overlay      = $('overlay');
const boxList      = $('box-list');
const boxCount     = $('box-count');
const clearBtn     = $('clear-btn');
const exportBtn    = $('export-btn');
const importBtn    = $('import-btn');
const importInput  = $('import-input');
const imageInfo    = $('image-info');
const imageDims    = $('image-dims');
const zoomControls = $('zoom-controls');
const zoomLabel    = $('zoom-label');
const zoomInBtn    = $('zoom-in');
const zoomOutBtn   = $('zoom-out');
const zoomResetBtn = $('zoom-reset');
const panHint      = $('pan-hint');
const togglePct    = $('toggle-pct');
const togglePx     = $('toggle-px');

/* ─── Utilities ──────────────────────────────────────────────────── */

function colorForIndex(i) {
  return BOX_COLORS[i % BOX_COLORS.length];
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/** Bounding rect of the displayed image (zoomed visual rect). */
function getImageRect() {
  return mainImage.getBoundingClientRect();
}

/**
 * Convert viewport client coords → image-display pixel coords (in unzoomed space).
 * getBoundingClientRect() returns the zoomed rect, so we divide by zoom.
 */
function clientToImage(clientX, clientY) {
  const rect = getImageRect();
  return {
    x: (clientX - rect.left) / state.zoom,
    y: (clientY - rect.top)  / state.zoom,
  };
}

/** Unzoomed display size of the image. */
function getDisplaySize() {
  const rect = getImageRect();
  return {
    w: rect.width  / state.zoom,
    h: rect.height / state.zoom,
  };
}

/** Convert box display-pixel coords → percentages relative to displayed image. */
function pixelsToPercent(box) {
  const { w: iw, h: ih } = getDisplaySize();
  return {
    left:   +((box.x / iw) * 100).toFixed(2),
    top:    +((box.y / ih) * 100).toFixed(2),
    width:  +((box.w / iw) * 100).toFixed(2),
    height: +((box.h / ih) * 100).toFixed(2),
  };
}

/** Convert box display-pixel coords → natural image pixel coords. */
function boxToNaturalPixels(box) {
  const { w: dw, h: dh } = getDisplaySize();
  const scaleX = state.image.naturalWidth  / dw;
  const scaleY = state.image.naturalHeight / dh;
  return {
    left:   Math.round(box.x * scaleX),
    top:    Math.round(box.y * scaleY),
    width:  Math.round(box.w * scaleX),
    height: Math.round(box.h * scaleY),
  };
}

/** Normalize a box so x/y is always top-left, w/h always positive. */
function normalizeBox(box) {
  let { x, y, w, h } = box;
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  return { ...box, x, y, w, h };
}

/* ─── SVG helpers ────────────────────────────────────────────────── */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/**
 * Convert image-display coords (unzoomed) → canvas-area pixel coords for SVG rendering.
 * The SVG lives in canvas-area space (never scaled), so we must map image coords to it.
 * getBoundingClientRect() returns the visual (post-transform) rect, so this is always correct.
 */
function imageToSVG(px, py) {
  const imgRect = mainImage.getBoundingClientRect();
  const caRect  = canvasArea.getBoundingClientRect();
  return {
    x: imgRect.left - caRect.left + px * state.zoom,
    y: imgRect.top  - caRect.top  + py * state.zoom,
  };
}

/** Returns true if (clientX, clientY) is within the visually displayed image. */
function isInImage(clientX, clientY) {
  const r = mainImage.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right
      && clientY >= r.top  && clientY <= r.bottom;
}

/* ─── Zoom / Pan ─────────────────────────────────────────────────── */

/**
 * Calculate the image's fit-to-canvas size at zoom=1 from natural dimensions.
 * Called on image load and on window resize.
 */
function computeBaseDisplaySize() {
  const padding = 48;
  const maxW = canvasArea.clientWidth  - padding;
  const maxH = canvasArea.clientHeight - padding;
  const { naturalWidth: nw, naturalHeight: nh } = mainImage;
  const scale = Math.min(1, maxW / nw, maxH / nh); // never upscale at zoom=1
  return { w: Math.round(nw * scale), h: Math.round(nh * scale) };
}

/**
 * Apply current zoom and pan.
 * Sets explicit image dimensions (not CSS scale) so the browser re-samples from the
 * full-resolution source at every zoom level instead of scaling a pre-rasterized bitmap.
 */
function applyTransform() {
  mainImage.style.width  = `${state.baseW * state.zoom}px`;
  mainImage.style.height = `${state.baseH * state.zoom}px`;
  imageWrapper.style.transform = `translate(${state.panX}px, ${state.panY}px)`;
}

function updateZoomLabel() {
  zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

/**
 * Zoom by factor, anchored at viewport point (clientX, clientY).
 * The image point under the cursor stays fixed.
 */
function zoomAt(factor, clientX, clientY) {
  const oldZoom = state.zoom;
  const newZoom = clamp(oldZoom * factor, ZOOM_MIN, ZOOM_MAX);
  if (newZoom === oldZoom) return;

  // Canvas center in viewport
  const cr = canvasArea.getBoundingClientRect();
  const Ox = cr.left + cr.width  / 2;
  const Oy = cr.top  + cr.height / 2;

  // Adjust pan so the image point under (clientX, clientY) stays fixed
  const ratio = newZoom / oldZoom;
  state.panX = (clientX - Ox) * (1 - ratio) + state.panX * ratio;
  state.panY = (clientY - Oy) * (1 - ratio) + state.panY * ratio;
  state.zoom = newZoom;

  applyTransform();
  renderOverlay(); // SVG is in screen space — must redraw after zoom changes positions
  updateZoomLabel();
}

function zoomAtCenter(factor) {
  const cr = canvasArea.getBoundingClientRect();
  zoomAt(factor, cr.left + cr.width / 2, cr.top + cr.height / 2);
}

function resetZoom() {
  state.zoom = 1;
  state.panX = 0;
  state.panY = 0;
  applyTransform();
  renderOverlay(); // SVG in screen space — must redraw after pan/zoom reset
  updateZoomLabel();
}

/* ─── Rendering ──────────────────────────────────────────────────── */

function renderAll() {
  renderOverlay();
  renderSidebar();
  updateSidebarControls();
}

function renderOverlay() {
  overlay.innerHTML = '';

  // Preview rect for live drawing
  const previewRect = svgEl('rect', {
    id: 'preview-rect',
    fill: 'transparent',
    stroke: '#6366f1',
    'stroke-width': '1.75',
    'stroke-dasharray': '7 4',
    display: 'none',
    'pointer-events': 'none',
  });
  overlay.appendChild(previewRect);

  for (const box of state.boxes) {
    renderBoxGroup(box);
  }
}

function renderBoxGroup(box) {
  const isSelected = box.id === state.selectedId;
  const color = box.color;

  // Convert image-space coords → canvas-area/SVG-space coords
  const tl   = imageToSVG(box.x, box.y);
  const svgX = tl.x;
  const svgY = tl.y;
  const svgW = box.w * state.zoom;
  const svgH = box.h * state.zoom;

  const g = svgEl('g', {
    class: 'box-group' + (isSelected ? ' selected' : ''),
    'data-id': box.id,
  });

  // Main hit rect — pointer-events:all so it receives mouse events despite parent none
  const rect = svgEl('rect', {
    class: 'box-rect',
    x: svgX, y: svgY, width: svgW, height: svgH,
    fill:           isSelected ? `${color}22` : `${color}11`,
    stroke:         color,
    'stroke-width': isSelected ? '2' : '1.75',   // fixed screen-pixel width ✓
    rx:             '2',
    style:          isSelected ? `filter: drop-shadow(0 0 6px ${color}88)` : '',
    cursor:         state.spaceDown ? 'inherit' : 'move',
    'pointer-events': 'all',
  });
  rect.addEventListener('mousedown', e => onBoxRectMouseDown(e, box.id));
  g.appendChild(rect);

  // Label pill — fixed screen-pixel font size ✓
  const labelText = box.label || `#${box.id}`;
  const lblW = Math.max(labelText.length * 7 + 12, 28);
  const lblH = 18;
  const lblX = svgX + 2;
  const lblY = svgY - lblH - 2 < 0 ? svgY + 2 : svgY - lblH - 2;

  const lblBg = svgEl('rect', {
    x: lblX, y: lblY, width: lblW, height: lblH, rx: '3',
    fill: color,
    'pointer-events': 'none',
  });
  g.appendChild(lblBg);

  const lblTxt = svgEl('text', {
    x: lblX + lblW / 2,
    y: lblY + lblH / 2 + 1,
    'text-anchor':       'middle',
    'dominant-baseline': 'middle',
    fill:                '#fff',
    'font-size':         '11',   // fixed 11px regardless of zoom ✓
    'font-weight':       '600',
    'font-family':       'Inter, system-ui, sans-serif',
    'pointer-events':    'none',
  });
  lblTxt.textContent = labelText;
  g.appendChild(lblTxt);

  // Corner resize handles — fixed HANDLE_R radius in screen pixels ✓
  if (isSelected) {
    const corners = [
      { type: 'resize-nw', cx: svgX,        cy: svgY,        cursor: 'nw-resize' },
      { type: 'resize-ne', cx: svgX + svgW,  cy: svgY,        cursor: 'ne-resize' },
      { type: 'resize-sw', cx: svgX,        cy: svgY + svgH,  cursor: 'sw-resize' },
      { type: 'resize-se', cx: svgX + svgW,  cy: svgY + svgH,  cursor: 'se-resize' },
    ];

    for (const { type, cx, cy, cursor } of corners) {
      const hitCircle = svgEl('circle', {
        cx, cy, r: HANDLE_HIT_R,
        fill: 'transparent',
        cursor: state.spaceDown ? 'inherit' : cursor,
        'pointer-events': 'all',
      });
      hitCircle.addEventListener('mousedown', e => onHandleMouseDown(e, box.id, type));
      g.appendChild(hitCircle);

      const visCircle = svgEl('circle', {
        cx, cy, r: HANDLE_R,
        fill: '#fff',
        stroke: color,
        'stroke-width': '2',
        'pointer-events': 'none',
      });
      g.appendChild(visCircle);
    }
  }

  overlay.appendChild(g);
}

function renderSidebar() {
  boxList.innerHTML = '';

  if (state.boxes.length === 0) {
    boxList.innerHTML = `
      <div class="sidebar-empty">
        <p>Draw boxes on the image<br>to see them here</p>
      </div>`;
    return;
  }

  const isPercent = state.coordMode === 'pct';
  const unit = isPercent ? '%' : 'px';

  for (const box of state.boxes) {
    const vals = isPercent ? pixelsToPercent(box) : boxToNaturalPixels(box);
    const isSelected = box.id === state.selectedId;

    const card = document.createElement('div');
    card.className = 'box-card' + (isSelected ? ' selected' : '');
    card.dataset.id = box.id;
    card.style.borderLeftColor = box.color;

    card.innerHTML = `
      <div class="box-card-header">
        <span class="box-swatch" style="background:${box.color}"></span>
        <input
          class="box-label-input"
          type="text"
          value="${escapeAttr(box.label)}"
          placeholder="Label…"
          title="Click to rename"
          data-id="${box.id}"
        />
        <button class="box-delete-btn" title="Delete box" data-id="${box.id}">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="box-coords">
        <div class="coord-item">
          <span class="coord-label">Left</span>
          <span class="coord-value">${vals.left}${unit}</span>
        </div>
        <div class="coord-item">
          <span class="coord-label">Top</span>
          <span class="coord-value">${vals.top}${unit}</span>
        </div>
        <div class="coord-item">
          <span class="coord-label">Width</span>
          <span class="coord-value">${vals.width}${unit}</span>
        </div>
        <div class="coord-item">
          <span class="coord-label">Height</span>
          <span class="coord-value">${vals.height}${unit}</span>
        </div>
      </div>`;

    // Label input events
    const labelInput = card.querySelector('.box-label-input');
    labelInput.addEventListener('mousedown', e => e.stopPropagation()); // prevent card select on focus
    labelInput.addEventListener('click', e => e.stopPropagation());
    labelInput.addEventListener('input', () => {
      updateBox(box.id, { label: labelInput.value });
      renderOverlay(); // update SVG label live without losing input focus
    });
    labelInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { labelInput.blur(); }
      if (e.key === 'Escape') { labelInput.value = box.label; labelInput.blur(); }
      e.stopPropagation(); // prevent Delete key from deleting the box while typing
    });
    labelInput.addEventListener('blur', () => renderAll());

    // Card click → select
    card.addEventListener('click', e => {
      if (e.target.closest('.box-delete-btn') || e.target.closest('.box-label-input')) return;
      selectBox(box.id);
    });

    // Delete button
    card.querySelector('.box-delete-btn').addEventListener('click', e => {
      e.stopPropagation();
      deleteBox(box.id);
    });

    boxList.appendChild(card);
  }
}

function updateSidebarControls() {
  const count = state.boxes.length;
  boxCount.textContent = count;
  boxCount.classList.toggle('has-items', count > 0);
  clearBtn.hidden    = count === 0;
  exportBtn.disabled = count === 0;
}

/**
 * Patch only the 4 coordinate <span> values inside an existing sidebar card.
 * Called on every mousemove during drag/resize — zero DOM rebuild, no flicker.
 */
function patchCardCoords(id) {
  const card = boxList.querySelector(`.box-card[data-id="${id}"]`);
  if (!card) return;

  const box = getBox(id);
  if (!box) return;

  const isPercent = state.coordMode === 'pct';
  const vals = isPercent ? pixelsToPercent(box) : boxToNaturalPixels(box);
  const unit = isPercent ? '%' : 'px';

  // Order matches renderSidebar card HTML: left, top, width, height
  const spans = card.querySelectorAll('.coord-value');
  spans[0].textContent = `${vals.left}${unit}`;
  spans[1].textContent = `${vals.top}${unit}`;
  spans[2].textContent = `${vals.width}${unit}`;
  spans[3].textContent = `${vals.height}${unit}`;
}

/**
 * Toggle the .selected CSS class on sidebar cards directly.
 * Called when selection changes — zero DOM rebuild.
 */
function patchCardSelection(oldId, newId) {
  if (oldId != null) {
    const old = boxList.querySelector(`.box-card[data-id="${oldId}"]`);
    if (old) old.classList.remove('selected');
  }
  if (newId != null) {
    const next = boxList.querySelector(`.box-card[data-id="${newId}"]`);
    if (next) next.classList.add('selected');
  }
}

/** Escape a string for use in an HTML attribute value. */
function escapeAttr(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ─── Box Management ─────────────────────────────────────────────── */

function addBox(x, y, w, h) {
  // Validate size BEFORE consuming an ID — prevents ID gaps from failed draws
  const box = normalizeBox({ x, y, w, h });
  if (box.w < MIN_BOX_PX || box.h < MIN_BOX_PX) return;

  const id    = state.nextId++;
  const color = colorForIndex(id - 1);
  const label = `Box #${id}`;
  box.id    = id;
  box.color = color;
  box.label = label;
  state.boxes.push(box);
  state.selectedId = box.id;
  renderAll();
  scrollToSelectedCard();
}

function deleteBox(id) {
  state.boxes = state.boxes.filter(b => b.id !== id);
  if (state.selectedId === id) state.selectedId = null;
  renderAll();
}

function selectBox(id) {
  const prevId = state.selectedId;
  state.selectedId = id;
  patchCardSelection(prevId, id); // toggle .selected class — no DOM rebuild
  renderOverlay();                // redraw SVG: deselect old box, highlight new
  scrollToSelectedCard();
}

function scrollToSelectedCard() {
  const card = boxList.querySelector(`.box-card[data-id="${state.selectedId}"]`);
  if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function updateBox(id, patch) {
  const idx = state.boxes.findIndex(b => b.id === id);
  if (idx === -1) return;
  state.boxes[idx] = { ...state.boxes[idx], ...patch };
}

function getBox(id) {
  return state.boxes.find(b => b.id === id) || null;
}

/* ─── Image Loading ──────────────────────────────────────────────── */

function loadImage(file) {
  if (!file || !file.type.startsWith('image/')) return;

  const url = URL.createObjectURL(file);
  mainImage.onload = () => {
    state.image = {
      naturalWidth:  mainImage.naturalWidth,
      naturalHeight: mainImage.naturalHeight,
    };
    state.boxes      = [];
    state.nextId     = 1;
    state.selectedId = null;

    // Compute fit-to-canvas size, then reset zoom/pan
    emptyState.hidden   = true;   // must be hidden first so canvas has its full clientWidth
    imageWrapper.hidden = false;  // must be visible so image has layout
    const { w, h } = computeBaseDisplaySize();
    state.baseW = w;
    state.baseH = h;
    state.zoom  = 1;
    state.panX  = 0;
    state.panY  = 0;
    applyTransform();
    updateZoomLabel();

    zoomControls.hidden = false;
    importBtn.disabled  = false;

    // Enable SVG overlay interaction now that an image is loaded
    overlay.style.pointerEvents = 'all';
    overlay.style.cursor        = 'crosshair';

    // Show image dimensions
    imageDims.textContent = `${state.image.naturalWidth} × ${state.image.naturalHeight} px`;
    imageInfo.hidden = false;

    renderAll();
  };
  mainImage.src = url;
}

/* ─── Mouse: Drawing ─────────────────────────────────────────────── */

function onOverlayMouseDown(e) {
  // Pan mode takes priority when space is held
  if (state.spaceDown) {
    e.preventDefault();
    state.isPanning = true;
    state.panStart  = { mouseX: e.clientX, mouseY: e.clientY, panX: state.panX, panY: state.panY };
    overlay.style.cursor = 'grabbing';
    return;
  }

  // Only respond to left-click for drawing
  if (e.button !== 0) return;

  // Only start drawing on the SVG background (not on box rects or handles)
  if (e.target !== overlay && e.target.id !== 'preview-rect') return;
  if (!state.image) return;

  // SVG now covers the full canvas-area — only draw if click lands on the image
  if (!isInImage(e.clientX, e.clientY)) return;

  e.preventDefault();

  const pos = clientToImage(e.clientX, e.clientY);
  state.drawMode = { active: true, startX: pos.x, startY: pos.y };

  state.selectedId = null;
  renderOverlay();
}

function updateDrawPreview(clientX, clientY) {
  const { startX, startY } = state.drawMode;

  // startX/Y are in image-display coords → convert to canvas-area (SVG) coords
  const origin = imageToSVG(startX, startY);

  // Current mouse position in canvas-area coords
  const caRect = canvasArea.getBoundingClientRect();
  const curX = clientX - caRect.left;
  const curY = clientY - caRect.top;

  const x = Math.min(origin.x, curX);
  const y = Math.min(origin.y, curY);
  const w = Math.abs(curX - origin.x);
  const h = Math.abs(curY - origin.y);

  const rect = overlay.querySelector('#preview-rect');
  if (!rect) return;
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', w);
  rect.setAttribute('height', h);
  rect.setAttribute('display', 'block');
  rect.setAttribute('pointer-events', 'none');
}

function finishDraw(clientX, clientY) {
  const { startX, startY } = state.drawMode;
  const pos = clientToImage(clientX, clientY);
  state.drawMode.active = false;

  const previewRect = overlay.querySelector('#preview-rect');
  if (previewRect) previewRect.setAttribute('display', 'none');

  addBox(startX, startY, pos.x - startX, pos.y - startY);
}

/* ─── Mouse: Moving ──────────────────────────────────────────────── */

function onBoxRectMouseDown(e, boxId) {
  if (e.button !== 0) return;  // only left-click moves boxes
  if (state.spaceDown) return; // let pan handler take over
  e.preventDefault();
  e.stopPropagation();

  selectBox(boxId);
  const box = getBox(boxId);
  if (!box) return;

  state.dragMode = {
    active: true, type: 'move', boxId,
    startMouseX: e.clientX, startMouseY: e.clientY,
    origBox: { ...box },
  };
}

/* ─── Mouse: Resizing ────────────────────────────────────────────── */

function onHandleMouseDown(e, boxId, handleType) {
  if (e.button !== 0) return;  // only left-click resizes boxes
  if (state.spaceDown) return;
  e.preventDefault();
  e.stopPropagation();

  const box = getBox(boxId);
  if (!box) return;

  state.dragMode = {
    active: true, type: handleType, boxId,
    startMouseX: e.clientX, startMouseY: e.clientY,
    origBox: { ...box },
  };
}

/* ─── Document-level mouse events ────────────────────────────────── */

function onDocMouseMove(e) {
  // Pan
  if (state.isPanning) {
    const dx = e.clientX - state.panStart.mouseX;
    const dy = e.clientY - state.panStart.mouseY;
    state.panX = state.panStart.panX + dx;
    state.panY = state.panStart.panY + dy;
    applyTransform();
    renderOverlay(); // SVG is in screen space — redraw so boxes track the panned image
    return;
  }

  // Draw preview
  if (state.drawMode.active) {
    updateDrawPreview(e.clientX, e.clientY);
    return;
  }

  // Drag/resize
  if (!state.dragMode.active) return;

  const { type, boxId, startMouseX, startMouseY, origBox } = state.dragMode;
  // Divide mouse delta by zoom because our box coords are in unzoomed display space
  const dx = (e.clientX - startMouseX) / state.zoom;
  const dy = (e.clientY - startMouseY) / state.zoom;

  const { w: iw, h: ih } = getDisplaySize();
  let { x, y, w, h } = origBox;

  if (type === 'move') {
    x = clamp(origBox.x + dx, 0, iw - origBox.w);
    y = clamp(origBox.y + dy, 0, ih - origBox.h);
  } else if (type === 'resize-se') {
    w = clamp(origBox.w + dx, MIN_BOX_PX, iw - origBox.x);
    h = clamp(origBox.h + dy, MIN_BOX_PX, ih - origBox.y);
  } else if (type === 'resize-sw') {
    const newX = clamp(origBox.x + dx, 0, origBox.x + origBox.w - MIN_BOX_PX);
    w = origBox.x + origBox.w - newX;
    h = clamp(origBox.h + dy, MIN_BOX_PX, ih - origBox.y);
    x = newX;
  } else if (type === 'resize-ne') {
    w = clamp(origBox.w + dx, MIN_BOX_PX, iw - origBox.x);
    const newY = clamp(origBox.y + dy, 0, origBox.y + origBox.h - MIN_BOX_PX);
    h = origBox.y + origBox.h - newY;
    y = newY;
  } else if (type === 'resize-nw') {
    const newX = clamp(origBox.x + dx, 0, origBox.x + origBox.w - MIN_BOX_PX);
    const newY = clamp(origBox.y + dy, 0, origBox.y + origBox.h - MIN_BOX_PX);
    w = origBox.x + origBox.w - newX;
    h = origBox.y + origBox.h - newY;
    x = newX;
    y = newY;
  }

  updateBox(boxId, { x, y, w, h });
  renderOverlay();        // redraw SVG box at new position/size
  patchCardCoords(boxId); // update only the 4 coord spans — no DOM rebuild
}

function onDocMouseUp(e) {
  if (state.isPanning) {
    state.isPanning = false;
    if (state.image) {
      overlay.style.cursor = state.spaceDown ? 'grab' : 'crosshair';
    }
    return;
  }

  if (state.drawMode.active) {
    finishDraw(e.clientX, e.clientY);
    state.drawMode.active = false;
    return;
  }

  if (state.dragMode.active) {
    state.dragMode.active = false;
    renderOverlay(); // final SVG sync — sidebar already correct from patchCardCoords + patchCardSelection
  }
}

/* ─── Keyboard ───────────────────────────────────────────────────── */

function onKeyDown(e) {
  // Don't intercept when typing in an input
  if (document.activeElement.tagName === 'INPUT') return;

  if (e.key === ' ') {
    e.preventDefault();
    if (!state.spaceDown && state.image) {
      state.spaceDown = true;
      overlay.style.cursor = 'grab';
      panHint.hidden = false;
      renderOverlay(); // update handle cursors
    }
    return;
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedId !== null) {
    deleteBox(state.selectedId);
    return;
  }

  if (e.key === 'Escape') {
    state.selectedId = null;
    renderAll();
  }

  // Zoom shortcuts
  if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAtCenter(ZOOM_STEP); }
  if (e.key === '-')                   { e.preventDefault(); zoomAtCenter(1 / ZOOM_STEP); }
  if (e.key === '0')                   { e.preventDefault(); resetZoom(); }
}

function onKeyUp(e) {
  if (e.key === ' ') {
    state.spaceDown = false;
    state.isPanning = false;
    if (state.image) {
      overlay.style.cursor = 'crosshair';
    }
    panHint.hidden = true;
    renderOverlay();
  }
}

/* ─── Wheel zoom ─────────────────────────────────────────────────── */

function onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY < 0 ? ZOOM_WHEEL : 1 / ZOOM_WHEEL;
  zoomAt(factor, e.clientX, e.clientY);
}

/* ─── Drag & Drop onto canvas ────────────────────────────────────── */

function onCanvasDragOver(e) {
  e.preventDefault();
  canvasArea.classList.add('drag-over');
}

function onCanvasDragLeave(e) {
  if (!canvasArea.contains(e.relatedTarget)) {
    canvasArea.classList.remove('drag-over');
  }
}

function onCanvasDrop(e) {
  e.preventDefault();
  canvasArea.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    loadImage(file);
  }
}

/* ─── Export ─────────────────────────────────────────────────────── */

function exportJSON() {
  if (state.boxes.length === 0) return;

  const data = state.boxes.map(box => {
    const pct = pixelsToPercent(box);
    const px  = boxToNaturalPixels(box);
    return {
      id:         box.id,
      label:      box.label,
      left_pct:   pct.left,
      top_pct:    pct.top,
      width_pct:  pct.width,
      height_pct: pct.height,
      left_px:    px.left,
      top_px:     px.top,
      width_px:   px.width,
      height_px:  px.height,
    };
  });

  downloadJSON(data, 'bboxes.json');
}

/* ─── Import ─────────────────────────────────────────────────────── */

function importJSON(file) {
  if (!file) return;

  if (!state.image) {
    alert('Please load an image first before importing bounding boxes.');
    return;
  }

  const reader = new FileReader();
  reader.onload = ev => {
    let data;
    try {
      data = JSON.parse(ev.target.result);
    } catch {
      alert('Invalid JSON file. Could not parse the file.');
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      alert('JSON must be a non-empty array of bounding box objects.');
      return;
    }

    // Validate at least one coord field exists in first item
    const sample = data[0];
    const hasPct = 'left_pct' in sample || 'left' in sample;
    if (!hasPct) {
      alert('JSON items must have left_pct/top_pct/width_pct/height_pct (or left/top/width/height) fields.');
      return;
    }

    const { w: dw, h: dh } = getDisplaySize();

    state.boxes = [];
    state.nextId = 1;
    state.selectedId = null;

    for (const item of data) {
      const leftPct   = item.left_pct   ?? item.left   ?? 0;
      const topPct    = item.top_pct    ?? item.top    ?? 0;
      const widthPct  = item.width_pct  ?? item.width  ?? 0;
      const heightPct = item.height_pct ?? item.height ?? 0;

      const x = (leftPct   / 100) * dw;
      const y = (topPct    / 100) * dh;
      const w = (widthPct  / 100) * dw;
      const h = (heightPct / 100) * dh;

      const id    = state.nextId++;
      const color = colorForIndex(id - 1);
      const label = item.label ?? `Box #${id}`;

      state.boxes.push({ id, color, label, x, y, w, h });
    }

    renderAll();
    scrollToSelectedCard();
  };
  reader.readAsText(file);
}

function downloadJSON(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Window Resize ──────────────────────────────────────────────── */

let resizeTimer;
function onWindowResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.image) return;
    // Recompute fit-to-canvas size — available space changed with the window
    const { w, h } = computeBaseDisplaySize();
    state.baseW = w;
    state.baseH = h;
    applyTransform();
    renderAll();
  }, 80);
}

/* ─── Init ───────────────────────────────────────────────────────── */

function initApp() {
  // Image file picker
  openBtn.addEventListener('click',  () => fileInput.click());
  emptyOpenBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => {
    loadImage(e.target.files[0]);
    fileInput.value = '';
  });

  // Drag & drop
  canvasArea.addEventListener('dragover',  onCanvasDragOver);
  canvasArea.addEventListener('dragleave', onCanvasDragLeave);
  canvasArea.addEventListener('drop',      onCanvasDrop);

  // Drawing on SVG
  overlay.addEventListener('mousedown', onOverlayMouseDown);

  // Global mouse move/up (captures drag outside SVG)
  document.addEventListener('mousemove', onDocMouseMove);
  document.addEventListener('mouseup',   onDocMouseUp);

  // Keyboard
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup',   onKeyUp);

  // Middle-mouse-button panning — capture phase so it fires even if a child calls stopPropagation
  canvasArea.addEventListener('mousedown', e => {
    if (e.button !== 1 || !state.image) return;
    e.preventDefault(); // prevent the browser's native autoscroll cursor
    state.isPanning = true;
    state.panStart  = { mouseX: e.clientX, mouseY: e.clientY, panX: state.panX, panY: state.panY };
    overlay.style.cursor = 'grabbing';
  }, { capture: true });

  // Scroll-wheel zoom (non-passive so we can prevent default scroll)
  canvasArea.addEventListener('wheel', onWheel, { passive: false });

  // Zoom buttons
  zoomInBtn.addEventListener('click',    () => zoomAtCenter(ZOOM_STEP));
  zoomOutBtn.addEventListener('click',   () => zoomAtCenter(1 / ZOOM_STEP));
  zoomResetBtn.addEventListener('click', resetZoom);

  // Coord mode toggle
  togglePct.addEventListener('click', () => {
    state.coordMode = 'pct';
    togglePct.classList.add('active');
    togglePx.classList.remove('active');
    renderSidebar();
  });
  togglePx.addEventListener('click', () => {
    state.coordMode = 'px';
    togglePx.classList.add('active');
    togglePct.classList.remove('active');
    renderSidebar();
  });

  // Clear all
  clearBtn.addEventListener('click', () => {
    state.boxes      = [];
    state.nextId     = 1;
    state.selectedId = null;
    renderAll();
  });

  // Export
  exportBtn.addEventListener('click', exportJSON);

  // Import
  importBtn.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', e => {
    importJSON(e.target.files[0]);
    importInput.value = '';
  });

  // Responsive re-render
  window.addEventListener('resize', onWindowResize);
}

document.addEventListener('DOMContentLoaded', initApp);
