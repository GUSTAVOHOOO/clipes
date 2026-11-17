# Pacote E — Corte: Transformar e Empacotar

Especificação detalhada das sub-abas **Transformar** e **Empacotar** da **Tela do Corte** do front v2 do Clipes.

* **Arquitetura vinculante:** [01-arquitetura.md](../01-arquitetura.md) (herda Shell Global, `<ContextoCorte>`, máquina de 6 estados, `<ResumoCustoPrivacidade>`, mapeador central de `CoreError.code`, store único de `core-progress`, política de atalhos e conformidade WCAG 2.2 AA).
* **Domínios de referência:** [06-roteiro-narracao-e-saida.md](../funcionalidades/06-roteiro-narracao-e-saida.md), [04-selecao-de-cortes.md](../funcionalidades/04-selecao-de-cortes.md), [01-instalacao-e-sistema.md](../funcionalidades/01-instalacao-e-sistema.md), [07-provedores-jobs-e-eventos.md](../funcionalidades/07-provedores-jobs-e-eventos.md) e [ADR-0001](../../adr/0001-dois-tipos-de-video-e-regras-de-transformacao.md).
* **Vocabulário:** [GLOSSARY.md](../../../GLOSSARY.md) — termos canônicos com inicial maiúscula (*Corte*, *Corte direto*, *Vídeo transformado*, *Transformação*, *Roteiro*, *Narração*, *Empacotamento*, *Permissão*, *Fonte*, *Frase*, *Provedor*, *Perfil de Provedor*, *Somente local*).

---

## Tela 1 — Sub-aba `Transformar` (`#/projeto/:id/corte/:corteId/transformar`)

### 1. Objetivo e navegação

Conduzir o usuário pelo fluxo humano-no-loop obrigatório do **Vídeo transformado** — **1. Ângulo** → **2. Roteiro em blocos** (com trava de aprovação) → **3. Narração** (TTS *just-in-time*, gravação com teleprompter ou importação, limpeza Antes/Depois e revisão de alinhamento) — garantindo contribuição criativa revisada antes da montagem e exportação.

* **De onde o usuário chega:**
  * Da sub-aba **Editar** (`#/projeto/:id/corte/:corteId/editar`) pelo seletor de sub-abas no `<ContextoCorte>`.
  * Da **Revisão de Cortes** (`#/projeto/:id/cortes/revisao/:runId`) ao abrir um Corte aprovado de **Vídeo transformado** ou ao converter um **Corte direto** via ação *"Converter em Vídeo transformado"* no `<ContextoCorte>`.
  * Do toast/link de job concluído na **Fila de Jobs** (`ai:angles:done`, `ai:script_block:done`, `narration`, `narration_align`).
* **Para onde o usuário vai:**
  * Para **Empacotar** (`#/projeto/:id/corte/:corteId/empacotar`) ao finalizar a Narração para gerar capa, título, descrição com capítulos e tags.
  * Para **Editar** (`#/projeto/:id/corte/:corteId/editar`) para ajustar o posicionamento temporal da Narração na `NarrationTrack` (`editor.montage.set_start`), revisar legendas na faixa `narration` ou mixar trilha/SFX.
  * Para outro Corte aprovado via botões `< Corte anterior | Próximo aprovado >` em `<ContextoCorte>`.
* **Guardas de rota:**
  1. Sem Projeto aberto → redireciona para `#/inicio`.
  2. `:corteId` inexistente ou candidato não aprovado → redireciona para `#/projeto/:id/cortes` com aviso.
  3. Corte for **Corte direto** (`videoKind === "direct"`) → a aba `Transformar` fica **oculta** no `<ContextoCorte>`; se acessada diretamente por URL/histórico, redireciona para `#/projeto/:id/corte/:corteId/editar` com aviso informativo (`"Transformar está disponível apenas para Vídeo transformado"`).

---

### 2. Layout por zonas

A sub-aba ocupa a área principal abaixo do `<ShellGlobal>` e do `<ContextoCorte>`. O cabeçalho do **Stepper** permanece fixo no topo da sub-aba; o conteúdo do passo ativo e o painel lateral de contexto da Transcrição rolam de forma independente.

#### Em 1366 px (notebook alvo)

Por padrão, o painel de contexto (**Transcrição do Corte**) inicia **recolhido** (`Ctrl/Cmd+]` abre/fecha), preservando largura de leitura confortável (`≤ 68 ch`) para roteiro, edição de blocos e teleprompter sem aperto horizontal:

```text
+----------------------------------------------------------------------------------+
| <ShellGlobal> (Barra Superior 44px)                                              |
+----------------------------------------------------------------------------------+
| <ContextoCorte>: < Anterior | Corte #12 [Vídeo transformado] | Próximo >         |
| Sub-abas: [ Editar ]  [(ativo) Transformar ]  [ Empacotar ]      [Exportar MP4]  |
+----------------------------------------------------------------------------------+
| STEPPER (fixo na sub-aba):                                                       |
|  (1) Ângulo [Escolhido] ──> (2) Roteiro [3/5 aprovados] ──> (3) [Trava] Narração |
|                                                [Abrir Transcrição do Corte (Ctrl+])] |
+----------------------------------------------------------------------------------+
|                                                                                  |
|   ÁREA DO PASSO ATIVO (centralizada/confortável <= 68 ch, scroll próprio)        |
|   +--------------------------------------------------------------------------+   |
|   | Cabeçalho do Passo + Banner pedagógico (quando aplicável)                |   |
|   | Controles primários do Passo (estimativa/geração/status)                 |   |
|   +--------------------------------------------------------------------------+   |
|   | Lista de cartões / blocos / formulários do Passo                         |   |
|   | (no Passo 1: sugestões + formulário manual)                              |   |
|   | (no Passo 2: blocos numerados 1..N editáveis + aprovar/regenerar)        |   |
|   | (no Passo 3: pré-requisitos TTS + ações globais + cartões por bloco)     |   |
|   +--------------------------------------------------------------------------+   |
|                                                                                  |
+----------------------------------------------------------------------------------+
| <BarraStatus> (Autosave / Job ativo / Dica F6 e atalhos)                         |
+----------------------------------------------------------------------------------+
```

#### Variação em 1440+ px

A **Transcrição do Corte** (com IDs de Frase e timestamps) abre acoplada à direita como painel auxiliar (`<aside>`), sem cobrir a área do passo ativo, facilitando conferir falas originais ao escrever um ângulo ou editar `refs` dos blocos do Roteiro:

```text
+----------------------------------------------------------------------------------+
| STEPPER: (1) Ângulo [Escolhido] ──> (2) Roteiro [5/5 aprovados] ──> (3) Narração |
+----------------------------------------------------+-----------------------------+
| ÁREA DO PASSO ATIVO (<= 68 ch, scroll próprio)     | TRANSCRIÇÃO DO CORTE        |
|                                                    | (painel acoplado, scroll)   |
| [Cabeçalho, avisos e ações do Passo]               | #104 [00:12] "Quando a..."  |
| [Blocos / Formulários / Controles de Narração]     | #105 [00:18] "E aí o..."    |
|                                                    | (clique copia ID p/ refs)   |
+----------------------------------------------------+-----------------------------+
```

#### Sub-superfícies internas do Passo 3 (Narração)

**3A. Instalador *just-in-time* de `pocket-tts` e Modelo TTS (exibido inline no topo do Passo 3 ou em diálogo quando o usuário escolhe síntese por TTS e falta o motor ou o modelo do idioma):**

```text
+----------------------------------------------------------------------+
| PREPARAR VOZ LOCAL (TTS)                                             |
| Para sintetizar a Narração no seu computador, faltam:                |
|  [1] Motor de voz pocket-tts  · ~XX MB · Licença Apache-2.0          |
|      [ Instalar motor de voz ]  (ou barra de progresso + [Cancelar]) |
|  [2] Modelo de voz (PT-BR)    · ~XXX MB · Licença (do catálogo)      |
|      Termo de uso proibido: [Resumo PT] [Ver texto completo]         |
|      [x] Li e concordo com as restrições de uso da voz sintética     |
|      [ Baixar modelo de voz ]   (ou progresso % + [Cancelar])        |
+----------------------------------------------------------------------+
```

**3B. Gravador com Teleprompter (painel focado inline no bloco ou modal expandido quando o usuário clica *"Gravar neste bloco"*):**

```text
+----------------------------------------------------------------------+
| GRAVAR NARRAÇÃO — Bloco 2 de 5: "O ponto de virada"       [Esc Fechar]|
+----------------------------------------------------------------------+
| Controles do teleprompter:                                           |
|  Velocidade: [—|----] 45 px/s  Fonte: [A-] [A+]  Modo: [Rolagem|Passo]|
+----------------------------------------------------------------------+
|                                                                      |
|   > "Mas o detalhe que quase ninguém percebeu naquela jogada         |
|      foi exatamente o tempo de reação antes da resposta..."          |
|                                                 (texto <= 68 ch)     |
+----------------------------------------------------------------------+
| VU Microfone: [||||||......]   Tempo: 00:08.4   Estado: Gravando     |
| [ Pausar ]   [ Parar e salvar ]   [ Descartar e regravar ]           |
| (Se no_speech_detected: Player do rascunho + [Descartar rascunho])   |
+----------------------------------------------------------------------+
```

---

### 3. Conteúdo e componentes por zona

#### Zona A — Stepper com travas

