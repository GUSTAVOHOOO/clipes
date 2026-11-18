import { AreaRolagem, Botao, Dialogo, Kbd } from '@ds'
import { useMemo } from 'react'
import {
  formatarTecla,
  MAPA_ATALHOS_OFICIAL,
  resolverTeclaExibida,
  type DefinicaoAtalho,
} from '~/comandos/atalhos'
import { usePreferencias } from '~/preferencias/preferencias'

type FolhaAtalhosProps = {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
}

/** Folha rápida com os atalhos oficiais por escopo, aberta por `?`, `Ctrl/Cmd+/` ou menu Mais. */
export function FolhaAtalhos({ aberto, aoMudarAberto }: FolhaAtalhosProps) {
  const [preferencias] = usePreferencias()

  const grupos = useMemo(() => {
    const mapa = new Map<string, DefinicaoAtalho[]>()
    for (const item of MAPA_ATALHOS_OFICIAL) {
      const lista = mapa.get(item.escopo) ?? []
      lista.push(item)
      mapa.set(item.escopo, lista)
    }
    return [...mapa.entries()]
  }, [])

  return (
    <Dialogo
      aberto={aberto}
      aoMudarAberto={aoMudarAberto}
      titulo="Atalhos de teclado"
      descricao="Pressione F6 para alternar entre barra superior, conteúdo e barra de status."
      largura={560}
      rodape={
        <>
          <Botao
            variante="secundario"
            onClick={() => {
              aoMudarAberto(false)
              window.location.hash = '#/config/aparencia'
            }}
          >
            Personalizar atalhos
          </Botao>
          <Botao variante="primario" onClick={() => aoMudarAberto(false)}>
            Fechar
          </Botao>
        </>
      }
    >
      <AreaRolagem className="max-h-[52vh]" rotulo="Lista de atalhos de teclado">
        <div className="flex flex-col gap-4 pr-2">
          {grupos.map(([escopo, itens]) => (
            <section key={escopo} className="flex flex-col gap-1.5">
              <h3 className="text-micro font-medio text-t3">{escopo}</h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {itens.map((item) => {
                  const teclaBase = Object.hasOwn(preferencias.atalhos, item.id)
                    ? preferencias.atalhos[item.id]
                    : item.tecla
                  const teclaEfetiva = resolverTeclaExibida(
                    teclaBase,
                    preferencias.modoTeclasUnicas,
                    item.teclaUnica,
                  )
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-controle bg-area px-2.5 py-1.5 text-pequeno"
                    >
                      <span className="min-w-0 flex-1 text-t2">{item.titulo}</span>
                      <Kbd tom="forte">
                        {teclaEfetiva ? formatarTecla(teclaEfetiva) : 'Desligado'}
                      </Kbd>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </AreaRolagem>
    </Dialogo>
  )
}
