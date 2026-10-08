import { useEffect, useMemo, useState } from 'react';
import { resolveStudioSelection } from './studioSelection.js';
import CorrectionQuestions from './CorrectionQuestions.jsx';

const providers = ['local','openai','claude','deepseek','gemini','openrouter'];
const generationModes = [
  { id: 'local', title: 'Sans IA Roblox', description: 'Par défaut · planification IA et construction 3D par Parts. Roblox Studio sert à placer et capturer le modèle, sans génération IA native.' },
  { id: 'roblox', title: 'IA Roblox uniquement', description: 'Géométrie générée par Roblox via MCP, sans repli vers les Parts. Le provider IA configuré peut encore participer au plan et à la critique.' },
  { id: 'hybrid', title: 'Local + IA Roblox', description: 'Parts par défaut ; Roblox natif si disponible pour les catégories organiques, puis repli Parts. Les anciens jobs gardent leur choix initial.' },
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
const defectLabels = {
  too_round:'Trop rond',not_round_enough:'Pas assez rond',too_straight:'Trop droit',too_bent:'Trop courbé',wrong_proportion:'Mauvaises proportions',too_thin:'Trop fin',too_thick:'Trop épais',asymmetric_bad:'Asymétrie gênante',
  too_few_details:'Trop peu de détails',too_many_details:'Trop de détails',visible_segment_seams:'Segments visibles',details_below_min_size:'Détails trop petits',
  too_few_leaves:'Trop peu de feuilles',too_many_leaves:'Trop de feuilles',too_few_parts:'Trop peu de pièces',too_many_parts:'Trop de pièces',
  texture_too_flat:'Texture trop plate',texture_too_noisy:'Texture trop chargée',colors_too_similar:'Couleurs trop proches',colors_too_saturated:'Couleurs trop saturées',
  missing_component:'Composant manquant',misplaced_component:'Composant mal placé',floating_component:'Composant flottant',overlap_bad:'Chevauchement gênant',
  unreadable_silhouette:'Silhouette peu lisible',variants_too_similar:'Variantes trop semblables',
};
const statusLabel = {
  queued:'En attente',understanding:'Analyse référence',planning:'Planification',generating:'Génération',
  review_ready:'À valider',clarifying_correction:'Clarification IA',awaiting_correction_answers:'L’IA attend ta réponse',awaiting_decomposition_review:'Inventaire à valider',saved:'Sauvegardé',failed:'Erreur',stopped:'Arrêté',interrupted:'Interrompu'
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
  const [form,setForm]=useState({name:'',brief:'',category:'auto',subtype:'',style:'Roblox low-poly, formes simplifiées, arêtes franches',sizeStuds:[10,12,10],maxParts:180,previewDecomposition:false,provider:settings.selectedProvider,planningProvider:settings.selectedProvider,planningModel:'',visionProvider:settings.selectedVisionProvider,variantTarget:3,continuousGeneration:true,batchTarget:''});
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
        <label>Nom de l'asset (facultatif)<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Cocotier tropical" /></label>
        <label>Catégorie<select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}><option value="auto">Auto-détection</option><option value="handheld">Objet tenu en main</option><option value="vehicle">Véhicule</option>
        <option value="building">Bâtiment</option><option value="vegetation">Végétal</option><option value="animal">Animal</option>
        <option value="furniture">Mobilier</option><option value="infrastructure">Infrastructure</option><option value="generic">Générique</option></select></label>
        <label>Sous-type<input value={form.subtype} onChange={e=>setForm({...form,subtype:e.target.value})} placeholder="coconut_palm, cherry_blossom..." /></label>
        <label>Style<input value={form.style} onChange={e=>setForm({...form,style:e.target.value})} /></label>
        <label>IA texte<select value={form.provider} onChange={e=>setForm({...form,provider:e.target.value})}>{providers.map(id=><option key={id} value={id} disabled={!settings.providers[id]?.configured}>{id}</option>)}</select></label>
        <label>IA planification<select value={form.planningProvider} onChange={e=>setForm({...form,planningProvider:e.target.value,planningModel:''})}>{providers.map(id=><option key={id} value={id} disabled={!settings.providers[id]?.configured}>{id}</option>)}</select></label>
        <label>Modèle de planification (facultatif)<input value={form.planningModel} onChange={e=>setForm({...form,planningModel:e.target.value})} placeholder="Vide = modèle du provider sélectionné" /></label>
        <label>IA vision<select value={form.visionProvider} onChange={e=>setForm({...form,visionProvider:e.target.value})}>{providers.map(id=><option key={id} value={id} disabled={!settings.providers[id]?.configured}>{id}</option>)}</select></label>
        <div className="generation-summary"><strong>Mode 3D actif</strong><span>{generationModeName(settings.generationMode)}</span><small>Modifiable via « Paramètres IA » en haut à droite.</small></div>
        <label>Largeur (studs)<input type="number" min="0.2" max="200" step="0.2" value={form.sizeStuds[0]} onChange={e=>setForm({...form,sizeStuds:[Number(e.target.value),form.sizeStuds[1],form.sizeStuds[2]]})}/></label>
        <label>Hauteur (studs)<input type="number" min="0.2" max="200" step="0.2" value={form.sizeStuds[1]} onChange={e=>setForm({...form,sizeStuds:[form.sizeStuds[0],Number(e.target.value),form.sizeStuds[2]]})}/></label>
        <label>Profondeur (studs)<input type="number" min="0.2" max="200" step="0.2" value={form.sizeStuds[2]} onChange={e=>setForm({...form,sizeStuds:[form.sizeStuds[0],form.sizeStuds[1],Number(e.target.value)]})}/></label>
        <label>Nombre de Parts maximal<input type="number" min="1" max="180" value={form.maxParts} onChange={e=>setForm({...form,maxParts:Number(e.target.value)})}/></label>
        <label className="preview-toggle"><input type="checkbox" checked={form.previewDecomposition} onChange={e=>setForm({...form,previewDecomposition:e.target.checked})}/> Examiner la décomposition avant construction</label>
        <label>Variantes par lot<select disabled={form.continuousGeneration} value={form.variantTarget} onChange={e=>setForm({...form,variantTarget:Number(e.target.value)})}>{[1,2,3,4,5,6].map(n=><option key={n}>{n}</option>)}</select></label>
        <label className="preview-toggle"><input type="checkbox" checked={form.continuousGeneration} onChange={e=>setForm({...form,continuousGeneration:e.target.checked,variantTarget:3})}/> Enchaîner les lots de 3 ; noter plus tard</label>
        <label>Nombre de lots (3 variantes chacun)<input type="number" min="1" step="1" list="batch-targets" disabled={!form.continuousGeneration} value={form.batchTarget} onChange={e=>setForm({...form,batchTarget:e.target.value})} placeholder="Vide = jusqu’à Arrêter" /><datalist id="batch-targets"><option value="3"/><option value="5"/><option value="10"/></datalist></label>
      </div>
      <label>Brief complet<textarea rows="5" value={form.brief} onChange={e=>setForm({...form,brief:e.target.value})} placeholder="Décris un objet en une phrase, ou ajoute une photo sans texte. Tu peux aussi détailler les proportions et les couleurs..." /></label>
      <div className="reference-row">
        <label className="upload" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();fileChange(e.dataTransfer.files)}}>Références visuelles — glisser/déposer ou cliquer<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e=>fileChange(e.target.files)} /></label>
        <div className="reference-previews">{images.map((src,i)=><img key={i} src={src} />)}</div>
      </div>
      {error&&<div className="error">{error}</div>}
      <button className="primary launch" disabled={(!form.name.trim()&&!form.brief.trim()&&images.length===0)||!studio?.access?.studioId}>Lancer la création</button>
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
    {variant.defects?.length>0&&<ul className="review-defects">{variant.defects.map((defect,i)=><li key={i}>{defect.component} · {defect.issue} · {defect.severity}</li>)}</ul>}
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

