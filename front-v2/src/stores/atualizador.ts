import { getVersion } from '@tauri-apps/api/app'
import { Channel, invoke, isTauri } from '@tauri-apps/api/core'
import { useMemo, useSyncExternalStore } from 'react'
import { getUpdaterBehavior, relaunchApp } from '~/core/desktop'
import { useFila, type Fila, type Job } from '~/core/progresso'
import { operacoesCriticasEmVoo } from '~/shell/FechamentoJanela'
import {
  errorReason,
  formatUpdateError,
  isConnectivityError,
  isSignatureOrIntegrityError,
  shouldIgnoreAutoCheckError,
} from '../../../src/features/updates/updateError'

export type StatusAtualizador =
  | 'idle'
  | 'checking'
  | 'available'
  | 'installing'
  | 'installed'
  | 'error'
  | 'offline'

export type AtualizacaoDisponivel = {
  version: string
  currentVersion: string
  date?: string
  body?: string
  rid?: number
  downloadAndInstall: () => Promise<void>
}

export type EstadoAtualizador = {
  status: StatusAtualizador
  versaoAtual: string
  atualizacao: AtualizacaoDisponivel | null
  erro: string | null
  signature: boolean
  conectividade: boolean
  verificado: boolean
  reinicioPendentePorJobs: boolean
  jobsCriticosEmVoo: Job[]
}

export type OpcoesVerificarAtualizacao = {
  automatico?: boolean
}

export type OpcoesInstalarAtualizacao = {
  jobsEmVoo?: readonly Job[]
  forcarReinicio?: boolean
}

export type StoreAtualizador = {
  estado: () => EstadoAtualizador
  assinar: (fn: () => void) => () => void
  verificar: (opcoes?: OpcoesVerificarAtualizacao) => Promise<AtualizacaoDisponivel | null>
  instalar: (opcoes?: OpcoesInstalarAtualizacao) => Promise<void>
  reiniciarParaAplicar: () => Promise<void>
  adiar: () => void
}

type MetadadosUpdaterTauri = {
  rid: number
  currentVersion: string
  version: string
  date?: string
  body?: string
}

const MENSAGEM_ASSINATURA_INVALIDA =
  'A verificação de assinatura digital desta atualização falhou. Instalação bloqueada por segurança.'

function lerCenarioUpdater(): string | null {
  if (typeof location === 'undefined') return null
  const hash = location.hash ?? ''
  const qIdx = hash.indexOf('?')
  if (qIdx >= 0) {
    const v = new URLSearchParams(hash.slice(qIdx + 1)).get('updater-test')
    if (v) return v
  }
  return new URLSearchParams(location.search).get('updater-test')
}

async function lerVersaoAtual(): Promise<string> {
  if (isTauri()) {
    try {
      return await getVersion()
    } catch {
      return '1.0.0'
    }
  }
  return '1.0.0'
}

/**
 * Store compartilhado do atualizador do aplicativo (US-16/US-17/US-121),
 * mantendo o endpoint configurado em `src-tauri/tauri.conf.json` sem instalação automática
 * e checando `operacoesCriticasEmVoo` (#291) antes de reiniciar.
 */
