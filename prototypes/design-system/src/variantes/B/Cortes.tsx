// Cortes como uma lista editorial: manchete, gancho citado, duração e Nota em texto.
import { useState } from 'react'
import { toast } from 'sonner'
import { cortes, duracao, fonte, img, tc, type Corte } from '../../dados'
import type { Tela } from '../../App'
import { CUSTO_POR_CORTE, dolar, memoria, num, resumoNota, segundos } from './comum'

export default function Cortes({ irPara }: { irPara: (t: Tela) => void }) {
  const [decisoes, setDecisoes] = useState(memoria.decisoes)
  const decidir = (id: string, d: 'aprovado' | 'rejeitado' | undefined) => {
    const novo = { ...decisoes, [id]: d }
    memoria.decisoes = novo
    setDecisoes(novo)
  }
  const abrir = (c: Corte) => { memoria.corteId = c.id; irPara('editor') }

  const aprovados = cortes.filter(c => decisoes[c.id] === 'aprovado')
  const total = aprovados.reduce((s, c) => s + duracao(c), 0)
  const custo = aprovados.length * CUSTO_POR_CORTE

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-[var(--rule)] bg-[var(--paper)]/95 backdrop-blur-[2px]">
        <div className="mx-auto flex max-w-[760px] items-center gap-6 px-6 py-3">
          <p className="min-w-0 flex-1 truncate text-[14px] text-[var(--mute)]">
            {aprovados.length === 0 ? 'Nenhum Corte aprovado ainda' : <>
              <span className="text-[var(--ink)] font-medium">{aprovados.length} {aprovados.length === 1 ? 'aprovado' : 'aprovados'}</span>, <span className="num">{tc(total)}</span> no total. Empacotamento pelo Provedor: <span className="num">{dolar(custo)}</span>
            </>}
          </p>
          <button type="button" disabled={!aprovados.length}
            onClick={() => toast(`Exportando ${aprovados.length} Cortes para a pasta do Projeto`, { description: `Custo do Provedor no lote: ${dolar(custo)}` })}
            className="shrink-0 rounded-lg bg-[var(--ink)] px-4 py-2 text-[14px] font-medium text-[var(--paper)] hover:bg-[var(--ink-2)] disabled:bg-[var(--rule-2)] disabled:text-[var(--mute)]">
            Exportar aprovados
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-[760px] px-6 pt-14 pb-28">
        <header className="mb-6">
          <p className="text-[14px] text-[var(--mute)]">{fonte.nome}, <span className="num">{tc(fonte.duracao)}</span></p>
          <h1 className="mt-1 text-[32px] leading-[1.15] font-semibold tracking-[-0.02em]">Cortes sugeridos pelo Provedor</h1>
          <p className="mt-3 max-w-[54ch] text-[16px] leading-relaxed text-[var(--ink-2)]">
            Leia o gancho de cada um. Aprove o que vale publicar, abra no editor o que precisa de ajuste e exporte o lote.
          </p>
        </header>

        <ol>
          {cortes.map(c => <Item key={c.id} c={c} decisao={decisoes[c.id]} decidir={d => decidir(c.id, d)} abrir={() => abrir(c)} />)}
        </ol>
      </div>
    </div>
  )
}

