// <InstaladorJustInTime> (baixar um componente na hora em que ele faz falta) e
// <ChecklistGuardaCorpos> (avisos antes de exportar; informa, nunca bloqueia).
import { AlertTriangle, Check, ChevronRight, CircleDashed, Download } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { tamanho as fmtTamanho } from '@/lib/formato'
import { Botao } from '@/primitivas/Botao'
import { Checkbox } from '@/primitivas/Escolhas'
import { Progresso } from '@/primitivas/Indicadores'

const recursos = {
  url_import: { nome: 'Importar por link (yt-dlp + deno)', para: 'baixar Fontes a partir de um link', bytes: 62e6, licenca: 'Unlicense · MIT', termos: true },
  yunet: { nome: 'Detector de rostos (YuNet)', para: 'sugerir o enquadramento 9:16', bytes: 340e3 + 212e6, licenca: 'MIT', termos: false },
  tts: { nome: 'Voz sintética (Pocket TTS)', para: 'gerar Narração no computador', bytes: 412e6, licenca: 'CC-BY 4.0', termos: true },
} as const

export interface InstaladorJustInTimeProps {
  recurso: keyof typeof recursos
  idioma?: 'pt' | 'en'
  modo?: 'inline' | 'modal'
  aberto?: boolean
  aoFechar?: () => void
  aoConcluir: () => void
  /** estado controlado para galeria/teste */
  estado?: 'oferta' | 'baixando' | 'erro'
  progresso?: number
  destino?: string
}

export function InstaladorJustInTime({ recurso, aoFechar, aoConcluir, estado: estadoExt, progresso = 0, destino = '%APPDATA%\\Clipes\\componentes' }: InstaladorJustInTimeProps) {
  const r = recursos[recurso]
  const [aceito, setAceito] = useState(!r.termos)
  const [estadoInt, setEstado] = useState<'oferta' | 'baixando' | 'erro'>('oferta')
  const estado = estadoExt ?? estadoInt
  return (
    <section aria-label={`Instalar ${r.nome}`} className="flex flex-col gap-3 rounded-area bg-area p-3">
      <div className="flex items-start gap-2.5">
        <Download className="mt-0.5 size-[15px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medio text-t1">{r.nome}</h3>
          <p className="mt-0.5 text-pequeno text-t2">Falta este componente para {r.para}. Ele é baixado uma vez e fica neste computador.</p>
        </div>
      </div>
      <dl className="m-0 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1 text-pequeno">
        <dt className="text-t3">Tamanho</dt>
        <dd className="num m-0 text-t2">{fmtTamanho(r.bytes)}</dd>
        <dt className="text-t3">Licença</dt>
        <dd className="m-0 text-t2">{r.licenca}</dd>
        <dt className="text-t3">Destino</dt>
        <dd className="m-0 truncate text-t2">{destino}</dd>
      </dl>
      {estado === 'baixando' ? (
        <div className="flex items-center gap-3">
          <Progresso valor={progresso} rotulo="Baixando" detalhe={`${fmtTamanho((r.bytes * progresso) / 100)} de ${fmtTamanho(r.bytes)}`} className="flex-1" />
          <Botao tamanho="p" onClick={() => setEstado('oferta')}>
            Cancelar
          </Botao>
        </div>
      ) : (
        <>
          {estado === 'erro' && <p className="text-pequeno text-erro">O download parou no meio. Confira a conexão e tente de novo; o que já baixou é aproveitado.</p>}
          {r.termos && (
            <Checkbox marcado={aceito} aoMudar={setAceito} className="text-pequeno">
              Li e aceito os termos de uso deste componente
            </Checkbox>
          )}
          <div className="flex justify-end gap-2">
            {aoFechar && <Botao onClick={aoFechar}>Agora não</Botao>}
            <Botao variante="secundario" icone={<Download />} disabled={!aceito} onClick={() => (setEstado('baixando'), aoConcluir())}>
              {estado === 'erro' ? 'Tentar de novo' : `Baixar ${fmtTamanho(r.bytes)}`}
            </Botao>
          </div>
        </>
      )}
    </section>
  )
}

