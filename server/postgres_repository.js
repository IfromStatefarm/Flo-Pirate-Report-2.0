import crypto from 'node:crypto';
import { ApiError, assert } from './api_error.js';
import { getPool, withTransaction } from './db.js';
import { validateCustomerConfig } from '../utils/customer_config.js';

function member(row) {
  return {
    memberId: row.member_id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    version: Number(row.version),
    platforms: row.platforms || []
  };
}

function domainAllowed(config, email) {
  const domain = String(email || '').toLowerCase().split('@')[1] || '';
  return config.access.allowedEmailDomains.includes(domain);
}

function identityRows(client, identity, { activeOnly = true, lock = false } = {}) {
  const statusClause = activeOnly ? "AND m.status = 'active'" : '';
  const lockClause = lock ? 'FOR UPDATE OF m, c' : '';
  return client.query(`
    SELECT m.*, c.config, c.config_version
    FROM customer_memberships m
    JOIN customers c ON c.customer_id = m.customer_id
    WHERE c.active = TRUE
      ${statusClause}
      AND (m.google_subject = $1 OR (m.google_subject IS NULL AND lower(m.email) = lower($2)))
    ${lockClause}
  `, [identity.subject, identity.email]);
}

async function resolveInside(client, identity, { requireAdmin = false } = {}) {
  const result = await identityRows(client, identity, { lock: true });
  if (result.rows.length === 0) throw new ApiError(403, 'not_a_member', 'No active customer membership was found.');
  if (result.rows.length !== 1) throw new ApiError(409, 'ambiguous_customer', 'The Google identity resolves to more than one active customer.');
  const row = result.rows[0];
  assert(row.email.toLowerCase() === identity.email, 401, 'identity_error', 'The verified Google email does not match the membership.');
  if (requireAdmin) assert(row.role === 'admin', 403, 'not_authorized', 'Only an active customer administrator may perform this operation.');
  if (!row.google_subject) {
    await client.query('UPDATE customer_memberships SET google_subject = $1, updated_at = now() WHERE member_id = $2', [identity.subject, row.member_id]);
  }
  const configResult = validateCustomerConfig(row.config);
  assert(configResult.valid, 500, 'configuration_error', 'Stored customer configuration is invalid.');
  assert(configResult.config.configVersion === Number(row.config_version), 500, 'configuration_error', 'Stored configuration versions do not match.');
  assert(configResult.config.access.enabledRoles.includes(row.role), 403, 'role_disabled', 'The member role is disabled for this customer.');
  assert(domainAllowed(configResult.config, row.email), 403, 'domain_not_allowed', 'The membership email domain is not approved for this customer.');
  return {
    customerId: row.customer_id,
    memberId: row.member_id,
    googleSubject: identity.subject,
    email: row.email,
    name: row.name,
    role: row.role,
    configVersion: Number(row.config_version),
    customerConfig: configResult.config
  };
}

async function utilization(client, customerConfig) {
  const counts = await client.query(`
    SELECT role, count(*)::int AS used
    FROM customer_memberships
    WHERE customer_id = $1 AND status = 'active'
    GROUP BY role
  `, [customerConfig.customerId]);
  const used = Object.fromEntries(counts.rows.map((row) => [row.role, Number(row.used)]));
  const activeUsers = Object.values(used).reduce((sum, value) => sum + value, 0);
  return {
    activeUsers: { used: activeUsers, limit: customerConfig.access.totalUserCap },
    roles: Object.fromEntries(['employee', 'manager', 'admin'].map((role) => [role, {
      used: used[role] || 0,
      limit: customerConfig.access.roleSeatCaps[role],
      enabled: customerConfig.access.enabledRoles.includes(role)
    }]))
  };
}

function errorWithUtilization(code, message, currentUtilization) {
  throw new ApiError(409, code, message, { utilization: currentUtilization });
}

export function enforceMembershipPolicy(members, target, mutation, config, currentUtilization) {
  const nextRole = mutation.role || target.role;
  const nextStatus = mutation.action === 'disable' ? 'disabled' : 'active';
  assert(config.access.enabledRoles.includes(nextRole), 409, 'role_disabled', 'The selected role is disabled.');
  if (nextStatus === 'active') {
    assert(domainAllowed(config, target.email), 409, 'domain_not_allowed', 'The member email domain is not approved for this customer.');
  }
  const projected = members.map((row) => row.member_id === target.member_id ? { ...row, role: nextRole, status: nextStatus } : row);
  const active = projected.filter((row) => row.status === 'active');
  if (active.length > config.access.totalUserCap) {
    errorWithUtilization('total_user_cap_exceeded', 'The active-user cap would be exceeded.', currentUtilization);
  }
  if (active.filter((row) => row.role === nextRole).length > config.access.roleSeatCaps[nextRole]) {
    errorWithUtilization('role_seat_cap_exceeded', 'The role seat cap would be exceeded.', currentUtilization);
  }
  if (active.filter((row) => row.role === 'admin').length === 0) {
    errorWithUtilization('final_admin_required', 'The customer must retain an active administrator.', currentUtilization);
  }
  return { nextRole, nextStatus };
}

