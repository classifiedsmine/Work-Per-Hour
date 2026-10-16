import React, { useState, useEffect, useRef } from 'react';
import { 
  ChevronLeft, ShieldCheck, Clock, CheckCircle2, AlertCircle, 
  RotateCcw, Activity, FolderOpen, Send, Sparkles, MessageSquare, Video, Star 
} from 'lucide-react';
import { WorkstreamItem, WorkstreamMessage, SharedFileItem, WorkstreamSubTab } from './types';
import { UserAccount, Order } from '../../types';
import { WorkstreamActivityStream } from './WorkstreamActivityStream';
import { WorkstreamMessageInput } from './WorkstreamMessageInput';
import { WorkstreamFilesTab } from './WorkstreamFilesTab';
import { WorkstreamSummaryCard } from './WorkstreamSummaryCard';
import { WorkstreamActionsPanel } from './WorkstreamActionsPanel';
import { WorkstreamReleaseModal } from './WorkstreamReleaseModal';
import { WorkstreamDeliverModal } from './WorkstreamDeliverModal';
import { WorkstreamRevisionModal } from './WorkstreamRevisionModal';
import { WorkstreamReviewModal } from './WorkstreamReviewModal';
import { WorkstreamVideoCallModal } from './WorkstreamVideoCallModal';
import { getAuthToken } from '../../utils/authToken';
import { classifyFileUrl, openWebLink } from '../../utils/safeFileLink';
import { useWorkstreamOffers } from '../../hooks/workstream/useWorkstreamOffers';

interface WorkstreamWorkspaceProps {
  order: WorkstreamItem;
  messages: WorkstreamMessage[];
  files: SharedFileItem[];
  currentUser?: UserAccount | null;
  usersList?: UserAccount[];
  partner?: UserAccount;
  onBack: () => void;
  onSendMessage: (text: string) => void;
  onRetryMessage?: (msg: WorkstreamMessage) => void;
  onAttachFile: (file: { name: string; size: string; url: string }) => void;
  /** Creates a system event record. */
  sendEvent: (orderId: string, text: string, type: 'system', metadata: Record<string, any>, onError: (msg: string) => void) => void;
  /** Called after a buyer accepts / pays an offer so the parent can refresh its order list. */
  onOrderChanged?: (order: any, newOrder?: any) => void;
  onReleaseEscrow: () => void | Promise<boolean>;
  onDeliverWork: (delivery: { notes: string; files: Array<{ name: string; size: string; url: string }> }) => void;
  onRequestRevision: (reason: string) => void;
  onViewPartnerProfile?: (user: UserAccount) => void;
  onLogRequirement?: (requirementText: string) => void;
  onMissedCall?: () => void;
  onDisputeAssistance?: () => void;
  isReviewModalOpen: boolean;
  setIsReviewModalOpen: (open: boolean) => void;
  handleSubmitReview: (review: { rating: number; comment: string; gigId?: string; projectId?: string }) => Promise<boolean>;
  reviewError?: string | null;
  isSubmittingReview?: boolean;
}

