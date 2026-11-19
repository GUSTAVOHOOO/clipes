import {
  BannerErroCore,
  Botao,
  ConfirmDialog,
  Entrada,
  GradeOpcoes,
  GrupoAjuste,
  Progresso,
  Segmentado,
  Slider,
  Status,
  Switch,
  tc,
  useToast,
} from '@ds'
import { Crop, Gamepad2, Maximize2, Trash2, User, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clampCropRect,
  defaultPanelRect,
  effectiveCropLayout,
  splitBounds,
  toggleCropKeyframeCut,
  upsertCropKeyframe,
  removeCropKeyframe,
  type CropKeyframe,
  type CropLayout,
} from '../../../../../src/features/editor/cropMath'
import { InstaladorJustInTime } from '~/componentes/InstaladorJustInTime'
import { chamar, paraErroCore, type ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { useFila } from '~/core/progresso'
import {
  useSessaoEditorCorte,
  type PainelCropAtivo,
  type SessaoEditorCorte,
} from '~/telas/corte/PalcoEditor'

export type PopoverEnquadrarProps = {
  projetoPath?: string | null
  corteId?: string | null
  estadoEditor?: SessaoEditorCorte
  tempoUs?: number
  painelCropAtivo?: PainelCropAtivo
  aoMudarPainelCropAtivo?: (painel: PainelCropAtivo) => void
}

const OPCOES_LAYOUT: Array<{ valor: CropLayout; rotulo: string; icone: React.ReactNode }> = [
  { valor: 'face', rotulo: 'Rosto (9:16)', icone: <User /> },
  { valor: 'fit', rotulo: 'Fit / Centro', icone: <Maximize2 /> },
  { valor: 'gameplay_webcam', rotulo: 'Jogo + Webcam', icone: <Gamepad2 /> },
  { valor: 'two_people', rotulo: 'Duas pessoas', icone: <Users /> },
  { valor: 'fullscreen_roi', rotulo: 'Tela cheia (ROI)', icone: <Crop /> },
]

function extrairConfiancaReframe(metrics: unknown): number | null {
  if (!metrics || typeof metrics !== 'object') return null
  const m = metrics as Record<string, unknown>
  if (typeof m.confidence === 'number' && Number.isFinite(m.confidence)) return m.confidence
  if (typeof m.meanConfidence === 'number' && Number.isFinite(m.meanConfidence)) return m.meanConfidence
  return null
}

export function PopoverEnquadrar({
  projetoPath = null,
  corteId = null,
  estadoEditor,
  tempoUs,
  painelCropAtivo: painelProp,
  aoMudarPainelCropAtivo,
}: PopoverEnquadrarProps) {
  const editor = useSessaoEditorCorte(projetoPath, corteId, estadoEditor)
  const doc = editor.documentoAtivo
  const jobs = useFila()
  const toast = useToast()

  const [painelInterno, setPainelInterno] = useState<PainelCropAtivo>('top')
  const painelAtivo = painelProp ?? painelInterno
  const definirPainelAtivo = useCallback(
    (p: PainelCropAtivo) => {
      if (aoMudarPainelCropAtivo) aoMudarPainelCropAtivo(p)
      else setPainelInterno(p)
    },
    [aoMudarPainelCropAtivo],
  )

  const [yunetDisponivel, setYunetDisponivel] = useState<boolean | null>(null)
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const [confirmarLimpar, setConfirmarLimpar] = useState(false)

  const arrastandoSliderRef = useRef(false)
  const ultimoRatioRef = useRef<number | null>(null)

  const layout = useMemo<CropLayout>(() => (doc ? effectiveCropLayout(doc.crop) : 'fit'), [doc])
  const ehDuplo = layout === 'gameplay_webcam' || layout === 'two_people'
  const usaYunet = layout === 'face' || layout === 'gameplay_webcam' || layout === 'two_people'
  const boundsSplit = splitBounds(layout)
  const ratioAtual = doc?.crop.splitRatio ?? boundsSplit?.[0] ?? 0.3

  const verificarYunet = useCallback(async () => {
    try {
      const [worker, modelos] = await Promise.all([
        chamar<{ installed: boolean }>('components.worker.status', {}),
        chamar<Array<{ id: string; installed: boolean }>>('components.models.manifest', {}),
      ])
      const yunet = (modelos ?? []).find((m) => m.id === 'yunet')
      setYunetDisponivel(Boolean(worker?.installed) && Boolean(yunet?.installed))
    } catch {
      setYunetDisponivel(false)
    }
  }, [])

  useEffect(() => {
    if (usaYunet) {
      void verificarYunet()
    }
  }, [usaYunet, verificarYunet])

  const painelAlvo: 'primary' | 'top' | 'bottom' = ehDuplo ? painelAtivo : 'primary'
  const editsAtivos = useMemo<CropKeyframe[]>(() => {
    if (!doc) return []
    if (!ehDuplo) return doc.crop.edits
    const dual = layout === 'gameplay_webcam' ? doc.crop.gameplayWebcam : doc.crop.twoPeople
    if (!dual) return []
    return painelAtivo === 'top' ? dual.top.edits : dual.bottom.edits
  }, [doc, ehDuplo, layout, painelAtivo])

  const mudarLayout = async (proximo: CropLayout) => {
    setErroAcao(null)
    const bounds = splitBounds(proximo)
    const ratio = bounds ? bounds[0] : null
    try {
      await editor.store.definirLayoutCrop(proximo, ratio, false)
    } catch (err) {
      setErroAcao(paraErroCore(err))
    }
  }

  const mudarProporcao = (pct: number) => {
    const ratio = Math.round(pct) / 100
    ultimoRatioRef.current = ratio
    const preview = arrastandoSliderRef.current
    void editor.store.definirLayoutCrop(layout, ratio, preview).catch((err) => {
      setErroAcao(paraErroCore(err))
    })
  }

  const iniciarAnaliseYunet = async () => {
    setErroAcao(null)
    try {
      await editor.store.iniciarReframe(
        layout as 'face' | 'gameplay_webcam' | 'two_people',
        ehDuplo ? ratioAtual : null,
      )
    } catch (err) {
      const e = paraErroCore(err)
      if (e.code === 'worker_missing' || e.code === 'model_missing') {
        setYunetDisponivel(false)
      } else {
        setErroAcao(e)
      }
    }
  }

  const aplicarSugestao = async () => {
    if (!editor.reframe) return
    setErroAcao(null)
    try {
      await editor.store.aplicarSugestaoCrop(editor.reframe.id)
      toast.add({
        title: 'Sugestão automática aplicada (não entra no Desfazer).',
      })
    } catch (err) {
      setErroAcao(paraErroCore(err))
    }
  }

  const salvarEdits = async (proximos: CropKeyframe[]) => {
    setErroAcao(null)
    try {
      await editor.store.definirEditsCrop(painelAlvo, proximos, false, layout)
    } catch (err) {
      setErroAcao(paraErroCore(err))
    }
  }

  const adicionarOuAtualizarNaAgulha = () => {
    if (!doc) return
    const instante = tempoUs ?? doc.startUs
    const baseRect =
      editsAtivos[0] ?? defaultPanelRect(doc.sourceAspect ?? 16 / 9, ehDuplo ? 1080 / 960 : 9 / 16)
    const prox = upsertCropKeyframe(
      editsAtivos,
      { timeUs: instante, x: baseRect.x, y: baseRect.y, width: baseRect.width, height: baseRect.height },
      40_000,
    )
    void salvarEdits(prox)
  }

  const atualizarCoordKeyframe = (
    kf: CropKeyframe,
    campo: 'x' | 'y' | 'width' | 'height',
    valorPct: number,
  ) => {
    if (!Number.isFinite(valorPct)) return
    const norm = Math.max(0, Math.min(1, valorPct / 100))
    const clamped = clampCropRect({
      x: campo === 'x' ? norm : kf.x,
      y: campo === 'y' ? norm : kf.y,
      width: campo === 'width' ? norm : kf.width,
      height: campo === 'height' ? norm : kf.height,
    })
    const prox = editsAtivos.map((item) =>
      item.timeUs === kf.timeUs ? { ...item, ...clamped } : item,
    )
    void salvarEdits(prox)
  }

  const reframe = editor.reframe
  const reframeRodando = reframe?.state === 'queued' || reframe?.state === 'running'
  const jobReframeFila = useMemo(() => {
    if (!reframe) return null
    return jobs.find((j) => j.id === String(reframe.job)) ?? null
  }, [jobs, reframe])
  const percentualReframe = jobReframeFila?.percentual ?? reframe?.progress ?? 0
  const confiancaReframe = extrairConfiancaReframe(reframe?.timeline?.metrics)

  return (
    <div className="flex flex-col gap-3 text-pequeno">
      {erroAcao && (
        <BannerErroCore
          erro={{ code: erroAcao.code, message: erroAcao.detalhe }}
          traduzir={(code) => mensagemDeErro(new (erroAcao.constructor as typeof ErroCore)(code, erroAcao.detalhe))}
          aoDispensar={() => setErroAcao(null)}
        />
      )}

      <GrupoAjuste rotulo="Layout">
        <GradeOpcoes<CropLayout>
          rotulo="Layout de enquadramento"
          valor={layout}
          aoMudar={(v) => void mudarLayout(v)}
          opcoes={OPCOES_LAYOUT}
          colunas={2}
        />
        {layout === 'fit' && (
          <p className="text-pequeno text-t3">
            Mantém o quadro 16:9 inteiro centralizado com barras laterais ou superiores.
          </p>
        )}
      </GrupoAjuste>

      {ehDuplo && boundsSplit && (
        <GrupoAjuste rotulo="Tela dividida" valor={<span className="num">{Math.round(ratioAtual * 100)}%</span>}>
          <div
            data-slider-wrapper
            onPointerDownCapture={() => {
              arrastandoSliderRef.current = true
            }}
            onPointerUpCapture={() => {
              if (!arrastandoSliderRef.current) return
              arrastandoSliderRef.current = false
              if (ultimoRatioRef.current !== null) {
                void editor.store.definirLayoutCrop(layout, ultimoRatioRef.current, false)
              }
            }}
          >
            <Slider
              rotulo="Proporção vertical"
              min={Math.round(boundsSplit[1] * 100)}
              max={Math.round(boundsSplit[2] * 100)}
              passo={1}
              valor={Math.round(ratioAtual * 100)}
              aoMudar={mudarProporcao}
              textoValor={(v) => `${v}%`}
            />
          </div>
          <Segmentado
            rotulo="Painel ativo"
            valor={painelAtivo}
            aoMudar={definirPainelAtivo}
            opcoes={[
              { valor: 'top', rotulo: 'Topo' },
              { valor: 'bottom', rotulo: 'Base' },
            ]}
          />
          {layout === 'gameplay_webcam' && (
            <p className="text-pequeno text-t3">
              Em Jogo + Webcam, ajustar o retângulo manual da webcam no modo Fonte 16:9 é o caminho principal.
            </p>
          )}
        </GrupoAjuste>
      )}

      {usaYunet && (
        <GrupoAjuste rotulo="Reenquadramento automático (YuNet)">
          {yunetDisponivel === false ? (
            <InstaladorJustInTime
              recurso="yunet"
              modo="inline"
              varianteAcao="secundario"
              aoConcluir={() => {
                setYunetDisponivel(true)
              }}
            />
          ) : (
            <div className="flex flex-col gap-2">
              {editor.modoSomenteLeituraMidia ? (
                <Status tom="aviso">Relocalize a Fonte para analisar o enquadramento automático.</Status>
              ) : null}

              {reframeRodando && reframe ? (
                <div className="flex items-center gap-2">
                  <Progresso valor={percentualReframe} rotulo="Analisando rostos…" className="flex-1" />
                  <Botao
                    tamanho="p"
                    onClick={() => void chamar('jobs.cancel', { id: reframe.job })}
                  >
                    Cancelar
                  </Botao>
                </div>
              ) : (
                <Botao
                  variante="secundario"
                  disabled={editor.modoSomenteLeituraMidia || yunetDisponivel === null}
                  onClick={() => void iniciarAnaliseYunet()}
                >
                  Analisar enquadramento automático
                </Botao>
              )}

              {reframe?.state === 'completed' && reframe.timeline && (
                <div className="flex flex-col gap-2 rounded-controle bg-area p-2">
                  {confiancaReframe !== null && (
                    <span className="num text-pequeno text-t2">
                      Confiança da análise: {(confiancaReframe * 100).toFixed(0)}%
                    </span>
                  )}
                  {layout === 'gameplay_webcam' && (
                    <span className="text-pequeno text-t3">
                      Em webcam pequena, a confiança costuma variar entre 0,10 e 0,65.
                    </span>
                  )}
                  <p className="text-pequeno text-t3">
                    Substitui apenas a sugestão automática; suas correções manuais serão mantidas. Esta ação não entra no Desfazer.
                  </p>
                  <Botao tamanho="p" variante="secundario" onClick={() => void aplicarSugestao()}>
                    Aplicar sugestão automática
                  </Botao>
                </div>
              )}
            </div>
          )}
        </GrupoAjuste>
      )}

      <GrupoAjuste
        rotulo={ehDuplo ? `Keyframes manuais (${painelAtivo === 'top' ? 'Topo' : 'Base'})` : 'Keyframes manuais'}
        valor={<span className="num">{editsAtivos.length}</span>}
      >
        <div className="flex flex-wrap gap-1.5">
          <Botao tamanho="p" variante="secundario" onClick={adicionarOuAtualizarNaAgulha}>
            Adicionar/Atualizar na agulha
          </Botao>
          {editsAtivos.length > 0 && (
            <Botao
              tamanho="p"
              variante="perigo"
              icone={<Trash2 />}
              onClick={() => setConfirmarLimpar(true)}
            >
              Limpar todas as edições manuais
            </Botao>
          )}
        </div>

        {editsAtivos.length === 0 ? (
          <p className="text-pequeno text-t3">Nenhum keyframe manual neste painel.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {editsAtivos.map((kf) => (
              <li key={kf.timeUs} className="flex flex-col gap-1.5 rounded-controle bg-area p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="num font-medio text-t1">
                    {tc(Math.max(0, kf.timeUs - (doc?.startUs ?? 0)))}
                  </span>
                  <div className="flex items-center gap-2">
                    <Switch
                      ligado={Boolean(kf.cut)}
                      aoMudar={() => void salvarEdits(toggleCropKeyframeCut(editsAtivos, kf.timeUs))}
                      className="text-pequeno"
                    >
                      Corte seco (cut)
                    </Switch>
                    <Botao
                      tamanho="p"
                      variante="fantasma"
                      aria-label={`Remover keyframe ${tc(Math.max(0, kf.timeUs - (doc?.startUs ?? 0)))}`}
                      onClick={() => void salvarEdits(removeCropKeyframe(editsAtivos, kf.timeUs))}
                    >
                      Remover
                    </Botao>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {(['x', 'y', 'width', 'height'] as const).map((campo) => (
                    <label key={campo} className="flex flex-col gap-0.5 text-micro text-t3">
                      <span>{campo === 'width' ? 'L%' : campo === 'height' ? 'A%' : `${campo.toUpperCase()}%`}</span>
                      <Entrada
                        tamanho="p"
                        type="number"
                        min={0}
                        max={100}
                        aria-label={`${campo} do keyframe ${kf.timeUs}`}
                        value={Math.round(kf[campo] * 100)}
                        onChange={(e) => atualizarCoordKeyframe(kf, campo, Number(e.target.value))}
                        className="num"
                      />
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </GrupoAjuste>

      <ConfirmDialog
        aberto={confirmarLimpar}
        aoMudarAberto={setConfirmarLimpar}
        titulo="Limpar edições manuais?"
        descricao="Todos os keyframes manuais deste painel serão removidos. Esta ação pode ser desfeita com Ctrl+Z."
        rotuloConfirmar="Limpar edições"
        rotuloCancelar="Cancelar"
        variante="perigo"
        focoInicial="cancelar"
        aoConfirmar={async () => {
          await salvarEdits([])
          setConfirmarLimpar(false)
        }}
      />
    </div>
  )
}
