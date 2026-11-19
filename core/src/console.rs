use crate::{CommandRegistration, CommandResult, EventSink};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const MAX_HISTORY_LINES: usize = 500;
pub const MAX_LINE_BYTES: usize = 512;
pub const DEFAULT_THROTTLE_MS: u64 = 300;
const REDACTED: &str = "[REDACTED]";
const MAX_THROTTLE_ENTRIES: usize = 256;
const THROTTLE_PRUNE_AGE: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConsoleLevel {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleEvent {
    pub seq: u64,
    pub timestamp_ms: u64,
    pub job: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// Origem curta: "component", "uv", "ffmpeg", "yt-dlp", "worker", "tts", "ai", "job".
    pub origin: String,
    pub level: ConsoleLevel,
    /// Mensagem humana em PT-BR para o modo Simples.
    pub simple: String,
    /// Linha técnica sanitizada (opcional; quando ausente, o modo Técnico exibe `simple`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub technical: Option<String>,
}

pub type SharedConsoleEmitter = Arc<dyn Fn(ConsoleEvent) + Send + Sync>;
static CONSOLE_EMITTER: OnceLock<SharedConsoleEmitter> = OnceLock::new();
static CONSOLE_STORE: OnceLock<Mutex<ConsoleStore>> = OnceLock::new();

/// Installs the console event receiver once, at application startup.
pub fn set_console_emitter(emitter: SharedConsoleEmitter) -> Result<(), SharedConsoleEmitter> {
    CONSOLE_EMITTER.set(emitter)
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ConsoleKind<'a> {
    /// Marcos de início, troca de etapa, erro e conclusão (nunca sofrem throttle).
    Milestone,
    /// Linhas contínuas de progresso limitadas por janela de throttle em `(job, origin, kind)`.
    Continuous(&'a str),
}

#[allow(dead_code)]
pub(crate) struct ConsoleDraft<'a> {
    pub job: &'a str,
    pub project: Option<&'a str>,
    pub origin: &'a str,
    pub level: ConsoleLevel,
    pub kind: ConsoleKind<'a>,
    pub simple: &'a str,
    pub technical: Option<&'a str>,
}

fn global_store() -> &'static Mutex<ConsoleStore> {
    CONSOLE_STORE.get_or_init(|| {
        Mutex::new(ConsoleStore::new(
            MAX_HISTORY_LINES,
            Duration::from_millis(DEFAULT_THROTTLE_MS),
        ))
    })
}

#[allow(dead_code)]
pub(crate) fn emit_console(draft: ConsoleDraft<'_>) {
    let now_instant = Instant::now();
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let event = {
        let mut store = global_store().lock().unwrap_or_else(|e| e.into_inner());
        store.record_at(draft, now_instant, now_ms)
    };
    if let Some(ev) = event {
        #[cfg(test)]
        {
            let mut list = test_listeners()
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            list.retain(|(_, tx)| tx.send(ev.clone()).is_ok());
        }
        if let Some(emitter) = CONSOLE_EMITTER.get() {
            emitter(ev);
        }
    }
}

#[cfg(test)]
type TestConsoleListeners = Mutex<Vec<(u64, std::sync::mpsc::Sender<ConsoleEvent>)>>;

#[cfg(test)]
fn test_listeners() -> &'static TestConsoleListeners {
    static LISTENERS: OnceLock<TestConsoleListeners> = OnceLock::new();
    LISTENERS.get_or_init(|| Mutex::new(Vec::new()))
}

#[cfg(test)]
/// Captura eventos emitidos por `emit_console` em testes sem disputar o `OnceLock` global.
pub(crate) struct TestConsoleCapture {
    id: u64,
    rx: std::sync::mpsc::Receiver<ConsoleEvent>,
    collected: Mutex<Vec<ConsoleEvent>>,
}

#[cfg(test)]
impl TestConsoleCapture {
    pub(crate) fn new() -> Self {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let id = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let (tx, rx) = std::sync::mpsc::channel();
        test_listeners()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push((id, tx));
        Self {
            id,
            rx,
            collected: Mutex::new(Vec::new()),
        }
    }

    pub(crate) fn events(&self) -> Vec<ConsoleEvent> {
        let mut guard = self.collected.lock().unwrap_or_else(|e| e.into_inner());
        while let Ok(ev) = self.rx.try_recv() {
            guard.push(ev);
        }
        guard.clone()
    }

    pub(crate) fn events_for_job(&self, job: &str) -> Vec<ConsoleEvent> {
        self.events().into_iter().filter(|e| e.job == job).collect()
    }
}

#[cfg(test)]
impl Drop for TestConsoleCapture {
    fn drop(&mut self) {
        if let Ok(mut list) = test_listeners().lock() {
            list.retain(|(id, _)| *id != self.id);
        }
    }
}

#[derive(Debug)]
struct ConsoleStore {
    capacity: usize,
    throttle_window: Duration,
    next_seq: u64,
    buffer: VecDeque<ConsoleEvent>,
    last_continuous: HashMap<(String, String, String), Instant>,
}

