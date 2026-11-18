import { beforeEach, describe, expect, it, vi } from 'vitest'
import { coreDispatch } from '@core'
import { chamar, ErroCore } from '~/core/cliente'

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
