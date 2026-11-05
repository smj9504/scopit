"""
Roof points -> roof planes -> faces and typed edges, in the Roof Analyzer's RoofData shape.

1. Planes: region growing on point normals, then merge adjacent coplanar pieces.
2. Faces: rasterise the roof outline, give every cell the plane of its nearest point, smooth.
3. Edges: walk the boundaries between cell labels (shared by both neighbours, so faces stay
   watertight), simplify them, and snap corners onto plane intersections so ridges, hips and valleys
   come out straight.
4. Types: between two planes -> ridge / hip / valley (convex vs concave, level vs sloped); on the
   outline -> eave (level) / rake (sloped); where a roof meets a higher roof -> eave or rake for the
   upper one and flashing / step flashing for the lower one.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
from shapely.geometry import LineString, MultiLineString, MultiPoint, Polygon

from .geometry import M2_TO_FT2, M_TO_FT, local_normals

STEP_M = 0.35          # height gap between two planes along a shared edge that means "step", not intersection
MIN_FACE_M2 = 1.0


@dataclass
class Plane:
    id: int
    normal: np.ndarray
    centroid: np.ndarray
    n_points: int
    a: float = 0.0
    b: float = 0.0
    c: float = 0.0
    slope_deg: float = 0.0
    azimuth_deg: float = 0.0   # downslope direction, degrees from north
    wall: bool = False

    def __post_init__(self):
        nx, ny, nz = self.normal
        self.slope_deg = math.degrees(math.acos(max(-1.0, min(1.0, nz))))
        self.wall = self.slope_deg > 60
        if not self.wall:
            self.a, self.b = -nx / nz, -ny / nz
            self.c = float(self.centroid[2] - self.a * self.centroid[0] - self.b * self.centroid[1])
        self.azimuth_deg = (math.degrees(math.atan2(nx, ny)) + 360) % 360

    @property
    def pitch(self) -> float:
        return 12 * math.tan(math.radians(self.slope_deg))

    @property
    def slope_factor(self) -> float:
        return 1 / math.cos(math.radians(self.slope_deg))

    def z(self, x, y):
        return self.a * np.asarray(x) + self.b * np.asarray(y) + self.c


def _fit(Q: np.ndarray):
    c = Q.mean(0)
    w, v = np.linalg.eigh((Q - c).T @ (Q - c))
    n = v[:, 0] if v[2, 0] > 0 else -v[:, 0]
    return n, c


def segment_planes(P: np.ndarray, min_pts: int, ang_deg: float = 10, dist: float = 0.15):
    """Region growing on normals. Returns (point -> plane index or -1, planes)."""
    n, curv, tree = local_normals(P)
    _, nb = tree.query(P, k=min(12, len(P)))
    seg = -np.ones(len(P), int)
    cos_t = math.cos(math.radians(ang_deg))
    sid = 0
    for s in np.argsort(curv):
        if seg[s] != -1 or curv[s] > 0.02:
            continue
        ns, p0 = n[s], P[s]
        members, stack = [s], [s]
        seg[s] = sid
        while stack:
            i = stack.pop()
            for j in nb[i]:
                if seg[j] == -1 and abs(n[j] @ ns) > cos_t and abs((P[j] - p0) @ ns) < dist:
                    seg[j] = sid
                    stack.append(j)
                    members.append(j)
                    if len(members) % 200 == 0:  # refit as the region grows
                        ns, p0 = _fit(P[members])
        if len(members) < min_pts:
            seg[np.array(members)] = -2
        else:
            sid += 1
    seg[seg < 0] = -1

    # merge adjacent pieces of the same plane (region growing splits noisy planes)
    parent = list(range(sid))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    fits = [_fit(P[seg == s]) for s in range(sid)]
    _, nb8 = tree.query(P, k=min(8, len(P)))
    a = np.repeat(seg, nb8.shape[1])
    b = seg[nb8.ravel()]
    keep = (a >= 0) & (b >= 0) & (a != b)
    pairs, counts = np.unique(np.sort(np.c_[a[keep], b[keep]], axis=1), axis=0, return_counts=True)
    for (i, j), cnt in zip(pairs, counts):
        if cnt < 5:
            continue
        (ni, ci), (nj, cj) = fits[i], fits[j]
        if abs(ni @ nj) < math.cos(math.radians(6)):
            continue
        if abs((cj - ci) @ ni) < 0.15 and abs((ci - cj) @ nj) < 0.15:
            parent[find(i)] = find(j)
    roots = sorted({find(i) for i in range(sid)})
    remap = {r: k for k, r in enumerate(roots)}
    seg = np.where(seg >= 0, np.array([remap[find(s)] for s in range(sid)] + [-1])[seg], -1) if sid else seg
    planes = []
    for k in range(len(roots)):
        Q = P[seg == k]
        nrm, c = _fit(Q)
        planes.append(Plane(k, nrm, c, len(Q)))
    return seg, planes


def _mode_filter(L: np.ndarray, mask: np.ndarray, k: int, iters: int = 2) -> np.ndarray:
    kernel = np.ones((3, 3), np.int16)
    for _ in range(iters):
        counts = np.stack([ndimage.convolve((L == lab).astype(np.int16), kernel, mode="constant") for lab in range(1, k + 1)])
        L = np.where(mask, counts.argmax(0) + 1, 0)
    return L


def _douglas_peucker(pts: np.ndarray, tol: float) -> np.ndarray:
    if len(pts) <= 2:
        return pts
    a, b = pts[0], pts[-1]
    ab = b - a
    L = np.hypot(*ab)
    d = np.hypot(*(pts - a).T) if L < 1e-9 else np.abs(ab[0] * (pts[:, 1] - a[1]) - ab[1] * (pts[:, 0] - a[0])) / L
    i = int(d.argmax())
    if d[i] <= tol:
        return np.array([a, b])
    left = _douglas_peucker(pts[: i + 1], tol)
    right = _douglas_peucker(pts[i:], tol)
    return np.vstack([left[:-1], right])


def _designator(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


@dataclass
class Arc:
    verts: list            # lattice vertex ids, in walk order
    ra: int                # region ids on the two sides (0 = outside)
    rb: int
    simple: list = field(default_factory=list)   # simplified vertex ids


def build_roof(P: np.ndarray, ground_z: float, spacing: Optional[float] = None) -> dict:
    """P: building points (local metres, x east, y north, z elevation). Returns RoofData + summary."""
    if len(P) < 30:
        raise ValueError("Not enough roof points")
    xy = P[:, :2]
    if spacing is None:
        spacing = float(np.median(cKDTree(xy).query(xy, k=2)[0][:, 1]))
    span = np.ptp(xy, axis=0)
    density_b = len(P) / max(span[0] * span[1], 1.0)
    seg, planes = segment_planes(P, min_pts=max(15, int(1.2 * density_b)))
    if not [p for p in planes if not p.wall]:
        raise ValueError("No roof planes found")

    # --- work in a frame aligned with the building, so straight walls give straight raster edges ---
    sloped = [p for p in planes if not p.wall and p.slope_deg > 5]
    if sloped:
        w = np.array([p.n_points for p in sloped], float)
        phi = np.array([math.atan2(p.normal[1], p.normal[0]) for p in sloped])   # downslope direction
        phi0 = 0.25 * math.atan2(float((w * np.sin(4 * phi)).sum()), float((w * np.cos(4 * phi)).sum()))
    else:
        rect = MultiPoint(xy).convex_hull.minimum_rotated_rectangle
        e = np.diff(np.asarray(rect.exterior.coords)[:2], axis=0)[0]
        phi0 = math.atan2(e[1], e[0])
    cs, sn = math.cos(phi0), math.sin(phi0)

    def to_aligned(X, Y):
        return X * cs + Y * sn, -X * sn + Y * cs

    def to_world(X, Y):
        return X * cs - Y * sn, X * sn + Y * cs

    xr, yr = to_aligned(P[:, 0], P[:, 1])
    P = np.c_[xr, yr, P[:, 2]]
    xy = P[:, :2]
    world_azimuth = {p.id: p.azimuth_deg for p in planes}
    planes = [Plane(p.id, np.array([*to_aligned(p.normal[0], p.normal[1]), p.normal[2]]),
                    np.array([*to_aligned(p.centroid[0], p.centroid[1]), p.centroid[2]]), p.n_points) for p in planes]
    roof_planes = [p for p in planes if not p.wall]

    # --- raster labels -------------------------------------------------------------------------
    cell = float(np.clip(1.25 * spacing, 0.25, 0.5))
    x0, y0 = xy.min(0) - 3 * cell
    nx = int(math.ceil((xy[:, 0].max() - x0) / cell)) + 3
    ny = int(math.ceil((xy[:, 1].max() - y0) / cell)) + 3
    gi = ((xy[:, 0] - x0) / cell).astype(int)
    gj = ((xy[:, 1] - y0) / cell).astype(int)
    occ = np.zeros((nx, ny), bool)
    occ[gi, gj] = True
    mask = ndimage.binary_fill_holes(ndimage.binary_closing(occ, iterations=2))
    lab, nl = ndimage.label(mask, structure=np.ones((3, 3)))
    if nl > 1:  # the caller already picked one building; only drop specks
        sizes = ndimage.sum(mask, lab, range(1, nl + 1))
        mask = np.isin(lab, 1 + np.nonzero(sizes * cell * cell >= MIN_FACE_M2)[0])

    roof_ids = np.array([p.id for p in roof_planes])
    use = np.isin(seg, roof_ids)
    tree = cKDTree(xy[use])
    seg_use = seg[use]
    ci, cj = np.nonzero(mask)
    _, nn = tree.query(np.c_[x0 + (ci + 0.5) * cell, y0 + (cj + 0.5) * cell])
    L = np.zeros((nx, ny), int)
    L[ci, cj] = seg_use[nn] + 1                      # plane index + 1
    L = _mode_filter(L, mask, len(planes))

    # split each plane label into connected regions; dissolve tiny ones into their neighbours
    R = np.zeros_like(L)
    region_plane: dict[int, Plane] = {}
    rid = 0
    min_cells = MIN_FACE_M2 / (cell * cell)
    for k in np.unique(L[L > 0]):
        comp, nc = ndimage.label(L == k)
        for c, sl in enumerate(ndimage.find_objects(comp), start=1):
            m = comp == c
            if m.sum() < min_cells or planes[k - 1].wall:
                continue
            # slivers along ridges/edges (mixed normals) are not real facets: need ~0.9 m of width
            if ndimage.distance_transform_edt(np.pad(m[sl], 1)).max() * cell < 0.45:
                continue
            rid += 1
            R[m] = rid
            region_plane[rid] = planes[k - 1]
    if rid == 0:
        raise ValueError("No roof faces found")
    holes = mask & (R == 0)
    if holes.any():
        idx = ndimage.distance_transform_edt(R == 0, return_distances=False, return_indices=True)
        R = np.where(holes, R[idx[0], idx[1]], R)

    # --- lattice boundaries --------------------------------------------------------------------
    Gp = np.pad(R, 1)
    nvy = ny + 1

    def vid(i, j):
        return i * nvy + j

    def vxy(v):
        i, j = divmod(v, nvy)
        return np.array([x0 + i * cell, y0 + j * cell])

    edges = []   # (v1, v2, label_a, label_b)
    below, above = Gp[1:nx + 1, 0:ny + 1], Gp[1:nx + 1, 1:ny + 2]
    for i, j in zip(*np.nonzero(below != above)):
        edges.append((vid(i, j), vid(i + 1, j), below[i, j], above[i, j]))
    left, right = Gp[0:nx + 1, 1:ny + 1], Gp[1:nx + 2, 1:ny + 1]
    for i, j in zip(*np.nonzero(left != right)):
        edges.append((vid(i, j), vid(i, j + 1), left[i, j], right[i, j]))
    adj = defaultdict(list)
    for e, (v1, v2, _, _) in enumerate(edges):
        adj[v1].append(e)
        adj[v2].append(e)
    is_node = {v: len(es) >= 3 for v, es in adj.items()}
    visited = np.zeros(len(edges), bool)

    def walk(v, e):
        verts = [v]
        while True:
            visited[e] = True
            v1, v2, _, _ = edges[e]
            v = v2 if v == v1 else v1
            verts.append(v)
            if is_node[v]:
                return verts
            nxt = [f for f in adj[v] if not visited[f]]
            if not nxt:
                return verts
            e = nxt[0]

    arcs: list[Arc] = []
    for v in [v for v, n in is_node.items() if n]:
        for e in adj[v]:
            if not visited[e]:
                a, b = edges[e][2], edges[e][3]
                arcs.append(Arc(walk(v, e), int(min(a, b)), int(max(a, b))))
    for e in range(len(edges)):
        if not visited[e]:
            v = edges[e][0]
            is_node[v] = True
            a, b = edges[e][2], edges[e][3]
            arcs.append(Arc(walk(v, e), int(min(a, b)), int(max(a, b))))

    # --- simplify, then snap vertices onto plane intersections ----------------------------------
    tol = max(0.35, 1.5 * cell)
    pos: dict[int, np.ndarray] = {}
    for arc in arcs:
        pts = np.array([vxy(v) for v in arc.verts])
        if arc.verts[0] == arc.verts[-1] and len(arc.verts) > 3:
            far = int(np.hypot(*(pts - pts[0]).T).argmax())
            keep = np.vstack([_douglas_peucker(pts[: far + 1], tol)[:-1], _douglas_peucker(pts[far:], tol)])
        else:
            keep = _douglas_peucker(pts, tol)
        lookup = {tuple(np.round(p, 6)): v for p, v in zip(pts, arc.verts)}
        arc.simple = [lookup[tuple(np.round(p, 6))] for p in keep]
        for v in arc.simple:
            pos.setdefault(v, vxy(v))

    def cells_at(v):
        i, j = divmod(v, nvy)
        return [int(r) for r in (Gp[i, j], Gp[i + 1, j], Gp[i, j + 1], Gp[i + 1, j + 1])]

    # the roof outline (raw lattice boundary against "outside"), used to land ridge/hip ends on it
    outline = MultiLineString([[tuple(vxy(v)) for v in a.verts] for a in arcs if a.ra == 0 and len(a.verts) >= 2])

    zpos: dict[int, float] = {}
    for v, p0 in list(pos.items()):
        around = cells_at(v)
        ps = {region_plane[r].id: region_plane[r] for r in around if r}.values()
        ps = sorted(ps, key=lambda p: -float(p.z(*p0)))
        group = [ps[0]] + [p for p in ps[1:] if float(ps[0].z(*p0) - p.z(*p0)) < STEP_M]
        new = p0
        if len(group) >= 3:
            A = np.array([[p.a, p.b, -1.0] for p in group])
            rhs = np.array([-p.c for p in group])
            sol, *_ = np.linalg.lstsq(A, rhs, rcond=None)
            if np.hypot(*(sol[:2] - p0)) < 1.5:
                new = sol[:2]
        elif len(group) == 2:
            g = np.array([group[0].a - group[1].a, group[0].b - group[1].b])
            gn = np.hypot(*g)
            if gn > 0.05:
                d = (g @ p0 + group[0].c - group[1].c) / gn
                foot = p0 - d * g / gn                 # nearest point on the two planes' intersection line
                new = foot if abs(d) < 1.0 else p0
                if 0 in around and not outline.is_empty:
                    # ridge/hip end on the outline: slide along the intersection line to the outline
                    t = np.array([-g[1], g[0]]) / gn
                    hits = LineString([foot - 3 * t, foot + 3 * t]).intersection(outline)
                    cand = [np.array(q.coords[0]) for q in getattr(hits, "geoms", [hits]) if not q.is_empty and q.geom_type == "Point"]
                    if cand:
                        best = min(cand, key=lambda q: np.hypot(*(q - p0)))
                        if np.hypot(*(best - p0)) < 1.5:
                            new = best
        pos[v] = np.asarray(new, float)
        zpos[v] = float(group[0].z(*pos[v]))

    # straighten the outline: in the building-aligned frame most walls run along x or y, so snap
    # near-axis outline segments to exact axis lines fitted to the raw boundary, and re-cut corners
    next_vid = [max(pos) + 1 if pos else 0]

    def new_vertex(xy_, z_):
        v = next_vid[0] = next_vid[0] + 1
        pos[v], zpos[v] = np.asarray(xy_, float), float(z_)
        return v

    for arc in arcs:
        if arc.ra != 0 or len(arc.simple) < 3:
            continue
        plane = region_plane[arc.rb]
        raw = np.array([vxy(v) for v in arc.verts])
        idx_of = {v: k for k, v in enumerate(arc.verts)}
        segs = []   # (axis 'x'|'y'|None, const)
        for v1, v2 in zip(arc.simple[:-1], arc.simple[1:]):
            d = pos[v2] - pos[v1]
            ang = math.degrees(math.atan2(abs(d[1]), abs(d[0])))
            k1, k2 = sorted((idx_of.get(v1, 0), idx_of.get(v2, len(raw) - 1)))
            chunk = raw[k1:k2 + 1] if k2 > k1 else raw
            if ang < 25:
                segs.append(["y", float(np.median(chunk[:, 1]))])      # runs along x: y = const
            elif ang > 65:
                segs.append(["x", float(np.median(chunk[:, 0]))])      # runs along y: x = const
            else:
                segs.append([None, 0.0])
        new_simple = [arc.simple[0]]
        for k in range(1, len(arc.simple) - 1):
            (ax1, c1), (ax2, c2) = segs[k - 1], segs[k]
            v = arc.simple[k]
            if ax1 and ax2 and ax1 != ax2:
                pos[v] = np.array([c1, c2]) if ax1 == "x" else np.array([c2, c1])
            elif ax1 and ax1 == ax2 and abs(c1 - c2) > 0.3:
                # a jog between two parallel walls: two corners joined by a short perpendicular wall
                p = pos[v]
                a = np.array([c1, p[1]]) if ax1 == "x" else np.array([p[0], c1])
                b = np.array([c2, p[1]]) if ax1 == "x" else np.array([p[0], c2])
                new_simple.append(new_vertex(a, plane.z(*a)))
                pos[v] = b
            elif ax1 and ax1 == ax2:
                continue   # collinear: drop the vertex
            elif ax1 or ax2:
                ax, c = (ax1, c1) if ax1 else (ax2, c2)
                p = pos[v]
                pos[v] = np.array([c, p[1]]) if ax == "x" else np.array([p[0], c])
            zpos[v] = float(plane.z(*pos[v]))
            new_simple.append(v)
        new_simple.append(arc.simple[-1])
        arc.simple = new_simple

    # snapping can pull an end node onto (or past) the next vertex: drop interior vertices that collapsed
    for arc in arcs:
        s = arc.simple
        if len(s) <= 2:
            continue
        kept = [s[0]]
        for v in s[1:-1]:
            if np.hypot(*(pos[v] - pos[kept[-1]])) > 0.25 and np.hypot(*(pos[v] - pos[s[-1]])) > 0.25:
                kept.append(v)
        kept.append(s[-1])
        arc.simple = kept

    # --- typed lines ---------------------------------------------------------------------------
    centroid = {}
    for r in region_plane:
        ii, jj = np.nonzero(R == r)
        centroid[r] = np.array([x0 + (ii.mean() + 0.5) * cell, y0 + (jj.mean() + 0.5) * cell])

    def length3d(p: Optional[Plane], vs) -> float:
        tot = 0.0
        for v1, v2 in zip(vs[:-1], vs[1:]):
            dz = float(p.z(*pos[v2]) - p.z(*pos[v1])) if p is not None else zpos[v2] - zpos[v1]
            tot += math.sqrt(float(np.sum((pos[v2] - pos[v1]) ** 2)) + dz * dz)
        return tot

    def edge_type(p: Plane, v1, v2, upper: bool) -> str:
        # level edges run across the slope (eave / flashing); edges running down the slope are rakes
        d = pos[v2] - pos[v1]
        g = np.array([p.a, p.b])
        dn, gn = np.hypot(*d), np.hypot(*g)
        level = p.slope_deg < 10 or dn < 1e-6 or abs(d @ g) / (dn * gn) < math.cos(math.radians(45))
        if upper:
            return "EAVE" if level else "RAKE"
        return "FLASHING" if level else "STEPFLASH"

    lines: list[dict] = []
    region_lines: dict[int, list[int]] = defaultdict(list)

    def add_runs(vs, types, plane, owner_regions):
        start = 0
        for k in range(1, len(types) + 1):
            if k == len(types) or types[k] != types[start]:
                run = vs[start:k + 1]
                lines.append({"type": types[start], "verts": run, "length_m": length3d(plane, run)})
                for r in owner_regions:
                    region_lines[r].append(len(lines) - 1)
                start = k

    for arc in arcs:
        vs = arc.simple
        if len(vs) < 2:
            continue
        if arc.ra == 0:
            p = region_plane[arc.rb]
            add_runs(vs, [edge_type(p, a, b, True) for a, b in zip(vs[:-1], vs[1:])], p, [arc.rb])
            continue
        pa, pb = region_plane[arc.ra], region_plane[arc.rb]
        raw = np.array([vxy(v) for v in arc.verts[:: max(1, len(arc.verts) // 8)]])
        gap = float(np.median(pa.z(raw[:, 0], raw[:, 1]) - pb.z(raw[:, 0], raw[:, 1])))
        if abs(gap) >= STEP_M:
            (ru, pu), (rl, pl) = ((arc.ra, pa), (arc.rb, pb)) if gap > 0 else ((arc.rb, pb), (arc.ra, pa))
            add_runs(vs, [edge_type(pu, a, b, True) for a, b in zip(vs[:-1], vs[1:])], pu, [ru])
            add_runs(vs, [edge_type(pl, a, b, False) for a, b in zip(vs[:-1], vs[1:])], pl, [rl])
            continue
        ca, cb = centroid[arc.ra], centroid[arc.rb]
        convex = float(pa.z(*cb) - pb.z(*cb)) + float(pb.z(*ca) - pa.z(*ca)) > 0
        d = np.cross(pa.normal, pb.normal)
        if np.linalg.norm(d) < math.sin(math.radians(3)):
            kind = "OTHER"
        else:
            level = math.degrees(math.atan2(abs(d[2]), math.hypot(d[0], d[1]))) < 12
            kind = ("RIDGE" if level else "HIP") if convex else "VALLEY"
        lines.append({"type": kind, "verts": vs, "length_m": length3d(None, vs)})
        region_lines[arc.ra].append(len(lines) - 1)
        region_lines[arc.rb].append(len(lines) - 1)

    # --- faces ---------------------------------------------------------------------------------
    def rings_for(r):
        own = [a for a in arcs if r in (a.ra, a.rb) and len(a.simple) >= 2]
        ends = defaultdict(list)
        for k, a in enumerate(own):
            ends[a.simple[0]].append(k)
            ends[a.simple[-1]].append(k)
        used, rings = set(), []
        for k0 in range(len(own)):
            if k0 in used:
                continue
            used.add(k0)
            ring = list(own[k0].simple)
            while ring[-1] != ring[0]:
                nxt = [k for k in ends[ring[-1]] if k not in used]
                if not nxt:
                    break
                k = nxt[0]
                used.add(k)
                s = own[k].simple
                ring += (s if s[0] == ring[-1] else s[::-1])[1:]
            if len(ring) >= 4:
                rings.append(ring[:-1] if ring[0] == ring[-1] else ring)
        return rings

    pid: dict[int, str] = {}

    def world_ft(x, y) -> dict:
        wx, wy = to_world(float(x), float(y))
        return {"x": round(wx * M_TO_FT, 3), "y": round(wy * M_TO_FT, 3)}

    def point_id(v):
        if v not in pid:
            pid[v] = f"P{len(pid) + 1}"
        return pid[v]

    faces = []
    total_ft2 = plan_ft2 = 0.0
    by_pitch: dict[int, float] = defaultdict(float)
    order = sorted(region_plane, key=lambda r: -(R == r).sum())
    for n, r in enumerate(order):
        p = region_plane[r]
        rings = rings_for(r)
        polys = [Polygon([pos[v] for v in ring]) for ring in rings]
        if not polys:
            continue
        k = int(np.argmax([abs(pg.area) for pg in polys]))
        ring, poly = rings[k], polys[k]
        if not poly.is_valid:
            poly = poly.buffer(0)
        cells_m2 = float((R == r).sum()) * cell * cell
        plan_m2 = cells_m2 if poly.is_empty else float(poly.area)
        area_ft2 = plan_m2 * p.slope_factor * M2_TO_FT2
        total_ft2 += area_ft2
        plan_ft2 += plan_m2 * M2_TO_FT2
        pitch_round = int(round(p.pitch))
        by_pitch[pitch_round] += area_ft2
        rp = poly.representative_point() if not poly.is_empty else Polygon([pos[v] for v in ring]).centroid
        faces.append({
            "id": f"F{n + 1}",
            "designator": _designator(n),
            "type": "ROOF",
            "area": round(area_ft2, 2),
            "pitch": str(pitch_round),
            "pitchExact": round(p.pitch, 2),
            "orientation": round(world_azimuth[p.id], 1),
            "lineIds": [],
            "vertices": [world_ft(*pos[v]) for v in ring],
            "centroid": world_ft(rp.x, rp.y),
            "isAccessory": False,
            "_region": r,
        })

    out_lines = {}
    line_totals: dict[str, float] = defaultdict(float)
    for k, ln in enumerate(lines):
        lid = f"L{k + 1}"
        out_lines[lid] = {"id": lid, "type": ln["type"], "ptIds": [point_id(v) for v in ln["verts"]],
                          "length": round(ln["length_m"] * M_TO_FT, 2)}
        line_totals[ln["type"]] += ln["length_m"] * M_TO_FT
    for f in faces:
        f["lineIds"] = [f"L{k + 1}" for k in dict.fromkeys(region_lines[f.pop("_region")])]
    points = {i: {**world_ft(*pos[v]), "z": round((zpos[v] - ground_z) * M_TO_FT, 3)} for v, i in pid.items()}

    predominant = max(by_pitch, key=by_pitch.get) if by_pitch else None
    return {
        "roof": {"points": points, "lines": out_lines, "faces": faces},
        "summary": {
            "total_area_sqft": round(total_ft2),
            "plan_area_sqft": round(plan_ft2),
            "squares": round(total_ft2 / 100, 2),
            "facets": len(faces),
            "predominant_pitch": predominant,
            "area_by_pitch": {str(k): round(v) for k, v in sorted(by_pitch.items())},
            "line_totals_ft": {k: round(v, 1) for k, v in sorted(line_totals.items())},
        },
    }
