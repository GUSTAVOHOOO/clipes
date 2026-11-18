// Tela de prova 1: Editor do Corte, organização da variante D aprovada
// (transcrição à esquerda, vídeo em altura total, transporte + 5 ações numa linha, timeline enxuta).
import { AudioLines, Captions, Clapperboard, Columns2, Crop, Expand, History, PanelLeft, Shrink, Type, Volume2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ContextoCorte } from '@/componentes/ContextoCorte'
import { LinhaFrase, LinhaSilencio } from '@/componentes/Linhas'
import { BarraAcoes, GrupoAjuste, PlayerProxy, TimelineEditor, Transporte, type AcaoBarra } from '@/componentes/Midia'
import { Paleta, useAtalhoPaleta, type Comando } from '@/componentes/Paleta'
import { BadgeNota, EixosNota } from '@/componentes/Selos'
import { DicaAtalho, Tela } from '@/componentes/Tela'
import { tc } from '@/lib/formato'
import { BotaoIcone } from '@/primitivas/Botao'
import { Entrada, Select } from '@/primitivas/Campos'
import { Checkbox, GradeOpcoes, Segmentado, Slider, Switch } from '@/primitivas/Escolhas'
import { Abas, AreaRolagem, Status } from '@/primitivas/Indicadores'
import { duracaoCorteUs, eixos, frasesTimeline, historico, onda, quadro1, transcricao } from './dados'

type Enquadramento = 'preencher' | 'ajustar' | 'duplo'
type EstiloLegenda = 'karaoke' | 'cinema' | 'simples'

