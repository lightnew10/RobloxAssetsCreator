import { createHash } from 'node:crypto';

function canonical(value, decimals) {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(decimals)) : null;
  if (Array.isArray(value)) return value.map((entry) => canonical(entry, decimals));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key], decimals)]));
  return value ?? null;
}
const digest = (value, decimals) => createHash('sha256').update(JSON.stringify(canonical(value, decimals))).digest('hex');
const definitionValue = (definition) => definition?.params ? { archetype: definition.archetype, params: definition.params }
  : definition?.primitives ? { primitives: definition.primitives }
    : definition?.parts ? { parts: definition.parts } : null;
const geometryValue = (geometry) => (geometry?.parts || []).map((part) => ({
  name: part.name, componentId: part.componentId, shape: part.shape, size: part.size,
  position: part.position, rotation: part.rotation, color: part.color,
  material: part.material, canCollide: part.canCollide,
}));

export function definitionFingerprint(definition) { return definitionValue(definition) ? digest(definitionValue(definition), 4) : null; }
export function geometryFingerprint(geometry) { return geometry?.parts ? digest(geometryValue(geometry), 3) : null; }

function collectChanges(before, after, prefix, changes) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort()) collectChanges(before[key], after[key], prefix ? `${prefix}.${key}` : key, changes);
  } else changes.push(prefix);
}
function pathsFor(definition) {
  if (definition?.params) return { params: definition.params };
  if (definition?.parts) return { parts: Object.fromEntries(definition.parts.map((part) => [part.id || part.name, part])) };
  if (definition?.primitives) return { parts: Object.fromEntries(definition.primitives.components.flatMap((component) => component.primitives.map((primitive) => [`${component.componentId}.${primitive.id || primitive.name}`, primitive]))) };
  return {};
}
export function compareVersions(before, after) {
  const definitionChanged = definitionFingerprint(before?.geometryDefinition) !== definitionFingerprint(after?.geometryDefinition);
  const geometryChanged = geometryFingerprint(before?.geometry) !== geometryFingerprint(after?.geometry);
  const changedFields = [];
  collectChanges(canonical(pathsFor(before?.geometryDefinition), 4), canonical(pathsFor(after?.geometryDefinition), 4), '', changedFields);
  return { changed: definitionChanged && geometryChanged, definitionChanged, geometryChanged, changedFields };
}
