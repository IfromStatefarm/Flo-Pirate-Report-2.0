// Shared customer permission vocabulary and built-in role policy.
// Seller/platform authority is deliberately outside this namespace.
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
  SIDEPANEL_ENFORCE: 'sidepanel.enforce',
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
  SETTINGS_GAMIFICATION: 'settings.gamification',
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
  PERMISSIONS.SIDEPANEL_ENFORCE,
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
    PERMISSIONS.SETTINGS_GAMIFICATION,
    PERMISSIONS.SETTINGS_ADMIN_ACCESS
  ])
});

// Feature entitlements narrow role grants; they never grant a role new powers.
export const FEATURE_PERMISSIONS = Object.freeze(Object.fromEntries(Object.entries({
  report: ['sidepanel.report', 'sidepanel.enforce', 'settings.coreConnectivity'],
  scoreboard: ['sidepanel.scoreboard'],
  automate: ['sidepanel.automate', 'settings.openLocker'],
  intel: ['sidepanel.intel', 'settings.intelligenceTools'],
  repair: ['sidepanel.repair'],
  feedback: ['settings.feedbackComms'],
  gamification: ['sidepanel.scoreboard', 'settings.gamification'],
  briefing: ['settings.briefingStats', 'settings.briefingContent'],
  selector_editor: ['settings.selectorPaths']
}).map(([feature, permissions]) => [feature, Object.freeze(permissions)])));

export const CONFIG_SECTION_PERMISSIONS = Object.freeze({
  verticals: PERMISSIONS.SETTINGS_INTELLIGENCE_TOOLS,
  platform_selectors: PERMISSIONS.SETTINGS_SELECTOR_PATHS,
  double_xp_settings: PERMISSIONS.SETTINGS_GAMIFICATION,
  gamification_levels: PERMISSIONS.SETTINGS_GAMIFICATION,
  community_highlights: PERMISSIONS.SETTINGS_BRIEFING_CONTENT,
  briefing_content: PERMISSIONS.SETTINGS_BRIEFING_CONTENT
});

// This resolver is the single replacement point for future persisted custom
// roles. Only trusted server configuration may supply role definitions.
export function getRolePermissions(role) {
  return Object.hasOwn(ROLE_PERMISSIONS, role) ? [...ROLE_PERMISSIONS[role]] : [];
}

export function resolvePermissions(config, role) {
  if (!config?.access?.enabledRoles?.includes(role)) return [];
  const enabled = new Set((config.capabilities?.enabledFeatures || [])
    .flatMap(feature => Object.hasOwn(FEATURE_PERMISSIONS, feature) ? FEATURE_PERMISSIONS[feature] : []));
  // Customer membership administration remains available for subscription recovery.
  enabled.add(PERMISSIONS.SETTINGS_ADMIN_ACCESS);
  return getRolePermissions(role).filter(permission => enabled.has(permission));
}
