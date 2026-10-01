//! Narrow IPC allowlist shared with the TypeScript renderer.
//!
//! The canonical list lives in `apps/desktop/ipc/allowlist.json` and is embedded
//! at compile time, so the renderer and the shell can never drift apart without
//! a build/test failure. Unknown commands are denied by default, and a malformed
//! allowlist denies everything rather than allowing everything.

use serde::Deserialize;
use std::fmt;

const RAW_ALLOWLIST: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../ipc/allowlist.json"
));

#[derive(Debug, Deserialize)]
struct AllowlistFile {
    version: u32,
    commands: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IpcDenial {
    NotAllowed(String),
    MalformedAllowlist(String),
}

impl fmt::Display for IpcDenial {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            IpcDenial::NotAllowed(command) => {
                write!(formatter, "IPC command \"{command}\" is not allowlisted")
            }
            IpcDenial::MalformedAllowlist(reason) => {
                write!(formatter, "desktop IPC allowlist is malformed: {reason}")
            }
        }
    }
}

impl std::error::Error for IpcDenial {}

/// All allowlisted commands, or an error if the embedded allowlist is invalid.
pub fn allowed_commands() -> Result<Vec<String>, IpcDenial> {
    let parsed: AllowlistFile = serde_json::from_str(RAW_ALLOWLIST)
        .map_err(|error| IpcDenial::MalformedAllowlist(error.to_string()))?;
    if parsed.version == 0 {
        return Err(IpcDenial::MalformedAllowlist(
            "version must be >= 1".to_string(),
        ));
    }
    if parsed.commands.is_empty() {
        return Err(IpcDenial::MalformedAllowlist(
            "commands must not be empty".to_string(),
        ));
    }
    if parsed.commands.iter().any(|command| command.is_empty()) {
        return Err(IpcDenial::MalformedAllowlist(
            "commands must be non-empty strings".to_string(),
        ));
    }
    Ok(parsed.commands)
}

/// Deny-by-default check. A broken allowlist allows nothing.
pub fn is_allowed_command(command: &str) -> bool {
    match allowed_commands() {
        Ok(commands) => commands.iter().any(|candidate| candidate == command),
        Err(_) => false,
    }
}

pub fn authorize(command: &str) -> Result<(), IpcDenial> {
    if is_allowed_command(command) {
        Ok(())
    } else {
        Err(IpcDenial::NotAllowed(command.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_allowlist_parses() {
        let commands = allowed_commands().expect("allowlist should parse");
        assert!(!commands.is_empty());
    }

    #[test]
    fn known_commands_are_allowed() {
        assert!(is_allowed_command("navin_shell_info"));
        assert!(is_allowed_command("navin_navind_validate_endpoint"));
        assert!(authorize("navin_secret_retrieve").is_ok());
    }

    #[test]
    fn unknown_commands_are_denied_by_default() {
        assert!(!is_allowed_command("fs_read_file"));
        assert!(!is_allowed_command(""));
        assert!(!is_allowed_command("navin_secret_store_everything"));
        assert_eq!(
            authorize("plugin:shell|open"),
            Err(IpcDenial::NotAllowed("plugin:shell|open".to_string()))
        );
    }

    #[test]
    fn secret_commands_are_scoped_to_three_operations() {
        let secret_commands: Vec<String> = allowed_commands()
            .unwrap()
            .into_iter()
            .filter(|command| command.starts_with("navin_secret_"))
            .collect();
        assert_eq!(
            secret_commands,
            vec![
                "navin_secret_store".to_string(),
                "navin_secret_retrieve".to_string(),
                "navin_secret_delete".to_string(),
            ]
        );
    }
}
