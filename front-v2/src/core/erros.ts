import type { ErroCore } from '~/core/cliente'

export type AcaoRecuperacao =
  | 'abrir-fila'
  | 'confirmar'
  | 'refazer-outro-perfil'
  | 'ajustar-orcamento'
  | 'instalar-componente'
  | 'relocalizar-fonte'
  | 'aceitar-termos'
  | 'recarregar'

export type Recuperacao = {
  rotulo: string
  rota?: string
  acao?: AcaoRecuperacao
}

export type MensagemErro = {
  titulo: string
  recuperacao?: Recuperacao
}

const entradaContextoPequeno: MensagemErro = {
  titulo: 'A Janela de contexto deste Perfil de Provedor é pequena para o tamanho de Corte escolhido.',
  recuperacao: { rotulo: 'Ajustar Perfil de canal', rota: '#/config/projeto' },
}

const entradaLimiteTaxa: MensagemErro = {
  titulo: 'O Provedor atingiu o limite temporário de requisições ou cota diária.',
  recuperacao: { rotulo: 'Refazer com outro Perfil', acao: 'refazer-outro-perfil' },
}

const entradaOrcamento: MensagemErro = {
  titulo: 'O orçamento configurado pausou a fila antes de exceder o limite.',
  recuperacao: { rotulo: 'Ajustar orçamento e continuar', acao: 'ajustar-orcamento' },
}

const entradaRespostaInvalida: MensagemErro = {
  titulo: 'O modelo devolveu resposta incompleta, recusada ou fora do formato esperado.',
  recuperacao: { rotulo: 'Refazer com outro Perfil', acao: 'refazer-outro-perfil' },
}

const entradaPerfilIndisponivel: MensagemErro = {
  titulo: 'O Perfil de Provedor configurado para esta tarefa não existe mais ou está incompleto.',
  recuperacao: { rotulo: 'Configurar Tarefas de IA', rota: '#/config/provedores' },
}

const entradaCredenciais: MensagemErro = {
  titulo: 'Chave ausente/recusada no cofre do sistema ou sessão do CLI não autenticada.',
  recuperacao: { rotulo: 'Atualizar chave / autenticar', rota: '#/config/provedores' },
}

const entradaComponenteFaltante: MensagemErro = {
  titulo: 'Falta instalar um componente ou modelo necessário para esta etapa.',
  recuperacao: { rotulo: 'Instalar componente', rota: '#/config/componentes', acao: 'instalar-componente' },
}

const entradaFonteAlterada: MensagemErro = {
  titulo: 'O arquivo da Fonte foi movido, apagado ou alterado no disco.',
  recuperacao: { rotulo: 'Relocalizar Fonte', acao: 'relocalizar-fonte' },
}

const entradaRoteiroPendente: MensagemErro = {
  titulo: 'Escolha um ângulo e aprove todos os blocos do Roteiro antes de gerar a Narração.',
}

const entradaEspacoInsuficiente: MensagemErro = {
  titulo: 'Espaço livre insuficiente no disco de destino.',
  recuperacao: { rotulo: 'Abrir Armazenamento', rota: '#/config/componentes' },
}

const entradaRede: MensagemErro = {
  titulo: 'Falha de conexão ou endereço não usa HTTPS seguro para envio remoto.',
  recuperacao: { rotulo: 'Configurar Provedores', rota: '#/config/provedores' },
}

/** Tabela central de tradução `CoreError.code` → mensagem humana e recuperação (§6). */
export const TABELA_ERROS: Record<string, MensagemErro> = {
  project_not_open: {
    titulo: 'Nenhum Projeto está aberto no momento.',
    recuperacao: { rotulo: 'Ir para Início', rota: '#/inicio' },
  },
  project_busy: {
    titulo: 'Há uma tarefa ativa bloqueando esta operação no Projeto.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
  newer_project: {
    titulo: 'Este Projeto foi salvo por uma versão mais nova do Clipes.',
    recuperacao: { rotulo: 'Verificar atualizações', rota: '#/sobre' },
  },
  local_only_violation: {
    titulo: 'Bloqueado pelo modo Somente local: este Provedor envia dados para fora da máquina.',
    recuperacao: { rotulo: 'Escolher Perfil local', rota: '#/config/provedores' },
  },
  confirmation_required: {
    titulo: 'Envio remoto ou repetição de chamada paga aguarda sua confirmação.',
    recuperacao: { rotulo: 'Confirmar e continuar', acao: 'confirmar' },
  },
  context_too_small: entradaContextoPequeno,
  max_cut_too_long: entradaContextoPequeno,
  rate_limit: entradaLimiteTaxa,
  provider_daily_limit: entradaLimiteTaxa,
  timeout_uncertain: {
    titulo: 'A resposta do Provedor demorou e não sabemos se a chamada foi cobrada.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
  budget_calls: entradaOrcamento,
  budget_cost: entradaOrcamento,
  budget_tokens: entradaOrcamento,
  time_budget_exhausted: entradaOrcamento,
  invalid_json: entradaRespostaInvalida,
  output_truncated: entradaRespostaInvalida,
  context_truncated: entradaRespostaInvalida,
  refusal: entradaRespostaInvalida,
  profile_unavailable: entradaPerfilIndisponivel,
  invalid_settings: entradaPerfilIndisponivel,
  vault: entradaCredenciais,
  groq_key: entradaCredenciais,
  cli_auth_required: entradaCredenciais,
  component_missing: entradaComponenteFaltante,
  ffprobe_missing: entradaComponenteFaltante,
  worker_missing: entradaComponenteFaltante,
  model_missing: entradaComponenteFaltante,
  source_offline: entradaFonteAlterada,
  source_changed: entradaFonteAlterada,
  source_mismatch: entradaFonteAlterada,
  terms_required: {
    titulo: 'Confirme o aviso de direitos autorais e Termos antes de baixar por URL.',
    recuperacao: { rotulo: 'Aceitar termos', acao: 'aceitar-termos' },
  },
  script_requires_transformed: {
    titulo: 'Roteiro e Narração estão disponíveis apenas para Vídeo transformado.',
  },
  script_not_approved: entradaRoteiroPendente,
  angle_required: entradaRoteiroPendente,
  no_speech_detected: {
    titulo: 'Nenhuma fala detectada na gravação (o rascunho foi preservado).',
  },
  caption_style_conflict: {
    titulo: 'O estilo da legenda foi alterado em outra operação; recarregue antes de salvar.',
    recuperacao: { rotulo: 'Recarregar estilo', acao: 'recarregar' },
  },
  insufficient_space: entradaEspacoInsuficiente,
  output_space_insufficient: entradaEspacoInsuficiente,
  network: entradaRede,
  insecure_endpoint: entradaRede,
  invalid_endpoint: entradaRede,
}

const MENSAGEM_DESCONHECIDA: MensagemErro = {
  titulo: 'Algo deu errado nesta operação.',
}

/** Traduz um `ErroCore` para mensagem humana em PT-BR e ação de recuperação opcional. */
export function mensagemDeErro(e: ErroCore): MensagemErro {
  return TABELA_ERROS[e.code] ?? MENSAGEM_DESCONHECIDA
}
