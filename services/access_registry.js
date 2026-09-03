import {
  ACCESS_PROFILE_CACHE_KEY,
  ACCESS_PROFILE_CACHE_TTL_MS,
  ACCESS_ROLES,
  ACCESS_SESSION_KEY,
  ACCESS_SHEET_GID,
  ACCESS_SHEET_ID,
  formatAccessPlatforms,
  formatAccessRole,
  hasPermission,
  hasPlatformAccess,
  isSafeSheetText,
  normalizeAccessEmail,
  normalizeAccessMiddleName,
  normalizeAccessPlatforms,
  normalizeAccessRole,
  normalizeAccessUsername,
  toPublicAccessProfile
} from '../utils/access_control.js';

const EXPECTED_HEADERS = Object.freeze([
  ['first name', 'firstname', 'given name'],
  ['last name', 'lastname', 'family name', 'surname'],
  ['middle name', 'middle', 'user middle name', 'middle initial'],
  ['useremail', 'user email', 'email'],
  ['accesslevel', 'access level', 'role'],
  ['platforms', 'platform access', 'platforms access', 'platforms access to'],
  ['password', 'user password', 'password hash', 'user password hash'],
  ['google drive root folder id', 'drive root folder id', 'drive folder id'],
  ['google drive root folder name', 'drive root folder name', 'drive folder name', 'drive root label'],
  ['foundation log sheet id', 'foundation sheet id', 'report sheet id'],
  ['foundation log sheet name', 'foundation sheet name', 'report sheet name', 'foundation sheet label'],
  ['event config sheet id', 'event sheet id'],
  ['event config sheet name', 'event sheet name', 'event sheet label']
]);

const MANAGED_CONNECTIVITY_FIELDS = Object.freeze([
  { storageKey: 'piracy_folder_id', profileId: 'driveRootId', profileLabel: 'driveRootLabel' },
  { storageKey: 'piracy_sheet_id', profileId: 'reportSheetId', profileLabel: 'reportSheetLabel' },
  { storageKey: 'event_sheet_id', profileId: 'eventSheetId', profileLabel: 'eventSheetLabel' }
]);