* **Dados:** `angles.get` (`selected`, `busy`), `script.get` (`current`, `narrationAllowed`, `busy`, `languageRequired`, `detectedLanguage`), `narration.get` (`narrationAllowed`, `gateReason`, `blocks`).
* **Controles (ordem de leitura):**
  1. **Passo `1. Ângulo`**: sempre habilitado. Mostra badge `"Pendente"` ou `"Definido: {selected.name}"`.
  2. **Passo `2. Roteiro`**: desabilitado se `selected === null` (tooltip/texto: *"Escolha ou escreva um ângulo no Passo 1 para liberar o Roteiro"*). Quando liberado, mostra `"Não gerado"`, `"{approved}/{total} aprovados"` ou `"Todos aprovados"`.
  3. **Passo `3. Narração`**: clicável para leitura explicativa, porém **travado para ações de áudio** enquanto `narrationAllowed === false` (`gateReason`: `"no_script"` | `"generating"` | `"pending_blocks"`). Mostra cadeado com rótulo `"Travado · {pending} blocos pendentes"`. Quando `narrationAllowed === true`, mostra `"{comAudio}/{total} blocos com voz"` ou `"Pronto para Empacotar"`.
* **Botão auxiliar à direita:** *"Abrir Transcrição do Corte"* / *"Fechar Transcrição"* (`Ctrl/Cmd+]`).

#### Zona B — Conteúdo do Passo 1: Ângulo

* **Explicação inicial:** `"Escolha a promessa central do Vídeo transformado. Ela guia o Roteiro, o título e a ideia de capa."`
* **Seletor de idioma (quando `script.get.languageRequired === true`):** `<select>` com `PT-BR` e `EN` + dica `"O idioma deste Corte não ficou claro na Transcrição; escolha em que idioma gerar."`
* **Cartão do ângulo escolhido** (visível quando `angles.get.selected !== null`): título (`selected.name`), promessa (`selected.promise`), público-alvo (`selected.audience`, se houver) e Frases vinculadas (`selected.sentence_ids`).
* **Ação de sugestão por Provedor:** botão *"Sugerir ângulos"* (ou *"Sugerir novos ângulos"* se já houver sugestões em `angles.get.angles`). Ao acionar, chama `angles.estimate` e, se `paid === true` ou CLI, exibe `<ResumoCustoPrivacidade>` antes de `angles.generate`.
* **Lista de sugestões (`angles.get.angles`):** 2 a 3 cartões, cada um exibindo `name`, `promise`, `audience`, chips das `sentence_ids` (clicáveis para rolar/destacar no painel de Transcrição do Corte) e botão *"Escolher este ângulo"*.
* **Seção expansível *"Escrever meu próprio ângulo"*:**
  * Campo **Nome do ângulo** (obrigatório, `1..60` caracteres, contador `tabular-nums`).
  * Campo **Promessa em uma frase** (obrigatório, `1..200` caracteres, 1 linha e 1 frase).
  * Campo **Para quem é (opcional)** (`0..120` caracteres).
  * Campo **Frases de apoio (opcional)** (`1..12` IDs do Corte, preenchível digitando ou clicando em Frases no painel lateral da Transcrição).
  * Botão *"Usar meu ângulo"*.

#### Zona C — Conteúdo do Passo 2: Roteiro em blocos

* **Banner pedagógico permanente (ADR-0001):**
  * Título: *"Revisão humana obrigatória antes da Narração"*
  * Texto: *"O Provedor sugere um rascunho em blocos, mas só você aprova o texto final. A etapa de Narração é liberada apenas quando todos os blocos estiverem aprovados — isso garante Transformação real e evita conteúdo automático repetitivo."*
* **Barra de cabeçalho do Roteiro:**
  * Ângulo ativo (`angle.name`), seletor de idioma se `languageRequired === true`, botão *"Sugerir Roteiro"* (ou *"Sugerir novo Roteiro"* se já existir `current`), contador de aprovação (`"Faltam {pending} de {total} blocos para aprovar"` ou `"Todos os blocos aprovados — Narração liberada"`), contador global de caracteres (`"{totalChars}/{limits.scriptChars} caracteres"`, `tabular-nums`) e link *"Avançar para Narração →"* (habilitado apenas quando `narrationAllowed === true`).
* **Lista ordenada de blocos (`current.blocks`, 3 a 12 itens, coluna `≤ 68 ch`):**
  * Cabeçalho do cartão: `Bloco {position}`, badge de estado (`Pendente`, `Aprovado`, `Desatualizado — ângulo mudou` quando `stale === true`, `Editado` quando `edited === true`), intenção narrativa (`intent`).
  * Campo **Título do bloco** (`title`, editável, limite `limits.titleChars` com contador).
  * Campo **Texto da Narração** (`narration`, `<textarea>`, limite `limits.narrationChars` com contador `tabular-nums`; exibe estado `"Gerando texto deste bloco…"` enquanto `block.job` estiver `queued`/`running`).
  * Campo **Frases de referência** (`refs`, lista de IDs do Corte com limite `limits.refs`, vinculável ao painel de Transcrição).
  * Barra de ações do bloco:
    * *"Salvar edição"* (`script.edit` — ativo quando qualquer campo do bloco foi alterado; salvar retorna bloco para `Pendente`).
    * *"Aprovar bloco"* (`script.approve` — ativo quando o bloco tem texto, não há edição não salva e `status === "pendente"`).
    * *"Regenerar bloco"* (menu ou botão com opção padrão e *"Refazer com outro Perfil…"*, listando `provider.profiles.list` e chamando `script.estimate { block, profileId }` → `<ResumoCustoPrivacidade>` → `script.regenerate`).

#### Zona D — Conteúdo do Passo 3: Narração

* **Faixa de trava (quando `narrationAllowed === false`):**
  * Alerta informativo: *"Narração travada: ainda há {pending} bloco(s) pendente(s) no Roteiro."* (ou *"Gere e aprove o Roteiro antes de narrar."*). Explica a regra da ADR-0001 e oferece botão primário *"Voltar ao próximo bloco pendente"* (salta para o Passo 2 focando o primeiro bloco não aprovado).
* **Resumo da etapa (quando `narrationAllowed === true`):**
  * Idioma do Roteiro (`pt` / `en`), duração total da Narração (`totalDurationUs` em `tabular-nums`), status de alinhamento automático (`alignPrerequisitesReady`: se `false`, aviso discreto *"Alinhamento de legendas indisponível: instale o Motor de transcrição local em Configurações → Componentes para gerar legendas da Narração"*).
  * **Seletor de voz e motor local (`pocket-tts`):**
    * Se faltar `pocket-tts` ou modelo TTS do idioma: exibe o bloco **3A (Instalador *just-in-time*)** ao acionar TTS ou num banner recolhível de preparação.
    * Quando pronto: seletor de **Voz** (`tts.catalog.voices` compatíveis com o idioma e modelos baixados, mostrando nome e atribuição/licença) e seletor de **Modelo ativo** (`tts.models.choose`, se houver mais de um modelo para o idioma, ex.: `portuguese_24l` / `portuguese`).
  * **Ações globais da Narração:**
    * *"Gerar voz de todos os blocos (TTS)"* (`narration.generate` — pede `<ConfirmDialog>` se já existir áudio gravado/importado em algum bloco).
    * *"Alinhar todos os blocos"* (`narration.align` — habilitado se houver ao menos 1 bloco com áudio e `alignPrerequisitesReady === true`).
    * Botão de saída quando tudo estiver pronto: *"Avançar para Empacotar →"* (e atalho secundário *"Ajustar posição na timeline (Editar)"*).
* **Cartões de bloco (`narration.get.blocks`):**
  * **Cabeçalho:** `Bloco {position} · {title}`, texto aprovado (`narrationText`, `≤ 68 ch`), badge de fonte do áudio (`TTS · {voiceId}` | `Gravado` | `Importado` | `Sem áudio`), duração do áudio (`durationUs`), badge `Desatualizado (Roteiro alterado)` se `audio.stale === true`.
  * **Barra de criação/substituição de áudio (3 caminhos):**
    1. *"Gerar com voz (TTS)"* / *"Regenerar TTS"* (`narration.regenerate_block`).
    2. *"Gravar no microfone"* → abre a sub-superfície **3B (Gravador com Teleprompter)** para este bloco.
    3. *"Importar áudio"* → diálogo nativo de arquivo (`.wav`, `.mp3`, `.m4a`, `.ogg`, máx. `200 MiB`, `0,3 s` a `10 min`) → `narration.import`.
  * **Controles específicos de gravação sem VAD:** quando `audio.engineId === "recorded"` e `audio.trimmed === false`, exibe aviso *"Silêncios não foram aparados na gravação"* e botão *"Aparar silêncios agora"* (`narration.trim_block`, habilitado quando `vadReady === true`, ou link para instalar o Worker em `#/config/componentes`).
  * **Player e Limpeza de voz (apenas quando `audio.cleanup.applicable === true`, i.e., `recorded` ou `imported`):**
    * Checkbox/switch *"Limpeza de voz (remove ruído de fundo e grave)"* (`narration.cleanup.set`).
    * Controle segmentado **`Antes (original)` | `Depois (limpa)`** para ouvir a comparação (`narration.cleanup.prepare` sob demanda quando `cleanup.ready === false`, tocando `mediaUrl('narration-original/' + audio.id)` vs. `mediaUrl('narration-clean/' + audio.id)`).
    * Indicador textual do piso de ruído (`"Ruído medido nos silêncios"` quando `noiseFloorSource === "vad"`, `"Piso padrão aplicado"` quando `"default"`).
  * **Alinhamento e Revisão de desvios (`alignment`):**
    * Badge de estado: `Pendente` | `Alinhado` | `Revisão necessária` (`needs_review`) | `Revisado` (`approved`) | `Falhou`.
    * Quando `status === "needs_review"`: caixa de revisão destacada mostrando:
      * *"O áudio falado diferiu do Roteiro ({insertions} acréscimo(s), {substitutions} troca(s)). Escolha qual texto vai para as legendas:"*
      * Comparação **Roteiro aprovado** (`narrationText`) × **Detectado na fala** (`alignment.spokenText`).
      * Dois botões: *"Usar texto do Roteiro"* (`narration.review { choice: "script" }`) e *"Usar texto falado"* (`narration.review { choice: "spoken" }`).
    * Botão secundário *"Re-alinhar bloco"* (`narration.align_block`).