export function TelaEditor() {
  const [aba, setAba] = useState<'transcricao' | 'indice'>('transcricao')
  const [filtro, setFiltro] = useState('')
  const [tempoUs, setTempoUs] = useState(14_200_000)
  const [tocando, setTocando] = useState(false)
  const [mudo, setMudo] = useState(false)
  const [extras, setExtras] = useState(false)
  // ?abrir=enquadrar abre uma ação já na carga (para captura headless)
  const [aberta, setAberta] = useState<string | null>(() => new URLSearchParams(location.search).get('abrir'))
  const [paleta, setPaleta] = useState(false)
  const [removidos, setRemovidos] = useState(() => new Set(transcricao.filter((t) => t.tipo === 'silencio' && t.removido).map((t) => t.id)))
  const [enq, setEnq] = useState<Enquadramento>('preencher')
  const [zoom, setZoom] = useState(112)
  const [estilo, setEstilo] = useState<EstiloLegenda>('karaoke')
  const [fonte, setFonte] = useState<'inter' | 'montserrat' | 'bebas'>('inter')
  const [tamLegenda, setTamLegenda] = useState(64)
  const [limiar, setLimiar] = useState<'0.5' | '0.8' | '1.2'>('0.8')
  const [voz, setVoz] = useState(100)
  const [trilha, setTrilha] = useState(18)
  const [normalizar, setNormalizar] = useState(true)
  const quadro = useRef<HTMLDivElement>(null)

  useAtalhoPaleta(useCallback(() => setPaleta((v) => !v), []))

  const alternarSilencio = (id: string) =>
    setRemovidos((r) => {
      const n = new Set(r)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const silencios = transcricao.filter((t) => t.tipo === 'silencio')
  const removidoUs = silencios.filter((t) => removidos.has(t.id)).reduce((soma, t) => soma + (t.fimUs - t.inicioUs), 0)
  const visiveis = filtro ? transcricao.filter((t) => t.tipo === 'frase' && t.texto.toLowerCase().includes(filtro.toLowerCase())) : transcricao
  const fraseAtiva = transcricao.find((t) => t.tipo === 'frase' && tempoUs >= t.inicioUs && tempoUs < t.fimUs)

  const acoes: AcaoBarra[] = useMemo(
    () => [
      {
        id: 'enquadrar', rotulo: 'Enquadrar', icone: <Crop />,
        conteudo: (
          <>
            <GrupoAjuste rotulo="Modo">
              <GradeOpcoes<Enquadramento> rotulo="Modo de enquadramento" valor={enq} aoMudar={setEnq}
                opcoes={[{ valor: 'preencher', rotulo: 'Preencher', icone: <Expand /> }, { valor: 'ajustar', rotulo: 'Ajustar', icone: <Shrink /> }, { valor: 'duplo', rotulo: 'Duplo', icone: <Columns2 className="rotate-90" /> }]}
              />
            </GrupoAjuste>
            <GrupoAjuste rotulo="Zoom" valor={`${zoom}%`}>
              <Slider rotulo="Zoom" valor={zoom} aoMudar={setZoom} min={100} max={200} textoValor={(v) => `${v}%`} />
            </GrupoAjuste>
          </>
        ),
      },
      {
        id: 'legenda', rotulo: 'Legenda', icone: <Type />,
        conteudo: (
          <>
            <GrupoAjuste rotulo="Estilo">
              <GradeOpcoes<EstiloLegenda> rotulo="Estilo da legenda" valor={estilo} aoMudar={setEstilo}
                opcoes={[{ valor: 'karaoke', rotulo: 'Karaokê', icone: <Captions /> }, { valor: 'cinema', rotulo: 'Cinema', icone: <Clapperboard /> }, { valor: 'simples', rotulo: 'Simples', icone: <Type /> }]}
              />
            </GrupoAjuste>
            <GrupoAjuste rotulo="Fonte">
              <Select rotulo="Fonte da legenda" valor={fonte} aoMudar={setFonte}
                opcoes={[{ valor: 'inter', rotulo: 'Inter Black' }, { valor: 'montserrat', rotulo: 'Montserrat ExtraBold' }, { valor: 'bebas', rotulo: 'Bebas Neue' }]}
              />
            </GrupoAjuste>
            <GrupoAjuste rotulo="Tamanho" valor={`${tamLegenda} px`}>
              <Slider rotulo="Tamanho da legenda" valor={tamLegenda} aoMudar={setTamLegenda} min={40} max={96} textoValor={(v) => `${v} px`} />
            </GrupoAjuste>
          </>
        ),
      },
      {
        id: 'silencios', rotulo: 'Silêncios', icone: <AudioLines />,
        conteudo: (
          <>
            <GrupoAjuste rotulo="Considerar silêncio a partir de">
              <Segmentado rotulo="Limiar de silêncio" valor={limiar} aoMudar={setLimiar}
                opcoes={[{ valor: '0.5', rotulo: '0,5 s' }, { valor: '0.8', rotulo: '0,8 s' }, { valor: '1.2', rotulo: '1,2 s' }]}
              />
            </GrupoAjuste>
            <GrupoAjuste rotulo="Remover" valor={`${removidos.size} de ${silencios.length}`}>
              <div className="flex flex-col gap-1">
                {silencios.map((t) => (
                  <Checkbox key={t.id} marcado={removidos.has(t.id)} aoMudar={() => alternarSilencio(t.id)}>
                    <span className="num">{tc(t.inicioUs)}</span>
                    <span className="num ml-auto text-t3">{((t.fimUs - t.inicioUs) / 1e6).toLocaleString('pt-BR')} s</span>
                  </Checkbox>
                ))}
              </div>
            </GrupoAjuste>
          </>
        ),
      },
      {
        id: 'audio', rotulo: 'Áudio', icone: <Volume2 />,
        conteudo: (
          <>
            <GrupoAjuste rotulo="Voz" valor={`${voz}%`}>
              <Slider rotulo="Volume da voz" valor={voz} aoMudar={setVoz} max={150} textoValor={(v) => `${v}%`} />
            </GrupoAjuste>
            <GrupoAjuste rotulo="Trilha" valor={`${trilha}%`}>
              <Slider rotulo="Volume da trilha" valor={trilha} aoMudar={setTrilha} textoValor={(v) => `${v}%`} />
            </GrupoAjuste>
            <Switch ligado={normalizar} aoMudar={setNormalizar}>Normalizar loudness</Switch>
          </>
        ),
      },
      {
        id: 'historico', rotulo: 'Histórico', icone: <History />,
        conteudo: (
          <ol className="flex flex-col gap-0.5">
            {historico.map((h, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 rounded-controle px-1.5 py-1.5 text-pequeno hover:bg-hover">
                <span className={i === 0 ? 'text-t1' : 'text-t2'}>{h.oque}</span>
                <span className="shrink-0 text-t3">{h.quando}</span>
              </li>
            ))}
          </ol>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enq, zoom, estilo, fonte, tamLegenda, limiar, removidos, voz, trilha, normalizar],
  )

  const comandos: Comando[] = [
    { id: 'exp', rotulo: 'Exportar Corte', grupo: 'Corte', atalho: 'Ctrl E', aoExecutar: () => setPaleta(false) },
    { id: 'trans', rotulo: 'Mostrar ou ocultar Transcrição', grupo: 'Corte', atalho: 'Ctrl [', aoExecutar: () => setPaleta(false) },
    { id: 'ult', rotulo: 'Reabrir último ajuste', grupo: 'Corte', atalho: 'Ctrl ]', aoExecutar: () => (setPaleta(false), setAberta('enquadrar')) },
    { id: 'sil', rotulo: 'Remover todos os silêncios', grupo: 'Ajustes', aoExecutar: () => (setPaleta(false), setRemovidos(new Set(silencios.map((t) => t.id)))) },
    { id: 'fila', rotulo: 'Abrir Fila de jobs', grupo: 'Projeto', atalho: 'Ctrl J', aoExecutar: () => setPaleta(false) },
  ]

  return (
    <Tela
      titulo="Editor do Corte"
      projeto={{ nome: 'Canal Dark História', outros: ['Canal de Cortes'] }}
      etapa="cortes"
      fila={{ ativos: 2 }}
      aoAbrirPaleta={() => setPaleta(true)}
      meio={
        <ContextoCorte
          projetoId="p1"
          corteAtual={{ corteId: 'k2', candidateId: 14, titulo: 'Como o navegador bloqueou o vazamento', indice: 2, totalAprovados: 8, videoKind: 'direct', anteriorId: 'k1', proximoId: 'k3' }}
          subAbaAtiva="editar"
          aoAbrirExportacao={() => undefined}
        />
      }
      status={{
        esquerda: (
          <>
            <Status tom="sucesso">Salvo</Status>
            <span className="num">Duração efetiva {tc(duracaoCorteUs - removidoUs)}</span>
          </>
        ),
        direita: (
          <>
            <DicaAtalho tecla="Ctrl [">transcrição</DicaAtalho>
            <DicaAtalho tecla="Ctrl ]">último ajuste</DicaAtalho>
          </>
        ),
      }}
    >
      <div className="flex min-h-0 flex-1">
        <aside aria-label="Transcrição do Corte" className="flex w-[clamp(330px,31vw,420px)] shrink-0 flex-col bg-area min-[1440px]:w-[clamp(420px,31vw,480px)]">
          <div className="flex h-10 shrink-0 items-center gap-2 px-3">
            <Abas rotulo="Painel do Corte" valor={aba} aoMudar={setAba} abas={[{ valor: 'transcricao', rotulo: 'Transcrição' }, { valor: 'indice', rotulo: 'Índice' }]} />
            <BotaoIcone rotulo="Recolher painel" atalho="Ctrl [" className="ml-auto">
              <PanelLeft />
            </BotaoIcone>
          </div>
          {aba === 'transcricao' ? (
            <>
              <div className="shrink-0 px-3 pb-2">
                <Entrada tamanho="p" value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar fala do Corte…" aria-label="Filtrar fala do Corte" />
              </div>
              <AreaRolagem rotulo="Frases do Corte" className="flex-1">
                <div className="flex flex-col gap-1 px-3 pt-1 pb-3.5">
                  {visiveis.map((t) =>
                    t.tipo === 'frase' ? (
                      <LinhaFrase key={t.id} inicioUs={t.inicioUs} palavras={t.texto.split(' ')} fora={t.fora} ativa={fraseAtiva?.id === t.id}
                        falada={fraseAtiva?.id === t.id ? t.texto.split(' ').indexOf('EXATAMENTE') : undefined} aoClicar={() => setTempoUs(t.inicioUs)}
                      />
                    ) : (
                      <LinhaSilencio key={t.id} duracaoUs={t.fimUs - t.inicioUs} removido={removidos.has(t.id)} aoAlternar={() => alternarSilencio(t.id)} />
                    ),
                  )}
                  {visiveis.length === 0 && <p className="px-2.5 py-6 text-pequeno text-t3">Nenhuma fala com “{filtro}” neste Corte.</p>}
                </div>
              </AreaRolagem>
            </>
          ) : (
            <div className="flex flex-col gap-4 px-5 pt-3">
              <BadgeNota nota={8.4} motivo="Gancho forte nos primeiros 3 s" />
              <EixosNota eixos={eixos} abertoPorPadrao />
            </div>
          )}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col items-center px-4 pt-2 pb-2">
          <div className="flex min-h-0 w-full flex-1 justify-center">
            <PlayerProxy sourceId={1} fonteDisponivel startUs={0} endUs={duracaoCorteUs} poster={quadro1} modo="previa_9_16" enquadramento={enq}
              legenda={{ antes: 'e foi', ativa: 'EXATAMENTE', depois: 'ali que tudo mudou', estilo }} tempoAtualUs={tempoUs} reproduzindo={tocando}
              aoMudarTempoUs={setTempoUs} aoMudarReproduzindo={setTocando} refQuadro={quadro} className="h-full"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
            <Transporte tempoUs={tempoUs} duracaoUs={duracaoCorteUs} reproduzindo={tocando} mudo={mudo} aoAlternar={() => setTocando((v) => !v)}
              aoInicio={() => setTempoUs(0)} aoFim={() => setTempoUs(duracaoCorteUs)} aoAlternarMudo={() => setMudo((v) => !v)}
            />
            <BarraAcoes acoes={acoes} aberta={aberta} aoMudarAberta={setAberta} ancora={quadro} />
          </div>
        </main>
      </div>

      <TimelineEditor windowStartUs={0} windowEndUs={duracaoCorteUs} startUs={0} endUs={duracaoCorteUs} tempoAtualUs={tempoUs}
        thumbs={Array.from({ length: 12 }, () => quadro1)} waveValues={onda}
        silences={silencios.map((t) => ({ inicioUs: t.inicioUs, fimUs: t.fimUs, removido: removidos.has(t.id) }))}
        sentences={frasesTimeline} narracao={[{ inicioUs: 2_000_000, fimUs: 9_000_000, rotulo: 'Narração: abertura' }]}
        trilha={{ rotulo: 'Trilha: Noturno 02 · 18%', sfxUs: [12_800_000, 30_400_000] }}
        faixasExtrasAbertas={extras} aoAlternarFaixasExtras={() => setExtras((v) => !v)} aoMoverAgulha={(us) => setTempoUs(us)}
      />
      <Paleta aberto={paleta} aoMudarAberto={setPaleta} comandos={comandos} />
    </Tela>
  )
}
