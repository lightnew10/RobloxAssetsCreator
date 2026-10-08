import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import { archetypes } from '../archetypes/index.js';
import { primitiveSpecSchema } from '../primitives.js';

const mutablePrimitiveFields = new Set(Object.keys(primitiveSpecSchema.properties).filter((key) => !['id', 'groupId'].includes(key)));
const mutablePartFields = new Set(['name', 'shape', 'size', 'position', 'rotation', 'color', 'material', 'canCollide']);
const copy = (value) => structuredClone(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const validatePrimitive = new Ajv({ strict: false }).compile(primitiveSpecSchema);
const clamp = (value, spec) => spec?.type === 'integer' ? Math.round(Math.min(spec.maximum ?? Infinity, Math.max(spec.minimum ?? -Infinity, value)))
  : Math.min(spec?.maximum ?? Infinity, Math.max(spec?.minimum ?? -Infinity, value));

export const patchSchema = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['target', 'ops', 'reason'], properties: {
      target: { type: 'string', enum: ['params', 'parts'] },
      ops: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['op', 'path'], properties: {
        op: { type: 'string', enum: ['set', 'scale', 'add', 'remove'] }, path: { type: 'string', maxLength: 180 }, value: {},
      } } }, reason: { type: 'string', maxLength: 500 },
    } },
    { type: 'object', additionalProperties: false, required: ['target', 'unsupported'], properties: { target: { type: 'null' }, unsupported: { type: 'string', maxLength: 500 } } },
  ],
};

export function ensurePrimitiveIds(definition, { force = false } = {}) {
  const next = copy(definition);
  const seen = new Set();
  if (next?.primitives?.components) for (const component of next.primitives.components) for (const primitive of component.primitives) {
    if (force || !primitive.id || seen.has(primitive.id)) primitive.id = randomUUID();
    seen.add(primitive.id);
  }
  if (next?.parts) for (const part of next.parts) {
    if (force || !part.id || seen.has(part.id)) part.id = randomUUID();
    seen.add(part.id);
  }
  return next;
}

export function definitionForVariant(variant) {
  const definition = variant?.geometryDefinition;
  if (definition?.params && archetypes[definition.archetype]) return { ...copy(definition), params: { ...copy(archetypes[definition.archetype].defaults), ...copy(definition.params) } };
  if (definition?.primitives) return ensurePrimitiveIds(definition);
  if (definition?.parts) return ensurePrimitiveIds(definition);
  if (variant?.geometry?.parts?.length) return ensurePrimitiveIds({ parts: variant.geometry.parts.map((part) => copy(part)), version: 'legacy_parts_v1' });
  return null;
}

function validValue(value, spec) {
  if (!spec) return false;
  if (spec.type === 'number' || spec.type === 'integer') return finite(value);
  if (spec.type === 'boolean') return typeof value === 'boolean';
  if (spec.type === 'string') return typeof value === 'string' && (!spec.enum || spec.enum.includes(value)) && (!spec.maxLength || value.length <= spec.maxLength);
  if (spec.type === 'array') return Array.isArray(value) && value.length >= (spec.minItems || 0) && value.length <= (spec.maxItems || Infinity) && value.every((item) => validValue(item, spec.items));
  return false;
}
function boundedValue(value, spec) {
  if (spec.type === 'array') return value.map((item) => boundedValue(item, spec.items));
  return ['number', 'integer'].includes(spec.type) ? clamp(value, spec) : value;
}
function partSpec(definition, field) {
  return definition.primitives ? primitiveSpecSchema.properties[field] : {
    name: { type: 'string', maxLength: 64 }, shape: { type: 'string', enum: ['box', 'cylinder', 'ball', 'wedge'] },
    size: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: 0.08, maximum: 200 } },
    position: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: -500, maximum: 500 } },
    rotation: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number', minimum: -360, maximum: 360 } },
    color: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer', minimum: 0, maximum: 255 } },
    material: { type: 'string' }, canCollide: { type: 'boolean' },
  }[field];
}

