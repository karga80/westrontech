//! API key normalisation.
//!
//! Alchemy's dashboard shows the full endpoint URL far more prominently than
//! the bare key, so pasting `https://eth-mainnet.g.alchemy.com/v2/<key>` into
//! the settings field is the common mistake. Stored verbatim it produces an
//! endless 401 loop: the RPC URL becomes `.../v2/https://.../v2/<key>` and the
//! Prices API receives a URL as its Bearer token.
//!
//! We normalise at the storage boundary — on write *and* on read — so a key
//! saved before this existed heals itself without the user re-entering it.

/// Path segments that are part of an Alchemy endpoint rather than the key.
/// If trimming a URL leaves only one of these, the input carried no key.
const PATH_TOKENS: &[&str] = &["v1", "v2", "v3", "nft", "prices", "data", "tokens"];

/// Extract the bare API key from whatever the user pasted.
///
/// - `https://eth-mainnet.g.alchemy.com/v2/abc123` → `abc123`
/// - `wss://eth-mainnet.g.alchemy.com/v2/abc123/`  → `abc123`
/// - `  abc123\n`                                   → `abc123`
///
/// Returns an empty string when no key can be recovered, so callers surface a
/// missing-key error instead of silently authenticating with a path fragment.
pub fn normalize_api_key(raw: &str) -> String {
    let trimmed = raw.trim();

    // Not a URL — the user pasted the key itself.
    if !trimmed.contains("://") {
        return trimmed.to_string();
    }

    // Drop query string and fragment, then take the last non-empty path segment.
    let without_query = trimmed
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_end_matches('/');

    let segment = without_query.rsplit('/').find(|s| !s.is_empty()).unwrap_or("");

    if PATH_TOKENS.iter().any(|t| segment.eq_ignore_ascii_case(t)) {
        return String::new();
    }

    segment.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_bare_key_unchanged() {
        assert_eq!(normalize_api_key("abc123XYZ"), "abc123XYZ");
    }

    #[test]
    fn trims_surrounding_whitespace_and_newlines() {
        assert_eq!(normalize_api_key("  abc123XYZ\n"), "abc123XYZ");
    }

    #[test]
    fn extracts_key_from_https_rpc_url() {
        assert_eq!(
            normalize_api_key("https://eth-mainnet.g.alchemy.com/v2/abc123XYZ"),
            "abc123XYZ"
        );
    }

    #[test]
    fn extracts_key_from_websocket_url() {
        assert_eq!(
            normalize_api_key("wss://eth-mainnet.g.alchemy.com/v2/abc123XYZ"),
            "abc123XYZ"
        );
    }

    #[test]
    fn ignores_trailing_slash() {
        assert_eq!(
            normalize_api_key("https://eth-mainnet.g.alchemy.com/v2/abc123XYZ/"),
            "abc123XYZ"
        );
    }

    #[test]
    fn strips_query_string_and_fragment() {
        assert_eq!(
            normalize_api_key("https://eth-mainnet.g.alchemy.com/v2/abc123XYZ?foo=bar#frag"),
            "abc123XYZ"
        );
    }

    #[test]
    fn returns_empty_when_url_carries_no_key() {
        assert_eq!(normalize_api_key("https://eth-mainnet.g.alchemy.com/v2/"), "");
        assert_eq!(normalize_api_key("https://eth-mainnet.g.alchemy.com/v2"), "");
    }

    #[test]
    fn returns_empty_for_blank_input() {
        assert_eq!(normalize_api_key(""), "");
        assert_eq!(normalize_api_key("   \n "), "");
    }

    #[test]
    fn is_idempotent() {
        let url = "https://eth-mainnet.g.alchemy.com/v2/abc123XYZ";
        let once = normalize_api_key(url);
        assert_eq!(normalize_api_key(&once), once);
    }
}
