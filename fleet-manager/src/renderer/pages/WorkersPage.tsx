/** Workers page: the roster and per-worker controls. */
import { WorkersTab } from './workers/WorkersTab';
export function WorkersPage({ push }: { push: (message: string, tone?: string) => void }) {
  return <WorkersTab push={push} />;
}
