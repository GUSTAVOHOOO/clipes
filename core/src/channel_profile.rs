//! Perfil de canal (#72): escolhas padrão por Projeto/canal.
//!
//! Armazenado no SQLite do Projeto (`project.sqlite`, migração `0072_001_channel_profile`) para
//! viajar com o Projeto portátil (ADR-0005). O estilo de legenda padrão usa a tabela
//! `caption_style_default` do #65 sem duplicação. Não guarda credenciais de rede social nem
//! escolha de Provedor (ADR-0010).

use crate::{
    caption_style::{store as caption_store, Style},
    projects,
    selection::cut::{VideoKind, MAX_CUT_US, MIN_CUT_US, PREFERRED_MAX_US},
    selection_windows,
    transcription::{is_supported_language, SUPPORTED_LANGUAGES},
    url_import, CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::{Connection, OptionalExtension};
use serde::{de::IgnoredAny, Deserialize, Serialize};
use serde_json::{json, Value};

pub const DEFAULT_LANGUAGE: &str = "pt";
pub const DEFAULT_MIN_CUT_US: i64 = MIN_CUT_US;
pub const DEFAULT_MAX_CUT_US: i64 = PREFERRED_MAX_US;
pub const PROFILE_MAX_CUT_US: i64 = MAX_CUT_US;
pub const MAX_ALLOWED_SOURCES: usize = 200;
pub const MAX_LABEL_CHARS: usize = 120;
pub const MAX_URL_CHARS: usize = 500;
pub const MAX_NOTE_CHARS: usize = 300;

// Garante em compilação que o teto do Perfil nunca passe do limite técnico do planejador (#144).
const _: () = assert!(PROFILE_MAX_CUT_US <= selection_windows::MAX_CUT_US);

inventory::submit! {
    projects::Migration {
        id: "0072_001_channel_profile",
        sql: "
CREATE TABLE channel_profile (
  id INTEGER PRIMARY KEY CHECK(id=1),
  video_kind TEXT NOT NULL DEFAULT 'direct' CHECK(video_kind IN ('direct','transformed')),
  language TEXT NOT NULL DEFAULT 'pt',
  min_us INTEGER NOT NULL DEFAULT 20000000 CHECK(min_us > 0),
  max_us INTEGER NOT NULL DEFAULT 60000000 CHECK(max_us > min_us AND max_us <= 180000000),
  allowed_sources TEXT NOT NULL DEFAULT '[]',
  narration_voice TEXT
);
INSERT INTO channel_profile (id) VALUES (1);
",
    }
}

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn invalid(message: &str) -> CoreError {
    error("channel_profile_invalid", message)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AllowedSource {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl AllowedSource {
    fn normalize(mut self) -> Result<Self, CoreError> {
        let label = self.label.trim();
        if label.is_empty()
            || label.chars().count() > MAX_LABEL_CHARS
            || label.chars().any(char::is_control)
        {
            return Err(invalid(
                "Cada fonte permitida precisa de um nome válido (até 120 caracteres).",
            ));
        }
        self.label = label.to_owned();

        self.url = match self.url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            None => None,
            Some(url) => {
                if url.chars().count() > MAX_URL_CHARS || url.chars().any(char::is_control) {
                    return Err(error("invalid_url", "Informe uma URL HTTP ou HTTPS válida"));
                }
                url_import::validate_url(url)?;
                Some(url.to_owned())
            }
        };

        self.note = match self
            .note
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            None => None,
            Some(note) => {
                if note.chars().count() > MAX_NOTE_CHARS || note.chars().any(char::is_control) {
                    return Err(invalid(
                        "A nota da fonte permitida deve ter no máximo 300 caracteres sem caracteres de controle.",
                    ));
                }
                Some(note.to_owned())
            }
        };
        Ok(self)
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileLimits {
    pub default_min_us: i64,
    pub default_max_us: i64,
    pub max_us: i64,
    pub technical_max_us: i64,
}

impl ProfileLimits {
    fn current() -> Self {
        Self {
            default_min_us: DEFAULT_MIN_CUT_US,
            default_max_us: DEFAULT_MAX_CUT_US,
            max_us: PROFILE_MAX_CUT_US,
            technical_max_us: selection_windows::MAX_CUT_US,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelProfile {
    pub video_kind: String,
    pub language: String,
    pub min_us: i64,
    pub max_us: i64,
    pub caption_style: Style,
    pub allowed_sources: Vec<AllowedSource>,
    pub narration_voice: Option<String>,
    pub direct_monetization_ack: bool,
    pub limits: ProfileLimits,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SelectionDefaults {
    pub video_kind: VideoKind,
    pub min_us: i64,
    pub max_us: i64,
}

impl Default for SelectionDefaults {
    fn default() -> Self {
        Self {
            video_kind: VideoKind::Direct,
            min_us: DEFAULT_MIN_CUT_US,
            max_us: DEFAULT_MAX_CUT_US,
        }
    }
}

/// Defaults de seleção do Projeto aberto (`videoKind`, `minUs`, `maxUs`). Sem Projeto aberto
/// devolve os padrões compilados; outros erros de leitura falham explicitamente.
pub(crate) fn selection_defaults() -> Result<SelectionDefaults, CoreError> {
    match projects::with_reader(|c| {
        c.query_row(
            "SELECT video_kind, min_us, max_us FROM channel_profile WHERE id=1",
            [],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()
    }) {
        Ok(Some((kind, min_us, max_us))) => Ok(SelectionDefaults {
            video_kind: VideoKind::parse(&kind).unwrap_or_default(),
            min_us,
            max_us,
        }),
        Ok(None) => Ok(SelectionDefaults::default()),
        Err(e) if e.code == "project_not_open" => Ok(SelectionDefaults::default()),
        Err(e) => Err(e),
    }
}

/// Idioma padrão do Perfil de canal aberto; sem Projeto aberto ou linha gravada, devolve
/// `DEFAULT_LANGUAGE`.
pub(crate) fn default_language() -> Result<String, CoreError> {
    match projects::with_reader(|c| {
        c.query_row("SELECT language FROM channel_profile WHERE id=1", [], |r| {
            r.get::<_, String>(0)
        })
        .optional()
    }) {
        Ok(Some(lang)) if is_supported_language(&lang) => Ok(lang),
        Ok(_) => Ok(DEFAULT_LANGUAGE.to_owned()),
        Err(e) if e.code == "project_not_open" => Ok(DEFAULT_LANGUAGE.to_owned()),
        Err(e) => Err(e),
    }
}

/// Se o aviso único de monetização do Corte direto (#76) já foi confirmado neste canal.
pub(crate) fn direct_monetization_ack() -> Result<bool, CoreError> {
    projects::with_reader(|c| {
        Ok(c.query_row(
            "SELECT direct_monetization_ack FROM channel_profile WHERE id=1",
            [],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
        .is_some_and(|v| v != 0))
    })
}

fn read_in(c: &Connection) -> rusqlite::Result<Result<ChannelProfile, CoreError>> {
    let row = c
        .query_row(
            "SELECT video_kind, language, min_us, max_us, allowed_sources, narration_voice, direct_monetization_ack FROM channel_profile WHERE id=1",
            [],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, i64>(6)? != 0,
                ))
            },
        )
        .optional()?;
    let (kind, language, min_us, max_us, allowed_raw, narration_voice, direct_monetization_ack) =
        match row {
            Some(row) => row,
            None => (
                "direct".into(),
                DEFAULT_LANGUAGE.into(),
                DEFAULT_MIN_CUT_US,
                DEFAULT_MAX_CUT_US,
                "[]".into(),
                None,
                false,
            ),
        };
    let Some(video_kind) = VideoKind::parse(&kind) else {
        return Ok(Err(error(
            "invalid_video_kind",
            "Tipo de vídeo inválido: use direct (Corte direto) ou transformed (Vídeo transformado).",
        )));
    };
    let Ok(allowed_sources) = serde_json::from_str::<Vec<AllowedSource>>(&allowed_raw) else {
        return Ok(Err(invalid(
            "Lista de fontes permitidas inválida no Projeto.",
        )));
    };
    let caption_style = match caption_store::default_style_in(c)? {
        Ok(style) => style,
        Err(e) => return Ok(Err(e)),
    };
    Ok(Ok(ChannelProfile {
        video_kind: video_kind.as_str().to_owned(),
        language,
        min_us,
        max_us,
        caption_style,
        allowed_sources,
        narration_voice,
        direct_monetization_ack,
        limits: ProfileLimits::current(),
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetInput {
    #[serde(default)]
    video_kind: Option<String>,
    #[serde(default)]
    language: Option<String>,
    #[serde(default)]
    min_us: Option<i64>,
    #[serde(default)]
    max_us: Option<i64>,
    #[serde(default)]
    caption_style: Option<Style>,
    #[serde(default)]
    allowed_sources: Option<Vec<AllowedSource>>,
    #[serde(default)]
    narration_voice: Option<String>,
    #[serde(default)]
    direct_monetization_ack: Option<IgnoredAny>,
    #[serde(default)]
    limits: Option<IgnoredAny>,
}

fn validate_range(min_us: i64, max_us: i64) -> Result<(), CoreError> {
    if min_us <= 0 || min_us >= max_us {
        return Err(error(
            "invalid_cut_range",
            "A faixa de duração dos Cortes é inválida: o mínimo precisa ser positivo e menor que o máximo.",
        ));
    }
    if max_us > PROFILE_MAX_CUT_US {
        return Err(error(
            "invalid_cut_range",
            "A duração máxima do Perfil de canal é de 3 min (180 s).",
        ));
    }
    Ok(())
}

fn validate_language(code: &str) -> Result<String, CoreError> {
    if !is_supported_language(code) {
        return Err(invalid(
            "Informe um código de idioma ISO-639-1 válido em minúsculas (ex.: pt, en).",
        ));
    }
    Ok(code.to_owned())
}

fn validate_allowed_sources(items: Vec<AllowedSource>) -> Result<Vec<AllowedSource>, CoreError> {
    if items.len() > MAX_ALLOWED_SOURCES {
        return Err(invalid(
            "A lista de fontes permitidas aceita no máximo 200 itens.",
        ));
    }
    items.into_iter().map(AllowedSource::normalize).collect()
}

fn get(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let profile = projects::with_reader(read_in)??;
    Ok(json!(profile))
}

fn set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let input: SetInput = serde_json::from_value(v).map_err(|_| {
        invalid("Dados do Perfil de canal inválidos. Credenciais sociais e escolha de Provedor não fazem parte do Perfil.")
    })?;
    let _ = (input.limits, input.direct_monetization_ack);
    if input.narration_voice.is_some() {
        return Err(invalid(
            "O campo de voz da Narração fica reservado até a entrada do TTS.",
        ));
    }

    let updated = projects::with_writer(|c| {
        let tx = c.transaction()?;
        let current = match read_in(&tx)? {
            Ok(p) => p,
            Err(e) => return Ok(Err(e)),
        };

        let video_kind = match input.video_kind {
            Some(ref k) => match VideoKind::parse(k) {
                Some(kind) => kind,
                None => {
                    return Ok(Err(error(
                        "invalid_video_kind",
                        "Tipo de vídeo inválido: use direct (Corte direto) ou transformed (Vídeo transformado).",
                    )))
                }
            },
            None => VideoKind::parse(&current.video_kind).unwrap_or_default(),
        };
        let language = match input.language {
            Some(ref l) => match validate_language(l) {
                Ok(l) => l,
                Err(e) => return Ok(Err(e)),
            },
            None => current.language,
        };
        let min_us = input.min_us.unwrap_or(current.min_us);
        let max_us = input.max_us.unwrap_or(current.max_us);
        if let Err(e) = validate_range(min_us, max_us) {
            return Ok(Err(e));
        }

        let allowed_sources = match input.allowed_sources {
            Some(list) => match validate_allowed_sources(list) {
                Ok(list) => list,
                Err(e) => return Ok(Err(e)),
            },
            None => current.allowed_sources,
        };
        let allowed_json = match serde_json::to_string(&allowed_sources) {
            Ok(s) => s,
            Err(_) => {
                return Ok(Err(invalid(
                    "Não foi possível serializar as fontes permitidas.",
                )))
            }
        };

        if let Some(style) = input.caption_style {
            if let Err(e) = caption_store::save_default_style_in(&tx, style)? {
                return Ok(Err(e));
            }
        }

        tx.execute(
            "INSERT INTO channel_profile (id, video_kind, language, min_us, max_us, allowed_sources, narration_voice)
             VALUES (1, ?1, ?2, ?3, ?4, ?5, NULL)
             ON CONFLICT(id) DO UPDATE SET
               video_kind = excluded.video_kind,
               language = excluded.language,
               min_us = excluded.min_us,
               max_us = excluded.max_us,
               allowed_sources = excluded.allowed_sources",
            (
                video_kind.as_str(),
                &language,
                min_us,
                max_us,
                &allowed_json,
            ),
        )?;
        let saved = read_in(&tx)?;
        if saved.is_ok() {
            tx.commit()?;
        }
        Ok(saved)
    })??;
    Ok(json!(updated))
}

fn languages(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let list: Vec<Value> = SUPPORTED_LANGUAGES
        .iter()
        .map(|(code, name)| json!({"code": code, "name": name}))
        .collect();
    Ok(json!(list))
}

inventory::submit! { CommandRegistration { name: "channel_profile.get", execute: get } }
inventory::submit! { CommandRegistration { name: "channel_profile.set", execute: set } }
inventory::submit! { CommandRegistration { name: "channel_profile.languages", execute: languages } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_validation_accepts_only_lowercase_iso_codes() {
        assert!(validate_language("pt").is_ok());
        assert!(validate_language("en").is_ok());
        assert!(validate_language("es").is_ok());
        for bad in ["PT", "pt-BR", "auto", "xx", "", "portuguese"] {
            assert_eq!(
                validate_language(bad).unwrap_err().code,
                "channel_profile_invalid"
            );
        }
    }

    #[test]
    fn duration_range_enforces_positive_order_and_three_minute_cap() {
        assert!(validate_range(20_000_000, 60_000_000).is_ok());
        assert!(validate_range(1, 180_000_000).is_ok());
        assert_eq!(
            validate_range(0, 60_000_000).unwrap_err().code,
            "invalid_cut_range"
        );
        assert_eq!(
            validate_range(-1, 60_000_000).unwrap_err().code,
            "invalid_cut_range"
        );
        assert_eq!(
            validate_range(60_000_000, 60_000_000).unwrap_err().code,
            "invalid_cut_range"
        );
        assert_eq!(
            validate_range(70_000_000, 60_000_000).unwrap_err().code,
            "invalid_cut_range"
        );
        assert_eq!(
            validate_range(20_000_000, PROFILE_MAX_CUT_US + 1)
                .unwrap_err()
                .code,
            "invalid_cut_range"
        );
    }

    #[test]
    fn allowed_source_normalization_validates_label_url_and_note() {
        let ok = AllowedSource {
            label: "  Canal Oficial  ".into(),
            url: Some("  https://youtube.com/@canal  ".into()),
            note: Some("  Autorizado por escrito  ".into()),
        }
        .normalize()
        .unwrap();
        assert_eq!(ok.label, "Canal Oficial");
        assert_eq!(ok.url.as_deref(), Some("https://youtube.com/@canal"));
        assert_eq!(ok.note.as_deref(), Some("Autorizado por escrito"));

        let blank_optionals = AllowedSource {
            label: "Criador".into(),
            url: Some("   ".into()),
            note: Some("".into()),
        }
        .normalize()
        .unwrap();
        assert_eq!(blank_optionals.url, None);
        assert_eq!(blank_optionals.note, None);

        let bad_url = AllowedSource {
            label: "Criador".into(),
            url: Some("ftp://example.com".into()),
            note: None,
        }
        .normalize()
        .unwrap_err();
        assert_eq!(bad_url.code, "invalid_url");

        let empty_label = AllowedSource {
            label: "   ".into(),
            url: None,
            note: None,
        }
        .normalize()
        .unwrap_err();
        assert_eq!(empty_label.code, "channel_profile_invalid");
    }
}
