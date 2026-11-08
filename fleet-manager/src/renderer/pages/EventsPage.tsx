/**
 * Event Center.
 *
 * Live feed of every fleet event with filtering, severity tones and notification management.
 */
import { useState } from 'react';
import { useStore } from '../lib/store';
import { fleet } from '../lib/api';
import { Button, Card, Empty, Pill } from '../components/ui';
import { formatTime } from '../lib/format';

interface Props { push: (message: string, tone?: string) => void }

export function EventsPage({ push }: Props) {
  const store = useStore();
  const [severity, setSeverity] = useState('ALL');
  const [search, setSearch] = useState('');

  const filtered = store.events.filter((event) => {
    if (severity !== 'ALL' && event.severity !== severity) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return event.type.toLowerCase().includes(q) || event.message.toLowerCase().includes(q);
  });

  return (
    <div className="col" style={{ gap: 16 }}>
      <Card
        title="Event Center"
        sub="Every role and fleet event, newest first."
        actions={<Button onClick={async () => { await fleet.markAllNotificationsRead(); await store.refreshEvents(); push('All notifications marked read'); }}>Mark all read</Button>}
      >
        <div className="row" style={{ marginBottom: 14 }}>
          <input type="text" placeholder="Search events…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={{ maxWidth: 160 }}>
            <option value="ALL">All severities</option>
            <option value="info">Info</option>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
          <div className="spacer" />
          <span className="card-sub">{filtered.length} events</span>
        </div>

        {filtered.length === 0 ? (
          <Empty>No events match.</Empty>
        ) : (
          <table>
            <thead>
              <tr><th>Time</th><th>Severity</th><th>Type</th><th>Source</th><th>Message</th></tr>
            </thead>
            <tbody>
              {filtered.slice(0, 300).map((event) => (
                <tr key={event.id}>
                  <td className="mono">{formatTime(event.timestamp)}</td>
                  <td><Pill tone={event.severity}>{event.severity}</Pill></td>
                  <td><strong>{event.type}</strong></td>
                  <td className="card-sub">{event.source}</td>
                  <td>{event.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Notifications">
        {store.notifications.length === 0 ? (
          <Empty>No notifications.</Empty>
        ) : (
          <table>
            <thead><tr><th></th><th>Time</th><th>Severity</th><th>Title</th><th>Body</th></tr></thead>
            <tbody>
              {store.notifications.map((notification) => (
                <tr key={notification.id} style={{ opacity: notification.read ? 0.55 : 1 }}>
                  <td>
                    {!notification.read && (
                      <Button small variant="ghost" onClick={async () => { await fleet.markNotificationRead(notification.id); await store.refreshEvents(); }}>●</Button>
                    )}
                  </td>
                  <td className="mono">{formatTime(notification.timestamp)}</td>
                  <td><Pill tone={notification.severity}>{notification.severity}</Pill></td>
                  <td><strong>{notification.title}</strong></td>
                  <td className="card-sub">{notification.body}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
