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
