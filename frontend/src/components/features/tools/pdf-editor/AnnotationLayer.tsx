/**
 * Scopit – PDF Editor: AnnotationLayer
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
  util,
  type TPointerEvent,
} from 'fabric';
import type { Annotation, AnnotationStyle, PageImage } from './types';
import { findRunAt, runPoint, type PdfFontFace, type PdfTextLayer } from './pdfTextRuns';

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
export const DEFAULT_CHECK_SIZE = 24;
const UPDATE_DEBOUNCE_MS = 120;

/**
 * Edit Text replaces a piece of the PDF's own text with a pair of
 * annotations: a cover over the original words (id = text id + this
 * suffix) and the new text. The cover erases the words from the page itself
 * (the backend drops their glyphs, in the preview PdfCanvas shows and in the
 * export); it's only painted, in the page's background color, until the
 * erased page is on screen, or where the words couldn't be erased. The id
 * link lets a second click on the same spot reopen the replacement instead
 * of stacking another one. Deleting the text empties it and keeps the
 * cover, which is how words get removed; the pair goes away together only
 * to restore the original.
 */
export const TEXT_COVER_SUFFIX = ':cover';

/**
 * Whether an annotation id is a cover's. Edit uses the same pairing for the
 * page's own images: picking one up adds a cover over it (which takes it off
 * the page) and an image annotation of it to move, resize, replace or delete.
 */
export function isTextCoverId(id: string | null | undefined): boolean {
  return !!id && id.endsWith(TEXT_COVER_SUFFIX);
}

/** Whether a cover's partner is an image: it covers a picked-up image, not words */
export function isImageCover(cover: Annotation, all: Annotation[]): boolean {
  const partnerId = cover.id.slice(0, -TEXT_COVER_SUFFIX.length);
  return all.some((a) => a.id === partnerId && a.type === 'image');
}

// Redaction marks: red until applied, when what's under them goes for good
const REDACT_STROKE = '#dc2626';
const REDACT_FILL = 'rgba(220, 38, 38, 0.14)';
// A redact drag shorter than this (page units) is a click: it marks the text under it
const REDACT_CLICK_SLOP = 3;
// An Edit press on the page's text that moves less than this (page units)
// is a click, which types into it; further, it drags the text somewhere else
const EDIT_DRAG_SLOP = 3;
// fabric IText: a single line is fontSize * 1.13 tall with the baseline at
// 77.8% of that (see _FABRIC_* in the backend's burn code)
const FABRIC_BASELINE_RATIO = 1 - 0.222;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AnnotationLayerProps {
  width: number;
  height: number;
  pageNumber: number;
  annotations: Annotation[];
  activeTool: string;
  selectedAnnotationId: string | null;
  onAnnotationSelect: (id: string | null) => void;
  /** One or more annotations changed on the canvas (move/resize/rotate/edit) */
  onAnnotationUpdate: (annotations: Annotation[]) => void;
  onAnnotationAdd: (annotation: Annotation) => void;
  onAnnotationDelete: (id: string) => void;
  zoom: number;
  drawColor?: string;
  drawWidth?: number;
  /** Side length used for newly placed check marks */
  checkSize?: number;
  /** Called when user clicks canvas with sign tool – provides click position */
  onSignRequest?: (pos: { x: number; y: number }) => void;
  /** The page's existing text, for the edit_text tool */
  textLayer?: PdfTextLayer | null;
  /** Edit Text covers whose words the page on screen has already erased */
  erasedCoverIds?: ReadonlySet<string>;
  /**
   * The edit_text tool covered a piece of PDF text: `added` is [cover, text]
   * (or just [text] if the cover already existed), already on the canvas
   * with the text in editing mode. Empty when the click reopened an
   * existing replacement instead.
   */
  onTextReplace?: (added: Annotation[]) => void;
  /** The page's own images, for the edit_text tool to pick up (null while loading) */
  pageImages?: PageImage[] | null;
  /** The edit_text tool clicked one of the page's images: make it editable */
  onImagePick?: (image: PageImage) => void;
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

/**
 * Same idea for a check mark: corner handles only, so it always resizes as a
 * square and its single "size" stays meaningful.
 */
function restrictToUniformScaling(obj: FabricObject): void {
  obj.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
}

/**
 * Extract position / size / rotation from a fabric object into an Annotation.
 *
 * x/y are the object's CENTER on the page and rotation is clockwise around
 * it -- the backend burns annotations into the PDF with exactly that
 * convention. Read from the absolute transform so it's also right for
 * objects that are part of a multi-selection (whose left/top are relative
 * to the selection).
 */
function fabricToAnnotation(obj: FabricObject, existing: Annotation): Annotation {
  const t = util.qrDecompose(obj.calcTransformMatrix());
  const rawWidth = obj.width ?? existing.width;
  const rawHeight = obj.height ?? existing.height;

  let content = existing.content;
  if (obj instanceof IText) {
    content = obj.text ?? existing.content;
  }

  return {
    ...existing,
    x: t.translateX,
    y: t.translateY,
    width: rawWidth * Math.abs(t.scaleX),
    height: rawHeight * Math.abs(t.scaleY),
    rotation: ((t.angle % 360) + 360) % 360,
    content,
  };
}

/**
 * Corner-scaling text stretches the glyphs via scaleX/Y, which neither the
 * saved annotation nor the PDF export know about. Fold the scale into the
 * font size so the size sticks after a reload and in the exported file.
 * Returns the new font size, or null if the object wasn't scaled.
 */
function foldTextScale(obj: IText): number | null {
  const scale = obj.scaleX ?? 1;
  if (Math.abs(scale - 1) < 0.001 && Math.abs((obj.scaleY ?? 1) - 1) < 0.001) return null;
  const fontSize = Math.max(1, Math.round((obj.fontSize ?? DEFAULT_FONT_SIZE) * scale * 10) / 10);
  obj.set({ fontSize, scaleX: 1, scaleY: 1 });
  obj.initDimensions(); // fabric re-measures text lazily; we need the new size now
  obj.setCoords();
  return fontSize;
}

type Box = Pick<Annotation, 'x' | 'y' | 'width' | 'height' | 'rotation'>;

/** Whether a page point lies inside an annotation's (rotated) box. */
function annotationContains(ann: Box, px: number, py: number): boolean {
  const a = (-(ann.rotation || 0) * Math.PI) / 180;
  const dx = px - ann.x;
  const dy = py - ann.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= ann.width / 2 && Math.abs(ly) <= ann.height / 2;
}

/** Whether two boxes overlap (by their unrotated extents: close enough here). */
function boxesOverlap(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) <= (a.width + b.width) / 2
    && Math.abs(a.y - b.y) <= (a.height + b.height) / 2;
}

