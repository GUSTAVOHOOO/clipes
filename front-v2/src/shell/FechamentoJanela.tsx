import { ConfirmDialog } from '@ds'
import { isTauri } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Job } from '~/core/progresso'

const ETAPAS_DOWNLOAD_GLOBAL = new Set(['download', 'update', 'worker'])
const ETAPAS_EXPORTACAO = new Set(['export', 'export_batch'])

/** Indica se um job em execução impede fechamento silencioso da janela. */
export function ehOperacaoCriticaEmVoo(job: Job): boolean {
  if (job.estado !== 'rodando') return false

  if (
    ETAPAS_DOWNLOAD_GLOBAL.has(job.etapa) ||
    job.etapa.startsWith('components.') ||
    job.etapa.startsWith('tts.models.') ||
    job.etapa.startsWith('sources.url.') ||
    job.id.startsWith('tts:') ||
    job.id.startsWith('components.') ||
    job.id.startsWith('sources.url.')
  ) {
    return true
  }

  if (
    ETAPAS_EXPORTACAO.has(job.etapa) ||
    job.etapa.startsWith('export:') ||
    job.etapa.startsWith('export.') ||
    job.id.startsWith('export-batch-')
  ) {
    return true
  }

  if (
    job.etapa.startsWith('ai:') ||
    job.etapa.startsWith('selection:') ||
    job.etapa === 'groq' ||
    job.etapa.startsWith('transcription:groq') ||
    job.id === 'provider.structured' ||
    job.id.startsWith('selection-')
  ) {
    return true
  }

  return false
}

/** Filtra os jobs `rodando` de download global, exportação ou chamada paga a Provedor. */
export function operacoesCriticasEmVoo(jobs: readonly Job[]): Job[] {
  return jobs.filter(ehOperacaoCriticaEmVoo)
}

/**
 * Escuta `app-close-requested` emitido pelo Tauri após `editor.flush` e fecha a janela
 * diretamente quando não há operação crítica em voo, ou pede confirmação em `<ConfirmDialog>`.
 */
export function FechamentoJanela({ jobs }: { jobs: readonly Job[] }) {
  const [aberto, setAberto] = useState(false)
  const [fechando, setFechando] = useState(false)
  const jobsRef = useRef<readonly Job[]>(jobs)
  jobsRef.current = jobs

  const criticos = useMemo(() => operacoesCriticasEmVoo(jobs), [jobs])

  useEffect(() => {
    if (!isTauri()) return

    let cancelado = false
    let parar: UnlistenFn = () => {}

    void listen('app-close-requested', () => {
      void emit('app-close-ack').catch(() => {})
      if (operacoesCriticasEmVoo(jobsRef.current).length === 0) {
        void getCurrentWindow()
          .destroy()
          .catch(() => {})
        return
      }
      setAberto(true)
    })
      .then((unlisten) => {
        if (cancelado) {
          unlisten()
        } else {
          parar = unlisten
        }
      })
      .catch(() => {})

    return () => {
      cancelado = true
      parar()
    }
  }, [])

  const confirmarFechamento = useCallback(async () => {
    setFechando(true)
    try {
      await getCurrentWindow().destroy()
    } catch {
      setFechando(false)
    }
  }, [])

  return (
    <ConfirmDialog
      aberto={aberto}
      aoMudarAberto={(proximo) => {
        if (!fechando) setAberto(proximo)
      }}
      titulo="Fechar o Clipes com operações em andamento?"
      descricao="Suas últimas edições no Editor já foram salvas, mas há operações ativas neste momento. Downloads globais e exportações em andamento serão interrompidos; tarefas locais retornam para a fila ao reabrir o Projeto; chamadas a Provedores em andamento ficarão como resultado incerto para sua decisão."
      rotuloCancelar="Continuar trabalhando"
      rotuloConfirmar="Fechar mesmo assim"
      variante="perigo"
      focoInicial="cancelar"
      ocupado={fechando}
      aoConfirmar={confirmarFechamento}
    >
      {criticos.length > 0 && (
        <ul className="flex flex-col gap-1.5 rounded-area bg-area px-3 py-2 text-pequeno text-t2">
          {criticos.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{item.mensagem || item.etapa}</span>
              <span className="num shrink-0 text-t3">{Math.round(item.percentual)}%</span>
            </li>
          ))}
        </ul>
      )}
    </ConfirmDialog>
  )
}