const dateLabel = (value) => value ? new Date(value).toLocaleString('fr-FR') : '—';

function ReviewRow({job,variant,onRefresh,defectOptions}) {
  const [rating,setRating]=useState(variant.humanRating == null ? '' : String(variant.humanRating));
  const [note,setNote]=useState('');
  const [feedback,setFeedback]=useState('');
  const [issues,setIssues]=useState([]);
  const [componentId,setComponentId]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>setRating(variant.humanRating == null ? '' : String(variant.humanRating)),[variant.id,variant.humanRating]);
  const act=async(url,body)=>{
    setBusy(true);setError('');
    try { await api(url,{method:'POST',body:JSON.stringify(body)}); await onRefresh(); }
    catch (cause) { setError(cause.message); }
    finally { setBusy(false); }
  };
  const saveRating=()=>act(`/api/jobs/${job.id}/variants/${variant.id}/rating`,{rating:Number(rating),note});
  const correct=(mode)=>act(`/api/jobs/${job.id}/correct`,{variantId:variant.id,issues,componentId:componentId||null,note:feedback,mode});
  const validate=()=>act(`/api/jobs/${job.id}/corrections/${variant.correctionId||variant.id}/validate`,{approved:true,rating:variant.humanRating});
  const canSave=['review_ready','stopped','failed'].includes(job.status);
  const sourceVariant=(job.variants||[]).find(entry=>entry.id===variant.correctionOf);
  const previousComponents=sourceVariant?.geometryDefinition?.primitives?.components||[];
  const currentComponents=variant.geometryDefinition?.primitives?.components||[];
  const changedComponents=sourceVariant ? currentComponents.filter(component=>{
    const prior=previousComponents.find(entry=>entry.componentId===component.componentId);
    return JSON.stringify(prior)!==JSON.stringify(component);
  }).map(component=>component.componentId) : [];
  const lineage=variant.correctionOf ? `Patch de ${variant.correctionOf.slice(0,8)}` : variant.rebuildOf ? `Rebuild de ${variant.rebuildOf.slice(0,8)}` : variant.convergenceOf ? `Nouvelle stratégie de ${variant.convergenceOf.slice(0,8)}` : 'Version initiale';
  const change=variant.patch?.ops?.length ? variant.patch.ops.map(op=>`${op.op} ${op.path}`).join(', ') : variant.paramChange ? `${variant.paramChange.param} ${variant.paramChange.direction}` : variant.correctionOf ? 'Correction guidée' : variant.rebuildOf ? 'Nouveau plan' : '—';
  const relatedFeedback=(job.feedback||[]).filter(entry=>entry.variantId===variant.id);
  return <>
    <tr className={job.bestVariantId===variant.id?'best-row':''}>
      <th scope="row"><strong>V{variant.order+1}</strong><small>{job.name} · lot {variant.batchNumber||1} · plan v{variant.planVersion}</small><small>{variant.id.slice(0,8)} · {variant.status}</small></th>
      <td>{dateLabel(variant.createdAt)}<small>Fin : {dateLabel(variant.finishedAt)}</small></td>
      <td>{sourceName(variant)}<small>{variant.technicalAudit?.partCount!=null?`${variant.technicalAudit.partCount} Parts`:''}</small></td>
      <td>{variant.review ? `${Number(variant.review.score).toFixed(1)}/10` : '—'}<small>{variant.review?.decision||''}</small></td>
      <td><strong>{variant.humanRating==null?'—':`${variant.humanRating}/10`}</strong><small>{(variant.humanRatingHistory||[]).length} notation(s)</small></td>
      <td><div className="review-thumbs">{(variant.captures||[]).map((capture,index)=><a key={capture.fileName} href={`/api/jobs/${job.id}/captures/${capture.fileName}`} target="_blank" rel="noreferrer" title={`Vue ${index+1}`}><img src={`/api/jobs/${job.id}/captures/${capture.fileName}`} alt={`V${variant.order+1} vue ${index+1}`}/></a>)}</div></td>
      <td>{change}<small>{variant.correctionStatus ? ({resolved:'Résolu',unresolved:'Non résolu',no_effect:'Aucun effet',unsupported:'Non supporté'}[variant.correctionStatus]||variant.correctionStatus) : variant.correctionDecision ? (variant.correctionDecision.keep?'Conservée':'Écartée') : ''}</small></td>
      <td>{lineage}</td>
      <td><span>{job.selectedVariantId===variant.id?'Sauvegardée':''}</span></td>
    </tr>
    <tr className="review-details-row"><td colSpan="9"><details><summary>Notes, défauts, corrections et historique de V{variant.order+1}</summary>
      <div className="review-row-details">
        <div><strong>Proposition IA</strong><p>{variant.review?.improvement||'Aucune proposition disponible.'}</p><ul>{(variant.defects||variant.review?.problems||[]).map((defect,index)=><li key={index}>{defect.component} · {defect.issue} · {defect.severity}</li>)}</ul>
          <p>Modification appliquée : {change}. {variant.correctionDecision?.reason||''}</p>
          {variant.correctionStatus&&<p><strong>{({resolved:'Résolu',unresolved:'Non résolu',no_effect:'Aucun effet',unsupported:'Non supporté'}[variant.correctionStatus])}</strong> · {variant.correctionReason}</p>}
          {variant.correctionRequest&&<p>Retour : {variant.correctionRequest.text}</p>}
          {(variant.appliedOps||[]).length>0&&<p>Opérations appliquées : {variant.appliedOps.map(op=>`${op.op} ${op.path} → ${JSON.stringify(op.value)}`).join(' ; ')}</p>}
          {(variant.rejectedOps||[]).length>0&&<p>Opérations refusées : {variant.rejectedOps.map(op=>`${op.path} (${op.reason})`).join(' ; ')}</p>}
          {(variant.changedFields||[]).length>0&&<p>Champs modifiés : {variant.changedFields.join(', ')}</p>}
          {variant.targetedReview&&<p>Revue ciblée : {variant.targetedReview.evidence} {variant.targetedReview.remaining&&`· Reste : ${variant.targetedReview.remaining}`}</p>}
          {changedComponents.length>0&&<p>Composants modifiés : {changedComponents.join(', ')}</p>}
          <p>Audit : {variant.technicalAudit?.passed?'conforme':variant.technicalAudit?'échec':'indisponible'} · plan v{variant.planVersion} · {variant.geometryDefinition?.archetype||variant.geometryDefinition?.version||'géométrie native'}</p>
          {(variant.review?.criteria||[]).map((criterion,index)=><p key={index}>{criterion.name} : {criterion.score}/10 · {criterion.comment}</p>)}
          {relatedFeedback.map(entry=><p key={entry.id}>Feedback {entry.mode} : {entry.text}</p>)}
        </div>
        <div><strong>Mes notes</strong><ul>{(variant.humanRatingHistory||[]).map(entry=><li key={entry.id}>{dateLabel(entry.at)} : {entry.rating}/10 {entry.note&&`· ${entry.note}`}</li>)}</ul>
          {variant.status==='done'&&<div className="review-edit"><label>Note /10<input type="number" min="0" max="10" step="0.1" disabled={job.selectedVariantId===variant.id&&job.status==='saved'} value={rating} onChange={e=>setRating(e.target.value)}/></label><label>Commentaire<input disabled={job.selectedVariantId===variant.id&&job.status==='saved'} value={note} maxLength={1000} onChange={e=>setNote(e.target.value)} placeholder="Ce qui fonctionne ou reste à corriger"/></label><button disabled={busy||rating===''||Number(rating)<0||Number(rating)>10||(job.selectedVariantId===variant.id&&job.status==='saved')} onClick={saveRating}>Enregistrer la note</button>
          {canSave&&<button disabled={busy||variant.humanRating==null||['no_effect','unsupported'].includes(variant.correctionStatus)} onClick={()=>act(`/api/jobs/${job.id}/select`,{variantId:variant.id,userRating:variant.humanRating})}>Choisir et sauvegarder</button>}
          {variant.correctionStatus==='resolved'&&<button disabled={busy||variant.correctionValidated===true} onClick={validate}>{variant.correctionValidated?'Correction validée':'Valider cette correction'}</button>}
          {job.selectedVariantId===variant.id&&job.status==='saved'&&<small>Note figée lors de la sauvegarde pour préserver la bibliothèque validée.</small>}
          <fieldset className="correction-issues"><legend>Défauts à corriger</legend>{defectOptions.map(issue=><label key={issue}><input type="checkbox" checked={issues.includes(issue)} onChange={e=>setIssues(current=>e.target.checked?[...current,issue]:current.filter(value=>value!==issue))}/>{defectLabels[issue]||issue.replaceAll('_',' ')}</label>)}</fieldset>
          <label>Composant<select value={componentId} onChange={e=>setComponentId(e.target.value)}><option value="">Asset entier</option>{(job.plan?.components||[]).map(component=><option key={component.id} value={component.id}>{component.name} ({component.id})</option>)}</select></label>
          <label>Nuance facultative<input value={feedback} onChange={e=>setFeedback(e.target.value)} placeholder="Précise le changement"/></label><button disabled={busy||(!feedback.trim()&&!issues.length)||Boolean(job.pendingCorrection)||variant.planVersion!==job.planVersion} onClick={()=>correct('patch')}>Patch</button><button disabled={busy||(!feedback.trim()&&!issues.length)||Boolean(job.pendingCorrection)} onClick={()=>correct('rebuild')}>Rebuild</button>{variant.planVersion!==job.planVersion&&<small>Ancien plan : utilise Rebuild pour cette variante.</small>}</div>}
          {error&&<p className="error">{error}</p>}
        </div>
      </div>
    </details></td></tr>
  </>;
}

