# Contribuindo com o Clipes

Obrigado por contribuir! Consulte o [glossário](GLOSSARY.md) e os [ADRs](docs/adr/) para entender os termos e as decisões do projeto.

## Por onde começar

- Para erros, ideias e propostas de Provedor ou modelo, escolha o formulário em [Issues](https://github.com/GUSTAVOHOOO/clipes/issues/new/choose). Confira se já existe uma issue parecida. Descreva o contexto e revise o texto antes de publicá-lo: issues são públicas.
- Para dúvidas de uso, use [Discussions](https://github.com/GUSTAVOHOOO/clipes/discussions). Para vulnerabilidades, siga [SECURITY.md](SECURITY.md), sem abrir issue pública.
- Para contribuir com código, procure uma issue existente ou abra uma para discutir o trabalho. Crie um fork e uma branch a partir de `master`, faça alterações focadas e abra um pull request para `master` explicando o que mudou, a issue relacionada e como testou. Responda à revisão e atualize o PR quando necessário.
- Consulte os guias de [Provedor](docs/contribuindo/provedor.md) e [Motor de transcrição](docs/contribuindo/motor-de-transcricao.md) para contribuições nessas áreas.

## DCO e licença

As contribuições são licenciadas sob [Apache-2.0](LICENSE). Cada commit deve ter uma linha `Signed-off-by` com seu nome e e-mail, certificando o [Developer Certificate of Origin (DCO)](https://developercertificate.org/). Não há CLA. Configure sua identidade no Git e use:

```sh
git config user.name "Seu Nome"
git config user.email "seu-email@example.com"
git commit -s -m "feat: descreve a mudança"
```

Verifique o rodapé com `git log -1 --format=full`. Se faltou a assinatura no último commit local, `git commit --amend -s` a acrescenta. Não assine em nome de outra pessoa.

## Rodar e verificar o que existe hoje

O app desktop, o núcleo e o worker ainda não estão disponíveis neste repositório. O que pode ser executado hoje é a demonstração do design system Foco, com [Bun](https://bun.sh/) e Node.js instalados:

```sh
cd design-system
bun install --frozen-lockfile
bun run dev --host 127.0.0.1 --port 5180 --strictPort
```

Abra http://localhost:5180. Para verificar a compilação, execute `bun run build` em `design-system`. A [documentação da demonstração](design-system/README.md) explica seus limites e outras verificações, incluindo as que exigem Chrome no Windows. Ela não processa vídeo de produção.

## Configuração do GitHub para mantenedores

Após integrar estes arquivos, um administrador precisa:

1. Ativar **Discussions** nas configurações do repositório para que o link de dúvidas funcione.
2. Ativar **Private vulnerability reporting** em Security / Code security para receber relatos pelo link de [SECURITY.md](SECURITY.md).
3. Instalar e configurar um **app de DCO** para verificar o `Signed-off-by` de cada commit dos pull requests e exigir a verificação na proteção de `master`.
4. Confirmar que a label `needs-triage` existe e que os três formulários aparecem no seletor de issues da branch padrão.

Os formulários recebem `template`, `title` e o texto no parâmetro `body` da URL `issues/new`; cada formulário usa o campo `body` para aceitar esse preenchimento. Para textos acima do limite de URL, o usuário pode colar o diagnóstico copiado pelo app. Revise o conteúdo antes de publicar; não envie credenciais ou dados privados.
