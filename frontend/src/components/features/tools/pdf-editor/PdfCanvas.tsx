/**
 * Scopit - PDF Canvas
 *
 * Renders the current PDF page to a <canvas> using pdfjs-dist.
 * Handles: loading, zoom, page navigation, click events for annotation placement.
 *
 * A page with Edit Text covers is rendered from the backend's preview of it
 * instead (the same erasing the export does), so the original words are
 * gone while rules, shading and images under them stay.
 *
 * Usage:
 *   <PdfCanvas
 *     documentId={editorState.documentId}
 *     currentPage={editorState.currentPage}
 *     zoom={editorState.zoom}
 *     pageCount={doc.pageCount}
 *     activeTool={editorState.tool}
 *     onPageChange={setPage}
 *   />
 */
import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
} from 'react';
// antd not needed – bare canvas only
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { useAuthStore } from '@/stores/authStore';
import './pdfWorker';
import { extractTextRuns, loadedFonts, sampleRunColors, type PdfTextLayer } from './pdfTextRuns';
import { pdfEditorApi, type PreviewCover } from './pdfEditorApi';
// Theme not needed – bare canvas only

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PdfCanvasProps {
  documentId: string;
  currentPage: number;
  zoom: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  activeTool: string;
  /** Increment to force PDF reload (e.g. after page rotate/reorder/delete) */
  refreshKey?: number;
  /** Called when page renders with the CSS display size of the canvas */
  onCanvasResize?: (width: number, height: number) => void;
  /** Called when the page render completes (true) or starts (false) */
  onPageReady?: (ready: boolean) => void;
  /** The page's existing text, for the Edit Text tool (null while rendering) */
  onTextLayer?: (layer: PdfTextLayer | null) => void;
  /** Edit covers on the current page: their text (or picked-up image) is shown erased */
  textCovers?: PreviewCover[];
  /** The covers whose text the page on screen has erased */
  onCoversErased?: (ids: ReadonlySet<string>) => void;
}

interface PagePreview {
  pdf: PDFDocumentProxy;
  erased: ReadonlySet<string>;
}

// Cursor styles mapped to tool names
const TOOL_CURSOR: Record<string, string> = {
  select: 'default',
  edit_text: 'text',
  text: 'text',
  image: 'crosshair',
  draw: 'crosshair',
  stamp: 'copy',
  sign: 'crosshair',
  crop: 'crosshair',
  redact: 'crosshair',
};

const NONE_ERASED: ReadonlySet<string> = new Set();
// Recent previews kept for undo/redo and paging back and forth
const MAX_PREVIEWS = 6;

function coverKey(covers: PreviewCover[]): string {
  const r = (v: number) => Math.round((v || 0) * 100) / 100;
  return JSON.stringify(covers.map((c) => [c.id, c.kind, r(c.x), r(c.y), r(c.width), r(c.height), r(c.rotation)]));
}

// ── PdfCanvas Component ───────────────────────────────────────────────────────

