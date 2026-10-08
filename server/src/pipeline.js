import {assertAllowedBrief} from './contentPolicy.js';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { getGenerationMode, getProviderRuntime, getVisionRuntime } from './providerSettings.js';
import { engineForGenerationMode, engineForJob, generationModeForJob, generationSourceForEngine } from './generationMode.js';
import { structuredChat, visionStructuredChat } from './providers.js';
import { inventorySchema, resolveCategory, inferCategory, loadCategoryPrompt } from './categories.js';
import { primitiveGeometrySchema, interpretPrimitives, PRIMITIVE_VERSION } from './primitives.js';
import { normalizeSpatialPlan, spatialPlanSchema } from './spatialPlan.js';
import { fallbackGeometry, geometryAudit, geometrySchema, legacyGeometrySchema, normalizeGeometry, seedFor, variationProfiles } from './geometry.js';
import { archetypes, buildProceduralGeometry, guessArchetype, proceduralGeometrySchema } from './archetypes/index.js';
import { ALLOWED_ISSUES, normalizeReview, planCorrections, applyOneChange, keepCorrection, shouldStop } from './review/defects.js';
import { geometrySystem, genericGeometrySystem, geometryUser, plannerSystem, plannerUser, reviewSystem, patchSystem, patchUser, targetedReviewSystem } from './prompts.js';
import { auditVariant, buildNativeVariant, buildPartsVariant, saveVariantToLibrary } from './assetStudio.js';
import { captureThreeViews, capturePath } from './capture.js';
import { getStudioStatus, listStudioTools } from './studioBridge.js';
import { getJob, listJobs, mutateJob, saveJob } from './store.js';
import { markRecovered, recordIncident, traceIncident } from './recovery.js';
import { safeTelegramErrorCode, sendCriticalAlert } from './telegram.js';
import { traceArtifact, traceEvent } from './trace.js';
import { learnFromSelection, relevantLessons, relevantExamples } from './learning.js';
import { saveLibrarySelection, searchLibrary } from './library.js';
import { recordVariantMetric } from './metrics.js';
import { normalizeAssetInput } from './input.js';
import { referenceSimilarity } from './referenceSimilarity.js';
import { qualityBatchDecision, rankQualityVariant } from './qualityPolicy.js';
import { compareVersions, definitionFingerprint, geometryFingerprint } from './change/fingerprint.js';
import { applyPatch, definitionForVariant, ensurePrimitiveIds, patchSchema } from './change/patch.js';
import { feedbackType } from './change/feedbackTypes.js';
import { listCorrectionsForFeedbackType, recordCorrection, recordFeedback, recordGeneration, recordUnsupported, saveCapture } from './change/store.js';

const queue = [];
let running = false;
const active = new Set();

const reviewSchema = {
  type: 'object', additionalProperties: false,
  required: ['score','decision','criteria','problems','improvement'],
  properties: {
    score: { type: 'number', minimum: 0, maximum: 10 },
    decision: { type: 'string', enum: ['accept','patch','rebuild'] },
    criteria: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name','score','essential','comment'], properties: { name:{type:'string'}, score:{type:'number',minimum:0,maximum:10}, essential:{type:'boolean'}, comment:{type:'string'} } } },
    problems: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['component','issue','severity'], properties: { component:{type:'string'}, issue:{type:'string',enum:[...ALLOWED_ISSUES]}, severity:{type:'string',enum:['low','medium','high','critical']} } } },
    improvement: { type: 'string' },
  },
};
const referenceSchema = {
  type: 'object', additionalProperties: false,
  required: ['summary','silhouette','structure','colors','mustPreserve'],
  properties: {
    summary:{type:'string'}, silhouette:{type:'string'}, structure:{type:'array',items:{type:'string'}},
    colors:{type:'array',items:{type:'string'}}, mustPreserve:{type:'array',items:{type:'string'}},
  },
};
const targetedReviewSchema = { type: 'object', additionalProperties: false, required: ['resolved', 'evidence', 'remaining'], properties: {
  resolved: { enum: [true, false, 'partial'] }, evidence: { type: 'string' }, remaining: { type: 'string' },
} };

function bounded(value, n = 1000) { return String(value || '').trim().slice(0, n); }
function event(job, type, message, data = {}) {
  job.events ||= [];
  job.events.push({ id: randomUUID(), at: new Date().toISOString(), type, message, data });
  if (job.events.length > 800) job.events.splice(0, job.events.length - 800);
}
function publicReferenceImages(job) {
  return (job.referenceImages || []).map((image) => {
    const match = String(image).match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    return match ? { mimeType: match[1], data: match[2] } : null;
  }).filter(Boolean).slice(0, 4);
}
function providerFor(job) { return job.provider || getProviderRuntime().provider; }
function visionProviderFor(job) { return job.visionProvider || getVisionRuntime().provider; }

export function normalizeBatchTarget(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw Object.assign(new Error('Le nombre de lots doit être un entier positif.'), { code: 'JOB_INPUT_INVALID' });
  return number;
}

export async function createAssetJob(input = {}) {
  const {name,brief,referenceImages:incomingImages}=normalizeAssetInput(input);
  const status = await getStudioStatus({ refresh: true });
  const studioId = bounded(input.studioId, 140);
  if (!studioId || !status.studios.some((x) => x.id === studioId) || status.access?.studioId !== studioId) {
    throw Object.assign(new Error('Choisis puis autorise une fenêtre Roblox Studio.'), { code: 'STUDIO_ACCESS_REQUIRED' });
  }
  const provider = input.provider || getProviderRuntime().provider;
  const planningProvider = input.planningProvider || provider;
  const planningModel = bounded(input.planningModel || '', 120);
  const visionProvider = input.visionProvider || getVisionRuntime().provider;
  if (provider !== 'local' && !getProviderRuntime(provider).apiKey) throw Object.assign(new Error('Clé API manquante pour ' + provider + '.'), { code: 'PROVIDER_KEY_REQUIRED' });
  if (planningProvider !== 'local' && !getProviderRuntime(planningProvider).apiKey) throw Object.assign(new Error('Clé API manquante pour le planificateur ' + planningProvider + '.'), { code: 'PROVIDER_KEY_REQUIRED' });
  // The server preference is authoritative: an old frontend cannot bypass local-only
  // by sending engine:"auto" or "native".
  const generationMode = getGenerationMode();
  const engine = engineForGenerationMode(generationMode);
  const id = randomUUID();
  const target = input.continuousGeneration === true ? 3 : Math.max(1, Math.min(config.maxVariants, Number(input.variantTarget) || 3));
  const batchTarget = input.continuousGeneration === true ? normalizeBatchTarget(input.batchTarget) : null;
  const requestedSizeStuds=Array.isArray(input.sizeStuds) && input.sizeStuds.length===3 &&
    input.sizeStuds.every(v=>Number.isFinite(Number(v))&&Number(v)>=.2&&Number(v)<=200)
    ? input.sizeStuds.map(Number) : null;
  const maxParts=Math.max(1,Math.min(180,Number(input.maxParts)||180));
  const memoryLessons = await relevantLessons({ name, category: input.category || 'prop', subtype: input.subtype || '' });
  const libraryExamples = await searchLibrary({name,brief,category:input.category||'prop',subtype:input.subtype||''});
  const memoryExamples = [...libraryExamples, ...(await relevantExamples({ name, brief, category: input.category || 'prop', subtype: input.subtype || '' }))].slice(0,3);
  const job = {
    schemaVersion: 2, id, name, brief, category: bounded(input.category || 'prop', 80), subtype: bounded(input.subtype, 80),
    style: bounded(input.style || 'Roblox low-poly stylisé, arêtes franches, palette réduite', 300), studioId, provider, visionProvider, planningProvider, planningModel,
    generationMode, engine, geometryStrategy: 'generic_primitives_v1',
    requestedSizeStuds,maxParts,
    previewDecomposition:input.previewDecomposition===true,planApproved:input.previewDecomposition!==true,
    variantTarget: target, continuousGeneration: input.continuousGeneration === true, batchTarget, activeBatchNumber: 1,
    traceLevel: input.traceLevel === 'off' ? 'off' : 'full',
    qualityPolicy: { initialVariants: target, autoAcceptScore: 8, essentialAcceptMinScore: 8, humanReviewMinScore: 5, essentialReviewMinScore: 5, maxPatchesPerCandidate: 2, maxRebuildsPerObject: 1, maxAttemptsPerObject: 9 },
    autoRebuilds: 0,
    referenceImages: incomingImages,
    referenceAnalysis: null, plan: null, planVersion: 0, variants: [], feedback: [], memoryLessons, memoryExamples, selectedVariantId: null,
    status: 'queued', error: null, stopRequested: false, pendingCorrection: null, recovery: null, events: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  event(job, 'job.created', 'Job de création créé.', {
    provider, planningProvider, planningModel: planningModel || null, visionProvider,
    generationMode, engine, variantTarget: target, batchTarget,
  });
  await saveJob(job);
  await traceArtifact(id, 'inputs', 'job_request', { ...job, referenceImages: job.referenceImages.map((x) => ({ dataUrlBytes: x.length })) }, { phase: 'input' });
  for (let index = 0; index < job.referenceImages.length; index += 1) {
    const match = String(job.referenceImages[index]).match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match) continue;
    const ext = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
    await traceArtifact(id, 'references', 'reference_' + index, Buffer.from(match[2], 'base64'), { phase: 'input', mimeType: match[1], extension: ext });
  }
  schedule(id);
  return job;
}

function schedule(id) {
  if (active.has(id) || queue.includes(id)) return;
  queue.push(id);
  queueMicrotask(drain);
}
async function drain() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift();
      active.add(id);
      try { await runJob(id); }
      finally { active.delete(id); }
    }
  } finally { running = false; }
}

