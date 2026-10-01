//! Navin desktop shell composition.
//!
//! This crate is intentionally thin: it wires plugins, native bridges and a tiny
//! set of allowlisted commands. All product behaviour lives in navind and the
//! surface bundles; the shell never parses mail, plans setup or runs engine logic.

mod commands;

use tauri::Manager;

pub fn run() {
    let mut builder = tauri::Builder::default();

    // The single-instance plugin must be registered first so a second launch
    // focuses the existing window instead of starting a rival instance.
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::navin_shell_info,
            commands::navin_navind_validate_endpoint,
            commands::navin_secret_store,
            commands::navin_secret_retrieve,
            commands::navin_secret_delete,
        ])
        .setup(|app| {
            // Register the navin:// scheme so deep links reach the running app.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running the Navin desktop shell");
}
