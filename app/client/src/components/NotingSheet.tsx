import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { dateTime, initials, relativeTime } from '../lib/format';
import type { FileNote } from '../types';
import { Alert, Button, Card, Checkbox, EmptyState, Loading, TextArea } from './ui';

/**
 * The noting sheet a government file carries.
 *
 * Distinct from the approval history: that records decisions, this records what
 * officers observed on the way. A note is never edited, because it is a record
 * of what someone said — a correction is another note.
 */
export function NotingSheet({
  entityType,
  entityId,
  title = 'Noting sheet',
}: {
  entityType: string;
  entityId: number;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user, isContractor } = useAuth();

  const [body, setBody] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const key = ['notes', entityType, entityId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<FileNote[]>('/notes', { entityType, entityId }),
  });

  const add = useMutation({
    mutationFn: () =>
      api.post<FileNote>(`/notes?entityType=${entityType}&entityId=${entityId}`, {
        body,
        isInternal,
      }),
    onSuccess: () => {
      setBody('');
      setIsInternal(false);
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not record the note.'),
  });

  const withdraw = useMutation({
    mutationFn: (id: number) => api.delete(`/notes/${id}`),
    onSuccess: () => {
      toast.success('Note withdrawn');
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: unknown) =>
      toast.error('Could not withdraw', error instanceof ApiError ? error.message : undefined),
  });

  const notes = data ?? [];
  const lastNoteNo = notes.length ? notes[notes.length - 1]!.noteNo : 0;

  return (
    <Card
      title={title}
      subtitle="What officers have recorded on this file, in the order they wrote it."
      actions={<span className="badge badge--neutral">{notes.length} note{notes.length === 1 ? '' : 's'}</span>}
    >
      <div className="stack">
        {isLoading ? (
          <Loading />
        ) : !notes.length ? (
          <EmptyState
            title="Nothing noted yet"
            text="Record an observation below. Notes stay on the file permanently."
          />
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {notes.map((note) => (
              <li
                key={note.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '12px 0',
                  borderBottom: '1px solid var(--line-soft)',
                }}
              >
                <span
                  className="header-user__avatar"
                  style={{ flex: 'none', background: 'var(--brand-100)', color: 'var(--brand-900)' }}
                  title={note.authorName ?? undefined}
                >
                  {initials(note.authorName)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14 }}>
                      Note {note.noteNo}
                    </strong>
                    <span style={{ color: 'var(--ink-700)', fontSize: 13.5 }}>
                      {note.authorName}
                      {note.authorRole ? ` · ${note.authorRole}` : ''}
                    </span>
                    <span
                      style={{ color: 'var(--ink-600)', fontSize: 12.5 }}
                      title={dateTime(note.createdAt)}
                    >
                      {relativeTime(note.createdAt)}
                    </span>
                    {note.isInternal && (
                      <span className="badge badge--warn">Internal</span>
                    )}
                  </div>
                  <p style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{note.body}</p>
                  {note.authorId === user?.id && note.noteNo === lastNoteNo && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={withdraw.isPending}
                      onClick={() => withdraw.mutate(note.id)}
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}

        <TextArea
          label={`Add note ${lastNoteNo + 1}`}
          full
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Record what you have observed, checked or decided."
          hint="A note cannot be edited once another officer has written below it."
        />
        <div className="row row--between">
          {!isContractor ? (
            <Checkbox
              label="Internal note — not shown to the contractor"
              checked={isInternal}
              onChange={(event) => setIsInternal(event.target.checked)}
            />
          ) : (
            <span />
          )}
          <Button
            variant="primary"
            loading={add.isPending}
            disabled={body.trim().length < 2}
            onClick={() => add.mutate()}
          >
            Record note
          </Button>
        </div>
      </div>
    </Card>
  );
}
