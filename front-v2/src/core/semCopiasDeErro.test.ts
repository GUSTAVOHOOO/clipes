import { describe, expect, it } from 'vitest'

const fontes = import.meta.glob<string>(
  [
    '../**/*.{ts,tsx}',
    '!../**/*.test.{ts,tsx}',
    '!../**/*.spec.{ts,tsx}',
    '!../core/cliente.ts',
  ],
  { query: '?raw', import: 'default', eager: true },
)

describe('guarda: normalização central de erros', () => {
  it('não permite function normalizarErro nem new ErroCore("desconhecido", String(...)) fora de core/cliente.ts', () => {
    const entradas = Object.entries(fontes)
    expect(entradas.length).toBeGreaterThan(20)

    const violacoes: string[] = []
    const padroes = [
      { nome: 'function normalizarErro', regex: /\bfunction\s+normalizarErro\b/ },
      {
        nome: "new ErroCore('desconhecido', String(",
        regex: /\bnew\s+ErroCore\(\s*['"]desconhecido['"]\s*,\s*String\(/,
      },
    ]

    for (const [caminho, conteudo] of entradas) {
      for (const padrao of padroes) {
        if (padrao.regex.test(conteudo)) {
          violacoes.push(`${caminho}: ${padrao.nome}`)
        }
      }
    }

    expect(violacoes).toEqual([])
  })
})
