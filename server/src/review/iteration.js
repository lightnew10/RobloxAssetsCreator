import { applyOneChange, keepCorrection, normalizeReview, planCorrections, shouldStop } from './defects.js';

// Pure orchestration seam: one parameter change per review, with the remaining
// defects preserved as instructions for the next plan.
export async function runDefectIteration({ review, history = [], archetypeId, schema, params, generate }) {
  const before = normalizeReview(review);
  const planned = planCorrections(before.defects, archetypeId, schema);
  const change = planned.changes[0] || null;
  if (!change) return { planned, change: null, keep: null, stop: shouldStop([...history, before]) };
  const afterReview = await generate(applyOneChange(params, change), change);
  const after = normalizeReview(afterReview);
  const keep = keepCorrection(before, after);
  return { planned, change, after, keep, stop: shouldStop([...history, before, after]) };
}
