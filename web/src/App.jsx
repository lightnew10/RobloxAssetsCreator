import { useEffect, useMemo, useState } from 'react';
import { resolveStudioSelection } from './studioSelection.js';

const providers = ['local','openai','claude','deepseek','gemini','openrouter'];
const generationModes = [
  { id: 'local', title: 'Sans IA Roblox', description: 'Par défaut · planification IA et construction 3D par Parts. Roblox Studio sert à placer et capturer le modèle, sans génération IA native.' },
  { id: 'roblox', title: 'IA Roblox uniquement', description: 'Géométrie générée par Roblox via MCP, sans repli vers les Parts. Le provider IA configuré peut encore participer au plan et à la critique.' },
  { id: 'hybrid', title: 'Local + IA Roblox', description: 'Roblox natif d’abord si disponible, puis notre pipeline Parts si nécessaire. Le moteur effectif reste identifié pour chaque variante.' },
];
const generationModeName = (id) => generationModes.find(mode => mode.id === id)?.title || generationModes[0].title;
const sourceName = (variant) => (variant.generationSource || (variant.engineUsed === 'native' ? 'roblox_native' : variant.engineUsed?.startsWith('parts') ? 'local_parts' : '')) === 'roblox_native'
  ? 'Généré par IA Roblox' : variant.engineUsed ? 'Généré par notre pipeline (Parts)' : 'Moteur non encore déterminé';
const api = async (url, options={}) => {
  const response = await fetch(url, { cache:'no-store', ...options, headers:{'Content-Type':'application/json',...(options.headers||{})} });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error?.message || 'Erreur API');
  return data;
};
const scoreClass = (score) => score >= 8 ? 'good' : score >= 5 ? 'mid' : 'bad';
const statusLabel = {
  queued:'En attente',understanding:'Analyse référence',planning:'Planification',generating:'Génération',
  review_ready:'À valider',saved:'Sauvegardé',failed:'Erreur',stopped:'Arrêté',interrupted:'Interrompu'
};

function ProviderSettings({settings,onClose,onReload}) {
  const [draft,setDraft]=useState(settings);
  const [keys,setKeys]=useState({});
  useEffect(()=>setDraft(settings),[settings]);
  const [error,setError]=useState('');
  const save=async(body)=>{
    try{
      setError('');
      await api('/api/provider-settings',{method:'PUT',body:JSON.stringify(body)});
      setKeys((x)=>({...x,[body.provider]:''}));
      await onReload();
    }catch(e){setError(e.message);}
  };
  return <div className="modal-backdrop"><div className="modal settings-modal">
    <div className="modal-head"><div><h2>Paramètres IA</h2><p>Les clés restent sur le serveur local et ne sont jamais renvoyées en clair.</p></div><button onClick={onClose}>✕</button></div>
    <fieldset className="generation-settings">
      <legend>Génération 3D · utilisation de l'IA Roblox</legend>
      <p>Ce choix s'applique aux nouvelles créations et évite de confondre les résultats locaux avec ceux de l'IA native Roblox.</p>
      <div className="generation-options">
        {generationModes.map(mode=><label key={mode.id} className={'generation-option '+((draft.generationMode||'local')===mode.id?'selected':'')}>
          <input type="radio" name="generationMode" value={mode.id}
            checked={(draft.generationMode||'local')===mode.id}
            onChange={()=>{setDraft(current=>({...current,generationMode:mode.id}));save({generationMode:mode.id});}} />
          <span><strong>{mode.title}</strong><small>{mode.description}</small></span>
        </label>)}
      </div>
    </fieldset>
    <div className="settings-row">
      <label>Provider texte<select value={draft.selectedProvider} onChange={e=>{setDraft({...draft,selectedProvider:e.target.value});save({selectedProvider:e.target.value});}}>
        {providers.map(id=><option key={id} value={id}>{id}</option>)}
      </select></label>
      <label>Provider vision<select value={draft.selectedVisionProvider} onChange={e=>{setDraft({...draft,selectedVisionProvider:e.target.value});save({selectedVisionProvider:e.target.value});}}>
        {providers.map(id=><option key={id} value={id}>{id}</option>)}
      </select></label>
    </div>
    <div className="provider-grid">
      {providers.map(id=>{const p=draft.providers[id];return <div className="provider-card" key={id}>
        <div className="provider-title"><strong>{id}</strong><span className={p.configured?'dot ok':'dot'}>{p.configured?'configuré':'non configuré'}</span></div>
        {id!=='local'&&<input type="password" value={keys[id]||''} onChange={e=>setKeys({...keys,[id]:e.target.value})} placeholder={p.keyHint||'Clé API'} />}
        <input value={p.textModel||''} onChange={e=>setDraft({...draft,providers:{...draft.providers,[id]:{...p,textModel:e.target.value}}})} placeholder="Modèle texte" />
        <input value={p.visionModel||''} onChange={e=>setDraft({...draft,providers:{...draft.providers,[id]:{...p,visionModel:e.target.value}}})} placeholder="Modèle vision" />
        <div className="actions">
          <button className="primary small" onClick={()=>save({provider:id,apiKey:keys[id]||undefined,textModel:draft.providers[id].textModel,visionModel:draft.providers[id].visionModel})}>Enregistrer</button>
          {id!=='local'&&p.configured&&<button className="small" onClick={async()=>{await api('/api/provider-settings/'+id+'/key',{method:'DELETE'});onReload();}}>Supprimer clé</button>}
        </div>
      </div>})}
    </div>
    {error&&<div className="error">{error}</div>}
  </div></div>;
}

