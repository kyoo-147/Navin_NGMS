//! Thin allowlisted commands. Each one delegates to `navin-desktop-core` for the
//! actual policy decision and to the OS keychain for secret storage; no product
//! logic lives here.

use navin_desktop_core::{endpoint, ipc, secret};
use serde::Serialize;

const KEYRING_SERVICE: &str = "com.navinresearch.desktop";

fn authorize(command: &str) -> Result<(), String> {
    ipc::authorize(command).map_err(|error| error.to_string())
}

#[derive(Serialize)]
pub struct ShellInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub platform: &'static str,
    pub ipc_allowlist: Vec<String>,
}

#[tauri::command]
pub fn navin_shell_info() -> Result<ShellInfo, String> {
    authorize("navin_shell_info")?;
    let ipc_allowlist = ipc::allowed_commands().map_err(|error| error.to_string())?;
    Ok(ShellInfo {
        name: "navin-desktop",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        ipc_allowlist,
    })
}

#[derive(Serialize)]
pub struct ValidatedEndpoint {
    pub origin: String,
    pub path_prefix: String,
    pub scheme: &'static str,
    pub host: String,
    pub is_loopback: bool,
}

#[tauri::command]
pub fn navin_navind_validate_endpoint(endpoint: String) -> Result<ValidatedEndpoint, String> {
    authorize("navin_navind_validate_endpoint")?;
    let parsed = navin_desktop_core::endpoint::parse_navind_endpoint(&endpoint)
        .map_err(|error| error.to_string())?;
    Ok(ValidatedEndpoint {
        origin: parsed.origin,
        path_prefix: parsed.path_prefix,
        scheme: match parsed.scheme {
            endpoint::Scheme::Http => "http",
            endpoint::Scheme::Https => "https",
        },
        host: parsed.host,
        is_loopback: parsed.is_loopback,
    })
}

fn keychain_entry(namespace: &str, name: &str) -> Result<keyring::Entry, String> {
    secret::validate_secret_ref(namespace, name).map_err(|error| error.to_string())?;
    keyring::Entry::new(KEYRING_SERVICE, &format!("{namespace}/{name}"))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn navin_secret_store(namespace: String, name: String, value: String) -> Result<(), String> {
    authorize("navin_secret_store")?;
    keychain_entry(&namespace, &name)?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn navin_secret_retrieve(namespace: String, name: String) -> Result<Option<String>, String> {
    authorize("navin_secret_retrieve")?;
    match keychain_entry(&namespace, &name)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn navin_secret_delete(namespace: String, name: String) -> Result<(), String> {
    authorize("navin_secret_delete")?;
    match keychain_entry(&namespace, &name)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
