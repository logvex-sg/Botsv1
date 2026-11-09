/**
 * Activity.
 *
 * Combines the event feed, notifications, statistics and live logs behind one set of tabs, so the
 * user has a single "what happened?" place instead of two similar pages.
 */
import { useState } from 'react';
import { EventsPage } from './EventsPage';
import { LogsPage } from './LogsPage';

interface Props { push: (message: string, tone?: string) => void }

type ActivityTab = 'events' | 'stats';

export function ActivityPage({ push }: Props) {
  const [tab, setTab] = useState<ActivityTab>('events');

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="tabs">
        <button className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>Events & notifications</button>
        <button className={`tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>Statistics & logs</button>
      </div>
      {tab === 'events' && <EventsPage push={push} />}
      {tab === 'stats' && <LogsPage />}
    </div>
  );
}
