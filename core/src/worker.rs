//! Cliente do worker de ML: JSON lines no stdin/stdout, versão do protocolo,
//! progresso, cancelamento e erros tipados (ADR-0004, worker/protocol/README.md).
//!
//! O worker nunca abre o banco: tudo o que ele produz volta ao núcleo como
//! mensagem `result`, e só o núcleo escreve em Projeto.

use crate::{
    console::{emit_console, ConsoleDraft, ConsoleKind, ConsoleLevel},
    CoreError,
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    ffi::OsStr,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
    },
    time::{Duration, Instant},
};

pub const PROTOCOL_VERSION: u64 = 1;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(60);
const CANCEL_GRACE: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Handshake {
    pub protocol: u64,
    pub worker: String,
    pub python: String,
    /// Versão de cada biblioteca reportada pelo worker; `None` se não instalada.
    pub libs: BTreeMap<String, Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkerEvent {
    Progress {
        stage: String,
        percentage: u8,
        message: String,
    },
    /// `event` é `model_loaded` ou `model_released`.
    Model { event: String, model: String },
}

fn error(code: &str, message: &str) -> CoreError {
    CoreError {
        code: code.into(),
        message: message.into(),
        usage: None,
    }
}

/// Converte um código de erro do worker numa mensagem fixa do núcleo. O texto
/// enviado pelo worker é descartado: pode conter caminhos pessoais (ADR-0006).
pub(crate) fn typed_error(code: &str) -> CoreError {
    match code {
        "invalid_message" => error("invalid_message", "O worker recusou uma mensagem inválida."),
        "protocol_mismatch" => error(
            "protocol_mismatch",
            "O worker usa outra versão do protocolo; reinstale-o.",
        ),
        "unknown_task" => error("unknown_task", "O worker não conhece esta tarefa."),
        "model_missing" => error("model_missing", "O modelo necessário não está instalado."),
        "out_of_memory" => error(
            "out_of_memory",
            "Memória insuficiente para carregar o modelo.",
        ),
        "cancelled" => error("cancelled", "Tarefa cancelada."),
        "internal" => error("worker_internal", "Erro interno do worker."),
        _ => error(
            "worker_error",
            "O worker respondeu com um erro desconhecido.",
        ),
    }
}

fn crashed() -> CoreError {
    error("worker_crashed", "O worker encerrou inesperadamente.")
}
fn protocol_error() -> CoreError {
    error(
        "worker_protocol",
        "O worker enviou uma mensagem fora do protocolo.",
    )
}

pub(crate) fn emit_worker_event(job: &str, project: Option<&str>, event: &WorkerEvent) {
    match event {
        WorkerEvent::Model { event, model } => {
            let simple = match event.as_str() {
                "model_loaded" => format!("Modelo carregado no worker: {model}"),
                "model_released" => format!("Modelo liberado do worker: {model}"),
                other => format!("Evento de modelo ({other}): {model}"),
            };
            let tech = format!("event={event} model={model}");
            emit_console(ConsoleDraft {
                job,
                project,
                origin: "worker",
                level: ConsoleLevel::Info,
                kind: ConsoleKind::Milestone,
                simple: &simple,
                technical: Some(&tech),
            });
        }
        WorkerEvent::Progress {
            stage,
            percentage,
            message,
        } => {
            let clean_msg = message.trim();
            let simple = if clean_msg.is_empty() {
                format!("Worker ({stage}) · {percentage}%")
            } else {
                format!("{clean_msg} · {percentage}%")
            };
            let tech = if clean_msg.is_empty() {
                format!("stage={stage} progress={percentage}%")
            } else {
                format!("stage={stage} progress={percentage}% message={clean_msg}")
            };
            emit_console(ConsoleDraft {
                job,
                project,
                origin: "worker",
                level: ConsoleLevel::Info,
                kind: ConsoleKind::Continuous("progress"),
                simple: &simple,
                technical: Some(&tech),
            });
        }
    }
}

pub struct WorkerClient {
    child: Child,
    group: crate::process::ProcessGroup,
    stdin: ChildStdin,
    lines: Receiver<Option<Value>>,
    handshake: Handshake,
    next_id: AtomicU64,
    console_context: Option<(String, Option<String>)>,
}

impl WorkerClient {
    /// Inicia o worker sem shell e faz o handshake. `configure` ajusta ambiente e
    /// diretório do comando; stdin/stdout já ficam em pipe.
    pub fn start<I, S>(
        program: impl AsRef<OsStr>,
        arguments: I,
        configure: impl FnOnce(&mut Command),
    ) -> Result<Self, CoreError>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let (mut child, group) = crate::process::spawn_managed_with(program, arguments, |c| {
            c.stdin(Stdio::piped());
            configure(c);
        })
        .map_err(|_| {
            error(
                "worker_start",
                "Não foi possível iniciar o worker; reinstale-o em Componentes.",
            )
        })?;
        let stdin = child.stdin.take().ok_or_else(crashed)?;
        let stdout = child.stdout.take().ok_or_else(crashed)?;
        let mut stderr = child.stderr.take().ok_or_else(crashed)?;
        std::thread::spawn(move || {
            let _ = std::io::copy(&mut stderr, &mut std::io::sink());
        });
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                // Linha inválida vira `None`; o fim do fluxo fecha o canal.
                if tx.send(serde_json::from_str::<Value>(&line).ok()).is_err() {
                    break;
                }
            }
        });
        let mut client = WorkerClient {
            child,
            group,
            stdin,
            lines,
            handshake: Handshake {
                protocol: 0,
                worker: String::new(),
                python: String::new(),
                libs: BTreeMap::new(),
            },
            next_id: AtomicU64::new(1),
            console_context: None,
        };
        client.send(json!({"v":PROTOCOL_VERSION,"type":"hello","protocol":PROTOCOL_VERSION}))?;
        client.handshake = client.read_handshake()?;
        Ok(client)
    }

    pub(crate) fn set_console_context(&mut self, job: impl Into<String>, project: Option<String>) {
        self.console_context = Some((job.into(), project));
    }

    pub fn handshake(&self) -> &Handshake {
        &self.handshake
    }

    fn send(&mut self, message: Value) -> Result<(), CoreError> {
        writeln!(self.stdin, "{message}")
            .and_then(|_| self.stdin.flush())
            .map_err(|_| crashed())
    }

    fn recv(&mut self, timeout: Duration) -> Result<Option<Value>, CoreError> {
        match self.lines.recv_timeout(timeout) {
            Ok(Some(value)) => Ok(Some(value)),
            Ok(None) => Err(protocol_error()),
            Err(RecvTimeoutError::Timeout) => Ok(None),
            Err(RecvTimeoutError::Disconnected) => Err(crashed()),
        }
    }

    fn read_handshake(&mut self) -> Result<Handshake, CoreError> {
        let deadline = Instant::now() + HANDSHAKE_TIMEOUT;
        loop {
            if Instant::now() >= deadline {
                self.group.terminate();
                return Err(error(
                    "worker_timeout",
                    "O worker não respondeu ao handshake.",
                ));
            }
            let Some(message) = self.recv(POLL)? else {
                continue;
            };
            return match message["type"].as_str() {
                Some("handshake") => parse_handshake(&message),
                Some("error") => Err(typed_error(message["code"].as_str().unwrap_or(""))),
                _ => Err(protocol_error()),
            };
        }
    }

    /// Executa uma tarefa e espera o resultado. Se `cancel` for ativado, envia
    /// `cancel`; o worker que não responder em alguns segundos é encerrado.
    pub fn run(
        &mut self,
        task: &str,
        params: Value,
        cancel: &AtomicBool,
        on_event: &mut dyn FnMut(WorkerEvent),
    ) -> Result<Value, CoreError> {
        let id = format!("r{}", self.next_id.fetch_add(1, Ordering::SeqCst));
        self.send(
            json!({"v":PROTOCOL_VERSION,"type":"request","id":id,"task":task,"params":params}),
        )?;
        let mut cancel_deadline: Option<Instant> = None;
        loop {
            if cancel.load(Ordering::SeqCst) && cancel_deadline.is_none() {
                self.send(json!({"v":PROTOCOL_VERSION,"type":"cancel","id":id}))?;
                cancel_deadline = Some(Instant::now() + CANCEL_GRACE);
            }
            if cancel_deadline.is_some_and(|d| Instant::now() >= d) {
                self.group.terminate();
                return Err(typed_error("cancelled"));
            }
            let Some(message) = self.recv(POLL)? else {
                continue;
            };
            let for_this = message["id"].as_str() == Some(id.as_str());
            match message["type"].as_str() {
                Some("progress") if for_this => {
                    let ev = WorkerEvent::Progress {
                        stage: message["stage"].as_str().unwrap_or("").into(),
                        percentage: message["percentage"].as_u64().unwrap_or(0).min(100) as u8,
                        message: message["message"].as_str().unwrap_or("").into(),
                    };
                    if let Some((ref job, ref project)) = self.console_context {
                        emit_worker_event(job, project.as_deref(), &ev);
                    }
                    on_event(ev);
                }
                Some("event") => {
                    let ev = WorkerEvent::Model {
                        event: message["event"].as_str().unwrap_or("").into(),
                        model: message["model"].as_str().unwrap_or("").into(),
                    };
                    if let Some((ref job, ref project)) = self.console_context {
                        emit_worker_event(job, project.as_deref(), &ev);
                    }
                    on_event(ev);
                }
                Some("result") if for_this => return Ok(message["data"].clone()),
                Some("error") if for_this || message["id"].is_null() => {
                    let code = message["code"].as_str().unwrap_or("");
                    let err = typed_error(code);
                    if let Some((ref job, ref project)) = self.console_context {
                        let tech = format!("task={task} code={}", err.code);
                        emit_console(ConsoleDraft {
                            job,
                            project: project.as_deref(),
                            origin: "worker",
                            level: if err.code == "cancelled" {
                                ConsoleLevel::Warn
                            } else {
                                ConsoleLevel::Error
                            },
                            kind: ConsoleKind::Milestone,
                            simple: &err.message,
                            technical: Some(&tech),
                        });
                    }
                    return Err(err);
                }
                _ => {}
            }
        }
    }

    /// Pede o encerramento e espera um instante; depois disso, força.
    pub fn shutdown(mut self) {
        let _ = self.send(json!({"v":PROTOCOL_VERSION,"type":"shutdown"}));
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for WorkerClient {
    fn drop(&mut self) {
        // O grupo cobre eventuais filhos do worker; o wait evita processo zumbi.
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            self.group.terminate();
        }
        let _ = self.child.wait();
    }
}

