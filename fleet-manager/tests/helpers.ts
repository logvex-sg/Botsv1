/**
 * Shared test helpers.
 *
 * Builds a fully wired {@link AppContext} over an in-memory database, with the worker WebSocket
 * server left stopped unless a test asks for it. Nothing is mocked below the protocol boundary: the
 * services, repositories and SQLite are the real ones, so an integration test exercises the same
 * code paths the app runs.
 */
import { AppContext } from '../src/main/context';

export interface TestContext {
  context: AppContext;
}

export async function createTestContext(options: {
  /** Set to false to leave the worker WebSocket server stopped (it binds a real port otherwise). */
  startWorkerServer?: boolean;
  /** A fixed worker token so tests can connect without reading the generated one. */
  workerToken?: string;
  /** Worker server port; 0 (the default here) binds an ephemeral port so test files never collide. */
  workerServerPort?: number;
} = {}): Promise<TestContext> {
  const context = await AppContext.create({
    databasePath: ':memory:',
    startWorkerServer: options.startWorkerServer,
    workerToken: options.workerToken,
    workerServerPort: options.workerServerPort ?? 0,
  });
  return { context };
}

/** A regear preset that the worker tests use as a known loadout. */
export function samplePreset() {
  return {
    name: 'Standard',
    description: 'Diamonds and totems',
    items: [
      { query: 'diamond', count: 64, label: 'Diamonds' },
      { query: 'totem', count: 2, label: 'Totems' },
    ],
    minArmorPieces: 4,
    minFood: 8,
    lowDurabilityPercent: 10,
  };
}
