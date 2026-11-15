//! Defence against input cut in silence (#145). A local server (Ollama, llama.cpp, LM Studio)
//! may drop the start of a prompt that does not fit its context and still answer `200`. The
//! answer was computed on a partial Transcript, so it is not accepted: `context_truncated`.
//!
//! The decision is a pure function of what the call reported (`suspect`). Rules, in order:
//! 1. An explicit signal from the server (`truncated`, or `tokens_evaluated` below what was
//!    sent) always counts, local or remote.
//! 2. The usage heuristic runs only for a local (loopback, zero cost) server. A paid remote
//!    answer is never dropped by it: those APIs answer an error instead of cutting.
//! 3. "Pinned": the input tokens reach `PINNED_PERCENT` of the context sent. Before
//!    calibration (under `cost::CALIBRATION_MIN_SAMPLES` observations of the #140 key), being
//!    pinned is enough. After it, the input must also be below the low end of the estimate.
//!
//! No retry and no change of Provider follow: the error keeps the usage and a fixed message.
use super::*;

/// Input tokens at or above this share of the context sent count as "pinned at the limit".
/// Tunable with the benchmark (#57/#148).
pub(super) const PINNED_PERCENT: u64 = 98;
/// Fixed message (ADR-0006): no text, endpoint, profile or path.
pub(super) const MESSAGE: &str =
    "The provider cut the input to fit its context; increase the context or replan with smaller windows";

/// What the server itself said about the input.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct Explicit {
    pub truncated: bool,
    pub evaluated: Option<u64>,
}

pub(super) struct Reading<'a> {
    pub local: bool,
    /// Input tokens of this call, from the usage the Provider reported.
    pub input: Option<u64>,
    /// Context the call is known to run with; `None` when unknown (nothing to compare).
    pub context: Option<u64>,
    /// The `estimate` the call guard attached (`inputTokensLow`, `calibrationSamples`), if any.
    pub estimate: Option<&'a Value>,
    pub explicit: Explicit,
}

pub(super) fn is_pinned(input: u64, context: u64) -> bool {
    context > 0 && u128::from(input) * 100 >= u128::from(context) * u128::from(PINNED_PERCENT)
}

pub(super) fn suspect(r: &Reading<'_>) -> bool {
    let low = r.estimate.and_then(|e| e["inputTokensLow"].as_u64());
    if r.explicit.truncated {
        return true;
    }
    // "Sent": the estimate's low end (a prompt cache can make the evaluated count smaller
    // than the usage without any cut), else the usage input.
    if let (Some(evaluated), Some(sent)) = (r.explicit.evaluated, low.or(r.input)) {
        if evaluated < sent {
            return true;
        }
    }
    let (true, Some(input), Some(context)) = (r.local, r.input, r.context) else {
        return false;
    };
    if !is_pinned(input, context) {
        return false;
    }
    let samples = r
        .estimate
        .and_then(|e| e["calibrationSamples"].as_u64())
        .unwrap_or(0);
    if samples < cost::CALIBRATION_MIN_SAMPLES as u64 {
        return true;
    }
    low.is_some_and(|low| input < low)
}

// ---- the optional context probe (Test Provider, local only) ----

/// Characters of synthetic text sent per token of context: about 20% above the context for
/// ordinary English (~4 characters per token), so a server that cuts must show it.
pub(super) const PROBE_CHARS_PER_CONTEXT_TOKEN: u64 = 5;
/// A token never holds more characters than this in the synthetic text: fewer tokens than
/// `characters / this` means the server did not evaluate the whole text.
pub(super) const PROBE_MAX_CHARS_PER_TOKEN: u64 = 6;
/// Largest text the probe builds (about 250 thousand tokens); a larger context is not probed.
pub(super) const PROBE_MAX_CHARS: u64 = 1_000_000;

