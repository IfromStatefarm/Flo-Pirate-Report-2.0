import { PLATFORM_CATALOG } from './platform_catalog.js';

export const ACCESS_SHEET_ID = '1kp5n1F0cO57P3mbUsgmssXTRIQ3UPdkO6vOKUjV_XvY';
export const ACCESS_SHEET_GID = 0;
export const ACCESS_PROFILE_CACHE_KEY = 'tiered_access_profile';
export const ACCESS_SESSION_KEY = 'tiered_access_session';
export const ACCESS_PROFILE_CACHE_TTL_MS = 60 * 1000;

export const ACCESS_ROLES = Object.freeze({
  WAITING_APPROVAL: 'waiting_approval',
  EMPLOYEE: 'employee',
  MANAGER: 'manager',
  ADMIN: 'admin'
});

export const ACCESS_ROLE_OPTIONS = Object.freeze([
  ACCESS_ROLES.WAITING_APPROVAL,
  ACCESS_ROLES.EMPLOYEE,
  ACCESS_ROLES.MANAGER,
  ACCESS_ROLES.ADMIN
]);

export const ACCESS_ROLE_SHEET_VALUES = Object.freeze({
  [ACCESS_ROLES.EMPLOYEE]: 'Employee',
  [ACCESS_ROLES.ADMIN]: 'Admin',
  [ACCESS_ROLES.MANAGER]: 'Manager',
  [ACCESS_ROLES.WAITING_APPROVAL]: 'Waiting_Approval'
});

export const PERMISSIONS = Object.freeze({
  SIDEPANEL_REPORT: 'sidepanel.report',
  SIDEPANEL_SCOREBOARD: 'sidepanel.scoreboard',
  SIDEPANEL_AUTOMATE: 'sidepanel.automate',
  SIDEPANEL_INTEL: 'sidepanel.intel',
  SIDEPANEL_REPAIR: 'sidepanel.repair',
  SETTINGS_CORE_CONNECTIVITY: 'settings.coreConnectivity',
  SETTINGS_OPEN_LOCKER: 'settings.openLocker',
  SETTINGS_FEEDBACK_COMMS: 'settings.feedbackComms',
  SETTINGS_INTELLIGENCE_TOOLS: 'settings.intelligenceTools',
  SETTINGS_BRIEFING_STATS: 'settings.briefingStats',
  SETTINGS_BRIEFING_CONTENT: 'settings.briefingContent',
  SETTINGS_SELECTOR_PATHS: 'settings.selectorPaths',
  SETTINGS_ADMIN_ACCESS: 'settings.adminAccess'
});

const EMPLOYEE_PERMISSIONS = Object.freeze([
  PERMISSIONS.SIDEPANEL_REPORT,
  PERMISSIONS.SIDEPANEL_SCOREBOARD,
  PERMISSIONS.SETTINGS_CORE_CONNECTIVITY,
  PERMISSIONS.SETTINGS_FEEDBACK_COMMS
]);

const MANAGER_PERMISSIONS = Object.freeze([
  ...EMPLOYEE_PERMISSIONS,
  PERMISSIONS.SIDEPANEL_AUTOMATE,
  PERMISSIONS.SIDEPANEL_INTEL,
  PERMISSIONS.SETTINGS_OPEN_LOCKER,
  PERMISSIONS.SETTINGS_INTELLIGENCE_TOOLS,
  PERMISSIONS.SETTINGS_BRIEFING_STATS,
  PERMISSIONS.SETTINGS_BRIEFING_CONTENT
]);

export const ROLE_PERMISSIONS = Object.freeze({
  [ACCESS_ROLES.WAITING_APPROVAL]: Object.freeze([]),
  [ACCESS_ROLES.EMPLOYEE]: EMPLOYEE_PERMISSIONS,
  [ACCESS_ROLES.MANAGER]: MANAGER_PERMISSIONS,
  [ACCESS_ROLES.ADMIN]: Object.freeze([
    ...MANAGER_PERMISSIONS,
    PERMISSIONS.SIDEPANEL_REPAIR,
    PERMISSIONS.SETTINGS_SELECTOR_PATHS,
    PERMISSIONS.SETTINGS_ADMIN_ACCESS
  ])
});

