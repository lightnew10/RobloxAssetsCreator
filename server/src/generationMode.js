/**
 * Source of truth for the 3D geometry generator.
 * "Local" means local geometry planning + Parts construction in Roblox Studio;
 * Studio MCP remains necessary to place/capture the resulting asset.
 * "Roblox" uses the native Roblox 3D generator (planning and vision may still use AI providers).
 */
export const GENERATION_MODES = Object.freeze(['local', 'roblox', 'hybrid']);

export function normalizeGenerationMode(mode) {
  return GENERATION_MODES.includes(mode) ? mode : 'local';
}

export function engineForGenerationMode(mode) {
  switch (normalizeGenerationMode(mode)) {
    case 'roblox': return 'native';
    case 'hybrid': return 'auto';
    default: return 'parts';
  }
}

export function legacyModeForEngine(engine) {
  if (engine === 'native') return 'roblox';
  if (engine === 'auto') return 'hybrid';
  return 'local';
}

export function generationModeForJob(job) {
  // Old jobs keep their original engine even if the global preference changes.
  return job?.generationMode ? normalizeGenerationMode(job.generationMode) : legacyModeForEngine(job?.engine);
}

export function engineForJob(job) {
  return job?.generationMode ? engineForGenerationMode(job.generationMode) : ['auto', 'parts', 'native'].includes(job?.engine) ? job.engine : 'parts';
}

export function generationSourceForEngine(engineUsed) {
  return engineUsed === 'native' ? 'roblox_native' : ['parts', 'parts_fallback'].includes(engineUsed) ? 'local_parts' : null;
}
