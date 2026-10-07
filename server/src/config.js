import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const bool = (value, fallback = false) => value == null ? fallback : /^(1|true|yes|on)$/i.test(String(value));

export const config = Object.freeze({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT) || 3001,
  ollamaUrl: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
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
