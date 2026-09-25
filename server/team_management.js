import crypto from 'node:crypto';
import { permissionsFor } from './access_policy.js';
import { assert } from './api_error.js';
import { TEAM_ROLES } from '../utils/team_access.js';

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicMember = row => ({ memberId: row.member_id, email: row.email, name: row.name, role: row.role, status: row.status, version: Number(row.version), awaitingSignIn: row.status === 'active' && !row.google_subject });
const summary = row => row ? { email: row.email, role: row.role, status: row.status } : null;
const rosterHash = rows => digest(rows.map(r => [r.member_id, r.email, r.role, r.status, Number(r.version)]).sort((a,b) => a[0].localeCompare(b[0])));

export function teamUtilization(rows, config) {
  const active = rows.filter(r => r.status === 'active');
  return {
    activeUsers: { used: active.length, limit: config.access.totalUserCap },
    roles: Object.fromEntries(TEAM_ROLES.map(role => [role, { used: active.filter(r => r.role === role).length, limit: config.access.roleSeatCaps[role], enabled: config.access.enabledRoles.includes(role) }]))
  };
}

export function projectTeamChanges(rows, changes, config, managementOnly = false) {
  const before = teamUtilization(rows, config);
  const projected = rows.map(row => ({ ...row }));
  const updates = [];
  for (const change of changes) {
    assert(!managementOnly || change.action === 'disable', 403, 'team_read_only', 'This subscription allows viewing and deactivation only. Contact Ivan to renew.');
    let target;
    if (change.action === 'add') {
      assert(!projected.some(r => r.email.toLowerCase() === change.email), 409, 'email_unavailable', 'An address is already registered. Refresh the directory or contact Ivan.');
      target = { member_id: `member_${crypto.randomUUID().replaceAll('-', '')}`, email: change.email, name: change.name, role: change.role, status: 'active', version: 1, google_subject: null };
      projected.push(target);
    } else {
      target = projected.find(r => r.member_id === change.memberId);
      assert(target, 404, 'member_not_found', 'A selected person is no longer available.');
      assert(Number(target.version) === change.expectedVersion, 409, 'stale_member_version', 'A selected membership changed. Refresh and review again.');
      const valid = change.action === 'disable' ? target.status !== 'disabled'
        : change.action === 'change_role' ? target.status === 'active'
        : change.action === 'reactivate' ? target.status === 'disabled'
        : ['pending', 'approved'].includes(target.status);
      assert(valid, 409, 'invalid_transition', 'The selected action does not match this person’s current access.');
    }
    const old = change.action === 'add' ? null : { ...target };
    target.role = change.role || target.role;
    target.status = change.action === 'disable' ? 'disabled' : 'active';
    if (old) target.version = Number(target.version) + 1;
    if (target.status === 'active') {
      assert(config.access.enabledRoles.includes(target.role), 409, 'role_disabled', 'This role is not included in the package.');
      assert(config.access.allowedEmailDomains.includes(target.email.toLowerCase().split('@')[1]), 409, 'domain_not_allowed', 'An email domain is not approved for this customer.');
    }
    updates.push({ action: change.action, before: old, after: { ...target } });
  }
  const after = teamUtilization(projected, config);
  assert(after.roles.admin.used >= 1, 409, 'final_admin_required', 'Keep at least one active administrator.');
  const oldCounts = [before.activeUsers, ...TEAM_ROLES.map(r => before.roles[r])];
  const newCounts = [after.activeUsers, ...TEAM_ROLES.map(r => after.roles[r])];
  const overage = c => Math.max(0, c.used - c.limit);
  const wasOver = oldCounts.some(c => overage(c) > 0);
  const fits = newCounts.every(c => !overage(c));
  const improves = wasOver && newCounts.every((c,i) => overage(c) <= overage(oldCounts[i])) && newCounts.some((c,i) => overage(c) < overage(oldCounts[i]));
  assert(fits || improves, 409, 'seat_limit_exceeded', 'This change exceeds purchased seats. Free capacity or reduce an existing overage.', { utilization: before });
  return { updates, before, after };
}

