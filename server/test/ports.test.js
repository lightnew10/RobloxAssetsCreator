import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { checkLocalPort, projectPorts } from '../../scripts/check-ports.js';

test('detects an already occupied local port without terminating its owner', async () => {
  const owner = net.createServer();
  await new Promise((resolve) => owner.listen(0, '127.0.0.1', resolve));
  try {
    const port = owner.address().port;
    const state = await checkLocalPort(port);
    assert.equal(state.free, false);
    assert.equal(state.code, 'EADDRINUSE');
    assert.equal(owner.listening, true);
  } finally {
    await new Promise((resolve) => owner.close(resolve));
  }
});

test('allows an available port', async () => {
  const owner = net.createServer();
  await new Promise((resolve) => owner.listen(0, '127.0.0.1', resolve));
  const port = owner.address().port;
  await new Promise((resolve) => owner.close(resolve));
  const state = await checkLocalPort(port);
  assert.equal(state.free, true);
});

test('cleans the known API, Vite and former Vite fallback ports', () => {
  assert.deepEqual(projectPorts(), [3001, 5173, 5174]);
  assert.deepEqual(projectPorts('4000'), [3001, 5173, 5174, 4000]);
  assert.deepEqual(projectPorts('5173'), [3001, 5173, 5174]);
  assert.deepEqual(projectPorts('not-a-port'), [3001, 5173, 5174]);
});
