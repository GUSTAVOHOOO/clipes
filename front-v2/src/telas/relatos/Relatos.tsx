import {
  AreaTexto,
  BannerErroCore,
  Botao,
  Campo,
  Checkbox,
  cn,
  Entrada,
  Esqueleto,
  Status,
  useToast,
} from '@ds'
import { isTauri } from '@tauri-apps/api/core'
import { AlertTriangle, Check, ChevronRight, Copy, Download, ExternalLink, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { abrirUrlExterna, copiarTexto, salvarDialogo } from '~/core/desktop'
import { mensagemDeErro } from '~/core/erros'
import type { TipoRelato } from '~/rotas/rotas'
import { useEstadoForcado } from '~/shell/EstadoForcado'

export type RelatosProps = {
  tipoInicial?: TipoRelato
}

type SondaHardwareRegistro = {
  key: {
    gpu: string | null
    driver: string | null
    ct2_version: string | null
    model: string
    app_version: string
  }
  chosen: {
    device: string
    compute_type: string
  }
  verified: boolean
  attempts: Array<{
    device: string
    compute_type: string
    batch_size: number
    ok: boolean
  }>
  batch: {
    compute_type: string
    tested: Array<[number, boolean]>
    max_safe: number | null
    origin: string
    measured_at: number
  } | null
  vram_free_mib: number | null
  measured_at: number
  fallback_reason: string | null
}

type OpcaoTipoRelato = {
  valor: TipoRelato
  rotulo: string
  template: string
  incluirDiagnosticoPadrao: boolean
}

const OPCOES_TIPO: readonly OpcaoTipoRelato[] = [
  {
    valor: 'bug',
    rotulo: 'Relatar problema',
    template: 'bug.yml',
    incluirDiagnosticoPadrao: true,
  },
  {
    valor: 'ideia',
    rotulo: 'Sugerir ideia',
    template: 'ideia.yml',
    incluirDiagnosticoPadrao: false,
  },
  {
    valor: 'provedor',
    rotulo: 'Propor Provedor ou modelo',
    template: 'provedor-modelo.yml',
    incluirDiagnosticoPadrao: false,
  },
]

const URL_BASE_ISSUES = 'https://github.com/GUSTAVOHOOO/clipes/issues/new'
const URL_SECURITY_MD = 'https://github.com/GUSTAVOHOOO/clipes/blob/master/SECURITY.md'
const LIMITE_BYTES_URL = 8000
const REGEX_SEGREDO = /token|chave|\bkey\b/i

function bytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length
}

function montarUrlIssue(template: string, title: string, body: string): string {
  const params = new URLSearchParams({ template, title, body })
  return `${URL_BASE_ISSUES}?${params.toString()}`
}

function formatarResumoSonda(sonda: SondaHardwareRegistro): string {
  const gpu = sonda.key.gpu ?? 'CPU (sem GPU compatível)'
  const driver = sonda.key.driver ? `driver ${sonda.key.driver}` : 'sem driver'
  const ct2 = sonda.key.ct2_version ? `ct2=${sonda.key.ct2_version}` : 'ct2=indisponível'
  const lote = sonda.batch ? `max_safe=${sonda.batch.max_safe ?? 'nenhum'} (${sonda.batch.origin})` : 'lote não medido'
  const vram = sonda.vram_free_mib != null ? `${sonda.vram_free_mib} MiB livres` : 'VRAM n/d'
  const fallback = sonda.fallback_reason ? ` | fallback=${sonda.fallback_reason}` : ''
  return [
    '### Sonda de hardware (Transcrição)',
    `gpu: ${gpu} (${driver}) | ${ct2} | modelo=${sonda.key.model}`,
    `chosen: ${sonda.chosen.device}/${sonda.chosen.compute_type} (verified=${sonda.verified}) | ${lote} | ${vram}${fallback}`,
  ].join('\n')
}