#### Zona E — Painel lateral acoplável: Transcrição do Corte

* **Dados:** `editor.sentences` ou trecho da Transcrição do Corte (`start_id`..`end_id`), com IDs das Frases e timestamps em `tabular-nums`.
* **Comportamento:** permite ler o que é dito no Corte enquanto se define Ângulo/Roteiro e clicar em qualquer Frase para inserir/alternar seu ID no campo `refs` em foco (no Passo 1 ou Passo 2).

---

### 4. Ações

| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | O que muda na tela após concluir | Desfazer |
|---|---|---|---|---|---|
| Carregar sub-aba `Transformar` | `angles.get`, `script.get`, `narration.get`, `tts.catalog`, `components.pocket_tts.status` | Projeto aberto; candidato aprovado de Vídeo transformado | Nenhuma | Preenche stepper, trava (`narrationAllowed`) e dados dos 3 passos | — |
| Sugerir ângulos | `angles.estimate` → `angles.generate` | Vídeo transformado; Provedor configurado p/ `script` | `<ResumoCustoPrivacidade>` + `confirmed: true` se `paid` ou CLI | Job `ai:angles` entra em curso; ao concluir, lista 2–3 sugestões | — |
| Escolher sugestão ou salvar ângulo manual | `angles.choose` | Nenhuma geração de Roteiro ativa; campos válidos | `<ConfirmDialog>` se retornar `angle_change_confirmation` (já há Roteiro) → reenvia `confirmed: true` | Atualiza `selected`; se havia Roteiro, blocos ficam `stale: true` e `Pendente`; libera Passo 2 | Pode trocar o ângulo novamente |
| Sugerir Roteiro completo | `script.estimate` → `script.generate` → `script.get` | Ângulo escolhido; idioma definido | `<ResumoCustoPrivacidade>` + `confirmed: true` se `paid` ou CLI | Enfileira `ai:script` e depois `ai:script_block` por bloco; blocos aparecem progressivamente | Gerações anteriores preservadas em `generations` |
| Editar título, texto ou `refs` de um bloco | `script.edit` | Bloco com texto gerado; sem job ativo | Nenhuma | Grava nova versão; bloco volta para `Pendente` (`edited: true`) e trava Passo 3 se estava liberado | Reeditando manualmente |
| Aprovar bloco do Roteiro | `script.approve` | Bloco com texto e sem alterações não salvas | Nenhuma | Bloco passa para `Aprovado`; atualiza contador; quando `pending === 0`, chama `script.narration_allowed` e libera Passo 3 | Editar ou regenerar retorna para `Pendente` |
| Regenerar bloco (mesmo ou outro Perfil) | `provider.profiles.list` (se trocar) → `script.estimate { block, profileId }` → `script.regenerate` | Esboço existente; ângulo válido; bloco livre | `<ResumoCustoPrivacidade>` + `confirmed: true` se `paid` ou CLI | Enfileira `ai:script_block` só para o bloco; bloco volta para `Pendente` | — |
| Instalar `pocket-tts` (*just-in-time*) | `components.manifest` → `components.download { id: "pocket-tts", confirmed: true }` | `data_dir` gravável | `<ConfirmDialog>` com tamanho e licença do manifesto | Baixa com progresso; ao concluir, habilita download/escolha de modelo TTS | Cancelável durante download via `components.cancel` |
| Baixar modelo TTS | `tts.models.download { id, confirmed: true, termsAccepted: true }` | Modelo no catálogo | `<ConfirmDialog>` com tamanho, licença e checkbox obrigatório de termo proibido | Baixa pesos e vozes (`tts:<id>`); ao concluir, atualiza `tts.catalog` e libera vozes | Cancelável via `tts.models.cancel` |
| Escolher modelo TTS padrão do idioma | `tts.models.choose` | Modelo no catálogo | Nenhuma | Atualiza modelo ativo do idioma (`pt` ou `en`) | Troca reversível |
| Gerar voz TTS (todos ou 1 bloco) | `narration.generate` / `narration.regenerate_block` | `narrationAllowed === true`; `pocket-tts` e modelo TTS instalados | `<ConfirmDialog>` se bloco(s) já tiverem gravação/importação | Enfileira job `narration`; ao concluir, dispara `narration_align` se worker pronto | Cancelável via `jobs.cancel`; pode gravar/importar por cima |
| Gravar bloco com teleprompter | `narration.record_block` | `narrationAllowed === true`; permissão de microfone; FFmpeg se não-PCM | Nenhuma | Salva WAV 24 kHz mono, apara com Silero VAD (se pronto) e enfileira `narration_align`. Se `no_speech_detected`, mantém rascunho no cache | *"Descartar rascunho"* (`narration.discard_draft`) em falha; regravar substitui |
| Aparar gravação após instalar Worker | `narration.trim_block` | Bloco `recorded`; `vadReady === true` | Nenhuma | Apara silêncios de início/fim, mede piso de ruído e re-enfileira `narration_align` | — |
| Descartar rascunho sem fala | `narration.discard_draft` | Rascunho salvo após `no_speech_detected` | Nenhuma | Remove arquivo temporário de rascunho e oculta player de rascunho | — |
| Importar áudio externo | `narration.import` | `narrationAllowed === true`; FFmpeg + `ffprobe`; arquivo válido | `<ConfirmDialog>` se bloco já tiver áudio | Enfileira `narration_import`; converte para 24 kHz mono e enfileira `narration_align` | Cancelável via `jobs.cancel` |
| Ligar/desligar limpeza de voz | `narration.cleanup.set` | Bloco `recorded` ou `imported` | Nenhuma | Alterna flag `cleanup.enabled` usada no export | Toggle reversível |
| Ouvir comparação Antes/Depois | `narration.cleanup.prepare` (se `!ready`) | Bloco `recorded` ou `imported`; FFmpeg | Nenhuma | Gera `.clean.wav` se necessário e alterna player entre original e limpo | Alternância instantânea |
| Alinhar Narração (todos ou 1 bloco) | `narration.align` / `narration.align_block` | Bloco(s) com áudio; `alignPrerequisitesReady === true` | Nenhuma | Enfileira `narration_align`; atualiza `alignment.status` | Cancelável via `jobs.cancel` |
| Resolver bloco `needs_review` | `narration.review { choice }` | Bloco alinhado | Nenhuma | Grava escolha (`script` ou `spoken`), marca alinhamento `approved` e libera legenda do bloco | Pode re-escolher chamando `narration.review` |
| Cancelar job em fila | `jobs.cancel { id }` / `components.cancel` / `tts.models.cancel` | Job ou download em andamento | Nenhuma | Interrompe job/download e restaura estado anterior | — |

---

### 5. Estados da tela

1. **`loading` (carregando):** exibe `<Skeleton>` com barras do stepper (3 nós) e estrutura de 3 cartões de bloco (nunca retorna `null` nem `"Nenhum roteiro"` durante a carga).
2. **`empty` (vazio por etapa):**
   * **Passo 1 sem sugestões:** `"Nenhum ângulo sugerido ainda. Peça sugestões ao Provedor ou escreva o seu próprio ângulo."` + CTA primário *"Sugerir ângulos"* e secundário *"Escrever meu próprio ângulo"*.
   * **Passo 2 sem Roteiro (com ângulo escolhido):** `"Ângulo definido! Gere o Roteiro em blocos para revisar e aprovar cada trecho antes de narrar."` + CTA primário *"Sugerir Roteiro"*.
   * **Passo 3 sem áudios (com Roteiro aprovado):** `"Roteiro aprovado. Escolha como dar voz a este vídeo: gere localmente com TTS, grave lendo o teleprompter ou importe um áudio."`
3. **`error` (erro):** exibe container `role="alert"` usando o mapeador central, com detalhes técnicos recolhidos:

| `CoreError.code` | Mensagem humana na UI | Ação de recuperação |
|---|---|---|
| `script_requires_transformed` | Este Corte é um Corte direto; Transformação e Narração existem apenas no Vídeo transformado. | Botão *"Voltar para Editar"* (ou usar *"Converter em Vídeo transformado"* no cabeçalho). |
| `angle_required` | Escolha ou escreva um ângulo no Passo 1 antes de gerar o Roteiro. | Botão *"Ir para o Passo 1 (Ângulo)"*. |
| `angle_invalid` | Confira o nome (até 60 caracteres), a promessa (1 frase, até 200 caracteres) e as Frases selecionadas. | Foca o primeiro campo inválido. |
| `script_not_approved` | Aprove todos os blocos do Roteiro antes de gerar, gravar ou importar a Narração. | Botão *"Ir para o bloco pendente"*. |
| `language_required` | O idioma deste Corte ficou ambíguo. Escolha PT-BR ou EN para continuar. | Foca o seletor de idioma. |
| `local_only_violation` | Bloqueado pelo modo **Somente local**: este Provedor envia o texto para fora da máquina. | Botão *"Configurar Perfil local"* (`#/config/provedores`). |
| `confirmation_required` | Esta chamada usa um Provedor pago ou CLI e precisa da sua confirmação. | Abre `<ResumoCustoPrivacidade>` para confirmar. |
| `edit_invalid` / `invalid_edit` | A edição excedeu o limite de caracteres/referências ou contém formato inválido. | Exibe a violação específica no campo afetado. |
| `generation_in_progress` / `import_in_progress` | Já existe uma geração ou importação em andamento para este Corte. | Botão *"Abrir Fila de Jobs"* (`Ctrl/Cmd+J`). |
| `component_missing` / `ffprobe_missing` / `tts_model_missing` | Falta instalar o motor de voz local (`pocket-tts`), FFmpeg ou o modelo TTS deste idioma. | Abre o cartão *Just-in-Time* correspondente (ou link para `#/config/componentes`). |
| `worker_missing` / `model_missing` | Falta o componente de alinhamento e detecção de voz para esta ação. | Link *"Instalar em Componentes"* (`#/config/componentes`) — permite continuar gravando sem VAD quando aplicável. |
| `no_speech_detected` | Nenhuma fala detectada na gravação. O áudio anterior do bloco foi mantido e este rascunho ficou salvo temporariamente. | Player do rascunho + *"Gravar novamente"* e *"Descartar rascunho"*. |
| `import_unsupported_format` / `import_file_too_large` / `import_duration_too_short` / `import_duration_too_long` / `import_no_audio_stream` / `import_unsupported_codec` | Arquivo inválido: envie `.wav`, `.mp3`, `.m4a` ou `.ogg` com áudio válido entre 0,3 s e 10 min e até 200 MiB. | Botão *"Escolher outro arquivo"*. |
| `narration_cleanup_failed` / `ffmpeg_missing` | Não foi possível preparar a limpeza de voz sem o FFmpeg funcionando. | Link *"Verificar FFmpeg"* (`#/config/componentes`). |

