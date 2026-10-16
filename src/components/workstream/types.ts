import { Order, UserAccount, Gig, Project } from '../../types';

export type WorkstreamFilter = 
  | 'all' 
  | 'inbox' 
  | 'discussion' 
  | 'in_progress' 
  | 'delivered'
  | 'completed' 
  | 'starred' 
  | 'escrow' 
  | 'archived';

export type WorkstreamSubTab = 'activity' | 'files' | 'milestones' | 'invoices';

export interface WorkstreamMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  text: string;
  timestamp: string;
  type?: 'message' | 'system' | 'file' | 'proposal' | 'deliverable' | 'milestone';
  fileInfo?: {
    name: string;
    size: string;
    url: string;
    type?: string;
  };
  metadata?: {
    amount?: number;
    milestoneTitle?: string;
    action?: string;
    offerId?: string;
    offerKind?: string;
    clientMessageId?: string;
  };
  status?: 'sending' | 'sent' | 'failed';
}

export type WorkstreamOfferKind = 'proposal' | 'invoice' | 'deposit';
export type WorkstreamOfferStatus = 'pending' | 'accepted' | 'paid' | 'declined' | 'cancelled';

/** A real proposal / invoice / deposit request stored on the server. */
export interface WorkstreamOffer {
  id: string;
  number: string;
  orderId: string;
  kind: WorkstreamOfferKind;
  title: string;
  amount: number;
  deliveryDays?: number;
  note?: string;
  status: WorkstreamOfferStatus;
  createdBy: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  fundedOrderId?: string;
  /** What the buyer is charged in total (amount + client fees), from the server's fee quote. */
  clientTotal?: number;
  currencySymbol?: string;
}

export interface WorkstreamItem extends Order {
  seller?: UserAccount;
  buyer?: UserAccount;
  gig?: Gig;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
}

export interface SharedFileItem {
  id: string;
  name: string;
  size: string;
  url: string;
  uploadedAt: string;
  uploadedBy: string;
  uploaderAvatar?: string;
  type?: string;
}
