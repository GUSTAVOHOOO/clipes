// Só o harness de navegador usa este módulo; o desktop sempre chama o núcleo.
type Mock = { job: number; state: string; progress: number; started: number; error: { code: string } | null };
let serial = 5900;
const jobs = new Map<number, Mock>();
// Encoder do #62: o mock imita o cache do núcleo (lista que passou no teste e troca manual).
const encoder = { detected: false, passed: ['h264_nvenc', 'libx264'], manual: null as string | null };
const encoderView = () => ({ ffmpeg: true, detected: encoder.detected, stale: false, passed: encoder.detected ? encoder.passed : [], selected: 'h264_nvenc', manual: encoder.manual, effective: encoder.detected ? encoder.manual ?? 'h264_nvenc' : 'libx264' });
export function exportMock(
  name: string,
  args: object,
  corrected?: (sourceId: number, position: number) => boolean,
): unknown {
  const a = args as { job?: number; id?: number; output?: string; source_id?: number; start_id?: number; end_id?: number };
  if (name === 'export.encoder.status') return encoderView();
  if (name === 'export.encoder.detect') { encoder.detected = true; return encoderView(); }
  if (name === 'export.encoder.set') { encoder.manual = (args as { encoder: string | null }).encoder; return encoderView(); }
  if (name === 'export.settings') return { last_directory: '/test/exports' };
  if (name === 'export.start') {
    if (!a.start_id || !a.end_id) throw { code: 'export_bounds' };
    if (new URLSearchParams(location.search).has('export-exists')) throw { code: 'export_exists' };
    if (new URLSearchParams(location.search).has('export-glyph-missing') && !corrected?.(a.source_id ?? 1, 10)) {
      throw {
        code: 'export_glyph_missing',
        message: 'A fonte da legenda (Noto Sans) não tem glifo para “来” (U+6765, Frase 1) em “来”. Corrija a palavra na Transcrição.',
        usage: {
          font: 'Noto Sans',
          missing_glyphs: [{ position: 10, sentence_id: 1, word: '来', char: '来', codepoint: 'U+6765', start_us: 90_000_000 }],
        },
      };
    }
    const job = ++serial;
    jobs.set(job, { job, state: 'running', progress: 35, started: Date.now(), error: null });
    return { job, state: 'queued' };
  }
  const item = jobs.get(a.job ?? a.id ?? -1);
  if (!item) throw { code: 'invalid_job' };
  if (name === 'jobs.cancel') item.state = 'cancelled';
  if (item.state === 'running' && Date.now() - item.started > 1500) { item.state = 'completed'; item.progress = 100; }
  if (item.state === 'completed' && new URLSearchParams(location.search).has('export-fallback')) return { ...item, encoder: 'libx264', encoder_fallback: { from: 'h264_nvenc', reason: 'encoder_failed' } };
  return item;
}
