/** Inventory page: a worker's last reported inventory and fleet-wide item counts. */
import { InventoryTab } from './workers/InventoryTab';
export function InventoryPage({ push }: { push: (message: string, tone?: string) => void }) {
  return <InventoryTab push={push} />;
}
