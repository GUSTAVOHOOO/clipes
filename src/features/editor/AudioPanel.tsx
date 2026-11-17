import { useCallback, useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from '@tauri-apps/api/core';
import { Trash2 } from 'lucide-react';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { GUARDRAILS_UPDATED_EVENT } from '@/features/guardrails/GuardrailsPanel';
import { clock, fill } from '@/features/projects/selectionFormat';
import type {
  AudioAsset,
  AudioKind,
  AudioMixState,
  LicenseKind,
  ResolvedSfx,
  SfxAnchor,
} from './timelineMath';

export type AnchorWordOption = {
  position: number;
  text: string;
  sourceStartUs: number;
  startUs: number;
};

const texts = {
  'pt-BR': {
    intro: 'Importe arquivos locais como trilha sonora (1 por vídeo) ou efeitos sonoros. A trilha abaixa automaticamente (-12 dB) nos intervalos de fala.',
    importTitle: 'Importar áudio local',
    kind: 'Tipo',
    kindMusic: 'Trilha sonora',
    kindSfx: 'Efeito sonoro',
    chooseFile: 'Escolher arquivo de áudio',
    noFile: 'Nenhum arquivo selecionado',
    license: 'Origem / licença',
    licenses: {
      unknown: 'Não informada / desconhecida',
      youtube_audio_library: 'YouTube Audio Library',
      cc0: 'CC0 (Domínio público)',
      cc_by: 'CC-BY (Exige atribuição)',
      purchased: 'Licença comprada / banco pago',
      original: 'Autoral / própria',
    } as Record<LicenseKind, string>,
    attribution: 'Texto de atribuição (vai para a descrição)',
    attributionPlaceholder: 'Ex.: Música por Artista (CC-BY 4.0)',
    unknownLicenseHint: 'Sem origem/licença registrada, o checklist pré-export mostrará o aviso de música com claim.',
    importBtn: 'Importar áudio',
    soundtrackTitle: 'Trilha sonora do Corte',
    noneSoundtrack: 'Nenhuma trilha definida neste Corte.',
    selectMusic: 'Escolher trilha importada',
    startSec: 'Início (s)',
    volume: 'Volume ({pct}%)',
    fadeInMs: 'Fade entrada (ms)',
    fadeOutMs: 'Fade saída (ms)',
    loopToFit: 'Repetir ou cortar para caber na duração',
    removeSoundtrack: 'Remover trilha',
    sfxTitle: 'Efeitos sonoros no Corte',
    selectSfx: 'Escolher efeito importado',
    anchorMode: 'Ancorar em',
    anchorMoment: 'Momento atual ({time})',
    anchorWord: 'Palavra da Transcrição',
    chooseWord: 'Palavra',
    addSfx: 'Adicionar efeito',
    noneSfx: 'Nenhum efeito sonoro adicionado.',
    wordBadge: 'Palavra: {word}',
    momentBadge: 'Momento: {time}',
    outsideClip: 'Fora das bordas atuais',
    seekSfx: 'Ir para efeito',
    removeSfx: 'Remover efeito',
    libraryTitle: 'Áudios importados no Projeto',
    emptyLibrary: 'Nenhum áudio importado ainda.',
    useAsMusic: 'Usar como trilha',
    editLicense: 'Editar licença',
    saveLicense: 'Salvar licença',
    cancel: 'Cancelar',
    deleteAsset: 'Excluir áudio',
    deleteTitle: 'Excluir áudio importado?',
    deleteDesc: 'Remover “{name}” do Projeto? Se estiver em uso em algum Corte, deixará de tocar.',
    confirmDelete: 'Excluir',
    unverifiedBadge: 'Sem licença registrada',
    duckingNote: '{count} intervalo(s) de fala detectado(s) para ducking da trilha.',
    errors: {
      attribution_required: 'Informe o texto de atribuição para licença CC-BY.',
      audio_too_large: 'O arquivo excede o limite de 500 MiB.',
      invalid_audio: 'Arquivo de áudio inválido ou não suportado.',
      ffprobe_missing: 'Instale o Componente FFmpeg/ffprobe para ler este formato.',
      word_not_found: 'A palavra selecionada não está ativa neste Corte.',
      default: 'Não foi possível atualizar o áudio.',
    } as Record<string, string>,
  },
  en: {
    intro: 'Import local files as a soundtrack (1 per video) or sound effects. The soundtrack automatically ducks (-12 dB) during speech intervals.',
    importTitle: 'Import local audio',
    kind: 'Type',
    kindMusic: 'Soundtrack',
    kindSfx: 'Sound effect',
    chooseFile: 'Choose audio file',
    noFile: 'No file selected',
    license: 'Origin / license',
    licenses: {
      unknown: 'Not provided / unknown',
      youtube_audio_library: 'YouTube Audio Library',
      cc0: 'CC0 (Public domain)',
      cc_by: 'CC-BY (Attribution required)',
      purchased: 'Purchased / paid library',
      original: 'Original / own',
    } as Record<LicenseKind, string>,
    attribution: 'Attribution text (added to Packaging description)',
    attributionPlaceholder: 'e.g. Music by Artist (CC-BY 4.0)',
    unknownLicenseHint: 'Without a recorded origin/license, the pre-export checklist will show the claimed-music notice.',
    importBtn: 'Import audio',
    soundtrackTitle: 'Clip soundtrack',
    noneSoundtrack: 'No soundtrack set for this Clip.',
    selectMusic: 'Choose imported soundtrack',
    startSec: 'Start (s)',
    volume: 'Volume ({pct}%)',
    fadeInMs: 'Fade in (ms)',
    fadeOutMs: 'Fade out (ms)',
    loopToFit: 'Repeat or cut to fit duration',
    removeSoundtrack: 'Remove soundtrack',
    sfxTitle: 'Clip sound effects',
    selectSfx: 'Choose imported SFX',
    anchorMode: 'Anchor to',
    anchorMoment: 'Current playhead ({time})',
    anchorWord: 'Transcript word',
    chooseWord: 'Word',
    addSfx: 'Add effect',
    noneSfx: 'No sound effects added.',
    wordBadge: 'Word: {word}',
    momentBadge: 'Moment: {time}',
    outsideClip: 'Outside current borders',
    seekSfx: 'Jump to effect',
    removeSfx: 'Remove effect',
    libraryTitle: 'Project audio library',
    emptyLibrary: 'No imported audio yet.',
    useAsMusic: 'Use as soundtrack',
    editLicense: 'Edit license',
    saveLicense: 'Save license',
    cancel: 'Cancel',
    deleteAsset: 'Delete audio',
    deleteTitle: 'Delete imported audio?',
    deleteDesc: 'Remove “{name}” from the Project? Any Clip using it will stop playing it.',
    confirmDelete: 'Delete',
    unverifiedBadge: 'No license recorded',
    duckingNote: '{count} speech interval(s) active for soundtrack ducking.',
    errors: {
      attribution_required: 'Attribution text is required for CC-BY license.',
      audio_too_large: 'The file exceeds the 500 MiB limit.',
      invalid_audio: 'Invalid or unsupported audio file.',
      ffprobe_missing: 'Install the FFmpeg/ffprobe Component to inspect this format.',
      word_not_found: 'The selected word is not active in this Clip.',
      default: 'Could not update audio.',
    } as Record<string, string>,
  },
};

const field = 'foco h-8 w-full rounded-md border border-line-strong bg-field px-2 text-sm text-fg';
const codeOf = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '');

