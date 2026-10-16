import React, { useEffect, useRef, useState } from 'react';
import {
  Bell, Briefcase, ChevronDown, FileText, Heart, HelpCircle, LayoutDashboard,
  LogOut, Mail, Pencil, PlusCircle, Search, Settings, Sparkles, User, Wallet
} from 'lucide-react';
import { PPH_CATEGORIES } from '../components/HeaderCategoriesNav';
import { slugify } from '../utils/slugify';
import type { Order, UserAccount } from '../types';
import { clearAuthToken } from '../utils/authToken';

export interface HeaderProps {
  navigate: (to: string, e?: React.MouseEvent) => void;
  currentUser: UserAccount | null;
  orders: Order[];
  likedGigIds: string[];
  /** Route flags used to highlight / scope the category dropdown. */
  isGigsList: boolean;
  isGigDetail: boolean;
  isProjectsList: boolean;
  isProjectDetail: boolean;
  isCategoryRoute: boolean;
  loadUserSession: () => Promise<boolean>;
  updateCurrentUser: (u: UserAccount | null | ((prev: UserAccount | null) => UserAccount | null)) => void;
  setImpersonatedUser: (u: UserAccount | null) => void;
  setSelectedOrder: (o: Order | null) => void;
  setPath: (p: string) => void;
  fetchMessages: (orderId: string) => void | Promise<void>;
}

