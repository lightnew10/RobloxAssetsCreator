import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = path.join(config.dataRoot, 'provider-settings.json');
export const providerIds = ['local', 'openai', 'claude', 'deepseek', 'gemini', 'openrouter'];
const defaultsById = {
  local: { textModel: 'qwen3.5:9b', visionModel: 'qwen3-vl:4b-instruct', apiKey: '' },
  openai: { textModel: 'gpt-5.6-sol', visionModel: 'gpt-5.6-sol', apiKey: '' },
  claude: { textModel: 'claude-sonnet-5-5', visionModel: 'claude-sonnet-5-5', apiKey: '' },
  deepseek: { textModel: 'deepseek-chat', visionModel: '', apiKey: '' },
  gemini: { textModel: 'gemini-2.5-flash', visionModel: 'gemini-2.5-flash', apiKey: '' },
  openrouter: { textModel: '', visionModel: '', apiKey: '' },
};

function defaults() {
  return {
    selectedProvider: 'local',
    selectedVisionProvider: 'local',
    providers: Object.fromEntries(providerIds.map((id) => [id, { ...defaultsById[id] }])),
  };
}

function load() {
  const base = defaults();
  try {
    if (!existsSync(file)) return base;
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (providerIds.includes(parsed.selectedProvider)) base.selectedProvider = parsed.selectedProvider;
    if (providerIds.includes(parsed.selectedVisionProvider)) base.selectedVisionProvider = parsed.selectedVisionProvider;
    for (const id of providerIds) {
      base.providers[id] = { ...base.providers[id], ...(parsed.providers?.[id] || {}) };
    }
  } catch {}
  return base;
}

let state = load();
function save() {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function publicEntry(id, value) {
  const key = String(value?.apiKey || '');
  return {
    id,
    configured: id === 'local' || Boolean(key),
    textModel: value?.textModel || '',
    visionModel: value?.visionModel || '',
    keyHint: key ? '••••' + key.slice(-4) : '',
  };
}

export function getProviderSettings() {
  return {
    selectedProvider: state.selectedProvider,
    selectedVisionProvider: state.selectedVisionProvider,
    providers: Object.fromEntries(providerIds.map((id) => [id, publicEntry(id, state.providers[id])])),
  };
}

export function getProviderRuntime(id = state.selectedProvider) {
  const provider = providerIds.includes(id) ? id : 'local';
  const entry = state.providers[provider] || defaultsById[provider];
  return { provider, ...entry };
}

export function getVisionRuntime(id = state.selectedVisionProvider) {
  return getProviderRuntime(id);
}

export function updateProviderSettings(input = {}) {
  if (input.selectedProvider !== undefined) {
    if (!providerIds.includes(input.selectedProvider)) throw Object.assign(new Error('Provider inconnu.'), { code: 'PROVIDER_INVALID' });
    state.selectedProvider = input.selectedProvider;
  }
  if (input.selectedVisionProvider !== undefined) {
    if (!providerIds.includes(input.selectedVisionProvider)) throw Object.assign(new Error('Provider vision inconnu.'), { code: 'PROVIDER_INVALID' });
    state.selectedVisionProvider = input.selectedVisionProvider;
  }
  if (input.provider) {
    if (!providerIds.includes(input.provider)) throw Object.assign(new Error('Provider inconnu.'), { code: 'PROVIDER_INVALID' });
    const entry = state.providers[input.provider] ||= { ...defaultsById[input.provider] };
    if (typeof input.apiKey === 'string') entry.apiKey = input.apiKey.trim();
    if (typeof input.textModel === 'string') entry.textModel = input.textModel.trim();
    if (typeof input.visionModel === 'string') entry.visionModel = input.visionModel.trim();
  }
  save();
  return getProviderSettings();
}

export function clearProviderKey(provider) {
  return updateProviderSettings({ provider, apiKey: '' });
}
