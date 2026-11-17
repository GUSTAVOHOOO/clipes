//! Chat da live como sinal na seleção de Cortes (#151), ao lado da energia do áudio (#54).
//!
//! **Fluxo.** Uma Fonte importada por URL ganha um job `chat` na fila do Projeto (também por
//! `chat.fetch {source_id}`, "buscar o chat depois"). O job pede ao yt-dlp só o replay do chat
//! (`--skip-download --write-subs --sub-langs live_chat`), guarda o arquivo bruto **ao lado da
//! mídia da Fonte** (`<nome>.live_chat.json`, local) e o agrega numa série por intervalo. Vídeo
//! sem replay não é erro: a Fonte fica marcada como sem chat. Fonte local não tem o que buscar.
//!
//! **Privacidade.** O Projeto (SQLite) guarda só a série agregada: pessoas distintas, mensagens,
//! Super Chats e contagens de reação por intervalo. Texto de mensagem e identificador de autor
//! existem só em memória durante a agregação (os autores servem para contar pessoas distintas e
//! nunca são gravados, nem em hash). Nada disso vai para o Provedor nem para log: o Provedor só
//! recebe a marca `[chat 3,1× · risadas]` ([`mark`]).
//!
//! **Pico.** Medido contra a mediana móvel da própria Fonte ([`peaks`]), nunca contra um número
//! absoluto: o público muda muito entre canais. O chat chega depois do momento, então a marca
//! aponta [`REACTION_DELAY_US`] para trás ([`marks_for_sentences`]). As constantes abaixo são os
//! valores iniciais e serão calibradas no #57.

use crate::{
    jobs::{self, preview},
    projects,
    sentences::Sentence,
    CommandRegistration, CommandResult, CoreError, EventSink,
};
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};

/// Tipo do job na fila.
pub const JOB_KIND: &str = "chat";
/// Versão do método de agregação; uma série de outra versão é refeita pelo job.
pub const METHOD: i64 = 1;

/// Intervalo da série (10 s). Calibrado no #57. Uma série guarda o intervalo com que foi feita.
pub const INTERVAL_US: i64 = 10_000_000;
/// Janela da mediana móvel (10 min, centrada em cada intervalo e cortada nas pontas da Fonte).
pub const MEDIAN_WINDOW_US: i64 = 600_000_000;
/// Pico: pessoas distintas no intervalo ≥ esta razão × a mediana móvel (2,0×).
pub const PEAK_RATIO: f64 = 2.0;
/// Piso da mediana na razão: um chat quase mudo (mediana 0) não faz qualquer dupla virar pico.
pub const BASELINE_FLOOR: f64 = 1.0;
/// Guarda de ruído: menos pessoas que isto no intervalo nunca é pico, qualquer que seja a razão.
pub const MIN_PEAK_PEOPLE: u32 = 4;
/// Atraso de reação: o chat responde depois do momento, e a marca aponta 10 s para trás.
pub const REACTION_DELAY_US: i64 = 10_000_000;
/// Mensagem idêntica do mesmo autor dentro desta janela é repetição (spam) e é ignorada.
pub const REPEAT_WINDOW_US: i64 = 60_000_000;

/// Rótulo de reação: só aparece quando a reação **domina** o intervalo, isto é, quando ao menos
/// este percentual das mensagens do intervalo a traz...
pub const REACTION_DOMINANCE_PERCENT: u32 = 40;
/// ... e há pelo menos estas mensagens com ela (poucas mensagens não dominam nada).
pub const REACTION_MIN_MESSAGES: u32 = 3;
/// Mínimo de `k` seguidos para contar como risada (`kkk`, `kkkk`...).
pub const LAUGH_MIN_K: usize = 3;
/// Mínimo de `?` seguidos para contar como surpresa (`???`, `????`...).
pub const SURPRISE_MIN_QUESTION_MARKS: usize = 3;

/// Reação dominante de um intervalo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Reaction {
    Laugh,
    Surprise,
    Clip,
}

impl Reaction {
    /// Rótulo do texto enviado ao Provedor.
    pub fn label(self) -> &'static str {
        match self {
            Reaction::Laugh => "risadas",
            Reaction::Surprise => "surpresa",
            Reaction::Clip => "pedido de clip",
        }
    }
    /// Chave estável (JSON da UI e dos candidatos).
    pub fn key(self) -> &'static str {
        match self {
            Reaction::Laugh => "laugh",
            Reaction::Surprise => "surprise",
            Reaction::Clip => "clip",
        }
    }
}

