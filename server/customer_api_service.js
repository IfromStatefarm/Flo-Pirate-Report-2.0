import { verifyReportPolicy } from './report_policy.js';
import { permissionsFor, requirePermission, EVENT_PERMISSIONS } from './access_policy.js';
import { TEAM_OPERATIONS, validateTeamRequest } from '../utils/team_access.js';
import { validateCustomerAccessProfile } from '../utils/access_control.js';
import { validateCustomerConfig } from '../utils/customer_config.js';
import {
  CUSTOMER_EVENT_ATTRIBUTE_KEYS,
  CUSTOMER_EVENT_TYPES
} from '../contracts/customer_events.js';
import { ApiError, assert } from './api_error.js';
import { generatePDF } from './report_pdf.js';
import { authorizeEventPlatforms, effectivePlatforms, requireUrlPlatforms, statisticsPlatforms } from './platform_policy.js';
import { createGoogleOperations } from './integrations/google_operations.js';
import { readBearerToken } from './google_identity.js';

const MEMBER_ROLES = new Set(['employee', 'manager', 'admin']);
const MEMBER_ACTIONS = new Set(['approve', 'activate', 'reactivate', 'change_role', 'disable']);
const EVENT_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_TEXT = /^[^<>\u0000-\u001F\u007F]*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EVENT_TYPE_SET = new Set(CUSTOMER_EVENT_TYPES);
const TEXT_ATTRIBUTE_KEYS = new Set([
  'platform', 'handle', 'source_event_name', 'vertical', 'report_id', 'mode',
  'content_type', 'domain', 'notes', 'run_id', 'outcome', 'previous_status',
  'new_status', 'reason', 'start_date', 'end_date'
]);
const URL_ATTRIBUTE_KEYS = new Set(['target_url', 'pdf_url', 'channel_url', 'evidence_url']);
const INTEGER_ATTRIBUTE_KEYS = new Set([
  'url_count', 'estimated_views', 'scout_points', 'enforcer_points', 'row_index',
  'start_row', 'duration_ms', 'network_observation_count', 'embedded_video_count',
  'iframe_count', 'email_count', 'checked_count', 'resolved_count', 'active_count'
]);


function exactObject(value, keys, path = 'request') {
  assert(value && typeof value === 'object' && !Array.isArray(value), 400, 'invalid_request', `${path} must be an object.`);
  const allowed = new Set(keys);
  const extra = Object.keys(value).find((key) => !allowed.has(key));
  assert(!extra, 400, 'invalid_request', `${path}.${extra} is not supported.`);
  const missing = keys.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  assert(!missing, 400, 'invalid_request', `${path}.${missing} is required.`);
  return value;
}

function safeText(value, path, maxLength = 240) {
  assert(typeof value === 'string', 400, 'invalid_request', `${path} must be text.`);
  const text = value.trim().replace(/\s+/g, ' ');
  assert(text.length <= maxLength && SAFE_TEXT.test(value) && !/^[=+]/.test(text), 400, 'invalid_request', `${path} is unsafe or oversized.`);
  return text;
}

function safeUrl(value, path, { httpsOnly = false } = {}) {
  try {
    const parsed = new URL(String(value || '').trim());
    assert(
      (httpsOnly ? parsed.protocol === 'https:' : ['http:', 'https:'].includes(parsed.protocol)) &&
        !parsed.username && !parsed.password && !parsed.hash,
      400,
      'invalid_event',
      `${path} must be a credential-free web URL.`
    );
    return parsed.href;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'invalid_event', `${path} must be a credential-free web URL.`);
  }
}

