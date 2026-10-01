//! Entitlement gating for desktop surfaces.
//!
//! Hiding a module is a UX affordance only; the navind backend remains the
//! authoritative authorization boundary. These helpers decide what the shell
//! offers to render and never replace server enforcement.

use crate::deeplink::Surface;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Entitlements {
    pub roles: Vec<String>,
    pub scopes: Vec<String>,
}

const CONTROL_ROLES: &[&str] = &[
    "org.support",
    "org.user_admin",
    "org.domain_admin",
    "ops.viewer",
    "ops.operator",
    "ops.security_admin",
    "ops.backup_admin",
    "ops.super_admin",
    "platform.developer",
];

const MAIL_ROLES: &[&str] = &["mail.user", "mail.delegate"];

fn wildcard_match(pattern: &str, value: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern == value;
    }
    let mut index = 0usize;
    let last = parts.len() - 1;
    for (position, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if index > value.len() {
            return false;
        }
        if position == 0 {
            if !value[index..].starts_with(part) {
                return false;
            }
            index += part.len();
        } else if position == last {
            return value[index..].ends_with(part);
        } else {
            match value[index..].find(part) {
                Some(found) => index += found + part.len(),
                None => return false,
            }
        }
    }
    true
}

pub fn scope_matches(granted: &str, required: &str) -> bool {
    if granted == required {
        return true;
    }
    if !granted.contains('*') {
        return false;
    }
    wildcard_match(granted, required)
}

impl Entitlements {
    pub fn has_scope(&self, required: &str) -> bool {
        self.scopes
            .iter()
            .any(|granted| scope_matches(granted, required))
    }

    fn has_any_role(&self, roles: &[&str]) -> bool {
        self.roles.iter().any(|role| roles.contains(&role.as_str()))
    }

    pub fn can_open_control(&self) -> bool {
        self.scopes
            .iter()
            .any(|scope| scope.starts_with("control:"))
            || self.has_any_role(CONTROL_ROLES)
    }

    pub fn can_open_mail(&self) -> bool {
        self.scopes.iter().any(|scope| scope.starts_with("mail:")) || self.has_any_role(MAIL_ROLES)
    }

    pub fn default_module(&self) -> Option<Surface> {
        if self.can_open_mail() {
            Some(Surface::Mail)
        } else if self.can_open_control() {
            Some(Surface::Control)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entitlements(roles: &[&str], scopes: &[&str]) -> Entitlements {
        Entitlements {
            roles: roles.iter().map(|value| value.to_string()).collect(),
            scopes: scopes.iter().map(|value| value.to_string()).collect(),
        }
    }

    #[test]
    fn ordinary_mail_user_cannot_open_control() {
        let user = entitlements(&["mail.user"], &["mail:read", "mail:write"]);
        assert!(user.can_open_mail());
        assert!(!user.can_open_control());
        assert_eq!(user.default_module(), Some(Surface::Mail));
    }

    #[test]
    fn control_only_operator_lands_in_control() {
        let operator = entitlements(&["ops.operator"], &["control:plan"]);
        assert!(!operator.can_open_mail());
        assert!(operator.can_open_control());
        assert_eq!(operator.default_module(), Some(Surface::Control));
    }

    #[test]
    fn wildcard_scopes_match_the_namespace() {
        assert!(scope_matches("control:*", "control:plan"));
        assert!(!scope_matches("control:*", "mail:read"));
        let wildcard_user = entitlements(&[], &["control:*"]);
        assert!(wildcard_user.can_open_control());
    }

    #[test]
    fn no_entitlements_yields_no_module() {
        let anonymous = entitlements(&[], &[]);
        assert_eq!(anonymous.default_module(), None);
    }
}
