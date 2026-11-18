import {
  BannerErroCore,
  Botao,
  Campo,
  Checkbox,
  ConfirmDialog,
  Entrada,
  GrupoAjuste,
  Segmentado,
  Select,
  Slider,
  Status,
  useToast,
} from '@ds'
import { Plus, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { paraErroCore, type ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import {
  type AudioAsset,
  type AudioKind,
  type LicenseKind,
} from '~/stores/editorCorte'
import { useSessaoEditorCorte, type SessaoEditorCorte } from '~/telas/corte/PalcoEditor'

export type PopoverAudioProps = {
  projetoPath?: string | null
  corteId?: string | null
  estadoEditor?: SessaoEditorCorte
  tempoUs?: number
  palavraSelecionadaPosition?: number | null
}

const OPCOES_LICENCA: Array<{ valor: LicenseKind; rotulo: string }> = [
  { valor: 'youtube_audio_library', rotulo: 'Biblioteca do YouTube' },
  { valor: 'cc0', rotulo: 'CC0 (Domínio público)' },
  { valor: 'cc_by', rotulo: 'CC-BY (Com atribuição)' },
  { valor: 'purchased', rotulo: 'Licença comprada' },
  { valor: 'original', rotulo: 'Original / Própria' },
  { valor: 'unknown', rotulo: 'Desconhecida' },
]

export function PopoverAudio({
  projetoPath = null,
  corteId = null,
  estadoEditor,
  tempoUs,
  palavraSelecionadaPosition,
}: PopoverAudioProps) {
  const editor = useSessaoEditorCorte(projetoPath, corteId, estadoEditor)
  const doc = editor.documentoAtivo
  const toast = useToast()

  const [abaBiblioteca, setAbaBiblioteca] = useState<AudioKind>('music')
  const [sfxSelecionadoId, setSfxSelecionadoId] = useState<string | null>(null)
  const [formImportarAberto, setFormImportarAberto] = useState(false)
  const [caminhoImport, setCaminhoImport] = useState('')
  const [tipoImport, setTipoImport] = useState<AudioKind>('music')
  const [nomeImport, setNomeImport] = useState('')
  const [licencaImport, setLicencaImport] = useState<LicenseKind>('unknown')
  const [atribuicaoImport, setAtribuicaoImport] = useState('')
  const [erroAtribuicao, setErroAtribuicao] = useState<string | undefined>(undefined)
  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const [excluirAlvo, setExcluirAlvo] = useState<AudioAsset | null>(null)

  const refAtribuicao = useRef<HTMLInputElement>(null)
  const arrastandoVolumeTrilhaRef = useRef(false)
  const ultimoVolumeTrilhaRef = useRef<number | null>(null)

  const musicas = useMemo(
    () => editor.bibliotecaAudio.filter((a) => a.kind === 'music'),
    [editor.bibliotecaAudio],
  )
  const efeitos = useMemo(
    () => editor.bibliotecaAudio.filter((a) => a.kind === 'sfx'),
    [editor.bibliotecaAudio],
  )
  const bibliotecaFiltrada = abaBiblioteca === 'music' ? musicas : efeitos

  const soundtrack = doc?.audioMix.soundtrack ?? null
  const sfxNoCorte = doc?.audioMix.sfx ?? []
  const tempoAtual = tempoUs ?? doc?.startUs ?? 0
  const sfxAtivoId =
    sfxSelecionadoId && efeitos.some((e) => String(e.id) === sfxSelecionadoId)
      ? sfxSelecionadoId
      : efeitos[0]
        ? String(efeitos[0].id)
        : null

  const removerTrilha = async () => {
    setErroAcao(null)
    try {
      await editor.store.limparTrilhaSonora()
      toast.add({
        title: 'Trilha sonora removida.',
        actionProps: {
          children: 'Desfazer',
          onClick: () => void editor.store.desfazerEditor(),
        },
      })
    } catch (err) {
      setErroAcao(paraErroCore(err))
    }
  }

  const removerSfx = async (id: number, nome: string) => {
    setErroAcao(null)
    try {
      await editor.store.removerSfx(id)
      toast.add({
        title: `SFX "${nome}" removido.`,
        actionProps: {
          children: 'Desfazer',
          onClick: () => void editor.store.desfazerEditor(),
        },
      })
    } catch (err) {
      setErroAcao(paraErroCore(err))
    }
  }

  const confirmarImportacao = async () => {
    setErroAtribuicao(undefined)
    setErroAcao(null)
    if (licencaImport === 'cc_by' && !atribuicaoImport.trim()) {
      setErroAtribuicao('Informe a atribuição obrigatória para licença CC-BY.')
      refAtribuicao.current?.focus()
      return
    }
    try {
      await editor.store.importarAudio({
        kind: tipoImport,
        path: caminhoImport.trim(),
        ...(nomeImport.trim() ? { name: nomeImport.trim() } : {}),
        license_kind: licencaImport,
        ...(licencaImport === 'cc_by' ? { license_attribution: atribuicaoImport.trim() } : {}),
      })
      setFormImportarAberto(false)
      setCaminhoImport('')
      setNomeImport('')
      setAtribuicaoImport('')
      setAbaBiblioteca(tipoImport)
    } catch (err) {
      const e = paraErroCore(err)
      if (e.code === 'attribution_required') {
        setErroAtribuicao('Informe a atribuição obrigatória para licença CC-BY.')
        refAtribuicao.current?.focus()
      } else {
        setErroAcao(e)
      }
    }
  }

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

      {/* Trilha sonora do Corte */}
      <GrupoAjuste rotulo="Trilha sonora do Corte">
        <Select<string>
          rotulo="Selecionar trilha sonora"
          placeholder="Escolher música da biblioteca…"
          valor={soundtrack ? String(soundtrack.assetId) : null}
          aoMudar={(id) => void editor.store.definirTrilhaSonora({ asset_id: Number(id) })}
          opcoes={musicas.map((m) => ({ valor: String(m.id), rotulo: m.name }))}
        />

        {soundtrack && (
          <div className="flex flex-col gap-2 rounded-controle bg-area p-2">
            <div className="flex items-center justify-between gap-2">
              <Status tom={soundtrack.licenseVerified ? 'sucesso' : 'aviso'}>
                {soundtrack.licenseVerified ? 'Licença verificada' : 'Licença não informada'}
              </Status>
              <Botao tamanho="p" variante="fantasma" onClick={() => void removerTrilha()}>
                Remover trilha
              </Botao>
            </div>

            <div
              data-slider-wrapper
              onPointerDownCapture={() => {
                arrastandoVolumeTrilhaRef.current = true
              }}
              onPointerUpCapture={() => {
                if (!arrastandoVolumeTrilhaRef.current) return
                arrastandoVolumeTrilhaRef.current = false
                if (ultimoVolumeTrilhaRef.current !== null) {
                  void editor.store.definirTrilhaSonora({
                    volume: ultimoVolumeTrilhaRef.current,
                    preview: false,
                  })
                }
              }}
            >
              <div className="flex items-center justify-between text-micro text-t3">
                <span>Volume</span>
                <span className="num text-t2">{Math.round(soundtrack.volume * 100)}%</span>
              </div>
              <Slider
                rotulo="Volume da trilha"
                min={0}
                max={100}
                passo={1}
                valor={Math.round(soundtrack.volume * 100)}
                aoMudar={(pct) => {
                  const vol = Math.round(pct) / 100
                  ultimoVolumeTrilhaRef.current = vol
                  void editor.store.definirTrilhaSonora({
                    volume: vol,
                    preview: arrastandoVolumeTrilhaRef.current,
                  })
                }}
                textoValor={(v) => `${v}%`}
              />
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <Campo rotulo="Início (s)">
                {(props) => (
                  <Entrada
                    {...props}
                    tamanho="p"
                    type="number"
                    min={0}
                    step={0.5}
                    value={Number((soundtrack.startUs / 1_000_000).toFixed(1))}
                    onChange={(e) =>
                      void editor.store.definirTrilhaSonora({
                        start_us: Math.max(0, Math.round(Number(e.target.value) * 1_000_000)),
                      })
                    }
                    className="num"
                  />
                )}
              </Campo>
              <Campo rotulo="Fade-in (s)">
                {(props) => (
                  <Entrada
                    {...props}
                    tamanho="p"
                    type="number"
                    min={0}
                    step={0.5}
                    value={Number((soundtrack.fadeInUs / 1_000_000).toFixed(1))}
                    onChange={(e) =>
                      void editor.store.definirTrilhaSonora({
                        fade_in_us: Math.max(0, Math.round(Number(e.target.value) * 1_000_000)),
                      })
                    }
                    className="num"
                  />
                )}
              </Campo>
              <Campo rotulo="Fade-out (s)">
                {(props) => (
                  <Entrada
                    {...props}
                    tamanho="p"
                    type="number"
                    min={0}
                    step={0.5}
                    value={Number((soundtrack.fadeOutUs / 1_000_000).toFixed(1))}
                    onChange={(e) =>
                      void editor.store.definirTrilhaSonora({
                        fade_out_us: Math.max(0, Math.round(Number(e.target.value) * 1_000_000)),
                      })
                    }
                    className="num"
                  />
                )}
              </Campo>
            </div>

            <Checkbox
              marcado={soundtrack.loopToFit}
              aoMudar={(loop_to_fit) => void editor.store.definirTrilhaSonora({ loop_to_fit })}
              className="text-pequeno"
            >
              Repetir para cobrir o Corte
            </Checkbox>

            <p className="text-micro text-t3">Abaixa automaticamente -12 dB sob a fala.</p>
          </div>
        )}
      </GrupoAjuste>

      {/* Efeitos sonoros (SFX) */}
      <GrupoAjuste rotulo="Efeitos sonoros (SFX)">
        <Select<string>
          rotulo="Escolher efeito sonoro"
          placeholder="Escolher SFX da biblioteca…"
          valor={sfxAtivoId}
          aoMudar={setSfxSelecionadoId}
          opcoes={efeitos.map((e) => ({ valor: String(e.id), rotulo: e.name }))}
        />
        <div className="flex flex-wrap gap-1.5">
          <Botao
            tamanho="p"
            variante="secundario"
            disabled={!sfxAtivoId}
            onClick={() =>
              sfxAtivoId &&
              void editor.store.adicionarSfx({
                asset_id: Number(sfxAtivoId),
                anchor: { kind: 'moment', sourceUs: tempoAtual },
              })
            }
          >
            Adicionar SFX na agulha
          </Botao>
          <Botao
            tamanho="p"
            variante="fantasma"
            disabled={!sfxAtivoId || typeof palavraSelecionadaPosition !== 'number'}
            onClick={() =>
              sfxAtivoId &&
              typeof palavraSelecionadaPosition === 'number' &&
              void editor.store.adicionarSfx({
                asset_id: Number(sfxAtivoId),
                anchor: {
                  kind: 'word',
                  track: 'original',
                  position: palavraSelecionadaPosition,
                  offsetUs: 0,
                },
              })
            }
          >
            Ancorar na palavra selecionada
          </Botao>
        </div>

        {sfxNoCorte.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {sfxNoCorte.map((item) => (
              <li key={item.id} className="flex flex-col gap-1.5 rounded-controle bg-area p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medio text-t1">{item.name}</span>
                  {item.outsideClip && <Status tom="aviso">Fora do Corte</Status>}
                </div>
                <div className="flex items-center justify-between text-micro text-t3">
                  <span>Volume</span>
                  <span className="num text-t2">{Math.round(item.volume * 100)}%</span>
                </div>
                <Slider
                  rotulo={`Volume de ${item.name}`}
                  min={0}
                  max={100}
                  passo={1}
                  valor={Math.round(item.volume * 100)}
                  aoMudar={(pct) =>
                    void editor.store.atualizarSfx({
                      id: item.id,
                      volume: Math.round(pct) / 100,
                    })
                  }
                  textoValor={(v) => `${v}%`}
                />
                <div className="flex justify-between gap-1.5">
                  <Botao
                    tamanho="p"
                    variante="fantasma"
                    onClick={() =>
                      void editor.store.atualizarSfx({ id: item.id, time_us: tempoAtual })
                    }
                  >
                    Mover para a agulha
                  </Botao>
                  <Botao
                    tamanho="p"
                    variante="fantasma"
                    aria-label={`Remover SFX ${item.name}`}
                    onClick={() => void removerSfx(item.id, item.name)}
                  >
                    Remover
                  </Botao>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GrupoAjuste>

      {/* Biblioteca do Projeto */}
      <GrupoAjuste rotulo="Biblioteca do Projeto">
        <div className="flex items-center justify-between gap-2">
          <Segmentado<AudioKind>
            rotulo="Filtro da biblioteca"
            valor={abaBiblioteca}
            aoMudar={setAbaBiblioteca}
            opcoes={[
              { valor: 'music', rotulo: 'Músicas' },
              { valor: 'sfx', rotulo: 'SFX' },
            ]}
          />
          <Botao
            tamanho="p"
            variante="secundario"
            icone={<Plus />}
            onClick={() => setFormImportarAberto((v) => !v)}
          >
            Importar áudio (até 500 MiB)
          </Botao>
        </div>

        {formImportarAberto && (
          <div className="flex flex-col gap-2 rounded-controle bg-area p-2">
            <SeletorCaminho
              modo="arquivo"
              rotulo="Arquivo de áudio"
              valor={caminhoImport}
              aoMudar={setCaminhoImport}
            />
            <Segmentado<AudioKind>
              rotulo="Tipo do áudio"
              valor={tipoImport}
              aoMudar={setTipoImport}
              opcoes={[
                { valor: 'music', rotulo: 'Música' },
                { valor: 'sfx', rotulo: 'SFX' },
              ]}
            />
            <Campo rotulo="Nome">
              {(props) => (
                <Entrada
                  {...props}
                  tamanho="p"
                  value={nomeImport}
                  onChange={(e) => setNomeImport(e.target.value)}
                  placeholder="Opcional"
                />
              )}
            </Campo>
            <Campo rotulo="Origem / Licença">
              {(props) => (
                <Select<LicenseKind>
                  {...props}
                  rotulo="Origem / Licença"
                  valor={licencaImport}
                  aoMudar={(v) => {
                    setLicencaImport(v)
                    setErroAtribuicao(undefined)
                  }}
                  opcoes={OPCOES_LICENCA}
                />
              )}
            </Campo>
            {licencaImport === 'cc_by' && (
              <Campo rotulo="Atribuição" erro={erroAtribuicao}>
                {(props) => (
                  <Entrada
                    {...props}
                    ref={refAtribuicao}
                    tamanho="p"
                    value={atribuicaoImport}
                    onChange={(e) => {
                      setAtribuicaoImport(e.target.value)
                      if (erroAtribuicao) setErroAtribuicao(undefined)
                    }}
                    placeholder="Autor / fonte para crédito"
                  />
                )}
              </Campo>
            )}
            <div className="flex justify-end gap-2">
              <Botao tamanho="p" variante="fantasma" onClick={() => setFormImportarAberto(false)}>
                Cancelar
              </Botao>
              <Botao
                tamanho="p"
                variante="secundario"
                onClick={() => void confirmarImportacao()}
              >
                Confirmar importação
              </Botao>
            </div>
          </div>
        )}

        {bibliotecaFiltrada.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-controle bg-area p-3 text-center text-t3">
            <p>Nenhuma música ou efeito sonoro no Projeto ainda.</p>
            {!formImportarAberto && (
              <Botao
                tamanho="p"
                variante="secundario"
                onClick={() => setFormImportarAberto(true)}
              >
                Importar áudio local
              </Botao>
            )}
          </div>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {bibliotecaFiltrada.map((asset) => (
              <li
                key={asset.id}
                className="flex flex-col gap-1.5 rounded-controle bg-area p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medio text-t1">{asset.name}</span>
                  <Botao
                    tamanho="p"
                    variante="perigo"
                    icone={<Trash2 />}
                    aria-label={`Excluir ${asset.name} da biblioteca`}
                    onClick={() => setExcluirAlvo(asset)}
                  >
                    Excluir
                  </Botao>
                </div>
                <Select<LicenseKind>
                  rotulo={`Licença de ${asset.name}`}
                  valor={asset.licenseKind}
                  aoMudar={(lk) =>
                    void editor.store
                      .definirLicencaAudio(
                        asset.id,
                        lk,
                        lk === 'cc_by' ? asset.licenseAttribution || 'Autor' : undefined,
                      )
                      .catch((err) => setErroAcao(paraErroCore(err)))
                  }
                  opcoes={OPCOES_LICENCA}
                />
              </li>
            ))}
          </ul>
        )}
      </GrupoAjuste>

      <ConfirmDialog
        aberto={excluirAlvo !== null}
        aoMudarAberto={(v) => {
          if (!v) setExcluirAlvo(null)
        }}
        titulo="Excluir áudio da biblioteca?"
        descricao={`Remover "${excluirAlvo?.name ?? ''}" da biblioteca do Projeto não pode ser desfeito.`}
        rotuloConfirmar="Excluir áudio"
        rotuloCancelar="Cancelar"
        variante="perigo"
        focoInicial="cancelar"
        aoConfirmar={async () => {
          if (!excluirAlvo) return
          await editor.store.excluirAudio(excluirAlvo.id)
          setExcluirAlvo(null)
        }}
      />
    </div>
  )
}
