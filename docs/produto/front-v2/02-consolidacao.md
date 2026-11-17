# Consolidação dos Pacotes de Telas — Front v2 (Clipes)

Este documento consolida [01-arquitetura.md](./01-arquitetura.md) e os 6 pacotes de especificação da Fase 3 em [docs/produto/front-v2/telas/](./telas/) (`A` a `F`), conferindo todos os contratos contra [docs/produto/funcionalidades.md](../funcionalidades.md), os domínios [01](../funcionalidades/01-instalacao-e-sistema.md)–[07](../funcionalidades/07-provedores-jobs-e-eventos.md), [90-inventario-ui-atual.md](../funcionalidades/90-inventario-ui-atual.md), [GLOSSARY.md](../../../GLOSSARY.md), os [ADRs](../../adr/0001-dois-tipos-de-video-e-regras-de-transformacao.md) e o código em `core/src/`, `src-tauri/src/main.rs`, `src/lib/` e `design-system/src/components/`.

---

## Resumo

As 22 telas e superfícies dos pacotes **A–F** estão especificadas com cobertura completa das macro-etapas, fluxos do **Corte direto** e **Vídeo transformado**, estados padronizados, máquina de eventos `core-progress` e requisitos WCAG 2.2 AA. Todo o catálogo de comandos do núcleo com valor direto de UI (além de 10 comandos auxiliares internos/cliente) tem destino mapeado. Dois pontos de entrada de arquitetura foram resolvidos pela inspeção do código: `:corteId` deve identificar `candidateId` para Cortes da seleção (pois `clipId` só nasce ao chamar `editor.open`, enquanto Transformar/Empacotar exigem `candidate`) e o agrupamento VAD `#279` (`transcription.grouping`) já está implementado no núcleo Rust (`core/src/components/hardware.rs:1084-1107`). Em 17/11 o dev aprovou as recomendações dos 11 pontos de produto/arquitetura da Seção 3, e as 10 inconsistências entre pacotes foram aplicadas (a 10 parcialmente: vale o catálogo canônico, sem reescrever os pacotes). Falta para a **Fase 4 (mockups e design system)** detalhar os wireframes das 5 abas do Inspetor e do `Índice do Corte` no **Pacote D**, que é funcionalmente completo mas condensado visualmente. Para a **Fase 5 (tickets)**, restam 3 correções de núcleo bloqueantes, 11 melhorias de núcleo e a remoção dos portões de query string + implementação dos handlers ausentes no mock TS.

---

## Catálogo de componentes compartilhados

Nomes canônicos unificados em PT-BR e alinhados às primitivas já existentes em `design-system/src/components/`.

### 1. `<Tela>` (Shell da janela) e moldura (`<BarraSuperior>`, `<SeletorProjeto>`, `<BarraStatus>`)
* **Apelidos nos pacotes:** `<Tela>` (`A`), `<ShellGlobal>` (`E`), *Shell* (`B`, `C`, `D`, `F`).
* **Base existente:** `design-system/src/components/shell/Tela.tsx`.
* **Interface unificada:**
  ```ts
  interface TelaProps {
    titulo: string;
    meio?: React.ReactNode;        // slot para <ContextoCorte> (Pacotes D/E)
    direita?: React.ReactNode;
    mostrarEtapas?: boolean;       // false sem Projeto aberto
    modoMinimo?: boolean;          // true em #/assistente
    children: React.ReactNode;
  }
  ```
* **Comportamento:** Ocupa `100vw × 100vh` sem scroll na moldura externa (`min-h-0 flex-1`). Consome o Store de Projeto Ativo, Store de Fila (`core-progress`) e Store do Editor. Exibe Barra Superior (44 px: `<SeletorProjeto>`, 3 macro-etapas com contadores, selo permanente `Somente local`, indicador de Orçamento/Pausa, gatilho da Fila `Ctrl/Cmd+J`, `<Paleta>` `Ctrl/Cmd+K`, Configurações `Ctrl/Cmd+,`, menu `Relatos`/`Sobre`/`?`) e Barra de Status (28–32 px: estado de autosave `Salvo`/`Salvando…`/`editor_save_failed`, aviso de backup falho, resumo do job ativo, dica `F6` e alternadores de painéis).
* **Usado em:** Todas as telas (`A`, `B`, `C`, `D`, `E`, `F`).

### 2. `<ContextoCorte>`
* **Apelidos nos pacotes:** `<ContextoCorte>` (`A`, `D`, `E`).
* **Base existente:** `design-system/src/components/shell/ContextoCorte.tsx`.
* **Interface unificada:**
  ```ts
  interface ContextoCorteProps {
    projetoId: string;
    corteAtual: {
      corteId: string; // numeric candidateId ou "avulso-<sourceId>-<startId>-<endId>"
      candidateId: number | null;
      titulo: string;
      indice: number | null; // null quando avulso
      totalAprovados: number;
      videoKind: 'direct' | 'transformed';
      anteriorId?: string | null;
      proximoId?: string | null;
    };
    subAbaAtiva: 'editar' | 'transformar' | 'empacotar';
    aoAntesDeNavegar?: () => Promise<boolean>; // ex.: editor.flush ao sair de Editar
    aoAbrirExportacao: () => void;
    aoConverterTransformado?: () => void; // desabilitado até ticket Rust #2
  }
  ```
* **Comportamento:** Montado no slot `meio` / sub-cabeçalho de `<Tela>` em `#/projeto/:id/corte/:corteId/*`. Exibe retorno a Cortes, `< Anterior` / `Próximo aprovado >` (`Alt+PageUp` / `Alt+PageDown`), `<SeloTipoVideo>`, ação discreta *"Converter em Vídeo transformado"* (desabilitada enquanto não houver comando no núcleo), `<nav aria-label="Etapas do Corte">` com `Editar`, `Transformar` *(omitida se `videoKind === 'direct'` ou `candidateId === null`)* e `Empacotar` *(omitida se `candidateId === null`)*, e botão único **"Exportar Corte"** (`Ctrl/Cmd+E`).
* **Usado em:** Pacote D (`Superfície 1`, `Editar`) e Pacote E (`Transformar`, `Empacotar`).

### 3. `<Paleta>`
* **Apelidos nos pacotes:** `<Paleta>` (`A`), *Paleta de comandos `Ctrl/Cmd+K`* (`B`, `C`, `D`, `E`, `F`).
* **Base existente:** `design-system/src/components/shell/Paleta.tsx` e `src/lib/comandos.tsx` (`useComandos`).
* **Comportamento:** Modal pesquisável via `Ctrl/Cmd+K` (funciona inclusive dentro de inputs). Lê dinamicamente comandos registrados por escopo com suporte a `filhos()`, `desabilitado`, `grupo` e `<Kbd>` idêntico ao handler ativo. Restaura foco ao elemento salvo ao fechar (`Esc`).
* **Usado em:** Todas as telas (`A`–`F`).

### 4. Família de Estados de Tela (`<Esqueleto>`, `<EstadoTela>`, `<BannerErroCore>`)
* **Apelidos nos pacotes:**
  * Loading: `<Esqueleto>` (`A`, `D`), `<Skeleton>` (`B`, `E`, `F`), `<BannerEstado state="loading">` (`C`).
  * Vazio / Parcial / Pré-condição: `<EstadoTela>` (`A`, `C`, `D`), `<EstadoVazio>` (`E`), `<BannerEstado state="empty|partial">` (`C`). *(Evolui `design-system/src/components/ui/Estado.tsx` e `domain/EstadoLista.tsx`.)*
  * Erro: `<BannerErroCore>` (`B`, `D`, `E`), `<ErroAcionavel>` (`F`), `<EstadoTela tipo="erro">` (`A`), `<BannerEstado state="error">` (`C`).
* **Interface unificada:**
  ```ts
  interface EsqueletoProps {
    variante: 'lista' | 'cards' | 'formulario' | 'transcricao' | 'painel' | 'linha';
    quantidade?: number;
    rotuloAcessivel?: string;
  }

  interface EstadoTelaProps {
    tipo: 'vazio' | 'parcial' | 'sem_permissao';
    titulo: string;
    descricao: string;
    acaoPrimaria?: { rotulo: string; aoAcionar: () => void };
    acaoSecundaria?: { rotulo: string; aoAcionar: () => void };
    compacto?: boolean; // para faixas no topo de listas/sub-abas
  }

  interface BannerErroCoreProps {
    erro: { code: string; message: string; usage?: unknown; retryable?: boolean };
    acaoRecuperacao?: { rotulo: string; aoAcionar: () => void };
    acaoSecundaria?: { rotulo: string; aoAcionar: () => void };
    permitirRelato?: boolean; // exibe link para #/relatos?tipo=bug
    aoDispensar?: () => void;
  }
  ```