function rank(points, kind) {
  if (points > 1000) return `Level 3 ${kind}`;
  if (points > 500) return `Level 2 ${kind}`;
  return `Level 1 ${kind}`;
}

function scoreboard(events, actor) {
  const users = new Map();
  let teamTotal = 0;
  for (const row of events) {
    const attributes = row.attributes || {};
    const current = users.get(row.user_id) || { name: row.member_name || row.user_id, scout: 0, enforcer: 0 };
    current.scout += Number(attributes.scout_points || 0);
    current.enforcer += Number(attributes.enforcer_points || 0);
    users.set(row.user_id, current);
    if (row.event_type === 'report.submitted') teamTotal += Number(attributes.url_count || attributes.urls?.length || 1);
  }
  const rows = [...users.entries()].map(([userId, value]) => ({ userId, ...value, total: value.scout + value.enforcer }));
  const topScouts = [...rows].sort((a, b) => b.scout - a.scout).slice(0, 10).map((row) => ({ name: row.name, points: row.scout }));
  const topEnforcers = [...rows].sort((a, b) => b.enforcer - a.enforcer).slice(0, 10).map((row) => ({ name: row.name, points: row.enforcer }));
  const overallLeaderboard = [...rows].sort((a, b) => b.total - a.total).slice(0, 10).map((row) => ({ name: row.name, points: row.total }));
  const own = rows.find((row) => row.userId === actor.memberId) || { scout: 0, enforcer: 0, total: 0 };
  const mvpRow = [...rows].sort((a, b) => b.total - a.total)[0];
  return {
    scoutPoints: own.scout,
    enforcerPoints: own.enforcer,
    scoutRank: rank(own.scout, 'Scout Reporter'),
    enforcerRank: rank(own.enforcer, 'Enforcer'),
    teamTotal,
    topScouts,
    topEnforcers,
    overallLeaderboard,
    mvp: { name: mvpRow?.name || 'TBD', points: mvpRow?.total || 0 },
    isCurrentMvp: Boolean(mvpRow && mvpRow.userId === actor.memberId)
  };
}

function intelligence(events, query) {
  const reports = events.filter((row) => row.event_type === 'report.submitted');
  const byPlatform = new Map();
  const byEvent = new Map();
  const byTarget = new Map();
  const byUser = new Map();
  const timelineData = {};
  let totalUrls = 0;
  for (const row of reports) {
    const a = row.attributes || {};
    const urlCount = Number(a.url_count || a.urls?.length || 1);
    const views = Number(a.estimated_views || 0);
    const platform = String(a.platform || 'other').toLowerCase();
    const eventName = String(a.source_event_name || 'Unknown Event');
    const handle = String(a.handle || 'Unknown').replace(/^@/, '');
    const date = new Date(row.occurred_at).toISOString().slice(0, 10);
    totalUrls += urlCount;
    const p = byPlatform.get(platform) || { name: platform, reports: 0, urls: 0 };
    p.reports += 1; p.urls += urlCount; byPlatform.set(platform, p);
    const ev = byEvent.get(eventName) || { name: eventName, views: 0 };
    ev.views += views; byEvent.set(eventName, ev);
    const target = byTarget.get(handle) || { handle, reports: 0, urls: 0, platforms: new Set() };
    target.reports += 1; target.urls += urlCount; target.platforms.add(platform); byTarget.set(handle, target);
    const user = byUser.get(row.user_id) || { name: row.member_name || row.user_id, scout: 0, enforced: 0, urlsResolved: 0, resolvedPct: 0, wBurndown: 0, uwBurndown: 0, days: new Set() };
    user.scout += Number(a.scout_points || 0); user.enforced += Number(a.enforcer_points || 0); user.days.add(date); byUser.set(row.user_id, user);
    timelineData[date] = { count: Number(timelineData[date]?.count || 0) + 1 };
  }
  const topPirates = [...byTarget.values()].map((item) => ({ ...item, platforms: [...item.platforms].join(', ') })).sort((a, b) => b.urls - a.urls);
  const topPiratesByPlatform = {};
  for (const target of topPirates) for (const platform of target.platforms.split(', ').filter(Boolean)) (topPiratesByPlatform[platform] ||= []).push(target);
  return {
    startDate: query.start_date,
    endDate: query.end_date,
    rawReportedNum: reports.length,
    totalUrls,
    globalUnweightedResolvedNum: 0,
    globalWeightedResolvedNum: 0,
    globalWeightedBurndown: 0,
    globalUnweightedBurndown: 0,
    platformTotals: [...byPlatform.values()].sort((a, b) => b.urls - a.urls),
    eventViews: [...byEvent.values()].sort((a, b) => b.views - a.views),
    topPirates,
    topPiratesByPlatform,
    timelineData,
    teamStats: [...byUser.values()].map((item) => ({
      name: item.name,
      urls: 0,
      scouted: item.scout,
      enforced: item.enforced,
      resolvedNum: item.urlsResolved,
      resolvedRate: `${item.resolvedPct}%`,
      wBurndown: item.wBurndown || 'N/A',
      uwBurndown: item.uwBurndown || 'N/A',
      daysReported: item.days.size
    })),
    topScouts: [...byUser.values()]
      .sort((a, b) => b.scout - a.scout)
      .map((item) => ({ name: item.name, count: item.scout })),
    topEnforcers: [...byUser.values()]
      .sort((a, b) => b.enforced - a.enforced)
      .map((item) => ({ name: item.name, count: item.enforced })),
    mvp: (() => {
      const item = [...byUser.values()].sort((a, b) => (b.scout + b.enforced) - (a.scout + a.enforced))[0];
      return item ? { name: item.name, total: item.scout + item.enforced } : null;
    })()
  };
}

