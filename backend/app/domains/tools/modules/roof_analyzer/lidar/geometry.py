"""Small shared geometry helpers (no network imports, so the roof model is testable offline)."""
import numpy as np
from scipy.spatial import cKDTree

M2_TO_FT2 = 10.7639
M_TO_FT = 3.28084


def local_normals(P: np.ndarray, k: int = 16):
    """PCA normal (pointing up), surface variation and the KD-tree, for every point."""
    tree = cKDTree(P)
    _, nb = tree.query(P, k=min(k, len(P)))
    Q = P[nb] - P[nb].mean(axis=1, keepdims=True)
    C = np.einsum("nki,nkj->nij", Q, Q) / Q.shape[1]
    w, v = np.linalg.eigh(C)
    n = v[:, :, 0].copy()
    n[n[:, 2] < 0] *= -1
    curv = w[:, 0] / np.maximum(w.sum(axis=1), 1e-12)
    return n, curv, tree
