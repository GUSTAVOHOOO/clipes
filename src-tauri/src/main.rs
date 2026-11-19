#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
mod media_server;

use tauri::{Emitter, Listener};

struct MediaTransport {
    #[cfg(target_os = "linux")]
    server: media_server::MediaServer,
}

#[tauri::command]
fn media_base_url(transport: tauri::State<'_, MediaTransport>) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        return Some(transport.server.base_url());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = transport;
        None
    }
}

#[tauri::command]
async fn core_dispatch(
    app: tauri::AppHandle,
    name: String,
    arguments: serde_json::Value,
) -> clipes_core::CommandResult {
    tauri::async_runtime::spawn_blocking(move || {
        clipes_core::dispatch(&name, arguments, &mut |event| {
            let _ = app.emit("core-progress", event);
        })
    })
    .await
    .map_err(|_| clipes_core::CoreError {
        code: "dispatch_failed".into(),
        message: "Core command failed".into(),
        usage: None,
    })?
}

/// Protocolo `clipes-media`: o núcleo decide o que servir (`clipes_core::media::serve`); aqui só
/// se traduz a requisição HTTP. O recurso é um id opaco, nunca um caminho (#58).
fn media_response(request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let origin = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok());
    if let Some(orig) = origin {
        if !media_server::is_allowed_origin(orig) {
            return tauri::http::Response::builder()
                .status(403)
                .header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Length", "0")
                .body(Vec::new())
                .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()));
        }
    }
    let range = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok());
    let served = clipes_core::media::serve(request.uri().path(), range);
    let mut response = tauri::http::Response::builder().status(served.status);
    for (name, value) in &served.headers {
        response = response.header(*name, value);
    }
    if let Some(orig) = origin {
        response = response
            .header("Access-Control-Allow-Origin", orig)
            .header("Vary", "Origin");
    }
    let head = request.method() == tauri::http::Method::HEAD;
    response
        .body(if head { Vec::new() } else { served.body })
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

const CLOSE_ACK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

#[derive(Debug, Default)]
struct WatchdogState {
    generation: u64,
    acked: bool,
}

#[derive(Default)]
struct CloseWatchdog {
    state: std::sync::Mutex<WatchdogState>,
    cv: std::sync::Condvar,
}

impl CloseWatchdog {
    fn arm(&self) -> u64 {
        let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        guard.generation = guard.generation.wrapping_add(1);
        guard.acked = false;
        self.cv.notify_all();
        guard.generation
    }

    fn ack(&self) {
        let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        guard.acked = true;
        self.cv.notify_all();
    }

    fn should_force_destroy(&self, generation: u64) -> bool {
        let guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        guard.generation == generation && !guard.acked
    }

    fn wait_for_timeout(&self, generation: u64, timeout: std::time::Duration) {
        let guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let _ = self.cv.wait_timeout_while(guard, timeout, |state| {
            state.generation == generation && !state.acked
        });
    }
}

fn run_watchdog_after<W, D>(
    watchdog: &CloseWatchdog,
    generation: u64,
    timeout: std::time::Duration,
    wait_fn: W,
    destroy_fn: D,
) where
    W: FnOnce(&CloseWatchdog, u64, std::time::Duration),
    D: FnOnce(),
{
    wait_fn(watchdog, generation, timeout);
    if watchdog.should_force_destroy(generation) {
        destroy_fn();
    }
}

trait CloseTarget {
    fn prevent_close(&mut self);
    fn emit_close_requested(&mut self);
    fn emit_save_failed(&mut self, event: clipes_core::ProgressEvent);
    fn schedule_ack_watchdog(&mut self, generation: u64, timeout: std::time::Duration);
}

struct TauriCloseTarget<'a> {
    window: &'a tauri::Window,
    api: &'a tauri::CloseRequestApi,
    watchdog: std::sync::Arc<CloseWatchdog>,
}

impl CloseTarget for TauriCloseTarget<'_> {
    fn prevent_close(&mut self) {
        self.api.prevent_close();
    }

    fn emit_close_requested(&mut self) {
        let _ = self.window.emit("app-close-requested", ());
    }

    fn emit_save_failed(&mut self, event: clipes_core::ProgressEvent) {
        let _ = self.window.emit("core-progress", event);
    }

    fn schedule_ack_watchdog(&mut self, generation: u64, timeout: std::time::Duration) {
        let window = self.window.clone();
        let watchdog = std::sync::Arc::clone(&self.watchdog);
        let _ = std::thread::Builder::new()
            .name("clipes-close-watchdog".into())
            .spawn(move || {
                run_watchdog_after(
                    &watchdog,
                    generation,
                    timeout,
                    CloseWatchdog::wait_for_timeout,
                    move || {
                        let _ = window.destroy();
                    },
                );
            });
    }
}

/// Coordena `CloseRequested` executando `editor.flush` sincronamente antes de delegar o fechamento à WebView.
fn handle_close_requested<F, T>(flush: F, watchdog: &CloseWatchdog, target: &mut T)
where
    F: FnOnce() -> clipes_core::CommandResult,
    T: CloseTarget,
{
    target.prevent_close();
    match flush() {
        Ok(_) => {
            let generation = watchdog.arm();
            target.emit_close_requested();
            target.schedule_ack_watchdog(generation, CLOSE_ACK_TIMEOUT);
        }
        Err(error) => target.emit_save_failed(clipes_core::ProgressEvent {
            job: "editor".into(),
            project: None,
            clip_id: None,
            stage: "editor_save_failed".into(),
            percentage: 0,
            message: "Não foi possível salvar o Corte.".into(),
            error: Some(error),
        }),
    }
}

