// Raiz: provedores, rotas por hash, comandos globais, paleta e avisos.
import { lazy, Suspense, type ComponentType } from 'react'
import { AppProvider } from '@/lib/app'
import { ComandosProvider, useComandos } from '@/lib/comandos'
import { ir, useRota } from '@/lib/rota'
import { useTema } from '@/lib/tema'
import { Paleta } from '@/components/shell/Paleta'
import { Toaster } from '@/components/ui/Toast'
import { TipProvider } from '@/components/ui/Tooltip'

const Fontes = lazy(() => import('@/screens/Fontes'))
const Cortes = lazy(() => import('@/screens/Cortes'))
const Exportar = lazy(() => import('@/screens/Exportar'))
const Editor = lazy(() => import('@/screens/editor/Editor'))
const Transformar = lazy(() => import('@/screens/transformar/Transformar'))
const Empacotar = lazy(() => import('@/screens/empacotar/Empacotar'))
const EstiloLegenda = lazy(() => import('@/screens/legenda/EstiloLegenda'))
const Config = lazy(() => import('@/screens/config/Config'))
const Galeria = lazy(() => import('@/gallery/Galeria'))

function escolher(partes: string[]): ComponentType {
  const [a, , etapa] = partes
  if (a === 'fontes') return Fontes
  if (a === 'cortes') return Cortes
  if (a === 'exportar') return Exportar
  if (a === 'legenda') return EstiloLegenda
  if (a === 'config') return Config
  if (a === 'galeria') return Galeria
  if (a === 'corte') return etapa === 'transformar' ? Transformar : etapa === 'empacotar' ? Empacotar : Editor
  return Fontes
}

function ComandosGlobais() {
  const { efetivo, definir } = useTema()
  useComandos([
    { id: 'n-fontes', titulo: 'Fontes e fila', grupo: 'Navegar', palavras: ['importar', 'url', 'arquivo', 'fila'], executar: () => ir('/fontes') },
    { id: 'n-cortes', titulo: 'Cortes sugeridos', grupo: 'Navegar', palavras: ['revisar', 'aprovar', 'nota'], executar: () => ir('/cortes') },
    { id: 'n-exportar', titulo: 'Exportar em lote', grupo: 'Navegar', palavras: ['render', 'fila'], executar: () => ir('/exportar') },
    { id: 'n-legenda', titulo: 'Estilos de legenda', grupo: 'Navegar', palavras: ['preset', 'fonte', 'cor', 'karaokê'], executar: () => ir('/legenda') },
    { id: 'n-config', titulo: 'Configurações', grupo: 'App', atalho: 'Ctrl+,', global: true, executar: () => ir('/config/provedor') },
    { id: 'n-provedor', titulo: 'Configurar Provedor', grupo: 'App', palavras: ['api', 'chave', 'codex', 'ollama', 'llm'], executar: () => ir('/config/provedor') },
    { id: 'n-componentes', titulo: 'Componentes e downloads', grupo: 'App', palavras: ['ffmpeg', 'modelo', 'whisper', 'baixar'], executar: () => ir('/config/componentes') },
    { id: 'n-diag', titulo: 'Exportar diagnóstico', grupo: 'App', palavras: ['bug', 'log', 'suporte'], executar: () => ir('/config/diagnostico') },
    {
      id: 'tema',
      titulo: efetivo === 'escuro' ? 'Usar tema claro' : 'Usar tema escuro',
      grupo: 'App',
      palavras: ['tema', 'claro', 'escuro', 'aparência', 'dark', 'light'],
      executar: () => definir(efetivo === 'escuro' ? 'claro' : 'escuro'),
    },
    { id: 'n-galeria', titulo: 'Galeria do design system', grupo: 'App', palavras: ['tokens', 'componentes', 'cores'], executar: () => ir('/galeria/cores') },
  ])
  return null
}

function Rotas() {
  const { partes } = useRota()
  const Atual = escolher(partes)
  return (
    <Suspense fallback={<div className="h-full bg-canvas" />}>
      <Atual />
    </Suspense>
  )
}

export default function App() {
  return (
    <AppProvider>
      <ComandosProvider>
        <TipProvider>
          <ComandosGlobais />
          <Rotas />
          <Paleta />
          <Toaster />
        </TipProvider>
      </ComandosProvider>
    </AppProvider>
  )
}
