// Roteiro simulado (#73). `?script-paid` pede a confirmação de custo.
const flag = (name: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).has(name);
type MockBlock = { id: number; title: string; versions: { narration: string; edited: boolean }[]; approved: number; stale: boolean };
type Angle = { name: string; promise: string; audience?: string; sentence_ids?: number[] };
let angle: Angle | null = null;
let anglePolls = 0;
let angleGeneration = 0;
const suggestions: Angle[] = [
  { name: 'Custo da escolha', promise: 'Entenda por que decidir cedo muda o resultado.', audience: 'Quem precisa decidir', sentence_ids: [10, 11] },
  { name: 'Aprender com o erro', promise: 'Descubra como transformar uma falha em aprendizado.', audience: 'Iniciantes', sentence_ids: [12] },
];
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
      status: now && !b.stale && b.approved === b.versions.length ? 'aprovado' : 'pendente', stale: b.stale, version: b.versions.length, edited: now?.edited ?? false, job: null,
    };
  });
  const pending = shown.filter(b => b.status !== 'aprovado').length;
  return {
    schemaVersion: 1, revision: generation + blocks.reduce((n, b) => n + b.versions.length + (b.approved > 0 ? 1 : 0), 0),
    detectedLanguage: 'pt-BR', languageRequired: false, angle,
    current: generation > 0 ? { generation, language: 'pt-BR', blocks: shown, totalChars: shown.reduce((n, b) => n + (b.narration ?? '').length, 0), pending, approved: shown.length - pending, complete: true } : null,
    narrationAllowed: generation > 0 && pending === 0, job: null, busy: pendingPolls > 0, limits, generations: [],
  };
}

const violation = (code: string) => ({ code: 'edit_invalid', message: 'Edição inválida.', usage: { violations: [{ code }] } });

/** `undefined` quando o comando não é do Roteiro. */
export function scriptMockDispatch(name: string, args: object): unknown {
  const a = args as { block?: number; narration?: string; confirmed?: boolean; angle?: Angle; index?: number; generation?: number };
  if (name === 'angles.estimate') return { paid: flag('script-paid'), profile: 'legacy', estimate: flag('script-paid') ? { kind: 'usd', minMicroUsd: 100, maxMicroUsd: 300 } : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 } };
  if (name === 'angles.generate') {
    if (flag('script-paid') && !a.confirmed) throw { code: 'confirmation_required' };
    anglePolls = 2; return { job: 100 + angleGeneration };
  }
  if (name === 'angles.get') {
    if (anglePolls > 0 && --anglePolls === 0) angleGeneration += 1;
    return { angles: angleGeneration > 0 ? suggestions : [], generation: angleGeneration || null, selected: angle, busy: anglePolls > 0, job: angleGeneration || anglePolls ? { state: anglePolls ? 'running' : 'completed', code: null } : null };
  }
  if (name === 'angles.choose') {
    const next = a.generation ? suggestions[a.index ?? -1] : a.angle;
    if (!next?.name?.trim() || !next.promise?.trim()) throw { code: 'angle_invalid' };
    if (JSON.stringify(next) !== JSON.stringify(angle)) {
      if (generation > 0 && !a.confirmed) throw { code: 'angle_change_confirmation' };
      angle = next; blocks.forEach(b => { b.stale = true; });
    }
    return { angles: angleGeneration > 0 ? suggestions : [], generation: angleGeneration || null, selected: angle, busy: anglePolls > 0, job: angleGeneration || anglePolls ? { state: anglePolls ? 'running' : 'completed', code: null } : null };
  }
  if (name === 'script.estimate') return { paid: flag('script-paid'), profile: 'legacy', language: 'pt-BR', estimate: flag('script-paid') ? { kind: 'usd', minMicroUsd: 400, maxMicroUsd: 2000 } : { kind: 'zero', minMicroUsd: 0, maxMicroUsd: 0 } };
  if (name === 'script.generate' || name === 'script.regenerate') {
    if (!angle) throw { code: 'angle_required' };
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
      if (regen) { regen.versions.push({ narration: `Nova fala do bloco ${regen.id} sobre o Corte.`, edited: false }); regen.stale = false; }
      else { generation += 1; blocks = [1, 2, 3].map(n => ({ id: generation * 10 + n, title: `Bloco ${n}`, versions: [{ narration: `Fala do bloco ${n} sobre o Corte.`, edited: false }], approved: 0, stale: false })); }
      regen = null;
    }
    return view();
  }
  if (name === 'script.edit' || name === 'script.approve') {
    const target = blocks.find(b => b.id === a.block);
    if (!target) throw { code: 'block_not_found', message: 'Bloco não encontrado.' };
    if (name === 'script.approve') { target.approved = target.versions.length; target.stale = false; }
    else if (typeof a.narration === 'string') {
      if (a.narration.trim().length > limits.narrationChars) throw violation('narration_too_long');
      target.versions.push({ narration: a.narration.trim(), edited: true });
      target.stale = false;
    }
    return view();
  }
  return undefined;
}
