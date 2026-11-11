/**
 * The operation vocabulary a natural-language instruction is resolved into.
 *
 * This is the contract between the AI layer and the worker: a model may only ever name an operation
 * from this list, with arguments from the declared shapes. Anything else is refused. That is what
 * makes it safe to point a language model at a live bot.
 */

export type IntentOperation =
  | 'storage.sort'
  | 'storage.search'
  | 'storage.count'
  | 'storage.consolidate'
  | 'storage.report'
  | 'storage.move'
  | 'shulker.fill'
  | 'shulker.unpack'
  | 'shulker.inspect'
  | 'shulker.organise'
  | 'restock.run'
  | 'restock.report'
  | 'inventory.report'
  | 'inventory.search'
  | 'container.find'
  | 'container.read'
  | 'container.emptiest'
  | 'container.fullest'
  | 'navigation.goTo'
  | 'portal.list'
  | 'portal.scan'
  | 'structure.list'
  | 'structure.audit'
  | 'structure.preview'
  | 'maintenance.run'
  | 'worker.assign'
  | 'crafting.plan'
  | 'disposal.plan'
  | 'status.report';

export interface OperationDescriptor {
  id: IntentOperation;
  /** Human description, shown in previews and error messages. */
  description: string;
  /** Argument names the operation accepts. */
  arguments: string[];
  /** Whether running it changes the world. */
  mutating: boolean;
  /** Permission flag that must be on, or null. */
  requires: string | null;
  /** Whether an operator must approve before it runs. */
  requiresApproval: boolean;
  /** Example phrasings the deterministic interpreter recognises. */
  examples: string[];
}

