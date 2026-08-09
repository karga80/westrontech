'use client';

// Small NFT thumbnail — falls back to the first letter of the name when no
// image URL is present or the image fails to load, so a broken/missing
// image never leaves a blank box with no explanation of what was supposed
// to be there. Shared by the wallet-detail NFT gallery/modals and the
// Distribute modal's Send NFT tab so there is exactly one place that
// decides how an NFT thumbnail degrades.

import type { OwnedNft } from '@/lib/tauri';

export default function NftThumb({ nft, size = 36 }: { nft: OwnedNft; size?: number }) {
  const thumb = nft.image?.thumbnail_url || nft.image?.original_url || nft.image?.cached_url;
  return (
    <div
      style={{
        width: `${size}px`, height: `${size}px`, borderRadius: '4px', overflow: 'hidden',
        backgroundColor: '#14161f', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {thumb
        ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        : <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#555' }}>{(nft.name ?? '?')[0]}</span>}
    </div>
  );
}
