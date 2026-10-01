//! navind endpoint transport policy.
//!
//! URL parsing is delegated to the `url` crate. The narrow raw-authority checks
//! only stop URL canonicalization from hiding controls, empty ports, userinfo,
//! or ambiguous numeric spellings of loopback.

use std::fmt;
use url::{Host, Url};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scheme {
    Http,
    Https,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NavindEndpoint {
    pub origin: String,
    pub path_prefix: String,
    pub scheme: Scheme,
    pub host: String,
    pub is_loopback: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EndpointRejection {
    InvalidUrl,
    UserInfo,
    UnsupportedScheme,
    MissingHost,
    QueryOrFragment,
    PlaintextRemote,
}

impl fmt::Display for EndpointRejection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            EndpointRejection::InvalidUrl => "not a valid absolute navind URL",
            EndpointRejection::UserInfo => "navind endpoints must not embed credentials",
            EndpointRejection::UnsupportedScheme => "unsupported navind endpoint scheme",
            EndpointRejection::MissingHost => "navind endpoint must include a host",
            EndpointRejection::QueryOrFragment => {
                "navind endpoint must not include a query or fragment"
            }
            EndpointRejection::PlaintextRemote => {
                "refusing plaintext HTTP navind endpoint for a non-loopback host"
            }
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for EndpointRejection {}

pub fn is_loopback_host(host: &str) -> bool {
    matches!(
        host.trim_matches(['[', ']']).to_ascii_lowercase().as_str(),
        "127.0.0.1" | "::1"
    )
}

fn has_control_character(input: &str) -> bool {
    input.chars().any(|character| character.is_ascii_control())
}

fn has_encoded_separator(input: &str) -> bool {
    let bytes = input.as_bytes();
    bytes.windows(3).any(|window| {
        window[0] == b'%'
            && ((window[1] == b'2' && matches!(window[2], b'F' | b'f'))
                || (window[1] == b'5' && matches!(window[2], b'C' | b'c')))
    })
}

fn is_encoded_dot_segment(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    let mut index = 0;
    let mut dots = 0;
    while index < bytes.len() {
        if bytes[index] == b'.' {
            index += 1;
        } else if index + 2 < bytes.len()
            && bytes[index] == b'%'
            && bytes[index + 1] == b'2'
            && matches!(bytes[index + 2], b'E' | b'e')
        {
            index += 3;
        } else {
            return false;
        }
        dots += 1;
    }
    (1..=2).contains(&dots)
}

fn has_unsafe_path_syntax(input: &str) -> bool {
    if input.contains('\\') || has_encoded_separator(input) {
        return true;
    }
    let Some(separator) = input.find("://") else {
        return false;
    };
    let remainder = &input[separator + 3..];
    let Some(path_start) = remainder.find(['/', '?', '#']) else {
        return false;
    };
    if remainder.as_bytes()[path_start] != b'/' {
        return false;
    }
    let path = remainder[path_start..]
        .split(['?', '#'])
        .next()
        .unwrap_or_default();
    path.split('/').any(is_encoded_dot_segment)
}

fn raw_authority(input: &str) -> Option<&str> {
    let separator = input.find("://")?;
    let remainder = &input[separator + 3..];
    let end = remainder.find(['/', '?', '#']).unwrap_or(remainder.len());
    Some(&remainder[..end])
}

fn raw_authority_host(authority: &str) -> Option<String> {
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    if let Some(rest) = authority.strip_prefix('[') {
        let end = rest.find(']')?;
        let port = &rest[end + 1..];
        if !port.is_empty()
            && (!port.starts_with(':') || !port[1..].bytes().all(|byte| byte.is_ascii_digit()))
        {
            return None;
        }
        return Some(authority[..=end + 1].to_ascii_lowercase());
    }

    match authority.split_once(':') {
        None => Some(authority.to_ascii_lowercase()),
        Some((host, port))
            if !host.is_empty()
                && !port.is_empty()
                && port.bytes().all(|byte| byte.is_ascii_digit())
                && !port.contains(':') =>
        {
            Some(host.to_ascii_lowercase())
        }
        Some(_) => None,
    }
}

fn parsed_host(url: &Url) -> Option<String> {
    match url.host()? {
        Host::Domain(host) => Some(host.to_ascii_lowercase()),
        Host::Ipv4(host) => Some(host.to_string()),
        Host::Ipv6(host) => Some(format!("[{host}]")),
    }
}

pub fn parse_navind_endpoint(input: &str) -> Result<NavindEndpoint, EndpointRejection> {
    if has_control_character(input) || has_unsafe_path_syntax(input) {
        return Err(EndpointRejection::InvalidUrl);
    }

    let url = Url::parse(input).map_err(|_| EndpointRejection::InvalidUrl)?;
    let authority = raw_authority(input).ok_or(EndpointRejection::InvalidUrl)?;
    if authority.is_empty() {
        return Err(EndpointRejection::MissingHost);
    }
    if authority.contains('@') || !url.username().is_empty() || url.password().is_some() {
        return Err(EndpointRejection::UserInfo);
    }
    let literal_host = raw_authority_host(authority).ok_or(EndpointRejection::InvalidUrl)?;

    let scheme = match url.scheme() {
        "http" => Scheme::Http,
        "https" => Scheme::Https,
        _ => return Err(EndpointRejection::UnsupportedScheme),
    };
    let host = parsed_host(&url).ok_or(EndpointRejection::MissingHost)?;
    if url.query().is_some() || url.fragment().is_some() {
        return Err(EndpointRejection::QueryOrFragment);
    }

    let is_loopback = is_loopback_host(&host);
    if scheme == Scheme::Http && !matches!(literal_host.as_str(), "127.0.0.1" | "[::1]") {
        return Err(EndpointRejection::PlaintextRemote);
    }

    Ok(NavindEndpoint {
        origin: url.origin().ascii_serialization(),
        path_prefix: url.path().trim_end_matches('/').to_string(),
        scheme,
        host,
        is_loopback,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    struct CorpusCase {
        input: String,
        accepted: bool,
        origin: Option<String>,
        #[serde(rename = "pathPrefix")]
        path_prefix: Option<String>,
        scheme: Option<String>,
        host: Option<String>,
        #[serde(rename = "isLoopback")]
        is_loopback: Option<bool>,
    }

    #[test]
    fn ts_and_rust_share_the_same_endpoint_corpus() {
        let corpus: Vec<CorpusCase> = serde_json::from_str(include_str!(
            "../../../../src/shell/navind/endpoint-corpus.json"
        ))
        .expect("endpoint corpus should parse");

        for case in corpus {
            let result = parse_navind_endpoint(&case.input);
            assert_eq!(result.is_ok(), case.accepted, "case: {}", case.input);
            if let (
                Ok(endpoint),
                Some(origin),
                Some(path_prefix),
                Some(scheme),
                Some(host),
                Some(is_loopback),
            ) = (
                result,
                case.origin,
                case.path_prefix,
                case.scheme,
                case.host,
                case.is_loopback,
            ) {
                assert_eq!(endpoint.origin, origin, "origin: {}", case.input);
                assert_eq!(endpoint.path_prefix, path_prefix, "path: {}", case.input);
                assert_eq!(
                    endpoint.scheme,
                    if scheme == "https" {
                        Scheme::Https
                    } else {
                        Scheme::Http
                    }
                );
                assert_eq!(endpoint.host, host, "host: {}", case.input);
                assert_eq!(
                    endpoint.is_loopback, is_loopback,
                    "loopback: {}",
                    case.input
                );
            }
        }
    }
}
