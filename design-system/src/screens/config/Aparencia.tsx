import { useTema, type Tema } from '@/lib/tema'
import { useComandos } from '@/lib/comandos'
import { Monitor, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Aparencia() {
  const { tema, definir } = useTema()
  const opcoes = [
    { id: 'escuro', nome: 'Escuro', Icone: Moon },
    { id: 'claro', nome: 'Claro', Icone: Sun },
    { id: 'sistema', nome: 'Sistema', Icone: Monitor },
  ] as const
  useComandos(
    opcoes.map((o) => ({
      id: `tema-${o.id}`,
      titulo: `Tema ${o.nome.toLowerCase()}`,
      grupo: 'Aparência',
      executar: () => definir(o.id),
    })),
  )
  return (
    <div className="space-y-8">
      <fieldset>
        <legend className="mb-4 text-sm font-medium">Tema</legend>
        <div className="flex flex-wrap gap-3">
          {opcoes.map(({ id, nome, Icone }) => (
            <label
              key={id}
              className={cn(
                'flex min-w-36 cursor-default items-center gap-3 rounded-lg border bg-surface p-4',
                tema === id ? 'border-accent-line' : 'border-line-strong',
              )}
            >
              <input
                className="size-4 accent-(--primary)"
                type="radio"
                name="tema"
                value={id}
                checked={tema === id}
                onChange={() => definir(id as Tema)}
              />
              <Icone size={16} className="text-fg-3" />
              <span>{nome}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="border-t border-line pt-5">
        <h2 className="text-sm font-medium">Movimento e teclado</h2>
        <p className="mt-2 text-sm text-fg-2">
          A preferência de movimento reduzido do sistema é respeitada automaticamente. O foco permanece visível em todos
          os temas.
        </p>
        <p className="mt-4 text-xs text-fg-3">Abra a paleta com Ctrl+K para consultar os comandos da tela atual.</p>
      </div>
    </div>
  )
}