export function createPostgresRepository() {
  return {
    async resolveActiveMembership(identity) {
      return withTransaction(async (client) => {
        const result = await identityRows(client, identity, { lock: true });
        if (result.rows.length !== 1) return { count: result.rows.length };
        const row = result.rows[0];
        if (row.email.toLowerCase() !== identity.email) return { count: 0 };
        const configResult = validateCustomerConfig(row.config);
        assert(configResult.valid, 500, 'configuration_error', 'Stored customer configuration is invalid.');
        assert(configResult.config.configVersion === Number(row.config_version), 500, 'configuration_error', 'Stored configuration versions do not match.');
        if (!configResult.config.access.enabledRoles.includes(row.role) || !domainAllowed(configResult.config, row.email)) return { count: 0 };
        if (!row.google_subject) await client.query('UPDATE customer_memberships SET google_subject = $1, updated_at = now() WHERE member_id = $2', [identity.subject, row.member_id]);
        return { count: 1, member: member(row), customerConfig: configResult.config };
      });
    },

    requireActiveMember(identity) {
      return withTransaction((client) => resolveInside(client, identity));
    },

    requireAdministrator(identity) {
      return withTransaction((client) => resolveInside(client, identity, { requireAdmin: true }));
    },

    async listMembers(actor, query) {
      const configResult = validateCustomerConfig(actor.customerConfig);
      assert(configResult.valid, 500, 'configuration_error', 'Stored customer configuration is invalid.');
      const values = [actor.customerId];
      const filter = query ? 'AND (lower(email) LIKE $2 OR lower(name) LIKE $2)' : '';
      if (query) values.push(`%${query.toLowerCase()}%`);
      const result = await getPool().query(`SELECT * FROM customer_memberships WHERE customer_id = $1 ${filter} ORDER BY lower(name), lower(email) LIMIT 1000`, values);
      return {
        protocolVersion: 1,
        customerId: actor.customerId,
        configVersion: actor.configVersion,
        members: result.rows.map(member).map(({ platforms, ...item }) => item),
        utilization: await utilization(getPool(), configResult.config)
      };
    },

    mutateMembership(actor, mutation, occurredAt) {
      return withTransaction(async (client) => {
        const refreshedActor = await resolveInside(client, { subject: actor.googleSubject, email: actor.email }, { requireAdmin: true });
        void refreshedActor;
        const customer = await client.query('SELECT * FROM customers WHERE customer_id = $1 AND active = TRUE FOR UPDATE', [actor.customerId]);
        assert(customer.rows.length === 1, 404, 'member_not_found', 'The customer is inactive or missing.');
        const configResult = validateCustomerConfig(customer.rows[0].config);
        assert(configResult.valid, 500, 'configuration_error', 'Stored customer configuration is invalid.');
        const config = configResult.config;
        const members = await client.query('SELECT * FROM customer_memberships WHERE customer_id = $1 FOR UPDATE', [actor.customerId]);
        const target = members.rows.find((row) => row.member_id === mutation.memberId);
        assert(target, 404, 'member_not_found', 'The selected customer member was not found.');
        assert(Number(target.version) === mutation.expectedVersion, 409, 'stale_member_version', 'The membership changed elsewhere.');
        const currentUtilization = await utilization(client, config);
        const { nextRole, nextStatus } = enforceMembershipPolicy(members.rows, target, mutation, config, currentUtilization);
        const updated = await client.query(`UPDATE customer_memberships SET role = $1, status = $2, version = version + 1, updated_at = now() WHERE member_id = $3 RETURNING *`, [nextRole, nextStatus, target.member_id]);
        const auditId = `audit_${crypto.randomUUID().replaceAll('-', '')}`;
        await client.query(`INSERT INTO membership_audit (audit_id, customer_id, actor_member_id, actor_email, target_member_id, action, before_state, after_state, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9 / 1000.0))`, [auditId, actor.customerId, actor.memberId, actor.email, target.member_id, mutation.action, target, updated.rows[0], occurredAt]);
        return {
          protocolVersion: 1,
          customerId: actor.customerId,
          configVersion: Number(customer.rows[0].config_version),
          member: (({ platforms, ...item }) => item)(member(updated.rows[0])),
          utilization: await utilization(client, config),
          audit: { auditId, action: mutation.action, actorEmail: actor.email, targetMemberId: target.member_id, occurredAt }
        };
      }, { isolation: 'SERIALIZABLE', retries: 2 });
    },

    async recordEvent(actor, event, acceptedAt) {
      const eventPlatform = String(event.attributes?.platform || '').trim().toLowerCase();
      if (eventPlatform) {
        assert(
          actor.customerConfig.capabilities.enabledPlatforms.includes(eventPlatform),
          403,
          'scope_mismatch',
          'The event platform is not enabled for this customer.'
        );
      }
      const payloadHash = crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');
      return withTransaction(async (client) => {
        const existing = await client.query('SELECT payload_hash FROM customer_events WHERE customer_id = $1 AND event_id = $2 FOR UPDATE', [actor.customerId, event.event_id]);
        if (existing.rows.length) assert(existing.rows[0].payload_hash === payloadHash, 409, 'event_conflict', 'The event ID was already used with different contents.');
        else await client.query(`INSERT INTO customer_events (customer_id,event_id,user_id,event_type,occurred_at,attributes,payload_hash) VALUES ($1,$2,$3,$4,to_timestamp($5 / 1000.0),$6,$7)`, [actor.customerId, event.event_id, actor.memberId, event.event_type, event.occurred_at, event.attributes, payloadHash]);
        return { protocol_version: 1, event_id: event.event_id, customer_id: actor.customerId, user_id: actor.memberId, accepted_at: acceptedAt };
      });
    },

    async queryStatistics(actor, queryType, query, generatedAt, legacy = false) {
      const dashboardId = actor.customerConfig.stats.dashboardId;
      assert(query.dashboard_id === dashboardId, 403, 'scope_mismatch', 'The requested dashboard is outside the customer scope.');
      if (Array.isArray(query.platforms)) {
        assert(
          query.platforms.every((platform) => actor.customerConfig.capabilities.enabledPlatforms.includes(platform)),
          403,
          'scope_mismatch',
          'One or more requested platforms are not enabled for this customer.'
        );
      }
      let start;
      let end;
      if (queryType === 'scoreboard') {
        start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
        end = new Date(); end.setUTCMonth(end.getUTCMonth() + 1, 1); end.setUTCHours(0, 0, 0, 0);
      } else {
        start = new Date(`${query.start_date}T00:00:00.000Z`);
        end = new Date(`${query.end_date}T23:59:59.999Z`);
      }
      const result = await getPool().query(`
        SELECT e.*, m.name AS member_name
        FROM customer_events e
        LEFT JOIN customer_memberships m ON m.customer_id = e.customer_id AND m.member_id = e.user_id
        WHERE e.customer_id = $1 AND e.occurred_at >= $2 AND e.occurred_at <= $3
        ORDER BY e.occurred_at
      `, [actor.customerId, start, end]);
      let events = result.rows;
      if (queryType === 'intelligence' && Array.isArray(query.platforms) && query.platforms.length) {
        const allowed = new Set(query.platforms);
        events = events.filter((row) => !row.attributes?.platform || allowed.has(row.attributes.platform));
      }
      const data = queryType === 'scoreboard' ? scoreboard(events, actor) : intelligence(events, query);
      if (legacy) data.dataScope = 'normalized-store-compatibility';
      return { protocol_version: 1, customer_id: actor.customerId, user_id: actor.memberId, dashboard_id: dashboardId, query_type: queryType, generated_at: generatedAt, data };
    }
  };
}