/// Agregado de um intervalo da série. É tudo o que o Projeto guarda do chat.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Interval {
    pub people: u32,
    pub messages: u32,
    pub paid: u32,
    pub laugh: u32,
    pub surprise: u32,
    pub clip: u32,
}

impl Interval {
    /// A reação que domina o intervalo, se alguma domina (empate: risada, surpresa, clip).
    pub fn dominant(&self) -> Option<Reaction> {
        [
            (Reaction::Laugh, self.laugh),
            (Reaction::Surprise, self.surprise),
            (Reaction::Clip, self.clip),
        ]
        .into_iter()
        .filter(|(_, n)| {
            *n >= REACTION_MIN_MESSAGES
                && u64::from(*n) * 100
                    >= u64::from(self.messages) * u64::from(REACTION_DOMINANCE_PERCENT)
        })
        .max_by_key(|(r, n)| (*n, std::cmp::Reverse(*r)))
        .map(|(r, _)| r)
    }
}

/// Um pico de pessoas distintas num intervalo da série.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Peak {
    pub interval: usize,
    pub people: u32,
    /// Razão sobre a mediana móvel, em décimos (31 = 3,1×).
    pub ratio_tenths: u32,
    pub reaction: Option<Reaction>,
}

/// Marca de chat de uma Frase: o pico que ela cobre (já deslocado pelo atraso de reação).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChatMark {
    pub interval: u32,
    pub ratio_tenths: u32,
    pub reaction: Option<Reaction>,
    /// Início do momento a que o pico se refere (início do intervalo menos o atraso), em µs.
    pub at_us: i64,
}

/// Marcas por ID de Frase.
pub type ChatMarks = BTreeMap<i64, ChatMark>;

/// **A marca do texto enviado ao Provedor** (ADR-0008: só texto fixo e números): `[chat 3,1×]` ou
/// `[chat 3,1× · risadas]`. Nunca carrega texto de mensagem nem nome de autor. É montada aqui e
/// posta na linha da Frase por `sentences::line`, depois da marca de energia (#54).
pub fn mark(m: &ChatMark) -> String {
    let ratio = format!("{}", f64::from(m.ratio_tenths) / 10.0);
    let ratio = if ratio.contains('.') {
        ratio.replace('.', ",")
    } else {
        format!("{ratio},0")
    };
    match m.reaction {
        Some(r) => format!("[chat {ratio}× · {}]", r.label()),
        None => format!("[chat {ratio}×]"),
    }
}

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

fn chat_failed() -> CoreError {
    error("chat_failed", "Não foi possível buscar o chat da live.")
}