impl ConsoleStore {
    fn new(capacity: usize, throttle_window: Duration) -> Self {
        Self {
            capacity,
            throttle_window,
            next_seq: 1,
            buffer: VecDeque::with_capacity(capacity),
            last_continuous: HashMap::new(),
        }
    }

    fn record_at(
        &mut self,
        draft: ConsoleDraft<'_>,
        now: Instant,
        timestamp_ms: u64,
    ) -> Option<ConsoleEvent> {
        if let ConsoleKind::Continuous(kind_label) = draft.kind {
            if draft.level == ConsoleLevel::Info {
                let key = (
                    draft.job.to_string(),
                    draft.origin.to_string(),
                    kind_label.to_string(),
                );
                if let Some(&prev) = self.last_continuous.get(&key) {
                    if now.saturating_duration_since(prev) < self.throttle_window {
                        return None;
                    }
                }
                if self.last_continuous.len() >= MAX_THROTTLE_ENTRIES {
                    self.last_continuous
                        .retain(|_, ts| now.saturating_duration_since(*ts) < THROTTLE_PRUNE_AGE);
                }
                self.last_continuous.insert(key, now);
            }
        }

        let simple = sanitize_line(draft.simple);
        let technical = draft
            .technical
            .map(sanitize_line)
            .filter(|line| !line.is_empty());

        let event = ConsoleEvent {
            seq: self.next_seq,
            timestamp_ms,
            job: draft.job.to_string(),
            project: draft
                .project
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToString::to_string),
            origin: draft.origin.to_string(),
            level: draft.level,
            simple,
            technical,
        };
        self.next_seq = self.next_seq.saturating_add(1);

        if self.capacity > 0 {
            if self.buffer.len() == self.capacity {
                self.buffer.pop_front();
            }
            self.buffer.push_back(event.clone());
        }

        Some(event)
    }

    fn history(&self, project: Option<&str>, limit: usize) -> Vec<ConsoleEvent> {
        let cap = limit.min(self.capacity);
        if cap == 0 {
            return Vec::new();
        }
        let mut items: Vec<ConsoleEvent> = self
            .buffer
            .iter()
            .filter(|ev| match project {
                Some(proj) => ev.project.is_none() || ev.project.as_deref() == Some(proj),
                None => true,
            })
            .cloned()
            .collect();
        if items.len() > cap {
            items.drain(..items.len() - cap);
        }
        items
    }
}

/// Sanitiza texto para exibição no console ao vivo antes de sair do núcleo:
/// remove sequências ANSI, normaliza `\r`/controles, mascara segredos e caminhos pessoais,
/// e trunca em 512 bytes UTF-8 válidos.
pub(crate) fn sanitize_line(raw: &str) -> String {
    let no_ansi = strip_ansi(raw);
    let normalized = normalize_cr_and_controls(&no_ansi);
    let redacted = redact_secrets(&normalized);
    let masked_paths = mask_personal_paths(&redacted);
    truncate_utf8(&masked_paths, MAX_LINE_BYTES)
}

fn strip_ansi(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = String::with_capacity(raw.len());
    let mut i = 0;

    while i < bytes.len() {
        let b = bytes[i];
        if b == 0x1B {
            i += 1;
            if i >= bytes.len() {
                break;
            }
            match bytes[i] {
                b'[' => {
                    // CSI: ESC [ params intermediates final_byte(0x40..=0x7E)
                    i += 1;
                    while i < bytes.len() && (0x20..=0x3F).contains(&bytes[i]) {
                        i += 1;
                    }
                    if i < bytes.len() && (0x40..=0x7E).contains(&bytes[i]) {
                        i += 1;
                    }
                }
                b']' => {
                    // OSC: ESC ] ... (BEL 0x07 or ST ESC \)
                    i += 1;
                    while i < bytes.len() {
                        if bytes[i] == 0x07 {
                            i += 1;
                            break;
                        }
                        if bytes[i] == 0x1B && i + 1 < bytes.len() && bytes[i + 1] == b'\\' {
                            i += 2;
                            break;
                        }
                        i += 1;
                    }
                }
                0x20..=0x2F => {
                    i += 1;
                    while i < bytes.len() && (0x20..=0x2F).contains(&bytes[i]) {
                        i += 1;
                    }
                    if i < bytes.len() && (0x30..=0x7E).contains(&bytes[i]) {
                        i += 1;
                    }
                }
                0x40..=0x7E => {
                    i += 1;
                }
                _ => {}
            }
            continue;
        }

        // Handle UTF-8 char (including 8-bit CSI U+009B)
        let ch = raw[i..].chars().next().unwrap();
        let ch_len = ch.len_utf8();
        if ch == '\u{009B}' {
            i += ch_len;
            while i < bytes.len() && (0x20..=0x3F).contains(&bytes[i]) {
                i += 1;
            }
            if i < bytes.len() && (0x40..=0x7E).contains(&bytes[i]) {
                i += 1;
            }
            continue;
        }
        out.push(ch);
        i += ch_len;
    }

    out
}

