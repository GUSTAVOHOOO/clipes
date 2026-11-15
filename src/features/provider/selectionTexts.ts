/**
 * Fontes oficiais das instruções (lidas em 2026-11-15; ver docs/contribuindo/aviso-de-contexto.md):
 * - Ollama, `num_ctx` no Modelfile: https://docs.ollama.com/modelfile
 * - Ollama, app e `OLLAMA_CONTEXT_LENGTH`, memória cresce: https://docs.ollama.com/context-length
 * - LM Studio, tamanho de contexto ao carregar: https://lmstudio.ai/docs/app/advanced/per-model
 * - llama.cpp, `-c`/`--ctx-size`: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
 */
export const selectionTexts = {
  'pt-BR': {
    title: 'Seleção com este perfil', estimate: 'Estimativa para fala densa de 60 min. Não é uma regra: a Fonte real é avaliada na hora de selecionar.',
    model: 'Modelo', context: 'Contexto efetivo', tokens: 'tokens', origin: 'Origem',
    loading: 'Calculando…', unavailable: 'Não foi possível estimar a seleção para este perfil.',
    origins: { user: 'Informado por você', loaded: 'Carregado no servidor', server: 'Informado pelo servidor', catalog: 'Catálogo embutido', fallback: 'Padrão conservador', measured: 'Medido' },
    full: 'Janela cheia', reduced: 'Janela reduzida', blocked: 'Bloqueada',
    fullBody: 'A seleção usa janelas de até {max} min.',
    reducedBody: 'A seleção usa janelas de cerca de {first} min: mais chamadas e possíveis limitações, como perder Cortes. Aumente o contexto ou escolha outro perfil.',
    blockedBody: 'A seleção de Cortes não roda com este perfil: o contexto não comporta a janela mínima de {min} min. Outras Tarefas de IA que couberem continuam disponíveis.',
    notRecommended: 'Não recomendado para a seleção de Cortes: o contexto é pequeno demais. O perfil continua servindo a outras Tarefas de IA.',
    fixTitle: 'Como aumentar o contexto',
    fixDefault: 'Aumente o contexto no perfil ou escolha outro perfil para a seleção. O Clipes não troca de Provedor sozinho.',
    ollama_profile: 'Ollama: aumente o campo "Contexto em tokens" deste perfil (é o `num_ctx` enviado ao Ollama). Um contexto maior usa mais memória (VRAM).',
    ollama_server: 'Ollama: no app do Ollama, ajuste o controle de tamanho de contexto, ou inicie o servidor com `OLLAMA_CONTEXT_LENGTH`. Um contexto maior usa mais memória (VRAM).',
    lmstudio: 'LM Studio: defina o tamanho do contexto ("Context size") ao carregar o modelo, ou nos padrões do modelo em Meus Modelos.',
    llamacpp: 'llama.cpp: inicie o servidor com `-c` (ou `--ctx-size`), por exemplo `-c 16384`.',
    docs: 'Documentação oficial',
  },
  en: {
    title: 'Selection with this profile', estimate: 'Estimate for dense speech, 60 min. Not a rule: the real Source is checked when you select.',
    model: 'Model', context: 'Effective context', tokens: 'tokens', origin: 'Origin',
    loading: 'Calculating…', unavailable: 'Could not estimate the selection for this profile.',
    origins: { user: 'Set by you', loaded: 'Loaded on the server', server: 'Reported by the server', catalog: 'Built-in catalog', fallback: 'Conservative default', measured: 'Measured' },
    full: 'Full window', reduced: 'Reduced window', blocked: 'Blocked',
    fullBody: 'Selection uses windows of up to {max} min.',
    reducedBody: 'Selection uses windows of about {first} min: more calls and possible limitations, such as missed Clips. Increase the context or choose another profile.',
    blockedBody: 'Clip selection does not run with this profile: the context does not fit the minimum {min} min window. Other AI Tasks that fit stay available.',
    notRecommended: 'Not recommended for Clip selection: the context is too small. The profile still serves other AI Tasks.',
    fixTitle: 'How to increase the context',
    fixDefault: 'Increase the context in the profile or choose another profile for selection. Clipes never switches Providers by itself.',
    ollama_profile: 'Ollama: increase the "Context in tokens" field of this profile (it is the `num_ctx` sent to Ollama). A larger context uses more memory (VRAM).',
    ollama_server: 'Ollama: in the Ollama app, adjust the context length control, or start the server with `OLLAMA_CONTEXT_LENGTH`. A larger context uses more memory (VRAM).',
    lmstudio: 'LM Studio: set the context size ("Context size") when you load the model, or in the model defaults under My Models.',
    llamacpp: 'llama.cpp: start the server with `-c` (or `--ctx-size`), for example `-c 16384`.',
    docs: 'Official documentation',
  },
} as const;

export const guideDocs = {
  ollama_profile: 'https://docs.ollama.com/modelfile',
  ollama_server: 'https://docs.ollama.com/context-length',
  lmstudio: 'https://lmstudio.ai/docs/app/advanced/per-model',
  llamacpp: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md',
} as const;