inventory::submit! { projects::Migration { id: "0151_001_chat", sql: "
CREATE TABLE chat_replays (
  source_id INTEGER PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('available','absent')),
  method INTEGER NOT NULL,
  interval_us INTEGER NOT NULL,
  intervals INTEGER NOT NULL,
  messages INTEGER NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE chat_series (
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  people INTEGER NOT NULL,
  messages INTEGER NOT NULL,
  paid INTEGER NOT NULL,
  laugh INTEGER NOT NULL,
  surprise INTEGER NOT NULL,
  clip INTEGER NOT NULL,
  PRIMARY KEY (source_id, idx)
) WITHOUT ROWID;
ALTER TABLE selection_runs ADD COLUMN chat_marks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE selection_candidates ADD COLUMN chat_marks TEXT;
" } }

// ---------------------------------------------------------------- leitura do replay (pura)

/// Uma mensagem do replay, só em memória durante a agregação.
pub struct ChatMessage {
    pub offset_us: i64,
    pub author: String,
    pub text: String,
    pub paid: bool,
}

fn offset_ms(value: &Value) -> Option<i64> {
    match value {
        Value::String(s) => s.trim().parse().ok(),
        Value::Number(n) => n.as_i64(),
        _ => None,
    }
}

/// Texto das `runs` (`text` ou `emoji`) ou do `simpleText`. Emoji entra pelo atalho (`:KEKW:`) ou
/// pelo próprio caractere.
fn message_text(message: &Value) -> String {
    if let Some(s) = message["simpleText"].as_str() {
        return s.to_owned();
    }
    let mut out = String::new();
    for run in message["runs"].as_array().into_iter().flatten() {
        if let Some(t) = run["text"].as_str() {
            out.push_str(t);
        } else if let Some(e) = run.get("emoji") {
            let shortcut = e["shortcuts"].get(0).and_then(Value::as_str);
            out.push(' ');
            out.push_str(shortcut.or_else(|| e["emojiId"].as_str()).unwrap_or(""));
            out.push(' ');
        }
    }
    out
}

/// Mensagens de uma linha do replay (`replayChatItemAction`). Linha inválida ou de outro tipo
/// (membros, banners, remoções) devolve vazio.
pub fn parse_line(line: &str) -> Vec<ChatMessage> {
    let Ok(root) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    let replay = &root["replayChatItemAction"];
    let Some(offset) = offset_ms(&replay["videoOffsetTimeMsec"])
        .or_else(|| offset_ms(&root["videoOffsetTimeMsec"]))
    else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for action in replay["actions"].as_array().into_iter().flatten() {
        let item = &action["addChatItemAction"]["item"];
        for (key, paid) in [
            ("liveChatTextMessageRenderer", false),
            ("liveChatPaidMessageRenderer", true),
        ] {
            let renderer = &item[key];
            let Some(author) = renderer["authorExternalChannelId"].as_str() else {
                continue;
            };
            out.push(ChatMessage {
                offset_us: offset.saturating_mul(1000),
                author: author.to_owned(),
                text: message_text(&renderer["message"]),
                paid,
            });
        }
    }
    out
}

fn tokens(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
}

/// Classifica o texto: (risada, surpresa, pedido de clip). Só em memória; nada disto é gravado.
/// `kkkk`/`KEKW` são risada, `????`/`WTF` surpresa, `clipa`/`clip it` pedido de clip.
pub fn reactions(text: &str) -> (bool, bool, bool) {
    let lower = text.to_lowercase();
    let (mut laugh, mut surprise) = (false, false);
    for t in tokens(&lower) {
        laugh |= (t.len() >= LAUGH_MIN_K && t.chars().all(|c| c == 'k'))
            || t.starts_with("kekw")
            || t.starts_with("haha")
            || t.starts_with("rsrs")
            || ["lol", "lul", "lulw", "lmao"].contains(&t.as_str());
        surprise |= ["wtf", "wth", "omg"].contains(&t.as_str());
    }
    laugh |= lower.contains('😂') || lower.contains('🤣');
    surprise |= lower.contains(&"?".repeat(SURPRISE_MIN_QUESTION_MARKS))
        || ['😱', '😮', '🤯', '😲'].iter().any(|c| lower.contains(*c));
    let clip = lower.contains("clipa") || lower.contains("clip it") || lower.contains("clip that");
    (laugh, surprise, clip)
}

// ---------------------------------------------------------------- agregação (pura)

#[derive(Default)]
struct Bucket {
    authors: HashSet<String>,
    interval: Interval,
}

/// Agrega mensagens numa série por intervalo, descartando comandos e repetições e contando
/// **pessoas distintas**. Os autores vivem só aqui, em memória.
pub struct Aggregator {
    interval_us: i64,
    buckets: BTreeMap<usize, Bucket>,
    last_seen: HashMap<(String, String), i64>,
    kept: u64,
}

impl Aggregator {
    pub fn new(interval_us: i64) -> Self {
        Aggregator {
            interval_us: interval_us.max(1),
            buckets: BTreeMap::new(),
            last_seen: HashMap::new(),
            kept: 0,
        }
    }

    pub fn push(&mut self, m: &ChatMessage) {
        if m.offset_us < 0 {
            return;
        }
        let text = m.text.trim();
        // Comandos de bot (`!sorteio`, `!pix`) não são reação. Super Chat conta sempre.
        if !m.paid && text.starts_with('!') {
            return;
        }
        // Spam: a mesma mensagem do mesmo autor repetida dentro da janela é ignorada, e cada
        // repetição renova a janela (quem spamma sem parar continua ignorado).
        if !text.is_empty() {
            let key = (m.author.clone(), text.to_lowercase());
            let previous = self.last_seen.insert(key, m.offset_us);
            if previous.is_some_and(|p| m.offset_us - p < REPEAT_WINDOW_US) {
                return;
            }
        }
        self.kept += 1;
        let index = (m.offset_us / self.interval_us) as usize;
        let bucket = self.buckets.entry(index).or_default();
        let (laugh, surprise, clip) = reactions(text);
        let i = &mut bucket.interval;
        i.messages += 1;
        i.paid += u32::from(m.paid);
        i.laugh += u32::from(laugh);
        i.surprise += u32::from(surprise);
        i.clip += u32::from(clip);
        if bucket.authors.insert(m.author.clone()) {
            i.people += 1;
        }
    }

    /// Série densa (do intervalo 0 ao último com mensagem) e o total de mensagens mantidas.
    pub fn finish(self) -> (Vec<Interval>, u64) {
        let len = self.buckets.keys().next_back().map_or(0, |last| last + 1);
        let mut series = vec![Interval::default(); len];
        for (index, bucket) in self.buckets {
            series[index] = bucket.interval;
        }
        (series, self.kept)
    }
}

/// Agrega o arquivo bruto, linha a linha, sem carregá-lo inteiro. `tick` é chamado por linha e
/// pode interromper (cancelamento).
pub fn aggregate_file(
    path: &Path,
    interval_us: i64,
    mut tick: impl FnMut() -> Result<(), CoreError>,
) -> Result<(Vec<Interval>, u64), CoreError> {
    let file = fs::File::open(path).map_err(|_| chat_failed())?;
    let mut aggregator = Aggregator::new(interval_us);
    for line in BufReader::new(file).lines() {
        tick()?;
        let Ok(line) = line else { continue };
        for message in parse_line(&line) {
            aggregator.push(&message);
        }
    }
    Ok(aggregator.finish())
}

// ---------------------------------------------------------------- picos (puros)

fn median(values: &mut [u32]) -> f64 {
    values.sort_unstable();
    let n = values.len();
    if n == 0 {
        0.0
    } else if n % 2 == 1 {
        f64::from(values[n / 2])
    } else {
        (f64::from(values[n / 2 - 1]) + f64::from(values[n / 2])) / 2.0
    }
}

/// Picos da série, medidos contra a **mediana móvel da própria Fonte**: a janela de
/// [`MEDIAN_WINDOW_US`] centrada no intervalo (cortada nas pontas). Pico: pessoas distintas
/// ≥ [`PEAK_RATIO`] × a mediana (com o piso [`BASELINE_FLOOR`]) e ao menos [`MIN_PEAK_PEOPLE`].
pub fn peaks(series: &[Interval], interval_us: i64) -> Vec<Peak> {
    let half = ((MEDIAN_WINDOW_US / interval_us.max(1)) / 2).max(1) as usize;
    let mut out = Vec::new();
    let mut window: Vec<u32> = Vec::new();
    for (i, interval) in series.iter().enumerate() {
        if interval.people < MIN_PEAK_PEOPLE {
            continue;
        }
        window.clear();
        window.extend(
            series[i.saturating_sub(half)..(i + half + 1).min(series.len())]
                .iter()
                .map(|x| x.people),
        );
        let baseline = median(&mut window).max(BASELINE_FLOOR);
        let ratio = f64::from(interval.people) / baseline;
        if ratio >= PEAK_RATIO {
            out.push(Peak {
                interval: i,
                people: interval.people,
                ratio_tenths: (ratio * 10.0).round() as u32,
                reaction: interval.dominant(),
            });
        }
    }
    out
}

/// Marcas por Frase: cada pico aponta [`REACTION_DELAY_US`] para trás e marca as Frases que
/// tocam esse trecho; a Frase que toca vários picos fica com o de maior razão.
pub fn marks_for_sentences(peaks: &[Peak], interval_us: i64, frases: &[Sentence]) -> ChatMarks {
    let mut marks = ChatMarks::new();
    for peak in peaks {
        let from = peak.interval as i64 * interval_us - REACTION_DELAY_US;
        let to = from + interval_us;
        let first = frases.partition_point(|s| s.end_us <= from);
        for s in frases[first..].iter().take_while(|s| s.start_us < to) {
            let candidate = ChatMark {
                interval: peak.interval as u32,
                ratio_tenths: peak.ratio_tenths,
                reaction: peak.reaction,
                at_us: from,
            };
            let better = marks
                .get(&s.id)
                .is_none_or(|m| candidate.ratio_tenths > m.ratio_tenths);
            if better {
                marks.insert(s.id, candidate);
            }
        }
    }
    marks
}

/// As marcas que caem no trecho `frases[start..=end]` de um Corte, uma por pico, para a revisão
/// (#55) mostrar o porquê. Só números e o rótulo de reação.
pub fn candidate_marks(
    marks: &ChatMarks,
    frases: &[Sentence],
    start: usize,
    end: usize,
) -> Vec<Value> {
    let mut seen = HashSet::new();
    frases[start..=end]
        .iter()
        .filter_map(|s| marks.get(&s.id))
        .filter(|m| seen.insert(m.interval))
        .map(|m| {
            json!({
                "ratio": f64::from(m.ratio_tenths) / 10.0,
                "reaction": m.reaction.map(Reaction::key),
                "atUs": m.at_us,
            })
        })
        .collect()
}

// ---------------------------------------------------------------- persistência

/// Série gravada de uma Fonte.
pub struct Stored {
    pub interval_us: i64,
    pub series: Vec<Interval>,
}

fn store(source: i64, series: &[Interval], interval_us: i64, kept: u64) -> Result<(), CoreError> {
    projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute("DELETE FROM chat_series WHERE source_id=?1", [source])?;
        let mut insert = tx.prepare("INSERT INTO chat_series(source_id,idx,people,messages,paid,laugh,surprise,clip) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")?;
        for (i, x) in series.iter().enumerate() {
            insert.execute((
                source, i as i64, x.people, x.messages, x.paid, x.laugh, x.surprise, x.clip,
            ))?;
        }
        drop(insert);
        tx.execute(
            "INSERT INTO chat_replays(source_id,state,method,interval_us,intervals,messages) VALUES (?1,'available',?2,?3,?4,?5) ON CONFLICT(source_id) DO UPDATE SET state='available', method=excluded.method, interval_us=excluded.interval_us, intervals=excluded.intervals, messages=excluded.messages, fetched_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            (source, METHOD, interval_us, series.len() as i64, kept as i64),
        )?;
        tx.commit()?;
        Ok(())
    })
}