async function withRecovery(jobId, stage, variantId, fn) {
  let previousIncident = null;
  let lastCause = null;
  // Native generation jobs are expensive; repeating the same failed job does not fix an opaque "Failed".
  // Try a different native method in runVariant instead of three identical MCP calls.
  const maxPasses = stage === 'native_build' ? 1 : 3;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    try {
      const result = await fn(pass);
      if (previousIncident) await mutateJob(jobId, (job) => { markRecovered(job, previousIncident); return job; });
      return result;
    } catch (cause) {
      lastCause = cause;
      const snapshot = await mutateJob(jobId, (job) => {
        const incident = recordIncident(job, { stage, variantId, code: cause.code || 'PIPELINE_ERROR', message: cause.message, details: cause.details });
        event(job, 'recovery.incident', cause.message, incident);
        return job;
      });
      const incident = snapshot.recovery.incidents.at(-1);
      previousIncident = incident;
      await traceIncident(snapshot, incident);
      if (incident.circuitBreaker) {
        throw Object.assign(new Error('Arrêt après 3 erreurs identiques : ' + cause.message), { code: 'PIPELINE_CIRCUIT_BREAKER', details: incident });
      }
    }
  }
  // A recovery that exhausted attempts must never silently return undefined.
  throw lastCause || Object.assign(new Error('Récupération épuisée.'), { code: 'RECOVERY_EXHAUSTED' });
}

async function analyzeReferences(job) {
  const images = publicReferenceImages(job);
  if (!images.length || job.referenceAnalysis) return job.referenceAnalysis;
  await mutateJob(job.id, (item) => { item.status = 'understanding'; event(item, 'reference.analysis_started', 'Analyse des références visuelles.'); return item; });
  try {
    const response = await visionStructuredChat({
      provider: visionProviderFor(job),
      messages: [
        { role: 'system', content: 'Analyse les images de référence pour reconstruire un asset 3D Roblox. Décris uniquement ce qui est visuellement observable, surtout silhouette, proportions, composants, courbes, densité, couleurs et détails indispensables. JSON uniquement.' },
        { role: 'user', content: JSON.stringify({ name: job.name, brief: job.brief, category: job.category, subtype: job.subtype }) },
      ],
      images, schema: referenceSchema, traceContext: { runId: job.id, phase: 'reference_understanding', traceLevel: job.traceLevel },
    });
    assertAllowedBrief(response.data.summary||'');
    await mutateJob(job.id, (item) => { item.referenceAnalysis = response.data; event(item, 'reference.analyzed', 'Références analysées.', { model: response.meta.model }); return item; });
    return response.data;
  } catch (cause) {
    if(cause.code==='CONTENT_RESTRICTED')throw cause;
    await mutateJob(job.id, (item) => { event(item, 'reference.analysis_failed', cause.message, { code: cause.code }); return item; });
    return null;
  }
}

async function buildPlan(job, referenceAnalysis) {
  let structuralIssues = [];
  let lastIncident = null;
  let lastPlannerError = null;
  await mutateJob(job.id, (item) => { item.status = 'planning'; event(item, 'plan.started', 'Création du plan 3D.'); return item; });
  const isGeneric = job.geometryStrategy === 'generic_primitives_v1';
  const categoryHint = inferCategory(job);
  const categoryTemplate = isGeneric ? await loadCategoryPrompt(categoryHint) : '';
  for (let attempt = 0; attempt < config.maxPlanAttempts; attempt += 1) {
    try {
      const response = await structuredChat({
        provider: job.planningProvider || providerFor(job),
        modelOverride: job.planningModel || '',
        // JSON planning is deterministic: do not burn long reasoning before answering.
        thinkOverride: (job.planningProvider || providerFor(job)) === 'local' ? config.ollamaPlanningThink : null,
        messages: [
          { role: 'system', content: plannerSystem + (isGeneric ? '\\nMODE: INVOICE COMPONENTS ONLY, NO LOW-LEVEL PARTS. Use category from enum. Keep JSON below 1500 output tokens.\\nCATEGORY_TEMPLATE: '+categoryTemplate : '') },
          { role: 'user', content: plannerUser({ brief: job.brief, category: job.category, subtype: job.subtype, style: job.style, feedback: [...(job.memoryLessons || []).map((x) => ({ source: 'validated_memory', text: x.text })), ...(job.feedback || [])], previousIssues: structuralIssues }) + '\nREFERENCE_ANALYSIS=' + JSON.stringify(referenceAnalysis) + (lastPlannerError ? '\nPREVIOUS_ATTEMPT_ERROR=' + JSON.stringify(lastPlannerError) + '\nCorrect only the identified error and return one complete JSON document.' : '') },
        ],
        schema: isGeneric ? inventorySchema : spatialPlanSchema,
        traceContext: { runId: job.id, phase: 'planning', attempt: attempt + 1, traceLevel: job.traceLevel },
      });
      // Normalize only once: a second pass would discard the original repair
      // audit and could turn a successfully repaired virtual root into noise.
      const requested=job.requestedSizeStuds;
      const plan = normalizeSpatialPlan(requested?{...response.data,sizeStuds:requested}:response.data,null,requested||[10,10,10]);
      if(isGeneric){
        plan.category=resolveCategory(response.data.category,job);
        plan.interpreterVersion=PRIMITIVE_VERSION;
      }
      structuralIssues = plan.structureNormalization?.unresolved || [];
      if (plan.structureNormalization?.repairs?.length) {
        await traceEvent(job.id, 'SPATIAL_PLAN_REPAIRED', {
          repairs: plan.structureNormalization.repairs,
          componentCount: plan.components.length,
        }, { phase: 'planning', attempt: attempt + 1, traceLevel: job.traceLevel });
      }
      const version = (job.planVersion || 0) + 1;
      await mutateJob(job.id, (item) => {
        item.plan = plan; item.planVersion = version;
        event(item, 'plan.ready', 'Plan 3D validé.', { version, repairs: plan.structureNormalization?.repairs?.length || 0, provider: response.meta.provider, model: response.meta.model });
        return item;
      });
      await traceArtifact(job.id, 'plans', 'plan_v' + version, plan, { phase: 'planning' });
      if (lastIncident) await mutateJob(job.id, (item) => { markRecovered(item, lastIncident); return item; });
      return plan;
    } catch (cause) {
      if (Array.isArray(cause.details)) structuralIssues = cause.details;
      lastPlannerError = { code: cause.code || 'PLAN_FAILED',
        message: String(cause.message || '').slice(0, 260),
        issues: Array.isArray(cause.details) ? cause.details.slice(0, 8) : [] };
      const snapshot = await mutateJob(job.id, (item) => {
        const incident = recordIncident(item, { stage: 'planning', code: cause.code || 'PLAN_FAILED', message: cause.message, details: cause.details });
        event(item, 'plan.retry', cause.message, { attempt: attempt + 1, issues: cause.details || [] });
        return item;
      });
      lastIncident = snapshot.recovery.incidents.at(-1);
      await traceIncident(snapshot, lastIncident);
      await traceEvent(job.id, 'PLAN_RETRY_DIAGNOSTIC', {
        reason: cause.code || 'PLAN_FAILED', nextAttempt: attempt + 2,
        think: (job.planningProvider || providerFor(job)) === 'local' ? config.ollamaPlanningThink : null,
        issueCount: structuralIssues.length,
      }, { phase: 'planning', attempt: attempt + 1, traceLevel: job.traceLevel });
      // Repeating a stalled model with identical inputs and settings is not a recovery strategy.
      // Stop after a genuine Ollama timeout and let the user choose another planning model
      // or increase the configured limits; leave normal retries for schema/structure failures.
      if (cause.code === 'AI_TIMEOUT' || lastIncident.circuitBreaker || attempt === config.maxPlanAttempts - 1) {
        throw cause;
      }
    }
  }
}

