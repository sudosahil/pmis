import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Page } from '../api/client';
import { dateTime, relativeTime } from '../lib/format';
import type { Notification } from '../types';
import { Alert, BellIcon, Button, Card, CheckIcon, EmptyState, Loading, PageHeader } from '../components/ui';
import { Pagination } from '../components/DataTable';

type NotificationPage = Page<Notification> & { unread: number };

const SEVERITY_TONE: Record<Notification['severity'], string> = {
  ACTION: 'warn',
  WARNING: 'danger',
  SUCCESS: 'ok',
  INFO: 'info',
};

export function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'list', unreadOnly, page],
    queryFn: () =>
      api.get<NotificationPage>('/notifications', {
        unreadOnly: unreadOnly ? 'true' : undefined,
        page,
        pageSize: 20,
      }),
  });

  const markRead = useMutation({
    mutationFn: (body: { ids?: number[]; all?: boolean }) => api.post('/notifications/read', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  function open(notification: Notification) {
    if (!notification.isRead) markRead.mutate({ ids: [notification.id] });
    if (notification.link) navigate(notification.link);
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Files awaiting your action, decisions taken on your submissions, and payment confirmations."
        actions={
          <>
            <Button onClick={() => { setUnreadOnly((v) => !v); setPage(1); }}>
              {unreadOnly ? 'Show all' : 'Show unread only'}
            </Button>
            <Button
              variant="primary"
              icon={<CheckIcon />}
              disabled={(data?.unread ?? 0) === 0}
              loading={markRead.isPending}
              onClick={() => markRead.mutate({ all: true })}
            >
              Mark all as read
            </Button>
          </>
        }
      />

      {(data?.unread ?? 0) > 0 && (
        <Alert variant="info" title={`${data!.unread} unread notification${data!.unread === 1 ? '' : 's'}`}>
          Opening a notification marks it as read and takes you to the record it refers to.
        </Alert>
      )}

      <Card flush>
        {isLoading ? (
          <Loading />
        ) : !data?.items.length ? (
          <EmptyState
            icon={<BellIcon size={40} />}
            title={unreadOnly ? 'Nothing unread' : 'No notifications yet'}
            text="You will be told here when a file reaches you or a decision is taken on your submission."
          />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {data.items.map((notification) => (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => open(notification)}
                  style={{
                    display: 'flex',
                    gap: 12,
                    width: '100%',
                    padding: '14px 18px',
                    border: 'none',
                    borderBottom: '1px solid var(--line-soft)',
                    borderLeft: notification.isRead
                      ? '4px solid transparent'
                      : `4px solid var(--${SEVERITY_TONE[notification.severity]}-fg)`,
                    background: notification.isRead ? 'transparent' : 'var(--brand-050)',
                    textAlign: 'left',
                    cursor: notification.link ? 'pointer' : 'default',
                    font: 'inherit',
                    color: 'inherit',
                  }}
                >
                  <span
                    className={`badge badge--${SEVERITY_TONE[notification.severity]}`}
                    style={{ flex: 'none', alignSelf: 'flex-start' }}
                  >
                    {notification.severity === 'ACTION' ? 'Action needed' : notification.severity.toLowerCase()}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontWeight: notification.isRead ? 500 : 700 }}>
                      {notification.title}
                    </span>
                    <span style={{ display: 'block', color: 'var(--ink-700)', marginTop: 2 }}>
                      {notification.message}
                    </span>
                  </span>
                  <span
                    style={{ flex: 'none', color: 'var(--ink-600)', fontSize: 12.5, whiteSpace: 'nowrap' }}
                    title={dateTime(notification.createdAt)}
                  >
                    {relativeTime(notification.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {data && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        )}
      </Card>
    </>
  );
}