function ReviewTable({job,jobs,onRefresh}) {
  const [filter,setFilter]=useState('all');
  const [visibleCount,setVisibleCount]=useState(50);
  const [defectOptions,setDefectOptions]=useState([]);
  useEffect(()=>{api('/api/review/defects').then(data=>setDefectOptions(data.issues||[])).catch(()=>{})},[]);
  const entries=(jobs||[job]).flatMap(item=>(item.variants||[]).map(variant=>({job:item,variant})))
    .filter(({variant})=>filter==='unrated' ? variant.status==='done'&&variant.humanRating==null : filter==='rated' ? variant.humanRating!=null : true)
    .sort((a,b)=>String(b.variant.createdAt||'').localeCompare(String(a.variant.createdAt||'')));
  return <section className="review-table-section"><div className="panel-head"><div><h3>Revue des variantes</h3><p>{entries.length} variante(s) affichables · revue possible pendant les lots suivants</p></div><label>Afficher <select value={filter} onChange={e=>{setFilter(e.target.value);setVisibleCount(50)}}><option value="all">Toutes</option><option value="unrated">À noter</option><option value="rated">Déjà notées</option></select></label></div>
    <div className="review-table-scroll"><table className="review-table"><thead><tr><th>Variante</th><th>Créée / terminée</th><th>Moteur</th><th>IA</th><th>Ma note</th><th>Captures</th><th>Modification</th><th>Origine</th><th>Choix</th></tr></thead><tbody>{entries.slice(0,visibleCount).map(({job:entryJob,variant})=><ReviewRow key={variant.id} job={entryJob} variant={variant} onRefresh={onRefresh} defectOptions={defectOptions}/>)}</tbody></table></div>
    {entries.length>visibleCount&&<button className="review-more" onClick={()=>setVisibleCount(count=>count+50)}>Afficher 50 variantes de plus</button>}
  </section>;
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

function DecompositionApproval({job,onRefresh}){
  const [draft,setDraft]=useState(JSON.stringify(job.plan?.components||[],null,2));
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>setDraft(JSON.stringify(job.plan?.components||[],null,2)),[job.id,job.planVersion]);
  const approve=async()=>{
    setBusy(true);setError('');
    try{
      const components=JSON.parse(draft);
      if(!Array.isArray(components)||!components.length)throw new Error('Le JSON doit contenir une liste de composants.');
      await api('/api/jobs/'+job.id+'/decomposition',{method:'POST',body:JSON.stringify({components})});
      await onRefresh();
    }catch(e){setError(e.message)}finally{setBusy(false)}
  };
  return <section className="decomposition-approval">
    <h3>Aperçu de décomposition — validation requise</h3>
    <p>Vérifie les composants, leurs identifiants et parents. Tu peux les renommer, retirer ou modifier leurs proportions dans le JSON ci-dessous. La construction attend ta validation.</p>
    <textarea rows={12} spellCheck={false} aria-label="Composants de la décomposition" value={draft} onChange={e=>setDraft(e.target.value)}/>
    {error&&<div className="error">{error}</div>}
    <button className="primary" disabled={busy} onClick={approve}>Valider la décomposition et construire</button>
  </section>;
}