fn normalize_cr_and_controls(s: &str) -> String {
    let mut parts = Vec::new();
    for line in s.split('\n') {
        let chosen = line
            .split('\r')
            .rev()
            .map(|seg| seg.trim_matches(|c: char| c == ' ' || c == '\t'))
            .find(|seg| !seg.chars().all(|c| c.is_control()));

        if let Some(seg) = chosen {
            let cleaned: String = seg
                .chars()
                .filter(|&c| !c.is_control() || c == '\t')
                .collect();
            let trimmed = cleaned.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        }
    }
    parts.join(" ")
}

fn is_boundary_before(s: &str, idx: usize) -> bool {
    if idx == 0 {
        return true;
    }
    let prev = s[..idx].chars().next_back().unwrap();
    !prev.is_ascii_alphanumeric() && prev != '_' && prev != '-'
}

fn is_alnum_boundary_before(s: &str, idx: usize) -> bool {
    if idx == 0 {
        return true;
    }
    let prev = s[..idx].chars().next_back().unwrap();
    !prev.is_ascii_alphanumeric()
}

fn starts_with_ascii_ci(s: &str, prefix: &str) -> bool {
    s.len() >= prefix.len()
        && s.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
}

fn skip_spaces(s: &str, mut i: usize) -> usize {
    let b = s.as_bytes();
    while i < b.len() && (b[i] == b' ' || b[i] == b'\t') {
        i += 1;
    }
    i
}

fn consume_token_value(s: &str, start: usize) -> usize {
    let b = s.as_bytes();
    let mut i = start;
    while i < b.len() {
        let ch = b[i];
        if ch.is_ascii_whitespace()
            || matches!(ch, b';' | b',' | b'"' | b'\'' | b')' | b']' | b'>')
        {
            break;
        }
        i += 1;
    }
    i
}

fn consume_query_value(s: &str, start: usize) -> usize {
    let b = s.as_bytes();
    let mut i = start;
    while i < b.len() {
        let ch = b[i];
        if ch.is_ascii_whitespace()
            || matches!(ch, b'&' | b';' | b',' | b'"' | b'\'' | b')' | b']' | b'>' | b'#')
        {
            break;
        }
        i += 1;
    }
    i
}

fn is_token_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn match_known_key_prefix(rest: &str) -> Option<usize> {
    if let Some(after) = rest.strip_prefix("sk-ant-") {
        let len = after.bytes().take_while(|&b| is_token_char(b)).count();
        if len >= 6 {
            return Some("sk-ant-".len() + len);
        }
    }
    if let Some(after) = rest.strip_prefix("sk-") {
        let len = after.bytes().take_while(|&b| is_token_char(b)).count();
        if len >= 6 {
            return Some("sk-".len() + len);
        }
    }
    if let Some(after) = rest.strip_prefix("AIza") {
        let len = after.bytes().take_while(|&b| is_token_char(b)).count();
        if len >= 10 {
            return Some("AIza".len() + len);
        }
    }
    if let Some(after) = rest.strip_prefix("gsk_") {
        let len = after.bytes().take_while(|&b| is_token_char(b)).count();
        if len >= 10 {
            return Some("gsk_".len() + len);
        }
    }
    for prefix in ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "hf_"] {
        if let Some(after) = rest.strip_prefix(prefix) {
            let len = after.bytes().take_while(|b| b.is_ascii_alphanumeric()).count();
            if len >= 10 {
                return Some(prefix.len() + len);
            }
        }
    }
    if let Some(after) = rest.strip_prefix("github_pat_") {
        let len = after
            .bytes()
            .take_while(|&b| b.is_ascii_alphanumeric() || b == b'_')
            .count();
        if len >= 10 {
            return Some("github_pat_".len() + len);
        }
    }
    if let Some(after) = rest.strip_prefix("glpat-") {
        let len = after.bytes().take_while(|&b| is_token_char(b)).count();
        if len >= 10 {
            return Some("glpat-".len() + len);
        }
    }
    for prefix in ["xoxb-", "xoxp-", "xoxa-", "xoxr-", "xoxs-"] {
        if let Some(after) = rest.strip_prefix(prefix) {
            let len = after.bytes().take_while(|&b| is_token_char(b)).count();
            if len >= 10 {
                return Some(prefix.len() + len);
            }
        }
    }
    if rest.starts_with("eyJ") {
        let bytes = rest.as_bytes();
        let mut p1 = 3;
        while p1 < bytes.len() && is_token_char(bytes[p1]) {
            p1 += 1;
        }
        if p1 >= 11 && p1 < bytes.len() && bytes[p1] == b'.' {
            let mut p2 = p1 + 1;
            while p2 < bytes.len() && is_token_char(bytes[p2]) {
                p2 += 1;
            }
            if p2 - (p1 + 1) >= 8 && p2 < bytes.len() && bytes[p2] == b'.' {
                let mut p3 = p2 + 1;
                while p3 < bytes.len() && is_token_char(bytes[p3]) {
                    p3 += 1;
                }
                if p3 - (p2 + 1) >= 4 {
                    return Some(p3);
                }
            }
        }
    }
    None
}

