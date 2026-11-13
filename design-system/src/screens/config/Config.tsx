import { Tela, CabecalhoPagina } from '@/components/shell/Tela'
import { useRota } from '@/lib/rota'
import { cn } from '@/lib/cn'
import { Provedor } from './Provedor'
import { Componentes } from './Componentes'
import { Aparencia } from './Aparencia'
import { Diagnostico } from './Diagnostico'

const secoes = [
  {
    id: 'provedor',
    nome: 'Provedor',
    descricao: 'Escolha quem sugere os Cortes. A Transcrição continua local até você permitir o envio.',
  },
  {
    id: 'componentes',
    nome: 'Componentes',
    descricao: 'Baixe apenas o que precisar. Tamanho e licença ficam visíveis antes de qualquer download.',
  },
  { id: 'aparencia', nome: 'Aparência', descricao: 'Um espaço de trabalho confortável para revisar por horas.' },
  { id: 'diagnostico', nome: 'Diagnóstico', descricao: 'Revise o conteúdo antes de compartilhar um diagnóstico.' },
]

export default function Config() {
  const { partes } = useRota()
  const atual = secoes.find((s) => s.id === partes[1]) ?? secoes[0]
  return (
    <Tela titulo={`Configurações · ${atual.nome}`}>
      <div className="mx-auto flex h-full max-w-[1120px] gap-10 overflow-y-auto px-8 py-10 max-[800px]:gap-5 max-[800px]:px-4">
        <nav aria-label="Configurações" className="w-44 shrink-0 space-y-1">
          <p className="mb-5 px-2 text-xs text-fg-3">Configurações</p>
          {secoes.map((s) => (
            <a
              key={s.id}
              href={`#/config/${s.id}`}
              aria-current={atual.id === s.id ? 'page' : undefined}
              className={cn(
                'foco flex min-h-8 items-center rounded-md px-2 text-sm',
                atual.id === s.id ? 'bg-selected text-fg' : 'text-fg-3 hover:bg-hover hover:text-fg',
              )}
            >
              {s.nome}
            </a>
          ))}
          <div className="mt-6 border-t border-line pt-3">
            <a className="foco flex min-h-8 items-center px-2 text-xs text-fg-3 hover:text-fg" href="#/galeria/cores">
              Galeria do design system
            </a>
          </div>
        </nav>
        <section className="min-w-0 flex-1 pb-12" aria-label={atual.nome}>
          <CabecalhoPagina titulo={atual.nome} descricao={atual.descricao} />
          <div className="mt-8">
            {atual.id === 'provedor' ? (
              <Provedor />
            ) : atual.id === 'componentes' ? (
              <Componentes />
            ) : atual.id === 'aparencia' ? (
              <Aparencia />
            ) : (
              <Diagnostico />
            )}
          </div>
        </section>
      </div>
    </Tela>
  )
}
