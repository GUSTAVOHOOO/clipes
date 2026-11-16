use tauri::Emitter;

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
    let range = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok());
    let served = clipes_core::media::serve(request.uri().path(), range);
    let mut response = tauri::http::Response::builder().status(served.status);
    for (name, value) in &served.headers {
        response = response.header(*name, value);
    }
    let head = request.method() == tauri::http::Method::HEAD;
    response
        .body(if head { Vec::new() } else { served.body })
        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

fn main() {
    tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match clipes_core::dispatch("editor.flush", serde_json::json!({}), &mut |_| {}) {
                    Ok(_) => (),
                    Err(error) => {
                        api.prevent_close();
                        let _ = window.emit(
                            "core-progress",
                            clipes_core::ProgressEvent {
                                job: "editor".into(),
                                project: None,
                                stage: "editor_save_failed".into(),
                                percentage: 0,
                                message: "Não foi possível salvar o Corte.".into(),
                                error: Some(error),
                            },
                        );
                    }
                }
            }
        })
        .register_asynchronous_uri_scheme_protocol("clipes-media", |_ctx, request, responder| {
            // Leitura de disco fora da thread principal.
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(media_response(&request))
            });
        })
        .setup(|app| {
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
        .invoke_handler(tauri::generate_handler![core_dispatch])
        .run(tauri::generate_context!())
        .expect("failed to run Clipes");
}
