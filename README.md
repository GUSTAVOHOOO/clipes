# Clipes

Gerador open source de cortes de lives e vídeos, com processamento local e Provedor de IA escolhido pelo usuário. Consulte o [guia de contribuição](CONTRIBUTING.md) para desenvolver e o [glossário](GLOSSARY.md) para conhecer os termos do projeto.

## Instalação

Baixe o instalador para seu sistema na página de [releases](https://github.com/GUSTAVOHOOO/clipes/releases). No Windows, o instalador NSIS instala o Clipes para o usuário atual, sem exigir administrador, e baixa o bootstrapper do WebView2 se necessário. No Linux estão disponíveis AppImage e `.deb`. Os instaladores não incluem FFmpeg, Python ou modelos: os componentes são obtidos separadamente pela tela de Componentes.

O beta do Windows ainda não tem assinatura de código. Por isso, o Microsoft Defender SmartScreen pode avisar que o aplicativo é desconhecido. Confira a origem e o SHA-256 do arquivo com o `SHA256SUMS.txt` publicado na release; se confiar no arquivo, escolha **Mais informações** e depois **Executar assim mesmo** no aviso. No PowerShell, calcule o hash com `Get-FileHash .\<instalador.exe> -Algorithm SHA256`.

## Publicação de uma release

Após integrar o fluxo e ajustar as versões do aplicativo para a versão desejada, o mantenedor cria e envia uma tag no commit a publicar, por exemplo `git tag v0.1.0` e `git push origin v0.1.0`. A execução de **Instaladores e release** gera os três instaladores, cria `SHA256SUMS.txt` e publica uma release com notas geradas pelo GitHub. Pull requests executam somente os builds e disponibilizam os instaladores como artefatos do Actions, sem criar release.

As atualizações usam pacotes assinados do Tauri. Para gerar e proteger o par de chaves, configurar os secrets `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` e definir a chave pública, siga [o guia de contribuição](CONTRIBUTING.md#chave-do-updater). O app mostra a versão e as notas e só baixa a atualização depois da confirmação.
