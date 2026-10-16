import React from 'react';
import { 
  ShieldCheck, ArrowRight, FileText, Paperclip, AlertTriangle, 
  RotateCcw, CheckCircle2, PlusCircle, Settings, Send, Video, Star
} from 'lucide-react';
import { WorkstreamItem } from './types';
import { UserAccount } from '../../types';

interface WorkstreamActionsPanelProps {
  order: WorkstreamItem;
  currentUser?: UserAccount | null;
  onOpenReleaseModal: () => void;
  onOpenDeliverModal: () => void;
  onOpenRevisionModal: () => void;
  onOpenReviewModal: () => void;
  onOpenInvoiceModal?: () => void;
  onStartVideoCall?: () => void;
  onAttachFiles: () => void;
  onDisputeAssistance?: () => void;
}

export const WorkstreamActionsPanel: React.FC<WorkstreamActionsPanelProps> = ({
  order,
  currentUser,
  onOpenReleaseModal,
  onOpenDeliverModal,
  onOpenRevisionModal,
  onOpenReviewModal,
  onOpenInvoiceModal,
  onStartVideoCall,
  onAttachFiles,
  onDisputeAssistance
}) => {
  const isBuyer = currentUser?.id === order.buyerId;
  const isSeller = currentUser?.id === order.sellerId;
  const isCompleted = order.status === 'completed';
  const isDelivered = order.status === 'delivered';

  return (
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
      <h4 className="text-xs font-bold text-fiverr-dark uppercase tracking-wider flex items-center gap-2">
        <Settings className="w-4 h-4 text-slate-400" />
        <span>Workstream Actions</span>
      </h4>

      <div className="space-y-2.5">
        {/* IN-BROWSER MEETING BUTTON (WEB-RTC VIDEO CALL) */}
        {onStartVideoCall && (
          <button
            onClick={onStartVideoCall}
            className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl text-xs font-bold text-left flex items-center justify-between transition shadow-xs cursor-pointer border border-indigo-500/80"
          >
            <div className="flex items-center gap-2.5">
              <Video className="w-4 h-4 text-emerald-400 animate-pulse" />
              <span>Open Local Camera Preview</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}

        {/* BUYER ACTIONS */}
        {isBuyer && !isCompleted && isDelivered && (
          <button
            onClick={onOpenReleaseModal}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-bold text-left flex items-center justify-between transition shadow-xs cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4" />
              <span>Approve & Release Escrow</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
        {isBuyer && !isCompleted && !isDelivered && (order.status === 'in_progress' || order.status === 'funded_in_escrow') && (
          <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-2xl text-[11px] text-blue-800 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Escrow funded (${order.amount.toLocaleString()}). Awaiting seller deliverables.</span>
          </div>
        )}
        {isBuyer && !isCompleted && order.status === 'revision' && (
          <div className="p-3 bg-purple-50/70 border border-purple-200 rounded-2xl text-[11px] text-purple-800 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-purple-600 shrink-0" />
            <span>Revision requested. Seller is updating deliverables.</span>
          </div>
        )}
        {isBuyer && (isCompleted || order.status === 'cancelled') && !order.review && (
          <button
            onClick={onOpenReviewModal}
            className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-xs font-bold text-left flex items-center justify-between transition shadow-xs cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Star className="w-4 h-4 fill-white" />
              <span>{order.status === 'cancelled' ? 'Rate Cancelled Order' : 'Write a Review'}</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}

        {order.review && (
          <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-2xl text-xs space-y-2 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 font-bold text-amber-900">
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                <span>{order.review.isCancelledOrder ? 'Post-Cancellation Review' : 'Review Submitted'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-amber-800 text-[11px] bg-amber-100/70 px-2 py-0.5 rounded-full">
                  {order.review.rating}.0 / 5.0
                </span>
                {isBuyer && (
                  <button onClick={onOpenReviewModal} className="text-[10px] text-amber-800 underline font-semibold hover:text-amber-950">
                    Edit
                  </button>
                )}
              </div>
            </div>
            <p className="text-[11px] text-amber-800 italic line-clamp-3">"{order.review.comment}"</p>
            {order.review.reply && (
              <div className="mt-2 pt-2 border-t border-amber-200 text-[11px] text-amber-900">
                <span className="font-bold">Seller Public Response: </span>
                <span className="italic">"{order.review.reply.text}"</span>
              </div>
            )}
          </div>
        )}

        {isBuyer && isDelivered && (
          <button
            onClick={onOpenRevisionModal}
            className="w-full py-2.5 px-4 bg-purple-50 hover:bg-purple-100 text-purple-800 border border-purple-200 rounded-2xl text-xs font-bold text-left flex items-center justify-between transition cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <RotateCcw className="w-4 h-4" />
              <span>Request Revisions</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}

        {/* SELLER ACTIONS */}
        {isSeller && !isCompleted && (order.status === 'in_progress' || order.status === 'funded_in_escrow' || order.status === 'revision') && (
          <button
            onClick={onOpenDeliverModal}
            className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-xs font-bold text-left flex items-center justify-between transition shadow-xs cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Send className="w-4 h-4 text-emerald-400" />
              <span>{order.status === 'revision' ? 'Submit Revised Deliverables' : 'Submit Deliverable Files'}</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}

        {/* COMPLETED BANNER */}
        {isCompleted && (
          <div className="p-3 bg-emerald-50 rounded-2xl border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>This order has been completed and escrow funds released.</span>
          </div>
        )}

        {/* SHARED COMMON ACTIONS */}
        <button
          onClick={onAttachFiles}
          className="w-full py-2.5 px-4 bg-slate-50 hover:bg-slate-100 text-fiverr-dark border border-slate-200 rounded-2xl text-xs font-semibold text-left flex items-center justify-between transition group cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <Paperclip className="w-4 h-4 text-slate-400 group-hover:text-fiverr-dark transition" />
            <span>Share Files & Documents</span>
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
        </button>

        {onOpenInvoiceModal && (
          <button
            onClick={onOpenInvoiceModal}
            className="w-full py-2.5 px-4 bg-slate-50 hover:bg-slate-100 text-fiverr-dark border border-slate-200 rounded-2xl text-xs font-semibold text-left flex items-center justify-between transition group cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <FileText className="w-4 h-4 text-slate-400 group-hover:text-fiverr-dark transition" />
              <span>Raise Milestone Invoice</span>
            </div>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
          </button>
        )}

        {onDisputeAssistance && (
          <button
            onClick={onDisputeAssistance}
            className="w-full py-2 px-3 text-slate-400 hover:text-red-600 rounded-xl text-[11px] font-medium text-left flex items-center gap-2 transition cursor-pointer mt-1"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Escrow Dispute Assistance</span>
          </button>
        )}
      </div>
    </div>
  );
};