function LearningDashboard({stats}){
  if(!stats)return null;
  return <section className="panel learning-dashboard">
    <div className="panel-head"><div><span className="eyebrow">APPRENTISSAGE LOCAL</span><h2>Bibliothèque de références validées</h2></div>
      <strong>{stats.totalValidated||0} exemple(s) humain(s)</strong></div>
    <div className="dashboard-stats">
      <div><b>Par catégorie</b><p>{Object.entries(stats.byCategory||{}).map(([category,count])=>category+' : '+count).join(' · ')||'Aucun exemple validé'}</p></div>
      <div><b>Scores par moteur</b><p>{Object.entries(stats.engines||{}).map(([engine,x])=>engine+' : '+x.avgScore+'/10 ('+x.count+')').join(' · ')||'Aucune évaluation enregistrée'}</p></div>
      <div><b>Jeu d'évaluation</b><p>{stats.evaluation?.fixtures?
        stats.evaluation.passed+'/'+stats.evaluation.fixtures+' tests statiques · visuel '+(stats.evaluation.averageVisualScore==null?'non mesuré':stats.evaluation.averageVisualScore+'/10')
        :'Pas encore exécuté'}</p></div>
    </div>
  </section>;
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
    <div className="panel-head"><div><span className="eyebrow">JOB {job.id.slice(0,8)}</span><h2>{job.name}</h2><p>{job.brief}</p></div><div className="job-state"><span className={'status '+(['failed','interrupted'].includes(job.status)?'offline':job.status==='saved'||job.status==='review_ready'?'online':'working')}>{statusLabel[job.status]||job.status}</span><button onClick={openTrace}>Trace</button>{['failed','interrupted','stopped'].includes(job.status)&&<button className="primary" disabled={actionBusy} onClick={resume}>Reprendre</button>}{['queued','understanding','planning','generating','awaiting_decomposition_review'].includes(job.status)&&<button disabled={actionBusy} onClick={stop}>Arrêter</button>}</div></div>
    {job.error&&<div className="error"><strong>{job.error.code}</strong> · {job.error.message}</div>}
    {job.continuousGeneration&&<p className="continuous-banner">Génération en série · lot {job.activeBatchNumber||1}{job.batchTarget ? ` / ${job.batchTarget}` : ' / ∞'} · {job.completedBatchNumber||0} lot(s) prêts · {job.status==='review_ready' ? 'Nombre de lots atteint : toutes les variantes sont prêtes pour la revue.' : 'Les variantes terminées restent consultables et peuvent être notées pendant la génération.'}</p>}
    <GenerationScoreSummary job={job}/>
    <PlanView job={job}/>
    {job.status==='awaiting_decomposition_review'&&<DecompositionApproval job={job} onRefresh={onRefresh}/>}
    <ReviewTable job={job} onRefresh={onRefresh}/>
    <div className="timeline"><h3>Activité</h3>{[...(job.events||[])].reverse().slice(0,40).map(e=><div key={e.id}><time>{new Date(e.at).toLocaleTimeString()}</time><strong>{e.type}</strong><span>{e.message}</span>{e.data && Object.keys(e.data).length > 0 && <details><summary>Détails techniques</summary><pre>{JSON.stringify(e.data,null,2).slice(0,12000)}</pre></details>}</div>)}</div>
    {traceOpen&&<div className="modal-backdrop"><div className="modal trace-modal"><div className="modal-head"><div><h2>FULL TRACE</h2><p>{trace.length} événements · {artifacts.length} artifacts</p></div><button onClick={()=>setTraceOpen(false)}>✕</button></div><div className="artifact-list">{artifacts.slice().reverse().map(a=><a key={a.id} href={'/api/jobs/'+job.id+'/trace/artifacts/'+a.id} target="_blank" rel="noreferrer"><strong>{a.category}</strong><span>{a.name}</span><small>{Math.round((a.size||0)/1024)} Ko</small></a>)}</div><pre>{trace.map(e=>JSON.stringify(e,null,2)).join('\n\n')}</pre></div></div>}
  </section>;
}

