// PROTÓTIPO DESCARTÁVEL (#22) · Variante E, "Estúdio + Comando": a estrutura e o grafite da A, mais calmos,
// com a paleta Ctrl K, os atalhos e o fluxo pelo teclado da D. O que é raro mora na paleta, nos atalhos ou no hover.
import type { PropsVariante } from '../App'
import { Raiz } from './E/Shell'
import Importar from './E/Importar'
import Cortes from './E/Cortes'
import Editor from './E/Editor'

export const nome = 'Estúdio + Comando'

export default function VarianteE({ tela, irPara }: PropsVariante) {
  return (
    <Raiz tela={tela} irPara={irPara}>
      {tela === 'importar' && <Importar />}
      {tela === 'cortes' && <Cortes />}
      {tela === 'editor' && <Editor />}
    </Raiz>
  )
}
