/**
 * Group engine tests: honest bulk-operation aggregation and template application.
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateResults,
  applyTemplate,
  membersOf,
  withTags,
  type GroupMemberOutcome,
} from '../../src/main/packages/group-engine';

function outcome(label: string, bucket: GroupMemberOutcome['outcome']): GroupMemberOutcome {
  return { workerId: label.toLowerCase(), label, ok: bucket === 'completed', outcome: bucket, detail: '' };
}

describe('aggregateResults', () => {
  it('is ok only when every worker completed', () => {
    const summary = aggregateResults([outcome('A', 'completed'), outcome('B', 'completed')]);
    expect(summary.ok).toBe(true);
    expect(summary.message).toBe('2 completed');
  });

  it('is not ok when any worker failed or disconnected', () => {
    const summary = aggregateResults([
      outcome('A', 'completed'), outcome('B', 'completed'),
      outcome('C', 'disconnected'), outcome('D', 'failed'),
    ]);
    expect(summary.ok).toBe(false);
    expect(summary.completed).toBe(2);
    expect(summary.disconnected).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.message).toBe('2 completed, 1 disconnected, 1 failed');
  });

  it('does not treat an empty selection as success', () => {
    const summary = aggregateResults([]);
    expect(summary.ok).toBe(false);
    expect(summary.message).toContain('No workers');
  });

  it('keeps the per-worker lines for the report', () => {
    const summary = aggregateResults([outcome('A', 'completed'), outcome('B', 'failed')]);
    expect(summary.outcomes.map((o) => o.label)).toEqual(['A', 'B']);
  });
});

describe('membersOf', () => {
  it('filters workers to one group', () => {
    const workers = [{ groupId: 'g1' }, { groupId: 'g2' }, { groupId: 'g1' }];
    expect(membersOf(workers, 'g1').length).toBe(2);
  });
});

describe('withTags', () => {
  it('requires every requested tag', () => {
    const workers = [{ tags: ['eu', 'pvp'] }, { tags: ['eu'] }];
    expect(withTags(workers, ['eu', 'pvp']).length).toBe(1);
  });

  it('returns everyone when no tags are requested', () => {
    expect(withTags([{ tags: [] }, { tags: ['x'] }], []).length).toBe(2);
  });
});

describe('applyTemplate', () => {
  it('copies the template defaults without sharing array references', () => {
    const template = {
      id: 't1', name: 'Storage Team', description: 'd', color: '#fff',
      defaultTaskPresetIds: ['p1'], defaultEquipmentPresetIds: ['e1'], permissions: ['inventory'],
    };
    const applied = applyTemplate(template);
    expect(applied.name).toBe('Storage Team');
    applied.defaultTaskPresetIds.push('p2');
    expect(template.defaultTaskPresetIds).toEqual(['p1']);
  });
});
