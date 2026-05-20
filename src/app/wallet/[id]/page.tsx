import WalletDetailClient from './WalletDetailClient';

// Next.js static export pre-renders only the ids returned here. Default
// wallets ('0'|'1'|'2') plus a sentinel so user-added wallets (id = Date.now())
// fall back to client-side routing without a 404.
export function generateStaticParams() {
  return [{ id: '0' }, { id: '1' }, { id: '2' }, { id: 'detail' }];
}

// Client-side fallback: any id not pre-generated is still rendered through
// React hydration of the sentinel page, which reads the real id from the URL.
// Note: dynamicParams must NOT be exported — "output: export" (static site for
// Tauri) forbids it. The 'detail' sentinel above is the fallback mechanism.

export default async function WalletDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  // Next 15/16 made `params` a Promise; accept both shapes for forward compat.
  const resolved = await Promise.resolve(params);
  return <WalletDetailClient id={resolved.id} />;
}
