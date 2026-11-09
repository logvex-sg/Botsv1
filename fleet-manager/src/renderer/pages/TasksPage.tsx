/** Tasks page: dispatch a task kind to one worker or many and watch confirmed results. */
import { TasksTab } from './workers/TasksTab';
export function TasksPage({ push }: { push: (message: string, tone?: string) => void }) {
  return <TasksTab push={push} />;
}
