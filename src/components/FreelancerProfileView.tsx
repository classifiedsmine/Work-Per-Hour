import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, CheckCircle2, Star, MapPin, Clock, MessageSquare, 
  Briefcase, Check, ExternalLink, ChevronRight, Award, User, 
  Sparkles, Globe, Filter, Eye, Tag, Pencil, Settings
} from 'lucide-react';
import { UserAccount, Gig, Review } from '../types';
import { Reviews } from './gig_reviews';

interface FreelancerProfileViewProps {
  profileUser: UserAccount;
  currentUser: UserAccount | null;
  gigs: Gig[];
  reviews?: Review[];
  onNavigate: (to: string, e?: React.MouseEvent) => void;
  onFeatureGig?: (gigId: string) => void;
  onContact?: () => void;
  onEditProfile?: () => void;
}

export const FreelancerProfileView: React.FC<FreelancerProfileViewProps> = ({
  profileUser,
  currentUser,
  gigs,
  reviews = [],
  onNavigate,
  onFeatureGig,
  onContact,
  onEditProfile
}) => {
  // Main Tab State: 'offers' | 'portfolio'
  const [mainTab, setMainTab] = useState<'offers' | 'portfolio'>('offers');
  
  // Secondary Sub-filter Tab State: 'reviews' | 'purchases' | 'endorsements'
  const [subTab, setSubTab] = useState<'reviews' | 'purchases' | 'endorsements'>('reviews');
  
  // Insights Tab State: 'freelancer' | 'buyer'
  const [insightMode, setInsightMode] = useState<'freelancer' | 'buyer'>('freelancer');

  // Read More Bio Toggle
  const [isBioExpanded, setIsBioExpanded] = useState<boolean>(false);

  // Hide Feedback Toggle
  const [hideFeedback, setHideFeedback] = useState<boolean>(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState<number>(1);

  const mappedReviews = useMemo(() => {
    return reviews
      .filter(r => r.targetUserId === profileUser.id)
      .map(r => ({
        id: r.id,
        orderId: r.orderId,
        reviewerName: r.reviewerName ?? r.buyerName ?? 'Anonymous',
        reviewerAvatar: r.reviewerAvatar ?? r.avatar ?? '',
        targetUserId: r.targetUserId ?? profileUser.id,
        rating: r.rating ?? 0,
        comment: r.comment ?? r.review ?? '',
        orderTitle: r.orderTitle ?? r.gigTitle ?? '',
        createdAt: r.createdAt ?? r.timeAgo ?? ''
      }));
  }, [reviews, profileUser.id]);

  // Filter Gigs for this Freelancer (or fallback to high-quality SEO/Development sample offers matching the screenshot)
  const userGigs = gigs.filter(g => 
    g.freelancerId === profileUser.id || 
    (g.freelancerName && profileUser.name && g.freelancerName.toLowerCase() === profileUser.name.toLowerCase())
  );

  const offersToDisplay = userGigs;

  const userSkills = profileUser.skills && profileUser.skills.length > 0 
    ? profileUser.skills 
    : ['guest posts', 'link building', 'seo marketing', 'guest blogging', 'digital marketing', 'seo audit', 'backlinks', 'content writing'];

  return (
    <div className="min-h-screen bg-[#f4f5f7] font-sans text-slate-800 pb-16">
      {/* Dark Top Banner Cover */}
      <div className="w-full bg-[#1b2129] border-b border-slate-800 py-6 px-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <a href="/gigs" onClick={(e) => onNavigate('/gigs', e)} className="text-slate-400 hover:text-white transition">Home</a>
            <span className="text-slate-600">/</span>
            <a href="/gigs" onClick={(e) => onNavigate('/gigs', e)} className="text-slate-400 hover:text-white transition">Marketing & SEO</a>
            <span className="text-slate-600">/</span>
            <span className="text-emerald-400 font-semibold">{profileUser.name}</span>
          </div>
          <div className="flex items-center gap-3">
            {onEditProfile && (
              <button
                onClick={onEditProfile}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition flex items-center gap-1.5 shadow-sm cursor-pointer border border-emerald-500"
              >
                <Pencil size={13} />
                <span>Edit Profile</span>
              </button>
            )}
            <span className="text-[11px] text-slate-400">Search Engine Friendly URL Profile</span>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-6xl mx-auto px-4 mt-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* ======================================================== */}
          {/* LEFT SIDEBAR (Freelancer Credentials & Integrations) */}
          {/* ======================================================== */}
          <div className="lg:col-span-4 space-y-4">
            
            {/* Main Profile Info Card */}
            <div className="bg-white border border-slate-200/90 rounded-xl p-5 shadow-xs space-y-4 text-xs text-slate-700 relative">
              
              {/* Top Right Edit Button on Profile Card */}
              {onEditProfile && (
                <button
                  onClick={onEditProfile}
                  className="absolute top-4 right-4 px-2.5 py-1 bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-200 hover:border-emerald-500 font-bold text-[11px] rounded-lg shadow-2xs transition flex items-center gap-1 cursor-pointer"
                  title="Edit Profile Details"
                >
                  <Pencil size={12} className="text-emerald-600" />
                  <span>Edit</span>
                </button>
              )}

              {/* Avatar & CERT Status Badge */}
              <div className="text-center relative pt-1">
                <div className="relative inline-block">
                  <img 
                    src={profileUser.avatar} 
                    alt={profileUser.name} 
                    className="w-24 h-24 rounded-full object-cover border-2 border-white shadow-sm ring-2 ring-slate-200 mx-auto"
                  />
                  <span className="absolute bottom-0 right-0 px-1.5 py-0.5 bg-emerald-600 text-white font-black text-[9px] rounded-full uppercase tracking-wider border border-white shadow-xs" title="CERT 5 Top Rated Level">
                    CERT 5
                  </span>
                </div>

                <div className="flex items-center justify-center gap-2 mt-2.5">
                  <h1 className="text-xl font-bold text-fiverr-dark">{profileUser.name}</h1>
                  {onEditProfile && (
                    <button
                      onClick={onEditProfile}
                      className="px-2.5 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-300 font-bold text-[11px] rounded-md transition flex items-center gap-1 cursor-pointer"
                      title="Edit Profile"
                    >
                      <Pencil size={11} className="text-emerald-600" />
                      <span>Edit profile</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-600 font-medium leading-tight mt-1 px-2">
                  {profileUser.title || 'SEO Expert and Experienced Guest Post Writer on Authority Sites.'}
                </p>

                <div className="flex items-center justify-center gap-1 text-[11px] text-slate-500 mt-1.5">
                  <MapPin size={12} className="text-slate-400" />
                  <span>Mumbai, India</span>
                  <span className="mx-0.5">·</span>
                  <span className="text-emerald-600 font-semibold">Local time: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>

              {/* Bio & Read More */}
              <div className="pt-3 border-t border-slate-100">
                <p className={`text-fiverr-dark leading-body text-base ${!isBioExpanded ? 'line-clamp-3' : ''}`}>
                  {profileUser.bio || "That's why we are here to get you to the first page and give you a boost! I am a full-time SEO professional and guest blogger with access to high authority news media outlets and blogs."}
                </p>
                <button 
                  onClick={() => setIsBioExpanded(!isBioExpanded)}
                  className="text-emerald-700 font-bold text-[11px] hover:underline mt-1 cursor-pointer"
                >
                  {isBioExpanded ? 'Read Less ▲' : 'Read More ▼'}
                </button>
              </div>

              {/* Star Rating & Hourly Rate Row */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <div className="flex items-center gap-1">
                  <Star size={14} className="fill-amber-400 text-amber-400" />
                  <span className="font-extrabold text-slate-900">4.9</span>
                  <span className="text-slate-500">(142)</span>
                </div>
                <div className="text-right">
                  <span className="font-bold text-fiverr-dark text-xl">${profileUser.hourlyRate || 25}</span>
                  <span className="text-fiverr-muted text-xs"> / hr</span>
                </div>
              </div>

              {/* Contact Actions */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <button 
                  onClick={(e) => onContact ? onContact() : onNavigate('/messages', e)}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition shadow-xs flex items-center justify-center gap-2 cursor-pointer uppercase tracking-wider"
                >
                  <Briefcase size={14} />
                  <span>Contact Me / Hire</span>
                </button>
                <button 
                  onClick={(e) => onContact ? onContact() : onNavigate('/messages', e)}
                  className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <MessageSquare size={13} className="text-slate-500" />
                  <span>Message via Workstream</span>
                </button>
              </div>
            </div>

            {/* Skills Tag Section */}
            <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs space-y-2 text-xs">
              <h3 className="font-bold text-fiverr-dark uppercase tracking-wider text-xs flex items-center gap-1.5">
                <Tag size={12} className="text-fiverr-muted" />
                <span>Skills</span>
              </h3>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {userSkills.map((skill, idx) => (
                  <span 
                    key={idx} 
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-medium transition cursor-pointer border border-slate-200/60"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>

            {/* Insights Card */}
            <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="font-bold text-fiverr-dark uppercase tracking-wider text-xs">Insights</h3>
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded text-[10px] font-bold">
                  <button 
                    onClick={() => setInsightMode('freelancer')}
                    className={`px-2 py-0.5 rounded transition ${insightMode === 'freelancer' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
                  >
                    Freelancer
                  </button>
                  <button 
                    onClick={() => setInsightMode('buyer')}
                    className={`px-2 py-0.5 rounded transition ${insightMode === 'buyer' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500'}`}
                  >
                    Buyer
                  </button>
                </div>
              </div>

              <div className="space-y-2 text-[11px] text-slate-600">
                <div className="flex justify-between items-center py-1 border-b border-slate-50">
                  <span>Projects worked on</span>
                  <span className="font-bold text-slate-900">1717</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-50">
                  <span>Buyers worked with</span>
                  <span className="font-bold text-slate-900">955</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-50">
                  <span>Last active</span>
                  <span className="font-semibold text-slate-700">Oct 11 2026</span>
                </div>
                <div className="flex justify-between items-center py-1">
                  <span>Response time</span>
                  <span className="font-semibold text-emerald-700">within a few days</span>
                </div>
              </div>
            </div>

            {/* Your Account Box / Verification Checklist */}
            <div className="bg-white border border-slate-200/90 rounded-xl p-4 shadow-xs space-y-3 text-xs">
              <h3 className="font-bold text-fiverr-dark uppercase tracking-wider text-xs border-b border-slate-100 pb-2">
                Your Account
              </h3>
              <div className="space-y-2 text-[11px] text-slate-600">
                <div className="flex justify-between items-center">
                  <span>Account type</span>
                  <span className="font-bold text-slate-800 uppercase text-[10px]">Freelancer</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Amount spent</span>
                  <span className="font-semibold text-slate-700">$0.00</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Earned</span>
                  <span className="font-extrabold text-slate-900">${profileUser.earned ? profileUser.earned.toLocaleString() : '48,500'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span>Member since</span>
                  <span className="font-semibold text-slate-700">{profileUser.createdAt || 'Jan 2023'}</span>
                </div>

                <div className="pt-2 border-t border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span>Facebook</span>
                    <span className="text-emerald-600 font-bold flex items-center gap-1"><Check size={12} /> Connected</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>LinkedIn</span>
                    <span className="text-emerald-600 font-bold flex items-center gap-1"><Check size={12} /> Connected</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Google</span>
                    <span className="text-emerald-600 font-bold flex items-center gap-1"><Check size={12} /> Connected</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Mobile</span>
                    <span className="text-emerald-600 font-bold flex items-center gap-1"><Check size={12} /> Verified</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Email</span>
                    <span className="text-emerald-600 font-bold flex items-center gap-1"><Check size={12} /> Verified</span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* ======================================================== */}
          {/* RIGHT MAIN CONTENT AREA (Offers, Upgrade Banner, Reviews) */}
          {/* ======================================================== */}
          <div className="lg:col-span-8 space-y-5">
            
            {/* Orange Promotional Upgrade Banner */}
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
              <div className="space-y-1 text-xs">
                <h2 className="font-bold text-emerald-700 uppercase tracking-wide text-sm">
                  UNLOCK MORE OPPORTUNITIES.
                </h2>
                <p className="text-fiverr-dark text-sm leading-body">
                  Select a subscription monthly plan for proposal credits, and get access to premier job platforms.
                </p>
              </div>
              <button 
                onClick={() => alert('Subscription Upgrade Dialog Opened. Select your proposal credits package.')}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs rounded uppercase tracking-wider shrink-0 transition cursor-pointer shadow-xs"
              >
                SUBMIT PROPOSAL
              </button>
            </div>

            {/* Primary Main Content Tabs */}
            <div className="bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden">
              <div className="flex items-center border-b border-slate-200 bg-slate-50/80 px-4 pt-2 text-xs font-bold text-slate-600">
                <button 
                  onClick={() => setMainTab('portfolio')}
                  className={`px-4 py-2.5 transition-colors cursor-pointer border-b-2 ${mainTab === 'portfolio' ? 'border-slate-900 text-slate-900 bg-white font-extrabold' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
                >
                  Portfolio (0)
                </button>
                <button 
                  onClick={() => setMainTab('offers')}
                  className={`px-4 py-2.5 transition-colors cursor-pointer border-b-2 ${mainTab === 'offers' ? 'border-slate-900 text-slate-900 bg-white font-extrabold' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
                >
                  OFFERS ({offersToDisplay.length})
                </button>
              </div>

              {mainTab === 'offers' ? (
                <div className="p-5 space-y-5">
                  
                  {/* Create an offer promo box */}
                  <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 space-y-2 text-xs">
                    <h3 className="font-bold text-slate-900 text-xs">Create an offer</h3>
                    <p className="text-slate-600 text-[11px] leading-relaxed">
                      Don't be defined by a title or category - express your own skills with self-contained offers. Tell your customers what you can offer and start building lasting relationships with clients.
                    </p>
                    <button 
                      onClick={(e) => onNavigate('/create-gig', e)}
                      className="px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-bold text-[11px] rounded transition cursor-pointer"
                    >
                      POST AN OFFER
                    </button>
                  </div>

                  {/* Secondary Sub-Filter Tabs Bar */}
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2 text-xs font-bold">
                    <div className="flex items-center gap-4 text-slate-600">
                      <button 
                        onClick={() => setSubTab('reviews')}
                        className={`pb-1 transition ${subTab === 'reviews' ? 'text-emerald-700 border-b-2 border-emerald-600' : 'hover:text-slate-900'}`}
                      >
                        Reviews (142)
                      </button>
                      <button 
                        onClick={() => setSubTab('purchases')}
                        className={`pb-1 transition ${subTab === 'purchases' ? 'text-emerald-700 border-b-2 border-emerald-600' : 'hover:text-slate-900'}`}
                      >
                        Purchases
                      </button>
                      <button 
                        onClick={() => setSubTab('endorsements')}
                        className={`pb-1 transition ${subTab === 'endorsements' ? 'text-emerald-700 border-b-2 border-emerald-600' : 'hover:text-slate-900'}`}
                      >
                        Endorsements
                      </button>
                    </div>

                    <button 
                      onClick={() => setHideFeedback(!hideFeedback)}
                      className="text-[11px] text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      {hideFeedback ? 'Show Feedback' : 'Hide Feedback'}
                    </button>
                  </div>

                  {/* Vertical List of Offers / Gigs */}
                  <div className="space-y-3">
                    {offersToDisplay.map((offer) => (
                      <div 
                        key={offer.id} 
                        className="bg-white border border-slate-200/90 rounded-xl p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:shadow-sm transition"
                      >
                        <div className="flex items-center gap-3.5 flex-1">
                          <img 
                            src={offer.image} 
                            alt={offer.title} 
                            className="w-24 h-16 rounded-lg object-cover border border-slate-200 shrink-0" 
                          />
                          <div className="space-y-1">
                            <a 
                              href={`/gigs/${offer.id}`} 
                              onClick={(e) => onNavigate(`/gigs/${offer.id}`, e)}
                              className="font-semibold text-fiverr-dark hover:text-emerald-600 transition text-gig-title line-clamp-2 cursor-pointer leading-gig"
                            >
                              {offer.title}
                            </a>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                              <span className="text-fiverr-muted font-normal">{offer.category}</span>
                              <span>·</span>
                              <span className="text-emerald-700 font-bold">100% SUCCESS RATE</span>
                              <span>·</span>
                              <span className="text-fiverr-muted">Delivered in {offer.deliveryDays} days</span>
                              <span>·</span>
                              <span className="text-amber-600 font-bold flex items-center gap-0.5">
                                ★ {offer.rating} ({offer.reviewsCount})
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                          <div className="text-right">
                            <span className="text-xl font-bold text-fiverr-dark">${offer.price}</span>
                          </div>
                          <button 
                            onClick={(e) => onNavigate(`/gigs/${offer.id}`, e)}
                            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded transition cursor-pointer"
                          >
                            VIEW OFFER
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Reviews List Section (Visible if feedback not hidden) */}
                  {!hideFeedback && subTab === 'reviews' && (
                    <div className="pt-6 border-t border-slate-200 space-y-4">
                      <Reviews allReviews={mappedReviews} targetUser={profileUser} currentUser={currentUser} />
                    </div>
                  )}

                  {/* Bottom Pagination Control */}
                  <div className="flex items-center justify-center gap-1 pt-4 text-xs font-bold text-slate-600">
                    <button 
                      onClick={() => setCurrentPage(1)} 
                      className={`w-7 h-7 rounded border border-slate-200 flex items-center justify-center transition cursor-pointer ${currentPage === 1 ? 'bg-slate-900 text-white border-slate-900' : 'bg-white hover:bg-slate-100'}`}
                    >
                      1
                    </button>
                    <button 
                      onClick={() => setCurrentPage(2)} 
                      className={`w-7 h-7 rounded border border-slate-200 flex items-center justify-center transition cursor-pointer ${currentPage === 2 ? 'bg-slate-900 text-white border-slate-900' : 'bg-white hover:bg-slate-100'}`}
                    >
                      2
                    </button>
                    <button 
                      onClick={() => setCurrentPage(3)} 
                      className={`w-7 h-7 rounded border border-slate-200 flex items-center justify-center transition cursor-pointer ${currentPage === 3 ? 'bg-slate-900 text-white border-slate-900' : 'bg-white hover:bg-slate-100'}`}
                    >
                      3
                    </button>
                    <button onClick={() => setCurrentPage(4)} className="w-7 h-7 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center transition cursor-pointer">4</button>
                    <button onClick={() => setCurrentPage(5)} className="w-7 h-7 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center transition cursor-pointer">5</button>
                    <button onClick={() => setCurrentPage(6)} className="w-7 h-7 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center transition cursor-pointer">6</button>
                    <button onClick={() => setCurrentPage(7)} className="w-7 h-7 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center transition cursor-pointer">7</button>
                    <span className="px-1 text-slate-400">...</span>
                    <button onClick={() => setCurrentPage(22)} className="w-7 h-7 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center transition cursor-pointer">22</button>
                    <button onClick={() => setCurrentPage(prev => Math.min(22, prev + 1))} className="w-7 h-7 rounded border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center transition cursor-pointer">›</button>
                  </div>

                </div>
              ) : (
                <div className="p-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto text-lg font-bold">
                    0
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm">No Portfolio Items Uploaded Yet</h3>
                  <p className="text-slate-500 text-xs max-w-sm mx-auto">
                    Showcase past work samples and case studies to gain higher client trust and win more proposals.
                  </p>
                </div>
              )}
            </div>

          </div>

        </div>
      </div>
    </div>
  );
};