async function makeGenericGeometry(job, variant){
  const seed=seedFor([job.brief,job.category,variant.profile.id,PRIMITIVE_VERSION].join(':'));
  let lastError=null;
  const source=variant.correctionOf ? job.variants.find(x=>x.id===variant.correctionOf) : null;
  const partial=Boolean(source?.geometryDefinition?.primitives&&source?.geometry?.parts?.length);
  for(let attempt=0;attempt<config.maxGeometryAttempts;attempt+=1){
    try{
      const response=await structuredChat({
        provider:providerFor(job),
        messages:[
          {role:'system',content:genericGeometrySystem + (partial ? '\\nCORRECTION CIBLÉE : produis uniquement les composants modifiés. Les autres composants seront conservés bit pour bit.':'')},
          {role:'user',content:geometryUser({
            plan:job.plan,profile:variant.profile,
            examples:(job.memoryExamples||[]).filter(x=>x.decomposition),
            feedback:[...(job.memoryLessons||[]).map(x=>({source:'validated_memory',text:x.text})),...(job.feedback||[])],
            previousReview:variant.sourceReview||null,
          })}
        ],
        schema:primitiveGeometrySchema,
        traceContext:{runId:job.id,variantId:variant.id,phase:'geometry',attempt:attempt+1,traceLevel:job.traceLevel},
      });
      const built=interpretPrimitives(response.data,job.plan,{
        profile:variant.profile.id,maxParts:job.maxParts||180,minDetail:.2,seed,allowPartial:partial
      });
      const changedIds=new Set(response.data.components.map(x=>x.componentId));
      const combined=partial ? [...source.geometry.parts.filter(p=>!changedIds.has(p.componentId)),...built.parts] : built.parts;
      if(combined.length>(job.maxParts||180))
        throw Object.assign(new Error('Correction dépasse le plafond de pièces.'),{code:'TOO_MANY_PARTS',details:{count:combined.length}});
      const geometry=normalizeGeometry({parts:combined},job.plan);
      const audit=geometryAudit(geometry,job.plan);
      if(!audit.passed)throw Object.assign(new Error('Audit primitives : '+audit.issues.map(x=>x.code).join(', ')),
        {code:'GEOMETRY_AUDIT_FAILED',details:audit.issues});
      const generatedComponents = ensurePrimitiveIds({ primitives: { components: response.data.components } }, { force: true }).primitives.components;
      const finalDefinition = ensurePrimitiveIds({ primitives: { components: partial
        ? [...source.geometryDefinition.primitives.components.filter(x=>!changedIds.has(x.componentId)), ...generatedComponents]
        : generatedComponents } }).primitives;
      if(partial)await traceEvent(job.id,'TARGETED_PRIMITIVE_PATCH',{changedComponents:[...changedIds],retainedParts:source.geometry.parts.length-combined.length+built.parts.length},{variantId:variant.id,phase:'geometry'});
      await traceArtifact(job.id,'plans','primitive_decomposition_'+variant.id,{
        schemaVersion:2,interpreterVersion:PRIMITIVE_VERSION,decomposition:finalDefinition,warnings:built.warnings,
      },{variantId:variant.id,phase:'geometry'});
      await traceEvent(job.id,'PRIMITIVE_GEOMETRY_BUILT',{
        interpreterVersion:PRIMITIVE_VERSION,partCount:geometry.parts.length,
        warnings:built.warnings,seed,category:job.plan.category
      },{variantId:variant.id,phase:'geometry'});
      return {geometry,audit,definition:{
        archetype:null,primitives:finalDefinition,version:PRIMITIVE_VERSION,variation:variant.profile.id,
      },generation:{provider:response.meta.provider,model:response.meta.model,fallback:false}};
    }catch(cause){
      lastError=cause;
      await traceEvent(job.id,'GENERIC_PRIMITIVE_RETRY',{code:cause.code||'PRIMITIVE_ERROR',
        message:cause.message,details:cause.details||null},
        {variantId:variant.id,phase:'geometry',attempt:attempt+1});
    }
  }
  await traceEvent(job.id,'GENERIC_PRIMITIVE_FALLBACK',{
    reason:lastError?.message||'Unknown failure',mode:'legacy_parts'
  },{variantId:variant.id,phase:'geometry'});
  return null;
}

async function preparePatch(job, variant) {
  const source = job.variants.find((entry) => entry.id === variant.correctionOf);
  if (!source) throw Object.assign(new Error('Variante source introuvable.'), { code: 'CORRECTION_SOURCE_MISSING' });
  const definition = definitionForVariant(source);
  if (!definition) {
    const reason = 'Définition de géométrie indisponible pour cet objet.';
    await recordUnsupported({ id: randomUUID(), at: new Date().toISOString(), jobId: job.id, sourceVariantId: source.id, feedback: variant.correctionRequest?.text || '', reason });
    await traceEvent(job.id, 'correction.unsupported', { reason }, { variantId: variant.id, phase: 'correction' });
    return { unsupported: reason, applied: [], rejected: [], feedback: variant.correctionRequest?.text || '', feedbackType: variant.correctionRequest?.feedbackType || 'unsupported', sourceVariantId: source.id, patch: null };
  }
  if (definitionFingerprint(source.geometryDefinition) !== definitionFingerprint(definition)) {
    await mutateJob(job.id, (item) => { item.variants.find((entry) => entry.id === source.id).geometryDefinition = definition; return item; });
  }
  const feedback = variant.correctionRequest?.text || variant.sourceReview?.improvement || variant.paramChange?.issue || '';
  const type = variant.correctionRequest?.feedbackType || feedbackType({ text: feedback });
  const examples = await listCorrectionsForFeedbackType(type, { category: job.category, archetype: definition.archetype });
  if (examples.length) await traceEvent(job.id, 'examples.retrieved', { ids: examples.map((entry) => entry.id), feedbackType: type }, { variantId: variant.id, phase: 'correction' });
  let patch;
  if (variant.paramChange && definition.params) {
    const changed = applyOneChange(definition.params, variant.paramChange);
    patch = { target: 'params', ops: [{ op: 'set', path: variant.paramChange.param, value: changed[variant.paramChange.param] }], reason: variant.paramChange.issue };
  } else {
    const response = await structuredChat({ provider: providerFor(job), messages: [
      { role: 'system', content: patchSystem },
      { role: 'user', content: patchUser({ definition, feedback, componentId: variant.correctionRequest?.componentId, examples }) },
    ], schema: patchSchema, traceContext: { runId: job.id, variantId: variant.id, phase: 'correction', traceLevel: job.traceLevel } });
    patch = response.data;
  }
  await traceEvent(job.id, 'patch.proposed', { patch, sourceVariantId: source.id }, { variantId: variant.id, phase: 'correction' });
  const result = applyPatch(definition, patch);
  for (const rejected of result.rejected) await traceEvent(job.id, 'patch.rejected', rejected, { variantId: variant.id, phase: 'correction' });
  if (result.unsupported) {
    await recordUnsupported({ id: randomUUID(), at: new Date().toISOString(), jobId: job.id, sourceVariantId: source.id, feedback, feedbackType: type, reason: result.unsupported });
    await traceEvent(job.id, 'correction.unsupported', { reason: result.unsupported }, { variantId: variant.id, phase: 'correction' });
  }
  if (result.applied.length) await traceEvent(job.id, 'patch.applied', { operations: result.applied }, { variantId: variant.id, phase: 'correction' });
  return { ...result, patch, feedback, feedbackType: type, examples: examples.map((entry) => entry.id), sourceVariantId: source.id };
}

async function makeGeometry(job, variant) {
  if (variant.preparedPatch) {
    const source = job.variants.find((entry) => entry.id === variant.correctionOf);
    const definition = variant.preparedPatch.definition;
    let raw;
    const profile = { ...source.profile, id: definition.variation || source.geometryDefinition?.variation || source.profile.id };
    if (definition.params) raw = buildProceduralGeometry(definition, job.plan, profile, variant.patchSeed);
    else if (definition.primitives) raw = interpretPrimitives(definition.primitives, job.plan, { profile: profile.id, maxParts: job.maxParts || 180, minDetail: .2 });
    else raw = { parts: definition.parts };
    const geometry = normalizeGeometry(raw, job.plan);
    const audit = geometryAudit(geometry, job.plan);
    if (!audit.passed) throw Object.assign(new Error('Patch géométrique non conforme.'), { code: 'GEOMETRY_AUDIT_FAILED', details: audit.issues });
    return { geometry, audit, definition, generation: { provider: 'targeted_patch', model: null, fallback: false } };
  }
  if (variant.paramChange) {
    const source = job.variants.find((entry) => entry.id === variant.correctionOf);
    const definition = source?.geometryDefinition;
    if (!definition?.params || !archetypes[definition.archetype]) throw new Error('Source paramétrique indisponible pour la correction.');
    const params = applyOneChange(definition.params, variant.paramChange);
    const procedural = buildProceduralGeometry({ ...definition, params }, job.plan, source.profile, seedFor(job.id + ':' + variant.id));
    const geometry = normalizeGeometry(procedural, job.plan);
    const audit = geometryAudit(geometry, job.plan);
    if (!audit.passed) throw Object.assign(new Error('Correction paramétrique non conforme.'), { code: 'GEOMETRY_AUDIT_FAILED', details: audit.issues });
    return { geometry, audit, definition: procedural.definition, generation: { provider: 'structured_review', model: null, fallback: false } };
  }
  if(job.geometryStrategy === 'generic_primitives_v1'){
    const generic=await makeGenericGeometry(job,variant);
    if(generic)return generic;
  }
  let lastError = null;
  const seed = seedFor(job.id + ':' + variant.id);
  const expectedArchetype = guessArchetype(job);
  for (let attempt = 0; attempt < config.maxGeometryAttempts; attempt += 1) {
    try {
      const response = await structuredChat({
        provider: providerFor(job),
        messages: [
          { role: 'system', content: geometrySystem },
          { role: 'user', content: geometryUser({
            plan: job.plan, profile: variant.profile,
            examples: (job.memoryExamples || []).filter(x=>x.archetype && x.params),
            feedback: [...(job.memoryLessons || []).map(x => ({ source:'validated_memory',text:x.text })), ...(job.feedback || [])],
            previousReview: variant.sourceReview || null,
          }) },
        ],
        schema: expectedArchetype ? proceduralGeometrySchema : legacyGeometrySchema,
        traceContext: { runId: job.id, variantId: variant.id, phase: 'geometry', attempt: attempt + 1, traceLevel: job.traceLevel },
      });
      if (expectedArchetype && response.data.archetype !== expectedArchetype)
        throw Object.assign(new Error('Archétype incohérent avec le type demandé : '+response.data.archetype+' au lieu de '+expectedArchetype),
          {code:'ARCHETYPE_MISMATCH'});
      const procedural = response.data.archetype
        ? buildProceduralGeometry(response.data, job.plan, variant.profile, seed)
        : null;
      const geometry = normalizeGeometry(procedural || response.data, job.plan);
      const audit = geometryAudit(geometry, job.plan);
      if (!audit.passed) throw Object.assign(new Error('Géométrie IA non conforme : ' + audit.issues.map(x=>x.code).join(', ')), {code:'GEOMETRY_AUDIT_FAILED',details:audit.issues});
      if (procedural) await traceEvent(job.id, 'PARAMETRIC_GEOMETRY_BUILT', {
        archetype:procedural.definition.archetype, params:procedural.definition.params,
        variation:procedural.definition.variation, bounds:procedural.bounds, partCount:geometry.parts.length,
      }, {phase:'geometry',variantId:variant.id});
      return {geometry,audit,definition:procedural?.definition||null,generation:{provider:response.meta.provider,model:response.meta.model,fallback:false}};
    } catch(cause) {
      lastError=cause;
      await traceEvent(job.id,'GEOMETRY_RETRY',{code:cause.code||'GEOMETRY_ERROR',message:cause.message},
        {variantId:variant.id,phase:'geometry',attempt:attempt+1});
    }
  }
  // Known types still receive a meaningful parametric asset when the LLM fails.
  const guessed=guessArchetype(job);
  if (guessed) {
    try {
      const procedural=buildProceduralGeometry({archetype:guessed,params:{},variation:variant.profile.id},job.plan,variant.profile,seed);
      const geometry=normalizeGeometry(procedural,job.plan);
      const audit=geometryAudit(geometry,job.plan);
      if (!audit.passed) throw Object.assign(new Error('Audit géométrique fallback invalide.'),{code:'GEOMETRY_AUDIT_FAILED',details:audit.issues});
      await traceEvent(job.id,'GEOMETRY_PARAMETRIC_FALLBACK',{archetype:guessed,reason:lastError?.message,audit},
        {variantId:variant.id,phase:'geometry'});
      return {geometry,audit,definition:procedural.definition,generation:{provider:'deterministic_archetype',model:null,fallback:true}};
    } catch(cause) {lastError=cause;}
  }
  const geometry=fallbackGeometry(job.plan,seed,variant.profile);
  const audit=geometryAudit(geometry,job.plan);
  await traceEvent(job.id,'GEOMETRY_DETERMINISTIC_FALLBACK',{reason:lastError?.message,audit},
    {variantId:variant.id,phase:'geometry'});
  return {geometry,audit,definition:null,generation:{provider:'deterministic_fallback',model:null,fallback:true}};
}

