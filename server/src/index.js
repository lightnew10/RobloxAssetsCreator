import express from 'express';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { clearProviderKey, getProviderSettings, updateProviderSettings } from './providerSettings.js';
import { providerHealth, ollamaMemoryDiagnostic } from './providers.js';
import { getStudioStatus, grantStudioAccess, listStudioTools, readStudioTree, revokeStudioAccess } from './studioBridge.js';
import { closeStudioMcp } from './studioMcpClient.js';
import { approveDecomposition, createAssetJob, queueStatus, reconcileInterruptedJobs, requestCorrection, resumeJob, selectAndSave, stopJob } from './pipeline.js';
import { getJob, listJobs } from './store.js';
import { capturePath } from './capture.js';
import { readTrace, readTraceArtifacts, resolveTraceArtifact } from './trace.js';
import { learningStats } from './stats.js';

const app = express();
function publicJob(job) {
  if (!job) return job;
  return { ...job, referenceImages: (job.referenceImages || []).map((value, index) => ({ index, bytes: String(value || '').length })) };
}
app.disable('x-powered-by');
app.use(express.json({ limit: '35mb' }));

function localOnly(req, res, next) {
  const remote = req.socket.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
    return res.status(403).json({ ok:false, error:{ code:'LOCAL_ONLY', message:'API réservée à cette machine.' } });
  }
  const origin = req.get('origin');
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    return res.status(403).json({ ok:false, error:{ code:'ORIGIN_DENIED', message:'Origine non locale.' } });
  }
  next();
}
app.use('/api', localOnly);

app.get('/api/health', async (_req,res) => {
  const [studio, providers] = await Promise.all([
    getStudioStatus().catch((e)=>({status:'disconnected',detail:e.message,studios:[],tools:[]})),
    providerHealth().catch(()=>({local:{ok:false}})),
  ]);
  res.json({ ok:true, server:{host:config.host,port:config.port,traceLevel:config.traceLevel,buildTag:'windows-save-recovery-v5'}, studio, providers, queue:queueStatus() });
});

app.get('/api/learning/stats',async(_req,res,next)=>{try{res.json({ok:true,stats:await learningStats()});}catch(e){next(e);}});
app.get('/api/provider-settings', (_req,res)=>res.json({ok:true,settings:getProviderSettings()}));
app.put('/api/provider-settings', (req,res,next)=>{
  try { res.json({ok:true,settings:updateProviderSettings(req.body||{})}); } catch(e){ next(e); }
});
app.delete('/api/provider-settings/:provider/key',(req,res,next)=>{
  try { res.json({ok:true,settings:clearProviderKey(req.params.provider)}); } catch(e){ next(e); }
});

app.get('/api/studio/status', async (_req,res,next)=>{ try{res.json({ok:true,studio:await getStudioStatus({refresh:true})});}catch(e){next(e);} });
app.get('/api/studio/tools', async (_req,res,next)=>{ try{res.json({ok:true,tools:await listStudioTools()});}catch(e){next(e);} });
app.post('/api/studio/access', async (req,res,next)=>{
  try {
    if (req.body?.enabled === false) { revokeStudioAccess(); return res.json({ok:true,access:null}); }
    res.json({ok:true,access:await grantStudioAccess(req.body?.studioId)});
  } catch(e){ next(e); }
});
app.post('/api/studio/tree', async (req,res,next)=>{ try{res.json({ok:true,tree:await readStudioTree(req.body?.studioId)});}catch(e){next(e);} });
app.post('/api/studio/reconnect', async (_req,res,next)=>{ try{closeStudioMcp();res.json({ok:true,studio:await getStudioStatus({refresh:true})});}catch(e){next(e);} });

