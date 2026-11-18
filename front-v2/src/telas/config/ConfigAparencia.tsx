import {
  Botao,
  Busca,
  Campo,
  ConfirmDialog,
  Esqueleto,
  EstadoTela,
  Kbd,
  Segmentado,
  Select,
  Switch,
  TabelaGrade,
  cn,
  useToast,
  type ColunaGrade,
  type OpcaoSelect,
} from '@ds'
import { AlertCircle, Keyboard } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import {
  MAPA_ATALHOS_OFICIAL,
  detectarConflitoAtalho,
  ehAtalhoReservado,
  ehTeclaUnica,
  formatarEventoTeclado,
  formatarTecla,
  resolverTeclaExibida,
  substituirAtalho,
  type DefinicaoAtalho,
} from '~/comandos/atalhos'
import { aplicarPreferencias } from '~/preferencias/aplicarPreferencias'
import {
  usePreferencias,
  type ModoTeclasUnicas,
  type Preferencias,
} from '~/preferencias/preferencias'
import { ComEstado, useEstadoForcado } from '~/shell/EstadoForcado'
import { ConfiguracoesLayout } from '~/telas/config/ConfiguracoesLayout'

export type ConfigAparenciaProps = {
  projetoAberto: string | null
}

const OPCOES_TEMA: { valor: Preferencias['tema']; rotulo: string }[] = [
  { valor: 'escuro', rotulo: 'Escuro' },
  { valor: 'claro', rotulo: 'Claro' },
  { valor: 'sistema', rotulo: 'Seguir sistema' },
]

const OPCOES_ESCALA: { valor: '100' | '115'; rotulo: string }[] = [
  { valor: '100', rotulo: '100% (Padrão 13 px)' },
  { valor: '115', rotulo: '115% (Maior 15 px)' },
]

const OPCOES_IDIOMA: OpcaoSelect<Preferencias['idioma']>[] = [
  { valor: 'pt', rotulo: 'Português (Brasil)' },
  { valor: 'en', rotulo: 'English' },
]

const OPCOES_WCAG: { valor: ModoTeclasUnicas; titulo: string; detalhe: string }[] = [
  {
    valor: 'ativas',
    titulo: 'Ativos fora de campos de texto (padrão NLE)',
    detalhe: 'Espaço, J, K, L, I, O, A, R e ? funcionam fora de entradas de texto.',
  },
  {
    valor: 'alt',
    titulo: 'Exigir modificador Alt + tecla (evita disparos acidentais)',
    detalhe: 'Transforma teclas únicas em combinações com Alt.',
  },
  {
    valor: 'desligadas',
    titulo: 'Desligar todos os atalhos de tecla única (mantém Ctrl/Cmd e F6)',
    detalhe: 'Mantém apenas combinações com modificadores e teclas de função.',
  },
]

type ConflitoPendente = {
  idAlvo: string
  novaTecla: string
  conflito: DefinicaoAtalho
}