async function reviewVariant(job, variant) {
  if (!config.autoReview || !variant.captures?.length) return null;
  const captureImages = variant.captures.map((x) => ({ mimeType: x.mimeType, data: x.data }));
  const refs = publicReferenceImages(job);
  // Experimental metric runs beside visual critique; it never changes review scores.
  if (refs.length) {
    const diagnostic = referenceSimilarity(refs,captureImages);
    try {await traceEvent(job.id,'REFERENCE_SIMILARITY_EXPERIMENT',diagnostic,
      {phase:'review',variantId:variant.id,traceLevel:job.traceLevel});}
    catch(cause){console.warn('[RAC][REFERENCE_SIMILARITY_TRACE]',cause.message);}
  }
  try {
    const response = await visionStructuredChat({
      provider: visionProviderFor(job),
      messages: [
        { role: 'system', content: reviewSystem },
        { role: 'user', content: JSON.stringify({
          asset: job.name, brief: job.brief, plan: job.plan,
          variation: variant.profile, technicalAudit: variant.technicalAudit,
          essentialCriteria: job.plan.essentialCriteria,
          imageOrder: refs.length ? 'Les premières images sont les références utilisateur, puis viennent les trois captures Studio.' : 'Les images sont les trois captures Studio.',
        }) },
      ],
      images: [...refs, ...captureImages],
      schema: reviewSchema,
      traceContext: { runId: job.id, variantId: variant.id, phase: 'review', traceLevel: job.traceLevel },
    });
    return { ...response.data, provider: response.meta.provider, model: response.meta.model, technicalPassed: variant.technicalAudit?.passed === true };
  } catch (cause) {
    await traceEvent(job.id, 'REVIEW_UNAVAILABLE', { code: cause.code, message: cause.message }, { variantId: variant.id, phase: 'review' });
    return null;
  }
}

async function recordGenerationVersion(job, variant) {
  await recordGeneration({ id: variant.id, jobId: job.id, at: variant.finishedAt || new Date().toISOString(), brief: job.brief,
    category: job.category, archetype: variant.geometryDefinition?.archetype || null,
    mode: variant.geometryDefinition?.primitives ? 'primitives' : variant.geometryDefinition?.parts ? 'legacy_parts' : variant.engineUsed === 'native' ? 'native' : 'params',
    definition: variant.geometryDefinition || null, definitionFingerprint: definitionFingerprint(variant.geometryDefinition),
    geometryFingerprint: geometryFingerprint(variant.geometry), engine: variant.engineUsed, schemaVersion: job.schemaVersion,
    status: variant.status, correctionStatus: variant.correctionStatus || null });
}

async function finishUnappliedPatch(job, variant, result) {
  const status = result.unsupported ? 'unsupported' : 'no_effect';
  const reason = result.unsupported || 'La correction n’a modifié aucun élément. Le retour n’a pas été appliqué.';
  const finished = await mutateJob(job.id, (item) => {
    const target = item.variants.find((entry) => entry.id === variant.id);
    target.status = 'done'; target.finishedAt = new Date().toISOString(); target.correctionStatus = status;
    target.correctionReason = reason; target.patch = result.patch; target.appliedOps = result.applied; target.rejectedOps = result.rejected;
    target.correctionDecision = { keep: false, reason: status }; target.changedFields = [];
    event(item, `correction.${status}`, reason, { variantId: variant.id, sourceVariantId: result.sourceVariantId });
    return item;
  });
  await traceEvent(job.id, `correction.${status}`, { reason }, { variantId: variant.id, phase: 'correction' });
  await recordCorrection({ kind: 'attempt', id: variant.correctionId || variant.id, at: new Date().toISOString(), jobId: job.id,
    sourceVariantId: result.sourceVariantId, variantId: variant.id, feedbackType: result.feedbackType,
    feedback: result.feedback, patch: result.patch, applied: result.applied, rejected: result.rejected,
    changed: false, changedFields: [], status, reason, category: job.category });
  await recordGenerationVersion(finished, finished.variants.find((entry) => entry.id === variant.id));
}

async function assessCorrection(job, variant, captures) {
  const source = job.variants.find((entry) => entry.id === (variant.correctionOf || variant.rebuildOf));
  const change = compareVersions(source, variant);
  const beforeImages = [], afterImages = [];
  for (const capture of source?.captures || []) {
    const matching = captures.find((entry) => entry.view === capture.view);
    if (!matching) continue;
    const file = capturePath(job.id, capture.fileName);
    if (!file) continue;
    try {
      const before = await readFile(file), after = Buffer.from(matching.data, 'base64');
      beforeImages.push({ mimeType: capture.mimeType, data: before.toString('base64') });
      afterImages.push({ mimeType: matching.mimeType, data: matching.data });
    } catch {}
  }
  const captureChanged = beforeImages.length > 0 && beforeImages.some((image, index) =>
    createHash('sha256').update(image.data).digest('hex') !== createHash('sha256').update(afterImages[index].data).digest('hex'));
  const changed = source?.engineUsed === 'native' ? captureChanged : change.changed && captureChanged;
  let targetedReview = null;
  if (changed && beforeImages.length) {
    try {
      const response = await visionStructuredChat({ provider: visionProviderFor(job), messages: [
        { role: 'system', content: targetedReviewSystem },
        { role: 'user', content: JSON.stringify({ feedback: variant.correctionRequest?.text || variant.sourceReview?.improvement || variant.paramChange?.issue || '', component: variant.correctionRequest?.componentId || null, imageOrder: 'Vues avant, puis vues après, dans le même ordre.' }) },
      ], images: [...beforeImages, ...afterImages], schema: targetedReviewSchema,
      traceContext: { runId: job.id, variantId: variant.id, phase: 'targeted_review', traceLevel: job.traceLevel } });
      targetedReview = response.data;
      await traceEvent(job.id, 'review.targeted', targetedReview, { variantId: variant.id, phase: 'targeted_review' });
    } catch (cause) {
      targetedReview = { resolved: false, evidence: '', remaining: `Revue ciblée indisponible : ${cause.code || 'VISION_ERROR'}` };
      await traceEvent(job.id, 'review.targeted', targetedReview, { variantId: variant.id, phase: 'targeted_review' });
    }
  }
  const status = correctionOutcome(change, captureChanged, beforeImages.length > 0, targetedReview, source?.engineUsed === 'native');
  const reason = status === 'no_effect' ? 'La définition, la géométrie ou les captures n’ont pas changé.'
    : status === 'resolved' ? targetedReview.evidence : targetedReview?.remaining || 'Changement non confirmé par la revue ciblée.';
  return { ...change, changed, captureChanged, targetedReview, status, reason };
}

export function correctionOutcome(change, captureChanged, capturesAvailable, targetedReview, native = false) {
  const definitelyNoEffect = native ? capturesAvailable && !captureChanged
    : !change.definitionChanged || !change.geometryChanged || capturesAvailable && !captureChanged;
  if (definitelyNoEffect) return 'no_effect';
  const changed = native ? captureChanged : change.changed && captureChanged;
  return changed && targetedReview?.resolved === true ? 'resolved' : 'unresolved';
}