const PLATFORM_KEY_ALIASES = new Map();
PLATFORM_CATALOG.forEach((entry) => {
  PLATFORM_KEY_ALIASES.set(entry.key, entry.key);
  PLATFORM_KEY_ALIASES.set(entry.label.toLowerCase(), entry.key);
});
PLATFORM_KEY_ALIASES.set('x', 'twitter');
PLATFORM_KEY_ALIASES.set('x / twitter', 'twitter');
PLATFORM_KEY_ALIASES.set('other', 'other');

export function normalizeAccessEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizeAccessUsername(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeAccessMiddleName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeAccessRole(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  return ACCESS_ROLE_OPTIONS.includes(normalized)
    ? normalized
    : ACCESS_ROLES.WAITING_APPROVAL;
}

export function formatAccessRole(role) {
  return ACCESS_ROLE_SHEET_VALUES[normalizeAccessRole(role)];
}

export function normalizeAccessPlatform(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'all' || normalized === '*') return 'all';
  return PLATFORM_KEY_ALIASES.get(normalized) || '';
}

export function normalizeAccessPlatforms(value) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,;]+/);

  const normalized = rawValues
    .map(normalizeAccessPlatform)
    .filter(Boolean);

  if (normalized.includes('all')) return ['all'];
  return [...new Set(normalized)].sort();
}

export function formatAccessPlatforms(value) {
  return normalizeAccessPlatforms(value).join(',');
}

export function hasPermission(profile, permission) {
  if (!profile || profile.status !== 'ready') return false;
  const role = normalizeAccessRole(profile.role);
  return ROLE_PERMISSIONS[role]?.includes(permission) || false;
}

export function hasPlatformAccess(profile, platform) {
  if (!profile || profile.status !== 'ready') return false;
  const requestedPlatform = normalizeAccessPlatform(platform);
  if (!requestedPlatform) return false;
  const allowedPlatforms = normalizeAccessPlatforms(profile.platforms);
  return allowedPlatforms.includes('all') || allowedPlatforms.includes(requestedPlatform);
}

export function getPermissionsForRole(role) {
  return [...(ROLE_PERMISSIONS[normalizeAccessRole(role)] || [])];
}

export function toPublicAccessProfile(profile) {
  if (!profile) return null;
  const managedConfig = profile.managedConfig || {};
  return {
    rowNumber: Number(profile.rowNumber) || null,
    name: String(profile.name || ''),
    firstName: String(profile.firstName || '').trim().replace(/\s+/g, ' '),
    lastName: String(profile.lastName || '').trim().replace(/\s+/g, ' '),
    middleName: String(profile.middleName || '').trim().replace(/\s+/g, ' '),
    email: normalizeAccessEmail(profile.email),
    role: normalizeAccessRole(profile.role),
    platforms: normalizeAccessPlatforms(profile.platforms),
    status: profile.status || 'registry_error',
    permissions: getPermissionsForRole(profile.role),
    managedConfig: {
      driveRootId: String(managedConfig.driveRootId || '').trim(),
      driveRootLabel: String(managedConfig.driveRootLabel || '').trim(),
      reportSheetId: String(managedConfig.reportSheetId || '').trim(),
      reportSheetLabel: String(managedConfig.reportSheetLabel || '').trim(),
      eventSheetId: String(managedConfig.eventSheetId || '').trim(),
      eventSheetLabel: String(managedConfig.eventSheetLabel || '').trim()
    },
    loadedAt: Number(profile.loadedAt) || Date.now()
  };
}

export function roleLabel(role) {
  return formatAccessRole(role);
}

export function isSafeSheetText(value) {
  const normalized = String(value || '').trim();
  return Boolean(normalized) && !/^[=+@]/.test(normalized);
}
