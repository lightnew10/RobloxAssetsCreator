import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const bool = (value, fallback = false) => value == null ? fallback : /^(1|true|yes|on)$/i.test(String(value));
const boundedInteger = (value, fallback, min, max) => {
  const number = Number(value);
  return value == null || String(value).trim() === '' || !Number.isFinite(number)
    ? fallback : Math.max(min, Math.min(max, Math.floor(number)));
};

export const config = Object.freeze({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 3001,
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  // An Ollama model may stream thinking before producing the final JSON.
  // Timers measure inactivity and total duration separately.
  ollamaIdleTimeoutMs: boundedInteger(process.env.OLLAMA_IDLE_TIMEOUT_MS, 900000, 30000, 7200000),
  ollamaMaxDurationMs: boundedInteger(process.env.OLLAMA_MAX_DURATION_MS, 3600000, 60000, 14400000),
  // Abort planning only when the model thinks continuously without any answer.
  ollamaMaxThinkingOnlyMs: boundedInteger(process.env.OLLAMA_MAX_THINKING_ONLY_MS, 90000, 30000, 14400000),
  // JSON planning is a deterministic output task; reasoning is opt-in, not default.
  ollamaPlanningThink: bool(process.env.OLLAMA_PLANNING_THINK, false),
  ollamaNumCtx: boundedInteger(process.env.OLLAMA_NUM_CTX, 8192, 2048, 131072),
  ollamaPlanNumPredict: boundedInteger(process.env.OLLAMA_PLAN_NUM_PREDICT, 1500, 256, 4096),
  ollamaGeometryNumPredict: boundedInteger(process.env.OLLAMA_GEOMETRY_NUM_PREDICT, 650, 256, 4096),
  ollamaReviewNumPredict: boundedInteger(process.env.OLLAMA_REVIEW_NUM_PREDICT, 900, 256, 4096),
  traceLevel: ['off', 'basic', 'full'].includes(process.env.TRACE_LEVEL) ? process.env.TRACE_LEVEL : 'full',
  dataRoot: path.join(root, 'data'),
  jobsRoot: path.join(root, 'data', 'runtime', 'jobs'),
  capturesRoot: path.join(root, 'data', 'runtime', 'captures'),
  tracesRoot: path.join(root, 'data', 'runtime', 'traces'),
  mcpProtocolVersion: process.env.MCP_PROTOCOL_VERSION || '2025-11-25',
  maxVariants: Math.max(1, Math.min(6, Number(process.env.MAX_VARIANTS) || 3)),
  maxPlanAttempts: Math.max(1, Math.min(5, Number(process.env.MAX_PLAN_ATTEMPTS) || 3)),
  maxGeometryAttempts: Math.max(1, Math.min(5, Number(process.env.MAX_GEOMETRY_ATTEMPTS) || 2)),
  maxCorrectionRounds: Math.max(0, Math.min(4, Number(process.env.MAX_CORRECTION_ROUNDS) || 2)),
  autoReview: bool(process.env.AUTO_REVIEW, true),
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
});
