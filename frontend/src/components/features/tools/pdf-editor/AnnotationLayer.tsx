/**
 * ScopeIt – PDF Editor: AnnotationLayer
 *
 * A transparent fabric.js canvas overlay that sits on top of the PDF page
 * canvas and handles all interactive annotations (text, image, drawing,
 * stamps, signature fields).
 *
 * Usage:
 *   <AnnotationLayer
 *     width={viewport.width * zoom}
 *     height={viewport.height * zoom}
 *     pageNumber={currentPage}
 *     annotations={pageAnnotations}
 *     activeTool={tool}
 *     selectedAnnotationId={selectedId}
 *     onAnnotationSelect={setSelected}
 *     onAnnotationUpdate={handleUpdate}
 *     onAnnotationAdd={handleAdd}
 *     onAnnotationDelete={handleDelete}
 *     zoom={zoom}
 *   />
 */

import ReactDOM from 'react-dom';
import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useLayoutEffect,
} from 'react';
import {
  Canvas,
  IText,
  Image as FabricImage,
  Rect,
  Ellipse,
  Line,
  Path,
  PencilBrush,
  FabricObject,
  ActiveSelection,
} from 'fabric';
import type { Annotation, AnnotationStyle } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

const STAMPS = [
  { label: 'APPROVED', color: '#10b981' },
  { label: 'DRAFT', color: '#6b7280' },
  { label: 'CONFIDENTIAL', color: '#ef4444' },
  { label: 'RECEIVED', color: '#3b82f6' },
  { label: 'COPY', color: '#8b5cf6' },
] as const;

type StampLabel = (typeof STAMPS)[number]['label'];

