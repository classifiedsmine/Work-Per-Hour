import React, { useState, useMemo } from 'react';
import { 
  Wallet, Search, ArrowUpRight, ArrowDownLeft, ShieldCheck, 
  CreditCard, DollarSign, Filter, RefreshCw, User, CheckCircle2,
  Lock, AlertTriangle
} from 'lucide-react';
import { UserAccount } from '../types';

interface UserWalletsLedgerModuleProps {
  currentUser?: UserAccount | null;
}

export const UserWalletsLedgerModule: React.FC<UserWalletsLedgerModuleProps> = ({
  currentUser
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'freelancer' | 'buyer' | 'admin'>('all');

  interface LedgerEntry {
    id: string;
    userName: string;
    userEmail: string;
    role: string;
    balance: number;
    escrowHold: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    status: string;
    lastActivity: string;
  }

  const [ledgerEntries] = useState<LedgerEntry[]>([]);

  const filteredWallets = useMemo(() => {
    return ledgerEntries.filter(w => {
      const matchesSearch = 
        w.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        w.userEmail.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === 'all' || w.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [ledgerEntries, searchQuery, roleFilter]);

  const totalPlatformBalance = ledgerEntries.reduce((sum, w) => sum + w.balance, 0);
  const totalEscrowHold = ledgerEntries.reduce((sum, w) => sum + w.escrowHold, 0);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <Wallet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">User Wallets & Financial Ledger</h2>
            <p className="text-xs text-slate-500">Real-time audit log of user wallet balances, escrow liabilities, and liquidity reserves</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 bg-white border border-slate-200 rounded-3xl shadow-xs">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total User Liquid Funds</span>
          <div className="text-3xl font-extrabold text-slate-900 mt-2">
            ${totalPlatformBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-slate-400 mt-1">Available across all active client and freelancer balance accounts</p>
        </div>
        <div className="p-5 bg-white border border-slate-200 rounded-3xl shadow-xs">
          <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">Total Active Escrow Liabilities</span>
          <div className="text-3xl font-extrabold text-blue-700 mt-2">
            ${totalEscrowHold.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <p className="text-xs text-blue-500 mt-1">Secured in contracts pending milestone deliverables clearance</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl p-4 shadow-xs flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search wallet ledger by user name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as any)}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700"
        >
          <option value="all">All User Roles</option>
          <option value="freelancer">Freelancers</option>
          <option value="buyer">Buyers / Clients</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600 border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75 font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-3 px-4">User Account</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Available Balance</th>
                <th className="py-3 px-4">In Escrow</th>
                <th className="py-3 px-4">Turnover (Earned / Spent)</th>
                <th className="py-3 px-4">Ledger Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredWallets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400 font-medium">
                    No wallet accounts or ledger records found.
                  </td>
                </tr>
              ) : (
                filteredWallets.map((w) => (
                  <tr key={w.id} className="hover:bg-slate-50/60 transition">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900">{w.userName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{w.userEmail}</div>
                    </td>
                    <td className="py-3.5 px-4 capitalize font-semibold text-slate-700">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px]">
                        {w.role}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900 text-sm">
                      ${w.balance.toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-blue-600">
                      ${w.escrowHold.toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">
                      {w.role === 'freelancer' ? `Earned: $${w.lifetimeEarned.toFixed(2)}` : `Spent: $${w.lifetimeSpent.toFixed(2)}`}
                    </td>
                    <td className="py-3.5 px-4">
                      {w.status === 'active' ? (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Active
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                          Frozen
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