/* ---------- Checklist de guarda-corpos ---------- */

export type ItemGuarda = {
  id: string
  estado: 'ok' | 'atencao' | 'pendente'
  titulo: string
  detalhe?: string
  acao?: { rotulo: string; aoAcionar: () => void }
}

export interface ChecklistGuardaCorposProps {
  itens: ItemGuarda[]
  escopo: 'single' | 'source' | 'project'
  abertoPorPadrao?: boolean
  mostrarDivulgacaoIa?: boolean
  aoConfirmarDireto?: () => Promise<void> | void
  confirmado?: boolean
}

const iconeGuarda = { ok: Check, atencao: AlertTriangle, pendente: CircleDashed }
const palavraGuarda = { ok: 'Ok', atencao: 'Atenção', pendente: 'Pendente' }

export function ChecklistGuardaCorpos({ itens, abertoPorPadrao, mostrarDivulgacaoIa, aoConfirmarDireto, confirmado }: ChecklistGuardaCorposProps) {
  const atencao = itens.filter((i) => i.estado !== 'ok').length
  const padrao = abertoPorPadrao ?? atencao > 0
  const [aberto, setAberto] = useState(padrao)
  const interagiu = useRef(false)
  // Os avisos chegam de forma assíncrona: acompanha o padrão até a pessoa mexer no controle.
  useEffect(() => {
    if (!interagiu.current) setAberto(padrao)
  }, [padrao])
  return (
    <section aria-label="Antes de exportar" className="flex flex-col gap-2">
      <button type="button" aria-expanded={aberto} onClick={() => { interagiu.current = true; setAberto((v) => !v) }} className="flex cursor-pointer items-center gap-1.5 self-start rounded-controle border-0 bg-transparent py-1 text-pequeno text-t2 hover:text-t1">
        <ChevronRight className={cn('size-[14px] stroke-[1.75] transition-transform duration-(--dur-base) ease-saida', aberto && 'rotate-90')} aria-hidden />
        Antes de exportar
        <span className="num text-t3">· {atencao ? `${atencao} ponto${atencao > 1 ? 's' : ''} para olhar` : 'tudo certo'}</span>
      </button>
      {aberto && (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {itens.map((i) => {
            const Icone = iconeGuarda[i.estado]
            return (
              <li key={i.id} className="grid grid-cols-[18px_1fr_auto] items-start gap-2 rounded-controle px-2 py-1.5">
                <Icone className={cn('mt-0.5 size-[14px] stroke-[1.75]', i.estado === 'ok' ? 'text-t3' : 'text-t2')} aria-label={palavraGuarda[i.estado]} />
                <div className="min-w-0">
                  <p className={i.estado === 'ok' ? 'text-t2' : 'text-t1'}>{i.titulo}</p>
                  {i.detalhe && <p className="text-pequeno text-t3">{i.detalhe}</p>}
                </div>
                {i.acao && (
                  <Botao tamanho="p" onClick={i.acao.aoAcionar}>
                    {i.acao.rotulo}
                  </Botao>
                )}
              </li>
            )
          })}
          {mostrarDivulgacaoIa && (
            <li className="mt-1 rounded-controle bg-area px-3 py-2 text-pequeno text-t2">
              Ao publicar, marque o vídeo como “conteúdo alterado ou sintético” se a Narração for voz sintética.
            </li>
          )}
          {aoConfirmarDireto && (
            <li className="mt-1 px-2">
              <Checkbox marcado={!!confirmado} aoMudar={() => void aoConfirmarDireto()} className="text-pequeno">
                Sei que Corte direto pode não monetizar por conteúdo reutilizado
              </Checkbox>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

