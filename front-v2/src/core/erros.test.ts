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
})
