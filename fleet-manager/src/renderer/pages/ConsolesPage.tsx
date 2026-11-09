/** Consoles page: what each worker says about itself, and the tasks it supports. */
import { ConsoleTab } from './workers/ConsoleTab';
export function ConsolesPage({ push }: { push: (message: string, tone?: string) => void }) {
  return <ConsoleTab push={push} />;
}