fn parse_handshake(message: &Value) -> Result<Handshake, CoreError> {
    let protocol = message["protocol"].as_u64().ok_or_else(protocol_error)?;
    if protocol != PROTOCOL_VERSION {
        return Err(typed_error("protocol_mismatch"));
    }
    let text = |key: &str| message[key].as_str().map(str::to_owned);
    let libs = message["libs"].as_object().ok_or_else(protocol_error)?;
    Ok(Handshake {
        protocol,
        worker: text("worker").ok_or_else(protocol_error)?,
        python: text("python").ok_or_else(protocol_error)?,
        libs: libs
            .iter()
            .map(|(name, version)| (name.clone(), version.as_str().map(str::to_owned)))
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    #[test]
    fn worker_client_emits_model_and_progress_events_and_never_leaks_stderr() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("fake_worker_unit.rs");
        let exe = dir.path().join(if cfg!(windows) {
            "fake_worker_unit.exe"
        } else {
            "fake_worker_unit"
        });
        fs::write(
            &src,
            r##"
use std::io::{BufRead, Write};
fn main() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines().map_while(Result::ok) {
        if line.contains("\"hello\"") {
            writeln!(stdout, r#"{{"v":1,"type":"handshake","protocol":1,"worker":"fake","python":"3.11","libs":{{"faster-whisper":"1.0"}}}}"#).unwrap();
            stdout.flush().unwrap();
        } else if line.contains("\"request\"") {
            eprintln!("Traceback C:\\Users\\Alice\\secret_worker.py sk-proj-secret123456");
            writeln!(stdout, r#"{{"v":1,"type":"event","event":"model_loaded","model":"faster-whisper:small:cpu:int8"}}"#).unwrap();
            writeln!(stdout, r#"{{"v":1,"type":"progress","id":"r1","stage":"transcribing","percentage":45,"message":"Transcrevendo bloco 1"}}"#).unwrap();
            writeln!(stdout, r#"{{"v":1,"type":"event","event":"model_released","model":"faster-whisper:small:cpu:int8"}}"#).unwrap();
            writeln!(stdout, r#"{{"v":1,"type":"result","id":"r1","data":{{"ok":true}}}}"#).unwrap();
            stdout.flush().unwrap();
        } else if line.contains("\"shutdown\"") {
            break;
        }
    }
}
"##,
        )
        .unwrap();
        let rustc = PathBuf::from(env!("CARGO")).with_file_name(if cfg!(windows) {
            "rustc.exe"
        } else {
            "rustc"
        });
        assert!(std::process::Command::new(rustc)
            .arg(&src)
            .arg("-o")
            .arg(&exe)
            .status()
            .unwrap()
            .success());

        let capture = crate::console::TestConsoleCapture::new();
        let mut client = WorkerClient::start(&exe, std::iter::empty::<&str>(), |_| {}).unwrap();
        client.set_console_context("worker-unit-1", Some("proj-w1".into()));
        let cancel = AtomicBool::new(false);
        let mut seen = Vec::new();
        let res = client
            .run("transcribe", json!({}), &cancel, &mut |ev| seen.push(ev))
            .unwrap();
        assert_eq!(res, json!({"ok": true}));
        assert_eq!(seen.len(), 3);
        client.shutdown();

        let events = capture.events_for_job("worker-unit-1");
        assert!(events.iter().any(|ev| {
            ev.origin == "worker"
                && ev.project.as_deref() == Some("proj-w1")
                && ev.simple.contains("Modelo carregado")
                && ev.technical.as_deref()
                    == Some("event=model_loaded model=faster-whisper:small:cpu:int8")
        }));
        assert!(events.iter().any(|ev| {
            ev.origin == "worker"
                && ev.simple == "Transcrevendo bloco 1 · 45%"
                && ev.technical.as_deref()
                    == Some("stage=transcribing progress=45% message=Transcrevendo bloco 1")
        }));
        assert!(events.iter().any(|ev| {
            ev.origin == "worker"
                && ev.simple.contains("Modelo liberado")
                && ev.technical.as_deref()
                    == Some("event=model_released model=faster-whisper:small:cpu:int8")
        }));
        for ev in &events {
            let joined = format!("{} {}", ev.simple, ev.technical.as_deref().unwrap_or(""));
            assert!(!joined.contains("Traceback"));
            assert!(!joined.contains("Alice"));
            assert!(!joined.contains("secret_worker.py"));
            assert!(!joined.contains("sk-proj-secret123456"));
        }
    }
}
