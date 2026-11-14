//! Cliente do worker de ML: JSON lines no stdin/stdout, versão do protocolo,
//! progresso, cancelamento e erros tipados (ADR-0004, worker/protocol/README.md).
//!
//! O worker nunca abre o banco: tudo o que ele produz volta ao núcleo como
//! mensagem `result`, e só o núcleo escreve em Projeto.

use crate::CoreError;
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

pub struct WorkerClient {
    child: Child,
    group: crate::process::ProcessGroup,
    stdin: ChildStdin,
    lines: Receiver<Option<Value>>,
    handshake: Handshake,
    next_id: AtomicU64,
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
        };
        client.send(json!({"v":PROTOCOL_VERSION,"type":"hello","protocol":PROTOCOL_VERSION}))?;
        client.handshake = client.read_handshake()?;
        Ok(client)
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
                Some("progress") if for_this => on_event(WorkerEvent::Progress {
                    stage: message["stage"].as_str().unwrap_or("").into(),
                    percentage: message["percentage"].as_u64().unwrap_or(0).min(100) as u8,
                    message: message["message"].as_str().unwrap_or("").into(),
                }),
                Some("event") => on_event(WorkerEvent::Model {
                    event: message["event"].as_str().unwrap_or("").into(),
                    model: message["model"].as_str().unwrap_or("").into(),
                }),
                Some("result") if for_this => return Ok(message["data"].clone()),
                Some("error") if for_this || message["id"].is_null() => {
                    return Err(typed_error(message["code"].as_str().unwrap_or("")))
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
