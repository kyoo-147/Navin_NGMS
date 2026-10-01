//! Fail-closed updater policy.
//!
//! A disabled updater must carry no endpoints, signing key or host allowlist. An
//! enabled updater must be signed, use HTTPS only, and point at an explicitly
//! allow-listed host. URL parsing is delegated to the standard `url` parser;
//! malformed URLs and userinfo are rejected instead of normalized into policy.

use std::fmt;
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdatePolicyInput {
    pub enabled: bool,
    pub endpoints: Vec<String>,
    pub pubkey: String,
    pub allow_hosts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdatePolicy {
    pub enabled: bool,
    pub endpoints: Vec<String>,
    pub allow_hosts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdatePolicyError {
    DisabledWithConfig,
    MissingPubkey,
    MissingEndpoint,
    MissingAllowlist,
    InsecureEndpoint(String),
    UserInfo(String),
    HostNotAllowed(String),
}

impl fmt::Display for UpdatePolicyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            UpdatePolicyError::DisabledWithConfig => formatter.write_str(
                "disabled updater must not declare endpoints, a pubkey, or allowed hosts",
            ),
            UpdatePolicyError::MissingPubkey => {
                formatter.write_str("enabled updater requires a signing public key")
            }
            UpdatePolicyError::MissingEndpoint => {
                formatter.write_str("enabled updater requires at least one endpoint")
            }
            UpdatePolicyError::MissingAllowlist => {
                formatter.write_str("enabled updater requires an explicit host allowlist")
            }
            UpdatePolicyError::InsecureEndpoint(endpoint) => {
                write!(formatter, "update endpoint must use HTTPS: {endpoint}")
            }
            UpdatePolicyError::UserInfo(endpoint) => {
                write!(
                    formatter,
                    "update endpoint must not embed credentials: {endpoint}"
                )
            }
            UpdatePolicyError::HostNotAllowed(host) => {
                write!(
                    formatter,
                    "update endpoint host \"{host}\" is not in the allowlist"
                )
            }
        }
    }
}

impl std::error::Error for UpdatePolicyError {}

fn has_control_character(input: &str) -> bool {
    input.chars().any(|character| character.is_ascii_control())
}

fn raw_authority(endpoint: &str) -> Option<&str> {
    let separator = endpoint.find("://")?;
    let remainder = &endpoint[separator + 3..];
    let end = remainder.find(['/', '?', '#']).unwrap_or(remainder.len());
    Some(&remainder[..end])
}

fn https_host(endpoint: &str) -> Result<String, UpdatePolicyError> {
    if has_control_character(endpoint) {
        return Err(UpdatePolicyError::InsecureEndpoint(endpoint.to_string()));
    }
    let parsed = Url::parse(endpoint)
        .map_err(|_| UpdatePolicyError::InsecureEndpoint(endpoint.to_string()))?;
    let authority = raw_authority(endpoint)
        .ok_or_else(|| UpdatePolicyError::InsecureEndpoint(endpoint.to_string()))?;
    if authority.contains('@') || !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(UpdatePolicyError::UserInfo(endpoint.to_string()));
    }
    if authority.ends_with(':') {
        return Err(UpdatePolicyError::InsecureEndpoint(endpoint.to_string()));
    }
    if parsed.scheme() != "https" {
        return Err(UpdatePolicyError::InsecureEndpoint(endpoint.to_string()));
    }
    parsed
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| UpdatePolicyError::InsecureEndpoint(endpoint.to_string()))
}

pub fn resolve_update_policy(input: UpdatePolicyInput) -> Result<UpdatePolicy, UpdatePolicyError> {
    let endpoints: Vec<String> = input
        .endpoints
        .iter()
        .map(|e| e.trim().to_string())
        .collect();
    let pubkey = input.pubkey.trim().to_string();
    let allow_hosts: Vec<String> = input
        .allow_hosts
        .iter()
        .map(|host| host.trim().to_ascii_lowercase())
        .collect();

    if !input.enabled {
        if !endpoints.is_empty() || !pubkey.is_empty() || !allow_hosts.is_empty() {
            return Err(UpdatePolicyError::DisabledWithConfig);
        }
        return Ok(UpdatePolicy {
            enabled: false,
            endpoints: Vec::new(),
            allow_hosts: Vec::new(),
        });
    }

    if pubkey.is_empty() {
        return Err(UpdatePolicyError::MissingPubkey);
    }
    if endpoints.is_empty() {
        return Err(UpdatePolicyError::MissingEndpoint);
    }
    if allow_hosts.is_empty() {
        return Err(UpdatePolicyError::MissingAllowlist);
    }

    for endpoint in &endpoints {
        let host = https_host(endpoint)?;
        if !allow_hosts.iter().any(|allowed| allowed == &host) {
            return Err(UpdatePolicyError::HostNotAllowed(host));
        }
    }

    Ok(UpdatePolicy {
        enabled: true,
        endpoints,
        allow_hosts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(enabled: bool, endpoints: &[&str], pubkey: &str, hosts: &[&str]) -> UpdatePolicyInput {
        UpdatePolicyInput {
            enabled,
            endpoints: endpoints.iter().map(|value| value.to_string()).collect(),
            pubkey: pubkey.to_string(),
            allow_hosts: hosts.iter().map(|value| value.to_string()).collect(),
        }
    }

    #[test]
    fn disabled_updater_is_empty() {
        let policy = resolve_update_policy(input(false, &[], "", &[])).unwrap();
        assert!(!policy.enabled);
        assert!(policy.endpoints.is_empty());
    }

    #[test]
    fn disabled_updater_rejects_config() {
        assert_eq!(
            resolve_update_policy(input(false, &["https://updates.example.com"], "", &[])),
            Err(UpdatePolicyError::DisabledWithConfig)
        );
    }

    #[test]
    fn enabled_updater_requires_signature_https_and_allowlist() {
        assert_eq!(
            resolve_update_policy(input(
                true,
                &["https://updates.example.com"],
                "",
                &["updates.example.com"]
            )),
            Err(UpdatePolicyError::MissingPubkey)
        );
        assert_eq!(
            resolve_update_policy(input(true, &[], "KEY", &["updates.example.com"])),
            Err(UpdatePolicyError::MissingEndpoint)
        );
        assert_eq!(
            resolve_update_policy(input(true, &["https://updates.example.com"], "KEY", &[])),
            Err(UpdatePolicyError::MissingAllowlist)
        );
        assert_eq!(
            resolve_update_policy(input(
                true,
                &["http://updates.example.com"],
                "KEY",
                &["updates.example.com"]
            )),
            Err(UpdatePolicyError::InsecureEndpoint(
                "http://updates.example.com".to_string()
            ))
        );
        assert_eq!(
            resolve_update_policy(input(
                true,
                &["https://user:pass@updates.example.com"],
                "KEY",
                &["updates.example.com"]
            )),
            Err(UpdatePolicyError::UserInfo(
                "https://user:pass@updates.example.com".to_string()
            ))
        );
        assert_eq!(
            resolve_update_policy(input(
                true,
                &["https://evil.example"],
                "KEY",
                &["updates.example.com"]
            )),
            Err(UpdatePolicyError::HostNotAllowed(
                "evil.example".to_string()
            ))
        );
    }

    #[test]
    fn enabled_updater_accepts_a_fully_specified_config() {
        let policy = resolve_update_policy(input(
            true,
            &["https://updates.example.com/stable/"],
            "KEY",
            &["updates.example.com"],
        ))
        .unwrap();
        assert!(policy.enabled);
        assert_eq!(
            policy.endpoints,
            vec!["https://updates.example.com/stable/".to_string()]
        );
    }
}