function validateEventAttributes(eventType, attributes) {
  const allowed = new Set(CUSTOMER_EVENT_ATTRIBUTE_KEYS[eventType] || []);
  const extra = Object.keys(attributes).find((key) => !allowed.has(key));
  assert(!extra, 400, 'invalid_event', `attributes.${extra} is not supported for ${eventType}.`);
  const output = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === '') continue;
    if (TEXT_ATTRIBUTE_KEYS.has(key)) {
      output[key] = safeText(value, `attributes.${key}`, key === 'notes' ? 2000 : 240);
    } else if (URL_ATTRIBUTE_KEYS.has(key)) {
      output[key] = safeUrl(value, `attributes.${key}`, { httpsOnly: key !== 'target_url' });
    } else if (INTEGER_ATTRIBUTE_KEYS.has(key)) {
      const minimum = ['scout_points', 'enforcer_points'].includes(key) ? -1000000 : 0;
      assert(Number.isSafeInteger(value) && value >= minimum && value <= 1000000000, 400, 'invalid_event', `attributes.${key} is invalid.`);
      output[key] = value;
    } else if (key === 'urls') {
      assert(Array.isArray(value) && value.length >= 1 && value.length <= 100, 400, 'invalid_event', 'attributes.urls must contain 1-100 URLs.');
      output.urls = value.map((url, index) => safeUrl(url, `attributes.urls.${index}`));
    }
  }
  return output;
}


function customerProfile(resolution, now) {
  const configResult = validateCustomerConfig(resolution.customerConfig);
  assert(configResult.valid, 500, 'configuration_error', 'The stored customer configuration is invalid.');
  const config = configResult.config;
  const member = resolution.member;
  assert(config.access.enabledRoles.includes(member.role), 403, 'role_disabled', 'The member role is disabled for this customer.');
  const issuedAt = now();
  const profile = {
    schemaVersion: 1,
    customerId: config.customerId,
    userId: member.memberId,
    configVersion: config.configVersion,
    email: member.email,
    name: member.name,
    role: member.role,
    permissions: resolution.managementOnly ? ['settings.adminAccess'] : resolution.overCap ? ['settings.adminAccess', 'settings.coreConnectivity'] : permissionsFor(config, member.role),
    platforms: effectivePlatforms(config, member.platforms),
    theme: {
      ...config.product,
      logoUrl: config.theme.logoUrl,
      logoAltText: config.theme.logoAltText,
      assistantImageUrl: config.theme.assistantImageUrl,
      easterEggImageUrl: config.theme.easterEggImageUrl,
      colors: config.theme.colors
    },
    legal: config.legal,
    integrations: {
      driveRootFolderId: config.destinations.driveRootFolderId,
      reportSpreadsheetId: config.destinations.reportSpreadsheetId,
      eventSpreadsheetId: config.destinations.eventSpreadsheetId,
      statsDashboardId: config.stats.dashboardId
    },
    issuedAt,
    expiresAt: Math.min(issuedAt + (10 * 60 * 1000), resolution.entitlementExpiresAt)
  };
  const validation = validateCustomerAccessProfile(profile, { expectedEmail: member.email, now: issuedAt });
  assert(validation.valid, 500, 'configuration_error', 'The server generated an invalid customer profile.');
  return validation.profile;
}

function validateBootstrapRequest(body, identity, allowedExtensionIds) {
  exactObject(body, ['protocolVersion', 'identity', 'extension']);
  assert(body.protocolVersion === 1, 400, 'invalid_request', 'Unsupported bootstrap protocol.');
  exactObject(body.identity, ['email'], 'identity');
  exactObject(body.extension, ['id', 'version'], 'extension');
  const hintedEmail = safeText(body.identity.email, 'identity.email', 254).toLowerCase();
  assert(hintedEmail === identity.email, 401, 'identity_error', 'The requested email does not match the verified Google identity.');
  const extensionId = safeText(body.extension.id, 'extension.id', 256);
  assert(allowedExtensionIds.has(extensionId), 403, 'extension_not_allowed', 'This extension build is not authorized to use the customer API.');
  safeText(body.extension.version, 'extension.version', 32);
}

