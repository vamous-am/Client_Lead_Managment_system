import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format, differenceInHours } from 'date-fns';
import { Sheet, SheetContent, SheetTitle, SheetClose } from './ui/sheet.js';
import { Badge } from './ui/badge.js';
import { Button } from './ui/button.js';
import { Skeleton } from './ui/skeleton.js';
import { useLead } from '../hooks/useLead.js';
import { LeadStatus } from '@crm/shared';
import api from '../lib/api.js';
import type { LeadDoc } from '../hooks/useLeads.js';

interface LeadDrawerProps {
  leadId: string | null;
  open: boolean;
  onClose: () => void;
  /** Ref to return focus to when the drawer closes. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
}

const NOTE_MAX = 500;

/**
 * Formats a note timestamp: relative for notes under 24 hours old,
 * absolute for older notes.
 */
function formatNoteTime(iso: string): string {
  const date = new Date(iso);
  if (differenceInHours(new Date(), date) < 24) {
    return formatDistanceToNow(date, { addSuffix: true });
  }
  return format(date, 'MMM d, yyyy h:mm a');
}

/**
 * Lead detail side drawer.
 * Displays lead metadata, a status update control, a manual note form,
 * and a unified timeline of all notes sorted newest-first.
 */
export function LeadDrawer({
  leadId,
  open,
  onClose,
  returnFocusRef,
}: LeadDrawerProps) {
  const queryClient = useQueryClient();
  const [noteContent, setNoteContent] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const { data: lead, isLoading, isError, refetch } = useLead(leadId);

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/api/leads/${leadId}/status`, { status }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      void queryClient.invalidateQueries({ queryKey: ['leads'] });
      void queryClient.invalidateQueries({ queryKey: ['leads-stats'] });
    },
  });

  const noteMutation = useMutation({
    mutationFn: (content: string) =>
      api.post(`/api/leads/${leadId}/notes`, { content }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lead', leadId] });
      setNoteContent('');
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onClose();
      // Return focus to the element that opened the drawer
      requestAnimationFrame(() => {
        returnFocusRef.current?.focus();
      });
    }
  };

  const sortedNotes = [...(lead?.notes ?? [])].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const noteIsValid =
    noteContent.trim().length > 0 && noteContent.length <= NOTE_MAX;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent key={leadId ?? 'empty'}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <SheetTitle>
            {isLoading ? (
              <Skeleton className="h-5 w-40" />
            ) : (
              (lead?.name ?? 'Lead detail')
            )}
          </SheetTitle>
          <SheetClose>
            <Button
              ref={closeButtonRef}
              variant="ghost"
              size="sm"
              aria-label="Close drawer"
            >
              ✕
            </Button>
          </SheetClose>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex-1 p-6 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex-1 p-6 flex flex-col items-center justify-center gap-3">
            <p className="text-sm text-red-500">Failed to load lead.</p>
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : lead ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Lead metadata */}
            <div className="px-6 py-4 space-y-1 border-b shrink-0">
              <p className="text-sm text-muted-foreground">{lead.email}</p>
              {lead.phone && (
                <p className="text-sm text-muted-foreground">{lead.phone}</p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">{lead.source}</span>
                <Badge variant={lead.status as 'new' | 'contacted' | 'converted'}>
                  {lead.status}
                </Badge>
              </div>
            </div>

            {/* Status update */}
            <div className="px-6 py-4 border-b shrink-0">
              <label
                htmlFor="status-select"
                className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2"
              >
                Status
              </label>
              <select
                id="status-select"
                value={lead.status}
                disabled={statusMutation.isPending || noteMutation.isPending}
                onChange={(e) => statusMutation.mutate(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Update lead status"
              >
                {LeadStatus.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {/* Timeline — scrolls independently */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Timeline
              </h3>
              {sortedNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No notes yet. Add a note to track this lead.
                </p>
              ) : (
                sortedNotes.map((note, i) => (
                  <div
                    key={i}
                    className={`rounded-md p-3 text-sm ${
                      note.type === 'status_change'
                        ? 'bg-slate-100 text-slate-600'
                        : 'bg-white border border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="flex items-center gap-1.5 font-medium text-xs">
                        {note.type === 'status_change' ? (
                          <>
                            <span aria-hidden>⚙</span>
                            <span className="text-slate-500">System</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden>👤</span>
                            <span>{note.author}</span>
                          </>
                        )}
                      </span>
                      <time
                        dateTime={note.timestamp}
                        className="text-xs text-muted-foreground"
                      >
                        {formatNoteTime(note.timestamp)}
                      </time>
                    </div>
                    <p className="text-slate-700 leading-relaxed">{note.content}</p>
                  </div>
                ))
              )}
            </div>

            {/* Note input — stays outside scroll area */}
            <div className="px-6 py-4 border-t shrink-0 space-y-2">
              <label
                htmlFor="note-input"
                className="block text-xs font-semibold text-slate-700 uppercase tracking-wider"
              >
                Add note
              </label>
              <textarea
                id="note-input"
                rows={3}
                maxLength={NOTE_MAX}
                value={noteContent}
                disabled={noteMutation.isPending || statusMutation.isPending}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Write a note…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
                aria-label="Note content"
              />
              <div className="flex items-center justify-between">
                <span
                  className={`text-xs ${
                    noteContent.length > NOTE_MAX
                      ? 'text-red-500 font-medium'
                      : 'text-muted-foreground'
                  }`}
                >
                  {noteContent.length}/{NOTE_MAX}
                </span>
                <Button
                  size="sm"
                  disabled={!noteIsValid || noteMutation.isPending || statusMutation.isPending}
                  onClick={() => noteMutation.mutate(noteContent.trim())}
                >
                  {noteMutation.isPending ? 'Saving…' : 'Add note'}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
