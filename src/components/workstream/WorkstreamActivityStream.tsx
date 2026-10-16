import React, { useEffect, useRef, useState } from 'react';
import { formatMessageTime } from '../../utils/messageTime';
import { 
  FileText, Download, ShieldCheck, Activity, CheckCircle2, 
  Clock, AlertTriangle, MessageSquare, ArrowDown, Sparkles,
  FileSignature, Receipt, Lock, Loader2, RotateCcw
} from 'lucide-react';
import { WorkstreamMessage, WorkstreamOffer } from './types';
import { UserAccount } from '../../types';

interface WorkstreamActivityStreamProps {
  messages: WorkstreamMessage[];
  currentUserId?: string;
  usersList?: UserAccount[];
  partnerUser?: UserAccount;
  onDownloadFile?: (fileInfo: { name: string; url: string }) => void;
  /** Real offer records for this workstream (the source of truth for every offer card). */
  offers?: WorkstreamOffer[];
  buyerId?: string;
  sellerId?: string;
  onOfferAction?: (offerId: string, action: 'accept' | 'decline' | 'cancel') => Promise<{ ok: boolean; error?: string }>;
  onRetryMessage?: (msg: WorkstreamMessage) => void;
}

export const WorkstreamActivityStream: React.FC<WorkstreamActivityStreamProps> = ({
  messages,
  currentUserId,
  usersList = [],
  partnerUser,
  onDownloadFile,
  offers = [],
  buyerId,
  sellerId,
  onOfferAction,
  onRetryMessage
}) => {
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<{ id: string; message: string } | null>(null);

  const KIND_CFG = {
    proposal: { label: 'Proposal', icon: <FileSignature className="w-4 h-4" />, accept: 'Accept & Fund Escrow' },
    invoice: { label: 'Invoice', icon: <Receipt className="w-4 h-4" />, accept: 'Pay Invoice' },
    deposit: { label: 'Deposit Request', icon: <Lock className="w-4 h-4" />, accept: 'Fund Deposit' }
  } as const;
  const STATUS_CFG: Record<string, { label: string; cls: string }> = {
    pending: { label: 'Awaiting buyer', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    accepted: { label: 'Accepted', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    paid: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    declined: { label: 'Declined', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-500 border-slate-200' }
  };

  const runOfferAction = async (offer: WorkstreamOffer, action: 'accept' | 'decline' | 'cancel') => {
    if (!onOfferAction || busyOfferId) return;
    const sym = offer.currencySymbol || '$';
    if (action === 'accept') {
      const total = offer.clientTotal ?? offer.amount;
      const ok = window.confirm(
        `${KIND_CFG[offer.kind].accept}: ${offer.title}\n\n${sym}${offer.amount.toLocaleString()} goes into escrow. ` +
        `Your wallet will be charged ${sym}${Number(total).toLocaleString()} in total including fees.`
      );
      if (!ok) return;
    }
    setBusyOfferId(offer.id);
    setOfferError(null);
    const result = await onOfferAction(offer.id, action);
    setBusyOfferId(null);
    if (!result.ok) setOfferError({ id: offer.id, message: result.error || 'Action failed.' });
  };

  const renderOfferCard = (msg: WorkstreamMessage, isMe: boolean) => {
    const offer = offers.find(o => o.id === msg.metadata?.offerId);
    if (!offer) {
      return (
        <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
          <div className="max-w-md bg-white border border-slate-200 rounded-3xl px-4 py-3 text-xs text-slate-400 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading {msg.text}...
          </div>
        </div>
      );
    }
    const cfg = KIND_CFG[offer.kind];
    const st = STATUS_CFG[offer.status] || STATUS_CFG.pending;
    const sym = offer.currencySymbol || '$';
    const iAmBuyer = !!currentUserId && currentUserId === buyerId;
    const iAmSeller = !!currentUserId && currentUserId === sellerId;
    const busy = busyOfferId === offer.id;
    return (
      <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
        <div className="w-full max-w-md bg-white border border-emerald-200 rounded-3xl shadow-xs overflow-hidden">
          <div className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-100 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-800">
              <span className="text-emerald-600">{cfg.icon}</span>{cfg.label} {offer.number}
            </span>
            <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${st.cls}`}>{offer.status === 'pending' && iAmSeller ? 'Awaiting buyer' : st.label}</span>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-sm font-bold text-fiverr-dark">{offer.title}</p>
            <p className="text-2xl font-black text-fiverr-dark font-mono">{sym}{offer.amount.toLocaleString()}</p>
            {offer.deliveryDays && <p className="text-[11px] text-slate-500">Delivery in <strong>{offer.deliveryDays}</strong> day{offer.deliveryDays === 1 ? '' : 's'}</p>}
            {offer.note && <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{offer.note}</p>}

            {offer.status === 'pending' && iAmBuyer && (
              <div className="flex items-center gap-2 pt-2">
                <button type="button" disabled={busy} onClick={() => runOfferAction(offer, 'accept')}
                  className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {cfg.accept}
                </button>
                <button type="button" disabled={busy} onClick={() => runOfferAction(offer, 'decline')}
                  className="px-4 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 font-bold rounded-xl text-xs transition cursor-pointer">
                  Decline
                </button>
              </div>
            )}
            {offer.status === 'pending' && iAmSeller && (
              <button type="button" disabled={busy} onClick={() => runOfferAction(offer, 'cancel')}
                className="mt-1 px-4 py-2 border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 font-bold rounded-xl text-xs transition cursor-pointer">
                Cancel {cfg.label.toLowerCase()}
              </button>
            )}
            {offerError?.id === offer.id && <p className="text-[11px] font-semibold text-rose-600 pt-1">{offerError.message}</p>}
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
      {messages.map((msg) => {
        if (msg.type === 'system') {
          return (
            <div key={msg.id} className="flex justify-center">
              <div className="text-[10px] text-slate-400 font-medium px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
                {msg.text}
              </div>
            </div>
          );
        }

        const isMe = msg.senderId === currentUserId;
        if (msg.metadata?.action === 'offer_created' && msg.metadata?.offerId) {
          return renderOfferCard(msg, isMe);
        }
        
        const senderObj = usersList.find(u => u.id === msg.senderId) || (isMe ? undefined : partnerUser);
        const avatarUrl = msg.senderAvatar || senderObj?.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop';
        const senderName = msg.senderName || senderObj?.name || (isMe ? 'You' : 'Partner');

        const isFailed = msg.status === 'failed';
        const isSending = msg.status === 'sending';

        return (
          <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
            <img src={avatarUrl} alt={senderName} className="w-8 h-8 rounded-full object-cover shrink-0" />
            <div className={`flex flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}>
              <span className="text-[10px] font-bold text-slate-400 px-1">{senderName}</span>
              <div className={`px-4 py-3 rounded-2xl text-xs max-w-sm ${
                isFailed
                  ? 'bg-rose-50 border border-rose-300 text-rose-900 rounded-tr-none'
                  : isMe
                    ? 'bg-slate-900 text-white rounded-tr-none'
                    : 'bg-white border border-slate-200 rounded-tl-none shadow-xs'
              }`}>
                {msg.type === 'file' && msg.fileInfo ? (
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${isFailed ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-600'}`}><FileText className="w-4 h-4" /></div>
                    <div className="flex-1">
                      <div className="font-bold">{msg.fileInfo.name}</div>
                      <div className="text-[10px] opacity-70">{msg.fileInfo.size}</div>
                    </div>
                    {!isFailed && (
                      <button onClick={() => onDownloadFile?.(msg.fileInfo!)} className="p-2 hover:bg-white/10 rounded-lg cursor-pointer transition">
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                )}
              </div>

              {/* Status and retry bar */}
              <div className="flex items-center gap-1.5 px-1 text-[9px]">
                {isFailed && (
                  <div className="flex items-center gap-1.5 text-rose-600 font-semibold">
                    <AlertTriangle className="w-3 h-3 text-rose-500" />
                    <span>Failed to send</span>
                    {isMe && onRetryMessage && (
                      <button
                        type="button"
                        onClick={() => onRetryMessage(msg)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-100 hover:bg-rose-200 text-rose-700 rounded-md font-bold transition cursor-pointer"
                        title="Retry sending this message"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>Retry</span>
                      </button>
                    )}
                  </div>
                )}
                {isSending && (
                  <div className="flex items-center gap-1 text-slate-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Sending...</span>
                  </div>
                )}
                {!isFailed && !isSending && (
                  <span className="text-slate-400">{formatMessageTime(msg.timestamp)}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={scrollEndRef} />
    </div>
  );
};
