import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { getGenerationMode, getProviderRuntime, getVisionRuntime } from './providerSettings.js';
import { engineForGenerationMode, engineForJob, generationModeForJob, generationSourceForEngine } from './generationMode.js';
import { structuredChat, visionStructuredChat } from './providers.js';
import { inventorySchema, resolveCategory, inferCategory, loadCategoryPrompt } from './categories.js';
import { primitiveGeometrySchema, interpretPrimitives, PRIMITIVE_VERSION } from './primitives.js';
import { normalizeSpatialPlan, spatialPlanSchema } from './spatialPlan.js';
import { fallbackGeometry, geometryAudit, geometrySchema, legacyGeometrySchema, normalizeGeometry, seedFor, variationProfiles } from './geometry.js';
import { buildProceduralGeometry, guessArchetype, proceduralGeometrySchema } from './archetypes/index.js';
import { geometrySystem, genericGeometrySystem, geometryUser, plannerSystem, plannerUser, reviewSystem } from './prompts.js';
import { auditVariant, buildNativeVariant, buildPartsVariant, saveVariantToLibrary } from './assetStudio.js';
import { captureThreeViews } from './capture.js';
import { getStudioStatus, listStudioTools } from './studioBridge.js';
import { getJob, listJobs, mutateJob, saveJob } from './store.js';
import { markRecovered, recordIncident, traceIncident } from './recovery.js';
import { sendCriticalAlert } from './telegram.js';
import { traceArtifact, traceEvent } from './trace.js';
import { learnFromSelection, relevantLessons, relevantExamples } from './learning.js';
import { saveLibrarySelection, searchLibrary } from './library.js';
import { recordVariantMetric } from './metrics.js';
import { referenceSimilarity } from './referenceSimilarity.js';
import { qualityBatchDecision, rankQualityVariant } from './qualityPolicy.js';

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
    problems: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['component','issue','severity'], properties: { component:{type:'string'}, issue:{type:'string'}, severity:{type:'string',enum:['low','medium','high','critical']} } } },
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

export async function createAssetJob(input = {}) {
  const name = bounded(input.name, 80);
  const brief = bounded(input.brief, 5000);
  if (!name || !brief) throw Object.assign(new Error('Nom et brief requis.'), { code: 'JOB_INPUT_INVALID' });
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
  const target = Math.max(1, Math.min(config.maxVariants, Number(input.variantTarget) || 3));
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
    variantTarget: target, traceLevel: input.traceLevel === 'off' ? 'off' : 'full',
    qualityPolicy: { initialVariants: target, autoAcceptScore: 8, essentialAcceptMinScore: 8, humanReviewMinScore: 5, essentialReviewMinScore: 5, maxPatchesPerCandidate: 2, maxRebuildsPerObject: 1, maxAttemptsPerObject: 9 },
    autoRebuilds: 0,
    referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages.slice(0, 4) : [],
    referenceAnalysis: null, plan: null, planVersion: 0, variants: [], feedback: [], memoryLessons, memoryExamples, selectedVariantId: null,
    status: 'queued', error: null, stopRequested: false, pendingCorrection: null, recovery: null, events: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  event(job, 'job.created', 'Job de création créé.', {
    provider, planningProvider, planningModel: planningModel || null, visionProvider,
    generationMode, engine, variantTarget: target,
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
        await sendCriticalAlert(`RobloxAssetsCreator STOP\nJob: ${snapshot.name}\nStage: ${stage}\nErreur: ${cause.code || 'PIPELINE_ERROR'}\n${cause.message}`);
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
    await mutateJob(job.id, (item) => { item.referenceAnalysis = response.data; event(item, 'reference.analyzed', 'Références analysées.', { model: response.meta.model }); return item; });
    return response.data;
  } catch (cause) {
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
        await sendCriticalAlert(`RobloxAssetsCreator : plan 3D bloqué\n${job.name}\n${cause.message}`);
        throw cause;
      }
    }
  }
}

