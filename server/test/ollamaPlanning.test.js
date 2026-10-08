import test from 'node:test';
import assert from 'node:assert/strict';
import { structuredChat } from '../src/providers.js';

function makeResponse() {
  const encoder = new TextEncoder();
  const lines = [
    { model: 'qwen3.5:9b', message: { content: '{"ok":true}' }, done: false },
    { model: 'qwen3.5:9b', message: { content: '' }, done: true, eval_count: 4, prompt_eval_count: 6 },
  ].map(x => JSON.stringify(x)).join('\n') + '\n';
  return { ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(lines)); controller.close(); } }) };
}

test('Ollama think flag is top-level and only set for explicit planning fallback', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return makeResponse();
  };
  try {
    const input = {
      provider: 'local',
      modelOverride: 'qwen3.5:9b',
      messages: [{ role: 'user', content: 'JSON only' }],
      schema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
    };
    const regular = await structuredChat(input);
    const fallback = await structuredChat({ ...input, thinkOverride: false });
    assert.equal(regular.data.ok, true);
    assert.equal(fallback.data.ok, true);
    assert.equal(Object.hasOwn(bodies[0], 'think'), false);
    assert.equal(bodies[1].think, false);
    assert.equal(Object.hasOwn(bodies[1].options, 'think'), false);
    assert.ok(bodies.every(body => body.options.num_ctx >= 2048));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