/** Site header: brand, primary nav, category/search/workstream dropdowns and the user menu. */
export function Header({
  navigate, currentUser, orders, likedGigIds,
  isGigsList, isGigDetail, isProjectsList, isProjectDetail, isCategoryRoute,
  loadUserSession, updateCurrentUser, setImpersonatedUser, setSelectedOrder, setPath, fetchMessages
}: HeaderProps) {
  // Dropdown state is local to the header (moved out of App).
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [isWorkstreamsDropdownOpen, setIsWorkstreamsDropdownOpen] = useState(false);
  const [isHeaderSearchDropdownOpen, setIsHeaderSearchDropdownOpen] = useState(false);
  const [isHeaderCategoriesDropdownOpen, setIsHeaderCategoriesDropdownOpen] = useState(false);
  const headerCategoriesTimeoutRef = useRef<any>(null);

  const handleHeaderCategoriesMouseEnter = () => {
    if (headerCategoriesTimeoutRef.current) clearTimeout(headerCategoriesTimeoutRef.current);
    setIsHeaderCategoriesDropdownOpen(true);
  };

  const handleHeaderCategoriesMouseLeave = () => {
    if (headerCategoriesTimeoutRef.current) clearTimeout(headerCategoriesTimeoutRef.current);
    headerCategoriesTimeoutRef.current = setTimeout(() => {
      setIsHeaderCategoriesDropdownOpen(false);
    }, 250);
  };

  const toggleAvailableNow = () => {
    if (!currentUser) return;
    const updated = { ...currentUser, isAvailableNow: !currentUser.isAvailableNow };
    updateCurrentUser(updated);
    alert(updated.isAvailableNow ? 'You are now marked as Available Now! Clients will see your green status.' : 'You are now marked as Unavailable.');
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handleOutsideClick = () => {
      if (isUserDropdownOpen) setIsUserDropdownOpen(false);
      if (isWorkstreamsDropdownOpen) setIsWorkstreamsDropdownOpen(false);
      if (isHeaderSearchDropdownOpen) setIsHeaderSearchDropdownOpen(false);
      if (isHeaderCategoriesDropdownOpen) setIsHeaderCategoriesDropdownOpen(false);
    };
    if (isUserDropdownOpen || isWorkstreamsDropdownOpen || isHeaderSearchDropdownOpen || isHeaderCategoriesDropdownOpen) {
      document.addEventListener('click', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('click', handleOutsideClick);
    };
  }, [isUserDropdownOpen, isWorkstreamsDropdownOpen, isHeaderSearchDropdownOpen, isHeaderCategoriesDropdownOpen]);

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200/80 backdrop-blur-md px-4 sm:px-6 py-3.5 flex items-center justify-between shadow-xs w-full max-w-full">
      {/* Left Side: Brand & Nav Links */}
      <div className="flex items-center gap-10">
        <div className="flex items-center gap-3">
          <a href="/" onClick={(e) => navigate('/', e)} className="flex items-center gap-2.5 text-left group">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center font-bold text-lg shadow-md group-hover:bg-slate-800 transition-colors">
              W
            </div>
            <div>
              <span className="text-[17px] font-bold tracking-tight text-fiverr-dark block leading-none">WorkPerHour</span>
              <span className="text-[9px] text-emerald-600 font-semibold uppercase tracking-wider">Secure Escrow Marketplace</span>
            </div>
          </a>
        </div>

        <nav className="hidden lg:flex items-center gap-7 text-[13.5px] font-medium text-fiverr-dark">
          {/* CATEGORIES AUTO DROPDOWN LINK */}
          <div 
            className="relative"
            onMouseEnter={handleHeaderCategoriesMouseEnter}
            onMouseLeave={handleHeaderCategoriesMouseLeave}
          >
            <button 
              type="button"
              onClick={(e) => {
                e.preventDefault();
                if (headerCategoriesTimeoutRef.current) clearTimeout(headerCategoriesTimeoutRef.current);
                setIsHeaderCategoriesDropdownOpen(!isHeaderCategoriesDropdownOpen);
              }}
              className={`transition-colors hover:text-emerald-700 py-1 inline-flex items-center gap-1 cursor-pointer font-medium ${isCategoryRoute ? 'text-emerald-600 font-bold border-b-2 border-emerald-600' : 'text-fiverr-dark'}`}
            >
              <span>Categories</span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isHeaderCategoriesDropdownOpen ? 'rotate-180 text-emerald-600' : ''}`} />
            </button>

            {isHeaderCategoriesDropdownOpen && (
              <div 
                className="absolute left-0 top-full -mt-0.5 pt-2 w-[720px] max-w-[calc(100vw-2rem)] z-[120] animate-in fade-in duration-150"
                onMouseEnter={handleHeaderCategoriesMouseEnter}
                onMouseLeave={handleHeaderCategoriesMouseLeave}
              >
                <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 p-4.5 font-sans text-xs">
                  <div className="px-2 pb-2.5 mb-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                      Browse All Categories
                    </span>
                    <a 
                      href="/gigs" 
                      onClick={(e) => { 
                        if (headerCategoriesTimeoutRef.current) clearTimeout(headerCategoriesTimeoutRef.current);
                        setIsHeaderCategoriesDropdownOpen(false); 
                        navigate('/gigs', e); 
                      }}
                      className="text-[11px] font-bold text-emerald-600 hover:text-emerald-700 hover:underline flex items-center gap-1"
                    >
                      Explore All Gigs →
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-3 max-h-[440px] overflow-y-auto p-1">
                    {PPH_CATEGORIES.map((cat) => (
                      <div key={cat.slug} className="p-3 rounded-xl hover:bg-emerald-50/40 hover:border-emerald-200/80 transition-all border border-slate-100 group">
                        <a 
                          href={`/categories/${cat.slug}`}
                          onClick={(e) => { 
                            if (headerCategoriesTimeoutRef.current) clearTimeout(headerCategoriesTimeoutRef.current);
                            setIsHeaderCategoriesDropdownOpen(false); 
                            navigate(`/categories/${cat.slug}`, e); 
                          }}
                          className="font-bold text-slate-900 group-hover:text-emerald-600 text-[13px] block mb-1.5 flex items-center justify-between"
                        >
                          <span>{cat.name}</span>
                          <span className="text-slate-300 group-hover:text-emerald-600 text-xs transition-colors">→</span>
                        </a>
                        <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[11.5px] text-slate-500">
                          {cat.subcategories.slice(0, 5).map((sub) => (
                            <a
                              key={sub.slug}
                              href={`/categories/${sub.slug}`}
                              onClick={(e) => { 
                                if (headerCategoriesTimeoutRef.current) clearTimeout(headerCategoriesTimeoutRef.current);
                                setIsHeaderCategoriesDropdownOpen(false); 
                                navigate(`/categories/${sub.slug}`, e); 
                              }}
                              className="hover:text-emerald-600 hover:underline cursor-pointer"
                            >
                              {sub.name}
                            </a>
                          ))}
                          {cat.subcategories.length > 5 && (
                            <a
                              href={`/categories/${cat.slug}`}
                              onClick={(e) => { 
                                if (headerCategoriesTimeoutRef.current) clearTimeout(headerCategoriesTimeoutRef.current);
                                setIsHeaderCategoriesDropdownOpen(false); 
                                navigate(`/categories/${cat.slug}`, e); 
                              }}
                              className="text-emerald-600 font-bold hover:underline cursor-pointer"
                            >
                              +{cat.subcategories.length - 5} more
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <a 
            href="/gigs" 
            onClick={(e) => navigate('/gigs', e)}
            className={`transition-colors hover:text-fiverr-dark py-1 ${isGigsList || isGigDetail ? 'text-fiverr-dark font-semibold border-b-2 border-slate-900' : ''}`}
          >
            Explore Gigs
          </a>
          <a 
            href="/projects" 
            onClick={(e) => navigate('/projects', e)}
            className={`transition-colors hover:text-fiverr-dark py-1 ${isProjectsList || isProjectDetail ? 'text-fiverr-dark font-semibold border-b-2 border-slate-900' : ''}`}
          >
            Buyer Requests
          </a>
        </nav>
      </div>

      {/* Zone 3: Primary Actions & Profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* POST PROJECT BUTTON */}
        <a 
          href="/post-project"
          onClick={(e) => navigate('/post-project', e)}
          className="hidden sm:inline-flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[12px] uppercase tracking-wider rounded-xl shadow-xs transition-colors cursor-pointer"
        >
          Post Project
        </a>

        {/* SEARCH DROPDOWN */}
        <div className="relative">
          <button 
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsHeaderSearchDropdownOpen(!isHeaderSearchDropdownOpen);
              setIsWorkstreamsDropdownOpen(false);
              setIsUserDropdownOpen(false);
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl text-[12.5px] font-bold text-fiverr-dark transition-colors cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 text-fiverr-muted" />
            <span>Search</span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {isHeaderSearchDropdownOpen && (
            <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-2xl border border-slate-200 py-3 z-[100] text-[13.5px] font-sans" onClick={(e) => e.stopPropagation()}>
              <div className="px-4 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100">
                Buyers can
              </div>
              <div className="p-1 space-y-0.5">
                <button
                  onClick={() => {
                    setIsHeaderSearchDropdownOpen(false);
                    navigate('/gigs');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="font-bold text-fiverr-dark">Search offers</div>
                  <span className="text-[10px] text-fiverr-muted">to buy now</span>
                </button>
                <button
                  onClick={() => {
                    setIsHeaderSearchDropdownOpen(false);
                    navigate('/freelancers');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="font-bold text-fiverr-dark">Search freelancers</div>
                  <span className="text-[10px] text-fiverr-muted">to request a proposal</span>
                </button>
              </div>

              <div className="px-4 pt-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-t border-slate-100 mt-1">
                Freelancers can
              </div>
              <div className="p-1">
                <button
                  onClick={() => {
                    setIsHeaderSearchDropdownOpen(false);
                    navigate('/projects');
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="font-bold text-fiverr-dark">Search projects</div>
                  <span className="text-[10px] text-fiverr-muted">to quote on</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <button 
          onClick={(e) => navigate('/wishlist', e)} 
          className="p-2 text-fiverr-dark hover:text-fiverr-dark rounded-full hover:bg-slate-100 transition-colors relative cursor-pointer"
          title="Wishlist / Liked Gigs"
        >
          <Heart className="w-5 h-5 text-fiverr-dark" />
          {likedGigIds.length > 0 && (
            <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center shadow-xs">
              {likedGigIds.length}
            </span>
          )}
        </button>
        
        <div className="relative">
          <button 
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              if (!currentUser) {
                const restored = await loadUserSession();
                if (!restored) {
                  navigate('/login', e);
                  return;
                }
              }
              setIsWorkstreamsDropdownOpen(!isWorkstreamsDropdownOpen);
              setIsUserDropdownOpen(false);
            }} 
            className="p-2 text-fiverr-dark hover:text-fiverr-dark rounded-full hover:bg-slate-100 transition-colors relative cursor-pointer"
            title="Workstreams & Messages"
          >
            <Mail className="w-5 h-5 text-fiverr-dark" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full"></span>
          </button>

          {isWorkstreamsDropdownOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 py-3 z-[100] text-xs font-sans" onClick={(e) => e.stopPropagation()}>
              <div className="px-4 pb-2.5 mb-2 border-b border-slate-100 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Workstreams</span>
                <span className="text-[10px] font-mono text-emerald-600 font-bold">{orders.length} Active</span>
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                {orders.slice(0, 5).map(ord => (
                  <div 
                    key={ord.id}
                    onClick={async () => {
                      if (!currentUser) {
                        const restored = await loadUserSession();
                        if (!restored) {
                          navigate('/login');
                          return;
                        }
                      }
                      setSelectedOrder(ord);
                      fetchMessages(ord.id);
                      setIsWorkstreamsDropdownOpen(false);
                      navigate('/messages/' + ord.id);
                    }}
                    className="p-3 hover:bg-slate-50 transition-colors cursor-pointer flex items-start gap-3"
                  >
                    <img src="https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=100&h=100&fit=crop" className="w-8 h-8 rounded-full object-cover ring-1 ring-slate-200 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="font-bold text-fiverr-dark truncate">{ord.title}</span>
                        <span className="text-[10px] text-slate-400 whitespace-nowrap font-mono">{ord.createdAt || '31 Jul 2026'}</span>
                      </div>
                      <p className="text-[11px] text-fiverr-muted truncate">
                        {ord.requirements || 'Hi Nikhil, Hope you are doing well. Please check the deliverables.'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="pt-2 px-3 border-t border-slate-100 mt-2 text-center">
                <button 
                  onClick={() => {
                    setIsWorkstreamsDropdownOpen(false);
                    navigate('/messages');
                  }}
                  className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-fiverr-dark font-bold text-[10px] uppercase tracking-wider rounded-xl transition-colors cursor-pointer"
                >
                  View All
                </button>
              </div>
            </div>
          )}
        </div>

        <button 
          onClick={(e) => navigate('/notifications', e)} 
          className="p-2 text-fiverr-dark hover:text-fiverr-dark rounded-full hover:bg-slate-100 transition-colors relative cursor-pointer"
          title="Notifications"
        >
          <Bell className="w-5 h-5 text-fiverr-dark" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>

        {!currentUser ? (
          <>
            <button onClick={(e) => navigate('/login', e)} className="px-4 py-2 text-[13.5px] font-semibold text-fiverr-dark hover:text-fiverr-dark cursor-pointer">Login</button>
            <button onClick={(e) => navigate('/signup', e)} className="px-4 py-2 text-[13.5px] font-semibold text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 cursor-pointer">Sign Up</button>
          </>
        ) : (
          <div className="relative pl-2 border-l border-slate-200">
            <button 
              type="button"
              onClick={(e) => {
                  e.stopPropagation();
                  setIsUserDropdownOpen(!isUserDropdownOpen);
              }}
              className="relative flex items-center gap-1.5 cursor-pointer p-1 rounded-xl hover:bg-slate-100 transition-colors border-none bg-transparent"
            >
              <div className="relative">
                <img src={currentUser.avatar} alt={currentUser.name} className="w-8 h-8 rounded-full object-cover border border-slate-200" />
                {currentUser.isAvailableNow && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-white rounded-full animate-pulse" title="Available Now"></span>
                )}
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-emerald-950 transition-transform ${isUserDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {isUserDropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 p-2 z-[100] text-[13px]" onClick={(e) => e.stopPropagation()}>
                <div className="px-3 py-2 border-b border-slate-100 mb-1 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-fiverr-dark block">{currentUser.name}</span>
                    <span className="text-[10px] text-slate-400 uppercase">{currentUser.role}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold uppercase ${currentUser.isAvailableNow ? 'text-emerald-700' : 'text-fiverr-muted'}`}>
                      {currentUser.isAvailableNow ? 'Available' : 'Unavailable'}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); toggleAvailableNow(); }}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        currentUser.isAvailableNow ? 'bg-emerald-500' : 'bg-slate-300'
                      }`}
                      role="switch"
                      aria-checked={currentUser.isAvailableNow}
                      title="Toggle availability status"
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                          currentUser.isAvailableNow ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                <button 
                  onClick={(e) => { setIsUserDropdownOpen(false); navigate('/create-gig', e); }} 
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 text-fiverr-dark font-semibold flex items-center gap-2.5 transition cursor-pointer"
                >
                  <PlusCircle className="w-4 h-4 text-emerald-600" />
                  <span>Post Gig</span>
                </button>



                <button 
                  onClick={(e) => { setIsUserDropdownOpen(false); navigate('/orders', e); }} 
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 text-fiverr-dark font-semibold flex items-center gap-2.5 transition cursor-pointer"
                >
                  <LayoutDashboard className="w-4 h-4 text-emerald-600" />
                  <span>Dashboard</span>
                </button>

                <div className="w-full px-3 py-1.5 rounded-xl hover:bg-slate-50 text-fiverr-dark font-semibold flex items-center justify-between transition group">
                  <button 
                    onClick={(e) => { 
                      setIsUserDropdownOpen(false); 
                      const pUrl = `/${slugify(currentUser.name)}`;
                      navigate(pUrl, e); 
                    }} 
                    className="flex items-center gap-2.5 flex-1 text-left cursor-pointer py-0.5"
                  >
                    <User className="w-4 h-4 text-emerald-600" />
                    <span>Profile</span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsUserDropdownOpen(false);
                      navigate('/edit-profile', e);
                    }}
                    className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 hover:border-emerald-400 text-[11px] font-bold rounded-md flex items-center gap-1 cursor-pointer transition shadow-2xs"
                    title="Edit Profile"
                  >
                    <Pencil className="w-3 h-3 text-emerald-600" />
                    <span>Edit</span>
                  </button>
                </div>

                <button 
                  onClick={(e) => { setIsUserDropdownOpen(false); navigate('/projects', e); }} 
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 text-fiverr-dark font-semibold flex items-center gap-2.5 transition cursor-pointer"
                >
                  <Briefcase className="w-4 h-4 text-indigo-600" />
                  <span>Buyer Activity</span>
                </button>

                <button 
                  onClick={(e) => { setIsUserDropdownOpen(false); navigate('/freelance-activity', e); }} 
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 text-fiverr-dark font-semibold flex items-center gap-2.5 transition cursor-pointer"
                >
                  <Briefcase className="w-4 h-4 text-emerald-600" />
                  <span>Freelancer Activity</span>
                </button>


                <button 
                  onClick={(e) => { setIsUserDropdownOpen(false); navigate('/payments', e); }} 
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 text-fiverr-dark font-semibold flex items-center gap-2.5 transition cursor-pointer"
                >
                  <Wallet className="w-4 h-4 text-emerald-600" />
                  <span>Payments</span>
                </button>

                <button 
                  onClick={(e) => { 
                    setIsUserDropdownOpen(false); 
                    navigate('/settings', e);
                  }} 
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 text-fiverr-dark font-semibold flex items-center gap-2.5 transition cursor-pointer"
                >
                  <Settings className="w-4 h-4 text-emerald-600" />
                  <span>Settings</span>
                </button>

                <button 
                  onClick={(e) => { setIsUserDropdownOpen(false); navigate('/support', e); }} 
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 text-fiverr-dark font-semibold flex items-center gap-2.5 transition cursor-pointer"
                >
                  <HelpCircle className="w-4 h-4 text-amber-600" />
                  <span>Customer Support</span>
                </button>

                <button 
                  onClick={() => { 
                    setIsUserDropdownOpen(false); 
                    alert('How WorkPerHour Works:\n\n1. Browse Gigs or Post a Project Request.\n2. Hire top experts and fund milestone payments safely into the 14-day Escrow Vault.\n3. Collaborate in real-time via project Workstreams.\n4. Approve completed work to release escrow funds.'); 
                  }} 
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-50 text-fiverr-dark font-semibold flex items-center gap-2.5 transition cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-purple-600" />
                  <span>How it works</span>
                </button>

                <div className="my-1 border-t border-slate-100"></div>

                <button 
                  onClick={() => {
                    setIsUserDropdownOpen(false);
                    setImpersonatedUser(null);
                    updateCurrentUser(null);
                    clearAuthToken();
                    localStorage.removeItem('user');
                    localStorage.removeItem('current_user');
                    setPath('/gigs');
                    window.history.pushState({}, '', '/gigs');
                  }} 
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-red-50 text-red-600 font-semibold flex items-center gap-2.5 transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-red-500" />
                  <span>Log Out</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
