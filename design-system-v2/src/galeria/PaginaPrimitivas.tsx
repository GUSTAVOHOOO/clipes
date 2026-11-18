// Página Primitivas: cada peça com seus estados lado a lado (hover e foco forçados com .demo-hover/.demo-foco).
import { Copy, Download, FolderOpen, Pencil, Play, Scissors, Settings, Trash2 } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { Botao, BotaoIcone, Kbd, type VarianteBotao } from '@/primitivas/Botao'
import { AreaTexto, Busca, Campo, Entrada, Select } from '@/primitivas/Campos'
import { Checkbox, GradeOpcoes, Segmentado, Slider, Switch } from '@/primitivas/Escolhas'
import { ConfirmDialog, Dialogo, Dica, Menu, MenuGrupo, MenuItem, MenuMarcavel, MenuSeparador, Popover } from '@/primitivas/Flutuantes'
import { Abas, Progresso, Separador, Skeleton, Status, useToast, type TomStatus } from '@/primitivas/Indicadores'
import { Estados, Exemplo, Pagina, Secao } from './App'

const variantes: { v: VarianteBotao; rotulo: string; icone?: ReactElement; atalho?: string }[] = [
  { v: 'primario', rotulo: 'Aprovar', atalho: 'A' },
  { v: 'secundario', rotulo: 'Rejeitar', atalho: 'R' },
  { v: 'suave', rotulo: '+1 Frase' },
  { v: 'fantasma', rotulo: 'Abrir no editor', atalho: 'Enter' },
  { v: 'perigo', rotulo: 'Apagar Corte', icone: <Trash2 /> },
]

const tons: TomStatus[] = ['neutro', 'pendente', 'info', 'sucesso', 'aviso', 'perigo', 'rodando', 'pausado']
const rotuloTom: Record<TomStatus, string> = { neutro: 'Sem Fonte', pendente: 'Pendente', info: 'Somente local', sucesso: 'Salvo', aviso: 'Fonte grande', perigo: 'Falhou', rodando: 'Transcrevendo', pausado: 'Pausado' }

