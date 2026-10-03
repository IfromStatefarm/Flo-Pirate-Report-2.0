import { resolvePermissions } from '../utils/permission_policy.js';
import { assert } from './api_error.js';
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

export const permissionsFor = resolvePermissions;

export function canPerform(actor, permission) {
  return Boolean(actor &&
    (!(actor.managementOnly || actor.overCap) || permission === 'settings.adminAccess') &&
    permissionsFor(actor.customerConfig, actor.role).includes(permission));
}

export function requirePermission(actor, permission) {
  assert(canPerform(actor, permission), 403, 'not_authorized',
    'The verified member is not authorized for this customer operation.');
}

export function requireReportMode(actor, mode) {
  assert(['scout', 'enforcer'].includes(mode), 400, 'invalid_report', 'Unsupported report mode.');
  requirePermission(actor, 'sidepanel.report');
  if (mode === 'enforcer') requirePermission(actor, 'sidepanel.enforce');
}