function Item({ c, decisao, decidir, abrir }: {
  c: Corte; decisao?: 'aprovado' | 'rejeitado'; decidir: (d: 'aprovado' | 'rejeitado' | undefined) => void; abrir: () => void
}) {
  const [verNota, setVerNota] = useState(false)
  const gancho = c.frases[0]?.texto ?? ''

  if (decisao === 'rejeitado') return (
    <li className="flex items-baseline gap-4 border-t border-[var(--rule)] py-5">
      <span className="flex-1 text-[16px] text-[var(--faint)] line-through decoration-[var(--rule-2)]">{c.titulo}</span>
      <span className="text-[14px] text-[var(--mute)]">Rejeitado</span>
      <button type="button" onClick={() => decidir(undefined)} className="text-[14px] font-medium underline underline-offset-4 decoration-[var(--rule-2)] hover:decoration-[var(--ink)]">Desfazer</button>
    </li>
  )

  return (
    <li className="grid grid-cols-[96px_1fr] gap-x-8 border-t border-[var(--rule)] py-10">
      <button type="button" onClick={abrir} className="self-start overflow-hidden rounded-[10px] bg-[var(--ink)]" aria-label={`Abrir “${c.titulo}” no editor`}>
        <img src={img(c.vert)} alt="" className="aspect-[9/16] w-full object-cover" />
      </button>

      <div className="min-w-0">
        <div className="flex items-baseline gap-3">
          <h2 className="flex-1 text-[26px] leading-[1.2] font-semibold tracking-[-0.018em]">
            <button type="button" onClick={abrir} className="text-left hover:underline decoration-[var(--rule-2)] underline-offset-[6px] decoration-2">{c.titulo}</button>
          </h2>
          {decisao === 'aprovado' && <span className="shrink-0 rounded-full bg-[var(--marker)] px-2.5 py-0.5 text-[13px] font-medium">Aprovado</span>}
        </div>

        <blockquote className="relative mt-4 max-w-[48ch] text-[19px] leading-[1.5] text-[var(--ink-2)]">
          <span aria-hidden className="absolute -left-[0.55em] text-[var(--faint)]">“</span>{gancho.replace(/^["“]|["”]$/g, '')}<span aria-hidden className="text-[var(--faint)]">”</span>
        </blockquote>

        <p className="mt-4 text-[15px] text-[var(--mute)]">
          <span className="num text-[var(--ink-2)]">{segundos(duracao(c))}</span>, de <span className="num">{tc(c.inicio)}</span> a <span className="num">{tc(c.fim)}</span> da Fonte
        </p>

        <p className="mt-1 text-[15px]">
          <span className="num font-semibold">{num(c.nota.total)}</span>
          <span className="text-[var(--ink-2)]"> · {resumoNota(c)}</span>
          <button type="button" aria-expanded={verNota} onClick={() => setVerNota(v => !v)}
            className="ml-3 text-[14px] text-[var(--mute)] underline underline-offset-4 decoration-[var(--rule-2)] hover:text-[var(--ink)]">
            {verNota ? 'esconder Nota' : 'ver Nota'}
          </button>
        </p>

        {verNota && (
          <dl className="mt-5 max-w-[60ch] border-l-2 border-[var(--rule)] pl-5">
            {c.nota.eixos.map(e => (
              <div key={e.nome} className="grid grid-cols-[150px_28px_1fr] items-baseline gap-x-3 py-1.5">
                <dt className="text-[14px] font-medium">{e.nome}</dt>
                <dd className="num text-[14px] font-medium text-right">{e.valor}</dd>
                <dd className="text-[14px] leading-snug text-[var(--ink-2)]">{e.justificativa}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-6 flex items-center gap-6 text-[15px]">
          {decisao === 'aprovado' ? (
            <button type="button" onClick={() => decidir(undefined)} className="text-[var(--mute)] underline underline-offset-4 decoration-[var(--rule-2)] hover:text-[var(--ink)]">Desfazer aprovação</button>
          ) : (
            <button type="button" onClick={() => decidir('aprovado')} className="font-medium underline underline-offset-4 decoration-[var(--ink)] hover:bg-[var(--marker-soft)]">Aprovar</button>
          )}
          <button type="button" onClick={() => decidir('rejeitado')} className="text-[var(--mute)] underline underline-offset-4 decoration-[var(--rule-2)] hover:text-[var(--ink)]">Rejeitar</button>
          <button type="button" onClick={abrir} className="text-[var(--mute)] underline underline-offset-4 decoration-[var(--rule-2)] hover:text-[var(--ink)]">Abrir no editor</button>
        </div>
      </div>
    </li>
  )
}
