// Página Tokens: papéis de cor nos dois temas lado a lado (valores lidos do CSS), tipo, espaço, raio, sombra, movimento.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Pagina, Secao } from './App'

type Papel = { nome: string; uso: string; texto?: boolean }

const grupos: { titulo: string; papeis: Papel[] }[] = [
  {
    titulo: 'Superfícies',
    papeis: [
      { nome: 'chao', uso: 'fundo da janela' },
      { nome: 'area', uso: 'uma área de trabalho, um degrau acima' },
      { nome: 'elevado', uso: 'popover, campo, linha selecionada' },
      { nome: 'hover', uso: 'passagem do ponteiro, item realçado' },
      { nome: 'linha', uso: 'divisória rara de 1 px' },
      { nome: 'linha-forte', uso: 'contorno de controle (3:1)' },
    ],
  },
  {
    titulo: 'Texto',
    papeis: [
      { nome: 't1', uso: 'principal', texto: true },
      { nome: 't2', uso: 'secundário', texto: true },
      { nome: 't3', uso: 'terciário, dicas, timecodes', texto: true },
    ],
  },
  {
    titulo: 'A única cor',
    papeis: [
      { nome: 'sinal', uso: 'agulha, marca de seleção, primária' },
      { nome: 'sinal-texto', uso: 'palavra falada', texto: true },
      { nome: 'foco', uso: 'anel de foco de 2 px' },
      { nome: 'erro', uso: 'só texto e ícone de erro', texto: true },
    ],
  },
]

function Amostra({ papel }: { papel: Papel }) {
  const ref = useRef<HTMLDivElement>(null)
  const [valor, setValor] = useState('')
  useLayoutEffect(() => {
    if (ref.current) setValor(getComputedStyle(ref.current).getPropertyValue(`--${papel.nome}`).trim())
  })
  return (
    <div ref={ref} className="grid grid-cols-[36px_1fr_auto] items-center gap-3 py-1.5">
      {papel.texto ? (
        <span className="text-titulo font-forte" style={{ color: `var(--${papel.nome})` }} aria-hidden>
          Aa
        </span>
      ) : (
        <span className="size-9 rounded-controle shadow-[inset_0_0_0_1px_var(--linha)]" style={{ background: `var(--${papel.nome})` }} aria-hidden />
      )}
      <span className="flex min-w-0 flex-col">
        <code className="text-base text-t1">--{papel.nome}</code>
        <span className="truncate text-pequeno text-t3">{papel.uso}</span>
      </span>
      <code className="num text-pequeno text-t3">{valor}</code>
    </div>
  )
}

function Tema({ tema, children }: { tema: 'escuro' | 'claro'; children: ReactNode }) {
  return (
    <div data-tema={tema} className="flex flex-col gap-1 rounded-area bg-chao p-5 text-t1 shadow-[inset_0_0_0_1px_var(--linha)]">
      <span className="mb-2 text-pequeno text-t3">{tema === 'escuro' ? 'Escuro (padrão)' : 'Claro'}</span>
      {children}
    </div>
  )
}

const tipos = [
  { cls: 'text-destaque font-forte', nome: 'destaque', px: '20 / 1,25 · 600', ex: 'Ele contou como perdeu tudo em 2019' },
  { cls: 'text-titulo font-forte', nome: 'titulo', px: '16 / 1,3 · 600', ex: 'Como o navegador bloqueou o vazamento' },
  { cls: 'text-campo', nome: 'campo', px: '14 / 1,4', ex: 'Filtrar fala do Corte…' },
  { cls: 'text-base', nome: 'base', px: '13 / 1,45', ex: 'Todo mundo achava que o isolamento do navegador era impenetrável.' },
  { cls: 'text-pequeno', nome: 'pequeno', px: '12 / 1,45', ex: 'Entrada 00:00,0 · Saída 00:38,4' },
  { cls: 'text-micro', nome: 'micro', px: '11 / 1,3', ex: 'manter · remover' },
]