function StudioPanel({studio,onRefresh}) {
  const [busy,setBusy]=useState(false);
  const [selected,setSelected]=useState('');
  const [error,setError]=useState('');
  const studios=studio?.studios||[];
  const active=studio?.access?.studioId||'';
  // Le listing MCP peut changer après une actualisation : ne jamais envoyer un ancien studioId.
  const selectedId=resolveStudioSelection(studios,selected,active);
  useEffect(()=>{
    if(selected!==selectedId) {
      setSelected(selectedId);
      setError('');
    }
  },[selected,selectedId]);
  const authorize=async()=>{
    if(!selectedId||busy)return;
    setBusy(true);
    setError('');
    try{
      await api('/api/studio/access',{method:'POST',body:JSON.stringify({enabled:true,studioId:selectedId})});
      await onRefresh();
    }catch(e){
      setError(e.message||'Impossible d’autoriser cette fenêtre Roblox Studio.');
      await onRefresh();
    }finally{
      setBusy(false);
    }
  };
  return <section className="panel studio-panel">
    <div className="panel-head"><div><span className="eyebrow">ROBLOX STUDIO MCP</span><h2>Connexion Studio</h2></div><span className={'status '+(studio?.status==='connected'?'online':'offline')}>{studio?.status||'...'}</span></div>
    <p className="muted">{studio?.detail}</p>
    <div className="studio-controls">
      <select value={selectedId} onChange={e=>{setSelected(e.target.value);setError('')}}>{studios.map(s=><option key={s.id} value={s.id}>{s.name}{s.placeId?' · '+s.placeId:''}</option>)}</select>
      <button className="primary" disabled={!selectedId||busy} onClick={authorize}>{active===selectedId?'Autorisé':'Autoriser cette fenêtre'}</button>
      <button onClick={()=>{setError('');onRefresh()}}>Actualiser</button>
    </div>
    {error&&<div className="error">{error}</div>}
    <div className="tool-strip">{(studio?.tools||[]).slice(0,10).map(t=><span key={t}>{t}</span>)}</div>
  </section>;
}

