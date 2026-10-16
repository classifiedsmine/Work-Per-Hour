import React from 'react';
import { HelpCircle, Settings, ShieldCheck, Users } from 'lucide-react';

interface FooterProps {
  navigate: (to: string, e?: React.MouseEvent) => void;
}

/** Site footer with brand blurb and link columns. */
export function Footer({ navigate }: FooterProps) {
  return (
    <footer className="bg-white border-t border-slate-200/80 mt-16 py-12 px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8 mb-12">
        {/* Col 1: Brand */}
        <div>
          <a href="/gigs" onClick={(e) => navigate('/gigs', e)} className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center font-bold text-base">
              W
            </div>
            <span className="text-base font-bold tracking-tight text-fiverr-dark">WorkPerHour</span>
          </a>
          <p className="text-xs text-fiverr-muted leading-relaxed mb-4">
            WorkPerHour is a secure freelance marketplace with 100% Escrow payment protection, real-time Workstream collaboration, and Gemini AI proposal generation.
          </p>
          <div className="flex items-center gap-2 text-xs text-emerald-600 font-semibold">
            <ShieldCheck className="w-4 h-4" />
            <span>100% Escrow Protected</span>
          </div>
        </div>

        {/* Col 2: SEO Category Links */}
        <div>
          <h4 className="text-xs font-bold text-fiverr-dark uppercase tracking-wider mb-4">Browse Categories</h4>
          <ul className="space-y-2.5 text-xs text-fiverr-dark">
            <li>
              <a href="/categories/development-it" onClick={(e) => navigate('/categories/development-it', e)} className="hover:text-fiverr-dark transition-colors">
                Development & IT
              </a>
            </li>
            <li>
              <a href="/categories/ai-data" onClick={(e) => navigate('/categories/ai-data', e)} className="hover:text-fiverr-dark transition-colors">
                AI & Data Science
              </a>
            </li>
            <li>
              <a href="/categories/design-creative" onClick={(e) => navigate('/categories/design-creative', e)} className="hover:text-fiverr-dark transition-colors">
                Design & Creative
              </a>
            </li>
            <li>
              <a href="/categories/mobile-apps" onClick={(e) => navigate('/categories/mobile-apps', e)} className="hover:text-fiverr-dark transition-colors">
                Mobile Apps
              </a>
            </li>
          </ul>
        </div>

        {/* Col 3: Platform Links */}
        <div>
          <h4 className="text-xs font-bold text-fiverr-dark uppercase tracking-wider mb-4">Marketplace Navigation</h4>
          <ul className="space-y-2.5 text-xs text-fiverr-dark">
            <li>
              <a href="/gigs" onClick={(e) => navigate('/gigs', e)} className="hover:text-fiverr-dark transition-colors">
                Explore All Gigs
              </a>
            </li>
            <li>
              <a href="/projects" onClick={(e) => navigate('/projects', e)} className="hover:text-fiverr-dark transition-colors">
                Buyer Requests Board
              </a>
            </li>
            <li>
              <a href="/orders" onClick={(e) => navigate('/orders', e)} className="hover:text-fiverr-dark transition-colors">
                My Escrow Orders
              </a>
            </li>
            <li>
              <a href="/messages" onClick={(e) => navigate('/messages', e)} className="hover:text-fiverr-dark transition-colors">
                Active Workstreams
              </a>
            </li>
          </ul>
        </div>

        {/* Col 4: Platform Administration & Support */}
        <div>
          <h4 className="text-xs font-bold text-fiverr-dark uppercase tracking-wider mb-4">Support & Administration</h4>
          <ul className="space-y-2.5 text-xs text-fiverr-dark">
            <li>
              <button 
                onClick={(e) => navigate('/support', e)}
                className="inline-flex items-center gap-1.5 font-bold text-fiverr-dark hover:text-emerald-600 transition-colors cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span>Contact Support Desk</span>
              </button>
            </li>
            <li>
              <a href="/admin" onClick={(e) => navigate('/admin', e)} className="inline-flex items-center gap-1.5 font-bold text-fiverr-dark hover:text-emerald-600 transition-colors">
                <Settings className="w-3.5 h-3.5 text-emerald-600" />
                <span>Admin Panel Console</span>
              </a>
            </li>
            <li><span className="text-slate-400">Escrow Security Protocols</span></li>
            <li><span className="text-slate-400">Gemini AI Engine Logs</span></li>
          </ul>
        </div>
      </div>

      <div className="max-w-7xl mx-auto pt-8 border-t border-slate-200/60 flex flex-col sm:flex-row items-center justify-between text-xs text-fiverr-muted gap-4">
        <p>© 2026 WorkPerHour Marketplace Inc. All rights reserved.</p>
        <div className="flex items-center gap-6">
          <button 
            onClick={(e) => navigate('/support', e)}
            className="font-semibold text-emerald-600 hover:text-emerald-700 inline-flex items-center gap-1 cursor-pointer"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Contact Support</span>
          </button>
          <span>·</span>
          <button 
            onClick={(e) => navigate('/switch-user', e)}
            className="font-semibold text-fiverr-dark hover:text-fiverr-dark inline-flex items-center gap-1 cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-emerald-600" />
            <span>Switch User</span>
          </button>
          <span>·</span>
          <a href="/admin" onClick={(e) => navigate('/admin', e)} className="font-semibold text-fiverr-dark hover:text-fiverr-dark">
            Admin Portal
          </a>
          <span>·</span>
          <span>Terms of Service</span>
          <span>·</span>
          <span>Privacy Policy</span>
        </div>
      </div>
    </footer>
  );
}
