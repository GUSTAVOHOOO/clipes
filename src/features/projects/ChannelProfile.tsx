import { useCallback, useEffect, useState } from 'react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import type { CaptionStyle } from '@/features/captions/types';
import { VideoKindPicker, type VideoKind } from './videoKind';

export const CHANNEL_PROFILE_UPDATED_EVENT = 'clipes:channel-profile-updated';

export type AllowedSource = {
  label: string;
  url?: string | null;
  note?: string | null;
};

export type ChannelProfileData = {
  videoKind: VideoKind;
  language: string;
  minUs: number;
  maxUs: number;
  captionStyle: CaptionStyle;
  allowedSources: AllowedSource[];
  narrationVoice: string | null;
  limits: {
    defaultMinUs: number;
    defaultMaxUs: number;
    maxUs: number;
    technicalMaxUs: number;
  };
};

type LanguageOption = { code: string; name: string };

const presetStyle = (preset: CaptionStyle['preset']): CaptionStyle => ({
  schemaVersion: 1,
  revision: 0,
  preset,
  font: preset === 'cinema' ? 'Noto Serif' : 'Noto Sans',
  fontSize: preset === 'vertical' ? 64 : 56,
  color: '#FFFFFF',
  activeColor: '#FACC15',
  dimColor: '#FFFFFF',
  outlineColor: '#101010',
  outline: preset === 'cinema' ? 3 : 6,
  shadow: 0,
  x: 540,
  y: 1440,
  highlight: preset !== 'simple',
});

const texts = {
  'pt-BR': {
    title: 'Perfil de canal',
    intro: 'Salve as escolhas padrão deste canal no Projeto, sem credenciais sociais nem escolha de Provedor.',
    language: 'Idioma padrão',
    durationTitle: 'Faixa de duração dos Cortes (segundos)',
    minSec: 'Duração mínima (s)',
    maxSec: 'Duração máxima (s)',
    durationHint: 'Padrão: 20 a 60 s · Máximo do Perfil: 3 min (180 s). Alimenta a seleção de Cortes e novos lotes.',
    captionTitle: 'Estilo de legenda padrão',
    captionHint: 'Usado como ponto de partida ao abrir novos Cortes no editor.',
    preset: 'Preset',
    vertical: 'Vertical',
    cinema: 'Cinema',
    simple: 'Simples · sem destaque',
    font: 'Fonte',
    fontSize: 'Tamanho da fonte',
    outline: 'Contorno',
    shadow: 'Sombra',
    x: 'Posição horizontal',
    y: 'Posição vertical',
    color: 'Cor normal',
    activeColor: 'Cor ativa',
    dimColor: 'Cor esmaecida',
    outlineColor: 'Cor do contorno',
    highlight: 'Destaque karaokê',
    allowedTitle: 'Fontes permitidas',
    allowedHint: 'Registro de criadores e fontes autorizadas para este canal (apenas referência; não bloqueia importações).',
    allowedEmpty: 'Nenhuma fonte permitida cadastrada.',
    sourceLabel: 'Nome da fonte permitida',
    sourceUrl: 'URL (opcional)',
    sourceNote: 'Nota de licença ou autorização (opcional)',
    addSource: 'Adicionar fonte permitida',
    removeSource: 'Remover',
    narrationVoice: 'Voz da Narração: campo reservado para o TTS (indisponível nesta versão).',
    cadence: 'Ritmo de publicação sugerido (orientação): publique em ritmo regular e moderado (por exemplo, 1 a 3 vídeos por dia por canal) e evite enviar lotes grandes de vídeos parecidos em sequência, para reduzir risco de filtros de spam.',
    save: 'Salvar perfil do canal',
    saved: 'Perfil do canal salvo.',
    loading: 'Carregando perfil do canal…',
    rangeError: 'Informe valores inteiros em segundos com 0 < mínimo < máximo ≤ 180 s.',
    urlError: 'Informe uma URL HTTP ou HTTPS válida para a fonte permitida.',
    loadError: 'Não foi possível carregar o perfil do canal.',
    saveError: 'Não foi possível salvar o perfil do canal.',
  },
  en: {
    title: 'Channel profile',
    intro: 'Save this channel’s default choices in the Project, with no social credentials or Provider choice.',
    language: 'Default language',
    durationTitle: 'Clip duration range (seconds)',
    minSec: 'Minimum duration (s)',
    maxSec: 'Maximum duration (s)',
    durationHint: 'Default: 20 to 60 s · Profile maximum: 3 min (180 s). Feeds Clip selection and new batches.',
    captionTitle: 'Default caption style',
    captionHint: 'Used as the starting style when opening new Clips in the editor.',
    preset: 'Preset',
    vertical: 'Vertical',
    cinema: 'Cinema',
    simple: 'Simple · no highlight',
    font: 'Font',
    fontSize: 'Font size',
    outline: 'Outline',
    shadow: 'Shadow',
    x: 'Horizontal position',
    y: 'Vertical position',
    color: 'Normal color',
    activeColor: 'Active color',
    dimColor: 'Dim color',
    outlineColor: 'Outline color',
    highlight: 'Karaoke highlight',
    allowedTitle: 'Allowed sources',
    allowedHint: 'Record of authorized creators and sources for this channel (reference only; does not block imports).',
    allowedEmpty: 'No allowed sources registered.',
    sourceLabel: 'Allowed source name',
    sourceUrl: 'URL (optional)',
    sourceNote: 'License or authorization note (optional)',
    addSource: 'Add allowed source',
    removeSource: 'Remove',
    narrationVoice: 'Narration voice: field reserved for TTS (unavailable in this version).',
    cadence: 'Suggested publishing cadence (guideline): publish at a steady, moderate pace (for example, 1 to 3 videos per day per channel) and avoid uploading large batches of similar videos back-to-back to reduce spam-filter risk.',
    save: 'Save channel profile',
    saved: 'Channel profile saved.',
    loading: 'Loading channel profile…',
    rangeError: 'Enter whole seconds with 0 < minimum < maximum ≤ 180 s.',
    urlError: 'Enter a valid HTTP or HTTPS URL for the allowed source.',
    loadError: 'Could not load the channel profile.',
    saveError: 'Could not save the channel profile.',
  },
};

