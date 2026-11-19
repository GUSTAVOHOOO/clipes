// PROTOTYPE — console ao vivo. Código descartável: motor de eventos simulados, sem núcleo real.
import { useSyncExternalStore } from 'react'

export type Origem = 'componente' | 'uv' | 'ffmpeg' | 'yt-dlp' | 'worker' | 'ia'
export type Nivel = 'info' | 'aviso' | 'erro'
export type Linha = { seq: number; t: number; tarefa: string; origem: Origem; nivel: Nivel; simples: string; tecnico: string }
export type Tarefa = { id: string; nome: string; estado: 'rodando' | 'ok' | 'erro' | 'cancelada'; pct: number; etapa: string; inicio: number }
type Passo = [number, Origem, Nivel, string, string, number?]
type Estado = { linhas: Linha[]; tarefas: Tarefa[]; aberto: boolean }

let estado: Estado = { linhas: [], tarefas: [], aberto: false }
const ouvintes = new Set<() => void>()
const timers = new Map<string, number[]>()
let seq = 0
function set(p: Partial<Estado>) {
  estado = { ...estado, ...p }
  ouvintes.forEach((f) => f())
}

export function useConsole() {
  return useSyncExternalStore(
    (f) => {
      ouvintes.add(f)
      return () => ouvintes.delete(f)
    },
    () => estado,
  )
}
export const abrir = (aberto: boolean) => set({ aberto })
export const limpar = () => set({ linhas: [] })

export const SCRIPTS: Record<string, { nome: string; passos: Passo[] }> = {
  ffmpeg: {
    nome: 'Instalar FFmpeg',
    passos: [
      [200, 'componente', 'info', 'Procurando a versão certa do FFmpeg para o seu Windows…', 'GET catalogo/ffmpeg → 200 (versão 7.1, win64)', 5],
      [700, 'componente', 'info', 'Baixando FFmpeg (82 MB)…', 'download host=cdn.clipes.app bytes=0/86114304', 10],
      [900, 'componente', 'info', 'Baixando FFmpeg · 35%', 'download bytes=30139406/86114304 speed=24.1MB/s', 35],
      [900, 'componente', 'info', 'Baixando FFmpeg · 70%', 'download bytes=60280012/86114304 speed=23.8MB/s', 60],
      [900, 'componente', 'info', 'Baixando FFmpeg · 100%', 'download bytes=86114304/86114304', 80],
      [600, 'componente', 'info', 'Conferindo se o arquivo chegou inteiro e é o original…', 'sha256 ok (a91f…c03e) · assinatura minisign válida', 88],
      [700, 'componente', 'info', 'Descompactando em ~\\AppData\\Local\\Clipes\\ffmpeg', 'unzip ffmpeg.exe, ffprobe.exe → ~\\AppData\\Local\\Clipes\\ffmpeg', 95],
      [600, 'ffmpeg', 'info', 'FFmpeg respondeu: versão 7.1 com aceleração de GPU (NVENC).', 'ffmpeg -version → 7.1-essentials · encoders: h264_nvenc libx264', 100],
    ],
  },
  worker: {
    nome: 'Instalar o Worker de transcrição',
    passos: [
      [200, 'componente', 'info', 'Preparando o Python do Clipes (isolado, não mexe no seu Python)…', 'uv python install 3.12', 8],
      [900, 'uv', 'info', 'Baixando o Python gerenciado…', 'uv: Downloading cpython-3.12.7 (31.4MiB)', 20],
      [1100, 'uv', 'info', 'Resolvendo as dependências…', 'uv: Resolved 42 packages in 1.8s', 30],
      [800, 'uv', 'info', 'Baixando bibliotecas de GPU (CUDA). É a parte mais demorada.', 'uv: Downloading nvidia-cudnn-cu12 (664.8MiB)', 45],
      [1300, 'uv', 'info', 'Baixando bibliotecas de GPU (CUDA) · 60%', 'uv: Downloading nvidia-cublas-cu12 (410.6MiB)', 60],
      [1300, 'uv', 'aviso', 'A conexão oscilou; tentando de novo (1 de 3)…', 'uv: warning: Retrying download (attempt 1/3) host=files.pythonhosted.org', 62],
      [1100, 'uv', 'info', 'Instalando 42 pacotes…', 'uv: Installed 42 packages in 4.2s', 85],
      [900, 'worker', 'info', 'Testando o Worker: carregou o modelo e respondeu em 0,4 s.', 'handshake ok · faster-whisper 1.1.0 · device=cuda compute=float16', 100],
    ],
  },
  modelo: {
    nome: 'Baixar modelo de transcrição',
    passos: [
      [200, 'componente', 'info', 'Baixando o modelo Whisper large-v3 (3 GB). Fica guardado no seu PC.', 'download host=huggingface.co bytes=0/3087007744', 4],
      [1200, 'componente', 'info', 'Baixando modelo · 25%', 'download bytes=771751936/3087007744 speed=48.2MB/s', 25],
      [1200, 'componente', 'info', 'Baixando modelo · 50%', 'download bytes=1543503872/3087007744 speed=51.0MB/s', 50],
      [1200, 'componente', 'info', 'Baixando modelo · 75%', 'download bytes=2315255808/3087007744 speed=49.7MB/s', 75],
      [900, 'componente', 'info', 'Conferindo o arquivo…', 'sha256 ok (7be2…19d4)', 95],
      [500, 'componente', 'info', 'Modelo pronto para usar.', 'model_registered large-v3 path=~\\AppData\\Local\\Clipes\\models', 100],
    ],
  },
  ia: {
    nome: 'Seleção de Cortes (IA)',
    passos: [
      [200, 'ia', 'info', 'Iniciando a Seleção de Cortes com o Perfil “Principal” (modelo gemini-3-pro).', 'task=selection profile=principal model=gemini-3-pro windows=8', 3],
      [900, 'ia', 'info', 'Enviando a janela 1 de 8 para o Provedor…', 'POST /v1/generate window=1/8 tokens_in=11840 Authorization: Bearer ‹oculto›', 12],
      [1200, 'ia', 'info', 'Janela 1 de 8 respondeu: 3 candidatos de Corte.', 'response ok window=1/8 tokens_out=612 dur=1.1s', 20],
      [1000, 'ia', 'info', 'Enviando a janela 2 de 8…', 'POST /v1/generate window=2/8 tokens_in=12011', 28],
      [1300, 'ia', 'aviso', 'A resposta da janela 2 veio fora do formato. Pedindo para o Provedor corrigir (reparo 1 de 2).', 'schema_invalid window=2/8 → repair attempt=1/2', 32],
      [1200, 'ia', 'info', 'Janela 2 de 8 corrigida: 2 candidatos.', 'repair ok window=2/8 tokens_out=498', 40],
      [1100, 'ia', 'info', 'Janelas 3 e 4 de 8 respondidas.', 'window=3/8 ok · window=4/8 ok', 60],
      [1100, 'ia', 'info', 'Janelas 5 a 8 de 8 respondidas.', 'window=5..8/8 ok', 85],
      [800, 'ia', 'info', 'Ranqueando 21 candidatos e aplicando as regras de qualidade…', 'rank candidates=21 guardrails=pass', 95],
      [600, 'ia', 'info', 'Pronto: 12 Cortes sugeridos. Custo desta Seleção: US$ 0,18 (12.340 tokens).', 'done cost=0.18 tokens=12340 dur=11.8s', 100],
    ],
  },
  export: {
    nome: 'Exportar Corte 3 (9:16)',
    passos: [
      [200, 'ffmpeg', 'info', 'Escolhendo o codificador: placa de vídeo NVIDIA (rápido).', 'encoder=h264_nvenc preset=p5 1080x1920@30', 5],
      [800, 'ffmpeg', 'info', 'Exportando · 15% · 2,4x mais rápido que o vídeo', 'frame=105 fps=72 speed=2.4x out_time=00:00:03.5', 15],
      [700, 'ffmpeg', 'info', 'Exportando · 38%', 'frame=285 fps=74 speed=2.5x out_time=00:00:09.5', 38],
      [700, 'ffmpeg', 'info', 'Exportando · 61% · aplicando legenda', 'frame=461 fps=73 speed=2.4x out_time=00:00:15.3', 61],
      [700, 'ffmpeg', 'info', 'Exportando · 88%', 'frame=662 fps=75 speed=2.5x out_time=00:00:22.0', 88],
      [600, 'ffmpeg', 'info', 'Ajustando o volume para o padrão de redes sociais (-14 LUFS).', 'loudnorm measured_I=-17.2 target_I=-14.0', 96],
      [500, 'ffmpeg', 'info', 'Pronto: ~\\Videos\\Clipes\\Corte-03.mp4 (24 s, 18 MB).', 'done out=~\\Videos\\Clipes\\Corte-03.mp4 bytes=18874368', 100],
    ],
  },
}

