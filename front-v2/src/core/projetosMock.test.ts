import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assinarProgressoMock,
  coreDispatch,
  emitirProgressoMock,
} from '@core'

type ProjetoRecente = { available: boolean; name: string; path: string }
type ProjetoAtual = { id: string; name: string; path: string; warning?: string | null }

describe('mock de projetos e barramento core-progress (src/lib/core.ts)', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_CORE_MOCK', '1')
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  afterEach(async () => {
    try {
      await coreDispatch('projects.close', {})
    } catch {
      // ignora se já estava fechado ou ocupado
    }
    vi.unstubAllEnvs()
    window.history.replaceState(null, '', '/')
    window.location.hash = ''
  })

  it('projects.recent retorna projetos disponíveis e indisponíveis por padrão e [] com ?estado=vazio', async () => {
    const padrao = await coreDispatch<ProjetoRecente[]>('projects.recent', {})
    expect(padrao.length).toBeGreaterThanOrEqual(2)
    expect(padrao.some((p) => p.available)).toBe(true)
    expect(padrao.some((p) => !p.available)).toBe(true)

    window.location.hash = '#/inicio?estado=vazio'
    const vazioHash = await coreDispatch<ProjetoRecente[]>('projects.recent', {})
    expect(vazioHash).toEqual([])

    window.location.hash = '#/inicio'
    window.history.replaceState(null, '', '/?estado=vazio')
    const vazioSearch = await coreDispatch<ProjetoRecente[]>('projects.recent', {})
    expect(vazioSearch).toEqual([])
  })

  it('projects.create rejeita nomes inválidos com invalid_project', async () => {
    for (const nomeInvalido of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b']) {
      await expect(
        coreDispatch('projects.create', { name: nomeInvalido, parent: '/tmp/clipes' }),
      ).rejects.toMatchObject({ code: 'invalid_project' })
    }

    await expect(
      coreDispatch('projects.create', { name: 'Valido', parent: '   ' }),
    ).rejects.toMatchObject({ code: 'invalid_project' })
  })

  it('projects.create válido cria, abre o projeto, atualiza projects.current e projects.local_only.get sem ?source-test=1', async () => {
    expect(await coreDispatch<ProjetoAtual | null>('projects.current', {})).toBeNull()
    expect(
      await coreDispatch<{ open: boolean; enabled: boolean }>('projects.local_only.get', {}),
    ).toEqual({ open: false, enabled: false })

    const criado = await coreDispatch<ProjetoAtual>('projects.create', {
      name: 'Canal Teste',
      parent: '/tmp/clipes',
    })

    expect(criado).toMatchObject({
      name: 'Canal Teste',
      path: '/tmp/clipes/Canal Teste.clipes',
    })
    expect(criado.id).toBeTruthy()

    const atual = await coreDispatch<ProjetoAtual | null>('projects.current', {})
    expect(atual).toMatchObject({
      id: criado.id,
      name: 'Canal Teste',
      path: '/tmp/clipes/Canal Teste.clipes',
    })

    expect(
      await coreDispatch<{ open: boolean; enabled: boolean }>('projects.local_only.get', {}),
    ).toEqual({ open: true, enabled: false })

    const recentes = await coreDispatch<ProjetoRecente[]>('projects.recent', {})
    expect(recentes[0]).toEqual({
      available: true,
      name: 'Canal Teste',
      path: '/tmp/clipes/Canal Teste.clipes',
    })
  })

  it('projects.open valida extensão .clipes, simula newer_project e abre projeto V1 existente', async () => {
    await expect(
      coreDispatch('projects.open', { path: '/tmp/sem-extensao' }),
    ).rejects.toMatchObject({ code: 'invalid_project' })

    await expect(
      coreDispatch('projects.open', { path: '/tmp/futuro.clipes' }),
    ).rejects.toMatchObject({ code: 'newer_project' })

    const v1 = await coreDispatch<ProjetoAtual>('projects.open', {
      path: 'C:\\V1\\CanalLegado.clipes',
    })
    expect(v1).toMatchObject({
      name: 'CanalLegado',
      path: 'C:\\V1\\CanalLegado.clipes',
    })

    const atual = await coreDispatch<ProjetoAtual | null>('projects.current', {})
    expect(atual?.path).toBe('C:\\V1\\CanalLegado.clipes')

    const recentes = await coreDispatch<ProjetoRecente[]>('projects.recent', {})
    expect(recentes[0]).toEqual({
      available: true,
      name: 'CanalLegado',
      path: 'C:\\V1\\CanalLegado.clipes',
    })
  })

  it('projects.close limpa projects.current e rejeita com project_busy quando há job ativo simulado', async () => {
    const aberto = await coreDispatch<ProjetoAtual>('projects.open', {
      path: '/tmp/FecharTeste.clipes',
    })

    emitirProgressoMock({
      job: '991',
      project: aberto.id,
      stage: 'transcribing',
      percentage: 35,
      message: 'Transcrevendo…',
      error: null,
    })

    await expect(coreDispatch('projects.close', {})).rejects.toMatchObject({
      code: 'project_busy',
    })

    emitirProgressoMock({
      job: '991',
      project: aberto.id,
      stage: 'complete',
      percentage: 100,
      message: 'Concluído',
      error: null,
    })

    const res = await coreDispatch<null>('projects.close', {})
    expect(res).toBeNull()
    expect(await coreDispatch<ProjetoAtual | null>('projects.current', {})).toBeNull()
    expect(
      await coreDispatch<{ open: boolean; enabled: boolean }>('projects.local_only.get', {}),
    ).toEqual({ open: false, enabled: false })
  })

  it('emitirProgressoMock e assinarProgressoMock entregam eventos e permitem cancelar assinatura', () => {
    const recebidos: unknown[] = []
    const cancelar = assinarProgressoMock((ev) => recebidos.push(ev))

    const evento = {
      job: 'ffmpeg',
      project: null,
      stage: 'download',
      percentage: 50,
      message: 'Baixando FFmpeg',
      error: null,
    }
    emitirProgressoMock(evento)
    expect(recebidos).toEqual([evento])

    cancelar()
    emitirProgressoMock({ ...evento, percentage: 100, stage: 'complete' })
    expect(recebidos).toHaveLength(1)
  })
})
