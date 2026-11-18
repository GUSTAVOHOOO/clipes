// Família de estados de tela: <Esqueleto> (carregando), <EstadoTela> (vazio/parcial/sem permissão)
// e <BannerErroCore> (erro do núcleo traduzido, com ação de recuperação e detalhe técnico recolhido).
import { CircleAlert, CircleDashed, Lock, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Botao } from '@/primitivas/Botao'
import { Skeleton } from '@/primitivas/Indicadores'

export interface EsqueletoProps {
  variante: 'lista' | 'cards' | 'formulario' | 'transcricao' | 'painel' | 'linha'
  quantidade?: number
  rotuloAcessivel?: string
}

export function Esqueleto({ variante, quantidade = 5, rotuloAcessivel = 'Carregando' }: EsqueletoProps) {
  const itens = Array.from({ length: quantidade }, (_, i) => i)
  // larguras variadas para não parecer uma grade de tijolos
  const larg = ['w-[82%]', 'w-[64%]', 'w-[90%]', 'w-[71%]', 'w-[56%]']
  return (
    <div role="status" aria-label={rotuloAcessivel} aria-busy className="w-full">
      {variante === 'linha' && <Skeleton className="h-3 w-2/3" />}
      {variante === 'lista' && (
        <div className="flex flex-col gap-1">
          {itens.map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className={cn('h-3', larg[i % 5])} />
                <Skeleton className="h-2.5 w-20" />
              </div>
              <Skeleton className="h-3.5 w-7" />
            </div>
          ))}
        </div>
      )}
      {variante === 'transcricao' && (
        <div className="flex flex-col gap-4 px-2.5 py-2">
          {itens.map((i) => (
            <div key={i} className="grid grid-cols-[52px_1fr] gap-2.5">
              <Skeleton className="h-3 w-11" />
              <div className="flex flex-col gap-2">
                <Skeleton className={cn('h-3', larg[i % 5])} />
                <Skeleton className={cn('h-3', larg[(i + 2) % 5])} />
              </div>
            </div>
          ))}
        </div>
      )}
      {variante === 'cards' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
          {itens.map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="aspect-[9/16] w-full rounded-area" />
              <Skeleton className={cn('h-3', larg[i % 5])} />
            </div>
          ))}
        </div>
      )}
      {variante === 'formulario' && (
        <div className="flex flex-col gap-4">
          {itens.map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-7 w-full" />
            </div>
          ))}
        </div>
      )}
      {variante === 'painel' && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-32 w-full rounded-area" />
        </div>
      )}
    </div>
  )
}

export interface EstadoTelaProps {
  tipo: 'vazio' | 'parcial' | 'sem_permissao'
  titulo: string
  descricao: string
  acaoPrimaria?: { rotulo: string; aoAcionar: () => void }
  acaoSecundaria?: { rotulo: string; aoAcionar: () => void }
  /** faixa no topo de listas/sub-abas em vez do bloco centrado */
  compacto?: boolean
}

const iconeEstado = { vazio: CircleDashed, parcial: CircleDashed, sem_permissao: Lock }

/** Explica o porquê em PT-BR e leva à próxima ação real com um único primário. */
export function EstadoTela({ tipo, titulo, descricao, acaoPrimaria, acaoSecundaria, compacto }: EstadoTelaProps) {
  const Icone = iconeEstado[tipo]
  if (compacto)
    return (
      <div role="status" className="flex items-center gap-3 rounded-area bg-area px-3 py-2">
        <Icone className="size-[15px] shrink-0 stroke-[1.75] text-t3" aria-hidden />
        <p className="min-w-0 flex-1 text-pequeno">
          <span className="text-t1">{titulo}</span> <span className="text-t3">{descricao}</span>
        </p>
        {acaoSecundaria && (
          <Botao tamanho="p" onClick={acaoSecundaria.aoAcionar}>
            {acaoSecundaria.rotulo}
          </Botao>
        )}
        {acaoPrimaria && (
          <Botao tamanho="p" variante="secundario" onClick={acaoPrimaria.aoAcionar}>
            {acaoPrimaria.rotulo}
          </Botao>
        )}
      </div>
    )
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="flex max-w-[44ch] flex-col items-start gap-3">
        <Icone className="size-5 stroke-[1.5] text-t3" aria-hidden />
        <h2 className="text-titulo font-forte tracking-[-0.01em] text-balance text-t1">{titulo}</h2>
        <p className="text-t2">{descricao}</p>
        {(acaoPrimaria || acaoSecundaria) && (
          <div className="mt-2 flex gap-2">
            {acaoPrimaria && (
              <Botao variante="primario" onClick={acaoPrimaria.aoAcionar}>
                {acaoPrimaria.rotulo}
              </Botao>
            )}
            {acaoSecundaria && <Botao onClick={acaoSecundaria.aoAcionar}>{acaoSecundaria.rotulo}</Botao>}
          </div>
        )}
      </div>
    </div>
  )
}

