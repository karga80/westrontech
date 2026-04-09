'use client';

export type TagVariant =
  | 'success'     // green  — generic success, Sale, active
  | 'danger'      // red    — generic error, Failed
  | 'warning'     // amber  — Pending, Scheduled
  | 'info'        // blue   — Routine, Listing, Watch
  | 'purple'      // purple — generic NFT badge
  | 'neutral'     // gray   — inactive, default
  | 'accent'      // lime   — AI, Running, primary CTA
  // ── NFT group (shared purple bg, distinct text) ──────────────────────────
  | 'nft-buy'     // light purple  — bought NFT from marketplace
  | 'nft-sell'    // pink          — sold NFT on marketplace
  | 'nft-sent'    // indigo        — transferred NFT (no sale)
  | 'nft-offer'   // amber         — placed collection/item offer (bid)
  | 'nft-mint'    // green         — minted new NFT (from 0x0)
  | 'sweep'       // fuchsia       — bulk NFT sweep (multiple buys in one tx)
  // ── Token group (shared teal bg, distinct text) ──────────────────────────
  | 'token-in'    // green         — received ETH / ERC-20
  | 'token-out'   // red           — sent ETH / ERC-20
  | 'swap'        // cyan          — DEX token swap
  | 'approve'     // amber         — ERC-20/NFT contract approval
  // ── Contract group ───────────────────────────────────────────────────────
  | 'contract';   // gray          — generic smart contract interaction

interface TagProps {
  variant: TagVariant;
  children: React.ReactNode;
  dot?: boolean;
  size?: 'xs' | 'sm';
  className?: string;
}

export function Tag({ variant, children, dot, size = 'sm', className }: TagProps) {
  const fontSize = size === 'xs' ? '9px' : '10px';
  const padding  = size === 'xs' ? '1px 5px' : '2px 7px';

  return (
    <span
      className={className}
      style={{
        display:         'inline-flex',
        alignItems:      'center',
        gap:             dot ? '4px' : undefined,
        fontFamily:      'var(--font-jetbrains)',
        fontSize,
        fontWeight:      700,
        padding,
        borderRadius:    '4px',
        letterSpacing:   '0.03em',
        color:           `var(--tag-${variant}-text)`,
        backgroundColor: `var(--tag-${variant}-bg)`,
        border:          `1px solid var(--tag-${variant}-border)`,
        whiteSpace:      'nowrap',
        flexShrink:      0,
        lineHeight:      1.4,
      }}
    >
      {dot && (
        <span
          style={{
            width:           '5px',
            height:          '5px',
            borderRadius:    '50%',
            backgroundColor: `var(--tag-${variant}-text)`,
            flexShrink:      0,
          }}
        />
      )}
      {children}
    </span>
  );
}

// Convenience maps for common domain objects
// ── Feed transaction type → tag variant ─────────────────────────────────────
// Token group (teal bg): Receive, Sent, Swap Buy, Approve
// NFT group   (purple bg): NFT Buy, NFT Sell, NFT Sent, NFT Offer, NFT Mint, Sweep
// Contract group (gray bg): Contract Interaction
export const TX_TYPE_VARIANT: Record<string, TagVariant> = {
  // Token group
  'Receive':              'token-in',
  'Sent':                 'token-out',
  'Swap Buy':             'swap',
  'Approve':              'approve',
  // NFT group
  'NFT Buy':              'nft-buy',
  'NFT Sell':             'nft-sell',
  'NFT Sent':             'nft-sent',
  'NFT Offer':            'nft-offer',
  'NFT Mint':             'nft-mint',
  'Sweep':                'sweep',
  // Contract group
  'Contract Interaction': 'contract',
  // Legacy aliases kept for live Alchemy data (toFeedItem uses 'Send')
  'Send':                 'token-out',
};

export const TASK_STATUS_VARIANT: Record<string, TagVariant> = {
  Pending:    'warning',
  Processing: 'info',
  Scheduled:  'neutral',
  Running:    'accent',
  Paused:     'warning',
  Finished:   'success',
  Failed:     'danger',
};

export const NFT_ACTIVITY_VARIANT: Record<string, TagVariant> = {
  Sale:     'success',
  Listing:  'info',
  Bid:      'warning',
  Transfer: 'purple',
};

export const WALLET_TOKEN_VARIANT: Record<string, TagVariant> = {
  ETH:   'neutral',
  BNB:   'warning',
  MATIC: 'purple',
  SOL:   'info',
};
