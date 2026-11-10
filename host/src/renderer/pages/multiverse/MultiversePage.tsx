/**
 * Multiverse page.
 *
 * One page with six tabs that together are the organisational half of the product: server
 * profiles, reusable task presets, schedules, automation rules, container records and the audit
 * trail. Every tab talks to the real Host service through the preload bridge, so a button here does
 * exactly what the equivalent command does.
 */
import { useCallback, useEffect, useState } from 'react';
import { Segmented } from '../../components/ui';
import { ServersTab } from './ServersTab';
import { TemplatesTab } from './TemplatesTab';
import { PresetsTab } from './PresetsTab';
import { SchedulesTab } from './SchedulesTab';
import { RulesTab } from './RulesTab';
import { ContainersTab } from './ContainersTab';
import { AuditTab } from './AuditTab';

type TabId = 'servers' | 'templates' | 'presets' | 'schedules' | 'rules' | 'containers' | 'audit';

interface Props {
  push: (message: string, tone?: string) => void;
}

export function MultiversePage({ push }: Props) {
  const [tab, setTab] = useState<TabId>('servers');

  return (
    <div className="col" style={{ gap: 16 }}>
      <Segmented<TabId>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'servers', label: 'Servers' },
          { value: 'templates', label: 'Templates' },
          { value: 'presets', label: 'Task presets' },
          { value: 'schedules', label: 'Schedules' },
          { value: 'rules', label: 'Automation' },
          { value: 'containers', label: 'Containers' },
          { value: 'audit', label: 'Audit' },
        ]}
      />
      {tab === 'servers' && <ServersTab push={push} />}
      {tab === 'templates' && <TemplatesTab push={push} />}
      {tab === 'presets' && <PresetsTab push={push} />}
      {tab === 'schedules' && <SchedulesTab push={push} />}
      {tab === 'rules' && <RulesTab push={push} />}
      {tab === 'containers' && <ContainersTab push={push} />}
      {tab === 'audit' && <AuditTab push={push} />}
    </div>
  );
}

/**
 * A tiny data hook for the tabs.
 *
 * Each tab loads its own slice, exposes a refresh, and keeps the last error so a failed load is
 * shown rather than swallowed. It is intentionally small: the Host is the source of truth and a
 * tab only ever reads one collection.
 */
export function useCollection<T>(load: () => Promise<T[]>, deps: unknown[] = []): {
  items: T[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
} {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setItems(await load());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, error, reload };
}
