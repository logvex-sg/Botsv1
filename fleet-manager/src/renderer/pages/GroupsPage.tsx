/** Groups page: named sets of workers for bulk actions. */
import { GroupsTab } from './workers/GroupsTab';
export function GroupsPage({ push }: { push: (message: string, tone?: string) => void }) {
  return <GroupsTab push={push} />;
}