fn redact_secrets(s: &str) -> String {
    const SENSITIVE_HEADERS: &[&str] = &[
        "proxy-authorization",
        "x-goog-api-key",
        "x-access-token",
        "x-auth-token",
        "x-api-key",
        "api-key",
    ];
    const QUERY_SECRET_KEYS: &[&str] = &[
        "x-amz-security-token",
        "x-amz-signature",
        "x-amz-credential",
        "x-goog-signature",
        "x-goog-credential",
        "refresh_token",
        "access_token",
        "client_secret",
        "session_id",
        "auth_token",
        "signature",
        "id_token",
        "password",
        "api_key",
        "apikey",
        "cookies",
        "session",
        "passwd",
        "secret",
        "cookie",
        "token",
        "auth",
        "pwd",
        "key",
        "sig",
    ];

    let mut out = String::with_capacity(s.len());
    let mut i = 0;

    while i < s.len() {
        let rest = &s[i..];

        // 1. Cookie / Set-Cookie header
        if is_boundary_before(s, i) {
            let cookie_header = if starts_with_ascii_ci(rest, "set-cookie") {
                Some("set-cookie".len())
            } else if starts_with_ascii_ci(rest, "cookie") {
                Some("cookie".len())
            } else {
                None
            };
            if let Some(hlen) = cookie_header {
                let after_name = skip_spaces(s, i + hlen);
                if after_name < s.len() && s.as_bytes()[after_name] == b':' {
                    let quote = if i > 0 && matches!(s.as_bytes()[i - 1], b'"' | b'\'') {
                        Some(s.as_bytes()[i - 1])
                    } else {
                        None
                    };
                    out.push_str(&s[i..i + hlen]);
                    out.push_str(": ");
                    out.push_str(REDACTED);
                    if let Some(q) = quote {
                        let mut j = after_name + 1;
                        while j < s.len() && s.as_bytes()[j] != q {
                            j += 1;
                        }
                        i = j;
                    } else {
                        i = s.len();
                    }
                    continue;
                }
            }
        }

        // 2. Authorization header
        if is_boundary_before(s, i) && starts_with_ascii_ci(rest, "authorization") {
            let hlen = "authorization".len();
            let after_name = skip_spaces(s, i + hlen);
            if after_name < s.len() && matches!(s.as_bytes()[after_name], b':' | b'=') {
                let sep = s.as_bytes()[after_name] as char;
                let val_start = skip_spaces(s, after_name + 1);
                let val_rest = &s[val_start..];
                let scheme_len = ["bearer", "basic", "token", "digest"]
                    .iter()
                    .find(|&&sch| {
                        starts_with_ascii_ci(val_rest, sch)
                            && val_rest
                                .as_bytes()
                                .get(sch.len())
                                .is_some_and(|b| b.is_ascii_whitespace())
                    })
                    .map(|sch| sch.len());

                out.push_str(&s[i..i + hlen]);
                out.push(sep);
                if sep == ':' {
                    out.push(' ');
                }
                if let Some(slen) = scheme_len {
                    out.push_str(&s[val_start..val_start + slen]);
                    out.push(' ');
                    let tok_start = skip_spaces(s, val_start + slen);
                    let tok_end = consume_token_value(s, tok_start);
                    out.push_str(REDACTED);
                    i = tok_end.max(tok_start);
                } else {
                    let tok_end = consume_token_value(s, val_start);
                    out.push_str(REDACTED);
                    i = tok_end.max(val_start);
                }
                continue;
            }
        }

        // 3. Standalone Bearer <token>
        if is_boundary_before(s, i) && starts_with_ascii_ci(rest, "bearer") {
            let after = i + "bearer".len();
            if after < s.len() && matches!(s.as_bytes()[after], b' ' | b'\t') {
                let tok_start = skip_spaces(s, after);
                if tok_start < s.len() && !s[tok_start..].starts_with(REDACTED) {
                    let tok_end = consume_token_value(s, tok_start);
                    if tok_end > tok_start {
                        out.push_str(&s[i..after]);
                        out.push(' ');
                        out.push_str(REDACTED);
                        i = tok_end;
                        continue;
                    }
                }
            }
        }

        // 4. Sensitive API-key headers
        if is_boundary_before(s, i) {
            if let Some(&hdr) = SENSITIVE_HEADERS
                .iter()
                .find(|&&h| starts_with_ascii_ci(rest, h))
            {
                let after_name = skip_spaces(s, i + hdr.len());
                if after_name < s.len() && matches!(s.as_bytes()[after_name], b':' | b'=') {
                    let sep = s.as_bytes()[after_name] as char;
                    let mut val_start = skip_spaces(s, after_name + 1);
                    let mut quote_char = None;
                    if val_start < s.len() && matches!(s.as_bytes()[val_start], b'"' | b'\'') {
                        quote_char = Some(s.as_bytes()[val_start]);
                        val_start += 1;
                    }
                    let val_end = if let Some(q) = quote_char {
                        let mut j = val_start;
                        while j < s.len() && s.as_bytes()[j] != q {
                            j += 1;
                        }
                        if j < s.len() {
                            j + 1
                        } else {
                            j
                        }
                    } else {
                        consume_token_value(s, val_start)
                    };
                    if val_end > val_start {
                        out.push_str(&s[i..i + hdr.len()]);
                        out.push(sep);
                        if sep == ':' {
                            out.push(' ');
                        }
                        out.push_str(REDACTED);
                        i = val_end;
                        continue;
                    }
                }
            }
        }

        // 5. URL query params / key=value secrets
        if is_boundary_before(s, i) {
            if let Some(&param) = QUERY_SECRET_KEYS
                .iter()
                .find(|&&k| starts_with_ascii_ci(rest, k))
            {
                let eq_pos = i + param.len();
                if eq_pos < s.len() && s.as_bytes()[eq_pos] == b'=' {
                    let val_start = eq_pos + 1;
                    let val_end = consume_query_value(s, val_start);
                    if val_end > val_start {
                        out.push_str(&s[i..eq_pos + 1]);
                        out.push_str(REDACTED);
                        i = val_end;
                        continue;
                    }
                }
            }
        }

        // 6. Known API key prefixes
        if is_alnum_boundary_before(s, i) {
            if let Some(len) = match_known_key_prefix(rest) {
                out.push_str(REDACTED);
                i += len;
                continue;
            }
        }

        // 7. Long hex tokens (>= 32 hex chars containing at least one digit)
        if is_alnum_boundary_before(s, i) {
            let hex_len = rest.bytes().take_while(|b| b.is_ascii_hexdigit()).count();
            if hex_len >= 32 {
                let after = i + hex_len;
                let bounded_after = after == s.len() || !s.as_bytes()[after].is_ascii_alphanumeric();
                let has_digit = rest.as_bytes()[..hex_len]
                    .iter()
                    .any(|b| b.is_ascii_digit());
                if bounded_after && has_digit {
                    out.push_str(REDACTED);
                    i = after;
                    continue;
                }
            }
        }

        let ch = rest.chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }

    out
}