export const WorkstreamWorkspace: React.FC<WorkstreamWorkspaceProps> = ({
  order,
  messages,
  files,
  currentUser,
  usersList = [],
  partner,
  onBack,
  onSendMessage,
  onRetryMessage,
  onAttachFile,
  sendEvent,
  onOrderChanged,
  onReleaseEscrow,
  onDeliverWork,
  onRequestRevision,
  onViewPartnerProfile,
  onDisputeAssistance,
  onLogRequirement,
  onMissedCall,
  isReviewModalOpen,
  setIsReviewModalOpen,
  handleSubmitReview,
  reviewError,
  isSubmittingReview
}) => {
  const [activeSubTab, setActiveSubTab] = useState<WorkstreamSubTab>('activity');
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const [isDeliverModalOpen, setIsDeliverModalOpen] = useState(false);
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);
  const [isVideoCallModalOpen, setIsVideoCallModalOpen] = useState(false);

  // Real proposals / invoices / deposit requests for this workstream (server is the source of truth)
  const lastMessageId = messages.length ? messages[messages.length - 1].id : '';
  const { offers, currencySymbol, escrowFunded, createOffer, respond } = useWorkstreamOffers(order.id, lastMessageId);
  const isSeller = !!currentUser && currentUser.id === order.sellerId;
  const canSendProposal = isSeller && !escrowFunded && order.status === 'in_progress';
  const canRaiseInvoice = isSeller && escrowFunded && order.status !== 'cancelled';
  const proposalHint = !isSeller ? 'Only the seller can send this' : 'Escrow is already funded. Use Raise Invoice for extra work.';
  const invoiceHint = !isSeller ? 'Only the seller can send this' : 'Invoices are for follow-on work once escrow is funded.';

  // When an offer is accepted/paid the order changes (escrow funded, or a new invoice order appears).
  // The buyer's click already refreshes, but the seller only sees the system message, so refresh on it too.
  const lastMessage = messages.length ? messages[messages.length - 1] : undefined;
  const handledOfferMsgRef = useRef<string>(lastMessageId);
  useEffect(() => {
    if (!lastMessage || lastMessage.id === handledOfferMsgRef.current) return;
    handledOfferMsgRef.current = lastMessage.id;
    if (lastMessage.metadata?.action === 'offer_accepted') onOrderChanged?.(null);
  }, [lastMessage?.id]);

  const handleOfferAction = async (offerId: string, action: 'accept' | 'decline' | 'cancel') => {
    const result = await respond(offerId, action);
    if (result.ok && (result.order || result.newOrder)) onOrderChanged?.(result.order, result.newOrder);
    return result;
  };

  const [errorInfo, setErrorInfo] = useState<{msg: string, retryAction: () => void} | null>(null);

  // Buyer review window countdown calculation
  const latestDelivery = Array.isArray(order.deliveryHistory) && order.deliveryHistory.length > 0
    ? order.deliveryHistory[order.deliveryHistory.length - 1]
    : null;

  const deliveredAt = latestDelivery?.deliveredAt;
  const reviewDays = (order as any).reviewWindowDays || 3;
  const expiresAtMs = (order as any).reviewWindowExpiresAt
    ? new Date((order as any).reviewWindowExpiresAt).getTime()
    : deliveredAt
      ? new Date(deliveredAt).getTime() + reviewDays * 24 * 60 * 60 * 1000
      : null;

  const [remainingTimeStr, setRemainingTimeStr] = useState<string>('');

  useEffect(() => {
    if (!expiresAtMs || order.status !== 'delivered') {
      setRemainingTimeStr('');
      return;
    }

    const updateCountdown = () => {
      const diff = expiresAtMs - Date.now();
      if (diff <= 0) {
        setRemainingTimeStr('Window closed (Auto-accepting...)');
        return;
      }
      const totalSeconds = Math.floor(diff / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (days > 0) {
        setRemainingTimeStr(`${days}d ${hours}h ${minutes}m left`);
      } else if (hours > 0) {
        setRemainingTimeStr(`${hours}h ${minutes}m ${seconds}s left`);
      } else {
        setRemainingTimeStr(`${minutes}m ${seconds}s left`);
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [expiresAtMs, order.status]);

  const handleLogRequirement = (reqText: string) => {
    if (onLogRequirement) onLogRequirement(reqText);
    const text = `📋 Project Requirement Logged: "${reqText}"`;
    const metadata = { action: 'requirement_logged', requirementText: reqText };
    
    sendEvent(order.id, text, 'system', metadata, (msg: string) => {
      setErrorInfo({ msg, retryAction: () => handleLogRequirement(reqText) });
    });
  };

  const handleMissedCall = () => {
    if (onMissedCall) onMissedCall();
    const text = `📞 Missed Video Meeting with ${partner?.name || 'collaborator'}`;
    const metadata = { action: 'missed_call' };
    
    sendEvent(order.id, text, 'system', metadata, (msg: string) => {
      setErrorInfo({ msg, retryAction: handleMissedCall });
    });
  };

  const handleDownloadFile = async (f: { name: string; url: string }) => {
    if (!f.url) {
      alert(`"${f.name || 'This file'}" is unavailable: it has no valid download link.`);
      return;
    }
    // User-provided links are never trusted: only uploaded files get the auth token, only http(s) opens a tab,
    // everything else (javascript:, data:, free text...) stays plain text and is never navigated to or fetched.
    const link0 = classifyFileUrl(f.url);
    if (link0.kind === 'web') { openWebLink(link0.url); return; }
    if (link0.kind === 'text') { alert(`${f.name || 'Deliverable'}:\n\n${link0.url}`); return; }
    // Files are access-controlled, so fetch with the session token and save the blob.
    try {
      const token = getAuthToken();
      const downloadUrl = f.url.includes('?') ? `${f.url}&download=1` : `${f.url}?download=1`;
      const res = await fetch(downloadUrl, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
      if (!res.ok) {
        alert(res.status === 403
          ? 'You do not have access to this file.'
          : `"${f.name || 'This file'}" could not be downloaded (it may no longer be available).`);
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = f.name || 'download';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    } catch (err) {
      console.error('File download failed:', err);
      alert('Network error downloading the file. Please try again.');
    }
  };

  const getStatusBadge = () => {
    switch (order.status) {
      case 'completed':
        return (
          <span className="px-3 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold uppercase rounded-full flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Completed</span>
          </span>
        );
      case 'delivered':
        return (
          <span className="px-3 py-1 bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold uppercase rounded-full flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span>Delivered · Awaiting Review</span>
          </span>
        );
      case 'revision':
        return (
          <span className="px-3 py-1 bg-purple-50 text-purple-800 border border-purple-200 text-[10px] font-bold uppercase rounded-full flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5 text-purple-600" />
            <span>Revision in Progress</span>
          </span>
        );
      default:
        return (
          <span className="px-3 py-1 bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-bold uppercase rounded-full flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>Escrow Protected (${order.amount})</span>
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {errorInfo && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-2xl flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span className="font-medium">{errorInfo.msg}</span>
          </div>
          <button 
            onClick={() => { errorInfo.retryAction(); setErrorInfo(null); }}
            className="px-3 py-1 bg-rose-200 hover:bg-rose-300 text-rose-900 rounded-lg font-bold transition cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* WORKSTREAM HEADER */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 sm:p-6 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-xl text-slate-500 transition-colors cursor-pointer"
              title="Back to All Workstreams"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-bold text-fiverr-dark tracking-tight">
                  {order.title}
                </h1>
                {getStatusBadge()}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Order #{order.id} • Partner: <strong className="text-fiverr-dark font-medium">{partner?.name || 'Collaborator'}</strong>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {currentUser?.id === order.buyerId && order.status !== 'completed' && (
              <button
                onClick={() => setIsReleaseModalOpen(true)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Release Escrow</span>
              </button>
            )}

            {currentUser?.id === order.buyerId && order.status === 'completed' && !order.review && (
              <button
                onClick={() => setIsReviewModalOpen(true)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
              >
                <Star className="w-4 h-4 fill-white" />
                <span>Write a Review</span>
              </button>
            )}

            {currentUser?.id === order.sellerId && order.status !== 'completed' && (
              <button
                onClick={() => setIsDeliverModalOpen(true)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
              >
                <Send className="w-3.5 h-3.5 text-emerald-400" />
                <span>Deliver Work</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2-COLUMN LAYOUT: MAIN WORKSTREAM + SUMMARY SIDEBAR */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* LEFT COLUMN: ACTIVITY & FILES TABS (3 COLS) */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-xs overflow-hidden flex flex-col h-[750px]">
            {/* SUBTABS HEADER */}
            <div className="flex border-b border-slate-100 bg-slate-50/70 px-6 py-2 items-center justify-between">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveSubTab('activity')}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
                    activeSubTab === 'activity'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    <span>Activity Stream</span>
                  </div>
                </button>

                <button
                  onClick={() => setActiveSubTab('files')}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
                    activeSubTab === 'files'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Shared Files ({files.length})</span>
                  </div>
                </button>
              </div>
            </div>

            {/* TAB CONTENT */}
            <div className="flex-1 overflow-hidden flex flex-col relative">
              {activeSubTab === 'activity' ? (
                <>
                  <WorkstreamActivityStream
                    messages={messages}
                    currentUserId={currentUser?.id}
                    usersList={usersList}
                    partnerUser={partner}
                    onDownloadFile={handleDownloadFile}
                    offers={offers}
                    buyerId={order.buyerId}
                    sellerId={order.sellerId}
                    onOfferAction={handleOfferAction}
                    onRetryMessage={onRetryMessage}
                  />
                  <WorkstreamMessageInput
                    key={order.id}
                    onSendMessage={onSendMessage}
                    onAttachFile={onAttachFile}
                    onStartVideoCall={() => setIsVideoCallModalOpen(true)}
                    onCreateOffer={createOffer}
                    canSendProposal={canSendProposal}
                    canRaiseInvoice={canRaiseInvoice}
                    proposalHint={proposalHint}
                    invoiceHint={invoiceHint}
                    currencySymbol={currencySymbol}
                  />
                </>
              ) : (
                <WorkstreamFilesTab
                  key={`files_${order.id}`}
                  files={files}
                  onUploadFile={onAttachFile}
                  onDownloadFile={handleDownloadFile}
                />
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: SUMMARY CARD & ACTIONS PANEL (1 COL) */}
        <div className="space-y-6">
          <WorkstreamSummaryCard
            order={order}
            partner={partner}
            currentUser={currentUser}
            onViewPartnerProfile={onViewPartnerProfile}
          />

          <WorkstreamActionsPanel
            order={order}
            currentUser={currentUser}
            onOpenReleaseModal={() => setIsReleaseModalOpen(true)}
            onOpenDeliverModal={() => setIsDeliverModalOpen(true)}
            onOpenRevisionModal={() => setIsRevisionModalOpen(true)}
            onOpenReviewModal={() => setIsReviewModalOpen(true)}
            onStartVideoCall={() => setIsVideoCallModalOpen(true)}
            onAttachFiles={() => setActiveSubTab('files')}
            onDisputeAssistance={onDisputeAssistance}
          />
        </div>
      </div>

      {/* MODALS */}
      <WorkstreamVideoCallModal
        key={`video_${order.id}`}
        isOpen={isVideoCallModalOpen}
        order={order}
        currentUser={currentUser}
        partner={partner}
        onClose={() => setIsVideoCallModalOpen(false)}
        onLogRequirement={handleLogRequirement}
        onMissedCall={handleMissedCall}
      />

      <WorkstreamReleaseModal
        key={`release_${order.id}`}
        isOpen={isReleaseModalOpen}
        order={order}
        onClose={() => setIsReleaseModalOpen(false)}
        onConfirm={async () => { await onReleaseEscrow(); }}
      />

      <WorkstreamDeliverModal
        key={`deliver_${order.id}`}
        isOpen={isDeliverModalOpen}
        order={order}
        onClose={() => setIsDeliverModalOpen(false)}
        onSubmitDelivery={onDeliverWork}
      />

      <WorkstreamRevisionModal
        key={`revision_${order.id}`}
        isOpen={isRevisionModalOpen}
        order={order}
        onClose={() => setIsRevisionModalOpen(false)}
        onSubmitRevision={onRequestRevision}
      />
      
      <WorkstreamReviewModal
        key={`review_${order.id}`}
        isOpen={isReviewModalOpen}
        order={order}
        onClose={() => setIsReviewModalOpen(false)}
        onSubmitReview={handleSubmitReview}
        error={reviewError}
        isSubmitting={isSubmittingReview}
      />
    </div>
  );
};