fn store_absent(source: i64) -> Result<(), CoreError> {
    projects::with_writer(|c| {
        let tx = c.transaction()?;
        tx.execute("DELETE FROM chat_series WHERE source_id=?1", [source])?;
        tx.execute(
            "INSERT INTO chat_replays(source_id,state,method,interval_us,intervals,messages) VALUES (?1,'absent',?2,?3,0,0) ON CONFLICT(source_id) DO UPDATE SET state='absent', method=excluded.method, interval_us=excluded.interval_us, intervals=0, messages=0, fetched_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            (source, METHOD, INTERVAL_US),
        )?;
        tx.commit()?;
        Ok(())
    })
}

/// A série da Fonte, ou `None` se ela não tem chat (sem replay, local ou ainda não buscado).
pub fn load(source: i64) -> Result<Option<Stored>, CoreError> {
    let head: Option<i64> = projects::with_reader(|c| {
        c.query_row(
            "SELECT interval_us FROM chat_replays WHERE source_id=?1 AND state='available'",
            [source],
            |r| r.get(0),
        )
        .optional()
    })?;
    let Some(interval_us) = head else {
        return Ok(None);
    };
    let rows: Vec<(i64, Interval)> = projects::with_reader(|c| {
        let mut q = c.prepare("SELECT idx,people,messages,paid,laugh,surprise,clip FROM chat_series WHERE source_id=?1 ORDER BY idx")?;
        let rows = q.query_map([source], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                Interval {
                    people: r.get(1)?,
                    messages: r.get(2)?,
                    paid: r.get(3)?,
                    laugh: r.get(4)?,
                    surprise: r.get(5)?,
                    clip: r.get(6)?,
                },
            ))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
    })?;
    let len = rows.last().map_or(0, |(i, _)| *i as usize + 1);
    let mut series = vec![Interval::default(); len];
    for (i, x) in rows {
        series[i as usize] = x;
    }
    Ok(Some(Stored {
        interval_us,
        series,
    }))
}