const field = 'foco h-8 rounded-md border border-line-strong bg-field px-3 text-fg disabled:opacity-50';

function validHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.host);
  } catch {
    return false;
  }
}

/** Perfil de canal (#72): escolhas padrão do Projeto aberto, sem credenciais sociais nem Provedor. */
export function ChannelProfile({ projectId }: { projectId: string }) {
  const t = useText(texts);
  const [profile, setProfile] = useState<ChannelProfileData | null>(null);
  const [languages, setLanguages] = useState<LanguageOption[]>([
    { code: 'pt', name: 'portuguese' },
    { code: 'en', name: 'english' },
  ]);
  const [minSec, setMinSec] = useState('20');
  const [maxSec, setMaxSec] = useState('60');
  const [sourceLabel, setSourceLabel] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setStatus('');
    const [loaded, langs] = await Promise.all([
      coreDispatch<ChannelProfileData>('channel_profile.get', {}),
      coreDispatch<LanguageOption[]>('channel_profile.languages', {}).catch(() => null),
    ]);
    setProfile(loaded);
    setMinSec(String(Math.round(loaded.minUs / 1_000_000)));
    setMaxSec(String(Math.round(loaded.maxUs / 1_000_000)));
    if (langs && langs.length > 0) setLanguages(langs);
  }, []);

  useEffect(() => {
    void load().catch(() => setError(t.loadError));
  }, [projectId, load, t.loadError]);

  function addAllowedSource() {
    if (!profile) return;
    setError('');
    const label = sourceLabel.trim();
    if (!label) return;
    const url = sourceUrl.trim();
    if (url && !validHttpUrl(url)) {
      setError(t.urlError);
      return;
    }
    const note = sourceNote.trim();
    const item: AllowedSource = {
      label,
      ...(url ? { url } : {}),
      ...(note ? { note } : {}),
    };
    setProfile({ ...profile, allowedSources: [...profile.allowedSources, item] });
    setSourceLabel('');
    setSourceUrl('');
    setSourceNote('');
    setStatus('');
  }

  function removeAllowedSource(index: number) {
    if (!profile) return;
    setProfile({
      ...profile,
      allowedSources: profile.allowedSources.filter((_, i) => i !== index),
    });
    setStatus('');
  }

  async function save() {
    if (!profile) return;
    setError('');
    setStatus('');
    const min = Number(minSec);
    const max = Number(maxSec);
    const maxAllowed = Math.round(profile.limits.maxUs / 1_000_000);
    if (!Number.isInteger(min) || !Number.isInteger(max) || min <= 0 || min >= max || max > maxAllowed) {
      setError(t.rangeError);
      return;
    }
    setBusy(true);
    try {
      const saved = await coreDispatch<ChannelProfileData>('channel_profile.set', {
        videoKind: profile.videoKind,
        language: profile.language,
        minUs: min * 1_000_000,
        maxUs: max * 1_000_000,
        captionStyle: profile.captionStyle,
        allowedSources: profile.allowedSources,
        narrationVoice: null,
      });
      setProfile(saved);
      setMinSec(String(Math.round(saved.minUs / 1_000_000)));
      setMaxSec(String(Math.round(saved.maxUs / 1_000_000)));
      setStatus(t.saved);
      window.dispatchEvent(new CustomEvent(CHANNEL_PROFILE_UPDATED_EVENT, { detail: saved }));
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setError(msg || t.saveError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8 border-t border-line pt-6" aria-labelledby="channel-profile-title">
      <h2 id="channel-profile-title" className="text-base font-semibold">{t.title}</h2>
      <p className="mt-1 text-sm text-fg-2">{t.intro}</p>
      {!profile ? (
        <p className="mt-3 text-sm text-fg-2" role={error ? 'alert' : 'status'}>{error || t.loading}</p>
      ) : (
        <div className="mt-4 flex flex-col gap-5 text-sm">
          <VideoKindPicker
            value={profile.videoKind}
            onChange={videoKind => { setProfile({ ...profile, videoKind }); setStatus(''); }}
            disabled={busy}
          />

          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              {t.language}
              <select
                className={`${field} w-56`}
                value={profile.language}
                disabled={busy}
                onChange={e => { setProfile({ ...profile, language: e.target.value }); setStatus(''); }}
              >
                {languages.map(lang => (
                  <option key={lang.code} value={lang.code}>{lang.code} · {lang.name}</option>
                ))}
              </select>
            </label>
          </div>

          <fieldset disabled={busy} className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">{t.durationTitle}</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex flex-col gap-1">
                {t.minSec}
                <input
                  type="number"
                  min={1}
                  max={179}
                  step={1}
                  className={`${field} w-36`}
                  value={minSec}
                  onChange={e => { setMinSec(e.target.value); setStatus(''); }}
                />
              </label>
              <label className="flex flex-col gap-1">
                {t.maxSec}
                <input
                  type="number"
                  min={2}
                  max={Math.round(profile.limits.maxUs / 1_000_000)}
                  step={1}
                  className={`${field} w-36`}
                  value={maxSec}
                  onChange={e => { setMaxSec(e.target.value); setStatus(''); }}
                />
              </label>
            </div>
            <p className="text-xs text-fg-2">{t.durationHint}</p>
          </fieldset>

          <fieldset disabled={busy} className="flex flex-col gap-3 rounded-md border border-line p-3">
            <legend className="px-1 font-medium">{t.captionTitle}</legend>
            <p className="text-xs text-fg-2">{t.captionHint}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex flex-col gap-1">
                {t.preset}
                <select
                  className={field}
                  value={profile.captionStyle.preset}
                  onChange={e => {
                    const next = presetStyle(e.target.value as CaptionStyle['preset']);
                    setProfile({ ...profile, captionStyle: next });
                    setStatus('');
                  }}
                >
                  <option value="vertical">{t.vertical}</option>
                  <option value="cinema">{t.cinema}</option>
                  <option value="simple">{t.simple}</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                {t.font}
                <select
                  className={field}
                  value={profile.captionStyle.font}
                  onChange={e => {
                    setProfile({
                      ...profile,
                      captionStyle: { ...profile.captionStyle, font: e.target.value as CaptionStyle['font'] },
                    });
                    setStatus('');
                  }}
                >
                  <option value="Noto Sans">Noto Sans</option>
                  <option value="Noto Serif">Noto Serif</option>
                </select>
              </label>
              {(['fontSize', 'outline', 'shadow', 'x', 'y'] as const).map(key => (
                <label key={key} className="flex flex-col gap-1">
                  {t[key]}
                  <input
                    type="number"
                    className={field}
                    min={key === 'fontSize' ? 24 : key === 'x' ? 80 : key === 'y' ? 192 : 0}
                    max={key === 'fontSize' ? 96 : key === 'x' ? 1000 : key === 'y' ? 1600 : 10}
                    step={1}
                    value={profile.captionStyle[key]}
                    onChange={e => {
                      setProfile({
                        ...profile,
                        captionStyle: { ...profile.captionStyle, [key]: Number(e.target.value) },
                      });
                      setStatus('');
                    }}
                  />
                </label>
              ))}
              <label className="flex items-center gap-2 self-end pb-1">
                <input
                  type="checkbox"
                  className="foco"
                  checked={profile.captionStyle.highlight}
                  onChange={e => {
                    setProfile({
                      ...profile,
                      captionStyle: { ...profile.captionStyle, highlight: e.target.checked },
                    });
                    setStatus('');
                  }}
                />
                {t.highlight}
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(['color', 'activeColor', 'dimColor', 'outlineColor'] as const).map(key => (
                <label key={key} className="flex flex-col gap-1">
                  {t[key]}
                  <input
                    type="color"
                    aria-label={t[key]}
                    className={`${field} p-1`}
                    value={profile.captionStyle[key]}
                    onChange={e => {
                      setProfile({
                        ...profile,
                        captionStyle: { ...profile.captionStyle, [key]: e.target.value },
                      });
                      setStatus('');
                    }}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset disabled={busy} className="flex flex-col gap-3 rounded-md border border-line p-3">
            <legend className="px-1 font-medium">{t.allowedTitle}</legend>
            <p className="text-xs text-fg-2">{t.allowedHint}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                {t.sourceLabel}
                <input
                  className={field}
                  maxLength={120}
                  value={sourceLabel}
                  onChange={e => setSourceLabel(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                {t.sourceUrl}
                <input
                  type="url"
                  className={field}
                  maxLength={500}
                  value={sourceUrl}
                  onChange={e => setSourceUrl(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1">
                {t.sourceNote}
                <input
                  className={field}
                  maxLength={300}
                  value={sourceNote}
                  onChange={e => setSourceNote(e.target.value)}
                />
              </label>
            </div>
            <div>
              <Button disabled={busy || !sourceLabel.trim()} onClick={addAllowedSource}>
                {t.addSource}
              </Button>
            </div>
            {profile.allowedSources.length === 0 ? (
              <p className="text-xs text-fg-2">{t.allowedEmpty}</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {profile.allowedSources.map((item, idx) => (
                  <li key={`${item.label}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="font-medium">{item.label}</p>
                      {(item.url || item.note) && (
                        <p className="break-all text-xs text-fg-2">
                          {[item.url, item.note].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <Button tamanho="sm" onClick={() => removeAllowedSource(idx)}>
                      {t.removeSource} {item.label}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <p className="text-xs text-fg-2" data-narration-voice-reserved>{t.narrationVoice}</p>

          <p role="note" className="rounded-md border border-line bg-field p-3 text-fg-2">
            {t.cadence}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button variante="primario" disabled={busy} onClick={() => void save()}>
              {t.save}
            </Button>
            {status && <p role="status" aria-live="polite" className="text-xs text-fg-2">{status}</p>}
          </div>
          {error && <p role="alert" className="text-danger">{error}</p>}
        </div>
      )}
    </section>
  );
}
