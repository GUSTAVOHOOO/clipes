// Página Componentes: o catálogo de domínio (02-consolidacao.md) com estados reais.
import { Crop, History } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { ChecklistGuardaCorpos, InstaladorJustInTime } from '@/componentes/Avisos'
import { ContextoCorte } from '@/componentes/ContextoCorte'
import { BannerErroCore, EstadoTela, Esqueleto, FaixaJob } from '@/componentes/Estados'
import { AjusteBorda, ItemCorte, LinhaFrase, LinhaSilencio } from '@/componentes/Linhas'
import { ListaVirtual, TabelaGrade } from '@/componentes/Listas'
import { BarraAcoes, GrupoAjuste, PlayerProxy, TimelineEditor, Transporte } from '@/componentes/Midia'
import { Paleta } from '@/componentes/Paleta'
import { ResumoCustoPrivacidade } from '@/componentes/ResumoCustoPrivacidade'
import { BadgeNota, EixosNota, SeloTipoVideo } from '@/componentes/Selos'
import { BarraStatus, DicaAtalho, Etapas, GatilhoFila, GatilhoPaleta, SeletorProjeto } from '@/componentes/Tela'
import { duracao, usd } from '@/lib/formato'
import { Slider } from '@/primitivas/Escolhas'
import { Progresso, Status } from '@/primitivas/Indicadores'
import { Estados, Exemplo, Pagina, Secao } from './App'
import { cortesSugeridos, duracaoCorteUs, eixos, frasesTimeline, onda, quadro1, quadro2, silenciosTimeline, type CorteSugerido } from './dados'

/** moldura neutra para mostrar um componente de tela inteira em tamanho real */
function Palco({ children, altura }: { children: ReactNode; altura?: number }) {
  return (
    <div className="overflow-hidden rounded-area bg-chao shadow-[inset_0_0_0_1px_var(--linha)]" style={{ height: altura }}>
      {children}
    </div>
  )
}