* **Comportamento:** Implementam os 6 estados obrigatórios (`loading`, `empty`, `error`, `ready`, `job_running`, `partial`). `<Esqueleto>` respeita `prefers-reduced-motion` e impede `return null` ou `"lista vazia"` prematuro. `<BannerErroCore>` usa container `role="alert"`, traduz `CoreError.code` pelo mapeador central da Arquitetura §6 e esconde código/trace técnico dentro de `<details>Ver detalhe técnico</details>` com botão para `#/relatos`.
* **Usado em:** Todas as telas (`A`–`F`).

### 5. `<ResumoCustoPrivacidade>`
* **Apelidos nos pacotes:** `<ResumoCustoPrivacidade>` (`A`, `B`, `C`, `D`, `E`, `F`).
* **Interface unificada:**
  ```ts
  interface ResumoCustoPrivacidadeProps {
    tarefa: string; // ex.: "Seleção de Cortes", "Tradução", "Transcrição Groq"
    perfil: {
      id: string;
      label: string;
      kind: 'local' | 'api' | 'cli' | 'groq';
      model: string | null;
    };
    localidade: 'local' | 'remoto' | 'cli';
    saiDaMaquina: boolean;
    host?: string | null;
    estimativa:
      | { kind: 'zero' }
      | { kind: 'plan_quota' }
      | { kind: 'usd'; minMicroUsd: number; maxMicroUsd: number; inputTokens?: number; janelas?: number; nota?: string }
      | { kind: 'unknown' };
    orcamento?: { restanteMicroUsd?: number | null; callsRestantes?: number | null; pausado?: boolean } | null;
    bloqueadoSomenteLocal?: boolean;
    consentimentoPendente?: boolean;
    aoConfirmarConsentimento?: (aceito: boolean) => void;
    compacto?: boolean;
  }
  ```
* **Comportamento:** Cartão único obrigatório (Arquitetura §7) exibido inline ou dentro de `<ConfirmDialog>` antes de qualquer disparo que consulta Provedor ou Groq remoto. Sempre usa `tabular-nums`, diferencia `Local (loopback)` / `Remoto (HTTPS)` / `CLI (<nome>)`, diferencia `US$ 0,00` / faixa `~US$ min – max` / `Consome cota do plano` / `Custo desconhecido` e sinaliza bloqueio quando `Somente local` está ativo.
* **Usado em:** `B` (Telas 2, 3), `C` (Telas C.1, C.2), `D` (`Editar` — Tradução), `E` (`Transformar`, `Empacotar`), `F` (`Fila de Jobs`), `A` (`Custos` — Estimador).

### 6. `<ConfirmDialog>`
* **Apelidos nos pacotes:** `<ConfirmDialog>` (`A`, `B`, `C`, `D`, `E`, `F`).
* **Base existente:** `design-system/src/components/ui/Dialog.tsx` (`@base-ui/react/alert-dialog`).
* **Interface unificada:**
  ```ts
  interface ConfirmDialogProps {
    aberto: boolean;
    aoMudarAberto: (aberto: boolean) => void;
    titulo: string;
    descricao: string | React.ReactNode;
    rotuloConfirmar: string;
    rotuloCancelar?: string; // padrão "Cancelar"
    variante?: 'primario' | 'perigo';
    confirmarDesabilitado?: boolean;
    ocupado?: boolean;
    focoInicial?: 'cancelar' | 'confirmar'; // padrão "cancelar" em perigo/pago
    focoFinal?: React.RefObject<HTMLElement | null>;
    aoConfirmar: () => void | Promise<void>;
    children?: React.ReactNode; // permite embutir <ResumoCustoPrivacidade> ou lista de conflitos
  }
  ```
* **Comportamento:** Modal acessível (`role="alertdialog"`, `aria-modal="true"`, `inert` no fundo, focus trap incluindo `<textarea>`, retorno de foco ao gatilho). Protege contra `Enter` acidental mantendo `focoInicial="cancelar"` em ações destrutivas/pagas.
* **Usado em:** Todas as telas (`A`–`F`).

### 7. `<ListaVirtual>` e `<TabelaGrade>`
* **Apelidos nos pacotes:** `<ListaVirtual>` (`B`, `C`, `D`), `<DataGrid>` (`A`), `role="grid"` (`B`, `F`).
* **Base existente:** `design-system/src/components/ui/VirtualList.tsx`.
* **Interface unificada:**
  ```ts
  interface ListaVirtualProps<T> {
    itens?: T[];
    total: number; // quando paginado sob demanda (transcription.timeline)
    alturaItem: number | ((indice: number) => number);
    obterItem?: (indice: number) => T | undefined;
    carregarPagina?: (offset: number, limit: number) => Promise<void>;
    obterId?: (item: T) => string | number;
    selecionadoId?: string | number | null;
    aoSelecionar?: (item: T) => void;
    rolarParaIndice?: number | null;
    renderizarItem: (item: T, indice: number, selecionado: boolean) => React.ReactNode;
    ariaLabel: string;
    papel?: 'listbox' | 'region';
  }
  ```
* **Comportamento:** Suporta tanto array em memória (`C.2` candidatos, `D` Índice do Corte) quanto paginação por demanda (`B.3` `transcription.timeline`, `B.1` > 30 Fontes). Em `papel="listbox"`, garante `tabIndex={0}` no container e `aria-activedescendant` (eliminando o bug `tabIndex={-1}` da v1). `<TabelaGrade>` (`A`, `B.2`, `F`) encapsula `role="grid"` com navegação por setas e controles interativos internos (`Select`, `Switch`, botões).
* **Usado em:** `A` (`Provedores`, `Custos`, `Aparência`), `B` (`Lista de Fontes`, `Lotes`, `Leitor Transcrição`), `C` (`Bancada C.2`), `D` (`Transcrição`, `Índice do Corte`), `F` (`Exportação` — itens do lote, `Fila de Jobs`).

### 8. Componentes de Mídia (`<PlayerProxy>`, `<PlayerReferenciaFonte>`, `<TimelineEditor>`)
* **Apelidos nos pacotes:** `<PlayerProxy>` (`C`, `D`, `E`), `<PlayerReferenciaFonte>` (`B`), `<TimelineEditor>` (`D`).
* **Base existente:** `design-system/src/components/editor/Preview.tsx` e `Timeline.tsx`.
* **Interfaces unificadas:**
  * **`<PlayerProxy>`:**
    ```ts
    interface PlayerProxyProps {
      sourceId: number;
      fonteDisponivel: boolean;
      startUs: number;
      endUs: number;
      proxyKey?: string | null;
      modo: 'previa_9_16' | 'fonte_16_9' | 'capa';
      crop?: ClipCrop;
      painelAtivo?: 'primary' | 'top' | 'bottom';
      captions?: CaptionData | null;
      silences?: SilencesState;
      montage?: MontageState | null;
      audioMix?: AudioMixState | null;
      tempoAtualUs: number;
      reproduzindo: boolean;
      taxaReproducao?: number;
      mostrarTransporte?: boolean;
      overlayBorda?: { lado: 'start' | 'end'; timeUs: number; livrePorQuadro: boolean } | null;
      aoMudarTempoUs: (us: number) => void;
      aoMudarReproduzindo: (tocando: boolean) => void;
      aoEditarCrop?: (edits: CropKeyframe[], preview: boolean) => void;
      aoPedirRelocalizacao?: () => void;
    }
    ```
  * **`<PlayerReferenciaFonte>`:** `{ fonteId: number; disponivel: boolean; seekUs?: number | null; aoMudarTempoUs?: (us: number) => void }` — usa `mediaUrl("source/" + fonteId)` (HTTP 206 Range) para Fontes inteiras (> 10 min) com fallback gracioso se codec MKV não tocar na WebView.
  * **`<TimelineEditor>`:** interface completa do Pacote D (`windowStartUs`, `windowEndUs`, `startUs`, `endUs`, `tempoAtualUs`, `timelineState`, `thumbs`, `waveValues`, `sentences`, `silences`, `keyframes`, `montage`, `audioMix`, `zoom`, callbacks `aoAjustarBorda`, `aoMoverAgulha`, `aoMoverNarracao`, `aoMoverSfx` com `preview: true/false`).
