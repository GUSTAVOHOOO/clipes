import {
  Abas,
  BannerErroCore,
  Botao,
  Busca,
  ConfirmDialog,
  Esqueleto,
  Progresso,
  Status,
  type Aba,
} from '@ds'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import licenseText from '../../../../LICENSE?raw'
import noticesText from '../../../../THIRD_PARTY_NOTICES.md?raw'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'
import { abrirUrlExterna } from '~/core/desktop'
import { useFila, type Fila } from '~/core/progresso'
import { operacoesCriticasEmVoo } from '~/shell/FechamentoJanela'
import { useEstadoForcado } from '~/shell/EstadoForcado'
import { storeAtualizador, useAtualizador, type StoreAtualizador } from '~/stores/atualizador'

export type SobreProps = {
  store?: StoreAtualizador
  fila?: Fila
}

type AbaLegal = 'licenca' | 'atribuicoes'

const ABAS_LEGAIS: Aba<AbaLegal>[] = [
  { valor: 'licenca', rotulo: 'Licença do Clipes (Apache-2.0)' },
  { valor: 'atribuicoes', rotulo: 'Atribuições de terceiros' },
]

const URL_REPOSITORIO = 'https://github.com/GUSTAVOHOOO/clipes'

function filtrarAtribuicoes(texto: string, termo: string): string | null {
  const consulta = termo.trim().toLowerCase()
  if (!consulta) return texto
  const blocos = texto.split(/\n(?=##\s+)/)
  const correspondentes = blocos.filter((bloco) => bloco.toLowerCase().includes(consulta))
  if (correspondentes.length === 0) return null
  return correspondentes.join('\n\n')
}

/**
 * Sobre e Atualizações (`#/sobre`): versão instalada (`app.version`),
 * verificador/instalador explícito de atualizações assinadas (US-16/17/121, #291)
 * e visualização acessível de `LICENSE` e `THIRD_PARTY_NOTICES.md`.
 */
export function Sobre({ store = storeAtualizador, fila }: SobreProps) {
  const forcado = useEstadoForcado()
  const jobs = useFila(fila)
  const atualizador = useAtualizador({ store, fila })

  const [versao, setVersao] = useState<string | null>(null)
  const [carregandoVersao, setCarregandoVersao] = useState(true)
  const [erroVersao, setErroVersao] = useState<ErroCore | null>(null)

  const [abaAtiva, setAbaAtiva] = useState<AbaLegal>('licenca')
  const [termoBusca, setTermoBusca] = useState('')
  const [confirmarReinicioAberto, setConfirmarReinicioAberto] = useState(false)

  const carregarVersao = useCallback(async () => {
    setCarregandoVersao(true)
    setErroVersao(null)
    try {
      const res = await chamar<{ version: string }>('app.version', {})
      setVersao(res?.version ?? '0.1.0')
    } catch (erro) {
      setErroVersao(paraErroCore(erro))
    } finally {
      setCarregandoVersao(false)
    }
  }, [])

  useEffect(() => {
    void carregarVersao()
  }, [carregarVersao])

  useEffect(() => {
    if (atualizador.reinicioPendentePorJobs) {
      setConfirmarReinicioAberto(true)
    }
  }, [atualizador.reinicioPendentePorJobs])

  const criticosEmVoo = useMemo(() => {
    if (atualizador.jobsCriticosEmVoo.length > 0) return atualizador.jobsCriticosEmVoo
    return operacoesCriticasEmVoo(jobs)
  }, [atualizador.jobsCriticosEmVoo, jobs])

  const handleReiniciar = useCallback(() => {
    if (operacoesCriticasEmVoo(jobs).length > 0 || atualizador.jobsCriticosEmVoo.length > 0) {
      setConfirmarReinicioAberto(true)
      return
    }
    void atualizador.reiniciarParaAplicar()
  }, [atualizador, jobs])

  const atribuicoesFiltradas = useMemo(
    () => filtrarAtribuicoes(noticesText, termoBusca),
    [termoBusca],
  )

  const carregandoVersaoExibido = forcado === 'carregando' || carregandoVersao
  const erroVersaoExibido =
    erroVersao ??
    (forcado === 'erro' ? new ErroCore('desconhecido', 'Simulação via ?estado=erro.') : null)
  const offlineExibido = forcado === 'offline' || atualizador.status === 'offline'

  const versaoExibida = versao ?? atualizador.versaoAtual

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[82ch] flex-col gap-4">
      {/* Zona 1: Identidade e Versão */}
      <section aria-labelledby="sobre-heading" className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 id="sobre-heading" className="text-titulo font-forte tracking-[-0.01em] text-t1">
            Sobre e atualizações
          </h1>
          <p className="text-pequeno text-t2">Clipes — Gerador local e open source de Cortes</p>
          {carregandoVersaoExibido ? (
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-pequeno text-t2">Versão instalada:</span>
              <div className="w-24">
                <Esqueleto variante="linha" rotuloAcessivel="Carregando versão instalada" />
              </div>
            </div>
          ) : erroVersaoExibido ? (
            <div className="mt-1">
              <BannerErroCore
                erro={{
                  code: erroVersaoExibido.code,
                  message: erroVersaoExibido.detalhe || erroVersaoExibido.message,
                }}
                traduzir={() => ({ titulo: 'Não foi possível carregar a versão instalada.' })}
                acaoRecuperacao={{
                  rotulo: 'Tentar novamente',
                  aoAcionar: () => void carregarVersao(),
                }}
              />
            </div>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-pequeno text-t2">
              <span>
                Versão instalada: <strong className="num font-medio text-t1">{versaoExibida}</strong>
              </span>
              <span aria-hidden>·</span>
              <span>
                Licença: <strong className="font-medio text-t1">Apache-2.0</strong>
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Botao
            tamanho="p"
            variante="fantasma"
            icone={<ExternalLink />}
            onClick={() => void abrirUrlExterna(URL_REPOSITORIO)}
          >
            Repositório GitHub
          </Botao>
          <a
            href="#/relatos"
            className="foco inline-flex h-6 items-center rounded-controle bg-elevado px-2 text-pequeno text-t1 shadow-[inset_0_0_0_1px_var(--contorno-controle)] hover:bg-hover"
          >
            Relatar problema ou ideia
          </a>
        </div>
      </section>

      {/* Zona 2: Atualizações do aplicativo */}
      <section aria-label="Atualizações do aplicativo" className="flex flex-col gap-3 rounded-area bg-area p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-medio text-t1">Atualizações assinadas via GitHub Releases</h2>
          <Status tom="info">Nunca instala sem sua confirmação</Status>
        </div>

        {offlineExibido ? (
          <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-pequeno text-t2">
              Você está offline. Conecte-se à internet para verificar atualizações.
            </p>
            <Botao
              variante="primario"
              icone={<RefreshCw />}
              onClick={() => void atualizador.verificar()}
            >
              Verificar atualizações
            </Botao>
          </div>
        ) : atualizador.status === 'checking' ? (
          <div role="status" aria-live="polite" className="flex items-center gap-2">
            <Status tom="rodando">Verificando atualizações assinadas…</Status>
          </div>
        ) : atualizador.status === 'available' && atualizador.atualizacao && !atualizador.signature ? (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-base font-medio text-t1">
                Nova versão disponível:{' '}
                <span className="num">
                  {atualizador.atualizacao.currentVersion} → {atualizador.atualizacao.version}
                </span>
              </p>
              {atualizador.atualizacao.date && (
                <span className="num text-pequeno text-t3">{atualizador.atualizacao.date}</span>
              )}
            </div>
            {atualizador.atualizacao.body && (
              <div className="rounded-controle bg-elevado p-2.5 text-pequeno text-t2">
                <p className="font-medio text-t1">Notas da versão:</p>
                <p className="mt-1 whitespace-pre-wrap">{atualizador.atualizacao.body}</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Botao variante="primario" onClick={() => void atualizador.instalar()}>
                Baixar e instalar {atualizador.atualizacao.version}
              </Botao>
              <Botao variante="secundario" onClick={atualizador.adiar}>
                Lembrar depois
              </Botao>
            </div>
          </div>
        ) : atualizador.status === 'installing' ? (
          <div role="status" aria-live="polite" className="flex flex-col gap-1.5">
            <Progresso
              valor={null}
              rotulo={`Baixando e verificando assinatura da versão ${atualizador.atualizacao?.version ?? ''}…`}
            />
            <p className="text-pequeno text-t3">
              O app será reiniciado ao concluir (se houver jobs ativos na Fila, exibe confirmação antes de reiniciar).
            </p>
          </div>
        ) : atualizador.status === 'installed' ? (
          <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3">
            <Status tom="sucesso" forte>
              Atualização instalada. Reinicie para aplicar.
            </Status>
            <Botao variante="primario" onClick={handleReiniciar}>
              Reiniciar para aplicar
            </Botao>
          </div>
        ) : atualizador.status === 'error' ? (
          <BannerErroCore
            erro={{
              code: atualizador.signature
                ? 'invalid-signature'
                : atualizador.conectividade
                  ? 'network'
                  : 'updater_error',
              message: atualizador.erro ?? 'Falha ao consultar ou aplicar atualização.',
            }}
            traduzir={() => ({
              titulo: atualizador.signature
                ? 'A verificação de assinatura digital desta atualização falhou. Instalação bloqueada por segurança.'
                : atualizador.conectividade
                  ? 'Sem conexão ou servidor indisponível para verificar atualizações.'
                  : 'Não foi possível verificar atualizações neste momento.',
            })}
            acaoRecuperacao={{
              rotulo: 'Tentar novamente',
              aoAcionar: () => void atualizador.verificar(),
            }}
          />
        ) : (
          <div role="status" aria-live="polite" className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-pequeno text-t2">
              {atualizador.verificado
                ? `Você está usando a versão mais recente (${versaoExibida}).`
                : 'Nenhuma verificação automática em segundo plano foi iniciada nesta sessão.'}
            </p>
            <Botao
              variante="primario"
              icone={<RefreshCw />}
              onClick={() => void atualizador.verificar()}
            >
              Verificar atualizações
            </Botao>
          </div>
        )}

        <p className="border-t border-linha pt-2.5 text-pequeno text-t3">
          FFmpeg, yt-dlp, Worker Python e modelos de transcrição/TTS são atualizados separadamente em{' '}
          <a href="#/config/componentes" className="foco text-t2 underline hover:text-t1">
            Componentes e Armazenamento
          </a>
          .
        </p>
      </section>

      {/* Zona 3: Licenças e Atribuições */}
      <section aria-label="Licenças e Atribuições" className="flex min-h-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Abas
            rotulo="Documentos legais"
            valor={abaAtiva}
            aoMudar={setAbaAtiva}
            abas={ABAS_LEGAIS}
          />
          {abaAtiva === 'atribuicoes' && (
            <Busca
              rotulo="Buscar biblioteca ou componente"
              placeholder="Buscar biblioteca ou componente..."
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              className="w-64"
            />
          )}
        </div>

        <div role="tabpanel" className="flex min-h-0 flex-1 flex-col">
          {abaAtiva === 'atribuicoes' && atribuicoesFiltradas === null ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-area bg-area p-6 text-center">
              <p className="text-base text-t1">
                Nenhuma atribuição encontrada para &quot;{termoBusca.trim()}&quot;.
              </p>
              <Botao variante="secundario" onClick={() => setTermoBusca('')}>
                Limpar busca
              </Botao>
            </div>
          ) : (
            <pre
              tabIndex={0}
              aria-label={
                abaAtiva === 'licenca'
                  ? 'Texto integral da licença Apache-2.0'
                  : 'Atribuições de terceiros'
              }
              className="foco m-0 min-h-[160px] flex-1 overflow-auto rounded-area bg-area p-3 font-mono text-pequeno leading-relaxed whitespace-pre-wrap break-words text-t2"
            >
              {abaAtiva === 'licenca' ? licenseText : (atribuicoesFiltradas ?? noticesText)}
            </pre>
          )}
        </div>
      </section>

      <ConfirmDialog
        aberto={confirmarReinicioAberto}
        aoMudarAberto={setConfirmarReinicioAberto}
        titulo="Reiniciar o Clipes com operações em andamento?"
        descricao="Downloads globais e exportações em andamento serão interrompidos; tarefas locais retornam para a fila ao reabrir o Projeto; chamadas a Provedores em andamento ficarão como resultado incerto para sua decisão."
        rotuloCancelar="Continuar trabalhando"
        rotuloConfirmar="Reiniciar mesmo assim"
        variante="perigo"
        focoInicial="cancelar"
        aoConfirmar={async () => {
          setConfirmarReinicioAberto(false)
          await atualizador.reiniciarParaAplicar()
        }}
      >
        {criticosEmVoo.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-1.5 rounded-area bg-area px-3 py-2 text-pequeno text-t2">
            {criticosEmVoo.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{item.mensagem || item.etapa}</span>
                <span className="num shrink-0 text-t3">{Math.round(item.percentual)}%</span>
              </li>
            ))}
          </ul>
        )}
      </ConfirmDialog>
    </div>
  )
}
