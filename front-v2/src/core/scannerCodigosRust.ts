/**
 * Extrai todos os códigos `CoreError.code` emitidos em código de produção Rust
 * (`core/src/**` e `src-tauri/src/**`), ignorando módulos `#[cfg(test)]` e arquivos de teste.
 */

export function removerBlocosCfgTest(conteudo: string): string {
  const linhas = conteudo.split(/\r?\n/)
  const saida: string[] = []
  let pulando = false
  let profundidade = 0
  let viuCfgTest = false

  for (const linha of linhas) {
    if (!pulando) {
      if (/^\s*#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/.test(linha)) {
        viuCfgTest = true
        saida.push('')
        continue
      }
      if (viuCfgTest) {
        if (/^\s*#\s*\[/.test(linha)) {
          saida.push('')
          continue
        }
        if (linha.includes('mod tests') || linha.includes('{')) {
          pulando = true
          profundidade = 0
          for (const ch of linha) {
            if (ch === '{') profundidade++
            else if (ch === '}') profundidade--
          }
          if (profundidade <= 0 && linha.includes('}')) pulando = false
          viuCfgTest = false
          saida.push('')
          continue
        }
        viuCfgTest = false
      }
      saida.push(linha)
    } else {
      for (const ch of linha) {
        if (ch === '{') profundidade++
        else if (ch === '}') profundidade--
      }
      if (profundidade <= 0) pulando = false
      saida.push('')
    }
  }

  return saida.join('\n')
}

export function ehArquivoTesteRust(caminho: string): boolean {
  const norm = caminho.replace(/\\/g, '/')
  return (
    norm.includes('/tests/') ||
    norm.endsWith('/tests.rs') ||
    norm.endsWith('_test.rs')
  )
}

export function extrairCodigosDeArquivoRust(
  caminho: string,
  conteudoBruto: string,
): string[] {
  if (ehArquivoTesteRust(caminho)) return []

  const norm = caminho.replace(/\\/g, '/')
  const prod = removerBlocosCfgTest(conteudoBruto)
  const codigos = new Set<string>()

  const regexes = [
    /(?:CoreError|TaskError|ChapterWarning|Self)\s*\{\s*code:\s*"([a-z0-9_]+)"/gs,
    /\b(?:error|err|fixed|billed|warn|fail|TaskError::new|typed_error|error_with_usage)\(\s*"([a-z0-9_]+)"/gs,
    /\.http_failure(?:_with_reset)?\(\s*[^,]+,\s*"([a-z0-9_]+)"/gs,
  ]

  for (const re of regexes) {
    let m: RegExpExecArray | null
    while ((m = re.exec(prod)) !== null) {
      codigos.add(m[1])
    }
  }

  // Wrappers específicos com tuplas/matches de códigos em Rust:
  if (norm.endsWith('selection_windows.rs')) {
    for (const m of prod.matchAll(/PlanError::\w+[^=]*=>\s*\(\s*"([a-z0-9_]+)"/gs)) {
      codigos.add(m[1])
    }
  }
  if (norm.endsWith('jobs/ai.rs')) {
    for (const m of prod.matchAll(/return\s+Some\(\(\s*"([a-z0-9_]+)"/gs)) {
      codigos.add(m[1])
    }
  }
  if (norm.endsWith('jobs/budget.rs')) {
    for (const m of prod.matchAll(/return\s+Some\(\s*"([a-z0-9_]+)"\s*\)/gs)) {
      codigos.add(m[1])
    }
  }
  if (norm.endsWith('reframe.rs')) {
    for (const m of prod.matchAll(/if code == "worker_protocol"[\s\S]*?\)/gs)) {
      for (const sm of m[0].matchAll(/"([a-z0-9_]+)"/g)) {
        codigos.add(sm[1])
      }
    }
  }

  return [...codigos]
}

export function extrairCodigosRustDeMapa(
  fontes: Record<string, string>,
): Map<string, string[]> {
  const mapa = new Map<string, Set<string>>()

  for (const [caminho, conteudo] of Object.entries(fontes)) {
    const codigos = extrairCodigosDeArquivoRust(caminho, conteudo)
    for (const codigo of codigos) {
      if (!mapa.has(codigo)) mapa.set(codigo, new Set())
      mapa.get(codigo)!.add(caminho.replace(/\\/g, '/'))
    }
  }

  const ordenado = new Map<string, string[]>()
  for (const codigo of [...mapa.keys()].sort()) {
    ordenado.set(codigo, [...mapa.get(codigo)!].sort())
  }
  return ordenado
}