export const OPERATIONS: readonly OperationDescriptor[] = [
  { id: 'storage.sort', description: 'Sort loose items into the correct storage containers', arguments: ['networkId', 'containerId'], mutating: true, requires: 'allowContainerMoves', requiresApproval: true, examples: ['sort the storage room', 'tidy the chests', 'organise the storage'] },
  { id: 'storage.search', description: 'Search every registered container for an item', arguments: ['query'], mutating: false, requires: null, requiresApproval: false, examples: ['find all diamonds', 'where are my diamonds', 'search for netherite'] },
  { id: 'storage.count', description: 'Count an item across the whole network', arguments: ['query'], mutating: false, requires: null, requiresApproval: false, examples: ['how many iron do i have', 'count the cobblestone'] },
  { id: 'storage.consolidate', description: 'Merge identical stacks to free container slots', arguments: ['networkId'], mutating: true, requires: 'allowContainerMoves', requiresApproval: true, examples: ['consolidate the storage', 'merge the stacks'] },
  { id: 'storage.report', description: 'Report storage capacity, bottlenecks and unsorted items', arguments: ['networkId'], mutating: false, requires: null, requiresApproval: false, examples: ['how full is the storage', 'storage report', 'check the storage'] },
  { id: 'storage.move', description: 'Move matching items into a named container', arguments: ['query', 'containerId', 'networkId'], mutating: true, requires: 'allowContainerMoves', requiresApproval: true, examples: ['move all iron into the mining storage', 'put the diamonds in the vault'] },
  { id: 'shulker.fill', description: 'Fill shulker boxes with matching items', arguments: ['query', 'count', 'category'], mutating: true, requires: 'allowShulkerPack', requiresApproval: true, examples: ['fill five building-material shulkers', 'pack the cobblestone into shulkers'] },
  { id: 'shulker.unpack', description: 'Empty carried shulker boxes into the inventory', arguments: ['slot'], mutating: true, requires: 'allowShulkerUnpack', requiresApproval: true, examples: ['unpack the shulkers', 'empty my shulker boxes'] },
  { id: 'shulker.inspect', description: 'Read the contents of carried shulker boxes', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['what is in my shulkers', 'inspect the shulker boxes'] },
  { id: 'shulker.organise', description: 'Suggest shulker organisation (inspect, consolidate, reserve)', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['organise my shulkers', 'tidy the shulker boxes'] },
  { id: 'restock.run', description: 'Top up carried items from storage', arguments: ['query', 'minimum'], mutating: true, requires: 'allowRestock', requiresApproval: true, examples: ['restock the building supplies', 'top up my torches', 'restock'] },
  { id: 'restock.report', description: 'Report what is below its restock minimum', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['what needs restocking', 'restock report'] },
  { id: 'inventory.report', description: 'Report the carried inventory', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['what am i carrying', 'show my inventory', 'inventory'] },
  { id: 'inventory.search', description: 'Find matching items in the carried inventory', arguments: ['query'], mutating: false, requires: null, requiresApproval: false, examples: ['do i have any food', 'find my pickaxe'] },
  { id: 'container.find', description: 'Find containers holding an item', arguments: ['query'], mutating: false, requires: null, requiresApproval: false, examples: ['which chest has the iron', 'find the container with diamonds'] },
  { id: 'container.read', description: 'Read one container by position or label', arguments: ['containerId', 'x', 'y', 'z'], mutating: false, requires: null, requiresApproval: false, examples: ['read the vault chest', 'inspect that chest'] },
  { id: 'container.emptiest', description: 'List the containers with the most free space', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['which chest is empty', 'find an empty chest'] },
  { id: 'container.fullest', description: 'List the fullest containers', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['find full chests', 'which chests are full'] },
  { id: 'navigation.goTo', description: 'Walk to a registered location', arguments: ['containerId', 'structureId', 'x', 'y', 'z'], mutating: true, requires: null, requiresApproval: false, examples: ['go to the vault', 'walk to the mining storage', 'return to base'] },
  { id: 'portal.list', description: 'List registered portals', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['list the portals', 'show the registered portals'] },
  { id: 'portal.scan', description: 'Scan for nearby portals', arguments: ['radius'], mutating: false, requires: null, requiresApproval: false, examples: ['inspect the registered portals', 'scan for portals', 'find portals'] },
  { id: 'structure.list', description: 'List registered structures', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['list the structures', 'what structures are registered'] },
  { id: 'structure.audit', description: 'Report structures needing attention', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['check my structures', 'which structures need work', 'structure audit'] },
  { id: 'structure.preview', description: 'Preview what a change would touch', arguments: ['structureId', 'x', 'y', 'z'], mutating: false, requires: null, requiresApproval: false, examples: ['preview work on the farm', 'what would a change touch'] },
  { id: 'maintenance.run', description: 'Run a maintenance pass over due structures', arguments: ['structureId'], mutating: true, requires: 'allowContainerMoves', requiresApproval: true, examples: ['run maintenance', 'do the maintenance', 'maintain the storage room'] },
  { id: 'worker.assign', description: 'Ask the fleet to assign a worker to a job', arguments: ['task'], mutating: false, requires: null, requiresApproval: false, examples: ['assign an available worker to storage maintenance', 'assign a worker to sort the storage'] },
  { id: 'crafting.plan', description: 'Plan how many of an item can be crafted', arguments: ['query'], mutating: false, requires: null, requiresApproval: false, examples: ['can i craft a diamond pickaxe', 'plan crafting torches'] },
  { id: 'disposal.plan', description: 'Plan disposal of junk without touching valuables', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['what junk can i throw out', 'plan disposal'] },
  { id: 'status.report', description: 'Report the worker status', arguments: [], mutating: false, requires: null, requiresApproval: false, examples: ['status', 'how are you', 'what are you doing'] },
];

const BY_ID = new Map<string, OperationDescriptor>(OPERATIONS.map((operation) => [operation.id, operation]));

export function operationById(id: string): OperationDescriptor | undefined {
  return BY_ID.get(id);
}

export function isOperationId(value: unknown): value is IntentOperation {
  return typeof value === 'string' && BY_ID.has(value);
}

export function knownOperations(): IntentOperation[] {
  return OPERATIONS.map((operation) => operation.id);
}