function CreatePanel({settings,studio,onCreated}) {
  const [form,setForm]=useState({name:'',brief:'',category:'tree',subtype:'',style:'stylized Roblox',provider:settings.selectedProvider,planningProvider:settings.selectedProvider,planningModel:'',visionProvider:settings.selectedVisionProvider,variantTarget:3});
  const [images,setImages]=useState([]);
  const [error,setError]=useState('');
  useEffect(()=>setForm(f=>({...f,provider:settings.selectedProvider,visionProvider:settings.selectedVisionProvider})),[settings.selectedProvider,settings.selectedVisionProvider]);
  const fileChange=async(files)=>{
    const selected=[...files].slice(0,4);
    const data=await Promise.all(selected.map(file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file)})));
    setImages(data);
  };
  const submit=async(e)=>{
    e.preventDefault();setError('');
    try{
      const studioId=studio?.access?.studioId;
      const data=await api('/api/jobs',{method:'POST',body:JSON.stringify({...form,studioId,referenceImages:images})});
      onCreated(data.job);setForm(f=>({...f,name:'',brief:'',subtype:''}));setImages([]);
    }catch(err){setError(err.message)}
  };
  return <section className="panel create-panel">
    <div className="panel-head"><div><span className="eyebrow">NOUVEL ASSET</span><h2>Créer 3 variantes 3D</h2></div><span className="badge">Plan → Build → Capture → Review</span></div>
    <form onSubmit={submit}>
      <div className="form-grid">
        <label>Nom de l'asset<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Cocotier tropical" /></label>
        <label>Catégorie<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option>tree</option><option>bush</option><option>rock</option><option>building</option><option>furniture</option><option>prop</option><option>road</option><option>bridge</option></select></label>
        <label>Sous-type<input value={form.subtype} onChange={e=>setForm({...form,subtype:e.target.value})} placeholder="coconut_palm, cherry_blossom..." /></label>
        <label>Style<input value={form.style} onChange={e=>setForm({...form,style:e.target.value})} /></label>
        <label>IA texte<select value={form.provider} onChange={e=>setForm({...form,provider:e.target.value})}>{providers.map(id=><option key={id} value={id} disabled={!settings.providers[id]?.configured}>{id}</option>)}</select></label>
        <label>IA planification<select value={form.planningProvider} onChange={e=>setForm({...form,planningProvider:e.target.value,planningModel:''})}>{providers.map(id=><option key={id} value={id} disabled={!settings.providers[id]?.configured}>{id}</option>)}</select></label>
        <label>Modèle de planification (facultatif)<input value={form.planningModel} onChange={e=>setForm({...form,planningModel:e.target.value})} placeholder="Vide = modèle du provider sélectionné" /></label>
        <label>IA vision<select value={form.visionProvider} onChange={e=>setForm({...form,visionProvider:e.target.value})}>{providers.map(id=><option key={id} value={id} disabled={!settings.providers[id]?.configured}>{id}</option>)}</select></label>
        <div className="generation-summary"><strong>Mode 3D actif</strong><span>{generationModeName(settings.generationMode)}</span><small>Modifiable via « Paramètres IA » en haut à droite.</small></div>
        <label>Variantes<select value={form.variantTarget} onChange={e=>setForm({...form,variantTarget:Number(e.target.value)})}>{[1,2,3,4,5,6].map(n=><option key={n}>{n}</option>)}</select></label>
      </div>
      <label>Brief complet<textarea rows="5" value={form.brief} onChange={e=>setForm({...form,brief:e.target.value})} placeholder="Décris la silhouette, les proportions, les branches, feuilles, couleurs, détails indispensables..." /></label>
      <div className="reference-row">
        <label className="upload">Références visuelles<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>fileChange(e.target.files)} /></label>
        <div className="reference-previews">{images.map((src,i)=><img key={i} src={src} />)}</div>
      </div>
      {error&&<div className="error">{error}</div>}
      <button className="primary launch" disabled={!form.name.trim()||!form.brief.trim()||!studio?.access?.studioId}>Lancer la création</button>
    </form>
  </section>;
}

function PlanView({job}) {
  if(!job.plan)return null;
  return <div className="plan-box"><div className="plan-top"><strong>Plan 3D · v{job.planVersion}</strong><span>{job.plan.components?.length||0} composants · {job.plan.nativeMethod}</span></div>
    <div className="component-list">{(job.plan.components||[]).map(c=><span key={c.id} title={c.parentId?'parent: '+c.parentId:'root'}>{c.name}</span>)}</div>
    {(job.plan.structureNormalization?.repairs?.length>0)&&<p className="repair">Relations réparées automatiquement : {job.plan.structureNormalization.repairs.length}</p>}
  </div>;
}

