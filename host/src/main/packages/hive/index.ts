/**
 * Hive engine: the pure core of HIVE MODE.
 *
 * Everything here is deterministic and free of sockets, workers and the world, so the coordinated
 * behaviour the hive promises — formations, sectors, task distribution, command parsing,
 * observations — is testable as arithmetic. The stateful coordinator lives in
 * `src/main/hive/hive-service.ts` and is a thin layer over these functions.
 */
export * from './formations';
export * from './roles';
export * from './sectors';
export * from './commands';
export * from './distribution';
export * from './observations';
