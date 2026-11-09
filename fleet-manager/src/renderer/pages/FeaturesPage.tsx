/**
 * Main Features.
 *
 * A single place for the fleet's capabilities so the sidebar does not need a section per feature.
 * Each tab is a focused, plain-language area; the underlying pages are reused unchanged so no
 * functionality is lost.
 */
import { useState } from 'react';
import { HunterPage } from './HunterPage';
import { TargetsPage } from './TargetsPage';
import { GearerPage } from './GearerPage';
import { StasisPage } from './StasisPage';
import { ServersPage } from './ServersPage';
import { Callout } from '../components/ui';
import type { UiMode } from '../../shared/types';

interface Props {
  push: (message: string, tone?: string) => void;
  uiMode: UiMode;
  /** Which tab to open first; set when navigating in from elsewhere (e.g. the setup checklist). */
  initialTab?: FeatureTab;
}

export type FeatureTab = 'hunter' | 'targets' | 'gear' | 'stasis' | 'servers';

const TABS: { id: FeatureTab; label: string; blurb: string }[] = [
  { id: 'hunter', label: 'Hunter', blurb: 'Connects to the Logvex Hunter addon and shows combat readiness. Combat stays off until you authorise it.' },
  { id: 'targets', label: 'Targets', blurb: 'The shared list of players the fleet watches. Add friends to keep them safe.' },
  { id: 'gear', label: 'Gear', blurb: 'Equipment profiles and warnings when a bot is missing armour, weapons, totems or food.' },
  { id: 'stasis', label: 'Stasis', blurb: 'Defensive locations the fleet keeps an eye on, with a simple ready/unavailable state.' },
  { id: 'servers', label: 'Servers', blurb: 'The Minecraft servers your bots connect to. Add one per server.' },
];

export function FeaturesPage({ push, uiMode, initialTab }: Props) {
  const [tab, setTab] = useState<FeatureTab>(initialTab ?? 'hunter');
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <Callout tone="info" title={active.label}>{active.blurb}</Callout>

      {uiMode === 'beginner' && tab === 'hunter' && (
        <Callout tone="warning" title="Heads up">
          The Hunter never attacks on its own. Combat testing must be authorised per account, and only
          in a private test environment.
        </Callout>
      )}

      {tab === 'hunter' && <HunterPage push={push} />}
      {tab === 'targets' && <TargetsPage push={push} />}
      {tab === 'gear' && <GearerPage push={push} />}
      {tab === 'stasis' && <StasisPage push={push} />}
      {tab === 'servers' && <ServersPage push={push} />}
    </div>
  );
}
