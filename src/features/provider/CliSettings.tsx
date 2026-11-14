import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { coreDispatch } from '@/lib/core';
import { useText } from '@/lib/i18n';

const texts = {
  'pt-BR': { title: 'Assinatura via CLI (experimental)', codex: 'Usar Codex CLI', claude: 'Usar Claude Code CLI', active: 'Provedor selecionado:', none: 'Nenhum CLI selecionado.', quota: 'Consome a cota do seu plano.', codexWarning: 'O Codex CLI pode rodar comandos de leitura na sua máquina; um texto malicioso na Transcrição pode fazê-lo ler arquivos e enviá-los à OpenAI; use só com Fontes confiáveis.', claudeWarning: 'Usa a sua assinatura do Claude; a Anthropic ainda não confirmou por escrito esse uso por apps de terceiros; use por sua conta.', setup: 'Instale o CLI e faça login por conta própria. O Clipes não lê nem guarda seus tokens.', confirmTitle: 'Enviar texto ao Provedor?', confirm: 'Somente texto será enviado; vídeo e áudio não são enviados. Confirme que leu os avisos antes de ativar este Provedor.', cancel: 'Cancelar', accept: 'Ativar e permitir envio', test: 'Testar CLI', disable: 'Desativar CLI', disabled: 'CLI desativado.', enabled: 'Provedor ativado.', success: 'Conexão testada com sucesso.', failed: 'Não foi possível concluir. Confira a instalação e o login do CLI.', unsupported: 'Esta versão do Claude Code não permite desligar as ferramentas. Atualize o CLI.' },
  en: { title: 'CLI subscription (experimental)', codex: 'Use Codex CLI', claude: 'Use Claude Code CLI', active: 'Selected provider:', none: 'No CLI selected.', quota: 'Uses your plan quota.', codexWarning: 'Codex CLI can run read commands on your machine; malicious text in a Transcript can cause it to read files and send them to OpenAI; use only trusted Sources.', claudeWarning: 'Uses your Claude subscription; Anthropic has not yet confirmed this use by third-party apps in writing; use at your own discretion.', setup: 'Install the CLI and sign in yourself. Clipes does not read or store your tokens.', confirmTitle: 'Send text to provider?', confirm: 'Only text is sent; video and audio are not sent. Confirm that you have read the warnings before enabling this provider.', cancel: 'Cancel', accept: 'Enable and allow sending', test: 'Test CLI', disable: 'Disable CLI', disabled: 'CLI disabled.', enabled: 'Provider enabled.', success: 'Connection tested successfully.', failed: 'Could not complete the request. Check the CLI installation and sign-in.', unsupported: 'This version of Claude Code cannot disable tools. Update the CLI.' },
} as const;
type Status = { selected: string };
export function CliSettings({ refreshKey, onSelected }: { refreshKey: number; onSelected: (value: string) => void }) {
  const t = useText(texts);
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  async function refresh() { const status = await coreDispatch<Status>('provider.cli.status', {}); setSelected(status.selected); onSelected(status.selected); }
  useEffect(() => { void refresh().catch(() => setMessage(t.failed)); }, [refreshKey]);
  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setMessage('');
    try { await action(); await refresh(); setMessage(success); } catch (error) { setMessage((error as {code?: string})?.code === 'unsupported_cli' ? t.unsupported : t.failed); } finally { setBusy(false); }
  }
  return <section className="mt-8 border-t border-line pt-6" aria-labelledby="cli-provider-title">
    <h3 id="cli-provider-title" className="font-semibold">{t.title}</h3>
    <p className="mt-2 text-sm text-fg-2">{t.setup}</p>
    <p className="mt-3 text-sm">{t.codexWarning}</p>
    <p className="mt-3 text-sm">{t.claudeWarning}</p>
    <p className="mt-3 text-sm">{t.quota}</p>
    <p className="mt-3 text-sm">{selected ? `${t.active} ${selected === 'codex' ? 'Codex CLI' : 'Claude Code CLI'}` : t.none}</p>
    <div className="mt-4 flex flex-wrap gap-2"><Button ref={first} type="button" disabled={busy} onClick={() => setPending('codex')}>{t.codex}</Button><Button type="button" disabled={busy} onClick={() => setPending('claude')}>{t.claude}</Button><Button type="button" disabled={busy || !selected} onClick={() => void run(async () => { await coreDispatch('provider.test', {}); }, t.success)}>{t.test}</Button><Button type="button" disabled={busy || !selected} onClick={() => void run(async () => { await coreDispatch('provider.cli.configure', {kind: ''}); }, t.disabled)}>{t.disable}</Button></div>
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
    <ConfirmDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null); }} title={t.confirmTitle} description={t.confirm} cancelLabel={t.cancel} confirmLabel={t.accept} finalFocus={first} onConfirm={() => { const kind = pending; setPending(null); if (kind) void run(async () => { await coreDispatch('provider.cli.configure', {kind}); await coreDispatch('provider.cli.confirm', {kind}); }, t.enabled); }} />
  </section>;
}
