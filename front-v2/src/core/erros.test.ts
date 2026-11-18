import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BannerErroCore } from '@ds'
import { ErroCore } from '~/core/cliente'
import { mensagemDeErro, TABELA_ERROS, type Recuperacao } from '~/core/erros'

type LinhaTabelaSpec = {
  codigos: string[]
  titulo: string
  recuperacao?: Recuperacao
}

// Todas as 21 linhas (41 códigos) da tabela em docs/produto/front-v2/01-arquitetura.md §6.
const LINHAS_SPEC_SECAO_6: LinhaTabelaSpec[] = [
  {
    codigos: ['project_not_open'],
    titulo: 'Nenhum Projeto está aberto no momento.',
    recuperacao: { rotulo: 'Ir para Início', rota: '#/inicio' },
  },
  {
    codigos: ['project_busy'],
    titulo: 'Há uma tarefa ativa bloqueando esta operação no Projeto.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
  {
    codigos: ['newer_project'],
    titulo: 'Este Projeto foi salvo por uma versão mais nova do Clipes.',
    recuperacao: { rotulo: 'Verificar atualizações', rota: '#/sobre' },
  },
  {
    codigos: ['local_only_violation'],
    titulo: 'Bloqueado pelo modo Somente local: este Provedor envia dados para fora da máquina.',
    recuperacao: { rotulo: 'Escolher Perfil local', rota: '#/config/provedores' },
  },
  {
    codigos: ['confirmation_required'],
    titulo: 'Envio remoto ou repetição de chamada paga aguarda sua confirmação.',
    recuperacao: { rotulo: 'Confirmar e continuar', acao: 'confirmar' },
  },
  {
    codigos: ['context_too_small', 'max_cut_too_long'],
    titulo: 'A Janela de contexto deste Perfil de Provedor é pequena para o tamanho de Corte escolhido.',
    recuperacao: { rotulo: 'Ajustar Perfil de canal', rota: '#/config/projeto' },
  },
  {
    codigos: ['rate_limit', 'provider_daily_limit'],
    titulo: 'O Provedor atingiu o limite temporário de requisições ou cota diária.',
    recuperacao: { rotulo: 'Refazer com outro Perfil', acao: 'refazer-outro-perfil' },
  },
  {
    codigos: ['timeout_uncertain'],
    titulo: 'A resposta do Provedor demorou e não sabemos se a chamada foi cobrada.',
    recuperacao: { rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' },
  },
  {
    codigos: ['budget_calls', 'budget_cost', 'budget_tokens', 'time_budget_exhausted'],
    titulo: 'O orçamento configurado pausou a fila antes de exceder o limite.',
    recuperacao: { rotulo: 'Ajustar orçamento e continuar', acao: 'ajustar-orcamento' },
  },
  {
    codigos: ['invalid_json', 'output_truncated', 'context_truncated', 'refusal'],
    titulo: 'O modelo devolveu resposta incompleta, recusada ou fora do formato esperado.',
    recuperacao: { rotulo: 'Refazer com outro Perfil', acao: 'refazer-outro-perfil' },
  },
  {
    codigos: ['profile_unavailable', 'invalid_settings'],
    titulo: 'O Perfil de Provedor configurado para esta tarefa não existe mais ou está incompleto.',
    recuperacao: { rotulo: 'Configurar Tarefas de IA', rota: '#/config/provedores' },
  },
  {
    codigos: ['vault', 'groq_key', 'cli_auth_required'],
    titulo: 'Chave ausente/recusada no cofre do sistema ou sessão do CLI não autenticada.',
    recuperacao: { rotulo: 'Atualizar chave / autenticar', rota: '#/config/provedores' },
  },
  {
    codigos: ['component_missing', 'ffprobe_missing', 'worker_missing', 'model_missing'],
    titulo: 'Falta instalar um componente ou modelo necessário para esta etapa.',
    recuperacao: { rotulo: 'Instalar componente', rota: '#/config/componentes', acao: 'instalar-componente' },
  },
  {
    codigos: ['source_offline', 'source_changed', 'source_mismatch'],
    titulo: 'O arquivo da Fonte foi movido, apagado ou alterado no disco.',
    recuperacao: { rotulo: 'Relocalizar Fonte', acao: 'relocalizar-fonte' },
  },
  {
    codigos: ['terms_required'],
    titulo: 'Confirme o aviso de direitos autorais e Termos antes de baixar por URL.',
    recuperacao: { rotulo: 'Aceitar termos', acao: 'aceitar-termos' },
  },
  {
    codigos: ['script_requires_transformed'],
    titulo: 'Roteiro e Narração estão disponíveis apenas para Vídeo transformado.',
  },
  {
    codigos: ['script_not_approved', 'angle_required'],
    titulo: 'Escolha um ângulo e aprove todos os blocos do Roteiro antes de gerar a Narração.',
  },
  {
    codigos: ['no_speech_detected'],
    titulo: 'Nenhuma fala detectada na gravação (o rascunho foi preservado).',
  },
  {
    codigos: ['caption_style_conflict'],
    titulo: 'O estilo da legenda foi alterado em outra operação; recarregue antes de salvar.',
    recuperacao: { rotulo: 'Recarregar estilo', acao: 'recarregar' },
  },
  {
    codigos: ['insufficient_space', 'output_space_insufficient'],
    titulo: 'Espaço livre insuficiente no disco de destino.',
    recuperacao: { rotulo: 'Abrir Armazenamento', rota: '#/config/componentes' },
  },
  {
    codigos: ['network', 'insecure_endpoint', 'invalid_endpoint'],
    titulo: 'Falha de conexão ou endereço não usa HTTPS seguro para envio remoto.',
    recuperacao: { rotulo: 'Configurar Provedores', rota: '#/config/provedores' },
  },
]

const TODOS_CODIGOS_SECAO_6 = LINHAS_SPEC_SECAO_6.flatMap((l) => l.codigos)

describe('mapeador de erros (erros.ts)', () => {
  it('cobre todos os 41 códigos listados na tabela da §6 com entrada própria', () => {
    expect(TODOS_CODIGOS_SECAO_6).toHaveLength(41)
    for (const codigo of TODOS_CODIGOS_SECAO_6) {
      expect(TABELA_ERROS[codigo], `código ausente na TABELA_ERROS: ${codigo}`).toBeDefined()
    }
  })

  it.each(LINHAS_SPEC_SECAO_6)(
    'mapeia o grupo [$codigos] para mensagem humana e recuperação esperadas',
    ({ codigos, titulo, recuperacao }) => {
      const entradaBase = TABELA_ERROS[codigos[0]]
      for (const codigo of codigos) {
        expect(TABELA_ERROS[codigo]).toBe(entradaBase)
        const resultado = mensagemDeErro(new ErroCore(codigo, 'detalhe'))
        expect(resultado.titulo).toBe(titulo)
        if (recuperacao) {
          expect(resultado.recuperacao).toEqual(recuperacao)
        } else {
          expect(resultado.recuperacao).toBeUndefined()
        }
      }
    },
  )

  it('mapeia casos nominais do plano exatamente como especificado', () => {
    expect(mensagemDeErro(new ErroCore('project_not_open', ''))).toEqual({
      titulo: 'Nenhum Projeto está aberto no momento.',
      recuperacao: { rotulo: 'Ir para Início', rota: '#/inicio' },
    })

    const orcamento = mensagemDeErro(new ErroCore('budget_cost', ''))
    expect(orcamento.titulo).toBe('O orçamento configurado pausou a fila antes de exceder o limite.')
    expect(orcamento.recuperacao?.acao).toBe('ajustar-orcamento')

    const fonte = mensagemDeErro(new ErroCore('source_changed', ''))
    expect(fonte.recuperacao?.acao).toBe('relocalizar-fonte')
  })

  it.each(['desconhecido', 'codigo_nao_mapeado', '', 'constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'Review Focus 2: código "%s" devolve mensagem genérica sem recuperação',
    (codigo) => {
      const resultado = mensagemDeErro(new ErroCore(codigo, 'detalhe bruto'))
      expect(resultado).toEqual({ titulo: 'Algo deu errado nesta operação.' })
      expect(resultado.recuperacao).toBeUndefined()
    },
  )

  it('Review Focus 2: erro desconhecido renderiza alerta com "Ver detalhe técnico" no BannerErroCore', () => {
    const erro = new ErroCore('desconhecido', 'boom')
    render(
      createElement(BannerErroCore, {
        erro: { code: erro.code, message: erro.detalhe },
        traduzir: (code: string) => mensagemDeErro(new ErroCore(code, erro.detalhe)),
      }),
    )

    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent('Algo deu errado nesta operação.')
    expect(alerta).toHaveTextContent('Ver detalhe técnico')
    expect(alerta).toHaveTextContent('desconhecido: boom')
  })

  it('mapeia window_uncertain em PT-BR com vocabulário do domínio e recuperação para a Fila', () => {
    const resultado = mensagemDeErro(new ErroCore('window_uncertain', 'janela incerta'))
    expect(resultado.titulo).toMatch(/Janela/)
    expect(resultado.titulo).toMatch(/Seleção/)
    expect(resultado.recuperacao).toEqual({ rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' })
  })

  it('cobre todos os 32 códigos adicionais do Pacote B (Fontes, Transcrição e Lotes)', () => {
    const codigosPacoteB = [
      'js_runtime_missing',
      'age_restricted',
      'login_required',
      'sabr_unavailable',
      'download_failed',
      'invalid_url',
      'source_unavailable',
      'probe_failed',
      'invalid_source',
      'copy_exists',
      'transcription_busy',
      'transcript_complete',
      'transcript_partial',
      'uncertain_job',
      'transcription_uncertain',
      'invalid_batch',
      'invalid_budget',
      'invalid_batch_state',
      'invalid_item_state',
      'out_of_memory',
      'groq_key_missing',
      'audio_too_large',
      'groq_http',
      'invalid_correction',
      'invalid_permission',
      'invalid_language',
      'invalid_track',
      'source_missing',
      'transcript_missing',
      'word_missing',
      'nothing_to_undo',
      'nothing_to_redo',
    ]

    for (const codigo of codigosPacoteB) {
      expect(TABELA_ERROS[codigo], `código ausente na TABELA_ERROS: ${codigo}`).toBeDefined()
      const msg = mensagemDeErro(new ErroCore(codigo, 'detalhe'))
      expect(msg.titulo).not.toBe('Algo deu errado nesta operação.')
      expect(msg.titulo.length).toBeGreaterThan(5)
    }
  })

  it('mapeia recuperações específicas do Pacote B', () => {
    const deno = mensagemDeErro(new ErroCore('js_runtime_missing', ''))
    expect(deno.titulo).toContain('deno')
    expect(deno.recuperacao?.acao).toBe('instalar-componente')

    const age = mensagemDeErro(new ErroCore('age_restricted', ''))
    expect(age.titulo).toContain('restrição de idade')
    expect(age.recuperacao?.rotulo).toBe('Importar arquivo local')

    const login = mensagemDeErro(new ErroCore('login_required', ''))
    expect(login.titulo).toContain('login')
    expect(login.recuperacao?.rotulo).toBe('Importar arquivo local')

    const uncertain = mensagemDeErro(new ErroCore('uncertain_job', ''))
    expect(uncertain.recuperacao?.acao).toBe('abrir-fila')

    const groqKey = mensagemDeErro(new ErroCore('groq_key_missing', ''))
    expect(groqKey.recuperacao?.rota).toBe('#/config/provedores')

    const corr = mensagemDeErro(new ErroCore('invalid_correction', ''))
    expect(corr.titulo).toContain('200')

    const oom = mensagemDeErro(new ErroCore('out_of_memory', ''))
    expect(oom.titulo).toContain('memória')
    expect(oom.recuperacao?.rota).toBe('#/config/componentes')
  })

  it('mapeia source_busy em PT-BR com recuperação para a Fila de Jobs', () => {
    const resultado = mensagemDeErro(new ErroCore('source_busy', 'job ativo'))
    expect(resultado.titulo).toMatch(/Fonte/)
    expect(resultado.recuperacao).toEqual({ rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' })
  })

  it('mapeia snapshot_missing em PT-BR com vocabulário do domínio', () => {
    const resultado = mensagemDeErro(new ErroCore('snapshot_missing', 'snapshot não encontrado'))
    expect(resultado.titulo).not.toBe('Algo deu errado nesta operação.')
    expect(resultado.titulo).toMatch(/Snapshot/)
    expect(resultado.titulo).toMatch(/Histórico/)
    expect(resultado.titulo).toMatch(/Corte/)
    expect(resultado.recuperacao).toBeUndefined()
  })

  it('cobre todos os 19 códigos do Pacote C (Seleção, Revisão, Bordas e Redo)', () => {
    const codigosPacoteC = [
      'run_not_found',
      'candidate_not_found',
      'nothing_to_undo',
      'window_uncertain',
      'window_not_redoable',
      'windows_required',
      'window_not_found',
      'adjust_out_of_transcript',
      'adjust_empty',
      'adjust_too_short',
      'adjust_too_long',
      'transcript_incomplete',
      'no_sentences',
      'invalid_cut_range',
      'invalid_video_kind',
      'invalid_selection_plan',
      'invalid_profile',
      'verification_failed',
      'selection_windows_failed',
    ]

    for (const codigo of codigosPacoteC) {
      expect(TABELA_ERROS[codigo], `código ausente na TABELA_ERROS: ${codigo}`).toBeDefined()
      const msg = mensagemDeErro(new ErroCore(codigo, 'detalhe'))
      expect(msg.titulo).not.toBe('Algo deu errado nesta operação.')
      expect(msg.titulo.length).toBeGreaterThan(5)
    }
  })

  it('mapeia mensagens e recuperações específicas do Pacote C', () => {
    const runNotFound = mensagemDeErro(new ErroCore('run_not_found', ''))
    expect(runNotFound.titulo).toMatch(/execução/i)

    const uncertain = mensagemDeErro(new ErroCore('window_uncertain', ''))
    expect(uncertain.recuperacao).toEqual({ rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' })

    const adjustShort = mensagemDeErro(new ErroCore('adjust_too_short', ''))
    expect(adjustShort.titulo).toMatch(/mínima/i)

    const adjustLong = mensagemDeErro(new ErroCore('adjust_too_long', ''))
    expect(adjustLong.titulo).toMatch(/máxima/i)

    const adjustOut = mensagemDeErro(new ErroCore('adjust_out_of_transcript', ''))
    expect(adjustOut.titulo).toMatch(/Transcrição/i)

    const transcriptInc = mensagemDeErro(new ErroCore('transcript_incomplete', ''))
    expect(transcriptInc.titulo).toMatch(/Transcrição/i)

    const noSentences = mensagemDeErro(new ErroCore('no_sentences', ''))
    expect(noSentences.titulo).toMatch(/Frase/i)

    const nothingUndo = mensagemDeErro(new ErroCore('nothing_to_undo', ''))
    expect(nothingUndo.titulo).toMatch(/desfazer/i)

    const verifFailed = mensagemDeErro(new ErroCore('verification_failed', ''))
    expect(verifFailed.recuperacao?.acao).toBe('refazer-outro-perfil')

    const windowsFailed = mensagemDeErro(new ErroCore('selection_windows_failed', ''))
    expect(windowsFailed.recuperacao?.acao).toBe('refazer-outro-perfil')

    const invalidProfile = mensagemDeErro(new ErroCore('invalid_profile', ''))
    expect(invalidProfile.recuperacao?.rota).toBe('#/config/provedores')
  })

  it('mapeia erros de conversão do tipo de vídeo (candidate_not_found e invalid_video_kind) em PT-BR com vocabulário do GLOSSARY', () => {
    const naoEncontrado = mensagemDeErro(new ErroCore('candidate_not_found', 'Candidato não encontrado.'))
    expect(naoEncontrado.titulo).not.toBe('Algo deu errado nesta operação.')
    expect(naoEncontrado.titulo).toMatch(/Corte|candidato/i)

    const tipoInvalido = mensagemDeErro(new ErroCore('invalid_video_kind', 'Tipo inválido.'))
    expect(tipoInvalido.titulo).not.toBe('Algo deu errado nesta operação.')
    expect(tipoInvalido.titulo).toContain('Corte direto')
    expect(tipoInvalido.titulo).toContain('Vídeo transformado')
  })

  it('cobre todos os 35 códigos do Pacote D (Editor, Crop, Áudio, Tradução, Proxy e Exportação)', () => {
    const codigosPacoteD = [
      'invalid_clip',
      'unknown_sentence_id',
      'invalid_range',
      'clip_too_long',
      'adjust_empty',
      'adjust_too_short',
      'adjust_too_long',
      'invalid_silence_threshold',
      'invalid_silence_interval',
      'invalid_crop',
      'reframe_not_found',
      'translation_permission_required',
      'language_required',
      'translation_missing',
      'translation_empty',
      'invalid_audio_kind',
      'invalid_audio',
      'audio_asset_missing',
      'attribution_required',
      'sfx_not_found',
      'block_not_found',
      'invalid_montage',
      'proxy_not_ready',
      'proxy_failed',
      'export_exists',
      'export_destination',
      'export_glyph_missing',
      'export_ass_missing',
      'export_font_missing',
      'export_failed',
      'export_bounds',
      'export_candidate',
      'project_write',
      'nothing_to_undo',
      'nothing_to_redo',
    ]

    for (const codigo of codigosPacoteD) {
      expect(TABELA_ERROS[codigo], `código ausente na TABELA_ERROS: ${codigo}`).toBeDefined()
      const msg = mensagemDeErro(new ErroCore(codigo, 'detalhe'))
      expect(msg.titulo).not.toBe('Algo deu errado nesta operação.')
      expect(msg.titulo.length).toBeGreaterThan(5)
    }
  })

  it('cobre todos os 55 códigos do Pacote E (Transformar, Narração, TTS, Capa e Empacotamento)', () => {
    const codigosPacoteE = [
      'angle_invalid',
      'angle_change_confirmation',
      'edit_invalid',
      'invalid_edit',
      'nothing_to_edit',
      'nothing_to_approve',
      'generation_in_progress',
      'suggestion_in_progress',
      'generating',
      'no_script',
      'pending_blocks',
      'import_in_progress',
      'import_unsupported_format',
      'import_file_too_large',
      'import_duration_too_short',
      'import_duration_too_long',
      'import_no_audio_stream',
      'import_unsupported_codec',
      'import_empty_file',
      'import_failed',
      'import_file_missing',
      'import_invalid_audio',
      'invalid_recording_audio',
      'recording_too_large',
      'narration_record_failed',
      'narration_failed',
      'narration_missing',
      'narration_not_recorded',
      'narration_align_failed',
      'narration_cleanup_failed',
      'cleanup_not_applicable',
      'invalid_cleanup_state',
      'alignment_missing',
      'invalid_review_choice',
      'tts_model_missing',
      'tts_model_unknown',
      'tts_model_language_mismatch',
      'tts_voice_unknown',
      'tts_voice_language_mismatch',
      'tts_voice_unsupported',
      'terms_acceptance_required',
      'ffmpeg_missing',
      'instant_out_of_cut',
      'no_instant',
      'thumbnail_exists',
      'thumbnail_destination',
      'thumbnail_failed',
      'chapter_delimiters_missing',
      'chapters_require_transformed',
      'chapters_unavailable',
      'narration_required',
      'too_few_chapters',
      'block_not_found',
      'language_required',
      'export_glyph_missing',
    ]

    for (const codigo of codigosPacoteE) {
      expect(TABELA_ERROS[codigo], `código ausente na TABELA_ERROS: ${codigo}`).toBeDefined()
      const msg = mensagemDeErro(new ErroCore(codigo, 'detalhe'))
      expect(msg.titulo).not.toBe('Algo deu errado nesta operação.')
      expect(msg.titulo.length).toBeGreaterThan(5)
    }
  })

  it('mapeia tradução e ações de recuperação específicas do Pacote D', () => {
    const exportExists = mensagemDeErro(new ErroCore('export_exists', ''))
    expect(exportExists.titulo).toMatch(/existe um arquivo/i)

    const exportDest = mensagemDeErro(new ErroCore('export_destination', ''))
    expect(exportDest.titulo).toMatch(/\.mp4/i)

    const exportGlyph = mensagemDeErro(new ErroCore('export_glyph_missing', ''))
    expect(exportGlyph.titulo).toMatch(/fonte da legenda/i)
    expect(exportGlyph.recuperacao?.rotulo).toMatch(/Transcrição/i)

    const exportAss = mensagemDeErro(new ErroCore('export_ass_missing', ''))
    expect(exportAss.titulo).toMatch(/renderizar/i)
    expect(exportAss.recuperacao?.rota).toBe('#/relatos')

    const audioMissing = mensagemDeErro(new ErroCore('audio_asset_missing', ''))
    expect(audioMissing.titulo).toMatch(/trilha sonora|efeito sonoro/i)
    expect(audioMissing.recuperacao?.rotulo).toMatch(/Áudio/i)

    const attrReq = mensagemDeErro(new ErroCore('attribution_required', ''))
    expect(attrReq.titulo).toMatch(/atribuição/i)
    expect(attrReq.titulo).toMatch(/CC-BY/i)

    const proxyFail = mensagemDeErro(new ErroCore('proxy_failed', ''))
    expect(proxyFail.titulo).toMatch(/prévia/i)
    expect(proxyFail.recuperacao?.rotulo).toMatch(/prévia/i)

    const transPerm = mensagemDeErro(new ErroCore('translation_permission_required', ''))
    expect(transPerm.titulo).toMatch(/Permissão/i)
    expect(transPerm.titulo).toMatch(/tradução/i)

    const projWrite = mensagemDeErro(new ErroCore('project_write', ''))
    expect(projWrite.titulo).toMatch(/disco/i)
    expect(projWrite.recuperacao?.rota).toBe('#/config/componentes')

    const conflict = mensagemDeErro(new ErroCore('caption_style_conflict', ''))
    expect(conflict.titulo).toMatch(/recarregue/i)
    expect(conflict.recuperacao).toEqual({ rotulo: 'Recarregar estilo', acao: 'recarregar' })
  })

  it('mapeia mensagens e recuperações específicas do Pacote E', () => {
    const angleInvalid = mensagemDeErro(new ErroCore('angle_invalid', ''))
    expect(angleInvalid.titulo).toMatch(/60/)
    expect(angleInvalid.titulo).toMatch(/200/)

    const ttsMissing = mensagemDeErro(new ErroCore('tts_model_missing', ''))
    expect(ttsMissing.titulo).toMatch(/TTS/i)
    expect(ttsMissing.recuperacao?.acao).toBe('instalar-componente')

    const importFmt = mensagemDeErro(new ErroCore('import_unsupported_format', ''))
    expect(importFmt.titulo).toMatch(/\.wav/i)

    const cleanupFail = mensagemDeErro(new ErroCore('narration_cleanup_failed', ''))
    expect(cleanupFail.titulo).toMatch(/FFmpeg/i)
    expect(cleanupFail.recuperacao?.rota).toBe('#/config/componentes')

    const outOfCut = mensagemDeErro(new ErroCore('instant_out_of_cut', ''))
    expect(outOfCut.titulo).toMatch(/Corte/)

    const thumbExists = mensagemDeErro(new ErroCore('thumbnail_exists', ''))
    expect(thumbExists.titulo).toMatch(/arquivo/i)

    const delimMissing = mensagemDeErro(new ErroCore('chapter_delimiters_missing', ''))
    expect(delimMissing.titulo).toMatch(/delimitadores|marcadores/i)

    const chapReq = mensagemDeErro(new ErroCore('chapters_require_transformed', ''))
    expect(chapReq.titulo).toMatch(/Vídeo transformado/)

    const glyphMissing = mensagemDeErro(new ErroCore('export_glyph_missing', ''))
    expect(glyphMissing.titulo).toMatch(/fonte/i)

    const genInProg = mensagemDeErro(new ErroCore('generation_in_progress', ''))
    expect(genInProg.recuperacao).toEqual({ rotulo: 'Abrir Fila de Jobs', acao: 'abrir-fila' })

    const termsReq = mensagemDeErro(new ErroCore('terms_acceptance_required', ''))
    expect(termsReq.recuperacao?.acao).toBe('aceitar-termos')
  })
})
