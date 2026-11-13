import { useState, type ReactNode } from 'react'
import { Check, Copy, Plus, X } from 'lucide-react'
import { Tela, CabecalhoPagina } from '@/components/shell/Tela'
import { Button, IconButton } from '@/components/ui/Button'
import { Campo, Input, Textarea } from '@/components/ui/Field'
import { NumberScrub } from '@/components/ui/NumberScrub'
import { Select } from '@/components/ui/Select'
import { Switch } from '@/components/ui/Switch'
import { Segmented } from '@/components/ui/Segmented'
import { Abas } from '@/components/ui/Tabs'
import { Dialog } from '@/components/ui/Dialog'
import { MenuContexto } from '@/components/ui/ContextMenu'
import { Menu, MenuItem } from '@/components/ui/Menu'
import { Popover } from '@/components/ui/Popover'
import { Tip } from '@/components/ui/Tooltip'
import { Status, type TomStatus } from '@/components/ui/Status'
import { Progresso } from '@/components/ui/Progress'
import { Kbd } from '@/components/ui/Kbd'
import { avisar } from '@/components/ui/Toast'
import { Estado, Esqueleto } from '@/components/ui/Estado'
import { ListaVirtual } from '@/components/ui/VirtualList'
import { PreviewCorte } from '@/components/editor/Preview'
import { cortes } from '@/data/dados'
import { useRota } from '@/lib/rota'
import { useTema } from '@/lib/tema'
import { useComandos } from '@/lib/comandos'
import { cn } from '@/lib/cn'

