import { beforeEach, describe, expect, it, vi } from 'vitest'
import { coreDispatch } from '@core'
import { chamar, ErroCore, paraErroCore } from '~/core/cliente'

vi.mock('@core', () => ({
  coreDispatch: vi.fn(),
}))

const mockDispatch = vi.mocked(coreDispatch)

describe('cliente do núcleo (chamar / ErroCore)', () => {
  beforeEach(() => {
    mockDispatch.mockReset()
  })

  it('repassa comando, argumentos e resposta tipada de coreDispatch', async () => {
    mockDispatch.mockResolvedValueOnce({ name: 'Canal de Cortes' })

    const resposta = await chamar<{ name: string }>('projects.current', { verbose: true })

    expect(mockDispatch).toHaveBeenCalledWith('projects.current', { verbose: true })
    expect(resposta).toEqual({ name: 'Canal de Cortes' })
  })

  it('usa objeto vazio como argumento padrão quando args é omitido', async () => {
    mockDispatch.mockResolvedValueOnce([])

    await chamar('projects.recent')

    expect(mockDispatch).toHaveBeenCalledWith('projects.recent', {})
  })

  it('normaliza objeto { code, message } em ErroCore preservando code e detalhe', async () => {
    mockDispatch.mockRejectedValueOnce({ code: 'project_busy', message: 'x' })

    let capturado: unknown
    try {
      await chamar('projects.open', { path: '/a.clipes' })
    } catch (erro) {
      capturado = erro
    }

    expect(capturado).toBeInstanceOf(Error)
    expect(capturado).toBeInstanceOf(ErroCore)
    expect((capturado as ErroCore).code).toBe('project_busy')
    expect((capturado as ErroCore).detalhe).toBe('x')
  })

  it('normaliza objeto { code } sem message com detalhe vazio', async () => {
    mockDispatch.mockRejectedValueOnce({ code: 'confirmation_required' })

    await expect(chamar('transcription.start', {})).rejects.toMatchObject({
      code: 'confirmation_required',
      detalhe: '',
    })
  })

  it.each([
    { entrada: 'boom', esperadoCode: 'desconhecido', esperadoDetalhe: 'boom' },
    { entrada: undefined, esperadoCode: 'desconhecido', esperadoDetalhe: '' },
    { entrada: null, esperadoCode: 'desconhecido', esperadoDetalhe: '' },
    { entrada: new Error('falha de rede'), esperadoCode: 'desconhecido', esperadoDetalhe: 'falha de rede' },
    { entrada: { message: 'sem código' }, esperadoCode: 'desconhecido', esperadoDetalhe: 'sem código' },
    { entrada: { code: '   ', message: 'código em branco' }, esperadoCode: 'desconhecido', esperadoDetalhe: 'código em branco' },
  ])('normaliza erro sem code válido ($entrada) para code desconhecido', async ({ entrada, esperadoCode, esperadoDetalhe }) => {
    mockDispatch.mockRejectedValueOnce(entrada)

    let capturado: unknown
    try {
      await chamar('qualquer.comando')
    } catch (erro) {
      capturado = erro
    }

    expect(capturado).toBeInstanceOf(ErroCore)
    expect((capturado as ErroCore).code).toBe(esperadoCode)
    expect((capturado as ErroCore).detalhe).toBe(esperadoDetalhe)
  })
})

describe('ErroCore.usage (confirmações com custo)', () => {
  beforeEach(() => {
    mockDispatch.mockReset()
  })

  it('preserva usage de objeto { code, message, usage } rejeitado pelo núcleo', async () => {
    const usage = { selectionPaid: true, audioEstimateMicroUsd: 250_000 }
    mockDispatch.mockRejectedValueOnce({ code: 'confirmation_required', message: 'm', usage })

    const erro = await chamar('batches.create', {}).catch((e: unknown) => e)

    expect(erro).toBeInstanceOf(ErroCore)
    expect((erro as ErroCore).code).toBe('confirmation_required')
    expect((erro as ErroCore).usage).toEqual(usage)
  })

  it('preserva usage de Error com propriedade usage', async () => {
    const usage = { estimate: { minMicroUsd: 1, maxMicroUsd: 2 } }
    mockDispatch.mockRejectedValueOnce(
      Object.assign(new Error('m'), { code: 'transcription_retry_confirmation', usage }),
    )

    const erro = await chamar('transcription.start', {}).catch((e: unknown) => e)

    expect((erro as ErroCore).usage).toEqual(usage)
  })

  it('deixa usage indefinido quando o núcleo não manda', async () => {
    mockDispatch.mockRejectedValueOnce({ code: 'project_busy', message: 'x' })

    const erro = await chamar('projects.open', {}).catch((e: unknown) => e)

    expect((erro as ErroCore).usage).toBeUndefined()
  })
})

describe('paraErroCore', () => {
  it('devolve a mesma instância quando já é ErroCore', () => {
    const original = new ErroCore('project_busy', 'ocupado', { tokens: 10 })
    expect(paraErroCore(original)).toBe(original)
  })

  it('normaliza string para ErroCore com code desconhecido e detalhe preservado', () => {
    const res = paraErroCore('falha direta')
    expect(res).toBeInstanceOf(ErroCore)
    expect(res.code).toBe('desconhecido')
    expect(res.detalhe).toBe('falha direta')
    expect(res.usage).toBeUndefined()
  })

  it('normaliza Error preservando code (com trim), message e usage', () => {
    const usage = { estimate: { minMicroUsd: 10, maxMicroUsd: 20 } }
    const err = Object.assign(new Error('precisa confirmar'), {
      code: '  confirmation_required  ',
      usage,
    })

    const res = paraErroCore(err)
    expect(res).toBeInstanceOf(ErroCore)
    expect(res.code).toBe('confirmation_required')
    expect(res.detalhe).toBe('precisa confirmar')
    expect(res.usage).toEqual(usage)
  })

  it('normaliza objeto { code, message, usage } preservando todos os campos', () => {
    const usage = { selectionPaid: true, audioEstimateMicroUsd: 250_000 }
    const res = paraErroCore({ code: 'confirmation_required', message: 'custo alto', usage })

    expect(res).toBeInstanceOf(ErroCore)
    expect(res.code).toBe('confirmation_required')
    expect(res.detalhe).toBe('custo alto')
    expect(res.usage).toEqual(usage)
  })

  it.each([null, undefined])('normaliza %s para code desconhecido com detalhe vazio', (entrada) => {
    const res = paraErroCore(entrada)
    expect(res).toBeInstanceOf(ErroCore)
    expect(res.code).toBe('desconhecido')
    expect(res.detalhe).toBe('')
  })

  it.each([
    { code: '', message: 'vazio' },
    { code: '   ', message: 'só espaços' },
    new Error('sem code'),
  ])('normaliza code vazio, só com espaços ou ausente para desconhecido ($code)', (entrada) => {
    const res = paraErroCore(entrada)
    expect(res).toBeInstanceOf(ErroCore)
    expect(res.code).toBe('desconhecido')
  })

  it('normaliza code com espaços ao redor aplicando trim', () => {
    const res = paraErroCore({ code: '  project_busy ', message: 'em uso' })
    expect(res.code).toBe('project_busy')
    expect(res.detalhe).toBe('em uso')
  })
})