* **Usado em:** `B` (`PlayerReferenciaFonte`), `C.2` (`PlayerProxy` 9:16), `D` (`PlayerProxy` + `TimelineEditor`), `E.2` (`PlayerProxy` modo `'capa'`).

### 9. `<InstaladorJustInTime>`
* **Apelidos nos pacotes:** `<InstaladorJustInTime>` (`A`, `D`), `<InstaladorComponenteJustInTime>` (`E`), *cartão just-in-time `yt-dlp`/`deno`* (`B`).
* **Interface unificada:**
  ```ts
  interface InstaladorJustInTimeProps {
    recurso: 'url_import' | 'yunet' | 'tts';
    idioma?: 'pt' | 'en';
    modo?: 'inline' | 'modal';
    aberto?: boolean;
    aoFechar?: () => void;
    aoConcluir: () => void;
  }
  ```
* **Comportamento:** Verifica `*.status`, `components.manifest` / `components.models.manifest` / `tts.catalog`. Mostra tamanho, licença, destino em `data_dir` e exige confirmação explícita (`confirmed: true`) mais aceite de termos quando aplicável (`terms_accepted` para URL; `prohibitedUse.summaryPt` / `termsAccepted` para TTS). Roteia cancelamento corretamente: `components.cancel { id }` para `yt-dlp`/`deno`/`worker`/`yunet`/`pocket-tts` vs. `tts.models.cancel { id }` para modelos TTS (`tts:<id>`).
* **Usado em:** `A` (Superfície 4), `B` (`Fontes` — `yt-dlp`/`deno`), `D` (`Enquadramento` — `yunet`/`worker`), `E` (`Transformar` — `pocket-tts`/modelo TTS).

### 10. Selos e Indicadores (`<Status>`, `<SeloTipoVideo>`, `<BadgeNota>`)
* **Apelidos nos pacotes:**
  * `<Status>` (`A`, `B`, `D`), `<SeloEstado>` (`F`) → canônico **`<Status>`** (`design-system/src/components/ui/Status.tsx`), sempre ícone + rótulo textual (SC 1.4.1), tons `'neutro' | 'info' | 'sucesso' | 'aviso' | 'perigo'`.
  * `<SeloTipoVideo>` / `<SeletorTipoVideo>` (`C`, `D`, `E`, `F`, evolução de `videoKind.tsx`).
  * `<BadgeNota>` / `<BarrasEixosNota>` (`C`, evolução de `design-system/src/components/domain/Nota.tsx`).
* **Usado em:** `A`–`F`.

### 11. `<ChecklistGuardaCorpos>`
* **Apelidos nos pacotes:** `<ChecklistGuardaCorpos>` (`F`), `<PainelGuardrails>` (`E`), *Checklist pré-exportação / Faixa contextual de Guardrails* (`C`, `D`).
* **Interface unificada:**
  ```ts
  interface ChecklistGuardaCorposProps {
    estado: GuardrailsState; // resposta de guardrails.check
    escopo: 'single' | 'source' | 'project';
    abertoPorPadrao?: boolean;
    mostrarDivulgacaoIa?: boolean; // cartão AiDisclosureNote
    aoConfirmarDireto?: () => Promise<void>; // guardrails.ack_direct_notice
    aoNavegarCorte?: (corteId: string, aba: 'editar' | 'transformar' | 'empacotar') => void;
    aoNavegarFonte?: (fonteId: number) => void;
  }
  ```
* **Comportamento:** Puramente informativo (nunca bloqueante). Exibe Permissão, tipo de vídeo, roteiro/narração pendentes, `freezeTailUs` (> 5 s), `audio.unverifiedCount`, `over60s`, `AiDisclosureNote` e o botão único de ciência `guardrails.ack_direct_notice`.
* **Usado em:** `C.2`, `D` (`<ContextoCorte>` modal de export), `E.2` (`Empacotar`), `F` (`Mesa de Prontidão`).

### 12. Auxiliares específicos e Primitivas Base UI
* **Domínio:** `<CampoPermissao>` (`B`, resumo em `E`/`F`), `<GravadorTeleprompter>` (`E.1`), `<ContadorLimite>` (`E.2`, útil em formulários com `tabular-nums`), `<ListaChips>` (`E.2`), `<LinhaFila>` (já existe em `design-system/src/components/domain/LinhaFila.tsx`, base para `F.2`).
* **Primitivas UI (`design-system/src/components/ui/`):** `<Button>`, `<Campo>`, `<Select>`, `<Switch>`, `<Abas>`, `<Segmented>`, `<Progresso>`, `<Kbd>`, `<Tooltip>`, `<Toaster>`, `<ContextMenu>`, `<Popover>`, `<NumberScrub>`, `<Spinner>`.

---

## Questões para a arquitetura

Todas as 30 questões originais dos pacotes `A`–`F` foram consolidadas e deduplicadas em **26 questões**:

