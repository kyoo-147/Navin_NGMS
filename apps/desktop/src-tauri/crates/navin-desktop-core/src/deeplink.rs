//! Deep-link parsing for the `navin://` scheme.
//!
//! A deep link is untrusted input (any local process can open a registered
//! scheme), so it is parsed into a small closed set of typed actions and
//! everything else is rejected.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Surface {
    Mail,
    Control,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeepLinkAction {
    OpenSurface(Surface),
    OAuthCallback { code: String, state: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeepLinkRejection {
    InvalidUrl,
    UnsupportedScheme,
    UserInfo,
    Fragment,
    UnknownTarget,
    MissingOAuthParams,
}

impl fmt::Display for DeepLinkRejection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            DeepLinkRejection::InvalidUrl => "not a valid deep link",
            DeepLinkRejection::UnsupportedScheme => "unsupported deep-link scheme",
            DeepLinkRejection::UserInfo => "deep links must not embed credentials",
            DeepLinkRejection::Fragment => "deep links must not include a fragment",
            DeepLinkRejection::UnknownTarget => "unsupported deep-link target",
            DeepLinkRejection::MissingOAuthParams => "oauth callback requires code and state",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for DeepLinkRejection {}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                output.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                match (hex_value(bytes[index + 1]), hex_value(bytes[index + 2])) {
                    (Some(high), Some(low)) => {
                        output.push(high * 16 + low);
                        index += 3;
                    }
                    _ => {
                        output.push(b'%');
                        index += 1;
                    }
                }
            }
            byte => {
                output.push(byte);
                index += 1;
            }
        }
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let (candidate, value) = pair.split_once('=').unwrap_or((pair, ""));
        if candidate == key {
            return Some(percent_decode(value));
        }
    }
    None
}

pub fn parse_deep_link(url: &str) -> Result<DeepLinkAction, DeepLinkRejection> {
    let (scheme, rest) = url.split_once("://").ok_or(DeepLinkRejection::InvalidUrl)?;
    if !scheme.eq_ignore_ascii_case("navin") {
        return Err(DeepLinkRejection::UnsupportedScheme);
    }
    if rest.is_empty() {
        return Err(DeepLinkRejection::InvalidUrl);
    }
    if rest.contains('#') {
        return Err(DeepLinkRejection::Fragment);
    }

    let (before_query, query) = match rest.split_once('?') {
        Some((before_query, query)) => (before_query, Some(query)),
        None => (rest, None),
    };
    let (authority, path) = match before_query.split_once('/') {
        Some((authority, remainder)) => (authority, format!("/{remainder}")),
        None => (before_query, String::new()),
    };
    if authority.is_empty() {
        return Err(DeepLinkRejection::InvalidUrl);
    }
    if authority.contains('@') {
        return Err(DeepLinkRejection::UserInfo);
    }

    let host = authority.to_ascii_lowercase();
    let trimmed_path = path.trim_end_matches('/');

    match host.as_str() {
        "open" => {
            if query.is_some() {
                return Err(DeepLinkRejection::UnknownTarget);
            }
            match trimmed_path {
                "/mail" => Ok(DeepLinkAction::OpenSurface(Surface::Mail)),
                "/control" => Ok(DeepLinkAction::OpenSurface(Surface::Control)),
                _ => Err(DeepLinkRejection::UnknownTarget),
            }
        }
        "oauth" => {
            if trimmed_path != "/callback" {
                return Err(DeepLinkRejection::UnknownTarget);
            }
            let query = query.unwrap_or("");
            let code = query_param(query, "code").unwrap_or_default();
            let state = query_param(query, "state").unwrap_or_default();
            if code.is_empty() || state.is_empty() {
                return Err(DeepLinkRejection::MissingOAuthParams);
            }
            Ok(DeepLinkAction::OAuthCallback { code, state })
        }
        _ => Err(DeepLinkRejection::UnknownTarget),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_surface_targets() {
        assert_eq!(
            parse_deep_link("navin://open/mail"),
            Ok(DeepLinkAction::OpenSurface(Surface::Mail))
        );
        assert_eq!(
            parse_deep_link("navin://open/control"),
            Ok(DeepLinkAction::OpenSurface(Surface::Control))
        );
    }

    #[test]
    fn parses_oauth_callback() {
        assert_eq!(
            parse_deep_link("navin://oauth/callback?code=abc&state=xyz"),
            Ok(DeepLinkAction::OAuthCallback {
                code: "abc".to_string(),
                state: "xyz".to_string(),
            })
        );
    }

    #[test]
    fn rejects_untrusted_targets() {
        assert_eq!(
            parse_deep_link("navin://open/../../etc/passwd"),
            Err(DeepLinkRejection::UnknownTarget)
        );
        assert_eq!(
            parse_deep_link("navin://open/mail?next=https://evil.example"),
            Err(DeepLinkRejection::UnknownTarget)
        );
        assert_eq!(
            parse_deep_link("navin://oauth/callback?code=only"),
            Err(DeepLinkRejection::MissingOAuthParams)
        );
        assert_eq!(
            parse_deep_link("https://evil.example/open/mail"),
            Err(DeepLinkRejection::UnsupportedScheme)
        );
        assert_eq!(
            parse_deep_link("navin://open/mail#frag"),
            Err(DeepLinkRejection::Fragment)
        );
        assert_eq!(
            parse_deep_link("navin://user@open/mail"),
            Err(DeepLinkRejection::UserInfo)
        );
    }
}
