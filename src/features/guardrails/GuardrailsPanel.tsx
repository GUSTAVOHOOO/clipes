import { useCallback, useEffect, useState, type RefObject } from 'react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';

export const GUARDRAILS_UPDATED_EVENT = 'clipes:guardrails-updated';

export type GuardrailsState = {
  scope: 'single' | 'source' | 'project';
  directMonetizationAck: boolean;
  needsDirectNotice: boolean;
  videoKind: 'direct' | 'transformed' | 'mixed';
  hasDirect: boolean;
  hasTransformed: boolean;
  totalCuts: number;
  durationUs: number;
  over60s: boolean;
  over60sCount: number;
  shortClaimLimitUs: number;
  permission: {
    status: 'granted' | 'partial' | 'none';
    grantedCount: number;
    missingCount: number;
    totalCount: number;
    who?: string | null;
    where?: string | null;
    scope?: string | null;
  };
  script: {
    applicable: boolean;
    exists?: boolean;
    approved?: boolean;
    pendingBlocks?: number;
    totalBlocks?: number;
    transformedCount?: number;
    approvedCount?: number;
    unapprovedCount?: number;
  };
  narration?: {
    applicable: boolean;
    hasTts?: boolean;
    generatedBlocks?: number;
    totalBlocks?: number;
    voices?: string[];
    freezeTailUs?: number;
    longFreezeTail?: boolean;
    ttsCutCount?: number;
    transformedCount?: number;
    freezeTailCount?: number;
    longFreezeTailCount?: number;
    maxFreezeTailUs?: number;
  };
};

