import { useEffect, useState } from 'react';
import { Bell, Check, Database, Pause, Play, RotateCcw, Server, Workflow } from 'lucide-react';
import { uiText } from '../i18n';
import { useSeen } from './motion';

/** One pass on entry. Playback only explains the example; it never applies the proposal. */
export function useStory() {
  const [ref, seen] = useSeen<HTMLDivElement>(0.25);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { setReduced(query.matches); if (query.matches) setPlaying(false); };
    query.addEventListener('change', change); return () => query.removeEventListener('change', change);
  }, []);
  useEffect(() => { if (seen && !reduced) setPlaying(true); }, [seen, reduced]);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => { if (step === 2) setPlaying(false); else setStep(step + 1); }, 2800);
    return () => clearTimeout(timer);
  }, [step, playing]);
  return { ref, step, playing, reduced, select: (next: number) => { setPlaying(false); setStep(next); }, toggle: () => { if (!playing && step === 2) setStep(0); setPlaying(!playing); } };
}
export function StoryControl({ story }: { story: ReturnType<typeof useStory> }) {
  return <button className="story-control" onClick={story.toggle} aria-label={story.playing ? uiText('Pausar demonstração') : uiText('Reproduzir demonstração')} disabled={story.reduced}>
    {story.playing ? <Pause size={14} /> : story.step === 2 ? <RotateCcw size={14} /> : <Play size={14} />}
    {story.reduced ? uiText('Passo a passo') : story.playing ? uiText('Pausar') : uiText('Reproduzir')}
  </button>;
}

/** A compact, readable view of the actual sample's event dependencies. */
export function EventScene({ proposed, applied, active = 0 }: { proposed?: boolean; applied?: boolean; active?: number }) {
  return <div className="event-scene" data-active={active} data-proposed={proposed || applied || undefined} data-applied={applied || undefined} role="img" aria-label={uiText(proposed || applied ? 'Pedidos publica no Kafka, que conecta Pagamentos e Notificações.' : 'Pedidos publica no Kafka, que conecta Pagamentos.')}>
    <div className="scene-caption"><span className="scene-dot" />{uiText(applied ? 'Arquitetura atualizada' : proposed ? 'Prévia da mudança' : 'Arquitetura atual')}</div>
    <svg className="scene-wires" viewBox="0 0 520 290" aria-hidden preserveAspectRatio="none">
      <path d={`M125 140H217 M303 140H350V62H395${proposed || applied ? " M303 140H350V222H395" : ""}`} className="wire-base" />
      <path d="M125 140H217 M303 140H350V62H395" className="wire-flow" />
      {(proposed || applied) && <path d="M303 140H350V222H395" className="wire-new" />}
    </svg>
    <div className="scene-node scene-orders"><Server size={22} /><strong>{uiText('Pedidos')}</strong><small>{uiText('Publica eventos')}</small></div>
    <div className="scene-node scene-kafka"><Workflow size={25} /><strong>Kafka</strong><small>{uiText('Eventos')}</small></div>
    <div className="scene-node scene-payments"><Database size={21} /><strong>{uiText('Pagamentos')}</strong><small>{uiText('Consumidor')}</small></div>
    <div className="scene-node scene-notifications" data-visible={proposed || applied || undefined}><Bell size={21} /><strong>{uiText('Notificações')}</strong><small>{applied ? <><Check size={11} />{uiText('Adicionado')}</> : uiText('Novo consumidor')}</small></div>
    <span className="scene-event">order.created</span>
  </div>;
}
