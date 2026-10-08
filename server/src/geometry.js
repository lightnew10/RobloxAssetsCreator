import { proceduralGeometrySchema } from './archetypes/index.js';
import { createHash } from 'node:crypto';

export const legacyGeometrySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['parts'],
  properties: {
    parts: {
      type: 'array', minItems: 1, maxItems: 180,
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'componentId', 'shape', 'size', 'position', 'rotation', 'color', 'material', 'canCollide'],
        properties: {
          name: { type: 'string' },
          componentId: { type: 'string' },
          shape: { type: 'string', enum: ['box', 'cylinder', 'ball', 'wedge'] },
          size: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          position: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          rotation: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
          color: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'integer' } },
          material: { type: 'string' },
          canCollide: { type: 'boolean' },
        },
      },
    },
  },
};


// Keep the old Parts contract for backward compatibility while preferring compact parameters.
export const geometrySchema={oneOf:[proceduralGeometrySchema,legacyGeometrySchema]};

export const variationProfiles = [
  { id: 'balanced', label: 'Équilibrée', instruction: 'Respect maximal du brief avec proportions naturelles et détails modérés.', ranges: {height:[.95,1.05],curvature:[.8,1.2],length:[.95,1.05]} },
  { id: 'silhouette', label: 'Silhouette', instruction: 'Accentue la silhouette, les asymétries et les masses principales sans changer le type.', ranges: {height:[1.08,1.18],curvature:[1.4,1.8],length:[1.15,1.3]} },
  { id: 'detail', label: 'Détaillée', instruction: 'Ajoute des subdivisions et détails secondaires tout en gardant les mêmes proportions globales.', ranges: {segments:[1.35,1.55],count:[1.2,1.4]} },
  { id: 'compact', label: 'Compacte', instruction: 'Variation légèrement plus compacte et dense, sans perdre les critères essentiels.', ranges: {height:[.7,.8],radius:[.75,.9],length:[.7,.8]} },
  { id: 'expressive', label: 'Expressive', instruction: 'Variation plus marquée des courbes et orientations, toujours crédible et lisible.' },
  { id: 'clean', label: 'Épurée', instruction: 'Moins de petits détails mais des formes principales mieux séparées et très lisibles.' },
];

const clamp = (v, min, max, fallback) => Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : fallback;
const vec3 = (v, min, max, fallback) => Array.isArray(v) && v.length === 3 ? v.map((x, i) => clamp(x, min, max, fallback[i])) : [...fallback];
const clean = (v, n = 80) => String(v || '').replace(/[^\p{L}\p{N}_ .-]/gu, '').slice(0, n);
const materials = new Set(['Plastic','SmoothPlastic','Wood','WoodPlanks','Grass','LeafyGrass','Ground','Rock','Slate','Concrete','Brick','Cobblestone','Metal','CorrodedMetal','Sand','Snow','Ice','Glass','Fabric','Neon']);
const shapeFor = (text) => /leaf|feuille|frond|branch|branche|trunk|tronc|stem|tige|pole|poteau/i.test(text) ? 'cylinder' : /fruit|fruit|flower|fleur|rock|roche|stone|pierre/i.test(text) ? 'ball' : 'box';

function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
export function seedFor(value) {
  return createHash('sha256').update(String(value)).digest().readUInt32LE(0);
}

export function normalizeGeometry(raw, plan) {
  const known = new Set((plan.components || []).map((c) => c.id));
  const parts = (raw?.parts || []).slice(0, 180).map((part, index) => {
    const componentId = known.has(part?.componentId) ? part.componentId : (plan.components?.[0]?.id || 'root');
    return {
      name: clean(part?.name || 'Part_' + (index + 1)),
      componentId,
      shape: ['box','cylinder','ball','wedge'].includes(part?.shape) ? part.shape : 'box',
      size: vec3(part?.size, 0.08, 200, [1,1,1]),
      position: vec3(part?.position, -500, 500, [0,0.5,0]),
      rotation: vec3(part?.rotation, -360, 360, [0,0,0]),
      color: vec3(part?.color, 0, 255, [130,130,130]).map((x) => Math.round(x)),
      material: materials.has(part?.material) ? part.material : 'SmoothPlastic',
      canCollide: part?.canCollide !== false,
    };
  });
  return { parts };
}

function family(component) {
  const text = [component?.name, component?.role, component?.shape, component?.silhouetteRole].filter(Boolean).join(' ');
  if (/trunk|tronc|stem|tige/i.test(text)) return 'trunk';
  if (/branch|branche|frond|rameau/i.test(text)) return 'branch';
  if (/leaf|feuille|foliage|feuillage|crown|couronne/i.test(text)) return 'foliage';
  if (/flower|fleur|blossom/i.test(text)) return 'flower';
  if (/fruit|coco|coconut/i.test(text)) return 'fruit';
  if (/rock|roche|stone|pierre/i.test(text)) return 'rock';
  return 'generic';
}

function colorFor(familyName, variation = 0) {
  const colors = {
    trunk: [105, 75, 48], branch: [100, 72, 46], foliage: [70, 135, 66],
    flower: [236, 160, 190], fruit: [120, 90, 45], rock: [115, 118, 120], generic: [145, 145, 145],
  };
  const base = colors[familyName] || colors.generic;
  return base.map((x, i) => Math.round(clamp(x + variation * (i === 1 ? 16 : 8), 0, 255, x)));
}

