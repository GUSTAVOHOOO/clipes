// PROTÓTIPO DESCARTÁVEL (#22) · Variante D, "Comando": minimalismo monocromático, voltado ao teclado (Ctrl K em tudo).
import type { PropsVariante } from '../App'
import { Raiz } from './D/comum'
import Importar from './D/Importar'
import Cortes from './D/Cortes'
import Editor from './D/Editor'

export const nome = 'Comando'

export default function VarianteD(props: PropsVariante) {
  return (
    <Raiz>
      {props.tela === 'importar' && <Importar {...props} />}
      {props.tela === 'cortes' && <Cortes {...props} />}
      {props.tela === 'editor' && <Editor {...props} />}
    </Raiz>
  )
}