app.get('/api/jobs', async (req,res,next)=>{ try{res.json({ok:true,jobs:(await listJobs(Number(req.query.limit)||40)).map(publicJob),queue:queueStatus()});}catch(e){next(e);} });
app.post('/api/jobs', async (req,res,next)=>{ try{res.status(202).json({ok:true,job:publicJob(await createAssetJob(req.body||{}))});}catch(e){next(e);} });
app.get('/api/jobs/:jobId', async (req,res,next)=>{
  try {
    const job=await getJob(req.params.jobId);
    if(!job) return res.status(404).json({ok:false,error:{code:'JOB_NOT_FOUND',message:'Job introuvable.'}});
    res.json({ok:true,job:publicJob(job),queue:queueStatus()});
  } catch(e){next(e);}
});
app.post('/api/jobs/:jobId/decomposition',async(req,res,next)=>{try{res.status(202).json({ok:true,job:publicJob(await approveDecomposition(req.params.jobId,req.body||{}))});}catch(e){next(e);}});
app.post('/api/jobs/:jobId/correct', async (req,res,next)=>{ try{res.status(202).json({ok:true,job:publicJob(await requestCorrection(req.params.jobId,req.body||{}))});}catch(e){next(e);} });
app.post('/api/jobs/:jobId/select', async (req,res,next)=>{ try{res.json({ok:true,job:publicJob(await selectAndSave(req.params.jobId,req.body?.variantId,req.body?.userRating))});}catch(e){next(e);} });
app.post('/api/jobs/:jobId/stop', async (req,res,next)=>{ try{res.json({ok:true,job:publicJob(await stopJob(req.params.jobId))});}catch(e){next(e);} });
app.post('/api/jobs/:jobId/resume', async (req,res,next)=>{
  try {
    const job=await getJob(req.params.jobId);
    if(!job) return res.status(404).json({ok:false,error:{code:'JOB_NOT_FOUND',message:'Job introuvable.'}});
    const resumed=await resumeJob(req.params.jobId);
    res.status(202).json({ok:true,job:publicJob(resumed)});
  } catch(e){next(e);}
});
app.get('/api/jobs/:jobId/trace', async (req,res,next)=>{ try{res.json({ok:true,events:await readTrace(req.params.jobId,Number(req.query.limit)||500)});}catch(e){next(e);} });
app.get('/api/jobs/:jobId/trace/artifacts', async (req,res,next)=>{ try{res.json({ok:true,artifacts:await readTraceArtifacts(req.params.jobId,Number(req.query.limit)||500)});}catch(e){next(e);} });
app.get('/api/jobs/:jobId/trace/artifacts/:artifactId', async (req,res,next)=>{
  try {
    const artifact=await resolveTraceArtifact(req.params.jobId,req.params.artifactId);
    if(artifact.mimeType)res.type(artifact.mimeType);
    res.sendFile(artifact.absolute);
  } catch(e){next(e);}
});
app.get('/api/jobs/:jobId/captures/:fileName', async (req,res)=>{
  const file=capturePath(req.params.jobId,req.params.fileName);
  if(!file||!existsSync(file)) return res.status(404).json({ok:false,error:{code:'CAPTURE_NOT_FOUND',message:'Capture introuvable.'}});
  return res.sendFile(file);
});

app.use((req,res)=>res.status(404).json({ok:false,error:{code:'ROUTE_NOT_FOUND',message:'Route introuvable.'}}));
app.use((err,req,res,_next)=>{
  console.error('[RAC]',err);
  const status = ['JOB_NOT_FOUND'].includes(err.code) ? 404 : ['JOB_INPUT_INVALID','PROVIDER_KEY_REQUIRED','STUDIO_ACCESS_REQUIRED','STUDIO_NOT_CONNECTED','FEEDBACK_REQUIRED','VARIANT_NOT_READY','JOB_NOT_REVIEWABLE'].includes(err.code) ? 409 : 500;
  res.status(status).json({ok:false,error:{code:err.code||'SERVER_ERROR',message:err.message||'Erreur serveur.',details:err.details||null}});
});

const server=app.listen(config.port,config.host,()=>{
  console.log(`RobloxAssetsCreator API http://${config.host}:${config.port}`);
  ollamaMemoryDiagnostic().catch(error=>console.warn('[RAC] Ollama diagnostics:',error.message));
  reconcileInterruptedJobs().then((count)=>{if(count)console.log('[RAC] '+count+' job(s) marqué(s) interrompu(s) après redémarrage.');}).catch((error)=>console.error('[RAC] startup recovery',error));
});
function shutdown(){ closeStudioMcp(); server.close(()=>process.exit(0)); setTimeout(()=>process.exit(1),4000).unref(); }
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
