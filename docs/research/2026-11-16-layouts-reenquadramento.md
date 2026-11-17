# Layouts de reenquadramento (#78) e validação da detecção de webcam

**Status:** implementação concluída com fixtures sintéticas; validação com lives reais do dataset #28 pendente (conforme decisão do coordenador: nenhuma mídia do dataset #28 foi baixada ou medida neste ticket).

## Layouts da v1

1. **`face` (Rosto):** Fill 9:16 seguindo o rosto com sugestão automática do YuNet e correções manuais por keyframe.
2. **`fit` (Fit / centro):** Fonte inteira centralizada em 1080×1920 com barras pretas, com zoom e pan manuais opcionais.
3. **`gameplay_webcam` (Jogo + webcam):** webcam no topo (padrão 30%, ajustável de 20% a 50%) e jogo embaixo (restante), cada painel em Fill com pan e zoom próprios. A detecção automática tem baixa confiança (teto `0.65`), mantendo o retângulo manual no editor como caminho principal.
4. **`two_people` (Duas pessoas empilhadas):** duas janelas empilhadas em Fill (padrão 50/50, ajustável de 30% a 70%), com rastreamento independente de dois rostos por cena ou ajuste manual por painel.
5. **`fullscreen_roi` (Tela cheia com área de interesse):** Fill 9:16 com área escolhida à mão, proporção travada em 9:16, só mover e zoom, sem rastreio de rosto; reutiliza os keyframes manuais do #71.

## Detecção de webcam (`worker/src/clipes_worker/reframe_webcam.py`)

- Agrupa detecções YuNet persistentes por proximidade (`CLUSTER_DISTANCE = 0.09`, `CLUSTER_IOU = 0.15`, persistência mínima `0.15`), favorecendo cantos/bordas e penalizando faces grandes de tela cheia.
- Refina o retângulo ao redor do rosto com mapa de gradiente temporal (`temporal_edge_map` sobre média dos quadros amostrados) para destacar molduras estáticas da webcam enquanto o jogo em movimento borra na média.
- Calcula confiança limitada a `[0.15, 0.65]` (ou `0.10` no fallback sem rosto), garantindo sinalização explícita de baixa confiança na UI.
- Desloca o recorte do jogo quando possível para evitar duplicar a região da webcam no painel inferior.

## Validação executada (sintética)

- `worker/tests/test_reframe_camera.py` e `worker/tests/test_reframe.py`: detecção sintética de webcam fixa no canto com rosto persistente, rejeição de rosto transiente de personagem no meio da tela, fallback sem rosto, e `two_people_timelines` em cena dupla.
- `core/tests/export_parity.rs` (`real_ffmpeg_v1_layouts_fit_roi_gameplay_webcam_and_two_people_match_preview_parity`): paridade pixel a pixel com FFmpeg real para `fit`, `fullscreen_roi`, `gameplay_webcam` (30/70 com pan no painel inferior) e `two_people` (50/50).
- `scripts/editor-crop.mjs`: verificação Playwright de todos os 5 layouts no preview (`CutPreview`), slider de divisão, ajuste manual por painel e `Ctrl+Z`.

## Pendência

- Validar precisão, taxa de acerto da caixa da webcam e falsos positivos em **lives reais do dataset #28** em execução manual futura com mídia autorizada fora do repositório.
