import { BannerErroCore, Botao, Campo, Dialogo, Entrada } from '@ds'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { SeletorCaminho } from '~/componentes/SeletorCaminho'
import { chamar, ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'
import { notificarMudancaProjeto } from '~/shell/Shell'

export type ProjetoCriado = {
  id?: string | null
  name: string
  path: string
}

export type DialogoNovoProjetoProps = {
  aberto: boolean
  aoMudarAberto: (aberto: boolean) => void
  aoCriar?: (projeto: ProjetoCriado) => void
}

function validarNomeProjeto(nome: string): string | undefined {
  const limpo = nome.trim()
  if (!limpo || limpo === '.' || limpo === '..' || /[\\/:]/.test(limpo)) {
    return 'Escolha um nome válido (sem barras ou dois-pontos).'
  }
  return undefined
}

function montarPrevia(pasta: string, nome: string): string {
  const p = pasta.trim()
  const n = nome.trim()
  if (!p || !n) return ''
  const sep = p.includes('\\') && !p.includes('/') ? '\\' : '/'
  const base = p.replace(/[\\/]+$/, '') || sep
  return base === sep ? `${sep}${n}.clipes` : `${base}${sep}${n}.clipes`
}

/** Modal de criação de Projeto portátil `.clipes` com prévia de caminho e validação inline. */
export function DialogoNovoProjeto({ aberto, aoMudarAberto, aoCriar }: DialogoNovoProjetoProps) {
  const [nome, setNome] = useState('')
  const [pasta, setPasta] = useState('')
  const [erroNome, setErroNome] = useState<string | undefined>()
  const [erroPasta, setErroPasta] = useState<string | undefined>()
  const [erroGeral, setErroGeral] = useState<ErroCore | null>(null)
  const [criando, setCriando] = useState(false)

  const nomeRef = useRef<HTMLInputElement>(null)
  const pastaRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!aberto) {
      setErroNome(undefined)
      setErroPasta(undefined)
      setErroGeral(null)
      return
    }
    const id = queueMicrotask(() => {
      nomeRef.current?.focus()
    })
    void id
  }, [aberto])

  const previa = montarPrevia(pasta, nome)

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault()
    if (criando) return

    const errNome = validarNomeProjeto(nome)
    const errPasta = pasta.trim() ? undefined : 'Informe a pasta onde salvar o Projeto.'
    setErroNome(errNome)
    setErroPasta(errPasta)
    setErroGeral(null)

    if (errNome) {
      nomeRef.current?.focus()
      return
    }
    if (errPasta) {
      pastaRef.current?.focus()
      return
    }

    setCriando(true)
    try {
      const criado = await chamar<ProjetoCriado>('projects.create', {
        name: nome.trim(),
        parent: pasta.trim(),
      })
      notificarMudancaProjeto(criado)
      aoMudarAberto(false)
      setNome('')
      setPasta('')
      if (aoCriar) {
        aoCriar(criado)
      } else {
        const id = criado.id || criado.name
        window.location.hash = `#/projeto/${encodeURIComponent(id)}/fontes`
      }
    } catch (erro) {
      const coreErr = erro instanceof ErroCore ? erro : new ErroCore('desconhecido', String(erro))
      if (coreErr.code === 'invalid_project') {
        setErroNome('Escolha um nome válido (sem barras ou dois-pontos) e uma pasta válida.')
        nomeRef.current?.focus()
      } else {
        setErroGeral(coreErr)
      }
    } finally {
      setCriando(false)
    }
  }

  return (
    <Dialogo
      aberto={aberto}
      aoMudarAberto={(v) => {
        if (!criando) aoMudarAberto(v)
      }}
      titulo="Novo Projeto"
      descricao="Cada Projeto guarda suas Fontes, Cortes e Perfil de canal numa pasta .clipes portátil."
      largura={500}
      rodape={
        <>
          <Botao variante="fantasma" disabled={criando} onClick={() => aoMudarAberto(false)}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="form-novo-projeto" carregando={criando}>
            Criar Projeto
          </Botao>
        </>
      }
    >
      <form id="form-novo-projeto" onSubmit={(e) => void aoSubmeter(e)} className="flex flex-col gap-3">
        {erroGeral && (
          <BannerErroCore
            erro={{ code: erroGeral.code, message: erroGeral.detalhe || erroGeral.message }}
            traduzir={(code) => {
              if (code === 'project_create') {
                return {
                  titulo:
                    'Não foi possível criar a pasta do Projeto. Verifique permissões e espaço em disco.',
                }
              }
              return mensagemDeErro(erroGeral)
            }}
            permitirRelato
          />
        )}

        <Campo rotulo="Nome do Projeto" erro={erroNome}>
          {(propsAria) => (
            <Entrada
              ref={nomeRef}
              autoFocus
              {...propsAria}
              value={nome}
              onChange={(e) => {
                setNome(e.target.value)
                if (erroNome) setErroNome(undefined)
              }}
              placeholder="Ex.: Canal de Cortes"
              disabled={criando}
            />
          )}
        </Campo>

        <SeletorCaminho
          rotulo="Pasta onde salvar"
          valor={pasta}
          aoMudar={(v) => {
            setPasta(v)
            if (erroPasta) setErroPasta(undefined)
          }}
          erro={erroPasta}
          placeholder="C:\Videos ou /tmp/clipes"
          ajuda={
            previa ? (
              <span className="font-mono">Será criado em: {previa}</span>
            ) : (
              'A pasta .clipes será criada dentro deste diretório.'
            )
          }
          desabilitado={criando}
          inputRef={pastaRef}
        />
      </form>
    </Dialogo>
  )
}