/// Marcas de chat da Transcrição (a Fonte dela) sobre as Frases, ou `None` se a Fonte não tem
/// chat. A seleção então roda sem marcas e o resumo da execução diz isso.
pub(crate) fn load_marks(
    transcript: i64,
    frases: &[Sentence],
) -> Result<Option<ChatMarks>, CoreError> {
    let source: Option<i64> = projects::with_reader(|c| {
        c.query_row(
            "SELECT source_id FROM transcripts WHERE id=?1",
            [transcript],
            |r| r.get(0),
        )
        .optional()
    })?;
    let Some(source) = source else {
        return Ok(None);
    };
    Ok(load(source)?.map(|stored| {
        marks_for_sentences(
            &peaks(&stored.series, stored.interval_us),
            stored.interval_us,
            frases,
        )
    }))
}

// ---------------------------------------------------------------- o job

struct Origin {
    media: PathBuf,
    url: Option<String>,
}

fn origin_of(source: i64, project: &Path) -> Result<Origin, CoreError> {
    let (stored, url): (String, Option<String>) = projects::with_reader(|c| {
        c.query_row(
            "SELECT path,origin_url FROM sources WHERE id=?1",
            [source],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
    })?
    .ok_or_else(|| error("source_missing", "Fonte não encontrada"))?;
    let stored = PathBuf::from(stored);
    let media = if stored.is_absolute() {
        stored
    } else {
        project.join(stored)
    };
    Ok(Origin { media, url })
}

/// Onde mora o replay bruto: ao lado da mídia, com o mesmo nome.
pub fn replay_path(media: &Path) -> PathBuf {
    media.with_extension("live_chat.json")
}

struct TempDir(PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn fetch_args(url: &str, template: &Path, deno: Option<&Path>) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = [
        "--ignore-config",
        "--no-playlist",
        "--skip-download",
        "--write-subs",
        "--sub-langs",
        "live_chat",
        "--socket-timeout",
        "30",
        "--newline",
        "--color",
        "never",
        "-o",
    ]
    .iter()
    .map(std::ffi::OsString::from)
    .chain([template.as_os_str().to_os_string()])
    .collect();
    args.extend(crate::url_import::js_runtime_args(deno));
    args.push("--".into());
    args.push(url.into());
    args
}

/// Pede o replay ao yt-dlp numa pasta temporária ao lado da mídia e o move para o lugar final.
/// `Ok(false)`: o vídeo não tem `live_chat` (não é erro).
fn fetch(url: &str, target: &Path, id: i64, stop: &AtomicBool) -> Result<bool, CoreError> {
    let exe = crate::components::ytdlp_executable()?;
    // O deno é opcional: sem o Componente, o yt-dlp roda como antes (#203, #250).
    let deno = crate::components::deno_executable();
    let dir = target
        .parent()
        .ok_or_else(|| error("chat_storage", "Pasta da Fonte indisponível."))?;
    let temp = (0..100)
        .find_map(|n| {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_nanos();
            let p = dir.join(format!(".clipes-chat-{}-{nonce}-{n}", std::process::id()));
            fs::create_dir(&p).ok().map(|_| TempDir(p))
        })
        .ok_or_else(|| error("chat_storage", "Pasta da Fonte indisponível."))?;
    let template = temp.0.join("%(id)s.%(ext)s");
    let args = fetch_args(url, &template, deno.as_deref());
    preview::run_process_as(&exe, args, id, stop, chat_failed, |_| {})?;
    preview::check(id, stop)?;
    let found = fs::read_dir(&temp.0)
        .map_err(|_| chat_failed())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".live_chat.json"))
        });
    let Some(found) = found else {
        return Ok(false);
    };
    fs::rename(&found, target)
        .or_else(|_| fs::copy(&found, target).map(|_| ()))
        .map_err(|_| error("chat_storage", "Não foi possível guardar o chat da live."))?;
    Ok(true)
}

