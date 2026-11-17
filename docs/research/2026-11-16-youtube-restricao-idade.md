# Pesquisa #194: importar vídeos do YouTube com restrição de idade

Data: 16/11/2026. Ticket: [#194](https://github.com/GUSTAVOHOOO/clipes/issues/194). Relacionados: #45 (importação por URL), #152 (só áudio primeiro), #59 (conferência).
Nada foi implementado. Cookies, perfis e ferramentas de teste ficaram em `%TEMP%\clipes-194-*` e foram apagados.

Convenção: **[fato]** = verificado em fonte ou teste, com link ou comando. **[inferência]** = conclusão minha, sem fonte direta.

## Resumo

1. **[fato]** Sem login, o yt-dlp falha em vídeo +18 com `Sign in to confirm your age`. Hoje o Clipes mostra só "Não foi possível baixar a Fonte" (`download_failed`), porque o stderr do yt-dlp é descartado.
2. **[fato]** Detectar antes de baixar funciona **sem login**: `--skip-download --ignore-no-formats-error --print "%(age_limit)s %(availability)s"` devolve `18` e `needs_auth` mesmo quando o download é impossível. Dá para mostrar um erro tipado `age_restricted`.
3. **[fato]** Com **deno** (EJS), um vídeo +18 **embedável** baixou sem login e sem PO Token (10 KiB de 1080p + opus). Um +18 **não embedável** continuou exigindo login. O maintainer do yt-dlp diz que vídeos +18 "usually are not embeddable" ([#17705](https://github.com/yt-dlp/yt-dlp/issues/17705)), então esse caminho ajuda pouco.
4. **[fato]** PO Token (bgutil 2.0.2) **não destrava** a verificação de idade. Ele serve para as URLs de mídia (GVS), não para o portão de idade.
5. **[fato]** Com cookies de uma conta logada, mas **sem idade verificada**, o erro vira `Sorry, this content is age-restricted. To view this video, please provide more info so we can be sure you're an adult`. É o mesmo erro relatado no #194. Ou seja: o gargalo é a **conta ser adulta e verificada**, não os cookies.
6. **[não verificado]** O caminho feliz (conta verificada + cookies + deno + bgutil + `mweb`/`web_creator`) não foi testado: a conta descartável do dev não tem idade verificada e não pedimos que ele fizesse a verificação (documento ou cartão). A fonte do yt-dlp para esse caminho é o maintainer em [#17542](https://github.com/yt-dlp/yt-dlp/issues/17542) (26/08/2026).
7. **[fato]** Os Termos do YouTube proíbem baixar sem autorização do YouTube e contornar o Serviço; o yt-dlp avisa que cookies de conta podem levar a banimento. Já no #45 o app avisa dos Termos uma vez.
8. **Recomendação:** na v1, **só detectar, explicar e oferecer o plano B** (baixar por conta própria e importar o arquivo local), mais o aviso de que o login do app fica de fora. Cookies/login ficam como opção avançada **fora da v1**, com decisão do dev e emenda do ADR-0005 se ele quiser.
9. **[inferência]** Para canal de cortes de GTA RP com Permissão do criador, o plano B (baixar pelo criador ou por outro meio e importar) costuma ser mais seguro e estável que automatizar a conta do usuário.
10. Perguntas para o dev no fim.

## O que acontece hoje no Clipes

Código lido em `core/src/url_import.rs`, `core/src/sources.rs`, `core/src/components.rs` (revisão da worktree em 16/11/2026).

- **[fato]** `sources.import` aceita `origin_url`, valida com `validate_url` (só http/https) e registra a URL na Fonte. O download é o comando `sources.url.download` de `url_import.rs`, que exige o aviso dos Termos aceito (`terms_required`).
- **[fato]** Argumentos do yt-dlp: `--ignore-config --no-playlist --match-filters "live_status !=? is_live ..." --newline --progress --restrict-filenames --print after_move:clipes-file:%(filepath)s -o <tmp>/%(id)s.%(ext)s [--ffmpeg-location] -- <url>`. Não há `--cookies`, `--js-runtimes`, `--extractor-args` nem `--print` de metadados.
- **[fato]** O stderr do yt-dlp vai para `io::sink()`. Qualquer saída diferente de zero vira `download_failed` ("Não foi possível baixar a Fonte"). Não existe erro tipado `age_restricted`, `login_required` nem `needs_js_runtime`.
- **[fato]** O yt-dlp é o Componente pinado `2026.11.04.232659` (nightly, executável standalone), baixado com SHA-256 fixo. Atualiza só com confirmação e assinatura OpenPGP verificada (CONTRIBUTING, "Atualização do yt-dlp").
- **[fato]** Não há deno no app. Em máquina limpa, o yt-dlp avisa `No supported JavaScript runtime could be found. Only deno is enabled by default` e perde formatos. Isso afeta **todo** vídeo do YouTube, não só +18: com deno ausente o desafio `n` falha (`n challenge solving failed`) e "some formats may be missing". [inferência] vale tratar o deno como Componente à parte, mesmo se nada de login for feito (ver tickets).
- **[fato]** Cookies no repo: o app não guarda nada de sessão do YouTube hoje (`url-import.json` só tem `terms_accepted` e `download_dir`).

Exemplo concreto: o dev cola a URL de uma live de GTA RP +18 de um criador que deu Permissão. O app mostra "Não foi possível baixar a Fonte", sem dizer que o motivo é a idade nem o que fazer.

## Mecânica atual do yt-dlp (testes)

Máquina: Windows 11, 16/11/2026. Executáveis: o Componente do app (`2026.11.04.232659`) e a nightly `2026.11.15.232800` (a mais recente em [yt-dlp-nightly-builds](https://github.com/yt-dlp/yt-dlp-nightly-builds/releases)); a estável mais recente é `2026.10.26` ([releases](https://github.com/yt-dlp/yt-dlp/releases)). Deno 2.9.8 em `%TEMP%`, fora do PATH. bgutil-ytdlp-pot-provider 2.0.2 (git `26475e9`, 07/10/2026), servidor HTTP em `127.0.0.1:4416`/`[::1]`. Vídeos:

- `HtVdAasjOgU` (The Witcher 3, EN, +18, **embedável**, 142 s). É um dos vídeos de teste do próprio yt-dlp.
- `Tq92D6wQ1mg` (EN, +18, 106 s, canal Projekt Melody) e `KiSG6rf_rf0` (EN, +18, travou no #59): **não embedáveis** na prática, pois o `web_embedded` não devolveu formatos.
- Não achei, nesta rodada, um VOD +18 de GTA RP ou reação para repetir o teste. [não verificado] se as lives do nicho do dev são embedáveis.

### Sem login

| # | Teste | Resultado |
|---|---|---|
| 1 | Baseline: `yt-dlp --skip-download --print ...` sem deno, sem cookies, `HtVdAasjOgU` | `ERROR: Sign in to confirm your age`; avisos de JS runtime e de `n challenge`. Nenhum metadado impresso. |
| 2 | Mesmo, com `--ignore-no-formats-error` | **Imprime** `age_limit=18`, `availability=needs_auth`, `duration`, `channel`, `live_status`. Avisos: `Only images are available`, `Requested format is not available`. |
| 3 | Com deno (`--js-runtimes deno:<caminho>`), `HtVdAasjOgU`, sem cookies | `This video is age-restricted; some formats may be missing without authentication`, resolve o desafio JS, baixa: `Downloading 1 format(s): 399+251` (1080p + opus). |
| 4 | `--test -f "bv*+ba/b"` (baixa só ~10 KiB por stream) | Arquivos `.f399.mp4` e `.f251.webm` de 10 241 bytes. Mídia **real** veio. (`Conversion failed` no fim é só a mescla do corte do `--test`.) |
| 5 | `--test -f ba` com a build do app | Uma vez, `Requested format is not available` e `Some web_embedded client https formats have been skipped as they are missing a URL. YouTube may have enabled the SABR-only streaming experiment`. Com `-f "ba/b"` e `-f worst` funcionou. **Instável conforme a sessão** (SABR). |
| 6 | `Tq92D6wQ1mg` com deno, sem cookies | `ERROR: Sign in to confirm your age`. Com `--ignore-no-formats-error --print`: `age_limit=18`, `needs_auth`, 106 s, canal. |
| 7 | Nightly 2026.11.15 repetindo 3 e 6 | Mesmo resultado (embedável baixa, não embedável pede login). |
| 8 | `--extractor-args youtube:player_client=tv` / `android_vr` / `mweb` / `web_safari`, deno, sem cookies, `HtVdAasjOgU` | Só listou áudio (`249/250` opus) sem `web_embedded`; só `web_embedded` trouxe vídeo (m3u8 144p–360p no `-F`). |
| 9 | bgutil 2.0.2 (servidor HTTP em loopback + plugin) + deno, sem cookies, `Tq92D6wQ1mg` | Plugin carregou (`bgutil:http-2.0.2 (external)`; `script-node` e `script-deno` ficam `unavailable` sem clonar o repo). Mesmo erro de idade. O token nem é gerado: sem formato de mídia a baixar, não há requisição GVS. |

Comando de detecção (reproduzível, sem login):

```sh
yt-dlp --ignore-config --skip-download --ignore-no-formats-error --no-playlist \
  --print "%(id)s|%(age_limit)s|%(availability)s|%(duration)s|%(channel)s" -- <url>
```

- **[fato]** `availability` aparece como `needs_auth`; `age_limit` como `18`. O mesmo comando em vídeo público devolve `age_limit=0` e `availability=public` [inferência a partir do #45: vídeo público baixou normalmente na conferência; não repeti o comando nele para não gastar banda].
- **[fato]** Efeito colateral: o yt-dlp ainda imprime avisos em stderr. O app precisaria ler o stdout (`--print`) e tratar o exit code, e não depender do texto do erro.

### Com login (conta descartável do dev, presente)

Procedimento dos impedimentos: Chrome instalado, perfil em `%TEMP%\clipes-194-chrome`, porta 9333, o dev fez o login. Exportei cookies por CDP (`Storage.getCookies`) para `cookies.txt` fora do repo. **Achado novo:** o primeiro export, logo após o login em `accounts.google.com`, **não tinha `LOGIN_INFO`** (nenhum cookie de sessão do YouTube), e o yt-dlp seguia pedindo `Sign in to confirm your age`. Depois de abrir `https://www.youtube.com/` no mesmo perfil e exportar de novo, apareceu `LOGIN_INFO` (42 cookies) e o erro mudou.

Matriz, nightly 2026.11.15, `Tq92D6wQ1mg` e `KiSG6rf_rf0`:

| Combinação | Resultado nos dois vídeos |
|---|---|
| cookies, sem deno | `Sorry, this content is age-restricted. To view this video, please provide more info so we can be sure you're an adult` |
| cookies + deno | idem |
| cookies + deno + bgutil + `player_client=mweb` | idem |
| cookies + deno + bgutil + `player_client=web_creator` | idem |
| cookies + deno + bgutil, clientes padrão | idem |

- **[fato]** A mensagem do YouTube muda de "Sign in" para "provide more info so we can be sure you're an adult" quando a sessão é reconhecida mas **a conta não está verificada como adulta**. Isso reproduz o erro do #194 ("Sorry, this content is age-restricted").
- **[inferência]** A conta usada no #59 também não estava verificada, ou não passou nesse critério. O texto do #194 diz "conta logada com idade verificada"; o erro sugere que, para o YouTube, **não estava**. Vale o dev conferir em Configurações da conta Google, antes de qualquer decisão.
- **[não verificado]** Se, com a conta verificada, a combinação cookies + deno + bgutil + `mweb`/`web_creator` baixa. Base: o maintainer `bashonly` em [#17542](https://github.com/yt-dlp/yt-dlp/issues/17542) (26/08/2026): "Workaround: use a PO token provider and the `mweb` client or `web_creator` client." Não pedi ao dev que enviasse documento ou cartão para uma conta descartável, porque isso passa dados pessoais ao Google só para o teste.
- **Aviso de risco de banimento:** o wiki do yt-dlp diz, no guia de exportação de cookies do YouTube, que "you run the risk of it being banned (temporarily or permanently)" e sugere conta descartável e limite de ritmo e volume ([wiki, Extractors/Exporting YouTube cookies](https://github.com/yt-dlp/yt-dlp/wiki/Extractors), lido em 16/11/2026). A conta do teste era descartável, por decisão do dev.
- **Limpeza:** cookies, perfil do Chrome, deno, bgutil e a nightly foram apagados de `%TEMP%`; servidor bgutil e Chrome encerrados (confirmado: nenhuma pasta `clipes-194-*`, nenhuma porta 4416/9333 em escuta, `git status` limpo).

### O que o yt-dlp pede hoje (fontes)

- **EJS / runtime JS:** o yt-dlp resolve os desafios do YouTube com scripts `yt-dlp-ejs` rodando num runtime JS externo. Só o **deno** vem habilitado por padrão (>= 2.3.0); node (>= 22) e quickjs precisam de `--js-runtimes`; bun está deprecado. O executável standalone já traz o `yt-dlp-ejs`. [Wiki EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS). **[fato testado]** o deno tem de estar no PATH ou ao lado do `yt-dlp.exe`, ou passado como `--js-runtimes deno:<caminho>`.
- **PO Token:** por cliente, para **GVS** (stream), **Player** ou **Subs**. `mweb`, `web_safari` (exceto HLS), `web_creator` exigem GVS; `tv` e `web_embedded` não exigem; `web_creator` exige cookies. A página diz que extrair PO Token à mão "is no longer recommended", que o token é ligado ao ID do vídeo e que o caminho recomendado é um provedor com `mweb`. A página **não fala de vídeo com restrição de idade**. [PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) (última edição 12/07/2026).
- **bgutil-ytdlp-pot-provider:** modo servidor HTTP (preferido; `localhost`, porta 4416) ou modo script; exige Node >= 22 ou Deno >= 2.0.0; yt-dlp >= 2025.05.22. Ele próprio diz que "Providing a PO token does not guarantee bypassing 403 errors" e que não contorna restrições de IP. Não menciona idade nem Termos. [README](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) (versão 2.0.2). **[fato testado]** O README não cobre o `yt-dlp.exe` standalone; funcionou com `--plugin-dirs <dir>/<nome>/yt_dlp_plugins` apontando para o pacote instalado com `pip install --target`.
- **Cliente para vídeo +18:** `web_embedded` só devolve formatos se o vídeo for embedável; "Age-restricted videos are usually not embeddable" ([#17705](https://github.com/yt-dlp/yt-dlp/issues/17705), 20/09/2026). `mweb` sem PO Token só dá o formato 18 (360p) ([#17603](https://github.com/yt-dlp/yt-dlp/issues/17603), 01/09/2026); o maintainer respondeu que nenhum cliente que dependa de PO Token entra nos padrões "until native po token generation is a thing". O ticket [#17542](https://github.com/yt-dlp/yt-dlp/issues/17542) deu o workaround acima. [#17389](https://github.com/yt-dlp/yt-dlp/issues/17389) (SABR, fechado em 10/10/2026) é a causa raiz de vários desses sintomas.
- **Cookies:** o wiki manda exportar de uma janela privada e fechá-la, porque o YouTube rotaciona cookies de abas abertas; e avisa para **não** usar `--cookies-from-browser` nesse caso. O FAQ avisa que o arquivo tem cookies de **todos** os sites e que a extensão "Get cookies.txt" (não "LOCALLY") foi tratada como malware. [Wiki Extractors](https://github.com/yt-dlp/yt-dlp/wiki/Extractors), [FAQ](https://github.com/yt-dlp/yt-dlp/wiki/FAQ).
- **README do yt-dlp:** a captura da página cortou antes das seções de autenticação; as opções `--js-runtimes` e `--remote-components` ("By default, no remote components are allowed") vieram de lá. Não consegui citar o parágrafo sobre `--cookies`; usei o wiki e o FAQ. Também não achei, no README, nada específico sobre `--age-limit` como bypass.
- **Política do yt-dlp:** o repositório tem uma "NO AI / NO LLM POLICY" e bloqueia contribuições geradas por IA ([CONTRIBUTING](https://github.com/yt-dlp/yt-dlp/blob/master/CONTRIBUTING.md#no-ai--no-llm-policy); caso visto em [#17997](https://github.com/yt-dlp/yt-dlp/issues/17997), 04/11/2026). **Nunca abrir issue ou PR no yt-dlp com texto de agente**; isso vai para os impedimentos.

## Termos e risco para a conta do usuário

- **[fato]** Termos de Serviço do YouTube (vigência "5 de janeiro de 2022", lido em 16/11/2026, [youtube.com/t/terms](https://www.youtube.com/t/terms)): o usuário não pode "acessar, reproduzir, fazer download, distribuir..." o Serviço ou o Conteúdo, exceto quando autorizado pelo Serviço ou com permissão por escrito do YouTube; não pode "burlar, desabilitar, fraudar ou interferir" com o Serviço; não pode acessar por "meio automatizado (robôs, botnets ou scrapers)" (exceto buscadores compatíveis com o `robots.txt`); e o YouTube pode suspender ou encerrar a Conta Google por violação "significativa ou repetida". Sobre compartilhar senha: "Não compartilhe sua senha com outras pessoas nem a reutilize em aplicativos de terceiros."
- **[fato]** Os Termos **não tratam** de conteúdo com restrição de idade. A regra de visualização está na Ajuda: vídeos com restrição "are not viewable to users who are under 18 years of age or signed out" ([Ajuda do YouTube](https://support.google.com/youtube/answer/2802167), sem data na página). Não encontrei fonte primária (nesta pesquisa) sobre os métodos de verificação de idade nem sobre os países atendidos.
- **[inferência]** O download já é coberto pela proibição geral dos Termos, com ou sem restrição de idade; a restrição não cria uma regra nova, mas **entregar a sessão da conta** ao app aumenta o risco: a atividade sai da conta do usuário, em ritmo de automação.
- **[fato]** O aviso de banimento do próprio yt-dlp (acima) é a melhor fonte de risco concreto: banimento "temporário ou permanente". O #17705 mostra um usuário preocupado ("probably this pattern is clearly trigger for permanent ban by google") ao baixar muitos vídeos com PO Token por vídeo; o maintainer não confirmou isso, nem eu. **[inferência]** Para um app que baixa lives de várias horas, em volume, o risco é real e o usuário precisa saber disso antes.
- **ADR-0005:** [fato] o ADR-0005 trata do **Projeto portátil com SQLite**; ele **não fala de download, cookies ou Termos**. A regra "nunca no Projeto" citada no #194 é coerente com ele: o Projeto é uma pasta `.clipes` que viaja entre máquinas e pode ser compartilhada, então um cookie ali vazaria a sessão. **[inferência]** Não há ADR atual que proíba guardar uma sessão fora do Projeto; a lacuna é de decisão, não de contradição. O que mais pesa é o ADR-0004 (segredos no cofre do sistema, UI nunca lê) e o glossário ("Somente local" = só loopback). Um cookie de sessão seguiria a mesma regra do cofre.

## Opções

Critérios: esforço (S/M/G), risco para a conta do usuário, risco jurídico/de política, custo de manutenção.

### A. Só detectar e explicar (com plano B no texto)

- O app lê `age_limit`/`availability` antes de baixar, devolve o erro tipado `age_restricted` e mostra: "Este vídeo tem restrição de idade. O Clipes não usa sua conta do YouTube. Baixe por conta própria (por exemplo, com a ferramenta que você já usa ou com o criador) e importe o arquivo."
- **Prós:** nenhum dado de conta; sem risco de banimento; sem ADR novo; reaproveita o fluxo de importação local e de Permissão; cabe na v1.
- **Contras:** o usuário vai ter de baixar sozinho; frustra quem tem muitos VODs +18.
- **Esforço:** S. **Risco conta:** nenhum. **Manutenção:** baixa (`--print` é estável; o texto de erro muda).

### B. Plano B explícito "baixe e importe o arquivo"

- É o que a opção A já mostra, com um botão "Importar arquivo local" no próprio erro e, se der, um texto de ajuda (como pedir o arquivo ao criador.).
- **Prós:** caminho que já existe. Combina com a Permissão: no nicho de cortes, o criador pode entregar o VOD.
- **Contras:** depende do usuário. A pasta e o formato do arquivo baixado fora do app podem variar (mkv, webm, mp4) mas o ffmpeg do Clipes já cobre.
- **Esforço:** S (junto com A). **Risco:** nenhum.

### C. `cookies.txt` importado pelo usuário

- O usuário exporta o arquivo (como no wiki) e o app o guarda no cofre ou numa pasta de dados do app (fora do Projeto), passando `--cookies` ao yt-dlp, apagado após o uso ou por botão.
- **Prós:** sem webview; o dev já fez o procedimento; separa o login do app.
- **Contras:** o export é técnico (janela privada, extensão confiável: o próprio FAQ avisa de extensão maliciosa); cookies expiram e rotacionam; o arquivo tem cookies de **todos** os sites; precisa deno + PO Token (bgutil como Componente + Node/Deno) para dar certo; **só funciona se a conta for verificada** (teste acima); risco de banimento da conta.
- **Esforço:** G (cofre, UI de importação, deno como Componente, provedor de PO Token, testes). **Risco conta:** alto. **Manutenção:** alta (SABR e PO Token mudam a cada poucas semanas, vide os issues citados).

### D. Login numa webview do próprio app

- O app abre o login do Google numa webview (Tauri) e lê os cookies.
- **Prós:** melhor UX.
- **Contras:** o Google bloqueia login em navegadores embutidos ("Esse navegador ou app pode não ser seguro", já visto com Playwright e documentado nos impedimentos); o app passaria a **capturar credenciais/sessão de uma conta Google**, o que fere o espírito de "não compartilhe sua senha ... em aplicativos de terceiros" dos Termos; mais superfície de ataque (SECURITY.md, ADR-0006 sem telemetria); mesmo problema de verificação de idade e banimento. Não achei fonte que diga que isso funciona hoje com WebView2; **[não verificado]**.
- **Esforço:** G. **Risco conta:** alto. **Risco jurídico/política:** alto. **Manutenção:** muito alta.

### Comparação

| Opção | v1? | Esforço | Risco conta | Cobertura (+18) | ADR novo |
|---|---|---|---|---|---|
| A. Detectar e explicar | Sim | S | Nenhum | 0% automática | Não |
| B. Baixe e importe o arquivo | Sim | S | Nenhum | 100% manual | Não |
| C. cookies.txt | Depois (opcional) | G | Alto | Só com conta verificada [não verificado] | Sim (emenda) |
| D. Webview | Não | G | Alto | idem | Sim |

## Recomendação

1. **v1:** A + B. Detectar, tipar o erro (`age_restricted`) e orientar o plano B. **[inferência]** Isso resolve o travamento da conferência do #59 sem dado de conta.
2. **Separar do #194, mas tratar já:** tornar o **deno** um Componente (e passar `--js-runtimes deno:<caminho>`). Sem ele, o yt-dlp perde formatos em **qualquer** vídeo do YouTube (teste 1). Também registrar o stderr do yt-dlp (sem URL assinada) para diagnóstico, em vez de descartar.
3. **Depois, só se o dev quiser:** opção C como **modo avançado desligado por padrão**, com aviso explícito do risco de banimento, conta descartável recomendada, arquivo fora do Projeto e apagado em N horas. **Antes de decidir C, repetir o teste com uma conta realmente verificada** (isso é a única prova que falta). Não recomendo D.
4. **ADR:** nenhuma emenda é necessária para A+B. **Se C for aprovada, proponho um ADR novo** (não uma emenda do 0005): "Sessão do YouTube é segredo do usuário, fica no cofre ou em arquivo da pasta de dados do app, nunca no Projeto, nunca em log, apagada por botão e por prazo". O 0005 só ganha uma frase em "O que vem junto": "O Projeto nunca guarda cookies nem sessão". Quem decide é o dev.
5. **[inferência]** A cobertura por embed (teste 3) **não** deve virar caminho oficial: depende de o criador permitir incorporação, e vídeo +18 raramente permite.

## Escopo

**v1:**
- Detecção por `--print` antes do download; erro tipado `age_restricted` (e `login_required` genérico) na UI, com o texto do plano B.
- Mensagem clara para o erro de JS runtime ausente.
- Deno como Componente com SHA-256 fixo (se o dev concordar, no ticket separado).
- Registro do stderr tratado (sem segredos) para o relato de problemas (ADR-0006).

**Depois:**
- Importação de `cookies.txt` (opção C), com deno + provedor de PO Token como Componentes.
- Nova rodada de teste com conta verificada.
- Download por trecho (#152) com `--download-sections` continua com o spike próprio; **este relatório não verificou isso**.

## Perguntas para o dev

1. Aprova a recomendação v1 (A+B), ou quer a opção C como modo avançado?
2. A conta que você usou no #59 está **verificada como adulta** no Google? O erro `provide more info so we can be sure you're an adult` indica que não. Se quiser provar o caminho feliz, uma conta verificada que você aceite usar precisa ser testada, sem eu pedir documento ou cartão.
3. As lives +18 do seu nicho (GTA RP, reações) são **embedáveis**? Se você passar 2 URLs reais, eu repito o teste 3 sem login.
4. Deno como Componente do app: ok abrir um ticket (S) já na v1, mesmo sem o +18?
5. Se a opção C for aprovada, o prazo de retenção do arquivo de cookies: apagar ao fim de cada importação, por horas, ou só por botão?

## Tickets propostos (não criados)

1. **Detecção `age_restricted` na importação por URL**
   - Antes de baixar, o núcleo roda `yt-dlp --skip-download --ignore-no-formats-error --print` com os campos `id|age_limit|availability|live_status|duration` (sem cookies) e devolve erro tipado `age_restricted` quando `age_limit >= 18` e `availability == needs_auth`.
   - Teste headless com yt-dlp falso para: vídeo público; +18; erro de rede; saída inesperada.
   - A UI mostra a mensagem do plano B com botão "Importar arquivo local".
   - O código não depende do texto do erro do YouTube.
2. **Erros tipados da importação por URL e stderr diagnóstico**
   - O stderr do yt-dlp deixa de ir para `io::sink()`; as linhas são limitadas, sem URLs assinadas, cookies ou tokens, e entram no relato de problemas (ADR-0006).
   - Códigos: `age_restricted`, `login_required`, `js_runtime_missing`, `sabr_unavailable`, `download_failed`.
3. **Deno como Componente**
   - Download sob demanda com SHA-256 fixo, licença na tela, `--js-runtimes deno:<caminho>` no download e na detecção; teste com falso.
   - Critério: vídeo público sem deno e com deno no Windows, com a mesma versão do yt-dlp, sem aviso de `n challenge`.
4. **(depois) Spike com conta verificada**
   - Repetir a matriz deste relatório (cookies, deno, bgutil, `mweb`/`web_creator`) com conta verificada, 2 vídeos do nicho, tudo apagado; relatório em `docs/research/`.
5. **(depois, se C aprovada) Sessão do YouTube por `cookies.txt`**
   - ADR de segredo da sessão; importação do arquivo por botão; cofre ou pasta de dados do app, nunca no Projeto; botão "Esquecer sessão"; apagar por prazo; aviso de risco de banimento e de conta descartável; nunca logar o conteúdo.
   - Deno e provedor de PO Token como Componentes, servidor só em loopback.

## Fontes

Primárias, lidas em 16/11/2026 (data do conteúdo entre parênteses quando a página informa):

- yt-dlp, PO Token Guide: https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide (editada 12/07/2026)
- yt-dlp, EJS: https://github.com/yt-dlp/yt-dlp/wiki/EJS
- yt-dlp, README (parcial): https://github.com/yt-dlp/yt-dlp/blob/master/README.md
- yt-dlp, wiki Extractors (exportação de cookies do YouTube): https://github.com/yt-dlp/yt-dlp/wiki/Extractors
- yt-dlp, FAQ (cookies): https://github.com/yt-dlp/yt-dlp/wiki/FAQ
- yt-dlp, política contra IA: https://github.com/yt-dlp/yt-dlp/blob/master/CONTRIBUTING.md#no-ai--no-llm-policy
- yt-dlp, issues: [#17603](https://github.com/yt-dlp/yt-dlp/issues/17603) (01/09/2026), [#17542](https://github.com/yt-dlp/yt-dlp/issues/17542) (26/08/2026), [#17705](https://github.com/yt-dlp/yt-dlp/issues/17705) (20/09/2026), [#17389](https://github.com/yt-dlp/yt-dlp/issues/17389) (fechado 10/10/2026), [#17997](https://github.com/yt-dlp/yt-dlp/issues/17997) (04/11/2026)
- yt-dlp, releases: https://github.com/yt-dlp/yt-dlp/releases (estável 2026.10.26, 26/10/2026) e https://github.com/yt-dlp/yt-dlp-nightly-builds/releases (nightly 2026.11.15, 15/11/2026)
- bgutil-ytdlp-pot-provider: https://github.com/Brainicism/bgutil-ytdlp-pot-provider (2.0.2, 07/10/2026)
- Termos de Serviço do YouTube: https://www.youtube.com/t/terms (vigência 05/01/2022)
- Ajuda do YouTube, restrição de idade: https://support.google.com/youtube/answer/2802167 (sem data)
- Deno: https://github.com/denoland/deno/releases (2.9.8 usado nos testes)

Sem fonte primária encontrada: métodos e países da verificação de idade do Google; comportamento de login Google em WebView2 do Tauri; qualquer texto do yt-dlp sobre vídeo +18 e PO Token além dos issues acima.
