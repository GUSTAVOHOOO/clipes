//! Montagem do Vídeo transformado (#204): resolve a posição de cada bloco da Narração
//! sobre o Corte emendado (`SpliceMap` do #77), sem sobreposição e com congelamento final (`tpad`).
//!
//! Decisões fechadas no #204 (16/11/2026):
//! - **1A (voice-over):** a Narração toca por cima do Corte em execução contínua (ducking no #82).
//! - **2B (ancorado na 1ª Frase de `refs`):** cada bloco começa na 1ª Frase mantida em `refs`;
//!   colisões empurram o bloco seguinte mantendo [`BLOCK_GAP_US`] de respiro; blocos sem `refs`
//!   entram em `0` (se primeiro) ou logo após o anterior.
//! - **3A (empurra e congela o fim):** a fala maior que o trecho empurra os blocos seguintes
//!   dentro do Corte; só a sobra após o fim do Corte vira congelamento do último quadro (`freeze_tail_us`),
//!   com aviso na interface e no checklist.
//! - **4B (automático + arrasto):** a posição automática é o padrão; o usuário pode arrastar o
//!   início de qualquer bloco na timeline (armazenado no documento do editor em µs da Fonte)
//!   sem invalidar a aprovação do Roteiro nem regerar áudio/alinhamento (#79/#81).
//!
//! Enquanto o #79 (TTS) não entra, a duração por bloco vem de [`estimate_block_duration_us`],
//! usando a constante documentada [`ESTIMATED_CHARS_PER_SECOND`].

use crate::{editor::silences::SpliceMap, projects, script, CoreError};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Versão do schema do documento de montagem devolvido pelo núcleo.
pub const MONTAGE_SCHEMA_VERSION: u64 = 1;

/// Respiro mínimo mantido entre o fim de um bloco e o início do próximo quando há empurrão
/// ou bloco consecutivo sem `refs` (300 ms).
pub const BLOCK_GAP_US: i64 = 300_000;

/// Sobra final acima deste limite (5 s) gera aviso reforçado de congelamento longo.
pub const LONG_FREEZE_TAIL_US: i64 = 5_000_000;

/// Velocidade média estimada da fala da Narração em caracteres por segundo (~150 palavras/min)
/// enquanto o #79 (TTS) não fornece a duração real de cada bloco.
pub const ESTIMATED_CHARS_PER_SECOND: i64 = 15;

/// Duração mínima estimada para qualquer bloco com texto não vazio (500 ms).
pub const MIN_ESTIMATED_BLOCK_US: i64 = 500_000;

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