const secoes = [
  { id: 'cores', nome: 'Cores e tokens' },
  { id: 'tipografia', nome: 'Tipografia' },
  { id: 'controles', nome: 'Controles' },
  { id: 'camadas', nome: 'Camadas' },
  { id: 'estados', nome: 'Estados e filas' },
  { id: 'listas', nome: 'Listas e teclado' },
  { id: 'video', nome: 'Vídeo e legenda' },
]
export default function Galeria() {
  const { partes } = useRota()
  const s = secoes.find((s) => s.id === partes[1]) ?? secoes[0]
  const { efetivo, definir } = useTema()
  return (
    <Tela
      titulo="Galeria"
      direita={
        <Button tamanho="sm" onClick={() => definir(efetivo === 'escuro' ? 'claro' : 'escuro')}>
          Tema {efetivo === 'escuro' ? 'claro' : 'escuro'}
        </Button>
      }
    >
      <div className="mx-auto flex h-full max-w-[1200px] gap-10 overflow-auto px-8 py-8">
        <nav aria-label="Galeria" className="w-44 shrink-0">
          <p className="mb-4 px-2 text-xs text-fg-3">Design system · Foco</p>
          {secoes.map((sec) => (
            <a
              key={sec.id}
              href={`#/galeria/${sec.id}`}
              aria-current={s.id === sec.id ? 'page' : undefined}
              className={cn(
                'foco flex min-h-8 items-center rounded-md px-2 text-sm',
                s.id === sec.id ? 'bg-selected' : 'text-fg-3 hover:bg-hover hover:text-fg',
              )}
            >
              {sec.nome}
            </a>
          ))}
          <p className="mt-8 px-2 text-xs leading-relaxed text-fg-3">
            Peças reais da interface, com os mesmos tokens e comandos das telas.
          </p>
        </nav>
        <section className="min-w-0 flex-1 pb-10">
          <CabecalhoPagina
            titulo={s.nome}
            descricao="Grafite quente, contraste legível e ferramentas que recuam diante do conteúdo."
          />
          <div className="mt-8">
            {s.id === 'cores' ? (
              <Cores />
            ) : s.id === 'tipografia' ? (
              <Tipografia />
            ) : s.id === 'controles' ? (
              <Controles />
            ) : s.id === 'camadas' ? (
              <Camadas />
            ) : s.id === 'estados' ? (
              <Estados />
            ) : s.id === 'listas' ? (
              <Listas />
            ) : (
              <Video />
            )}
          </div>
        </section>
      </div>
    </Tela>
  )
}
function Grupo({ titulo, descricao, children }: { titulo: string; descricao?: string; children: ReactNode }) {
  return (
    <section className="mb-8 border-t border-line pt-5">
      <h2 className="mb-1 text-sm font-medium">{titulo}</h2>
      {descricao && <p className="mb-4 text-xs text-fg-3">{descricao}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}
function Cores() {
  const tokens = [
    'canvas',
    'surface',
    'field',
    'hover',
    'selected',
    'raised',
    'fg',
    'fg-2',
    'fg-3',
    'line',
    'line-strong',
    'control-border',
    'accent',
    'danger',
    'warning',
    'success',
    'info',
    'playhead',
    'wave',
    'handle',
  ]
  return (
    <>
      <div className="grid grid-cols-4 gap-x-6 gap-y-5">
        {tokens.map((t) => (
          <div key={t}>
            <div className="h-16 rounded-md border border-line-strong" style={{ background: `var(--${t})` }} />
            <p className="mt-2 font-mono text-xs text-fg-2">--{t}</p>
          </div>
        ))}
      </div>
      <Grupo
        titulo="Um acento com função"
        descricao="Âmbar sinaliza seleção, palavra ativa, playhead e foco. A ação primária usa texto invertido."
      >
        <div className="flex items-center gap-4">
          <Button variante="primario">Exportar Corte</Button>
          <span className="rounded-sm bg-accent-subtle px-2 py-1 text-accent-text">Palavra ativa</span>
          <Kbd atalho="Ctrl+K" />
        </div>
      </Grupo>
    </>
  )
}
function Tipografia() {
  return (
    <>
      <div className="divide-y divide-line">
        {['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'].map((t) => (
          <div key={t} className="flex items-baseline gap-8 py-4">
            <span className="w-16 font-mono text-xs text-fg-3">text-{t}</span>
            <span style={{ fontSize: `var(--text-${t})` }}>O vídeo e a fala na frente.</span>
          </div>
        ))}
      </div>
      <Grupo
        titulo="Tempos e comandos"
        descricao="Geist Mono, números tabulares. Inter Variable nos rótulos e no texto."
      >
        <p className="timecode text-xl">
          00:21:08.320 <span className="text-fg-3">/ 02:02:21</span>
        </p>
        <div className="mt-4 flex gap-2">
          <Kbd atalho="Space" />
          <Kbd atalho="Ctrl+K" />
          <Kbd atalho="Alt+ArrowRight" />
        </div>
      </Grupo>
    </>
  )
}
function Controles() {
  const [valor, setValor] = useState<number | null>(50)
  const [idioma, setIdioma] = useState('pt')
  const [ligado, setLigado] = useState(true)
  const [seg, setSeg] = useState('M')
  const [aba, setAba] = useState('transcricao')
  return (
    <>
      <Grupo titulo="Botões" descricao="Uma ação primária por contexto. 28, 32 e 36 px; foco visível.">
        <div className="flex flex-wrap items-center gap-3">
          <Button variante="primario" icone={<Plus size={14} />}>
            Importar Fonte
          </Button>
          <Button icone={<Check size={14} />}>Aprovar</Button>
          <Button variante="fantasma">Cancelar</Button>
          <Button variante="perigo">Remover</Button>
          <Button disabled>Indisponível</Button>
          <Button carregando>Exportando</Button>
          <Tip rotulo="Fechar" atalho="Escape">
            <IconButton rotulo="Fechar">
              <X size={14} />
            </IconButton>
          </Tip>
        </div>
      </Grupo>
      <Grupo titulo="Campos" descricao="Rótulos visíveis; erro e ajuda junto ao controle.">
        <div className="grid grid-cols-2 gap-5">
          <Campo rotulo="Título do Corte">
            <Input defaultValue="Uma conversa muda tudo" />
          </Campo>
          <Campo rotulo="Endereço da Fonte" erro="Informe uma URL completa.">
            <Input defaultValue="youtube" aria-invalid="true" />
          </Campo>
          <Campo rotulo="Volume" descricao="Arraste o rótulo ou use as setas; Alt faz o ajuste fino.">
            <NumberScrub rotulo="Volume" unidade="%" valor={valor} onChange={setValor} min={0} max={100} />
          </Campo>
          <Campo rotulo="Idioma">
            <Select
              rotulo="Idioma de demonstração"
              valor={idioma}
              onChange={setIdioma}
              opcoes={[
                { valor: 'pt', rotulo: 'Português' },
                { valor: 'en', rotulo: 'English' },
              ]}
            />
          </Campo>
          <Campo rotulo="Roteiro" className="col-span-2">
            <Textarea aria-label="Roteiro de demonstração" defaultValue="Revise o texto antes de gerar a Narração." />
          </Campo>
        </div>
      </Grupo>
      <Grupo titulo="Escolhas e abas">
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-3 text-sm">
            <Switch rotulo="Legenda karaokê" ligado={ligado} onChange={setLigado} />
            Legenda karaokê
          </label>
          <Segmented
            rotulo="Tamanho da legenda"
            valor={seg}
            onChange={setSeg}
            opcoes={['P', 'M', 'G'].map((v) => ({ valor: v, rotulo: v }))}
          />
        </div>
        <div className="mt-6">
          <Abas
            rotulo="Ferramentas de exemplo"
            valor={aba}
            onChange={setAba}
            abas={[
              { valor: 'transcricao', rotulo: 'Transcrição', atalho: 'T' },
              { valor: 'enquadramento', rotulo: 'Enquadramento', atalho: 'E' },
            ]}
          />
        </div>
      </Grupo>
    </>
  )
}
function Camadas() {
  const [aberto, setAberto] = useState(false)
  useComandos([
    { id: 'galeria-dialog', titulo: 'Abrir diálogo de exemplo', grupo: 'Galeria', executar: () => setAberto(true) },
  ])
  return (
    <>
      <Grupo titulo="Camadas flutuantes" descricao="Esc fecha e devolve o foco. Menus usam setas e Enter.">
        <div className="flex flex-wrap gap-4">
          <Menu gatilho={<Button>Menu de ações</Button>}>
            <MenuItem onSelect={() => avisar('Ação de exemplo executada')}>Duplicar estilo</MenuItem>
            <MenuItem onSelect={() => avisar('Título copiado · exemplo')} icone={<Copy size={14} />}>
              Copiar título
            </MenuItem>
          </Menu>
          <Popover titulo="Permissão da Fonte" gatilho={<Button>Popover</Button>}>
            <p className="text-sm text-fg-2">Confirme que pode usar a Fonte e guarde a comprovação no Projeto.</p>
          </Popover>
          <Button onClick={() => setAberto(true)}>Abrir diálogo</Button>
          <Button onClick={() => avisar.desfazer('Corte rejeitado · exemplo', () => avisar('Rejeição desfeita'))}>
            Mostrar aviso
          </Button>
        </div>
      </Grupo>
      <Grupo
        titulo="Menu de contexto"
        descricao="Clique direito ou Shift+F10. As mesmas ações também ficam no menu visível."
      >
        <MenuContexto
          itens={[
            { id: 'copiar', rotulo: 'Copiar título', executar: () => avisar('Título copiado · exemplo') },
            { id: 'remover', rotulo: 'Remover exemplo', perigo: true, executar: () => avisar('Exemplo removido') },
          ]}
        >
          <div className="border border-dashed border-control-border p-8 text-sm text-fg-2">
            Título do Corte · abra o menu de contexto
          </div>
        </MenuContexto>
      </Grupo>
      <Dialog
        aberto={aberto}
        onAbrir={setAberto}
        titulo="Salvar estilo de legenda"
        descricao="Diálogo de exemplo. O foco fica nesta camada até você fechar."
        rodape={
          <>
            <Button onClick={() => setAberto(false)}>Cancelar</Button>
            <Button
              variante="primario"
              onClick={() => {
                setAberto(false)
                avisar.sucesso('Estilo salvo · exemplo')
              }}
            >
              Salvar estilo
            </Button>
          </>
        }
      >
        <Campo rotulo="Nome do estilo">
          <Input defaultValue="Meu estilo" />
        </Campo>
      </Dialog>
    </>
  )
}
function Estados() {
  return (
    <>
      <Grupo titulo="Estados com nome" descricao="A cor reforça o texto e o ícone.">
        <div className="flex flex-wrap gap-5">
          {(
            [
              ['rascunho', 'Rascunho'],
              ['andamento', 'Transcrevendo'],
              ['sucesso', 'Pronto'],
              ['atencao', 'Revisar'],
              ['perigo', 'Falhou'],
              ['espera', 'Na fila'],
              ['rejeitado', 'Rejeitado'],
            ] as [TomStatus, string][]
          ).map(([tom, nome]) => (
            <Status key={tom} tom={tom}>
              {nome}
            </Status>
          ))}
        </div>
        <div className="mt-6 max-w-96">
          <div className="mb-2 flex justify-between text-xs text-fg-3">
            <span>Transcrevendo Fonte</span>
            <span className="timecode">42%</span>
          </div>
          <Progresso valor={0.42} rotulo="Transcrição 42%" />
        </div>
      </Grupo>
      <Grupo titulo="Vazio, erro e carregamento">
        <div className="grid grid-cols-2 divide-x divide-line">
          <Estado
            titulo="Seu primeiro Corte começa aqui"
            descricao="Importe uma Fonte para revisar as Frases sugeridas."
            acao={<Button onClick={() => (location.hash = '/fontes')}>Importar Fonte</Button>}
          />
          <Estado
            tipo="erro"
            titulo="A Fonte está indisponível"
            descricao="Confira a Permissão e tente importar novamente."
            acao={<Button onClick={() => avisar('Nova tentativa · exemplo')}>Tentar novamente</Button>}
          />
        </div>
        <Esqueleto linhas={2} />
      </Grupo>
    </>
  )
}
const linhas = Array.from({ length: 1000 }, (_, i) => ({
  id: `frase-${i}`,
  texto: `Frase ${String(i + 1).padStart(4, '0')} · A Transcrição mantém o contexto da Fonte.`,
}))
function Listas() {
  const [selecionada, setSelecionada] = useState('Nenhuma Frase aberta')
  return (
    <>
      <Grupo
        titulo="Lista virtualizada"
        descricao="Mil Frases, apenas as linhas visíveis no DOM. Setas, Home e End navegam; Enter abre."
      >
        <ListaVirtual
          itens={linhas}
          chave={(i) => i.id}
          render={(i) => i.texto}
          rotulo="Frases de exemplo"
          onSelecionar={(i) => setSelecionada(i.texto)}
        />
        <p role="status" className="mt-4 text-xs text-fg-2">
          {selecionada}
        </p>
      </Grupo>
      <Grupo titulo="Um comando, dois caminhos" descricao="Botão, paleta e atalho chamam a mesma ação.">
        <div className="flex items-center gap-3">
          <Kbd atalho="Ctrl+K" />
          <span className="text-sm text-fg-2">Buscar uma ação em qualquer tela.</span>
        </div>
      </Grupo>
    </>
  )
}
function Video() {
  return (
    <Grupo
      titulo="Preview 9:16 com karaokê"
      descricao="Quadro local de Tears of Steel, Blender Foundation, CC-BY 3.0. A edição usa a mesma peça."
    >
      <div className="flex items-center gap-10">
        <PreviewCorte
          corte={cortes[0]}
          grupo={cortes[0].palavras.slice(0, 3)}
          ativa={cortes[0].palavras[0]?.id}
          className="h-[420px]"
        />
        <div className="space-y-4 text-sm text-fg-2">
          <p>Legenda é conteúdo do vídeo e usa as cores do estilo.</p>
          <p>O fundo e os controles acompanham o tema da interface.</p>
          <a href="#/corte/c1/editar" className="foco inline-flex min-h-8 items-center underline underline-offset-4">
            Abrir editor completo
          </a>
        </div>
      </div>
    </Grupo>
  )
}
