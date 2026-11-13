// Variante A, "Estúdio": editor profissional clássico, grafite neutro, um só acento âmbar para seleção e playhead.
import { Toaster } from 'sonner'
import type { PropsVariante } from '../App'
import { tema } from './A/ui'
import Importar from './A/Importar'
import Cortes from './A/Cortes'
import Editor from './A/Editor'

export const nome = 'Estúdio'

export default function VarianteA({ tela, irPara }: PropsVariante) {
  return (
    <div style={tema} className="h-full overflow-hidden bg-[var(--a-bg)] text-[var(--a-tx)] font-sans text-[13px] antialiased [color-scheme:dark]">
      {tela === 'importar' && <Importar tela={tela} irPara={irPara} />}
      {tela === 'cortes' && <Cortes tela={tela} irPara={irPara} />}
      {tela === 'editor' && <Editor tela={tela} irPara={irPara} />}
      <Toaster position="bottom-right" offset={20} toastOptions={{
        style: { background: '#232323', border: '1px solid #3b3b3b', color: '#ecebe7', fontFamily: '"Inter Variable", system-ui, sans-serif', fontSize: 13 },
      }} />
    </div>
  )
}
