import { randomUUID } from 'node:crypto';
import { traceArtifact, traceEvent } from './trace.js';

function family(code = '', details = []) {
  const upper = String(code).toUpperCase();
  const detailCodes = (Array.isArray(details) ? details : [details]).map((x) => String(x?.code || '').toLowerCase());
  if (upper.includes('SPATIAL') || detailCodes.some((x) => ['missing_parent','ambiguous_parent','self_parent','parent_cycle'].includes(x))) return 'spatial_structure';
  if (upper.includes('JSON') || upper.includes('SCHEMA')) return 'structured_output';
  if (upper.includes('MCP') || upper.includes('STUDIO')) return 'studio';
  if (upper.includes('CAPTURE')) return 'capture';
  if (upper.includes('TIMEOUT')) return 'timeout';
  if (upper.includes('GEOMETRY')) return 'geometry';
  return 'unknown';
}
function signature(context) {
  const details = Array.isArray(context.details) ? context.details : context.details ? [context.details] : [];
  const causes = [...new Set(details.map((x) => x?.code).filter(Boolean))].sort().join('+') || 'none';
  return [context.stage || 'unknown', context.code || 'unknown', causes, context.variantId || 'job'].join('|');
}
export function ensureRecovery(job) {
  job.recovery ||= { lastSignature: null, consecutive: {}, incidents: [] };
  return job.recovery;
}
export function recordIncident(job, context = {}) {
  const state = ensureRecovery(job);
  const sig = signature(context);
  const attempt = state.lastSignature === sig ? Math.min(3, (state.consecutive[sig] || 0) + 1) : 1;
  state.lastSignature = sig;
  state.consecutive[sig] = attempt;
  const kind = family(context.code, context.details);
  const action = attempt >= 3 ? 'stop' : kind === 'spatial_structure' && attempt === 1 ? 'repair_then_retry' : kind === 'spatial_structure' ? 'targeted_replan' : attempt === 1 ? 'retry' : 'switch_strategy';
  const incident = {
    id: randomUUID(), at: new Date().toISOString(), stage: context.stage || null, variantId: context.variantId || null,
    code: context.code || null, message: context.message || null, family: kind, signature: sig, attempt, action,
    details: context.details || null, recovered: false, circuitBreaker: attempt >= 3,
  };
  state.incidents.push(incident);
  return incident;
}
export function markRecovered(job, incident) {
  if (!incident) return;
  const state = ensureRecovery(job);
  const target = state.incidents.find((x) => x.id === incident.id);
  if (!target) return;
  target.recovered = true;
  target.resolvedAt = new Date().toISOString();
  state.consecutive[target.signature] = 0;
  if (state.lastSignature === target.signature) state.lastSignature = null;
}
export async function traceIncident(job, incident) {
  const artifact = await traceArtifact(job.id, 'incidents', 'incident_' + incident.attempt, incident, { phase: incident.stage, variantId: incident.variantId });
  await traceEvent(job.id, incident.circuitBreaker ? 'RECOVERY_STOP' : 'RECOVERY_INCIDENT', { ...incident, artifactId: artifact?.id }, { phase: incident.stage, variantId: incident.variantId });
}