export function criarStoreAtualizador(): StoreAtualizador {
  let atual: EstadoAtualizador = {
    status: 'idle',
    versaoAtual: '1.0.0',
    atualizacao: null,
    erro: null,
    signature: false,
    conectividade: false,
    verificado: false,
    reinicioPendentePorJobs: false,
    jobsCriticosEmVoo: [],
  }
  const ouvintes = new Set<() => void>()

  function publicar(proximo: EstadoAtualizador) {
    atual = proximo
    for (const fn of ouvintes) {
      fn()
    }
  }

  function atualizar(patch: Partial<EstadoAtualizador>) {
    publicar({ ...atual, ...patch })
  }

  async function verificar(
    opcoes?: OpcoesVerificarAtualizacao,
  ): Promise<AtualizacaoDisponivel | null> {
    const automatico = Boolean(opcoes?.automatico)
    const versaoAtual = await lerVersaoAtual()
    const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false

    if (!online) {
      if (automatico) {
        atualizar({
          status: 'idle',
          versaoAtual,
          erro: null,
          signature: false,
          conectividade: true,
        })
        return null
      }
      atualizar({
        status: 'offline',
        versaoAtual,
        atualizacao: null,
        erro: null,
        signature: false,
        conectividade: true,
        verificado: true,
      })
      return null
    }

    const scenario = lerCenarioUpdater()
    const behavior = scenario ? 'mock-available' : getUpdaterBehavior()

    if (behavior === 'off') {
      atualizar({
        status: 'idle',
        versaoAtual,
        atualizacao: null,
        erro: null,
        signature: false,
        conectividade: false,
        verificado: !automatico,
      })
      return null
    }

    atualizar({
      status: 'checking',
      versaoAtual,
      erro: null,
      signature: false,
      conectividade: false,
      reinicioPendentePorJobs: false,
    })

    try {
      let disponivel: AtualizacaoDisponivel | null = null

      if (behavior === 'mock-available') {
        if (scenario === 'offline') {
          throw new Error(
            'error sending request for url (https://github.com/GUSTAVOHOOO/clipes/releases/latest/download/latest.json): client error (Connect)',
          )
        }
        if (scenario === 'release-not-found') {
          throw new Error('Could not fetch a valid release JSON from the remote')
        }
        if (scenario === 'invalid-signature') {
          throw new Error('The signature verification failed')
        }
        const jaInstalado =
          typeof sessionStorage !== 'undefined' &&
          sessionStorage.getItem('clipes.mock-update-installed') === '1'
        if (!jaInstalado) {
          disponivel = {
            version: '0.2.0',
            currentVersion: versaoAtual,
            date: '2026-11-13T00:00:00Z',
            body: 'Novidades de teste',
            downloadAndInstall: async () => {
              if (scenario === 'install-invalid-signature') {
                throw new Error('The signature verification failed')
              }
              if (scenario === 'install-network-error') {
                throw new Error(
                  'error sending request for url (https://github.com/GUSTAVOHOOO/clipes/releases/download/v0.2.0/clipes.exe)',
                )
              }
            },
          }
        }
      } else {
        const meta = await invoke<MetadadosUpdaterTauri | null>('plugin:updater|check')
        if (meta) {
          disponivel = {
            rid: meta.rid,
            version: meta.version,
            currentVersion: meta.currentVersion || versaoAtual,
            date: meta.date,
            body: meta.body,
            downloadAndInstall: async () => {
              const channel = new Channel()
              await invoke('plugin:updater|download_and_install', {
                onEvent: channel,
                rid: meta.rid,
              })
            },
          }
        }
      }

      if (disponivel) {
        atualizar({
          status: 'available',
          versaoAtual,
          atualizacao: disponivel,
          erro: null,
          signature: false,
          conectividade: false,
          verificado: true,
        })
        return disponivel
      }

      atualizar({
        status: 'idle',
        versaoAtual,
        atualizacao: null,
        erro: null,
        signature: false,
        conectividade: false,
        verificado: true,
      })
      return null
    } catch (err) {
      if (automatico && shouldIgnoreAutoCheckError(err)) {
        atualizar({
          status: 'idle',
          versaoAtual,
          atualizacao: null,
          erro: null,
          signature: false,
          conectividade: false,
        })
        return null
      }

      const signature = isSignatureOrIntegrityError(err)
      const conectividade = isConnectivityError(err)
      atualizar({
        status: 'error',
        versaoAtual,
        atualizacao: null,
        erro: signature ? formatUpdateError(err, MENSAGEM_ASSINATURA_INVALIDA) : errorReason(err),
        signature,
        conectividade,
        verificado: true,
      })
      return null
    }
  }

  async function instalar(opcoes?: OpcoesInstalarAtualizacao): Promise<void> {
    if (atual.status !== 'available' || atual.signature || !atual.atualizacao) return
    const alvo = atual.atualizacao
    const scenario = lerCenarioUpdater()
    const modoMock = Boolean(scenario) || getUpdaterBehavior() === 'mock-available'

    atualizar({
      status: 'installing',
      erro: null,
      signature: false,
      conectividade: false,
    })

    try {
      await alvo.downloadAndInstall()

      if (modoMock) {
        try {
          sessionStorage.setItem('clipes.mock-update-installed', '1')
        } catch {
          // sessionStorage indisponível
        }
        atualizar({
          status: 'installed',
          erro: null,
          signature: false,
          conectividade: false,
        })
        return
      }

      const criticos = operacoesCriticasEmVoo(opcoes?.jobsEmVoo ?? [])
      if (criticos.length > 0 && !opcoes?.forcarReinicio) {
        atualizar({
          status: 'installed',
          reinicioPendentePorJobs: true,
          jobsCriticosEmVoo: criticos,
        })
        return
      }

      atualizar({
        status: 'installed',
        reinicioPendentePorJobs: false,
        jobsCriticosEmVoo: [],
      })
      await relaunchApp()
    } catch (err) {
      const signature = isSignatureOrIntegrityError(err)
      const conectividade = isConnectivityError(err)
      atualizar({
        status: 'error',
        atualizacao: signature ? null : alvo,
        erro: signature ? formatUpdateError(err, MENSAGEM_ASSINATURA_INVALIDA) : errorReason(err),
        signature,
        conectividade,
      })
    }
  }

  async function reiniciarParaAplicar(): Promise<void> {
    atualizar({ reinicioPendentePorJobs: false, jobsCriticosEmVoo: [] })
    await relaunchApp()
  }

  function adiar(): void {
    atualizar({
      status: 'idle',
      erro: null,
      reinicioPendentePorJobs: false,
    })
  }

  return {
    estado: () => atual,
    assinar: (fn) => {
      ouvintes.add(fn)
      return () => ouvintes.delete(fn)
    },
    verificar,
    instalar,
    reiniciarParaAplicar,
    adiar,
  }
}

export const storeAtualizador = criarStoreAtualizador()

export type ResultadoUseAtualizador = EstadoAtualizador & {
  verificar: (opcoes?: OpcoesVerificarAtualizacao) => Promise<AtualizacaoDisponivel | null>
  instalar: (opcoes?: Omit<OpcoesInstalarAtualizacao, 'jobsEmVoo'>) => Promise<void>
  reiniciarParaAplicar: () => Promise<void>
  adiar: () => void
}

/** Hook reativo para o atualizador compartilhado entre `#/sobre` e o Shell. */
export function useAtualizador(opcoes?: {
  store?: StoreAtualizador
  fila?: Fila
}): ResultadoUseAtualizador {
  const store = opcoes?.store ?? storeAtualizador
  const estado = useSyncExternalStore(store.assinar, store.estado, store.estado)
  const jobs = useFila(opcoes?.fila)

  return useMemo(
    () => ({
      ...estado,
      verificar: store.verificar,
      instalar: (instOpts) => store.instalar({ ...instOpts, jobsEmVoo: jobs }),
      reiniciarParaAplicar: store.reiniciarParaAplicar,
      adiar: store.adiar,
    }),
    [estado, jobs, store],
  )
}