const SIGN_FIELD_FILL = 'rgba(59, 130, 246, 0.06)';
const SIGN_FIELD_STROKE = '#6b7280';
const SIGN_FIELD_STROKE_DASH: [number, number] = [6, 4];
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_FAMILY = 'Arial';
const DEFAULT_TEXT_COLOR = '#111827';
const DEFAULT_DRAW_COLOR = '#111827';
const DEFAULT_DRAW_WIDTH = 2;
const STAMP_FONT_SIZE = 22;
const STAMP_PADDING_X = 18;
const STAMP_PADDING_Y = 8;
const STAMP_BORDER_RADIUS = 4;
const SIGN_FIELD_DEFAULT_W = 200;
const SIGN_FIELD_DEFAULT_H = 60;
const DEFAULT_SHAPE_SIZE = 100;
const DEFAULT_SHAPE_STROKE = '#111827';
const DEFAULT_SHAPE_FILL = 'transparent';
const DEFAULT_LINE_LENGTH = 150;
const UPDATE_DEBOUNCE_MS = 120;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AnnotationLayerProps {
  width: number;
  height: number;
  pageNumber: number;
  annotations: Annotation[];
  activeTool: string;
  selectedAnnotationId: string | null;
  onAnnotationSelect: (id: string | null) => void;
  onAnnotationUpdate: (annotation: Annotation) => void;
  onAnnotationAdd: (annotation: Annotation) => void;
  onAnnotationDelete: (id: string) => void;
  zoom: number;
  drawColor?: string;
  drawWidth?: number;
  /** Called when user clicks canvas with sign tool – provides click position */
  onSignRequest?: (pos: { x: number; y: number }) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Read the annotation id stored in fabric object's `data` bag. */
function getAnnotationId(obj: FabricObject | undefined | null): string | null {
  if (!obj) return null;
  const d = (obj as FabricObject & { data?: { annotationId?: string } }).data;
  return d?.annotationId ?? null;
}

/** Tag a fabric object with the annotation id it represents. */
function setAnnotationId(obj: FabricObject, id: string): void {
  (obj as FabricObject & { data?: unknown }).data = { annotationId: id };
}

/**
 * Hide the edge/midpoint resize handles (mt/mb/ml/mr) on a text object.
 * Those controls scale only scaleX or scaleY independently, which stretches
 * the glyph shapes. Leaving only the corner handles keeps resizing uniform
 * (fabric's default `canvas.uniformScaling` applies proportional scale there).
 */
function restrictTextScaling(obj: IText): void {
  obj.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
}

/** Extract position / size / rotation from a fabric object into an Annotation. */
function fabricToAnnotation(obj: FabricObject, existing: Annotation): Annotation {
  const scaleX = (obj.scaleX ?? 1);
  const scaleY = (obj.scaleY ?? 1);
  const rawWidth = obj.width ?? existing.width;
  const rawHeight = obj.height ?? existing.height;

  let content = existing.content;
  if (obj instanceof IText) {
    content = obj.text ?? existing.content;
  }

  return {
    ...existing,
    x: obj.left ?? existing.x,
    y: obj.top ?? existing.y,
    width: rawWidth * scaleX,
    height: rawHeight * scaleY,
    rotation: obj.angle ?? existing.rotation,
    content,
  };
}

// ─── Annotation → Fabric object ──────────────────────────────────────────────

function buildTextObject(ann: Annotation): IText {
  const style = ann.style ?? {};
  const obj = new IText(ann.content || 'Text', {
    left: ann.x,
    top: ann.y,
    angle: ann.rotation,
    fontSize: style.fontSize ?? DEFAULT_FONT_SIZE,
    fontFamily: style.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontWeight: style.fontWeight ?? 'normal',
    fontStyle: (style.fontStyle as 'normal' | 'italic' | 'oblique') ?? 'normal',
    fill: style.color ?? DEFAULT_TEXT_COLOR,
    backgroundColor: style.backgroundColor ?? '',
    opacity: style.opacity ?? 1,
    selectable: true,
    editable: true,
  });
  restrictTextScaling(obj);
  setAnnotationId(obj, ann.id);
  return obj;
}

function buildSignFieldObject(ann: Annotation): Rect {
  const w = ann.width || SIGN_FIELD_DEFAULT_W;
  const h = ann.height || SIGN_FIELD_DEFAULT_H;
  const obj = new Rect({
    left: ann.x,
    top: ann.y,
    width: w,
    height: h,
    angle: ann.rotation,
    fill: SIGN_FIELD_FILL,
    stroke: SIGN_FIELD_STROKE,
    strokeWidth: 1.5,
    strokeDashArray: SIGN_FIELD_STROKE_DASH,
    rx: 3,
    ry: 3,
    selectable: true,
    opacity: ann.style?.opacity ?? 1,
  });
  setAnnotationId(obj, ann.id);
  return obj;
}

function buildStampObject(ann: Annotation, color: string): IText {
  // Stamp = styled IText with the label as content (no separate DOM overlay needed)
  const obj = new IText(ann.content || 'STAMP', {
    left: ann.x,
    top: ann.y,
    angle: ann.rotation,
    fontSize: STAMP_FONT_SIZE,
    fontFamily: "'Inter', sans-serif",
    fontWeight: 'bold',
    fill: color,
    textAlign: 'center',
    editable: false,
    selectable: true,
    opacity: ann.style?.opacity ?? 1,
    // Padding acts as visual spacing inside the selection box
    padding: 8,
  });
  restrictTextScaling(obj);
  setAnnotationId(obj, ann.id);
  return obj;
}

// ─── Shape builders ──────────────────────────────────────────────────────────

function buildShapeRectObject(ann: Annotation): Rect {
  const w = ann.width || DEFAULT_SHAPE_SIZE;
  const h = ann.height || DEFAULT_SHAPE_SIZE;
  const obj = new Rect({
    left: ann.x,
    top: ann.y,
    width: w,
    height: h,
    angle: ann.rotation,
    fill: ann.style?.backgroundColor ?? DEFAULT_SHAPE_FILL,
    stroke: ann.style?.color ?? DEFAULT_SHAPE_STROKE,
    strokeWidth: ann.style?.borderWidth ?? DEFAULT_DRAW_WIDTH,
    selectable: true,
    opacity: ann.style?.opacity ?? 1,
  });
  setAnnotationId(obj, ann.id);
  return obj;
}

function buildShapeCircleObject(ann: Annotation): Ellipse {
  const w = ann.width || DEFAULT_SHAPE_SIZE;
  const h = ann.height || DEFAULT_SHAPE_SIZE;
  const obj = new Ellipse({
    left: ann.x,
    top: ann.y,
    rx: w / 2,
    ry: h / 2,
    angle: ann.rotation,
    fill: ann.style?.backgroundColor ?? DEFAULT_SHAPE_FILL,
    stroke: ann.style?.color ?? DEFAULT_SHAPE_STROKE,
    strokeWidth: ann.style?.borderWidth ?? DEFAULT_DRAW_WIDTH,
    selectable: true,
    opacity: ann.style?.opacity ?? 1,
  });
  setAnnotationId(obj, ann.id);
  return obj;
}

function buildShapeLineObject(ann: Annotation): Line {
  const len = ann.width || DEFAULT_LINE_LENGTH;
  const obj = new Line([0, 0, len, 0], {
    left: ann.x,
    top: ann.y,
    angle: ann.rotation,
    stroke: ann.style?.color ?? DEFAULT_SHAPE_STROKE,
    strokeWidth: ann.style?.borderWidth ?? DEFAULT_DRAW_WIDTH,
    selectable: true,
    opacity: ann.style?.opacity ?? 1,
  });
  setAnnotationId(obj, ann.id);
  return obj;
}

/** Build a fabric object from a persisted Annotation. */
async function annotationToFabricObject(ann: Annotation): Promise<FabricObject | null> {
  switch (ann.type) {
    case 'text':
      return buildTextObject(ann);

    case 'image': {
      if (!ann.content) return null;
      try {
        const img = await FabricImage.fromURL(ann.content, {
          crossOrigin: 'anonymous',
        });
        img.set({
          left: ann.x,
          top: ann.y,
          angle: ann.rotation,
          opacity: ann.style?.opacity ?? 1,
          selectable: true,
        });
        // Scale to stored dimensions
        if (ann.width && ann.height && img.width && img.height) {
          img.scaleX = ann.width / img.width;
          img.scaleY = ann.height / img.height;
        }
        setAnnotationId(img, ann.id);
        return img;
      } catch {
        return null;
      }
    }

    case 'drawing': {
      if (!ann.content) return null;
      try {
        const pathObj = new Path(ann.content, {
          left: ann.x,
          top: ann.y,
          angle: ann.rotation,
          fill: '',
          stroke: ann.style?.color ?? DEFAULT_DRAW_COLOR,
          strokeWidth: ann.style?.borderWidth ?? DEFAULT_DRAW_WIDTH,
          selectable: true,
          opacity: ann.style?.opacity ?? 1,
        });
        setAnnotationId(pathObj, ann.id);
        return pathObj;
      } catch {
        return null;
      }
    }

    case 'sign_field':
      return buildSignFieldObject(ann);

    case 'stamp': {
      const stampDef = STAMPS.find((s) => s.label === ann.content);
      const color = stampDef?.color ?? ann.style?.color ?? '#6b7280';
      return buildStampObject(ann, color);
    }

    case 'shape': {
      switch (ann.content) {
        case 'rect':   return buildShapeRectObject(ann);
        case 'circle': return buildShapeCircleObject(ann);
        case 'line':   return buildShapeLineObject(ann);
        default:       return null;
      }
    }

    default:
      return null;
  }
}

// ─── Stamp Picker ─────────────────────────────────────────────────────────────

interface StampPickerProps {
  x: number;
  y: number;
  onSelect: (stamp: (typeof STAMPS)[number]) => void;
  onDismiss: () => void;
}

const StampPicker: React.FC<StampPickerProps> = ({ x, y, onSelect, onDismiss }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    // Delay to avoid the same click that opened the picker from closing it
    const timer = setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onDismiss]);

  // Render via portal to avoid fabric.js DOM conflicts
  return ReactDOM.createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Select stamp type"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 10000,
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        padding: '6px 0',
        minWidth: 160,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div
        style={{
          padding: '4px 12px 8px',
          fontSize: 11,
          color: '#9ca3af',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          borderBottom: '1px solid #f3f4f6',
          marginBottom: 4,
        }}
      >
        Choose Stamp
      </div>
      {STAMPS.map((stamp) => (
        <button
          key={stamp.label}
          role="menuitem"
          onClick={() => onSelect(stamp)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            width: '100%',
            padding: '7px 14px',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textAlign: 'left',
            fontSize: 13,
            color: '#111827',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = 'none';
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: stamp.color,
              flexShrink: 0,
            }}
          />
          {stamp.label}
        </button>
      ))}
    </div>,
    document.body,
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const AnnotationLayer: React.FC<AnnotationLayerProps> = ({
  width,
  height,
  pageNumber,
  annotations,
  activeTool,
  selectedAnnotationId,
  onAnnotationSelect,
  onAnnotationUpdate,
  onAnnotationAdd,
  onAnnotationDelete,
  zoom,
  drawColor,
  drawWidth,
  onSignRequest,
}) => {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce timer for object:modified updates
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending click position for image/stamp placement
  const pendingClickRef = useRef<{ x: number; y: number } | null>(null);

  // Stamp picker state
  const [stampPicker, setStampPicker] = useState<{
    screenX: number;
    screenY: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);

  // ── Stable callback refs ──────────────────────────────────────────────────
  // Keep the latest prop callbacks in a ref so event handlers can always call
  // the current version without needing to be re-registered.
  const callbacksRef = useRef({
    onAnnotationSelect,
    onAnnotationUpdate,
    onAnnotationAdd,
    onAnnotationDelete,
    onSignRequest,
  });
  useEffect(() => {
    callbacksRef.current = {
      onAnnotationSelect,
      onAnnotationUpdate,
      onAnnotationAdd,
      onAnnotationDelete,
      onSignRequest,
    };
  });

  // Keep a stable ref to current annotations for use inside event handlers
  const annotationsRef = useRef<Annotation[]>(annotations);
  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  // Keep stable refs for event handlers (avoids stale closures)
  const activeToolRef = useRef(activeTool);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);

  const pageNumberRef = useRef(pageNumber);
  useEffect(() => { pageNumberRef.current = pageNumber; }, [pageNumber]);

  const drawColorRef = useRef(drawColor ?? DEFAULT_DRAW_COLOR);
  useEffect(() => { drawColorRef.current = drawColor ?? DEFAULT_DRAW_COLOR; }, [drawColor]);

  const drawWidthRef = useRef(drawWidth ?? DEFAULT_DRAW_WIDTH);
  useEffect(() => { drawWidthRef.current = drawWidth ?? DEFAULT_DRAW_WIDTH; }, [drawWidth]);

  // ── Initialize fabric canvas on mount ────────────────────────────────────
  useLayoutEffect(() => {
    if (!canvasElRef.current) return;

    const fc = new Canvas(canvasElRef.current, {
      width,
      height,
      selection: true,
      backgroundColor: undefined, // transparent
      preserveObjectStacking: true,
      // Dark selection style (default light blue is hard to see)
      selectionColor: 'rgba(17, 24, 39, 0.08)',
      selectionBorderColor: '#111827',
      selectionLineWidth: 1,
      selectionFullyContained: false,
      skipTargetFind: false,
      // Allow Ctrl+Click (in addition to default Shift+Click) for multi-select
      multiSelectionKey: 'ctrlKey',
    });

    // Override default selection handle colors for ALL fabric objects
    const darkHandles = {
      borderColor: '#111827',
      cornerColor: '#111827',
      cornerStrokeColor: '#ffffff',
      cornerStyle: 'circle' as const,
      cornerSize: 8,
      transparentCorners: false,
      borderScaleFactor: 1.5,
    };
    Object.assign(FabricObject.ownDefaults, darkHandles);

    fabricRef.current = fc;

    // ── object:modified ──────────────────────────────────────────────────
    fc.on('object:modified', (e) => {
      const obj = e.target;
      if (!obj) return;
      const id = getAnnotationId(obj);
      if (!id) return;

      const existing = annotationsRef.current.find((a) => a.id === id);
      if (!existing) return;

      const updated = fabricToAnnotation(obj, existing);

      // Debounce rapid resize/move events
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(() => {
        callbacksRef.current.onAnnotationUpdate(updated);
      }, UPDATE_DEBOUNCE_MS);
    });

    // ── text:changed (IText live editing) ────────────────────────────────
    fc.on('text:changed' as never, (e: { target?: IText }) => {
      const obj = e.target;
      if (!obj || !(obj instanceof IText)) return;
      const id = getAnnotationId(obj);
      if (!id) return;
      const existing = annotationsRef.current.find((a) => a.id === id);
      if (!existing) return;
      const updated: Annotation = { ...existing, content: obj.text ?? '' };
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(() => {
        callbacksRef.current.onAnnotationUpdate(updated);
      }, UPDATE_DEBOUNCE_MS);
    });

    // ── selection events ─────────────────────────────────────────────────
    fc.on('selection:created', (e) => {
      const id = getAnnotationId(e.selected?.[0]);
      callbacksRef.current.onAnnotationSelect(id ?? null);
    });
    fc.on('selection:updated', (e) => {
      const id = getAnnotationId(e.selected?.[0]);
      callbacksRef.current.onAnnotationSelect(id ?? null);
    });
    fc.on('selection:cleared', () => {
      callbacksRef.current.onAnnotationSelect(null);
    });

    // ── keyboard: Delete / Backspace to remove selected annotation ────────
    const handleKeyDown = (e: KeyboardEvent) => {
      const fc = fabricRef.current;
      if (!fc) return;
      // Do not intercept key events while a text object is being edited
      const active = fc.getActiveObject();
      if (active instanceof IText && active.isEditing) return;

      // Do not intercept when a DOM input/textarea/select has focus
      const tag = (document.activeElement?.tagName ?? '').toLowerCase();
      const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select'
        || (document.activeElement as HTMLElement)?.isContentEditable;
      if (isEditable) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const selected = fc.getActiveObject();
        if (!selected) return;
        e.preventDefault();

        // Multi-selection (ActiveSelection group)
        if (selected instanceof ActiveSelection) {
          const objects = selected.getObjects();
          fc.discardActiveObject();
          objects.forEach((obj) => {
            const id = getAnnotationId(obj);
            if (id) {
              fc.remove(obj);
              callbacksRef.current.onAnnotationDelete(id);
            }
          });
        } else {
          const id = getAnnotationId(selected);
          if (!id) return;
          fc.remove(selected);
          fc.discardActiveObject();
          callbacksRef.current.onAnnotationDelete(id);
        }
        fc.renderAll();
        callbacksRef.current.onAnnotationSelect(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      fc.dispose();
      fabricRef.current = null;
    };
    // Intentionally omit reactive deps – we only init once.
    // Width/height/activeTool changes are handled in their own effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Resize canvas when dimensions change ─────────────────────────────────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc.setDimensions({ width, height });
    fc.renderAll();
  }, [width, height]);

  // ── Sync tool mode (selection, drawing) ──────────────────────────────────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    const isSelect = activeTool === 'select';
    const isDrawing = activeTool === 'draw';

    fc.isDrawingMode = isDrawing;
    fc.selection = isSelect;
    fc.skipTargetFind = !isSelect && !isDrawing;

    // Make existing objects selectable/moveable only in select mode.
    // Keep evented=true for all tools so the canvas-level mouse:down event
    // continues to fire reliably (setting evented=false can suppress the
    // canvas event pipeline in fabric v7 when selection is also false).
    fc.forEachObject((obj) => {
      obj.set({ selectable: isSelect, evented: true });
      obj.setCoords();
    });

    if (isDrawing) {
      const brush = new PencilBrush(fc);
      brush.width = drawWidth ?? DEFAULT_DRAW_WIDTH;
      brush.color = drawColor ?? DEFAULT_DRAW_COLOR;
      fc.freeDrawingBrush = brush;
    }

    fc.requestRenderAll();
  }, [activeTool, drawColor, drawWidth]);

  // ── Capture completed free-draw paths and convert to annotations ──────────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    const handlePathCreated = (e: { path?: Path }) => {
      const pathObj = e.path;
      if (!pathObj) return;

      // fabric adds the path automatically; we just need to tag it
      const id = generateId();
      setAnnotationId(pathObj, id);

      // path.path is the SVG path data array; fabric also stores pathOffset
      const pathData = (pathObj as Path & { path: unknown }).path;
      const svgPath =
        typeof pathData === 'string'
          ? pathData
          : JSON.stringify(pathData);

      const newAnn: Annotation = {
        id,
        type: 'drawing',
        page: pageNumber,
        x: pathObj.left ?? 0,
        y: pathObj.top ?? 0,
        width: pathObj.width ?? 0,
        height: pathObj.height ?? 0,
        rotation: 0,
        content: svgPath,
        style: {
          color: drawColorRef.current,
          borderWidth: drawWidthRef.current,
        },
      };

      pathObj.selectable = activeTool === 'select';
      pathObj.evented = true;
      fc.renderAll();
      callbacksRef.current.onAnnotationAdd(newAnn);
    };

    fc.on('path:created' as never, handlePathCreated as never);
    return () => {
      fc.off('path:created' as never, handlePathCreated as never);
    };
  }, [activeTool, pageNumber]);

  // ── Canvas click handler: text / image / stamp / sign_field placement ────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    const handleMouseDown = (opt: Record<string, unknown>) => {
      const tool = activeToolRef.current;
      // Only handle placement tools
      if (tool === 'select' || tool === 'draw') return;

      // Get coordinates - fabric v7 uses scenePoint, fall back to pointer/e
      let cx = 0;
      let cy = 0;
      const sp = opt.scenePoint as { x: number; y: number } | undefined;
      if (sp) {
        cx = sp.x;
        cy = sp.y;
      } else if (opt.e instanceof MouseEvent) {
        const rect = fc.getElement().getBoundingClientRect();
        cx = ((opt.e as MouseEvent).clientX - rect.left) / (fc.getZoom() || 1);
        cy = ((opt.e as MouseEvent).clientY - rect.top) / (fc.getZoom() || 1);
      }

      // Ignore if clicking an existing fabric object.
      if (opt.target != null) return;

      // For text tool: if an IText is currently in editing mode, exit editing
      // first and skip placing a new text object (user just wants to deselect).
      if (tool === 'text') {
        const active = fc.getActiveObject();
        if (active instanceof IText && active.isEditing) {
          active.exitEditing();
          fc.discardActiveObject();
          fc.renderAll();
          return;
        }
      }

      switch (tool) {
        case 'text': {
          const id = generateId();
          const textObj = new IText('Type here…', {
            left: cx,
            top: cy,
            fontSize: DEFAULT_FONT_SIZE,
            fontFamily: DEFAULT_FONT_FAMILY,
            fill: DEFAULT_TEXT_COLOR,
            selectable: true,
            editable: true,
          });
          restrictTextScaling(textObj);
          setAnnotationId(textObj, id);
          fc.add(textObj);
          fc.setActiveObject(textObj);
          textObj.enterEditing();
          textObj.selectAll();
          fc.renderAll();

          const pg = pageNumberRef.current;
          const newAnn: Annotation = {
            id,
            type: 'text',
            page: pg,
            x: cx,
            y: cy,
            width: textObj.width ?? 80,
            height: textObj.height ?? 24,
            rotation: 0,
            content: 'Type here…',
            style: {
              fontSize: DEFAULT_FONT_SIZE,
              fontFamily: DEFAULT_FONT_FAMILY,
              color: DEFAULT_TEXT_COLOR,
            },
          };
          callbacksRef.current.onAnnotationAdd(newAnn);
          break;
        }

        case 'image': {
          pendingClickRef.current = { x: cx, y: cy };
          fileInputRef.current?.click();
          break;
        }

        case 'stamp': {
          // Record canvas position; show picker near cursor on screen
          const canvasEl = canvasElRef.current;
          if (!canvasEl) break;
          const evtRect = canvasEl.getBoundingClientRect();
          const me = opt.e as MouseEvent | undefined;
          setStampPicker({
            screenX: me ? me.clientX : evtRect.left + cx,
            screenY: me ? me.clientY : evtRect.top + cy,
            canvasX: cx,
            canvasY: cy,
          });
          break;
        }

        case 'sign': {
          // Open signature modal with click position
          callbacksRef.current.onSignRequest?.({ x: cx, y: cy });
          break;
        }

        case 'shape_rect': {
          const id = generateId();
          const clr = drawColorRef.current;
          const sw = drawWidthRef.current;
          const rectObj = new Rect({
            left: cx,
            top: cy,
            width: DEFAULT_SHAPE_SIZE,
            height: DEFAULT_SHAPE_SIZE,
            fill: DEFAULT_SHAPE_FILL,
            stroke: clr,
            strokeWidth: sw,
            selectable: true,
          });
          setAnnotationId(rectObj, id);
          fc.add(rectObj);
          fc.setActiveObject(rectObj);
          fc.renderAll();

          callbacksRef.current.onAnnotationAdd({
            id,
            type: 'shape',
            page: pageNumberRef.current,
            x: cx,
            y: cy,
            width: DEFAULT_SHAPE_SIZE,
            height: DEFAULT_SHAPE_SIZE,
            rotation: 0,
            content: 'rect',
            style: { color: clr, borderWidth: sw, backgroundColor: DEFAULT_SHAPE_FILL },
          });
          break;
        }

        case 'shape_circle': {
          const id = generateId();
          const clr = drawColorRef.current;
          const sw = drawWidthRef.current;
          const ellipseObj = new Ellipse({
            left: cx,
            top: cy,
            rx: DEFAULT_SHAPE_SIZE / 2,
            ry: DEFAULT_SHAPE_SIZE / 2,
            fill: DEFAULT_SHAPE_FILL,
            stroke: clr,
            strokeWidth: sw,
            selectable: true,
          });
          setAnnotationId(ellipseObj, id);
          fc.add(ellipseObj);
          fc.setActiveObject(ellipseObj);
          fc.renderAll();

          callbacksRef.current.onAnnotationAdd({
            id,
            type: 'shape',
            page: pageNumberRef.current,
            x: cx,
            y: cy,
            width: DEFAULT_SHAPE_SIZE,
            height: DEFAULT_SHAPE_SIZE,
            rotation: 0,
            content: 'circle',
            style: { color: clr, borderWidth: sw, backgroundColor: DEFAULT_SHAPE_FILL },
          });
          break;
        }

        case 'shape_line': {
          const id = generateId();
          const clr = drawColorRef.current;
          const sw = drawWidthRef.current;
          const lineObj = new Line([0, 0, DEFAULT_LINE_LENGTH, 0], {
            left: cx,
            top: cy,
            stroke: clr,
            strokeWidth: sw,
            selectable: true,
          });
          setAnnotationId(lineObj, id);
          fc.add(lineObj);
          fc.setActiveObject(lineObj);
          fc.renderAll();

          callbacksRef.current.onAnnotationAdd({
            id,
            type: 'shape',
            page: pageNumberRef.current,
            x: cx,
            y: cy,
            width: DEFAULT_LINE_LENGTH,
            height: sw,
            rotation: 0,
            content: 'line',
            style: { color: clr, borderWidth: sw },
          });
          break;
        }
      }
    };

    fc.on('mouse:down' as never, handleMouseDown as never);
    return () => {
      fc.off('mouse:down' as never, handleMouseDown as never);
    };
    // Register once — handler reads tool/page from refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Place stamp after user picks a label ─────────────────────────────────
  const handleStampSelect = useCallback(
    (stamp: (typeof STAMPS)[number]) => {
      const fc = fabricRef.current;
      if (!fc || !stampPicker) return;
      setStampPicker(null);

      const { canvasX: cx, canvasY: cy } = stampPicker;
      const id = generateId();

      const stampText = new IText(stamp.label, {
        left: cx,
        top: cy,
        fontSize: STAMP_FONT_SIZE,
        fontFamily: "'Inter', sans-serif",
        fontWeight: 'bold',
        fill: stamp.color,
        textAlign: 'center',
        editable: false,
        selectable: true,
        padding: 8,
      });
      restrictTextScaling(stampText);
      setAnnotationId(stampText, id);
      fc.add(stampText);
      fc.setActiveObject(stampText);
      fc.renderAll();

      const newAnn: Annotation = {
        id,
        type: 'stamp',
        page: pageNumberRef.current,
        x: cx,
        y: cy,
        width: stampText.width ?? 100,
        height: stampText.height ?? 30,
        rotation: 0,
        content: stamp.label,
        style: { color: stamp.color },
      };
      callbacksRef.current.onAnnotationAdd(newAnn);
    },
    [stampPicker, pageNumber],
  );

  // ── Handle image file selection ───────────────────────────────────────────
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fc = fabricRef.current;
      const file = e.target.files?.[0];
      const pos = pendingClickRef.current;
      // Reset input so the same file can be re-selected
      e.target.value = '';

      if (!fc || !file || !pos) {
        pendingClickRef.current = null;
        return;
      }
      pendingClickRef.current = null;

      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target?.result as string | undefined;
        if (!dataUrl) return;

        try {
          const img = await FabricImage.fromURL(dataUrl);
          // Default max width/height inside the canvas
          const maxW = Math.min(300, width * 0.5);
          const maxH = Math.min(300, height * 0.5);
          const scaleX = img.width ? Math.min(1, maxW / img.width) : 1;
          const scaleY = img.height ? Math.min(1, maxH / img.height) : 1;
          const scale = Math.min(scaleX, scaleY);

          img.set({
            left: pos.x,
            top: pos.y,
            scaleX: scale,
            scaleY: scale,
            selectable: true,
          });

          const id = generateId();
          setAnnotationId(img, id);
          fc.add(img);
          fc.setActiveObject(img);
          fc.renderAll();

          const finalW = (img.width ?? 0) * scale;
          const finalH = (img.height ?? 0) * scale;

          const newAnn: Annotation = {
            id,
            type: 'image',
            page: pageNumber,
            x: pos.x,
            y: pos.y,
            width: finalW,
            height: finalH,
            rotation: 0,
            content: dataUrl,
            style: { opacity: 1 },
          };
          callbacksRef.current.onAnnotationAdd(newAnn);
        } catch {
          // Silently fail – image could not be loaded
        }
      };
      reader.readAsDataURL(file);
    },
    [pageNumber, width, height],
  );

  // ── Sync annotations prop → fabric canvas objects ─────────────────────────
  // Strategy: diff by annotationId so we don't thrash objects that haven't
  // changed. This runs after every annotations change.
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    const annMap = new Map<string, Annotation>(annotations.map((a) => [a.id, a]));

    // Remove fabric objects whose annotation no longer exists
    const toRemove: FabricObject[] = [];
    fc.forEachObject((obj) => {
      const id = getAnnotationId(obj);
      if (id && !annMap.has(id)) {
        toRemove.push(obj);
      }
    });
    toRemove.forEach((obj) => fc.remove(obj));

    // Build a map of existing fabric objects by annotationId
    const fabricMap = new Map<string, FabricObject>();
    fc.forEachObject((obj) => {
      const id = getAnnotationId(obj);
      if (id) fabricMap.set(id, obj);
    });

    // Add new annotations OR update existing ones
    let needsRender = toRemove.length > 0;
    const addPromises: Promise<void>[] = [];

    for (const ann of annotations) {
      const existingObj = fabricMap.get(ann.id);

      if (!existingObj) {
        // New annotation — create fabric object
        const p = annotationToFabricObject(ann).then((obj) => {
          if (!obj) return;
          obj.selectable = activeTool === 'select';
          obj.evented = true;
          fc.add(obj);
        });
        addPromises.push(p);
      } else {
        // Existing annotation — update fabric object properties from annotation
        // Skip if this object is currently being edited (e.g. IText in edit mode)
        if (existingObj instanceof IText && existingObj.isEditing) continue;

        // Update position/size
        existingObj.set({
          left: ann.x,
          top: ann.y,
          angle: ann.rotation || 0,
        });

        // Update text content
        if (existingObj instanceof IText && existingObj.text !== ann.content) {
          existingObj.set({ text: ann.content });
        }

        // Update style properties
        const s = ann.style || {};
        if (existingObj instanceof IText) {
          existingObj.set({
            fontSize: s.fontSize ?? existingObj.fontSize,
            fontFamily: s.fontFamily ?? existingObj.fontFamily,
            fontWeight: (s.fontWeight as string) ?? existingObj.fontWeight,
            fontStyle: (s.fontStyle as string) ?? existingObj.fontStyle,
            underline: s.textDecoration === 'underline',
            fill: s.color ?? existingObj.fill,
          });
        }

        // Update drawing stroke color/width
        if (ann.type === 'drawing' && existingObj instanceof Path) {
          existingObj.set({
            stroke: s.color ?? DEFAULT_DRAW_COLOR,
            strokeWidth: s.borderWidth ?? DEFAULT_DRAW_WIDTH,
          });
        }

        // Update shape style (stroke, fill, width)
        if (ann.type === 'shape') {
          const shapeProps: Record<string, unknown> = {
            stroke: s.color ?? DEFAULT_SHAPE_STROKE,
            strokeWidth: s.borderWidth ?? DEFAULT_DRAW_WIDTH,
          };
          // Fill for rect/circle (not line)
          if (ann.content !== 'line') {
            shapeProps.fill = s.backgroundColor ?? DEFAULT_SHAPE_FILL;
          }
          existingObj.set(shapeProps);
        }

        // Update opacity (all types)
        if (s.opacity !== undefined) {
          existingObj.set({ opacity: s.opacity });
        }

        existingObj.setCoords();
        needsRender = true;
      }
    }

    if (addPromises.length > 0) {
      Promise.all(addPromises).then(() => fc.renderAll());
    } else if (needsRender) {
      fc.renderAll();
    }
    // `activeTool` intentionally omitted – tool mode is handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations]);

  // ── Sync selectedAnnotationId → fabric active object ─────────────────────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    if (selectedAnnotationId === null) {
      fc.discardActiveObject();
      fc.renderAll();
      return;
    }

    // Find the fabric object with that id
    let target: FabricObject | null = null;
    fc.forEachObject((obj) => {
      if (getAnnotationId(obj) === selectedAnnotationId) {
        target = obj;
      }
    });

    if (target) {
      fc.setActiveObject(target);
      fc.renderAll();
    }
  }, [selectedAnnotationId]);

  // ── Apply zoom by scaling canvas transform ────────────────────────────────
  // The parent renders the PDF at zoom*viewport resolution, and passes us
  // width/height already scaled. The fabric canvas dimensions match, so all
  // annotation coordinates are stored in PDF-space (zoom=1) coordinates and
  // we need to apply the zoom as a viewport transform here.
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    fc.setZoom(zoom);
    fc.setDimensions({ width, height });
    fc.renderAll();
  }, [zoom, width, height]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Fabric canvas wrapper — ONLY the <canvas> goes here.
          Fabric.js mutates the DOM around the canvas element, so no other
          React children may exist inside this div. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height,
          pointerEvents: 'auto',
          background: 'transparent',
          overflow: 'visible',
          outline: 'none',
        }}
        tabIndex={0}
        aria-label={`Annotation layer for page ${pageNumber}`}
        role="region"
      >
        <canvas
          ref={canvasElRef}
          aria-hidden="true"
          style={{ display: 'block' }}
        />
      </div>

      {/* Everything below is rendered OUTSIDE the fabric-managed div */}

      {/* Hidden file input for image insertion */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none', position: 'absolute' }}
        onChange={handleFileChange}
        aria-hidden="true"
        tabIndex={-1}
      />

      {/* Stamp type picker — portalled to body */}
      {stampPicker && (
        <StampPicker
          x={stampPicker.screenX}
          y={stampPicker.screenY}
          onSelect={handleStampSelect}
          onDismiss={() => setStampPicker(null)}
        />
      )}

      {/* Sign-field label overlays */}
      {annotations
        .filter((a) => a.type === 'sign_field')
        .map((a) => (
          <SignFieldLabel key={a.id} annotation={a} zoom={zoom} />
        ))}

      {/* Stamps are rendered as IText directly in fabric — no DOM overlay needed */}
    </>
  );
};

