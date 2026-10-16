import { useState, useEffect } from 'react';
import { Review, Order, Message } from './types';
import { getAuthToken } from './utils/authToken';

interface UseEscrowReviewsProps {
  selectedOrder: Order | null;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setSelectedOrder: React.Dispatch<React.SetStateAction<Order | null>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export function useEscrowReviews({
  selectedOrder,
  setOrders,
  setSelectedOrder,
  setMessages
}: UseEscrowReviewsProps) {
  const [reviews, setReviews] = useState<Review[]>([]);

  useEffect(() => {
    fetch('/api/reviews')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setReviews(data);
      })
      .catch(err => console.error('Failed to fetch reviews:', err));
  }, []);

  const handleReleaseEscrow = async (review: { rating: number; comment: string }) => {
    if (!selectedOrder) return;

    // 1. Update order status to completed
    setOrders(prev => prev.map(o => o.id === selectedOrder.id ? { ...o, status: 'completed' } : o));
    setSelectedOrder(prev => prev ? { ...prev, status: 'completed' } : null);

    // 2. Fire system chat message
    const sysMsg: Message = {
      id: `msg_${Date.now()}`,
      orderId: selectedOrder.id,
      senderId: 'system',
      senderName: 'WorkSphere Escrow Vault',
      text: `🎉 Escrow funds ($${selectedOrder.amount.toLocaleString()}) released to seller! Workstream completed with ${review.rating}-star rating: "${review.comment}"`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'system'
    };
    setMessages(prev => [...prev, sysMsg]);

    // 3. Create real Review object linked to the freelancer via POST /api/reviews
    try {
      const token = getAuthToken();
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          orderId: selectedOrder.id,
          targetUserId: selectedOrder.sellerId,
          rating: review.rating,
          comment: review.comment,
          orderTitle: selectedOrder.title
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.review) {
          setReviews(prev => [data.review, ...prev]);
        }
      }
    } catch (err) {
      console.error('Failed to persist escrow review:', err);
    }
  };

  return {
    reviews,
    setReviews,
    handleReleaseEscrow
  };
}
