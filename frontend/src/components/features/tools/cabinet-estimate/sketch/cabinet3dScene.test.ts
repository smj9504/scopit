import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cabinetSolids, type Pt2 } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dModel';
import { buildCabinetScene, crownBand } from '@/components/features/tools/cabinet-estimate/sketch/cabinet3dScene';
import { reconcileCabinets, type PresetCatalog } from '@/components/features/tools/cabinet-estimate/sketch/cabinetSketchLayout';
import { CROWN_BANDS } from '@/components/features/tools/cabinet-estimate/sketch/cabinetFronts';

const SCALE = 20; // px per foot
const PRESETS: PresetCatalog = {
  WDC24: { width: 24, height: 30, specialty: 'diagonal_corner_wall' },
};
const OUT = 2.75;
const MITER = OUT * (Math.SQRT2 - 1); // how far a 45° crown's miter reaches past the joint

const close = (pts: Pt2[], expected: Pt2[]) => {
  expect(pts).toHaveLength(expected.length);
  pts.forEach(([x, z], i) => {
    expect(x).toBeCloseTo(expected[i][0]);
    expect(z).toBeCloseTo(expected[i][1]);
  });
};

describe('crownBand', () => {
  it('leaves a square joint where the next cabinet\'s crown carries straight on', () => {
    const box: Pt2[] = [[0, 0], [30, 0], [30, 12], [0, 12]];
    close(crownBand(box, ['flush', 'joint', 'out', 'out'], OUT), [[-OUT, 0], [30, 0], [30, 12 + OUT], [-OUT, 12 + OUT]]);
  });

  it('carries a diagonal corner\'s angled crown on to the miter with each neighbour\'s', () => {
    // Back, run end (joint), angled face, leg end (joint), leg back.
    const wdc: Pt2[] = [[0, 0], [24, 0], [24, 12], [12, 24], [0, 24]];
    close(crownBand(wdc, ['flush', 'joint', 'out', 'joint', 'flush'], OUT), [
      [0, 0],
      [24, 0],
      [24, 12 + OUT], // in line with the next upper's crown front…
      [24 + MITER, 12 + OUT], // …to the miter
      [12 + OUT, 24 + MITER],
      [12 + OUT, 24],
      [0, 24],
    ]);
  });

  it('mitres an angle end\'s cut into the crown of the run it ends', () => {
    // Back, 45° cut, the full-depth end joining the run.
    const wea: Pt2[] = [[0, 0], [12, 0], [0, 12]];
    close(crownBand(wea, ['flush', 'out', 'joint'], OUT), [
      [0, 0],
      [12 + OUT * Math.SQRT2, 0], // the cut runs on to the wall
      [MITER, 12 + OUT],
      [0, 12 + OUT],
    ]);
  });
});

describe('crown molding in the scene', () => {
  it('stops flush at both backs of a diagonal corner, with no wall drawn behind either', () => {
    const [shape] = reconcileCabinets(
      [],
      [{ code: 'WDC24', cab_type: 'wall', location: 'perimeter', width_inches: 24, height_inches: 30, specialty_type: 'diagonal_corner_wall', qty: 1 }],
      [],
      PRESETS,
      SCALE
    )!;
    const [solid] = cabinetSolids([shape], PRESETS, SCALE);
    const root = buildCabinetScene([solid], [], new Set(), { crown: true });
    root.updateMatrixWorld(true);
    const group = root.children.find((c) => c.userData.cabinetId === solid.cabinet.id)!;
    const top = solid.bottom + solid.height;
    const crowns = group.children.filter(
      (m): m is THREE.Mesh => m instanceof THREE.Mesh && new THREE.Box3().setFromObject(m).min.y >= top - 0.01
    );
    expect(crowns).toHaveLength(CROWN_BANDS.length);
    for (const crown of crowns) {
      const box = new THREE.Box3().setFromObject(crown);
      expect(box.min.x).toBeCloseTo(solid.x); // the side leg's back
      expect(box.min.z).toBeCloseTo(solid.z); // its own back
    }
  });
});