/** Corner (top-left, before rotation) of an annotation's box. */
function annotationCorner(ann: Box): { x: number; y: number } {
  const a = ((ann.rotation || 0) * Math.PI) / 180;
  const dx = -ann.width / 2;
  const dy = -ann.height / 2;
  return {
    x: ann.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: ann.y + dx * Math.sin(a) + dy * Math.cos(a),
  };
}

/**
 * Font of a text annotation on the canvas. An Edit Text replacement is
 * drawn with the PDF font of the words it replaced, exactly as pdf.js draws
 * them, while pdf.js has that font loaded; otherwise with its fallback.
 */
function textFontProps(
  style: AnnotationStyle | undefined,
  fonts: Map<string, PdfFontFace> | null,
): { fontFamily: string; fontWeight: string; fontStyle: '' | 'normal' | 'italic' | 'oblique' } {
  const face = style?.pdfFont ? fonts?.get(style.pdfFont) : undefined;
  if (face) {
    return { fontFamily: face.family, fontWeight: face.weight, fontStyle: face.style as 'normal' | 'italic' };
  }
  return {
    fontFamily: style?.fontFamily ?? DEFAULT_FONT_FAMILY,
    fontWeight: style?.fontWeight ?? 'normal',
    fontStyle: (style?.fontStyle as 'normal' | 'italic' | 'oblique') ?? 'normal',
  };
}

/** Image border, drawn by fabric as a stroke around the image. */
function imageBorderProps(style: AnnotationStyle | undefined) {
  const width = style?.borderWidth ?? 0;
  return width > 0
    ? { stroke: style?.borderColor ?? '#6b7280', strokeWidth: width, strokeUniform: true }
    : { stroke: null, strokeWidth: 0 };
}

// ─── Annotation → Fabric object ──────────────────────────────────────────────

interface BuildOptions {
  /** Loaded PDF fonts, for Edit Text replacements */
  fonts?: Map<string, PdfFontFace> | null;
  /** An Edit Text replacement: may be empty (its words were deleted) */
  replacement?: boolean;
}

