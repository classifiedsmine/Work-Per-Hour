import { SEED_USERS, SEED_GIGS, SEED_PROJECTS, SEED_ORDERS, SEED_REVIEWS, SEED_MESSAGES } from '../data/completeSeedDataset';

export const Users: any[] = SEED_USERS;
export const Gigs: any[] = SEED_GIGS;
export const Projects: any[] = SEED_PROJECTS;
export const Orders: any[] = SEED_ORDERS;
export const Workstreams: any[] = SEED_ORDERS;

export function getHydratedWorkstreams(userId: string) {
  return SEED_ORDERS.map(ord => {
    const seller = SEED_USERS.find(u => u.id === ord.sellerId);
    const buyer = SEED_USERS.find(u => u.id === ord.buyerId);
    const gig = SEED_GIGS.find(g => g.id === ord.gigId);
    return {
      ...ord,
      seller,
      buyer,
      gig
    };
  });
}
