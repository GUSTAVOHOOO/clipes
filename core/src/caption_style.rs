//! Documento de estilo e preparação única para CSS/libass (#65).
mod layout;
pub mod store;
use crate::{export::captions::CaptionWord, CoreError};
pub use layout::{prepare, Cue, Prepared, VisibleWord};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    Vertical,
    Cinema,
    Simple,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Style {
    pub schema_version: u64,
    pub revision: u64,
    pub preset: Preset,
    pub font: String,
    pub font_size: u32,
    pub color: String,
    pub active_color: String,
    pub dim_color: String,
    pub outline_color: String,
    pub outline: u32,
    pub shadow: u32,
    pub x: u32,
    pub y: u32,
    pub highlight: bool,
}

pub fn invalid() -> CoreError {
    CoreError {
        code: "caption_style_invalid".into(),
        message: "O estilo da legenda é inválido.".into(),
        usage: None,
    }
}
pub fn color_valid(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

impl Style {
    pub fn preset(preset: Preset) -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            preset,
            font: if preset == Preset::Cinema {
                "Noto Serif"
            } else {
                "Noto Sans"
            }
            .into(),
            font_size: if preset == Preset::Vertical { 64 } else { 56 },
            color: "#FFFFFF".into(),
            active_color: "#FACC15".into(),
            dim_color: "#FFFFFF".into(),
            outline_color: "#101010".into(),
            outline: if preset == Preset::Cinema { 3 } else { 6 },
            shadow: 0,
            x: 540,
            y: 1440,
            highlight: preset != Preset::Simple,
        }
    }
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.schema_version != 1
            || self.revision > i64::MAX as u64
            || !matches!(self.font.as_str(), "Noto Sans" | "Noto Serif")
            || !(24..=96).contains(&self.font_size)
            || self.outline > 10
            || self.shadow > 10
            || !(80..=1000).contains(&self.x)
            || !(192..=1600).contains(&self.y)
            || [
                &self.color,
                &self.active_color,
                &self.dim_color,
                &self.outline_color,
            ]
            .iter()
            .any(|c| !color_valid(c))
        {
            return Err(invalid());
        }
        Ok(())
    }
    pub fn font_file(&self) -> &'static str {
        if self.font == "Noto Serif" {
            "NotoSerif-Bold.ttf"
        } else {
            "NotoSans-Bold.ttf"
        }
    }
    pub fn font_bytes(&self) -> &'static [u8] {
        if self.font == "Noto Serif" {
            crate::export::render::SERIF_FONT_BYTES
        } else {
            crate::export::render::FONT_BYTES
        }
    }
}

pub fn validate_document(v: &serde_json::Value) -> Result<(), CoreError> {
    serde_json::from_value::<Style>(v.clone())
        .map_err(|_| invalid())?
        .validate()
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WordOverride {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}
impl WordOverride {
    pub fn validate(&self) -> Result<(), CoreError> {
        if [&self.color, &self.active_color]
            .into_iter()
            .flatten()
            .any(|c| !color_valid(c))
        {
            return Err(invalid());
        }
        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct StyledWord {
    pub word: CaptionWord,
    pub position: i64,
    pub overrides: WordOverride,
}

impl Style {
    /// O TTF do Noto Serif Bold declara família "Noto Serif Bold" (nameID 1) e "Noto Serif"
    /// só como família tipográfica (nameID 16): DirectWrite só enxerga a primeira.
    /// fontconfig lista as duas, então o nome longo casa nas duas plataformas.
    pub fn ass_font(&self) -> &str {
        if self.font == "Noto Serif" {
            "Noto Serif Bold"
        } else {
            &self.font
        }
    }
    /// O nome longo já é o peso Bold; pedir negrito de novo faria o libass sintetizar.
    pub fn ass_bold(&self) -> i32 {
        if self.font == "Noto Serif" {
            0
        } else {
            -1
        }
    }
}
