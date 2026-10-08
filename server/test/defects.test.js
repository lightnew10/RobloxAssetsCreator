import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReview, planCorrections, applyOneChange, keepCorrection, shouldStop } from '../src/review/defects.js';
import { archetypes } from '../src/archetypes/index.js';

const schemaOf = (id) => archetypes[id].schema;
const review = (issue, severity = 'high', component = 'x') => normalizeReview({ score: 5, problems: [{ component, issue, severity }] });

test('vocabulaire hors liste : rejeté, aucune correction', () => {
  const r = review('le tronc a une bizarrerie');
  assert.equal(r.defects[0].status, 'rejected_vocabulary');
  assert.equal(planCorrections(r.defects, 'palmTree', schemaOf('palmTree')).changes.length, 0);
});

test('palmier : manque de feuilles → frondCount augmente, borné', () => {
  const { changes } = planCorrections(review('too_few_leaves').defects, 'palmTree', schemaOf('palmTree'));
  assert.equal(changes[0].param, 'frondCount');
  assert.equal(applyOneChange({ frondCount: 19 }, changes[0]).frondCount, 20);
});

test('rocher : trop rond → roughness augmente (rôle angularity)', () => {
  const { changes } = planCorrections(review('too_round').defects, 'rock', schemaOf('rock'));
  assert.equal(changes[0].param, 'roughness');
  assert.equal(changes[0].direction, 'increase');
});

test('texture : pas de paramètre numérique → instruction au décomposeur, pas de changement aveugle', () => {
  const plan = planCorrections(review('texture_too_flat').defects, 'palmTree', schemaOf('palmTree'));
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.instructions.length, 1);
});

test('défaut structurel → reconstruction, pas de paramètre', () => {
  const plan = planCorrections(review('floating_component').defects, 'house', schemaOf('house'));
  assert.equal(plan.rebuilds.length, 1);
});

test('objet non enregistré (voiture) : même logique, sans code spécifique', () => {
  const car = { type: 'object', properties: { wheelCount: { type: 'integer', minimum: 4, maximum: 8 } } };
  const plan = planCorrections(review('too_few_details').defects, 'car', car);
  assert.equal(plan.missing[0].reason, 'needs_param_role');
  assert.equal(plan.instructions.length, 1);
});

test('gain insuffisant ou nouveau défaut grave : correction annulée', () => {
  const before = { score: 6, defects: [] };
  assert.equal(keepCorrection(before, { score: 6.2, defects: [] }).keep, false);
  const after = { score: 7.5, defects: [{ component: 'trunk', issue: 'floating_component', severity: 'critical', status: 'valid' }] };
  assert.equal(keepCorrection(before, after).reason, 'new_serious_defect');
});

test('arrêt : accepté à 8, ou stagnation sur trois versions', () => {
  assert.equal(shouldStop([{ score: 8, defects: [] }]).reason, 'accepted');
  assert.equal(shouldStop([6, 6.2, 6.3].map((score) => ({ score, defects: [] }))).reason, 'stagnation');
});