async function runVariant(jobId, variantId) {
  let job = await getJob(jobId);
  let variant = job.variants.find((x) => x.id === variantId);
  if (!variant || variant.status === 'done') return;
  await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.startedAt ||= new Date().toISOString(); v.status='generating'; event(item,'variant.generating',v.profile.label,{variantId}); return item; });
  job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);

  if (variant.correctionOf && (variant.correctionRequest?.mode === 'patch' || variant.paramChange)) {
    const source = job.variants.find((entry) => entry.id === variant.correctionOf);
    if (source?.engineUsed !== 'native' && !variant.preparedPatch) {
      const prepared = await preparePatch(job, variant);
      if (prepared.unsupported || !prepared.applied?.length) { await finishUnappliedPatch(job, variant, prepared); return; }
      await mutateJob(jobId, (item) => {
        const target = item.variants.find((entry) => entry.id === variantId);
        target.preparedPatch = prepared; target.patchSeed = source.buildSeed || seedFor(job.id + ':' + source.id);
        return item;
      });
      job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);
    }
  }

  const selectedMode = generationModeForJob(job);
  let engine = engineForJob(job);
  // A job's mode is fixed when it is created; changing settings cannot silently
  // switch the geometry engine of a queued, resumed, or corrected job.
  await traceEvent(job.id, 'GENERATION_MODE_SELECTED', {
    mode: selectedMode, requestedEngine: engine, variantId,
  }, { phase: 'generation', variantId, traceLevel: job.traceLevel });
  const tools = (await listStudioTools()).map((x) => x.name);
  if (engine === 'auto') {
    const category=job.plan?.category||inferCategory(job);
    const organic=['animal','vegetation'].includes(category) ||
      (category==='generic' && /rock|stone|pierre|roche|rocher/i.test(job.brief));
    const wantNative=job.geometryStrategy !== 'generic_primitives_v1' || organic;
    engine = wantNative && tools.includes(job.plan.nativeMethod) && tools.includes('wait_job_finished')
      ? 'native' : 'parts';
  }
  if (variant.correctionOf && (variant.correctionRequest?.mode === 'patch' || variant.paramChange)) {
    const source = job.variants.find((entry) => entry.id === variant.correctionOf);
    engine = source?.engineUsed === 'native' ? 'native' : 'parts';
  }
  if (engine === 'native' && (!tools.includes(job.plan.nativeMethod) || !tools.includes('wait_job_finished'))) {
    throw Object.assign(new Error('La génération native demandée nécessite ' + job.plan.nativeMethod + ' et wait_job_finished dans le serveur MCP Roblox.'), {
      code: 'NATIVE_TOOL_UNAVAILABLE', details: { nativeMethod: job.plan.nativeMethod, availableTools: tools },
    });
  }

  if (engine === 'parts') {
    const generated = await makeGeometry(job, variant);
    await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.geometry=generated.geometry; v.geometryAudit=generated.audit; v.generation=generated.generation; v.geometryDefinition=generated.definition; v.buildSeed ||= v.patchSeed || seedFor(job.id + ':' + variantId); v.status='building'; return item; });
    job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);
    const bounds = await withRecovery(jobId, 'studio_build', variantId, () => buildPartsVariant(job, variant));
    await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.bounds=bounds; v.engineUsed='parts'; v.generationSource='local_parts'; v.status='auditing'; event(item,'variant.built','Variante construite par Parts.',{variantId}); return item; });
  } else {
    try {
      // If the preferred native generator fails, try a different supported generator once.
      // Never run three identical expensive native jobs whose previous result was "Failed".
      const alternatives = [job.plan.nativeMethod, job.plan.nativeMethod === 'generate_mesh' ? 'generate_procedural_model' : 'generate_mesh']
        .filter((method, index, methods) => tools.includes(method) && methods.indexOf(method) === index);
      let bounds = null;
      let lastNativeError = null;
      for (const method of alternatives) {
        try {
          bounds = await withRecovery(jobId, 'native_build', variantId,
            () => buildNativeVariant(job, variant, { methodOverride: method }));
          break;
        } catch (cause) {
          lastNativeError = cause;
          await mutateJob(jobId, (item) => {
            event(item, 'variant.native_method_failed',
              'Méthode ' + method + ' échouée : ' + cause.message,
              { variantId, method, code: cause.code, details: {
                status: cause.details?.status || null,
                reason: cause.details?.reason || null,
                mcpDiagnostics: cause.details?.mcpDiagnostics || null,
              } });
            return item;
          });
          if (['STUDIO_ACCESS_REQUIRED', 'STUDIO_NOT_CONNECTED', 'MCP_NOT_CONNECTED', 'MCP_EXITED'].includes(cause.code)) break;
        }
      }
      if (!bounds) throw lastNativeError || Object.assign(new Error('Aucune méthode native utilisable.'), { code: 'NATIVE_METHOD_UNAVAILABLE' });
      if (lastNativeError) await mutateJob(jobId, (item) => {
        const previous = item.recovery?.incidents?.at(-1);
        if (previous?.stage === 'native_build' && previous?.variantId === variantId) markRecovered(item, previous);
        return item;
      });
      await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.bounds=bounds; v.engineUsed='native'; v.generationSource='roblox_native'; v.status='auditing'; event(item,'variant.built','Variante générée nativement par Roblox.',{variantId,method:bounds.nativeMethod}); return item; });
    } catch (cause) {
      if (engineForJob(job) !== 'auto') throw cause;
      await mutateJob(jobId, (item) => { event(item,'variant.native_fallback','Génération native indisponible, repli Parts.',{variantId,reason:cause.message}); return item; });
      job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);
      const generated = await makeGeometry(job, variant);
      await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.geometry=generated.geometry; v.geometryAudit=generated.audit; v.generation=generated.generation; v.geometryDefinition=generated.definition; v.status='building'; return item; });
      job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);
      const bounds = await withRecovery(jobId, 'studio_build', variantId, () => buildPartsVariant(job, variant));
      await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.bounds=bounds; v.engineUsed='parts_fallback'; v.generationSource='local_parts'; v.status='auditing'; return item; });
    }
  }

  job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);
  const technicalAudit = await withRecovery(jobId, 'technical_audit', variantId, () => auditVariant(job, variant));
  await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.technicalAudit=technicalAudit; v.status='capturing'; return item; });

  job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);
  const captures = await withRecovery(jobId, 'capture', variantId, () => captureThreeViews(job, variant));
  await mutateJob(jobId, (item) => {
    const v=item.variants.find((x)=>x.id===variantId);
    v.captures=captures.map(({data,...rest})=>rest);
    v._captureData=captures;
    v.status='reviewing';
    return item;
  });
  job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);
  variant.captures = (variant._captureData || captures);
  const review = await reviewVariant(job, variant);
  const captureHashes = await Promise.all(captures.map(async (capture) => {
    const result = await saveCapture(Buffer.from(capture.data, 'base64'), capture.mimeType === 'image/jpeg' ? 'jpg' : 'png');
    return { view: capture.view, hash: result.hash };
  }));
  const correction = (variant.correctionOf || variant.rebuildOf && variant.correctionRequest) ? await assessCorrection(job, variant, captures) : null;
  await mutateJob(jobId, (item) => {
    const v=item.variants.find((x)=>x.id===variantId);
    delete v._captureData;
    v.review=review; v.defects=review ? normalizeReview(review).defects : []; v.status='done'; v.finishedAt=new Date().toISOString(); v.captureHashes = captureHashes;
    if (correction) {
      v.correctionStatus = correction.status; v.correctionReason = correction.reason;
      v.changeReport = { changed: correction.changed, definitionChanged: correction.definitionChanged, geometryChanged: correction.geometryChanged, captureChanged: correction.captureChanged };
      v.changedFields = correction.changedFields; v.targetedReview = correction.targetedReview;
      v.patch = v.preparedPatch?.patch || null; v.appliedOps = v.preparedPatch?.applied || []; v.rejectedOps = v.preparedPatch?.rejected || [];
      if (correction.status === 'no_effect') v.correctionDecision = { keep: false, reason: 'no_effect' };
      delete v.preparedPatch;
      event(item, `correction.${correction.status}`, correction.reason, { variantId, sourceVariantId: v.correctionOf || v.rebuildOf, changedFields: v.changedFields });
    }
    event(item,'variant.done',review ? `Variante terminée · ${Number(review.score).toFixed(1)}/10` : 'Variante terminée · critique IA indisponible',{
      variantId, engineUsed: v.engineUsed, generationSource: v.generationSource || generationSourceForEngine(v.engineUsed),
    });
    return item;
  });
  const finishedJob = await getJob(jobId);
  const finishedVariant = finishedJob.variants.find(v=>v.id===variantId);
  await recordGenerationVersion(finishedJob, finishedVariant);
  if (correction) {
    await recordCorrection({ kind: 'attempt', id: finishedVariant.correctionId || finishedVariant.id, at: new Date().toISOString(), jobId,
      sourceVariantId: finishedVariant.correctionOf || finishedVariant.rebuildOf, variantId, feedbackType: finishedVariant.correctionRequest?.feedbackType || feedbackType({ text: finishedVariant.correctionRequest?.text || finishedVariant.sourceReview?.improvement || finishedVariant.paramChange?.issue }),
      feedback: finishedVariant.correctionRequest?.text || finishedVariant.sourceReview?.improvement || null,
      patch: finishedVariant.patch, applied: finishedVariant.appliedOps, rejected: finishedVariant.rejectedOps,
      changed: correction.changed, changedFields: correction.changedFields, status: correction.status, reason: correction.reason,
      targetedReview: correction.targetedReview, category: finishedJob.category, archetype: finishedVariant.geometryDefinition?.archetype || null });
    await traceEvent(jobId, `correction.${correction.status}`, { reason: correction.reason, changedFields: correction.changedFields }, { variantId, phase: 'correction' });
  }
  try { await recordVariantMetric(finishedJob,finishedVariant); }
  catch(cause) { await traceEvent(jobId,'METRICS_WRITE_ERROR',{code:cause.code||null,message:cause.message},{phase:'metrics',variantId}); }
}

function createVariant(job, order, extra = {}) {
  const profile = variationProfiles[order % variationProfiles.length];
  const id = randomUUID();
  return {
    id, order, profile, planVersion: job.planVersion, batchNumber: job.activeBatchNumber || 1,
    rebuildOf: job.rebuildSourceVariantId || null, status: 'pending',
    ...(job.rebuildCorrection ? { correctionRequest: job.rebuildCorrection, correctionId: id } : {}),
    geometry: null, bounds: null, technicalAudit: null, captures: [], review: null, engineUsed: null, generationSource: null,
    createdAt: new Date().toISOString(), ...extra,
  };
}

