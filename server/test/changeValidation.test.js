import test from 'node:test';
import assert from 'node:assert/strict';
import { correctionEligibleForLearning, validatedCorrectionFeedback } from '../src/change/validation.js';

test('a corrected variant needs resolution and explicit human validation for learning', () => {
  const variant = { correctionOf:'original', correctionRequest:{ id:'feedback-1' }, correctionStatus:'resolved' };
  assert.equal(correctionEligibleForLearning(variant), false);
  assert.equal(correctionEligibleForLearning({ ...variant, correctionValidated:true }), true);
  assert.equal(correctionEligibleForLearning({ ...variant, correctionValidated:true, correctionStatus:'no_effect' }), false);
  assert.equal(correctionEligibleForLearning({ ...variant, correctionValidated:true, correctionStatus:'unresolved' }), false);
});

test('only feedback attached to an explicitly validated resolution becomes an example', () => {
  const job = {
    feedback:[{ id:'a', text:'feuilles trop fines' }, { id:'b', text:'tronc trop haut' }, { id:'auto', source:'auto_review', text:'auto' }],
    variants:[
      { correctionRequest:{ id:'a' }, correctionStatus:'resolved', correctionValidated:true },
      { correctionRequest:{ id:'b' }, correctionStatus:'resolved', correctionValidated:false },
      { correctionRequest:{ id:'auto' }, correctionStatus:'resolved', correctionValidated:true },
    ],
  };
  assert.deepEqual(validatedCorrectionFeedback(job).map((entry) => entry.id), ['a']);
});
