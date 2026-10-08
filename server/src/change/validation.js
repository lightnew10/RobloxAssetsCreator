export function validatedCorrectionFeedback(job) {
  const approved = new Set((job?.variants || []).filter((variant) => variant.correctionStatus === 'resolved' && variant.correctionValidated === true)
    .map((variant) => variant.correctionRequest?.id).filter(Boolean));
  return (job?.feedback || []).filter((entry) => entry?.source !== 'auto_review' && approved.has(entry.id));
}
export function correctionEligibleForLearning(variant) {
  if (['no_effect','unsupported'].includes(variant?.correctionStatus)) return false;
  if (variant?.correctionOf || variant?.rebuildOf && variant?.correctionRequest)
    return variant.correctionStatus === 'resolved' && variant.correctionValidated === true;
  return true;
}
