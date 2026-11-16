// Roteiro simulado (#73). `?script-paid` pede a confirmação de custo.
const flag = (name: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);
type MockBlock = { id: number; title: string; versions: { narration: string; edited: boolean }[]; approved: number };
let blocks: MockBlock[] = [];
let generation = 0;
let pendingPolls = 0;
let regen: MockBlock | null = null;
const limits = { minBlocks: 3, maxBlocks: 12, titleChars: 80, narrationChars: 800, scriptChars: 6000, refs: 50 };

function view() {
  const shown = blocks.map((b, i) => {
    const now = b.versions.length > 0 ? b.versions[b.versions.length - 1] : null;
    return {
      id: b.id, position: i + 1, title: b.title, intent: 'Comenta o trecho do Corte.', refs: [10], narration: now?.narration ?? null,
      status: now && b.approved === b.versions.length ? 'aprovado' : 'pendente', version: b.versions.length, edited: now?.edited ?? false, job: null,
    };
  });
  const pending = shown.filter(b => b.status !== 'aprovado').length;
  return {
    schemaVersion: 1, revision: generation + blocks.reduce((n, b) => n + b.versions.length + (b.approved > 0 ? 1 : 0), 0),
    detectedLanguage: 'pt-BR', languageRequired: false,
    current: generation > 0 ? { generation, language: 'pt-BR', blocks: shown, totalChars: shown.reduce((n, b) => n + (b.narration ?? '').length, 0), pending, approved: shown.length - pending, complete: true } : null,
    narrationAllowed: generation > 0 && pending === 0, job: null, busy: pendingPolls > 0, limits, generations: [],
  };
}

const violation = (code: string) => ({ code: 'edit_invalid', message: 'Edição inválida.', usage: { violations: [{ code }] } });

/** `undefined` quando o comando não é do Roteiro. */
export function scriptMockDispatch(name: string, args: object): unknown {
  const a = args as { block?: number; narration?: string; confirmed?: boolean };
  if (name === 'script.estimate') return { paid: flag('script-paid'), profile: 'legacy', language: 'pt-BR', estimate: flag('script-paid') ? { kind: 'usd', minMicroUsd: 400, maxMicroUsd: 2000 } : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 } };
  if (name === 'script.generate' || name === 'script.regenerate') {
    if (flag('script-paid') && !a.confirmed) throw { code: 'confirmation_required', message: 'confirmação obrigatória' };
    pendingPolls = 2;
    if (name === 'script.regenerate') {
      const target = blocks.find(b => b.id === a.block);
      if (!target) throw { code: 'block_not_found', message: 'Bloco não encontrado.' };
      regen = target;
    } else regen = null;
    return { job: generation + 1 };
  }
  if (name === 'script.get') {
    if (pendingPolls > 0 && --pendingPolls === 0) {
      if (regen) regen.versions.push({ narration: `Nova fala do bloco ${regen.id} sobre o Corte.`, edited: false });
      else { generation += 1; blocks = [1, 2, 3].map(n => ({ id: generation * 10 + n, title: `Bloco ${n}`, versions: [{ narration: `Fala do bloco ${n} sobre o Corte.`, edited: false }], approved: 0 })); }
      regen = null;
    }
    return view();
  }
  if (name === 'script.edit' || name === 'script.approve') {
    const target = blocks.find(b => b.id === a.block);
    if (!target) throw { code: 'block_not_found', message: 'Bloco não encontrado.' };
    if (name === 'script.approve') target.approved = target.versions.length;
    else if (typeof a.narration === 'string') {
      if (a.narration.trim().length > limits.narrationChars) throw violation('narration_too_long');
      target.versions.push({ narration: a.narration.trim(), edited: true });
    }
    return view();
  }
  return undefined;
}