export const guardrailsTexts = {
  'pt-BR': {
    directNotice: {
      sectionTitle: 'Aviso de monetização do Corte direto',
      title: 'Risco de monetização do Corte direto',
      description:
        'O Corte direto pode ter a monetização recusada pela política de conteúdo reutilizado do YouTube, mesmo com Permissão do criador. Este aviso aparece uma única vez por canal e não impede a exportação.',
      cancel: 'Cancelar',
      confirm: 'Entendi e continuar',
      ackedStatus: 'Aviso único já confirmado neste canal.',
      pendingStatus: 'Ainda não exibido na exportação deste canal.',
    },
    aiDisclosure: {
      title: 'Divulgação de conteúdo gerado por IA',
      body: 'Divulgação obrigatória quando houver voz sintética realista que imita uma pessoa real ou cena realista gerada por IA. Não é obrigatória para roteiro, título ou legenda feitos com IA.',
    },
    checklist: {
      summary: 'Originalidade e riscos antes de exportar',
      intro: 'Checklist informativo — nenhum item bloqueia a exportação.',
      videoKindDirect: 'Tipo do vídeo: Corte direto — risco de conteúdo reutilizado mesmo com Permissão.',
      videoKindTransformed: 'Tipo do vídeo: Vídeo transformado — exige contribuição criativa humana revisada.',
      videoKindMixed: 'Tipo do vídeo: misto (Cortes diretos e Vídeos transformados no lote).',
      permGrantedSingle: 'Permissão da Fonte: registrada ({who} · {where}). Protege contra direitos autorais, mas não garante monetização.',
      permNoneSingle: 'Permissão da Fonte: sem permissão registrada — risco de claim ou strike de direitos autorais.',
      permBatch: 'Permissão das Fontes: {granted} de {total} Cortes com Permissão ({missing} sem permissão).',
      permEmpty: 'Permissão das Fontes: nenhum Corte aprovado no momento.',
      scriptApprovedSingle: 'Roteiro: aprovado ({total} blocos).',
      scriptPendingSingle: 'Roteiro: pendente ({pending} de {total} blocos por aprovar).',
      scriptNoneSingle: 'Roteiro: ainda não gerado ou aprovado para este Vídeo transformado.',
      scriptBatch: 'Roteiro (Vídeo transformado): {approved} de {total} aprovados ({unapproved} pendentes).',
      narrationTtsActiveSingle: 'Narração por TTS: {generated} de {total} blocos sintetizados ({voices}) — divulgue conteúdo sintético quando aplicável (especialmente se a voz imitar pessoa real).',
      narrationTtsNoneSingle: 'Narração por TTS: nenhum áudio TTS gerado para este Corte.',
      narrationTtsBatch: 'Narração por TTS: {ttsCount} de {total} Vídeos transformados com áudio TTS — divulgue conteúdo sintético quando aplicável.',
      narrationFreezeTailSingle: 'Sobra final da Narração: o último quadro ficará congelado por {sec} s ao fim do vídeo.',
      narrationLongFreezeTailSingle: 'Sobra final longa da Narração: ultrapassa o Corte em {sec} s (> 5 s) e congelará o último quadro.',
      narrationFreezeTailBatch: 'Sobra final da Narração: {count} Vídeo(s) transformado(s) congelarão o último quadro (até {sec} s).',
      transformationRule: 'Legenda, crop e filtros não contam como Transformação.',
      musicFixed: 'Música com claim: verifique se há música de fundo ou trilha de jogo na Fonte; músicas protegidas podem gerar claim no Content ID mesmo com Permissão.',
      musicOver60Single: 'Corte acima de 60 s: Shorts com mais de 1 minuto que contenham música com claim são bloqueados e ficam inelegíveis para monetização.',
      musicOver60Batch: '{count} Corte(s) acima de 60 s: Shorts com mais de 1 minuto que contenham música com claim são bloqueados e ficam inelegíveis para monetização.',
    },
  },
  en: {
    directNotice: {
      sectionTitle: 'Direct Clip monetization notice',
      title: 'Direct Clip monetization risk',
      description:
        'A Direct Clip may have monetization refused under YouTube’s reused-content policy, even with the creator’s Permission. This notice is shown once per channel and does not block export.',
      cancel: 'Cancel',
      confirm: 'I understand and continue',
      ackedStatus: 'One-time notice already acknowledged for this channel.',
      pendingStatus: 'Not yet shown during export for this channel.',
    },
    aiDisclosure: {
      title: 'AI-generated content disclosure',
      body: 'Disclosure is required when using a realistic synthetic voice imitating a real person or a realistic AI-generated scene. It is not required for AI-assisted scripts, titles, or captions.',
    },
    checklist: {
      summary: 'Originality and risks before exporting',
      intro: 'Informational checklist — no item blocks export.',
      videoKindDirect: 'Video type: Direct Clip — reused-content risk even with Permission.',
      videoKindTransformed: 'Video type: Transformed Video — requires reviewed human creative contribution.',
      videoKindMixed: 'Video type: mixed (Direct Clips and Transformed Videos in the batch).',
      permGrantedSingle: 'Source Permission: recorded ({who} · {where}). Protects against copyright claims, but does not guarantee monetization.',
      permNoneSingle: 'Source Permission: no permission recorded — risk of copyright claim or strike.',
      permBatch: 'Source Permission: {granted} of {total} Clips have Permission ({missing} without permission).',
      permEmpty: 'Source Permission: no approved Clips yet.',
      scriptApprovedSingle: 'Script: approved ({total} blocks).',
      scriptPendingSingle: 'Script: pending ({pending} of {total} blocks left to approve).',
      scriptNoneSingle: 'Script: not yet generated or approved for this Transformed Video.',
      scriptBatch: 'Script (Transformed Video): {approved} of {total} approved ({unapproved} pending).',
      narrationTtsActiveSingle: 'TTS Narration: {generated} of {total} blocks synthesized ({voices}) — disclose synthetic content when applicable (especially if the voice imitates a real person).',
      narrationTtsNoneSingle: 'TTS Narration: no TTS audio generated for this Clip.',
      narrationTtsBatch: 'TTS Narration: {ttsCount} of {total} Transformed Videos use TTS audio — disclose synthetic content when applicable.',
      narrationFreezeTailSingle: 'Narration tail overflow: the last frame will freeze for {sec} s at the end of the video.',
      narrationLongFreezeTailSingle: 'Long Narration tail overflow: exceeds the Clip by {sec} s (> 5 s) and will freeze the last frame.',
      narrationFreezeTailBatch: 'Narration tail overflow: {count} Transformed Video(s) will freeze the last frame (up to {sec} s).',
      transformationRule: 'Captions, crop, and filters do not count as Transformation.',
      musicFixed: 'Claimed music: check for background music or game soundtracks in the Source; copyrighted music can trigger a Content ID claim even with Permission.',
      musicOver60Single: 'Clip over 60 s: Shorts longer than 1 minute containing claimed music are blocked and ineligible for monetization.',
      musicOver60Batch: '{count} Clip(s) over 60 s: Shorts longer than 1 minute containing claimed music are blocked and ineligible for monetization.',
    },
  },
};

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(values[k] ?? ''));