const PdfCanvas: React.FC<PdfCanvasProps> = ({
  documentId,
  currentPage,
  zoom,
  pageCount,
  onPageChange,
  activeTool,
  refreshKey = 0,
  onCanvasResize,
  onPageReady,
  onTextLayer,
  textCovers,
  onCoversErased,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  // Bumped per render so a slow text extraction can't report a stale page
  const renderGenRef = useRef(0);
  const onTextLayerRef = useRef(onTextLayer);
  onTextLayerRef.current = onTextLayer;
  const onCoversErasedRef = useRef(onCoversErased);
  onCoversErasedRef.current = onCoversErased;
  // Page + zoom on screen; re-rendering the same view isn't a page change
  const shownViewRef = useRef<string | null>(null);

  const covers = textCovers ?? [];
  const coversKey = coverKey(covers);
  const coversRef = useRef(covers);
  coversRef.current = covers;
  // Erased versions of pages, by page + covers, most recently used last
  const previewsRef = useRef(new Map<string, Promise<PagePreview>>());

  const [isLoading, setIsLoading] = useState(true);
  const [isPageRendering, setIsPageRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const clearPreviews = useCallback(() => {
    for (const preview of previewsRef.current.values()) {
      preview.then((p) => p.pdf.destroy(), () => undefined);
    }
    previewsRef.current.clear();
  }, []);

  // ── Load PDF Document ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!documentId) return;

    let cancelled = false;

    const loadPdf = async () => {
      setIsLoading(true);
      setError(null);

      // Keep the old doc alive so the canvas retains its last frame
      const prevDoc = pdfDocRef.current;

      try {
        const token = useAuthStore.getState().accessToken;
        const apiBase = import.meta.env.VITE_API_URL || '/api';
        const url = `${apiBase}/tools/pdf-editor/documents/${documentId}/download`;

        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
        }

        const data = await response.arrayBuffer();
        if (cancelled) return;

        const pdf = await pdfjsLib.getDocument({ data }).promise;
        if (cancelled) {
          pdf.destroy();
          return;
        }

        // Swap: set new doc, then destroy old (previews were of the old file)
        pdfDocRef.current = pdf;
        if (prevDoc) prevDoc.destroy();
        clearPreviews();
        shownViewRef.current = null;
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          console.error('[PdfCanvas] Load error:', err);
          setError(err instanceof Error ? err.message : 'Failed to load PDF');
          setIsLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
    };
  }, [documentId, refreshKey, clearPreviews]);

  // ── Erased page previews ───────────────────────────────────────────────────

  const previewFor = useCallback((pageNum: number, pageCovers: PreviewCover[], key: string) => {
    const cacheKey = `${pageNum}|${key}`;
    const cache = previewsRef.current;
    let preview = cache.get(cacheKey);
    if (preview) {
      cache.delete(cacheKey);
    } else {
      preview = pdfEditorApi
        .previewTextEdits(
          documentId,
          pageNum,
          pageCovers.map(({ id, x, y, width, height, rotation, kind }) => ({ id, x, y, width, height, rotation, kind })),
        )
        .then(async ({ pdf, erased }) => ({
          pdf: await pdfjsLib.getDocument({ data: pdf }).promise,
          erased: new Set(erased),
        }));
      // A failed preview isn't kept, so the next render asks again
      preview.catch(() => cache.delete(cacheKey));
    }
    cache.set(cacheKey, preview);
    while (cache.size > MAX_PREVIEWS) {
      const [oldest, evicted] = cache.entries().next().value as [string, Promise<PagePreview>];
      cache.delete(oldest);
      evicted.then((p) => p.pdf.destroy(), () => undefined);
    }
    return preview;
  }, [documentId]);

  // ── Render Current Page ────────────────────────────────────────────────────

  const renderPage = useCallback(
    async (
      pdf: PDFDocumentProxy,
      pageNum: number,
      scale: number,
      view: string,
      erased: ReadonlySet<string>,
    ) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Cancel any in-progress render
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
        renderTaskRef.current = null;
      }

      // Swapping in an edited version of the page on screen is no page
      // change: the annotations stay visible throughout
      const sameView = view === shownViewRef.current;
      setIsPageRendering(true);
      if (!sameView) onPageReady?.(false);
      const gen = ++renderGenRef.current;
      if (!sameView) onTextLayerRef.current?.(null);

      let page: PDFPageProxy | null = null;
      try {
        page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        // Render off screen, then swap, so the last frame stays up meanwhile
        const dpr = window.devicePixelRatio || 1;
        const offscreen = document.createElement('canvas');
        offscreen.width = Math.floor(viewport.width * dpr);
        offscreen.height = Math.floor(viewport.height * dpr);
        const offCtx = offscreen.getContext('2d');
        if (!offCtx) throw new Error('Could not get 2d context');
        offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const task = page.render({ canvas: offscreen, canvasContext: offCtx, viewport });
        renderTaskRef.current = task;

        await task.promise;
        renderTaskRef.current = null;
        if (gen !== renderGenRef.current) return;

        // Set both canvas resolution and CSS display size
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context');
        ctx.drawImage(offscreen, 0, 0);

        const cssW = Math.floor(viewport.width);
        const cssH = Math.floor(viewport.height);
        setCanvasSize({ width: cssW, height: cssH });
        onCanvasResize?.(cssW, cssH);

        shownViewRef.current = view;
        setIsPageRendering(false);
        onCoversErasedRef.current?.(erased);
        onPageReady?.(true);

        if (onTextLayerRef.current) {
          try {
            const runs = await extractTextRuns(page, page.getViewport({ scale: 1 }));
            if (gen === renderGenRef.current) {
              const pixelScale = scale * dpr;
              onTextLayerRef.current?.({
                runs,
                fonts: loadedFonts(page),
                sampleColors: (run) => sampleRunColors(canvas, run, pixelScale),
              });
            }
          } catch (err) {
            console.warn('[PdfCanvas] Text extraction failed:', err);
          }
        }
      } catch (err: unknown) {
        // RenderingCancelledException is expected when we cancel; ignore it
        if (
          err instanceof Error &&
          err.name !== 'RenderingCancelledException'
        ) {
          console.error('[PdfCanvas] Render error:', err);
          setError('Failed to render page');
        }
        setIsPageRendering(false);
      } finally {
        page?.cleanup();
      }
    },
    [],
  );

  // Render page whenever currentPage, zoom, the loaded PDF or the page's
  // covers change
  useEffect(() => {
    const pdf = pdfDocRef.current;
    if (!pdf || isLoading) return;
    const view = `${currentPage}@${zoom}`;
    const pageCovers = coversRef.current;
    if (!pageCovers.length) {
      renderPage(pdf, currentPage, zoom, view, NONE_ERASED);
      return;
    }
    let stale = false;
    previewFor(currentPage, pageCovers, coversKey).then(
      (preview) => {
        if (!stale) renderPage(preview.pdf, 1, zoom, view, preview.erased);
      },
      (err) => {
        // Show the original; the covers are painted over its text meanwhile
        console.warn('[PdfCanvas] Text edit preview failed:', err);
        if (!stale) renderPage(pdf, currentPage, zoom, view, NONE_ERASED);
      },
    );
    return () => { stale = true; };
  }, [currentPage, zoom, isLoading, coversKey, renderPage, previewFor]);

  // ── Cleanup on Unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
      pdfDocRef.current?.destroy();
      clearPreviews();
    };
  }, [clearPreviews]);

  // ── Page Navigation via Scroll ─────────────────────────────────────────────

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Only intercept plain vertical scroll (no modifier keys) for page nav
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;

      const delta = e.deltaY;
      if (delta > 0 && currentPage < pageCount) {
        onPageChange(currentPage + 1);
      } else if (delta < 0 && currentPage > 1) {
        onPageChange(currentPage - 1);
      }
    },
    [currentPage, pageCount, onPageChange],
  );

  // Click handling is delegated to the AnnotationLayer (fabric.js) which
  // sits on top of this canvas. PdfCanvas only renders the PDF pages.

  // ── Render ─────────────────────────────────────────────────────────────────

  const cursor = TOOL_CURSOR[activeTool] ?? 'default';

  // Canvas is always visible — keeps previous frame during reload so PDF
  // content doesn't flash blank while the annotation layer stays visible.
  return (
    <canvas
      ref={canvasRef}
      onWheel={handleWheel}
      style={{
        display: 'block',
        cursor,
        // slight fade while reloading so user knows something is happening
        opacity: isLoading ? 0.5 : 1,
        transition: 'opacity 0.15s ease',
      }}
      aria-label={`PDF page ${currentPage} of ${pageCount}`}
    />
  );
};

export default PdfCanvas;
