// Variante E: legenda karaokê desenhada sobre o preview, no estilo do preset (copiada da A).
import type { CSSProperties } from 'react'
import { presets, type Palavra } from '../../dados'

export type Preset = (typeof presets)[number]
export type EstiloLegenda = { preset: Preset; pos: number; escala: number; porVez: number }

const pesoDe = (p: Preset) => (p.id === 'limpo' ? 600 : p.id === 'caixa' ? 700 : 800)
const familia = (p: Preset) => (p.fonte === 'Geist' ? '"Geist Variable", system-ui, sans-serif' : '"Inter Variable", system-ui, sans-serif')

/** Uma linha de palavras: a ativa leva a cor de destaque (ou, sem destaque, as outras ficam mais apagadas). */
/** `unidade` 'cqw': a legenda escala com a largura do preview só pelo CSS (o preview declara container-type). */
export function LinhaLegenda({ palavras, ativa, preset, tamanho, unidade = 'px' }: { palavras: { id: string; t: string }[]; ativa?: string; preset: Preset; tamanho: number; unidade?: 'px' | 'cqw' }) {
  const semDestaque = preset.destaque === preset.cor
  const caixa = preset.id === 'caixa'
  const contorno = preset.contorno ? (preset.contorno * tamanho) / 60 : 0
  const base: CSSProperties = {
    fontFamily: familia(preset), fontWeight: pesoDe(preset), fontSize: `${tamanho}${unidade}`, lineHeight: 1.15,
    letterSpacing: preset.id === 'impacto' ? '0.01em' : '-0.01em',
    textTransform: preset.id === 'impacto' ? 'uppercase' : undefined,
    WebkitTextStroke: contorno ? `${contorno}${unidade} #000` : undefined,
    paintOrder: 'stroke fill',
    textShadow: preset.id === 'limpo' ? '0 1px 8px rgba(0,0,0,.6)' : undefined,
  }
  return (
    <span className={`inline-flex flex-wrap justify-center gap-x-[0.28em] ${caixa ? 'bg-[#F5F5F4] rounded-[0.18em] px-[0.35em] py-[0.12em]' : ''}`} style={base}>
      {palavras.map(w => {
        const on = w.id === ativa
        return (
          <span key={w.id} style={{
            color: on ? preset.destaque : preset.cor,
            opacity: semDestaque && ativa && !on ? 0.5 : 1,
            transform: on && !semDestaque ? 'scale(1.06)' : undefined, display: 'inline-block',
          }}>{w.t}</span>
        )
      })}
    </span>
  )
}

/** Recorta a Frase atual em grupos de N palavras e mostra o grupo da palavra ativa. */
export function grupoAtual(palavras: Palavra[], fraseId: string | undefined, ativaId: string | undefined, porVez: number) {
  if (!fraseId) return []
  const da = palavras.filter(w => w.f === fraseId)
  const i = Math.max(0, da.findIndex(w => w.id === ativaId))
  const g = Math.floor(i / porVez)
  return da.slice(g * porVez, g * porVez + porVez)
}