export async function checkGuardrails(args: Record<string, unknown>): Promise<GuardrailsState | null> {
  try {
    return await coreDispatch<GuardrailsState>('guardrails.check', args);
  } catch {
    return null;
  }
}

export async function ackDirectMonetizationNotice(): Promise<void> {
  try {
    await coreDispatch('guardrails.ack_direct_notice', {});
    window.dispatchEvent(new CustomEvent(GUARDRAILS_UPDATED_EVENT));
  } catch {
    // Guarda-corpos nunca bloqueiam a exportação.
  }
}

export function DirectMonetizationDialog({
  open,
  onOpenChange,
  onConfirm,
  finalFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const t = useText(guardrailsTexts).directNotice;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.title}
      description={t.description}
      cancelLabel={t.cancel}
      confirmLabel={t.confirm}
      finalFocus={finalFocus}
      onConfirm={onConfirm}
    />
  );
}

export function AiDisclosureNote() {
  const t = useText(guardrailsTexts).aiDisclosure;
  return (
    <div data-ai-disclosure className="rounded-md border border-line bg-field p-2.5 text-xs text-fg-2">
      <p className="font-medium text-fg">{t.title}</p>
      <p className="mt-0.5">{t.body}</p>
    </div>
  );
}

type ChecklistProps = {
  scope?: 'single' | 'source' | 'project';
  sourceId?: number;
  candidateId?: number;
  clipId?: number;
  startId?: number;
  endId?: number;
  refreshKey?: string | number;
};