fn env_home_prefixes() -> Vec<String> {
    let mut prefixes = Vec::new();
    for var in ["USERPROFILE", "HOME"] {
        if let Some(val) = std::env::var_os(var) {
            if let Some(s) = val.to_str() {
                let trimmed = s.trim_end_matches(['\\', '/']);
                if trimmed.len() > 1 {
                    prefixes.push(trimmed.to_string());
                    if trimmed.contains('\\') {
                        prefixes.push(trimmed.replace('\\', "/"));
                    }
                }
            }
        }
    }
    prefixes.sort_by_key(|b| std::cmp::Reverse(b.len()));
    prefixes.dedup();
    prefixes
}

fn match_windows_user_end(s: &str, user_start: usize) -> usize {
    let bytes = s.as_bytes();
    let max_scan = (user_start + 64).min(bytes.len());
    let mut j = user_start;
    let mut found_sep = None;
    while j < max_scan {
        let b = bytes[j];
        if b == b'\\' || b == b'/' {
            found_sep = Some(j);
            break;
        }
        if matches!(
            b,
            b'"' | b'\'' | b'<' | b'>' | b'\r' | b'\n' | b'\t' | b':' | b';' | b'*' | b'|'
        ) {
            break;
        }
        j += 1;
    }
    if let Some(sep_idx) = found_sep {
        if sep_idx > user_start {
            return sep_idx;
        }
    }
    let mut k = user_start;
    while k < bytes.len() {
        let b = bytes[k];
        if b.is_ascii_whitespace()
            || matches!(
                b,
                b'\\' | b'/' | b'"' | b'\'' | b'<' | b'>' | b':' | b';' | b'*' | b'|' | b')' | b']'
            )
        {
            break;
        }
        k += 1;
    }
    k
}

fn match_unix_user_end(s: &str, user_start: usize) -> usize {
    let bytes = s.as_bytes();
    let mut k = user_start;
    while k < bytes.len() {
        let b = bytes[k];
        if b.is_ascii_whitespace()
            || matches!(b, b'/' | b'"' | b'\'' | b'<' | b'>' | b'|' | b';' | b',' | b')' | b']')
        {
            break;
        }
        k += 1;
    }
    k
}