1. **O que é `:corteId` na rota `#/projeto/:id/corte/:corteId/...` e como tratar Cortes avulsos sem `candidate_id`?** *(Origem: C#1, E#1)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
   * *Problema:* Todos os comandos de `angles.*`, `script.*`, `narration.*`, `thumbnail.*` e `packaging.*` exigem `candidate: number` (`candidate_id`), enquanto `editor.open` recebe `{ source_id, start_id, end_id, candidate_id? }` e só cria o `clipId` (`clip_edits.id` em `core/src/editor/edits.rs:475-493`) na primeira abertura do editor. Além disso, `editor.open` aceita `candidate_id: null` (Corte avulso com identidade `"source:<sId>:<startId>:<endId>"`).
   * *Opções:* (a) `:corteId` = `candidateId` para Cortes da seleção e token `avulso-<sourceId>-<startId>-<endId>` (com `Transformar`/`Empacotar` ocultos) para avulsos; (b) `:corteId` = `clipId` (exigiria chamar `editor.open` antes de ir a qualquer sub-aba ou da Mesa de Prontidão, mesmo sem abrir o Editor).
   * *Decisão:* **Opção (a) — `:corteId` é `candidateId`** para Cortes aprovados (e `avulso-<sourceId>-<startId>-<endId>` para Cortes avulsos sem `candidate_id`, ocultando `Transformar` e `Empacotar`). *Motivo:* na Revisão (`C.2`) e na Mesa de Prontidão (`F.1`), o candidato aprovado pode ainda não ter registro em `clip_edits`, mas já possui `candidateId` estável usado por `Transformar`, `Empacotar` e `export.start`.

2. **Diálogo de fechamento da janela com downloads/jobs ativos (`WindowEvent::CloseRequested`)** *(Origem: A#3, F#5)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
   * *Problema:* `src-tauri/src/main.rs:90-108` intercepta `CloseRequested` no Rust apenas para rodar `editor.flush` sincronamente. Downloads globais (`components.*`, `tts.models.*`, `sources.url.*`) e parte do estado em voo são rastreados no Store da WebView, que não é consultado hoje antes de fechar.
   * *Opções:* (a) Rust executa `editor.flush` primeiro (se falhar, `prevent_close()` + `editor_save_failed`); se passar, emite evento `app-close-requested` à WebView com `prevent_close()` quando fechamento ainda não foi confirmado; o front verifica o Store e, se não houver nada ativo, chama `window.destroy()`; se houver download/export/chamada paga em voo, abre `<ConfirmDialog>`; (b) manter lista de operações globais em Rust e expor comando de consulta síncrona.
   * *Decisão:* **Opção (a)** (coordenação Rust ↔ WebView via evento Tauri). *Motivo:* reutiliza o Store único previsto em `01-arquitetura.md` §5, mantém `editor.flush` síncrono no Rust como trava de integridade e cumpre o diálogo explicativo da §5 sem duplicar máquina de estados de UI em Rust.

3. **Persistência de Aparência, Escala UI (`100%`/`115%`), Alto Contraste, Idioma e interruptor WCAG 2.1.4 + remapeamento de atalhos** *(Origem: A#2)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
   * *Problema:* Hoje `tema.ts` e `i18n.ts` gravam em `localStorage` da WebView (que não segue `CLIPES_DATA_DIR`), e o núcleo Rust não possui comando para `ui-settings.json`.
   * *Opções:* (a) Persistir localmente no front (`localStorage`, conforme §10.1 de `01-arquitetura.md`); (b) criar comando Rust para gravar `ui-settings.json` em `config_dir`/`CLIPES_DATA_DIR` (ou `@tauri-apps/plugin-store`).
   * *Decisão:* **Opção (a) no v2** com interface isolada no Store de Sessão. *Motivo:* `01-arquitetura.md` §10 já define *"preferências de atalhos (armazenadas localmente)"* no front, evita novo ticket de Rust bloqueando Fase 4/5 e atende plenamente desktop + navegador mock.

4. **Válvula de escape quando `editor.flush` falha repetidamente ao sair da rota `Editar`** *(Origem: D#2)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
   * *Problema:* A §3 de `01-arquitetura.md` determina bloquear a saída com diálogo se `editor.flush` falhar. Se o disco estiver cheio ou somente-leitura, o usuário ficaria preso na rota para sempre.
   * *Opções:* (a) Bloqueio absoluto sem saída; (b) `<ConfirmDialog>` com 3 ações: *"Tentar salvar novamente"* (primário), *"Continuar editando"* e ação secundária de perigo *"Sair descartando alterações não salvas"*.
   * *Decisão:* **Opção (b)** na navegação SPA, mantendo bloqueio no `CloseRequested` (ou oferecendo o mesmo descarte consciente). *Motivo:* impede deadlock de navegação sem perder segurança contra perda acidental de edições.

5. **Lista de navegação `< Anterior | Próximo aprovado >` no `<ContextoCorte>`** *(Origem: D#1)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
   * *Problema:* Ao entrar no Corte vindo da Bancada C.2 (uma execução específica `?run=:runId`) vs. vindo da Mesa de Prontidão (`F.1`, todos os aprovados do Projeto), qual conjunto define `i / N`?
   * *Opções:* (a) Sempre todos os aprovados do Projeto; (b) Preservar a execução da origem quando `?run=:runId` estiver presente, e usar todos os aprovados do Projeto caso contrário.
   * *Decisão:* **Opção (b)**. *Motivo:* respeita o contexto mental de quem está revisando uma live/execução específica sem impedir percorrer todo o Projeto quando vem da Exportação.

6. **Atalho de teclado dedicado para `< Anterior | Próximo aprovado >` no `<ContextoCorte>`** *(Origem: D#3)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
   * *Problema:* `[` e `]` foram removidos para eliminar conflito com `Ctrl+[` / `Ctrl+]` dos painéis.
   * *Opções:* (a) Sem atalho de teclado (apenas botões e Paleta `Ctrl/Cmd+K`); (b) Adicionar `Alt+PageUp` / `Alt+PageDown` (livres no mapa da §8).
   * *Decisão:* **Opção (b)** (`Alt+PageUp` / `Alt+PageDown`) registrados em `useComandos`. *Motivo:* acelera revisão em sequência por teclado sem colidir com nenhum atalho NLE nem de texto.

7. **Ação *"Exportar só este"* diretamente nos cards da Mesa de Prontidão (`F.1`)** *(Origem: F#3)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
   * *Problema:* A §2 da arquitetura lista `export.start` apenas em `Editar` e `Empacotar`, mas o Pacote F incluiu *"Exportar só este"* no menu secundário do cartão.
   * *Opções:* (a) Restringir à Tela do Corte; (b) Manter como ação secundária no cartão abrindo o mesmo modal pré-exportação de `guardrails.check` do Pacote D.
   * *Decisão:* **Opção (b)**. *Motivo:* evita obrigar o usuário a navegar para outro contexto quando só quer reexportar um Corte corrigido, reutilizando o mesmo modal e guardrails.

8. **Desempenho N+1 ao montar a Mesa de Prontidão (`#/projeto/:id/exportacao`)** *(Origem: F#2)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
   * *Problema:* Hoje não existe comando agregado no Rust; montar a grade exige `sources.list` → `selection.list` → `selection.review` + `packaging.get`, `thumbnail.get` e `guardrails.check` por candidato aprovado.
   * *Opções:* (a) Lazy-loading no front por página/viewport + cache no Store de Projeto Ativo; (b) Novo comando Rust `export.readiness` agregado.
   * *Decisão:* **Ambas em etapas** — usar lazy-loading paginado + cache no front imediatamente (não bloqueia Fase 4/5) e abrir ticket de **melhora** para `export.readiness` no Rust.

9. **Cálculo de ETA na Fila de Jobs (`jobs.list` e `ProgressEvent`)** *(Origem: F#4)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
   * *Problema:* `core/src/jobs.rs:206` e `ProgressEvent` não informam `startedAtMs` nem `etaMs`.
   * *Opções:* (a) Não mostrar ETA nunca; (b) Calcular ETA no Store do front apenas para jobs determinísticos observados desde o início na sessão atual (omitindo após reload ou em estágios `ai:*` indeterminados), e abrir ticket de melhora para `started_at_ms` no Rust.
   * *Decisão:* **Opção (b)**. *Motivo:* dá feedback útil em transcrições e lotes longos sem inventar estimativas falsas após recarregar a janela.

10. **Empacotamento 100% manual sem Provedor (`packaging.edit` exige `packaging.generate` prévio)** *(Origem: E#3)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
    * *Problema:* Verificado em `core/src/packaging.rs:949` que `packaging.edit` retorna `nothing_to_edit` se nunca houve `packaging.generate`. Usuários sem Provedor ou que queiram redigir tudo manualmente ficam bloqueados.
    * *Opções:* (a) Manter CTA *"Sugerir Empacotamento"* como entrada obrigatória; (b) Abrir ticket de núcleo para `packaging.edit` inicializar registro vazio quando `current === null`.
    * *Decisão:* **Opção (b)** (ticket de **melhora**, mantendo o CTA de sugestão quando vazio até o backend suportar). *Motivo:* melhora autonomia para usuários 100% manuais ou offline sem bloquear a Fase 4.

11. **Remoção de áudio de bloco na Narração (`narration.delete_block`) e tooltip preventivo de `transcription.undo`** *(Origem: B#4, E#4)* — **[decidido pelo dev em 17/11: recomendação aprovada]**
    * *Problema:* (1) Em `Narration` (`E.1`), um bloco com áudio gravado/importado/TTS só pode ser substituído, não limpo de volta a `Sem áudio`; (2) `transcription.corrections` (`B.3`) retorna só `{ can_undo, can_redo }`, impedindo exibir no tooltip qual Fonte será afetada pelo `Ctrl+Z` global antes do clique.
    * *Decisão:* Abrir tickets de núcleo de baixa prioridade (**opcional** para `narration.delete_block`; **melhora** para `next_undo`/`next_redo` em `transcription.corrections`). Na v1, substituição de bloco e aviso genérico no tooltip + toast pós-`undo` com `r.source_id` atendem sem bloquear.

---

12. **`#/assistente` como rota dedicada vs. modal sobre `#/inicio`** *(Origem: A#1)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* **Rota dedicada `#/assistente?passo=1|2`** usando `<Tela modoMinimo>` (já prevista em `01-arquitetura.md` §3, preserva histórico e testes E2E diretos; ajustar o termo *"modal"* na §2).

13. **Seção `#/config/custos` sem Projeto aberto** *(Origem: A#4)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* **Manter `#/config/custos` acessível sem Projeto aberto** para `Tabela de Preços e Estimador` (globais), exibindo `<EstadoTela tipo="vazio">` acionável nas abas de Orçamentos/Gastos/Auditoria (conforme tabela §3 que só redireciona `#/config/projeto`).

14. **Seletor de pasta/arquivo do SO vs. campo editável no navegador/Playwright** *(Origem: A#5)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Manter botão nativo (`@tauri-apps/plugin-dialog`) **acompanhado de input de texto editável** (ou fallback modal em navegador) nos caminhos de `projects.create/open`, `components.settings.set`, `sources.url.settings.set` e exportação.

15. **Manifesto macOS incompleto (`ffmpeg`, `yt-dlp`, `uv`)** *(Origem: A#6)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Seguir `01-arquitetura.md` §11.8 — UI orienta `components.ffmpeg.system` de forma não bloqueante no macOS até inclusão no manifesto Rust.

16. **Padronização de sub-visões por query string (`?sub=lotes` vs. `/lotes`)** *(Origem: B#1, F#1)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Oficializar `#/projeto/:id/fontes?sub=fontes|lotes` e `#/projeto/:id/exportacao?sub=prontidao|lotes` na tabela de rotas de `01-arquitetura.md` §3, mantendo `#/projeto/:id/exportacao/lotes` como redirect/alias de compatibilidade.

17. **Player da Fonte inteira (`mediaUrl("source/" + fonteId)`) vs. `proxy.request` em `#/projeto/:id/fontes/:fonteId`** *(Origem: B#2)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Usar `<PlayerReferenciaFonte>` sobre `mediaUrl("source/" + fonteId)` (HTTP `206 Range` já existe em `core/src/media.rs`) com tratamento gracioso de erro de codec na WebView, pois `proxy.request` rejeita trechos > 10 min (`clip_too_long`).

18. **Duplicação controlada de `transcription.grouping` (#279) e fechamento do contrato** *(Origem: B#3)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Manter o controle sincronizado no cartão do Motor Local (`B.3`) e em `#/config/componentes` (`A.7`) deixando explícito no rótulo que vale para o app inteiro; contrato já está fechado e implementado em `core/src/components/hardware.rs:1084-1107`.

19. **Conflito potencial entre `Enter` na palavra (`F2`/`Enter` = corrigir) vs. navegar vídeo (`US-55`)** *(Origem: B#5)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Manter `F2` / `Enter` exclusivos para edição de grafia (`01-arquitetura.md` §8) e usar clique do ponteiro / `Ctrl/Cmd+Espaço` / botão *"Ouvir aqui"* para `seek` no vídeo.

20. **Dados de `leavesMachine` e destino em `selection.estimate` (Modo 1)** *(Origem: C#2)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Front cruza `profile` com `provider.profiles.list` e `assistant.tasks` no Store de Sessão para alimentar `<ResumoCustoPrivacidade>`, evitando bloquear na espera por mudança do Modo 1 no Rust.

21. **Uso de `selection.redo` vs. `jobs.redo` na Bancada C.2** *(Origem: C#3)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Na Bancada (`C.2`) e Configurador (`C.1`), usar sempre `selection.redo` (confirmado no código `core/src/selection.rs:1092,1289` que apenas ele incrementa `selection_runs.revision`; `jobs.redo` em `core/src/jobs/redo.rs:201` só re-enfileira a unidade na Fila Global).

22. **Visibilidade de Fontes transcritas em `#/projeto/:id/cortes` (`sources.list` sem `transcriptState`)** *(Origem: C#4)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Store de Projeto Ativo mantém mapa `transcriptStatusBySource` carregado em paralelo sob demanda e atualizado pelos eventos `core-progress` de `transcription`.

23. **Sinalização de `editor.audio.soundtrack.clear` / `editor.audio.sfx.remove` vs. confirmação** *(Origem: D#4)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Manter remoção imediata reversível por `Ctrl/Cmd+Z` (`editor.undo`) + toast *"Desfazer"*, reservando `<ConfirmDialog>` para *"Limpar todas as edições manuais"* de crop e `audio.delete`.

24. **Invalidação de `export.captions` após `translation.edit`** *(Origem: D#5)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Confirmado pela regra geral de `01-arquitetura.md` §10: qualquer `translation.edit` invalida `export.captions` no Store do Editor quando a faixa `Traduzida` está ativa.

25. **Guarda de Fonte `offline`/`changed` em `Transformar` e `Empacotar`** *(Origem: E#2)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Estender a regra somente-leitura de mídia da §3 de `Editar` para `Transformar` e `Empacotar`: textos/áudios de Narração e Ficha de Empacotamento continuam editáveis via SQLite, exibindo banner de relocalização no lugar do preview/export PNG/MP4.

26. **Seleção ad-hoc de `profileId` em `angles.generate`, `thumbnail.suggest` e `packaging.generate`** *(Origem: E#5)* — **[resolvida por consistência; aprovada em 17/11]**
    * *Resolução recomendada:* Manter padrão atual do núcleo e ADR-0010 (roteamento em `#/config/provedores` e `jobs.redo` pós-execução na Fila; `profileId` ad-hoc exposto apenas onde já existe em `script.estimate`/`regenerate`).

---

## Dependências do núcleo (tickets de Rust)

Lista única deduplicada combinando [01-arquitetura.md §11](./01-arquitetura.md#11-depend%C3%AAncias-do-n%C3%BAcleo) e as lacunas levantadas nos pacotes `A`–`F`, verificada contra `docs/produto/funcionalidades/*.md` e `core/src/`.

### A. Já implementados no núcleo (não abrir ticket de Rust — apenas ligar na UI/mock)
1. **`transcription.grouping` (#279 — `auto: true`, `mode: "auto"|"manual"`):** Pacotes `A` (`Tela 7`, L864) e `B` (`Tela 3`, L559) listaram como pendente por nota antiga em `03-transcricao.md:113`, mas **já está implementado** em `core/src/components/hardware.rs:449-455, 1084-1107`.
2. **`energy.start` (`core/src/energy.rs:484`), `transcription.blocks`, `transcription.sentences`, `transcription.words`, `transcription.hardware.diagnostic`, `provider.audit.list`, `jobs.budget.get`, `jobs.redo`, `jobs.redo.estimate`, `jobs.result`, `projects.close`, `proxy.map_time`, `editor.snapshots`, `script.narration_allowed`, `export.batch.status`:** Todos já existem no Rust (confirmados em `90-inventario-ui-atual.md:513-519`); faltavam apenas na UI v1 e/ou no mock TS.

### B. Tickets necessários no núcleo Rust (deduplicados)

| # | Título curto do ticket | O que mudar | Comando(s) / Arquivo(s) | Telas bloqueadas / impactadas | Prioridade |
|---|---|---|---|---|---|
| 1 | Serializar `encoder_fallback` em `export.status` | Incluir campo `encoder_fallback` no JSON retornado (SQL já lê `encoder`, `fallback_from`, `fallback_reason`). | `export.status` (`core/src/export.rs:1125-1138`, ref. `06` §Obs. #1, §11 #1) | `D` (`<ContextoCorte>`), `E.2` (`Empacotar`), `F.1` (export individual) | **bloqueia a fase 5** |
| 2 | Bloqueio explícito de janela `uncertain` em `selection.resume` | Separar `selection.resume` de `cmd_redo` ou rejeitar `uncertain` com `window_uncertain` mesmo sem `profileId` (ADR-0005/0009). | `selection.resume` (`core/src/selection.rs:1558`, ref. `04` §Obs. #3) | `C.1` (`Configurador de Seleção`) | **bloqueia a fase 5** |
| 3 | Coordenação `CloseRequested` com operações em voo | Emitir evento de consulta/confirmação para a WebView após `editor.flush` OK antes de encerrar janela se houver download/export/chamada paga em voo. | `src-tauri/src/main.rs:90-108` (`A` §9, `F.2` §2.9) | `A` (`Shell Global`), `F.2` (`Fila de Jobs`) | **bloqueia a fase 5** |
| 4 | Converter Corte direto individual em Vídeo transformado | Criar comando (ex.: `selection.candidate.set_kind`) ou override por candidato em vez de prender `video_kind` só em `selection_runs`. | `selection.*`, `script.*`, `angles.*` (`04`, `06`, §11 #2) | `D` (`<ContextoCorte>`), `E.1` (`Transformar`) | **melhora** *(botão fica desabilitado até existir)* |
| 5 | Remover evento residual `job: "0"` em `narration.record_block` | Remover chamada duplicada `jobs::progress(0, "narration_record", 100, ...)` após `EventSink`. | `narration.record_block` (`core/src/narration_record.rs:859`, ref. `07` §Obs. #5, §11 #5) | `E.1` (`Transformar`), `F.2` (`Fila`) | **melhora** *(front filtra `job === "0"`)* |
| 6 | Restaurar snapshot do editor (`editor.snapshots.restore`) | Adicionar comando que restaura snapshot escolhido de `clip_snapshots` empilhando passo em `undo`. | `editor.snapshots.restore` (`core/src/editor/edits.rs:1715`, ref. `05` §Obs. #1, §11 #3) | `D` (`Editar` — aba Histórico) | **melhora** *(aba fica somente leitura)* |
| 7 | Excluir Fonte do Projeto (`sources.delete`) | Remover Fonte e dependências no SQLite com guarda contra jobs ativos e `editor_edits`. | `sources.delete` (`02` §Obs. #5, §11 #4) | `B.1` (`Lista de Fontes`) | **melhora** *(ação oculta/desabilitada)* |
| 8 | Enriquecer `jobs.preview` com chave `clipes-media` e `sourceId` | Alinhar entrada e devolver chaves opacas em vez de caminhos absolutos de disco. | `jobs.preview` (`core/src/jobs/preview.rs:478`, ref. `07` §Obs. #2, §11 #6) | `B.3` (`Detalhe da Fonte`), §11 #6 | **melhora** |
| 9 | `clip_id` em `ai:translation:*` e evento para backup automático | Incluir `clip_id` nos eventos `ai:translation` e emitir evento `core-progress` ao concluir/falhar backup automático. | `translation.rs`, `backups.rs` (`01` §Obs. #5, `03` §Obs. #4, §11 #7) | `A.10` (`Backups`), `D` (`Legendas e Tradução`) | **melhora** |
| 10 | Comando agregado de prontidão (`export.readiness`) | Retornar resumo de aprovados (`packaging`, `thumbnail`, `script`, `narration`, `guardrails`) em 1 chamada. | `export.*` (`F.1` §1.9) | `F.1` (`Mesa de Prontidão`) | **melhora** *(evita N+1)* |
| 11 | Permitir criação manual em `packaging.edit` (`nothing_to_edit`) | Inicializar ficha de empacotamento quando `current === null` sem exigir `packaging.generate` prévio. | `packaging.edit` (`core/src/packaging.rs:949`, `E.2` §9) | `E.2` (`Empacotar`) | **melhora** |
| 12 | Corrigir etapa fixa `"componente"` em `diagnostic.get` | Inferir etapa real do log em vez de fixar `"Etapa da falha: componente"`. | `diagnostic.get` (`core/src/diagnostic.rs:193-199`, §11 #9) | `F.3` (`Relatos e Diagnóstico`) | **melhora** |
| 13 | Suporte macOS no manifesto de Componentes (`ffmpeg`, `yt-dlp`, `uv`) | Adicionar entradas `aarch64`/`x86_64` macOS ao manifesto embutido. | `core/src/components.rs:50-59` (`01` §Obs. #4, §11 #8) | `A.3` (`Assistente`), `A.4` (`JIT`), `A.7` (`Componentes`) | **melhora** |
| 14 | Expor `next_undo`/`next_redo` em `transcription.corrections` e `transcriptState` em `sources.list` | Retornar `{ source_id, source_name, word }` da próxima operação de undo/redo e resumo de transcrição em `sources.list`. | `transcription.corrections`, `sources.list` (`B.3` §9, `C.1` §9) | `B.3` (`Transcrição`), `C.1` (`Configurador`) | **melhora** |
| 15 | Expor `startedAtMs` e rótulo de alvo em `jobs.list` + `export.settings.set` | Retornar timestamp de início e nome da Fonte/Corte em `jobs.list`, e persistir pasta em `export.settings.set`. | `jobs.list` (`core/src/jobs.rs:206`), `export.settings` (`F.1`, `F.2`) | `F.1` (`Exportação`), `F.2` (`Fila de Jobs`) | **opcional** |
| 16 | Atualizar `selection_runs.revision` em `jobs.redo` (ou manter separado) | Avaliar se `jobs.redo` sobre `ai:selection` também cria revisão nova em `selection_runs`. | `core/src/jobs/redo.rs:201` (`C.2` §9) | `C.2` (`Bancada`), `F.2` (`Fila`) | **opcional** |
| 17 | Setter para timeouts globais de `provider.json` e remoção de `"legacy"` | Permitir editar `timeouts.remote`/`local` globais e remover perfil `"legacy"` se desejado. | `core/src/provider*` (`07` §Obs. #3, `A.5` §9, §11 #8) | `A.5` (`Provedores`) | **opcional** |
| 18 | Remover áudio de bloco (`narration.delete_block`) e progresso em `narration.cleanup.prepare` | Limpar áudio de um bloco de volta para `Sem áudio`; emitir `core-progress` em limpeza longa. | `narration.*` (`E.1` §9) | `E.1` (`Transformar`) | **opcional** |
| 19 | Campos informativos extras (tamanho PyTorch/CUDA no worker, `percentage` em `batch:*`, `batches.estimate`, `transcription.blocks` total, `selection.review` vizinhas, ID único em cópia de Fonte, `components.active_jobs`) | Melhorias pontuais de telemetria local de UI e paralelismo de cópia. | `components.rs`, `source_batches.rs`, `transcription.rs`, `selection.rs`, `sources.rs` (`A`, `B`, `C`, `F`) | `A.3`, `B.1`, `B.2`, `B.3`, `C.2`, `F.2` | **opcional** |

---

## Lacunas do mock TS

Para o front v2 rodar integralmente no navegador (`VITE_CORE_MOCK=1`) e nos testes E2E Playwright sem depender de Tauri nem de query flags ocultas:

### 1. Infraestrutura transversal do mock (`src/lib/core.ts` e estilos/comandos)
* **Remover portões obrigatórios de query string (`A`–`F`):** eliminar `?source-test=1`, `?transcript-test=1`, `?batch-test=1` e `?hardware-cpu=1` como condição para comandos existirem. O mock padrão deve entregar um Projeto `"demo"` completo e navegável desde `#/inicio`.
* **Padronizar query params apenas para cenários de teste (`A`–`F`):** `?estado=vazio|erro|carregando|parcial|offline|erro-flush|fallback` e `?paleta`.
* **Barramento simulado de `core-progress` (`A`–`F`):** emitir eventos em tempo real no listener único do front para `transcription.estimate`, `transcription.start` (`probe` → `transcribing` → `complete`), `energy.start`, `chat.fetch`, `selection.start`/`redo`, `proxy.request`, `editor.timeline`, `reframe.start`, `translation.start`, `ai:angles`, `ai:script`, `narration.*`, `export.start`, `export.batch.start`, `components.download` (`ffmpeg`, `yt-dlp`, `deno`, `uv`, `pocket-tts`), `components.worker.install`, `components.models.download`, `tts.models.download`, `sources.url.download`, `sources.hash`/`relocate`/`import(copy)` e `editor_saved`/`editor_save_failed`.
* **Infra UI fora do `core.ts` (`A.9`, `F.4`):** implementar camada de remapeamento + interruptor WCAG 2.1.4 em `src/lib/comandos.tsx`; definir `[data-contrast="high"]` e escala `115%` em `src/styles/tokens.css`; unificar estado de `UpdateNotice.tsx` (`VITE_UPDATER_MOCK` / erros `offline` / `invalid-signature`) com `#/sobre`.

### 2. Projetos, Backups e Diagnóstico (`A`, `B`, `F`)
* **Sem mock hoje:** `projects.create`, `projects.open`, `projects.close`, `backups.settings.set`, `backups.create`, `backups.restore`, `diagnostic.export`, `transcription.hardware.diagnostic`.
* **Divergências:** `projects.recent` retorna sempre `[]` (deve listar ao menos 1 disponível e 1 indisponível); `backups.settings.get` omite `default_interval_seconds`, `default_copies` e `warning`.

### 3. Componentes, Provedores e Orçamentos (`A`, `B`, `E`, `F`)
* **Sem mock hoje:** `components.cancel`, `components.ffmpeg.system`, `components.settings.set`, `jobs.budget.get`, `jobs.redo`, `jobs.redo.estimate`, `jobs.result`, `provider.audit.list`.
* **Divergências:**
  * `components.download` só cobre `deno` e `pocket-tts` (faltam `ffmpeg`, `yt-dlp`, `uv`).
  * `jobs.budget.set` e `jobs.budget.continue` em `src/lib/batchMock.ts:51-57` só aceitam `scope: "batch"` e retornam objeto do lote em vez de `{ budgets: [...] }` como o Rust (`scope: "task"` e `"batch"`).
  * `provider.cost.estimate` retorna apenas `kind: "usd"` (não simula `zero`, `plan_quota`, `unknown`); `provider.prices.get` lista só 1 modelo; `provider.cli.configure` não persiste `timeoutSeconds`; `provider.configure` / `context.get` / `selection_state` são simplificados.

### 4. Fontes, Transcrição e Lotes (`B`, `C`)
* **Sem mock hoje:** `sources.cancel`, `sources.url.cancel`, `proxy.map_time`, `transcription.blocks`, `transcription.sentences`, `transcription.words`, `energy.start`, `jobs.preview`.
* **Divergências:**
  * `sources.import` ignora `audio_track`, `copy`, `language`, `origin_url` e fixa `id: 4`.
  * `chat.status` (`src/lib/core.ts:267`) omite `intervals` e `messages`.
  * `transcription.groq.info` omite `model` e `prices`; `transcription.groq.estimate` omite `minMicroUsd`, `maxMicroUsd` e `audio_us`; `transcription.status` omite `model` e `engine`; `transcription.start` ignora `warnings` e alteração de `language`; `transcription.grouping` precisa refletir `#279` (`mode: "auto" | "manual"`).

### 5. Seleção, Editor, Transformação e Saída (`C`, `D`, `E`, `F`)
* **Sem mock hoje:** `editor.snapshots`, `script.narration_allowed`, `export.status` (ramo explícito ausente em `src/features/export/mock.ts`), `documents.validate` (para completude de `CoreCommandMap`).
* **Divergências:**
  * `selection.list`/`get` omitem `minUs`, `maxUs`, `planState`, `revision`, `revisions`, `window.profile`/`jobId`; `selectionReviewMock` ignora `run` e fixa 3 candidatos (`1, 2, 3`) sem estado persistente de `decide`/`adjust`/`undo`.
  * `src/lib/editorEditsMock.ts`: defaults divergem do Rust (`soundtrack.volume: 0.25`, `fadeInUs: 500_000`, `fadeOutUs: 800_000`, `sfx: 0.85`, `fps: 24` vs. `0.30`, `0`, `0`, `0.80` no Rust).
  * `src/lib/captionsMock.ts`: único `Map` global de `overrides` sem isolamento por `transcript_id`.
  * `src/lib/translationMock.ts`: fixa `permissionStateOf(1)` ignorando `sourceId` real e simula progresso por `pendingPolls`.
  * `src/lib/scriptMock.ts`: `angles.estimate` omite `profile`, `angles.choose` retorna `{ selected }` em vez do documento completo, `script.estimate`/`regenerate` ignoram `profileId` e `block`, `script.edit` ignora `title` e `refs`.
  * Mídia no mock: `narration.record_block` e `narration.cleanup.prepare` não servem WAVs reais em `mediaUrl('narration-original/...')` e `'narration-clean/...'`.
  * `src/lib/thumbnailMock.ts`: `thumbnail.export` fixa `/test/exports/capa.png`.
  * `guardrails.check`: usa `applicable`/`totalUnverified` em vez de `hasAudio`/`unverifiedCount` e omite `freezeTailCount`/`longFreezeTailCount`/`maxFreezeTailUs`.

---

## Inconsistências entre pacotes

| # | Item | Onde diverge | Correção recomendada | Status |
|---|---|---|---|---|
| 1 | **Rota de Lotes** | `01-arquitetura.md` §2 cita `#/projeto/:id/exportacao/lotes`, §3 e `F` usam `#/projeto/:id/exportacao?sub=prontidao\|lotes`; `B` introduz `#/projeto/:id/fontes?sub=fontes\|lotes` ausente em §3. | Padronizar `?sub=` em ambas (`fontes?sub=fontes\|lotes` e `exportacao?sub=prontidao\|lotes`), manter `/exportacao/lotes` como redirect e atualizar `01-arquitetura.md` §2 e §3. | aplicada |
| 2 | **Assistente: modal vs. rota** | `01-arquitetura.md` §2 descreve *"(modal/fluxo guiado)"*, enquanto §3 e `A` definem rota `#/assistente?passo=1\|2`. | Fixar rota dedicada `#/assistente?passo=1\|2` com `<Tela modoMinimo>` e corrigir texto da §2. | aplicada |
| 3 | **Lado e atalho da Transcrição do Corte em `D` vs. `E`** | `D` (`Editar`) acopla Transcrição do Corte à **esquerda** com `Ctrl/Cmd+[` (e Inspetor à direita com `Ctrl/Cmd+]`). `E` (`Transformar`) acopla a Transcrição do Corte à **direita** com `Ctrl/Cmd+]`. | Manter Transcrição do Corte **sempre à esquerda com `Ctrl/Cmd+[`** tanto em `Editar` (`D`) quanto em `Transformar` (`E`) (iniciando recolhida em 1366 px e aberta à esquerda em 1440+ px). | aplicada |
| 4 | **Rótulos no `<ContextoCorte>`** | `D` usa *"Exportar Corte (Ctrl+E)"* e *"Corte 2/8: <título>"*; `E` usa *"Exportar MP4"* e *"Corte #12"*, além de citar *"Converter em Vídeo transformado"* como fluxo ativo apesar da lacuna do núcleo. | Padronizar *"Exportar Corte"* (`Ctrl/Cmd+E`), `"Corte {i}/{N}: {título}"` (ou `Corte #{id}` se avulso) e manter *"Converter em Vídeo transformado"* desabilitado com tooltip até o ticket #4 de Rust. | aplicada |
| 5 | **Toast ao redirecionar `Transformar` em `Corte direto`** | `E` especifica toast informativo (*"Transformar está disponível apenas para Vídeo transformado"*); `D` apenas cita o redirect para `/editar`. | Exibir o toast informativo de `E` no redirect de guarda de rota. | aplicada |
| 6 | **Escopo contextual de `Ctrl/Cmd+S`** | `01-arquitetura.md` §8 lista `Ctrl/Cmd+S` apenas para `editor.flush` (`Editar`); `E` usa também para `script.edit` (em `Transformar`) e `packaging.edit` (em `Empacotar`). | Atualizar §8 da arquitetura para tornar `Ctrl/Cmd+S` contextual às 3 sub-abas do Corte. | aplicada |
| 7 | **Exportação individual na Mesa de Prontidão** | `01-arquitetura.md` §2 coloca `export.start` só em `Editar`/`Empacotar`; `F.1` adiciona *"Exportar só este"* no menu do card. | Oficializar *"Exportar só este"* em `01-arquitetura.md` §2 abrindo o mesmo modal de `guardrails.check` do `<ContextoCorte>`. | aplicada |
| 8 | **Guarda de Fonte `offline`/`changed` em `Transformar`/`Empacotar`** | `01-arquitetura.md` §3 documenta modo somente-leitura de mídia apenas em `editar`; `E` aplica também em `transformar` e `empacotar`. | Estender a regra da §3 para `transformar` e `empacotar` (edição textual/áudio via SQLite preservada; preview e export bloqueados com banner). | aplicada |
| 9 | **Query params de teste** | `01-arquitetura.md` §3 define `?estado=vazio\|erro\|carregando` e `?paleta`; `D` e `F` adicionam `?estado=erro-flush`, `?estado=offline`, `?estado=parcial`, `?export-fallback=1`, `?updater-test=...`. | Unificar tabela oficial de params de mock/QA (`?estado=vazio\|erro\|carregando\|parcial\|offline\|erro-flush\|fallback` e `?paleta`). | aplicada |
| 10 | **Nomes/props dos componentes compartilhados** | Props misturando PT/EN (`open`/`aberto`, `variant`/`intent`/`variante`) e múltiplos nomes para estados (`BannerEstado`, `ErroAcionavel`, `EstadoVazio`, `Skeleton`). | Adotar estritamente as interfaces canônicas da Seção 2 deste documento. | aplicada parcialmente: regra canônica registrada em `01-arquitetura.md` e no catálogo; nomes/props nos pacotes `A`–`F` não foram reescritos |

---

## Avaliação de completude

Todos os pacotes foram conferidos contra as **10 partes exigidas** (`1. Objetivo/navegação`, `2. Layout por zonas com wireframe 1366 e 1440+`, `3. Conteúdo`, `4. Ações`, `5. Estados`, `6. Eventos core-progress`, `7. Teclado/acessibilidade`, `8. US #26`, `9. Lacunas`, `10. Critérios de aceite`).

| Pacote | Telas / Superfícies | 10 partes | Pontos fortes | Pontos rasos / lacunas de especificação |
|---|---|---|---|---|
| **A** (`A-shell-inicio-config.md`) | 10 (Shell, Início, Assistente, JIT, 6 seções Config) | **Sim (10/10)** | Textos PT-BR reais, mapeamento de erros, regras WCAG 2.1.4 e remapeamento bem definidos. | Telas 6, 7, 8, 9 e 10 não desenham variação específica para `1440+ px` (compartilham wireframe de `1366 px` com nota genérica). |
| **B** (`B-fontes-e-transcricao.md`) | 3 (Lista/Entrada, Lotes, Detalhe/Transcrição) | **Sim (10/10)** | Cobertura minuciosa de contratos, FTS5, `#279`, `F2`/`Enter`, `undo` global e acessibilidade de palavras (`≥ 24 px`). | Wireframe da Tela 2 (`Lotes`) é único para `1366/1440+`; faltou fechar na época se `#279` já estava no Rust (verificado nesta consolidação: já está). |
| **C** (`C-cortes-selecao-revisao.md`) | 2 (Configurador C.1, Bancada C.2) | **Sim (10/10)** | Pacote mais homogêneo; trata revisões múltiplas, `uncertain`, `Espaço para comentário`, `±1 Frase` e bug `tabIndex={-1}`. | Pequena dependência de definição de `:corteId` (resolvida na Seção 3). |
| **D** (`D-corte-editar.md`) | 2 (`<ContextoCorte>` + `Editar`) | **Sim (10/10)** | Ciclo de vida transversal (`preview`, autosave `1 s`, `flush`, `undo` vs fora do `undo`) e cobertura funcional 100% fiel a `05-editor.md`. | **Mais condensado visualmente** (ver avaliação detalhada abaixo): faltam wireframes internos das 5 abas do Inspetor, do `Índice do Corte` e da interação no modo `Fonte 16:9`. |
| **E** (`E-corte-transformar-empacotar.md`) | 2 (`Transformar`, `Empacotar`) | **Sim (10/10)** | Sub-superfícies 3A (TTS JIT) e 3B (Teleprompter + `prefers-reduced-motion`) excelentes; validadores YouTube/vidIQ e crédito protegido exatos. | Posição/atalho do painel Transcrição do Corte divergente de `D` (corrigido na Seção 6). |
| **F** (`F-exportacao-fila-relatos.md`) | 4 (Exportação, Fila de Jobs, Relatos, Sobre) | **Sim (10/10)** | Mapeamento de 14 erros na Exportação, 4 trilhas de `core-progress` na Fila, fluxo ADR-0006 em 2 passos em Relatos. | `Relatos` e `Sobre` descrevem `1440+ px` apenas em prosa curta (sem wireframe próprio). |

### Avaliação objetiva do Pacote D (`D-corte-editar.md`)
Apesar de ser a tela mais complexa do aplicativo e ter extensão compacta frente à quantidade de recursos, `D-corte-editar.md` **cobre integralmente os contratos funcionais** exigidos:
1. **Transcrição do Corte + Índice textual:** **Coberto** (L262–275) — alternador `Transcrição | Índice do Corte`, busca `Ctrl/Cmd+F`, frases vizinhas atenuadas, `seek` no clique, `F2`/`Enter` para `transcription.correct`, silêncios tachados+hachurados com toggle inline, menu contextual da palavra e `Índice do Corte` virtualizado (`<ListaVirtual>`) filtrável e operável 100% por teclado. *Falta na Fase 4:* wireframe mostrando a linha-tipo do `Índice do Corte`.
2. **Palco 9:16:** **Coberto** (L276–289) — alternância `Prévia 9:16 | Enquadrar na Fonte 16:9`, 5 layouts via `cropMath.ts`, `SpliceMap`, legendas ao vivo via `render.ts` (`1080×1920`), badge de borda ao vivo durante arrasto, `duckingMath.ts` e transporte `role="toolbar"`. *Falta na Fase 4:* detalhar alças de redimensionamento do retângulo de crop no modo `Fonte 16:9` (inclusive operação por teclado no canvas e seleção de painel `Topo`/`Base`).
3. **As 5 abas do Inspetor:** **Todas as 5 cobertas** (L290–324) — `Enquadramento` (5 layouts, `splitRatio`, `<InstaladorJustInTime recurso="yunet" />`, `reframe.*`, aviso de `set_suggested` fora do `undo`, keyframes + `cut`, `<ConfirmDialog>` de limpeza), `Legendas e Tradução` (`remap_status`, 4 faixas, 3 presets, estilos com `revision`, glifos, `override`, tradução com permissão e edição), `Silêncios` (`120 ms`/`75 ms`, slider `300–2000 ms`, *review cards* com contexto e *"Ouvir em contexto"*), `Áudio e SFX` (trilha 30% + ducking `-12 dB`, SFX 80%, biblioteca até 500 MiB com `cc_by` obrigatório e `audio.delete` confirmado) e `Histórico e Snapshots` (`undoCount`/`redoCount`, `Salvar agora`, explicação do que fica fora do `undo`, até 20 snapshots somente leitura). *Falta na Fase 4:* wireframes internos de layout para cada uma das 5 abas (especialmente `Legendas e Tradução` e `Áudio e SFX`, que têm muitos controles).
4. **Timeline (faixas, zoom, bordas):** **Coberto** (L325–335) — cabeçalho com `±1 Frase`, duração efetiva, zoom (`-`, `+`, `Ajustar ao Corte`), Mini-mapa `±2 min`, Régua/Playhead (`role="slider"`) e as 5 faixas (`Vídeo` com `thumbs.jpg` e alças `I`/`O`, `Áudio e Silêncios` com `wave.bin` e hachura, `Frases e Keyframes`, `NarrationTrack` condicional com empurrões `300 ms` e `Cauda congelada`, `AudioTrack` com curva de ducking `-12 dB` e pinos SFX). *Falta na Fase 4:* especificar estados visuais de seleção/foco na timeline e recarga de `editor.sentences` caso o usuário estenda além da janela carregada inicialmente.
5. **Ciclo de vida da sessão:** **Completamente coberto** (L25–52) — `editor.open`, modo somente-leitura para Fonte `offline`/`changed`, `preview: true/false`, autosave `1 s`, `Ctrl/Cmd+S`, guarda de saída com 3 opções em falha de `editor.flush`, `CloseRequested` no Rust e fronteira explícita entre `editor.undo`, `transcription.undo` e ações fora da pilha.

---

## Pronto para a fase 4?

Checklist objetivo antes de iniciar os mockups e o design system:

- [x] **Decisões do dev resolvidas (11 itens `[decidido pelo dev em 17/11: recomendação aprovada]` + 15 resoluções por consistência aprovadas na Seção 3):** `:corteId` = `candidateId` (+ token `avulso-...`), coordenação de `CloseRequested` via evento Rust → WebView, válvula de escape no erro de `editor.flush`, persistência local de Aparência/WCAG 2.1.4 e *"Exportar só este"* na Mesa de Prontidão.
- [x] **Atualização pontual de `01-arquitetura.md`:** alinhar §2/§3 (`#/assistente` rota dedicada, `?sub=fontes|lotes`, `?sub=prontidao|lotes`, `:corteId`, guarda `offline`/`changed` em `Transformar`/`Empacotar`, `export.start` na Mesa de Prontidão, tabela oficial de query params), §5 (`CloseRequested`), §8 (`Ctrl/Cmd+S` contextual no Corte, `Alt+PageUp/PageDown` para `< Anterior | Próximo aprovado >`, Transcrição do Corte sempre à esquerda `Ctrl/Cmd+[` em `D` e `E`), §10 e §11 (tickets de melhora).
- [ ] **Congelamento do Catálogo de Componentes Compartilhados (Seção 2):** mapear cada componente canônico para os arquivos existentes em `design-system/src/components/` antes de desenhar novos tokens ou componentes.
- [ ] **Plano de detalhamento visual do Pacote D na Fase 4:** incluir explicitamente no escopo de mockups os wireframes das 5 abas do Inspetor, do `Índice do Corte` e da manipulação de retângulos no modo `Fonte 16:9`.
- [ ] **Tickets separados para Fase 5 abertos:** 3 tickets bloqueantes da Fase 5 + 11 tickets de melhora no Rust (Seção 4) e pacote de atualização do Mock TS (Seção 5) para garantir protótipo e E2E navegáveis sem query flags ocultas.
