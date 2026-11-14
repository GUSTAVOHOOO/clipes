export const costTexts = {
  'pt-BR': {
    title: 'Custo do Provedor', estimateTitle: 'Estimar antes de rodar', sample: 'Texto de exemplo (Transcrição)', ceiling: 'Teto de tokens de saída (opcional)', estimate: 'Estimar custo',
    estimated: 'Estimativa (teto, não é o valor final)', from: 'a partir de', noCeiling: 'sem teto de saída informado', planQuota: 'Consome a cota do seu plano', zero: 'Custo zero (modelo local)', unknown: 'Custo desconhecido: este modelo não tem preço. Informe um preço abaixo.', unknownShort: 'desconhecido',
    inputTokens: 'tokens de entrada estimados', ceilingTokens: 'teto de saída', heuristic: 'heurística de 1 token a cada 4 caracteres',
    pricesTitle: 'Tabela de preços (US$ por milhão de tokens)', tableDate: 'Tabela embutida atualizada em', noNetwork: 'Não há busca automática; os preços podem estar defasados.', model: 'Modelo', input: 'Entrada', output: 'Saída', source: 'Origem', override: 'Seu preço', table: 'Tabela', removeOverride: 'Remover preço de', kind: 'Tipo de provedor',
    overrideModel: 'Modelo a sobrescrever', overrideInput: 'Entrada (US$ por milhão)', overrideOutput: 'Saída (US$ por milhão)', saveOverride: 'Salvar preço',
    recordsTitle: 'Custos registrados no Projeto', noRecords: 'Nenhum custo registrado.', task: 'Tarefa', batch: 'Lote', cost: 'Custo', total: 'Total em dinheiro', plusUnknown: '(há tarefas com custo desconhecido)',
    failed: 'Não foi possível concluir. Confira o Provedor, o preço e se há um Projeto aberto.',
  },
  en: {
    title: 'Provider cost', estimateTitle: 'Estimate before running', sample: 'Sample text (Transcript)', ceiling: 'Output token ceiling (optional)', estimate: 'Estimate cost',
    estimated: 'Estimate (ceiling, not the final amount)', from: 'from', noCeiling: 'no output ceiling given', planQuota: 'Uses your plan quota', zero: 'Zero cost (local model)', unknown: 'Unknown cost: this model has no price. Enter a price below.', unknownShort: 'unknown',
    inputTokens: 'estimated input tokens', ceilingTokens: 'output ceiling', heuristic: 'heuristic of 1 token per 4 characters',
    pricesTitle: 'Price table (US$ per million tokens)', tableDate: 'Built-in table updated on', noNetwork: 'There is no automatic lookup; prices may be out of date.', model: 'Model', input: 'Input', output: 'Output', source: 'Source', override: 'Your price', table: 'Table', removeOverride: 'Remove price for', kind: 'Provider type',
    overrideModel: 'Model to override', overrideInput: 'Input (US$ per million)', overrideOutput: 'Output (US$ per million)', saveOverride: 'Save price',
    recordsTitle: 'Costs recorded in the Project', noRecords: 'No costs recorded.', task: 'Task', batch: 'Batch', cost: 'Cost', total: 'Total in money', plusUnknown: '(some tasks have unknown cost)',
    failed: 'Could not complete the request. Check the Provider, the price, and that a Project is open.',
  },
} as const;
