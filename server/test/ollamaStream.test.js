import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOllamaChatStream } from '../src/ollamaStream.js';

function fakeResponse(pieces) {
  const encoder = new TextEncoder();
  return { body: new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  }) };
}

test('assembles Ollama streaming JSON over arbitrary network chunks', async () => {
  const lines = [
    JSON.stringify({ model: 'qwen3.5:9b', message: { thinking: 'private-part', content: '' }, done: false }),
    JSON.stringify({ model: 'qwen3.5:9b', message: { content: '{"sizeStuds":' }, done: false }),
    JSON.stringify({ model: 'qwen3.5:9b', message: { content: '[10,20,10]}' }, done: false }),
    JSON.stringify({ model: 'qwen3.5:9b', done: true, prompt_eval_count: 17, eval_count: 80 }),
  ].join('\n') + '\n';
  const out = await parseOllamaChatStream(fakeResponse([lines.slice(0, 13), lines.slice(13, 59), lines.slice(59)]));
  assert.deepEqual(JSON.parse(out.text), { sizeStuds: [10,20,10] });
  assert.equal(out.usage.completionTokens, 80);
  assert.equal(out.raw.thinkingCharacters, 'private-part'.length);
  assert.equal(out.raw.message.thinking, undefined);
});

test('recognizes a stream terminated without done=true', async () => {
  await assert.rejects(parseOllamaChatStream(fakeResponse(['{"message":{"content":"hi"},"done":false}\n'])), { code: 'AI_STREAM_INCOMPLETE' });
});

test('reports an Ollama stream error rather than attempting to validate JSON', async () => {
  await assert.rejects(parseOllamaChatStream(fakeResponse(['{"error":"model out of memory"}\n'])), { code: 'AI_HTTP_ERROR' });
});