4. **`job_running` (job rodando):** mantém os blocos visíveis e interativos no que não conflitar (ex.: blocos já prontos continuam legíveis; apenas botões de disparo concorrente exibem estado ocupado), mostra barra determinística ou estágio `Preparando → Chamando Provedor → Verificando` e botão **Cancelar**.
5. **`partial` (parcial):**
   * Alguns blocos do Roteiro gerados e outros falhos/cancelados → faixa no topo do Passo 2: *"Roteiro parcial: {prontos} de {total} blocos gerados. Regenere os blocos vazios ou refaça com outro Perfil."*
   * Alguns blocos da Narração com áudio e outros `Sem áudio` ou `stale`, ou blocos com `needs_review` / `warningCode: "vad_unavailable"` → faixa resumo no Passo 3 indicando exatamente quantos blocos ainda precisam de áudio, aparo VAD ou revisão de alinhamento, com botão *"Ir para o próximo pendente"*.
6. **`sem permissão / pré-condição`:**
   * Quando `narrationAllowed === false`, o Passo 3 exibe estado travado pedagógico (ADR-0001) explicando a obrigatoriedade de aprovar todos os blocos no Passo 2.
   * Quando o microfone é negado pelo sistema/WebView durante a gravação, exibe alerta explicando como liberar a permissão de microfone ou usar *"Importar áudio"* / *"TTS local"* como alternativa imediata.

---

### 6. Eventos `core-progress` escutados

| `job` | `stage` | O que a tela atualiza |
|---|---|---|
| `<job_id>` (numérico) | `ai:angles:prepare` / `call` / `verify` / `paused` / `done` | Atualiza indicador de progresso do Passo 1; em `done` (ou `paused` por orçamento), recarrega `angles.get` e limpa estado ocupado. |
| `<job_id>` (numérico) | `ai:script:prepare` / `call` / `verify` / `paused` / `done` | Atualiza progresso do esboço no Passo 2; em `done`, chama `script.get` para materializar os blocos e disparar os `ai:script_block`. |
| `<job_id>` (numérico) | `ai:script_block:prepare` / `call` / `verify` / `paused` / `done` | Atualiza indicador do bloco específico; em `done`, chama `script.get` para exibir texto recém-gerado e atualizar contador de pendências. |
| `<job_id>` (numérico) | `narration` (1–99%), `complete`, `failed` | Atualiza barra de síntese TTS no Passo 3; em `complete` ou `failed`, recarrega `narration.get`. |
| `<job_id>` (numérico) | `narration_import` (10%, 35%, 85%), `complete`, `failed` | Atualiza progresso da importação no bloco; em `complete` ou `failed`, recarrega `narration.get`. |
| `<job_id>` (numérico) | `aligning` (0–99%), `complete`, `failed` | Atualiza progresso de alinhamento; em `complete` ou `failed`, recarrega `narration.get` destacando eventual `needs_review`. |
| `"narration_record"` | `vad` (40% ou 50%), `done` (100%) | Exibe indicador *"Detectando fala e aparando silêncios…"* durante `narration.record_block` e `narration.trim_block`. *(Nota: o store global ignora o evento residual duplicado `job === "0"` conforme Seção 5 da arquitetura.)* |
| `"pocket-tts"` | `download` (0–99%), `complete` (100%) | Atualiza progresso do instalador *just-in-time* de `pocket-tts`; em `complete`, recarrega `components.pocket_tts.status` e `tts.catalog`. |
| `"tts:<model_id>"` | `download` (0–99%), `complete` (100%) | Atualiza progresso do download do modelo/vozes TTS; em `complete`, recarrega `tts.catalog`. |

---

### 7. Teclado e acessibilidade

* **Regiões `F6` / `Shift+F6`:** Topo (`ShellGlobal` + `<ContextoCorte>`) → Stepper + Área do Passo ativo → Painel lateral da Transcrição do Corte (quando aberto) → Barra de Status.
* **Atalhos da tela (sem conflitos com a tabela da arquitetura):**
  * `Ctrl/Cmd+K`: Paleta de comandos (permite saltar para Passo 1/2/3, *"Sugerir Roteiro"*, *"Aprovar bloco atual"*, *"Abrir gravador"*).
  * `Ctrl/Cmd+]`: Abrir/recolher painel da Transcrição do Corte.
  * `Ctrl/Cmd+S`: Se o foco estiver dentro de um bloco editado no Passo 2, salva a edição desse bloco (`script.edit`).
  * `Esc`: Fecha o Gravador com Teleprompter (quando não está gravando ou após confirmar descarte) ou fecha diálogos abertos devolvendo foco ao gatilho.
  * `Espaço`: No Gravador com Teleprompter (fora de sliders/inputs), pausa/retoma a rolagem ou reprodução do rascunho; em botões/controles focados, ativa o controle normalmente.
  * Regra SC 2.1.4: nenhuma letra simples sem modificador dispara atalho quando o foco está em `<input>`, `<textarea>` ou `<select>`.
* **Padrões WAI-ARIA APG:**
  * **Stepper:** `<nav aria-label="Etapas da Transformação">` com `<ol>` e `aria-current="step"` no passo ativo; passos bloqueados usam `aria-disabled="true"` (com descrição via `aria-describedby` explicando a trava, sem impedir leitura por leitor de tela).
  * **Comparação Antes/Depois e escolha de voz:** `role="radiogroup"` com *roving tabindex* ou `<select>` nativo rotulado.
  * **Diálogos (`<ResumoCustoPrivacidade>`, `<ConfirmDialog>`, modal de termos TTS):** `role="dialog"`, `aria-modal="true"`, armadilha de foco e devolução de foco ao gatilho ao fechar.
  * **Anúncios (`role="status"` / `aria-live="polite"`):** mudanças de aprovação (`"3 de 5 blocos aprovados; Narração liberada"`), salvamento de bloco e conclusão de áudio/alinhamento. Erros em `role="alert"`.
  * **Movimento reduzido (`prefers-reduced-motion: reduce`):** o teleprompter desliga rolagem automática contínua por padrão e habilita controles discretos por passo (`Frase anterior` / `Próxima frase` por botão ou `↑`/`↓`).
  * **Alvos e tipografia:** todos os botões, chips de Frase e controles de player possuem alvo mínimo ≥ 24×24 CSS px; contadores de caracteres, durações e valores em USD usam `tabular-nums`.

---

### 8. US do #26 atendidas

* **US-3, US-4, US-5, US-6, US-17:** visibilidade de tamanho/licença, confirmação prévia, retomada, integridade e atualização de `pocket-tts` e modelos TTS.
* **US-28, US-31:** estimativa prévia de custo (`angles.estimate`, `script.estimate`), erro claro e troca manual de Perfil de Provedor por bloco (`profileId`).
* **US-51:** acompanhamento determinístico de progresso e cancelamento sem travar a UI.
* **US-87, US-88, US-89, US-90, US-97:** tipo Vídeo transformado visível, Roteiro em blocos, edição/aprovação/regeneração com contexto vizinho, trava humana obrigatória (`narrationAllowed`) e ausência de geração em lote automática.
* **US-91, US-92, US-93, US-94, US-95, US-130:** TTS local (`pocket-tts`) PT-BR/EN, gravação com teleprompter, aparo automático Silero VAD, importação de áudio, alinhamento por palavra com revisão `needs_review` e limpeza de voz Antes/Depois.
* **US-127:** proposta de 2–3 ângulos ou escrita de ângulo manual antes do Roteiro.

---

### 9. Lacunas (Núcleo Rust e Mock TS)

