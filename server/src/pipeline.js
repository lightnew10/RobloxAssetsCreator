import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { getProviderRuntime, getVisionRuntime } from './providerSettings.js';
import { structuredChat, visionStructuredChat } from './providers.js';
import { normalizeSpatialPlan, spatialPlanSchema } from './spatialPlan.js';
import { fallbackGeometry, geometryAudit, geometrySchema, normalizeGeometry, seedFor, variationProfiles } from './geometry.js';
import { geometrySystem, geometryUser, plannerSystem, plannerUser, reviewSystem } from './prompts.js';
import { auditVariant, buildNativeVariant, buildPartsVariant, saveVariantToLibrary } from './assetStudio.js';
import { captureThreeViews } from './capture.js';
import { getStudioStatus, listStudioTools } from './studioBridge.js';
import { getJob, listJobs, mutateJob, saveJob } from './store.js';
import { markRecovered, recordIncident, traceIncident } from './recovery.js';
import { sendCriticalAlert } from './telegram.js';
import { traceArtifact, traceEvent } from './trace.js';
import { learnFromSelection, relevantLessons } from './learning.js';
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
  const id = randomUUID();
  const target = Math.max(1, Math.min(config.maxVariants, Number(input.variantTarget) || 3));
  const memoryLessons = await relevantLessons({ name, category: input.category || 'prop', subtype: input.subtype || '' });
  const job = {
    schemaVersion: 1, id, name, brief, category: bounded(input.category || 'prop', 80), subtype: bounded(input.subtype, 80),
    style: bounded(input.style || 'stylized Roblox', 300), studioId, provider, visionProvider, planningProvider, planningModel,
    engine: ['auto','parts','native'].includes(input.engine) ? input.engine : 'auto',
    variantTarget: target, traceLevel: input.traceLevel === 'off' ? 'off' : 'full',
    qualityPolicy: { initialVariants: target, autoAcceptScore: 8, essentialAcceptMinScore: 8, humanReviewMinScore: 5, essentialReviewMinScore: 5, maxPatchesPerCandidate: 2, maxRebuildsPerObject: 1, maxAttemptsPerObject: 9 },
    autoRebuilds: 0,
    referenceImages: Array.isArray(input.referenceImages) ? input.referenceImages.slice(0, 4) : [],
    referenceAnalysis: null, plan: null, planVersion: 0, variants: [], feedback: [], memoryLessons, selectedVariantId: null,
    status: 'queued', error: null, stopRequested: false, pendingCorrection: null, recovery: null, events: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  event(job, 'job.created', 'Job de création créé.', { provider, planningProvider, planningModel: planningModel || null, visionProvider, engine: job.engine, variantTarget: target });
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
  for (let attempt = 0; attempt < config.maxPlanAttempts; attempt += 1) {
    try {
      const response = await structuredChat({
        provider: job.planningProvider || providerFor(job),
        modelOverride: job.planningModel || '',
        // JSON planning is deterministic: do not burn long reasoning before answering.
        thinkOverride: (job.planningProvider || providerFor(job)) === 'local' ? config.ollamaPlanningThink : null,
        messages: [
          { role: 'system', content: plannerSystem },
          { role: 'user', content: plannerUser({ brief: job.brief, category: job.category, subtype: job.subtype, style: job.style, feedback: [...(job.memoryLessons || []).map((x) => ({ source: 'validated_memory', text: x.text })), ...(job.feedback || [])], previousIssues: structuralIssues }) + '\nREFERENCE_ANALYSIS=' + JSON.stringify(referenceAnalysis) + (lastPlannerError ? '\nPREVIOUS_ATTEMPT_ERROR=' + JSON.stringify(lastPlannerError) + '\nCorrect only the identified error and return one complete JSON document.' : '') },
        ],
        schema: spatialPlanSchema,
        traceContext: { runId: job.id, phase: 'planning', attempt: attempt + 1, traceLevel: job.traceLevel },
      });
      // Normalize only once: a second pass would discard the original repair
      // audit and could turn a successfully repaired virtual root into noise.
      const plan = normalizeSpatialPlan(response.data, null, [10, 10, 10]);
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

async function makeGeometry(job, variant) {
  let lastError = null;
  for (let attempt = 0; attempt < config.maxGeometryAttempts; attempt += 1) {
    try {
      const response = await structuredChat({
        provider: providerFor(job),
        messages: [
          { role: 'system', content: geometrySystem },
          { role: 'user', content: geometryUser({ plan: job.plan, profile: variant.profile, feedback: [...(job.memoryLessons || []).map((x) => ({ source: 'validated_memory', text: x.text })), ...(job.feedback || [])], previousReview: variant.sourceReview || null }) },
        ],
        schema: geometrySchema,
        traceContext: { runId: job.id, variantId: variant.id, phase: 'geometry', attempt: attempt + 1, traceLevel: job.traceLevel },
      });
      const geometry = normalizeGeometry(response.data, job.plan);
      const audit = geometryAudit(geometry, job.plan);
      if (!audit.passed) throw Object.assign(new Error('Géométrie IA non conforme : ' + audit.issues.map((x) => x.code).join(', ')), { code: 'GEOMETRY_AUDIT_FAILED', details: audit.issues });
      return { geometry, audit, generation: { provider: response.meta.provider, model: response.meta.model, fallback: false } };
    } catch (cause) {
      lastError = cause;
      await traceEvent(job.id, 'GEOMETRY_RETRY', { code: cause.code, message: cause.message }, { variantId: variant.id, phase: 'geometry', attempt: attempt + 1 });
    }
  }
  const geometry = fallbackGeometry(job.plan, seedFor(job.id + ':' + variant.id), variant.profile);
  const audit = geometryAudit(geometry, job.plan);
  await traceEvent(job.id, 'GEOMETRY_DETERMINISTIC_FALLBACK', { reason: lastError?.message, audit }, { variantId: variant.id, phase: 'geometry' });
  return { geometry, audit, generation: { provider: 'deterministic_fallback', model: null, fallback: true } };
}

async function reviewVariant(job, variant) {
  if (!config.autoReview || !variant.captures?.length) return null;
  const captureImages = variant.captures.map((x) => ({ mimeType: x.mimeType, data: x.data }));
  const refs = publicReferenceImages(job);
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
  await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.status='generating'; event(item,'variant.generating',v.profile.label,{variantId}); return item; });
  job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);

  let engine = job.engine;
  const tools = (await listStudioTools()).map((x) => x.name);
  if (engine === 'auto') engine = tools.includes(job.plan.nativeMethod) && tools.includes('wait_job_finished') ? 'native' : 'parts';
  if (engine === 'native' && (!tools.includes(job.plan.nativeMethod) || !tools.includes('wait_job_finished'))) {
    throw Object.assign(new Error('La génération native demandée nécessite ' + job.plan.nativeMethod + ' et wait_job_finished dans le serveur MCP Roblox.'), {
      code: 'NATIVE_TOOL_UNAVAILABLE', details: { nativeMethod: job.plan.nativeMethod, availableTools: tools },
    });
  }

  if (engine === 'parts') {
    const generated = await makeGeometry(job, variant);
    await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.geometry=generated.geometry; v.geometryAudit=generated.audit; v.generation=generated.generation; v.status='building'; return item; });
    job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);
    const bounds = await withRecovery(jobId, 'studio_build', variantId, () => buildPartsVariant(job, variant));
    await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.bounds=bounds; v.engineUsed='parts'; v.status='auditing'; event(item,'variant.built','Variante construite par Parts.',{variantId}); return item; });
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
      await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.bounds=bounds; v.engineUsed='native'; v.status='auditing'; event(item,'variant.built','Variante générée nativement par Roblox.',{variantId,method:bounds.nativeMethod}); return item; });
    } catch (cause) {
      if (job.engine !== 'auto') throw cause;
      await mutateJob(jobId, (item) => { event(item,'variant.native_fallback','Génération native indisponible, repli Parts.',{variantId,reason:cause.message}); return item; });
      job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);
      const generated = await makeGeometry(job, variant);
      await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.geometry=generated.geometry; v.geometryAudit=generated.audit; v.generation=generated.generation; v.status='building'; return item; });
      job = await getJob(jobId); variant = job.variants.find((x) => x.id === variantId);
      const bounds = await withRecovery(jobId, 'studio_build', variantId, () => buildPartsVariant(job, variant));
      await mutateJob(jobId, (item) => { const v=item.variants.find((x)=>x.id===variantId); v.bounds=bounds; v.engineUsed='parts_fallback'; v.status='auditing'; return item; });
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
    event(item,'variant.done',review ? `Variante terminée · ${Number(review.score).toFixed(1)}/10` : 'Variante terminée · critique IA indisponible',{variantId});
    return item;
  });
}

