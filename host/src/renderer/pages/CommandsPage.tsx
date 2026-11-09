/** Commands page: send server commands and chat lines through workers, with an audit log. */
import { CommandsTab } from './workers/CommandsTab';
export function CommandsPage({ push }: { push: (message: string, tone?: string) => void }) {
  return <CommandsTab push={push} />;
}