function validateMembershipRequest(body) {
  if (body.operation === 'list_members') {
    exactObject(body, ['protocolVersion', 'operation', 'query']);
    return { operation: body.operation, query: safeText(body.query, 'query', 120) };
  }
  exactObject(body, ['protocolVersion', 'operation', 'mutation']);
  assert(body.operation === 'mutate_membership', 400, 'invalid_request', 'Unsupported membership operation.');
  const mutation = body.mutation;
  assert(mutation && typeof mutation === 'object' && !Array.isArray(mutation), 400, 'invalid_request', 'mutation must be an object.');
  const action = safeText(mutation.action, 'mutation.action', 32);
  assert(MEMBER_ACTIONS.has(action), 400, 'invalid_request', 'Unsupported membership action.');
  const requiresRole = action !== 'disable';
  exactObject(mutation, requiresRole ? ['action', 'memberId', 'expectedVersion', 'role'] : ['action', 'memberId', 'expectedVersion'], 'mutation');
  const memberId = safeText(mutation.memberId, 'mutation.memberId', 128);
  assert(EVENT_ID.test(memberId), 400, 'invalid_request', 'Invalid member ID.');
  assert(Number.isSafeInteger(mutation.expectedVersion) && mutation.expectedVersion >= 1, 400, 'invalid_request', 'Invalid membership version.');
  const role = requiresRole ? safeText(mutation.role, 'mutation.role', 32) : undefined;
  if (requiresRole) assert(MEMBER_ROLES.has(role), 400, 'invalid_request', 'Unsupported membership role.');
  return { operation: body.operation, mutation: { action, memberId, expectedVersion: mutation.expectedVersion, ...(role ? { role } : {}) } };
}

function validateDataRequest(body, currentTime) {
  assert(body?.protocol_version === 1, 400, 'invalid_request', 'Unsupported customer-data protocol.');
  if (body.operation === 'record_event') {
    exactObject(body, ['protocol_version', 'operation', 'event']);
    exactObject(body.event, ['event_id', 'customer_id', 'user_id', 'event_type', 'occurred_at', 'attributes'], 'event');
    assert(EVENT_ID.test(String(body.event.event_id || '')) && !String(body.event.event_id).startsWith('sys_'), 400, 'invalid_event', 'Invalid event ID.');
    assert(Number.isSafeInteger(body.event.occurred_at) && body.event.occurred_at > 0, 400, 'invalid_event', 'Invalid event timestamp.');
    assert(body.event.occurred_at <= currentTime + (5 * 60 * 1000), 400, 'invalid_event', 'Event timestamp is too far in the future.');
    assert(body.event.attributes && typeof body.event.attributes === 'object' && !Array.isArray(body.event.attributes), 400, 'invalid_event', 'Invalid event attributes.');
    assert(EVENT_TYPE_SET.has(body.event.event_type), 400, 'invalid_event', 'Unsupported event type.');
    return {
      operation: body.operation,
      event: {
        ...body.event,
        attributes: validateEventAttributes(body.event.event_type, body.event.attributes)
      }
    };
  }
  exactObject(body, ['protocol_version', 'operation', 'customer_id', 'user_id', 'query_type', 'query']);
  assert(['query_statistics', 'query_legacy_statistics'].includes(body.operation), 400, 'invalid_request', 'Unsupported customer-data operation.');
  assert(['scoreboard', 'intelligence'].includes(body.query_type), 400, 'invalid_query', 'Unsupported statistics query.');
  if (body.query_type === 'scoreboard') {
    exactObject(body.query, ['dashboard_id', 'period'], 'query');
    assert(body.query.period === 'current_month', 400, 'invalid_query', 'Unsupported scoreboard period.');
    body.query = {
      dashboard_id: safeText(body.query.dashboard_id, 'query.dashboard_id', 128),
      period: 'current_month'
    };
  } else {
    exactObject(body.query, ['dashboard_id', 'start_date', 'end_date', 'platforms'], 'query');
    assert(ISO_DATE.test(body.query.start_date) && ISO_DATE.test(body.query.end_date), 400, 'invalid_query', 'Statistics dates must use YYYY-MM-DD.');
    const start = new Date(`${body.query.start_date}T00:00:00.000Z`);
    const end = new Date(`${body.query.end_date}T23:59:59.999Z`);
    assert(!Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf()) && start <= end &&
      start.toISOString().slice(0, 10) === body.query.start_date && end.toISOString().slice(0, 10) === body.query.end_date &&
      end - start <= 366 * 86400000, 400, 'invalid_query', 'Statistics require a valid date range of at most 366 days.');
    assert(Array.isArray(body.query.platforms) && body.query.platforms.length <= 100, 400, 'invalid_query', 'Statistics platforms must be a bounded list.');
    body.query = {
      dashboard_id: safeText(body.query.dashboard_id, 'query.dashboard_id', 128),
      start_date: body.query.start_date,
      end_date: body.query.end_date,
      platforms: body.query.platforms.map((platform, index) => safeText(platform, `query.platforms.${index}`, 64))
    };
  }
  return body;
}

