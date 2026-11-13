// Variante C "Etapas": fluxo guiado, uma tarefa por tela, com um stepper fino no topo.
import type { PropsVariante } from '../App'
import { tema } from './C/comum'
import { Importar } from './C/Importar'
import { Revisar } from './C/Revisar'
import { Editor } from './C/Editor'

export const nome = 'Etapas'

export default function VarianteC({ tela, irPara }: PropsVariante) {
  return (
    <div style={tema} className="relative h-full flex flex-col overflow-hidden bg-[var(--bg)] text-[var(--tx)] font-sans text-[14px] selection:bg-[#57534e]">
      {tela === 'importar' && <Importar irPara={irPara} />}
      {tela === 'cortes' && <Revisar irPara={irPara} />}
      {tela === 'editor' && <Editor irPara={irPara} />}
    </div>
  )
}
