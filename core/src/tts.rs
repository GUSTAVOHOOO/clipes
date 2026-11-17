//! Narração por TTS local (#79; emenda ao ADR-0004): catálogo extensível de motores/modelos
//! TTS (Pocket TTS como Componente executável + pesos sem login), validação de vozes para o
//! Perfil de canal e geração por bloco do Roteiro aprovado com duração real exposta para o #204.

pub mod catalog;
pub mod narration;

pub use catalog::is_valid_voice;
pub(crate) use narration::{block_audio_for_candidate, guardrail_status};
pub use narration::{block_durations_for_candidate, run, JOB_KIND};
