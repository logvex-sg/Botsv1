/**
 * Setup advisor.
 *
 * Pure, side-effect-free logic that turns a snapshot of the fleet into a guided first-run
 * checklist. Keeping it pure means the "what do I do next?" logic can be unit-tested without a
 * database, an Electron window or a running bot.
 *
 * The advisor never performs an action; it only reports what the user should do and which page to
 * visit. The dashboard renders the steps and offers a one-click button for each.
 */
import type { SetupReport, SetupStep } from '../../../shared/types';

export interface SetupSnapshot {
  servers: number;
  accounts: number;
  /** Accounts that can actually be deployed right now (credential present where needed). */
  deployableAccounts: number;
  instances: number;
  runningInstances: number;
  hunterConnected: boolean;
}

export function buildSetupReport(snapshot: SetupSnapshot): SetupReport {
  const steps: SetupStep[] = [
    {
      id: 'server',
      title: 'Add a server',
      description: 'Tell the app which Minecraft server your bots should join.',
      status: snapshot.servers > 0 ? 'done' : 'todo',
      page: 'features',
      actionLabel: 'Add server',
      optional: false,
    },
    {
      id: 'account',
      title: 'Add an account',
      description: 'Each bot needs its own account. Offline servers need only a username.',
      status: snapshot.accounts > 0 ? 'done' : 'todo',
      page: 'accounts',
      actionLabel: 'Add account',
      optional: false,
    },
    {
      id: 'credential',
      title: 'Add a password where needed',
      description: 'Accounts on online servers need a stored password before they can log in.',
      status: snapshot.accounts === 0 ? 'blocked'
        : snapshot.deployableAccounts > 0 ? 'done' : 'todo',
      page: 'accounts',
      actionLabel: 'Fix accounts',
      optional: false,
    },
    {
      id: 'deploy',
      title: 'Start your bots',
      description: 'Launch a deployment to bring your bots online.',
      status: snapshot.instances > 0 ? 'done' : snapshot.deployableAccounts > 0 ? 'todo' : 'blocked',
      page: 'tasks',
      actionLabel: 'Start bots',
      optional: false,
    },
    {
      id: 'hunter',
      title: 'Connect Logvex Hunter (optional)',
      description: 'Link the Hunter addon to share targets and see live combat events.',
      status: snapshot.hunterConnected ? 'done' : 'todo',
      page: 'settings',
      actionLabel: 'Connect',
      optional: true,
    },
  ];

  const required = steps.filter((s) => !s.optional);
  const doneRequired = required.filter((s) => s.status === 'done').length;
  const completion = required.length === 0 ? 1 : doneRequired / required.length;
  const ready = doneRequired === required.length;

  const next = steps.find((s) => !s.optional && s.status !== 'done')
    ?? steps.find((s) => s.status !== 'done')
    ?? null;

  return {
    ready,
    completion,
    steps,
    nextStepId: next?.id ?? null,
    nextHint: next ? next.description : 'Everything is set up. Your bots are ready.',
  };
}
