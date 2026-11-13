// Variante B, "Documento": a Transcrição em primeiro lugar, como um texto que se edita.
import type { PropsVariante } from '../App'
import { Raiz } from './B/comum'
import Importar from './B/Importar'
import Cortes from './B/Cortes'
import Editor from './B/Editor'

export const nome = 'Documento'

export default function VarianteB({ tela, irPara }: PropsVariante) {
  return (
    <Raiz>
      {tela === 'importar' && <Importar irPara={irPara} />}
      {tela === 'cortes' && <Cortes irPara={irPara} />}
      {tela === 'editor' && <Editor irPara={irPara} />}
    </Raiz>
  )
}
