import { useRef, useState, useEffect } from 'react';

export default function CorrectionQuestions({ job, api, onRefresh, autoOpen = true }) {
  const correction = job.pendingCorrection;
  const clarification = correction.clarification;
  const [answers, setAnswers] = useState(clarification.answers || {});
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(autoOpen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef(null);
  const answerInput = useRef(null);
  const question = clarification.questions[index];
  const titleId = correction.id + '-clarification-title';
  const answerId = correction.id + '-correction-answer';
  useEffect(() => {
    if (visible && !dialog.current.open) dialog.current.showModal();
    if (!visible && dialog.current.open) dialog.current.close();
    if (visible) answerInput.current?.focus();
  }, [visible, index]);
  const act = async (action) => {
    setBusy(true); setError('');
    try {
      await api(`/api/jobs/${job.id}/corrections/${correction.id}/answers`, {
        method: 'POST', body: JSON.stringify({ action, answers }),
      });
      await onRefresh();
      return true;
    } catch (cause) { setError(cause.message); return false; }
    finally { setBusy(false); }
  };
  const close = async () => { if (await act('draft')) setVisible(false); };
  const next = async () => {
    if (question.required && !answers[question.id]?.trim()) { setError('Cette précision est indispensable.'); return; }
    if (await act('draft')) setIndex(index + 1);
  };
  const submit = async () => {
    const missing = clarification.questions.findIndex((entry) => entry.required && !answers[entry.id]?.trim());
    if (missing >= 0) { setIndex(missing); setError('Réponds à cette question avant de continuer.'); return; }
    await act('submit');
  };
  return <>
    <section className="clarification-banner" aria-live="polite">
      <div><strong>L’IA attend ta réponse · {job.name}</strong><p>La correction est suspendue. Tes réponses sont conservées.</p></div>
      <button onClick={() => setVisible(true)}>Répondre aux {clarification.questions.length} question(s)</button>
    </section>
    <dialog ref={dialog} className="modal clarification-modal" aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
      <div className="modal-head"><div><h2 id={titleId}>L’IA attend ta réponse</h2>
        <p>{job.name} · {correction.mode === 'patch' ? 'Correction ciblée' : 'Reconstruction'} · Question {index + 1} sur {clarification.questions.length}</p></div>
        <button disabled={busy} onClick={close} aria-label="Fermer et conserver les réponses">✕</button></div>
      <p className="clarification-request">Ta demande : {correction.originalText || correction.text}</p>
      {clarification.metrics.length > 0 && <div className="clarification-measures"><strong>Mesures actuelles de la variante source</strong>
        {clarification.metrics.map(metric => <p key={metric.label}>{metric.label} : <b>{(Array.isArray(metric.value) ? metric.value : [metric.value]).map(value => Number(value.toFixed(3))).join(' × ')} {metric.unit}</b></p>)}
      </div>}
      {clarification.diagnostic && <p className="muted">L’analyse IA n’a pas abouti. Précise directement le changement souhaité pour reprendre.</p>}
      <label className="clarification-question" htmlFor={answerId}>{question.question}</label>
      <p className="muted">{question.required ? 'Réponse indispensable' : 'Préférence facultative : tu peux laisser l’IA choisir.'}</p>
      <div className="clarification-options">{question.options.map(option => <button key={option} disabled={busy}
        className={answers[question.id] === option ? 'primary' : ''}
        onClick={() => setAnswers(current => ({ ...current, [question.id]: option }))}>{option}</button>)}</div>
      <textarea ref={answerInput} id={answerId} value={answers[question.id] || ''} maxLength={1000} disabled={busy}
        placeholder="Choisis une proposition ou écris ta réponse précise…"
        onChange={event => setAnswers(current => ({ ...current, [question.id]: event.target.value }))}/>
      {!question.required && <button disabled={busy} onClick={() => setAnswers(current => ({ ...current, [question.id]: '' }))}>Laisser l’IA choisir</button>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="clarification-actions">
        <button disabled={busy} onClick={() => act('cancel')}>Annuler la correction</button>
        {index > 0 && <button disabled={busy} onClick={() => { setIndex(index - 1); setError(''); }}>Précédent</button>}
        {index < clarification.questions.length - 1 ? <button className="primary" disabled={busy} onClick={next}>Suivant</button>
          : <button className="primary" disabled={busy} onClick={submit}>Appliquer mes réponses</button>}
      </div>
    </dialog>
  </>;
}
