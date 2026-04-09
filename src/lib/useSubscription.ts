'use client';

import { useState, useEffect } from 'react';
import { loadSubscription, isSubscriptionActive, type PlanType } from './subscriptionStore';

export interface SubscriptionInfo {
  plan: PlanType;
  isPro: boolean;
  loaded: boolean;
}

// Returns the current subscription state, reactive to localStorage changes.
export function useSubscription(): SubscriptionInfo {
  const [info, setInfo] = useState<SubscriptionInfo>({ plan: 'free', isPro: false, loaded: false });

  useEffect(() => {
    const sub = loadSubscription();
    setInfo({ plan: sub.plan, isPro: isSubscriptionActive(sub), loaded: true });
  }, []);

  return info;
}