async function runFull(job) {
  const referenceAnalysis = await analyzeReferences(job);
  job = await getJob(job.id);
  if (!job.plan) await buildPlan(job, referenceAnalysis);
  job = await getJob(job.id);
  if (job.previewDecomposition && !job.planApproved) {
    await mutateJob(job.id,item=>{
      item.status='awaiting_decomposition_review';
      event(item,'plan.review_required','Inventaire prêt : validation humaine avant construction.');
      return item;
    });
    return;
  }
  const current = job.variants.filter((x) => x.planVersion === job.planVersion && !x.correctionOf);
  if (current.length < job.variantTarget) {
    await mutateJob(job.id, (item) => {
      const existing = item.variants.filter((x) => x.planVersion === item.planVersion && !x.correctionOf).length;
      for (let i = existing; i < item.variantTarget; i += 1) item.variants.push(createVariant(item, item.variants.length));
      item.status = 'generating';
      return item;
    });
  }
  job = await getJob(job.id);
  for (const variant of job.variants.filter((x) => x.planVersion === job.planVersion && !x.correctionOf && x.status !== 'done')) {
    const fresh = await getJob(job.id);
    if (fresh.stopRequested) return;
    await runVariant(job.id, variant.id);
  }
}

async function runPatch(job, correction) {
  const source = job.variants.find((x) => x.id === correction.variantId) || job.variants.find((x) => x.id === job.selectedVariantId) || [...job.variants].sort((a,b)=>(b.review?.score||0)-(a.review?.score||0))[0];
  if (!source) throw Object.assign(new Error('Aucune variante source à corriger.'), { code: 'CORRECTION_SOURCE_MISSING' });
  const order = job.variants.length;
  const variant = createVariant(job, order, { correctionOf: source.id, correctionId: correction.id, correctionRequest: correction,
    profile: { id: 'correction', label: 'Correction', instruction: 'Applique précisément ce retour : ' + correction.text.slice(0, 500) + '. Conserve les éléments déjà corrects.' }, sourceReview: source.review || null });
  await mutateJob(job.id, (item) => { item.variants.push(variant); item.pendingCorrection=null; item.status='generating'; event(item,'correction.started',correction.text,{sourceVariantId:source.id,variantId:variant.id}); return item; });
  await runVariant(job.id, variant.id);
}

async function autoImprove(jobId) {
  for (let cycle = 0; cycle < 4; cycle += 1) {
    let job = await getJob(jobId);
    const current = job.variants.filter((variant) => variant.planVersion === job.planVersion);
    const eligible = job.variants.filter((variant) => !variant.correctionDecision || variant.correctionDecision.keep);
    const decision = qualityBatchDecision(eligible, {
      planVersion: job.planVersion,
      policy: job.qualityPolicy,
      attemptsUsed: job.variants.filter((variant) => variant.review || ['done','failed'].includes(variant.status)).length,
      rebuildsUsed: job.autoRebuilds || 0,
      patchesUsed: current.filter((variant) => variant.correctionOf).length,
      patchable: true,
    });
    const best = rankQualityVariant(current.filter((variant) => !variant.correctionDecision || variant.correctionDecision.keep), job.qualityPolicy);
    if (!best?.review) return;
    const normalized = normalizeReview(best.review);
    const history = job.reviewHistory?.length ? job.reviewHistory : [normalized];
    const stopping = shouldStop(history, { acceptScore: job.qualityPolicy?.autoAcceptScore ?? 8 });
    const archetypeId = best.geometryDefinition?.archetype || job.plan?.archetype || null;
    const parameterSchema = archetypeId ? archetypes[archetypeId]?.schema || null : null;
    const planned = planCorrections(normalized.defects, archetypeId, parameterSchema);
    const canChange = Boolean(best.geometryDefinition?.params && best.geometryDefinition.archetype === archetypeId && best.engineUsed !== 'native');
    if (!canChange && planned.changes.length) {
      planned.instructions.push(...planned.changes.map((change) => ({ issue: change.issue, component: 'asset' })));
      planned.changes.length = 0;
    }
    await mutateJob(jobId, (item) => {
      item.qualityDecision = decision;
      item.reviewHistory ||= [normalized];
      event(item, 'quality.decision', decision.accepted ? 'Qualité automatique validée.' : 'Évaluation de la prochaine amélioration.', { cycle: cycle + 1, ...decision });
      return item;
    });
    const record = async (details) => {
      await mutateJob(jobId, (item) => {
        event(item, 'review.defects', 'Revue structurée des défauts.', { variantId: best.id, defects: normalized.defects, ...details });
        return item;
      });
      await traceEvent(jobId, 'review.defects', { variantId: best.id, defects: normalized.defects, ...details }, { variantId: best.id, phase: 'review', traceLevel: job.traceLevel });
    };
    if (stopping.stop || decision.accepted || decision.finished) {
      await record({ changes: [], keepCorrection: null, stopReason: stopping.reason || (decision.accepted ? 'accepted' : 'limit') });
      return;
    }
    if (planned.changes.length && decision.needsCorrection) {
      const change = planned.changes[0];
      const variant = createVariant(job, job.variants.length, {
        correctionOf: best.id,
        profile: { id:'auto_patch', label:'Auto-correction', instruction:'Corrige précisément les problèmes mesurés par la critique visuelle, conserve les critères déjà bons et améliore la conformité.' },
        sourceReview: best.review,
        paramChange: change,
      });
      await mutateJob(jobId, (item) => {
        item.variants.push(variant);
        event(item, 'quality.auto_patch', 'Correction automatique de la meilleure variante.', { sourceVariantId: best.id, variantId: variant.id, score: best.review.score });
        return item;
      });
      await runVariant(jobId, variant.id);
      const after = await getJob(jobId);
      const result = after.variants.find((entry) => entry.id === variant.id);
      const nextReview = result.review ? normalizeReview(result.review) : { score: 0, defects: [] };
      const keep = result.correctionStatus === 'no_effect' || result.correctionStatus === 'unsupported'
        ? { keep: false, reason: result.correctionStatus }
        : result.review ? keepCorrection(normalized, nextReview) : { keep: false, reason: 'review_unavailable' };
      const nextHistory = [...history, nextReview];
      const stop = shouldStop(nextHistory, { acceptScore: job.qualityPolicy?.autoAcceptScore ?? 8 });
      await mutateJob(jobId, (item) => {
        item.variants.find((entry) => entry.id === variant.id).correctionDecision = keep;
        item.reviewHistory = nextHistory;
        return item;
      });
      await record({ changes: [change], correctedVariantId: variant.id, keepCorrection: keep, stopReason: stop.stop ? stop.reason : null });
      if (stop.stop) return;
      continue;
    }
    if (planned.instructions.length) await mutateJob(jobId, (item) => {
      for (const instruction of planned.instructions) item.feedback.push({ id:randomUUID(), at:new Date().toISOString(), source:'auto_review', mode:'rebuild', variantId:best.id, text:`Corrige : ${instruction.issue} sur ${instruction.component}` });
      return item;
    });
    if (decision.needsRegenerate && !planned.instructions.length && !planned.rebuilds.length) {
      const profile = variationProfiles[(job.variants.length + 1) % variationProfiles.length];
      const variant = createVariant(job, job.variants.length, {
        convergenceOf: best.id,
        profile: { ...profile, label: 'Convergence · ' + profile.label, instruction: profile.instruction + ' Tiens compte de la meilleure critique précédente et cherche une amélioration nette.' },
        sourceReview: best.review,
      });
      await mutateJob(jobId, (item) => {
        item.variants.push(variant);
        event(item, 'quality.regenerate', 'Nouvelle stratégie de variante pour sortir de la stagnation.', { sourceVariantId: best.id, variantId: variant.id, score: best.review.score });
        return item;
      });
      await runVariant(jobId, variant.id);
      await record({ changes: [], keepCorrection: null, stopReason: null });
      continue;
    }
    if ((planned.rebuilds.length || planned.instructions.length) &&
        (job.autoRebuilds || 0) < (job.qualityPolicy?.maxRebuildsPerObject ?? 1) &&
        !decision.attemptBudgetExhausted) {
      const problems = planned.rebuilds.map((problem) => problem.component + ': ' + problem.issue).join('; ');
      await mutateJob(jobId, (item) => {
        item.autoRebuilds = (item.autoRebuilds || 0) + 1;
        item.rebuildSourceVariantId = best.id;
        item.feedback.push({ id:randomUUID(), at:new Date().toISOString(), source:'auto_review', mode:'rebuild', variantId:best.id, text:'Rebuild demandé par le contrôle qualité. ' + best.review.improvement + (problems ? ' Problèmes: ' + problems : '') });
        item.plan = null;
        item.status = 'planning';
        event(item, 'quality.auto_rebuild', 'Reconstruction automatique du plan 3D.', { sourceVariantId: best.id, score: best.review.score });
        return item;
      });
      job = await getJob(jobId);
      await buildPlan(job, job.referenceAnalysis);
      job = await getJob(jobId);
      await mutateJob(jobId, (item) => {
        for (let i = 0; i < item.variantTarget; i += 1) item.variants.push(createVariant(item, i));
        item.status = 'generating';
        return item;
      });
      job = await getJob(jobId);
      for (const variant of job.variants.filter((variant) => variant.planVersion === job.planVersion && !variant.correctionOf && variant.status !== 'done')) await runVariant(jobId, variant.id);
      await record({ changes: [], rebuilds: planned.rebuilds, keepCorrection: null, stopReason: null });
      continue;
    }
    await record({ changes: [], instructions: planned.instructions, keepCorrection: null, stopReason: 'limit' });
    return;
  }
}

