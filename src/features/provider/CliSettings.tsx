import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';

export const texts = {
  'pt-BR': { title: 'Assinatura via CLI (experimental)', codex: 'Usar Codex CLI', claude: 'Usar Claude Code CLI', opencode: 'Usar OpenCode CLI', modelLabel: 'Modelo OpenCode (provedor/modelo)', free: 'Grátis (modelo confirmado pela fonte oficial)', opencodeWarning: 'O Clipes roda o OpenCode isolado; só modelos que funcionam sem login (gratuitos) estão disponíveis; seu login do OpenCode não é usado. O texto sai da máquina e o provedor pode retê-lo ou usá-lo para melhorar o modelo.', freeLimit: 'A cota gratuita do OpenCode acabou. Tente novamente mais tarde; não há repetição automática.', freeLimitRetry: 'A cota gratuita do OpenCode acabou. Tente novamente em {seconds} segundos; não há repetição automática.', authRequired: 'Este modelo exige login ou não está na lista gratuita confirmada. Escolha um modelo gratuito do OpenCode.', active: 'Provedor selecionado:', none: 'Nenhum CLI selecionado.', quota: 'Consome a cota do seu plano.', codexWarning: 'O Codex CLI pode rodar comandos de leitura na sua máquina; um texto malicioso na Transcrição pode fazê-lo ler arquivos e enviá-los à OpenAI; use só com Fontes confiáveis.', claudeWarning: 'Usa a sua assinatura do Claude; a Anthropic ainda não confirmou por escrito esse uso por apps de terceiros; use por sua conta.', setup: 'Instale o CLI e faça login por conta própria. O Clipes não lê nem guarda seus tokens.', confirmTitle: 'Enviar texto ao Provedor?', confirm: 'Somente texto será enviado; vídeo e áudio não são enviados. Confirme que leu os avisos antes de ativar este Provedor.', cancel: 'Cancelar', accept: 'Ativar e permitir envio', test: 'Testar CLI', disable: 'Desativar CLI', disabled: 'CLI desativado.', enabled: 'Provedor ativado.', success: 'Conexão testada com sucesso.', failed: 'Não foi possível concluir. Confira a instalação e o login do CLI.', unsupported: 'Esta versão ou configuração do CLI não permite comprovar o isolamento necessário.' },
  en: { title: 'CLI subscription (experimental)', codex: 'Use Codex CLI', claude: 'Use Claude Code CLI', opencode: 'Use OpenCode CLI', modelLabel: 'OpenCode model (provider/model)', free: 'Free (model confirmed by official source)', opencodeWarning: 'Clipes runs OpenCode in isolation; only models that work without login (free models) are available; your OpenCode login is not used. Text leaves the machine and the provider may retain it or use it to improve the model.', freeLimit: 'OpenCode free quota exhausted. Try again later; no automatic retry.', freeLimitRetry: 'OpenCode free quota exhausted. Retry after {seconds} seconds; no automatic retry.', authRequired: 'This model requires login or is not in the confirmed free list. Choose a free OpenCode model.', active: 'Selected provider:', none: 'No CLI selected.', quota: 'Uses your plan quota.', codexWarning: 'Codex CLI can run read commands on your machine; malicious text in a Transcript can cause it to read files and send them to OpenAI; use only trusted Sources.', claudeWarning: 'Uses your Claude subscription; Anthropic has not yet confirmed this use by third-party apps in writing; use at your own discretion.', setup: 'Install the CLI and sign in yourself. Clipes does not read or store your tokens.', confirmTitle: 'Send text to provider?', confirm: 'Only text is sent; video and audio are not sent. Confirm that you have read the warnings before enabling this provider.', cancel: 'Cancel', accept: 'Enable and allow sending', test: 'Test CLI', disable: 'Disable CLI', disabled: 'CLI disabled.', enabled: 'Provider enabled.', success: 'Connection tested successfully.', failed: 'Could not complete the request. Check the CLI installation and sign-in.', unsupported: 'This CLI version or configuration cannot guarantee the required isolation.' },
} as const;
type Status = { selected: string; opencodeModel: string };
export function CliSettings({ refreshKey, onSelected }: { refreshKey: number; onSelected: (value: string) => void }) {
  const t = useText(texts);
  const [selected, setSelected] = useState('');
  const [model, setModel] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  async function refresh() { const status = await coreDispatch<Status>('provider.cli.status', {}); setSelected(status.selected); setModel(status.opencodeModel ?? ''); onSelected(status.selected); }
  useEffect(() => { void refresh().catch(() => setMessage(t.failed)); }, [refreshKey]);
  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setMessage('');
    try { await action(); await refresh(); setMessage(success); } catch (error) {
      const failure = error as { code?: string; message?: string };
      const delay = /^OpenCode free quota exhausted; retry after ([0-9]+) seconds; no automatic retry$/.exec(failure?.message ?? '');
      setMessage(failure?.code === 'cli_free_limit' ? delay ? t.freeLimitRetry.replace('{seconds}', delay[1]) : t.freeLimit : failure?.code === 'unsupported_cli' ? t.unsupported : failure?.code === 'cli_auth_required' ? t.authRequired : t.failed);
    } finally { setBusy(false); }
  }
  return <section className="mt-8 border-t border-line pt-6" aria-labelledby="cli-provider-title">
    <h3 id="cli-provider-title" className="font-semibold">{t.title}</h3>
    <p className="mt-2 text-sm text-fg-2">{t.setup}</p>
    <p className="mt-3 text-sm">{t.codexWarning}</p>
    <p className="mt-3 text-sm">{t.claudeWarning}</p>
    <p className="mt-3 text-sm">{t.opencodeWarning}</p>
    <label className="mt-4 block text-sm">{t.modelLabel}<input className="foco mt-1 block h-9 w-full max-w-lg rounded-md border border-line-strong bg-field px-3 text-fg" value={model} placeholder="opencode/big-pickle" disabled={busy} onChange={e => setModel(e.target.value)} /></label>
    <p className="mt-3 text-sm">{t.quota}</p>
    <p className="mt-3 text-sm">{selected ? `${t.active} ${selected === 'codex' ? 'Codex CLI' : selected === 'opencode' ? 'OpenCode CLI' : 'Claude Code CLI'}` : t.none}</p>
    <div className="mt-4 flex flex-wrap gap-2"><Button ref={first} type="button" disabled={busy} onClick={() => setPending('codex')}>{t.codex}</Button><Button type="button" disabled={busy} onClick={() => setPending('claude')}>{t.claude}</Button><Button type="button" disabled={busy || !model.trim()} onClick={() => setPending('opencode')}>{t.opencode}</Button><Button type="button" disabled={busy || !selected} onClick={() => void run(async () => { await coreDispatch('provider.test', {}); }, t.success)}>{t.test}</Button><Button type="button" disabled={busy || !selected} onClick={() => void run(async () => { await coreDispatch('provider.cli.configure', {kind: ''}); }, t.disabled)}>{t.disable}</Button></div>
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
    <ConfirmDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }} title={t.confirmTitle} description={t.confirm} cancelLabel={t.cancel} confirmLabel={t.accept} finalFocus={first} onConfirm={() => { const kind = pending; setPending(null); if (kind) void run(async () => { await coreDispatch('provider.cli.configure', {kind, ...(kind === 'opencode' ? { model: model.trim() } : {})}); await coreDispatch('provider.cli.confirm', {kind}); }, t.enabled); }}>
      <p className="px-5 pb-3 text-sm">{pending === 'opencode' ? t.opencodeWarning : pending === 'codex' ? t.codexWarning : t.claudeWarning}</p>
      {pending === 'opencode' && <p className="break-all px-5 pb-3 text-sm">{model}</p>}
    </ConfirmDialog>
  </section>;
}