export function PaginaPrimitivas() {
  const [check, setCheck] = useState<boolean | 'misto'>(true)
  const [sw, setSw] = useState(true)
  const [sl, setSl] = useState(112)
  const [seg, setSeg] = useState<'p' | 'a' | 'd'>('p')
  const [grade, setGrade] = useState<'k' | 'c' | 's'>('k')
  const [aba, setAba] = useState<'e' | 't' | 'p'>('e')
  const [sel, setSel] = useState<'groq' | 'local' | null>('local')
  const [dialogo, setDialogo] = useState(false)
  const [confirma, setConfirma] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [marcado, setMarcado] = useState(true)
  const toast = useToast()

  return (
    <Pagina titulo="Primitivas" descricao="As peças sem domínio. Cada uma aparece com os estados que o app precisa: normal, hover, foco, desabilitado, carregando, erro e vazio. Hover e foco aparecem forçados para comparar lado a lado; passe o ponteiro e use Tab para ver os de verdade.">
      <Secao titulo="Botão" descricao="Um primário por tela. O atalho mora dentro do botão. Perigo é texto vermelho sobre degrau, nunca fundo vermelho.">
        <div className="flex flex-col gap-10">
          <div className="grid grid-cols-[96px_repeat(5,max-content)] items-center gap-x-8 gap-y-4 overflow-x-auto p-1 -m-1">
            {['', 'normal', 'hover', 'foco', 'desabilitado', 'carregando'].map((e) => (
              <span key={e} className="text-micro text-t3">{e}</span>
            ))}
            {variantes.map(({ v, rotulo, icone, atalho }) => (
              <div key={v} className="contents">
                <span className="text-pequeno text-t2">{v}</span>
                <span><Botao variante={v} icone={icone} atalho={atalho}>{rotulo}</Botao></span>
                <span><Botao variante={v} icone={icone} atalho={atalho} className="demo-hover">{rotulo}</Botao></span>
                <span><Botao variante={v} icone={icone} atalho={atalho} className="demo-foco">{rotulo}</Botao></span>
                <span><Botao variante={v} icone={icone} atalho={atalho} disabled>{rotulo}</Botao></span>
                <span><Botao variante={v} atalho={atalho} carregando>{rotulo}</Botao></span>
              </div>
            ))}
          </div>
          <Estados>
            <Exemplo estado="tamanhos p · m · g">
              <Botao tamanho="p" variante="secundario">Pequeno</Botao>
              <Botao tamanho="m" variante="secundario">Médio</Botao>
              <Botao tamanho="g" variante="primario" icone={<Download />}>Exportar 8 Cortes</Botao>
            </Exemplo>
            <Exemplo estado="ícone (com dica)">
              <BotaoIcone rotulo="Cortar aqui" atalho="S"><Scissors /></BotaoIcone>
              <BotaoIcone rotulo="Copiar"><Copy /></BotaoIcone>
              <BotaoIcone rotulo="Configurações" className="demo-hover"><Settings /></BotaoIcone>
              <BotaoIcone rotulo="Editar" className="demo-foco"><Pencil /></BotaoIcone>
              <BotaoIcone rotulo="Reproduzir" disabled><Play /></BotaoIcone>
            </Exemplo>
            <Exemplo estado="kbd normal · forte">
              <Kbd>Ctrl K</Kbd>
              <Kbd tom="forte">Esc</Kbd>
            </Exemplo>
          </Estados>
        </div>
      </Secao>

      <Secao titulo="Campos" descricao="Sem borda: o campo é um degrau elevado. Rótulo, ajuda e erro ficam ligados por id; o erro diz o problema e a saída.">
        <div className="grid grid-cols-3 gap-x-8 gap-y-6 max-[900px]:grid-cols-1">
          <Campo rotulo="Nome do Projeto" ajuda="Aparece no seletor do topo.">{(p) => <Entrada {...p} defaultValue="Canal Dark História" />}</Campo>
          <Campo rotulo="Hover">{(p) => <Entrada {...p} className="demo-hover" defaultValue="Canal Dark História" />}</Campo>
          <Campo rotulo="Foco">{(p) => <Entrada {...p} className="demo-foco" defaultValue="Canal Dark História" />}</Campo>
          <Campo rotulo="Vazio">{(p) => <Entrada {...p} placeholder="Ex.: Podcast Semanal" />}</Campo>
          <Campo rotulo="Desabilitado" ajuda="Definido na criação do Projeto.">{(p) => <Entrada {...p} disabled defaultValue="pt-BR" />}</Campo>
          <Campo rotulo="Pasta de saída" erro="A pasta não existe mais. Escolha outra ou crie de novo.">{(p) => <Entrada {...p} defaultValue="D:\Cortes\antigos" />}</Campo>
          <Campo rotulo="Busca">{(p) => <Busca id={p.id} rotulo="Buscar Cortes" placeholder="Buscar Cortes…" atalho="/" />}</Campo>
          <Campo rotulo="Provedor de IA">{() => <Select rotulo="Provedor de IA" valor={sel} aoMudar={setSel} opcoes={[{ valor: 'local', rotulo: 'Local (Ollama)', descricao: 'nada sai da máquina' }, { valor: 'groq', rotulo: 'Groq', descricao: 'API remota, paga por uso' }]} />}</Campo>
          <Campo rotulo="Select desabilitado">{() => <Select rotulo="Select desabilitado" valor={null} aoMudar={() => undefined} opcoes={[]} desabilitado placeholder="Sem perfis" />}</Campo>
          <Campo rotulo="Descrição do Corte" className="col-span-full max-w-[560px]">{(p) => <AreaTexto {...p} rows={3} defaultValue="Em março de 2019 ele perdeu tudo. Neste trecho conta o que aprendeu." />}</Campo>
        </div>
      </Secao>

      <Secao titulo="Escolhas" descricao="Marcado é cinza claro, não laranja: o sinal fica para a seleção da tela.">
        <Estados>
          <Exemplo estado="checkbox"><Checkbox marcado={check} aoMudar={setCheck}>Remover silêncios</Checkbox></Exemplo>
          <Exemplo estado="misto"><Checkbox marcado="misto" aoMudar={() => undefined}>3 de 5 Fontes</Checkbox></Exemplo>
          <Exemplo estado="desmarcado"><Checkbox marcado={false} aoMudar={() => undefined}>Narração</Checkbox></Exemplo>
          <Exemplo estado="desabilitado"><Checkbox marcado desabilitado aoMudar={() => undefined}>Legenda</Checkbox></Exemplo>
          <Exemplo estado="switch"><Switch ligado={sw} aoMudar={setSw}>Normalizar loudness</Switch></Exemplo>
          <Exemplo estado="switch desligado"><Switch ligado={false} aoMudar={() => undefined}>Somente local</Switch></Exemplo>
          <Exemplo estado="switch desabilitado"><Switch ligado desabilitado aoMudar={() => undefined}>Divulgação de IA</Switch></Exemplo>
        </Estados>
        <Estados>
          <Exemplo estado="slider" className="w-64"><Slider rotulo="Zoom" valor={sl} aoMudar={setSl} min={100} max={200} textoValor={(v) => `${v}%`} className="w-full" /></Exemplo>
          <Exemplo estado="slider desabilitado" className="w-64"><Slider rotulo="Trilha" valor={30} aoMudar={() => undefined} desabilitado className="w-full" /></Exemplo>
          <Exemplo estado="segmentado"><Segmentado rotulo="Enquadramento" valor={seg} aoMudar={setSeg} opcoes={[{ valor: 'p', rotulo: 'Preencher' }, { valor: 'a', rotulo: 'Ajustar' }, { valor: 'd', rotulo: 'Duplo', desabilitada: true }]} /></Exemplo>
        </Estados>
        <Estados>
          <Exemplo estado="grade de opções" className="w-72">
            <div className="w-full rounded-area bg-elevado p-3">
              <GradeOpcoes rotulo="Estilo da legenda" valor={grade} aoMudar={setGrade} opcoes={[{ valor: 'k', rotulo: 'Karaokê', icone: <Play /> }, { valor: 'c', rotulo: 'Cinema', icone: <Scissors /> }, { valor: 's', rotulo: 'Simples', icone: <Pencil /> }]} />
            </div>
          </Exemplo>
          <Exemplo estado="abas">
            <Abas rotulo="Etapas do Corte" valor={aba} aoMudar={setAba} abas={[{ valor: 'e', rotulo: 'Editar' }, { valor: 't', rotulo: 'Transformar' }, { valor: 'p', rotulo: 'Empacotar', desabilitada: true, dica: 'Disponível depois de aprovar' }]} />
          </Exemplo>
          <Exemplo estado="abas pequenas">
            <Abas tamanho="p" rotulo="Painel" valor="t" aoMudar={() => undefined} abas={[{ valor: 't', rotulo: 'Transcrição' }, { valor: 'i', rotulo: 'Índice' }]} />
          </Exemplo>
        </Estados>
      </Secao>

      <Secao titulo="Estado e progresso" descricao="Estado é ícone + palavra, sempre cinza; o tom só troca o ícone. Progresso é uma linha de 2 px com o número ao lado.">
        <Estados>
          {tons.map((t) => (
            <Exemplo key={t} estado={t}><Status tom={t}>{rotuloTom[t]}</Status></Exemplo>
          ))}
        </Estados>
        <div className="grid max-w-[720px] grid-cols-2 gap-8">
          <Progresso valor={62} rotulo="Transcrevendo live-2026-11-14.mp4" detalhe="62% · faltam 4 min" />
          <Progresso valor={null} rotulo="Medindo silêncios" />
        </div>
        <Estados>
          <Exemplo estado="skeleton" className="w-72">
            <div className="flex w-full flex-col gap-2"><Skeleton className="h-3 w-2/3" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /></div>
          </Exemplo>
          <Exemplo estado="separador" className="w-72"><Separador className="w-full" /></Exemplo>
        </Estados>
      </Secao>

      <Secao titulo="Flutuantes" descricao="Popover, menu, diálogo, confirmação, dica e toast. Só o que flutua ganha sombra.">
        <Estados>
          <Exemplo estado="dica">
            <Dica texto="Definir Entrada" atalho="I"><Botao variante="secundario">Passe o ponteiro</Botao></Dica>
          </Exemplo>
          <Exemplo estado="popover">
            <Popover titulo="Zoom do quadro" gatilho={<Botao variante="secundario">Abrir popover</Botao>}>
              <Slider rotulo="Zoom" valor={sl} aoMudar={setSl} min={100} max={200} textoValor={(v) => `${v}%`} className="w-56" />
            </Popover>
          </Exemplo>
          <Exemplo estado="menu">
            <Menu gatilho={<Botao variante="secundario">Abrir menu</Botao>}>
              <MenuGrupo titulo="Corte">
                <MenuItem icone={<Pencil />} atalho="Enter">Abrir no editor</MenuItem>
                <MenuItem icone={<Copy />} atalho="Ctrl D">Duplicar</MenuItem>
                <MenuItem icone={<FolderOpen />} desabilitado>Mostrar na pasta</MenuItem>
              </MenuGrupo>
              <MenuSeparador />
              <MenuMarcavel marcado={marcado} aoMudar={setMarcado}>Mostrar rejeitados</MenuMarcavel>
              <MenuSeparador />
              <MenuItem icone={<Trash2 />} perigo>Apagar Corte</MenuItem>
            </Menu>
          </Exemplo>
          <Exemplo estado="diálogo"><Botao variante="secundario" onClick={() => setDialogo(true)}>Abrir diálogo</Botao></Exemplo>
          <Exemplo estado="confirmação"><Botao variante="perigo" icone={<Trash2 />} onClick={() => setConfirma(true)}>Apagar Fonte</Botao></Exemplo>
          <Exemplo estado="toast">
            <Botao variante="secundario" onClick={() => toast.add({ title: 'Corte aprovado', description: 'Ele contou como perdeu tudo em 2019' })}>Toast</Botao>
            <Botao variante="secundario" onClick={() => toast.add({ title: 'Exportação falhou', description: 'Disco cheio em D:. Libere 2 GB e tente de novo.', type: 'erro' })}>Toast de erro</Botao>
          </Exemplo>
        </Estados>
        <Dialogo aberto={dialogo} aoMudarAberto={setDialogo} titulo="Renomear Projeto" descricao="O nome aparece no seletor do topo e na pasta de saída."
          rodape={<><Botao onClick={() => setDialogo(false)}>Cancelar</Botao><Botao variante="primario" onClick={() => setDialogo(false)}>Salvar</Botao></>}
        >
          <Campo rotulo="Nome">{(p) => <Entrada {...p} defaultValue="Canal Dark História" />}</Campo>
        </Dialogo>
        <ConfirmDialog aberto={confirma} aoMudarAberto={setConfirma} titulo="Apagar a Fonte e os 12 Cortes dela?" variante="perigo" rotuloConfirmar="Apagar Fonte" ocupado={ocupado}
          descricao="O vídeo original no disco não é tocado. A transcrição e os Cortes somem deste Projeto."
          aoConfirmar={async () => { setOcupado(true); await new Promise((r) => setTimeout(r, 900)); setOcupado(false); setConfirma(false) }}
        />
      </Secao>
    </Pagina>
  )
}
