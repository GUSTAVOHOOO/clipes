import { ArrowRight, RotateCcw, X } from 'lucide-react'
import { img, type ItemFila } from '@/data/dados'
import { dur } from '@/lib/formato'
import { ir } from '@/lib/rota'
import { Button, IconButton } from '@/components/ui/Button'
import { Progresso } from '@/components/ui/Progress'
import { Status, type TomStatus } from '@/components/ui/Status'

const ESTADOS: Record<ItemFila['estado'], { texto: string; tom: TomStatus }> = {
  baixando: { texto: 'Baixando', tom: 'andamento' },
  transcrevendo: { texto: 'Transcrevendo', tom: 'andamento' },
  selecionando: { texto: 'Selecionando Cortes', tom: 'andamento' },
  'na-fila': { texto: 'Na fila', tom: 'espera' },
  pronta: { texto: 'Pronta', tom: 'sucesso' },
  erro: { texto: 'Falha no download', tom: 'perigo' },
  offline: { texto: 'Fonte offline', tom: 'atencao' },
}

export type FonteFila = ItemFila & { permissao?: { origem: string; escopo: string }; localizacao?: string }

export function LinhaFila({
  item,
  onRepetir,
  onRemover,
}: {
  item: FonteFila
  onRepetir: () => void
  onRemover: () => void
}) {
  const st = ESTADOS[item.estado]
  const trabalhando = ['baixando', 'transcrevendo', 'selecionando'].includes(item.estado)
  return (
    <li className="group/fila flex items-center gap-4 py-4">
      <img src={img(item.img)} alt="" className="h-14 w-24 shrink-0 rounded-sm object-cover" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium">{item.nome}</h3>
        <p className="mt-1 text-xs text-fg-3">
          {item.projeto} · {item.dur ? dur(item.dur) : 'Duração a verificar'}
        </p>
        {item.permissao && (
          <p className="mt-1 truncate text-2xs text-fg-3" title={`${item.permissao.origem} · ${item.permissao.escopo}`}>
            Permissão: {item.permissao.origem} · {item.permissao.escopo}
          </p>
        )}
        {item.erro && <p className="mt-1 max-w-[65ch] text-xs text-danger">{item.erro}</p>}
        {trabalhando && (
          <Progresso
            className="mt-2 max-w-72"
            valor={item.progresso}
            rotulo={`${st.texto}: ${Math.round(item.progresso * 100)}%`}
          />
        )}
      </div>
      <div className="flex w-48 shrink-0 flex-col gap-1">
        <Status tom={st.tom}>
          {st.texto}
          {trabalhando && ` · ${Math.round(item.progresso * 100)}%`}
        </Status>
        {item.resta && <span className="text-2xs text-fg-3">Cerca de {dur(item.resta)} restantes</span>}
      </div>
      <div className="flex w-36 shrink-0 justify-end gap-1">
        {item.estado === 'pronta' && (
          <Button tamanho="sm" variante="fantasma" icone={<ArrowRight size={14} />} onClick={() => ir('/cortes')}>
            {item.cortes} Cortes
          </Button>
        )}
        {(item.estado === 'erro' || item.estado === 'offline') && (
          <Button tamanho="sm" icone={<RotateCcw size={13} />} onClick={onRepetir}>
            Tentar de novo
          </Button>
        )}
        {item.estado !== 'pronta' && (
          <IconButton tamanho="sm" rotulo={`Remover ${item.nome} da fila`} onClick={onRemover}>
            <X size={14} />
          </IconButton>
        )}
      </div>
    </li>
  )
}
