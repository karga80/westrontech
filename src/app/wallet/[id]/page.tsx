import WalletDetailClient from './WalletDetailClient';

// Static export ('output: export') can only ship prerendered paths, and wallet
// ids are runtime values (Date.now()), so we prerender ONE detail page and route
// every wallet through it as /wallet/detail?id=<id>. WalletDetailClient reads the
// real id from the query string on the client. dynamicParams MUST be false here —
// 'true' is incompatible with static export.
export function generateStaticParams() {
  return [{ id: 'detail' }];
}

export const dynamicParams = false;

export default async function WalletDetailPage({
  params,
}: {
  params: Promise<{ id: string }> | { id: string };
}) {
  // Next 15/16 made `params` a Promise; accept both shapes for forward compat.
  const resolved = await Promise.resolve(params);
  return <WalletDetailClient id={resolved.id} />;
}
