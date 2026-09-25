import { ApiError, assert } from '../api_error.js';

const FOLDER = 'application/vnd.google-apps.folder';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const RESOURCE_ID = /^[A-Za-z0-9_-]{10,256}$/;
const MAX_DEPTH = 32;
const FIELDS = 'id,driveId,mimeType,parents,trashed,capabilities(canEdit,canAddChildren,canListChildren,canDownload)';

// Constructed only with a server-resolved actor, server connector and permission.
// No positive authorization cache: a moved resource must be checked again before
// the next provider request. Metadata calls cannot fetch file contents.
export function createGoogleResourceGuard({ actor, token, permission, repository, fetchImpl = fetch }) {
  const destinations = actor.customerConfig.destinations;
  const root = destinations.driveRootFolderId;
  const spreadsheets = new Set([destinations.reportSpreadsheetId, destinations.eventSpreadsheetId]);

  async function metadata(resourceId, rootAlias = false) {
    assert((rootAlias && resourceId === 'root') || (typeof resourceId === 'string' && RESOURCE_ID.test(resourceId)), 403, 'scope_mismatch', 'Invalid Google resource identity.');
    let response;
    try {
      response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(resourceId)}?fields=${encodeURIComponent(FIELDS)}&supportsAllDrives=true`, {
        headers: {Authorization: `Bearer ${token}`}, redirect: 'error', signal: AbortSignal.timeout(10000)
      });
    } catch {
      throw new ApiError(503, 'resource_verification_unavailable', 'Google resource verification is temporarily unavailable.');
    }
    if (response.status === 429 || response.status >= 500) throw new ApiError(503, 'resource_verification_unavailable', 'Google resource verification is temporarily unavailable.');
    assert(response.ok, 403, 'resource_unavailable', 'The configured Google resource is unavailable.');
    let file;
    try { file = await response.json(); } catch { throw new ApiError(503, 'resource_verification_unavailable', 'Google resource verification is temporarily unavailable.'); }
    assert((rootAlias ? typeof file?.id === 'string' && RESOURCE_ID.test(file.id) : file?.id === resourceId) && file.trashed === false && typeof file.mimeType === 'string' && file.mimeType !== SHORTCUT,
      403, 'scope_mismatch', 'The Google resource is deleted, indirect, or unverifiable.');
    assert(file.parents === undefined || (Array.isArray(file.parents) && file.parents.length <= 1 && file.parents.every(id => typeof id === 'string' && RESOURCE_ID.test(id))),
      403, 'scope_mismatch', 'Google resource ancestry could not be verified.');
    return file;
  }

  async function verifyInside(resourceId, {type, write = false, withinRoot = true} = {}) {
    const visited = new Set();
    let current = resourceId, target;
    // Continue above the configured root as well: a customer root nested below
    // another registered customer root is not an isolated boundary.
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      assert(!visited.has(current), 403, 'scope_mismatch', 'Google resource ancestry contains a cycle.');
      visited.add(current);
      const file = await metadata(current);
      if (!target) target = file;
      else assert(file.mimeType === FOLDER, 403, 'scope_mismatch', 'Google resource ancestry is not a folder hierarchy.');
      if (!file.parents?.length) {
        // Drive can omit an inaccessible parent. Only a provider-confirmed
        // My Drive root or shared-drive root proves the chain is complete.
        if (!(file.mimeType === FOLDER && file.driveId === file.id)) {
          const home = await metadata('root', true);
          assert(home.id === file.id && home.mimeType === FOLDER && !home.parents?.length,
            403, 'scope_mismatch', 'Google resource ancestry is incomplete.');
        }
        assert(!withinRoot || visited.has(root), 403, 'scope_mismatch', 'The resource is outside the customer root.');
        assert(!type || target.mimeType === type, 403, 'scope_mismatch', 'The configured Google resource has the wrong type.');
        const capability = target.mimeType === FOLDER ? (write ? 'canAddChildren' : 'canListChildren') : (write ? 'canEdit' : null);
        assert(!capability || target.capabilities?.[capability] === true, 403, 'resource_unavailable', 'The Google connector lacks access for this operation.');
        if (!write && target.mimeType !== FOLDER && target.mimeType !== SHEET) {
          assert(target.capabilities?.canDownload === true, 403, 'resource_unavailable', 'The Google connector cannot read this file.');
        }
        // This global registry probe returns no foreign metadata. It also
        // refreshes membership, entitlement, permission, destinations/platforms.
        await repository.verifyGoogleResourceScope(actor, [...visited], permission);
        return target;
      }
      current = file.parents[0];
    }
    throw new ApiError(403, 'scope_mismatch', 'Google resource ancestry exceeds the supported depth.');
  }

  async function verify(resourceId, options) {
    try { return await verifyInside(resourceId, options); }
    catch (error) {
      // Guessed foreign, missing, trashed, moved and inaccessible resources must
      // not reveal existence or ownership through distinct API responses.
      if (error instanceof ApiError && ['scope_mismatch', 'resource_unavailable'].includes(error.code)) {
        throw new ApiError(403, 'scope_mismatch', 'The Google resource is unavailable in this customer scope.');
      }
      throw error;
    }
  }

  const assertFolder = (id, write = false) => verify(id, {type: FOLDER, write});
  async function authorizeRequest(value, options = {}) {
    const url = new URL(value);
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port, 403, 'scope_mismatch', 'Unsupported provider destination.');
    const method = String(options.method || 'GET').toUpperCase();
    if (url.hostname === 'sheets.googleapis.com') {
      const match = /^\/v4\/spreadsheets\/([A-Za-z0-9_-]+)(?:$|\/|:)/.exec(url.pathname);
      assert(match && spreadsheets.has(match[1]) && ['GET', 'POST', 'PUT'].includes(method), 403, 'scope_mismatch', 'The spreadsheet is outside the customer configuration.');
      return verify(match[1], {type: SHEET, write: method !== 'GET', withinRoot: false});
    }
    assert(url.hostname === 'www.googleapis.com', 403, 'scope_mismatch', 'Unsupported provider destination.');
    const match = /^\/(upload\/)?drive\/v3\/files(?:\/([A-Za-z0-9_-]+))?$/.exec(url.pathname);
    assert(match, 403, 'scope_mismatch', 'Unsupported Google resource operation.');
    const [, upload, fileId] = match;
    if (fileId) {
      assert((!upload && method === 'GET') || (upload && method === 'PATCH' && url.searchParams.get('uploadType') === 'media'), 403, 'scope_mismatch', 'Unsupported Google resource operation.');
      return verify(fileId, {write: method === 'PATCH'});
    }
    if (!upload && method === 'GET') {
      // All supported adapter searches are constrained to one parent. There is
      // no public arbitrary query route; this is a second boundary for mistakes.
      const query = url.searchParams.get('q') || '';
      const operators = query.replace(/'(?:\\.|[^'\\])*'/g, "''");
      assert(!/\b(?:or|not)\b|[()]/i.test(operators), 403, 'scope_mismatch', 'Drive searches must retain the customer parent restriction.');
      const parents = [...query.matchAll(/(?:^| and )'([A-Za-z0-9_-]{10,256})' in parents(?= and |$)/g)];
      assert(parents.length === 1, 403, 'scope_mismatch', 'A customer-scoped Drive search is required.');
      return assertFolder(parents[0][1]);
    }
    assert(method === 'POST', 403, 'scope_mismatch', 'Unsupported Google resource operation.');
    let file;
    try {
      if (upload) {
        assert(url.searchParams.get('uploadType') === 'multipart' && options.body instanceof FormData, 403, 'scope_mismatch', 'A scoped multipart upload is required.');
        file = JSON.parse(await options.body.get('metadata').text());
      } else file = JSON.parse(options.body);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(403, 'scope_mismatch', 'Google upload metadata could not be verified.');
    }
    assert(file && Array.isArray(file.parents) && file.parents.length === 1 && !file.shortcutDetails &&
      (upload || file.mimeType === FOLDER), 403, 'scope_mismatch', 'A customer-scoped parent is required.');
    return assertFolder(file.parents[0], true);
  }

  async function verifyConfigured() {
    await assertFolder(root);
    for (const id of spreadsheets) await verify(id, {type: SHEET, withinRoot: false});
  }
  const assertFile = (id, mimeType) => verify(id, {type: mimeType});
  return Object.freeze({assertFolder, assertFile, verifyConfigured, authorizeRequest});
}
