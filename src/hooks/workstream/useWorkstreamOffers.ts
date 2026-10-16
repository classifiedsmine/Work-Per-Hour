import { useState, useCallback, useEffect, useRef } from 'react';
import { getAuthToken } from '../../utils/authToken';
import { WorkstreamOffer, WorkstreamOfferKind } from '../../components/workstream/types';

export interface CreateOfferInput {
  kind: WorkstreamOfferKind;
  title: string;
  amount: number;
  deliveryDays?: number;
  note?: string;
}

export interface OfferActionResult {
  ok: boolean;
  error?: string;
  order?: any;
  newOrder?: any;
}

/**
 * Loads the real proposals / invoices / deposit requests of one workstream and exposes the
 * seller / buyer actions. The server is the only source of truth for status and money movement.
 * `refreshKey` should change whenever a new workstream message arrives so statuses stay live.
 */
export function useWorkstreamOffers(orderId: string | undefined, refreshKey?: string) {
  const [offers, setOffers] = useState<WorkstreamOffer[]>([]);
  const [currencySymbol, setCurrencySymbol] = useState('$');
  const [escrowFunded, setEscrowFunded] = useState(false);
  const activeOrderRef = useRef<string | undefined>(orderId);
  activeOrderRef.current = orderId;

  const headers = () => {
    const token = getAuthToken();
    return { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  };

  const refresh = useCallback(async () => {
    if (!orderId || !getAuthToken()) return;
    try {
      const res = await fetch(`/api/orders/${orderId}/offers`, { headers: headers() });
      if (!res.ok || activeOrderRef.current !== orderId) return;
      const data = await res.json();
      setOffers(Array.isArray(data.offers) ? data.offers : []);
      if (data.currencySymbol) setCurrencySymbol(data.currencySymbol);
      setEscrowFunded(!!data.escrowFunded);
    } catch (err) {
      console.error('Failed to load workstream offers:', err);
    }
  }, [orderId]);

  useEffect(() => {
    setOffers([]);
    setEscrowFunded(false);
    refresh();
  }, [orderId, refresh]);

  useEffect(() => {
    if (refreshKey) refresh();
  }, [refreshKey, refresh]);

  const request = async (url: string, body?: any): Promise<OfferActionResult & { offer?: WorkstreamOffer }> => {
    try {
      const res = await fetch(url, { method: 'POST', headers: headers(), body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || 'Something went wrong.' };
      await refresh();
      return { ok: true, ...data };
    } catch {
      return { ok: false, error: 'Network error. Please try again.' };
    }
  };

  const createOffer = (input: CreateOfferInput) =>
    request(`/api/orders/${orderId}/offers`, input);
  const respond = (offerId: string, action: 'accept' | 'decline' | 'cancel') =>
    request(`/api/offers/${offerId}/${action}`);

  return { offers, currencySymbol, escrowFunded, createOffer, respond, refresh };
}
