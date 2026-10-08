import rules from '../review/defectRules.json' with { type: 'json' };
import aliases from './feedbackAliases.json' with { type: 'json' };

const vocabulary = new Set(Object.values(rules.vocabulary).flat());
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export function feedbackType({ issues = [], text = '' } = {}) {
  const selected = issues.find((issue) => vocabulary.has(issue));
  if (selected) return selected;
  const normalized = normalize(text);
  const alias = aliases.find((entry) => vocabulary.has(entry.type) && new RegExp(entry.pattern).test(normalized));
  if (alias) return alias.type;
  const count = normalized.match(/(?:pas assez|trop peu) de ([a-z][a-z0-9_-]{2,30})/);
  return count ? `too_few_${count[1]}` : normalized.slice(0, 160) || 'unspecified';
}
