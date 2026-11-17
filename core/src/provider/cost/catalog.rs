//! Backwards-compatible model metadata and request-wide input tiers.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tier {
    /// Exclusive threshold: exactly this many input tokens retains the previous rate.
    pub above_input_tokens: u64,
    pub input_per_million: f64,
    pub output_per_million: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Price {
    pub provider: String,
    pub model: String,
    pub input_per_million: f64,
    pub output_per_million: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_output: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens_per_request: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens_per_minute: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tokens_per_day: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limits_source: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tiers: Vec<Tier>,
}

impl Price {
    pub(super) fn tier(&self, input: u64) -> Option<&Tier> {
        self.tiers
            .iter()
            .rev()
            .find(|t| input > t.above_input_tokens)
    }

    pub(super) fn rates(&self, input: u64) -> (f64, f64) {
        self.tier(input)
            .map_or((self.input_per_million, self.output_per_million), |t| {
                (t.input_per_million, t.output_per_million)
            })
    }

    pub(super) fn valid(&self) -> bool {
        let rate = |n: f64| n.is_finite() && n >= 0.0;
        if self.provider.trim().is_empty()
            || self.model.trim().is_empty()
            || !rate(self.input_per_million)
            || !rate(self.output_per_million)
            || self.context_window == Some(0)
            || self.max_output == Some(0)
            || self.tokens_per_request == Some(0)
            || self.tokens_per_minute == Some(0)
            || self.tokens_per_day == Some(0)
        {
            return false;
        }
        let mut previous = (0, self.input_per_million, self.output_per_million);
        for tier in &self.tiers {
            if tier.above_input_tokens <= previous.0
                || !rate(tier.input_per_million)
                || !rate(tier.output_per_million)
                || tier.input_per_million < previous.1
                || tier.output_per_million < previous.2
            {
                return false;
            }
            previous = (
                tier.above_input_tokens,
                tier.input_per_million,
                tier.output_per_million,
            );
        }
        true
    }
}
