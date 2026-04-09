// OpenSea Stream API payload types

export interface StreamTrait {
  trait_type: string;
  value: string;
}

export interface StreamItemMetadata {
  animation_url: string | null;
  image_url: string | null;
  metadata_url: string | null;
  name: string | null;
  background_color?: string | null;
  description?: string | null;
  traits?: StreamTrait[];
}

export interface StreamItem {
  chain: { name: string };
  metadata: StreamItemMetadata;
  nft_id: string;
  permalink: string;
}

export interface StreamPaymentToken {
  address: string;
  decimals: number;
  eth_price: string;
  name: string;
  symbol: string;
  usd_price: string;
}

export interface SeaportConsiderationItem {
  endAmount: string;
  identifierOrCriteria: string;
  itemType: number;
  recipient: string;
  startAmount: string;
  token: string;
}

export interface SeaportOfferItem {
  endAmount: string;
  identifierOrCriteria: string;
  itemType: number;
  startAmount: string;
  token: string;
}

export interface SeaportParameters {
  conduitKey: string;
  consideration: SeaportConsiderationItem[];
  counter: string;
  endTime: string;
  offer: SeaportOfferItem[];
  offerer: string;
  orderType: number;
  salt: string;
  startTime: string;
  totalOriginalConsiderationItems: number;
  zone: string;
  zoneHash: string;
}

export interface ProtocolData {
  parameters: SeaportParameters;
  signature: string;
}

export interface ItemListedPayload {
  base_price: string;
  chain: string;
  collection: { slug: string };
  event_timestamp: string;
  expiration_date: string;
  is_private: boolean;
  item: StreamItem;
  listing_date: string;
  listing_type: string | null;
  maker: { address: string };
  order_hash: string;
  payment_token: StreamPaymentToken;
  protocol_address: string;
  protocol_data: ProtocolData;
  quantity: number;
  taker: { address: string } | null;
}

export interface ItemListedEvent {
  event_type: 'item_listed';
  sent_at: string;
  payload: ItemListedPayload;
}

export interface ItemSoldPayload {
  chain: string;
  closing_date: string;
  collection: { slug: string };
  event_timestamp: string;
  is_private: boolean;
  item: StreamItem;
  listing_type: string | null;
  maker: { address: string };
  order_hash: string;
  payment_token: StreamPaymentToken;
  protocol_address: string;
  protocol_data: ProtocolData;
  quantity: number;
  sale_price: string;
  taker: { address: string } | null;
  transaction: {
    hash: string;
    timestamp: string;
  };
}

export interface ItemSoldEvent {
  event_type: 'item_sold';
  sent_at: string;
  payload: ItemSoldPayload;
}

export interface ItemTransferredPayload {
  chain: string;
  collection: { slug: string };
  event_timestamp: string;
  from_account: { address: string };
  item: StreamItem;
  quantity: number;
  to_account: { address: string };
  transaction: {
    hash: string;
    timestamp: string;
  };
}

export interface ItemTransferredEvent {
  event_type: 'item_transferred';
  sent_at: string;
  payload: ItemTransferredPayload;
}

export interface ItemMetadataUpdatedPayload {
  collection: { slug: string };
  item: StreamItem;
}

export interface ItemMetadataUpdatedEvent {
  event_type: 'item_metadata_updated';
  sent_at: string;
  payload: ItemMetadataUpdatedPayload;
}

export interface StreamTraitCriteria {
  trait_type: string;
  trait_name: string;
}

export interface ItemCancelledPayload {
  base_price: string;
  chain: string;
  collection: { slug: string };
  event_timestamp: string;
  expiration_date: string;
  is_private: boolean;
  item: StreamItem | null;
  listing_date: string;
  listing_type: string | null;
  maker: { address: string };
  order_hash: string;
  payment_token: StreamPaymentToken;
  protocol_address: string;
  quantity: number;
  taker: { address: string } | null;
  transaction: { hash: string; timestamp: string } | null;
  // Present when cancelling a collection offer or trait offer
  asset_contract_criteria?: { address: string };
  trait_criteria?: StreamTraitCriteria[];
}

export interface ItemCancelledEvent {
  event_type: 'item_cancelled';
  sent_at: string;
  payload: ItemCancelledPayload;
}

export interface ItemReceivedBidPayload {
  base_price: string;
  chain: string;
  collection: { slug: string };
  created_date: string;
  event_timestamp: string;
  expiration_date: string;
  item: StreamItem;
  maker: { address: string };
  order_hash: string;
  payment_token: StreamPaymentToken;
  protocol_address: string;
  protocol_data: ProtocolData;
  quantity: number;
  taker: { address: string } | null;
}

export interface ItemReceivedBidEvent {
  event_type: 'item_received_bid';
  sent_at: string;
  payload: ItemReceivedBidPayload;
}

export interface CollectionOfferPayload {
  asset_contract_criteria: { address: string };
  base_price: string;
  chain: string;
  collection: { slug: string };
  collection_criteria: { slug: string };
  created_date: string;
  event_timestamp: string;
  expiration_date: string;
  item: Record<string, never>; // always empty object for collection offers
  maker: { address: string };
  order_hash: string;
  payment_token: StreamPaymentToken;
  protocol_address: string;
  protocol_data: ProtocolData;
  quantity: number;
  taker: { address: string } | null;
}

export interface CollectionOfferEvent {
  event_type: 'collection_offer';
  sent_at: string;
  payload: CollectionOfferPayload;
}

export interface NumericTraitCriteria {
  trait_type: string;
  min_value: number;
  max_value: number;
}

export interface TraitOfferPayload {
  asset_contract_criteria: { address: string };
  base_price: string;
  chain: string;
  collection: { slug: string };
  collection_criteria: { slug: string };
  created_date: string;
  event_timestamp: string;
  expiration_date: string;
  item: Record<string, never>;
  maker: { address: string };
  numeric_trait_criteria_list: NumericTraitCriteria[];
  order_hash: string;
  payment_token: StreamPaymentToken;
  protocol_address: string;
  protocol_data: ProtocolData;
  quantity: number;
  taker: { address: string } | null;
  trait_criteria: StreamTraitCriteria | null; // single trait (backward compat), null for multi-trait offers
  trait_criteria_list: StreamTraitCriteria[]; // multi-trait list
}

export interface TraitOfferEvent {
  event_type: 'trait_offer';
  sent_at: string;
  payload: TraitOfferPayload;
}

export interface OrderInvalidatePayload {
  chain: string;
  collection: { slug: string };
  event_timestamp: string;
  item: StreamItem | null;
  order_hash: string;
  protocol_address: string;
  // Present for collection/trait offer invalidations
  asset_contract_criteria?: { address: string };
  trait_criteria?: StreamTraitCriteria[];
}

export interface OrderInvalidateEvent {
  event_type: 'order_invalidate';
  sent_at: string;
  payload: OrderInvalidatePayload;
}

export interface OrderRevalidatePayload {
  chain: string;
  collection: { slug: string };
  event_timestamp: string;
  item: Record<string, never>;
  order_hash: string;
  protocol_address: string;
}

export interface OrderRevalidateEvent {
  event_type: 'order_revalidate';
  sent_at: string;
  payload: OrderRevalidatePayload;
}

export type StreamEvent =
  | ItemListedEvent
  | ItemSoldEvent
  | ItemTransferredEvent
  | ItemMetadataUpdatedEvent
  | ItemCancelledEvent
  | ItemReceivedBidEvent
  | CollectionOfferEvent
  | TraitOfferEvent
  | OrderInvalidateEvent
  | OrderRevalidateEvent;