function VariantCard({job,variant,onRefresh}) {
  const [feedback,setFeedback]=useState('');
  const [rating,setRating]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const correct=async(mode)=>{
    if(!feedback.trim())return;
    setBusy(true);try{await api('/api/jobs/'+job.id+'/correct',{method:'POST',body:JSON.stringify({variantId:variant.id,text:feedback,mode})});setFeedback('');await onRefresh()}finally{setBusy(false)}
  };
  const save=async()=>{setBusy(true);setError('');try{await api('/api/jobs/'+job.id+'/select',{method:'POST',body:JSON.stringify({variantId:variant.id,userRating:rating===''?null:Number(rating)})});await onRefresh()}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <article className={'variant '+(job.bestVariantId===variant.id?'best':'')}>
    <div className="variant-head"><div><span className="variant-no">V{variant.order+1}</span><strong>{variant.profile?.label||'Variante'}</strong></div><div>{variant.review&&<span className={'score '+scoreClass(variant.review.score)}>{Number(variant.review.score).toFixed(1)}/10</span>}<span className="mini-status">{variant.status}</span></div></div>
    <div className="captures">{(variant.captures||[]).map((c,i)=><a key={c.fileName} href={'/api/jobs/'+job.id+'/captures/'+c.fileName} target="_blank"><img src={'/api/jobs/'+job.id+'/captures/'+c.fileName} alt={'vue '+(i+1)} /></a>)}</div>
    <div className="variant-meta"><span title={'Moteur effectif : '+(variant.engineUsed||job.engine)}>{sourceName(variant)}</span><span>{variant.technicalAudit?.partCount!=null?variant.technicalAudit.partCount+' parts':''}</span><span>{variant.technicalAudit?.passed?'audit OK':variant.technicalAudit?'audit KO':''}</span></div>
    {variant.review&&<div className="review"><p><strong>{variant.review.decision}</strong> · {variant.review.improvement}</p><div className="criteria">{(variant.review.criteria||[]).map((c,i)=><span key={i} title={c.comment}>{c.name}: {c.score}/10</span>)}</div></div>}
    {variant.status==='done'&&job.status==='review_ready'&&<div className="variant-actions">
      <label>Ta note (0–10)
        <select value={rating} onChange={e=>setRating(e.target.value)} aria-label="Note humaine">
          <option value="">Choisir une note</option>
          {Array.from({length:11},(_,i)=>i).map(n=><option key={n} value={n}>{n}/10</option>)}
        </select>
      </label>
      <button className="primary" disabled={busy||rating===''} onClick={save}>Choisir + sauvegarder</button>
      <small>La bibliothèque n'apprend que des assets explicitement choisis avec une note humaine ≥ 8/10.</small>
      <input value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="Correction à appliquer..." />
      <button disabled={busy||!feedback.trim()} onClick={()=>correct('patch')}>Patch</button>
      <button disabled={busy||!feedback.trim()} onClick={()=>correct('rebuild')}>Rebuild plan</button>
    </div>}
    {error&&<div className="error">{error}</div>}
    {job.selectedVariantId===variant.id&&<div className="saved">Sauvegardé : {job.savedAsset?.path}</div>}
  </article>;
}

function GenerationScoreSummary({job}) {
  const buckets = [
    { id: 'local_parts', title: 'Notre pipeline (Parts)' },
    { id: 'roblox_native', title: 'IA native Roblox' },
  ].map(group => {
    const variants = (job.variants||[]).filter(v => (v.generationSource ||
      (v.engineUsed === 'native' ? 'roblox_native' : v.engineUsed?.startsWith('parts') ? 'local_parts' : null)) === group.id);
    const scores = variants.filter(v=>v.review && Number.isFinite(Number(v.review.score)))
      .map(v=>Number(v.review.score)).filter(score=>score>=0 && score<=10);
    return { ...group, count: variants.length, mean: scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : null };
  });
  if (!buckets.some(bucket=>bucket.count)) return null;
  return <div className="source-score-comparison">
    <strong>Scores par moteur réellement utilisé</strong>
    <div>{buckets.map(bucket=><span key={bucket.id}><b>{bucket.title}</b>
      <small>{bucket.count} variante(s) · {bucket.mean == null ? 'Pas encore de note' : 'moyenne ' + bucket.mean.toFixed(1) + '/10'}</small>
    </span>)}</div>
    <p>Une note Roblox native n'est pas une mesure des performances géométriques de notre IA locale.</p>
  </div>;
}

function JobDetail({job,onRefresh}) {
  const [traceOpen,setTraceOpen]=useState(false);
  const [trace,setTrace]=useState([]);
  const [artifacts,setArtifacts]=useState([]);
  const [actionBusy,setActionBusy]=useState(false);
  const openTrace=async()=>{
    const [d,a]=await Promise.all([api('/api/jobs/'+job.id+'/trace?limit=250'),api('/api/jobs/'+job.id+'/trace/artifacts?limit=250')]);
    setTrace(d.events||[]);setArtifacts(a.artifacts||[]);setTraceOpen(true)
  };
  const resume=async()=>{setActionBusy(true);try{await api('/api/jobs/'+job.id+'/resume',{method:'POST',body:'{}'});await onRefresh()}finally{setActionBusy(false)}};
  const stop=async()=>{setActionBusy(true);try{await api('/api/jobs/'+job.id+'/stop',{method:'POST',body:'{}'});await onRefresh()}finally{setActionBusy(false)}};
  return <section className="panel job-detail">
    <div className="panel-head"><div><span className="eyebrow">JOB {job.id.slice(0,8)}</span><h2>{job.name}</h2><p>{job.brief}</p></div><div className="job-state"><span className={'status '+(['failed','interrupted'].includes(job.status)?'offline':job.status==='saved'||job.status==='review_ready'?'online':'working')}>{statusLabel[job.status]||job.status}</span><button onClick={openTrace}>Trace</button>{['failed','interrupted','stopped'].includes(job.status)&&<button className="primary" disabled={actionBusy} onClick={resume}>Reprendre</button>}{['queued','understanding','planning','generating'].includes(job.status)&&<button disabled={actionBusy} onClick={stop}>Arrêter</button>}</div></div>
    {job.error&&<div className="error"><strong>{job.error.code}</strong> · {job.error.message}</div>}
    <GenerationScoreSummary job={job}/>
    <PlanView job={job}/>
    <div className="variants">{(job.variants||[]).map(v=><VariantCard key={v.id} job={job} variant={v} onRefresh={onRefresh}/>)}</div>
    <div className="timeline"><h3>Activité</h3>{[...(job.events||[])].reverse().slice(0,40).map(e=><div key={e.id}><time>{new Date(e.at).toLocaleTimeString()}</time><strong>{e.type}</strong><span>{e.message}</span>{e.data && Object.keys(e.data).length > 0 && <details><summary>Détails techniques</summary><pre>{JSON.stringify(e.data,null,2).slice(0,12000)}</pre></details>}</div>)}</div>
    {traceOpen&&<div className="modal-backdrop"><div className="modal trace-modal"><div className="modal-head"><div><h2>FULL TRACE</h2><p>{trace.length} événements · {artifacts.length} artifacts</p></div><button onClick={()=>setTraceOpen(false)}>✕</button></div><div className="artifact-list">{artifacts.slice().reverse().map(a=><a key={a.id} href={'/api/jobs/'+job.id+'/trace/artifacts/'+a.id} target="_blank" rel="noreferrer"><strong>{a.category}</strong><span>{a.name}</span><small>{Math.round((a.size||0)/1024)} Ko</small></a>)}</div><pre>{trace.map(e=>JSON.stringify(e,null,2)).join('\n\n')}</pre></div></div>}
  </section>;
}

export default function App(){
  const [health,setHealth]=useState(null),[settings,setSettings]=useState(null),[jobs,setJobs]=useState([]),[selectedId,setSelectedId]=useState(null),[settingsOpen,setSettingsOpen]=useState(false),[fatal,setFatal]=useState('');
  const selected=useMemo(()=>jobs.find(j=>j.id===selectedId)||jobs[0]||null,[jobs,selectedId]);
  const refreshSettings=async()=>{const d=await api('/api/provider-settings');setSettings(d.settings)};
  const refresh=async()=>{
    try{
      const [h,j]=await Promise.all([api('/api/health'),api('/api/jobs')]);
      setHealth(h);setJobs(j.jobs||[]);setFatal('');
      if(!selectedId&&j.jobs?.[0])setSelectedId(j.jobs[0].id);
    }catch(e){setFatal(e.message)}
  };
  useEffect(()=>{refreshSettings().catch(e=>setFatal(e.message));refresh();const timer=setInterval(refresh,2200);return()=>clearInterval(timer)},[]);
  if(!settings)return <div className="loading">Connexion au serveur...</div>;
  return <div className="app">
    <header className="topbar"><div className="brand"><div className="logo">R</div><div><strong>Roblox Assets Creator</strong><span>3D pipeline standalone</span></div></div><div className="top-actions"><span title="Version du serveur API sur le port 3001">API {health?.server?.buildTag||'ancienne version / inconnue'}</span><span className={'status '+(health?.providers?.local?.ok?'online':'offline')}>Ollama {health?.providers?.local?.ok?'online':'offline'}</span><button onClick={()=>setSettingsOpen(true)}>⚙ Paramètres IA</button></div></header>
    <main>
      {fatal&&<div className="error global">{fatal}</div>}
      <div className="dashboard-grid">
        <StudioPanel studio={health?.studio} onRefresh={refresh}/>
        <CreatePanel settings={settings} studio={health?.studio} onCreated={job=>{setSelectedId(job.id);refresh()}}/>
      </div>
      <section className="jobs-strip"><div className="jobs-title"><h3>Créations</h3><span>{jobs.length} job(s)</span></div><div className="job-tabs">{jobs.map(j=><button key={j.id} className={selected?.id===j.id?'active':''} onClick={()=>setSelectedId(j.id)}><strong>{j.name}</strong><span>{statusLabel[j.status]||j.status}</span></button>)}</div></section>
      {selected?<JobDetail job={selected} onRefresh={refresh}/>:<section className="empty"><h2>Aucun asset</h2><p>Connecte Studio, décris un asset et lance la première génération.</p></section>}
    </main>
    {settingsOpen&&<ProviderSettings settings={settings} onClose={()=>setSettingsOpen(false)} onReload={refreshSettings}/>}
  </div>
}
