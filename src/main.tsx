import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelLeft, PanelRight } from 'lucide-react';
import { ComandosProvider, useComandos } from '@/lib/comandos';
import { LanguageContext, useText, type Language } from '@/lib/i18n';
import { iniciarTema } from '@/lib/tema';
import { drawers } from '@/lib/drawers';
import { Paleta, GatilhoPaleta } from '@/components/shell/Paleta';
import { GavetaBorda, ZonaBorda, Puxador, CabecalhoGaveta, useGaveta } from '@/components/shell/Gaveta';
import { Button } from '@/components/ui/Button';
import { texts } from '@/features/shell/texts';
import { UpdateNotice } from '@/features/updates/UpdateNotice';
import { Report } from '@/features/report/Report';
import { About } from '@/features/about/About';
import { Components } from '@/features/components/Components';
import { Preferences } from '@/features/preferences/Preferences';
import { Projects } from '@/features/projects/Projects';
import '@/styles/index.css';

type Page = 'home' | 'about' | 'preferences' | 'components' | 'report';
function Shell({ language, setLanguage }: { language: Language; setLanguage: (v: Language) => void }) {
  const t = useText(texts); const [page, setPage] = useState<Page>('home');
  const left = useGaveta(); const right = useGaveta();
  useComandos([
    { id:'home', titulo:t.home, grupo:t.group, executar:() => setPage('home') },
    { id:'report', titulo:t.report, grupo:t.group, executar:() => setPage('report') },
    { id:'about', titulo:t.about, grupo:t.group, executar:() => setPage('about') },
    { id:'components', titulo:t.components, grupo:t.group, executar:() => setPage('components') },
    { id:'preferences', titulo:t.preferences, grupo:t.group, executar:() => setPage('preferences') },
    { id:'left', titulo:t.left, grupo:t.group, atalho:'[', executar:() => { right.fechar(); left.alternar(); } },
    { id:'right', titulo:t.right, grupo:t.group, atalho:']', executar:() => { left.fechar(); right.alternar(); } },
  ]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const drawer = (side: 'esq' | 'dir', g: typeof left) => {
    const label = side === 'esq' ? t.left : t.right;
    const contributions = drawers.filter(d => d.side === side);
    return <><ZonaBorda lado={side} g={g} /><Puxador lado={side} g={g} itens={[{id:side, rotulo:label, atalho: side === 'esq' ? '[' : ']', icone:side === 'esq' ? <PanelLeft size={16}/> : <PanelRight size={16}/>, onClick:g.alternar}]} /><GavetaBorda lado={side} g={g} rotulo={label}><CabecalhoGaveta acoes={<Button onClick={g.fechar}>{t.close}</Button>}><h2 className="font-semibold">{label}</h2></CabecalhoGaveta><div className="overflow-y-auto p-4">{contributions.length ? contributions.map((d,i) => <section key={i}><h3>{d.title[language]}</h3><d.component /></section>) : <p className="text-fg-2">{t.emptyDrawer}</p>}</div></GavetaBorda></>;
  };
  return <div className="flex h-full flex-col bg-canvas text-fg"><header className="flex h-(--topbar-h) shrink-0 items-center gap-2 border-b border-line px-4"><strong className="mr-4">Clipes</strong><nav className="flex flex-1 gap-1" aria-label={t.group}>{(['home','components','preferences','about','report'] as const).map(p => <Button key={p} variante="fantasma" onClick={() => setPage(p)} aria-current={page === p ? 'page' : undefined}>{t[p]}</Button>)}</nav><GatilhoPaleta /></header><main className="relative min-h-0 flex-1 overflow-y-auto">{page === 'home' ? <Projects /> : page === 'report' ? <Report /> : page === 'about' ? <About /> : page === 'components' ? <Components /> : <Preferences language={language} setLanguage={setLanguage} />}{drawer('esq',left)}{drawer('dir',right)}</main><Paleta /><UpdateNotice /></div>;
}
function App() {
  const [language, updateLanguage] = useState<Language>(() => { try { return localStorage.getItem('clipes.language') === 'en' ? 'en' : 'pt-BR'; } catch { return 'pt-BR'; } });
  const setLanguage = (v: Language) => { updateLanguage(v); try { localStorage.setItem('clipes.language',v); } catch { /* session only */ } };
  return <LanguageContext.Provider value={language}><ComandosProvider><Shell language={language} setLanguage={setLanguage}/></ComandosProvider></LanguageContext.Provider>;
}
iniciarTema();
createRoot(document.getElementById('root')!).render(<App />);