// ─── Sign Field Label Overlay ─────────────────────────────────────────────────

/**
 * Renders the "Signature" text label inside a sign_field annotation as a
 * pure DOM element. This keeps it crisp at any zoom level and avoids the
 * complexity of keeping a fabric Text object in sync with the Rect.
 */
const SignFieldLabel: React.FC<{ annotation: Annotation; zoom: number }> = ({
  annotation: a,
  zoom,
}) => {
  const w = (a.width || SIGN_FIELD_DEFAULT_W) * zoom;
  const h = (a.height || SIGN_FIELD_DEFAULT_H) * zoom;
  const x = a.x * zoom;
  const y = a.y * zoom;

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        transform: a.rotation ? `rotate(${a.rotation}deg)` : undefined,
        transformOrigin: '0 0',
      }}
    >
      <span
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize: Math.max(10, 13 * zoom),
          color: '#6b7280',
          userSelect: 'none',
          letterSpacing: '0.03em',
          fontWeight: 500,
        }}
      >
        {a.content || 'Signature'}
      </span>
    </div>
  );
};

// ─── Stamp Label Overlay ──────────────────────────────────────────────────────

const StampLabel: React.FC<{ annotation: Annotation; zoom: number }> = ({
  annotation: a,
  zoom,
}) => {
  const stampDef = STAMPS.find((s) => s.label === a.content);
  const color = stampDef?.color ?? a.style?.color ?? '#6b7280';

  const w = a.width * zoom;
  const h = a.height * zoom;
  const x = a.x * zoom;
  const y = a.y * zoom;
  const fontSize = Math.max(9, STAMP_FONT_SIZE * zoom);

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        transform: a.rotation ? `rotate(${a.rotation}deg)` : undefined,
        transformOrigin: '0 0',
      }}
    >
      <span
        style={{
          fontFamily: "'Inter', sans-serif",
          fontSize,
          color,
          fontWeight: 700,
          letterSpacing: '0.1em',
          userSelect: 'none',
        }}
      >
        {a.content}
      </span>
    </div>
  );
};

export default AnnotationLayer;
