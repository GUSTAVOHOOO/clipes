# Clipes

Gerador open source de cortes de lives e vídeos: transcrição local, cortes com legenda e edição, agnóstico de provedor de IA.

## Agent skills

### Issue tracker

Issues, mapas do wayfinder e tickets vivem no GitHub Issues deste repo (`gh` CLI, sub-issues e dependências nativas). See `docs/agents/issue-tracker.md`.

### Triage labels

Cinco labels padrão: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: um `GLOSSARY.md` e `docs/adr/` na raiz, criados sob demanda. ADRs são seguidos e podem ser questionados: quando um fato novo os contradiz, levante a questão com a evidência. See `docs/agents/domain.md`.

### Impedimentos conhecidos

Antes de insistir num erro de ambiente (modelo do Codex, update do Codex, yt-dlp, cookies, login do Google, DCO, CI), consulte `docs/agents/impedimentos.md`. Ao resolver um impedimento novo, acrescente a entrada lá.

### Disco

O disco do dev é pequeno: cada worker devolve o disco como encontrou. Antes do `worker_done`, rode `cargo clean` no worktree e apague as pastas que criou no `%TEMP%` (ambientes Python, mídias, proxies, saídas de teste); `%TEMP%\clipes-dataset` é compartilhado e fica. Teste novo cria a pasta temporária com `tempfile::TempDir`, que se apaga sozinha. Com menos de 15 GB livres no C:, pergunte ao coordenador via `ask` antes de compilar ou baixar modelo. Causas e limpeza em `docs/agents/impedimentos.md`, seção Disco.