export function nextContinuousBatch(job) {
  if (job.stopRequested) return null;
  const batchNumber = job.activeBatchNumber || 1;
  const variants = (job.variants || []).filter((variant) => (variant.batchNumber || 1) === batchNumber && !variant.correctionOf);
  if (variants.length < 3 || variants.some((variant) => variant.status !== 'done')) return null;
  return { batchNumber, nextBatchNumber: batchNumber + 1, variantIds: variants.map((variant) => variant.id) };
}

export function continuousBatchTargetReached(job) {
  return Number.isSafeInteger(job.batchTarget) && job.batchTarget > 0 && (job.completedBatchNumber || 0) >= job.batchTarget;
}

async function runContinuous(jobId) {
    let job = await getJob(jobId);
    if (job.stopRequested) {
      await mutateJob(jobId, (item) => { item.status = 'stopped'; event(item, 'job.stopped', 'Génération en série arrêtée.'); return item; });
      return;
    }
    const state = nextContinuousBatch(job);
    if (!state) throw Object.assign(new Error('Le lot courant est incomplet.'), { code: 'CONTINUOUS_BATCH_INCOMPLETE' });
    const batch = state.batchNumber;
    if ((job.completedBatchNumber || 0) < batch) {
      await mutateJob(jobId, (item) => {
        item.completedBatchNumber = batch;
        event(item, 'batch.ready', 'Lot de variantes prêt pour la revue.', { batchNumber: batch, variantIds: state.variantIds });
        return item;
      });
    }
    job = await getJob(jobId);
    if (job.pendingCorrection) {
      const correction = job.pendingCorrection;
      if (correction.mode === 'patch') {
        await runPatch(job, correction);
      } else {
        await mutateJob(jobId, (item) => { item.plan = null; item.pendingCorrection = null; item.status = 'queued'; item.activeBatchNumber = batch + 1; item.rebuildSourceVariantId = correction.variantId || null; item.rebuildCorrection = correction; event(item, 'correction.rebuild_started', 'Reconstruction du plan demandée.'); return item; });
        job = await getJob(jobId);
        await runFull(job);
        if ((await getJob(jobId)).status === 'awaiting_decomposition_review') return;
      }
      if (!queue.includes(jobId)) queue.push(jobId);
      return;
    }
    if (continuousBatchTargetReached(job)) {
      await mutateJob(jobId, (item) => {
        item.status = 'review_ready';
        const candidates = item.variants.filter((variant) => variant.status === 'done' && (!variant.correctionDecision || variant.correctionDecision.keep));
        const best = rankQualityVariant(candidates, item.qualityPolicy) || [...candidates].sort((a,b)=>(b.review?.score ?? -1)-(a.review?.score ?? -1))[0];
        item.bestVariantId = best?.id || null;
        event(item, 'batch.target_reached', 'Nombre de lots demandé terminé. Variantes prêtes pour la revue.', { completedBatchNumber: item.completedBatchNumber, batchTarget: item.batchTarget });
        return item;
      });
      return;
    }
    const nextBatch = state.nextBatchNumber;
    const created = await mutateJob(jobId, (item) => {
      if (item.stopRequested) return item;
      item.activeBatchNumber = nextBatch;
      item.status = 'generating';
      item.rebuildCorrection = null; item.rebuildSourceVariantId = null;
      for (let index = 0; index < 3; index += 1) item.variants.push(createVariant(item, item.variants.length));
      event(item, 'batch.started', 'Nouveau lot de trois variantes.', { batchNumber: nextBatch });
      return item;
    });
    if (created.stopRequested) {
      await mutateJob(jobId, (item) => { item.status = 'stopped'; return item; });
      return;
    }
    for (const variant of created.variants.filter((entry) => entry.batchNumber === nextBatch)) {
      if ((await getJob(jobId)).stopRequested) break;
      await runVariant(jobId, variant.id);
    }
    if ((await getJob(jobId)).stopRequested) {
      await mutateJob(jobId, (item) => { item.status = 'stopped'; event(item, 'job.stopped', 'Génération en série arrêtée.'); return item; });
      return;
    }
    if (!queue.includes(jobId)) queue.push(jobId);
}

async function runJob(id) {
  let job = await getJob(id);
  if (!job || job.stopRequested || ['review_ready','saved','stopped'].includes(job.status)) return;
  try {
    await traceEvent(id, 'JOB_STARTED', { name: job.name, provider: job.provider, generationMode: generationModeForJob(job), engine: engineForJob(job) }, { phase: 'job' });
    if (job.continuousGeneration) {
      await runFull(job);
      if ((await getJob(id)).status === 'awaiting_decomposition_review') return;
      await runContinuous(id);
      return;
    }
    if (job.pendingCorrection?.mode === 'patch') await runPatch(job, job.pendingCorrection);
    else {
      if (job.pendingCorrection?.mode === 'rebuild') {
        await mutateJob(id, (item) => { item.plan=null; item.rebuildSourceVariantId=item.pendingCorrection?.variantId||null; item.rebuildCorrection=item.pendingCorrection; item.pendingCorrection=null; item.status='queued'; event(item,'correction.rebuild_started','Reconstruction du plan demandée.'); return item; });
        job = await getJob(id);
      }
      await runFull(job);
      const afterFull = await getJob(id);
      if(afterFull?.status==='awaiting_decomposition_review')return;
      if (afterFull.rebuildCorrection) await mutateJob(id, (item) => { item.rebuildCorrection = null; item.rebuildSourceVariantId = null; return item; });
      await autoImprove(id);
    }
    job = await getJob(id);
    if (job.stopRequested) {
      await mutateJob(id, (item) => { item.status='stopped'; event(item,'job.stopped','Arrêt demandé.'); return item; });
      return;
    }
    const candidates = job.variants.filter((x) => x.status === 'done');
    const retained = candidates.filter((x) => !x.correctionDecision || x.correctionDecision.keep);
    const best = rankQualityVariant(retained, job.qualityPolicy) || [...retained].sort((a,b)=>(b.review?.score ?? -1)-(a.review?.score ?? -1))[0];
    await mutateJob(id, (item) => {
      item.status='review_ready'; item.error=null;
      item.bestVariantId=best?.id || null;
      event(item,'job.review_ready','Création terminée : sélection utilisateur requise.',{bestVariantId:best?.id||null,bestScore:best?.review?.score??null});
      return item;
    });
    await traceEvent(id, 'JOB_REVIEW_READY', { bestVariantId: best?.id || null, bestScore: best?.review?.score ?? null }, { phase: 'job' });
  } catch (cause) {
    const failed = await getJob(id).catch(() => null);
    const attempted = [...(failed?.variants || [])].reverse().find((entry) =>
      (entry.correctionOf || entry.rebuildOf && entry.correctionRequest) && !['done','failed'].includes(entry.status));
    if (attempted) {
      await mutateJob(id, (item) => {
        const target = item.variants.find((entry) => entry.id === attempted.id);
        target.status = 'failed'; target.correctionStatus = 'unresolved'; target.correctionReason = `Échec technique : ${cause.code || 'PIPELINE_FAILED'}`;
        event(item, 'correction.unresolved', target.correctionReason, { variantId: target.id });
        return item;
      }).catch(() => {});
      await recordCorrection({ kind:'attempt', id: attempted.correctionId || attempted.id, at:new Date().toISOString(), jobId:id,
        sourceVariantId: attempted.correctionOf || attempted.rebuildOf, variantId:attempted.id,
        feedbackType:attempted.correctionRequest?.feedbackType || null, feedback:attempted.correctionRequest?.text || null,
        patch:attempted.preparedPatch?.patch || null, applied:attempted.preparedPatch?.applied || [], rejected:attempted.preparedPatch?.rejected || [],
        changed:false, changedFields:[], status:'unresolved', reason:`Échec technique : ${cause.code || 'PIPELINE_FAILED'}` }).catch(() => {});
    }
    await mutateJob(id, (item) => { item.status='failed'; item.error={code:cause.code||'PIPELINE_FAILED',message:cause.message,details:cause.details||null}; event(item,'job.failed',cause.message,{code:cause.code}); return item; }).catch(()=>{});
    await sendCriticalAlert(`RobloxAssetsCreator — erreur de génération\nJob : ${id}\nCode : ${safeTelegramErrorCode(cause.code || 'PIPELINE_FAILED')}\nConsulte la trace locale pour les détails.`);
    await traceArtifact(id, 'errors', 'pipeline_failure', { code:cause.code, message:cause.message, details:cause.details, stack:cause.stack }, { phase:'job' });
  }
}

