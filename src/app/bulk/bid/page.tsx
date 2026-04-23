'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BidRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/bulk/bulk-bid'); }, []);
  return null;
}
