import {
  BannerErroCore,
  Botao,
  GrupoAjuste,
  Slider,
  Status,
  duracao,
  tc,
} from '@ds'
import { Play } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { paraErroCore, type ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useSessaoEditorCorte, type SessaoEditorCorte } from '~/telas/corte/PalcoEditor'

export type PopoverSilenciosProps = {
  projetoPath?: string | null
  corteId?: string | null
  estadoEditor?: SessaoEditorCorte
  aoOuvirEmContexto: (tempoUs: number) => void
}

function trechoContexto(
  frases: Array<{ startUs: number; endUs: number; text: string }>,
  gapStartUs: number,
  gapEndUs: number,
): string {
  const antes = frases.filter((f) => f.endUs <= gapStartUs + 250_000).slice(-1)[0]
  const depois = frases.find((f) => f.startUs >= gapEndUs - 250_000)
  const pAntes = antes ? antes.text.trim().split(/\s+/).slice(-3).join(' ') : ''
  const pDepois = depois ? depois.text.trim().split(/\s+/).slice(0, 3).join(' ') : ''
  if (!pAntes && !pDepois) return '[pausa]'
  return `…${pAntes} [pausa] ${pDepois}…`.trim()
}

export function PopoverSilencios({
  projetoPath = null,
  corteId = null,
  estadoEditor,
  aoOuvirEmContexto,
}: PopoverSilenciosProps) {
  const editor = useSessaoEditorCorte(projetoPath, corteId, estadoEditor)
  const doc = editor.documentoAtivo
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const arrastandoRef = useRef(false)
  const ultimoThresholdUsRef = useRef<number | null>(null)

  const silences = doc?.silences
  const limiarMs = Math.round((silences?.thresholdUs ?? 600_000) / 1000)
  const intervalos = silences?.intervals ?? []
  const ativas = useMemo(
    () => intervalos.filter((i) => i.status === 'active').length,
    [intervalos],
  )

  const aoMudarLimiar = (ms: number) => {
    const us = Math.round(ms) * 1000
    ultimoThresholdUsRef.current = us
    const preview = arrastandoRef.current
    void editor.store.detectarSilencios(us, preview).catch((err) => {
      setErroAcao(paraErroCore(err))
    })
  }

  if (!doc || !silences) {
    return <p className="text-pequeno text-t3">Nenhum Corte carregado.</p>
  }

  const duracaoOriginalUs = Math.max(0, doc.endUs - doc.startUs)

  return (
    <div className="flex flex-col gap-3 text-pequeno">
      {erroAcao && (
        <BannerErroCore
          erro={{ code: erroAcao.code, message: erroAcao.detalhe }}
          traduzir={(code) =>
            mensagemDeErro(new (erroAcao.constructor as typeof ErroCore)(code, erroAcao.detalhe))
          }
          aoDispensar={() => setErroAcao(null)}
        />
      )}

      <p className="rounded-controle bg-area p-2 text-t2">
        Preserva 120 ms após a fala anterior e 75 ms antes da próxima (mínimo 200 ms).
      </p>

      <GrupoAjuste
        rotulo="Duração mínima da pausa"
        valor={<span className="num">{limiarMs} ms</span>}
      >
        <div
          data-slider-wrapper
          onPointerDownCapture={() => {
            arrastandoRef.current = true
          }}
          onPointerUpCapture={() => {
            if (!arrastandoRef.current) return
            arrastandoRef.current = false
            if (ultimoThresholdUsRef.current !== null) {
              void editor.store.detectarSilencios(ultimoThresholdUsRef.current, false)
            }
          }}
        >
          <Slider
            rotulo="Duração mínima da pausa"
            min={300}
            max={2000}
            passo={50}
            valor={limiarMs}
            aoMudar={aoMudarLimiar}
            textoValor={(v) => `${v} ms`}
          />
        </div>
      </GrupoAjuste>

      <dl className="m-0 grid grid-cols-2 gap-2 rounded-controle bg-area p-2">
        <div>
          <dt className="text-micro text-t3">Original</dt>
          <dd className="num m-0 text-t1">{tc(duracaoOriginalUs)}</dd>
        </div>
        <div>
          <dt className="text-micro text-t3">Efetiva</dt>
          <dd className="num m-0 text-t1">{tc(silences.effectiveDurationUs)}</dd>
        </div>
        <div>
          <dt className="text-micro text-t3">Removido</dt>
          <dd className="num m-0 text-t2">{duracao(silences.removedUs)}</dd>
        </div>
        <div>
          <dt className="text-micro text-t3">Pausas ativas</dt>
          <dd className="num m-0 text-t1">
            {ativas} / {intervalos.length}
          </dd>
        </div>
      </dl>

      <div className="flex gap-2">
        <Botao
          tamanho="p"
          variante="secundario"
          disabled={intervalos.length === 0}
          onClick={() => void editor.store.aplicarTodosSilencios()}
          className="flex-1 justify-center"
        >
          Aplicar todos
        </Botao>
        <Botao
          tamanho="p"
          variante="fantasma"
          disabled={intervalos.length === 0}
          onClick={() => void editor.store.reverterTodosSilencios()}
          className="flex-1 justify-center"
        >
          Reverter todos
        </Botao>
      </div>

      {intervalos.length === 0 ? (
        <div className="rounded-controle bg-area p-3 text-center text-t3">
          Nenhuma pausa detectada acima deste limite.
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {intervalos.map((s, idx) => {
            const ativa = s.status === 'active'
            const duracaoMs = Math.round((s.endUs - s.startUs) / 1000)
            const contexto = trechoContexto(editor.frases, s.gapStartUs, s.gapEndUs)
            return (
              <li key={s.id} className="flex flex-col gap-1.5 rounded-controle bg-area p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="num font-medio text-t1">
                    #{idx + 1} · {tc(Math.max(0, s.startUs - doc.startUs))} –{' '}
                    {tc(Math.max(0, s.endUs - doc.startUs))}
                  </span>
                  <span className="num text-t3">{duracaoMs} ms</span>
                </div>
                <p className="text-pequeno text-t2">{contexto}</p>
                <div className="flex items-center justify-between gap-2">
                  <Botao
                    tamanho="p"
                    variante="fantasma"
                    icone={<Play />}
                    onClick={() => aoOuvirEmContexto(Math.max(doc.startUs, s.startUs - 1_500_000))}
                  >
                    Ouvir em contexto
                  </Botao>
                  <Botao
                    tamanho="p"
                    variante={ativa ? 'suave' : 'secundario'}
                    onClick={() => void editor.store.alternarSilencio(s.id)}
                  >
                    {ativa ? 'Manter pausa' : 'Remover pausa'}
                  </Botao>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