/** Tela de Configurações: Aparência, Acessibilidade de Teclado (WCAG 2.1.4) e Mapa de Atalhos (#/config/aparencia). */
export function ConfigAparencia({ projetoAberto }: ConfigAparenciaProps) {
  const [prefs, mudarPrefs] = usePreferencias()
  const toast = useToast()
  const forcado = useEstadoForcado()

  const [busca, setBusca] = useState('')
  const [capturandoId, setCapturandoId] = useState<string | null>(null)
  const [erroCaptura, setErroCaptura] = useState<string | null>(null)
  const [conflito, setConflito] = useState<ConflitoPendente | null>(null)
  const [confirmarRestaurarTodos, setConfirmarRestaurarTodos] = useState(false)

  const atualizarPrefs = useCallback(
    (parcial: Partial<Preferencias>) => {
      mudarPrefs(parcial)
      const proximo: Preferencias = {
        ...prefs,
        ...parcial,
        atalhos: parcial.atalhos !== undefined ? parcial.atalhos : prefs.atalhos,
      }
      if (parcial.modoTeclasUnicas !== undefined && parcial.teclasUnicas === undefined) {
        proximo.teclasUnicas = parcial.modoTeclasUnicas !== 'desligadas'
      }
      aplicarPreferencias(proximo)
    },
    [mudarPrefs, prefs],
  )

  useEffect(() => {
    aplicarPreferencias(prefs)
  }, [prefs])

  const comandoEmCaptura = useMemo(
    () => MAPA_ATALHOS_OFICIAL.find((c) => c.id === capturandoId) ?? null,
    [capturandoId],
  )

  useEffect(() => {
    if (!capturandoId) return

    const aoTeclar = (e: globalThis.KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setCapturandoId(null)
        setErroCaptura(null)
        return
      }

      const combinacao = formatarEventoTeclado(e)
      if (!combinacao) return

      if (ehAtalhoReservado(combinacao)) {
        setErroCaptura(
          `A combinação ${formatarTecla(combinacao)} é reservada pelo sistema operacional. Escolha outra tecla.`,
        )
        setConflito(null)
        return
      }

      const achado = detectarConflitoAtalho(
        capturandoId,
        combinacao,
        MAPA_ATALHOS_OFICIAL,
        prefs.atalhos,
      )
      if (achado) {
        setConflito({ idAlvo: capturandoId, novaTecla: combinacao, conflito: achado })
        setErroCaptura(null)
        setCapturandoId(null)
        return
      }

      atualizarPrefs({
        atalhos: { ...prefs.atalhos, [capturandoId]: combinacao },
      })
      setCapturandoId(null)
      setErroCaptura(null)
      setConflito(null)
    }

    window.addEventListener('keydown', aoTeclar, true)
    return () => window.removeEventListener('keydown', aoTeclar, true)
  }, [capturandoId, prefs.atalhos, atualizarPrefs])

  const iniciarCaptura = useCallback((id: string) => {
    setCapturandoId(id)
    setErroCaptura(null)
    setConflito(null)
  }, [])

  const cancelarCaptura = useCallback(() => {
    setCapturandoId(null)
    setErroCaptura(null)
  }, [])

  const restaurarItem = useCallback(
    (id: string) => {
      const proximo = { ...prefs.atalhos }
      delete proximo[id]
      atualizarPrefs({ atalhos: proximo })
      setConflito(null)
      setErroCaptura(null)
    },
    [prefs.atalhos, atualizarPrefs],
  )

  const confirmarSubstituicao = useCallback(() => {
    if (!conflito) return
    const proximo = substituirAtalho(
      prefs.atalhos,
      conflito.idAlvo,
      conflito.novaTecla,
      conflito.conflito.id,
    )
    atualizarPrefs({ atalhos: proximo })
    setConflito(null)
    setErroCaptura(null)
    toast.add({ title: 'Atalho atualizado.' })
  }, [conflito, prefs.atalhos, atualizarPrefs, toast])

  const restaurarTodos = useCallback(() => {
    atualizarPrefs({ atalhos: {}, modoTeclasUnicas: 'ativas' })
    setConfirmarRestaurarTodos(false)
    setCapturandoId(null)
    setConflito(null)
    setErroCaptura(null)
    toast.add({ title: 'Atalhos restaurados para o padrão.' })
  }, [atualizarPrefs, toast])

  const termo = busca.trim().toLowerCase()
  const atalhosFiltrados = useMemo(() => {
    if (!termo) return [...MAPA_ATALHOS_OFICIAL]
    return MAPA_ATALHOS_OFICIAL.filter((item) => {
      const teclaBase = Object.hasOwn(prefs.atalhos, item.id)
        ? prefs.atalhos[item.id]
        : item.tecla
      const teclaExibida = resolverTeclaExibida(teclaBase, prefs.modoTeclasUnicas, item.teclaUnica)
      const textoTecla = teclaExibida ? formatarTecla(teclaExibida).toLowerCase() : ''
      return (
        item.titulo.toLowerCase().includes(termo) ||
        item.escopo.toLowerCase().includes(termo) ||
        textoTecla.includes(termo)
      )
    })
  }, [termo, prefs.atalhos, prefs.modoTeclasUnicas])

  const colunas = useMemo<ColunaGrade<DefinicaoAtalho>[]>(
    () => [
      {
        id: 'escopo',
        titulo: 'Escopo',
        largura: '160px',
        render: (item) => <span className="text-pequeno text-t2">{item.escopo}</span>,
      },
      {
        id: 'acao',
        titulo: 'Ação',
        render: (item) => (
          <div className="flex flex-col">
            <span className="text-t1">{item.titulo}</span>
            {item.observacao && <span className="text-micro text-t3">{item.observacao}</span>}
          </div>
        ),
      },
      {
        id: 'atalho',
        titulo: 'Atalho',
        largura: '210px',
        render: (item) => {
          if (capturandoId === item.id) {
            return (
              <span className="inline-block rounded-controle bg-chao px-2 py-1 text-pequeno text-t1">
                Pressione a nova combinação… Esc para cancelar
              </span>
            )
          }
          const remapeado = Object.hasOwn(prefs.atalhos, item.id)
          const teclaBase = remapeado ? prefs.atalhos[item.id] : item.tecla
          const teclaEfetiva = resolverTeclaExibida(
            teclaBase,
            prefs.modoTeclasUnicas,
            item.teclaUnica,
          )
          if (!teclaEfetiva) {
            const desligadoWcag =
              Boolean(teclaBase) &&
              prefs.modoTeclasUnicas === 'desligadas' &&
              ehTeclaUnica({ teclaUnica: item.teclaUnica }, teclaBase)
            return (
              <span className="text-pequeno text-t3">
                {desligadoWcag ? 'Desligado (WCAG 2.1.4)' : 'Sem atalho'}
              </span>
            )
          }
          return <Kbd tom="normal">{formatarTecla(teclaEfetiva)}</Kbd>
        },
      },
      {
        id: 'acoes',
        titulo: 'Ações',
        largura: '210px',
        alinhar: 'dir',
        render: (item) => {
          const emCaptura = capturandoId === item.id
          const foiRemapeado = Object.hasOwn(prefs.atalhos, item.id)
          return (
            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
              {emCaptura ? (
                <Botao tamanho="p" variante="secundario" onClick={cancelarCaptura}>
                  Cancelar
                </Botao>
              ) : (
                <Botao
                  tamanho="p"
                  variante="secundario"
                  aria-label={`Remapear ${item.titulo}`}
                  onClick={() => iniciarCaptura(item.id)}
                >
                  Remapear
                </Botao>
              )}
              {foiRemapeado && (
                <Botao
                  tamanho="p"
                  variante="fantasma"
                  aria-label={`Restaurar padrão de ${item.titulo}`}
                  onClick={() => restaurarItem(item.id)}
                >
                  Restaurar padrão
                </Botao>
              )}
            </div>
          )
        },
      },
    ],
    [capturandoId, prefs.atalhos, prefs.modoTeclasUnicas, cancelarCaptura, iniciarCaptura, restaurarItem],
  )

  const aoTeclarWcag = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') {
      return
    }
    e.preventDefault()
    const i = OPCOES_WCAG.findIndex((o) => o.valor === prefs.modoTeclasUnicas)
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
    const prox = OPCOES_WCAG[(i + delta + OPCOES_WCAG.length) % OPCOES_WCAG.length]
    atualizarPrefs({ modoTeclasUnicas: prox.valor })
    const cont = e.currentTarget
    requestAnimationFrame(() => {
      ;(cont.querySelector(`[data-wcag="${prox.valor}"]`) as HTMLElement | null)?.focus()
    })
  }

  return (
    <ConfiguracoesLayout
      secao="aparencia"
      projetoAberto={projetoAberto}
      titulo="Aparência e Teclado"
      subtitulo="Tema, contraste, escala de texto, idioma e mapa completo de atalhos de teclado."
    >
      <ComEstado
        estado={forcado === 'carregando' ? 'carregando' : 'pronto'}
        carregando={<Esqueleto variante="formulario" quantidade={4} />}
      >
        <div className="flex flex-col gap-5">
          {/* 1. Visual e Idioma */}
          <section
            aria-labelledby="titulo-visual-idioma"
            className="flex max-w-[68ch] flex-col gap-4 rounded-area bg-area p-4"
          >
            <h2 id="titulo-visual-idioma" className="text-base font-forte text-t1">
              1. Visual e Idioma
            </h2>

            <div className="grid gap-3 sm:grid-cols-[170px_1fr] sm:items-center">
              <span className="text-pequeno text-t2">Tema</span>
              <Segmentado
                rotulo="Tema"
                valor={prefs.tema}
                aoMudar={(tema) => atualizarPrefs({ tema })}
                opcoes={OPCOES_TEMA}
                className="max-w-sm"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[170px_1fr] sm:items-center">
              <span className="text-pequeno text-t2">Alto Contraste</span>
              <Switch
                ligado={prefs.altoContraste}
                aoMudar={(altoContraste) => atualizarPrefs({ altoContraste })}
              >
                Modo Alto Contraste (bordas e texto ≥ 7:1)
              </Switch>
            </div>

            <div className="grid gap-3 sm:grid-cols-[170px_1fr] sm:items-center">
              <span className="text-pequeno text-t2">Escala da interface</span>
              <Segmentado
                rotulo="Escala da interface"
                valor={prefs.escala === 115 ? '115' : '100'}
                aoMudar={(v) => atualizarPrefs({ escala: v === '115' ? 115 : 100 })}
                opcoes={OPCOES_ESCALA}
                className="max-w-md"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[170px_1fr] sm:items-center">
              <span className="text-pequeno text-t2">Idioma</span>
              <div className="max-w-xs">
                <Campo rotulo="Idioma" className="[&_label]:sr-only">
                  {(props) => (
                    <Select
                      {...props}
                      rotulo="Idioma"
                      valor={prefs.idioma}
                      aoMudar={(idioma) => atualizarPrefs({ idioma })}
                      opcoes={OPCOES_IDIOMA}
                    />
                  )}
                </Campo>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[170px_1fr] sm:items-start">
              <span className="text-pequeno text-t2">Painéis e movimento</span>
              <div className="flex flex-col gap-1.5">
                <Switch
                  ligado={prefs.paineisSoPorClique}
                  aoMudar={(paineisSoPorClique) => atualizarPrefs({ paineisSoPorClique })}
                >
                  Abrir gavetas e painéis só por clique ou atalho
                </Switch>
                <p className="text-pequeno text-t3">
                  Animações respeitam automaticamente a preferência <code className="font-mono">prefers-reduced-motion</code> do sistema.
                </p>
              </div>
            </div>
          </section>

          {/* 2. Acessibilidade de Teclado (WCAG 2.1.4) */}
          <section
            aria-labelledby="titulo-wcag-teclado"
            className="flex max-w-[68ch] flex-col gap-3 rounded-area bg-area p-4"
          >
            <h2 id="titulo-wcag-teclado" className="text-base font-forte text-t1">
              2. Acessibilidade de Teclado (WCAG 2.1.4)
            </h2>
            <p className="text-pequeno text-t2">
              Atalhos de tecla única (<Kbd>Espaço</Kbd>, <Kbd>J</Kbd>, <Kbd>K</Kbd>, <Kbd>L</Kbd>,{' '}
              <Kbd>I</Kbd>, <Kbd>O</Kbd>, <Kbd>A</Kbd>, <Kbd>R</Kbd>, <Kbd>?</Kbd>):
            </p>
            <div
              role="radiogroup"
              aria-label="Modo de teclas únicas"
              onKeyDown={aoTeclarWcag}
              className="flex flex-col gap-1.5"
            >
              {OPCOES_WCAG.map((op) => {
                const selecionado = prefs.modoTeclasUnicas === op.valor
                return (
                  <button
                    key={op.valor}
                    type="button"
                    role="radio"
                    data-wcag={op.valor}
                    aria-checked={selecionado}
                    tabIndex={selecionado ? 0 : -1}
                    onClick={() => atualizarPrefs({ modoTeclasUnicas: op.valor })}
                    className={cn(
                      'foco flex cursor-pointer flex-col items-start gap-0.5 rounded-controle border-0 px-3 py-2 text-left transition-colors duration-(--dur-rapida) ease-saida',
                      selecionado
                        ? 'marcado bg-elevado text-t1'
                        : 'bg-chao/60 text-t2 hover:bg-hover hover:text-t1',
                    )}
                  >
                    <span className={cn('text-base', selecionado && 'font-medio text-t1')}>
                      {op.titulo}
                    </span>
                    <span className="text-pequeno text-t3">{op.detalhe}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* 3. Mapa de Atalhos */}
          <section aria-labelledby="titulo-mapa-atalhos" className="flex flex-col gap-3 rounded-area bg-area p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Keyboard className="size-4 text-t3" aria-hidden />
                <h2 id="titulo-mapa-atalhos" className="text-base font-forte text-t1">
                  3. Mapa de Atalhos
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Busca
                  rotulo="Buscar atalho"
                  placeholder="Buscar ação, escopo ou tecla…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="w-64"
                />
                <Botao
                  variante="secundario"
                  onClick={() => setConfirmarRestaurarTodos(true)}
                >
                  Restaurar padrões
                </Botao>
              </div>
            </div>

            <div role="status" aria-live="polite" className="sr-only">
              {comandoEmCaptura
                ? `Gravando atalho para ${comandoEmCaptura.titulo}. Pressione a nova tecla ou Esc para cancelar.`
                : ''}
            </div>

            {erroCaptura && (
              <div role="alert" className="flex items-start gap-2 rounded-controle bg-elevado px-3 py-2 text-pequeno text-erro">
                <AlertCircle className="mt-0.5 size-[14px] shrink-0" aria-hidden />
                <span>{erroCaptura}</span>
              </div>
            )}

            {conflito && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-controle bg-elevado px-3 py-2.5">
                <div className="flex items-start gap-2 text-pequeno">
                  <AlertCircle className="mt-0.5 size-[14px] shrink-0 text-erro" aria-hidden />
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medio text-t1">
                      Conflito de atalho no escopo {conflito.conflito.escopo}
                    </span>
                    <span className="text-t2">
                      A tecla <Kbd tom="forte">{formatarTecla(conflito.novaTecla)}</Kbd> já está
                      atribuída a &ldquo;{conflito.conflito.titulo}&rdquo;.
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Botao tamanho="p" variante="secundario" onClick={confirmarSubstituicao}>
                    Substituir
                  </Botao>
                  <Botao
                    tamanho="p"
                    variante="fantasma"
                    onClick={() => iniciarCaptura(conflito.idAlvo)}
                  >
                    Escolher outra tecla
                  </Botao>
                </div>
              </div>
            )}

            {atalhosFiltrados.length === 0 ? (
              <EstadoTela
                tipo="vazio"
                compacto
                titulo={`Nenhum atalho corresponde a '${busca.trim()}'.`}
                descricao="Tente buscar pelo nome da ação, escopo ou tecla."
                acaoPrimaria={{
                  rotulo: 'Limpar busca',
                  aoAcionar: () => setBusca(''),
                }}
              />
            ) : (
              <div className="overflow-x-auto">
                <TabelaGrade
                  rotulo="Mapa de atalhos de teclado"
                  linhas={atalhosFiltrados}
                  colunas={colunas}
                  obterId={(item) => item.id}
                />
              </div>
            )}
          </section>
        </div>
      </ComEstado>

      <ConfirmDialog
        aberto={confirmarRestaurarTodos}
        aoMudarAberto={setConfirmarRestaurarTodos}
        titulo="Restaurar todos os atalhos?"
        descricao="Todos os atalhos remapeados e o modo de teclas únicas voltarão para o padrão original do Clipes."
        rotuloCancelar="Cancelar"
        rotuloConfirmar="Restaurar padrões"
        variante="perigo"
        focoInicial="cancelar"
        aoConfirmar={restaurarTodos}
      />
    </ConfiguracoesLayout>
  )
}