export interface BannerErroCoreProps {
  erro: { code: string; message: string; usage?: unknown; retryable?: boolean }
  acaoRecuperacao?: { rotulo: string; aoAcionar: () => void }
  acaoSecundaria?: { rotulo: string; aoAcionar: () => void }
  permitirRelato?: boolean
  aoDispensar?: () => void
  /** mapeador CoreError.code → mensagem humana (Arquitetura §6) */
  traduzir?: (code: string) => { titulo: string; explicacao?: string } | undefined
}

const mapaPadrao: Record<string, { titulo: string; explicacao?: string }> = {
  provider_unreachable: { titulo: 'O Provedor não respondeu.', explicacao: 'Confira a conexão ou a chave do Perfil e tente de novo.' },
  source_missing: { titulo: 'A Fonte não está mais no lugar.', explicacao: 'Localize o arquivo para continuar.' },
  editor_save_failed: { titulo: 'Não deu para salvar a edição.', explicacao: 'Suas mudanças continuam aqui; tente salvar de novo.' },
  budget_exceeded: { titulo: 'O teto de gasto foi atingido.', explicacao: 'Aumente o teto em Custos ou use um Perfil local.' },
}

/** Erro acionável: título humano, recuperação e detalhe técnico recolhido. Único lugar com a cor de erro. */
export function BannerErroCore({ erro, acaoRecuperacao, acaoSecundaria, permitirRelato, aoDispensar, traduzir }: BannerErroCoreProps) {
  const t = traduzir?.(erro.code) ?? mapaPadrao[erro.code] ?? { titulo: 'Algo deu errado nesta etapa.', explicacao: 'Tente de novo; se repetir, mande um relato.' }
  return (
    <div role="alert" className="flex items-start gap-3 rounded-area bg-area px-3 py-2.5">
      <CircleAlert className="mt-0.5 size-[15px] shrink-0 stroke-[1.75] text-erro" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-t1">{t.titulo}</p>
        {t.explicacao && <p className="text-pequeno text-t2">{t.explicacao}</p>}
        <details className="group mt-0.5 text-pequeno text-t3">
          <summary className="w-fit cursor-pointer list-none rounded-controle hover:text-t2 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Ver detalhe técnico</span>
            <span className="hidden group-open:inline">Ocultar detalhe técnico</span>
          </summary>
          <code className="mt-1.5 block rounded-controle bg-chao px-2 py-1.5 font-mono text-micro break-all text-t2">
            {erro.code}: {erro.message}
          </code>
          {permitirRelato && (
            <a href="#/relatos?tipo=bug" className="mt-1.5 inline-block text-t2 underline hover:text-t1">
              Mandar relato com este erro
            </a>
          )}
        </details>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {acaoSecundaria && (
          <Botao tamanho="p" onClick={acaoSecundaria.aoAcionar}>
            {acaoSecundaria.rotulo}
          </Botao>
        )}
        {acaoRecuperacao && (
          <Botao tamanho="p" variante="secundario" onClick={acaoRecuperacao.aoAcionar}>
            {acaoRecuperacao.rotulo}
          </Botao>
        )}
        {aoDispensar && (
          <Botao tamanho="p" className="w-6 px-0" aria-label="Dispensar" onClick={aoDispensar}>
            <X />
          </Botao>
        )}
      </div>
    </div>
  )
}

/** Faixa de job rodando: mantém o conteúdo e mostra progresso + Cancelar. */
export function FaixaJob({ rotulo, detalhe, children, aoCancelar }: { rotulo: string; detalhe?: ReactNode; children?: ReactNode; aoCancelar?: () => void }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-area bg-area px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline justify-between gap-3 text-pequeno">
          <span className="text-t1">{rotulo}</span>
          {detalhe && <span className="num text-t3">{detalhe}</span>}
        </p>
        {children && <div className="mt-1.5">{children}</div>}
      </div>
      {aoCancelar && (
        <Botao tamanho="p" onClick={aoCancelar}>
          Cancelar
        </Botao>
      )}
    </div>
  )
}
