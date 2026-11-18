import { BannerErroCore, Esqueleto, EstadoTela } from '@ds'
import { useMemo, useRef } from 'react'
import { ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import {
  storeFontesProjeto,
  useFontesProjeto,
  type StoreFontesProjeto,
} from '~/stores/fontesProjeto'
import { ConstrutorLote } from '~/telas/fontes/ConstrutorLote'
import { ListaLotes } from '~/telas/fontes/ListaLotes'

export type LotesFontesProps = {
  projetoId: string
  projetoPath: string | null
  store?: StoreFontesProjeto
  aoAbrirFila?: () => void
}

/** Sub-aba Lotes de Fontes (`#/projeto/:id/fontes?sub=lotes`). */
export function LotesFontes({
  projetoId,
  projetoPath,
  store = storeFontesProjeto,
  aoAbrirFila,
}: LotesFontesProps) {
  const forcado = useEstadoForcado()
  const jobsFila = useFila()
  const listaFontesRef = useRef<HTMLFieldSetElement>(null)
  const encProjeto = encodeURIComponent(projetoId)

  const {
    fontes,
    carregando,
    carregandoLotes,
    erro,
    erroLotes,
    transcriptStatusBySource,
    lotes,
    selecionadasParaLote,
    recarregarFontes,
    recarregarLotes,
    definirSelecionadasParaLote,
  } = useFontesProjeto(projetoPath, { store })

  const focarSelecaoFontes = () => {
    const primeiroCheckbox = listaFontesRef.current?.querySelector<HTMLElement>(
      '[role="checkbox"]:not([disabled])',
    )
    primeiroCheckbox?.focus()
  }

  const estado = useMemo<'carregando' | 'erro' | 'sem-fontes' | 'sem-lotes' | 'pronto'>(() => {
    if (forcado === 'carregando') return 'carregando'
    if (forcado === 'erro') return 'erro'
    if (carregando || carregandoLotes) return 'carregando'
    if (erro || erroLotes) return 'erro'
    if (fontes.length === 0) return 'sem-fontes'
    if (forcado === 'vazio' || lotes.length === 0) return 'sem-lotes'
    return 'pronto'
  }, [carregando, carregandoLotes, erro, erroLotes, fontes.length, forcado, lotes.length])

  const erroExibido = useMemo(() => {
    if (erro) return erro
    if (erroLotes) return erroLotes
    if (forcado === 'erro') {
      return new ErroCore('local_only_violation', 'Simulação de erro via ?estado=erro.')
    }
    return null
  }, [erro, erroLotes, forcado])

  if (estado === 'carregando') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
        <div className="flex min-h-0 w-full shrink-0 flex-col rounded-area bg-area p-3 lg:w-[40%] lg:max-w-[520px]">
          <Esqueleto
            variante="lista"
            quantidade={4}
            rotuloAcessivel="Carregando Fontes para o lote"
          />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <div className="rounded-area bg-area p-3">
            <Esqueleto variante="painel" rotuloAcessivel="Carregando lotes do Projeto" />
          </div>
          <div className="rounded-area bg-area p-3">
            <Esqueleto variante="painel" rotuloAcessivel="Carregando lotes do Projeto" />
          </div>
        </div>
      </div>
    )
  }

  if (estado === 'erro' && erroExibido) {
    const traducao = mensagemDeErro(erroExibido)
    return (
      <BannerErroCore
        erro={{
          code: erroExibido.code,
          message: erroExibido.detalhe || erroExibido.message,
        }}
        traduzir={() => ({ titulo: traducao.titulo })}
        acaoRecuperacao={
          traducao.recuperacao
            ? {
                rotulo: traducao.recuperacao.rotulo,
                aoAcionar: () => {
                  if (traducao.recuperacao?.rota) {
                    window.location.hash = traducao.recuperacao.rota
                  } else {
                    void Promise.all([recarregarFontes(), recarregarLotes()])
                  }
                },
              }
            : {
                rotulo: 'Tentar novamente',
                aoAcionar: () => void Promise.all([recarregarFontes(), recarregarLotes()]),
              }
        }
        permitirRelato
      />
    )
  }

  if (estado === 'sem-fontes') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-area bg-area">
        <EstadoTela
          tipo="vazio"
          titulo="Nenhuma Fonte para processar em lote"
          descricao="Importe ao menos uma Fonte antes de criar um Lote de Fontes."
          acaoPrimaria={{
            rotulo: 'Voltar para Fontes',
            aoAcionar: () => {
              window.location.hash = `#/projeto/${encProjeto}/fontes`
            },
          }}
        />
      </div>
    )
  }

  const temLoteParcial =
    forcado === 'parcial' ||
    lotes.some((l) => l.status === 'attention' || l.status === 'budget_paused')

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
      {projetoPath && (
        <div className="flex min-h-0 w-full shrink-0 flex-col overflow-y-auto lg:w-[40%] lg:max-w-[520px]">
          <ConstrutorLote
            projetoPath={projetoPath}
            fontes={fontes}
            transcriptStatusBySource={transcriptStatusBySource}
            selecionadasInicial={selecionadasParaLote}
            aoMudarSelecionadas={definirSelecionadasParaLote}
            listaFontesRef={listaFontesRef}
            aoCriarLote={async () => {
              await recarregarLotes()
            }}
          />
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
        {estado === 'sem-lotes' ? (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-area bg-area">
            <EstadoTela
              tipo="vazio"
              titulo="Nenhum lote executado neste Projeto ainda."
              descricao="Selecione Fontes ao lado para processar Transcrição e Seleção de Cortes em sequência."
              acaoPrimaria={{
                rotulo: 'Focar seleção de Fontes',
                aoAcionar: focarSelecaoFontes,
              }}
            />
          </div>
        ) : (
          <>
            {temLoteParcial && (
              <EstadoTela
                tipo="parcial"
                compacto
                titulo="Há lotes aguardando sua ação"
                descricao="Revise os lotes pausados por orçamento ou com itens pausados por erro abaixo."
              />
            )}
            <ListaLotes
              projetoId={projetoId}
              lotes={lotes}
              jobsAtivos={jobsFila}
              aoAtualizar={async () => {
                await recarregarLotes()
              }}
              aoAbrirFila={aoAbrirFila}
            />
          </>
        )}
      </div>
    </div>
  )
}
