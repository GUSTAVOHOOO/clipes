---
status: accepted
---

# Relato de problemas sem telemetria: diagnóstico por allowlist e nenhum envio sem revisão

O usuário leva um bug ou uma ideia do app para uma issue do GitHub sem que o Clipes envie nada sozinho. Decisão do dev em 13/11/2026, no grilling do [#25](https://github.com/GUSTAVOHOOO/clipes/issues/25), em continuidade à regra de zero telemetria da [distribuição (#24)](https://github.com/GUSTAVOHOOO/clipes/issues/24) e à política do [ADR-0003](0003-licenca-apache-ffmpeg-sob-demanda-e-politica-de-modelos.md).

## As duas regras

1. **O diagnóstico é uma allowlist.** Só sai o que está na lista; o que não está, não sai.
   - **Entra:** versão do app e dos Componentes, sistema operacional, GPU/VRAM e encoder detectados, nome do Motor de transcrição e do Provedor, etapa do pipeline onde falhou e as últimas ~200 linhas de erro e aviso do log.
   - **Nunca entra:** chaves, caminhos pessoais (o nome de usuário vira `~`), nomes de Fontes e de arquivos, texto de Transcrição, Roteiro ou prompts, URLs das Fontes e nome do canal.
   - O log local já é gravado limpo, e a limpeza se repete na exportação como segunda barreira.
2. **Nenhum envio sem revisão.** O usuário vê o texto completo numa tela de pré-visualização, pode editá-lo e remover blocos. Sem essa tela não existe botão de envio. No relato de bug o diagnóstico vem ligado, e na ideia vem desligado.

## O que vem junto

- **Caminho de envio:** o app abre no navegador uma URL `issues/new` com template, título e corpo preenchidos. Se o texto passar do limite de URL (~8 KB), copia o diagnóstico para a área de transferência. "Copiar texto" fica sempre disponível. Não há API do GitHub nem login na v1.
- **Três entradas:** Relatar problema, Sugerir ideia e Propor Provedor ou modelo, cada uma com um template YAML do GitHub que aplica `needs-triage`. Issues em branco ficam desligadas e as dúvidas de uso vão para o Discussions.
- **Segurança:** vulnerabilidades vão pelo Private vulnerability reporting do GitHub, descrito no `SECURITY.md`. O app avisa, sem bloquear, quando o texto livre menciona "token" ou "chave".

## Opções consideradas

- **Criar a issue pela API do GitHub:** exige login e token no cofre do sistema, e aumenta a superfície de ataque sem ganho que justifique na v1.
- **Telemetria automática de falhas:** contraria o zero telemetria já decidido.
- **Denylist de dados sensíveis:** é frágil, porque um campo novo vazaria por padrão. Daí a allowlist.
- **Dois repositórios, um público e outro de desenvolvimento:** os tickets e o mapa são parte do valor público do projeto, e a numeração e as sub-issues se separariam. O isolamento vem das labels `wayfinder:*` e da triagem, não de outro repo.
