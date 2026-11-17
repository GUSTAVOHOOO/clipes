//! End-to-end tests for provider rate limits (#269): 413/429 backoff in selection,
//! rate-limit retries excluded from `max_calls`, and `provider_daily_limit` preserving progress.
use clipes_core::{dispatch, projects::with_writer, CoreError};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

fn call(name: &str, args: Value) -> Result<Value, CoreError> {
    dispatch(name, args, &mut |_| {})
}

fn seed_source(sentences_count: i64) -> i64 {
    let total_us = sentences_count * 10_000_000;
    with_writer(|c| {
        c.execute(
            "INSERT INTO sources(path,size,duration_us,partial_hash,metadata,permission,audio_track) VALUES ('C:/videos/live.mp4',1,?1,'h','{}','{}',0)",
            [total_us],
        )?;
        let source = c.last_insert_rowid();
        c.execute(
            "INSERT INTO transcripts(source_id,audio_track,engine,model,revision,compute_type,state,resume_us,duration_us) VALUES (?1,0,'local','m','r','c','complete',?2,?2)",
            (source, total_us),
        )?;
        let transcript = c.last_insert_rowid();
        for position in 0..sentences_count * 10 {
            let text = if position % 10 == 9 {
                " palavra."
            } else {
                " palavra"
            };
            c.execute(
                "INSERT INTO transcript_words(transcript_id,position,kind,text,start_us,end_us,language) VALUES (?1,?2,'word',?3,?4,?5,'pt')",
                (
                    transcript,
                    position,
                    text,
                    position * 1_000_000,
                    (position + 1) * 1_000_000,
                ),
            )?;
        }
        Ok(source)
    })
    .unwrap()
}

fn read_request(stream: &mut std::net::TcpStream) -> Vec<u8> {
    stream.set_nonblocking(false).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut bytes = Vec::new();
    loop {
        let mut chunk = [0; 8192];
        let n = stream.read(&mut chunk).unwrap();
        assert!(n > 0, "request ended before its body");
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(pos) = bytes.windows(4).position(|x| x == b"\r\n\r\n") {
            let headers = String::from_utf8_lossy(&bytes[..pos]);
            let length: usize = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':')
                        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                        .map(|(_, value)| value.trim().parse().unwrap())
                })
                .expect("missing Content-Length");
            if bytes.len() >= pos + 4 + length {
                return bytes;
            }
        }
    }
}

fn http_reply(status: &str, headers: &str, body: &Value) -> String {
    let body = body.to_string();
    format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\n{headers}Connection: close\r\n\r\n{body}",
        body.len()
    )
}

fn first_id_from_wire(wire: &[u8]) -> i64 {
    let start = wire.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
    let body: Value = serde_json::from_slice(&wire[start..]).unwrap();
    let content = body["messages"][1]["content"].as_str().unwrap();
    let inner: Value = serde_json::from_str(content).unwrap();
    let transcript = inner["untrustedTranscript"].as_str().unwrap();
    transcript
        .lines()
        .find(|l| !l.starts_with('#'))
        .and_then(|l| l.split(' ').next())
        .and_then(|id| id.parse().ok())
        .unwrap()
}

