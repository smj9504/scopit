/**
 * Scopit - PDF Canvas
 *
 * Renders the current PDF page to a <canvas> using pdfjs-dist.
 * Handles: loading, zoom, page navigation, click events for annotation placement.
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
}

// Cursor styles mapped to tool names
const TOOL_CURSOR: Record<string, string> = {
  select: 'default',
  text: 'text',
  image: 'crosshair',
  draw: 'crosshair',
  stamp: 'copy',
  sign: 'crosshair',
};

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
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isPageRendering, setIsPageRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

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

        // Swap: set new doc, then destroy old
        pdfDocRef.current = pdf;
        if (prevDoc) prevDoc.destroy();
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
  }, [documentId, refreshKey]);

  // ── Render Current Page ────────────────────────────────────────────────────

  const renderPage = useCallback(
    async (pdf: PDFDocumentProxy, pageNum: number, scale: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Cancel any in-progress render
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch { /* ignore */ }
        renderTaskRef.current = null;
      }

      setIsPageRendering(true);
      onPageReady?.(false);

      let page: PDFPageProxy | null = null;
      try {
        page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        // Set both canvas resolution and CSS display size
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const cssW = Math.floor(viewport.width);
        const cssH = Math.floor(viewport.height);
        setCanvasSize({ width: cssW, height: cssH });
        onCanvasResize?.(cssW, cssH);

        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const task = page.render({ canvas: canvasRef.current!, canvasContext: ctx, viewport });
        renderTaskRef.current = task;

        await task.promise;
        renderTaskRef.current = null;
        setIsPageRendering(false);
        onPageReady?.(true);
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

  // Render page whenever currentPage, zoom, or the loaded PDF changes
  useEffect(() => {
    const pdf = pdfDocRef.current;
    if (!pdf || isLoading) return;
    renderPage(pdf, currentPage, zoom);
  }, [currentPage, zoom, isLoading, renderPage]);

  // ── Cleanup on Unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel();
      pdfDocRef.current?.destroy();
    };
  }, []);

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
