import React, { useState } from 'react';
import { X, ShieldCheck, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { WorkstreamItem } from './types';

interface WorkstreamReleaseModalProps {
  isOpen: boolean;
  order: WorkstreamItem;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export const WorkstreamReleaseModal: React.FC<WorkstreamReleaseModalProps> = ({
  isOpen,
  order,
  onClose,
  onConfirm
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [releaseNote, setReleaseNote] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-fiverr-dark">Release Escrow Funds</h3>
              <p className="text-[11px] text-slate-400">Order #{order.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
            <div>
              <span className="text-[11px] text-slate-400 uppercase font-semibold block">
                Total Escrow Release
              </span>
              <span className="text-xl font-bold font-mono text-emerald-600">
                ${order.amount.toLocaleString()} USD
              </span>
            </div>
            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase rounded-full">
              Instant Payout
            </span>
          </div>

          <div className="p-3 bg-emerald-50/80 text-[11px] text-emerald-800 rounded-2xl border border-emerald-200 flex items-start gap-2.5 leading-relaxed">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Releasing escrow accepts the deliverables, marks the Workstream as completed, and transfers the funds to the seller. Review submission is completely optional and handled separately.
            </span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-fiverr-dark font-bold rounded-xl text-xs transition cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs shadow-xs transition cursor-pointer flex items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isSubmitting ? 'Releasing...' : 'Confirm & Release Funds'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