export async function requestCorrection(jobId, input = {}) {
  if (input.issues !== undefined && (!Array.isArray(input.issues) || input.issues.length > 8 || input.issues.some((issue) => !ALLOWED_ISSUES.has(issue))))
    throw Object.assign(new Error('Liste de défauts invalide.'), { code:'JOB_INPUT_INVALID' });
  const issues = Array.isArray(input.issues) ? [...new Set(input.issues)] : [];
  const componentId = bounded(input.componentId, 80);
  const text = bounded([issues.join(', '), bounded(input.note || input.text, 1000)].filter(Boolean).join(' · '), 3000);
  if (!text) throw Object.assign(new Error('Feedback requis.'), { code:'FEEDBACK_REQUIRED' });
  const mode = input.mode === 'rebuild' ? 'rebuild' : 'patch';
  const type = feedbackType({ issues, text });
  const feedbackId = randomUUID();
  const job = await mutateJob(jobId, (item) => {
    if (!['review_ready','failed','stopped'].includes(item.status) && !(item.continuousGeneration && item.status === 'generating'))
      throw Object.assign(new Error('Attends une variante terminée avant de corriger.'), { code:'JOB_NOT_REVIEWABLE' });
    if (item.pendingCorrection) throw Object.assign(new Error('Une correction est déjà en attente.'), { code:'CORRECTION_PENDING' });
    if (input.variantId && !item.variants.some((variant) => variant.id === input.variantId && variant.status === 'done'))
      throw Object.assign(new Error('Variante introuvable ou non terminée.'), { code:'VARIANT_NOT_READY' });
    if (componentId && !item.plan?.components?.some((component) => component.id === componentId))
      throw Object.assign(new Error('Composant inconnu.'), { code:'JOB_INPUT_INVALID' });
    item.feedback.push({ id:feedbackId, at:new Date().toISOString(), text, issues, componentId:componentId||null, feedbackType:type, mode, variantId:input.variantId||null });
    const sourceVariantId = input.variantId || item.bestVariantId || item.variants.find((variant) => variant.status === 'done')?.id || null;
    const source = item.variants.find((variant) => variant.id === sourceVariantId);
    if (mode === 'patch' && source?.planVersion !== item.planVersion)
      throw Object.assign(new Error('Cette variante utilise un ancien plan. Demande un Rebuild pour la corriger.'), { code:'JOB_INPUT_INVALID' });
    item.pendingCorrection={ id:feedbackId, mode, text, issues, componentId:componentId||null, feedbackType:type, variantId:sourceVariantId };
    if (item.status !== 'generating') item.status='queued';
    item.error=null; item.stopRequested=false;
    event(item,'feedback.received',text,{mode,variantId:input.variantId||null});
    return item;
  });
  try {
    await recordFeedback({ id:feedbackId, at:new Date().toISOString(), jobId, variantId:input.variantId||null, text, issues, componentId:componentId||null, feedbackType:type, mode });
  } catch (cause) {
    await mutateJob(jobId, (item) => {
      if (item.pendingCorrection?.id === feedbackId) item.pendingCorrection = null;
      item.feedback = item.feedback.filter((entry) => entry.id !== feedbackId);
      if (item.status === 'queued') item.status = 'review_ready';
      event(item, 'feedback.storage_failed', 'Le retour n’a pas pu être journalisé.', { code:cause.code || 'FEEDBACK_STORAGE_FAILED' });
      return item;
    });
    throw cause;
  }
  await traceEvent(jobId, 'feedback.received', { feedbackId, variantId: input.variantId||null, feedbackType:type, issues, componentId:componentId||null }, { phase:'correction', variantId:input.variantId||null }).catch(() => {});
  schedule(jobId);
  return job;
}

export async function validateCorrection(jobId, correctionId, input = {}) {
  const approved = input.approved === true;
  const rating = input.rating == null || input.rating === '' ? null : Number(input.rating);
  if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 10)) throw Object.assign(new Error('Note humaine invalide (0 à 10).'), { code:'HUMAN_RATING_INVALID' });
  const job = await mutateJob(jobId, (item) => {
    const variant = item.variants.find((entry) => (entry.correctionId || entry.id) === correctionId && entry.status === 'done');
    if (!variant) throw Object.assign(new Error('Correction introuvable.'), { code:'CORRECTION_NOT_FOUND' });
    if (approved && variant.correctionStatus !== 'resolved') throw Object.assign(new Error('Seule une correction résolue peut devenir un exemple.'), { code:'CORRECTION_NOT_RESOLVED' });
    variant.correctionValidated = approved;
    variant.correctionValidatedAt = new Date().toISOString();
    if (rating !== null) variant.correctionRating = rating;
    event(item, 'correction.validated', approved ? 'Correction validée par l’utilisateur.' : 'Correction non validée.', { correctionId, variantId: variant.id, approved, rating });
    return item;
  });
  await recordCorrection({ kind:'validation', id:randomUUID(), correctionId, at:new Date().toISOString(), approved, rating });
  await traceEvent(jobId, 'correction.validated', { correctionId, approved, rating }, { phase:'correction' });
  return job;
}

export async function rateVariant(jobId, variantId, input = {}) {
  const rating = Number(input.rating);
  if (input.rating === '' || input.rating == null || !Number.isFinite(rating) || rating < 0 || rating > 10)
    throw Object.assign(new Error('Note humaine invalide (0 à 10).'), { code: 'HUMAN_RATING_INVALID' });
  const note = bounded(input.note, 1000);
  return mutateJob(jobId, (item) => {
    const variant = item.variants.find((entry) => entry.id === variantId && entry.status === 'done');
    if (!variant) throw Object.assign(new Error('Variante introuvable ou non terminée.'), { code: 'VARIANT_NOT_READY' });
    if (item.selectedVariantId === variantId && item.status === 'saved')
      throw Object.assign(new Error('La note de cette variante sauvegardée est figée dans la bibliothèque.'), { code: 'RATING_LOCKED' });
    const entry = { id: randomUUID(), at: new Date().toISOString(), rating, note };
    variant.humanRating = rating;
    variant.humanRatingHistory ||= [];
    variant.humanRatingHistory.push(entry);
    event(item, 'variant.rated', 'Note humaine enregistrée.', { variantId, rating, note, ratingId: entry.id });
    return item;
  });
}

export async function approveDecomposition(jobId,input={}) {
  const approved=await mutateJob(jobId,item=>{
    if (item.status!=='awaiting_decomposition_review'||!item.plan)
      throw Object.assign(new Error('Aucun inventaire en attente de validation.'),{code:'PLAN_NOT_REVIEWABLE'});
    if (input.components!==undefined) {
      if(!Array.isArray(input.components)||input.components.length<1||input.components.length>24)
        throw Object.assign(new Error('Inventaire JSON invalide (1 à 24 composants).'),{code:'PLAN_INPUT_INVALID'});
      const old=item.plan;
      const parsed=normalizeSpatialPlan({...old,components:input.components},null,old.sizeStuds);
      item.plan={...parsed,category:old.category,interpreterVersion:old.interpreterVersion};
      item.planVersion++;
    }
    item.planApproved=true;
    item.status='queued';
    event(item,'plan.human_approved','Décomposition validée avant construction.',{
      planVersion:item.planVersion,edited:input.components!==undefined
    });
    return item;
  });
  await traceArtifact(jobId,'plans','human_approved_inventory_v'+approved.planVersion,
    approved.plan,{phase:'planning'});
  schedule(jobId);
  return approved;
}

export async function selectAndSave(jobId, variantId, userRating = null) {
  let job = await getJob(jobId);
  const variant = job?.variants.find((x) => x.id === variantId && x.status === 'done' && !['no_effect','unsupported'].includes(x.correctionStatus));
  if (!job || !variant) throw Object.assign(new Error('Variante introuvable ou non terminée.'), { code:'VARIANT_NOT_READY' });
  const rating = userRating===null||userRating===undefined?null:Number(userRating);
  if (rating!==null && (!Number.isFinite(rating)||rating<0||rating>10))
    throw Object.assign(new Error('Note humaine invalide (0 à 10).'),{code:'HUMAN_RATING_INVALID'});
  const ratedVariant = {...variant,humanRating:rating};
  const saved = await saveVariantToLibrary(job, ratedVariant);
  const libraryExample = await saveLibrarySelection(job,ratedVariant,rating);
  const lessons = await learnFromSelection(job, ratedVariant);
  await traceEvent(job.id,'HUMAN_SELECTION',{
    variantId, humanRating:rating,libraryAccepted:Boolean(libraryExample),libraryVersion:libraryExample?.version||null
  },{phase:'learning',variantId});
  await traceArtifact(job.id, 'learning', 'validated_lessons', lessons, { phase: 'learning', variantId });
  job = await mutateJob(jobId, (item) => { item.selectedVariantId=variantId; item.savedAsset=saved; item.status='saved'; item.validatedLessons=lessons; item.humanRating=rating;
    const selected=item.variants.find(x=>x.id===variantId);
    if(selected) {
      if (rating !== null && selected.humanRating !== rating) {
        selected.humanRatingHistory ||= [];
        selected.humanRatingHistory.push({ id:randomUUID(), at:new Date().toISOString(), rating, note:'Note lors de la sauvegarde.' });
      }
      selected.humanRating=rating;
    }
    event(item,'variant.saved','Asset copié dans ServerStorage/RobloxAssetsCreator_Assets.',{variantId,path:saved?.path,lessons:lessons.length,libraryAccepted:Boolean(libraryExample),humanRating:rating}); return item; });
  return job;
}

export async function stopJob(jobId) {
  return mutateJob(jobId, (job) => { job.stopRequested=true; if (!active.has(jobId)) job.status='stopped'; event(job,'job.stop_requested','Arrêt demandé.'); return job; });
}

export function queueStatus() { return { running, queued: [...queue], active: [...active] }; }
export async function resumeJob(jobId) {
  const job = await mutateJob(jobId, (item) => {
    item.stopRequested = false;
    item.status = 'queued';
    item.error = null;
    if (item.recovery) {
      item.recovery.lastSignature = null;
      item.recovery.consecutive = {};
    }
    event(item, 'job.manual_resume', 'Reprise manuelle demandée.');
    return item;
  });
  schedule(jobId);
  return job;
}
export async function reconcileInterruptedJobs() {
  const jobs = await listJobs(200);
  let count = 0;
  for (const job of jobs) {
    if (!['queued','understanding','planning','generating'].includes(job.status)) continue;
    await mutateJob(job.id, (item) => {
      item.status = 'interrupted';
      item.error = { code: 'SERVER_RESTARTED', message: 'Le serveur a redémarré pendant cette création. Réautorise Studio puis clique sur Reprendre.' };
      event(item, 'job.interrupted', 'Création interrompue par un redémarrage du serveur.');
      return item;
    });
    count += 1;
  }
  return count;
}
