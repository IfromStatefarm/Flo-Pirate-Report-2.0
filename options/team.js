import { hasPermission, PERMISSIONS } from '../utils/access_control.js';
import { TEAM_ROLES, TEAM_ROLE_DESCRIPTIONS, validateTeamRequest } from '../utils/team_access.js';

const $ = id => document.getElementById(id);
const title = value => String(value || '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const state = { profile: null, members: [], selected: new Set(), drafts: new Map(), cursor: '', nextCursor: '', historyCursor: '', preview: null, busy: false, managementOnly: false, loadSequence: 0 };
function node(tag, text, className) { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; }
function message(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
async function send(action, extra = {}) {
  const response = await chrome.runtime.sendMessage({ action, ...extra });
  if (!response?.success) { const error = new Error(response?.error || 'The request could not be completed. Check your connection and try again.'); error.code = response?.errorCode; throw error; }
  return response;
}
async function api(operation, payload = {}) { return send('teamAccess', { payload: { operation, ...payload } }); }
function lockPage(text) {
  state.profile = null; state.members = []; state.selected.clear(); state.preview = null; state.loadSequence++;
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('people').replaceChildren(); $('history-list').replaceChildren(); $('workspace').hidden = true; $('access-help').hidden = false;
  message(text, true);
}
async function verify() {
  const result = await send('refreshAccessProfile');
  const p = result.profile;
  if (!hasPermission(p, PERMISSIONS.SETTINGS_ADMIN_ACCESS)) throw new Error('Team & Access is available to verified customer admins only.');
  if (state.profile && state.profile.customerId !== p.customerId) throw new Error('Your organization changed. Reopen Team & Access.');
  state.profile = p;
  const colors = { primary: '--brand-primary', onPrimary: '--brand-on-primary', background: '--page-background', surface: '--surface', text: '--text-primary', muted: '--text-muted', border: '--border', accent: '--brand-accent' };
  for (const [key, token] of Object.entries(colors)) {
    if (/^#[0-9a-f]{6}$/i.test(p.theme?.colors?.[key] || '')) document.documentElement.style.setProperty(token, p.theme.colors[key]);
  }
  $('company').textContent = p.legal?.companyName || p.theme?.displayName || 'Your organization';
  $('signed-in').textContent = `Signed in as ${p.email}`;
  $('access-help').hidden = true; $('workspace').hidden = false;
}
function seatCards(target, totals, before = null) {
  target.replaceChildren();
  for (const [label, c, previous] of [['Total users', totals.activeUsers, before?.activeUsers], ...TEAM_ROLES.map(r => [title(r), totals.roles[r], before?.roles[r]])]) {
    const card = node('div', null, `seat${c.used > c.limit ? ' over' : ''}`);
    card.append(node('span', label), node('strong', previous ? `${previous.used} → ${c.used} / ${c.limit}` : `${c.used} / ${c.limit}`)); target.append(card);
  }
}
function selectionChanged() {
  $('selected-count').textContent = `${state.selected.size} selected`;
  $('select-all').checked = !!state.members.length && state.selected.size === state.members.length;
  $('select-all').indeterminate = state.selected.size > 0 && state.selected.size < state.members.length;
  for (const id of ['review-selected', 'apply-role']) $(id).disabled = !state.selected.size || state.managementOnly || state.busy;
  $('deactivate').disabled = !state.selected.size || state.busy;
}
function renderPeople() {
  $('people').replaceChildren();
  for (const member of state.members) {
    const tr = node('tr'), selection = node('td'), checkbox = node('input');
    checkbox.type = 'checkbox'; checkbox.checked = state.selected.has(member.memberId); checkbox.setAttribute('aria-label', `Select ${member.email}`);
    checkbox.addEventListener('change', () => { checkbox.checked ? state.selected.add(member.memberId) : state.selected.delete(member.memberId); selectionChanged(); });
    selection.append(checkbox);
    const person = node('td'); person.append(node('strong', member.name), node('small', member.email));
    const access = node('td'), badge = node('span', member.status === 'disabled' ? 'Deactivated' : member.awaitingSignIn ? 'Awaiting first sign-in' : title(member.status), `badge ${member.status}`); access.append(badge);
    const edit = node('td'), select = node('select'); select.setAttribute('aria-label', `New role for ${member.email}`);
    select.append(new Option('Choose role…', ''));
    TEAM_ROLES.forEach(role => select.append(new Option(title(role), role)));
    select.value = state.drafts.get(member.memberId) || ''; select.disabled = state.managementOnly;
    select.addEventListener('change', () => { state.drafts.set(member.memberId, select.value); if (select.value) state.selected.add(member.memberId); checkbox.checked = state.selected.has(member.memberId); selectionChanged(); });
    edit.append(select);
    tr.append(selection, person, node('td', title(member.role)), access, edit); $('people').append(tr);
  }
  $('empty').hidden = state.members.length > 0; selectionChanged();
}
async function loadPeople(cursor = '') {
  const seq = ++state.loadSequence;
  const result = await api('team_list', { query: $('query').value.trim(), role: $('role-filter').value, status: $('status-filter').value, cursor });
  if (seq !== state.loadSequence || !state.profile) return;
  state.members = result.members; state.cursor = cursor; state.nextCursor = result.nextCursor; state.selected.clear(); state.drafts.clear(); state.managementOnly = result.subscription.managementOnly;
  seatCards($('seats'), result.utilization);
  $('subscription').textContent = `Subscription: ${title(result.subscription.state)}${result.subscription.paidThrough ? ` · Paid through ${new Date(result.subscription.paidThrough).toLocaleDateString()}` : ''}`;
  const over = [result.utilization.activeUsers, ...Object.values(result.utilization.roles)].some(c => c.used > c.limit);
  $('recovery').hidden = !state.managementOnly && !over;
  $('recovery').textContent = state.managementOnly ? 'You can review your team and deactivate users. Contact Ivan to activate or renew before adding or promoting people.' : 'Your team exceeds purchased capacity. Reduce the overage to restore ordinary work.';
  $('add').disabled = state.managementOnly; $('bulk-role').disabled = state.managementOnly;
  $('domains').textContent = `Approved domains: ${result.allowedDomains.join(', ')}`;
  $('first-page').disabled = !cursor; $('next-page').disabled = !result.nextCursor;
  $('page-label').textContent = `${result.members.length} people on this page`;
  renderPeople();
}
async function refresh() {
  try { await verify(); await loadPeople(); message('Team is up to date.'); }
  catch (error) { lockPage(error.message); }
}
async function task(work) {
  if (state.busy) return;
  state.busy = true; selectionChanged();
  try { await work(); } catch (error) { message(error.message, true); }
  finally { state.busy = false; selectionChanged(); }
}
function selectedChanges(disable = false) {
  if (!state.selected.size) throw new Error('Select at least one person.');
  return state.members.filter(m => state.selected.has(m.memberId)).map(m => {
    if (disable) return { action: 'disable', memberId: m.memberId, expectedVersion: m.version };
    const role = state.drafts.get(m.memberId);
    if (!role) throw new Error(`Choose a new role for ${m.email}.`);
    return { action: m.status === 'active' ? 'change_role' : m.status === 'disabled' ? 'reactivate' : 'approve', memberId: m.memberId, expectedVersion: m.version, role };
  });
}
async function review(changes) {
  const requestId = crypto.randomUUID();
  validateTeamRequest({ protocolVersion: 1, operation: 'team_preview', requestId, changes });
  const result = await api('team_preview', { requestId, changes });
  state.preview = { ...result, added: changes.filter(c => c.action === 'add').map(c => c.email) };
  seatCards($('review-counts'), result.after, result.before); $('review-changes').replaceChildren();
  result.changes.forEach(change => $('review-changes').append(node('li', `${change.after.email}: ${change.before ? `${title(change.before.role)} (${title(change.before.status)})` : 'New person'} → ${title(change.after.role)} (${title(change.after.status)})`)));
  $('review-warning').textContent = [result.affectsSelf ? 'This changes your own access. You may lose access to this page.' : '', result.grantsAdmin ? 'An admin can manage everyone in this organization.' : ''].filter(Boolean).join(' ');
  $('acknowledge').checked = false; $('confirm').disabled = true; $('review-error').textContent = '';
  $('add-dialog').close(); $('review-dialog').showModal();
}
async function commit() {
  if (!state.preview || !$('acknowledge').checked || state.busy) return;
  state.busy = true; $('confirm').disabled = true; $('cancel-review').disabled = true;
  try {
    const preview = state.preview;
    const result = await api('team_commit', { requestId: preview.requestId });
    $('review-dialog').close(); state.preview = null;
    if (!result.adminAccess) { lockPage('Your access was updated. Only customer admins can manage the team.'); return; }
    await verify(); await loadPeople(); message(`${result.changed} ${result.changed === 1 ? 'person' : 'people'} updated. Changes are recorded in history.`);
    if (preview.added.length) {
      $('instructions').value = `You have access to ${$('company').textContent} in Rights Reporter.\n\n1. Install the extension package supplied by your administrator.\n2. Open the extension’s Settings and sign in with your approved Google account.\n3. Your organization and role will load automatically.\n\nApproved emails:\n${preview.added.join('\n')}\n\nContact your administrator if you need help. Do not share passwords.`;
      $('copy-status').textContent = ''; $('instructions-dialog').showModal();
    }
  } catch (error) { $('review-error').textContent = `${error.message} Nothing further will be submitted until you confirm again. If the connection failed, retry this same review to check its saved result.`; }
  finally { state.busy = false; $('cancel-review').disabled = false; $('confirm').disabled = !$('acknowledge').checked; selectionChanged(); }
}
async function history(append = false) {
  const result = await api('team_history', { cursor: append ? state.historyCursor : '' });
  if (!append) $('history-list').replaceChildren();
  result.entries.forEach(e => {
    const li = node('li'); li.append(node('strong', `${e.after?.email || e.before?.email || 'User'} · ${title(e.action)}`));
    li.append(node('div', `${e.before?.role ? `${title(e.before.role)} / ${title(e.before.status)}` : 'New person'} → ${title(e.after?.role)} / ${title(e.after?.status)}`));
    li.append(node('span', `${e.actorEmail} · ${new Date(e.occurredAt).toLocaleString()}`, 'history-meta')); $('history-list').append(li);
  });
  if (!append && !result.entries.length) $('history-list').append(node('li', 'No user changes have been recorded yet.'));
  state.historyCursor = result.nextCursor; $('more-history').hidden = !state.historyCursor;
}
TEAM_ROLES.forEach(role => $('role-guide').append(node('dt', title(role)), node('dd', TEAM_ROLE_DESCRIPTIONS[role])));
$('refresh').addEventListener('click', () => task(refresh));
$('filters').addEventListener('submit', e => { e.preventDefault(); void task(() => loadPeople()); });
$('first-page').addEventListener('click', () => task(() => loadPeople()));
$('next-page').addEventListener('click', () => task(() => loadPeople(state.nextCursor)));
$('select-all').addEventListener('change', () => { state.selected = new Set($('select-all').checked ? state.members.map(m => m.memberId) : []); renderPeople(); });
$('apply-role').addEventListener('click', () => { if (!$('bulk-role').value) return message('Choose a role for the selected people.', true); state.selected.forEach(id => state.drafts.set(id, $('bulk-role').value)); renderPeople(); });
$('review-selected').addEventListener('click', () => task(() => review(selectedChanges())));
$('deactivate').addEventListener('click', () => task(() => review(selectedChanges(true))));
$('add').addEventListener('click', () => { $('add-error').textContent = ''; $('add-dialog').showModal(); });
$('cancel-add').addEventListener('click', () => $('add-dialog').close());
$('add-role').addEventListener('change', () => { $('add-role-description').textContent = TEAM_ROLE_DESCRIPTIONS[$('add-role').value]; });
$('add-role-description').textContent = TEAM_ROLE_DESCRIPTIONS.employee;
$('add-form').addEventListener('submit', e => {
  e.preventDefault();
  void task(async () => {
    try {
      const changes = $('emails').value.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).map(s => {
        const match = /^(.*?)\s*<([^<>]+)>$/.exec(s), email = (match ? match[2] : s).trim().toLowerCase();
        return { action: 'add', email, name: match?.[1]?.trim() || email.split('@')[0].replace(/^[=+]+/, '') || 'Team member', role: $('add-role').value };
      });
      await review(changes);
    } catch (error) { $('add-error').textContent = error.message; }
  });
});
$('acknowledge').addEventListener('change', () => { $('confirm').disabled = !$('acknowledge').checked || state.busy; });
$('cancel-review').addEventListener('click', () => { $('review-dialog').close(); state.preview = null; });
$('review-dialog').addEventListener('cancel', e => { if (state.busy) e.preventDefault(); });
$('confirm').addEventListener('click', commit);
$('close-instructions').addEventListener('click', () => $('instructions-dialog').close());
$('copy-instructions').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('instructions').value); $('copy-status').textContent = 'Instructions copied.'; } catch { $('instructions').select(); $('copy-status').textContent = 'Select and copy these instructions manually.'; } });
for (const view of ['directory', 'history']) $(view+'-tab').addEventListener('click', () => task(async () => {
  $('directory').hidden = view !== 'directory'; $('history').hidden = view !== 'history';
  $('directory-tab').setAttribute('aria-pressed', String(view === 'directory')); $('history-tab').setAttribute('aria-pressed', String(view === 'history'));
  if (view === 'history') await history();
}));
$('more-history').addEventListener('click', () => task(() => history(true)));
window.addEventListener('focus', () => {
  if (state.busy) return;
  void task(async () => {
    // Recheck authority without discarding an in-progress selection or review.
    try {
      await verify();
      if (!state.selected.size && !document.querySelector('dialog[open]')) await loadPeople();
    } catch (error) { lockPage(error.message); }
  });
});
void task(refresh);
