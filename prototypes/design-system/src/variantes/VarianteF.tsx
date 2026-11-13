// Variante F, "Foco": o Estúdio com densidade sob demanda. O editor abre só com preview e timeline;
// Cortes e ferramentas chegam pela borda (mouse perto ou tecla) e somem quando você volta a editar.
import type { PropsVariante } from '../App'
import { Casca } from './nucleo/Paleta'
import { temaF } from './F/comum'
import Importar from './F/Importar'
import Cortes from './F/Cortes'
import Editor from './F/Editor'

export const nome = 'Foco'

export default function VarianteF({ tela, irPara }: PropsVariante) {
  return (
    <Casca estilo={temaF} className="[color-scheme:dark]">
      {tela === 'importar' && <Importar tela={tela} irPara={irPara} />}
      {tela === 'cortes' && <Cortes tela={tela} irPara={irPara} />}
      {tela === 'editor' && <Editor tela={tela} irPara={irPara} />}
    </Casca>
  )
}
