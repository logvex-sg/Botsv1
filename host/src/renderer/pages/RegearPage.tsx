/** Regear page: loadout presets and the difference against each worker's reported inventory. */
import { RegearTab } from './workers/RegearTab';
export function RegearPage({ push }: { push: (message: string, tone?: string) => void }) {
  return <RegearTab push={push} />;
}
