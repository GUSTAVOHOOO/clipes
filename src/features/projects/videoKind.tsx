import { useId } from 'react';
import { useText } from '@/lib/i18n';
import { fill } from './selectionFormat';

/** Tipo de vídeo (ADR-0001, #67): escolhido antes da produção e visível em todo o fluxo. */
export type VideoKind = 'direct' | 'transformed';
export type Weight = { key: string; weight: number };

const texts = {
  'pt-BR': {
    label: 'Tipo de vídeo', badge: 'Tipo: {kind}', weights: 'Pesos da Nota neste tipo',
    kind: { direct: 'Corte direto', transformed: 'Vídeo transformado' },
    // Texto fixo, baseado no ADR-0001: o que cada tipo implica.
    implies: {
      direct: 'É o trecho da live com legenda, produzido de forma automática e rápida. A monetização pode ser recusada pela política de conteúdo reutilizado do YouTube, mesmo com a autorização do criador. A Nota usa 5 eixos.',
      transformed: 'Exige Narração ou comentário humano, revisado por você antes de virar vídeo: nunca é 100% automático. A seleção ganha o eixo Espaço para comentário, com o maior peso. A Nota usa 6 eixos.',
    },
    axis: { commentary: 'Espaço para comentário', hook: 'Gancho', selfContained: 'Autossuficiência', energy: 'Emoção/energia', value: 'Valor', closing: 'Fechamento' } as Record<string, string>,
  },
  en: {
    label: 'Video type', badge: 'Type: {kind}', weights: 'Score weights for this type',
    kind: { direct: 'Direct Clip', transformed: 'Transformed Video' },
    implies: {
      direct: 'It is the stream excerpt with captions, produced automatically and fast. Monetization may be refused by the YouTube reused-content policy, even with the creator’s consent. The score uses 5 axes.',
      transformed: 'It requires human Narration or commentary, reviewed by you before it becomes a video: it is never 100% automatic. Selection gains the Room for commentary axis, with the biggest weight. The score uses 6 axes.',
    },
    axis: { commentary: 'Room for commentary', hook: 'Hook', selfContained: 'Self-contained', energy: 'Emotion/energy', value: 'Value', closing: 'Closing' } as Record<string, string>,
  },
};

export const KINDS: VideoKind[] = ['direct', 'transformed'];

/** Execuções antigas não trazem o tipo e valem como Corte direto. */
export const kindOf = (value: unknown): VideoKind => (value === 'transformed' ? 'transformed' : 'direct');

export function useAxisLabels() { return useText(texts).axis; }

/** Pesos da Nota do tipo, na ordem da tabela do núcleo, como "Gancho 20%". */
export function WeightsLine({ weights }: { weights: Weight[] }) {
  const t = useText(texts);
  if (weights.length === 0) return null;
  return <p className="text-xs text-fg-2" data-weights aria-label={t.weights}>{t.weights}: {weights.map(w => `${t.axis[w.key] ?? w.key} ${Math.round(w.weight * 100)}%`).join(' · ')}</p>;
}

/** Selo do tipo, mostrado na seleção, na revisão e em lotes. */
export function VideoKindBadge({ kind }: { kind: VideoKind }) {
  const t = useText(texts);
  return <span data-video-kind={kind} className={`inline-flex w-fit items-center rounded-sm border px-1.5 text-xs ${kind === 'transformed' ? 'border-accent-line bg-selected text-fg' : 'border-line bg-field text-fg-2'}`}>{fill(t.badge, { kind: t.kind[kind] })}</span>;
}

/** Escolha do tipo antes de produzir, com o que cada tipo implica. */
export function VideoKindPicker({ value, onChange, disabled }: { value: VideoKind; onChange: (kind: VideoKind) => void; disabled?: boolean }) {
  const t = useText(texts);
  const name = useId();
  return <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
    <legend className="mb-1 text-fg-2">{t.label}</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      {KINDS.map(kind => {
        const described = `${name}-${kind}`;
        return <label key={kind} className={`foco flex cursor-pointer items-start gap-2 rounded-md border p-2 ${value === kind ? 'border-accent-line bg-selected' : 'border-line hover:bg-hover'}`}>
          <input type="radio" name={name} value={kind} checked={value === kind} aria-describedby={described} onChange={() => onChange(kind)} className="mt-1" />
          <span className="flex min-w-0 flex-col gap-1"><strong>{t.kind[kind]}</strong><span id={described} className="text-xs text-fg-2">{t.implies[kind]}</span></span>
        </label>;
      })}
    </div>
  </fieldset>;
}
