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
    .map_err(|error| clipes_core::CoreError {
        code: "dispatch_failed".into(),
        message: error.to_string(),
    })?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![core_dispatch])
        .run(tauri::generate_context!())
        .expect("failed to run Clipes");
}
