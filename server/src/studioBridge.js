import { callStudioMcpTool, parseStudioMcpResult, studioMcpAvailable, studioMcpTools } from './studioMcpClient.js';
import { traceArtifact, traceEvent } from './trace.js';

let cache = null;
let cacheUntil = 0;
let access = null;
const accessDurationMs = 12 * 60 * 60 * 1000;

function bounded(value, n = 180) { return String(value || '').slice(0, n); }
function normalizeStudios(result) {
  const value = parseStudioMcpResult(result);
  const items = Array.isArray(value) ? value : Array.isArray(value?.studios) ? value.studios : [];
  return items.map((item) => ({
    id: bounded(item.id || item.studio_id, 120),
    name: bounded(item.name || item.placeName || item.id, 120),
    placeId: Number(item.placeId || item.place_id) || 0,
  })).filter((x) => x.id);
}
function currentAccess(studios = []) {
  if (access && (Date.now() >= access.expiresAt || !studios.some((s) => s.id === access.studioId))) access = null;
  return access ? { studioId: access.studioId, enabledAt: access.enabledAt, expiresAt: new Date(access.expiresAt).toISOString() } : null;
}

export async function getStudioStatus({ refresh = false } = {}) {
  if (!studioMcpAvailable()) {
    access = null;
    return { status: 'unavailable', detail: 'Lanceur MCP Roblox Studio introuvable.', studios: [], access: null, tools: [] };
  }
  if (!refresh && cache && Date.now() < cacheUntil) return { ...cache, access: currentAccess(cache.studios) };
  try {
    const studios = normalizeStudios(await callStudioMcpTool('list_roblox_studios'));
    const tools = (await studioMcpTools()).map((x) => x.name);
    cache = {
      status: studios.length ? 'connected' : 'disconnected',
      detail: studios.length ? studios.length + ' instance(s) Studio détectée(s).' : 'Active Studio en tant que serveur MCP dans Assistant → Gérer les serveurs MCP.',
      studios,
      tools,
    };
  } catch (cause) {
    cache = { status: 'disconnected', detail: cause.message, studios: [], tools: [] };
  }
  cacheUntil = Date.now() + 3000;
  return { ...cache, access: currentAccess(cache.studios) };
}

export async function grantStudioAccess(studioId) {
  const status = await getStudioStatus({ refresh: true });
  if (!status.studios.some((x) => x.id === studioId)) {
    const detail = status.studios.length
      ? 'La fenêtre Roblox Studio sélectionnée n’est plus dans la liste. Actualise la liste et réessaie.'
      : 'Aucune fenêtre Roblox Studio disponible. Vérifie la connexion MCP et actualise.';
    throw Object.assign(new Error(detail), {
      code: 'STUDIO_NOT_CONNECTED',
      details: { requestedStudioId: studioId, availableStudios: status.studios.map(({ id, name }) => ({ id, name })) },
    });
  }
  access = { studioId, enabledAt: new Date().toISOString(), expiresAt: Date.now() + accessDurationMs };
  return currentAccess(status.studios);
}
export function revokeStudioAccess() { access = null; }

export async function executeStudioTool(name, args, context = {}) {
  const studioId = args?.studio_id;
  if (!access || Date.now() >= access.expiresAt || access.studioId !== studioId) throw Object.assign(new Error('Autorise cette fenêtre Roblox Studio dans l’interface.'), { code: 'STUDIO_ACCESS_REQUIRED' });
  const status = await getStudioStatus({ refresh: true });
  if (!status.studios.some((x) => x.id === studioId)) throw Object.assign(new Error('La fenêtre Studio autorisée n’est plus connectée.'), { code: 'STUDIO_NOT_CONNECTED' });
  const started = Date.now();
  if (context.runId) {
    const artifact = await traceArtifact(context.runId, 'studio', name + '_request', { name, args }, context);
    await traceEvent(context.runId, 'STUDIO_REQUEST', { tool: name, artifactId: artifact?.id }, context);
  }
  try {
    const result = await callStudioMcpTool(name, args);
    if (context.runId) {
      const artifact = await traceArtifact(context.runId, 'studio', name + '_response', result, context);
      await traceEvent(context.runId, 'STUDIO_RESPONSE', { tool: name, latencyMs: Date.now() - started, artifactId: artifact?.id }, context);
    }
    return result;
  } catch (cause) {
    if (context.runId) {
      await traceArtifact(context.runId, 'errors', 'studio_' + name, { code: cause.code, message: cause.message, details: cause.details, stack: cause.stack }, context);
      await traceEvent(context.runId, 'STUDIO_ERROR', { tool: name, code: cause.code, message: cause.message }, context);
    }
    throw cause;
  }
}

export async function readStudioTree(studioId) {
  const result = await executeStudioTool('search_game_tree', { studio_id: studioId, datamodel_type: 'Edit', max_depth: 5, head_limit: 500 });
  return parseStudioMcpResult(result);
}

export async function listStudioTools() {
  return (await studioMcpTools({ refresh: true })).map((tool) => ({
    name: tool.name,
    description: bounded(tool.description, 400),
    readOnly: tool.annotations?.readOnlyHint === true,
    inputSchema: tool.inputSchema || null,
  }));
}
