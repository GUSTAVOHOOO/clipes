// Variante G, "Seleção": o Estúdio sem abas. Você seleciona na timeline, no preview ou na lista,
// e o painel da direita mostra só as propriedades do que está selecionado (no estilo de um editor de design).
import type { PropsVariante } from '../App'
import { Casca } from './nucleo/Paleta'
import { temaG } from './G/comum'
import Importar from './G/Importar'
import Cortes from './G/Cortes'
import Editor from './G/Editor'

export const nome = 'Seleção'

export default function VarianteG({ tela, irPara }: PropsVariante) {
  return (
    <Casca estilo={temaG} fonte="geist" className="[color-scheme:dark]">
      {tela === 'importar' && <Importar tela={tela} irPara={irPara} />}
      {tela === 'cortes' && <Cortes tela={tela} irPara={irPara} />}
      {tela === 'editor' && <Editor tela={tela} irPara={irPara} />}
    </Casca>
  )
}
