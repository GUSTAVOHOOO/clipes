export const texts = {
  'pt-BR': {
    title: 'Provedor padrão', endpoint: 'Endereço da API', model: 'Modelo', schema: 'O provedor aceita JSON Schema nativo', save: 'Salvar provedor', key: 'Chave de API', keyHelp: 'Opcional para provedores locais. A chave é guardada no cofre do sistema.', keySaved: 'Chave salva, final', setKey: 'Salvar chave', removeKey: 'Remover chave', test: 'Testar conexão', success: 'Conexão testada com sucesso.', saved: 'Configuração salva.', failed: 'Não foi possível concluir. Confira o endereço, o modelo, a chave e a disponibilidade do provedor.', confirm: 'Enviar texto para este destino? Somente texto será enviado; vídeo e áudio não são enviados.', noKey: 'Nenhuma chave salva.',
  },
  en: {
    title: 'Default provider', endpoint: 'API endpoint', model: 'Model', schema: 'Provider supports native JSON Schema', save: 'Save provider', key: 'API key', keyHelp: 'Optional for local providers. The key is stored in the system vault.', keySaved: 'Key saved, ending in', setKey: 'Save key', removeKey: 'Remove key', test: 'Test connection', success: 'Connection tested successfully.', saved: 'Settings saved.', failed: 'Could not complete the request. Check the endpoint, model, key, and provider availability.', confirm: 'Send text to this destination? Only text is sent; video and audio are not sent.', noKey: 'No key saved.',
  },
} as const;
