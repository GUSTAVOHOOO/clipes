import {
  AreaRolagem,
  BannerErroCore,
  BotaoIcone,
  Esqueleto,
  EstadoTela,
  Kbd,
  cn,
  tcLongo,
} from '@ds'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatarTecla } from '~/comandos/atalhos'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'

export interface FraseTranscricaoTransformar {
  id: number
  start_us: number
  end_us: number
  language?: string | null
  text: string
  first_position?: number
  last_position?: number
}

export interface PainelTranscricaoTransformarProps {
  sourceId: number | null
  startId: number | null
  endId: number | null
  aberto: boolean
  refsAtivas: readonly number[]
  fraseDestacadaId?: number | null
  aoAlternarAberto: () => void
  aoClicarFrase: (id: number) => void
  className?: string
}

/**
 * Painel esquerdo recolhível (`Ctrl/Cmd+[`) da Transcrição do Corte na sub-aba Transformar.
 * Mostra as Frases do Corte (`startId..endId`), destaca `refsAtivas` e insere/alterna IDs ao clicar.
 */
export function PainelTranscricaoTransformar({
  sourceId,
  startId,
  endId,
  aberto,
  refsAtivas,
  fraseDestacadaId = null,
  aoAlternarAberto,
  aoClicarFrase,
  className,
}: PainelTranscricaoTransformarProps) {
  const [frases, setFrases] = useState<FraseTranscricaoTransformar[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<ErroCore | null>(null)
  const [tentativa, setTentativa] = useState(0)
  const listaRef = useRef<HTMLUListElement | null>(null)

  const refsSet = useMemo(() => new Set(refsAtivas), [refsAtivas])

  useEffect(() => {
    let cancelado = false
    if (sourceId == null) {
      setFrases([])
      setErro(null)
      setCarregando(false)
      return
    }
    setCarregando(true)
    setErro(null)
    const afterId = startId != null ? Math.max(0, startId - 1) : 0
    const limit =
      startId != null && endId != null && endId >= startId
        ? Math.max(1, endId - startId + 1)
        : 200
    void chamar<FraseTranscricaoTransformar[]>('transcription.sentences', {
      source_id: sourceId,
      after_id: afterId,
      limit,
    })
      .then((res) => {
        if (cancelado) return
        const lista = Array.isArray(res) ? res : []
        const filtradas =
          startId != null && endId != null
            ? lista.filter((f) => f.id >= startId && f.id <= endId)
            : lista
        setFrases(filtradas)
      })
      .catch((e) => {
        if (cancelado) return
        setErro(paraErroCore(e))
        setFrases([])
      })
      .finally(() => {
        if (!cancelado) setCarregando(false)
      })
    return () => {
      cancelado = true
    }
  }, [sourceId, startId, endId, tentativa])

  useEffect(() => {
    if (!aberto || fraseDestacadaId == null) return
    const alvo = listaRef.current?.querySelector<HTMLElement>(
      `[data-frase-id="${fraseDestacadaId}"]`,
    )
    if (alvo && typeof alvo.scrollIntoView === 'function') {
      alvo.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [aberto, fraseDestacadaId, frases])

  const atalho = formatarTecla('Mod+[')

  if (!aberto) {
    return (
      <aside
        aria-label="Transcrição do Corte recolhida"
        className={cn(
          'flex w-10 shrink-0 flex-col items-center gap-3 border-r border-linha bg-area py-2',
          className,
        )}
      >
        <BotaoIcone
          rotulo="Abrir Transcrição do Corte"
          atalho={atalho}
          tamanho="m"
          onClick={aoAlternarAberto}
        >
          <PanelLeftOpen />
        </BotaoIcone>
        <span
          aria-hidden
          className="text-micro font-medio tracking-wide text-t3 select-none [writing-mode:vertical-rl] [transform:rotate(180deg)]"
        >
          Transcrição
        </span>
      </aside>
    )
  }

  return (
    <aside
      aria-label="Transcrição do Corte"
      className={cn(
        'flex w-[clamp(300px,28vw,380px)] min-[1440px]:w-[clamp(340px,28vw,420px)] shrink-0 flex-col border-r border-linha bg-area min-h-0',
        className,
      )}
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-linha px-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="m-0 truncate text-pequeno font-medio text-t1">
            Transcrição do Corte
          </h2>
          <Kbd>{atalho}</Kbd>
        </div>
        <BotaoIcone
          rotulo="Fechar Transcrição do Corte"
          atalho={atalho}
          tamanho="p"
          onClick={aoAlternarAberto}
        >
          <PanelLeftClose />
        </BotaoIcone>
      </header>

      <p className="m-0 shrink-0 px-3 pt-2 pb-1 text-micro text-t3">
        Clique em uma Frase para inserir ou remover seu ID nas referências.
      </p>

      <div className="flex min-h-0 flex-1 flex-col">
        {carregando ? (
          <div className="p-2">
            <Esqueleto
              variante="transcricao"
              quantidade={4}
              rotuloAcessivel="Carregando Transcrição do Corte"
            />
          </div>
        ) : erro ? (
          <div className="p-3">
            <BannerErroCore
              erro={{ code: erro.code, message: erro.detalhe || erro.message }}
              traduzir={(code) => ({
                titulo: mensagemDeErro(new ErroCore(code, erro.detalhe)).titulo,
              })}
              acaoRecuperacao={{
                rotulo: 'Tentar de novo',
                aoAcionar: () => setTentativa((n) => n + 1),
              }}
            />
          </div>
        ) : frases.length === 0 ? (
          <div className="p-3">
            <EstadoTela
              tipo="vazio"
              compacto
              titulo="Nenhuma Frase neste Corte"
              descricao="Não há trechos de Transcrição disponíveis para este intervalo."
            />
          </div>
        ) : (
          <AreaRolagem rotulo="Frases da Transcrição do Corte" className="flex-1">
            <ul ref={listaRef} className="m-0 flex list-none flex-col gap-0.5 p-2">
              {frases.map((frase) => {
                const ativa = refsSet.has(frase.id)
                const destacada = fraseDestacadaId === frase.id
                return (
                  <li key={frase.id}>
                    <button
                      type="button"
                      data-frase-id={frase.id}
                      data-destacada={destacada ? 'true' : undefined}
                      aria-pressed={ativa}
                      onClick={() => aoClicarFrase(frase.id)}
                      className={cn(
                        'foco-interno flex min-h-6 w-full cursor-pointer flex-col gap-0.5 rounded-controle border-0 px-2.5 py-2 text-left transition-colors duration-(--dur-rapida) ease-saida',
                        ativa
                          ? 'marcado bg-elevado text-t1'
                          : destacada
                            ? 'bg-elevado text-t1'
                            : 'bg-transparent text-t2 hover:bg-hover hover:text-t1',
                      )}
                    >
                      <span className="flex items-center gap-2 text-micro text-t3">
                        <span className="num font-medio text-t2">#{frase.id}</span>
                        <span className="num">{tcLongo(frase.start_us)}</span>
                      </span>
                      <span className="text-base leading-[1.55]">{frase.text}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </AreaRolagem>
        )}
      </div>
    </aside>
  )
}