export default function App(){
  const [health,setHealth]=useState(null),[stats,setStats]=useState(null),[settings,setSettings]=useState(null),[jobs,setJobs]=useState([]),[selectedId,setSelectedId]=useState(null),[showAllReviews,setShowAllReviews]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[fatal,setFatal]=useState('');
  const selected=useMemo(()=>jobs.find(j=>j.id===selectedId)||jobs[0]||null,[jobs,selectedId]);
  const refreshSettings=async()=>{const d=await api('/api/provider-settings');setSettings(d.settings)};
  const refresh=async()=>{
    try{
      const [h,j,t]=await Promise.all([api('/api/health'),api('/api/jobs'),api('/api/learning/stats').catch(()=>({stats:null}))]);
      setHealth(h);setJobs(j.jobs||[]);setStats(t.stats||null);setFatal('');
      if(!selectedId&&j.jobs?.[0])setSelectedId(j.jobs[0].id);
    }catch(e){setFatal(e.message)}
  };
  useEffect(()=>{refreshSettings().catch(e=>setFatal(e.message));refresh();const timer=setInterval(refresh,2200);return()=>clearInterval(timer)},[]);
  if(!settings)return <div className="loading">Connexion au serveur...</div>;
  return <div className="app">
    <header className="topbar"><div className="brand"><div className="logo">R</div><div><strong>Roblox Assets Creator</strong><span>3D pipeline standalone</span></div></div><div className="top-actions"><span title="Version du serveur API sur le port 3001">API {health?.server?.buildTag||'ancienne version / inconnue'}</span><span className={'status '+(health?.providers?.local?.ok?'online':'offline')}>Ollama {health?.providers?.local?.ok?'online':'offline'}</span><button onClick={()=>setSettingsOpen(true)}>⚙ Paramètres IA</button></div></header>
    <main>
      {fatal&&<div className="error global">{fatal}</div>}
      {jobs.filter(job => job.pendingCorrection?.clarification?.state === 'waiting').map((job, index) =>
        <CorrectionQuestions key={job.pendingCorrection.id} job={job} api={api} onRefresh={refresh} autoOpen={index === 0}/>)}
      <div className="dashboard-grid">
        <StudioPanel studio={health?.studio} onRefresh={refresh}/>
        <CreatePanel settings={settings} studio={health?.studio} onCreated={job=>{setSelectedId(job.id);setShowAllReviews(false);refresh()}}/>
      </div>
      <LearningDashboard stats={stats}/>
      <section className="jobs-strip"><div className="jobs-title"><h3>Créations</h3><span>{jobs.length} job(s)</span></div><div className="job-tabs"><button className={showAllReviews?'active':''} onClick={()=>setShowAllReviews(true)}><strong>Toutes les revues</strong><span>Historique et notes</span></button>{jobs.map(j=><button key={j.id} className={!showAllReviews&&selected?.id===j.id?'active':''} onClick={()=>{setSelectedId(j.id);setShowAllReviews(false)}}><strong>{j.name}</strong><span>{statusLabel[j.status]||j.status}</span></button>)}</div></section>
      {showAllReviews?<section className="panel job-detail"><ReviewTable jobs={jobs} onRefresh={refresh}/></section>:selected?<JobDetail job={selected} onRefresh={refresh}/>:<section className="empty"><h2>Aucun asset</h2><p>Connecte Studio, décris un asset et lance la première génération.</p></section>}
    </main>
    {settingsOpen&&<ProviderSettings settings={settings} onClose={()=>setSettingsOpen(false)} onReload={refreshSettings}/>}
  </div>
}