export function createCustomerApiService({
  repository,
  verifyIdentity,
  reportPolicy,
  now = () => Date.now(),
  allowedExtensionIds = new Set(String(process.env.ALLOWED_EXTENSION_IDS || '').split(',').map((value) => value.trim()).filter(Boolean))
}) {
  async function bootstrap(request, body) {
    const identity = await verifyIdentity(request);
    validateBootstrapRequest(body, identity, allowedExtensionIds);
    const resolution = await repository.resolveActiveMembership(identity);
    if (resolution.count === 0) throw new ApiError(403, 'not_a_member', 'No active customer membership was found.');
    if (resolution.count !== 1) throw new ApiError(409, 'ambiguous_customer', 'The Google identity resolves to more than one active customer.');
    return { profile: customerProfile(resolution, now) };
  }

  async function memberships(request, body) {
    const identity = await verifyIdentity(request);
    assert(body?.protocolVersion === 1, 400, 'invalid_request', 'Unsupported membership protocol.');
    if (TEAM_OPERATIONS.includes(body.operation)) {
      let parsed;
      try { parsed = validateTeamRequest(body); }
      catch (error) { throw new ApiError(400, 'invalid_request', error.message); }
      return repository.teamOperation(identity, parsed);
    }
    const parsed = validateMembershipRequest(body);
    const actor = await repository.requireAdministrator(identity);
    if (parsed.operation === 'list_members') return repository.listMembers(actor, parsed.query);
    return repository.mutateMembership(actor, parsed.mutation, now());
  }

  async function data(request, body) {
    const identity = await verifyIdentity(request);
    if (body?.operation === 'google_operation') {
      exactObject(body, ['protocol_version','operation','command']);
      assert(body.protocol_version === 1,400,'invalid_request','Unsupported operation protocol.');
      const actor = await repository.requireActiveMember(identity);
      return createGoogleOperations({repository}).execute(actor,body.command,readBearerToken(request));
    }
    if(body?.operation==='finalize_report_batch') {
      exactObject(body,['protocol_version','operation','batch']);
      assert(body.protocol_version===1,400,'invalid_request','Unsupported report protocol.');
      const batch=body.batch;
      exactObject(batch,['batchId','reports'],'batch');
      assert(typeof batch.batchId==='string' && EVENT_ID.test(batch.batchId),400,'invalid_report','Invalid batch ID.');
      assert(Array.isArray(batch.reports) && batch.reports.length>=1 && batch.reports.length<=100,400,'invalid_report','A batch requires 1–100 reports.');
      const reportIds=new Set(),eventIds=new Set();
      for(const report of batch.reports) {
        exactObject(report,['reportId','eventId','pdfUrl','mode','contentType'],'batch report');
        assert(typeof report.reportId==='string' && typeof report.eventId==='string' && EVENT_ID.test(report.reportId) && EVENT_ID.test(report.eventId),400,'invalid_report','Invalid report identifiers.');
        assert(!reportIds.has(report.reportId) && !eventIds.has(report.eventId),400,'invalid_report','Duplicate batch reports are not allowed.');
        reportIds.add(report.reportId);eventIds.add(report.eventId);
        report.pdfUrl=safeUrl(report.pdfUrl,'report.pdfUrl',{httpsOnly:true});
        assert(['scout','enforcer'].includes(report.mode) && ['Live','VOD','Clip'].includes(report.contentType),400,'invalid_report','Unsupported report mode or content type.');
      }
      const actor=await repository.requireActiveMember(identity);
      requirePermission(actor,'sidepanel.report');
      const result=await repository.finalizeReportBatch(actor,batch,now());
      await repository.claimIntegrationResources(actor);
      const {adapter}=await createGoogleOperations({repository}).adapterFor(actor,readBearerToken(request));
      for(const report of result.reports) await repository.projectReport(actor,report.reportId,(value,options)=>adapter.projectReport(value,options));
      return result;
    }
    if (body?.operation === 'generate_report') {
      exactObject(body, ['protocol_version', 'operation', 'report']);
      assert(body.protocol_version === 1, 400, 'invalid_request', 'Unsupported report protocol.');
      const report = body.report;
      exactObject(report, ['reportId', 'eventId', 'eventName', 'vertical', 'handle', 'items'], 'report');
      assert(typeof report.reportId === 'string' && typeof report.eventId === 'string' && EVENT_ID.test(report.reportId) && EVENT_ID.test(report.eventId), 400, 'invalid_report', 'Invalid report identifier.');
      for (const key of ['eventName', 'vertical', 'handle']) report[key] = safeText(report[key], `report.${key}`, 160);
      assert(Array.isArray(report.items) && report.items.length > 0 && report.items.length <= 100, 400, 'invalid_report', 'Reports require 1–100 evidence items.');
      for (const item of report.items) {
        exactObject(item, ['url', 'screenshotLink', 'views'], 'evidence');
        for (const key of ['url', 'screenshotLink']) {
          assert(typeof item[key] === 'string' && item[key].length <= 2048, 400, 'invalid_report', 'Invalid evidence URL.');
          if (key === 'screenshotLink' && !item[key]) continue;
          let url; try { url = new URL(item[key]); } catch { throw new ApiError(400, 'invalid_report', 'Invalid evidence URL.'); }
          assert(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 400, 'invalid_report', 'Evidence links must use HTTP or HTTPS without credentials.');
        }
        item.views = safeText(item.views, 'evidence.views', 40);
      }
      const actor = await repository.requireActiveMember(identity);
      requirePermission(actor, 'sidepanel.report');
      requireUrlPlatforms(actor, report.items.map(item => item.url));
      const policy = reportPolicy ? await reportPolicy(actor, report) : await (async () => {
        await repository.claimIntegrationResources(actor);
        const {adapter} = await createGoogleOperations({repository}).adapterFor(actor,readBearerToken(request));
        return verifyReportPolicy(actor,report,adapter);
      })();
      return repository.generateReport(actor, report, generatePDF, policy);
    }
    const parsed = validateDataRequest(body, now());
    const actor = await repository.requireActiveMember(identity);
    if (parsed.operation === 'record_event') {
      assert(parsed.event.customer_id === actor.customerId && parsed.event.user_id === actor.memberId, 403, 'scope_mismatch', 'Event scope does not match the verified identity.');
      requirePermission(actor, EVENT_PERMISSIONS[parsed.event.event_type]);
      authorizeEventPlatforms(actor, parsed.event);
      const accepted=await repository.recordEvent(actor, parsed.event, now());
      if(parsed.event.event_type==='report.submitted') {
        await repository.claimIntegrationResources(actor);
        const {adapter}=await createGoogleOperations({repository}).adapterFor(actor,readBearerToken(request));
        await repository.projectReport(actor,parsed.event.attributes.report_id,(report,options)=>adapter.projectReport(report,options));
      }
      return accepted;
    }
    assert(parsed.customer_id === actor.customerId && parsed.user_id === actor.memberId, 403, 'scope_mismatch', 'Statistics scope does not match the verified identity.');
    requirePermission(actor, parsed.query_type === 'scoreboard' ? 'sidepanel.scoreboard' : 'sidepanel.intel');
    // Empty filters mean the actor's scope, never unrestricted customer data.
    parsed.query.platforms = statisticsPlatforms(actor, parsed.query.platforms);
    if(parsed.operation==='query_legacy_statistics') {
      assert(parsed.query.dashboard_id===actor.customerConfig.stats.dashboardId,403,'scope_mismatch','Invalid dashboard.');
      await repository.claimIntegrationResources(actor);
      const {adapter}=await createGoogleOperations({repository}).adapterFor({...actor,platforms:parsed.query.platforms},readBearerToken(request));
      const data=parsed.query_type==='scoreboard'?await adapter.fetchLeaderboardData(actor.email):await adapter.fetchIntelligenceData(parsed.query.start_date,parsed.query.end_date);
      assert(data,503,'legacy_unavailable','The independent legacy source is unavailable.');
      data._provenance={source:'google_sheets',version:1};
      return {protocol_version:1,customer_id:actor.customerId,user_id:actor.memberId,dashboard_id:parsed.query.dashboard_id,query_type:parsed.query_type,generated_at:now(),data};
    }
    return repository.queryStatistics(actor, parsed.query_type, parsed.query, now());
  }

  return Object.freeze({ bootstrap, memberships, data });
}