export function PaginaComponentes() {
  const [selId, setSelId] = useState('c3')
  const [tempo, setTempo] = useState(14_200_000)
  const [extras, setExtras] = useState(true)
  const [aberta, setAberta] = useState<string | null>(null)
  const [paleta, setPaleta] = useState(false)
  const [zoom, setZoom] = useState(112)
  const [removido, setRemovido] = useState(false)
  const quadro = useRef<HTMLDivElement>(null)

  return (
    <Pagina titulo="Componentes" descricao="O catálogo do front v2 montado com as primitivas. Nomes do glossário (Corte, Fonte, Frase, Nota); cada um com os estados que as telas vão pedir.">
      <Secao titulo="Moldura" descricao="Tela é a janela: topo de 40 px com marca, Projeto, 3 etapas, Fila e Comandos; barra de status de 28 px. Nada de caixas, só a linha sob o topo.">
        <Palco>
          <header className="flex h-(--altura-topo) items-center gap-5 border-b border-linha px-4">
            <SeletorProjeto nome="Canal Dark História" outros={['Canal de Cortes']} />
            <Etapas atual="cortes" contadores={{ fontes: '3', cortes: '8' }} />
            <div className="ml-auto flex items-center gap-3">
              <GatilhoFila fila={{ ativos: 2 }} />
              <GatilhoPaleta aoAbrir={() => setPaleta(true)} />
            </div>
          </header>
          <ContextoCorte projetoId="p1" corteAtual={{ corteId: 'k2', candidateId: 14, titulo: 'Como o navegador bloqueou o vazamento', indice: 2, totalAprovados: 8, videoKind: 'transformed', anteriorId: 'k1', proximoId: null }}
            subAbaAtiva="editar" aoAbrirExportacao={() => undefined} mostrarTipo
          />
          <div className="h-16" />
          <BarraStatus esquerda={<><Status tom="sucesso">Salvo</Status><span className="num">Duração efetiva 00:35,6</span></>}
            direita={<><DicaAtalho tecla="Ctrl [">transcrição</DicaAtalho><DicaAtalho tecla="Ctrl ]">último ajuste</DicaAtalho></>}
          />
        </Palco>
        <Estados>
          <Exemplo estado="Corte avulso (sem posição, sem ‹ ›)">
            <div className="w-[760px] max-w-full rounded-area bg-chao shadow-[inset_0_0_0_1px_var(--linha)]">
              <ContextoCorte projetoId="p1" corteAtual={{ corteId: '31', candidateId: null, titulo: 'Trecho marcado à mão', indice: null, totalAprovados: 8, videoKind: 'direct' }} subAbaAtiva="editar" aoAbrirExportacao={() => undefined} />
            </div>
          </Exemplo>
        </Estados>
        <Paleta aberto={paleta} aoMudarAberto={setPaleta} comandos={[
          { id: '1', rotulo: 'Ir para Cortes', grupo: 'Navegar', atalho: 'Ctrl 2', aoExecutar: () => setPaleta(false) },
          { id: '2', rotulo: 'Adicionar Fonte…', grupo: 'Projeto', atalho: 'Ctrl O', aoExecutar: () => setPaleta(false) },
          { id: '3', rotulo: 'Exportar Cortes aprovados', grupo: 'Projeto', atalho: 'Ctrl E', aoExecutar: () => setPaleta(false) },
          { id: '4', rotulo: 'Trocar Perfil de IA', grupo: 'Configurar', desabilitado: true, aoExecutar: () => setPaleta(false) },
        ]} />
      </Secao>

      <Secao titulo="Mídia" descricao="O vídeo é o conteúdo: quadro preto com cantos de 6 px e legenda na cor do vídeo. Transporte e as 5 ações vivem numa linha de 36 px; cada ação abre um popover ao lado do quadro.">
        <div className="flex flex-wrap items-start gap-8">
          <Exemplo estado="prévia 9:16" className="w-44"><PlayerProxy sourceId={1} fonteDisponivel poster={quadro1} startUs={0} endUs={1} modo="previa_9_16" refQuadro={quadro} legenda={{ antes: 'e foi', ativa: 'EXATAMENTE', depois: 'ali' }} tempoAtualUs={0} reproduzindo={false} aoMudarTempoUs={() => undefined} aoMudarReproduzindo={() => undefined} className="w-full" /></Exemplo>
          <Exemplo estado="duplo + simples" className="w-44"><PlayerProxy sourceId={1} fonteDisponivel poster={quadro2} startUs={0} endUs={1} modo="previa_9_16" enquadramento="duplo" legenda={{ ativa: 'de 2019', antes: 'Em março', estilo: 'simples' }} tempoAtualUs={0} reproduzindo={false} aoMudarTempoUs={() => undefined} aoMudarReproduzindo={() => undefined} className="w-full" /></Exemplo>
          <Exemplo estado="Fonte ausente" className="w-44"><PlayerProxy sourceId={1} fonteDisponivel={false} startUs={0} endUs={1} modo="previa_9_16" tempoAtualUs={0} reproduzindo={false} aoMudarTempoUs={() => undefined} aoMudarReproduzindo={() => undefined} aoPedirRelocalizacao={() => undefined} className="w-full" /></Exemplo>
          <div className="flex flex-col gap-4">
            <Exemplo estado="transporte"><Transporte tempoUs={tempo} duracaoUs={duracaoCorteUs} reproduzindo={false} aoAlternar={() => undefined} /></Exemplo>
            <Exemplo estado="transporte tocando, mudo"><Transporte tempoUs={tempo} duracaoUs={duracaoCorteUs} reproduzindo mudo aoAlternar={() => undefined} /></Exemplo>
            <Exemplo estado="barra de ações (abre ao lado do 1º quadro)">
              <BarraAcoes ancora={quadro} aberta={aberta} aoMudarAberta={setAberta} acoes={[
                { id: 'zoom', rotulo: 'Enquadrar', icone: <Crop />, conteudo: <GrupoAjuste rotulo="Zoom" valor={`${zoom}%`}><Slider rotulo="Zoom" valor={zoom} aoMudar={setZoom} min={100} max={200} /></GrupoAjuste> },
                { id: 'hist', rotulo: 'Histórico', icone: <History />, conteudo: <p className="text-pequeno text-t2">Nada desfeito ainda.</p> },
              ]} />
            </Exemplo>
          </div>
        </div>
        <Palco>
          <TimelineEditor windowStartUs={0} windowEndUs={duracaoCorteUs} startUs={2_000_000} endUs={34_000_000} tempoAtualUs={tempo} thumbs={Array.from({ length: 10 }, () => quadro1)} waveValues={onda}
            silences={silenciosTimeline} sentences={frasesTimeline} narracao={[{ inicioUs: 2e6, fimUs: 9e6, rotulo: 'Narração: abertura' }]} trilha={{ rotulo: 'Trilha: Noturno 02 · 18%', sfxUs: [12.8e6] }}
            faixasExtrasAbertas={extras} aoAlternarFaixasExtras={() => setExtras((v) => !v)} aoMoverAgulha={(us) => setTempo(us)} className="border-t-0"
          />
        </Palco>
      </Secao>

      <Secao titulo="Linhas da Transcrição e da Bancada" descricao="Seleção é um degrau elevado com 2 px de sinal à esquerda. Decidido fica em t2; a Nota é o único número forte.">
        <div className="grid grid-cols-2 gap-8 max-[900px]:grid-cols-1">
          <div className="flex flex-col gap-1 rounded-area bg-area p-3">
            <LinhaFrase inicioUs={-4e6} palavras={"Em dois mil e dezoito ninguém achava".split(" ")} fora />
            <LinhaFrase inicioUs={6.1e6} palavras={"O pesquisador abriu um site comum e percebeu".split(" ")} />
            <LinhaSilencio duracaoUs={1.2e6} removido={removido} aoAlternar={() => setRemovido((v) => !v)} />
            <LinhaFrase inicioUs={12.8e6} palavras={"e foi EXATAMENTE ali que tudo mudou".split(" ")} ativa falada={2} />
            <LinhaSilencio duracaoUs={2.8e6} removido />
          </div>
          <div className="flex flex-col rounded-area bg-area p-1.5">
            {cortesSugeridos.slice(0, 5).map((c) => (
              <ItemCorte key={c.id} titulo={c.titulo} inicioUs={c.inicioUs} duracaoUs={c.duracaoUs} nota={c.nota} decisao={c.decisao} selecionado={c.id === 'c3'} />
            ))}
          </div>
        </div>
        <div className="flex max-w-[640px] flex-col gap-2">
          <AjusteBorda rotulo="Início" posicaoUs={751e6} previa="“Em março de 2019 eu perdi tudo que tinha juntado”" />
          <AjusteBorda rotulo="Fim" posicaoUs={799e6} previa="“…ali eu entendi que depender de um único cliente”" />
        </div>
      </Secao>

      <Secao titulo="Nota e tipo de vídeo" descricao="Texto, não pílula: “Nota 8,4” e um motivo de uma linha. Os 5 eixos ficam recolhidos.">
        <Estados>
          <Exemplo estado="detalhe"><BadgeNota nota={8.4} motivo="Gancho forte: abre com ‘perdi tudo em 2019’" /></Exemplo>
          <Exemplo estado="lista"><BadgeNota nota={7.7} modo="lista" /></Exemplo>
          <Exemplo estado="tipo"><SeloTipoVideo tipo="direct" /><SeloTipoVideo tipo="transformed" /></Exemplo>
        </Estados>
        <div className="max-w-[560px]"><EixosNota eixos={eixos} abertoPorPadrao /></div>
      </Secao>

      <Secao titulo="Listas e tabelas" descricao="ListaVirtual tem um único ponto de Tab e anda com as setas; TabelaGrade anda entre células.">
        <div className="grid grid-cols-2 gap-8 max-[900px]:grid-cols-1">
          <div className="flex h-72 flex-col rounded-area bg-area">
            <ListaVirtual<CorteSugerido> ariaLabel="Cortes sugeridos" itens={cortesSugeridos} total={cortesSugeridos.length} alturaItem={56} selecionadoId={selId} aoSelecionar={(c) => setSelId(c.id)}
              renderizarItem={(c, _i, s) => <ItemCorte titulo={c.titulo} inicioUs={c.inicioUs} duracaoUs={c.duracaoUs} nota={c.nota} decisao={c.decisao} selecionado={s} />} className="flex-1 p-1.5"
            />
          </div>
          <TabelaGrade<CorteSugerido> rotulo="Cortes aprovados" linhas={cortesSugeridos.slice(0, 5)} obterId={(c) => c.id} colunas={[
            { id: 't', titulo: 'Corte', render: (c) => <span className="text-t1">{c.titulo}</span> },
            { id: 'd', titulo: 'Duração', largura: '80px', alinhar: 'dir', render: (c) => duracao(c.duracaoUs) },
            { id: 'n', titulo: 'Nota', largura: '64px', alinhar: 'dir', render: (c) => <BadgeNota nota={c.nota} modo="lista" /> },
          ]} />
        </div>
      </Secao>

      <Secao titulo="Estados de tela" descricao="Carregando tem a forma do que vem. Vazio explica o porquê e leva à próxima ação real. Erro do core vira frase humana com a saída.">
        <div className="grid grid-cols-3 gap-8 max-[1000px]:grid-cols-1">
          <Exemplo estado="carregando · lista"><div className="w-full"><Esqueleto variante="lista" quantidade={4} /></div></Exemplo>
          <Exemplo estado="carregando · transcrição"><div className="w-full"><Esqueleto variante="transcricao" quantidade={3} /></div></Exemplo>
          <Exemplo estado="carregando · formulário"><div className="w-full"><Esqueleto variante="formulario" quantidade={3} /></div></Exemplo>
        </div>
        <div className="grid grid-cols-2 gap-8 max-[900px]:grid-cols-1">
          <EstadoTela tipo="vazio" titulo="Nenhuma Fonte ainda" descricao="Adicione um vídeo ou uma live gravada. A transcrição roda neste computador." acaoPrimaria={{ rotulo: 'Adicionar Fonte', aoAcionar: () => undefined }} acaoSecundaria={{ rotulo: 'Colar link', aoAcionar: () => undefined }} />
          <div className="flex flex-col gap-4">
            <EstadoTela compacto tipo="parcial" titulo="3 Fontes ainda transcrevendo" descricao="Os Cortes delas aparecem aqui quando terminar." />
            <EstadoTela compacto tipo="sem_permissao" titulo="Pasta sem permissão de escrita" descricao="Escolha outra pasta de saída em Exportação." acaoPrimaria={{ rotulo: 'Escolher pasta', aoAcionar: () => undefined }} />
          </div>
        </div>
        <div className="flex max-w-[720px] flex-col gap-4">
          <BannerErroCore erro={{ code: 'provider_unreachable', message: 'connect ETIMEDOUT 104.18.2.1:443', retryable: true }} acaoRecuperacao={{ rotulo: 'Tentar de novo', aoAcionar: () => undefined }} acaoSecundaria={{ rotulo: 'Usar Perfil local', aoAcionar: () => undefined }} permitirRelato aoDispensar={() => undefined} />
          <FaixaJob rotulo="Transcrevendo live-2026-11-14.mp4" detalhe="62% · faltam 4 min" aoCancelar={() => undefined}>
            <Progresso compacto valor={62} rotulo="Transcrição" />
          </FaixaJob>
        </div>
      </Secao>

      <Secao titulo="Custo, privacidade e componentes sob demanda" descricao="Antes de qualquer coisa sair da máquina: para onde vai, quanto custa e o que fica. Componentes pesados são oferecidos na hora em que fazem falta.">
        <div className="grid grid-cols-2 gap-8 max-[900px]:grid-cols-1">
          <ResumoCustoPrivacidade tarefa="Sugerir Cortes de 3 Fontes" perfil={{ id: 'g', label: 'Groq', kind: 'groq', model: 'llama-4-scout' }} localidade="remoto" saiDaMaquina host="api.groq.com"
            estimativa={{ kind: 'usd', minMicroUsd: 18_000, maxMicroUsd: 42_000, janelas: 14 }} orcamento={{ restanteMicroUsd: 4_200_000 }} consentimentoPendente aoConfirmarConsentimento={() => undefined}
          />
          <ResumoCustoPrivacidade tarefa="Sugerir Cortes de 3 Fontes" perfil={{ id: 'l', label: 'Local', kind: 'local', model: 'qwen3:8b' }} localidade="local" saiDaMaquina={false} estimativa={{ kind: 'zero' }} />
        </div>
        <p className="text-pequeno text-t3">Orçamento restante neste mês: <span className="num">{usd(4_200_000)}</span></p>
        <div className="grid grid-cols-3 gap-8 max-[1000px]:grid-cols-1">
          <InstaladorJustInTime recurso="yunet" aoConcluir={() => undefined} aoFechar={() => undefined} />
          <InstaladorJustInTime recurso="tts" aoConcluir={() => undefined} estado="baixando" progresso={38} />
          <InstaladorJustInTime recurso="yunet" aoConcluir={() => undefined} estado="erro" />
        </div>
        <div className="max-w-[640px]">
          <ChecklistGuardaCorpos escopo="single" abertoPorPadrao mostrarDivulgacaoIa itens={[
            { id: '1', estado: 'ok', titulo: 'Legenda revisada', detalhe: 'nenhuma palavra com confiança baixa' },
            { id: '2', estado: 'atencao', titulo: 'Música de terceiros na Fonte', detalhe: '00:12 a 00:31, pode gerar reivindicação', acao: { rotulo: 'Silenciar trecho', aoAcionar: () => undefined } },
            { id: '3', estado: 'pendente', titulo: 'Divulgação de conteúdo sintético', detalhe: 'a Narração usa voz sintética' },
          ]} />
        </div>
      </Secao>
    </Pagina>
  )
}
