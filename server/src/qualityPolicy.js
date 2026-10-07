const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export const DEFAULT_ASSET_QUALITY_POLICY = Object.freeze({
  humanReviewMinScore: 5,
  autoAcceptScore: 8,
  catastrophicSubscoreMin: 3,
  essentialReviewMinScore: 5,
  essentialAcceptMinScore: 8,
  initialVariants: 3,
  maxPatchesPerCandidate: 2,
  maxRebuildsPerObject: 2,
  maxAttemptsPerObject: 9,
});

export function normalizeAssetQualityPolicy(policy = {}) {
  const merged = { ...DEFAULT_ASSET_QUALITY_POLICY, ...policy };
  return {
    humanReviewMinScore: Math.max(0, Math.min(10, finite(merged.humanReviewMinScore, 5))),
    autoAcceptScore: Math.max(0, Math.min(10, finite(merged.autoAcceptScore, 8))),
    catastrophicSubscoreMin: Math.max(0, Math.min(10, finite(merged.catastrophicSubscoreMin, 3))),
    essentialReviewMinScore: Math.max(0, Math.min(10, finite(merged.essentialReviewMinScore, 5))),
    essentialAcceptMinScore: Math.max(0, Math.min(10, finite(merged.essentialAcceptMinScore, 8))),
    initialVariants: Math.max(1, Math.floor(finite(merged.initialVariants, 3))),
    maxPatchesPerCandidate: Math.max(0, Math.floor(finite(merged.maxPatchesPerCandidate, 2))),
    maxRebuildsPerObject: Math.max(0, Math.floor(finite(merged.maxRebuildsPerObject, 2))),
    maxAttemptsPerObject: Math.max(0, Math.floor(finite(merged.maxAttemptsPerObject, 9))),
  };
}

function essentialScores(review) {
  return Array.isArray(review?.criteria)
    ? review.criteria.filter((item) => item?.essential).map((item) => finite(item.score, 0))
    : [];
}

function catastrophicSubscores(review, policy) {
  return ['silhouetteScore', 'proportionScore', 'placementScore']
    .flatMap((key) => Number.isFinite(Number(review?.[key])) && Number(review[key]) < policy.catastrophicSubscoreMin ? [{ key, score: Number(review[key]) }] : []);
}

export function reviewEligibility(review, policy = {}) {
  const config = normalizeAssetQualityPolicy(policy);
  const score = finite(review?.score, -1);
  const essentials = essentialScores(review);
  const catastrophic = catastrophicSubscores(review, config);
  const technicalPassed = review?.technicalPassed === true;
  const rebuild = review?.decision === 'rebuild';
  const essentialReviewPassed = essentials.length > 0 && essentials.every((value) => value >= config.essentialReviewMinScore);
  const essentialAcceptPassed = essentials.length > 0 && essentials.every((value) => value >= config.essentialAcceptMinScore);
  const reviewable = technicalPassed
    && score >= config.humanReviewMinScore
    && !rebuild
    && catastrophic.length === 0
    && essentialReviewPassed;
  const accepted = reviewable
    && score >= config.autoAcceptScore
    && (review?.decision == null || review.decision === 'accept')
    && essentialAcceptPassed;
  const reasons = [];
  if (!technicalPassed) reasons.push('technical_failed');
  if (score < config.humanReviewMinScore) reasons.push('score_below_review_gate');
  if (rebuild) reasons.push('rebuild_requested');
  if (catastrophic.length) reasons.push(...catastrophic.map((item) => `catastrophic_${item.key}`));
  if (!essentialReviewPassed) reasons.push('essential_criteria_below_review_gate');
  return { reviewable, accepted, reasons, score, catastrophic };
}

export function rankQualityVariant(variants = [], policy = {}) {
  return [...variants].filter((item) => item?.review).sort((left, right) => {
    const leftGate = reviewEligibility(left.review, policy);
    const rightGate = reviewEligibility(right.review, policy);
    return Number(rightGate.accepted) - Number(leftGate.accepted)
      || Number(rightGate.reviewable) - Number(leftGate.reviewable)
      || Number(right.review.technicalPassed === true) - Number(left.review.technicalPassed === true)
      || finite(right.review.score, -1) - finite(left.review.score, -1);
  })[0] || null;
}

export function qualityBatchDecision(variants = [], options = {}) {
  const policy = normalizeAssetQualityPolicy(options.policy || options);
  const planVersion = options.planVersion ?? null;
  const scope = planVersion == null ? variants : variants.filter((entry) => entry.planVersion === planVersion);
  const initial = scope.filter((entry) => !entry.correctionOf);
  const corrections = scope.filter((entry) => entry.correctionOf);
  const evaluated = scope.filter((entry) => entry.review);
  const best = rankQualityVariant(evaluated, policy);
  const gate = reviewEligibility(best?.review, policy);
  const initialComplete = initial.length >= policy.initialVariants
    && initial.every((entry) => ['done', 'failed', 'skipped'].includes(entry.status));
  const attemptsUsed = Number.isFinite(Number(options.attemptsUsed)) ? Number(options.attemptsUsed) : variants.length;
  const rebuildsUsed = Number.isFinite(Number(options.rebuildsUsed)) ? Number(options.rebuildsUsed) : 0;
  const patchesUsed = Number.isFinite(Number(options.patchesUsed)) ? Number(options.patchesUsed) : corrections.length;
  const budgetAvailable = policy.maxAttemptsPerObject === 0 || attemptsUsed < policy.maxAttemptsPerObject;
  const rebuildRequested = best?.review?.decision === 'rebuild';
  const patchable = options.patchable !== false && Boolean(best);
  const patchRequested = !rebuildRequested && Boolean(best) && (best.review.decision === 'patch' || !gate.accepted);

  const needsRebuild = initialComplete && !gate.accepted && rebuildRequested
    && rebuildsUsed < policy.maxRebuildsPerObject && budgetAvailable;
  const needsCorrection = initialComplete && !gate.accepted && !rebuildRequested && patchRequested && patchable
    && patchesUsed < policy.maxPatchesPerCandidate && budgetAvailable;
  const needsRegenerate = initialComplete && !gate.accepted && !needsRebuild && !needsCorrection
    && budgetAvailable;

  const terminal = initialComplete && !needsRebuild && !needsCorrection && !needsRegenerate;
  const accepted = initialComplete && gate.accepted;
  let state = 'improving';
  if (accepted) state = 'accepted';
  else if (terminal && gate.reviewable) state = 'review_ready';
  else if (terminal) state = 'quality_failed';

  return {
    finished: accepted || terminal,
    state,
    accepted,
    reviewable: gate.reviewable,
    bestVariantId: best?.id || null,
    initialComplete,
    needsCorrection,
    needsRebuild,
    needsRegenerate,
    attemptsUsed,
    rebuildsUsed,
    patchesUsed,
    planVersion,
    attemptBudgetExhausted: policy.maxAttemptsPerObject > 0 && attemptsUsed >= policy.maxAttemptsPerObject,
    gateReasons: gate.reasons,
  };
}


export function classifyBestQuality(variants = [], policy = {}) {
  const best = rankQualityVariant(variants, policy);
  const gate = reviewEligibility(best?.review, policy);
  return {
    best,
    bestVariantId: best?.id || null,
    bestScore: best?.review?.score ?? null,
    qualityStatus: gate.accepted ? 'accepted' : gate.reviewable ? 'review_ready' : 'quality_failed',
    reviewable: gate.reviewable,
    accepted: gate.accepted,
    gateReasons: gate.reasons,
  };
}
