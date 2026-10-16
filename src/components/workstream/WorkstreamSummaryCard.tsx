import React from 'react';
import { Briefcase, ShieldCheck, Clock, Calendar, CheckCircle2, ChevronRight, User } from 'lucide-react';
import { WorkstreamItem } from './types';
import { UserAccount } from '../../types';

interface WorkstreamSummaryCardProps {
  order: WorkstreamItem;
  partner?: UserAccount;
  currentUser?: UserAccount | null;
  onViewPartnerProfile?: (user: UserAccount) => void;
}

export const WorkstreamSummaryCard: React.FC<WorkstreamSummaryCardProps> = ({
  order,
  partner,
  currentUser,
  onViewPartnerProfile
}) => {
  const isBuyer = currentUser?.id === order.buyerId;

  return (
    <div className="space-y-5">
      {/* SUMMARY CARD */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-50 rounded-2xl text-emerald-600">
            <Briefcase className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-fiverr-dark leading-tight uppercase tracking-wider">
              Workstream Summary
            </h4>
            <div className="text-[10px] text-slate-400 mt-0.5 font-mono">
              Order #{order.id}
            </div>
          </div>
        </div>

        {/* FINANCIAL & ESCROW METRICS */}
        <div className="space-y-3 pt-2 border-t border-slate-100 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Escrow Vault</span>
            <div className="text-right">
              <span className="font-bold text-emerald-600 font-mono text-sm block">
                ${order.amount.toLocaleString()}
              </span>
              <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-semibold border border-emerald-200">
                14-Day Protection Active
              </span>
            </div>
          </div>

          <div className="flex justify-between items-center pt-1">
            <span className="text-slate-400">Created Date</span>
            <span className="font-bold text-fiverr-dark font-mono text-[11px]">
              {order.createdAt || 'Recent'}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-slate-400">Delivery Deadline</span>
            <span className="font-bold text-orange-600 font-mono text-[11px] flex items-center gap-1">
              <Clock className="w-3 h-3 text-orange-500" />
              <span>{order.dueDate || 'Standard turnaround'}</span>
            </span>
          </div>
        </div>

        {/* SCOPE & REQUIREMENTS */}
        <div className="pt-2 border-t border-slate-100">
          <h5 className="text-[10px] font-bold uppercase text-slate-400 mb-2 tracking-widest">
            Scope & Requirements
          </h5>
          <p className="text-[11px] text-fiverr-dark leading-relaxed italic border-l-2 border-emerald-500 pl-3 bg-slate-50/70 p-2.5 rounded-r-xl">
            {order.requirements || order.gig?.description || 'Standard service milestones agreed via workstream.'}
          </p>
        </div>
      </div>

      {/* COLLABORATOR PROFILE CARD */}
      {partner && (
        <div className="bg-slate-900 rounded-3xl p-5 shadow-xs text-white relative overflow-hidden">
          <div className="relative z-10 flex flex-col items-center text-center space-y-3">
            <img
              src={partner.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop'}
              alt={partner.name}
              className="w-14 h-14 rounded-full object-cover ring-4 ring-slate-800 shadow-md"
            />
            <div>
              <div className="font-bold text-sm tracking-tight">{partner.name}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-widest mt-0.5">
                {partner.role} • {partner.title || 'Verified Partner'}
              </div>
            </div>

            {onViewPartnerProfile && (
              <button
                onClick={() => onViewPartnerProfile(partner)}
                className="w-full py-2 bg-white/10 hover:bg-white/20 text-white font-bold text-[11px] rounded-xl transition border border-white/10 flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>View Full Profile</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
