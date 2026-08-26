import { z } from 'zod';

/** Note entry appended to a lead's timeline. */
export const noteSchema = z.object({
  type: z.enum(['note', 'status_change']),
  content: z.string().min(1).max(500),
  author: z.string().min(1),
  timestamp: z.coerce.date().default(() => new Date()),
});

export type Note = z.infer<typeof noteSchema>;

/** Enum values for the lead source field. */
export const LeadSource = [
  'Website',
  'Referral',
  'Ad Campaign',
  'LinkedIn',
  'Other',
] as const;

/** Enum values for the lead status field. */
export const LeadStatus = ['new', 'contacted', 'converted'] as const;

/**
 * Zod schema for creating or validating a lead.
 * Used for both client-side form validation and server-side request parsing.
 * fax is a honeypot field — always empty for real users, never stored.
 */
export const leadSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  message: z.string().optional(),
  source: z.enum(LeadSource),
  status: z.enum(LeadStatus).default('new'),
  notes: z.array(noteSchema).default([]),
  fax: z.string().max(0).optional(),
});

export type Lead = z.infer<typeof leadSchema>;