fn mask_personal_paths(s: &str) -> String {
    let env_prefixes = env_home_prefixes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;

    while i < s.len() {
        let rest = &s[i..];

        // 1. Explicit $USERPROFILE / $HOME match
        if is_alnum_boundary_before(s, i) {
            let mut matched_env = None;
            for pref in &env_prefixes {
                let ci = pref.as_bytes().get(1) == Some(&b':');
                let matches = if ci {
                    starts_with_ascii_ci(rest, pref)
                } else {
                    rest.starts_with(pref.as_str())
                };
                if matches {
                    let after = i + pref.len();
                    let bounded = after == s.len()
                        || matches!(
                            s.as_bytes()[after],
                            b'\\' | b'/' | b'"' | b'\'' | b';' | b',' | b')' | b']' | b'>'
                        )
                        || s.as_bytes()[after].is_ascii_whitespace();
                    if bounded {
                        matched_env = Some(after);
                        break;
                    }
                }
            }
            if let Some(end) = matched_env {
                out.push('~');
                i = end;
                continue;
            }
        }

        // 2. Windows path: X:\Users\<user> or X:/Users/<user>
        if is_alnum_boundary_before(s, i)
            && rest.len() >= 9
            && rest.as_bytes()[0].is_ascii_alphabetic()
            && rest.as_bytes()[1] == b':'
            && matches!(rest.as_bytes()[2], b'\\' | b'/')
            && starts_with_ascii_ci(&rest[3..], "users")
            && matches!(rest.as_bytes()[8], b'\\' | b'/')
        {
            let user_start = i + 9;
            let user_end = match_windows_user_end(s, user_start);
            if user_end > user_start {
                out.push('~');
                i = user_end;
                continue;
            }
        }

        // 3. Git Bash / MSYS path: /c/Users/<user>
        if is_alnum_boundary_before(s, i)
            && rest.len() >= 9
            && rest.as_bytes()[0] == b'/'
            && rest.as_bytes()[1].is_ascii_alphabetic()
            && rest.as_bytes()[2] == b'/'
            && starts_with_ascii_ci(&rest[3..], "users/")
        {
            let user_start = i + 9;
            let user_end = match_windows_user_end(s, user_start);
            if user_end > user_start {
                out.push('~');
                i = user_end;
                continue;
            }
        }

        // 4. Unix/macOS home path: /home/<user> or /Users/<user>
        let unix_boundary = i == 0 || {
            let prev = s[..i].chars().next_back().unwrap();
            !prev.is_ascii_alphanumeric() && !matches!(prev, '_' | '-' | '.')
        };
        if unix_boundary {
            let prefix_len = if rest.starts_with("/home/") {
                Some("/home/".len())
            } else if rest.starts_with("/Users/") {
                Some("/Users/".len())
            } else {
                None
            };
            if let Some(plen) = prefix_len {
                let user_start = i + plen;
                let user_end = match_unix_user_end(s, user_start);
                if user_end > user_start {
                    out.push('~');
                    i = user_end;
                    continue;
                }
            }
        }

        let ch = rest.chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }

    out
}

fn truncate_utf8(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    const ELLIPSIS: char = '…';
    let mut end = max_bytes.saturating_sub(ELLIPSIS.len_utf8());
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = s[..end].to_string();
    out.push(ELLIPSIS);
    out
}

fn console_history(arguments: Value, _events: &mut EventSink<'_>) -> CommandResult {
    let project = arguments
        .get("project")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let limit = arguments
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| (n as usize).clamp(1, MAX_HISTORY_LINES))
        .unwrap_or(MAX_HISTORY_LINES);

    let items = {
        let store = global_store().lock().unwrap_or_else(|e| e.into_inner());
        store.history(project, limit)
    };
    Ok(json!({ "items": items }))
}

