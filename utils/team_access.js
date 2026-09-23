// Shared protocol validation. Authority and seat decisions always remain on the server.
export const TEAM_ROLES = ['employee', 'manager', 'admin'];
export const TEAM_ROLE_DESCRIPTIONS = {
  employee: 'Capture evidence, create reports, and view the scoreboard.',
  manager: 'Employee tools plus purchased automation, intelligence, and briefing tools.',
  admin: 'Manager tools plus user onboarding, role changes, and access management.'
};
export const TEAM_OPERATIONS = ['team_list', 'team_history', 'team_preview', 'team_commit'];
export function isTeamPageSender(sender, extensionId) {
  return sender?.id === extensionId && ['options/team.html', 'options.html'].some(path =>
    String(sender?.url || '').split(/[?#]/, 1)[0] === `chrome-extension://${extensionId}/${path}`);
}
function check(value, message) { if (!value) throw new Error(message); }
function exact(value, keys) {
  check(value && typeof value === 'object' && !Array.isArray(value), 'Expected an object.');
  check(Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), 'Unexpected or missing fields.');
}
function text(value, max, empty = false) {
  check(typeof value === 'string' && value.length <= max && (empty || value.trim()) && !/[<>\u0000-\u001f\u007f]/.test(value), 'Invalid text.');
  return value.trim();
}
function id(value) { check(typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value), 'Invalid identifier.'); return value; }
export function validateTeamRequest(body) {
  check(body?.protocolVersion === 1 && TEAM_OPERATIONS.includes(body.operation), 'Unsupported team request.');
  const { operation } = body;
  if (operation === 'team_list') {
    exact(body, ['protocolVersion', 'operation', 'query', 'role', 'status', 'cursor']);
    check(['', ...TEAM_ROLES, 'waiting_approval'].includes(body.role), 'Invalid role filter.');
    check(['', 'active', 'pending', 'approved', 'disabled'].includes(body.status), 'Invalid status filter.');
    return { ...body, query: text(body.query, 120, true), cursor: text(body.cursor, 254, true) };
  }
  if (operation === 'team_history') {
    exact(body, ['protocolVersion', 'operation', 'cursor']);
    const cursor = text(body.cursor, 256, true);
    if (cursor) {
      const pair = JSON.parse(cursor);
      check(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && Number.isFinite(Date.parse(pair[0])), 'Invalid history cursor.');
      id(pair[1]);
    }
    return { ...body, cursor };
  }
  if (operation === 'team_commit') {
    exact(body, ['protocolVersion', 'operation', 'requestId']);
    return { ...body, requestId: id(body.requestId) };
  }
  exact(body, ['protocolVersion', 'operation', 'requestId', 'changes']);
  id(body.requestId);
  check(Array.isArray(body.changes) && body.changes.length > 0 && body.changes.length <= 50, 'Choose between 1 and 50 people.');
  const seen = new Set();
  const changes = body.changes.map(change => {
    check(['add', 'approve', 'reactivate', 'change_role', 'disable'].includes(change?.action), 'Unsupported change.');
    let normalized;
    if (change.action === 'add') {
      exact(change, ['action', 'email', 'name', 'role']);
      const email = text(change.email, 254).toLowerCase();
      check(/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email), 'Enter a valid email address.');
      normalized = { action: 'add', email, name: text(change.name, 120), role: change.role };
      check(!/^[=+]/.test(normalized.name), 'A name cannot start with = or +.');
    } else {
      exact(change, change.action === 'disable' ? ['action', 'memberId', 'expectedVersion'] : ['action', 'memberId', 'expectedVersion', 'role']);
      id(change.memberId);
      check(Number.isSafeInteger(change.expectedVersion) && change.expectedVersion >= 1, 'Invalid member version.');
      normalized = { ...change };
    }
    if (change.action !== 'disable') check(TEAM_ROLES.includes(change.role), 'Choose Employee, Manager, or Admin.');
    const key = normalized.email || normalized.memberId;
    check(!seen.has(key), 'Each person can appear only once in a batch.'); seen.add(key);
    return normalized;
  });
  return { ...body, changes };
}