export function createTeamManagement({ transact, resolveInside }) {
  return async function teamOperation(identity, body) {
    return transact(async client => {
      // The customer lock serializes roster and subscription changes.
      const actor = await resolveInside(client, identity, { permission: 'settings.adminAccess', allowOverCap: true, allowManagement: true });
      const envelope = { protocolVersion: 1, customerId: actor.customerId, configVersion: actor.configVersion };
      if (body.operation === 'team_list') {
        const values = [actor.customerId, body.cursor, body.query, body.role, body.status];
        const result = await client.query(`SELECT member_id,email,name,role,status,version,google_subject IS NOT NULL AS signed_in
          FROM customer_memberships WHERE customer_id=$1 AND lower(email)>$2
          AND ($3='' OR strpos(lower(email),lower($3))>0 OR strpos(lower(name),lower($3))>0)
          AND ($4='' OR role=$4) AND ($5='' OR status=$5)
          ORDER BY lower(email) LIMIT 51`, values);
        const rows = (await client.query('SELECT role,status FROM customer_memberships WHERE customer_id=$1', [actor.customerId])).rows;
        const page = result.rows.slice(0, 50);
        return { ...envelope, members: page.map(r => publicMember({ ...r, google_subject: r.signed_in })), nextCursor: result.rows.length > 50 ? page.at(-1).email.toLowerCase() : '', utilization: teamUtilization(rows, actor.customerConfig), subscription: { state: actor.subscriptionState, managementOnly: actor.managementOnly, paidThrough: actor.subscriptionPaidThrough }, allowedDomains: actor.customerConfig.access.allowedEmailDomains };
      }
      if (body.operation === 'team_history') {
        const cursor = body.cursor ? JSON.parse(body.cursor) : null;
        const rows = (await client.query(`SELECT audit_id,actor_email,action,before_state,after_state,occurred_at,occurred_at::text AS page_time FROM membership_audit
          WHERE customer_id=$1 AND ($2::timestamptz IS NULL OR (occurred_at,audit_id)<($2::timestamptz,$3))
          ORDER BY occurred_at DESC,audit_id DESC LIMIT 51`, [actor.customerId, cursor?.[0] || null, cursor?.[1] || ''])).rows;
        const page = rows.slice(0,50);
        return { ...envelope, entries: page.map(r => ({ auditId: r.audit_id, actorEmail: r.actor_email, action: r.action, before: summary(r.before_state), after: summary(r.after_state), occurredAt: r.occurred_at.toISOString() })), nextCursor: rows.length > 50 ? JSON.stringify([page.at(-1).page_time,page.at(-1).audit_id]) : '' };
      }
      const stored = (await client.query('SELECT * FROM team_change_requests WHERE customer_id=$1 AND request_id=$2 FOR UPDATE', [actor.customerId, body.requestId])).rows[0];
      if (stored) assert(stored.actor_member_id === actor.memberId, 403, 'request_unavailable', 'This review is unavailable.');
      if (body.operation === 'team_commit' && stored?.result) return stored.result;
      if (body.operation === 'team_preview' && stored) {
        assert(stored.payload_hash === digest(body.changes), 409, 'idempotency_conflict', 'This request ID was already used for different changes.');
        assert(new Date(stored.expires_at).valueOf() > Date.now(), 409, 'review_expired', 'This review expired. Start a new review.');
        return stored.preview;
      }
      if (body.operation === 'team_commit') {
        assert(stored, 404, 'review_required', 'Review the changes before saving.');
        assert(new Date(stored.expires_at).valueOf() > Date.now(), 409, 'review_expired', 'This review expired. Start a new review.');
      } else {
        const count = (await client.query("SELECT count(*)::int AS n FROM team_change_requests WHERE customer_id=$1 AND actor_member_id=$2 AND created_at>now()-interval '1 hour'", [actor.customerId, actor.memberId])).rows[0].n;
        assert(count < 100, 429, 'rate_limited', 'Too many team reviews. Try again later.');
      }
      const rows = (await client.query('SELECT * FROM customer_memberships WHERE customer_id=$1 ORDER BY member_id FOR UPDATE', [actor.customerId])).rows;
      if (stored) assert(stored.roster_hash === rosterHash(rows) && stored.config_version === actor.configVersion, 409, 'stale_review', 'The team or package changed. Refresh and review again.');
      const changes = stored ? stored.changes : body.changes;
      // Duplicate checks are tenant-local. Looking up other tenants' emails here
      // would turn team administration into a membership enumeration endpoint.
      const projection = projectTeamChanges(rows, changes, actor.customerConfig, actor.managementOnly);
      const preview = { ...envelope, requestId: body.requestId, expiresAt: Date.now()+10*60000, before: projection.before, after: projection.after, changes: projection.updates.map(u => ({ action: u.action, before: summary(u.before), after: summary(u.after) })), affectsSelf: projection.updates.some(u => u.after.member_id === actor.memberId), grantsAdmin: projection.updates.some(u => u.after.role === 'admin' && u.after.status === 'active' && (u.before?.role !== 'admin' || u.before?.status !== 'active')) };
      if (body.operation === 'team_preview') {
        await client.query('INSERT INTO team_change_requests(customer_id,request_id,actor_member_id,payload_hash,changes,roster_hash,config_version,preview) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [actor.customerId, body.requestId, actor.memberId, digest(changes), JSON.stringify(changes), rosterHash(rows), actor.configVersion, preview]);
        return preview;
      }
      const occurredAt = new Date().toISOString();
      for (const update of projection.updates) {
        const row = update.after;
        if (update.action === 'add') {
          await client.query("INSERT INTO customer_memberships(member_id,customer_id,email,name,role,status) VALUES($1,$2,$3,$4,$5,'active')", [row.member_id, actor.customerId, row.email, row.name, row.role]);
        } else {
          await client.query('UPDATE customer_memberships SET role=$1,status=$2,version=$3,updated_at=now() WHERE customer_id=$4 AND member_id=$5', [row.role, row.status, row.version, actor.customerId, row.member_id]);
        }
        await client.query('INSERT INTO membership_audit(audit_id,customer_id,actor_member_id,actor_email,target_member_id,action,before_state,after_state,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [`audit_${crypto.randomUUID().replaceAll('-', '')}`, actor.customerId, actor.memberId, actor.email, row.member_id, update.action, summary(update.before) || {}, summary(row), occurredAt]);
      }
      const self = projection.updates.find(u => u.after.member_id === actor.memberId);
      const result = { ...envelope, requestId: body.requestId, changed: projection.updates.length, utilization: projection.after, accessChanged: Boolean(self), adminAccess: !self || (permissionsFor(actor.customerConfig, self.after.role).includes('settings.adminAccess') && self.after.status === 'active') };
      await client.query('UPDATE team_change_requests SET result=$3 WHERE customer_id=$1 AND request_id=$2', [actor.customerId, body.requestId, result]);
      return result;
    }, { isolation: 'SERIALIZABLE' });
  };
}
