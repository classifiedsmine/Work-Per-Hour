import { useMemo } from 'react';
import { WorkstreamItem, WorkstreamFilter } from '../../components/workstream/types';

export interface UseWorkstreamFiltersProps {
  hydratedWorkstreamItems?: WorkstreamItem[];
  workstreamTab?: WorkstreamFilter;
  starredWorkstreams?: string[];
  selectedPersonFilter?: string | null;
  projectFilterSearch?: string;
  workstreamSearch?: string;
}

/**
 * Hook responsible for filtering hydrated workstream items based on the active
 * tab, starred status, person filter, project filter search, and keyword search.
 */
export function useWorkstreamFilters({
  hydratedWorkstreamItems = [],
  workstreamTab = 'all',
  starredWorkstreams = [],
  selectedPersonFilter = null,
  projectFilterSearch = '',
  workstreamSearch = ''
}: UseWorkstreamFiltersProps = {}) {
  const filteredWorkstreamItems: WorkstreamItem[] = useMemo(() => {
    return hydratedWorkstreamItems.filter(w => {
      // Tab filter
      // 16: Discussion should be distinct from general inbox/in_progress. 
      // Assuming 'discussion' means specifically active, in-progress work.
      if (workstreamTab === 'inbox' && !['funded_in_escrow', 'in_progress', 'delivered', 'revision'].includes(w.status)) return false;
      if (workstreamTab === 'in_progress' && !['in_progress', 'funded_in_escrow', 'revision'].includes(w.status)) return false;
      if (workstreamTab === 'delivered' && w.status !== 'delivered') return false;
      if (workstreamTab === 'completed' && w.status !== 'completed') return false;
      if (workstreamTab === 'starred' && !starredWorkstreams.includes(w.id)) return false;
      if (workstreamTab === 'escrow' && (w.amount <= 0 || w.status === 'cancelled' || w.status === 'completed')) return false;
      // 17: Cancelled is one form of archive, but let's allow 'disputed' or other terminal/inactive states as well.
      if (workstreamTab === 'archived' && !['cancelled', 'disputed'].includes(w.status)) return false;

      // Person filter
      if (selectedPersonFilter && w.sellerId !== selectedPersonFilter && w.buyerId !== selectedPersonFilter) return false;

      // Project filter
      if (projectFilterSearch && !w.title.toLowerCase().includes(projectFilterSearch.toLowerCase())) return false;

      // 18: Search query - Expand search to include metadata, buyer/seller name, and potential message preview content
      if (workstreamSearch) {
        const q = workstreamSearch.toLowerCase();
        const matchesTitle = w.title.toLowerCase().includes(q);
        const matchesId = w.id.toLowerCase().includes(q);
        const matchesSeller = w.seller?.name.toLowerCase().includes(q);
        const matchesBuyer = w.buyer?.name.toLowerCase().includes(q);
        const matchesMetadata = (w.requirements || '').toLowerCase().includes(q);
        // Assuming messages/attachments aren't directly in WorkstreamItem, 
        // we'd need to extend WorkstreamItem or pass extra data. 
        // For now, expand to fields present in the object.
        if (!matchesTitle && !matchesId && !matchesSeller && !matchesBuyer && !matchesMetadata) return false;
      }

      return true;
    });
  }, [hydratedWorkstreamItems, workstreamTab, starredWorkstreams, selectedPersonFilter, projectFilterSearch, workstreamSearch]);

  return {
    filteredWorkstreamItems
  };
}
