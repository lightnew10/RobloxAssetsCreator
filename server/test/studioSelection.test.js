import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStudioSelection } from '../../web/src/studioSelection.js';

test('selects the first detected Roblox Studio instance', () => {
  assert.equal(resolveStudioSelection([{ id: 'studio-A', name: 'Place' }]), 'studio-A');
});

test('keeps an explicit selection if it is still valid', () => {
  const studios = [{ id: 'A' }, { id: 'B' }];
  assert.equal(resolveStudioSelection(studios, 'B', 'A'), 'B');
});

test('replaces stale Studio instance ids after refresh', () => {
  assert.equal(resolveStudioSelection([{ id: 'new-id' }], 'old-id'), 'new-id');
});

test('prefers the existing authorization when selection is stale', () => {
  assert.equal(resolveStudioSelection([{ id: 'A' }, { id: 'B' }], 'old-id', 'B'), 'B');
});

test('disables authorization when MCP returns no instances', () => {
  assert.equal(resolveStudioSelection([], 'previous-studio'), '');
});
