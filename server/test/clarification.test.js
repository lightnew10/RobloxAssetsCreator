import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { getJob, saveJob } from '../src/store.js';
import { clarifyPendingCorrection } from '../src/pipeline.js';
import { applyClarificationResponse, correctionContext, createClarification } from '../src/change/clarification.js';
import { patchUser } from '../src/prompts.js';

function fixture() {
  return { id: randomUUID(), status: 'queued', provider: 'local', traceLevel: 'off', planVersion: 1,
    plan: { components: [{ id: 'leaves', name: 'Palmes' }] }, brief: 'Cocotier', events: [],
    feedback: [{ id: 'c', text: 'Élargis les palmes' }],
    pendingCorrection: { id: 'c', variantId: 'v', mode: 'patch', text: 'Élargis les palmes' },
    variants: [{ id: 'v', status: 'done', bounds: { size: [10, 12, 8] },
      geometryDefinition: { archetype: 'palmTree', params: { frondWidth: .105 } },
      geometry: { parts: [{ name: 'frond_0_0', size: [.51, 1, .1] }] } }] };
}
const questions = { questions: [
  { question: 'Quelle augmentation de largeur ?', options: ['+25 %', '+50 %'], required: true },
  { question: 'Conserver la longueur ?', options: ['Oui'], required: false },
] };
function waitingJob() {
  const job = fixture();
  job.pendingCorrection.clarification = createClarification(questions, correctionContext(job, job.pendingCorrection));
  job.status = 'awaiting_correction_answers';
  return job;
}
test('measures come from saved Studio bounds and real frond Parts, without calling normalized params studs', () => {
  const job = fixture(), context = correctionContext(job, job.pendingCorrection);
  assert.deepEqual(context.metrics[0].value, [10,12,8]);
  assert.equal(context.metrics[1].value, .51);
  assert.equal(context.definition.params.frondWidth, .105);
  assert.equal(context.parameterSchema.frondWidth.maximum, .25);
  const input = JSON.parse(patchUser({ definition: context.definition, feedback: '+50 %', context }));
  assert.equal(input.currentMeasurements[1].value, .51);
  assert.match(input.parameterNotes.frondWidth, /sans unité/);
  assert.deepEqual(correctionContext({ variants: [] }, {}).metrics, []);
});
test('questions are bounded and malformed model output is rejected', () => {
  assert.throws(() => createClarification({ questions: [...questions.questions, ...questions.questions] }, { metrics: [] }));
  assert.throws(() => createClarification({ questions: [{ question: '?', options: [] }] }, { metrics: [] }));
  assert.equal(createClarification({ questions: [] }, { metrics: [] }).state, 'ready');
});
test('drafts persist; required questions block; submit propagates exact answers to patch and rebuild feedback', () => {
  const job = waitingJob();
  assert.equal(applyClarificationResponse(job, 'c', { action: 'draft', answers: { q1: '+50 %' } }), false);
  assert.equal(job.status, 'awaiting_correction_answers');
  assert.equal(applyClarificationResponse(job, 'c', { action: 'submit' }), true);
  assert.equal(job.pendingCorrection.clarification.state, 'answered');
  assert.equal(job.pendingCorrection.originalText, 'Élargis les palmes');
  assert.match(job.pendingCorrection.text, /\+50 %/);
  assert.equal(job.feedback[0].text, job.pendingCorrection.text);
  assert.equal(job.status, 'queued');
  assert.throws(() => applyClarificationResponse(job, 'c', { action: 'submit' }), { code: 'CLARIFICATION_NOT_WAITING' });
  assert.throws(() => applyClarificationResponse(waitingJob(), 'c', { action: 'submit' }), { code: 'CLARIFICATION_INPUT_INVALID' });
});
test('unknown ids and oversized answers cannot mutate the pending request', () => {
  const job = waitingJob(), original = structuredClone(job);
  for (const answers of [{ fake: 'x' }, { q1: 'x'.repeat(1001) }, { q1: 50 }])
    assert.throws(() => applyClarificationResponse(job, 'c', { action: 'submit', answers }));
  assert.deepEqual(job, original);
  assert.throws(() => applyClarificationResponse(job, 'old', { action: 'submit', answers: { q1: 'yes' } }));
});
test('cancel preserves the source, archives questions and never constructs a variant', () => {
  const job = waitingJob(), source = structuredClone(job.variants);
  assert.equal(applyClarificationResponse(job, 'c', { action: 'cancel' }), false);
  assert.equal(job.pendingCorrection, null);
  assert.equal(job.correctionClarifications[0].clarification.state, 'cancelled');
  assert.deepEqual(job.variants, source);
  assert.equal(job.status, 'review_ready');
  assert.equal(job.feedback[0].cancelled, true);
});
test('clarification pauses before building, survives reload, and is only asked once', async () => {
  const job = fixture(); let calls = 0;
  try {
    await saveJob(job);
    const chat = async input => { calls++; assert.equal(input.provider, 'local'); return { data: questions }; };
    assert.equal(await clarifyPendingCorrection(job.id, { chat }), true);
    const saved = await getJob(job.id);
    assert.equal(saved.status, 'awaiting_correction_answers');
    assert.deepEqual(saved.variants, job.variants);
    assert.equal(saved.pendingCorrection.clarification.questions.length, 2);
    assert.equal(await clarifyPendingCorrection(job.id, { chat }), true);
    assert.equal(calls, 1);
    applyClarificationResponse(saved, 'c', { action: 'submit', answers: { q1: '+50 %' } });
    await saveJob(saved);
    assert.equal(await clarifyPendingCorrection(job.id, { chat }), false);
    assert.equal(calls, 1);
  } finally { await rm(path.join(config.jobsRoot, job.id + '.json'), { force: true }); }
});
test('precise request passes through; failed local interpreter asks for explicit input instead of executing', async () => {
  const job = fixture();
  try {
    await saveJob(job);
    assert.equal(await clarifyPendingCorrection(job.id, { chat: async () => ({ data: { questions: [] } }) }), false);
    assert.equal((await getJob(job.id)).status, 'queued');
    await saveJob(fixtureWithId(job.id));
    assert.equal(await clarifyPendingCorrection(job.id, { chat: async () => { throw Object.assign(new Error('bad JSON'), { code: 'AI_INVALID_JSON' }); } }), true);
    const saved = await getJob(job.id);
    assert.equal(saved.pendingCorrection.clarification.diagnostic, 'AI_INVALID_JSON');
    assert.equal(saved.pendingCorrection.clarification.questions[0].required, true);
  } finally { await rm(path.join(config.jobsRoot, job.id + '.json'), { force: true }); }
});
function fixtureWithId(id) { return { ...fixture(), id }; }
