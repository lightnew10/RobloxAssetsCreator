import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8'));
const rules = load('./defectRules.json');
const roles = load('./paramRoles.json');
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
export const ALLOWED_ISSUES = new Set(Object.values(rules.vocabulary).flat());

// Ramène une revue IA au vocabulaire fermé. Un défaut inconnu n'est jamais accepté tel quel.
export function normalizeReview(review) {
  const problems = Array.isArray(review?.problems) ? review.problems : [];
  return {
    score: Number(review?.score) || 0,
    defects: problems.map((p) => {
      const issue = String(p?.issue || '').trim();
      const known = ALLOWED_ISSUES.has(issue);
      return {
        component: String(p?.component || 'unknown').slice(0, 64),
        issue: known ? issue : 'unknown_issue',
        rawIssue: issue.slice(0, 120),
        severity: SEVERITIES.includes(p?.severity) ? p.severity : 'medium',
        status: known ? 'valid' : 'rejected_vocabulary',
      };
    }),
  };
}

// Trouve le paramètre qui porte un rôle donné pour un archétype, en lisant ses bornes dans le schéma.
function paramForRole(archetypeId, role, schema) {
  const declared = roles.archetypes[archetypeId] || {};
  const key = Object.keys(declared).find((k) => declared[k] === role && schema.properties?.[k]);
  if (!key) return null;
  const spec = schema.properties[key];
  return { key, min: spec.minimum, max: spec.maximum, integer: spec.type === 'integer' };
}

// Décide, pour chaque défaut valide, de l'action : modifier un paramètre, demander une réécriture
// ciblée au décomposeur (instruct), ou reconstruire (rebuild). Aucune règle ne dépend de l'objet.
export function planCorrections(defects, archetypeId, schema) {
  const changes = [], instructions = [], rebuilds = [], missing = [];
  for (const d of defects.filter((x) => x.status === 'valid')) {
    const rule = rules.rules[d.issue];
    if (!rule) { missing.push({ issue: d.issue, reason: 'no_rule' }); continue; }
    if (rule.action === 'rebuild') { rebuilds.push(d); continue; }
    if (rule.action === 'instruct') { instructions.push({ issue: d.issue, component: d.component }); continue; }
    const p = schema ? paramForRole(archetypeId, rule.role, schema) : null;
    if (!p) { missing.push({ issue: d.issue, component: d.component, reason: 'needs_param_role', role: rule.role }); instructions.push({ issue: d.issue, component: d.component }); continue; }
    changes.push({ issue: d.issue, param: p.key, direction: rule.direction, step: rule.ratio * (p.max - p.min), integer: p.integer, min: p.min, max: p.max });
  }
  return { changes, instructions, rebuilds, missing };
}

// Une seule correction à la fois, bornée par le schéma du paramètre.
export function applyOneChange(params, change) {
  const sign = change.direction === 'increase' ? 1 : -1;
  const raw = (Number(params[change.param]) || 0) + sign * change.step;
  const next = Math.min(change.max, Math.max(change.min, raw));
  return { ...params, [change.param]: change.integer ? Math.max(change.min, Math.round(next)) : Number(next.toFixed(4)) };
}

// Garde une correction seulement si elle améliore la note sans créer de défaut grave nouveau.
export function keepCorrection(before, after, minGain = 0.5) {
  const newSerious = after.defects.filter((d) => d.status === 'valid' && ['high', 'critical'].includes(d.severity)
    && !before.defects.some((b) => b.issue === d.issue && b.component === d.component));
  const gain = after.score - before.score;
  if (newSerious.length) return { keep: false, reason: 'new_serious_defect', gain };
  if (gain < minGain) return { keep: false, reason: 'insufficient_gain', gain };
  return { keep: true, reason: 'improved', gain };
}

// Arrêt : accepté à 8 sans défaut grave, ou stagnation sur trois versions consécutives.
export function shouldStop(history, { acceptScore = 8, minGain = 0.5 } = {}) {
  const last = history[history.length - 1];
  if (!last) return { stop: false };
  if (last.score >= acceptScore && !last.defects.some((d) => d.status === 'valid' && ['high', 'critical'].includes(d.severity))) {
    return { stop: true, reason: 'accepted' };
  }
  if (history.length >= 3) {
    const [a, b, c] = history.slice(-3);
    if (b.score - a.score < minGain && c.score - b.score < minGain) return { stop: true, reason: 'stagnation' };
  }
  return { stop: false };
}