function buildTextObject(ann: Annotation, opts: BuildOptions = {}): IText {
  const style = ann.style ?? {};
  const obj = new IText(opts.replacement ? ann.content : ann.content || 'Text', {
    left: ann.x,
    top: ann.y,
    angle: ann.rotation,
    fontSize: style.fontSize ?? DEFAULT_FONT_SIZE,
    ...textFontProps(style, opts.fonts ?? null),
    underline: style.textDecoration === 'underline',
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

function buildRedactObject(ann: Annotation): Rect {
  const obj = new Rect({
    left: ann.x,
    top: ann.y,
    width: Math.max(1, ann.width),
    height: Math.max(1, ann.height),
    angle: ann.rotation,
    fill: REDACT_FILL,
    stroke: REDACT_STROKE,
    strokeWidth: 1.5,
    strokeUniform: true,
    selectable: true,
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
    fontSize: ann.style?.fontSize ?? STAMP_FONT_SIZE,
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
    strokeUniform: true,
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
    strokeUniform: true,
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
    strokeUniform: true,
    selectable: true,
    opacity: ann.style?.opacity ?? 1,
  });
  setAnnotationId(obj, ann.id);
  return obj;
}

/** Check mark path spanning the full size×size box (so path bounds == size). */
function checkPathData(size: number): string {
  return `M 0 ${size * 0.55} L ${size * 0.36} ${size} L ${size} 0`;
}

function buildShapeCheckObject(ann: Annotation): Path {
  const size = ann.width || DEFAULT_CHECK_SIZE;
  const obj = new Path(checkPathData(size), {
    left: ann.x,
    top: ann.y,
    angle: ann.rotation,
    fill: '',
    stroke: ann.style?.color ?? DEFAULT_SHAPE_STROKE,
    strokeWidth: ann.style?.borderWidth ?? DEFAULT_DRAW_WIDTH,
    // Resizing scales the path, not the line weight
    strokeUniform: true,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    selectable: true,
    opacity: ann.style?.opacity ?? 1,
  });
  restrictToUniformScaling(obj);
  setAnnotationId(obj, ann.id);
  return obj;
}

/** Build a fabric object from a persisted Annotation. */
async function annotationToFabricObject(
  ann: Annotation,
  opts: BuildOptions = {},
): Promise<FabricObject | null> {
  switch (ann.type) {
    case 'text':
      return buildTextObject(ann, opts);

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
          ...imageBorderProps(ann.style),
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
          strokeUniform: true,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          selectable: true,
          opacity: ann.style?.opacity ?? 1,
        });
        // A resized drawing is saved as its scaled size; restore that scale
        if (ann.width && ann.height && pathObj.width && pathObj.height) {
          pathObj.scaleX = ann.width / pathObj.width;
          pathObj.scaleY = ann.height / pathObj.height;
        }
        setAnnotationId(pathObj, ann.id);
        return pathObj;
      } catch {
        return null;
      }
    }

    case 'sign_field':
      return buildSignFieldObject(ann);

    case 'redact':
      return buildRedactObject(ann);

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
        case 'check':  return buildShapeCheckObject(ann);
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
  checkSize,
  onSignRequest,
  textLayer,
  erasedCoverIds,
  onTextReplace,
  pageImages,
  onImagePick,
}) => {
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Debounce timer + pending batch for object:modified / text:changed updates
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUpdatesRef = useRef<Map<string, Annotation>>(new Map());
  const queueUpdatesRef = useRef<(updates: Annotation[]) => void>(() => {});

  // Ids whose fabric object is still being built (images load async), so a
  // second annotations change can't add the same object twice
  const pendingAddsRef = useRef<Set<string>>(new Set());

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
    onTextReplace,
    onImagePick,
  });
  useEffect(() => {
    callbacksRef.current = {
      onAnnotationSelect,
      onAnnotationUpdate,
      onAnnotationAdd,
      onAnnotationDelete,
      onSignRequest,
      onTextReplace,
      onImagePick,
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

  // The selection, for objects that are built after it was made (images
  // load asynchronously); and images rebuilt while selected
  const selectedIdRef = useRef(selectedAnnotationId);
  selectedIdRef.current = selectedAnnotationId;
  const reselectRef = useRef<Set<string>>(new Set());

  const pageNumberRef = useRef(pageNumber);
  useEffect(() => { pageNumberRef.current = pageNumber; }, [pageNumber]);

  const drawColorRef = useRef(drawColor ?? DEFAULT_DRAW_COLOR);
  useEffect(() => { drawColorRef.current = drawColor ?? DEFAULT_DRAW_COLOR; }, [drawColor]);

  const drawWidthRef = useRef(drawWidth ?? DEFAULT_DRAW_WIDTH);
  useEffect(() => { drawWidthRef.current = drawWidth ?? DEFAULT_DRAW_WIDTH; }, [drawWidth]);

  const checkSizeRef = useRef(checkSize ?? DEFAULT_CHECK_SIZE);
  useEffect(() => { checkSizeRef.current = checkSize ?? DEFAULT_CHECK_SIZE; }, [checkSize]);

  const textLayerRef = useRef(textLayer ?? null);
  useEffect(() => { textLayerRef.current = textLayer ?? null; }, [textLayer]);
  // Kept while a page re-renders (the layer is null then), so replacements
  // don't flicker to their fallback font
  const fontsRef = useRef<Map<string, PdfFontFace> | null>(null);

  const erasedCoversRef = useRef<ReadonlySet<string>>(erasedCoverIds ?? new Set());
  useEffect(() => { erasedCoversRef.current = erasedCoverIds ?? new Set(); }, [erasedCoverIds]);

  const pageImagesRef = useRef<PageImage[]>(pageImages ?? []);
  useEffect(() => { pageImagesRef.current = pageImages ?? []; }, [pageImages]);

  // A redact drag in progress: where it started and the box drawn so far
  const redactDragRef = useRef<{ x: number; y: number; rect: Rect } | null>(null);

  // Edit pressed on the page's text and made it a replacement: released
  // where it was pressed, it types into it; dragged, it moves it. Where the
  // press started and where the text was then, page units.
  const editPressRef = useRef<{
    obj: IText;
    ann: Annotation;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);

  // What a click with the edit_text tool would edit (PDF text or image, or a
  // spot already replaced), or the redact tool would mark. Top-left corner,
  // size and clockwise angle, page units.
  const [hoverBox, setHoverBox] = useState<
    { key: string; x: number; y: number; width: number; height: number; angle: number } | null
  >(null);
  useEffect(() => {
    if (activeTool !== 'edit_text' && activeTool !== 'redact') setHoverBox(null);
  }, [activeTool]);
  useEffect(() => { setHoverBox(null); }, [textLayer, pageImages]);

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
    Object.assign(FabricObject.ownDefaults, darkHandles, {
      // Annotation x/y are object centers; the PDF export depends on this.
      // fabric 7 already defaults to center -- pinned so an upgrade can't
      // silently shift every exported annotation.
      originX: 'center' as const,
      originY: 'center' as const,
    });

    fabricRef.current = fc;

    // Debounce rapid resize/move/typing events; batch per annotation id so a
    // multi-object move isn't reduced to its last object
    const queueUpdates = (updates: Annotation[]) => {
      if (updates.length === 0) return;
      for (const u of updates) pendingUpdatesRef.current.set(u.id, u);
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
      updateTimerRef.current = setTimeout(() => {
        const batch = Array.from(pendingUpdatesRef.current.values());
        pendingUpdatesRef.current.clear();
        if (batch.length) callbacksRef.current.onAnnotationUpdate(batch);
      }, UPDATE_DEBOUNCE_MS);
    };
    queueUpdatesRef.current = queueUpdates;

    // ── object:modified ──────────────────────────────────────────────────
    fc.on('object:modified', (e) => {
      const target = e.target;
      if (!target) return;

      // A moved/scaled multi-selection reports only the selection itself.
      // Dissolve it so its children get their absolute geometry back, save
      // each one, then restore the same selection.
      const isGroup = target instanceof ActiveSelection;
      const objects = isGroup ? target.getObjects() : [target];
      if (isGroup) fc.discardActiveObject();

      const updates: Annotation[] = [];
      for (const obj of objects) {
        const id = getAnnotationId(obj);
        if (!id) continue;
        const existing = annotationsRef.current.find((a) => a.id === id);
        if (!existing) continue;

        let style = existing.style;
        if (obj instanceof IText) {
          const fontSize = foldTextScale(obj);
          if (fontSize !== null) style = { ...style, fontSize };
        }
        updates.push({ ...fabricToAnnotation(obj, existing), style });
      }

      if (isGroup && objects.length > 1) {
        fc.setActiveObject(new ActiveSelection(objects, { canvas: fc }));
      }
      fc.requestRenderAll();
      queueUpdates(updates);
    });

    // ── text:changed (IText live editing) ────────────────────────────────
    fc.on('text:changed' as never, (e: { target?: IText }) => {
      const obj = e.target;
      if (!obj || !(obj instanceof IText)) return;
      const id = getAnnotationId(obj);
      if (!id) return;
      const existing = annotationsRef.current.find((a) => a.id === id);
      if (!existing) return;
      queueUpdates([fabricToAnnotation(obj, existing)]);
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

        // An Edit Text replacement stays on the canvas: the editor empties
        // it instead, and its cover keeps the original words erased
        const remove = (obj: FabricObject) => {
          const id = getAnnotationId(obj);
          if (!id) return;
          const isReplacement = annotationsRef.current.some((a) => a.id === id + TEXT_COVER_SUFFIX);
          if (!isReplacement) fc.remove(obj);
          callbacksRef.current.onAnnotationDelete(id);
        };

        // Multi-selection (ActiveSelection group)
        if (selected instanceof ActiveSelection) {
          const objects = selected.getObjects();
          fc.discardActiveObject();
          objects.forEach(remove);
        } else {
          fc.discardActiveObject();
          remove(selected);
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
    const isEdit = activeTool === 'edit_text';
    const isDrawing = activeTool === 'draw';
    const isRedact = activeTool === 'redact';

    fc.isDrawingMode = isDrawing;
    // No marquee in Edit: a press on the page's text drags that text
    fc.selection = isSelect;
    // The redact tool can still grab its marks to move or resize them, and
    // Edit everything (its replacements, picked-up images, other elements)
    fc.skipTargetFind = !isSelect && !isEdit && !isDrawing && !isRedact;
    fc.defaultCursor = isRedact ? 'crosshair' : 'default';

    // Make existing objects selectable/moveable only in select and edit mode.
    // Keep evented=true for all tools so the canvas-level mouse:down event
    // continues to fire reliably (setting evented=false can suppress the
    // canvas event pipeline in fabric v7 when selection is also false).
    // Edit covers are never picked: they go with their text or image.
    const marks = new Set(annotationsRef.current.filter((a) => a.type === 'redact').map((a) => a.id));
    fc.forEachObject((obj) => {
      const id = getAnnotationId(obj);
      const cover = isTextCoverId(id);
      const mark = !!id && marks.has(id);
      obj.set({ selectable: (isSelect || isEdit || (isRedact && mark)) && !cover, evented: !cover });
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

      pathObj.set({ strokeUniform: true, strokeLineCap: 'round', strokeLineJoin: 'round' });
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

    // A cover whose new text was dragged off it: the spot is just erased
    // now, with nothing there to edit
    const movedAway = (cover: Annotation): boolean => {
      const partnerId = cover.id.slice(0, -TEXT_COVER_SUFFIX.length);
      const partner = annotationsRef.current.find((a) => a.id === partnerId);
      return !!partner && !boxesOverlap(partner, cover);
    };

    // An Edit replacement at a page point, over the words it erased (the
    // cover) or its new text -- or a picked-up image where it is now (an
    // image's cover isn't one: words printed where the image used to be
    // are still there to edit): { cover, hit: whichever of the two is there }
    const findReplacement = (px: number, py: number): { cover: Annotation; hit: Annotation } | null => {
      const anns = annotationsRef.current;
      for (let i = anns.length - 1; i >= 0; i--) {
        const a = anns[i];
        if (!annotationContains(a, px, py)) continue;
        if (isTextCoverId(a.id)) {
          if (isImageCover(a, anns) || movedAway(a)) continue;
          return { cover: a, hit: a };
        }
        const cover = (a.type === 'text' || a.type === 'image') && a.content
          ? anns.find((c) => c.id === a.id + TEXT_COVER_SUFFIX)
          : undefined;
        if (cover) return { cover, hit: a };
      }
      return null;
    };
    const replacementAt = (px: number, py: number) => findReplacement(px, py)?.cover ?? null;

    // One of the page's own images under a page point that Edit can pick
    // up: not its background (a scan), and not one already picked up
    const findImageAt = (px: number, py: number): PageImage | null => {
      const anns = annotationsRef.current;
      const images = pageImagesRef.current;
      for (let i = images.length - 1; i >= 0; i--) {
        const img = images[i];
        if (img.background || !annotationContains(img, px, py)) continue;
        const taken = anns.some(
          (c) => isTextCoverId(c.id) && isImageCover(c, anns) && annotationContains(c, img.x, img.y),
        );
        if (!taken) return img;
      }
      return null;
    };

    // A redaction mark over a run of the page's text
    const runMark = (layer: PdfTextLayer, px: number, py: number): Annotation | null => {
      const run = findRunAt(layer.runs, px, py);
      if (!run) return null;
      const pad = Math.max(1, run.fontSize * 0.08);
      const center = runPoint(run, run.width / 2, (run.descent - run.ascent) / 2);
      return {
        id: generateId(),
        type: 'redact',
        page: pageNumberRef.current,
        x: center.x,
        y: center.y,
        width: run.width + pad * 2,
        height: run.ascent + run.descent + pad * 2,
        rotation: ((run.angle % 360) + 360) % 360,
        content: run.text,
        style: {},
      };
    };

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

      // Ignore if clicking an existing fabric object -- except that the
      // redact tool draws over anything but its own marks (it moves those)
      if (opt.target != null) {
        const targetId = getAnnotationId(opt.target as FabricObject);
        const isMark = annotationsRef.current.some((a) => a.id === targetId && a.type === 'redact');
        if (tool !== 'redact' || isMark) return;
      }

      // For text tool: if an IText is currently in editing mode, exit editing
      // first and skip placing a new text object (user just wants to deselect).
      // Edit goes straight on to the next text.
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

        case 'edit_text': {
          const layer = textLayerRef.current;
          const pg = pageNumberRef.current;

          // Already replaced here (the words under it are erased, so there's
          // no run to find): reopen that text rather than stack another --
          // or, for a picked-up image, select it
          const reopen = (cover: Annotation): boolean => {
            const partnerId = cover.id.slice(0, -TEXT_COVER_SUFFIX.length);
            const existing = fc.getObjects().find((o) => getAnnotationId(o) === partnerId);
            if (existing instanceof FabricImage) {
              fc.setActiveObject(existing);
              fc.renderAll();
              callbacksRef.current.onTextReplace?.([]);
              return true;
            }
            if (!(existing instanceof IText)) return false;
            fc.setActiveObject(existing);
            existing.enterEditing();
            existing.selectAll();
            fc.renderAll();
            callbacksRef.current.onTextReplace?.([]);
            return true;
          };
          const replaced = replacementAt(cx, cy);
          if (replaced && reopen(replaced)) break;
          const replacedImage = !!replaced && isImageCover(replaced, annotationsRef.current);

          const run = layer ? findRunAt(layer.runs, cx, cy) : null;
          if (!run && !replaced) {
            const image = findImageAt(cx, cy);
            if (image) {
              callbacksRef.current.onImagePick?.(image);
              break;
            }
          }
          if (!layer || !run) {
            // A cover whose text is gone (saved before replacements were
            // kept): start a new one where its words were
            if (replaced && !replacedImage) {
              const size = Math.max(4, Math.round((replaced.height / 1.16) * 10) / 10);
              const corner = annotationCorner(replaced);
              const a = ((replaced.rotation || 0) * Math.PI) / 180;
              const u = size * 0.08;
              const v = size * 0.88;
              const textAnn: Annotation = {
                id: replaced.id.slice(0, -TEXT_COVER_SUFFIX.length),
                type: 'text',
                page: pg,
                x: 0,
                y: 0,
                width: 0,
                height: 0,
                rotation: replaced.rotation || 0,
                content: '',
                style: { fontSize: size, fontFamily: DEFAULT_FONT_FAMILY, color: DEFAULT_TEXT_COLOR },
              };
              const textObj = buildTextObject(textAnn, { replacement: true });
              const baseline = { x: corner.x + u * Math.cos(a) - v * Math.sin(a), y: corner.y + u * Math.sin(a) + v * Math.cos(a) };
              const th = textObj.height ?? 0;
              const off = th / 2 - th * FABRIC_BASELINE_RATIO;
              textObj.set({ left: baseline.x - off * Math.sin(a), top: baseline.y + off * Math.cos(a) });
              textObj.setCoords();
              Object.assign(textAnn, { x: textObj.left, y: textObj.top, width: textObj.width ?? 0, height: th });
              fc.add(textObj);
              fc.setActiveObject(textObj);
              textObj.enterEditing();
              fc.renderAll();
              callbacksRef.current.onTextReplace?.([textAnn]);
            }
            break;
          }
          const runCenter = runPoint(run, run.width / 2, (run.descent - run.ascent) / 2);

          // The run is still on screen but already covered (its erased page
          // isn't back yet)
          const cover = annotationsRef.current.find(
            (a) => isTextCoverId(a.id) && !isImageCover(a, annotationsRef.current)
              && annotationContains(a, runCenter.x, runCenter.y),
          );
          if (cover && (movedAway(cover) || reopen(cover))) break;
          const textId = cover ? cover.id.slice(0, -TEXT_COVER_SUFFIX.length) : generateId();

          const sampled = layer.sampleColors(run);
          const rotation = ((run.angle % 360) + 360) % 360;
          const added: Annotation[] = [];

          if (!cover) {
            const pad = Math.max(1, run.fontSize * 0.08);
            const fill = sampled?.background ?? '#ffffff';
            const coverAnn: Annotation = {
              id: textId + TEXT_COVER_SUFFIX,
              type: 'shape',
              page: pg,
              x: runCenter.x,
              y: runCenter.y,
              width: run.width + pad * 2,
              height: run.ascent + run.descent + pad * 2,
              rotation,
              content: 'rect',
              style: { backgroundColor: fill, color: fill, borderWidth: 0 },
            };
            const coverObj = buildShapeRectObject(coverAnn);
            coverObj.set({ selectable: false, evented: false });
            fc.add(coverObj);
            added.push(coverAnn);
          }

          // Same PDF font as the words it replaces, if pdf.js can draw it
          const pdfFont = run.pdfFont && layer.fonts.has(run.pdfFont) ? run.pdfFont : undefined;
          const textAnn: Annotation = {
            id: textId,
            type: 'text',
            page: pg,
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            rotation,
            content: run.text,
            style: {
              fontSize: Math.round(run.fontSize * 10) / 10,
              fontFamily: run.fontFamily,
              fontWeight: run.bold ? 'bold' : 'normal',
              fontStyle: run.italic ? 'italic' : 'normal',
              color: sampled?.text ?? DEFAULT_TEXT_COLOR,
              ...(pdfFont ? { pdfFont } : {}),
            },
          };
          const textObj = buildTextObject(textAnn, { fonts: layer.fonts, replacement: true });
          // Put the new text's baseline-left where the original's was
          const tw = textObj.width ?? 0;
          const th = textObj.height ?? 0;
          const center = runPoint(run, tw / 2, th / 2 - th * FABRIC_BASELINE_RATIO);
          textObj.set({ left: center.x, top: center.y });
          textObj.setCoords();
          Object.assign(textAnn, { x: center.x, y: center.y, width: tw, height: th });

          fc.add(textObj);
          fc.setActiveObject(textObj);
          fc.renderAll();
          added.push(textAnn);
          callbacksRef.current.onTextReplace?.(added);
          // Typing starts on release, unless the press drags it away first
          editPressRef.current = {
            obj: textObj, ann: textAnn, x: cx, y: cy, left: center.x, top: center.y, moved: false,
          };
          break;
        }

        case 'image': {
          pendingClickRef.current = { x: cx, y: cy };
          fileInputRef.current?.click();
          break;
        }

        case 'redact': {
          // A drag marks an area; a click (see handleMouseUp) the text under it
          const rect = buildRedactObject({
            id: '', type: 'redact', page: pageNumberRef.current,
            x: cx, y: cy, width: 1, height: 1, rotation: 0, content: '', style: {},
          });
          rect.set({ selectable: false, evented: false });
          fc.add(rect);
          redactDragRef.current = { x: cx, y: cy, rect };
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
            strokeUniform: true,
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
            strokeUniform: true,
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
            strokeUniform: true,
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

        case 'shape_check': {
          const size = checkSizeRef.current;
          const ann: Annotation = {
            id: generateId(),
            type: 'shape',
            page: pageNumberRef.current,
            x: cx,
            y: cy,
            width: size,
            height: size,
            rotation: 0,
            content: 'check',
            style: { color: drawColorRef.current, borderWidth: drawWidthRef.current },
          };
          const checkObj = buildShapeCheckObject(ann);
          fc.add(checkObj);
          fc.setActiveObject(checkObj);
          fc.renderAll();

          callbacksRef.current.onAnnotationAdd(ann);
          break;
        }
      }
    };

    // Edit: highlight the PDF text or image that a click would make
    // editable, the replacement it would reopen, or the element a press
    // would grab; and drag the page's text a press just picked up. Redact:
    // the text a click would mark (and the box being dragged).
    const handleMouseMove = (opt: { scenePoint?: { x: number; y: number }; target?: FabricObject }) => {
      const tool = activeToolRef.current;
      const sp = opt.scenePoint;
      const press = editPressRef.current;
      if (press && sp) {
        const dx = sp.x - press.x;
        const dy = sp.y - press.y;
        if (!press.moved && Math.hypot(dx, dy) < EDIT_DRAG_SLOP) return;
        press.moved = true;
        press.obj.set({ left: press.left + dx, top: press.top + dy });
        press.obj.setCoords();
        fc.requestRenderAll();
        setHoverBox(null);
        return;
      }
      const drag = redactDragRef.current;
      if (drag && sp) {
        drag.rect.set({
          left: (drag.x + sp.x) / 2,
          top: (drag.y + sp.y) / 2,
          width: Math.max(1, Math.abs(sp.x - drag.x)),
          height: Math.max(1, Math.abs(sp.y - drag.y)),
        });
        drag.rect.setCoords();
        fc.requestRenderAll();
        return;
      }
      if (tool !== 'edit_text' && tool !== 'redact') return;
      const layer = textLayerRef.current;
      let box: typeof hoverBox = null;
      let cursor = tool === 'redact' ? 'crosshair' : 'default';
      const target = tool === 'edit_text' ? opt.target : undefined;
      if (target) {
        // Over an element, which a press grabs (fabric sets the cursor):
        // outlined like the page's text, unless it's selected already
        const ann = annotationsRef.current.find((a) => a.id === getAnnotationId(target));
        if (ann && target !== fc.getActiveObject()) {
          const corner = annotationCorner(ann);
          box = { key: ann.id, ...corner, width: ann.width, height: ann.height, angle: ann.rotation || 0 };
        }
      } else if (sp) {
        const replaced = tool === 'edit_text' ? findReplacement(sp.x, sp.y) : null;
        const run = replaced || !layer ? null : findRunAt(layer.runs, sp.x, sp.y);
        const image = tool === 'edit_text' && !replaced && !run ? findImageAt(sp.x, sp.y) : null;
        if (replaced) {
          const { hit } = replaced;
          const corner = annotationCorner(hit);
          box = { key: hit.id, ...corner, width: hit.width, height: hit.height, angle: hit.rotation || 0 };
          cursor = hit.type === 'image' ? 'pointer' : 'text';
        } else if (layer && run) {
          const corner = runPoint(run, 0, -run.ascent);
          box = {
            key: `run:${layer.runs.indexOf(run)}`,
            ...corner,
            width: run.width,
            height: run.ascent + run.descent,
            angle: run.angle,
          };
          cursor = tool === 'redact' ? 'pointer' : 'text';
        } else if (image) {
          const corner = annotationCorner(image);
          box = { key: `img:${image.index}`, ...corner, width: image.width, height: image.height, angle: image.rotation };
          cursor = 'pointer';
        }
      }
      fc.defaultCursor = cursor;
      setHoverBox((prev) => (prev?.key === box?.key ? prev : box));
    };

    // Edit: the page's text a press picked up types on a click and lands
    // where a drag left it; and a click on any text types into it right
    // away (a drag moved it, a corner resized it). Redact: finish the mark
    // being dragged -- or, for a click, mark the text under it.
    const handleMouseUp = (opt: {
      e?: TPointerEvent;
      target?: FabricObject;
      isClick?: boolean;
      transform?: { corner?: string } | null;
      scenePoint?: { x: number; y: number };
    }) => {
      const press = editPressRef.current;
      if (press) {
        editPressRef.current = null;
        if (press.moved) {
          const existing = annotationsRef.current.find((a) => a.id === press.ann.id) ?? press.ann;
          queueUpdatesRef.current([fabricToAnnotation(press.obj, existing)]);
        } else {
          press.obj.enterEditing();
          press.obj.selectAll();
        }
        fc.requestRenderAll();
        return;
      }

      const t = opt.target;
      if (
        activeToolRef.current === 'edit_text' && t instanceof IText && t.editable && !t.isEditing
        && opt.isClick && !opt.transform?.corner && opt.e && fc.getActiveObject() === t
      ) {
        t.setCursorByClick(opt.e);
        t.enterEditing(opt.e);
        fc.requestRenderAll();
        return;
      }

      const drag = redactDragRef.current;
      if (!drag) return;
      redactDragRef.current = null;
      const end = opt.scenePoint ?? { x: drag.x, y: drag.y };
      const width = Math.abs(end.x - drag.x);
      const height = Math.abs(end.y - drag.y);
      fc.remove(drag.rect);
      let mark: Annotation | null;
      if (width < REDACT_CLICK_SLOP && height < REDACT_CLICK_SLOP) {
        const layer = textLayerRef.current;
        mark = layer ? runMark(layer, drag.x, drag.y) : null;
      } else {
        mark = {
          id: generateId(),
          type: 'redact',
          page: pageNumberRef.current,
          x: (drag.x + end.x) / 2,
          y: (drag.y + end.y) / 2,
          width,
          height,
          rotation: 0,
          content: '',
          style: {},
        };
      }
      if (mark) {
        const obj = buildRedactObject(mark);
        fc.add(obj);
        callbacksRef.current.onAnnotationAdd(mark);
      }
      fc.requestRenderAll();
    };

    fc.on('mouse:down' as never, handleMouseDown as never);
    fc.on('mouse:move' as never, handleMouseMove as never);
    fc.on('mouse:up' as never, handleMouseUp as never);
    return () => {
      fc.off('mouse:down' as never, handleMouseDown as never);
      fc.off('mouse:move' as never, handleMouseMove as never);
      fc.off('mouse:up' as never, handleMouseUp as never);
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
        style: { color: stamp.color, fontSize: STAMP_FONT_SIZE },
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

    // An image annotation without a picture is a picked-up image the user
    // deleted (its cover keeps the original off the page): nothing to show
    const shown = annotations.filter((a) => !(a.type === 'image' && !a.content));
    const annMap = new Map<string, Annotation>(shown.map((a) => [a.id, a]));

    // Remove fabric objects whose annotation no longer exists -- or whose
    // picture was replaced, so it's built again from the new one
    const toRemove: FabricObject[] = [];
    fc.forEachObject((obj) => {
      const id = getAnnotationId(obj);
      if (!id) return;
      const ann = annMap.get(id);
      if (!ann) {
        toRemove.push(obj);
      } else if (obj instanceof FabricImage && ann.type === 'image' && obj.getSrc() !== ann.content) {
        // Selected again once rebuilt, so the property panel stays on it
        if (fc.getActiveObject() === obj) reselectRef.current.add(id);
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

    // Children of a multi-selection have selection-relative left/top; never
    // overwrite their geometry with page coordinates while selected
    const activeObj = fc.getActiveObject();
    const inSelection = new Set<FabricObject>(
      activeObj instanceof ActiveSelection ? activeObj.getObjects() : [],
    );

    // Add new annotations OR update existing ones
    let needsRender = toRemove.length > 0;
    const addPromises: Promise<void>[] = [];

    for (const ann of shown) {
      const existingObj = fabricMap.get(ann.id);

      if (!existingObj) {
        if (pendingAddsRef.current.has(ann.id)) continue;
        pendingAddsRef.current.add(ann.id);
        // New annotation — create fabric object
        const p = annotationToFabricObject(ann, {
          fonts: fontsRef.current,
          replacement: annMap.has(ann.id + TEXT_COVER_SUFFIX),
        }).then((obj) => {
          pendingAddsRef.current.delete(ann.id);
          if (!obj) return;
          // The page may have changed (or the annotation been deleted)
          // while an image was loading
          if (!annotationsRef.current.some((a) => a.id === ann.id)) return;
          if (isTextCoverId(ann.id)) {
            obj.set({ selectable: false, evented: false, visible: !erasedCoversRef.current.has(ann.id) });
          } else {
            const tool = activeToolRef.current;
            obj.selectable = tool === 'select' || tool === 'edit_text' || (tool === 'redact' && ann.type === 'redact');
            obj.evented = true;
          }
          fc.add(obj);
          // Selected before it existed (a picked-up image), or rebuilt while
          // selected (a replaced picture)
          if (reselectRef.current.delete(ann.id) || selectedIdRef.current === ann.id) {
            fc.setActiveObject(obj);
          }
        });
        addPromises.push(p);
      } else {
        // Existing annotation — update fabric object properties from annotation
        // Skip if this object is currently being edited (e.g. IText in edit mode)
        if (existingObj instanceof IText && existingObj.isEditing) continue;

        // Update position/size
        if (!inSelection.has(existingObj)) {
          existingObj.set({
            left: ann.x,
            top: ann.y,
            angle: ann.rotation || 0,
          });

          // Size comes from the annotation (property panel W/H, undo, ...).
          // Text/stamps are sized by their font instead.
          if (!(existingObj instanceof IText)) {
            if (existingObj.width && ann.width) {
              existingObj.set({ scaleX: ann.width / existingObj.width });
            }
            if (existingObj.height && ann.height) {
              existingObj.set({ scaleY: ann.height / existingObj.height });
            }
          }
        }

        // Update text content
        if (existingObj instanceof IText && existingObj.text !== ann.content) {
          existingObj.set({ text: ann.content });
        }

        // Update style properties
        const s = ann.style || {};
        if (existingObj instanceof IText) {
          existingObj.set({
            fontSize: s.fontSize ?? existingObj.fontSize,
            ...(ann.type === 'text'
              ? textFontProps(s, fontsRef.current)
              : {
                fontFamily: s.fontFamily ?? existingObj.fontFamily,
                fontWeight: (s.fontWeight as string) ?? existingObj.fontWeight,
                fontStyle: (s.fontStyle as string) ?? existingObj.fontStyle,
              }),
            underline: s.textDecoration === 'underline',
            fill: s.color ?? existingObj.fill,
            backgroundColor: s.backgroundColor ?? '',
          });
        }

        if (ann.type === 'image') {
          existingObj.set(imageBorderProps(s));
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
          // Fill for rect/circle (not line/check)
          if (ann.content !== 'line' && ann.content !== 'check') {
            shapeProps.fill = s.backgroundColor ?? DEFAULT_SHAPE_FILL;
          }
          existingObj.set(shapeProps);
        }

        // Update opacity (all types). A saved style can carry opacity: null,
        // and fabric multiplies globalAlpha by it, so null would hide the object
        existingObj.set({ opacity: s.opacity ?? 1 });
        if (isTextCoverId(ann.id)) existingObj.set({ visible: !erasedCoversRef.current.has(ann.id) });

        existingObj.setCoords();
        needsRender = true;
      }
    }

    // Stack objects in annotation order -- the order the PDF export draws
    // them in, and what "Bring to front" / "Send to back" change
    const applyZOrder = () => {
      const byId = new Map<string, FabricObject>();
      fc.forEachObject((obj) => {
        const id = getAnnotationId(obj);
        if (id) byId.set(id, obj);
      });
      annotationsRef.current.forEach((ann, index) => {
        const obj = byId.get(ann.id);
        if (obj && fc.getObjects().indexOf(obj) !== index) fc.moveObjectTo(obj, index);
      });
    };

    if (addPromises.length > 0) {
      Promise.all(addPromises).then(() => {
        applyZOrder();
        fc.renderAll();
      });
    } else {
      applyZOrder();
      if (needsRender) fc.renderAll();
    }
    // `activeTool` intentionally omitted – tool mode is handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations]);

  // ── Edit Text covers: painted only while their words are still on screen ──
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;
    const erased = erasedCoverIds ?? new Set<string>();
    let changed = false;
    fc.forEachObject((obj) => {
      const id = getAnnotationId(obj);
      if (!isTextCoverId(id)) return;
      const visible = !erased.has(id!);
      if (obj.visible !== visible) {
        obj.set({ visible });
        changed = true;
      }
    });
    if (changed) fc.requestRenderAll();
  }, [erasedCoverIds]);

  // ── Replacements follow the PDF fonts of the page on screen ──────────────
  // Each pdf.js document registers its fonts under its own names, and the
  // page may now come from a different one (an erased preview)
  useEffect(() => {
    if (!textLayer) return;
    fontsRef.current = textLayer.fonts;
    const fc = fabricRef.current;
    if (!fc) return;
    let changed = false;
    fc.forEachObject((obj) => {
      if (!(obj instanceof IText)) return;
      const ann = annotationsRef.current.find((a) => a.id === getAnnotationId(obj));
      if (ann?.type !== 'text' || !ann.style?.pdfFont) return;
      const props = textFontProps(ann.style, textLayer.fonts);
      if (
        props.fontFamily !== obj.fontFamily ||
        props.fontWeight !== String(obj.fontWeight) ||
        props.fontStyle !== obj.fontStyle
      ) {
        obj.set(props);
        obj.setCoords();
        changed = true;
      }
    });
    if (changed) fc.requestRenderAll();
  }, [textLayer]);

  // ── Sync selectedAnnotationId → fabric active object ─────────────────────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    if (selectedAnnotationId === null) {
      fc.discardActiveObject();
      fc.renderAll();
      return;
    }

    // Already selected (alone or as part of a multi-selection): leave it,
    // or a Ctrl+click multi-select would collapse to its first object
    const active = fc.getActiveObject();
    if (
      active &&
      (getAnnotationId(active) === selectedAnnotationId ||
        (active instanceof ActiveSelection &&
          active.getObjects().some((o) => getAnnotationId(o) === selectedAnnotationId)))
    ) {
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

      {hoverBox && (activeTool === 'edit_text' || activeTool === 'redact') && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: hoverBox.x * zoom,
            top: hoverBox.y * zoom,
            width: hoverBox.width * zoom,
            height: hoverBox.height * zoom,
            transform: `rotate(${hoverBox.angle}deg)`,
            transformOrigin: '0 0',
            outline: `1.5px solid ${activeTool === 'redact' ? REDACT_STROKE : '#3b82f6'}`,
            outlineOffset: 2,
            background: activeTool === 'redact' ? REDACT_FILL : 'rgba(59, 130, 246, 0.08)',
            borderRadius: 2,
            pointerEvents: 'none',
          }}
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
  // a.x/a.y are the field's center (fabric center origin)
  const x = a.x * zoom - w / 2;
  const y = a.y * zoom - h / 2;

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
        transformOrigin: 'center',
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

export default AnnotationLayer;