export function applyPatch(definition, patch, schema = null) {
  const next = ensurePrimitiveIds(definition);
  const applied = [], rejected = [];
  if (patch?.target === null) return { definition: next, applied, rejected, unsupported: String(patch.unsupported || 'Retour non supporté.') };
  for (const op of patch?.ops || []) {
    const refuse = (reason) => rejected.push({ ...op, reason });
    if (patch.target === 'params') {
      const properties = schema?.properties || archetypes[next.archetype]?.schema.properties || {};
      const spec = properties[op.path];
      if (!next.params || !spec || !Object.hasOwn(next.params, op.path)) { refuse('unknown_path'); continue; }
      if (!['set', 'scale', 'add'].includes(op.op)) { refuse('invalid_operation'); continue; }
      if (op.op !== 'set' && (!finite(op.value) || !finite(next.params[op.path]))) { refuse('invalid_value'); continue; }
      const raw = op.op === 'set' ? op.value : op.op === 'scale' ? next.params[op.path] * op.value : next.params[op.path] + op.value;
      if (!validValue(raw, spec)) { refuse('invalid_value'); continue; }
      const value = boundedValue(raw, spec);
      if (JSON.stringify(value) === JSON.stringify(next.params[op.path])) { refuse('no_effect'); continue; }
      next.params[op.path] = value; applied.push({ ...op, value });
      continue;
    }
    if (patch.target !== 'parts') { refuse('invalid_target'); continue; }
    const [componentId, primitiveId, field, index] = String(op.path || '').split('.');
    const component = next.primitives?.components?.find((entry) => entry.componentId === componentId);
    const entries = component?.primitives || next.parts?.filter((part) => part.componentId === componentId);
    if (!entries) { refuse('unknown_component'); continue; }
    if (op.op === 'add' && primitiveId === '$new' && !field) {
      if (!op.value || typeof op.value !== 'object' || Array.isArray(op.value)) { refuse('invalid_value'); continue; }
      const candidate = { ...copy(op.value), id: randomUUID() };
      const allowed = next.primitives ? mutablePrimitiveFields : mutablePartFields;
      const legacyRequired = ['name', 'shape', 'size', 'position', 'rotation', 'color', 'material', 'canCollide'];
      if (Object.keys(candidate).some((key) => key !== 'id' && key !== 'componentId' && !allowed.has(key)) || (next.primitives && !validatePrimitive(candidate)) || (!next.primitives && (candidate.componentId !== componentId || legacyRequired.some((key) => !validValue(candidate[key], partSpec(next, key)))))) { refuse('invalid_value'); continue; }
      if (entries.length >= (next.primitives ? 10 : 180)) { refuse('parts_limit'); continue; }
      entries.push(candidate); applied.push({ ...op, path: `${componentId}.${candidate.id}` }); continue;
    }
    const part = entries.find((entry) => entry.id === primitiveId);
    if (!part) { refuse('unknown_primitive'); continue; }
    if (op.op === 'remove' && !field) {
      if (entries.length <= 1) { refuse('last_primitive'); continue; }
      if (next.primitives) component.primitives = entries.filter((entry) => entry.id !== primitiveId);
      else next.parts = next.parts.filter((entry) => entry.id !== primitiveId);
      applied.push(op); continue;
    }
    if (!field || !(next.primitives ? mutablePrimitiveFields : mutablePartFields).has(field)) { refuse('unknown_path'); continue; }
    const spec = partSpec(next, field);
    if (!spec) { refuse('unknown_path'); continue; }
    const current = index === undefined ? part[field] : part[field]?.[Number(index)];
    const leafSpec = index === undefined ? spec : spec.type === 'array' && /^\d+$/.test(index) && Number(index) < part[field]?.length ? spec.items : null;
    if (!leafSpec) { refuse('unknown_path'); continue; }
    if (op.op !== 'set' && op.op !== 'scale' && op.op !== 'add') { refuse('invalid_operation'); continue; }
    let value = op.value;
    if (op.op !== 'set') {
      if (!finite(current) || !finite(value)) { refuse('invalid_value'); continue; }
      value = op.op === 'scale' ? current * value : current + value;
    }
    if (!validValue(value, leafSpec)) { refuse('invalid_value'); continue; }
    value = boundedValue(value, leafSpec);
    if (JSON.stringify(current) === JSON.stringify(value)) { refuse('no_effect'); continue; }
    if (index === undefined) part[field] = value; else part[field][Number(index)] = value;
    applied.push({ ...op, value });
  }
  return { definition: next, applied, rejected, unsupported: null };
}
