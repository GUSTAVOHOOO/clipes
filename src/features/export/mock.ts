// Só o harness de navegador usa este módulo; o desktop sempre chama o núcleo.
type Mock = { job: number; state: string; progress: number; started: number; error: { code: string } | null };
let serial = 5900;
const jobs = new Map<number, Mock>();
export function exportMock(name: string, args: object): unknown {
  const a = args as { job?: number; id?: number; output?: string; start_id?: number; end_id?: number };
  if (name === 'export.settings') return { last_directory: '/test/exports' };
  if (name === 'export.start') {
    if (!a.start_id || !a.end_id) throw { code: 'export_bounds' };
    if (new URLSearchParams(location.search).has('export-exists')) throw { code: 'export_exists' };
    const job = ++serial;
    jobs.set(job, { job, state: 'running', progress: 35, started: Date.now(), error: null });
    return { job, state: 'queued' };
  }
  const item = jobs.get(a.job ?? a.id ?? -1);
  if (!item) throw { code: 'invalid_job' };
  if (name === 'jobs.cancel') item.state = 'cancelled';
  if (item.state === 'running' && Date.now() - item.started > 1500) { item.state = 'completed'; item.progress = 100; }
  return item;
}
