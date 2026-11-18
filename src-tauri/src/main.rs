#[cfg_attr(not(any(target_os = "linux", test)), allow(dead_code))]
mod media_server;

use tauri::Emitter;

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

trait CloseTarget {
    fn prevent_close(&mut self);
    fn emit_close_requested(&mut self);
    fn emit_save_failed(&mut self, event: clipes_core::ProgressEvent);
}

struct TauriCloseTarget<'a> {
    window: &'a tauri::Window,
    api: &'a tauri::CloseRequestApi,
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
}

/// Coordena `CloseRequested` executando `editor.flush` sincronamente antes de delegar o fechamento à WebView.
fn handle_close_requested<F, T>(flush: F, target: &mut T)
where
    F: FnOnce() -> clipes_core::CommandResult,
    T: CloseTarget,
{
    target.prevent_close();
    match flush() {
        Ok(_) => target.emit_close_requested(),
        Err(error) => target.emit_save_failed(clipes_core::ProgressEvent {
            job: "editor".into(),
            project: None,
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
    tauri::Builder::default()
        .manage(transport)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let mut target = TauriCloseTarget { window, api };
                handle_close_requested(
                    || clipes_core::dispatch("editor.flush", serde_json::json!({}), &mut |_| {}),
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
        .setup(|app| {
            let _ = clipes_core::paths::ensure_migrated();
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
    }

    #[test]
    fn close_requested_with_flush_ok_prevents_close_and_emits_app_close_requested() {
        let mut target = FakeCloseTarget::default();
        handle_close_requested(|| Ok(serde_json::json!({})), &mut target);

        assert_eq!(target.prevented, 1);
        assert_eq!(target.close_requested_emitted, 1);
        assert!(target.save_failed_events.is_empty());
    }

    #[test]
    fn close_requested_with_flush_err_prevents_close_and_emits_save_failed_without_app_close_requested() {
        let mut target = FakeCloseTarget::default();
        let err = clipes_core::CoreError {
            code: "io_error".into(),
            message: "disco cheio".into(),
            usage: None,
        };
        handle_close_requested(|| Err(err.clone()), &mut target);

        assert_eq!(target.prevented, 1);
        assert_eq!(target.close_requested_emitted, 0);
        assert_eq!(target.save_failed_events.len(), 1);
        assert_eq!(target.save_failed_events[0].job, "editor");
        assert_eq!(target.save_failed_events[0].stage, "editor_save_failed");
        assert_eq!(target.save_failed_events[0].percentage, 0);
        assert_eq!(target.save_failed_events[0].error.as_ref(), Some(&err));
    }
}