function empurrar(id: string, nome: string, p: Passo) {
  const l: Linha = { seq: ++seq, t: Date.now(), tarefa: nome, origem: p[1], nivel: p[2], simples: p[3], tecnico: p[4] }
  const linhas = [...estado.linhas, l].slice(-500)
  const tarefas = estado.tarefas.map((x) => (x.id === id ? { ...x, pct: p[5] ?? x.pct, etapa: p[3] } : x))
  set({ linhas, tarefas })
}

export function iniciar(chave: string) {
  const s = SCRIPTS[chave]
  if (!s) return
  const id = `${chave}-${++seq}`
  set({
    aberto: true,
    tarefas: [{ id, nome: s.nome, estado: 'rodando' as const, pct: 0, etapa: 'Começando…', inicio: Date.now() }, ...estado.tarefas].slice(0, 6),
  })
  let acc = 0
  const ts: number[] = []
  s.passos.forEach((p, i) => {
    acc += p[0]
    ts.push(
      window.setTimeout(() => {
        empurrar(id, s.nome, p)
        if (i === s.passos.length - 1) {
          set({ tarefas: estado.tarefas.map((x) => (x.id === id ? { ...x, estado: 'ok', pct: 100 } : x)) })
        }
      }, acc),
    )
  })
  timers.set(id, ts)
}

export function cancelar(id: string) {
  timers.get(id)?.forEach(clearTimeout)
  const t = estado.tarefas.find((x) => x.id === id)
  if (t) empurrar(id, t.nome, [0, 'componente', 'aviso', 'Você cancelou. Nada foi alterado no seu Projeto.', 'cancel requested by user → job aborted'])
  set({ tarefas: estado.tarefas.map((x) => (x.id === id ? { ...x, estado: 'cancelada' } : x)) })
}

export const hhmmss = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour12: false })
export const ROTULO: Record<Origem, string> = { componente: 'Componentes', uv: 'uv', ffmpeg: 'FFmpeg', 'yt-dlp': 'yt-dlp', worker: 'Worker', ia: 'IA' }
