import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GAMIFICATION_LEVELS,
  applyGamificationLevels,
  getGamificationRank,
  isValidGamificationLevels,
  normalizeGamificationLevels
} from '../utils/gamification_levels.js';

const CUSTOM_LEVELS = {
  scout: { level_2_points: 250, level_3_points: 750 },
  enforcer: { level_2_points: 400, level_3_points: 900 }
};

test('gamification levels preserve the existing 501 and 1001 point defaults', () => {
  assert.deepEqual(normalizeGamificationLevels(null), DEFAULT_GAMIFICATION_LEVELS);
  assert.equal(getGamificationRank(500, 'scout'), 'Level 1 Scout Reporter');
  assert.equal(getGamificationRank(501, 'scout'), 'Level 2 Scout Reporter');
  assert.equal(getGamificationRank(1001, 'enforcer'), 'Level 3 Enforcer');
});

test('Scout and Enforcer tracks use their independently configured thresholds', () => {
  const stats = applyGamificationLevels({ scoutPoints: 300, enforcerPoints: 300 }, CUSTOM_LEVELS);
  assert.equal(stats.scoutRank, 'Level 2 Scout Reporter');
  assert.equal(stats.enforcerRank, 'Level 1 Enforcer');
  assert.deepEqual(stats.levelThresholds, CUSTOM_LEVELS);
});

test('level configuration accepts only fixed fields and ascending whole-number thresholds', () => {
  assert.equal(isValidGamificationLevels(CUSTOM_LEVELS), true);
  assert.equal(isValidGamificationLevels({ ...CUSTOM_LEVELS, arbitrary: true }), false);
  assert.equal(isValidGamificationLevels({
    ...CUSTOM_LEVELS,
    scout: { level_2_points: 500, level_3_points: 500 }
  }), false);
  assert.equal(isValidGamificationLevels({
    ...CUSTOM_LEVELS,
    enforcer: { level_2_points: 400.5, level_3_points: 900 }
  }), false);
});

test('Pioneer rank decoration is retained when thresholds are recalculated', () => {
  const stats = applyGamificationLevels({
    scoutPoints: 800,
    enforcerPoints: 950,
    scoutRank: '🚀 Pioneer Level 1 Scout Reporter'
  }, CUSTOM_LEVELS);
  assert.equal(stats.scoutRank, '🚀 Pioneer Level 3 Scout Reporter');
  assert.equal(stats.enforcerRank, '🚀 Pioneer Level 3 Enforcer');
});
