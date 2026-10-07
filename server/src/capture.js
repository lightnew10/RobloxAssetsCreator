import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { executeStudioTool } from './studioBridge.js';
import { traceArtifact, traceEvent } from './trace.js';

function cameraFor(variant, view) {
  const centerX = Number(variant.bounds?.centerX) || 0;
  const centerY = Number(variant.bounds?.centerY) || Math.max(2, Number(variant.bounds?.size?.[1]) / 2 || 5);
  const centerZ = Number(variant.bounds?.centerZ) || 0;
  const size = variant.bounds?.size || [10,10,10];
  const extent = Math.max(4, ...size.map((x) => Number(x) || 0));
  const d = Math.min(160, Math.max(12, extent * 2.4));
  if (view === 1) return { camera_position: [centerX + d, centerY + d * 0.12, centerZ + d * 0.18], look_at_position: [centerX,centerY,centerZ] };
  if (view === 2) return { camera_position: [centerX + d * 0.2, centerY + d * 1.3, centerZ + d * 0.3], look_at_position: [centerX,centerY,centerZ] };
  return { camera_position: [centerX + d * 0.35, centerY + d * 0.12, centerZ + d], look_at_position: [centerX,centerY,centerZ] };
}

export async function captureVariant(job, variant, view) {
  const camera = cameraFor(variant, view);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await executeStudioTool('screen_capture', {
      studio_id: job.studioId,
      capture_id: 'RAC_' + variant.id.slice(0, 8) + '_' + view + '_' + attempt,
      ...camera,
    }, { runId: job.id, variantId: variant.id, phase: 'capture', attempt: attempt + 1 });
    const image = result?.content?.find((item) => item.type === 'image' && item.data && /^image\/(png|jpeg)$/.test(item.mimeType || ''));
    if (image?.data) {
      const bytes = Buffer.from(image.data, 'base64');
      if (bytes.length > 8000) {
        const ext = image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
        const dir = path.join(config.capturesRoot, job.id);
        await mkdir(dir, { recursive: true });
        const fileName = variant.id + '-' + view + '.' + ext;
        await writeFile(path.join(dir, fileName), bytes);
        const artifact = await traceArtifact(job.id, 'captures', 'view_' + view, bytes, { variantId: variant.id, phase: 'capture', mimeType: image.mimeType, extension: ext });
        await traceEvent(job.id, 'CAPTURE_CREATED', { view, fileName, artifactId: artifact?.id, camera }, { variantId: variant.id, phase: 'capture' });
        return { fileName, mimeType: image.mimeType, data: image.data, view, camera };
      }
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw Object.assign(new Error('Capture Studio indisponible après 3 essais.'), { code: 'CAPTURE_UNAVAILABLE' });
}

export async function captureThreeViews(job, variant) {
  const images = [];
  for (let view = 0; view < 3; view += 1) images.push(await captureVariant(job, variant, view));
  return images;
}

export function capturePath(jobId, fileName) {
  if (!/^[a-f0-9-]+-\d+\.(png|jpg)$/i.test(fileName)) return null;
  return path.join(config.capturesRoot, jobId, fileName);
}