function createVariant(job, order, extra = {}) {
  const profile = variationProfiles[order % variationProfiles.length];
  return {
    id: randomUUID(), order, profile, planVersion: job.planVersion, status: 'pending',
    geometry: null, bounds: null, technicalAudit: null, captures: [], review: null, engineUsed: null,
    createdAt: new Date().toISOString(), ...extra,
  };
}

async function runFull(job) {
  const referenceAnalysis = await analyzeReferences(job);
  job = await getJob(job.id);
  if (!job.plan) await buildPlan(job, referenceAnalysis);
  job = await getJob(job.id);
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
    await traceEvent(id, 'JOB_STARTED', { name: job.name, provider: job.provider, engine: job.engine }, { phase: 'job' });
    if (job.pendingCorrection?.mode === 'patch') await runPatch(job, job.pendingCorrection);
    else {
      if (job.pendingCorrection?.mode === 'rebuild') {
        await mutateJob(id, (item) => { item.plan=null; item.pendingCorrection=null; item.status='queued'; event(item,'correction.rebuild_started','Reconstruction du plan demandée.'); return item; });
        job = await getJob(id);
      }
      await runFull(job);
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

export async function selectAndSave(jobId, variantId) {
  let job = await getJob(jobId);
  const variant = job?.variants.find((x) => x.id === variantId && x.status === 'done');
  if (!job || !variant) throw Object.assign(new Error('Variante introuvable ou non terminée.'), { code:'VARIANT_NOT_READY' });
  const saved = await saveVariantToLibrary(job, variant);
  const lessons = await learnFromSelection(job, variant);
  await traceArtifact(job.id, 'learning', 'validated_lessons', lessons, { phase: 'learning', variantId });
  job = await mutateJob(jobId, (item) => { item.selectedVariantId=variantId; item.savedAsset=saved; item.status='saved'; item.validatedLessons=lessons; event(item,'variant.saved','Asset copié dans ServerStorage/RobloxAssetsCreator_Assets.',{variantId,path:saved?.path,lessons:lessons.length}); return item; });
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