const PASSWORD_HASH_ALGORITHM = 'PBKDF2';
const PASSWORD_HASH_DIGEST = 'SHA-256';
const PASSWORD_HASH_ITERATIONS = 310000;
const PASSWORD_HASH_PREFIX = 'pbkdf2_sha256';
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_FAILURE_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_LOCK_MS = 60 * 1000;

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function escapeSheetTitle(value) {
  return String(value || '').replace(/'/g, "''");
}

function validateHeaders(row) {
  if (!Array.isArray(row) || row.length < EXPECTED_HEADERS.length) return false;
  return EXPECTED_HEADERS.every((aliases, index) => aliases.includes(normalizeHeader(row[index])));
}

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePasswordHash(password, salt, iterations = PASSWORD_HASH_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    PASSWORD_HASH_ALGORITHM,
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: PASSWORD_HASH_ALGORITHM, hash: PASSWORD_HASH_DIGEST, salt, iterations },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

export async function hashAccessPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt);
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`;
}

export async function verifyAccessPassword(password, storedHash) {
  const [prefix, iterationText, saltText, hashText, ...extra] = String(storedHash || '').split('$');
  const iterations = Number(iterationText);
  if (
    prefix !== PASSWORD_HASH_PREFIX ||
    extra.length > 0 ||
    !Number.isInteger(iterations) ||
    iterations < 100000 ||
    iterations > 2000000 ||
    !saltText ||
    !hashText
  ) return false;

  try {
    const expected = base64ToBytes(hashText);
    const actual = await derivePasswordHash(password, base64ToBytes(saltText), iterations);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch (error) {
    return false;
  }
}

function validateUsername(username) {
  const value = String(username || '').trim().replace(/\s+/g, ' ');
  if (value.length < 3 || value.length > 120 || !isSafeSheetText(value) || value.split(' ').length < 2) {
    throw new Error('Enter both a first and last name as they should appear on report forms.');
  }
  return value;
}

function validateNamePart(value, label, { required = true } = {}) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized && !required) return '';
  if (!normalized || normalized.length > 60 || !isSafeSheetText(normalized)) {
    throw new Error(`${label} must be 1-60 characters and cannot begin with =, +, or @.`);
  }
  return normalized;
}

function validateReportName(firstName, lastName) {
  const first = validateNamePart(firstName, 'First name');
  const last = validateNamePart(lastName, 'Last name');
  return {
    firstName: first,
    lastName: last,
    name: validateUsername(`${first} ${last}`)
  };
}

function validateMiddleName(middleName, { required = false } = {}) {
  return validateNamePart(middleName, 'Middle name or initial', { required });
}

function validateManagedValue(value, label, maxLength) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.length > maxLength || !isSafeSheetText(normalized)) {
    throw new Error(`${label} must be ${maxLength} characters or fewer and cannot begin with =, +, or @.`);
  }
  return normalized;
}

function normalizeManagedConfig(config = {}) {
  return {
    driveRootId: validateManagedValue(config.driveRootId, 'Google Drive Root Folder ID', 256),
    driveRootLabel: validateManagedValue(config.driveRootLabel, 'Google Drive Root Folder display name', 120),
    reportSheetId: validateManagedValue(config.reportSheetId, 'Foundation Log Sheet ID', 256),
    reportSheetLabel: validateManagedValue(config.reportSheetLabel, 'Foundation Log Sheet display name', 120),
    eventSheetId: validateManagedValue(config.eventSheetId, 'Event Config Sheet ID', 256),
    eventSheetLabel: validateManagedValue(config.eventSheetLabel, 'Event Config Sheet display name', 120)
  };
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH || value.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters.`);
  }
  return value;
}

async function fetchJson(url, options = {}, retries = 3, delayMs = 500) {
  const response = await fetch(url, options);
  if (response.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fetchJson(url, options, retries - 1, delayMs * 2);
  }

  const responseText = await response.text();
  let responseData = {};
  if (responseText) {
    try {
      responseData = JSON.parse(responseText);
    } catch (error) {
      responseData = {};
    }
  }

  if (!response.ok) {
    const apiMessage = responseData?.error?.message || responseText || response.statusText;
    throw new Error(`Access registry request failed (${response.status}): ${String(apiMessage).slice(0, 240)}`);
  }

  return responseData;
}

function parseUserRow(row, rowNumber) {
  const firstName = String(row?.[0] || '').trim().replace(/\s+/g, ' ');
  const lastName = String(row?.[1] || '').trim().replace(/\s+/g, ' ');
  const role = normalizeAccessRole(row?.[4]);
  return {
    rowNumber,
    name: [firstName, lastName].filter(Boolean).join(' '),
    firstName,
    lastName,
    middleName: String(row?.[2] || '').trim().replace(/\s+/g, ' '),
    email: normalizeAccessEmail(row?.[3]),
    role,
    platforms: normalizeAccessPlatforms(row?.[5]),
    passwordHash: String(row?.[6] || '').trim(),
    managedConfig: {
      driveRootId: String(row?.[7] || '').trim(),
      driveRootLabel: String(row?.[8] || '').trim(),
      reportSheetId: String(row?.[9] || '').trim(),
      reportSheetLabel: String(row?.[10] || '').trim(),
      eventSheetId: String(row?.[11] || '').trim(),
      eventSheetLabel: String(row?.[12] || '').trim()
    },
    status: role === ACCESS_ROLES.WAITING_APPROVAL ? 'waiting_approval' : 'ready',
    loadedAt: Date.now()
  };
}

