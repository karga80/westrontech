import WalletDetailClient from './WalletDetailClient';

export function generateStaticParams() {
  return [{ id: '0' }, { id: '1' }, { id: '2' }];
}

export default function WalletDetailPage({ params }: { params: { id: string } }) {
  return <WalletDetailClient id={params.id} />;
}
