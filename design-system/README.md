# Clipes · design system Foco

Demonstração interativa da direção aprovada no [#22](https://github.com/GUSTAVOHOOO/clipes/issues/22). Roda localmente, sem conta e sem serviço de processamento.

```powershell
bun install
bun run dev --host 127.0.0.1 --port 5180 --strictPort
```

Abra [localhost:5180](http://localhost:5180). O editor está em `#/corte/c1/editar`, e a galeria em `#/galeria/cores`. `Ctrl+K` abre os comandos da tela. Os atalhos frequentes aparecem junto dos controles.

## Conteúdo

- Tokens OKLCH nos temas escuro e claro; primitivas Base UI; galeria de cores, tipografia, controles, camadas, listas e estados.
- Importação de Fonte com registro de Permissão, Projeto e fila; revisão de Cortes com Nota de cinco eixos; exportação individual ou em lote.
- Editor com quadros amostrados, legenda karaokê, timeline, Frases, silêncios, alças com encaixe, ajuste fino por Alt, crop e keyframes. `F2` corrige a palavra focada na Transcrição.
- Estilos de legenda, Roteiro revisado, Narração, teleprompter, ducking, título, descrição e capa.
- Provedor com consentimento, catálogo de componentes, aparência e diagnóstico revisável. Projetos e edições ficam isolados durante a sessão.

## Limites desta entrega

O preview usa quadros locais amostrados de Tears of Steel, sem decodificação de vídeo ou áudio. Importar Fontes, transcrever, selecionar por Provedor, baixar componentes, gerar TTS e exportar vídeo são fluxos demonstrativos identificados na interface. Os Cortes de exemplo são reutilizados como amostras iniciais em cada Projeto.

Gravação de microfone, reprodução/importação de áudio, exportação de capa PNG e download do diagnóstico usam APIs reais do navegador. A gravação depende da permissão e do dispositivo disponível. Os quadros de demonstração têm baixa resolução. A capa pode usar uma imagem local de maior resolução.

Projetos, Permissões e edições vivem em memória e são perdidos ao recarregar; só a preferência de tema fica no armazenamento local. O campo de chave da API nunca é persistido ou enviado. SQLite, cofre nativo, TTS, FFmpeg e processamento de mídia serão integrados no app desktop.

## Verificação

```powershell
bun run build
node scripts/teclado.ts
node scripts/contraste.ts
node scripts/shots.ts --tamanhos 1440x900,1366x768 --temas escuro,claro fontes cortes corte/c1/editar legenda corte/c1/transformar corte/c1/empacotar exportar config/provedor galeria/controles
```

Os scripts de teclado usam o Chrome instalado no Windows. Defina `CHROME` para outro executável Chromium ou `PORT` para alterar a porta nos scripts compatíveis. As capturas ficam em `shots/` (ignoradas pelo Git); o executor de screenshots inicia cada captura com uma sessão limpa e falha se houver erros de console.

O build reúne os textos originais das licenças de runtime em [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) e inclui uma cópia em `dist/`. A arquitetura e os tokens estão em [DESIGN.md](DESIGN.md), e o contexto de produto em [PRODUCT.md](PRODUCT.md).
