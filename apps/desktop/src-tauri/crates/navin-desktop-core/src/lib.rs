//! Pure policy core for the Navin desktop shell.
//!
//! Every module here is intentionally free of Tauri, windowing and network
//! dependencies so the security-relevant decisions (IPC allowlist, endpoint
//! transport policy, deep-link parsing, secret storage, updater fail-closed
//! policy and permission gating) can be unit tested in isolation and reused by
//! the thin `#[tauri::command]` wrappers.

#![forbid(unsafe_code)]

pub mod deeplink;
pub mod endpoint;
pub mod ipc;
pub mod permissions;
pub mod secret;
pub mod update;
