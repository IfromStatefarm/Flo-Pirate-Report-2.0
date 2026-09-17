export const MIN_GAMIFICATION_LEVEL_POINTS = 1;
export const MAX_GAMIFICATION_LEVEL_POINTS = 10000000;

export const DEFAULT_GAMIFICATION_LEVELS = Object.freeze({
  scout: Object.freeze({
    level_2_points: 501,
    level_3_points: 1001
  }),
  enforcer: Object.freeze({
    level_2_points: 501,
    level_3_points: 1001
  })
});

const TRACK_KEYS = Object.freeze(['scout', 'enforcer']);
const LEVEL_KEYS = Object.freeze(['level_2_points', 'level_3_points']);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expectedKeys.length
    && keys.every((key, index) => key === [...expectedKeys].sort()[index]);
}

function isValidPoints(value) {
  return Number.isSafeInteger(value)
    && value >= MIN_GAMIFICATION_LEVEL_POINTS
    && value <= MAX_GAMIFICATION_LEVEL_POINTS;
}

export function isValidGamificationLevels(value) {
  if (!hasExactKeys(value, TRACK_KEYS)) return false;

  return TRACK_KEYS.every((track) => {
    const thresholds = value[track];
    if (!hasExactKeys(thresholds, LEVEL_KEYS)) return false;
    const level2 = thresholds.level_2_points;
    const level3 = thresholds.level_3_points;
    return isValidPoints(level2) && isValidPoints(level3) && level3 > level2;
  });
}

export function normalizeGamificationLevels(value) {
  if (!isValidGamificationLevels(value)) {
    return {
      scout: { ...DEFAULT_GAMIFICATION_LEVELS.scout },
      enforcer: { ...DEFAULT_GAMIFICATION_LEVELS.enforcer }
    };
  }

  return {
    scout: {
      level_2_points: Number(value.scout.level_2_points),
      level_3_points: Number(value.scout.level_3_points)
    },
    enforcer: {
      level_2_points: Number(value.enforcer.level_2_points),
      level_3_points: Number(value.enforcer.level_3_points)
    }
  };
}

export function getGamificationLevels(config) {
  return normalizeGamificationLevels(config?.gamification_levels);
}

export function getGamificationRank(points, track, levels = DEFAULT_GAMIFICATION_LEVELS) {
  const normalizedLevels = normalizeGamificationLevels(levels);
  const normalizedTrack = track === 'enforcer' ? 'enforcer' : 'scout';
  const numericPoints = Number.isFinite(Number(points)) ? Number(points) : 0;
  const kind = normalizedTrack === 'enforcer' ? 'Enforcer' : 'Scout Reporter';
  const thresholds = normalizedLevels[normalizedTrack];

  if (numericPoints >= thresholds.level_3_points) return `Level 3 ${kind}`;
  if (numericPoints >= thresholds.level_2_points) return `Level 2 ${kind}`;
  return `Level 1 ${kind}`;
}

export function applyGamificationLevels(stats, levels = DEFAULT_GAMIFICATION_LEVELS) {
  const normalizedLevels = normalizeGamificationLevels(levels);
  const pioneerPrefix = /^\s*🚀\s*Pioneer\b/i.test(String(stats?.scoutRank || ''))
    || /^\s*🚀\s*Pioneer\b/i.test(String(stats?.enforcerRank || ''))
    ? '🚀 Pioneer '
    : '';

  return {
    ...(stats || {}),
    scoutRank: `${pioneerPrefix}${getGamificationRank(stats?.scoutPoints, 'scout', normalizedLevels)}`,
    enforcerRank: `${pioneerPrefix}${getGamificationRank(stats?.enforcerPoints, 'enforcer', normalizedLevels)}`,
    levelThresholds: normalizedLevels
  };
}
