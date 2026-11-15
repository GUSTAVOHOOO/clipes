import { useState } from 'react';
import { useText, type Language } from '@/lib/i18n';
import { useTema } from '@/lib/tema';
import { texts } from './texts';
import { ProviderSettings } from '@/features/provider/ProviderSettings';
import { ProviderProfiles } from '@/features/provider/ProviderProfiles';
import { ProviderCosts } from '@/features/provider/Costs';
import { GroqSettings } from './GroqSettings';
import { AssistantSettings } from '@/features/assistant/AssistantSettings';
export function Preferences({ language, setLanguage }: { language: Language; setLanguage: (v: Language) => void }) {
  const t = useText(texts); const { tema, definir } = useTema(); const [providersVersion, setProvidersVersion] = useState(0);
  const select = 'foco mt-2 block h-9 w-56 rounded-md border border-line-strong bg-field px-3 text-fg';
  return <section className="mx-auto max-w-4xl px-8 py-10"><h1 className="text-xl font-semibold">{t.title}</h1><div className="mt-8 flex flex-col gap-6"><label>{t.theme}<select className={select} value={tema} onChange={e => definir(e.target.value as 'claro' | 'escuro')}><option value="escuro">{t.dark}</option><option value="claro">{t.light}</option></select></label><label>{t.language}<select className={select} value={language} onChange={e => setLanguage(e.target.value as Language)}><option value="pt-BR">Português (Brasil)</option><option value="en">English</option></select></label></div><GroqSettings /><AssistantSettings refreshKey={providersVersion} /><ProviderSettings onChange={() => setProvidersVersion(v => v + 1)} /><ProviderProfiles refreshKey={providersVersion} onChange={() => setProvidersVersion(v => v + 1)} /><ProviderCosts /></section>;
}