export function AudioPanel({
  audioMix,
  sourceUs,
  words,
  busy,
  onSetSoundtrack,
  onClearSoundtrack,
  onAddSfx,
  onUpdateSfx,
  onRemoveSfx,
  onSeek,
  onRefreshAudio,
}: {
  audioMix: AudioMixState | null;
  sourceUs: number;
  words: AnchorWordOption[];
  busy: boolean;
  onSetSoundtrack: (args: Record<string, unknown>, preview?: boolean) => void;
  onClearSoundtrack: () => void;
  onAddSfx: (assetId: number, anchor: SfxAnchor) => void;
  onUpdateSfx: (id: number, args: Record<string, unknown>, preview?: boolean) => void;
  onRemoveSfx: (id: number) => void;
  onSeek: (sourceUs: number) => void;
  onRefreshAudio: () => void;
}) {
  const t = useText(texts);
  const [assets, setAssets] = useState<AudioAsset[]>([]);
  const [importKind, setImportKind] = useState<AudioKind>('music');
  const [importPath, setImportPath] = useState('');
  const [licenseKind, setLicenseKind] = useState<LicenseKind>('unknown');
  const [attribution, setAttribution] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  const [sfxAssetId, setSfxAssetId] = useState<string>('');
  const [anchorType, setAnchorType] = useState<'moment' | 'word'>('moment');
  const [wordPos, setWordPos] = useState<string>('');

  const [editingLicenseId, setEditingLicenseId] = useState<number | null>(null);
  const [editLicenseKind, setEditLicenseKind] = useState<LicenseKind>('unknown');
  const [editAttribution, setEditAttribution] = useState('');
  const [pendingDelete, setPendingDelete] = useState<AudioAsset | null>(null);

  const loadAssets = useCallback(async () => {
    try {
      const list = await coreDispatch<AudioAsset[]>('audio.list', {});
      setAssets(list);
    } catch {
      // ignora em inicialização
    }
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const musicAssets = assets.filter(a => a.kind === 'music');
  const sfxAssets = assets.filter(a => a.kind === 'sfx');

  useEffect(() => {
    if (!sfxAssetId && sfxAssets.length > 0) {
      setSfxAssetId(String(sfxAssets[0].id));
    }
  }, [sfxAssets, sfxAssetId]);

  const anchorableWords = words.filter(w => w.position >= 0);
  useEffect(() => {
    if (!wordPos && anchorableWords.length > 0) {
      setWordPos(String(anchorableWords[0].position));
    }
  }, [anchorableWords, wordPos]);

  async function pickFile() {
    setError('');
    if (import.meta.env.VITE_CORE_MOCK === '1' && !isTauri()) {
      setImportPath(importKind === 'music' ? '/test/mock-trilha.wav' : '/test/mock-sfx.wav');
      return;
    }
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Áudio', extensions: ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac'] }],
      });
      if (selected) setImportPath(selected);
    } catch {
      setError(t.errors.default);
    }
  }

  async function handleImport() {
    if (!importPath) return;
    setError('');
    setImporting(true);
    try {
      const created = await coreDispatch<AudioAsset>('audio.import', {
        path: importPath,
        kind: importKind,
        license_kind: licenseKind,
        license_attribution: licenseKind === 'cc_by' ? attribution : '',
      });
      setImportPath('');
      setAttribution('');
      await loadAssets();
      if (created.kind === 'music' && !audioMix?.soundtrack) {
        onSetSoundtrack({ asset_id: created.id });
      } else if (created.kind === 'sfx') {
        setSfxAssetId(String(created.id));
      }
      window.dispatchEvent(new CustomEvent(GUARDRAILS_UPDATED_EVENT));
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    } finally {
      setImporting(false);
    }
  }

  async function saveLicense(id: number) {
    setError('');
    try {
      await coreDispatch('audio.license.set', {
        id,
        license_kind: editLicenseKind,
        license_attribution: editLicenseKind === 'cc_by' ? editAttribution : '',
      });
      setEditingLicenseId(null);
      await loadAssets();
      onRefreshAudio();
      window.dispatchEvent(new CustomEvent(GUARDRAILS_UPDATED_EVENT));
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setError('');
    try {
      await coreDispatch('audio.delete', { id });
      await loadAssets();
      onRefreshAudio();
      window.dispatchEvent(new CustomEvent(GUARDRAILS_UPDATED_EVENT));
    } catch (e) {
      setError(t.errors[codeOf(e)] ?? t.errors.default);
    }
  }

  const st = audioMix?.soundtrack ?? null;

  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-3 text-sm" data-audio-panel>
      <p className="text-xs text-fg-2">{t.intro}</p>
      {audioMix && (
        <p className="text-xs text-fg-3" data-audio-speech-count={audioMix.speechIntervals.length}>
          {fill(t.duckingNote, { count: audioMix.speechIntervals.length })}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-line bg-warning-subtle px-2.5 py-1.5 text-xs text-danger">
          {error}
        </p>
      )}

      {/* Importação local */}
      <section className="flex flex-col gap-2 rounded-md border border-line bg-surface p-2.5" aria-label={t.importTitle}>
        <h4 className="text-xs font-semibold text-fg">{t.importTitle}</h4>
        <label className="flex flex-col gap-1 text-xs">
          <span>{t.kind}</span>
          <select
            className={field}
            data-audio-import-kind
            value={importKind}
            onChange={e => setImportKind(e.target.value as AudioKind)}
          >
            <option value="music">{t.kindMusic}</option>
            <option value="sfx">{t.kindSfx}</option>
          </select>
        </label>
        <div className="flex flex-col gap-1">
          <Button tamanho="sm" disabled={busy || importing} onClick={() => void pickFile()} data-audio-pick-file data-foco-inicial>
            {t.chooseFile}
          </Button>
          <span className="truncate font-mono text-[11px] text-fg-3" data-audio-picked-path>
            {importPath || t.noFile}
          </span>
        </div>
        <label className="flex flex-col gap-1 text-xs">
          <span>{t.license}</span>
          <select
            className={field}
            data-audio-import-license
            value={licenseKind}
            onChange={e => setLicenseKind(e.target.value as LicenseKind)}
          >
            {(['unknown', 'youtube_audio_library', 'cc0', 'cc_by', 'purchased', 'original'] as LicenseKind[]).map(k => (
              <option key={k} value={k}>
                {t.licenses[k]}
              </option>
            ))}
          </select>
        </label>
        {licenseKind === 'unknown' && (
          <p className="rounded bg-warning-subtle px-2 py-1 text-[11px] text-fg-2" data-audio-unknown-hint>
            {t.unknownLicenseHint}
          </p>
        )}
        {licenseKind === 'cc_by' && (
          <label className="flex flex-col gap-1 text-xs">
            <span>{t.attribution}</span>
            <input
              type="text"
              className={field}
              data-audio-import-attribution
              placeholder={t.attributionPlaceholder}
              value={attribution}
              onChange={e => setAttribution(e.target.value)}
            />
          </label>
        )}
        <Button
          tamanho="sm"
          variante="primario"
          disabled={busy || importing || !importPath}
          onClick={() => void handleImport()}
          data-audio-import-submit
        >
          {t.importBtn}
        </Button>
      </section>

      {/* Trilha sonora do Corte */}
      <section className="flex flex-col gap-2 rounded-md border border-line bg-surface p-2.5" aria-label={t.soundtrackTitle}>
        <h4 className="text-xs font-semibold text-fg">{t.soundtrackTitle}</h4>
        <label className="flex flex-col gap-1 text-xs">
          <span>{t.selectMusic}</span>
          <select
            className={field}
            data-soundtrack-select
            value={st ? String(st.assetId) : ''}
            disabled={busy}
            onChange={e => {
              const v = e.target.value;
              if (!v) onClearSoundtrack();
              else onSetSoundtrack({ asset_id: Number(v) });
            }}
          >
            <option value="">{t.noneSoundtrack}</option>
            {musicAssets.map(a => (
              <option key={a.id} value={a.id}>
                {a.name} ({clock(a.durationUs)})
              </option>
            ))}
          </select>
        </label>
        {st && (
          <div className="flex flex-col gap-2 pt-1" data-soundtrack-controls>
            {!st.licenseVerified && (
              <span className="rounded bg-warning-subtle px-2 py-0.5 text-[11px] text-fg" data-soundtrack-unverified>
                {t.unverifiedBadge}
              </span>
            )}
            <label className="flex flex-col gap-1 text-xs">
              <span className="flex justify-between">
                <span>{fill(t.volume, { pct: Math.round(st.volume * 100) })}</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                data-soundtrack-volume
                value={Math.round(st.volume * 100)}
                disabled={busy}
                onChange={e => onSetSoundtrack({ volume: Number(e.target.value) / 100 })}
              />
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              <label className="flex flex-col gap-0.5 text-[11px]">
                <span>{t.startSec}</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  className={field}
                  data-soundtrack-start
                  value={(st.startUs / 1_000_000).toFixed(1)}
                  disabled={busy}
                  onChange={e => {
                    const sec = Math.max(0, Number(e.target.value) || 0);
                    onSetSoundtrack({ start_us: Math.round(sec * 1_000_000) });
                  }}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[11px]">
                <span>{t.fadeInMs}</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  className={field}
                  data-soundtrack-fade-in
                  value={Math.round(st.fadeInUs / 1000)}
                  disabled={busy}
                  onChange={e => {
                    const ms = Math.max(0, Number(e.target.value) || 0);
                    onSetSoundtrack({ fade_in_us: Math.round(ms * 1000) });
                  }}
                />
              </label>
              <label className="flex flex-col gap-0.5 text-[11px]">
                <span>{t.fadeOutMs}</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  className={field}
                  data-soundtrack-fade-out
                  value={Math.round(st.fadeOutUs / 1000)}
                  disabled={busy}
                  onChange={e => {
                    const ms = Math.max(0, Number(e.target.value) || 0);
                    onSetSoundtrack({ fade_out_us: Math.round(ms * 1000) });
                  }}
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                data-soundtrack-loop
                checked={st.loopToFit}
                disabled={busy}
                onChange={e => onSetSoundtrack({ loop_to_fit: e.target.checked })}
              />
              <span>{t.loopToFit}</span>
            </label>
            <div>
              <Button tamanho="sm" disabled={busy} onClick={onClearSoundtrack} data-soundtrack-clear>
                {t.removeSoundtrack}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Efeitos sonoros no Corte */}
      <section className="flex flex-col gap-2 rounded-md border border-line bg-surface p-2.5" aria-label={t.sfxTitle}>
        <h4 className="text-xs font-semibold text-fg">{t.sfxTitle}</h4>
        <label className="flex flex-col gap-1 text-xs">
          <span>{t.selectSfx}</span>
          <select
            className={field}
            data-sfx-asset-select
            value={sfxAssetId}
            disabled={busy || sfxAssets.length === 0}
            onChange={e => setSfxAssetId(e.target.value)}
          >
            {sfxAssets.length === 0 && <option value="">{t.emptyLibrary}</option>}
            {sfxAssets.map(a => (
              <option key={a.id} value={a.id}>
                {a.name} ({(a.durationUs / 1_000_000).toFixed(1)}s)
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span>{t.anchorMode}</span>
          <select
            className={field}
            data-sfx-anchor-mode
            value={anchorType}
            onChange={e => setAnchorType(e.target.value as 'moment' | 'word')}
          >
            <option value="moment">{fill(t.anchorMoment, { time: clock(sourceUs) })}</option>
            <option value="word" disabled={anchorableWords.length === 0}>
              {t.anchorWord}
            </option>
          </select>
        </label>
        {anchorType === 'word' && anchorableWords.length > 0 && (
          <label className="flex flex-col gap-1 text-xs">
            <span>{t.chooseWord}</span>
            <select
              className={field}
              data-sfx-word-select
              value={wordPos}
              onChange={e => setWordPos(e.target.value)}
            >
              {anchorableWords.map(w => (
                <option key={w.position} value={w.position}>
                  {w.text.trim()} ({clock(w.sourceStartUs)})
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          tamanho="sm"
          variante="primario"
          disabled={busy || !sfxAssetId || (anchorType === 'word' && !wordPos)}
          data-sfx-add
          onClick={() => {
            const aid = Number(sfxAssetId);
            if (!aid) return;
            if (anchorType === 'word' && wordPos) {
              onAddSfx(aid, { kind: 'word', track: 'original', position: Number(wordPos), offsetUs: 0 });
            } else {
              onAddSfx(aid, { kind: 'moment', sourceUs: Math.round(sourceUs) });
            }
          }}
        >
          {t.addSfx}
        </Button>

        {!audioMix?.sfx.length ? (
          <p className="text-xs text-fg-3">{t.noneSfx}</p>
        ) : (
          <ul className="flex flex-col gap-2 pt-1">
            {audioMix.sfx.map((item: ResolvedSfx) => (
              <li
                key={item.id}
                data-sfx-row={item.id}
                className="flex flex-col gap-1.5 rounded border border-line bg-field p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className="foco truncate text-left font-medium text-fg hover:underline"
                    title={t.seekSfx}
                    onClick={() => onSeek(item.sourceStartUs)}
                  >
                    {item.name}
                  </button>
                  <button
                    type="button"
                    className="foco rounded p-1 text-fg-3 hover:text-danger"
                    aria-label={`${t.removeSfx} (${item.name})`}
                    data-sfx-remove={item.id}
                    onClick={() => onRemoveSfx(item.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-fg-2">
                  <span>
                    {item.anchor.kind === 'word'
                      ? fill(t.wordBadge, { word: item.wordText || `#${item.anchor.position}` })
                      : fill(t.momentBadge, { time: clock(item.startUs) })}
                  </span>
                  {item.outsideClip && <span className="text-danger">{t.outsideClip}</span>}
                  {!item.licenseVerified && (
                    <span className="rounded bg-warning-subtle px-1 text-fg">{t.unverifiedBadge}</span>
                  )}
                </div>
                <label className="flex flex-col gap-0.5 text-[11px]">
                  <span>{fill(t.volume, { pct: Math.round(item.volume * 100) })}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={Math.round(item.volume * 100)}
                    disabled={busy}
                    onChange={e => onUpdateSfx(item.id, { volume: Number(e.target.value) / 100 })}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Biblioteca de áudios do Projeto */}
      <section className="flex flex-col gap-2 rounded-md border border-line bg-surface p-2.5" aria-label={t.libraryTitle}>
        <h4 className="text-xs font-semibold text-fg">{t.libraryTitle}</h4>
        {assets.length === 0 ? (
          <p className="text-xs text-fg-3">{t.emptyLibrary}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {assets.map(a => (
              <li key={a.id} data-audio-asset={a.id} className="flex flex-col gap-1 rounded border border-line bg-field p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{a.name}</span>
                  <span className="shrink-0 text-[11px] text-fg-3">
                    {a.kind === 'music' ? t.kindMusic : t.kindSfx} · {clock(a.durationUs)}
                  </span>
                </div>
                <p className="text-[11px] text-fg-2">
                  {t.licenses[a.licenseKind]}
                  {a.licenseKind === 'cc_by' && a.licenseAttribution ? ` — ${a.licenseAttribution}` : ''}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {a.kind === 'music' && (
                    <Button tamanho="sm" disabled={busy} onClick={() => onSetSoundtrack({ asset_id: a.id })}>
                      {t.useAsMusic}
                    </Button>
                  )}
                  <Button
                    tamanho="sm"
                    disabled={busy}
                    data-audio-edit-license={a.id}
                    onClick={() => {
                      setEditingLicenseId(a.id);
                      setEditLicenseKind(a.licenseKind);
                      setEditAttribution(a.licenseAttribution);
                    }}
                  >
                    {t.editLicense}
                  </Button>
                  <Button
                    tamanho="sm"
                    disabled={busy}
                    data-audio-delete={a.id}
                    onClick={() => setPendingDelete(a)}
                  >
                    {t.deleteAsset}
                  </Button>
                </div>
                {editingLicenseId === a.id && (
                  <div className="mt-1 flex flex-col gap-1.5 border-t border-line pt-1.5">
                    <select
                      className={field}
                      data-audio-edit-license-select={a.id}
                      value={editLicenseKind}
                      onChange={e => setEditLicenseKind(e.target.value as LicenseKind)}
                    >
                      {(['unknown', 'youtube_audio_library', 'cc0', 'cc_by', 'purchased', 'original'] as LicenseKind[]).map(k => (
                        <option key={k} value={k}>
                          {t.licenses[k]}
                        </option>
                      ))}
                    </select>
                    {editLicenseKind === 'cc_by' && (
                      <input
                        type="text"
                        className={field}
                        data-audio-edit-attribution={a.id}
                        placeholder={t.attributionPlaceholder}
                        value={editAttribution}
                        onChange={e => setEditAttribution(e.target.value)}
                      />
                    )}
                    <div className="flex gap-1.5">
                      <Button tamanho="sm" variante="primario" data-audio-save-license={a.id} onClick={() => void saveLicense(a.id)}>
                        {t.saveLicense}
                      </Button>
                      <Button tamanho="sm" onClick={() => setEditingLicenseId(null)}>
                        {t.cancel}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={open => { if (!open) setPendingDelete(null); }}
        title={t.deleteTitle}
        description={pendingDelete ? fill(t.deleteDesc, { name: pendingDelete.name }) : ''}
        cancelLabel={t.cancel}
        confirmLabel={t.confirmDelete}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