export function PaginaTokens() {
  return (
    <Pagina titulo="Tokens" descricao="Papéis, não valores. Grafite em degraus e um único laranja-sinal; a separação vem do espaço, não de bordas. O escuro é o padrão; o claro tem os mesmos papéis.">
      <Secao titulo="Cor" descricao="Os dois temas lado a lado, com os valores lidos do CSS em tempo real. Contraste conferido por scripts/contraste.ts (texto ≥ 4,5:1; sinal, foco e linha-forte ≥ 3:1).">
        <div className="grid grid-cols-2 gap-6 max-[900px]:grid-cols-1">
          {(['escuro', 'claro'] as const).map((t) => (
            <Tema key={t} tema={t}>
              {grupos.map((g) => (
                <div key={g.titulo} className="mb-4 last:mb-0">
                  <h3 className="mb-1 text-pequeno font-medio text-t2">{g.titulo}</h3>
                  {g.papeis.map((p) => (
                    <Amostra key={p.nome} papel={p} />
                  ))}
                </div>
              ))}
            </Tema>
          ))}
        </div>
      </Secao>

      <Secao titulo="Tipo" descricao="Inter Variable, auto-hospedada (funciona offline no Tauri). Base de 13 px: a UI é densa. Números de tempo e Nota usam a classe num (tabulares).">
        <div className="flex flex-col">
          {tipos.map((t) => (
            <div key={t.nome} className="grid grid-cols-[120px_120px_1fr] items-baseline gap-4 py-2.5">
              <code className="text-pequeno text-t2">text-{t.nome}</code>
              <span className="num text-pequeno text-t3">{t.px}</span>
              <span className={cn('truncate text-t1', t.cls)}>{t.ex}</span>
            </div>
          ))}
          <div className="grid grid-cols-[120px_120px_1fr] items-baseline gap-4 py-2.5">
            <code className="text-pequeno text-t2">num</code>
            <span className="text-pequeno text-t3">tabular</span>
            <span className="num text-base text-t1">00:14,2 / 00:38,4 · Nota 8,4 · 01:22:12</span>
          </div>
        </div>
      </Secao>

      <Secao titulo="Espaço e raio" descricao="Grade de 4 px (p-1 = 4 px). Três raios: mini para kbd e pistas, controle para botão e campo, área para painel, popover e o quadro 9:16.">
        <div className="flex flex-wrap items-end gap-10">
          <div className="flex items-end gap-3">
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <div key={n} className="flex flex-col items-center gap-2">
                <span className="w-3 bg-t3" style={{ height: n * 4 }} aria-hidden />
                <span className="num text-micro text-t3">{n * 4}</span>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-5">
            {[
              ['mini', '3 px', 'rounded-mini'],
              ['controle', '4 px', 'rounded-controle'],
              ['area', '6 px', 'rounded-area'],
            ].map(([n, px, cls]) => (
              <div key={n} className="flex flex-col gap-2">
                <span className={cn('size-14 bg-elevado', cls)} aria-hidden />
                <span className="text-micro text-t3">
                  {n} · <span className="num">{px}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Secao>

      <Secao titulo="Profundidade e movimento" descricao="Só o que flutua tem sombra. Movimento curto, saída exponencial, zerado com prefers-reduced-motion.">
        <div className="flex flex-wrap items-start gap-10">
          <div className="flex flex-col gap-2">
            <div className="h-16 w-44 rounded-area bg-elevado shadow-flutuante" />
            <span className="text-micro text-t3">shadow-flutuante · popover, menu, diálogo</span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="h-10 w-44 rounded-controle bg-elevado shadow-toast" />
            <span className="text-micro text-t3">shadow-toast</span>
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1.5 text-pequeno">
            {[
              ['--dur-rapida', '120 ms · hover, cor'],
              ['--dur-base', '150 ms · troca de estado'],
              ['--dur-lenta', '220 ms · entrada de toast, progresso'],
              ['--ease-saida', 'cubic-bezier(.16, 1, .3, 1)'],
              ['--altura-topo / subtopo / rodapé', '40 / 44 / 28 px'],
              ['--altura-barra', '36 px · transporte e ações'],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <code className="text-t2">{k}</code>
                </dt>
                <dd className="num text-t3">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Secao>
    </Pagina>
  )
}