inventory::submit! { CommandRegistration { name: "console.history", execute: console_history } }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_api_keys_bearer_cookies_query_tokens_and_long_hex() {
        let cases = [
            (
                "OpenAI sk-proj-abc1234567890xyz failed",
                "OpenAI [REDACTED] failed",
            ),
            (
                "Anthropic sk-ant-api03-secretkey12345",
                "Anthropic [REDACTED]",
            ),
            (
                "Google AIzaSyDummyKey1234567890abcdef",
                "Google [REDACTED]",
            ),
            (
                "Groq gsk_dummysecret1234567890abcdef",
                "Groq [REDACTED]",
            ),
            (
                "GitHub ghp_1234567890abcdef123456 and hf_1234567890abcdef12",
                "GitHub [REDACTED] and [REDACTED]",
            ),
            (
                "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload12345.sig99",
                "Authorization: Bearer [REDACTED]",
            ),
            (
                "Sending header Bearer super_secret_token_value",
                "Sending header Bearer [REDACTED]",
            ),
            (
                "x-api-key: my-secret-header-key-99",
                "x-api-key: [REDACTED]",
            ),
            (
                "Cookie: session=abc123; csrftoken=xyz789",
                "Cookie: [REDACTED]",
            ),
            (
                "< Set-Cookie: sid=topsecret; HttpOnly; Path=/",
                "< Set-Cookie: [REDACTED]",
            ),
            (
                "GET https://cdn.example.com/v?format=mp4&token=sec123&sig=abc999&key=k1&cookie=c2&auth=a3&api_key=ak4&signature=s5&secret=ss6&ok=1",
                "GET https://cdn.example.com/v?format=mp4&token=[REDACTED]&sig=[REDACTED]&key=[REDACTED]&cookie=[REDACTED]&auth=[REDACTED]&api_key=[REDACTED]&signature=[REDACTED]&secret=[REDACTED]&ok=1",
            ),
            (
                "Media http://127.0.0.1:45678/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/clip/1",
                "Media http://127.0.0.1:45678/[REDACTED]/clip/1",
            ),
            (
                "JWT standalone eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
                "JWT standalone [REDACTED]",
            ),
        ];

        for (input, expected) in cases {
            assert_eq!(sanitize_line(input), expected, "input: {input}");
        }
    }

    #[test]
    fn masks_personal_paths_with_tilde() {
        assert_eq!(
            sanitize_line(r"Abrindo C:\Users\Maria\AppData\Local\Clipes\ffmpeg.exe"),
            r"Abrindo ~\AppData\Local\Clipes\ffmpeg.exe"
        );
        assert_eq!(
            sanitize_line(r"Workspace C:\Users\Windows 11\orca\video.mp4"),
            r"Workspace ~\orca\video.mp4"
        );
        assert_eq!(
            sanitize_line(r"Entre C:\Users\Alice e C:\Users\Bob\file.txt"),
            r"Entre ~ e ~\file.txt"
        );
        assert_eq!(
            sanitize_line("Abrindo /home/joao/.local/share/clipes/worker"),
            "Abrindo ~/.local/share/clipes/worker"
        );
        assert_eq!(
            sanitize_line("Abrindo /Users/ana/Movies/live.mp4"),
            "Abrindo ~/Movies/live.mp4"
        );
        // URL /home/ não deve ser mascarada como caminho pessoal.
        assert_eq!(
            sanitize_line("GET https://example.com/home/docs"),
            "GET https://example.com/home/docs"
        );
    }

    #[test]
    fn strips_ansi_control_chars_and_normalizes_carriage_returns() {
        let ansi = "\x1b[32mResolved\x1b[0m \x1b]0;title\x07\x1b[1;34m42 packages\x1b[0m";
        assert_eq!(sanitize_line(ansi), "Resolved 42 packages");

        let cr = "Baixando 10%   \rBaixando 55%   \rBaixando 100%\r";
        assert_eq!(sanitize_line(cr), "Baixando 100%");

        let crlf = "Linha 1\r\nLinha 2\x00\x07";
        assert_eq!(sanitize_line(crlf), "Linha 1 Linha 2");
    }

    #[test]
    fn truncates_lines_above_512_utf8_bytes_on_valid_boundary() {
        let mut s = "á".repeat(300); // 600 bytes UTF-8 (2 bytes per char)
        s.push_str("fim");
        let out = sanitize_line(&s);
        assert!(out.len() <= MAX_LINE_BYTES);
        assert!(out.ends_with('…'));
        assert!(std::str::from_utf8(out.as_bytes()).is_ok());

        let exact = "a".repeat(MAX_LINE_BYTES);
        assert_eq!(sanitize_line(&exact), exact);
    }

    #[test]
    fn ring_buffer_is_fifo_with_500_limit_and_isolates_projects() {
        let mut store = ConsoleStore::new(500, Duration::from_millis(300));
        let t0 = Instant::now();
        for i in 0..550 {
            let project = if i % 3 == 0 {
                None
            } else if i % 3 == 1 {
                Some("proj-a")
            } else {
                Some("proj-b")
            };
            let msg = format!("linha {i}");
            store.record_at(
                ConsoleDraft {
                    job: "job-1",
                    project,
                    origin: "job",
                    level: ConsoleLevel::Info,
                    kind: ConsoleKind::Milestone,
                    simple: &msg,
                    technical: None,
                },
                t0,
                1000 + i as u64,
            );
        }

        let all = store.history(None, 500);
        assert_eq!(all.len(), 500);
        assert_eq!(all.first().unwrap().simple, "linha 50");
        assert_eq!(all.last().unwrap().simple, "linha 549");
        assert_eq!(all.first().unwrap().seq, 51);
        assert_eq!(all.last().unwrap().seq, 550);

        let proj_a = store.history(Some("proj-a"), 500);
        assert!(!proj_a.is_empty());
        assert!(proj_a
            .iter()
            .all(|e| e.project.is_none() || e.project.as_deref() == Some("proj-a")));
        assert!(proj_a.iter().any(|e| e.project.is_none()));
        assert!(proj_a.iter().any(|e| e.project.as_deref() == Some("proj-a")));

        let limited = store.history(None, 5);
        assert_eq!(limited.len(), 5);
        assert_eq!(limited.first().unwrap().simple, "linha 545");
        assert_eq!(limited.last().unwrap().simple, "linha 549");
    }

    #[test]
    fn throttles_continuous_lines_per_job_origin_kind_but_never_milestones_or_errors() {
        let mut store = ConsoleStore::new(500, Duration::from_millis(300));
        let t0 = Instant::now();

        let e1 = store.record_at(
            ConsoleDraft {
                job: "ffmpeg-1",
                project: None,
                origin: "ffmpeg",
                level: ConsoleLevel::Info,
                kind: ConsoleKind::Continuous("progress"),
                simple: "10%",
                technical: Some("frame=10"),
            },
            t0,
            100,
        );
        assert!(e1.is_some());

        let e2 = store.record_at(
            ConsoleDraft {
                job: "ffmpeg-1",
                project: None,
                origin: "ffmpeg",
                level: ConsoleLevel::Info,
                kind: ConsoleKind::Continuous("progress"),
                simple: "20%",
                technical: Some("frame=20"),
            },
            t0 + Duration::from_millis(150),
            250,
        );
        assert!(e2.is_none());

        let e_other_job = store.record_at(
            ConsoleDraft {
                job: "ffmpeg-2",
                project: None,
                origin: "ffmpeg",
                level: ConsoleLevel::Info,
                kind: ConsoleKind::Continuous("progress"),
                simple: "5%",
                technical: Some("frame=5"),
            },
            t0 + Duration::from_millis(150),
            250,
        );
        assert!(e_other_job.is_some());

        let e_err = store.record_at(
            ConsoleDraft {
                job: "ffmpeg-1",
                project: None,
                origin: "ffmpeg",
                level: ConsoleLevel::Error,
                kind: ConsoleKind::Continuous("progress"),
                simple: "Erro!",
                technical: None,
            },
            t0 + Duration::from_millis(180),
            280,
        );
        assert!(e_err.is_some());

        let e_milestone = store.record_at(
            ConsoleDraft {
                job: "ffmpeg-1",
                project: None,
                origin: "ffmpeg",
                level: ConsoleLevel::Info,
                kind: ConsoleKind::Milestone,
                simple: "Concluído",
                technical: None,
            },
            t0 + Duration::from_millis(190),
            290,
        );
        assert!(e_milestone.is_some());

        let e3 = store.record_at(
            ConsoleDraft {
                job: "ffmpeg-1",
                project: None,
                origin: "ffmpeg",
                level: ConsoleLevel::Info,
                kind: ConsoleKind::Continuous("progress"),
                simple: "50%",
                technical: Some("frame=50"),
            },
            t0 + Duration::from_millis(300),
            400,
        );
        assert!(e3.is_some());
    }

    #[test]
    fn store_sanitizes_before_buffering_and_emitting() {
        let mut store = ConsoleStore::new(500, Duration::from_millis(300));
        let t0 = Instant::now();
        let ev = store
            .record_at(
                ConsoleDraft {
                    job: "worker",
                    project: Some("p1"),
                    origin: "uv",
                    level: ConsoleLevel::Info,
                    kind: ConsoleKind::Milestone,
                    simple: r"Usando C:\Users\Alice\env com sk-proj-secret123456",
                    technical: Some("\x1b[33mAuthorization: Bearer topsecret999\x1b[0m"),
                },
                t0,
                500,
            )
            .expect("milestone must emit");

        assert_eq!(ev.simple, r"Usando ~\env com [REDACTED]");
        assert_eq!(
            ev.technical.as_deref(),
            Some("Authorization: Bearer [REDACTED]")
        );
        let history = store.history(Some("p1"), 10);
        assert_eq!(history.len(), 1);
        assert_eq!(history[0], ev);
    }

    #[test]
    fn dispatch_console_history_returns_sanitized_items_and_filters_by_project() {
        let _dir = tempfile::tempdir().expect("tempdir");
        let _guard = crate::test_env::set_data_dir(_dir.path());
        static EMITTED: OnceLock<Mutex<Vec<ConsoleEvent>>> = OnceLock::new();
        let captured = EMITTED.get_or_init(|| Mutex::new(Vec::new()));
        let _ = set_console_emitter(Arc::new(move |ev| {
            captured.lock().unwrap().push(ev);
        }));

        emit_console(ConsoleDraft {
            job: "hist-test-global",
            project: None,
            origin: "component",
            level: ConsoleLevel::Warn,
            kind: ConsoleKind::Milestone,
            simple: "Global sk-proj-secret123456",
            technical: Some("\x1b[31m\x1b[0m"),
        });
        emit_console(ConsoleDraft {
            job: "hist-test-p1",
            project: Some("console-hist-p1"),
            origin: "job",
            level: ConsoleLevel::Info,
            kind: ConsoleKind::Milestone,
            simple: "Projeto 1",
            technical: None,
        });
        emit_console(ConsoleDraft {
            job: "hist-test-p2",
            project: Some("console-hist-p2"),
            origin: "job",
            level: ConsoleLevel::Info,
            kind: ConsoleKind::Milestone,
            simple: "Projeto 2",
            technical: None,
        });

        let emitted_list = EMITTED.get().unwrap().lock().unwrap().clone();
        assert!(emitted_list
            .iter()
            .any(|ev| ev.job == "hist-test-global" && ev.simple == "Global [REDACTED]"));

        let res = crate::dispatch(
            "console.history",
            json!({ "project": "console-hist-p1" }),
            &mut |_| {},
        )
        .expect("console.history must succeed");

        let items = res["items"].as_array().expect("items array");
        let global = items
            .iter()
            .find(|item| item["job"] == "hist-test-global")
            .expect("global item must be present");
        assert_eq!(global["simple"], "Global [REDACTED]");
        assert_eq!(global["level"], "warn");
        assert!(global.get("timestampMs").is_some());
        assert!(global.get("technical").is_none());
        assert!(items.iter().any(|item| item["job"] == "hist-test-p1"));
        assert!(!items.iter().any(|item| item["job"] == "hist-test-p2"));

        // Console ao vivo nunca grava em diagnostic.log nem entra em diagnostic.get (ADR-0006).
        assert!(!_dir.path().join("diagnostic.log").exists());
        let diag = crate::dispatch("diagnostic.get", json!({}), &mut |_| {})
            .expect("diagnostic.get must succeed");
        let diag_str = diag.to_string();
        assert!(!diag_str.contains("hist-test-global"));
        assert!(!diag_str.contains("Projeto 1"));
    }
}
