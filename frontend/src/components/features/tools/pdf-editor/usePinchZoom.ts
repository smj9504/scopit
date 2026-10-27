/**
 * Scopit - PDF Editor: pinch to zoom
 *
 * Two fingers on the page viewer zoom it, and pan it as they move together.
 * While they're down the page is only scaled on screen; when they lift the
 * editor zooms, and once the page is drawn at that zoom the spot that was
 * under the fingers is scrolled back under them.
 *
 * The page under the fingers never sees them: the tool there gets nothing
 * from a pinch (AnnotationLayer drops what the first finger started).
 *
 * Usage:
 *   const pinch = usePinchZoom({ viewerRef, pageRef, zoom, clamp, onZoom });
 *   <PdfCanvas onCanvasResize={(w, h, drawnAt) => pinch.pageDrawn(drawnAt)} />
 */
import React, { useCallback, useEffect, useRef } from 'react';

interface Point {
  x: number;
  y: number;
}

export interface PinchZoomOptions {
  /** The scrolling viewer the page sits in (its offset parent) */
  viewerRef: React.RefObject<HTMLElement>;
  /** The page itself, scaled on screen while the fingers are down */
  pageRef: React.RefObject<HTMLElement>;
  zoom: number;
  /** The nearest zoom the editor allows */
  clamp: (zoom: number) => number;
  /** Zoom the editor to about this; returns the zoom it went to */
  onZoom: (zoom: number) => number;
}

const midpoint = (t: TouchList): Point => ({
  x: (t[0].clientX + t[1].clientX) / 2,
  y: (t[0].clientY + t[1].clientY) / 2,
});
const spread = (t: TouchList): number => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

export function usePinchZoom({ viewerRef, pageRef, zoom, clamp, onZoom }: PinchZoomOptions) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const clampRef = useRef(clamp);
  clampRef.current = clamp;
  const onZoomRef = useRef(onZoom);
  onZoomRef.current = onZoom;

  // The pinch under way: where the fingers started (screen), how far apart,
  // the page's corner and zoom then, and the scale and midpoint since
  const gestureRef = useRef<{
    start: Point;
    distance: number;
    corner: Point;
    zoom: number;
    scale: number;
    mid: Point;
  } | null>(null);
  // A pinch that zoomed, until the page is drawn at that zoom: the page
  // point (page units) to scroll back under the fingers' last midpoint
  const settleRef = useRef<{ zoom: number; at: Point; mid: Point } | null>(null);

  // The page as the editor has it now, in place of its scaled picture
  const settle = useCallback(() => {
    const viewer = viewerRef.current;
    const page = pageRef.current;
    const s = settleRef.current;
    settleRef.current = null;
    if (!page) return;
    page.style.transform = '';
    page.style.transformOrigin = '';
    if (!s || !viewer) return;
    const box = viewer.getBoundingClientRect();
    viewer.scrollLeft = page.offsetLeft + s.at.x * s.zoom - (s.mid.x - box.left);
    viewer.scrollTop = page.offsetTop + s.at.y * s.zoom - (s.mid.y - box.top);
  }, [viewerRef, pageRef]);

  // Bound after every render: the viewer is a new element after the page
  // organizer, which takes its place
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const onStart = (e: TouchEvent) => {
      // Not cancelable: the browser is scrolling with the first finger already
      if (e.touches.length !== 2 || !e.cancelable || !pageRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (gestureRef.current) return;
      settle();
      const page = pageRef.current;
      const box = page.getBoundingClientRect();
      const mid = midpoint(e.touches);
      gestureRef.current = {
        start: mid,
        distance: Math.max(1, spread(e.touches)),
        corner: { x: box.left, y: box.top },
        zoom: zoomRef.current,
        scale: 1,
        mid,
      };
      page.style.transformOrigin = `${mid.x - box.left}px ${mid.y - box.top}px`;
    };

    const onMove = (e: TouchEvent) => {
      const g = gestureRef.current;
      const page = pageRef.current;
      if (!g || !page) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length < 2) return;
      g.mid = midpoint(e.touches);
      g.scale = clampRef.current((g.zoom * spread(e.touches)) / g.distance) / g.zoom;
      page.style.transform = `translate(${g.mid.x - g.start.x}px, ${g.mid.y - g.start.y}px) scale(${g.scale})`;
    };

    const onEnd = (e: TouchEvent) => {
      const g = gestureRef.current;
      if (!g || e.touches.length >= 2) return;
      gestureRef.current = null;
      const at = { x: (g.start.x - g.corner.x) / g.zoom, y: (g.start.y - g.corner.y) / g.zoom };
      const next = onZoomRef.current(g.zoom * g.scale);
      settleRef.current = { zoom: next, at, mid: g.mid };
      // Only moved, or held at a limit: the page as drawn already fits
      if (Math.abs(next - g.zoom) < 1e-6) settle();
    };

    const capture = { capture: true, passive: false };
    viewer.addEventListener('touchstart', onStart, capture);
    viewer.addEventListener('touchmove', onMove, capture);
    viewer.addEventListener('touchend', onEnd, true);
    viewer.addEventListener('touchcancel', onEnd, true);
    return () => {
      viewer.removeEventListener('touchstart', onStart, capture);
      viewer.removeEventListener('touchmove', onMove, capture);
      viewer.removeEventListener('touchend', onEnd, true);
      viewer.removeEventListener('touchcancel', onEnd, true);
    };
  });

  /** The page has been drawn at this zoom */
  const pageDrawn = useCallback((drawnAt: number) => {
    const s = settleRef.current;
    if (s && Math.abs(drawnAt - s.zoom) < 1e-6) settle();
  }, [settle]);

  return { pageDrawn };
}
