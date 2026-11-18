// <ResumoCustoPrivacidade>: o cartão único antes de qualquer chamada a Provedor ou Groq remoto.
// Diz o que vai acontecer, onde roda, se algo sai da máquina e quanto custa, sempre em números tabulares.
import { Cloud, Cpu, HardDrive, ShieldCheck, Terminal } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { faixaUsd, usd } from '@/lib/formato'
import { Checkbox } from '@/primitivas/Escolhas'

export interface ResumoCustoPrivacidadeProps {
  tarefa: string
  perfil: { id: string; label: string; kind: 'local' | 'api' | 'cli' | 'groq'; model: string | null }
  localidade: 'local' | 'remoto' | 'cli'
  saiDaMaquina: boolean
  host?: string | null
  estimativa:
    | { kind: 'zero' }
    | { kind: 'plan_quota' }
    | { kind: 'usd'; minMicroUsd: number; maxMicroUsd: number; inputTokens?: number; janelas?: number; nota?: string }
    | { kind: 'unknown' }
  orcamento?: { restanteMicroUsd?: number | null; callsRestantes?: number | null; pausado?: boolean } | null
  bloqueadoSomenteLocal?: boolean
  consentimentoPendente?: boolean
  aoConfirmarConsentimento?: (aceito: boolean) => void
  consentido?: boolean
  compacto?: boolean
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_1fr] items-baseline gap-3">
      <dt className="text-pequeno text-t3">{rotulo}</dt>
      <dd className="m-0 min-w-0 text-t1">{children}</dd>
    </div>
  )
}

export function ResumoCustoPrivacidade(p: ResumoCustoPrivacidadeProps) {
  const IconeLocal = p.localidade === 'local' ? HardDrive : p.localidade === 'cli' ? Terminal : Cloud
  const onde = p.localidade === 'local' ? 'Local (loopback)' : p.localidade === 'cli' ? `CLI (${p.perfil.label})` : `Remoto (HTTPS)`
  const custo = (() => {
    const e = p.estimativa
    if (e.kind === 'zero') return 'US$ 0,00'
    if (e.kind === 'plan_quota') return 'Consome cota do plano'
    if (e.kind === 'unknown') return 'Custo desconhecido'
    return faixaUsd(e.minMicroUsd, e.maxMicroUsd)
  })()
  const detalheCusto =
    p.estimativa.kind === 'usd'
      ? [p.estimativa.inputTokens && `${p.estimativa.inputTokens.toLocaleString('pt-BR')} tokens de entrada`, p.estimativa.janelas && `${p.estimativa.janelas} janelas`, p.estimativa.nota].filter(Boolean).join(' · ')
      : null

  return (
    <section aria-label={`Resumo de custo e privacidade: ${p.tarefa}`} className={cn('flex flex-col gap-3 rounded-area bg-area', p.compacto ? 'p-2.5' : 'p-3')}>
      <dl className="m-0 flex flex-col gap-2">
        <Linha rotulo="Tarefa">{p.tarefa}</Linha>
        <Linha rotulo="Provedor">
          <span className="flex items-center gap-1.5">
            <Cpu className="size-[13px] stroke-[1.75] text-t3" aria-hidden />
            {p.perfil.label}
            {p.perfil.model && <span className="truncate text-t3">· {p.perfil.model}</span>}
          </span>
        </Linha>
        <Linha rotulo="Onde roda">
          <span className="flex items-center gap-1.5">
            <IconeLocal className="size-[13px] stroke-[1.75] text-t3" aria-hidden />
            {onde}
            {p.host && <span className="truncate text-t3">· {p.host}</span>}
          </span>
        </Linha>
        <Linha rotulo="Sai da máquina">
          {p.saiDaMaquina ? 'Sim: trechos da Transcrição vão ao Provedor' : 'Não: nada sai deste computador'}
        </Linha>
        <Linha rotulo="Custo">
          <span className="num">{custo}</span>
          {detalheCusto && !p.compacto && <span className="mt-0.5 block text-pequeno text-t3">{detalheCusto}</span>}
        </Linha>
        {p.orcamento && (
          <Linha rotulo="Orçamento">
            <span className="num">
              {p.orcamento.pausado
                ? 'Pausado pelo teto'
                : [p.orcamento.restanteMicroUsd != null && `${usd(p.orcamento.restanteMicroUsd)} restantes`, p.orcamento.callsRestantes != null && `${p.orcamento.callsRestantes} chamadas`].filter(Boolean).join(' · ')}
            </span>
          </Linha>
        )}
      </dl>
      {p.bloqueadoSomenteLocal && (
        <p className="flex items-start gap-1.5 text-pequeno text-t2">
          <ShieldCheck className="mt-px size-[13px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
          Este Projeto está em Somente local. Troque para um Perfil local ou libere a Tarefa em Privacidade.
        </p>
      )}
      {p.consentimentoPendente && p.aoConfirmarConsentimento && (
        <Checkbox marcado={!!p.consentido} aoMudar={p.aoConfirmarConsentimento} className="text-pequeno">
          Entendo que trechos da Transcrição saem desta máquina
        </Checkbox>
      )}
    </section>
  )
}