/// Executa o job: usa o replay que já está ao lado da mídia ou o busca (só com URL de origem),
/// agrega e grava a série numa só transação. Idempotente.
pub(crate) fn run(
    id: i64,
    source: i64,
    project: &Path,
    stop: &AtomicBool,
) -> Result<(), CoreError> {
    preview::check(id, stop)?;
    let origin = origin_of(source, project)?;
    let target = replay_path(&origin.media);
    jobs::progress(id, "chat", 0, "Buscando o chat da live")?;
    if !target.is_file() {
        let url = origin.url.as_deref().ok_or_else(|| {
            error(
                "chat_needs_url",
                "Só uma Fonte importada por URL pode buscar o chat.",
            )
        })?;
        if !fetch(url, &target, id, stop)? {
            store_absent(source)?;
            return Ok(());
        }
    }
    jobs::progress(id, "chat", 50, "Agregando o chat da live")?;
    let mut lines = 0_u64;
    let (series, kept) = aggregate_file(&target, INTERVAL_US, || {
        lines += 1;
        if lines.is_multiple_of(1024) {
            preview::check(id, stop)?;
        }
        Ok(())
    })?;
    preview::check(id, stop)?;
    if kept == 0 {
        // Replay vazio (só comandos, ou sem mensagens): conta como sem chat, sem erro.
        store_absent(source)?;
        return Ok(());
    }
    store(source, &series, INTERVAL_US, kept)
}

