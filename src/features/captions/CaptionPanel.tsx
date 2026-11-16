import { useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { correctionEvent } from '@/features/projects/TranscriptTimeline';
import { previewSeekEvent } from '@/features/projects/CutPreview';
import type { CaptionData, CaptionStyle, WordOverride } from './types';

export const captionTexts = {
  'pt-BR': { title: 'Legenda', loading: 'Carregando legenda…', error: 'Não foi possível salvar a legenda. Reabra a gaveta e tente de novo.', loadError: 'Não foi possível carregar a legenda.', saved: 'Salvo', saving: 'Salvando…', defaultSaved: 'Padrão salvo', preset: 'Preset', vertical: 'Vertical', cinema: 'Cinema', simple: 'Simples · sem destaque', font: 'Fonte', fontSize: 'Tamanho da fonte', color: 'Cor normal', activeColor: 'Cor ativa', dimColor: 'Cor esmaecida', outlineColor: 'Cor do contorno', outline: 'Contorno', shadow: 'Sombra', x: 'Posição horizontal', y: 'Posição vertical', highlight: 'Destaque karaokê', default: 'Usar como padrão', words: 'Palavras da legenda', text: 'Texto da palavra', saveText: 'Salvar palavra', wordHidden: 'Ocultar na legenda', wordHighlight: 'Destacar esta palavra', wordColor: 'Cor desta palavra', wordActive: 'Cor ativa desta palavra', resetWord: 'Remover estilo desta palavra', emoji: 'Emoji colorido não aparece no libass e será removido do preview e do export.', discarded: 'Estilos de palavras descartados após nova Transcrição: ', hint: 'Escolha uma palavra para corrigir o texto, ocultar ou mudar seu destaque. Trocar o preset mantém as edições por palavra.', style: 'Estilo do Corte', word: 'Palavra selecionada', retry: 'Tentar de novo' },
  en: { title: 'Captions', loading: 'Loading captions…', error: 'Could not save captions. Reopen the drawer and try again.', loadError: 'Could not load captions.', saved: 'Saved', saving: 'Saving…', defaultSaved: 'Default saved', preset: 'Preset', vertical: 'Vertical', cinema: 'Cinema', simple: 'Simple · no highlight', font: 'Font', fontSize: 'Font size', color: 'Normal color', activeColor: 'Active color', dimColor: 'Dim color', outlineColor: 'Outline color', outline: 'Outline', shadow: 'Shadow', x: 'Horizontal position', y: 'Vertical position', highlight: 'Karaoke highlight', default: 'Use as default', words: 'Caption words', text: 'Word text', saveText: 'Save word', wordHidden: 'Hide in captions', wordHighlight: 'Highlight this word', wordColor: 'This word’s color', wordActive: 'This word’s active color', resetWord: 'Remove this word’s style', emoji: 'Color emoji cannot appear in libass and will be removed from preview and export.', discarded: 'Word styles discarded after retranscription: ', hint: 'Choose a word to correct its text, hide it, or change its highlight. Switching presets keeps word edits.', style: 'Clip style', word: 'Selected word', retry: 'Try again' },
};
const field = 'foco h-8 w-full rounded-md border border-line-strong bg-field px-2 text-fg disabled:opacity-50';
const hasEmoji = (text: string) => /[\u200d\ufe0e\ufe0f\u20e3\u00a9\u00ae\u2300-\u23ff\u2600-\u27ff\u{1f000}-\u{1faff}\u{e0020}-\u{e007f}]/u.test(text);

export function CaptionPanel({ data, clipId, sourceId, refresh, loadError }: { data: CaptionData | null; clipId: number; sourceId: number; refresh: () => Promise<void>; loadError: boolean }) {
  const t = useText(captionTexts);
  const [draft, setDraft] = useState<CaptionStyle | null>(data?.style ?? null);
  const [position, setPosition] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [discarded, setDiscarded] = useState(0);
  const word = data?.words.find(w => w.position === position);
  useEffect(() => { setDraft(data?.style ?? null); }, [data]);
  useEffect(() => { setText(word?.text.trim() ?? ''); }, [word?.position, word?.text]);
  useEffect(() => { void coreDispatch<{ discarded: number }>('captions.remap_status', { source_id: sourceId }).then(v => setDiscarded(v.discarded)).catch(() => {}); }, [sourceId]);
  const save = async (action: () => Promise<unknown>, isDefault = false) => {
    setBusy(true); setError(false); setStatus(t.saving);
    try { await action(); await refresh(); setStatus(isDefault ? t.defaultSaved : t.saved); }
    catch { setError(true); setStatus(''); }
    finally { setBusy(false); }
  };
  const changeStyle = (key: keyof CaptionStyle, value: string | number | boolean) => setDraft(s => s && ({ ...s, [key]: value }));
  const commitStyle = () => { if (draft && JSON.stringify(draft) !== JSON.stringify(data?.style)) void save(() => coreDispatch('captions.style.set', { clip_id: clipId, style: draft })); };
  const override = (patch: WordOverride) => {
    if (!word || !data) return;
    const next: WordOverride = { ...word.overrides, ...patch };
    if (!next.hidden) delete next.hidden;
    void save(() => coreDispatch('captions.override', { transcript_id: data.transcriptId, position: word.position, overrides: next }));
  };
  const correct = () => { if (word && text.trim() !== word.text.trim()) void save(async () => {
    const changed = await coreDispatch('transcription.correct', { source_id: sourceId, position: word.position, text });
    window.dispatchEvent(new CustomEvent(correctionEvent, { detail: changed }));
  }); };
  if (!data || !draft) return <div className="p-3 text-sm"><p role={loadError ? 'alert' : 'status'}>{loadError ? t.loadError : t.loading}</p>{loadError && <Button tamanho="sm" onClick={() => void refresh().catch(() => {})}>{t.retry}</Button>}</div>;
  return <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-3 text-sm">
    <fieldset disabled={busy} className="flex flex-col gap-3"><legend className="mb-2 font-semibold">{t.style}</legend>
      <label className="flex flex-col gap-1">{t.preset}<select className={field} value={draft.preset} onChange={e => void save(() => coreDispatch('captions.style.preset', { clip_id: clipId, preset: e.target.value, revision: data.style.revision }))}><option value="vertical">{t.vertical}</option><option value="cinema">{t.cinema}</option><option value="simple">{t.simple}</option></select></label>
      <label className="flex flex-col gap-1">{t.font}<select className={field} value={draft.font} onChange={e => void save(() => coreDispatch('captions.style.set', { clip_id: clipId, style: { ...draft, font: e.target.value } }))}><option>Noto Sans</option><option>Noto Serif</option></select></label>
      <div className="grid grid-cols-2 gap-2">{(['fontSize', 'outline', 'shadow', 'x', 'y'] as const).map(key => <label key={key} className="flex flex-col gap-1">{t[key]}<input className={field} type="number" min={key === 'fontSize' ? 24 : key === 'x' ? 80 : key === 'y' ? 192 : 0} max={key === 'fontSize' ? 96 : key === 'x' ? 1000 : key === 'y' ? 1600 : 10} step="1" value={draft[key]} onChange={e => changeStyle(key, Number(e.target.value))} onBlur={commitStyle} /></label>)}</div>
      <div className="grid grid-cols-2 gap-2">{(['color', 'activeColor', 'dimColor', 'outlineColor'] as const).map(key => <label key={key} className="flex flex-col gap-1">{t[key]}<input aria-label={t[key]} className={`${field} p-1`} type="color" value={draft[key]} onChange={e => changeStyle(key, e.target.value)} onBlur={commitStyle} /></label>)}</div>
      <label className="flex items-center gap-2"><input type="checkbox" className="foco" checked={draft.highlight} onChange={e => void save(() => coreDispatch('captions.style.set', { clip_id: clipId, style: { ...draft, highlight: e.target.checked } }))} />{t.highlight}</label>
      <Button tamanho="sm" onClick={() => void save(() => coreDispatch('captions.style.default', { clip_id: clipId }), true)}>{t.default}</Button>
    </fieldset>
    <section aria-label={t.words} className="flex flex-col gap-2"><h4 className="font-semibold">{t.words}</h4><p className="text-xs text-fg-2">{t.hint}</p>
      <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">{data.words.map(w => <button type="button" key={w.position} aria-pressed={w.position === position} className={`foco rounded-md border px-2 py-1 ${w.position === position ? 'border-accent-line bg-accent-subtle' : 'border-line bg-field'} ${w.overrides.hidden ? 'line-through opacity-50' : ''}`} onClick={() => { setPosition(w.position); window.dispatchEvent(new CustomEvent(previewSeekEvent, { detail: { source_id: sourceId, us: data.start_us + w.startUs } })); }}>{w.text.trim()}</button>)}</div>
    </section>
    {word && <fieldset disabled={busy} className="flex flex-col gap-2"><legend className="mb-2 font-semibold">{t.word}</legend>
      <form onSubmit={e => { e.preventDefault(); correct(); }} className="flex flex-col gap-2"><label className="flex flex-col gap-1">{t.text}<input className={field} maxLength={200} value={text} onChange={e => setText(e.target.value)} /></label><Button tamanho="sm" type="submit">{t.saveText}</Button></form>
      <label className="flex items-center gap-2"><input type="checkbox" className="foco" checked={word.overrides.hidden ?? false} onChange={e => override({ hidden: e.target.checked })} />{t.wordHidden}</label>
      <label className="flex items-center gap-2"><input type="checkbox" className="foco" checked={word.overrides.highlight ?? true} onChange={e => override({ highlight: e.target.checked })} />{t.wordHighlight}</label>
      <label>{t.wordColor}<input aria-label={t.wordColor} className={`${field} p-1`} type="color" value={word.overrides.color ?? draft.color} onChange={e => override({ color: e.target.value })} /></label>
      <label>{t.wordActive}<input aria-label={t.wordActive} className={`${field} p-1`} type="color" value={word.overrides.activeColor ?? draft.activeColor} onChange={e => override({ activeColor: e.target.value })} /></label>
      <Button tamanho="sm" variante="fantasma" onClick={() => void save(() => coreDispatch('captions.override', { transcript_id: data.transcriptId, position: word.position, overrides: {} }))}>{t.resetWord}</Button>
    </fieldset>}
    {(data.emojiRemoved > 0 || hasEmoji(text)) && <p role="status" className="text-fg-2">{t.emoji}</p>}
    {discarded > 0 && <p role="status" className="text-fg-2">{t.discarded}{discarded}</p>}
    {error && <p role="alert" className="text-danger">{t.error}</p>}
    <p role="status" aria-live="polite" className="text-xs text-fg-2">{status}</p>
  </div>;
}
