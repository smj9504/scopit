/**
 * PDFs with the 3D view in them: an option's own PDF, and the customer
 * proposal with every estimate of the job. The pictures are drawn in the
 * browser (bathroom3dSnapshot, loaded on demand with three.js) and sent with
 * the request. The restoration's PDF — the carrier's — never gets one.
 */

import { bathroomEstimateService } from '@/services/bathroomEstimateService';
import type { BathroomEstimate } from '@/types/bathroomEstimate';

async function snapshots(
  estimates: Pick<BathroomEstimate, 'id' | 'sketch_data'>[],
  size: { width: number; height: number },
): Promise<Record<string, string>> {
  try {
    const { renderBathroomSnapshots } = await import('./sketch/bathroom3dSnapshot');
    return await renderBathroomSnapshots(
      estimates.map((e) => ({ key: e.id, sketch: e.sketch_data as any, estimate: e })),
      size,
    );
  } catch {
    // No WebGL, or three.js failed to load: the PDF goes without the picture
    return {};
  }
}

/** The 3D picture for an option's PDF; none for the restoration or the current layout. */
export async function optionRender(estimate?: BathroomEstimate | null): Promise<string | undefined> {
  if (!estimate || estimate.kind !== 'option') return undefined;
  const pictures = await snapshots([estimate], { width: 1400, height: 820 });
  return pictures[estimate.id];
}

/** The customer proposal for the job of `estimateId`, each estimate pictured in 3D. */
export async function exportProposalWith3D(estimateId: string, address?: string) {
  const group = await bathroomEstimateService.getGroup(estimateId);
  const priced = group.members.filter((m) => m.kind === 'restore' || m.kind === 'option');
  const renders = await snapshots(priced, { width: 900, height: 600 });
  await bathroomEstimateService.exportProposalPdf(estimateId, { address, renders });
}
