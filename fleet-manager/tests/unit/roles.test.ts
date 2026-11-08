import { describe, it, expect } from 'vitest';
import { ROLE_DEFINITIONS, defaultRoleConfig, validateRoleConfig, withRoleDefaults } from '../../src/main/services/roles/roles';
import { isRoleAllowed } from '../../src/shared/events';

describe('role definitions', () => {
  it('defines exactly three roles', () => {
    expect(Object.keys(ROLE_DEFINITIONS).sort()).toEqual(['GEARER', 'HUNTER', 'STASIS']);
  });

  it('default config fills every field', () => {
    for (const role of ['GEARER', 'STASIS', 'HUNTER'] as const) {
      const config = defaultRoleConfig(role);
      for (const field of ROLE_DEFINITIONS[role].fields) {
        expect(config).toHaveProperty(field.key);
      }
    }
  });

  it('HUNTER requires explicit combat authorisation', () => {
    const issues = validateRoleConfig('HUNTER', { authorizedCombat: false });
    expect(issues.some((i) => i.field === 'authorizedCombat')).toBe(true);
  });

  it('withRoleDefaults preserves overrides', () => {
    const config = withRoleDefaults('GEARER', { minTotems: 5 });
    expect(config.minTotems).toBe(5);
    expect(config).toHaveProperty('equipmentProfileId');
  });
});

describe('role permissions', () => {
  it('only GEARER may emit equipment events', () => {
    expect(isRoleAllowed('EQUIPMENT_READY', 'GEARER')).toBe(true);
    expect(isRoleAllowed('EQUIPMENT_READY', 'HUNTER')).toBe(false);
  });

  it('only STASIS may emit stasis events', () => {
    expect(isRoleAllowed('STASIS_READY', 'STASIS')).toBe(true);
    expect(isRoleAllowed('STASIS_READY', 'GEARER')).toBe(false);
  });

  it('HUNTER and meteor may emit target events', () => {
    expect(isRoleAllowed('TARGET_DETECTED', 'HUNTER')).toBe(true);
    expect(isRoleAllowed('TARGET_DETECTED', 'meteor')).toBe(true);
    expect(isRoleAllowed('TARGET_DETECTED', 'STASIS')).toBe(false);
  });

  it('unclassified events are allowed for anyone', () => {
    expect(isRoleAllowed('SOMETHING_NEW', 'GEARER')).toBe(true);
  });
});
