/**
 * Scopit - Roof Analyzer Tool
 * EagleView JSON parser with SVG visualization, face/line/area selection,
 * and session-based history for uploaded files.
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Card, Button, Upload, Typography, Tabs, Empty, Modal, Input, Dropdown, Tooltip, Spin, App } from 'antd';
import {
  UploadOutlined,
  HistoryOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CloseOutlined,
  ExpandOutlined,
  CompressOutlined,
  FolderOpenOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { ToolComponentProps } from '../registry';
import { colors, fonts, borderRadius } from '@/styles/theme';
import { useIsMobile } from '@/hooks/useIsMobile';
import {
  useToolSessions,
  useCreateToolSession,
  useUpdateToolSession,
  useDeleteToolSession,
} from '@/hooks/useTools';
import {
  parseEagleView,
  LINE_COLORS,
  slopeFactor,
  polygonArea2D,
  clipPolygonByPoly,
  ptInRect,
  segIntersectsRect,
} from './eagleview-parser';
import type { RoofData, Point2D } from './eagleview-parser';

const { Text, Title } = Typography;

// ── Transform hook ──
function useTransform(points: Record<string, { x: number; y: number }>, W: number, H: number, pad = 40) {
  return useMemo(() => {
    const pts = Object.values(points);
    if (!pts.length) return { tx: (x: number) => x, ty: (y: number) => y, itx: (x: number) => x, ity: (y: number) => y };
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxY - minY || 1));
    const tx = (x: number) => (x - minX) * scale + pad;
    const ty = (y: number) => H - ((y - minY) * scale + pad);
    const itx = (sx: number) => (sx - pad) / scale + minX;
    const ity = (sy: number) => (H - sy - pad) / scale + minY;
    return { tx, ty, itx, ity };
  }, [points, W, H, pad]);
}

type SelectionMode = 'face' | 'line' | 'area';
type PanelTab = 'summary' | 'faces' | 'accessories' | 'lines' | 'area';

const RoofAnalyzerTool: React.FC<ToolComponentProps> = () => {
  const { message } = App.useApp();
  const isMobile = useIsMobile();
  // Data state
  const [data, setData] = useState<RoofData | null>(null);
  const [filename, setFilename] = useState('');
  const [rawJson, setRawJson] = useState<any>(null);

  // Selection state
  const [selFaces, setSelFaces] = useState<Set<string>>(new Set());
  const [selLines, setSelLines] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<SelectionMode>('face');

  // Viewport state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [svgSize, setSvgSize] = useState({ w: 800, h: 600 });
  const [dragRect, setDragRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Area measurement
  const [areaResult, setAreaResult] = useState<{ projected: number; actual: number; byFace: any[] } | null>(null);
  const [areaPoly, setAreaPoly] = useState<Point2D[]>([]);
  const [areaPolyDone, setAreaPolyDone] = useState(false);
  const [mousePos, setMousePos] = useState<Point2D | null>(null);

  // Panel
  const [panelTab, setPanelTab] = useState<PanelTab>('summary');

  // Session / History
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessionName, setSessionName] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const didDrag = useRef(false);

  // Hooks
  const { data: sessions, isLoading: sessionsLoading } = useToolSessions('roof_analyzer');
  const createSession = useCreateToolSession();
  const deleteSession = useDeleteToolSession();

  // ResizeObserver
  useEffect(() => {
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setSvgSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ESC key for area mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode === 'area') {
        setAreaPoly([]); setAreaPolyDone(false); setAreaResult(null); setMousePos(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const { tx, ty, itx, ity } = useTransform(data?.points || {}, svgSize.w, svgSize.h);

  const clientToSvg = useCallback((e: React.MouseEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }, []);

  const screenToData = useCallback((sx: number, sy: number) => ({
    x: itx((sx - pan.x) / zoom),
    y: ity((sy - pan.y) / zoom),
  }), [itx, ity, pan, zoom]);

  // ── File handling ──
  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string);
        const parsed = parseEagleView(json);
        setData(parsed);
        setRawJson(json);
        setFilename(file.name);
        setSelFaces(new Set());
        setSelLines(new Set());
        setZoom(1);
        setPan({ x: 0, y: 0 });
        setAreaPoly([]);
        setAreaPolyDone(false);
        setAreaResult(null);

        // Auto-save session
        createSession.mutate(
          {
            tool_id: 'roof_analyzer',
            name: file.name.replace(/\.(json|JSON)$/, ''),
            data: { filename: file.name, eagleview_json: json },
          },
          {
            onSuccess: (session) => {
              setCurrentSessionId(session.id);
              message.success('File uploaded and saved');
            },
          },
        );
      } catch (err: any) {
        message.error('Failed to parse EagleView JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
    return false; // prevent antd auto upload
  }, [createSession]);

  // ── Load from history ──
  const loadSession = useCallback((session: any) => {
    try {
      const json = session.data?.eagleview_json;
      if (!json) {
        message.error('No EagleView data in this session');
        return;
      }
      const parsed = parseEagleView(json);
      setData(parsed);
      setRawJson(json);
      setFilename(session.data?.filename || session.name || 'Loaded from history');
      setCurrentSessionId(session.id);
      setSelFaces(new Set());
      setSelLines(new Set());
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setAreaPoly([]);
      setAreaPolyDone(false);
      setAreaResult(null);
      setHistoryOpen(false);
      message.success('Loaded: ' + (session.name || 'Untitled'));
    } catch (err: any) {
      message.error('Failed to load session: ' + err.message);
    }
  }, []);

  // ── Delete session ──
  const handleDeleteSession = useCallback((sessionId: string) => {
    Modal.confirm({
      title: 'Delete this file?',
      icon: <ExclamationCircleOutlined />,
      content: 'This will permanently remove the saved EagleView file.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => {
        deleteSession.mutate(sessionId, {
          onSuccess: () => {
            message.success('Deleted');
            if (currentSessionId === sessionId) {
              setCurrentSessionId(null);
            }
          },
        });
      },
    });
  }, [deleteSession, currentSessionId]);

  // ── Area calculation ──
  const calculateAreaPoly = useCallback((poly: Point2D[]) => {
    if (!data || poly.length < 3) return;
    const byFace: any[] = [];
    let totalProjected = 0, totalActual = 0;
    for (const face of data.faces) {
      if (face.isAccessory || face.vertices.length < 3) continue;
      const clipped = clipPolygonByPoly(face.vertices, poly);
      if (!clipped || clipped.length < 3) continue;
      const proj = polygonArea2D(clipped);
      if (proj < 0.01) continue;
      const sf = slopeFactor(face.pitch);
      const actual = proj * sf;
      totalProjected += proj;
      totalActual += actual;
      byFace.push({ designator: face.designator, pitch: face.pitch, proj, actual, sf });
    }
    byFace.sort((a, b) => b.actual - a.actual);
    setAreaResult({ projected: totalProjected, actual: totalActual, byFace });
  }, [data]);

  // ── Mouse handlers ──
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (!data) return;
    const pos = clientToSvg(e);
    if (e.altKey || e.button === 1) {
      isPanning.current = true;
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      return;
    }
    if (e.button === 0 && mode === 'area') {
      if (e.detail === 2) {
        setAreaPoly(prev => {
          const trimmed = prev.length > 1 ? prev.slice(0, -1) : prev;
          if (trimmed.length >= 3) {
            setTimeout(() => {
              calculateAreaPoly(trimmed);
              setAreaPolyDone(true);
              setPanelTab('area');
            }, 0);
          }
          return trimmed;
        });
        return;
      }
      const dp = screenToData(pos.x, pos.y);
      setAreaPoly(prev => [...prev, dp]);
      setAreaPolyDone(false);
      setAreaResult(null);
      return;
    }
    if (e.button === 0) {
      isDragging.current = true;
      didDrag.current = false;
      dragOrigin.current = pos;
      setDragRect({ x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y });
    }
  }, [data, pan, clientToSvg, mode, screenToData, calculateAreaPoly]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current && panStart.current) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
      return;
    }
    if (mode === 'area') {
      const pos = clientToSvg(e);
      setMousePos(screenToData(pos.x, pos.y));
      return;
    }
    if (isDragging.current && dragOrigin.current) {
      const pos = clientToSvg(e);
      const dx = Math.abs(pos.x - dragOrigin.current.x);
      const dy = Math.abs(pos.y - dragOrigin.current.y);
      if (dx > 5 || dy > 5) didDrag.current = true;
      setDragRect({ x1: dragOrigin.current.x, y1: dragOrigin.current.y, x2: pos.x, y2: pos.y });
    }
  }, [clientToSvg, mode, screenToData]);

  const onMouseUp = useCallback(() => {
    if (isPanning.current) { isPanning.current = false; panStart.current = null; return; }
    if (!isDragging.current) return;
    isDragging.current = false;
    const rect = dragRect;
    setDragRect(null);

    if (!didDrag.current || !rect || !data) return;

    const d1 = screenToData(rect.x1, rect.y1);
    const d2 = screenToData(rect.x2, rect.y2);
    const rx1 = Math.min(d1.x, d2.x), rx2 = Math.max(d1.x, d2.x);
    const ry1 = Math.min(d1.y, d2.y), ry2 = Math.max(d1.y, d2.y);

    if (mode === 'face') {
      const hits = data.faces.filter(f => ptInRect(rx1, ry1, rx2, ry2, f.centroid.x, f.centroid.y)).map(f => f.id);
      if (hits.length) setSelFaces(prev => {
        const n = new Set(prev);
        const allSelected = hits.every(id => n.has(id));
        hits.forEach(id => allSelected ? n.delete(id) : n.add(id));
        return n;
      });
    } else if (mode === 'line') {
      const hits = Object.values(data.lines).filter(l => {
        if (l.type === 'HIDDEN') return false;
        const pts = l.ptIds.map(pid => data.points[pid]).filter(Boolean);
        for (let i = 0; i < pts.length - 1; i++)
          if (segIntersectsRect(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, rx1, ry1, rx2, ry2)) return true;
        return false;
      }).map(l => l.id);
      if (hits.length) setSelLines(prev => {
        const n = new Set(prev);
        const allSelected = hits.every(id => n.has(id));
        hits.forEach(id => allSelected ? n.delete(id) : n.add(id));
        return n;
      });
    }
  }, [data, dragRect, mode, screenToData]);

  const onFaceClick = useCallback((e: React.MouseEvent, id: string) => {
    if (didDrag.current) return;
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      setSelFaces(prev => { const n = new Set(prev); n.delete(id); return n; });
    } else {
      setSelFaces(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }
  }, []);

  const onLineClick = useCallback((e: React.MouseEvent, id: string) => {
    if (didDrag.current) return;
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey) {
      setSelLines(prev => { const n = new Set(prev); n.delete(id); return n; });
    } else {
      setSelLines(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    }
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    if (e.ctrlKey || e.metaKey) {
      const pos = clientToSvg(e);
      setZoom(prev => {
        const next = Math.min(12, Math.max(0.2, prev * factor));
        const ratio = next / prev;
        setPan(p => ({ x: pos.x - ratio * (pos.x - p.x), y: pos.y - ratio * (pos.y - p.y) }));
        return next;
      });
    } else {
      setZoom(z => Math.min(12, Math.max(0.2, z * factor)));
    }
  }, [clientToSvg]);

  const clearAll = () => {
    setSelFaces(new Set()); setSelLines(new Set());
    setAreaResult(null); setAreaPoly([]); setAreaPolyDone(false); setMousePos(null);
  };
  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  // ── Summaries ──
  const facesSummary = useMemo(() => {
    if (!data) return { total: 0, accTotal: 0, faces: [], roofFaces: [], accFaces: [] };
    const sel = data.faces.filter(f => selFaces.has(f.id));
    const roofFaces = sel.filter(f => !f.isAccessory);
    const accFaces = sel.filter(f => f.isAccessory);
    return {
      total: roofFaces.reduce((s, f) => s + f.area, 0),
      accTotal: accFaces.reduce((s, f) => s + f.area, 0),
      faces: sel, roofFaces, accFaces,
    };
  }, [data, selFaces]);

  const slopeSummary = useMemo(() => {
    if (!data || selFaces.size === 0) return null;
    const groups = { low: 0, mid: 0, high: 0, other: 0 };
    for (const fid of selFaces) {
      const face = data.faces.find(f => f.id === fid);
      if (!face || face.isAccessory) continue;
      const p = parseFloat(face.pitch);
      if (p >= 7 && p <= 9) groups.low += face.area;
      else if (p >= 10 && p <= 12) groups.mid += face.area;
      else if (p > 12) groups.high += face.area;
      else groups.other += face.area;
    }
    return groups;
  }, [data, selFaces]);

  const faceLinesSummary = useMemo(() => {
    if (!data || selFaces.size === 0) return null;
    const lineSet = new Set<string>();
    for (const fid of selFaces) {
      const face = data.faces.find(f => f.id === fid);
      if (face) face.lineIds.forEach(lid => lineSet.add(lid));
    }
    const byType: Record<string, { total: number; count: number }> = {};
    let total = 0;
    for (const lid of lineSet) {
      const l = data.lines[lid]; if (!l || l.type === 'HIDDEN') continue;
      const t = l.type || 'OTHER';
      if (!byType[t]) byType[t] = { total: 0, count: 0 };
      byType[t].total += l.length; byType[t].count++; total += l.length;
    }
    return { byType, total };
  }, [data, selFaces]);

  const linesSummary = useMemo(() => {
    if (!data) return { byType: {} as Record<string, { lines: any[]; total: number }>, total: 0 };
    const byType: Record<string, { lines: any[]; total: number }> = {};
    let total = 0;
    for (const lid of selLines) {
      const l = data.lines[lid]; if (!l) continue;
      const t = l.type || 'OTHER';
      if (!byType[t]) byType[t] = { lines: [], total: 0 };
      byType[t].lines.push(l); byType[t].total += l.length; total += l.length;
    }
    return { byType, total };
  }, [data, selLines]);

  const drs = dragRect ? {
    x: Math.min(dragRect.x1, dragRect.x2),
    y: Math.min(dragRect.y1, dragRect.y2),
    w: Math.abs(dragRect.x2 - dragRect.x1),
    h: Math.abs(dragRect.y2 - dragRect.y1),
  } : null;

  // ── Render ──
  const canvasContent = (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
        background: colors.bgLight,
        cursor: isPanning.current ? 'grabbing' : mode === 'area' ? 'crosshair' : 'default',
        borderRadius: data ? 0 : borderRadius.lg,
        minHeight: data ? (isMobile ? 300 : 500) : 240,
      }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {!data ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, padding: isMobile ? 24 : 48 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <polygon points="12,3 21,19 3,19" stroke={colors.textMuted} strokeWidth="1.2" fill="rgba(203,213,225,0.2)" />
            </svg>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: colors.textPrimary, fontFamily: fonts.heading, marginBottom: 4 }}>
              Upload EagleView Report
            </div>
            <div style={{ fontSize: 13, color: colors.textSecondary }}>
              Upload a JSON file to visualize and analyze roof measurements
            </div>
          </div>
          <Upload
            accept=".json,.JSON"
            maxCount={1}
            showUploadList={false}
            beforeUpload={handleFileUpload}
          >
            <Button type="primary" icon={<UploadOutlined />} size="large" style={{ minHeight: 44, minWidth: 180 }}>
              Upload JSON File
            </Button>
          </Upload>
          {sessions && sessions.length > 0 && (
            <Button
              type="link"
              icon={<HistoryOutlined />}
              onClick={() => setHistoryOpen(true)}
              style={{ color: colors.textSecondary }}
            >
              Load from History ({sessions.length})
            </Button>
          )}
        </div>
      ) : (
        <>
          <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block', userSelect: 'none' }}>
            <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>
              {/* Faces */}
              {[...data.faces].sort((a, b) => b.area - a.area).map(face => {
                if (face.vertices.length < 3) return null;
                const pts = face.vertices.map(v => `${tx(v.x)},${ty(v.y)}`).join(' ');
                const cx = tx(face.centroid.x), cy = ty(face.centroid.y);
                const isSel = selFaces.has(face.id);
                return (
                  <g key={face.id}>
                    <polygon
                      points={pts}
                      fill={face.isAccessory
                        ? (isSel ? 'rgba(217,119,6,0.15)' : 'rgba(217,119,6,0.05)')
                        : (isSel ? 'rgba(37,99,235,0.12)' : 'rgba(0,0,0,0.03)')}
                      stroke={face.isAccessory
                        ? (isSel ? '#d97706' : 'rgba(217,119,6,0.4)')
                        : (isSel ? '#2563eb' : 'rgba(148,163,184,0.4)')}
                      strokeWidth={isSel ? 1.6 / zoom : 0.7 / zoom}
                      strokeDasharray={face.isAccessory ? `${4 / zoom} ${2 / zoom}` : undefined}
                      style={{ cursor: mode === 'face' ? 'pointer' : 'default' }}
                      onClick={mode === 'face' ? (e) => onFaceClick(e, face.id) : undefined}
                    >
                      <title>{face.isAccessory ? '[Acc] ' : ''}{face.designator} | {face.area.toFixed(0)} sqft | {face.pitch}:12</title>
                    </polygon>
                    <text x={cx} y={cy - 4 / zoom} textAnchor="middle"
                      fontSize={Math.max(6, 11 / zoom)}
                      fill={face.isAccessory ? (isSel ? '#d97706' : 'rgba(217,119,6,0.7)') : (isSel ? '#1d4ed8' : 'rgba(71,85,105,0.9)')}
                      fontWeight={isSel ? '700' : '400'}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >{face.designator}</text>
                    {!face.isAccessory && (
                      <text x={cx} y={cy + 8 / zoom} textAnchor="middle"
                        fontSize={Math.max(5, 8 / zoom)}
                        fill={isSel ? 'rgba(37,99,235,0.7)' : 'rgba(100,116,139,0.6)'}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >{face.area.toFixed(0)}sf/{face.pitch}:12</text>
                    )}
                  </g>
                );
              })}

              {/* Lines */}
              {Object.entries(data.lines).map(([lid, l]) => {
                if (l.type === 'HIDDEN') return null;
                const cfg = LINE_COLORS[l.type] || LINE_COLORS.OTHER;
                const pts = l.ptIds.map(pid => data.points[pid]).filter(Boolean);
                if (pts.length < 2) return null;
                const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${tx(p.x)} ${ty(p.y)}`).join(' ');
                const isSel = selLines.has(lid);
                const mid = pts[Math.floor(pts.length / 2)];
                return (
                  <g key={lid}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth={14 / zoom}
                      style={{ cursor: mode === 'line' ? 'pointer' : 'default' }}
                      onClick={mode === 'line' ? (e) => onLineClick(e, lid) : undefined}
                    />
                    <path d={d} fill="none"
                      stroke={isSel ? '#1a1f2e' : cfg.color}
                      strokeWidth={(isSel ? 2.4 : 1.4) / zoom}
                      strokeOpacity={isSel ? 1 : 0.85}
                    />
                    {isSel && mid && (
                      <text x={tx(mid.x)} y={ty(mid.y) - 6 / zoom} textAnchor="middle"
                        fontSize={Math.max(5, 8 / zoom)} fill="#1a1f2e" fontWeight="700"
                        style={{ pointerEvents: 'none', userSelect: 'none' }}>
                        {l.length.toFixed(1)}ft
                      </text>
                    )}
                  </g>
                );
              })}
            </g>

            {/* Drag rect */}
            {drs && didDrag.current && (
              <rect x={drs.x} y={drs.y} width={drs.w} height={drs.h}
                fill="rgba(37,99,235,0.05)" stroke="#2563eb" strokeWidth={1} strokeDasharray="4 3"
                style={{ pointerEvents: 'none' }}
              />
            )}

            {/* Area polygon */}
            {mode === 'area' && areaPoly.length > 0 && (() => {
              const sp = areaPoly.map(p => ({ sx: tx(p.x) * zoom + pan.x, sy: ty(p.y) * zoom + pan.y }));
              const cur = mousePos && !areaPolyDone ? { sx: tx(mousePos.x) * zoom + pan.x, sy: ty(mousePos.y) * zoom + pan.y } : null;
              const all = cur ? [...sp, cur] : sp;
              return (
                <g style={{ pointerEvents: 'none' }}>
                  {areaPolyDone && sp.length > 2 && <polygon points={sp.map(p => `${p.sx},${p.sy}`).join(' ')} fill="rgba(217,119,6,0.08)" stroke="none" />}
                  {all.length > 1 && <polyline points={all.map(p => `${p.sx},${p.sy}`).join(' ')} fill="none" stroke="#d97706" strokeWidth={1.5} strokeDasharray={areaPolyDone ? 'none' : '5 3'} />}
                  {!areaPolyDone && cur && sp.length > 1 && <line x1={cur.sx} y1={cur.sy} x2={sp[0].sx} y2={sp[0].sy} stroke="#d97706" strokeWidth={1} strokeDasharray="3 4" strokeOpacity={0.4} />}
                  {sp.map((p, i) => <circle key={i} cx={p.sx} cy={p.sy} r={i === 0 ? 6 : 3.5} fill={i === 0 ? '#d97706' : '#fff'} stroke="#d97706" strokeWidth={1.5} />)}
                  {cur && !areaPolyDone && <circle cx={cur.sx} cy={cur.sy} r={2.5} fill="#d97706" fillOpacity={0.6} />}
                </g>
              );
            })()}
          </svg>

          {/* Status bar */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            padding: '6px 16px', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(4px)',
            borderTop: `1px solid ${colors.border}`, display: 'flex', fontSize: 11,
            color: colors.textSecondary, alignItems: 'center',
          }}>
            {mode === 'face' && <span>{isMobile ? 'Tap to select' : 'Drag: select | Click: toggle | Ctrl+Click: deselect | Alt+Drag: pan | Scroll: zoom'}</span>}
            {mode === 'line' && <span>{isMobile ? 'Tap to select' : 'Drag: select | Click: toggle | Ctrl+Click: deselect | Alt+Drag: pan'}</span>}
            {mode === 'area' && <span style={{ color: '#d97706' }}>{isMobile ? `Tap to add${areaPoly.length > 0 ? ` | ${areaPoly.length} pts` : ''}` : `Click: add point | Double click: finish | Esc: reset${areaPoly.length > 0 ? ` | ${areaPoly.length} pts` : ''}`}</span>}
            <span style={{ marginLeft: 'auto', color: colors.textMuted }}>
              {data.faces.filter(f => !f.isAccessory).length}F | {Object.keys(data.lines).length}L | {(zoom * 100).toFixed(0)}%
            </span>
          </div>
        </>
      )}
    </div>
  );

  // ── Right Panel ──
  const rightPanel = data ? (
    <div style={{
      width: isMobile ? '100%' : 300,
      background: colors.bgWhite,
      borderLeft: isMobile ? 'none' : `1px solid ${colors.border}`,
      borderTop: isMobile ? `1px solid ${colors.border}` : 'none',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Stats row */}
      <div style={{ padding: '12px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: colors.border, borderRadius: 6, overflow: 'hidden' }}>
          {[
            ['Faces', data.faces.filter(f => !f.isAccessory).length],
            ['Acc', data.faces.filter(f => f.isAccessory).length],
            ['Area', data.faces.filter(f => !f.isAccessory).reduce((s, f) => s + f.area, 0).toFixed(0) + 'sf'],
            ['Lines', Object.keys(data.lines).length],
          ].map(([l, v]) => (
            <div key={l as string} style={{ background: colors.bgWhite, padding: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: colors.textMuted, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{l}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: colors.textPrimary, fontFamily: fonts.heading }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        {([
          { key: 'summary', label: 'Summary' },
          { key: 'faces', label: `Faces` },
          { key: 'accessories', label: `Acc` },
          { key: 'lines', label: 'Lines' },
          ...(mode === 'area' ? [{ key: 'area', label: 'Area' }] : []),
        ] as { key: PanelTab; label: string }[]).map(({ key, label }) => (
          <button key={key}
            onClick={() => setPanelTab(key)}
            style={{
              flex: 1, padding: '8px 4px', border: 'none',
              borderBottom: panelTab === key ? '2px solid #111827' : '2px solid transparent',
              background: 'transparent',
              color: panelTab === key ? colors.textPrimary : colors.textMuted,
              cursor: 'pointer', fontSize: 12, fontFamily: fonts.body,
              fontWeight: panelTab === key ? 600 : 400,
            }}
          >{label}</button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '14px', maxHeight: isMobile ? 320 : undefined }}>

        {/* SUMMARY */}
        {panelTab === 'summary' && (
          <>
            {selFaces.size === 0 && selLines.size === 0 && mode !== 'area' && (
              <div style={{ paddingTop: 48, textAlign: 'center', color: colors.textMuted, fontSize: 13, lineHeight: 2 }}>
                {mode === 'face' ? 'Click or drag to select faces' : 'Click or drag to select lines'}
              </div>
            )}

            {selFaces.size > 0 && (
              <div style={{ marginBottom: 16 }}>
                <SectionLabel>Selected Faces</SectionLabel>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: colors.textSecondary }}>Total Area</span>
                  <span>
                    <span style={{ fontSize: 24, fontWeight: 700, color: '#2563eb', fontFamily: fonts.heading }}>{facesSummary.total.toFixed(0)}</span>
                    <span style={{ fontSize: 12, color: colors.textMuted, marginLeft: 4 }}>sqft</span>
                  </span>
                </div>
                {facesSummary.accFaces.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#d97706', padding: '4px 0', borderTop: `1px solid ${colors.border}`, marginBottom: 4 }}>
                    <span>Accessories ({facesSummary.accFaces.length})</span>
                    <span style={{ fontWeight: 600 }}>{facesSummary.accTotal.toFixed(0)} sqft</span>
                  </div>
                )}

                {slopeSummary && (
                  <div style={{ marginTop: 10 }}>
                    <SectionLabel>Area by Slope</SectionLabel>
                    {[
                      { label: '7-9 / 12', value: slopeSummary.low, barColor: '#3b82f6' },
                      { label: '10-12 / 12', value: slopeSummary.mid, barColor: '#f59e0b' },
                      { label: '> 12 / 12', value: slopeSummary.high, barColor: '#ef4444' },
                      ...(slopeSummary.other > 0 ? [{ label: 'Other', value: slopeSummary.other, barColor: '#94a3b8' }] : []),
                    ].map(({ label, value, barColor }) => (
                      <div key={label} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                          <span style={{ color: colors.textSecondary }}>{label}</span>
                          <span style={{ color: value > 0 ? barColor : colors.textMuted, fontWeight: value > 0 ? 600 : 400 }}>
                            {value > 0 ? value.toFixed(0) + ' sf' : '—'}
                          </span>
                        </div>
                        {value > 0 && facesSummary.total > 0 && (
                          <div style={{ height: 4, background: '#f1f5f9', borderRadius: 2 }}>
                            <div style={{ height: '100%', background: barColor, borderRadius: 2, width: `${Math.min(100, (value / facesSummary.total) * 100)}%` }} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {faceLinesSummary && (
                  <div style={{ marginTop: 10 }}>
                    <SectionLabel>Line Lengths</SectionLabel>
                    {Object.entries(faceLinesSummary.byType).map(([type, info]) => {
                      const cfg = LINE_COLORS[type] || LINE_COLORS.OTHER;
                      return (
                        <div key={type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #f8fafc', fontSize: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ width: 14, height: 2, background: cfg.color, borderRadius: 1 }} />
                            <span style={{ color: colors.textSecondary }}>{cfg.label}</span>
                            <span style={{ color: colors.textMuted, fontSize: 10 }}>x{info.count}</span>
                          </div>
                          <span style={{ fontWeight: 600, color: colors.textPrimary }}>{info.total.toFixed(1)} ft</span>
                        </div>
                      );
                    })}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, marginTop: 6, paddingTop: 6, borderTop: `1px solid ${colors.border}` }}>
                      <span style={{ color: colors.textMuted }}>Total</span>
                      <span style={{ color: colors.textPrimary }}>{faceLinesSummary.total.toFixed(1)} ft</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {selLines.size > 0 && (
              <div>
                <SectionLabel>Selected Lines</SectionLabel>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: colors.textSecondary }}>Total Length</span>
                  <span>
                    <span style={{ fontSize: 24, fontWeight: 700, color: '#059669', fontFamily: fonts.heading }}>{linesSummary.total.toFixed(1)}</span>
                    <span style={{ fontSize: 12, color: colors.textMuted, marginLeft: 4 }}>ft</span>
                  </span>
                </div>
                {Object.entries(linesSummary.byType).map(([type, info]) => {
                  const cfg = LINE_COLORS[type] || LINE_COLORS.OTHER;
                  return (
                    <div key={type} style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: cfg.color, marginBottom: 3 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 14, height: 2, background: cfg.color, borderRadius: 2 }} />
                          {cfg.label}
                        </div>
                        <span>{info.total.toFixed(1)} ft</span>
                      </div>
                      {info.lines.map((l: any) => (
                        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: colors.textMuted, padding: '2px 0 2px 20px' }}>
                          <span>{l.id}</span><span>{l.length.toFixed(1)} ft</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* FACES */}
        {panelTab === 'faces' && (
          <div>
            {mode === 'face' && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <Button size="small" type="primary" ghost
                  onClick={() => setSelFaces(new Set(data.faces.filter(f => !f.isAccessory).map(f => f.id)))}
                  style={{ flex: 1 }}
                >Select All</Button>
                <Button size="small"
                  onClick={() => setSelFaces(new Set())}
                  style={{ flex: 1 }}
                >Clear</Button>
              </div>
            )}
            {selFaces.size > 0 && facesSummary.roofFaces.length > 0 && (
              <div style={{ background: '#eff6ff', borderRadius: 6, padding: '6px 12px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#3b82f6' }}>{facesSummary.roofFaces.length} selected</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#2563eb' }}>{facesSummary.total.toFixed(0)} sqft</span>
              </div>
            )}
            {/* Column headers */}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', borderBottom: `1px solid ${colors.border}`, marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>ID</span>
              <span style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Area</span>
              <span style={{ fontSize: 10, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pitch</span>
            </div>
            {data.faces.filter(f => !f.isAccessory).map(f => {
              const isSel = selFaces.has(f.id);
              return (
                <div key={f.id}
                  onClick={() => { if (mode !== 'face') return; isSel ? setSelFaces(p => { const n = new Set(p); n.delete(f.id); return n; }) : setSelFaces(p => new Set([...p, f.id])); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 8px', borderRadius: 6, marginBottom: 2,
                    background: isSel ? 'rgba(37,99,235,0.06)' : 'transparent',
                    borderLeft: `3px solid ${isSel ? '#2563eb' : 'transparent'}`,
                    cursor: mode === 'face' ? 'pointer' : 'default',
                    transition: 'background 0.15s',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: isSel ? '#2563eb' : colors.textPrimary }}>{f.designator}</span>
                  <span style={{ fontSize: 12, color: colors.textSecondary }}>{f.area.toFixed(0)} sf</span>
                  <span style={{ fontSize: 12, color: colors.textMuted }}>{f.pitch}:12</span>
                </div>
              );
            })}
          </div>
        )}

        {/* ACCESSORIES */}
        {panelTab === 'accessories' && (
          <div>
            {data.faces.filter(f => f.isAccessory).length === 0
              ? <Empty description="No accessories" style={{ paddingTop: 36 }} />
              : data.faces.filter(f => f.isAccessory).map(f => {
                const isSel = selFaces.has(f.id);
                return (
                  <div key={f.id}
                    onClick={() => { if (mode !== 'face') return; isSel ? setSelFaces(p => { const n = new Set(p); n.delete(f.id); return n; }) : setSelFaces(p => new Set([...p, f.id])); }}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 10px', borderRadius: 6, marginBottom: 4,
                      border: `1px solid ${isSel ? '#fde68a' : '#fef3c7'}`,
                      background: isSel ? '#fffbeb' : '#fffdf5',
                      cursor: mode === 'face' ? 'pointer' : 'default',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#d97706' }}>{f.designator}</span>
                    <span style={{ fontSize: 12, color: '#78716c' }}>{f.area.toFixed(0)} sf</span>
                    <span style={{ fontSize: 11, color: '#a8a29e' }}>{f.pitch}:12</span>
                  </div>
                );
              })
            }
          </div>
        )}

        {/* LINES */}
        {panelTab === 'lines' && (
          <div>
            {selLines.size === 0 ? (
              <div style={{ paddingTop: 48, textAlign: 'center', color: colors.textMuted, fontSize: 13, lineHeight: 2 }}>
                Click or drag to select lines
              </div>
            ) : (
              <>
                <div style={{ background: '#f0fdf4', borderRadius: 6, padding: '8px 12px', marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: '#16a34a' }}>{selLines.size} selected</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>{linesSummary.total.toFixed(1)} ft</span>
                </div>
                {Object.entries(linesSummary.byType).map(([type, info]) => {
                  const cfg = LINE_COLORS[type] || LINE_COLORS.OTHER;
                  return (
                    <div key={type} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `2px solid ${cfg.color}`, marginBottom: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: cfg.color }}>
                          <div style={{ width: 14, height: 3, background: cfg.color, borderRadius: 2 }} />{cfg.label}
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{info.total.toFixed(1)} ft</span>
                      </div>
                      {info.lines.map((l: any) => (
                        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: colors.textSecondary, padding: '3px 0 3px 20px' }}>
                          <span>{l.id}</span><span>{l.length.toFixed(1)} ft</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* AREA */}
        {panelTab === 'area' && (
          areaResult ? (
            <div>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '14px', marginBottom: 14, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#92400e', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actual Area (slope adjusted)</div>
                <div>
                  <span style={{ fontSize: 32, fontWeight: 700, color: '#d97706', fontFamily: fonts.heading }}>{areaResult.actual.toFixed(0)}</span>
                  <span style={{ fontSize: 13, color: '#92400e', marginLeft: 4 }}>sqft</span>
                </div>
                <div style={{ fontSize: 12, color: '#a16207', marginTop: 4 }}>Projected: {areaResult.projected.toFixed(0)} sqft</div>
              </div>
              <Button block onClick={() => { setAreaPoly([]); setAreaPolyDone(false); setAreaResult(null); }}
                style={{ marginBottom: 14 }}
              >Redraw</Button>
              <SectionLabel>Face Breakdown</SectionLabel>
              {areaResult.byFace.map((f: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f8fafc' }}>
                  <div>
                    <span style={{ fontSize: 13, color: '#d97706', fontWeight: 700, marginRight: 6 }}>{f.designator}</span>
                    <span style={{ fontSize: 10, color: colors.textMuted }}>{f.pitch}:12 x{f.sf.toFixed(3)}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>{f.actual.toFixed(1)} sf</div>
                    <div style={{ fontSize: 10, color: colors.textMuted }}>proj {f.proj.toFixed(1)}</div>
                  </div>
                </div>
              ))}
              {areaResult.byFace.length === 0 && (
                <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', padding: '10px 0' }}>No roof faces in this area</div>
              )}
            </div>
          ) : areaPoly.length > 0 ? (
            <div>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '14px', marginBottom: 14, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#92400e', marginBottom: 4 }}>Drawing polygon</div>
                <span style={{ fontSize: 28, fontWeight: 700, color: '#d97706', fontFamily: fonts.heading }}>{areaPoly.length}</span>
                <span style={{ fontSize: 12, color: '#a16207', marginLeft: 4 }}>pts</span>
              </div>
              <div style={{ fontSize: 12, color: colors.textMuted, textAlign: 'center', lineHeight: 2, marginBottom: 14 }}>
                Double-click to finish | Esc to reset
              </div>
              <Button type="primary" block disabled={areaPoly.length < 3}
                onClick={() => { if (areaPoly.length >= 3) { calculateAreaPoly(areaPoly); setAreaPolyDone(true); setPanelTab('area'); } }}
              >
                Calculate {areaPoly.length < 3 ? '(min 3 pts)' : ''}
              </Button>
            </div>
          ) : (
            <div style={{ paddingTop: 48, textAlign: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 14px', display: 'block' }}>
                <path d="M3 21l4-8 4 4 4-6 6 9H3z" stroke={colors.border} strokeWidth="1.5" fill="#f8fafc" />
              </svg>
              <div style={{ fontSize: 13, color: colors.textMuted, lineHeight: 2 }}>
                Click on the canvas to<br />draw the measurement area
              </div>
            </div>
          )
        )}
      </div>
    </div>
  ) : null;

  return (
    <div>
      {/* Toolbar */}
      {data && (
        <Card
          size="small"
          style={{ borderRadius: borderRadius.lg, marginBottom: 16, padding: 0 }}
          bodyStyle={{ padding: isMobile ? '8px 12px' : '8px 16px', display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 8, overflowX: 'auto', flexWrap: isMobile ? 'nowrap' : 'wrap' }}
        >
          {/* File info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 8 }}>
            <FolderOpenOutlined style={{ color: colors.textMuted }} />
            <Text style={{ color: colors.textSecondary, fontSize: 13, maxWidth: isMobile ? 100 : 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filename}
            </Text>
          </div>

          <div style={{ width: 1, height: 24, background: colors.border, margin: '0 4px' }} />

          {/* Mode buttons */}
          {[
            { key: 'face' as const, label: 'Face' },
            { key: 'line' as const, label: 'Line' },
            { key: 'area' as const, label: 'Area' },
          ].map(({ key, label }) => (
            <Button key={key} size="small"
              type={mode === key ? 'primary' : 'default'}
              onClick={() => {
                setMode(key);
                setAreaPoly([]); setAreaPolyDone(false); setAreaResult(null); setMousePos(null);
                if (key === 'area') setPanelTab('area');
              }}
            >{label}</Button>
          ))}

          <div style={{ width: 1, height: 24, background: colors.border, margin: '0 4px' }} />

          {/* Actions */}
          <Tooltip title="Clear selection">
            <Button size="small" icon={<CloseOutlined />} onClick={clearAll} />
          </Tooltip>
          <Tooltip title="Reset view">
            <Button size="small" icon={<ReloadOutlined />} onClick={resetView} />
          </Tooltip>

          <div style={{ width: 1, height: 24, background: colors.border, margin: '0 4px' }} />

          {/* Upload new */}
          <Upload accept=".json,.JSON" maxCount={1} showUploadList={false} beforeUpload={handleFileUpload}>
            <Button size="small" icon={<UploadOutlined />}>New File</Button>
          </Upload>

          {/* History */}
          <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>
            History
          </Button>

          {/* Legend - hidden on mobile */}
          {!isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto', flexWrap: 'wrap' }}>
              {Object.entries(LINE_COLORS).filter(([k]) => k !== 'HIDDEN' && k !== 'OTHER').map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                  <div style={{ width: 16, height: 2, background: v.color, borderRadius: 1 }} />
                  <span style={{ fontSize: 11, color: colors.textMuted }}>{v.label}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Main body */}
      <Card
        style={{
          borderRadius: borderRadius.lg,
          overflow: 'hidden',
          ...(isFullscreen ? {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, borderRadius: 0,
          } : {}),
        }}
        bodyStyle={{
          padding: 0,
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          height: data ? (isMobile ? 'auto' : 600) : 'auto',
          minHeight: data ? (isMobile ? 0 : 600) : (isMobile ? 240 : 300),
        }}
      >
        {canvasContent}
        {rightPanel}
      </Card>

      {/* History Modal */}
      <Modal
        title="EagleView File History"
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        footer={null}
        width={isMobile ? '100%' : 520}
        style={isMobile ? { top: 0, margin: 0, maxWidth: '100vw', paddingBottom: 0 } : undefined}
        centered={!isMobile}
      >
        {sessionsLoading ? (
          <div style={{ textAlign: 'center', padding: 32 }}><Spin /></div>
        ) : !sessions || sessions.length === 0 ? (
          <Empty description="No saved files yet" />
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {sessions.map((session) => (
              <div key={session.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 16px', borderRadius: 8, marginBottom: 8,
                  border: `1px solid ${currentSessionId === session.id ? colors.primary : colors.border}`,
                  background: currentSessionId === session.id ? '#f9fafb' : colors.bgWhite,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onClick={() => loadSession(session)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: colors.textPrimary, fontFamily: fonts.heading, marginBottom: 2 }}>
                    {session.name || 'Untitled'}
                  </div>
                  <div style={{ fontSize: 12, color: colors.textMuted }}>
                    {(session.data?.filename as string) || 'EagleView JSON'}
                    {' | '}
                    {new Date(session.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 12 }}>
                  <Tooltip title="Load">
                    <Button size="small" type="primary" ghost icon={<FolderOpenOutlined />}
                      onClick={(e) => { e.stopPropagation(); loadSession(session); }}
                    />
                  </Tooltip>
                  <Tooltip title="Delete">
                    <Button size="small" danger icon={<DeleteOutlined />}
                      onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                    />
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
};

// ── Helper Components ──
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, color: colors.textMuted,
      textTransform: 'uppercase', letterSpacing: '0.08em',
      marginBottom: 8, marginTop: 4,
    }}>
      {children}
    </div>
  );
}

export default RoofAnalyzerTool;
