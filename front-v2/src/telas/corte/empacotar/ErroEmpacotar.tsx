import { BannerErroCore } from '@ds'
import { ErroCore } from '~/core/cliente'
import { mensagemDeErro } from '~/core/erros'

export type AcoesErroEmpacotar = {
  relocalizarFonte?: () => void
  reabrirSalvar?: () => void
  abrirFila?: () => void
  focarCampo?: () => void
  recarregar?: () => void
  irPara?: (hash: string) => void
}

/**
 * Banner `role="alert"` com mensagem humana (`mensagemDeErro`) e ação de recuperação específica
 * das sub-abas de Empacotar (reabrir o diálogo de salvar, relocalizar Fonte, abrir Componentes…).
 */
export function ErroEmpacotar({
  erro,
  acoes = {},
  aoDispensar,
}: {
  erro: ErroCore
  acoes?: AcoesErroEmpacotar
  aoDispensar?: () => void
}) {
  const traducao = mensagemDeErro(erro)
  const navegar = (hash: string) => {
    if (acoes.irPara) acoes.irPara(hash)
    else window.location.hash = hash
  }

  let acaoRecuperacao: { rotulo: string; aoAcionar: () => void } | undefined
  switch (erro.code) {
    case 'thumbnail_exists':
    case 'export_exists':
    case 'thumbnail_destination':
    case 'export_destination':
      if (acoes.reabrirSalvar) {
        acaoRecuperacao = {
          rotulo: erro.code.endsWith('exists') ? 'Escolher outro nome' : 'Escolher destino',
          aoAcionar: acoes.reabrirSalvar,
        }
      }
      break
    case 'source_offline':
    case 'source_changed':
    case 'source_mismatch':
      if (acoes.relocalizarFonte) {
        acaoRecuperacao = { rotulo: 'Relocalizar Fonte', aoAcionar: acoes.relocalizarFonte }
      }
      break
    case 'component_missing':
      acaoRecuperacao = {
        rotulo: 'Instalar em Componentes',
        aoAcionar: () => navegar('#/config/componentes'),
      }
      break
    case 'instant_out_of_cut':
    case 'no_instant':
    case 'language_required':
      if (acoes.focarCampo) {
        acaoRecuperacao = { rotulo: 'Ajustar agora', aoAcionar: acoes.focarCampo }
      }
      break
    case 'generation_in_progress':
    case 'suggestion_in_progress':
      if (acoes.abrirFila) {
        acaoRecuperacao = { rotulo: 'Abrir Fila de Jobs', aoAcionar: acoes.abrirFila }
      }
      break
    default:
      if (traducao.recuperacao?.rota) {
        const rota = traducao.recuperacao.rota
        acaoRecuperacao = { rotulo: traducao.recuperacao.rotulo, aoAcionar: () => navegar(rota) }
      } else if (traducao.recuperacao?.acao === 'relocalizar-fonte' && acoes.relocalizarFonte) {
        acaoRecuperacao = { rotulo: traducao.recuperacao.rotulo, aoAcionar: acoes.relocalizarFonte }
      } else if (traducao.recuperacao?.acao === 'recarregar' && acoes.recarregar) {
        acaoRecuperacao = { rotulo: traducao.recuperacao.rotulo, aoAcionar: acoes.recarregar }
      }
  }

  return (
    <BannerErroCore
      erro={{ code: erro.code, message: erro.detalhe || erro.message }}
      traduzir={(code) => ({ titulo: mensagemDeErro(new ErroCore(code, erro.detalhe)).titulo })}
      acaoRecuperacao={acaoRecuperacao}
      aoDispensar={aoDispensar}
      permitirRelato
    />
  )
}
