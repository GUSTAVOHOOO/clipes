// <ContextoCorte>: sub-cabeçalho dentro de um Corte. Voltar a Cortes, posição e título,
// anterior/próximo aprovado, sub-abas Editar/Transformar/Empacotar e o único primário: Exportar.
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { Botao, BotaoIcone } from '@/primitivas/Botao'
import { Abas } from '@/primitivas/Indicadores'
import { SeloTipoVideo, type TipoVideo } from './Selos'

export type SubAba = 'editar' | 'transformar' | 'empacotar'

export interface ContextoCorteProps {
  projetoId: string
  corteAtual: {
    corteId: string
    candidateId: number | null
    titulo: string
    indice: number | null
    totalAprovados: number
    videoKind: TipoVideo
    anteriorId?: string | null
    proximoId?: string | null
  }
  subAbaAtiva: SubAba
  aoMudarSubAba?: (aba: SubAba) => void
  aoVoltar?: () => void
  aoNavegar?: (corteId: string) => void
  aoAbrirExportacao: () => void
  /** mostra o tipo de vídeo ao lado do título (desligado no editor enxuto) */
  mostrarTipo?: boolean
}

export function ContextoCorte({ corteAtual: c, subAbaAtiva, aoMudarSubAba, aoVoltar, aoNavegar, aoAbrirExportacao, mostrarTipo = false }: ContextoCorteProps) {
  const avulso = c.candidateId === null
  const posicao = c.indice != null ? `Corte ${c.indice} de ${c.totalAprovados}` : `Corte #${c.corteId}`
  return (
    <div className="flex h-(--altura-subtopo) shrink-0 items-center gap-3 px-4">
      <Botao icone={<ArrowLeft />} onClick={aoVoltar}>
        Cortes
      </Botao>
      <div className="flex items-center">
        <BotaoIcone rotulo="Corte anterior" atalho="Alt PgUp" disabled={!c.anteriorId} onClick={() => c.anteriorId && aoNavegar?.(c.anteriorId)} tamanho="p">
          <ChevronLeft />
        </BotaoIcone>
        <BotaoIcone rotulo="Próximo aprovado" atalho="Alt PgDn" disabled={!c.proximoId} onClick={() => c.proximoId && aoNavegar?.(c.proximoId)} tamanho="p">
          <ChevronRight />
        </BotaoIcone>
      </div>
      <h1 className="flex min-w-0 flex-1 items-center gap-2 text-base font-normal whitespace-nowrap">
        <span className="num text-t3">{posicao}</span>
        <span aria-hidden className="text-t3">·</span>
        <strong className="truncate font-medio text-t1">{c.titulo}</strong>
        {mostrarTipo && <SeloTipoVideo tipo={c.videoKind} className="ml-1" />}
      </h1>
      <Abas<SubAba>
        rotulo="Etapas do Corte"
        valor={subAbaAtiva}
        aoMudar={(v) => aoMudarSubAba?.(v)}
        abas={[
          { valor: 'editar', rotulo: 'Editar' },
          { valor: 'transformar', rotulo: 'Transformar', desabilitada: c.videoKind === 'direct' || avulso, dica: c.videoKind === 'direct' ? 'Disponível em Vídeo transformado' : undefined },
          { valor: 'empacotar', rotulo: 'Empacotar', desabilitada: avulso },
        ]}
      />
      <Botao variante="primario" onClick={aoAbrirExportacao} title="Exportar Corte (Ctrl+E)">
        Exportar
      </Botao>
    </div>
  )
}