async function makeGenericGeometry(job, variant){
  const seed=seedFor([job.brief,job.category,variant.profile.id,PRIMITIVE_VERSION].join(':'));
  let lastError=null;
  for(let attempt=0;attempt<config.maxGeometryAttempts;attempt+=1){
    try{
      const response=await structuredChat({
        provider:providerFor(job),
        messages:[
          {role:'system',content:genericGeometrySystem},
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
        profile:variant.profile.id,maxParts:job.maxParts||180,minDetail:.2,seed
      });
      const geometry=normalizeGeometry(built,job.plan);
      const audit=geometryAudit(geometry,job.plan);
      if(!audit.passed)throw Object.assign(new Error('Audit primitives : '+audit.issues.map(x=>x.code).join(', ')),
        {code:'GEOMETRY_AUDIT_FAILED',details:audit.issues});
      await traceArtifact(job.id,'plans','primitive_decomposition_'+variant.id,{
        schemaVersion:2,interpreterVersion:PRIMITIVE_VERSION,decomposition:response.data,warnings:built.warnings,
      },{variantId:variant.id,phase:'geometry'});
      await traceEvent(job.id,'PRIMITIVE_GEOMETRY_BUILT',{
        interpreterVersion:PRIMITIVE_VERSION,partCount:geometry.parts.length,
        warnings:built.warnings,seed,category:job.plan.category
      },{variantId:variant.id,phase:'geometry'});
      return {geometry,audit,definition:{
        archetype:null,primitives:response.data,version:PRIMITIVE_VERSION,variation:variant.profile.id,
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

async function makeGeometry(job, variant) {
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

async function runVariant(jobId, variantId) {
  let job = await getJob(jobId);
  let variant = job.variants.find((x) => x.id === variantId);
  if (!variant || variant.status === 'done') return;
  await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.startedAt ||= new Date().toISOString(); v.status='generating'; event(item,'variant.generating',v.profile.label,{variantId}); return item; });
  job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);

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
  if (engine === 'native' && (!tools.includes(job.plan.nativeMethod) || !tools.includes('wait_job_finished'))) {
    throw Object.assign(new Error('La génération native demandée nécessite ' + job.plan.nativeMethod + ' et wait_job_finished dans le serveur MCP Roblox.'), {
      code: 'NATIVE_TOOL_UNAVAILABLE', details: { nativeMethod: job.plan.nativeMethod, availableTools: tools },
    });
  }

  if (engine === 'parts') {
    const generated = await makeGeometry(job, variant);
    await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.geometry=generated.geometry; v.geometryAudit=generated.audit; v.generation=generated.generation; v.geometryDefinition=generated.definition; v.status='building'; return item; });
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
  await mutateJob(jobId, (item) => {
    const v=item.variants.find((x)=>x.id===variantId);
    delete v._captureData;
    v.review=review; v.status='done'; v.finishedAt=new Date().toISOString();
    event(item,'variant.done',review ? `Variante terminée · ${Number(review.score).toFixed(1)}/10` : 'Variante terminée · critique IA indisponible',{
      variantId, engineUsed: v.engineUsed, generationSource: v.generationSource || generationSourceForEngine(v.engineUsed),
    });
    return item;
  });
  const finishedJob = await getJob(jobId);
  const finishedVariant = finishedJob.variants.find(v=>v.id===variantId);
  try { await recordVariantMetric(finishedJob,finishedVariant); }
  catch(cause) { await traceEvent(jobId,'METRICS_WRITE_ERROR',{code:cause.code||null,message:cause.message},{phase:'metrics',variantId}); }
}

function createVariant(job, order, extra = {}) {
  const profile = variationProfiles[order % variationProfiles.length];
  return {
    id: randomUUID(), order, profile, planVersion: job.planVersion, status: 'pending',
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
      for (let i = existing; i < item.variantTarget; i += 1) item.variants.push(createVariant(item, i));
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
  const variant = createVariant(job, order, { correctionOf: source.id, profile: { id: 'correction', label: 'Correction', instruction: 'Applique précisément le feedback utilisateur et les problèmes de la critique sans dégrader les points déjà corrects.' }, sourceReview: source.review || null });
  await mutateJob(job.id, (item) => { item.variants.push(variant); item.pendingCorrection=null; item.status='generating'; event(item,'correction.started',correction.text,{sourceVariantId:source.id,variantId:variant.id}); return item; });
  await runVariant(job.id, variant.id);
}

async function autoImprove(jobId) {
  for (let cycle = 0; cycle < 4; cycle += 1) {
    let job = await getJob(jobId);
    const current = job.variants.filter((variant) => variant.planVersion === job.planVersion);
    const decision = qualityBatchDecision(job.variants, {
      planVersion: job.planVersion,
      policy: job.qualityPolicy,
      attemptsUsed: job.variants.filter((variant) => variant.review || ['done','failed'].includes(variant.status)).length,
      rebuildsUsed: job.autoRebuilds || 0,
      patchesUsed: current.filter((variant) => variant.correctionOf).length,
      patchable: true,
    });
    const best = rankQualityVariant(current, job.qualityPolicy);
    await mutateJob(jobId, (item) => {
      item.qualityDecision = decision;
      event(item, 'quality.decision', decision.accepted ? 'Qualité automatique validée.' : 'Évaluation de la prochaine amélioration.', { cycle: cycle + 1, ...decision });
      return item;
    });
    if (decision.accepted || decision.finished || !best?.review) return;
    if (decision.needsCorrection) {
      const variant = createVariant(job, job.variants.length, {
        correctionOf: best.id,
        profile: { id:'auto_patch', label:'Auto-correction', instruction:'Corrige précisément les problèmes mesurés par la critique visuelle, conserve les critères déjà bons et améliore la conformité.' },
        sourceReview: best.review,
      });
      await mutateJob(jobId, (item) => {
        item.variants.push(variant);
        event(item, 'quality.auto_patch', 'Correction automatique de la meilleure variante.', { sourceVariantId: best.id, variantId: variant.id, score: best.review.score });
        return item;
      });
      await runVariant(jobId, variant.id);
      continue;
    }
    if (decision.needsRegenerate) {
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
      continue;
    }
    if (decision.needsRebuild) {
      const problems = (best.review.problems || []).map((problem) => problem.component + ': ' + problem.issue).join('; ');
      await mutateJob(jobId, (item) => {
        item.autoRebuilds = (item.autoRebuilds || 0) + 1;
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
      continue;
    }
    return;
  }
}

async function runJob(id) {
  let job = await getJob(id);
  if (!job || job.stopRequested || ['review_ready','saved','stopped'].includes(job.status)) return;
  try {
    await traceEvent(id, 'JOB_STARTED', { name: job.name, provider: job.provider, generationMode: generationModeForJob(job), engine: engineForJob(job) }, { phase: 'job' });
    if (job.pendingCorrection?.mode === 'patch') await runPatch(job, job.pendingCorrection);
    else {
      if (job.pendingCorrection?.mode === 'rebuild') {
        await mutateJob(id, (item) => { item.plan=null; item.pendingCorrection=null; item.status='queued'; event(item,'correction.rebuild_started','Reconstruction du plan demandée.'); return item; });
        job = await getJob(id);
      }
      await runFull(job);
      const afterFull = await getJob(id);
      if(afterFull?.status==='awaiting_decomposition_review')return;
      await autoImprove(id);
    }
    job = await getJob(id);
    if (job.stopRequested) {
      await mutateJob(id, (item) => { item.status='stopped'; event(item,'job.stopped','Arrêt demandé.'); return item; });
      return;
    }
    const candidates = job.variants.filter((x) => x.status === 'done');
    const best = rankQualityVariant(candidates, job.qualityPolicy) || [...candidates].sort((a,b)=>(b.review?.score ?? -1)-(a.review?.score ?? -1))[0];
    await mutateJob(id, (item) => {
      item.status='review_ready'; item.error=null;
      item.bestVariantId=best?.id || null;
      event(item,'job.review_ready','Création terminée : sélection utilisateur requise.',{bestVariantId:best?.id||null,bestScore:best?.review?.score??null});
      return item;
    });
    await traceEvent(id, 'JOB_REVIEW_READY', { bestVariantId: best?.id || null, bestScore: best?.review?.score ?? null }, { phase: 'job' });
  } catch (cause) {
    await mutateJob(id, (item) => { item.status='failed'; item.error={code:cause.code||'PIPELINE_FAILED',message:cause.message,details:cause.details||null}; event(item,'job.failed',cause.message,{code:cause.code}); return item; }).catch(()=>{});
    await traceArtifact(id, 'errors', 'pipeline_failure', { code:cause.code, message:cause.message, details:cause.details, stack:cause.stack }, { phase:'job' });
  }
}

export async function requestCorrection(jobId, input = {}) {
  const text = bounded(input.text, 3000);
  if (!text) throw Object.assign(new Error('Feedback requis.'), { code:'FEEDBACK_REQUIRED' });
  const mode = input.mode === 'rebuild' ? 'rebuild' : 'patch';
  const job = await mutateJob(jobId, (item) => {
    if (!['review_ready','failed'].includes(item.status)) throw Object.assign(new Error('Attends la fin de la génération avant de corriger.'), { code:'JOB_NOT_REVIEWABLE' });
    item.feedback.push({ id:randomUUID(), at:new Date().toISOString(), text, mode, variantId:input.variantId||null });
    item.pendingCorrection={ mode, text, variantId:input.variantId||null };
    item.status='queued'; item.error=null; item.stopRequested=false;
    event(item,'feedback.received',text,{mode,variantId:input.variantId||null});
    return item;
  });
  schedule(jobId);
  return job;
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
  const variant = job?.variants.find((x) => x.id === variantId && x.status === 'done');
  if (!job || !variant) throw Object.assign(new Error('Variante introuvable ou non terminée.'), { code:'VARIANT_NOT_READY' });
  const rating = userRating===null||userRating===undefined?null:Number(userRating);
  if (rating!==null && (!Number.isFinite(rating)||rating<0||rating>10))
    throw Object.assign(new Error('Note humaine invalide (0 à 10).'),{code:'HUMAN_RATING_INVALID'});
  const saved = await saveVariantToLibrary(job, variant);
  const ratedVariant = {...variant,humanRating:rating};
  const libraryExample = await saveLibrarySelection(job,ratedVariant,rating);
  const lessons = await learnFromSelection(job, ratedVariant);
  await traceEvent(job.id,'HUMAN_SELECTION',{
    variantId, humanRating:rating,libraryAccepted:Boolean(libraryExample),libraryVersion:libraryExample?.version||null
  },{phase:'learning',variantId});
  await traceArtifact(job.id, 'learning', 'validated_lessons', lessons, { phase: 'learning', variantId });
  job = await mutateJob(jobId, (item) => { item.selectedVariantId=variantId; item.savedAsset=saved; item.status='saved'; item.validatedLessons=lessons; item.humanRating=rating;
    const selected=item.variants.find(x=>x.id===variantId); if(selected)selected.humanRating=rating; event(item,'variant.saved','Asset copié dans ServerStorage/RobloxAssetsCreator_Assets.',{variantId,path:saved?.path,lessons:lessons.length,libraryAccepted:Boolean(libraryExample),humanRating:rating}); return item; });
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
