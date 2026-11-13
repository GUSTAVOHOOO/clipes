use tauri::Emitter;

#[tauri::command]
fn core_dispatch(
    app: tauri::AppHandle,
    name: String,
    arguments: serde_json::Value,
) -> clipes_core::CommandResult {
    clipes_core::dispatch(&name, arguments, &mut |event| {
        let _ = app.emit("core-progress", event);
    })
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![core_dispatch])
        .run(tauri::generate_context!())
        .expect("failed to run Clipes");
}