export function createAccessRegistry({ getAuthToken, getUserEmail }) {
  let sheetTitlePromise = null;
  let inMemoryProfile = null;
  let inFlightProfilePromise = null;
  const loginFailures = new Map();

  async function getSheetTitle(token) {
    if (!sheetTitlePromise) {
      sheetTitlePromise = fetchJson(
        `https://sheets.googleapis.com/v4/spreadsheets/${ACCESS_SHEET_ID}?fields=sheets.properties(sheetId,title)`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
        .then((metadata) => {
          const targetSheet = (metadata.sheets || []).find(
            (sheet) => Number(sheet?.properties?.sheetId) === ACCESS_SHEET_GID
          );
          if (!targetSheet?.properties?.title) {
            throw new Error(`Access registry worksheet gid=${ACCESS_SHEET_GID} was not found.`);
          }
          return targetSheet.properties.title;
        })
        .catch((error) => {
          sheetTitlePromise = null;
          throw error;
        });
    }
    return sheetTitlePromise;
  }

  async function readRows(token) {
    const sheetTitle = await getSheetTitle(token);
    const range = `'${escapeSheetTitle(sheetTitle)}'!A1:M`;
    const data = await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${ACCESS_SHEET_ID}/values/${encodeURIComponent(range)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const values = Array.isArray(data.values) ? data.values : [];
    if (!validateHeaders(values[0])) {
      throw new Error('Access registry row 1 must contain the required user, access, password, and managed connectivity headers in columns A-M.');
    }
    return values.slice(1).map((row, index) => parseUserRow(row, index + 2));
  }

  async function appendWaitingUser(token, email, firstName, lastName, middleName, passwordHash) {
    const sheetTitle = await getSheetTitle(token);
    const range = `'${escapeSheetTitle(sheetTitle)}'!A:M`;

    await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${ACCESS_SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          majorDimension: 'ROWS',
          values: [[firstName, lastName, middleName, email, formatAccessRole(ACCESS_ROLES.WAITING_APPROVAL), '', passwordHash, '', '', '', '', '', '']]
        })
      }
    );
  }

  async function setLegacyCredentials(token, rowNumber, firstName, lastName, middleName, passwordHash) {
    const sheetTitle = await getSheetTitle(token);
    const title = escapeSheetTitle(sheetTitle);
    await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${ACCESS_SHEET_ID}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: [
            { range: `'${title}'!A${rowNumber}:C${rowNumber}`, values: [[firstName, lastName, middleName]] },
            { range: `'${title}'!G${rowNumber}`, values: [[passwordHash]] }
          ]
        })
      }
    );
  }

  async function setMiddleName(token, rowNumber, middleName) {
    const sheetTitle = await getSheetTitle(token);
    const range = `'${escapeSheetTitle(sheetTitle)}'!C${rowNumber}`;
    await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${ACCESS_SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ values: [[middleName]] })
      }
    );
  }

  async function clearProfileCache() {
    inMemoryProfile = null;
    await chrome.storage.local.remove(ACCESS_PROFILE_CACHE_KEY);
  }

  async function syncManagedConnectivity(profile) {
    const storageKeys = MANAGED_CONNECTIVITY_FIELDS.flatMap(({ storageKey }) => [
      storageKey,
      `manual_${storageKey}`,
      `managed_${storageKey}_active`
    ]);
    const stored = await chrome.storage.sync.get(storageKeys);
    const updates = {};

    MANAGED_CONNECTIVITY_FIELDS.forEach(({ storageKey, profileId, profileLabel }) => {
      const managedId = String(profile?.managedConfig?.[profileId] || '').trim();
      const managedLabel = String(profile?.managedConfig?.[profileLabel] || '').trim();
      const manualKey = `manual_${storageKey}`;
      const activeKey = `managed_${storageKey}_active`;
      const labelKey = `managed_${storageKey}_label`;
      const wasManaged = stored[activeKey] === true;

      if (managedId) {
        if (!wasManaged) updates[manualKey] = String(stored[storageKey] || '').trim();
        updates[storageKey] = managedId;
        updates[activeKey] = true;
        updates[labelKey] = managedLabel;
        return;
      }

      if (wasManaged) updates[storageKey] = String(stored[manualKey] || '').trim();
      updates[activeKey] = false;
      updates[labelKey] = '';
    });

    await chrome.storage.sync.set(updates);
  }

  async function restoreManualConnectivity() {
    const storageKeys = MANAGED_CONNECTIVITY_FIELDS.flatMap(({ storageKey }) => [
      storageKey,
      `manual_${storageKey}`,
      `managed_${storageKey}_active`
    ]);
    const stored = await chrome.storage.sync.get(storageKeys);
    const updates = {};

    MANAGED_CONNECTIVITY_FIELDS.forEach(({ storageKey }) => {
      const activeKey = `managed_${storageKey}_active`;
      if (stored[activeKey] === true) {
        updates[storageKey] = String(stored[`manual_${storageKey}`] || '').trim();
      }
      updates[activeKey] = false;
      updates[`managed_${storageKey}_label`] = '';
    });

    await chrome.storage.sync.set(updates);
  }

  async function readSession() {
    const storage = await chrome.storage.session.get(ACCESS_SESSION_KEY);
    const session = storage[ACCESS_SESSION_KEY];
    const email = normalizeAccessEmail(session?.email);
    if (!email) return null;
    return {
      email,
      username: String(session?.username || '').trim(),
      authenticatedAt: Number(session?.authenticatedAt) || 0
    };
  }

  async function storeSession(profile) {
    const session = {
      email: normalizeAccessEmail(profile.email),
      username: String(profile.name || '').trim(),
      authenticatedAt: Date.now()
    };
    await chrome.storage.session.set({ [ACCESS_SESSION_KEY]: session });
    return session;
  }

  async function logout() {
    inMemoryProfile = null;
    inFlightProfilePromise = null;
    await Promise.all([
      chrome.storage.local.remove(ACCESS_PROFILE_CACHE_KEY),
      chrome.storage.session.remove(ACCESS_SESSION_KEY),
      restoreManualConnectivity()
    ]);
    return { success: true };
  }

  async function readCachedProfile(email) {
    if (
      inMemoryProfile &&
      inMemoryProfile.email === email &&
      Date.now() - inMemoryProfile.loadedAt < ACCESS_PROFILE_CACHE_TTL_MS
    ) {
      return inMemoryProfile;
    }
    return null;
  }

  async function storeProfile(profile) {
    const publicProfile = toPublicAccessProfile(profile);
    inMemoryProfile = publicProfile;
    await Promise.all([
      chrome.storage.local.set({ [ACCESS_PROFILE_CACHE_KEY]: publicProfile }),
      syncManagedConnectivity(publicProfile)
    ]);
    return publicProfile;
  }

  async function loadCurrentProfile({ forceRefresh = false } = {}) {
    const session = await readSession();
    if (!session) {
      return toPublicAccessProfile({
        email: '',
        role: ACCESS_ROLES.WAITING_APPROVAL,
        platforms: [],
        status: 'logged_out'
      });
    }

    const googleEmail = normalizeAccessEmail(await getUserEmail());
    if (!googleEmail || googleEmail !== session.email) {
      return toPublicAccessProfile({
        email: session.email,
        name: session.username,
        role: ACCESS_ROLES.WAITING_APPROVAL,
        platforms: [],
        status: 'identity_error'
      });
    }

    if (!forceRefresh) {
      const cached = await readCachedProfile(session.email);
      if (cached) return cached;
    }

    const token = await getAuthToken();
    const rows = await readRows(token);
    const matches = rows.filter((row) => row.email === session.email);

    if (matches.length > 1) {
      throw new Error(`Duplicate access rows found for ${session.email}. An administrator must remove the duplicates.`);
    }

    if (matches.length === 0) {
      await logout();
      throw new Error('This extension account no longer exists. Create an account or contact an administrator.');
    }

    if (!matches[0].passwordHash) {
      await logout();
      throw new Error('This account does not have extension credentials. Create a password from Settings.');
    }

    return storeProfile(matches[0]);
  }

  function getCurrentProfile(options = {}) {
    if (inFlightProfilePromise) {
      if (options.forceRefresh) {
        return inFlightProfilePromise.then(() => getCurrentProfile(options));
      }
      return inFlightProfilePromise;
    }
    inFlightProfilePromise = loadCurrentProfile(options)
      .finally(() => {
        inFlightProfilePromise = null;
      });
    return inFlightProfilePromise;
  }

  function assertLoginAllowed(usernameKey) {
    const failure = loginFailures.get(usernameKey);
    if (failure?.lockedUntil > Date.now()) {
      throw new Error('Too many failed attempts. Wait one minute and try again.');
    }
    if (failure && Date.now() - failure.firstAt > LOGIN_FAILURE_WINDOW_MS) loginFailures.delete(usernameKey);
  }

  function recordLoginFailure(usernameKey) {
    const now = Date.now();
    const existing = loginFailures.get(usernameKey);
    const failure = !existing || now - existing.firstAt > LOGIN_FAILURE_WINDOW_MS
      ? { count: 1, firstAt: now, lockedUntil: 0 }
      : { ...existing, count: existing.count + 1 };
    if (failure.count >= MAX_LOGIN_FAILURES) failure.lockedUntil = now + LOGIN_LOCK_MS;
    loginFailures.set(usernameKey, failure);
  }

  async function createAccount({ firstName, lastName, middleName, password }) {
    const validatedName = validateReportName(firstName, lastName);
    const reportNameKey = normalizeAccessUsername(validatedName.name);
    const validatedMiddleName = validateMiddleName(middleName);
    const validatedPassword = validatePassword(password);
    const email = normalizeAccessEmail(await getUserEmail());
    if (!email) throw new Error('Sign in to Google Chrome with your work account before creating an extension account.');

    const token = await getAuthToken();
    let rows = await readRows(token);
    let emailMatches = rows.filter((row) => row.email === email);
    let nameMatches = rows.filter((row) => normalizeAccessUsername(row.name) === reportNameKey);

    if (emailMatches.length > 1) throw new Error(`Duplicate access rows found for ${email}. An administrator must remove the duplicates.`);
    if (emailMatches[0]?.passwordHash) throw new Error('An extension account already exists for this Google account. Sign in instead.');
    if (nameMatches.some((row) => row.email !== email) && !validatedMiddleName) {
      return {
        challenge: 'middle_name',
        message: 'Another user has the same first and last name. Enter your middle name or initial.'
      };
    }

    const passwordHash = await hashAccessPassword(validatedPassword);
    if (emailMatches.length === 0) {
      // Re-read immediately before appending to reduce duplicate account rows.
      rows = await readRows(token);
      emailMatches = rows.filter((row) => row.email === email);
      nameMatches = rows.filter((row) => normalizeAccessUsername(row.name) === reportNameKey);
      if (emailMatches.length > 1) throw new Error(`Duplicate access rows found for ${email}. An administrator must remove the duplicates.`);
      if (nameMatches.some((row) => row.email !== email) && !validatedMiddleName) {
        return {
          challenge: 'middle_name',
          message: 'Another user has the same first and last name. Enter your middle name or initial.'
        };
      }
      if (emailMatches.length === 0) {
        await appendWaitingUser(
          token,
          email,
          validatedName.firstName,
          validatedName.lastName,
          validatedMiddleName,
          passwordHash
        );
      } else if (!emailMatches[0].passwordHash) {
        await setLegacyCredentials(
          token,
          emailMatches[0].rowNumber,
          validatedName.firstName,
          validatedName.lastName,
          validatedMiddleName,
          passwordHash
        );
      } else {
        throw new Error('An extension account already exists for this Google account. Sign in instead.');
      }
    } else {
      await setLegacyCredentials(
        token,
        emailMatches[0].rowNumber,
        validatedName.firstName,
        validatedName.lastName,
        validatedMiddleName,
        passwordHash
      );
    }

    const updatedRows = await readRows(token);
    const matches = updatedRows.filter((row) => row.email === email);
    if (matches.length !== 1) throw new Error('The new extension account could not be verified.');
    await clearProfileCache();
    await storeSession(matches[0]);
    return storeProfile(matches[0]);
  }

  async function login({ firstName, lastName, middleName, email, password }) {
    const validatedName = validateReportName(firstName, lastName);
    const reportNameKey = normalizeAccessUsername(validatedName.name);
    const suppliedMiddleName = validateMiddleName(middleName);
    const middleNameKey = normalizeAccessMiddleName(suppliedMiddleName);
    const selectedEmail = normalizeAccessEmail(email);
    const suppliedPassword = String(password || '');
    const loginKey = `${reportNameKey}|${middleNameKey}|${selectedEmail}`;
    if (!suppliedPassword) throw new Error('Enter your first name, last name, and password.');
    assertLoginAllowed(loginKey);

    const googleEmail = normalizeAccessEmail(await getUserEmail());
    if (!googleEmail) throw new Error('Sign in to Google Chrome with your work account before signing in to the extension.');

    const token = await getAuthToken();
    const rows = await readRows(token);
    const nameMatches = rows.filter((row) => normalizeAccessUsername(row.name) === reportNameKey);
    if (nameMatches.length > 1 && !suppliedMiddleName) {
      return {
        challenge: 'middle_name',
        message: 'Another user has the same first and last name. Enter your middle name or initial.'
      };
    }

    let candidates = nameMatches;
    if (nameMatches.length > 1) {
      candidates = nameMatches.filter((row) => {
        const storedMiddleName = normalizeAccessMiddleName(row.middleName);
        return storedMiddleName === middleNameKey || !storedMiddleName;
      });
    }

    if (candidates.length > 1 && !selectedEmail) {
      return {
        challenge: 'email_selection',
        emails: [...new Set(candidates.map((row) => row.email).filter(Boolean))].sort(),
        message: 'More than one account has this full name. Select your email and log in with your password.'
      };
    }

    const user = selectedEmail
      ? candidates.find((row) => row.email === selectedEmail)
      : candidates[0];
    const passwordMatches = user?.passwordHash
      ? await verifyAccessPassword(suppliedPassword, user.passwordHash)
      : false;
    if (!user || user.email !== googleEmail || !passwordMatches) {
      recordLoginFailure(loginKey);
      throw new Error('Invalid name, email selection, or password for the current Google account.');
    }

    if (nameMatches.length > 1 && !user.middleName && suppliedMiddleName) {
      await setMiddleName(token, user.rowNumber, suppliedMiddleName);
      user.middleName = suppliedMiddleName;
    }

    loginFailures.delete(loginKey);
    await clearProfileCache();
    await storeSession(user);
    return storeProfile({ ...user, loadedAt: Date.now() });
  }

  async function requirePermission(permission, { forceRefresh = false } = {}) {
    const profile = await getCurrentProfile({ forceRefresh });
    if (!hasPermission(profile, permission)) {
      const reason = profile.status === 'logged_out'
        ? 'Sign in to the extension from Settings.'
        : profile.status === 'waiting_approval'
          ? 'Your account is waiting for administrator approval.'
          : `Your ${profile.role || 'current'} access level does not allow this action.`;
      throw new Error(`Access denied: ${reason}`);
    }
    return profile;
  }

  async function requirePlatform(profile, platform) {
    if (!hasPlatformAccess(profile, platform)) {
      throw new Error(`Access denied: ${platform || 'This platform'} is not assigned to your account.`);
    }
    return profile;
  }

  async function listUsers(query = '') {
    await requirePermission('settings.adminAccess', { forceRefresh: true });
    const token = await getAuthToken();
    const rows = await readRows(token);
    const needle = String(query || '').trim().toLowerCase();
    return rows
      .filter((row) => row.email)
      .filter((row) => !needle || row.email.includes(needle) || row.name.toLowerCase().includes(needle) || row.middleName.toLowerCase().includes(needle))
      .sort((left, right) => left.name.localeCompare(right.name) || left.email.localeCompare(right.email))
      .slice(0, 200)
      .map(toPublicAccessProfile);
  }

  async function updateUser({ email, firstName, lastName, middleName, role, platforms, managedConfig }) {
    const actor = await requirePermission('settings.adminAccess', { forceRefresh: true });
    const targetEmail = normalizeAccessEmail(email);
    const validatedName = validateReportName(firstName, lastName);
    const normalizedMiddleName = validateMiddleName(middleName);
    const normalizedRole = normalizeAccessRole(role);
    const normalizedPlatforms = normalizedRole === ACCESS_ROLES.WAITING_APPROVAL
      ? []
      : normalizeAccessPlatforms(platforms);

    if (!targetEmail) throw new Error('A target user email is required.');
    if (normalizedRole !== String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '_')) {
      throw new Error('Select a valid access level.');
    }

    const token = await getAuthToken();
    const rows = await readRows(token);
    const matches = rows.filter((row) => row.email === targetEmail);
    if (matches.length !== 1) {
      throw new Error(matches.length > 1
        ? `Duplicate access rows found for ${targetEmail}.`
        : `No access row found for ${targetEmail}.`);
    }

    const target = matches[0];
    const normalizedManagedConfig = normalizeManagedConfig(managedConfig ?? target.managedConfig);
    const nameKey = normalizeAccessUsername(validatedName.name);
    if (!normalizedMiddleName && rows.some((row) => row.email !== targetEmail && normalizeAccessUsername(row.name) === nameKey)) {
      throw new Error('Another user has this first and last name. Add a middle name or initial.');
    }
    if (target.role === ACCESS_ROLES.ADMIN && normalizedRole !== ACCESS_ROLES.ADMIN) {
      const adminCount = rows.filter((row) => row.role === ACCESS_ROLES.ADMIN).length;
      if (adminCount <= 1) throw new Error('The final administrator cannot be demoted.');
    }

    const sheetTitle = await getSheetTitle(token);
    const title = escapeSheetTitle(sheetTitle);
    const data = [
      { range: `'${title}'!A${target.rowNumber}:C${target.rowNumber}`, values: [[validatedName.firstName, validatedName.lastName, normalizedMiddleName]] },
      { range: `'${title}'!E${target.rowNumber}:F${target.rowNumber}`, values: [[formatAccessRole(normalizedRole), formatAccessPlatforms(normalizedPlatforms)]] },
      {
        range: `'${title}'!H${target.rowNumber}:M${target.rowNumber}`,
        values: [[
          normalizedManagedConfig.driveRootId,
          normalizedManagedConfig.driveRootLabel,
          normalizedManagedConfig.reportSheetId,
          normalizedManagedConfig.reportSheetLabel,
          normalizedManagedConfig.eventSheetId,
          normalizedManagedConfig.eventSheetLabel
        ]]
      }
    ];

    await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${ACCESS_SHEET_ID}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ valueInputOption: 'RAW', data })
      }
    );

    if (actor.email === targetEmail) await clearProfileCache();
    const updatedRows = await readRows(token);
    const updated = updatedRows.find((row) => row.email === targetEmail);
    if (actor.email === targetEmail) return storeProfile(updated);
    return toPublicAccessProfile(updated);
  }

  return {
    clearProfileCache,
    createAccount,
    getCurrentProfile,
    login,
    listUsers,
    logout,
    requirePermission,
    requirePlatform,
    updateUser
  };
}
