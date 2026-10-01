//! Secret storage policy: OS keychain or nothing.
//!
//! There is deliberately no plaintext variant. When the OS keychain is
//! unavailable the shell must fail closed rather than writing secrets to a file,
//! environment variable or web storage.

use std::fmt;

/// The only storage backend the desktop shell will ever use. A plaintext
/// fallback cannot be expressed because no such variant exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretBackend {
    OsKeychain,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretError {
    Unavailable,
    InvalidReference(&'static str),
}

impl fmt::Display for SecretError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SecretError::Unavailable => formatter.write_str(
                "no OS keychain available; refusing to persist secrets (no plaintext fallback)",
            ),
            SecretError::InvalidReference(reason) => {
                write!(formatter, "invalid secret reference: {reason}")
            }
        }
    }
}

impl std::error::Error for SecretError {}

fn is_valid_segment(segment: &str, max_length: usize) -> bool {
    if segment.is_empty() || segment.len() > max_length {
        return false;
    }
    let mut chars = segment.chars();
    let first = chars.next().unwrap_or('\0');
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return false;
    }
    chars.all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || matches!(ch, '.' | '_' | '-'))
}

pub fn validate_secret_ref(namespace: &str, name: &str) -> Result<(), SecretError> {
    if !is_valid_segment(namespace, 64) {
        return Err(SecretError::InvalidReference("namespace"));
    }
    if !is_valid_segment(name, 128) {
        return Err(SecretError::InvalidReference("name"));
    }
    Ok(())
}

pub fn resolve_backend(os_keychain_available: bool) -> Result<SecretBackend, SecretError> {
    if os_keychain_available {
        Ok(SecretBackend::OsKeychain)
    } else {
        Err(SecretError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_well_formed_references() {
        assert!(validate_secret_ref("navin-desktop", "navin-mail.refresh").is_ok());
        assert!(validate_secret_ref("account1", "token_2").is_ok());
    }

    #[test]
    fn rejects_malformed_references() {
        assert_eq!(
            validate_secret_ref("", "token"),
            Err(SecretError::InvalidReference("namespace"))
        );
        assert_eq!(
            validate_secret_ref("Navin", "token"),
            Err(SecretError::InvalidReference("namespace"))
        );
        assert_eq!(
            validate_secret_ref("navin", "../escape"),
            Err(SecretError::InvalidReference("name"))
        );
    }

    #[test]
    fn fails_closed_without_a_keychain() {
        assert_eq!(resolve_backend(true), Ok(SecretBackend::OsKeychain));
        assert_eq!(resolve_backend(false), Err(SecretError::Unavailable));
    }
}
