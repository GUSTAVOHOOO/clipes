import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { resolver, type Contexto } from '~/rotas/rotas'
import { useRota } from '~/rotas/useRota'

describe('resolver rotas', () => {
  const semProjeto: Contexto = { projetoAberto: null }
  const comCanal: Contexto = { projetoAberto: 'canal' }

  it('redireciona hashes vazios, raiz e desconhecidos para #/inicio', () => {
    expect(resolver('', semProjeto)).toEqual({ redirecionar: '#/inicio' })
    expect(resolver('#/', semProjeto)).toEqual({ redirecionar: '#/inicio' })
    expect(resolver('#/xyz', semProjeto)).toEqual({ redirecionar: '#/inicio' })
    expect(resolver('#/qualquer', comCanal)).toEqual({ redirecionar: '#/inicio' })
    expect(resolver('#/inicio', semProjeto)).toEqual({ rota: { tela: 'inicio' } })
  })

  it('resolve #/assistente com passo padrão 1 ou explícito 2 e retorno opcional', () => {
    expect(resolver('#/assistente', semProjeto)).toEqual({ rota: { tela: 'assistente', passo: 1 } })
    expect(resolver('#/assistente?passo=2', semProjeto)).toEqual({ rota: { tela: 'assistente', passo: 2 } })
    expect(resolver('#/assistente?passo=1&retorno=config', semProjeto)).toEqual({
      rota: { tela: 'assistente', passo: 1, retorno: 'config' },
    })
    expect(resolver('#/assistente?passo=2&retorno=config', semProjeto)).toEqual({
      rota: { tela: 'assistente', passo: 2, retorno: 'config' },
    })
  })

  it('bloqueia rotas de Projeto quando não há Projeto aberto ou é outro Projeto', () => {
    expect(resolver('#/projeto/canal/cortes', semProjeto)).toEqual({ redirecionar: '#/inicio' })
    expect(resolver('#/projeto/canal/cortes', { projetoAberto: 'outro' })).toEqual({ redirecionar: '#/inicio' })
    expect(resolver('#/projeto/outro/cortes', comCanal)).toEqual({ redirecionar: '#/inicio' })
  })

  it('resolve fontes, sub=lotes e detalhe da fonte', () => {
    expect(resolver('#/projeto/canal/fontes', comCanal)).toEqual({
      rota: { tela: 'fontes', projeto: 'canal', sub: 'fontes' },
    })
    expect(resolver('#/projeto/canal/fontes?sub=lotes', comCanal)).toEqual({
      rota: { tela: 'fontes', projeto: 'canal', sub: 'lotes' },
    })
    expect(resolver('#/projeto/canal/fontes/f-1', comCanal)).toEqual({
      rota: { tela: 'fonte', projeto: 'canal', fonte: 'f-1' },
    })
  })

  it('resolve cortes e revisão de cortes com parâmetros de query', () => {
    expect(resolver('#/projeto/canal/cortes?fonte=f1&run=r2&rev=3', comCanal)).toEqual({
      rota: { tela: 'cortes', projeto: 'canal', fonte: 'f1', run: 'r2', rev: 3 },
    })
    expect(resolver('#/projeto/canal/cortes/revisao/r2?rev=3&corte=c9', comCanal)).toEqual({
      rota: { tela: 'revisao', projeto: 'canal', run: 'r2', rev: 3, corte: 'c9' },
    })
  })

  it('redireciona #/projeto/:id/exportacao/lotes para ?sub=lotes quando o Projeto está aberto', () => {
    expect(resolver('#/projeto/canal/exportacao', comCanal)).toEqual({
      rota: { tela: 'exportacao', projeto: 'canal', sub: 'prontidao' },
    })
    expect(resolver('#/projeto/canal/exportacao/lotes', comCanal)).toEqual({
      redirecionar: '#/projeto/canal/exportacao?sub=lotes',
    })
    expect(resolver('#/projeto/canal/exportacao?sub=lotes', comCanal)).toEqual({
      rota: { tela: 'exportacao', projeto: 'canal', sub: 'lotes' },
    })
    expect(resolver('#/projeto/canal/exportacao/lotes', semProjeto)).toEqual({
      redirecionar: '#/inicio',
    })
  })

  it('guarda as abas do Corte para Corte direto e avulso-*', () => {
    const ctxDireto: Contexto = { projetoAberto: 'canal', corteTipo: () => 'direto' }
    const ctxTransf: Contexto = { projetoAberto: 'canal', corteTipo: () => 'transformado' }

    expect(resolver('#/projeto/canal/corte/12/transformar', ctxDireto)).toEqual({
      redirecionar: '#/projeto/canal/corte/12/editar',
      aviso: 'Transformar está disponível apenas para Vídeo transformado',
    })
    expect(resolver('#/projeto/canal/corte/12/transformar', ctxTransf)).toEqual({
      rota: { tela: 'corte', projeto: 'canal', corte: '12', aba: 'transformar' },
    })
    expect(resolver('#/projeto/canal/corte/avulso-3-10-20/empacotar', comCanal)).toEqual({
      redirecionar: '#/projeto/canal/corte/avulso-3-10-20/editar',
    })
    expect(resolver('#/projeto/canal/corte/12/empacotar?run=r1', ctxDireto)).toEqual({
      rota: { tela: 'corte', projeto: 'canal', corte: '12', aba: 'empacotar', run: 'r1' },
    })
  })

  it('guarda #/config/projeto sem Projeto aberto mas mantém #/config/custos acessível', () => {
    const res = resolver('#/config/projeto', semProjeto)
    expect(res).toEqual({
      redirecionar: '#/config/provedores',
      aviso: 'Abra um Projeto para editar estas configurações.',
    })

    expect(resolver('#/config/projeto', comCanal)).toEqual({
      rota: { tela: 'config', secao: 'projeto' },
    })
    expect(resolver('#/config/custos', semProjeto)).toEqual({
      rota: { tela: 'config', secao: 'custos' },
    })
    expect(resolver('#/config/invalida', semProjeto)).toEqual({
      redirecionar: '#/config/provedores',
    })
  })

  it('resolve #/relatos e #/sobre', () => {
    expect(resolver('#/relatos', semProjeto)).toEqual({ rota: { tela: 'relatos' } })
    expect(resolver('#/sobre', semProjeto)).toEqual({ rota: { tela: 'sobre' } })
  })

  it('propriedade: nenhum redirecionamento aponta para um hash que redireciona de novo', () => {
    const hashes = [
      '',
      '#',
      '#/',
      '#/xyz',
      '#/inicio',
      '#/assistente',
      '#/assistente?passo=2',
      '#/assistente?passo=1&retorno=config',
      '#/assistente?passo=2&retorno=config',
      '#/projeto',
      '#/projeto/canal',
      '#/projeto/canal/desconhecido',
      '#/projeto/canal/fontes',
      '#/projeto/canal/fontes?sub=lotes',
      '#/projeto/canal/fontes/f1',
      '#/projeto/canal/cortes',
      '#/projeto/canal/cortes/revisao',
      '#/projeto/canal/cortes/revisao/r1',
      '#/projeto/canal/corte/12',
      '#/projeto/canal/corte/12/editar',
      '#/projeto/canal/corte/12/transformar',
      '#/projeto/canal/corte/12/transformar?run=r1',
      '#/projeto/canal/corte/12/empacotar',
      '#/projeto/canal/corte/avulso-3-10-20/transformar',
      '#/projeto/canal/corte/avulso-3-10-20/empacotar',
      '#/projeto/canal/exportacao',
      '#/projeto/canal/exportacao/lotes',
      '#/projeto/outro/cortes',
      '#/config',
      '#/config/projeto',
      '#/config/custos',
      '#/config/provedores',
      '#/config/inexistente',
      '#/relatos',
      '#/sobre',
    ]

    const contextos: Contexto[] = [
      { projetoAberto: null },
      { projetoAberto: 'canal' },
      { projetoAberto: 'outro' },
      { projetoAberto: 'canal', corteTipo: () => 'direto' },
      { projetoAberto: 'canal', corteTipo: () => 'transformado' },
      { projetoAberto: 'canal', corteTipo: () => 'avulso' },
    ]

    for (const ctx of contextos) {
      for (const h of hashes) {
        const res = resolver(h, ctx)
        if ('redirecionar' in res) {
          const segundo = resolver(res.redirecionar, ctx)
          expect('rota' in segundo, `Loop detectado: ${h} -> ${res.redirecionar}`).toBe(true)
        }
      }
    }
  })
})

describe('useRota', () => {
  afterEach(() => {
    window.location.hash = ''
  })

  it('aplica redirecionamento com location.replace e devolve a rota destino', () => {
    window.location.hash = '#/projeto/canal/cortes'
    const { result } = renderHook(() => useRota({ projetoAberto: null }))
    expect(result.current).toEqual({ tela: 'inicio' })
    expect(window.location.hash).toBe('#/inicio')
  })

  it('reage a hashchange', () => {
    window.location.hash = '#/inicio'
    const { result } = renderHook(() => useRota({ projetoAberto: 'canal' }))
    expect(result.current).toEqual({ tela: 'inicio' })

    act(() => {
      window.location.hash = '#/projeto/canal/fontes?sub=lotes'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    expect(result.current).toEqual({ tela: 'fontes', projeto: 'canal', sub: 'lotes' })
  })
})
