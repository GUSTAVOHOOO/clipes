import { AreaRolagem, Kbd, cn } from '@ds'
import type { ReactNode } from 'react'
import type { SecaoConfig } from '~/rotas/rotas'

export type ItemSecaoConfig = {
  secao: SecaoConfig
  rotulo: string
  hash: string
}

export const SECOES_CONFIG_MENU: ItemSecaoConfig[] = [
  { secao: 'provedores', rotulo: 'Provedores e Tarefas de IA', hash: '#/config/provedores' },
  { secao: 'custos', rotulo: 'Custos, Orçamentos e Auditoria', hash: '#/config/custos' },
  { secao: 'componentes', rotulo: 'Componentes e Armazenamento', hash: '#/config/componentes' },
  { secao: 'exportacao', rotulo: 'Exportação e Encoder', hash: '#/config/exportacao' },
  { secao: 'aparencia', rotulo: 'Aparência e Teclado', hash: '#/config/aparencia' },
  { secao: 'projeto', rotulo: 'Projeto atual', hash: '#/config/projeto' },
]

export type ConfiguracoesLayoutProps = {
  secao: SecaoConfig
  projetoAberto: string | null
  titulo: string
  subtitulo?: string
  acoesCabecalho?: ReactNode
  children: ReactNode
}

/** Moldura compartilhada das 6 seções de Configurações com menu lateral fixo e rolagem interna independente. */
export function ConfiguracoesLayout({
  secao,
  projetoAberto,
  titulo,
  subtitulo,
  acoesCabecalho,
  children,
}: ConfiguracoesLayoutProps) {
  const atalho =
    typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)
      ? '⌘,'
      : 'Ctrl+,'

  return (
    <div className="flex h-full min-h-0 flex-1 gap-5">
      <aside className="flex w-[200px] shrink-0 flex-col gap-2 rounded-area bg-area p-2">
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="text-pequeno font-medio text-t2">Configurações</span>
          <Kbd tom="normal">{atalho}</Kbd>
        </div>

        <nav aria-label="Seções de Configurações" className="flex flex-col gap-0.5">
          {SECOES_CONFIG_MENU.map((item) => {
            const ativo = item.secao === secao
            const exigeProjeto = item.secao === 'projeto' && projetoAberto === null

            return (
              <a
                key={item.secao}
                href={item.hash}
                aria-current={ativo ? 'page' : undefined}
                className={cn(
                  'foco flex min-h-8 flex-col justify-center rounded-controle px-2.5 py-1.5 text-pequeno no-underline transition-colors duration-(--dur-rapida) ease-saida',
                  ativo
                    ? 'marcado bg-elevado font-medio text-t1'
                    : exigeProjeto
                      ? 'text-t3 hover:bg-hover hover:text-t2'
                      : 'text-t2 hover:bg-hover hover:text-t1',
                )}
              >
                <span>{item.rotulo}</span>
                {exigeProjeto && (
                  <span className="mt-0.5 text-micro text-t3">Abra um Projeto</span>
                )}
              </a>
            )
          })}
        </nav>
      </aside>

      <AreaRolagem className="min-h-0 flex-1" rotulo={titulo}>
        <div className="flex flex-col gap-4 pr-2 pb-4">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-titulo font-forte tracking-[-0.01em] text-t1">{titulo}</h1>
              {subtitulo && (
                <p className="max-w-[68ch] text-pequeno text-t2">{subtitulo}</p>
              )}
            </div>
            {acoesCabecalho && (
              <div className="flex shrink-0 items-center gap-2">{acoesCabecalho}</div>
            )}
          </header>

          {children}
        </div>
      </AreaRolagem>
    </div>
  )
}
