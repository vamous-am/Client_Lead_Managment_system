import { Router, type Request, type Response } from 'express';
import { leadSchema, LeadStatus } from '@crm/shared';
import { Lead } from '../models/Lead.js';
import { requireAuth } from '../middleware/auth.js';
import { formatZodError } from '../lib/validation.js';

const router = Router();

const SORT_ALLOWLIST = ['name', 'email', 'status', 'source', 'createdAt'] as const;
type SortField = (typeof SORT_ALLOWLIST)[number];

/** Resolves the authenticated username from the request. */
function getUsername(req: Request): string {
  return (req as Request & { user: { username: string } }).user.username;
}

/**
 * GET /api/leads/stats
 * Returns global lead counts by status, independent of any filters.
 * Requires authentication.
 */
router.get('/stats', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  const [total, newCount, contacted, converted] = await Promise.all([
    Lead.countDocuments(),
    Lead.countDocuments({ status: 'new' }),
    Lead.countDocuments({ status: 'contacted' }),
    Lead.countDocuments({ status: 'converted' }),
  ]);

  res.json({
    success: true,
    data: { total, new: newCount, contacted, converted },
  });
});

/**
 * GET /api/leads
 * Returns a paginated, filterable, searchable, sortable list of leads.
 * Query params: status, source, search, page, limit, sortBy, sortOrder.
 * Requires authentication.
 */
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  const rawSortBy = req.query.sortBy as string | undefined;
  const sortBy: SortField = SORT_ALLOWLIST.includes(rawSortBy as SortField)
    ? (rawSortBy as SortField)
    : 'createdAt';
  const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.source) filter.source = req.query.source;
  if (req.query.search) {
    const pattern = new RegExp(String(req.query.search), 'i');
    filter.$or = [{ name: pattern }, { email: pattern }];
  }

  const [leads, total] = await Promise.all([
    Lead.find(filter).sort({ [sortBy]: sortOrder }).skip(skip).limit(limit).lean(),
    Lead.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: {
      leads,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    },
  });
});

/**
 * GET /api/leads/:id
 * Returns a single lead by MongoDB ObjectId.
 * Responds 404 if not found.
 * Requires authentication.
 */
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const lead = await Lead.findById(req.params.id).lean();
  if (!lead) {
    res.status(404).json({ success: false, error: { message: 'Lead not found' } });
    return;
  }
  res.json({ success: true, data: lead });
});

/**
 * PATCH /api/leads/:id/status
 * Updates the lead's status and appends a status_change note authored by 'system'.
 * Body: { status: 'new' | 'contacted' | 'converted' }
 * Requires authentication.
 */
router.patch('/:id/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const statusResult = leadSchema.shape.status.safeParse(req.body.status);
  if (!statusResult.success) {
    res.status(400).json({
      success: false,
      error: {
        message: 'Invalid status value',
        details: formatZodError(statusResult.error),
      },
    });
    return;
  }

  const newStatus = statusResult.data as (typeof LeadStatus)[number];

  const lead = await Lead.findById(req.params.id);
  if (!lead) {
    res.status(404).json({ success: false, error: { message: 'Lead not found' } });
    return;
  }

  const previousStatus = lead.status;
  lead.status = newStatus;
  lead.notes.push({
    type: 'status_change',
    content: `Status changed from '${previousStatus}' to '${newStatus}'.`,
    author: 'system',
    timestamp: new Date(),
  });

  // ponytail: fetch-mutate-save; concurrent writes could lose one update.
  // Acceptable for single-admin scope. Upgrade to $set/$push operators if
  // multi-user access is ever added.
  await lead.save();
  res.json({ success: true, data: lead });
});

/**
 * POST /api/leads/:id/notes
 * Appends a manual note to the lead's timeline.
 * Body: { content: string }
 * type is always forced to 'note' server-side — clients cannot set audit types.
 * author is set from the authenticated user's JWT payload.
 * Requires authentication.
 */
router.post('/:id/notes', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const content = req.body.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    res.status(400).json({
      success: false,
      error: { message: 'content is required and must be a non-empty string' },
    });
    return;
  }
  if (content.trim().length > 500) {
    res.status(400).json({
      success: false,
      error: { message: 'Note content must be 500 characters or fewer' },
    });
    return;
  }

  const lead = await Lead.findById(req.params.id);
  if (!lead) {
    res.status(404).json({ success: false, error: { message: 'Lead not found' } });
    return;
  }

  lead.notes.push({
    type: 'note',
    content: content.trim(),
    author: getUsername(req),
    timestamp: new Date(),
  });

  // ponytail: fetch-mutate-save; same ceiling as PATCH /:id/status.
  await lead.save();
  res.json({ success: true, data: lead });
});

/**
 * POST /api/leads
 * Public lead submission endpoint. Does not require authentication.
 * Checks the fax honeypot field first, then validates against leadSchema.
 * Merges duplicate submissions by email rather than creating duplicate records.
 */
router.post('/', async (req: Request, res: Response): Promise<void> => {
  // Honeypot check — must run before schema validation
  if (req.body.fax && String(req.body.fax).length > 0) {
    res.status(201).json({
      success: true,
      data: { message: 'Lead submitted successfully' },
    });
    return;
  }

  // Validate against leadSchema (fax will be absent or empty — passes max(0))
  const result = leadSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        details: formatZodError(result.error),
      },
    });
    return;
  }

  const { name, email, phone, message, source } = result.data;
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await Lead.findOne({
    email: { $regex: new RegExp(`^${normalizedEmail}$`, 'i') },
  });

  if (existing) {
    // Duplicate merge path
    existing.status = 'new';
    if (existing.source !== source) {
      existing.source = source;
    }

    existing.notes.push({
      type: 'status_change',
      content: "Lead resubmitted via contact form. Status reset to 'new'.",
      author: 'system',
      timestamp: new Date(),
    });

    if (message && message.trim().length > 0) {
      existing.notes.push({
        type: 'note',
        content: `New message from resubmission: ${message.trim()}`,
        author: 'system',
        timestamp: new Date(),
      });
    }

    await existing.save();
    res.status(200).json({ success: true, data: existing });
    return;
  }

  // New lead path
  const lead = await Lead.create({
    name,
    email: normalizedEmail,
    phone,
    message,
    source,
    status: 'new',
    notes: [
      {
        type: 'note',
        content: 'Lead created via contact form.',
        author: 'system',
        timestamp: new Date(),
      },
    ],
  });

  res.status(201).json({ success: true, data: lead });
});

export default router;
