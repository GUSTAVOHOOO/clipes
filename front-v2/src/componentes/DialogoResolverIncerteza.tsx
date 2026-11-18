import {
  BannerErroCore,
  Botao,
  ConfirmDialog,
  Esqueleto,
  ResumoCustoPrivacidade,
  Status,
} from '@ds'
import { useEffect, useRef, useState } from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'

export interface PropsDialogoResolverIncerteza {
  aberto: boolean
  jobId: number
  rotuloJanela?: string
  aoFechar: () => void
  aoResolver?: (acao: 'retry' | 'discard') => void
}

type RespostaEstimativaJob = {
  safety: 'free' | 'paid' | string
  estimate:
    | { kind: 'zero' }
    | { kind: 'plan_quota' }
    | { kind: 'unknown' }
    | { kind: 'usd'; minMicroUsd: number; maxMicroUsd: number; inputTokens?: number; windows?: number }
}

function converterEstimativa(estimate: RespostaEstimativaJob['estimate']) {
  if (estimate.kind === 'usd') {
    return {
      kind: 'usd' as const,
      minMicroUsd: estimate.minMicroUsd,
      maxMicroUsd: estimate.maxMicroUsd,
      inputTokens: estimate.inputTokens,
      janelas: estimate.windows,
    }
  }
  return estimate
}

/**
 * Diálogo para resolver chamada incerta de Provedor (`uncertain`): estima via `jobs.estimate`
 * e oferece "Repetir chamada" (`jobs.retry` com `confirmed: true`) ou "Descartar chamada" (`jobs.discard`).
 */
export function DialogoResolverIncerteza({
  aberto,
  jobId,
  rotuloJanela,
  aoFechar,
  aoResolver,
}: PropsDialogoResolverIncerteza) {
  const [estimativa, setEstimativa] = useState<RespostaEstimativaJob | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [ocupado, setOcupado] = useState<'retry' | 'discard' | null>(null)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const houveErroAoConfirmarRef = useRef(false)
  const fechouNaAcaoRef = useRef(false)

  useEffect(() => {
    if (!aberto) {
      houveErroAoConfirmarRef.current = false
      fechouNaAcaoRef.current = false
      return
    }

    let cancelado = false
    setErro(null)
    setEstimativa(null)
    setCarregando(true)

    void chamar<RespostaEstimativaJob>('jobs.estimate', { id: jobId })
      .then((res) => {
        if (cancelado) return
        setEstimativa(res)
        setCarregando(false)
      })
      .catch((err) => {
        if (cancelado) return
        setErro(paraErroCore(err))
        setCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [aberto, jobId])

  const repetirChamada = async () => {
    if (ocupado) return
    setErro(null)
    setOcupado('retry')
    houveErroAoConfirmarRef.current = false
    fechouNaAcaoRef.current = false

    try {
      await chamar('jobs.retry', { id: jobId, confirmed: true })
      setOcupado(null)
      fechouNaAcaoRef.current = true
      aoResolver?.('retry')
      aoFechar()
    } catch (err) {
      houveErroAoConfirmarRef.current = true
      setErro(paraErroCore(err))
      setOcupado(null)
    }
  }

  const descartarChamada = async () => {
    if (ocupado) return
    setErro(null)
    setOcupado('discard')
    fechouNaAcaoRef.current = false

    try {
      await chamar('jobs.discard', { id: jobId })
      setOcupado(null)
      fechouNaAcaoRef.current = true
      aoResolver?.('discard')
      aoFechar()
    } catch (err) {
      setErro(paraErroCore(err))
      setOcupado(null)
    }
  }

  const ehPago = estimativa?.safety === 'paid'

  return (
    <ConfirmDialog
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (proximo) return
        if (houveErroAoConfirmarRef.current) {
          houveErroAoConfirmarRef.current = false
          return
        }
        if (fechouNaAcaoRef.current) {
          fechouNaAcaoRef.current = false
          return
        }
        if (!ocupado) aoFechar()
      }}
      titulo={rotuloJanela ? `Resolver chamada incerta — ${rotuloJanela}` : 'Resolver chamada incerta'}
      descricao="A chamada anterior foi interrompida antes da confirmação do Provedor. Confirme se deseja repetir a chamada ou descartá-la para destravar a execução."
      rotuloCancelar="Cancelar"
      rotuloConfirmar="Repetir chamada"
      confirmarDesabilitado={carregando || !estimativa || ocupado !== null}
      ocupado={ocupado === 'retry'}
      focoInicial="cancelar"
      aoConfirmar={repetirChamada}
    >
      <div className="flex flex-col gap-3">
        {carregando && <Esqueleto variante="linha" quantidade={2} rotuloAcessivel="Estimando custo da chamada" />}

        {erro && (
          <BannerErroCore
            erro={{ code: erro.code, message: erro.detalhe || erro.message }}
            traduzir={(code) => {
              const trad = mensagemDeErro(new ErroCore(code, erro.detalhe))
              return {
                titulo: trad.titulo,
                explicacao: erro.detalhe && erro.detalhe !== trad.titulo ? erro.detalhe : undefined,
              }
            }}
          />
        )}

        {estimativa && !carregando && (
          <ResumoCustoPrivacidade
            tarefa={rotuloJanela ? `Repetir ${rotuloJanela}` : 'Repetir chamada incerta'}
            perfil={{
              id: 'provedor-incerta',
              label: ehPago ? 'Provedor pago' : 'Provedor local',
              kind: ehPago ? 'api' : 'local',
              model: null,
            }}
            localidade={ehPago ? 'remoto' : 'local'}
            saiDaMaquina={ehPago}
            estimativa={converterEstimativa(estimativa.estimate)}
            compacto
          />
        )}

        {ehPago && !carregando && (
          <div className="flex items-start gap-2 rounded-area bg-area px-3 py-2.5">
            <Status tom="aviso">Cobrança possível</Status>
            <p className="min-w-0 flex-1 text-pequeno text-t1">
              Esta tarefa usa chamada paga ao Provedor: repetir pode gerar nova cobrança se o pedido anterior tiver sido processado.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-linha pt-2.5">
          <span className="text-pequeno text-t3">
            Ou encerre esta tentativa pendente:
          </span>
          <Botao
            variante="perigo"
            tamanho="p"
            carregando={ocupado === 'discard'}
            disabled={carregando || ocupado !== null}
            onClick={() => void descartarChamada()}
          >
            Descartar chamada
          </Botao>
        </div>
      </div>
    </ConfirmDialog>
  )
}