/// Enfileira o job de chat da Fonte, sem duplicar. Chamado pela importação por URL; um erro
/// aqui nunca derruba a importação.
pub(crate) fn enqueue_in(tx: &rusqlite::Transaction<'_>, source: i64) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO jobs(kind,safety,state,source_id) VALUES ('chat','local','queued',?1)",
        [source],
    )?;
    Ok(())
}

// ---------------------------------------------------------------- comandos

fn source_of(v: &Value) -> Result<i64, CoreError> {
    v["source_id"]
        .as_i64()
        .ok_or_else(|| error("source_missing", "Fonte não encontrada"))
}

fn pending_job(source: i64) -> Result<Option<i64>, CoreError> {
    projects::with_reader(|c| {
        c.query_row(
            "SELECT id FROM jobs WHERE kind='chat' AND source_id=?1 AND state IN ('queued','running') ORDER BY id LIMIT 1",
            [source],
            |r| r.get(0),
        )
        .optional()
    })
}

/// `chat.fetch {source_id}`: "buscar o chat depois". Só para Fonte importada por URL; roda na
/// fila como as outras tarefas e é idempotente enquanto há um job na fila ou rodando.
fn fetch_command(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source = source_of(&v)?;
    let url: Option<String> = projects::with_reader(|c| {
        c.query_row(
            "SELECT origin_url FROM sources WHERE id=?1",
            [source],
            |r| r.get(0),
        )
        .optional()
    })?
    .ok_or_else(|| error("source_missing", "Fonte não encontrada"))?;
    if url.is_none() {
        return Err(error(
            "chat_needs_url",
            "Só uma Fonte importada por URL pode buscar o chat.",
        ));
    }
    if let Some(job) = pending_job(source)? {
        return Ok(json!({"state": "queued", "job": job}));
    }
    let job = projects::with_writer(|c| {
        let tx = c.transaction()?;
        enqueue_in(&tx, source)?;
        let id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(id)
    })?;
    Ok(json!({"state": "queued", "job": job}))
}

/// `chat.status {source_id}`: `state` (`none` nunca buscado, `available`, `absent` sem replay),
/// se dá para buscar (`canFetch`: Fonte de URL), contagens agregadas e o último job.
fn status_command(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let source = source_of(&v)?;
    let row: Option<(String, i64, i64)> = projects::with_reader(|c| {
        c.query_row(
            "SELECT state,intervals,messages FROM chat_replays WHERE source_id=?1",
            [source],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
    })?;
    let url: Option<String> = projects::with_reader(|c| {
        c.query_row(
            "SELECT origin_url FROM sources WHERE id=?1",
            [source],
            |r| r.get(0),
        )
        .optional()
    })?
    .ok_or_else(|| error("source_missing", "Fonte não encontrada"))?;
    let peak_count = load(source)?
        .map(|s| peaks(&s.series, s.interval_us).len())
        .unwrap_or(0);
    let job: Option<Value> = projects::with_reader(|c| {
        c.query_row(
            "SELECT id,state,progress FROM jobs WHERE kind='chat' AND source_id=?1 ORDER BY id DESC LIMIT 1",
            [source],
            |r| Ok(json!({"id": r.get::<_, i64>(0)?, "state": r.get::<_, String>(1)?, "progress": r.get::<_, i64>(2)?})),
        )
        .optional()
    })?;
    Ok(json!({
        "state": row.as_ref().map_or("none", |r| r.0.as_str()),
        "canFetch": url.is_some(),
        "intervals": row.as_ref().map_or(0, |r| r.1),
        "messages": row.as_ref().map_or(0, |r| r.2),
        "peaks": peak_count,
        "job": job,
    }))
}

inventory::submit! { CommandRegistration { name: "chat.fetch", execute: fetch_command } }
inventory::submit! { CommandRegistration { name: "chat.status", execute: status_command } }

#[cfg(test)]
mod tests;
