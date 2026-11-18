import { invoke, isTauri } from '@tauri-apps/api/core'
import { Botao, Campo, Entrada } from '@ds'
import { FolderOpen } from 'lucide-react'
import { useRef, type ReactNode, type RefObject } from 'react'

type EstadoE2E = {
  dialogQueue: Array<string | null>
  dialogCalls: Array<{ kind: 'open' | 'save'; options?: Record<string, unknown> }>
  confirmQueue?: boolean[]
  confirmCalls?: string[]
  openedUrls?: string[]
  copiedText?: string | null
  updaterMode?: 'off' | 'available' | 'real'
}

declare global {
  interface Window {
    __CLIPES_E2E__?: EstadoE2E
  }
}

export type SeletorCaminhoProps = {
  rotulo: string
  valor: string
  aoMudar: (valor: string) => void
  modo?: 'pasta' | 'arquivo'
  ajuda?: ReactNode
  erro?: string
  placeholder?: string
  desabilitado?: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  aoEscolher?: () => Promise<string | null>
}

/** Campo editável de caminho no disco com botão para o seletor nativo (Tauri / fila E2E). */
export function SeletorCaminho({
  rotulo,
  valor,
  aoMudar,
  modo = 'pasta',
  ajuda,
  erro,
  placeholder,
  desabilitado,
  inputRef,
  aoEscolher,
}: SeletorCaminhoProps) {
  const refLocal = useRef<HTMLInputElement>(null)
  const refEfetiva = inputRef ?? refLocal
  const rotuloBotao = modo === 'arquivo' ? 'Escolher arquivo' : 'Escolher pasta'

  async function escolher() {
    if (desabilitado) return

    if (aoEscolher) {
      const escolhido = await aoEscolher()
      if (escolhido) aoMudar(escolhido)
      return
    }

    const e2e = typeof window !== 'undefined' ? window.__CLIPES_E2E__ : undefined
    if (e2e) {
      e2e.dialogCalls.push({
        kind: 'open',
        options: { directory: modo !== 'arquivo', multiple: false },
      })
      const proximo = e2e.dialogQueue.length > 0 ? (e2e.dialogQueue.shift() ?? null) : null
      if (proximo) aoMudar(proximo)
      else refEfetiva.current?.focus()
      return
    }

    if (isTauri()) {
      const selecionado = await invoke<string | string[] | null>('plugin:dialog|open', {
        options: { directory: modo !== 'arquivo', multiple: false },
      })
      const caminho = Array.isArray(selecionado) ? (selecionado[0] ?? null) : selecionado
      if (caminho) aoMudar(caminho)
      return
    }

    refEfetiva.current?.focus()
  }

  return (
    <Campo rotulo={rotulo} ajuda={ajuda} erro={erro}>
      {(propsAria) => (
        <div className="flex items-center gap-2">
          <Entrada
            ref={refEfetiva}
            {...propsAria}
            value={valor}
            onChange={(e) => aoMudar(e.target.value)}
            placeholder={placeholder}
            disabled={desabilitado}
            className="min-w-0 flex-1 font-mono"
          />
          <Botao
            variante="secundario"
            icone={<FolderOpen />}
            disabled={desabilitado}
            onClick={() => void escolher()}
          >
            {rotuloBotao}
          </Botao>
        </div>
      )}
    </Campo>
  )
}
