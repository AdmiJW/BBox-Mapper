# BBox Mapper

A lightweight, browser-based image annotation tool for drawing and exporting bounding boxes. No installation, no server, no build step — open `index.html` and start annotating.

---

## Features

- **Draw bounding boxes** by clicking and dragging on any loaded image
- **Move and resize** boxes with drag handles at each corner
- **Label boxes** with custom names — click the label in the sidebar to rename inline
- **Percentage and pixel coordinates** — toggle between `%` and `px` display in the sidebar
- **Natural image dimensions** displayed in the sidebar for reference
- **Zoom and pan** — scroll to zoom, hold `Space` and drag to pan
- **Export to JSON** — saves both percentage and absolute pixel coordinates
- **Import from JSON** — restore a previous session's boxes onto a loaded image
- **Multiple boxes** — each assigned a distinct color from a rotating palette
- **Keyboard shortcuts** for fast workflow

---

## Getting Started

1. Clone or download this repository
2. Open `index.html` in any modern browser
3. Click **Open Image** (or drag and drop an image file onto the canvas)
4. Draw bounding boxes by clicking and dragging on the image

No dependencies, no npm, no build tools required.

---

## Usage

### Drawing Boxes
Click and drag anywhere on the image to create a bounding box. A dashed preview appears while drawing. Boxes smaller than 2px are ignored to prevent accidental clicks.

### Selecting, Moving, Resizing
- **Click** a box to select it (corner resize handles appear)
- **Drag** the box body to move it
- **Drag a corner handle** to resize

### Labelling
Click the box name (e.g. `Box #1`) in the sidebar panel to rename it. The SVG label on the canvas updates live as you type.

### Coordinates
Use the **`%` / `px` toggle** in the sidebar header to switch between:
- **`%`** — position and size as a percentage of the image's displayed dimensions
- **`px`** — position and size in the image's natural (original) pixel space

### Zoom & Pan
| Action | Control |
|---|---|
| Zoom in / out | Scroll wheel over the canvas |
| Zoom in (button) | `+` button or `+` / `=` key |
| Zoom out (button) | `−` button or `-` key |
| Reset zoom | Reset button or `0` key |
| Pan | Hold `Space`, then click and drag |

### Keyboard Shortcuts
| Key | Action |
|---|---|
| `Delete` / `Backspace` | Delete the selected box |
| `Escape` | Deselect the current box |
| `+` / `=` | Zoom in |
| `-` | Zoom out |
| `0` | Reset zoom and pan |
| `Space` + drag | Pan the canvas |

---

## Export Format

Clicking **Export JSON** downloads a `bboxes.json` file. Each entry contains the box label, percentage coordinates, and natural-image pixel coordinates:

```json
[
  {
    "id": 1,
    "label": "cat",
    "left_pct": 12.50,
    "top_pct": 8.30,
    "width_pct": 45.20,
    "height_pct": 30.10,
    "left_px": 240,
    "top_px": 159,
    "width_px": 869,
    "height_px": 578
  }
]
```

| Field | Description |
|---|---|
| `id` | Sequential box identifier |
| `label` | User-defined label |
| `left_pct`, `top_pct` | Position of the top-left corner as % of image size |
| `width_pct`, `height_pct` | Box dimensions as % of image size |
| `left_px`, `top_px` | Position in natural image pixels |
| `width_px`, `height_px` | Dimensions in natural image pixels |

---

## Import Format

Clicking **Import JSON** loads boxes from a JSON file onto the currently displayed image. The file must be a non-empty array. Both the full export format and the legacy short format are accepted:

```json
[
  { "label": "dog", "left_pct": 5.0, "top_pct": 10.0, "width_pct": 30.0, "height_pct": 25.0 }
]
```

> **Note:** An image must be loaded before importing. Percentage coordinates are resolved against the image's current display size.

---

## File Structure

```
Bounding-Box-Mapper/
├── index.html   — App shell and layout
├── style.css    — Design system and component styles
├── app.js       — All application logic
└── README.md
```

---

## Browser Support

Works in all modern browsers (Chrome, Firefox, Edge, Safari). No polyfills needed.

---

## Tech Stack

- **Vanilla HTML / CSS / JavaScript** — zero dependencies
- **SVG overlay** rendered at native screen resolution for sharp visuals at all zoom levels
- **CSS transforms** for zoom and pan on the image layer only
