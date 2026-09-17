import { useQuery } from '@tanstack/react-query';
import api from '../lib/api.js';
import type { LeadDoc } from './useLeads.js';

/**
 * Fetches a single lead by ID from GET /api/leads/:id.
 * Only executes when id is non-null.
 * @param id - MongoDB ObjectId string, or null to disable.
 */
export function useLead(id: string | null) {
  return useQuery<LeadDoc>({
    queryKey: ['lead', id],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: LeadDoc }>(
        `/api/leads/${id}`,
      );
      return res.data.data;
    },
    enabled: id !== null,
  });
}
