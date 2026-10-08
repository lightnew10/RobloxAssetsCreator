import test from 'node:test';
import assert from 'node:assert/strict';
import { describeNativeFailure } from '../src/assetStudio.js';

test('native failure preserves a reported Roblox error', () => {
  assert.deepEqual(describeNativeFailure(
    { status: 'Failed', error: { message: 'generation service unavailable' } },
    'generate_mesh', 'native-job-1'
  ), {
    method: 'generate_mesh', jobId: 'native-job-1', status: 'Failed',
    reason: 'generation service unavailable', providerDetailsAvailable: true,
  });
});

test('native failure without a Roblox reason stays explicitly unknown', () => {
  assert.deepEqual(describeNativeFailure(
    { status: 'Failed', jobResult: {} }, 'generate_procedural_model', 'native-job-2'
  ), {
    method: 'generate_procedural_model', jobId: 'native-job-2', status: 'Failed',
    reason: null, providerDetailsAvailable: false,
  });
});

test('native failure inspects nested structured response messages', () => {
  const details = describeNativeFailure(
    { status: 'Failed', jobResult: { structuredContent: { failureReason: 'schema rejected' } } },
    'generate_mesh', 'native-job-3'
  );
  assert.equal(details.reason, 'schema rejected');
});
