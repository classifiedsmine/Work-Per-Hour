import { useState, useEffect, useCallback } from 'react';
import { UserAccount, Gig, Project, Proposal, Order, Dispute, Refund, Payout, Category, Review, SupportTicket, AuditLog, Message } from '../types';
import * as DatabaseService from '../services/DatabaseService';
import { initialUsers, initialGigs, initialProjects, initialOrders } from '../data/mockData';
import { getAuthToken } from '../utils/authToken';
import { getDeviceId } from '../utils/deviceId';


export const useAppData = () => {
  const [users, setUsers] = useState<UserAccount[]>(initialUsers);
  const [gigs, setGigs] = useState<Gig[]>(initialGigs);
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [userEmails, setUserEmails] = useState<string[]>([]);
  
  const [platformFee, setPlatformFee] = useState<number>(0);
  const [clientServiceFee, setClientServiceFee] = useState<number>(0);
  const [smallOrderFeeThreshold, setSmallOrderFeeThreshold] = useState<number>(0);
  const [smallOrderFeeAmount, setSmallOrderFeeAmount] = useState<number>(0);
  const [escrowProtectionDays, setEscrowProtectionDays] = useState<number>(0);
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUserEmails = async (userId: string) => {
    try {
      const res = await fetch(`/api/user-emails/${userId}`);
      if (res.ok) setUserEmails(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (DatabaseService.Users && DatabaseService.Users.length > 0) setUsers(DatabaseService.Users);
    if (DatabaseService.Gigs && DatabaseService.Gigs.length > 0) setGigs(DatabaseService.Gigs);
    if (DatabaseService.Projects) setProjects(DatabaseService.Projects);
    if (DatabaseService.Orders) setOrders(DatabaseService.Orders);
  }, []);



  const safeJson = async (res: Response, fallback: any = []) => {
    if (!res.ok) return fallback;
    const contentType = res.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) return fallback;
    try {
      return await res.json();
    } catch {
      return fallback;
    }
  };

  const fetchData = useCallback(async (currentUserId?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const token = getAuthToken();
      const authHeaders: Record<string, string> = {
        'x-device-id': getDeviceId(),
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };
      const reqOpt = { headers: authHeaders };

      const responses = await Promise.all([
        fetch('/api/users', reqOpt),
        fetch('/api/gigs', reqOpt),
        fetch('/api/projects', reqOpt),
        fetch('/api/proposals', reqOpt),
        fetch('/api/orders', reqOpt),
        fetch('/api/disputes', reqOpt),
        fetch('/api/refunds', reqOpt),
        fetch('/api/payouts', reqOpt),
        fetch('/api/categories', reqOpt),
        fetch('/api/reviews', reqOpt),
        fetch('/api/support-tickets', reqOpt),
        fetch('/api/audit-logs', reqOpt),
        fetch('/api/admin/settings', reqOpt)
      ]);

      const [uRes, gRes, pRes, prRes, oRes, dRes, rRes, payRes, cRes, revRes, sRes, aRes, setRes] = responses;

      const usersData = uRes.ok ? await safeJson(uRes, []) : [];
      const gigsData = gRes.ok ? await safeJson(gRes, []) : [];
      const projectsData = pRes.ok ? await safeJson(pRes, []) : [];
      const proposalsData = prRes.ok ? await safeJson(prRes, []) : [];
      const ords = oRes.ok ? await safeJson(oRes, []) : [];
      const disputesData = dRes.ok ? await safeJson(dRes, []) : [];
      const refundsData = rRes.ok ? await safeJson(rRes, []) : [];
      const payoutsData = payRes.ok ? await safeJson(payRes, []) : [];
      const categoriesData = cRes.ok ? await safeJson(cRes, []) : [];
      const reviewsData = revRes.ok ? await safeJson(revRes, []) : [];
      const supportTicketsData = sRes.ok ? await safeJson(sRes, []) : [];
      const auditLogsData = aRes.ok ? await safeJson(aRes, []) : [];
      const settingsData = setRes.ok ? await safeJson(setRes, null) : null;

      if (usersData.length > 0) setUsers(usersData);
      else setUsers(DatabaseService.Users);
      
      if (gigsData.length > 0) setGigs(gigsData);
      else setGigs(DatabaseService.Gigs);

      if (projectsData.length > 0) setProjects(projectsData);
      if (proposalsData.length > 0) setProposals(proposalsData);
      if (ords.length > 0) setOrders(ords);
      if (disputesData.length > 0) setDisputes(disputesData);
      if (refundsData.length > 0) setRefunds(refundsData);
      if (payoutsData.length > 0) setPayouts(payoutsData);
      if (categoriesData.length > 0) setCategories(categoriesData);
      if (reviewsData.length > 0) setReviews(reviewsData);
      if (supportTicketsData.length > 0) setSupportTickets(supportTicketsData);
      if (auditLogsData.length > 0) setAuditLogs(auditLogsData);
      
      if (settingsData) {
        if (settingsData.freelancerCommissionRate !== undefined) setPlatformFee(settingsData.freelancerCommissionRate);
        if (settingsData.clientServiceFee !== undefined) setClientServiceFee(settingsData.clientServiceFee);
        if (settingsData.smallOrderFeeThreshold !== undefined) setSmallOrderFeeThreshold(settingsData.smallOrderFeeThreshold);
        if (settingsData.smallOrderFeeAmount !== undefined) setSmallOrderFeeAmount(settingsData.smallOrderFeeAmount);
        if (settingsData.escrowHoldDays !== undefined) setEscrowProtectionDays(settingsData.escrowHoldDays);
      }
    } catch (e) {
      setError('Failed to fetch data');
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    users, setUsers,
    gigs, setGigs,
    projects, setProjects,
    proposals, setProposals,
    orders, setOrders,
    reviews, setReviews,
    messages, setMessages,
    disputes, setDisputes,
    refunds, setRefunds,
    payouts, setPayouts,
    categories, setCategories,
    supportTickets, setSupportTickets,
    auditLogs, setAuditLogs,
    userEmails, setUserEmails, fetchUserEmails,
    platformFee, setPlatformFee,
    clientServiceFee, setClientServiceFee,
    smallOrderFeeThreshold, setSmallOrderFeeThreshold,
    smallOrderFeeAmount, setSmallOrderFeeAmount,
    escrowProtectionDays, setEscrowProtectionDays,
    isLoading,
    error,
    refresh: fetchData
  };
};