/// Estima a duração da Narração em µs a partir do número de caracteres do texto do bloco.
/// Textos vazios ou só com espaços retornam `0`. Substituível pela duração real do #79/#83/#84.
pub fn estimate_block_duration_us(text: &str) -> i64 {
    let chars = text.trim().chars().count() as i64;
    if chars <= 0 {
        return 0;
    }
    ((chars * 1_000_000) / ESTIMATED_CHARS_PER_SECOND).max(MIN_ESTIMATED_BLOCK_US)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MontageSentence {
    pub id: i64,
    pub start_us: i64,
    pub end_us: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MontageBlockInput {
    pub block_id: i64,
    pub position: i64,
    #[serde(default)]
    pub title: String,
    pub refs: Vec<i64>,
    /// Duração da Narração deste bloco em µs (real do #79/#83/#84 ou estimada).
    pub duration_us: i64,
    /// `true` quando `duration_us` veio da estimativa por caracteres.
    #[serde(default)]
    pub estimated: bool,
}

pub struct MontageInput<'a> {
    pub blocks: &'a [MontageBlockInput],
    pub sentences: &'a [MontageSentence],
    pub splice: &'a SpliceMap,
    /// Inícios manuais opcionais por `block_id`, em µs absolutos da Fonte (`clip_start_us..=clip_end_us`).
    pub manual_starts: &'a BTreeMap<i64, i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StartMode {
    Automatic,
    Manual,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedBlock {
    pub block_id: i64,
    pub position: i64,
    pub title: String,
    pub mode: StartMode,
    /// ID da Frase usada como âncora automática, quando alguma `ref` permaneceu dentro do Corte.
    pub anchor_sentence_id: Option<i64>,
    /// Início manual salvo em µs da Fonte, quando o bloco foi posicionado pelo usuário.
    pub manual_source_start_us: Option<i64>,
    /// Início automático em µs do vídeo final (sem ajuste manual nem empurrão).
    pub auto_start_us: i64,
    /// Início desejado antes da checagem de colisão, em µs do vídeo final.
    pub desired_start_us: i64,
    /// Início resolvido no vídeo final (após empurrão sem sobreposição), em µs.
    pub start_us: i64,
    /// Fim resolvido no vídeo final (`start_us + duration_us`), em µs.
    pub end_us: i64,
    /// Duração da Narração do bloco em µs.
    pub duration_us: i64,
    /// `true` quando `duration_us` é uma estimativa por caracteres.
    pub estimated: bool,
    /// Quanto o bloco foi empurrado adiante por colisão com o anterior (`start_us - desired_start_us`).
    pub pushed_us: i64,
    /// Quanto deste bloco ultrapassa `clip_duration_us` (`(end_us - clip_duration_us).max(0)`).
    pub overflow_us: i64,
    /// Início mapeado de volta para µs da Fonte (`SpliceMap::output_to_source`) para exibição na timeline.
    pub source_start_us: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MontageWarning {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount_us: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MontagePlan {
    pub schema_version: u64,
    pub blocks: Vec<ResolvedBlock>,
    /// Duração do Corte emendado sem congelamento final (`SpliceMap::output_duration_us`).
    pub clip_duration_us: i64,
    /// Instante final da última fala da Narração em µs do vídeo final (`0` sem blocos).
    pub narration_end_us: i64,
    /// Duração do congelamento do último quadro (`tpad`) necessária ao fim do vídeo, em µs.
    pub freeze_tail_us: i64,
    /// Duração total do vídeo montado (`clip_duration_us + freeze_tail_us`).
    pub total_duration_us: i64,
    /// Soma dos empurrões aplicados a todos os blocos, em µs.
    pub total_pushed_us: i64,
    /// `true` se algum bloco ainda usa estimativa por caracteres.
    pub uses_estimated_durations: bool,
    pub warnings: Vec<MontageWarning>,
}

/// Contrato resumido consumido pelo TTS (#79), legendas da Narração (#81), capítulos (#80) e ducking (#82).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrationSegmentPlan {
    pub block_id: i64,
    pub start_us: i64,
    pub end_us: i64,
    pub duration_us: i64,
}

/// Plano de mixagem/tempo para o estágio de áudio (#82) e `tpad` final no export.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMixPlan {
    pub segments: Vec<NarrationSegmentPlan>,
    pub clip_duration_us: i64,
    pub freeze_tail_us: i64,
    pub total_duration_us: i64,
}

fn resolve_auto_anchor(
    refs: &[i64],
    sentences: &BTreeMap<i64, &MontageSentence>,
    splice: &SpliceMap,
    min_start_us: i64,
    clip_duration_us: i64,
) -> (Option<i64>, i64, bool) {
    if refs.is_empty() {
        return (None, min_start_us, false);
    }

    // Recua para a primeira Frase mantida dentro de [clip_start_us, clip_end_us].
    let maintained = refs
        .iter()
        .filter_map(|id| sentences.get(id).copied())
        .filter(|s| s.end_us > splice.clip_start_us && s.start_us < splice.clip_end_us)
        .min_by_key(|s| (s.start_us, s.id));

    if let Some(anchor) = maintained {
        let clamped_start = anchor
            .start_us
            .clamp(splice.clip_start_us, splice.clip_end_us);
        return (
            Some(anchor.id),
            splice.source_to_output(clamped_start),
            false,
        );
    }

    // Nenhuma Frase referenciada permaneceu dentro das bordas atuais do Corte.
    let known: Vec<&MontageSentence> = refs
        .iter()
        .filter_map(|id| sentences.get(id).copied())
        .collect();
    let fallback = if !known.is_empty() && known.iter().all(|s| s.end_us <= splice.clip_start_us) {
        0
    } else if !known.is_empty() && known.iter().all(|s| s.start_us >= splice.clip_end_us) {
        clip_duration_us
    } else {
        min_start_us
    };
    (None, fallback, true)
}

/// Função pura que resolve a montagem dos blocos da Narração sobre o Corte (`SpliceMap`).
/// Garante ordem dos blocos sem sobreposição, respeita inícios manuais quando livres de colisão
/// e calcula o congelamento final necessário (`freeze_tail_us`) e avisos.
pub fn resolve(input: &MontageInput<'_>) -> Result<MontagePlan, CoreError> {
    let clip_duration_us = input.splice.output_duration_us.max(0);
    let sentence_map: BTreeMap<i64, &MontageSentence> =
        input.sentences.iter().map(|s| (s.id, s)).collect();

    let mut resolved = Vec::with_capacity(input.blocks.len());
    let mut warnings = Vec::new();
    let mut prev_end_us: Option<i64> = None;

    for block in input.blocks {
        if block.duration_us < 0 {
            return Err(error(
                "invalid_montage",
                "A duração do bloco de Narração não pode ser negativa.",
            ));
        }
        let min_start_us = prev_end_us.map_or(0, |end| end + BLOCK_GAP_US);
        let (anchor_sentence_id, auto_start_us, anchor_outside) = resolve_auto_anchor(
            &block.refs,
            &sentence_map,
            input.splice,
            min_start_us,
            clip_duration_us,
        );
        if anchor_outside {
            warnings.push(MontageWarning {
                code: "anchor_outside_clip".into(),
                message: "A Frase de referência deste bloco ficou fora das bordas atuais do Corte."
                    .into(),
                block_id: Some(block.block_id),
                amount_us: None,
            });
        }

        let manual_source = input.manual_starts.get(&block.block_id).copied();
        let (mode, desired_start_us) = match manual_source {
            Some(src_us) => {
                if src_us < 0 {
                    return Err(error(
                        "invalid_montage",
                        "O início manual do bloco não pode ser negativo.",
                    ));
                }
                let clamped = src_us.clamp(input.splice.clip_start_us, input.splice.clip_end_us);
                (StartMode::Manual, input.splice.source_to_output(clamped))
            }
            None => (StartMode::Automatic, auto_start_us),
        };

        let start_us = desired_start_us.max(min_start_us);
        let pushed_us = start_us - desired_start_us;
        if pushed_us > 0 {
            warnings.push(MontageWarning {
                code: "block_pushed".into(),
                message: "O bloco foi empurrado para evitar sobreposição com o bloco anterior."
                    .into(),
                block_id: Some(block.block_id),
                amount_us: Some(pushed_us),
            });
        }

        let end_us = start_us + block.duration_us;
        let overflow_us = (end_us - clip_duration_us).max(0);
        let source_start_us = if start_us <= clip_duration_us {
            input.splice.output_to_source(start_us)
        } else {
            input.splice.clip_end_us
        };

        prev_end_us = Some(end_us);
        resolved.push(ResolvedBlock {
            block_id: block.block_id,
            position: block.position,
            title: block.title.clone(),
            mode,
            anchor_sentence_id,
            manual_source_start_us: manual_source,
            auto_start_us,
            desired_start_us,
            start_us,
            end_us,
            duration_us: block.duration_us,
            estimated: block.estimated,
            pushed_us,
            overflow_us,
            source_start_us,
        });
    }

    let narration_end_us = prev_end_us.unwrap_or(0);
    let freeze_tail_us = (narration_end_us - clip_duration_us).max(0);
    let total_duration_us = clip_duration_us + freeze_tail_us;
    let total_pushed_us = resolved.iter().map(|b| b.pushed_us).sum();
    let uses_estimated_durations = resolved.iter().any(|b| b.estimated);

    if freeze_tail_us > LONG_FREEZE_TAIL_US {
        warnings.push(MontageWarning {
            code: "long_freeze_tail".into(),
            message:
                "A Narração ultrapassa o fim do Corte em mais de 5 s; o último quadro será congelado."
                    .into(),
            block_id: None,
            amount_us: Some(freeze_tail_us),
        });
    } else if freeze_tail_us > 0 {
        warnings.push(MontageWarning {
            code: "freeze_tail".into(),
            message: "A Narração ultrapassa o fim do Corte; o último quadro será congelado até a fala terminar."
                .into(),
            block_id: None,
            amount_us: Some(freeze_tail_us),
        });
    }

    Ok(MontagePlan {
        schema_version: MONTAGE_SCHEMA_VERSION,
        blocks: resolved,
        clip_duration_us,
        narration_end_us,
        freeze_tail_us,
        total_duration_us,
        total_pushed_us,
        uses_estimated_durations,
        warnings,
    })
}

/// Extrai o plano enxuto de mixagem e `tpad` final para #79/#80/#81/#82.
pub fn audio_mix_plan(plan: &MontagePlan) -> AudioMixPlan {
    AudioMixPlan {
        segments: plan
            .blocks
            .iter()
            .filter(|b| b.duration_us > 0)
            .map(|b| NarrationSegmentPlan {
                block_id: b.block_id,
                start_us: b.start_us,
                end_us: b.end_us,
                duration_us: b.duration_us,
            })
            .collect(),
        clip_duration_us: plan.clip_duration_us,
        freeze_tail_us: plan.freeze_tail_us,
        total_duration_us: plan.total_duration_us,
    }
}

/// Resolve o plano de montagem para um Corte do Projeto aberto, combinando:
/// - o documento do editor (`clip_id`, se existir) para bordas, silêncios e inícios manuais;
/// - o Roteiro mais recente do candidato (`candidate_id`);
/// - as durações reais por `script_blocks.id` (`durations`, pares `(block_id, duration_us)`),
///   com fallback na estimativa por caracteres enquanto o #79 não grava durações medidas.
pub fn plan_for_clip(
    clip_id: Option<i64>,
    candidate_id: i64,
    durations: &[(i64, i64)],
) -> Result<Option<MontagePlan>, CoreError> {
    let Some(script_doc) = script::montage_blocks_readonly(candidate_id)? else {
        return Ok(None);
    };
    let cut = crate::selection::approved_cut(candidate_id)?;
    let (clip_start_us, clip_end_us, active_silences, manual_starts) = match clip_id {
        Some(id) => {
            let doc = crate::editor::edits::document(id)?;
            if doc.original.candidate_id != Some(candidate_id) {
                return Err(error(
                    "invalid_clip",
                    "O Corte editado não corresponde ao candidato informado.",
                ));
            }
            (
                doc.range.start_us,
                doc.range.end_us,
                doc.active_silences(),
                doc.narration_starts,
            )
        }
        None => {
            let Some(first) = cut.sentences.first() else {
                return Ok(None);
            };
            let last = cut.sentences.last().unwrap();
            (first.start_us, last.end_us, Vec::new(), BTreeMap::new())
        }
    };

    let mut durations_by_block =
        crate::tts::block_durations_for_candidate(candidate_id).unwrap_or_default();
    durations_by_block.extend(durations.iter().copied());
    let sentences = load_transcript_sentences(cut.transcript)?;
    let splice = SpliceMap::new(clip_start_us, clip_end_us, &active_silences);
    let blocks: Vec<MontageBlockInput> = script_doc
        .blocks
        .into_iter()
        .map(|b| {
            let (duration_us, estimated) = match durations_by_block.get(&b.id).copied() {
                Some(real) => (real, false),
                None => (
                    b.narration.as_deref().map_or(0, estimate_block_duration_us),
                    true,
                ),
            };
            MontageBlockInput {
                block_id: b.id,
                position: b.position,
                title: b.title,
                refs: b.refs,
                duration_us,
                estimated,
            }
        })
        .collect();

    let plan = resolve(&MontageInput {
        blocks: &blocks,
        sentences: &sentences,
        splice: &splice,
        manual_starts: &manual_starts,
    })?;
    Ok(Some(plan))
}

pub(crate) fn load_transcript_sentences(
    transcript_id: i64,
) -> Result<Vec<MontageSentence>, CoreError> {
    projects::with_reader(|c| {
        let mut q = c.prepare(
            "SELECT id, start_us, end_us FROM sentences WHERE transcript_id=?1 ORDER BY start_us, id",
        )?;
        let rows = q
            .query_map([transcript_id], |r| {
                Ok(MontageSentence {
                    id: r.get(0)?,
                    start_us: r.get(1)?,
                    end_us: r.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })
}

pub(crate) fn transcript_id_for_source(source_id: i64) -> Result<Option<i64>, CoreError> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT t.id FROM transcripts t JOIN sources s ON s.id=t.source_id AND s.audio_track=t.audio_track WHERE s.id=?1 AND t.state='complete'",
            [source_id],
            |r| r.get(0),
        )
        .optional()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sentences(count: i64) -> Vec<MontageSentence> {
        (1..=count)
            .map(|id| MontageSentence {
                id,
                start_us: (id - 1) * 10_000_000,
                end_us: id * 10_000_000,
            })
            .collect()
    }

    fn block(id: i64, pos: i64, refs: Vec<i64>, duration_us: i64) -> MontageBlockInput {
        MontageBlockInput {
            block_id: id,
            position: pos,
            title: format!("Bloco {pos}"),
            refs,
            duration_us,
            estimated: false,
        }
    }

    #[test]
    fn anchors_blocks_to_first_kept_sentence_and_remaps_silences() {
        let sents = sentences(6); // 0..60s (10s each)
                                  // Clip spans sentences 2..5 (10s..50s), with a 2s silence removed at 22s..24s.
        let splice = SpliceMap::new(10_000_000, 50_000_000, &[(22_000_000, 24_000_000)]);
        // Block 1 refs [1, 2]: sentence 1 is outside clip border, so it falls back to sentence 2 (10s -> output 0s).
        // Block 2 refs [4]: sentence 4 starts at 30s -> after 2s cut, output 18s.
        let blocks = vec![
            block(101, 1, vec![1, 2], 4_000_000),
            block(102, 2, vec![4], 5_000_000),
        ];
        let plan = resolve(&MontageInput {
            blocks: &blocks,
            sentences: &sents,
            splice: &splice,
            manual_starts: &BTreeMap::new(),
        })
        .unwrap();

        assert_eq!(plan.clip_duration_us, 38_000_000);
        assert_eq!(plan.blocks[0].anchor_sentence_id, Some(2));
        assert_eq!(plan.blocks[0].start_us, 0);
        assert_eq!(plan.blocks[0].end_us, 4_000_000);
        assert_eq!(plan.blocks[0].pushed_us, 0);
        assert_eq!(plan.blocks[1].anchor_sentence_id, Some(4));
        assert_eq!(plan.blocks[1].start_us, 18_000_000);
        assert_eq!(plan.blocks[1].end_us, 23_000_000);
        assert_eq!(plan.freeze_tail_us, 0);
        assert!(plan.warnings.is_empty());
    }

    #[test]
    fn resolves_collision_by_pushing_without_overlap() {
        let sents = sentences(4); // 0..40s
        let splice = SpliceMap::new(0, 40_000_000, &[]);
        // Block 1 at 0s runs 12s (0..12s).
        // Block 2 anchored to sentence 2 (10s) collides -> pushed to 12.3s (12s + 300ms).
        // Block 3 anchored to sentence 2 (10s) or 3 (20s): say sentence 2 -> pushed behind block 2.
        let blocks = vec![
            block(1, 1, vec![1], 12_000_000),
            block(2, 2, vec![2], 5_000_000),
            block(3, 3, vec![3], 4_000_000),
        ];
        let plan = resolve(&MontageInput {
            blocks: &blocks,
            sentences: &sents,
            splice: &splice,
            manual_starts: &BTreeMap::new(),
        })
        .unwrap();

        assert_eq!(plan.blocks[0].start_us, 0);
        assert_eq!(plan.blocks[0].end_us, 12_000_000);
        assert_eq!(plan.blocks[1].desired_start_us, 10_000_000);
        assert_eq!(plan.blocks[1].start_us, 12_000_000 + BLOCK_GAP_US);
        assert_eq!(plan.blocks[1].pushed_us, 2_000_000 + BLOCK_GAP_US);
        assert_eq!(plan.blocks[1].end_us, 17_300_000);
        // Block 3 at 20s does not collide with 17.3s + 0.3s = 17.6s.
        assert_eq!(plan.blocks[2].start_us, 20_000_000);
        assert_eq!(plan.blocks[2].pushed_us, 0);
        assert_eq!(plan.total_pushed_us, 2_300_000);
        assert!(plan
            .warnings
            .iter()
            .any(|w| w.code == "block_pushed" && w.block_id == Some(2)));
    }

    #[test]
    fn places_blocks_without_refs_at_zero_or_after_previous() {
        let sents = sentences(4);
        let splice = SpliceMap::new(0, 40_000_000, &[]);
        let blocks = vec![
            block(1, 1, vec![], 3_000_000),
            block(2, 2, vec![2], 4_000_000), // 10s..14s
            block(3, 3, vec![], 2_000_000),  // 14.3s..16.3s
        ];
        let plan = resolve(&MontageInput {
            blocks: &blocks,
            sentences: &sents,
            splice: &splice,
            manual_starts: &BTreeMap::new(),
        })
        .unwrap();

        assert_eq!(plan.blocks[0].start_us, 0);
        assert_eq!(plan.blocks[0].anchor_sentence_id, None);
        assert_eq!(plan.blocks[1].start_us, 10_000_000);
        assert_eq!(plan.blocks[2].start_us, 14_000_000 + BLOCK_GAP_US);
        assert_eq!(plan.blocks[2].pushed_us, 0);
    }

    #[test]
    fn final_overflow_produces_freeze_tail_and_warnings() {
        let sents = sentences(2); // 0..20s
        let splice = SpliceMap::new(0, 20_000_000, &[]);
        let blocks = vec![
            block(1, 1, vec![1], 12_000_000), // 0..12s
            block(2, 2, vec![2], 14_000_000), // 12.3s..26.3s -> 6.3s tail (> 5s)
        ];
        let plan = resolve(&MontageInput {
            blocks: &blocks,
            sentences: &sents,
            splice: &splice,
            manual_starts: &BTreeMap::new(),
        })
        .unwrap();

        assert_eq!(plan.clip_duration_us, 20_000_000);
        assert_eq!(plan.narration_end_us, 26_300_000);
        assert_eq!(plan.freeze_tail_us, 6_300_000);
        assert_eq!(plan.total_duration_us, 26_300_000);
        assert_eq!(plan.blocks[1].overflow_us, 6_300_000);
        assert!(plan.warnings.iter().any(|w| w.code == "long_freeze_tail"));

        let mix = audio_mix_plan(&plan);
        assert_eq!(mix.segments.len(), 2);
        assert_eq!(mix.freeze_tail_us, 6_300_000);
        assert_eq!(mix.total_duration_us, 26_300_000);
    }

    #[test]
    fn preserves_manual_start_and_prevents_overlap_when_preceding_block_grows() {
        let sents = sentences(4);
        let splice = SpliceMap::new(0, 40_000_000, &[]);
        let mut manual = BTreeMap::new();
        manual.insert(2, 15_000_000);

        // With short block 1 (5s), block 2 stays at manual 15s.
        let short = vec![
            block(1, 1, vec![1], 5_000_000),
            block(2, 2, vec![2], 4_000_000),
        ];
        let plan1 = resolve(&MontageInput {
            blocks: &short,
            sentences: &sents,
            splice: &splice,
            manual_starts: &manual,
        })
        .unwrap();
        assert_eq!(plan1.blocks[1].mode, StartMode::Manual);
        assert_eq!(plan1.blocks[1].manual_source_start_us, Some(15_000_000));
        assert_eq!(plan1.blocks[1].auto_start_us, 10_000_000);
        assert_eq!(plan1.blocks[1].start_us, 15_000_000);
        assert_eq!(plan1.blocks[1].pushed_us, 0);

        // If block 1 grows to 16s, block 2 is pushed to 16.3s without losing manual_source_start_us.
        let long = vec![
            block(1, 1, vec![1], 16_000_000),
            block(2, 2, vec![2], 4_000_000),
        ];
        let plan2 = resolve(&MontageInput {
            blocks: &long,
            sentences: &sents,
            splice: &splice,
            manual_starts: &manual,
        })
        .unwrap();
        assert_eq!(plan2.blocks[1].mode, StartMode::Manual);
        assert_eq!(plan2.blocks[1].manual_source_start_us, Some(15_000_000));
        assert_eq!(plan2.blocks[1].start_us, 16_300_000);
        assert_eq!(plan2.blocks[1].pushed_us, 1_300_000);
    }

    #[test]
    fn estimates_duration_from_character_count() {
        assert_eq!(estimate_block_duration_us("   "), 0);
        assert_eq!(estimate_block_duration_us("Oi"), MIN_ESTIMATED_BLOCK_US);
        assert_eq!(estimate_block_duration_us(&"a".repeat(150)), 10_000_000);
    }
}