/// Synthetic text built by the core, never user data: numbered filler lines.
pub(super) fn probe_text(characters: u64) -> String {
    let mut text = String::with_capacity(characters as usize + 80);
    let mut n = 0u64;
    while (text.len() as u64) < characters {
        n += 1;
        text.push_str(&format!(
            "Synthetic filler line {n}: the quick brown fox jumps over the lazy dog.
"
        ));
    }
    text.truncate(characters as usize);
    text
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct ProbeVerdict {
    pub truncated: bool,
    /// Tokens the server kept: only known when it cut the input.
    pub measured: Option<u64>,
}

/// Reads the reply to the probe. Cut: explicit signal, fewer tokens than the text can possibly
/// hold, or pinned at the context that was sent. No usage and no signal: nothing is measured.
pub(super) fn probe_verdict(
    characters: u64,
    context: u64,
    input: Option<u64>,
    explicit: Explicit,
) -> ProbeVerdict {
    let kept = explicit.evaluated.or(input);
    let cut = explicit.truncated
        || input.is_some_and(|n| {
            n < characters / PROBE_MAX_CHARS_PER_TOKEN || is_pinned(n, context) && n <= context
        });
    ProbeVerdict {
        truncated: cut,
        measured: kept.filter(|_| cut),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(
        local: bool,
        input: Option<u64>,
        context: Option<u64>,
        estimate: Value,
        explicit: Explicit,
    ) -> bool {
        suspect(&Reading {
            local,
            input,
            context,
            estimate: Some(&estimate),
            explicit,
        })
    }
    const NONE: Explicit = Explicit {
        truncated: false,
        evaluated: None,
    };

    #[test]
    fn before_calibration_pinned_is_enough() {
        let e = json!({"calibrationSamples":2,"inputTokensLow":100});
        assert!(run(true, Some(980), Some(1000), e.clone(), NONE));
        assert!(run(true, Some(1000), Some(1000), e.clone(), NONE));
        assert!(!run(true, Some(979), Some(1000), e, NONE));
        assert!(run(true, Some(980), Some(1000), Value::Null, NONE));
    }

    #[test]
    fn after_calibration_pinned_and_below_the_low_end() {
        let low_above = json!({"calibrationSamples":3,"inputTokensLow":1500});
        assert!(run(true, Some(1000), Some(1000), low_above, NONE));
        let low_below = json!({"calibrationSamples":3,"inputTokensLow":900});
        assert!(!run(true, Some(1000), Some(1000), low_below, NONE));
        let not_pinned = json!({"calibrationSamples":9,"inputTokensLow":5000});
        assert!(!run(true, Some(500), Some(1000), not_pinned, NONE));
    }

    #[test]
    fn explicit_signal_always_counts() {
        let t = Explicit {
            truncated: true,
            evaluated: None,
        };
        assert!(run(false, Some(1), Some(1000), Value::Null, t));
        let cut = Explicit {
            truncated: false,
            evaluated: Some(400),
        };
        assert!(run(false, Some(900), None, Value::Null, cut));
        assert!(run(true, None, None, json!({"inputTokensLow":800}), cut));
        let fine = Explicit {
            truncated: false,
            evaluated: Some(900),
        };
        assert!(!run(true, Some(900), Some(8000), Value::Null, fine));
    }

    #[test]
    fn the_probe_reads_a_cut_and_a_whole_text() {
        let text = probe_text(5000);
        assert_eq!(text.len(), 5000);
        assert!(text.starts_with("Synthetic filler line 1:"));
        // 1000-token context, 5000 characters: at least 833 tokens if nothing was cut.
        let whole = probe_verdict(5000, 1000, Some(1180), NONE);
        assert_eq!(
            whole,
            ProbeVerdict {
                truncated: false,
                measured: None
            }
        );
        let few = probe_verdict(5000, 1000, Some(700), NONE);
        assert_eq!(
            few,
            ProbeVerdict {
                truncated: true,
                measured: Some(700)
            }
        );
        let pinned = probe_verdict(5000, 1000, Some(999), NONE);
        assert_eq!(
            pinned,
            ProbeVerdict {
                truncated: true,
                measured: Some(999)
            }
        );
        let signal = Explicit {
            truncated: true,
            evaluated: Some(640),
        };
        assert_eq!(probe_verdict(5000, 1000, None, signal).measured, Some(640));
        assert!(!probe_verdict(5000, 1000, None, NONE).truncated);
    }

    #[test]
    fn remote_unknown_or_missing_data_never_suspects() {
        let e = json!({"calibrationSamples":0});
        assert!(!run(false, Some(1000), Some(1000), e.clone(), NONE));
        assert!(!run(true, None, Some(1000), e.clone(), NONE));
        assert!(!run(true, Some(1000), None, e, NONE));
        assert!(!run(true, Some(1), Some(0), Value::Null, NONE));
    }
}
