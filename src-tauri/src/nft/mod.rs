//! Calldata for a direct wallet-to-wallet NFT transfer.
//!
//! This is not a marketplace sale — Bulk Actions (list/cancel/bid) already
//! covers that. This is `transferFrom`/`safeTransferFrom` straight from one
//! address to another, and per the T9 decision (`docs/DECISIONS-PENDING.md`
//! D2) it goes through the exact same spend envelope as an ETH send, called
//! with `value_wei = 0`: no new cap, no new allowlist. The destination must
//! already be in the wallet's existing ETH scope — see
//! `signing::transfer_nft` for where that check happens.

use alloy::primitives::{keccak256, Address, U256};

/// Which token standard the collection implements. NFT metadata already
/// carries this (Alchemy returns `"ERC721"` / `"ERC1155"`); callers should
/// not guess.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TokenStandard {
    Erc721,
    Erc1155,
}

/// First 4 bytes of `keccak256(signature)` — the standard ABI function
/// selector. Computed from the signature string rather than hardcoded, so a
/// typo in the signature fails the selector tests below instead of silently
/// calling the wrong function on-chain.
fn selector(signature: &str) -> [u8; 4] {
    let hash = keccak256(signature.as_bytes());
    [hash[0], hash[1], hash[2], hash[3]]
}

fn encode_address(addr: Address) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[12..].copy_from_slice(addr.as_slice());
    word
}

fn encode_u256(value: U256) -> [u8; 32] {
    value.to_be_bytes()
}

/// ERC-721 `safeTransferFrom(address from, address to, uint256 tokenId)`.
/// The safe variant (not plain `transferFrom`) so a transfer into a contract
/// that cannot handle NFTs reverts instead of burning the token.
pub fn encode_erc721_transfer(from: Address, to: Address, token_id: U256) -> Vec<u8> {
    let mut data = Vec::with_capacity(4 + 32 * 3);
    data.extend_from_slice(&selector("safeTransferFrom(address,address,uint256)"));
    data.extend_from_slice(&encode_address(from));
    data.extend_from_slice(&encode_address(to));
    data.extend_from_slice(&encode_u256(token_id));
    data
}

/// ERC-1155
/// `safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)`.
/// `amount` is the quantity of this token id to move — usually 1 for a
/// collectible, but ERC-1155 permits more. The trailing `bytes` is always
/// empty here: Westron does not use the on-receive hook payload.
pub fn encode_erc1155_transfer(
    from: Address,
    to: Address,
    token_id: U256,
    amount: U256,
) -> Vec<u8> {
    const STATIC_WORDS: u64 = 5; // from, to, id, amount, bytes-offset
    let mut data = Vec::with_capacity(4 + 32 * 7);
    data.extend_from_slice(&selector(
        "safeTransferFrom(address,address,uint256,uint256,bytes)",
    ));
    data.extend_from_slice(&encode_address(from));
    data.extend_from_slice(&encode_address(to));
    data.extend_from_slice(&encode_u256(token_id));
    data.extend_from_slice(&encode_u256(amount));
    // Offset (in bytes, from the start of the encoded args) to the dynamic
    // `bytes data` payload.
    data.extend_from_slice(&encode_u256(U256::from(STATIC_WORDS * 32)));
    // Empty bytes: just its zero length, no content word needed.
    data.extend_from_slice(&encode_u256(U256::ZERO));
    data
}

/// Dispatches to the right encoder for `standard`. `amount` is ignored for
/// ERC-721 (always exactly one token per id).
pub fn encode_transfer(
    standard: TokenStandard,
    from: Address,
    to: Address,
    token_id: U256,
    amount: U256,
) -> Vec<u8> {
    match standard {
        TokenStandard::Erc721 => encode_erc721_transfer(from, to, token_id),
        TokenStandard::Erc1155 => encode_erc1155_transfer(from, to, token_id, amount),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FROM: &str = "0x00000000000000000000000000000000000000f1"; // "f1" = from
    const TO: &str = "0x00000000000000000000000000000000000000d5"; // "d5" = destination

    fn addr(s: &str) -> Address {
        s.parse().unwrap()
    }

    /// Selectors are computed at runtime from the signature string. Pin them
    /// against the well-known, spec-published 4-byte values so a typo in the
    /// signature (e.g. a missing space, wrong arg order) is caught here
    /// instead of on-chain against a contract that doesn't implement it.
    #[test]
    fn erc721_selector_matches_the_published_function_selector() {
        assert_eq!(
            selector("safeTransferFrom(address,address,uint256)"),
            [0x42, 0x84, 0x2e, 0x0e]
        );
    }

    #[test]
    fn erc1155_selector_matches_the_published_function_selector() {
        assert_eq!(
            selector("safeTransferFrom(address,address,uint256,uint256,bytes)"),
            [0xf2, 0x42, 0x43, 0x2a]
        );
    }

    #[test]
    fn erc721_calldata_is_selector_plus_three_32_byte_words() {
        let data = encode_erc721_transfer(addr(FROM), addr(TO), U256::from(42u64));
        assert_eq!(data.len(), 4 + 32 * 3, "4-byte selector + from + to + tokenId");
        assert_eq!(&data[0..4], &[0x42, 0x84, 0x2e, 0x0e]);
        // `from` word: left-padded to 32 bytes, address in the low 20 bytes.
        assert_eq!(&data[4..16], &[0u8; 12]);
        assert_eq!(&data[16..36], addr(FROM).as_slice());
        assert_eq!(&data[36..48], &[0u8; 12]);
        assert_eq!(&data[48..68], addr(TO).as_slice());
        // tokenId = 42
        assert_eq!(&data[68..99], &[0u8; 31]);
        assert_eq!(data[99], 42);
    }

    #[test]
    fn erc1155_calldata_encodes_empty_trailing_bytes_correctly() {
        let data = encode_erc1155_transfer(addr(FROM), addr(TO), U256::from(7u64), U256::from(1u64));
        // selector + from + to + id + amount + bytes-offset + bytes-length(0)
        assert_eq!(data.len(), 4 + 32 * 6);
        assert_eq!(&data[0..4], &[0xf2, 0x42, 0x43, 0x2a]);
        // bytes-offset word (5th arg word, i.e. bytes [4+32*4 .. 4+32*5)) must be 160 (0xa0).
        let offset_word = &data[4 + 32 * 4..4 + 32 * 5];
        assert_eq!(offset_word, encode_u256(U256::from(160u64)));
        // bytes-length word (final word) must be zero.
        let length_word = &data[4 + 32 * 5..4 + 32 * 6];
        assert_eq!(length_word, [0u8; 32]);
    }

    #[test]
    fn dispatch_picks_the_matching_encoder_for_each_standard() {
        let erc721_direct = encode_erc721_transfer(addr(FROM), addr(TO), U256::from(1u64));
        let erc721_dispatched = encode_transfer(
            TokenStandard::Erc721,
            addr(FROM),
            addr(TO),
            U256::from(1u64),
            U256::from(1u64), // amount ignored for ERC-721
        );
        assert_eq!(erc721_direct, erc721_dispatched);

        let erc1155_direct = encode_erc1155_transfer(addr(FROM), addr(TO), U256::from(9u64), U256::from(3u64));
        let erc1155_dispatched = encode_transfer(
            TokenStandard::Erc1155,
            addr(FROM),
            addr(TO),
            U256::from(9u64),
            U256::from(3u64),
        );
        assert_eq!(erc1155_direct, erc1155_dispatched);
    }
}
