// Galeria do design system v2: rotas por hash, tema escuro/claro e as duas telas de prova.
// #/tokens · #/primitivas · #/componentes · #/tela/editor · #/tela/bancada  (aceita ?tema=claro)
import { Moon, Sun } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Kbd } from '@/primitivas/Botao'
import { ProvedorDicas } from '@/primitivas/Flutuantes'
import { ProvedorToast } from '@/primitivas/Indicadores'
import { Segmentado } from '@/primitivas/Escolhas'
import { PaginaTokens } from './PaginaTokens'
import { PaginaPrimitivas } from './PaginaPrimitivas'
import { PaginaComponentes } from './PaginaComponentes'
import { TelaEditor } from './TelaEditor'
import { TelaBancada } from './TelaBancada'

type Tema = 'escuro' | 'claro'
const rotas = [
  { hash: '#/tokens', rotulo: 'Tokens' },
  { hash: '#/primitivas', rotulo: 'Primitivas' },
  { hash: '#/componentes', rotulo: 'Componentes' },
  { hash: '#/tela/editor', rotulo: 'Editor' },
  { hash: '#/tela/bancada', rotulo: 'Bancada' },
] as const

function useHash() {
  const [hash, setHash] = useState(() => location.hash || '#/tokens')
  useEffect(() => {
    const h = () => setHash(location.hash || '#/tokens')
    addEventListener('hashchange', h)
    return () => removeEventListener('hashchange', h)
  }, [])
  return hash
}

function useTema() {
  const [tema, setTema] = useState<Tema>(() => (document.documentElement.dataset.tema === 'claro' ? 'claro' : 'escuro'))
  useEffect(() => {
    document.documentElement.dataset.tema = tema
    try {
      localStorage.setItem('clipes-ds-tema', tema)
    } catch {
      /* sem armazenamento: o tema vale só nesta aba */
    }
  }, [tema])
  // Alt+T alterna o tema em qualquer página, inclusive nas telas sem moldura da galeria
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 't') setTema((t) => (t === 'escuro' ? 'claro' : 'escuro'))
    }
    addEventListener('keydown', h)
    return () => removeEventListener('keydown', h)
  }, [])
  return [tema, setTema] as const
}

export function App() {
  const hash = useHash()
  const [tema, setTema] = useTema()
  const tela = hash.startsWith('#/tela/')

  let conteudo: ReactNode
  if (hash === '#/tela/editor') conteudo = <TelaEditor />
  else if (hash === '#/tela/bancada') conteudo = <TelaBancada />
  else if (hash === '#/primitivas') conteudo = <PaginaPrimitivas />
  else if (hash === '#/componentes') conteudo = <PaginaComponentes />
  else conteudo = <PaginaTokens />

  return (
    <ProvedorDicas>
      <ProvedorToast>
        {tela ? (
          <div className="h-full">{conteudo}</div>
        ) : (
          <div className="flex h-full flex-col bg-chao">
            <header className="flex h-(--altura-topo) shrink-0 items-center gap-6 border-b border-linha px-4">
              <span className="font-forte text-t1">
                Clipes <span className="font-normal text-t3">design system v2</span>
              </span>
              <nav aria-label="Páginas da galeria" className="flex items-center gap-1">
                {rotas.map((r) => (
                  <a key={r.hash} href={r.hash} aria-current={hash === r.hash ? 'page' : undefined}
                    className={cn('flex h-7 items-center rounded-controle px-2.5 text-t3 no-underline transition-colors duration-(--dur-rapida) hover:bg-area hover:text-t2 aria-[current=page]:text-t1',
                      r.hash.startsWith('#/tela') && 'text-t3')}
                  >
                    {r.rotulo}
                  </a>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-3 text-pequeno text-t3">
                <span className="flex items-center gap-1.5">
                  <Kbd>Alt T</Kbd> tema
                </span>
                <Segmentado<Tema>
                  rotulo="Tema"
                  valor={tema}
                  aoMudar={setTema}
                  opcoes={[
                    { valor: 'escuro', rotulo: <span className="flex items-center gap-1.5"><Moon className="size-[13px] stroke-[1.75]" aria-hidden />Escuro</span> },
                    { valor: 'claro', rotulo: <span className="flex items-center gap-1.5"><Sun className="size-[13px] stroke-[1.75]" aria-hidden />Claro</span> },
                  ]}
                />
              </div>
            </header>
            <main className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[1120px] px-8 pt-10 pb-24">{conteudo}</div>
            </main>
          </div>
        )}
      </ProvedorToast>
    </ProvedorDicas>
  )
}

/* ---------- peças de layout da galeria (só aqui; não fazem parte da API) ---------- */

export function Pagina({ titulo, descricao, children }: { titulo: string; descricao: ReactNode; children: ReactNode }) {
  return (
    <article className="flex flex-col gap-14">
      <header className="flex max-w-[68ch] flex-col gap-2">
        <h1 className="text-destaque font-forte text-t1">{titulo}</h1>
        <p className="text-t2">{descricao}</p>
      </header>
      {children}
    </article>
  )
}

export function Secao({ titulo, descricao, children, id }: { titulo: string; descricao?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="flex flex-col gap-5">
      <header className="flex max-w-[68ch] flex-col gap-1">
        <h2 className="text-titulo font-forte text-t1">{titulo}</h2>
        {descricao && <p className="text-t3">{descricao}</p>}
      </header>
      {children}
    </section>
  )
}

/** Uma linha de estados: rótulo cinza à esquerda, exemplares lado a lado. */
export function Estados({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-start gap-x-8 gap-y-6', className)}>{children}</div>
}

export function Exemplo({ estado, children, className }: { estado: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="text-micro text-t3">{estado}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
