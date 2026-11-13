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
    })?
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![core_dispatch])
        .run(tauri::generate_context!())
        .expect("failed to run Clipes");
}