fn main() {
    let transport = MediaTransport {
        #[cfg(target_os = "linux")]
        server: media_server::MediaServer::start()
            .expect("failed to start Linux media loopback server"),
    };
    let close_watchdog = std::sync::Arc::new(CloseWatchdog::default());
    let event_watchdog = std::sync::Arc::clone(&close_watchdog);
    let setup_watchdog = std::sync::Arc::clone(&close_watchdog);

    tauri::Builder::default()
        .manage(transport)
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let mut target = TauriCloseTarget {
                    window,
                    api,
                    watchdog: std::sync::Arc::clone(&event_watchdog),
                };
                handle_close_requested(
                    || clipes_core::dispatch("editor.flush", serde_json::json!({}), &mut |_| {}),
                    &event_watchdog,
                    &mut target,
                );
            }
        })
        .register_asynchronous_uri_scheme_protocol("clipes-media", |_ctx, request, responder| {
            // Leitura de disco fora da thread principal.
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(media_response(&request))
            });
        })
        .setup(move |app| {
            let _ = clipes_core::paths::ensure_migrated();
            app.listen("app-close-ack", move |_| {
                setup_watchdog.ack();
            });
            let handle = app.handle().clone();
            let _ = clipes_core::set_event_emitter(std::sync::Arc::new(move |event| {
                let _ = handle.emit("core-progress", event);
            }));
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![core_dispatch, media_base_url])
        .run(tauri::generate_context!())
        .expect("failed to run Clipes");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FakeCloseTarget {
        prevented: usize,
        close_requested_emitted: usize,
        save_failed_events: Vec<clipes_core::ProgressEvent>,
        scheduled_watchdogs: Vec<(u64, std::time::Duration)>,
    }

    impl CloseTarget for FakeCloseTarget {
        fn prevent_close(&mut self) {
            self.prevented += 1;
        }

        fn emit_close_requested(&mut self) {
            self.close_requested_emitted += 1;
        }

        fn emit_save_failed(&mut self, event: clipes_core::ProgressEvent) {
            self.save_failed_events.push(event);
        }

        fn schedule_ack_watchdog(&mut self, generation: u64, timeout: std::time::Duration) {
            self.scheduled_watchdogs.push((generation, timeout));
        }
    }

    #[test]
    fn close_requested_with_flush_ok_prevents_close_emits_event_and_arms_watchdog() {
        let watchdog = std::sync::Arc::new(CloseWatchdog::default());
        let mut target = FakeCloseTarget::default();
        handle_close_requested(|| Ok(serde_json::json!({})), &watchdog, &mut target);

        assert_eq!(target.prevented, 1);
        assert_eq!(target.close_requested_emitted, 1);
        assert!(target.save_failed_events.is_empty());
        assert_eq!(
            target.scheduled_watchdogs,
            vec![(1, std::time::Duration::from_secs(3))]
        );
    }

    #[test]
    fn close_requested_with_flush_err_prevents_close_and_emits_save_failed_without_watchdog() {
        let watchdog = std::sync::Arc::new(CloseWatchdog::default());
        let mut target = FakeCloseTarget::default();
        let err = clipes_core::CoreError {
            code: "io_error".into(),
            message: "disco cheio".into(),
            usage: None,
        };
        handle_close_requested(|| Err(err.clone()), &watchdog, &mut target);

        assert_eq!(target.prevented, 1);
        assert_eq!(target.close_requested_emitted, 0);
        assert!(target.scheduled_watchdogs.is_empty());
        assert_eq!(target.save_failed_events.len(), 1);
        assert_eq!(target.save_failed_events[0].job, "editor");
        assert_eq!(target.save_failed_events[0].stage, "editor_save_failed");
        assert_eq!(target.save_failed_events[0].percentage, 0);
        assert_eq!(target.save_failed_events[0].error.as_ref(), Some(&err));
    }

    #[test]
    fn watchdog_forces_destroy_when_ack_does_not_arrive() {
        let watchdog = CloseWatchdog::default();
        let gen = watchdog.arm();
        let mut destroyed = 0usize;

        run_watchdog_after(
            &watchdog,
            gen,
            std::time::Duration::from_secs(3),
            |_wd, _g, _timeout| {
                // Simula passagem do tempo limite sem ack.
            },
            || {
                destroyed += 1;
            },
        );

        assert_eq!(destroyed, 1);
    }

    #[test]
    fn watchdog_does_not_destroy_when_ack_arrives_before_timeout() {
        let watchdog = CloseWatchdog::default();
        let gen = watchdog.arm();
        let mut destroyed = 0usize;

        run_watchdog_after(
            &watchdog,
            gen,
            std::time::Duration::from_secs(3),
            |wd, _g, _timeout| {
                wd.ack();
            },
            || {
                destroyed += 1;
            },
        );

        assert_eq!(destroyed, 0);
    }

    #[test]
    fn watchdog_ignores_stale_generation_after_rearm() {
        let watchdog = CloseWatchdog::default();
        let gen1 = watchdog.arm();
        let gen2 = watchdog.arm();
        assert_ne!(gen1, gen2);
        let mut destroyed = 0usize;

        run_watchdog_after(
            &watchdog,
            gen1,
            std::time::Duration::from_secs(3),
            |_wd, _g, _timeout| {},
            || {
                destroyed += 1;
            },
        );

        assert_eq!(destroyed, 0);
    }
}
