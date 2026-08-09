import WalletDetailClient from './WalletDetailClient';

// Static export ('output: export') can only ship prerendered paths, and wallet
// ids are runtime values (Date.now()), so we prerender ONE detail page and route
// every wallet through it as /wallet/detail?id=<id>. WalletDetailClient reads the
// real id from the query string on the client. dynamicParams MUST be false here —
// 'true' is incompatible with static export.
export function generateStaticParams() {
  return [{ id: 'detail' }];
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