fn selection_ok_reply(first_id: i64) -> String {
    let candidate = json!({
        "startId": first_id,
        "endId": first_id + 2,
        "title": "",
        "hook": {"score": 8, "why": "ok"},
        "selfContained": {"score": 8, "why": "ok"},
        "energy": {"score": 7, "why": "ok"},
        "value": {"score": 8, "why": "ok"},
        "closing": {"score": 8, "why": "ok"}
    });
    let text = json!({"schemaVersion": 1, "candidates": [candidate]}).to_string();
    http_reply(
        "200 OK",
        "",
        &json!({
            "choices": [{"message": {"content": text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 120, "completion_tokens": 30}
        }),
    )
}

#[derive(Clone)]
enum ScriptedReply {
    Raw(String),
    OkForFirstId,
}

struct FakeServer {
    endpoint: String,
    calls: Arc<Mutex<Vec<i64>>>,
    queue: Arc<Mutex<VecDeque<ScriptedReply>>>,
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl FakeServer {
    fn start(initial: Vec<ScriptedReply>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let calls = Arc::new(Mutex::new(Vec::new()));
        let queue = Arc::new(Mutex::new(VecDeque::from(initial)));
        let stop = Arc::new(AtomicBool::new(false));
        let (c_ref, q_ref, s_ref) = (calls.clone(), queue.clone(), stop.clone());
        let handle = thread::spawn(move || {
            while !s_ref.load(Ordering::SeqCst) {
                let Ok((mut stream, _)) = listener.accept() else {
                    thread::sleep(Duration::from_millis(5));
                    continue;
                };
                let wire = read_request(&mut stream);
                let first = first_id_from_wire(&wire);
                c_ref.lock().unwrap().push(first);
                let next = q_ref
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or(ScriptedReply::OkForFirstId);
                let reply = match next {
                    ScriptedReply::Raw(s) => s,
                    ScriptedReply::OkForFirstId => selection_ok_reply(first),
                };
                let _ = stream.write_all(reply.as_bytes());
            }
        });
        Self {
            endpoint,
            calls,
            queue,
            stop,
            handle: Some(handle),
        }
    }

    fn push(&self, replies: Vec<ScriptedReply>) {
        self.queue.lock().unwrap().extend(replies);
    }

    fn calls(&self) -> Vec<i64> {
        self.calls.lock().unwrap().clone()
    }
}

impl Drop for FakeServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

fn wait_run(run: i64, done: impl Fn(&Value) -> bool) -> Value {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let v = call("selection.get", json!({"run": run})).unwrap();
        if done(&v) {
            return v;
        }
        assert!(Instant::now() < deadline, "run {run} did not settle: {v}");
        thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn selection_retries_413_429_without_tripping_max_calls_and_preserves_progress_on_daily_limit() {
    let root = tempfile::tempdir().unwrap();
    std::env::set_var("CLIPES_DATA_DIR", root.path().join("data"));
    call(
        "projects.create",
        json!({"parent": root.path(), "name": "GroqTest"}),
    )
    .unwrap();
    // 240 sentences × 10 s = 40 min -> at least 4 selection windows.
    call("channel_profile.set", json!({"maxUs": 180_000_000})).unwrap();
    let source = seed_source(240);
    call("transcription.segment", json!({"source_id": source})).unwrap();

    // Window 0: 429 (reset-tokens: 20ms) -> 413 (Retry-After: 0) -> 429 (Retry-After: 0) -> 200 OK.
    // All 3 retries succeed without hitting SELECTION_BUDGET.max_calls = 2!
    // Window 1: 429 with TPD body + 2h reset -> provider_daily_limit, cancels queued windows 2+.
    let server = FakeServer::start(vec![
        ScriptedReply::Raw(http_reply(
            "429 Too Many Requests",
            "x-ratelimit-remaining-tokens: 0\r\nx-ratelimit-reset-tokens: 20ms\r\n",
            &json!({}),
        )),
        ScriptedReply::Raw(http_reply(
            "413 Payload Too Large",
            "Retry-After: 0\r\n",
            &json!({}),
        )),
        ScriptedReply::Raw(http_reply(
            "429 Too Many Requests",
            "Retry-After: 0\r\n",
            &json!({}),
        )),
        ScriptedReply::OkForFirstId,
        ScriptedReply::Raw(http_reply(
            "429 Too Many Requests",
            "x-ratelimit-remaining-requests: 0\r\nx-ratelimit-reset-requests: 2h\r\n",
            &json!({"error":{"message":"Rate limit reached on tokens per day (TPD)","code":"rate_limit_exceeded"}}),
        )),
    ]);

    call(
        "provider.configure",
        json!({"endpoint": server.endpoint, "kind": "openai", "model": "openai/gpt-oss-120b", "context": 131_072, "tokensPerRequest": 60_000, "tokensPerMinute": 60_000}),
    )
    .unwrap();

    let started = call("selection.start", json!({"source_id": source})).unwrap();
    let run = started["run"].as_i64().unwrap();
    let total_windows = started["windows"].as_u64().unwrap() as usize;
    assert!(total_windows >= 4);

    let partial = wait_run(run, |v| v["run"]["state"] == "partial");
    assert_eq!(partial["run"]["counts"]["completed"], 1);
    assert_eq!(partial["candidates"].as_array().unwrap().len(), 1);
    let windows = partial["windows"].as_array().unwrap();
    assert_eq!(windows[0]["state"], "completed");
    assert_eq!(windows[1]["state"], "failed");
    assert_eq!(windows[1]["code"], "provider_daily_limit");
    assert!(windows[1]["resetAtMs"].as_u64().is_some());
    assert!(windows[2..].iter().all(|w| w["code"] == "cancelled"));
    // 4 attempts for window 0 + 1 attempt for window 1 = 5 HTTP requests total (queued windows cancelled).
    assert_eq!(server.calls().len(), 5);

    // Resuming only runs windows 1..total_windows; window 0 is never repeated.
    server.push(vec![ScriptedReply::OkForFirstId; total_windows]);
    call("selection.resume", json!({"run": run})).unwrap();
    let completed = wait_run(run, |v| v["run"]["state"] == "completed");
    assert_eq!(completed["run"]["counts"]["completed"], total_windows);
    assert_eq!(server.calls().len(), 5 + (total_windows - 1));

    call("projects.close", json!({})).unwrap();
}
