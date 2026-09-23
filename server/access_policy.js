import { getPermissionsForRole } from '../utils/access_control.js';
import { assert } from './api_error.js';
const FEATURE_PERMISSIONS = Object.freeze({
  report: new Set(['sidepanel.report', 'settings.coreConnectivity']),
  scoreboard: new Set(['sidepanel.scoreboard']),
  automate: new Set(['sidepanel.automate', 'settings.openLocker']),
  intel: new Set(['sidepanel.intel', 'settings.intelligenceTools']),
  repair: new Set(['sidepanel.repair']),
  feedback: new Set(['settings.feedbackComms']),
  gamification: new Set(['sidepanel.scoreboard']),
  briefing: new Set(['settings.briefingStats', 'settings.briefingContent']),
  selector_editor: new Set(['settings.selectorPaths'])
});
export const EVENT_PERMISSIONS = Object.freeze({
  'activity.item_added': 'sidepanel.report',
  'event.source_url_updated': 'sidepanel.report',
  'report.whitelist_penalty': 'sidepanel.report',
  'report.submitted': 'sidepanel.report',
  'report.intelligence_generated': 'sidepanel.intel',
  'rogue.evidence_logged': 'sidepanel.report',
  'automation.scan_started': 'sidepanel.automate',
  'automation.platform_outcome': 'sidepanel.automate',
  'automation.row_status_changed': 'sidepanel.automate',
  'automation.scan_completed': 'sidepanel.automate',
  'platform.report_outcome': 'sidepanel.report'
});

export function permissionsFor(config, role) {
  const enabledFeatures = new Set(config.capabilities.enabledFeatures);
  const featurePermissions = new Set(
    Object.entries(FEATURE_PERMISSIONS)
      .filter(([feature]) => enabledFeatures.has(feature))
      .flatMap(([, permissions]) => [...permissions])
  );
  if (role === 'admin') featurePermissions.add('settings.adminAccess');
  return getPermissionsForRole(role).filter((permission) => featurePermissions.has(permission));
}

export function requirePermission(actor, permission) {
  assert(
    permissionsFor(actor.customerConfig, actor.role).includes(permission),
    403,
    'not_authorized',
    'The verified member is not authorized for this customer operation.'
  );
}

