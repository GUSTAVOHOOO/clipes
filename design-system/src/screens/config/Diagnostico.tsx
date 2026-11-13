import { useState } from 'react'
import { Download, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useComandos } from '@/lib/comandos'

export function Diagnostico() {
  const [exportado, setExportado] = useState(false)
  const relatorio = {
    produto: 'Clipes',
    versao: '0.1.0',
    modo: 'demonstracao-design-system',
    plataforma: 'Navegador',
    tema: document.documentElement.dataset.theme,
    verificacoes: {
      interface: 'disponivel',
      nucleoRust: 'nao-conectado',
      workerPython: 'nao-conectado',
      ffmpeg: 'nao-consultado',
      provedor: 'nao-consultado',
    },
    eventos: ['Interface de demonstração iniciada.'],
    dadosIncluidos: 'Somente os campos visíveis neste relatório.',
  }
  const json = JSON.stringify(relatorio, null, 2)
  const exportar = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'clipes-diagnostico.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setExportado(true)
  }
  useComandos([
    { id: 'diagnostico-exportar', titulo: 'Baixar diagnóstico revisado', grupo: 'Diagnóstico', executar: exportar },
  ])
  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 text-sm text-fg-2">
        <ShieldCheck size={16} className="mt-0.5 shrink-0" />
        Sem chaves, Transcrições, caminhos de arquivos ou conteúdo dos Cortes. O arquivo contém exatamente o relatório
        abaixo.
      </p>
      <pre
        tabIndex={0}
        aria-label="Prévia do diagnóstico"
        className="foco max-h-[360px] overflow-auto rounded-md border border-line bg-surface p-4 font-mono text-xs leading-relaxed text-fg-2"
      >
        {json}
      </pre>
      <Button variante="primario" icone={<Download size={14} />} onClick={exportar}>
        Exportar diagnóstico
      </Button>
      {exportado && (
        <p role="status" className="text-xs text-success">
          Diagnóstico exportado. Você escolhe com quem compartilhar.
        </p>
      )}
    </div>
  )
}