/** Seção informativa recolhível pré-export (#76): nunca bloqueia a exportação. */
export function GuardrailsChecklist(props: ChecklistProps) {
  const t = useText(guardrailsTexts).checklist;
  const [state, setState] = useState<GuardrailsState | null>(null);

  const load = useCallback(async () => {
    const args: Record<string, unknown> =
      props.scope === 'project'
        ? { scope: 'project' }
        : props.scope === 'source'
          ? { scope: 'source', source_id: props.sourceId }
          : {
              scope: 'single',
              source_id: props.sourceId,
              ...(props.candidateId !== undefined ? { candidate_id: props.candidateId } : {}),
              ...(props.clipId !== undefined ? { clip_id: props.clipId } : {}),
              ...(props.startId !== undefined ? { start_id: props.startId } : {}),
              ...(props.endId !== undefined ? { end_id: props.endId } : {}),
            };
    const next = await checkGuardrails(args);
    setState(next);
  }, [
    props.scope,
    props.sourceId,
    props.candidateId,
    props.clipId,
    props.startId,
    props.endId,
    props.refreshKey,
  ]);

  useEffect(() => {
    let active = true;
    void load().then(() => {
      if (!active) return;
    });
    const onUpdated = () => {
      if (active) void load();
    };
    window.addEventListener(GUARDRAILS_UPDATED_EVENT, onUpdated);
    return () => {
      active = false;
      window.removeEventListener(GUARDRAILS_UPDATED_EVENT, onUpdated);
    };
  }, [load]);

  const kindText = !state
    ? t.videoKindDirect
    : state.videoKind === 'mixed'
      ? t.videoKindMixed
      : state.videoKind === 'transformed'
        ? t.videoKindTransformed
        : t.videoKindDirect;

  const permissionText = (() => {
    if (!state) return t.permEmpty;
    if (state.scope === 'single') {
      return state.permission.status === 'granted'
        ? fill(t.permGrantedSingle, {
            who: state.permission.who || '—',
            where: state.permission.where || '—',
          })
        : t.permNoneSingle;
    }
    if (state.totalCuts === 0) return t.permEmpty;
    return fill(t.permBatch, {
      granted: state.permission.grantedCount,
      total: state.permission.totalCount,
      missing: state.permission.missingCount,
    });
  })();

  const scriptText = (() => {
    if (!state || !state.script.applicable) return null;
    if (state.scope === 'single') {
      if (!state.script.exists) return t.scriptNoneSingle;
      if (state.script.approved) {
        return fill(t.scriptApprovedSingle, { total: state.script.totalBlocks ?? 0 });
      }
      return fill(t.scriptPendingSingle, {
        pending: state.script.pendingBlocks ?? 0,
        total: state.script.totalBlocks ?? 0,
      });
    }
    return fill(t.scriptBatch, {
      approved: state.script.approvedCount ?? 0,
      total: state.script.transformedCount ?? 0,
      unapproved: state.script.unapprovedCount ?? 0,
    });
  })();

  const narrationText = (() => {
    if (!state?.narration?.applicable) return null;
    if (state.scope === 'single') {
      if (!state.narration.hasTts) return t.narrationTtsNoneSingle;
      return fill(t.narrationTtsActiveSingle, {
        generated: state.narration.generatedBlocks ?? 0,
        total: state.narration.totalBlocks ?? 0,
        voices: (state.narration.voices ?? []).join(', ') || 'TTS',
      });
    }
    return fill(t.narrationTtsBatch, {
      ttsCount: state.narration.ttsCutCount ?? 0,
      total: state.narration.transformedCount ?? 0,
    });
  })();

  const freezeTailText = (() => {
    if (!state?.narration?.applicable) return null;
    if (state.scope === 'single') {
      const tailUs = state.narration.freezeTailUs ?? 0;
      if (tailUs <= 0) return null;
      const sec = (tailUs / 1_000_000).toFixed(1);
      return fill(
        state.narration.longFreezeTail ? t.narrationLongFreezeTailSingle : t.narrationFreezeTailSingle,
        { sec },
      );
    }
    const count = state.narration.freezeTailCount ?? 0;
    if (count <= 0) return null;
    return fill(t.narrationFreezeTailBatch, {
      count,
      sec: ((state.narration.maxFreezeTailUs ?? 0) / 1_000_000).toFixed(1),
    });
  })();

  return (
    <details
      data-guardrails-checklist
      className="w-full max-w-xl rounded-md border border-line bg-surface px-3 py-2 text-xs text-fg-2"
    >
      <summary className="foco cursor-pointer font-medium text-fg select-none">
        {t.summary}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p>{t.intro}</p>
        <ul className="flex list-disc flex-col gap-1 pl-4">
          <li data-guardrails-item="video-kind">{kindText}</li>
          <li data-guardrails-item="permission">{permissionText}</li>
          {scriptText && <li data-guardrails-item="script">{scriptText}</li>}
          {narrationText && <li data-guardrails-item="narration-tts">{narrationText}</li>}
          {freezeTailText && (
            <li
              data-guardrails-freeze-tail
              className="rounded-sm bg-warning-subtle px-2 py-1 text-fg"
            >
              {freezeTailText}
            </li>
          )}
          <li data-guardrails-item="transformation">{t.transformationRule}</li>
          <li data-guardrails-item="music">{t.musicFixed}</li>
          {state?.over60s && (
            <li
              data-guardrails-over60s
              className="rounded-sm bg-warning-subtle px-2 py-1 text-fg"
            >
              {state.scope === 'single'
                ? t.musicOver60Single
                : fill(t.musicOver60Batch, { count: state.over60sCount })}
            </li>
          )}
        </ul>
        <AiDisclosureNote />
      </div>
    </details>
  );
}
