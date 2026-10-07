import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { config } from './config.js';

const launcher = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'mcp.bat');
let child = null;
let connecting = null;
let serial = 0;
let toolsCache = null;
const pending = new Map();

export function studioMcpAvailable() {
  return process.platform === 'win32' && Boolean(process.env.LOCALAPPDATA) && existsSync(launcher);
}
export function studioMcpLauncher() { return launcher; }

function rejectAll(cause) {
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.reject(cause);
  }
  pending.clear();
}
function close() {
  try { child?.kill(); } catch {}
  child = null;
  connecting = null;
  toolsCache = null;
}
function onLine(line) {
  let packet;
  try { packet = JSON.parse(line); } catch { return; }
  if (packet.id == null) return;
  const item = pending.get(packet.id);
  if (!item) return;
  pending.delete(packet.id);
  clearTimeout(item.timer);
  if (packet.error) item.reject(Object.assign(new Error(packet.error.message || 'Erreur MCP Studio.'), { code: 'MCP_RPC_ERROR', details: packet.error }));
  else item.resolve(packet.result);
}
function send(method, params = {}, timeoutMs = 15000) {
  if (!child?.stdin?.writable) return Promise.reject(Object.assign(new Error('Serveur MCP Studio indisponible.'), { code: 'MCP_NOT_CONNECTED' }));
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`Studio MCP : délai dépassé pour ${method}.`), { code: 'MCP_TIMEOUT' }));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', (cause) => {
      if (cause) {
        clearTimeout(timer);
        pending.delete(id);
        reject(cause);
      }
    });
  });
}

export async function connectStudioMcp() {
  if (!studioMcpAvailable()) throw Object.assign(new Error('Le lanceur MCP officiel Roblox Studio est introuvable dans %LOCALAPPDATA%\\Roblox\\mcp.bat.'), { code: 'MCP_LAUNCHER_NOT_FOUND' });
  if (connecting) return connecting;
  connecting = (async () => {
    child = spawn('cmd.exe', ['/d', '/c', launcher], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: child.stdout }).on('line', onLine);
    child.stderr.on('data', () => {});
    child.on('error', (cause) => { rejectAll(cause); close(); });
    child.on('exit', () => { rejectAll(Object.assign(new Error('Le serveur MCP Studio s’est arrêté.'), { code: 'MCP_EXITED' })); close(); });
    let initialized;
    try {
      initialized = await send('initialize', {
        protocolVersion: config.mcpProtocolVersion,
        capabilities: {},
        clientInfo: { name: 'RobloxAssetsCreator', version: '0.1.0' },
      }, 20000);
    } catch (first) {
      close();
      throw first;
    }
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    return initialized;
  })();
  try { return await connecting; }
  catch (cause) { close(); throw cause; }
}

export async function studioMcpTools({ refresh = false } = {}) {
  await connectStudioMcp();
  if (!refresh && toolsCache) return toolsCache;
  toolsCache = (await send('tools/list', {}, 30000))?.tools || [];
  return toolsCache;
}

export async function callStudioMcpTool(name, args = {}, timeoutMs = null) {
  if (!name || typeof name !== 'string' || !args || typeof args !== 'object' || Array.isArray(args)) throw Object.assign(new Error('Appel MCP invalide.'), { code: 'MCP_CALL_INVALID' });
  const tools = await studioMcpTools();
  if (!tools.some((tool) => tool.name === name)) throw Object.assign(new Error('Outil MCP absent : ' + name), { code: 'MCP_TOOL_MISSING', details: tools.map((x) => x.name) });
  const result = await send('tools/call', { name, arguments: args }, timeoutMs || (name === 'wait_job_finished' ? 650000 : 180000));
  if (result?.isError) {
    const message = result.content?.find((item) => item.type === 'text')?.text || 'Échec MCP : ' + name;
    throw Object.assign(new Error(message), { code: 'MCP_TOOL_ERROR', details: result });
  }
  return result;
}

export function parseStudioMcpResult(result) {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const content = result?.content?.filter((item) => item.type === 'text').map((item) => item.text).join('\n') || '';
  try { return JSON.parse(content); } catch {}
  const start = content.search(/[\[{]/);
  if (start >= 0) {
    try { return JSON.parse(content.slice(start)); } catch {}
  }
  return content;
}

export function closeStudioMcp() {
  rejectAll(Object.assign(new Error('Connexion MCP fermée.'), { code: 'MCP_CLOSED' }));
  close();
}