function componentBase(component, planSize) {
  const relativeSize = Array.isArray(component.relativeSize) ? component.relativeSize : [0.2,0.2,0.2];
  const relativePosition = Array.isArray(component.relativePosition) ? component.relativePosition : [0,0,0];
  const size = relativeSize.map((x, i) => Math.max(0.15, Math.abs(Number(x) || 0.1) * planSize[i]));
  const position = [
    (Number(relativePosition[0]) || 0) * planSize[0],
    Math.max(size[1] / 2, (Number(relativePosition[1]) || 0) * planSize[1]),
    (Number(relativePosition[2]) || 0) * planSize[2],
  ];
  return { size, position };
}

export function fallbackGeometry(plan, seed = 1, profile = variationProfiles[0]) {
  const random = rng(seed);
  const planSize = plan.sizeStuds || [10,10,10];
  const parts = [];
  for (const component of plan.components || []) {
    const fam = family(component);
    const base = componentBase(component, planSize);
    const repetitions = Math.max(1, Math.min(32, Math.round(Number(component.repetition) || (fam === 'foliage' ? 6 : fam === 'branch' ? 4 : 1))));
    const longCurve = Math.abs(Number(component.curvature) || 0) > 0.08 || ['branch','foliage','trunk'].includes(fam);
    const segments = longCurve ? Math.max(2, Math.min(8, fam === 'foliage' ? 4 : fam === 'branch' ? 4 : 5)) : 1;
    for (let r = 0; r < repetitions; r += 1) {
      const angle = repetitions === 1 ? 0 : (r / repetitions) * Math.PI * 2 + (random() - 0.5) * 0.35;
      for (let s = 0; s < segments; s += 1) {
        const t = segments === 1 ? 0 : s / (segments - 1);
        const spread = fam === 'foliage' ? planSize[0] * 0.22 : fam === 'branch' ? planSize[0] * 0.18 : 0;
        const radial = spread * (0.35 + 0.65 * t);
        const bend = (Number(component.curvature) || 0) * planSize[0] * t * t;
        const position = [
          base.position[0] + Math.cos(angle) * radial + bend * Math.cos(angle),
          base.position[1] + (fam === 'trunk' ? (t - 0.5) * base.size[1] * 0.75 : (random() - 0.35) * base.size[1] * 0.25),
          base.position[2] + Math.sin(angle) * radial + bend * Math.sin(angle),
        ];
        const pieceSize = [...base.size];
        if (segments > 1) pieceSize[1] = Math.max(0.15, base.size[1] / segments * 1.25);
        if (fam === 'foliage') {
          pieceSize[0] = Math.max(0.12, base.size[0] / Math.max(1, repetitions * 0.45));
          pieceSize[2] = Math.max(0.12, base.size[2] * 0.22);
        }
        if (fam === 'branch') {
          pieceSize[0] = Math.max(0.12, base.size[0] * 0.3);
          pieceSize[2] = Math.max(0.12, base.size[2] * 0.3);
        }
        parts.push({
          name: clean(component.name + '_' + (r + 1) + '_' + (s + 1)),
          componentId: component.id,
          shape: shapeFor([component.name, component.shape, component.role].join(' ')),
          size: pieceSize.map((x) => Number(x.toFixed(3))),
          position: position.map((x) => Number(x.toFixed(3))),
          rotation: [fam === 'trunk' ? (Number(component.orientation?.[0]) || 0) : 70 + (random() - 0.5) * 35, angle * 180 / Math.PI, fam === 'foliage' ? (random() - 0.5) * 20 : 0],
          color: colorFor(fam, (random() - 0.5) * (profile.id === 'detail' ? 1.2 : 0.8)),
          material: fam === 'trunk' || fam === 'branch' ? 'Wood' : fam === 'foliage' ? 'Grass' : fam === 'rock' ? 'Rock' : 'SmoothPlastic',
          canCollide: !['foliage','flower','fruit'].includes(fam),
        });
        if (parts.length >= 180) break;
      }
      if (parts.length >= 180) break;
    }
    if (parts.length >= 180) break;
  }
  return { parts };
}

export function geometryAudit(geometry, plan) {
  const issues = [];
  const parts = geometry?.parts || [];
  if (!parts.length) issues.push({ code: 'empty_geometry', message: 'Aucune Part générée.' });
  const counts = new Map();
  for (const part of parts) counts.set(part.componentId, (counts.get(part.componentId) || 0) + 1);
  for (const component of plan.components || []) {
    if (!counts.get(component.id)) issues.push({ code: 'component_missing', componentId: component.id, message: 'Composant absent de la géométrie.' });
    const fam = family(component);
    if (['branch','foliage'].includes(fam) && (Number(component.curvature) || 0) > 0.08 && (counts.get(component.id) || 0) < 3) {
      issues.push({ code: 'curve_undersegmented', componentId: component.id, message: 'Courbe insuffisamment segmentée.' });
    }
  }
  const balls = parts.filter((p) => p.shape === 'ball').length;
  if (parts.length >= 8 && balls / parts.length > 0.72) issues.push({ code: 'ball_proxy_overuse', message: 'Trop de volumes essentiels sont remplacés par des boules.' });
  return { passed: issues.length === 0, issues, partCount: parts.length };
}

export function geometryBounds(geometry) {
  if (!geometry?.parts?.length) return { size: [0,0,0], center: [0,0,0] };
  const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
  for (const p of geometry.parts) for (let i=0;i<3;i+=1) {
    min[i] = Math.min(min[i], p.position[i] - p.size[i] / 2);
    max[i] = Math.max(max[i], p.position[i] + p.size[i] / 2);
  }
  return { size: max.map((x,i)=>x-min[i]), center: max.map((x,i)=>(x+min[i])/2) };
}
