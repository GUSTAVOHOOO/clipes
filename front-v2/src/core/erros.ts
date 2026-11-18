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

const entradaPreviaFalhou: MensagemErro = {
  titulo: 'Não foi possível preparar a prévia rápida deste trecho.',
  recuperacao: { rotulo: 'Tentar gerar prévia novamente', acao: 'recarregar' },
}

const entradaRenderLegendaFalhou: MensagemErro = {
  titulo: 'Não foi possível renderizar o vídeo com as legendas atuais.',
  recuperacao: { rotulo: 'Abrir Relatos', rota: '#/relatos' },
}

const entradaCorteExportAlterado: MensagemErro = {
  titulo: 'As bordas ou a aprovação deste Corte mudaram.',
  recuperacao: { rotulo: 'Voltar para Cortes' },
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
    titulo: 'Não há mais decisões ou correções para desfazer.',
  },
  nothing_to_redo: {
    titulo: 'Não há correções desfeitas para refazer no Projeto.',
  },
  snapshot_missing: {
    titulo: 'O Snapshot selecionado não foi encontrado no Histórico deste Corte.',
  },
  run_not_found: {
    titulo: 'Esta execução de seleção não foi encontrada.',
  },
  candidate_not_found: {
    titulo: 'O candidato selecionado não foi encontrado nesta execução.',
  },
  window_not_redoable: {
    titulo: 'Só é possível refazer Janelas concluídas, que falharam ou foram canceladas.',
  },
  windows_required: {
    titulo: 'Escolha pelo menos uma Janela de seleção para refazer.',
  },
  window_not_found: {
    titulo: 'A Janela de seleção informada não foi encontrada.',
  },
  adjust_out_of_transcript: {
    titulo: 'A borda do Corte não pode sair dos limites da Transcrição.',
  },
  adjust_empty: {
    titulo: 'O Corte precisa manter ao menos uma Frase inteira.',
  },
  adjust_too_short: {
    titulo: 'O Corte ficaria abaixo da duração mínima desta execução.',
  },
  adjust_too_long: {
    titulo: 'O Corte ficaria acima da duração máxima desta execução.',
  },
  transcript_incomplete: {
    titulo: 'A Transcrição desta Fonte ainda não foi concluída.',
  },
  no_sentences: {
    titulo: 'A Transcrição desta Fonte não tem Frases disponíveis para seleção.',
  },
  invalid_cut_range: {
    titulo: 'A faixa de duração dos Cortes é inválida: o mínimo deve ser positivo e menor que o máximo.',
  },
  invalid_video_kind: {
    titulo: 'Tipo de vídeo inválido: escolha Corte direto ou Vídeo transformado.',
  },
  invalid_selection_plan: {
    titulo: 'O plano de Janelas de seleção é inválido para esta Transcrição.',
  },
  invalid_profile: {
    titulo: 'Escolha um Perfil de Provedor válido para continuar.',
    recuperacao: { rotulo: 'Configurar Provedores', rota: '#/config/provedores' },
  },
  verification_failed: {
    titulo: 'A resposta do Provedor não passou na verificação de formato da Seleção.',
    recuperacao: { rotulo: 'Refazer com outro Perfil', acao: 'refazer-outro-perfil' },
  },
  selection_windows_failed: {
    titulo: 'Algumas Janelas da seleção falharam; refaça-as para completar a execução.',
    recuperacao: { rotulo: 'Refazer com outro Perfil', acao: 'refazer-outro-perfil' },
  },
  invalid_clip: {
    titulo: 'Este Corte não está aberto ou não foi encontrado no Editor.',
  },
  unknown_sentence_id: {
    titulo: 'A Frase selecionada não foi encontrada na Transcrição.',
  },
  invalid_range: {
    titulo: 'As bordas precisam respeitar os limites válidos da Fonte e do Corte.',
  },
  clip_too_long: {
    titulo: 'O Corte ultrapassa a duração máxima de 10 minutos para prévia e edição.',
  },
  invalid_silence_threshold: {
    titulo: 'O limite de detecção de silêncio deve ficar entre 300 ms e 2000 ms.',
  },
  invalid_silence_interval: {
    titulo: 'O intervalo de silêncio selecionado não é válido para este Corte.',
  },
  invalid_crop: {
    titulo: 'As coordenadas ou o painel de enquadramento são inválidos.',
  },
  reframe_not_found: {
    titulo: 'A análise de reenquadramento automático não foi encontrada.',
  },
  translation_permission_required: {
    titulo: 'A Permissão desta Fonte não autoriza tradução. Registre o escopo de tradução na Fonte para liberar este recurso.',
  },
  language_required: {
    titulo: 'O idioma do Corte não é claro. Escolha o idioma de destino: PT-BR ou EN.',
  },
  translation_missing: {
    titulo: 'Gere uma tradução para este Corte antes de selecionar ou editar a faixa traduzida.',
  },
  translation_empty: {
    titulo: 'O texto da legenda traduzida não pode ficar vazio.',
  },
  invalid_audio_kind: {
    titulo: 'Tipo de áudio inválido: escolha música ou efeito sonoro (SFX).',
  },
  invalid_audio: {
    titulo: 'Não foi possível ler este arquivo de áudio. Verifique se o formato é válido.',
  },
  audio_asset_missing: {
    titulo: 'Uma trilha sonora ou efeito sonoro deste Corte não foi encontrado na pasta do Projeto.',
    recuperacao: { rotulo: 'Abrir aba Áudio e SFX' },
  },
  attribution_required: {
    titulo: 'Informe o texto de atribuição exigido pela licença CC-BY.',
  },
  sfx_not_found: {
    titulo: 'O efeito sonoro selecionado não foi encontrado neste Corte.',
  },
  block_not_found: {
    titulo: 'O bloco de Narração selecionado não foi encontrado.',
  },
  invalid_montage: {
    titulo: 'Os tempos da montagem da Narração são inválidos para este Corte.',
  },
  proxy_not_ready: entradaPreviaFalhou,
  proxy_failed: entradaPreviaFalhou,
  export_exists: {
    titulo: 'Já existe um arquivo com esse nome na pasta escolhida.',
  },
  export_destination: {
    titulo: 'Escolha uma pasta existente e um nome terminado em .mp4.',
  },
  export_glyph_missing: {
    titulo: 'A fonte da legenda não possui alguns caracteres usados no texto.',
    recuperacao: { rotulo: 'Editar texto na Transcrição' },
  },
  export_ass_missing: entradaRenderLegendaFalhou,
  export_font_missing: entradaRenderLegendaFalhou,
  export_failed: entradaRenderLegendaFalhou,
  export_bounds: entradaCorteExportAlterado,
  export_candidate: entradaCorteExportAlterado,
  project_write: {
    titulo: 'Não foi possível gravar as edições no disco. Verifique o espaço disponível.',
    recuperacao: { rotulo: 'Abrir Armazenamento', rota: '#/config/componentes' },
  },
  // Pacote E (Transformar, Narração, TTS, Capa e Empacotamento)
  angle_invalid: {
    titulo: 'Confira o nome (até 60 caracteres), a promessa (1 frase, até 200 caracteres) e as Frases selecionadas.',
  },
  angle_change_confirmation: {
    titulo: 'Confirme a troca do ângulo: os blocos do Roteiro ficarão desatualizados.',
    recuperacao: { rotulo: 'Confirmar troca', acao: 'confirmar' },
  },
  edit_invalid: {
    titulo: 'A edição excedeu os limites permitidos ou contém formato inválido.',
  },
  invalid_edit: {
    titulo: 'A edição excedeu os limites permitidos ou contém formato inválido.',
  },
  nothing_to_edit: {
    titulo: 'Gere o conteúdo deste Corte antes de editar.',
  },
  nothing_to_approve: {
    titulo: 'O bloco ainda não tem texto para aprovar.',
  },
  generation_in_progress: {
    titulo: 'Já existe uma geração ou sugestão em andamento para este Corte.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
  suggestion_in_progress: {
    titulo: 'Já existe uma sugestão de capa em andamento para este Corte.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
  generating: {
    titulo: 'A geração do Roteiro ainda está em andamento.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
  no_script: {
    titulo: 'Gere e aprove o Roteiro antes de narrar.',
  },
  pending_blocks: {
    titulo: 'Ainda há blocos pendentes de aprovação no Roteiro.',
  },
  import_in_progress: {
    titulo: 'Já existe uma importação de áudio em andamento para este Corte.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
  import_unsupported_format: {
    titulo: 'Arquivo inválido: envie .wav, .mp3, .m4a ou .ogg com áudio válido entre 0,3 s e 10 min e até 200 MiB.',
  },
  import_file_too_large: {
    titulo: 'Arquivo inválido: envie .wav, .mp3, .m4a ou .ogg com áudio válido entre 0,3 s e 10 min e até 200 MiB.',
  },
  import_duration_too_short: {
    titulo: 'Arquivo inválido: envie .wav, .mp3, .m4a ou .ogg com áudio válido entre 0,3 s e 10 min e até 200 MiB.',
  },
  import_duration_too_long: {
    titulo: 'Arquivo inválido: envie .wav, .mp3, .m4a ou .ogg com áudio válido entre 0,3 s e 10 min e até 200 MiB.',
  },
  import_no_audio_stream: {
    titulo: 'Arquivo inválido: envie .wav, .mp3, .m4a ou .ogg com áudio válido entre 0,3 s e 10 min e até 200 MiB.',
  },
  import_unsupported_codec: {
    titulo: 'Arquivo inválido: envie .wav, .mp3, .m4a ou .ogg com áudio válido entre 0,3 s e 10 min e até 200 MiB.',
  },
  import_empty_file: {
    titulo: 'Arquivo inválido: envie .wav, .mp3, .m4a ou .ogg com áudio válido entre 0,3 s e 10 min e até 200 MiB.',
  },
  import_invalid_audio: {
    titulo: 'Arquivo inválido: envie .wav, .mp3, .m4a ou .ogg com áudio válido entre 0,3 s e 10 min e até 200 MiB.',
  },
  import_file_missing: {
    titulo: 'O arquivo de áudio selecionado não foi encontrado no disco.',
  },
  import_failed: {
    titulo: 'Não foi possível importar o arquivo de áudio para este bloco.',
  },
  invalid_recording_audio: {
    titulo: 'O áudio gravado está vazio ou em formato inválido.',
  },
  recording_too_large: {
    titulo: 'A gravação ultrapassou o tamanho máximo permitido.',
  },
  narration_record_failed: {
    titulo: 'Não foi possível salvar ou processar a gravação da Narração.',
  },
  narration_failed: {
    titulo: 'Não foi possível gerar ou ler o áudio da Narração.',
  },
  narration_missing: {
    titulo: 'Este bloco ainda não possui áudio de Narração.',
  },
  narration_not_recorded: {
    titulo: 'Apenas gravações de microfone podem ser aparadas com VAD.',
  },
  narration_align_failed: {
    titulo: 'Não foi possível alinhar a Narração com o texto do Roteiro.',
  },
  narration_cleanup_failed: {
    titulo: 'Não foi possível preparar a limpeza de voz sem o FFmpeg funcionando.',
    recuperacao: { rotulo: 'Verificar FFmpeg', rota: '#/config/componentes' },
  },
  cleanup_not_applicable: {
    titulo: 'A limpeza de voz só se aplica a Narração gravada ou importada.',
  },
  invalid_cleanup_state: {
    titulo: 'A limpeza de voz só se aplica a Narração gravada ou importada.',
  },
  alignment_missing: {
    titulo: 'Alinhe o áudio deste bloco antes de revisar o texto.',
  },
  invalid_review_choice: {
    titulo: 'Escolha entre usar o texto do Roteiro ou o texto falado.',
  },
  tts_model_missing: {
    titulo: 'Falta baixar o modelo de voz TTS deste idioma.',
    recuperacao: { rotulo: 'Instalar modelo TTS', rota: '#/config/componentes', acao: 'instalar-componente' },
  },
  tts_model_unknown: {
    titulo: 'Modelo de voz TTS desconhecido no catálogo.',
  },
  tts_model_language_mismatch: {
    titulo: 'O modelo TTS selecionado não corresponde ao idioma do Roteiro.',
  },
  tts_voice_unknown: {
    titulo: 'Voz de Narração desconhecida no catálogo.',
  },
  tts_voice_language_mismatch: {
    titulo: 'A voz selecionada não é compatível com o idioma do Roteiro.',
  },
  tts_voice_unsupported: {
    titulo: 'A voz selecionada não é compatível com o modelo TTS ativo.',
  },
  terms_acceptance_required: {
    titulo: 'Confirme o termo de uso responsável antes de baixar o modelo de voz.',
    recuperacao: { rotulo: 'Aceitar termos', acao: 'aceitar-termos' },
  },
  ffmpeg_missing: {
    titulo: 'Instale o Componente FFmpeg para processar áudio, capa ou vídeo.',
    recuperacao: { rotulo: 'Verificar FFmpeg', rota: '#/config/componentes', acao: 'instalar-componente' },
  },
  instant_out_of_cut: {
    titulo: 'Escolha um momento dentro dos limites do Corte antes de salvar ou exportar a capa.',
  },
  no_instant: {
    titulo: 'Escolha um momento dentro dos limites do Corte antes de exportar a capa.',
  },
  thumbnail_exists: {
    titulo: 'Já existe um arquivo com esse nome na pasta escolhida. Escolha outro nome para não sobrescrever.',
  },
  thumbnail_destination: {
    titulo: 'Escolha uma pasta existente e um nome de arquivo PNG válido.',
  },
  thumbnail_failed: {
    titulo: 'Não foi possível extrair o quadro da capa.',
  },
  chapter_delimiters_missing: {
    titulo: 'Os marcadores de capítulos foram removidos da descrição. Nada foi alterado para preservar seu texto.',
  },
  chapters_require_transformed: {
    titulo: 'Capítulos automáticos existem apenas para Vídeo transformado.',
  },
  chapters_unavailable: {
    titulo: 'Capítulos automáticos exigem Vídeo transformado com Roteiro aprovado, Narração pronta e ao menos 3 blocos de 10 s.',
  },
  narration_required: {
    titulo: 'Gere ou grave a Narração dos blocos antes de atualizar os capítulos.',
  },
  too_few_chapters: {
    titulo: 'O YouTube exige pelo menos 3 capítulos com duração mínima de 10 s cada.',
  },
  cancelled: {
    titulo: 'Esta operação foi cancelada antes de concluir.',
  },
}

const MENSAGEM_DESCONHECIDA: MensagemErro = {
  titulo: 'Algo deu errado nesta operação.',
}

/** Traduz um `ErroCore` para mensagem humana em PT-BR e ação de recuperação opcional. */
export function mensagemDeErro(e: ErroCore): MensagemErro {
  return Object.hasOwn(TABELA_ERROS, e.code) ? TABELA_ERROS[e.code] : MENSAGEM_DESCONHECIDA
}