function baixarArquivoTextoNavegador(nome: string, conteudo: string): void {
  if (typeof URL.createObjectURL !== 'function') return
  const blob = new Blob([conteudo], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = nome
  link.click()
  URL.revokeObjectURL(url)
}

const SELETOR_FOCAVEL =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'

function focarRegiao(alvo: HTMLElement): void {
  const candidatos = alvo.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL)
  for (const el of candidatos) {
    if (el.closest('[hidden], [aria-hidden="true"]')) continue
    const estilo = window.getComputedStyle(el)
    if (estilo.display === 'none' || estilo.visibility === 'hidden') continue
    el.focus()
    return
  }
  alvo.focus()
}

/**
 * Relatos e Diagnóstico (`#/relatos`, ADR-0006): sem telemetria automática,
 * fluxo obrigatório em 2 passos com edição livre antes de copiar, exportar ou abrir no GitHub.
 */
export function Relatos({ tipoInicial }: RelatosProps) {
  const toast = useToast()
  const forcado = useEstadoForcado()

  const tipoPadrao = tipoInicial ?? 'bug'
  const [tipo, setTipo] = useState<TipoRelato>(tipoPadrao)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [incluirDiagnostico, setIncluirDiagnostico] = useState(tipoPadrao === 'bug')
  const [emRevisao, setEmRevisao] = useState(false)

  const [diagnosticoTexto, setDiagnosticoTexto] = useState('')
  const [carregandoDiag, setCarregandoDiag] = useState(true)
  const [erroDiag, setErroDiag] = useState<ErroCore | null>(null)

  const [sonda, setSonda] = useState<SondaHardwareRegistro | null>(null)
  const [carregandoSonda, setCarregandoSonda] = useState(true)
  const [erroSonda, setErroSonda] = useState<ErroCore | null>(null)
  const [sondaAnexada, setSondaAnexada] = useState(false)

  const [erroAcao, setErroAcao] = useState<ErroCore | null>(null)
  const [erroUrlGrande, setErroUrlGrande] = useState(false)
  const [statusAcao, setStatusAcao] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)

  const colPrincipalRef = useRef<HTMLDivElement>(null)
  const asideHardwareRef = useRef<HTMLElement>(null)
  const regiaoFocoRef = useRef<{ prev: number; curr: number }>({ prev: -1, curr: -1 })

  useEffect(() => {
    const proximo = tipoInicial ?? 'bug'
    setTipo(proximo)
    setIncluirDiagnostico(proximo === 'bug')
    setEmRevisao(false)
    setErroAcao(null)
    setErroUrlGrande(false)
    setStatusAcao(null)
  }, [tipoInicial])

  const carregarDados = useCallback(async () => {
    setCarregandoDiag(true)
    setCarregandoSonda(true)
    setErroDiag(null)
    setErroSonda(null)

    const [resDiag, resSonda] = await Promise.allSettled([
      chamar<{ text: string }>('diagnostic.get', {}),
      chamar<SondaHardwareRegistro | null>('transcription.hardware.diagnostic', {}),
    ])

    if (resDiag.status === 'fulfilled') {
      setDiagnosticoTexto(resDiag.value?.text ?? '')
      setSondaAnexada(false)
    } else {
      setErroDiag(paraErroCore(resDiag.reason))
    }
    setCarregandoDiag(false)

    if (resSonda.status === 'fulfilled') {
      setSonda(resSonda.value ?? null)
    } else {
      setErroSonda(paraErroCore(resSonda.reason))
    }
    setCarregandoSonda(false)
  }, [])

  useEffect(() => {
    void carregarDados()
  }, [carregarDados])

  const recarregarDiagnostico = useCallback(async () => {
    setCarregandoDiag(true)
    setErroDiag(null)
    setErroAcao(null)
    try {
      const res = await chamar<{ text: string }>('diagnostic.get', {})
      setDiagnosticoTexto(res?.text ?? '')
      setSondaAnexada(false)
    } catch (erro) {
      setErroDiag(paraErroCore(erro))
    } finally {
      setCarregandoDiag(false)
    }
  }, [])

  const recarregarSonda = useCallback(async () => {
    setCarregandoSonda(true)
    setErroSonda(null)
    try {
      const res = await chamar<SondaHardwareRegistro | null>('transcription.hardware.diagnostic', {})
      setSonda(res ?? null)
    } catch (erro) {
      setErroSonda(paraErroCore(erro))
    } finally {
      setCarregandoSonda(false)
    }
  }, [])

  const escolherTipo = useCallback((proximo: TipoRelato) => {
    setTipo(proximo)
    setIncluirDiagnostico(proximo === 'bug')
    setEmRevisao(false)
    setErroAcao(null)
    setErroUrlGrande(false)
    setStatusAcao(null)
  }, [])

  const opcaoAtiva = useMemo(
    () => OPCOES_TIPO.find((o) => o.valor === tipo) ?? OPCOES_TIPO[0],
    [tipo],
  )

  const mencaoSegredo = useMemo(() => {
    const combinado = emRevisao ? `${titulo} ${descricao} ${diagnosticoTexto}` : `${titulo} ${descricao}`
    return REGEX_SEGREDO.test(combinado)
  }, [descricao, diagnosticoTexto, emRevisao, titulo])

  const textoCompleto = useMemo(() => {
    const partes = [descricao.trim()]
    if (incluirDiagnostico && diagnosticoTexto.trim()) {
      partes.push(`### Diagnóstico técnico (allowlist)\n${diagnosticoTexto.trim()}`)
    }
    return partes.filter(Boolean).join('\n\n')
  }, [descricao, diagnosticoTexto, incluirDiagnostico])

  const urlEstimada = useMemo(
    () => montarUrlIssue(opcaoAtiva.template, titulo.trim(), textoCompleto),
    [opcaoAtiva.template, textoCompleto, titulo],
  )
  const bytesUrlEstimada = useMemo(() => bytesUtf8(urlEstimada), [urlEstimada])

  const anexarResumoHardware = useCallback(() => {
    if (!sonda) return
    const bloco = formatarResumoSonda(sonda)
    setDiagnosticoTexto((atual) => {
      if (atual.includes('### Sonda de hardware (Transcrição)')) return atual
      return atual.trim() ? `${atual.trim()}\n\n${bloco}` : bloco
    })
    setIncluirDiagnostico(true)
    setSondaAnexada(true)
    setStatusAcao('Resumo da sonda de hardware anexado ao diagnóstico.')
  }, [sonda])

  const handleCopiarTexto = useCallback(
    async (conteudo: string) => {
      setErroAcao(null)
      const ok = await copiarTexto(conteudo)
      if (ok) {
        setStatusAcao('Texto copiado.')
        toast.add({ title: 'Texto copiado.' })
      } else {
        setErroAcao(new ErroCore('export_failed', 'Área de transferência indisponível.'))
      }
    },
    [toast],
  )

  const handleExportarDiagnostic = useCallback(async () => {
    setErroAcao(null)
    setExportando(true)
    try {
      const caminhoEscolhido = await salvarDialogo({
        title: 'Exportar diagnóstico técnico',
        defaultPath: 'diagnostico-clipes.txt',
        filters: [{ name: 'Arquivo de texto', extensions: ['txt'] }],
      })

      if (caminhoEscolhido === null && isTauri()) {
        return
      }

      const pathParaCore = caminhoEscolhido ?? '/mock/diagnostico-clipes.txt'
      await chamar('diagnostic.export', { path: pathParaCore, text: diagnosticoTexto })

      if (!isTauri() && caminhoEscolhido === null) {
        baixarArquivoTextoNavegador('diagnostico-clipes.txt', diagnosticoTexto)
      }

      setStatusAcao('Diagnóstico exportado em .txt.')
      toast.add({ title: 'Diagnóstico exportado.' })
    } catch (erro) {
      setErroAcao(paraErroCore(erro))
    } finally {
      setExportando(false)
    }
  }, [diagnosticoTexto, toast])

  const handleAbrirGitHub = useCallback(async () => {
    setErroAcao(null)
    setErroUrlGrande(false)

    const urlDireta = montarUrlIssue(opcaoAtiva.template, titulo.trim(), textoCompleto)
    if (bytesUtf8(urlDireta) <= LIMITE_BYTES_URL) {
      const res = await abrirUrlExterna(urlDireta)
      setStatusAcao(
        res.ok
          ? 'Abrindo issue pré-preenchida no GitHub.'
          : 'URL do GitHub copiada para a área de transferência.',
      )
      return
    }

    if (incluirDiagnostico && diagnosticoTexto.trim()) {
      await copiarTexto(diagnosticoTexto)
      const corpoComAviso = [
        descricao.trim(),
        'Diagnóstico copiado para a área de transferência — cole aqui.',
      ]
        .filter(Boolean)
        .join('\n\n')
      const urlSemDiag = montarUrlIssue(opcaoAtiva.template, titulo.trim(), corpoComAviso)

      if (bytesUtf8(urlSemDiag) <= LIMITE_BYTES_URL) {
        await abrirUrlExterna(urlSemDiag)
        setStatusAcao(
          'URL do GitHub excedeu 8.000 bytes: Diagnóstico copiado para a área de transferência — cole na issue aberta.',
        )
        toast.add({ title: 'Diagnóstico copiado para a área de transferência.' })
        return
      }
    }

    setErroUrlGrande(true)
  }, [descricao, diagnosticoTexto, incluirDiagnostico, opcaoAtiva.template, textoCompleto, titulo, toast])

  // Ciclo F6 incluindo painel auxiliar direito em 1440+ px durante o Passo 2
  useEffect(() => {
    if (!emRevisao) return

    const obterRegioes = (): HTMLElement[] => {
      const aside = asideHardwareRef.current
      if (!aside || window.getComputedStyle(aside).display === 'none') return []
      const topo = document.querySelector<HTMLElement>('[data-regiao="topo"]')
      const fila = document.querySelector<HTMLElement>('[data-regiao="fila"]')
      const rodape = document.querySelector<HTMLElement>('[data-regiao="rodape"]')
      return [topo, colPrincipalRef.current, aside, fila, rodape].filter(
        (el): el is HTMLElement => el !== null,
      )
    }

    const indiceDoElemento = (el: EventTarget | null, regioes: HTMLElement[]): number => {
      if (!(el instanceof Node)) return -1
      return regioes.findIndex((r) => r === el || r.contains(el))
    }

    const aoFocusIn = (e: FocusEvent) => {
      const regioes = obterRegioes()
      if (regioes.length === 0) return
      const idx = indiceDoElemento(e.target, regioes)
      if (idx >= 0) {
        regiaoFocoRef.current = { prev: regiaoFocoRef.current.curr, curr: idx }
      }
    }

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'F6' || e.ctrlKey || e.metaKey || e.altKey) return
      const temDialogoModal = Array.from(
        document.querySelectorAll('[role="dialog"], [role="alertdialog"]'),
      ).some((el) => !el.closest('[aria-label="Notifications"]'))
      if (temDialogoModal) return

      const regioes = obterRegioes()
      if (regioes.length === 0) return

      const idxAtual = e.defaultPrevented
        ? regiaoFocoRef.current.prev
        : indiceDoElemento(document.activeElement, regioes)

      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      const dir = e.shiftKey ? -1 : 1
      const proximoIdx =
        idxAtual < 0
          ? dir > 0
            ? 0
            : regioes.length - 1
          : (idxAtual + dir + regioes.length) % regioes.length

      focarRegiao(regioes[proximoIdx])
      regiaoFocoRef.current = { prev: proximoIdx, curr: proximoIdx }
    }

    document.addEventListener('focusin', aoFocusIn, true)
    window.addEventListener('keydown', aoTeclar, { capture: true })
    return () => {
      document.removeEventListener('focusin', aoFocusIn, true)
      window.removeEventListener('keydown', aoTeclar, { capture: true })
    }
  }, [emRevisao])

  const carregandoDiagExibido = forcado === 'carregando' || carregandoDiag
  const carregandoSondaExibida = forcado === 'carregando' || carregandoSonda
  const sondaExibida = forcado === 'vazio' ? null : sonda
  const erroSondaExibido =
    erroSonda ??
    (forcado === 'erro' ? new ErroCore('settings', 'Simulação via ?estado=erro.') : null)

  const traducaoErroAcao = erroAcao ? mensagemDeErro(erroAcao) : null
  const traducaoErroDiag = erroDiag ? mensagemDeErro(erroDiag) : null
  const traducaoErroSonda = erroSondaExibido ? mensagemDeErro(erroSondaExibido) : null

  const renderBlocoSonda = (modoCompacto: boolean) => {
    if (carregandoSondaExibida) {
      return <Esqueleto variante="linha" quantidade={2} rotuloAcessivel="Carregando sonda de hardware" />
    }
    if (erroSondaExibido && traducaoErroSonda) {
      return (
        <BannerErroCore
          erro={{ code: erroSondaExibido.code, message: erroSondaExibido.detalhe || erroSondaExibido.message }}
          traduzir={() => ({ titulo: traducaoErroSonda.titulo })}
          acaoRecuperacao={{ rotulo: 'Tentar novamente', aoAcionar: () => void recarregarSonda() }}
        />
      )
    }
    if (!sondaExibida) {
      return <p className="text-pequeno text-t3">Nenhuma sonda de hardware gravada ainda.</p>
    }
    return (
      <div className="flex flex-col gap-2">
        <dl className="m-0 grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1 text-pequeno">
          <dt className="text-t3">GPU / Driver</dt>
          <dd className="num m-0 text-t1">
            {sondaExibida.key.gpu ?? 'CPU (sem GPU compatível)'}
            {sondaExibida.key.driver ? ` · Driver ${sondaExibida.key.driver}` : ''}
          </dd>
          <dt className="text-t3">CT2 / Modelo</dt>
          <dd className="num m-0 text-t2">
            {sondaExibida.key.ct2_version ?? '—'} · {sondaExibida.key.model}
          </dd>
          <dt className="text-t3">Escolha verificada</dt>
          <dd className="num m-0 text-t1">
            {sondaExibida.chosen.device} / {sondaExibida.chosen.compute_type}{' '}
            ({sondaExibida.verified ? 'verificado' : 'não verificado'})
          </dd>
          <dt className="text-t3">Lote / VRAM livre</dt>
          <dd className="num m-0 text-t2">
            {sondaExibida.batch
              ? `lote seguro: ${sondaExibida.batch.max_safe ?? 'nenhum'} (${sondaExibida.batch.origin})`
              : 'lote não medido'}
            {' · '}
            {sondaExibida.vram_free_mib != null ? `${sondaExibida.vram_free_mib} MiB` : 'VRAM n/d'}
          </dd>
          {!modoCompacto && (
            <>
              <dt className="text-t3">Tentativas</dt>
              <dd className="num m-0 text-t2">
                {sondaExibida.attempts.length}{' '}
                {sondaExibida.attempts.length === 1 ? 'tentativa' : 'tentativas'}
                {sondaExibida.fallback_reason ? ` · fallback: ${sondaExibida.fallback_reason}` : ''}
              </dd>
            </>
          )}
        </dl>
        <div>
          <Botao
            tamanho="p"
            variante="secundario"
            onClick={anexarResumoHardware}
            disabled={sondaAnexada}
          >
            {sondaAnexada ? 'Resumo de hardware anexado' : 'Anexar resumo de hardware ao diagnóstico'}
          </Botao>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4">
      {!emRevisao ? (
        <section
          aria-labelledby="relatos-heading"
          className="mx-auto flex w-full max-w-[68ch] flex-col gap-4"
        >
          <header className="flex flex-col gap-1">
            <h1 id="relatos-heading" className="text-titulo font-forte tracking-[-0.01em] text-t1">
              Relatos e diagnóstico
            </h1>
            <p className="text-pequeno text-t2">
              Sem telemetria automática — nada sai da sua máquina sem você ler e editar antes. Funciona mesmo sem Projeto aberto.
            </p>
          </header>

          <div className="flex flex-col gap-1.5">
            <span id="relatos-tipo-label" className="text-pequeno text-t2">
              Tipo de envio
            </span>
            <div
              role="radiogroup"
              aria-labelledby="relatos-tipo-label"
              className="flex flex-wrap gap-1.5"
              onKeyDown={(e) => {
                if (
                  e.key !== 'ArrowRight' &&
                  e.key !== 'ArrowLeft' &&
                  e.key !== 'ArrowDown' &&
                  e.key !== 'ArrowUp'
                ) {
                  return
                }
                e.preventDefault()
                const idx = OPCOES_TIPO.findIndex((o) => o.valor === tipo)
                const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
                const prox = OPCOES_TIPO[(idx + delta + OPCOES_TIPO.length) % OPCOES_TIPO.length]
                escolherTipo(prox.valor)
                requestAnimationFrame(() => {
                  const ativo = e.currentTarget.querySelector<HTMLElement>('[aria-checked="true"]')
                  ativo?.focus()
                })
              }}
            >
              {OPCOES_TIPO.map((op) => {
                const selecionado = op.valor === tipo
                return (
                  <button
                    key={op.valor}
                    type="button"
                    role="radio"
                    aria-checked={selecionado}
                    tabIndex={selecionado ? 0 : -1}
                    onClick={() => escolherTipo(op.valor)}
                    className={cn(
                      'foco min-h-7 cursor-pointer rounded-controle border-0 px-3 py-1 text-pequeno transition-colors duration-(--dur-rapida) ease-saida',
                      selecionado
                        ? 'marcado bg-elevado font-medio text-t1 shadow-[inset_0_0_0_1px_var(--contorno-controle)]'
                        : 'bg-area text-t2 hover:bg-hover hover:text-t1',
                    )}
                  >
                    {op.rotulo}
                  </button>
                )
              })}
            </div>
          </div>

          <Campo rotulo="Título">
            {(props) => (
              <Entrada
                {...props}
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Resumo curto do problema, ideia ou Provedor"
              />
            )}
          </Campo>

          <Campo rotulo="Descrição">
            {(props) => (
              <AreaTexto
                {...props}
                rows={4}
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="O que você esperava, o que aconteceu e os passos para reproduzir..."
              />
            )}
          </Campo>

          {mencaoSegredo && (
            <div role="alert" className="flex items-start gap-2.5 rounded-area bg-area px-3 py-2.5 text-pequeno text-t1">
              <AlertTriangle className="mt-0.5 size-[15px] shrink-0 stroke-[1.75] text-erro" aria-hidden />
              <span>
                Atenção: seu texto menciona &quot;token&quot;, &quot;chave&quot; ou &quot;key&quot;. Nunca cole chaves de API ou segredos no relato.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-area bg-area p-3">
            <Checkbox marcado={incluirDiagnostico} aoMudar={setIncluirDiagnostico}>
              Incluir diagnóstico técnico local (allowlist)
            </Checkbox>
            <p className="text-pequeno text-t2">
              Entra apenas: versão, SO, GPU/encoder, Motor, Provedor, versão da Tarefa/hash do prompt, contexto efetivo e últimas ~200 linhas limpas de erro. Nunca entram: chaves, caminhos pessoais, nomes de Fontes, Transcrições ou Roteiros.
            </p>
            {carregandoDiagExibido && (
              <Esqueleto variante="linha" quantidade={2} rotuloAcessivel="Carregando diagnóstico local" />
            )}
            {erroDiag && traducaoErroDiag && (
              <BannerErroCore
                erro={{ code: erroDiag.code, message: erroDiag.detalhe || erroDiag.message }}
                traduzir={() => ({ titulo: traducaoErroDiag.titulo })}
                acaoRecuperacao={{ rotulo: 'Tentar novamente', aoAcionar: () => void recarregarDiagnostico() }}
              />
            )}
          </div>

          <details className="group rounded-area bg-area p-3">
            <summary className="foco flex min-h-6 cursor-pointer list-none items-center gap-1.5 rounded-controle text-pequeno font-medio text-t1 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                className="size-[14px] shrink-0 stroke-[1.75] text-t3 transition-transform duration-(--dur-base) ease-saida group-open:rotate-90"
                aria-hidden
              />
              Diagnóstico da sonda de hardware (Transcrição)
            </summary>
            <div className="mt-2.5">{renderBlocoSonda(true)}</div>
          </details>

          {statusAcao && (
            <div role="status" aria-live="polite" className="text-pequeno text-t2">
              <Status tom="sucesso">{statusAcao}</Status>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <Botao
              variante="primario"
              onClick={() => {
                setErroAcao(null)
                setErroUrlGrande(false)
                setEmRevisao(true)
              }}
            >
              Revisar relato antes de enviar
            </Botao>

            <a
              href={URL_SECURITY_MD}
              onClick={(e) => {
                e.preventDefault()
                void abrirUrlExterna(URL_SECURITY_MD)
              }}
              className="foco inline-flex min-h-6 items-center gap-1.5 rounded-controle px-1.5 text-pequeno text-t2 underline hover:text-t1"
            >
              <ShieldAlert className="size-[14px] shrink-0 stroke-[1.75]" aria-hidden />
              Reportar vulnerabilidade de segurança em privado
            </a>
          </div>
        </section>
      ) : (
        <div
          className={cn(
            'grid min-h-0 gap-4',
            'grid-cols-1 min-[1440px]:grid-cols-[3fr_2fr]',
          )}
        >
          <section
            ref={colPrincipalRef}
            tabIndex={-1}
            aria-labelledby="relatos-revisao-heading"
            className="foco-interno mx-auto flex w-full max-w-[68ch] flex-col gap-3 min-[1440px]:max-w-none"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <h1 className="text-titulo font-forte tracking-[-0.01em] text-t1">
                  Relatos e diagnóstico
                </h1>
                <h2 id="relatos-revisao-heading" className="text-base font-medio text-t1">
                  Revisar e editar relato antes de enviar
                </h2>
                <p className="text-pequeno text-t2">
                  Template: <span className="font-mono">{opcaoAtiva.template}</span> · Edite ou apague qualquer linha abaixo antes de copiar, exportar ou abrir no GitHub.
                </p>
              </div>
              <Status tom="info">Passo 2 de 2</Status>
            </header>

            {mencaoSegredo && (
              <div role="alert" className="flex items-start gap-2.5 rounded-area bg-area px-3 py-2.5 text-pequeno text-t1">
                <AlertTriangle className="mt-0.5 size-[15px] shrink-0 stroke-[1.75] text-erro" aria-hidden />
                <span>
                  Atenção: seu texto menciona &quot;token&quot;, &quot;chave&quot; ou &quot;key&quot;. Remova quaisquer credenciais antes de compartilhar.
                </span>
              </div>
            )}

            {incluirDiagnostico ? (
              <Campo
                rotulo="Diagnóstico técnico editável"
                extra={
                  <span className="num">
                    URL estimada: {bytesUrlEstimada} / {LIMITE_BYTES_URL} bytes UTF-8
                  </span>
                }
                ajuda="Nota (#300): quando há registros locais, o diagnóstico pode trazer &quot;Etapa da falha: componente&quot; por padrão — corrija ou apague qualquer linha antes de enviar."
              >
                {(props) => (
                  <AreaTexto
                    {...props}
                    rows={12}
                    value={diagnosticoTexto}
                    onChange={(e) => setDiagnosticoTexto(e.target.value)}
                    className="min-h-[240px] font-mono text-pequeno leading-relaxed"
                  />
                )}
              </Campo>
            ) : (
              <div className="flex flex-col gap-2 rounded-area bg-area p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-pequeno font-medio text-t1">
                    Pré-visualização do relato (sem diagnóstico técnico)
                  </span>
                  <span className="num text-pequeno text-t3">
                    URL estimada: {bytesUrlEstimada} / {LIMITE_BYTES_URL} bytes UTF-8
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-pequeno text-t2">
                  {textoCompleto || 'Sem descrição preenchida.'}
                </p>
              </div>
            )}

            {erroAcao && traducaoErroAcao && (
              <BannerErroCore
                erro={{ code: erroAcao.code, message: erroAcao.detalhe || erroAcao.message }}
                traduzir={() => ({
                  titulo:
                    erroAcao.code === 'export_failed'
                      ? 'Não foi possível gravar o arquivo de diagnóstico na pasta escolhida.'
                      : traducaoErroAcao.titulo,
                })}
                acaoRecuperacao={
                  erroAcao.code === 'invalid_path'
                    ? { rotulo: 'Escolher destino novamente', aoAcionar: () => void handleExportarDiagnostic() }
                    : erroAcao.code === 'invalid_text'
                      ? { rotulo: 'Recarregar diagnóstico padrão', aoAcionar: () => void recarregarDiagnostico() }
                      : erroAcao.code === 'export_failed'
                        ? { rotulo: 'Tentar outra pasta', aoAcionar: () => void handleExportarDiagnostic() }
                        : undefined
                }
                acaoSecundaria={
                  erroAcao.code === 'export_failed'
                    ? {
                        rotulo: 'Copiar texto para área de transferência',
                        aoAcionar: () => void handleCopiarTexto(diagnosticoTexto || textoCompleto),
                      }
                    : undefined
                }
              />
            )}

            {erroUrlGrande && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-area bg-area px-3 py-2.5">
                <p className="text-pequeno text-erro">
                  O texto está grande demais para abrir direto na URL do navegador. Copie o texto completo e cole na nova issue.
                </p>
                <div className="flex items-center gap-2">
                  <Botao tamanho="p" variante="secundario" onClick={() => void handleCopiarTexto(textoCompleto)}>
                    Copiar texto completo
                  </Botao>
                  <a
                    href={`${URL_BASE_ISSUES}?template=${encodeURIComponent(opcaoAtiva.template)}`}
                    onClick={(e) => {
                      e.preventDefault()
                      void abrirUrlExterna(`${URL_BASE_ISSUES}?template=${encodeURIComponent(opcaoAtiva.template)}`)
                    }}
                    className="foco inline-flex min-h-6 items-center rounded-controle px-1.5 text-pequeno text-t2 underline hover:text-t1"
                  >
                    Abrir issue em branco
                  </a>
                </div>
              </div>
            )}

            {statusAcao && (
              <div role="status" aria-live="polite" className="flex items-center gap-1.5 text-pequeno text-t2">
                <Check className="size-[13px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
                <span>{statusAcao}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Botao
                variante="fantasma"
                onClick={() => {
                  setEmRevisao(false)
                  setErroAcao(null)
                  setErroUrlGrande(false)
                }}
              >
                Voltar para editar
              </Botao>

              <div className="flex flex-wrap items-center gap-2">
                <Botao
                  variante="secundario"
                  icone={<Copy />}
                  onClick={() => void handleCopiarTexto(textoCompleto)}
                >
                  Copiar texto
                </Botao>
                <Botao
                  variante="secundario"
                  icone={<Download />}
                  carregando={exportando}
                  onClick={() => void handleExportarDiagnostic()}
                >
                  Exportar diagnóstico (.txt)
                </Botao>
                <Botao
                  variante="primario"
                  icone={<ExternalLink />}
                  onClick={() => void handleAbrirGitHub()}
                >
                  Abrir no GitHub
                </Botao>
              </div>
            </div>
          </section>

          <aside
            ref={asideHardwareRef}
            tabIndex={-1}
            aria-label="Sonda de hardware e allowlist"
            className="foco-interno hidden flex-col gap-3 rounded-area bg-area p-4 min-[1440px]:flex"
          >
            <h2 className="text-base font-medio text-t1">Sonda de hardware e Allowlist</h2>
            <div className="flex flex-col gap-1.5 rounded-area bg-elevado p-3 text-pequeno">
              <strong className="font-medio text-t1">O que entra e o que nunca entra (ADR-0006)</strong>
              <p className="text-t2">
                <strong className="font-medio text-t1">Entra:</strong> versão do Clipes, SO, GPU/encoder, Motor, Provedor, versão da Tarefa/hash do prompt, contexto efetivo e últimas ~200 linhas limpas de erro.
              </p>
              <p className="text-t2">
                <strong className="font-medio text-t1">Nunca entra:</strong> chaves de API, caminhos pessoais do disco, nomes de Fontes, textos de Transcrição ou Roteiros.
              </p>
            </div>
            <div className="flex flex-col gap-2 rounded-area bg-elevado p-3">
              <strong className="text-pequeno font-medio text-t1">Resumo técnico da sonda de hardware</strong>
              {renderBlocoSonda(false)}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
