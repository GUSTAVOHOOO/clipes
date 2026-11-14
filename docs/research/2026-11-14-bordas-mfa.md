# Bordas de palavra independentes — medição provisória com MFA

Este relatório segue o [benchmark do #32](2026-11-14-benchmark-transcricao.md). O gabarito usa Montreal Forced Aligner (MFA), independente dos sistemas avaliados, sobre texto revisado do #29 nas 30 amostras e fora dos spans incertos. **A sanidade humana ainda não foi feita:** o MFA pode errar, inclusive por texto revisado sem escuta, então os números abaixo são concordância com MFA, não precisão comprovada contra marcação humana. O kit local contém 50 palavras PT e 50 EN para essa verificação. A decisão para #59 e o limite final de precisão permanecem pendentes da comparação humana; 50 ms é uma tolerância de diagnóstico, não uma exigência validada de karaokê. Até essa validação, não há evidência suficiente para aprovar os timestamps nativos nem para escolher um alinhador para o produto.

A máquina é a mesma do #32: Windows 11 Home 10.0.26300, Ryzen 5 5600H, 16 GB RAM e RTX 3050 Laptop 4 GB. Foram reaproveitadas as hipóteses brutas da execução #32 (turbo CUDA `int8_float16`, small CPU `int8`, CTC PT sobre turbo); versões de inferência e parâmetros estão no relatório anterior. MFA 3.4.3, Python 3.13.18, Kaldi 5.5.1172, micromamba 2.10.0; o ambiente conda Windows completo está fixado em [mfa-win-64.lock](../../benchmarks/transcricao/mfa-win-64.lock). O código MFA é MIT; os seguintes recursos de McAuliffe e Sonderegger são CC BY 4.0, com atribuição aos autores e ao Montreal Forced Aligner, licença [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):

| Recurso MFA | Versão da release | Tamanho | Fonte da licença e atribuição |
|---|---:|---:|---|
| Acústico `portuguese_mfa` | 2.0.0a | 91.604.181 B | [MFA acústico PT](https://mfa-models.readthedocs.io/en/latest/acoustic/Portuguese/index.html) |
| Dicionário `portuguese_mfa` | 2.0.0a | 5.856.723 B | [MFA dicionário PT](https://mfa-models.readthedocs.io/en/latest/dictionary/Portuguese/index.html) |
| Acústico `english_mfa` | 3.1.0 | 92.170.811 B | [MFA acústico EN](https://mfa-models.readthedocs.io/en/latest/acoustic/English/index.html) |
| Dicionário `english_mfa` | 3.1.0 | 1.078.195 B | [MFA dicionário EN](https://mfa-models.readthedocs.io/en/latest/dictionary/English/index.html) |
| G2P `portuguese_brazil_mfa` | 2.0.0a | 4.258.937 B | [MFA G2P PT](https://mfa-models.readthedocs.io/en/latest/g2p/Portuguese/index.html) |
| G2P `english_us_mfa` | 3.0.0 | 10.740.410 B | [MFA G2P EN](https://mfa-models.readthedocs.io/en/latest/g2p/English/index.html) |

O MFA validou os dicionários e o G2P produziu pronúncias para todos os OOV após normalização: 22 tipos PT (25 tokens no corpus) e 13 tipos EN (18 tokens). Todos os fones gerados foram comparados ao conjunto de fones do modelo acústico correspondente, sem incompatibilidades. A referência final marca os tokens que usaram G2P; deles, 25 PT e 17 EN permaneceram após exclusões. O kit não usa G2P nem tokens normalizados.

Para alinhar sem alterar o texto original, hifens iniciais espúrios foram removidos; `4`/`100` viraram `quatro`/`cem`, `24`/`48`/`200`/`90s` viraram `twenty four`/`forty eight`/`two hundred`/`nineties`, e `RP`/`F8` viraram `erre pe`/`efe oito`. A borda original vai do início da primeira palavra expandida ao fim da última; o mapeamento é guardado no manifesto local. No corpus PT, as regras primárias atingiram dois tokens de hífen, dois de número e dois de sigla (um deles também tinha hífen); em EN, três de hífen e quatro de número. `2x1` foi excluído por leitura ambígua (um token PT). Os intervalos não incertos foram extraídos com FFmpeg mono 16 kHz; o MFA exportou JSON. A primeira tentativa usou beam padrão 10/40 e os seis trechos que falharam foram recuperados com beam 30/200. Dois outros trechos EN com inserções foram reprocessados; um foi recuperado e o outro permanece excluído.

A qualidade não foi presumida: o código exclui trechos sem saída ou com divergência lexical/contagem e palavras MFA com duração acima de 2 s; intervalos sem borda pareada também são excluídos das hipóteses. Na tabela, o denominador é a contagem do texto revisado depois de excluir os spans incertos anteriores, antes das exclusões adicionais deste estudo. `Sem borda` conta palavras remanescentes sem correspondência temporal, incluindo tempos originais de duração zero; o procedimento adiciona seus intervalos às exclusões para não pontuar contra referência ausente.

| Fonte | Antes | Depois | Cobertura | Ambíguos | Sem borda |
|---|---:|---:|---:|---:|---:|
| rtZyZL3FfH4 | 688 | 685 | 99,56% | 0 | 3 |
| QiwQ62ypdcI | 711 | 707 | 99,44% | 1 | 1 |
| 6LB7vibQ5q0 | 773 | 734 | 94,95% | 0 | 14 |
| Total | 2.172 | 2.126 | 97,88% | 1 | 18 |

Os quatro intervalos excluídos integralmente foram: QiwQ62ypdcI 284,000–284,032 s e 1200,268–1200,348 s (um token em cada, curtos demais para extração de características); 6LB7vibQ5q0 35756,284–35756,320 s (três tokens, curto demais) e 35704,704–35727,324 s (19 tokens, inserção espúria de `thanks` e divergência de contagem). A inspeção automática também excluiu 11 palavras com duração acima de 2 s: uma em rtZyZL3FfH4 (10202,258–10207,888 s), uma em QiwQ62ypdcI (763,526–765,866 s) e nove em 6LB7vibQ5q0 (4508,056–4510,246; 8918,842–8920,922; 8926,492–8950,472; 8961,252–8966,212; 8977,152–8983,422; 17846,352–17850,712; 22363,250–22381,940; 31276,258–31278,368; 39979,862–39983,732 s). A exclusão temporal pode retirar palavras adicionais sobrepostas; as categorias não são somáveis. Os segmentos muito longos e as exclusões reduzem a confiança, especialmente em inglês.

## Medição

A implementação reutiliza `diagnose.py` e `metrics.py`: alinhamento lexical, F1 por borda e tolerância, e erro assinado hipótese menos referência. Exclui dos dois lados os spans incertos e adicionais; nenhuma mediana foi subtraída. O CTC cobre apenas as duas Fontes PT; as demais linhas cobrem as três.

| Sistema | Amostras | Mediana início/fim (ms) | F1 50 ms | 100 ms | 200 ms | 500 ms |
|---|---:|---:|---:|---:|---:|---:|
| Turbo int8_float16 | 30 | −16 / −24 | 0,4271 | 0,6043 | 0,6926 | 0,7549 |
| Small CPU int8 | 30 | −24 / −32 | 0,3663 | 0,5140 | 0,6094 | 0,6723 |
| CTC PT sobre turbo | 20 | +81 / +39 | 0,2393 | 0,4886 | 0,6125 | 0,6667 |

Em PT somente, o turbo teve −12/−20 ms e F1 0,4458/0,6164/0,6992/0,7595; o small teve −18/−28 ms e 0,3697/0,5018/0,5820/0,6409. Assim, nessa medição provisória, o CTC testado não melhorou o F1 sobre turbo PT em nenhuma tolerância.

Para avaliar constância do deslocamento, o IQR abaixo é calculado **entre as medianas dos dez trechos de cada Fonte**, separadamente para início e fim; as medianas por Fonte são agrupadas por borda. Isso não é um intervalo de confiança.

| Sistema / Fonte | Mediana início/fim (ms) | IQR entre trechos início/fim (ms) |
|---|---:|---:|
| Turbo rtZyZL3FfH4 | −12 / −20 | 22 / 17,5 |
| Turbo QiwQ62ypdcI | −14 / −20 | 18 / 9,5 |
| Turbo 6LB7vibQ5q0 | −28 / −30 | 35,7 / 25,8 |
| Small rtZyZL3FfH4 | −18 / −26 | 25 / 30,5 |
| Small QiwQ62ypdcI | −19 / −34 | 21,5 / 16,2 |
| Small 6LB7vibQ5q0 | −34 / −42 | 18,5 / 37,8 |
| CTC rtZyZL3FfH4 | +78 / +36 | 24 / 27,9 |
| CTC QiwQ62ypdcI | +86 / +43 | 29,9 / 24 |

O +76 ms do #32 muda de sinal quando a referência muda para MFA. As medianas também variam entre Fontes e trechos; não foi demonstrado deslocamento constante. Não recomendar correção fixa com esses dados.

## Checagem humana e decisão do #59 — pendentes

O kit em `%TEMP%\clipes-bordas-kit` contém 100 recortes de aproximadamente 3 s e rótulos do Audacity pré-preenchidos pelo MFA, sorteados com semente 102: 25 de cada Fonte PT e 50 da Fonte EN. Candidatas têm pelo menos três caracteres e duração entre 120 ms e 1 s, com separação de pelo menos 20 ms em um dos lados; isso reduz, mas não elimina, palavras coladas. O kit contém instruções para ouvir, ampliar, consultar forma de onda e espectrograma, ajustar e exportar cada rótulo; estimativa de 2–4 horas é aproximada. `kit_bordas.py` converte tempos relativos para absolutos e valida os rótulos. A pré-marcação MFA pode enviesar o revisor e deve ser considerada na interpretação. Ainda faltam a revisão de pelo menos 50 palavras por idioma, a comparação de erros e dispersão do MFA contra essas marcações e a justificativa do limite de precisão percebida para a legenda. Só então decidir se o nativo atende ou se #59 requer alinhamento e qual método. Áudios, rótulos, modelos e resultados brutos permanecem fora do Git.