* **Núcleo Rust:**
  1. Falta comando para remover/limpar o áudio de um bloco gravado/importado/TTS caso o usuário desista de narrar aquele bloco sem sobrescrever (`narration.delete_block`), já que hoje só existe `narration.discard_draft` para rascunhos `no_speech_detected`.
  2. `narration.cleanup.prepare` executa sincronamente sob `projects::start_job()` sem emitir `core-progress`; para áudios importados longos (até 10 min), a tela precisa manter estado de carregamento local no seletor `Depois (limpa)`.
  3. O evento residual `job: "0"` emitido por `core/src/narration_record.rs:859` ao final de `narration.record_block` precisa ser removido no Rust (já mitigado no store da arquitetura filtrando `job === "0"`).
  4. Conversão de **Corte direto** individual em **Vídeo transformado** (dependência #2 da Seção 11 da arquitetura) é necessária para que o botão no `<ContextoCorte>` destrave esta sub-aba sem refazer toda a seleção.
* **Mock TS (`src/lib/core.ts` e `src/lib/scriptMock.ts`):**
  1. `scriptMock.ts` não implementa `script.narration_allowed`, ignora `profileId` e `block` em `script.estimate`/`regenerate`, e em `script.edit` aplica apenas `narration` (ignorando `title` e `refs`).
  2. `angles.estimate` no mock não retorna `profile`, e `angles.choose` retorna `{ selected }` em vez do documento completo de `angles.get`.
  3. O mock não emite eventos `core-progress` em tempo real para `ai:angles:*`, `ai:script:*`, `narration`, `narration_import`, `narration_align`, `pocket-tts` e `tts:<model_id>`.
  4. Áudios gerados por `narration.record_block` e `narration.cleanup.prepare` no mock não servem WAVs reais via `mediaUrl('narration-original/...')` e `mediaUrl('narration-clean/...')`.
  5. `components.cancel` não existe no mock de `src/lib/core.ts`.

---

### 10. Critérios de aceite (E2E / Playwright com mock)

1. Com Corte de tipo **Corte direto**, a sub-aba `Transformar` não aparece no `<ContextoCorte>`, e navegar diretamente para `#/projeto/:id/corte/:corteId/transformar` redireciona para `#/projeto/:id/corte/:corteId/editar`.
2. Com `?estado=vazio` no Corte de **Vídeo transformado**, o Passo 1 exibe `"Nenhum ângulo sugerido ainda"` com foco acessível e botão *"Sugerir ângulos"*; o Passo 2 e o Passo 3 exibem estado travado no stepper.
3. Ao acionar *"Sugerir ângulos"* com Perfil pago no mock, o `<ResumoCustoPrivacidade>` é exibido antes de chamar `angles.generate` com `confirmed: true`; sem confirmação, nenhuma chamada é disparada.
4. Ao preencher manualmente Nome e Promessa em *"Escrever meu próprio ângulo"* e enviar, `angles.choose` atualiza o ângulo escolhido e desbloqueia o Passo 2 (**Roteiro**).
5. Trocar o ângulo quando já existem blocos de Roteiro dispara o diálogo de confirmação (`angle_change_confirmation`) e, após confirmar, marca os blocos existentes como `Desatualizado` e `Pendente`.
6. No Passo 2, editar um bloco aprovado e clicar em *"Salvar edição"* chama `script.edit`, retorna o bloco para `Pendente` e mantém o Passo 3 travado com a explicação pedagógica da ADR-0001 visível.
7. Aprovar o último bloco pendente no Passo 2 atualiza `narrationAllowed` para `true` e desbloqueia imediatamente o Passo 3 (**Narração**).
8. No Passo 3, com `components.pocket_tts.status` retornando `installed: false`, clicar em *"Gerar voz"* exibe o instalador *just-in-time* com tamanho, licença e confirmação antes de chamar `components.download { id: "pocket-tts", confirmed: true }`.
9. No Passo 3, com bloco `recorded`, alternar o controle segmentado para `Depois (limpa)` chama `narration.cleanup.prepare` quando `ready === false` e troca a origem do player de áudio.
10. Quando um bloco está com `alignment.status === "needs_review"`, a tela exibe a comparação entre texto do Roteiro e `spokenText` e clicar em *"Usar texto falado"* chama `narration.review { choice: "spoken" }` mudando o status para `Revisado`.

---

## Tela 2 — Sub-aba `Empacotar` (`#/projeto/:id/corte/:corteId/empacotar`)

### 1. Objetivo e navegação

Preparar e validar todos os artefatos de publicação do Corte — **Capa (PNG)**, **Título**, **Descrição com crédito protegido da Fonte**, **Tags**, **Hashtags**, **Capítulos** (no Vídeo transformado) e **Checklist de Guardrails** — e disparar a exportação individual ou seguir para a exportação em lote.

* **De onde o usuário chega:**
  * Da sub-aba **Editar** (`#/projeto/:id/corte/:corteId/editar`) ou **Transformar** (`#/projeto/:id/corte/:corteId/transformar`) pelo `<ContextoCorte>`.
  * Da **Mesa de Prontidão** (`#/projeto/:id/exportacao`) ao clicar em *"Completar Empacotamento"* / *"Editar capa e texto"* de um Corte específico.
* **Para onde o usuário vai:**
  * Exporta a capa em PNG no computador (`thumbnail.export`).
  * Exporta o vídeo individual em MP4 (`export.start`) pelo botão primário de exportação.
  * Segue para **Exportação e Mesa de Prontidão** (`#/projeto/:id/exportacao`) para conferir todos os Cortes aprovados e exportar em lote.
  * Se `credit.warning === "no_permission"`, link direto para **Fontes e Transcrição** (`#/projeto/:id/fontes/:fonteId`) para registrar a **Permissão** da Fonte.
* **Guardas de rota:**
  1. Sem Projeto aberto → redireciona para `#/inicio`.
  2. `:corteId` inexistente ou candidato não aprovado → redireciona para `#/projeto/:id/cortes` com aviso.
  3. Disponível tanto para **Corte direto** quanto para **Vídeo transformado** (adaptando o bloco de capítulos e os avisos de guardrails conforme `videoKind`).

---

### 2. Layout por zonas

A sub-aba usa duas colunas acopladas abaixo do `<ContextoCorte>` — **Capa e Preview** à esquerda e **Ficha de Empacotamento + Validadores + Guardrails** à direita — com rolagem independente apenas quando o conteúdo da ficha exceder a altura útil.

#### Em 1366 px (notebook alvo)

```text
+----------------------------------------------------------------------------------+
| <ShellGlobal> (Barra Superior 44px)                                              |
+----------------------------------------------------------------------------------+
| <ContextoCorte>: < Anterior | Corte #12 [Vídeo transformado] | Próximo >         |
| Sub-abas: [ Editar ]  [ Transformar ]  [(ativo) Empacotar ]      [Exportar MP4]  |
+----------------------------------------------------------------------------------+
|                                        |                                         |
|  COLUNA ESQUERDA (~42%): CAPA          |  COLUNA DIREITA (~58%): FICHA & SAÍDA   |
|  +----------------------------------+  |  [Sugerir Empacotamento] [Idioma: PT-BR]|
|  | Preview do quadro (16:9 / Corte) |  |  Aviso: "Sugestão — revise p/ publicar" |
|  | (exibe momento atual da capa)    |  |                                         |
|  +----------------------------------+  |  Título: [________________________] 62/100|
|  | Slider instante: [---●---------] |  |  [v] Faixa recomendada YouTube (50-70) |
|  | [◀ -1s] 00:14.200 / 00:48.000 [▶]|  |                                         |
|  +----------------------------------+  |  Descrição:                             |
|  | Momento atual: 00:14.200 (IA)    |  |  +-----------------------------------+  |
|  | Motivo: "Reação de surpresa..."  |  |  | Gancho (primeiros 150 chars)...   |  |
|  | [Sugerir momento] [Usar quadro]  |  |  | --- Capítulos ---                 |  |
|  | [ Salvamento: Salvar capa (PNG) ]|  |  | 00:00 Introdução ...              |  |
|  +----------------------------------+  |  +-----------------------------------+  |
|  | > Histórico de sugestões (3)     |  |  1240/5000 bytes   [Atualizar capítulos]|
|  +----------------------------------+  |  Crédito protegido (Permissão):         |
|                                        |  [🔒 Créditos: Criador X · link...]     |
|                                        |  Tags (8/30 · 142/500) & Hashtags (3/15)|
|                                        |  [Salvar ficha]                         |
|                                        |  -------------------------------------  |
|                                        |  GUARDRAILS & PRONTIDÃO (guardrails)    |
|                                        |  • Permissão registrada · Vídeo transf. |
|                                        |  • Nota de divulgação de IA             |
|                                        |  [Exportar vídeo MP4] [Ir p/ Lote ->]   |
+----------------------------------------+-----------------------------------------+
| <BarraStatus>                                                                    |
+----------------------------------------------------------------------------------+
```

#### Variação em 1440+ px

A proporção ajusta para ~40% esquerda / ~60% direita com maior respiro para o preview do quadro de capa e campos de descrição/tags sem compressão, mantendo a linha de leitura da descrição confortável (`≤ 68 ch`).

---

### 3. Conteúdo e componentes por zona

#### Zona A — Coluna Esquerda: Capa (Thumbnail)

* **Dados:** `thumbnail.get` (`source`, `cut: { startUs, endUs }`, `current`, `job`, `suggestions`, `choices`, `maxWhyChars`), `proxy.request` / `proxy.status`.
* **Controles e exibição (ordem de leitura):**
  1. **Palco de Preview do quadro:** carrega o proxy do Corte (`proxy.request { source_id, start_us: cut.startUs, end_us: cut.endUs }`) no tamanho nativo de vídeo do proxy, exibindo o quadro correspondente ao instante do scrubber (ou `current.instantUs` ao carregar). Se a Fonte estiver `offline`/`changed`, exibe banner de relocalização no lugar do vídeo sem bloquear a edição textual à direita.
  2. **Scrubber de escolha de quadro:** `role="slider"` limitado estritamente entre `cut.startUs` e `cut.endUs`, com transporte compacto (`Reproduzir/Pausar` `Espaço`, passos `-1 s` / `+1 s`, timecode atual em `tabular-nums` + `"/ {duração}"`).
  3. **Ficha do momento escolhido (`current`):**
     * Timecode (`00:14.200`), selo de origem (`"Sugerido pelo Provedor"` vs. `"Escolhido por você"`) e justificativa (`current.why`, até `maxWhyChars = 200`, quando sugerido pela IA).
     * Se `current === null`: estado `"Nenhum momento de capa escolhido ainda."`
  4. **Barra de ações da capa:**
     * *"Sugerir momento da capa"* / *"Sugerir de novo"* (`thumbnail.estimate` → `<ResumoCustoPrivacidade>` se pago/CLI → `thumbnail.suggest`).
     * *"Usar quadro atual como capa"* (`thumbnail.choose { candidate, instant_us }` — habilitado quando o instante do scrubber está dentro de `[cut.startUs, cut.endUs]` e difere de `current.instantUs`).
     * *"Salvar capa (PNG)"* (`thumbnail.export` — abre diálogo nativo `.png` com nome padrão `capa-{corte}.png`; gera PNG no tamanho nativo da Fonte sem crop, legenda nem filtros; habilitado quando `current !== null` e Fonte online).
  5. **Histórico recolhível (`<details>`):** lista `thumbnail.get.suggestions` e `choices` com botão *"Ver quadro"* para saltar o scrubber até aquele instante.

#### Zona B — Coluna Direita: Ficha de Empacotamento e Validadores YouTube

* **Dados:** `packaging.get` (`detectedLanguage`, `languageRequired`, `current`, `credit`, `chapters`, `job`, `limits`, `generations`), `guardrails.check { scope: "single", ... }`.
* **Controles e exibição (ordem de leitura):**
  1. **Barra superior da Ficha:**
     * Botão *"Sugerir Empacotamento"* / *"Sugerir novamente"* (`packaging.estimate` → `<ResumoCustoPrivacidade>` → `packaging.generate`).
     * Seletor de idioma (`PT-BR` | `EN`) exibido quando `languageRequired === true` ou para escolher o idioma de geração.
     * Faixa de aviso transparente: *"Sugestão gerada pelo Provedor — revise título, descrição e tags antes de publicar."*
  2. **Título + Validadores:**
     * Campo `<input>` para `title`.
     * Contador `tabular-nums`: `"{len}/{limits.titleChars} caracteres"` (`100`).
     * Validador estilo vidIQ (informativo, não bloqueante): indicador `"Faixa recomendada YouTube: 50–70 caracteres"` (mostra `"Ideal"` entre 50–70, `"Curto"` < 50, `"Pode truncar no mobile"` > 70; erro duro apenas se vazio ou > 100 ao salvar).
  3. **Descrição + Marcador de 150 chars + Capítulos + Crédito protegido:**
     * `<textarea>` para `description`.
     * Contador em **bytes UTF-8** somando automaticamente o crédito protegido (`bytesOf(description) + creditBytes`) contra `limits.descriptionBytes` (`5000 bytes`, `tabular-nums`).
     * **Validador de gancho (vidIQ):** indicador discreto *"Gancho inicial: {min(len, 150)}/150 caracteres visíveis antes de 'Mostrar mais'"*.
     * **Seção de Capítulos (somente quando `chapters.applicable === true`, i.e., Vídeo transformado):**
       * Estado de disponibilidade (`chapters.status`):
         * `"script_not_approved"` / `"narration_required"`: explica *"Aprove todos os blocos do Roteiro e gere/grave a Narração para gerar timestamps reais de capítulos."*
         * `"too_few_chapters"`: explica *"O YouTube exige pelo menos 3 capítulos com duração mínima de 10 s cada."*
         * `"ready"`: botão *"Atualizar capítulos"* (`packaging.refresh_chapters { candidate, description }`) — atualiza apenas o trecho entre `chapters.delimiters.start` e `end` preservando o resto da descrição.
       * **Validadores determinísticos das 3 regras do YouTube (`chapters.editWarnings` + checagem instantânea):** se o usuário editar timestamps manualmente na descrição, exibe notas não bloqueantes para `first_chapter_not_zero` (deve começar em `00:00`), `too_few_chapters` (`≥ 3`), `chapter_too_short` (`≥ 10 s` cada), `chapters_not_ordered`, `invalid_chapter_format`, `chapter_past_end`. Se `hasDelimiters === false`, avisa que os delimitadores foram removidos (impedindo `refresh_chapters` automático até restaurar ou regenerar).
     * **Crédito da Fonte protegido (`credit`):**
       * Quando `credit.text !== null`: bloco visualmente separado com ícone de cadeado, `aria-readonly="true"` e rótulo `"Crédito da Fonte (preenchido pela Permissão — não editável)"`, exibindo o texto exato anexado ao final de `fullDescription`.
       * Quando `credit.warning === "no_permission"`: alerta informativo `"Esta Fonte está sem Permissão registrada: nenhum crédito será incluído na descrição."` + link *"Registrar Permissão na Fonte"* (`#/projeto/:id/fontes/:fonteId`).
  4. **Tags e Hashtags:**
     * **Tags (`tags[]`):** lista em chips removíveis + input para adicionar (Enter ou vírgula). Contadores `tabular-nums`: `"{count}/{limits.tags} tags"` (`30`) e `"{totalChars}/{limits.tagsChars} caracteres"` (`500`), validando `<= 60` chars por tag.
     * **Hashtags (`hashtags[]`):** lista em chips `#...` + input. Contador `"{count}/{limits.hashtags}"` (`15`) + orientação YouTube (vidIQ): *"Recomendado: até 3 hashtags (o YouTube ignora todas se houver mais de 15)."*
  5. **Barra de salvamento da ficha:**
     * Botão primário *"Salvar alterações"* (`packaging.edit` — habilitado quando `current !== null` e há alterações não salvas) + botão *"Copiar descrição completa"* (copia `fullDescription` com crédito incluído para a área de transferência) + badge de status (`"Salvo"`, `"Alterações não salvas"`).
  6. **Painel de Guardrails e Prontidão (`guardrails.check { scope: "single" }`):**
     * Resumo informativo (nunca bloqueante):
       * Tipo do vídeo (**Corte direto** vs. **Vídeo transformado**) + regra *"Legenda, crop, filtros e trilha não contam como Transformação"*.
       * Status da **Permissão** (`granted` com `who · where` vs. `none`).
       * Se Vídeo transformado: status do **Roteiro** (`approved` vs. `pendingBlocks`) e **Narração/TTS** (`hasTts`, `voices`, aviso de sobra final `freezeTailUs` / `longFreezeTail > 5 s`).
       * Se houver áudio importado: quantidade de faixas sem licença registrada (`unverifiedCount`).
       * Se `over60s === true`: aviso *"Corte acima de 60 s: Shorts com mais de 1 minuto contendo música protegida ficam inelegíveis para monetização."*
       * Cartão fixo **`AiDisclosureNote`**: *"Divulgação de conteúdo gerado por IA: obrigatória quando houver voz sintética realista imitando pessoa real ou cena realista gerada por IA; não obrigatória para roteiro, título ou legenda feitos com IA."*
     * **Ações de saída:**
       * Se `needsDirectNotice === true`: botão/banner *"Confirmar ciência do risco de Corte direto"* (ou `<ConfirmDialog>` ao disparar o primeiro export) → `guardrails.ack_direct_notice`.
       * Botão primário *"Exportar vídeo (MP4)"*: lê `export.settings` e `export.captions` (verifica `missingGlyphs`), abre diálogo nativo de salvar arquivo `.mp4` e chama `export.start`, encaminhando progresso para o store global da Fila.
       * Botão secundário *"Ir para Mesa de Prontidão (Lote)"* → `#/projeto/:id/exportacao`.

---

### 4. Ações

| Ação do usuário | Comando(s) do núcleo | Pré-condições | Confirmação / Custo | O que muda na tela após concluir | Desfazer |
|---|---|---|---|---|---|
| Abrir sub-aba `Empacotar` | `thumbnail.get`, `packaging.get`, `guardrails.check`, `proxy.request` | Projeto aberto; candidato aprovado | Nenhuma | Carrega capa, ficha, guardrails e proxy de preview | — |
| Sugerir momento da capa | `thumbnail.estimate` → `thumbnail.suggest` | Candidato aprovado; Provedor de `packaging` configurado | `<ResumoCustoPrivacidade>` + `confirmed: true` se `paid` ou CLI | Enfileira `ai:thumbnail`; ao concluir, atualiza `current` e posiciona preview | Pode escolher quadro manual depois |
| Escolher quadro manual da capa | `thumbnail.choose { candidate, instant_us }` | `instant_us` dentro de `[cut.startUs, cut.endUs]` | Nenhuma | Atualiza `current` para `"user"` e registra no histórico | Pode selecionar outro instante ou sugestão do histórico |
| Exportar capa (PNG) | `thumbnail.export { candidate, output }` | `current !== null`; Fonte online/inalterada; FFmpeg instalado; caminho `.png` inexistente | Diálogo nativo de arquivo | Grava PNG em tamanho nativo no disco e exibe toast `"Capa salva"` | — |
| Sugerir Empacotamento (IA) | `packaging.estimate` → `packaging.generate` | Candidato aprovado; Provedor de `packaging` configurado; idioma definido | `<ResumoCustoPrivacidade>` + `confirmed: true` se `paid` ou CLI | Enfileira `ai:packaging`; ao concluir, preenche título, descrição, tags, hashtags e capítulos | Gerações anteriores mantidas em `generations` |
| Editar e salvar ficha | `packaging.edit` | Já existir geração em `current` | Nenhuma | Valida limites do YouTube, salva nova revisão e atualiza `fullDescription` | Edição manual no formulário antes de salvar |
| Atualizar capítulos | `packaging.refresh_chapters` | Vídeo transformado; Roteiro aprovado; Narração real; `≥ 3` blocos `≥ 10 s`; delimitadores presentes | Nenhuma | Atualiza só o bloco de capítulos na descrição mantendo texto do usuário | Ctrl+Z no campo de texto antes de salvar |
| Confirmar aviso de Corte direto | `guardrails.ack_direct_notice` | `needsDirectNotice === true` | `<ConfirmDialog>` informativo único por canal | Grava `directMonetizationAck: true` e atualiza painel de guardrails | — |
| Exportar vídeo individual (MP4) | `export.settings`, `export.captions` → `export.start` | Fonte online/inalterada; FFmpeg; sem `missingGlyphs` | Se `needsDirectNotice`, confirma aviso antes; diálogo nativo `.mp4` | Enfileira job `export` (`queued`) acompanhado na Fila global e Barra de Status | Cancelável via `jobs.cancel` |

---

### 5. Estados da tela

1. **`loading` (carregando):** `<Skeleton>` do player 16:9 à esquerda e dos campos de formulário + cartões à direita.
2. **`empty` (vazio):**
   * **Sem capa escolhida:** preview carregado no início do Corte + mensagem `"Nenhum momento de capa escolhido ainda."` + botões *"Sugerir momento da capa"* e *"Usar quadro atual"*.
   * **Sem Empacotamento gerado:** `"Nenhum texto de publicação gerado ainda. Peça uma sugestão ao Provedor para preencher título, descrição, tags e capítulos editáveis."` + CTA primário *"Sugerir Empacotamento"*. *(Ver Lacuna #1 sobre criação manual sem geração prévia.)*
3. **`error` (erro):** container `role="alert"` usando o mapeador central:

| `CoreError.code` | Mensagem humana na UI | Ação de recuperação |
|---|---|---|
| `local_only_violation` | Bloqueado pelo modo **Somente local**: o Provedor configurado para Empacotamento envia dados para fora da máquina. | Botão *"Configurar Perfil local"* (`#/config/provedores`). |
| `language_required` | O idioma do Corte ficou ambíguo. Escolha PT-BR ou EN antes de gerar o Empacotamento. | Foca o seletor de idioma. |
| `confirmation_required` | Esta sugestão usa um Provedor pago ou CLI e precisa da sua confirmação. | Abre `<ResumoCustoPrivacidade>`. |
| `generation_in_progress` / `suggestion_in_progress` | Já há uma sugestão de capa ou Empacotamento em andamento para este Corte. | Botão *"Abrir Fila de Jobs"* (`Ctrl/Cmd+J`). |
| `instant_out_of_cut` / `no_instant` | Escolha um momento dentro dos limites do Corte antes de salvar ou exportar a capa. | Foca o slider de instante da capa. |
| `thumbnail_exists` / `export_exists` | Já existe um arquivo com esse nome na pasta escolhida. Escolha outro nome para não sobrescrever. | Reabre o diálogo de salvar arquivo. |
| `thumbnail_destination` / `export_destination` | Escolha uma pasta existente e um nome de arquivo válido (`.png` para capa ou `.mp4` para vídeo). | Reabre o diálogo de salvar arquivo. |
| `source_offline` / `source_changed` | A Fonte foi movida ou alterada no disco. Você pode editar textos, mas precisa relocalizar para ver o preview ou exportar capa/vídeo. | Botão *"Relocalizar Fonte"* (`#/projeto/:id/fontes/:fonteId`). |
| `edit_invalid` / `invalid_edit` | Um ou mais campos ultrapassaram os limites do YouTube ou contêm caracteres proibidos. | Destaca os campos e contadores violados. |
| `chapter_delimiters_missing` | Os marcadores de capítulos foram removidos da descrição. Nada foi alterado para preservar seu texto. | Botão *"Copiar capítulos sugeridos"* ou instrução de restauração. |
| `chapters_require_transformed` / `script_not_approved` / `narration_required` / `too_few_chapters` | Capítulos automáticos exigem Vídeo transformado com Roteiro aprovado, Narração pronta e ao menos 3 blocos de 10 s. | Link para `Transformar` ou explicação do requisito faltante. |
| `export_glyph_missing` | A fonte da legenda não possui alguns caracteres do texto (`missing_glyphs`). | Botão *"Ajustar fonte em Editar"* (`#/projeto/:id/corte/:corteId/editar`). |
| `component_missing` | Instale o Componente FFmpeg para extrair a capa em PNG ou exportar o vídeo. | Link *"Instalar em Componentes"* (`#/config/componentes`). |

4. **`job_running` (job rodando):** enquanto `ai:thumbnail`, `ai:packaging`, `proxy` ou `export` rodam, o restante da tela permanece editável (exceto disparar outra geração simultânea do mesmo recurso), com progresso visível no bloco correspondente e botão **Cancelar**.
5. **`partial` (parcial):**
   * Capa escolhida sem Empacotamento gerado (ou vice-versa), ou Empacotamento de Vídeo transformado com `chapters.status !== "ready"` (mostra o motivo específico dos capítulos sem impedir salvar título/descrição/tags).
   * `credit.warning === "no_permission"` → ficha utilizável, mas com aviso visível de ausência de Permissão e crédito omitido.
6. **`sem permissão / pré-condição`:**
   * Fonte `offline`/`changed` bloqueia preview de capa, `thumbnail.export` e `export.start` com banner de relocalização, mantendo títulos, descrição, tags e guardrails acessíveis.

---

### 6. Eventos `core-progress` escutados

| `job` | `stage` | O que a tela atualiza |
|---|---|---|
| `<job_id>` (numérico) | `ai:thumbnail:prepare` / `call` / `verify` / `paused` / `done` | Atualiza botão/barra da capa; em `done`, recarrega `thumbnail.get` e posiciona o preview no novo `current.instantUs`. |
| `<job_id>` (numérico) | `ai:packaging:prepare` / `call` / `verify` / `paused` / `done` | Atualiza botão/barra da ficha; em `done`, recarrega `packaging.get` preenchendo os campos (se não houver edição não salva em conflito). |
| `<job_id>` (numérico) | `proxy` (1–98%), `complete`, `failed` | Atualiza carregamento do preview de vídeo à esquerda; em `complete`, inicializa o elemento `<video>` com `mediaUrl('proxy/' + key)`. |
| `<job_id>` (numérico) | `export` (1–99%), `complete`, `failed` | Atualiza barra do botão *"Exportar vídeo (MP4)"* e Barra de Status; em `complete`, exibe toast com opção de abrir pasta/arquivo. |

---

### 7. Teclado e acessibilidade

* **Regiões `F6` / `Shift+F6`:** Topo (`ShellGlobal` + `<ContextoCorte>`) → Coluna esquerda (Capa e Preview) → Coluna direita (Ficha de Empacotamento e Guardrails) → Barra de Status.
* **Atalhos da tela (sem conflitos com a tabela da arquitetura):**
  * `Ctrl/Cmd+K`: Paleta de comandos (*"Sugerir capa"*, *"Usar quadro atual"*, *"Sugerir Empacotamento"*, *"Atualizar capítulos"*, *"Exportar capa PNG"*, *"Exportar vídeo MP4"*).
  * `Ctrl/Cmd+S`: Salva alterações pendentes da ficha de Empacotamento (`packaging.edit`).
  * `Ctrl/Cmd+E`: Dispara fluxo de exportação individual (`export.start`).
  * `Espaço`, `J`/`K`/`L`, `←`/`→`: Controlam reprodução e busca quadro a quadro no preview da capa **apenas** quando o foco não está em campos de texto (`input`, `textarea`, `select`) e respeitando o interruptor WCAG 2.1.4.
* **Padrões WAI-ARIA APG:**
  * **Scrubber da capa:** `role="slider"`, `aria-label="Instante da capa"`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow` e `aria-valuetext` legível (`"00:14.200 de 00:48.000"`).
  * **Crédito protegido da Fonte:** região rotulada com `aria-readonly="true"` e descrição explícita de que é gerada pela Permissão da Fonte.
  * **Lista de tags e hashtags:** entrada acessível com botões individuais de remover contendo `aria-label="Remover tag {nome}"` e anúncio em `aria-live="polite"` ao adicionar/remover.
  * **Validadores e avisos:** exceder limite rígido (`> 100` título, `> 5000` bytes descrição, `> 30` tags) atualiza descrição de erro vinculada por `aria-describedby` e `aria-invalid="true"`; avisos orientativos (faixa 50–70, `≤ 3` hashtags, `editWarnings` de capítulos) usam `role="note"` / `role="status"` sem bloquear foco.
  * **Alvos e tipografia:** alvos ≥ 24×24 CSS px; todos os contadores (`62/100`, `1240/5000 bytes`, `8/30`) e timecodes usam `tabular-nums`.

---

### 8. US do #26 atendidas

* **US-48:** crédito da Fonte na descrição gerado automaticamente a partir da Permissão.
* **US-98, US-99, US-101, US-128:** títulos, descrição com crédito, tags, hashtags e capítulos editáveis a partir do ângulo e Roteiro, em PT-BR ou EN.
* **US-100, US-110:** sugestão de momento para thumbnail (enviando só texto), escolha manual de quadro no preview e exportação local em PNG.
* **US-102, US-103, US-104, US-105:** aviso único de Corte direto por canal, checklist informativo de originalidade, aviso de música com claim (e Corte > 60 s) e orientação sobre divulgação de IA.
* **US-106:** exportação individual MP4 `1080×1920`.

---

### 9. Lacunas (Núcleo Rust e Mock TS)

* **Núcleo Rust:**
  1. `packaging.edit` retorna `nothing_to_edit` se nunca houve `packaging.generate`: quem quiser escrever título/descrição/tags 100% à mão sem chamar Provedor (ex.: usuário sem Provedor configurado ou em modo estritamente manual) não consegue salvar via `packaging.edit`.
  2. `export.status` omite `encoder_fallback` no JSON retornado (`core/src/export.rs:1125-1138`), já listado na Seção 11 da arquitetura.
  3. `packaging.generate` e `thumbnail.suggest` não aceitam `profileId` opcional na chamada inicial (apenas via `jobs.redo` após concluído/falho), diferentemente de `script.regenerate`.
* **Mock TS (`src/lib/packagingMock.ts`, `src/lib/thumbnailMock.ts`, `src/lib/core.ts`):**
  1. Não emitem `core-progress` em tempo real para `ai:thumbnail:*`, `ai:packaging:*`, `proxy` e `export`.
  2. `guardrails.check` no mock diverge do Rust em escopo de lote (conforme documentado em `04-selecao-de-cortes.md`) e deve manter consistência com `scope: "single"`.
  3. `thumbnail.export` no mock usa caminho fixo `/test/exports/capa.png` sem simular escolha de pasta quando fora do Tauri.

---

### 10. Critérios de aceite (E2E / Playwright com mock)

1. Na sub-aba `Empacotar` com `?estado=vazio`, o painel esquerdo mostra `"Nenhum momento de capa escolhido ainda."` e o direito mostra o CTA primário `"Sugerir Empacotamento"`.
2. Clicar em *"Sugerir momento da capa"* com Perfil pago abre `<ResumoCustoPrivacidade>` com estimativa antes de enviar `thumbnail.suggest { confirmed: true }`.
3. Mover o slider da capa dentro de `[cut.startUs, cut.endUs]` e clicar em *"Usar quadro atual como capa"* chama `thumbnail.choose` e atualiza o selo para `"Escolhido por você"`.
4. Clicar em *"Salvar capa (PNG)"* chama `thumbnail.export` e exibe confirmação `"Capa salva"` sem erro de console.
5. Na Ficha de Empacotamento, o bloco de crédito da Fonte é somente leitura (`aria-readonly="true"`), e o contador de bytes da descrição soma `description` + crédito contra `5000 bytes`.
6. Quando a Fonte não possui Permissão registrada (`credit.warning === "no_permission"`), a tela exibe o aviso com link direto para `#/projeto/:id/fontes/:fonteId`.
7. Em Vídeo transformado com capítulos habilitados, digitar capítulos sem `00:00` inicial exibe o aviso não bloqueante de validação do YouTube sem impedir *"Salvar alterações"* (`packaging.edit`).
8. Clicar em *"Atualizar capítulos"* chama `packaging.refresh_chapters` preservando o texto editado fora dos delimitadores.
9. Com `needsDirectNotice === true` em Corte direto, acionar a confirmação de ciência chama `guardrails.ack_direct_notice` e oculta a pendência do aviso único.
10. Toda a navegação entre preview da capa, formulário da ficha e painel de guardrails funciona via `F6` e `Tab` com anel de foco visível e alvos ≥ 24 px.

---

## Componentes compartilhados usados

Componentes reutilizáveis demandados por este pacote (alinhados aos nomes da arquitetura e para unificação pelo coordenador):

| Componente | Responsabilidade neste pacote | Props mínimas sugeridas | Pacote provável de origem |
|---|---|---|---|
| `<ShellGlobal>` | Barra superior, Barra de Status, Fila de Jobs global e Paleta `Ctrl/Cmd+K` | *(envolve a rota via Router)* | Pacote A |
| `<ContextoCorte>` | Cabeçalho do Corte (`< Anterior | Próximo >`, tipo do vídeo, ação *"Converter em Vídeo transformado"*, abas `Editar`/`Transformar`/`Empacotar`) | `corteId`, `abaAtiva: 'editar' \| 'transformar' \| 'empacotar'` | Pacote D |
| `<ResumoCustoPrivacidade>` | Cartão/diálogo padrão pré-disparo de IA (rota, selo local/remoto/CLI, estimativa USD/cota, orçamento, `confirmed: true`) | `aberto`, `tarefa`, `perfil`, `destino: 'local' \| 'remoto' \| 'cli'`, `host?`, `estimativa`, `orcamento?`, `aoConfirmar`, `aoCancelar` | Pacote A |
| `<ConfirmDialog>` | Diálogo modal acessível de confirmação para ações destrutivas/substituição (trocar ângulo, sobrescrever áudio, aviso de Corte direto) | `aberto`, `titulo`, `descricao`, `rotuloConfirmar`, `rotuloCancelar`, `aoConfirmar`, `aoCancelar` | Pacote A |
| `<PlayerProxy>` | Player de vídeo do proxy 9:16/16:9 com transporte (`Espaço`/`J`/`K`/`L`/`←`/`→`), `proxy.request`/`status` e scrubber opcional | `sourceId`, `startUs`, `endUs`, `instanteAtualUs`, `aoMudarInstante`, `modo: 'editor' \| 'capa'` | Pacote C / D |
| `<PainelGuardrails>` | Checklist informativo (`guardrails.check`), `AiDisclosureNote` e fluxo único de `guardrails.ack_direct_notice` | `escopo: 'single' \| 'source' \| 'project'`, `sourceId?`, `candidateId?`, `aoConfirmarDireto?` | Pacote E / F |
| `<InstaladorComponenteJustInTime>` | Cartão inline/modal de instalação sob demanda com manifesto (tamanho, licença, confirmação, progresso e cancelamento) | `componenteId: 'pocket-tts' \| 'yt-dlp' \| 'deno' \| 'yunet'`, `titulo`, `motivo`, `aoConcluir` | Pacote A / B |
| `<GravadorTeleprompter>` | Captura de microfone WebView + teleprompter ajustável (velocidade, fonte, modo passo `prefers-reduced-motion`) + tratamento de rascunho VAD | `bloco`, `aoSalvarAudio: (base64, mimeType) => Promise<void>`, `aoDescartarRascunho`, `aoFechar` | Pacote E |
| `<ContadorLimite>` | Contador `tabular-nums` (`usado/máximo`) com estado visual e `aria-live` suave ao se aproximar ou exceder limite | `usado`, `maximo`, `unidade: 'caracteres' \| 'bytes' \| 'tags'`, `faixaIdeal?: [number, number]` | Pacote E |
| `<ListaChips>` | Editor acessível de lista de strings (`tags`, `hashtags`, `sentence_ids`) com remoção individual e validação por item | `itens`, `aoAlterar`, `maxItens`, `maxCharsItem?`, `prefixo?`, `rotulo` | Pacote E |
| `<Skeleton>` / `<EstadoVazio>` / `<BannerErroCore>` | Estados padrão de carregamento, vazio com CTA único e tradutor de `CoreError.code` com botão de recuperação | `variante`, `codigoErro?`, `cta?`, `onRecuperar?` | Pacote A |

---

## Questões para a arquitetura

1. **Identificador `:corteId` na rota vs. Cortes avulsos sem `candidate_id`:**
   * A arquitetura define `#/projeto/:id/corte/:corteId/editar`, `transformar` e `empacotar`, porém todos os comandos deste pacote (`angles.*`, `script.*`, `narration.*`, `thumbnail.*`, `packaging.*`) exigem `candidate: number` obrigatório, enquanto `editor.open` aceita `candidate_id: null` para Cortes avulsos `(source_id, start_id, end_id)`.
   * **Decisão necessária:** Cortes avulsos sem `candidate_id` devem ter `Transformar` e `Empacotar` ocultos (ou um comando para promover o Corte avulso a candidato)? Nesta especificação assumimos que `:corteId` resolve um `candidate` aprovado e que, se não houver `candidate_id`, apenas `Editar` e `Exportar` ficam disponíveis até existir suporte no núcleo.
2. **Guarda de Fonte `offline` ou `changed` em `Transformar` e `Empacotar`:**
   * Na Seção 3 da arquitetura, o banner de relocalização para Fonte `offline`/`changed` foi explicitado apenas na rota `editar`. Em `transformar` (Ângulo, Roteiro, TTS, Gravação) e `empacotar` (Título, Descrição, Tags, Guardrails), a edição textual e de áudio de Narração funciona normalmente só com o SQLite do Projeto, enquanto o preview do vídeo (`proxy.request`), `thumbnail.export` e `export.start` falham com `source_offline`/`source_changed`.
   * **Proposta:** aplicar a mesma regra não bloqueante do `editar` nessas duas sub-abas (exibir o banner de relocalização no lugar do player de preview/botão de exportar PNG/MP4, sem bloquear edição de Roteiro, Narração ou Empacotamento).
3. **Empacotamento 100% manual sem Provedor configurado (`packaging.edit`):**
   * Hoje `packaging.edit` no núcleo exige ao menos um `packaging.generate` prévio (`nothing_to_edit`). Se o usuário quiser preencher título/descrição/tags manualmente sem usar IA (ou sem Provedor configurado), fica impedido.
   * **Proposta:** registrar ticket no núcleo para `packaging.edit` aceitar criação inicial manual (ou `packaging.init`) e, até lá, manter o CTA *"Sugerir Empacotamento"* como entrada na tela vazia.
4. **Remoção do áudio de um bloco na Narração (`narration.delete_block`):**
   * Hoje é possível substituir o áudio de um bloco por TTS, gravação ou importação, mas não há comando para remover um áudio gravado/importado de volta ao estado `Sem áudio` (exceto descartar rascunho sem fala via `narration.discard_draft`).
   * **Proposta:** confirmar se vale abrir ticket de núcleo para `narration.delete_block` ou se substituir por outro caminho é suficiente na v1.
5. **Seleção ad-hoc de Perfil de Provedor por geração em `angles.generate`, `thumbnail.suggest` e `packaging.generate`:**
   * Apenas `script.estimate`/`script.regenerate` aceitam `profileId` opcional na chamada; `angles.*`, `thumbnail.*` e `packaging.*` só permitem trocar de perfil após concluir/falhar via `jobs.redo` na Fila de Jobs. Mantivemos o padrão do núcleo nesta especificação (expondo `profileId` só na regeneração de bloco do Roteiro e referenciando `jobs.redo` na Fila para os demais).
