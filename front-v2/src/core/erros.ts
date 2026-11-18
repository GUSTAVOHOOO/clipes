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
  | 'importar-local'

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

const entradaImportarLocal: MensagemErro = {
  titulo: 'Este vídeo tem restrição de idade no YouTube e não pode ser baixado pelo app.',
  recuperacao: { rotulo: 'Importar arquivo local', acao: 'importar-local' },
}

const entradaDownloadUrl: MensagemErro = {
  titulo: 'Não foi possível baixar o vídeo por esta URL. Verifique o link ou atualize o yt-dlp em Componentes.',
  recuperacao: { rotulo: 'Abrir Componentes', rota: '#/config/componentes' },
}

const entradaArquivoFonte: MensagemErro = {
  titulo: 'Não foi possível ler este arquivo de vídeo. Verifique se ele não está corrompido ou em uso.',
}

const entradaIdiomaBloqueado: MensagemErro = {
  titulo: 'O idioma não pode ser alterado porque a Transcrição desta Fonte já começou ou foi concluída.',
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
  window_uncertain: {
    titulo: 'Há uma Janela da Seleção com resultado incerto; resolva na Fila de Jobs antes de retomar ou refazer.',
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
  source_busy: {
    titulo: 'Há uma tarefa ativa ou incerta vinculada a esta Fonte; aguarde ou resolva na Fila de Jobs antes de excluir.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
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
  js_runtime_missing: {
    titulo: 'Falta o componente deno para resolver este vídeo do YouTube.',
    recuperacao: { rotulo: 'Instalar deno', rota: '#/config/componentes', acao: 'instalar-componente' },
  },
  age_restricted: entradaImportarLocal,
  login_required: {
    titulo: 'Este vídeo exige login no YouTube. O Clipes não usa seus cookies nem sua conta.',
    recuperacao: { rotulo: 'Importar arquivo local', acao: 'importar-local' },
  },
  sabr_unavailable: entradaDownloadUrl,
  download_failed: entradaDownloadUrl,
  invalid_url: {
    titulo: 'Cole um endereço válido começando com http:// ou https://.',
  },
  source_unavailable: entradaArquivoFonte,
  probe_failed: entradaArquivoFonte,
  invalid_source: entradaArquivoFonte,
  copy_exists: {
    titulo: 'Já existe um arquivo com este nome dentro da pasta do Projeto.',
  },
  transcription_busy: entradaIdiomaBloqueado,
  transcript_complete: entradaIdiomaBloqueado,
  transcript_partial: entradaIdiomaBloqueado,
  uncertain_job: {
    titulo: 'Esta Fonte tem uma chamada paga com resultado incerto. Resolva na Fila de Jobs antes de retomar o item.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
  transcription_uncertain: {
    titulo: 'Uma chamada paga do Groq ficou sem confirmação de resposta. Resolva na Fila de Jobs antes de continuar.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
  invalid_batch: {
    titulo: 'Lote inválido: selecione de 1 a 500 Fontes e informe uma faixa de duração válida.',
  },
  invalid_budget: {
    titulo: 'Valor de orçamento inválido. Informe um limite maior ou igual a zero.',
  },
  invalid_batch_state: {
    titulo: 'Este lote não permite esta ação no estado atual.',
  },
  invalid_item_state: {
    titulo: 'Esta Fonte do lote não está pausada para retomada.',
  },
  out_of_memory: {
    titulo: 'Faltou memória de vídeo/RAM durante a transcrição. Tente usar o modo CPU ou fechar outros programas.',
    recuperacao: { rotulo: 'Ajustar hardware', rota: '#/config/componentes' },
  },
  groq_key_missing: {
    titulo: 'Chave da API do Groq ausente ou inválida.',
    recuperacao: { rotulo: 'Configurar chave do Groq', rota: '#/config/provedores' },
  },
  audio_too_large: {
    titulo: 'O trecho de áudio excede o limite aceito pelo Groq. Use o Motor Local para esta Fonte.',
  },
  groq_http: {
    titulo: 'O serviço do Groq retornou um erro na requisição. Tente retomar do último bloco salvo ou usar o Motor Local.',
  },
  invalid_correction: {
    titulo: 'Digite entre 1 e 200 caracteres válidos para corrigir a palavra.',
  },
  invalid_permission: {
    titulo: 'Informe se há Permissão registrada ou preencha quem autorizou, onde e o escopo.',
  },
  invalid_language: {
    titulo: 'Idioma não suportado para esta Fonte.',
  },
  invalid_track: {
    titulo: 'A faixa de áudio selecionada não é válida para este arquivo.',
  },
  source_missing: {
    titulo: 'A Fonte selecionada não foi encontrada neste Projeto.',
  },
  transcript_missing: {
    titulo: 'Esta Fonte ainda não possui Transcrição gravada.',
  },
  word_missing: {
    titulo: 'A palavra selecionada não foi encontrada na Transcrição.',
  },
  nothing_to_undo: {
    titulo: 'Não há correções para desfazer no Projeto.',
  },
  nothing_to_redo: {
    titulo: 'Não há correções desfeitas para refazer no Projeto.',
  },
}

const MENSAGEM_DESCONHECIDA: MensagemErro = {
  titulo: 'Algo deu errado nesta operação.',
}

/** Traduz um `ErroCore` para mensagem humana em PT-BR e ação de recuperação opcional. */
export function mensagemDeErro(e: ErroCore): MensagemErro {
  return Object.hasOwn(TABELA_ERROS, e.code) ? TABELA_ERROS[e.code] : MENSAGEM_DESCONHECIDA
}
