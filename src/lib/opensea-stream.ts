import { OpenSeaStreamClient, Network, EventType, LogLevel } from '@opensea/stream-js';

if (!process.env.OPENSEA_API_KEY) {
  throw new Error('OPENSEA_API_KEY is not set');
}

export const streamClient = new OpenSeaStreamClient({
  token: process.env.OPENSEA_API_KEY,
  network: Network.MAINNET,
  logLevel: LogLevel.INFO,
  onError: () => { /* stream errors are best-effort */ },
});

streamClient.connect();

// Subscriptions — pass a collection slug (or '*' for all collections)
export const onItemListed      = (slug: string, cb: Parameters<typeof streamClient.onItemListed>[1])      => streamClient.onItemListed(slug, cb);
export const onItemSold        = (slug: string, cb: Parameters<typeof streamClient.onItemSold>[1])        => streamClient.onItemSold(slug, cb);
export const onItemTransferred = (slug: string, cb: Parameters<typeof streamClient.onItemTransferred>[1]) => streamClient.onItemTransferred(slug, cb);
export const onItemMetadataUpdated = (slug: string, cb: Parameters<typeof streamClient.onItemMetadataUpdated>[1]) => streamClient.onItemMetadataUpdated(slug, cb);
export const onItemCancelled   = (slug: string, cb: Parameters<typeof streamClient.onItemCancelled>[1])   => streamClient.onItemCancelled(slug, cb);
export const onItemReceivedBid = (slug: string, cb: Parameters<typeof streamClient.onItemReceivedBid>[1]) => streamClient.onItemReceivedBid(slug, cb);
export const onCollectionOffer = (slug: string, cb: Parameters<typeof streamClient.onCollectionOffer>[1]) => streamClient.onCollectionOffer(slug, cb);
export const onTraitOffer      = (slug: string, cb: Parameters<typeof streamClient.onTraitOffer>[1])      => streamClient.onTraitOffer(slug, cb);
export const onOrderInvalidate = (slug: string, cb: Parameters<typeof streamClient.onOrderInvalidate>[1]) => streamClient.onOrderInvalidate(slug, cb);
export const onOrderRevalidate = (slug: string, cb: Parameters<typeof streamClient.onOrderRevalidate>[1]) => streamClient.onOrderRevalidate(slug, cb);

export { EventType };
