// Variante H, "Linha": o Estúdio com a timeline como protagonista. A Transcrição vira uma trilha dentro da
// timeline, o preview fica pequeno e fixo em cima. Escuro por padrão; T alterna para o claro.
import { useState } from 'react'
import type { PropsVariante } from '../App'
import { Casca, useAtalhos } from './nucleo/Paleta'
import { CtxTema, memoH, temaClaro, temaEscuro } from './H/comum'
import Importar from './H/Importar'
import Cortes from './H/Cortes'
import Editor from './H/Editor'

export const nome = 'Linha'

function TeclaTema({ alternar }: { alternar: () => void }) {
  useAtalhos(ev => { if (!ev.ctrlKey && !ev.metaKey && ev.key.toLowerCase() === 't') alternar() })
  return null
}

export default function VarianteH({ tela, irPara }: PropsVariante) {
  const [claro, setClaro] = useState(memoH.claro)
  const alternarTema = () => setClaro(v => (memoH.claro = !v))
  return (
    <CtxTema.Provider value={{ claro, alternarTema }}>
      <Casca estilo={claro ? temaClaro : temaEscuro} className={claro ? '[color-scheme:light]' : '[color-scheme:dark]'}>
        <TeclaTema alternar={alternarTema} />
        {tela === 'importar' && <Importar tela={tela} irPara={irPara} />}
        {tela === 'cortes' && <Cortes tela={tela} irPara={irPara} />}
        {tela === 'editor' && <Editor tela={tela} irPara={irPara} />}
      </Casca>
    </CtxTema.Provider>
  )
}
