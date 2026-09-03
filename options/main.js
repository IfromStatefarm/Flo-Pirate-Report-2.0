import { getClippyAssetForState } from '../utils/clippy_assets.js';
import {
  PERMISSIONS,
  hasPermission,
  hasPlatformAccess,
  roleLabel
} from '../utils/access_control.js';
import { PLATFORM_CATALOG } from '../utils/platform_catalog.js';

<<<<<<< Updated upstream
const DEFAULT_BRIEFING_STATS = {
    kpi_total_takedowns: true,
    kpi_takedowns_platform: true,
    kpi_total_urls: true,
    kpi_urls_platform: true,
    kpi_resolved_num_unweighted: true,
    kpi_resolved_num_weighted: true,
    kpi_resolved_pct_unweighted: true,
    kpi_resolved_pct_weighted: true,
    kpi_burndown_weighted: true,
    kpi_burndown_unweighted: true,
    leaderboard_mvp: true,
    leaderboard_top_3: true,
    leaderboard_top_5: true,
    leaderboard_last_3: false,
    timeline_report: true,
    platform_breakdown: true,
    targets_top_1: true,
    targets_top_5: true,
    targets_top_platform_1: true,
    targets_top_platform_3: false,
    team_col_scout: true,
    team_col_enforced: true,
    team_col_urls_resolved_num: true,
    team_col_urls_resolved_pct: true,
    team_col_burndown_rate: true,
    team_col_days_reported: true,
    events_top_5: true,
    events_top_10: true,
    events_top_5_pct: false,
    events_top_10_pct: false,
    appx_team_all: true,
    appx_team_half: false,
    appx_events_all: true,
    appx_events_half: false
};
=======
const clippy = document.getElementById('clippy-img');
const status = document.getElementById('status');
let currentAccessProfile = null;
let selectedAccessUser = null;
let accessSearchTimer = null;

const CONNECTIVITY_FIELDS = Object.freeze([
  { inputId: 'piracy_folder_id', storageKey: 'piracy_folder_id', profileId: 'driveRootId', profileLabel: 'driveRootLabel' },
  { inputId: 'piracy_sheet_id', storageKey: 'piracy_sheet_id', profileId: 'reportSheetId', profileLabel: 'reportSheetLabel' },
  { inputId: 'event_sheet_id', storageKey: 'event_sheet_id', profileId: 'eventSheetId', profileLabel: 'eventSheetLabel' }
]);

function getConnectivityValue(inputId) {
  const input = document.getElementById(inputId);
  return String(input?.dataset.endpoint || input?.value || '').trim();
}

function renderConnectivityFields(profile, storedValues) {
  const managedConfig = profile?.managedConfig || {};
  CONNECTIVITY_FIELDS.forEach(({ inputId, storageKey, profileId, profileLabel }) => {
    const input = document.getElementById(inputId);
    const endpoint = String(managedConfig[profileId] || '').trim();
    const displayName = String(managedConfig[profileLabel] || '').trim();

    if (endpoint) {
      input.value = displayName || 'Managed by administrator';
      input.dataset.endpoint = endpoint;
      input.dataset.managed = 'true';
      input.readOnly = true;
      input.title = 'This value is managed by an administrator.';
      return;
    }

    input.value = String(storedValues[storageKey] || '').trim();
    delete input.dataset.endpoint;
    delete input.dataset.managed;
    input.readOnly = false;
    input.removeAttribute('title');
  });
}

function refreshSidepanelAccessView() {
  return chrome.runtime.sendMessage({ action: 'refreshSidepanelAccessView' }).catch(() => null);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action !== 'refreshSettingsAccessView') return false;
  window.location.reload();
  return false;
});

async function fetchConfig() {
  const response = await chrome.runtime.sendMessage({ action: 'getConfig' });
  if (!response?.success) throw new Error(response?.error || 'Unable to load shared configuration.');
  return response.config;
}

async function updateConfigSections(sections, platform = '') {
  const response = await chrome.runtime.sendMessage({ action: 'updateSharedConfig', sections, platform });
  if (!response?.success) throw new Error(response?.error || 'Unable to update shared configuration.');
  return response.config;
}
>>>>>>> Stashed changes

const DEFAULT_LAB_INSTRUCTIONS = 'Test new features and earn badges!';
const DEFAULT_HIGHLIGHT = Object.freeze({
    user: '',
    achievement: '',
    bonus_awarded: ''
});

const SELECTOR_EDITOR_MAX_PATHS = 7;
const SELECTOR_EDITOR_DELETE_WORDS = Object.freeze([
    'apple',
    'banana',
    'cherry',
    'grape',
    'kiwi',
    'lemon',
    'lime',
    'mango',
    'orange',
    'peach',
    'pear',
    'plum'
]);

const NON_EDITABLE_SELECTOR_GROUPS = new Set([
    'defaults',
    'templates',
    'wizard_steps',
    'dropdown_labels',
    'radio_options',
    'agreement_terms'
]);

const NON_EDITABLE_SELECTOR_LEAFS = new Set([
    'action',
    'authorized_channel_ids',
    'authorized_handles',
    'authorized_studio_manager_ids',
    'label',
    'option_value',
    'value'
]);

const SELECTOR_HELP_TEXT = Object.freeze({
    instagram: {
        scraper: {
            handle: 'Instagram scraper: finds the visible account handle on posts, reels, or stories.',
            profile_links: 'Instagram scraper: fallback profile links used to derive the creator username from the page URL structure.',
            meta_description: 'Instagram scraper: meta tags used as a backup source for views or page text when DOM selectors shift.',
            likes: 'Instagram scraper: fallback paths searched for visible like counts when video views are unavailable.',
            json_scripts: 'Instagram scraper: JSON script blocks searched for creator and reel view data.',
            'json_patterns.handle': 'Instagram scraper: regex patterns used to pull the reel/post owner username out of embedded page JSON.',
            'json_patterns.view_count': 'Instagram scraper: regex patterns used to pull the reel view count out of embedded page JSON.',
            'json_patterns.like_count': 'Instagram scraper: regex patterns used to pull the reel/post like count out of embedded page JSON.'
        },
        autofill: {
            'fields.relationship_radio': 'Instagram report form: chooses the relationship-to-rights-owner answer.',
            'fields.full_name': 'Instagram report form: fills "Your full name".',
            'fields.email': 'Instagram report form: fills the contact email.',
            'fields.confirm_email': 'Instagram report form: fills "Confirm your email address".',
            'fields.rights_owner_name': 'Instagram report form: fills the rights owner / authorized representative field.',
            'fields.country_select': 'Instagram report form: selects where rights are being asserted.',
            'fields.work_type_select': 'Instagram report form: selects the copyrighted work type.',
            'fields.source_url': 'Instagram report form: fills the original FloSports source URL.',
            'fields.copyrighted_work_description': 'Instagram report form: fills the event or copyrighted work description.',
            'fields.content_type_post': 'Instagram report form: checks the post content type.',
            'fields.content_type_story': 'Instagram report form: checks the story content type.',
            'fields.content_urls': 'Instagram report form: fills the reported pirate URL boxes.',
            'fields.additional_links_checkbox': 'Instagram report form: expands additional link boxes.',
            'fields.infringement_explanation': 'Instagram report form: fills the infringement explanation text area.',
            'fields.signature': 'Instagram report form: fills the electronic signature.'
        }
    },
    rumble: {
        scraper: {
            handle: 'Rumble scraper: finds the creator or channel name on the video page.',
            candidate_channel_links: 'Rumble scraper: fallback channel links used to derive the creator handle.',
            views: 'Rumble scraper: paths searched for the visible view count.',
            live_viewer_count: 'Rumble scraper: paths searched for the live viewer count.',
            live_indicators: 'Rumble scraper: signals used to decide whether the video is live.'
        },
        autofill: {
            menu_button: 'Rumble report flow: opens the action menu on the current video page.',
            direct_report_button: 'Rumble report flow: opens the report modal when Rumble exposes the report action directly.',
            report_button: 'Rumble report flow: clicks the Report action inside the menu.',
            copyright_reason: 'Rumble report flow: selects the copyright radio option.',
            submit_button: 'Rumble report flow: submits the copyright report popup.',
            success_text: 'Rumble report flow: success copy checked after submission.',
            success_indicators: 'Rumble report flow: success modal/container selectors checked after submission.'
        }
    }
});

const clippy = document.getElementById('clippy-img');
const status = document.getElementById('status');
const saveHint = document.getElementById('save_hint');
const setupStatusPill = document.getElementById('setup-status-pill');
const setupStatusCopy = document.getElementById('setup-status-copy');
const briefingModal = document.getElementById('briefing-modal');
const briefingCount = document.getElementById('briefing-count');
const suggestionCounter = document.getElementById('suggestion_counter');

const fieldIds = ['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id'];
let savedSettingsSnapshot = null;
let savedBriefingConfig = { ...DEFAULT_BRIEFING_STATS };
let editorVerticals = [];
let editorCommunityHighlights = {
    highlight_of_the_week: { ...DEFAULT_HIGHLIGHT },
    lab_instructions: DEFAULT_LAB_INSTRUCTIONS
};
let selectorEditorPlatformSelectors = {};
let selectorEditorSelectedPlatform = '';
let selectorEditorSelectedSection = 'autofill';
let currentSelectorCategoryMap = new Map();
let pendingSelectorDelete = null;

function setClippyState(state) {
    if (!clippy) return;
    clippy.src = getClippyAssetForState(state);
}

function getEl(id) {
    return document.getElementById(id);
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value ?? {}));
}

function isPlainObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCommunityHighlights(config) {
    const source = isPlainObject(config) ? config : {};
    const highlight = source.highlight_of_the_week || {};
    return {
        highlight_of_the_week: {
            user: String(highlight.user || '').trim(),
            achievement: String(highlight.achievement || '').trim(),
            bonus_awarded: String(highlight.bonus_awarded || '').trim()
        },
        lab_instructions: String(source.lab_instructions || '').trim()
    };
}

function normalizeVerticals(verticals) {
    if (!Array.isArray(verticals)) return [];
    return verticals.map((vertical) => ({
        ...vertical,
        name: String(vertical?.name || '').trim(),
        events: Array.isArray(vertical?.events)
            ? vertical.events.map((event) => ({ ...event }))
            : []
    }));
}

function normalizePlatformSelectors(platformSelectors) {
    if (!isPlainObject(platformSelectors)) return {};
    return cloneJson(platformSelectors);
}

function prettyLabel(value) {
    return String(value || '')
        .replace(/[._-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function readNestedValue(target, pathSegments) {
    return pathSegments.reduce((accumulator, segment) => (
        accumulator != null ? accumulator[segment] : undefined
    ), target);
}

function setNestedValue(target, pathSegments, nextValue) {
<<<<<<< Updated upstream
    if (!pathSegments.length) return;
    let cursor = target;
    for (let index = 0; index < pathSegments.length - 1; index += 1) {
        const segment = pathSegments[index];
        if (!isPlainObject(cursor[segment])) {
            cursor[segment] = {};
=======
  if (!pathSegments.length) return;
  let cursor = target;
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const segment = pathSegments[index];
    if (!isPlainObject(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
  cursor[pathSegments[pathSegments.length - 1]] = nextValue;
}

function normalizeSelectorPaths(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '')).filter(Boolean);
  if (typeof value === 'string') return value ? [value] : [];
  return [];
}

function isEditableSelectorLeaf(pathSegments, value) {
  if (pathSegments.some((segment) => segment.startsWith('_COMMENT'))) return false;
  if (pathSegments.length === 0) return false;

  const topLevelGroup = pathSegments[0];
  const leafKey = pathSegments[pathSegments.length - 1];
  if (NON_EDITABLE_SELECTOR_GROUPS.has(topLevelGroup)) return false;
  if (NON_EDITABLE_SELECTOR_LEAFS.has(leafKey)) return false;

  return Array.isArray(value) || typeof value === 'string';
}

function flattenEditableSelectorCategories(node, pathSegments = [], results = []) {
  if (!isPlainObject(node)) return results;

  Object.entries(node).forEach(([key, value]) => {
    if (key.startsWith('_COMMENT')) return;
    const nextPath = [...pathSegments, key];

    if (isPlainObject(value)) {
      flattenEditableSelectorCategories(value, nextPath, results);
      return;
    }

    if (!isEditableSelectorLeaf(nextPath, value)) return;

    const group = nextPath.length > 1 ? nextPath[0] : 'root';
    const title = nextPath.length > 1
      ? `${prettyLabel(nextPath[0])} / ${prettyLabel(nextPath[nextPath.length - 1])}`
      : prettyLabel(nextPath[0]);

    results.push({
      pathSegments: nextPath,
      pathString: nextPath.join('.'),
      group,
      title,
      valueType: Array.isArray(value) ? 'array' : 'string',
      paths: normalizeSelectorPaths(value)
    });
  });

  return results;
}

function collectDoubleXpEvents(verticals) {
  return normalizeVerticals(verticals)
    .flatMap((vertical) =>
      (vertical.events || [])
        .filter((event) => event?.double_xp)
        .map((event) => ({
          verticalName: vertical.name,
          eventName: String(event.eventName || '').trim()
        }))
    )
    .filter((event) => event.verticalName && event.eventName)
    .sort((a, b) => {
      const verticalCompare = a.verticalName.localeCompare(b.verticalName);
      return verticalCompare !== 0 ? verticalCompare : a.eventName.localeCompare(b.eventName);
    });
}

function populateDoubleXpVerticalOptions() {
  const { verticalSelect } = getBriefingContentModalElements();
  const selected = verticalSelect.value;
  const verticalNames = normalizeVerticals(editorVerticals)
    .map((vertical) => vertical.name)
    .filter(Boolean);

  verticalSelect.innerHTML = verticalNames.length > 0
    ? verticalNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
    : '<option value="">No verticals found</option>';

  if (selected && verticalNames.includes(selected)) {
    verticalSelect.value = selected;
  }
}

function renderDoubleXpEventList() {
  const { listContainer } = getBriefingContentModalElements();
  const events = collectDoubleXpEvents(editorVerticals);

  if (events.length === 0) {
    listContainer.innerHTML = '<div class="editor-empty-state">No Double XP events are live right now.</div>';
    return;
  }

  listContainer.innerHTML = events
    .map((event, index) => `
      <div class="double-xp-item">
        <div>
          <div class="double-xp-item-title">${escapeHtml(event.eventName)}</div>
          <div class="double-xp-item-subtitle">${escapeHtml(event.verticalName)}</div>
        </div>
        <button class="btn-secondary remove-double-xp-event" data-index="${index}" type="button">Remove</button>
      </div>
    `)
    .join('');

  listContainer.querySelectorAll('.remove-double-xp-event').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.index);
      const target = events[index];
      if (!target) return;

      editorVerticals = editorVerticals.map((vertical) => {
        if (vertical.name !== target.verticalName) return vertical;
        return {
          ...vertical,
          events: (vertical.events || []).filter((event) => {
            const matchesName = String(event?.eventName || '').trim().toLowerCase() === target.eventName.toLowerCase();
            return !(matchesName && event?.double_xp);
          })
        };
      });

      renderDoubleXpEventList();
      setBriefingContentStatus(`Removed "${target.eventName}" from Double XP.`, '#b45309');
    });
  });
}

function syncBriefingContentEditorInputs() {
  const { userInput, descInput, bonusInput, labInput } = getBriefingContentModalElements();
  const highlight = editorCommunityHighlights.highlight_of_the_week || DEFAULT_HIGHLIGHT;

  userInput.value = highlight.user || '';
  descInput.value = highlight.achievement || '';
  bonusInput.value = highlight.bonus_awarded || '';
  labInput.value = editorCommunityHighlights.lab_instructions || '';

  populateDoubleXpVerticalOptions();
  renderDoubleXpEventList();
}

async function loadBriefingContentEditor() {
  const { modal, saveBtn } = getBriefingContentModalElements();
  try {
    setBriefingContentStatus('Loading shared briefing content...', '#2563eb');
    saveBtn.disabled = true;
    const config = await fetchConfig();
    editorCommunityHighlights = normalizeCommunityHighlights(config.community_highlights);
    editorVerticals = normalizeVerticals(config.verticals);
    syncBriefingContentEditorInputs();
    modal.style.display = 'flex';
    setBriefingContentStatus('');
  } catch (error) {
    console.error('Failed to load briefing content editor:', error);
    setStatusMessage('Unable to load shared briefing content.', '#ce0e2d', 'looking');
    clearStatusMessage();
  } finally {
    saveBtn.disabled = false;
  }
}

function addDoubleXpEventFromInputs() {
  const { verticalSelect, eventNameInput } = getBriefingContentModalElements();
  const verticalName = verticalSelect.value.trim();
  const eventName = eventNameInput.value.trim();

  if (!verticalName || !eventName) {
    setBriefingContentStatus('Choose a vertical and enter an event name first.', '#ce0e2d');
    return;
  }

  const matchingVertical = editorVerticals.find((vertical) => vertical.name === verticalName);
  if (!matchingVertical) {
    setBriefingContentStatus('That vertical is missing from config.', '#ce0e2d');
    return;
  }

  const existingEvent = (matchingVertical.events || []).find(
    (event) => String(event?.eventName || '').trim().toLowerCase() === eventName.toLowerCase()
  );

  if (existingEvent?.double_xp) {
    setBriefingContentStatus('That Double XP event is already live.', '#b45309');
    return;
  }

  if (existingEvent) {
    existingEvent.double_xp = true;
  } else {
    matchingVertical.events = [...(matchingVertical.events || []), { eventName, double_xp: true }];
  }

  eventNameInput.value = '';
  renderDoubleXpEventList();
  setBriefingContentStatus(`Added "${eventName}" to Double XP.`, 'green');
}

async function saveBriefingContentEdits() {
  const { modal, saveBtn, userInput, descInput, bonusInput, labInput } = getBriefingContentModalElements();

  const communityHighlights = {
    highlight_of_the_week: {
      user: userInput.value.trim(),
      achievement: descInput.value.trim(),
      bonus_awarded: bonusInput.value.trim()
    },
    lab_instructions: labInput.value.trim()
  };

  try {
    saveBtn.disabled = true;
    setBriefingContentStatus('Saving shared events_config.json...', '#2563eb');
    await updateConfigSections({
      community_highlights: communityHighlights,
      verticals: editorVerticals
    });

    renderCommunityPreview(communityHighlights);
    modal.style.display = 'none';
    setStatusMessage('Briefing content saved to shared events_config.json.', 'green', 'smirk');
    clearStatusMessage();
  } catch (error) {
    console.error('Failed to save briefing content:', error);
    setBriefingContentStatus(error.message || 'Failed to save briefing content.', '#ce0e2d');
  } finally {
    saveBtn.disabled = false;
  }
}

function getSelectorEditorPlatforms() {
  return Object.entries(selectorEditorPlatformSelectors)
    .filter(([, value]) => isPlainObject(value))
    .map(([platformKey, value]) => ({
      key: platformKey,
      label: prettyLabel(platformKey),
      hasAutofill: isPlainObject(value.autofill),
      hasScraper: isPlainObject(value.scraper)
    }))
    .filter((platform) => (platform.hasAutofill || platform.hasScraper) && hasPlatformAccess(currentAccessProfile, platform.key))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getSelectorEditorSectionsForPlatform(platformKey) {
  const platformConfig = selectorEditorPlatformSelectors[platformKey];
  if (!isPlainObject(platformConfig)) return [];
  return ['autofill', 'scraper'].filter((section) => isPlainObject(platformConfig[section]));
}

function getSelectedSelectorSectionNode() {
  const platformConfig = selectorEditorPlatformSelectors[selectorEditorSelectedPlatform];
  if (!isPlainObject(platformConfig)) return null;
  return platformConfig[selectorEditorSelectedSection] || null;
}

function populateSelectorEditorPlatformOptions() {
  const { platformSelect } = getSelectorEditorElements();
  const platforms = getSelectorEditorPlatforms();

  platformSelect.innerHTML = platforms.length > 0
    ? platforms.map((platform) => `<option value="${escapeHtml(platform.key)}">${escapeHtml(platform.label)}</option>`).join('')
    : '<option value="">No editable platforms</option>';

  if (!platforms.some((platform) => platform.key === selectorEditorSelectedPlatform)) {
    selectorEditorSelectedPlatform = platforms[0]?.key || '';
  }
  platformSelect.value = selectorEditorSelectedPlatform;
}

function populateSelectorEditorSectionOptions() {
  const { sectionSelect } = getSelectorEditorElements();
  const sections = getSelectorEditorSectionsForPlatform(selectorEditorSelectedPlatform);

  sectionSelect.innerHTML = sections.length > 0
    ? sections.map((section) => `<option value="${escapeHtml(section)}">${escapeHtml(prettyLabel(section))}</option>`).join('')
    : '<option value="">No editable sections</option>';

  if (!sections.includes(selectorEditorSelectedSection)) {
    selectorEditorSelectedSection = sections[0] || '';
  }
  sectionSelect.value = selectorEditorSelectedSection;
}

function buildSelectorHelpText(platformKey, sectionKey, pathSegments) {
  const pathString = pathSegments.join('.');
  const explicitHelp = SELECTOR_HELP_TEXT?.[platformKey]?.[sectionKey]?.[pathString];
  if (explicitHelp) return explicitHelp;

  const leafLabel = prettyLabel(pathSegments[pathSegments.length - 1] || pathString);
  const groupLabel = prettyLabel(pathSegments[0] || sectionKey);
  if (sectionKey === 'autofill') {
    return `${prettyLabel(platformKey)} autofill: update the paths used to locate "${leafLabel}" inside the ${groupLabel} area of the reporting workflow.`;
  }
  return `${prettyLabel(platformKey)} scraper: update the paths used to capture "${leafLabel}" from the page during evidence gathering.`;
}

function applySelectorCategoryPaths(pathSegments, nextPaths, valueType) {
  const sectionNode = getSelectedSelectorSectionNode();
  if (!isPlainObject(sectionNode)) return;

  let nextValue;
  if (nextPaths.length === 0) {
    nextValue = valueType === 'string' ? '' : [];
  } else if (valueType === 'string' && nextPaths.length === 1) {
    nextValue = nextPaths[0];
  } else {
    nextValue = nextPaths;
  }

  setNestedValue(sectionNode, pathSegments, nextValue);
}

function renderSelectorEditorCategories() {
  const { categoriesContainer } = getSelectorEditorElements();
  const sectionNode = getSelectedSelectorSectionNode();

  if (!isPlainObject(sectionNode)) {
    categoriesContainer.innerHTML = '<div class="editor-empty-state">No editable categories are available for this platform section.</div>';
    currentSelectorCategoryMap = new Map();
    return;
  }

  const categories = flattenEditableSelectorCategories(sectionNode);
  currentSelectorCategoryMap = new Map(categories.map((category) => [category.pathString, category]));

  if (categories.length === 0) {
    categoriesContainer.innerHTML = '<div class="editor-empty-state">No editable categories are available for this platform section.</div>';
    return;
  }

  const groupedCategories = categories.reduce((accumulator, category) => {
    const groupKey = category.group || 'root';
    if (!accumulator[groupKey]) accumulator[groupKey] = [];
    accumulator[groupKey].push(category);
    return accumulator;
  }, {});

  categoriesContainer.innerHTML = Object.entries(groupedCategories)
    .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
    .map(([groupKey, groupCategories]) => `
      <div class="selector-category-group">
        <div class="selector-group-title">${escapeHtml(groupKey === 'root' ? 'General' : prettyLabel(groupKey))}</div>
        ${groupCategories.map((category) => {
          const helpText = buildSelectorHelpText(selectorEditorSelectedPlatform, selectorEditorSelectedSection, category.pathSegments);
          const pathsMarkup = category.paths.length > 0
            ? category.paths.map((pathValue, index) => `
                <div class="selector-path-row">
                  <div class="selector-path-text">${escapeHtml(pathValue)}</div>
                  <button
                    class="icon-button selector-path-delete"
                    type="button"
                    title="Delete this saved path"
                    data-category="${escapeHtml(category.pathString)}"
                    data-index="${index}"
                  >✕</button>
                </div>
              `).join('')
            : '<div class="editor-empty-state">No saved paths for this category yet.</div>';

          return `
            <details class="selector-category">
              <summary>
                <div class="selector-category-label">
                  <span class="selector-category-title">${escapeHtml(category.title)}</span>
                  <span class="selector-category-count">${category.paths.length} saved</span>
                </div>
                <button
                  class="help-pill selector-help-trigger"
                  type="button"
                  data-help="${escapeHtml(helpText)}"
                  title="What this category controls"
                >?</button>
              </summary>
              <div class="selector-category-body">
                <div class="selector-help-text">${escapeHtml(helpText)}</div>
                <div class="selector-path-list">${pathsMarkup}</div>
                <div class="selector-add-row">
                  <input
                    type="text"
                    placeholder="Add a new selector / XPath / regex path"
                    data-add-input="${escapeHtml(category.pathString)}"
                  >
                  <button
                    class="btn-secondary selector-add-path"
                    type="button"
                    data-category="${escapeHtml(category.pathString)}"
                  >Add New Value Path</button>
                </div>
              </div>
            </details>
          `;
        }).join('')}
      </div>
    `)
    .join('');

  categoriesContainer.querySelectorAll('.selector-help-trigger').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      alert(button.dataset.help || 'No help text available.');
    });
  });

  categoriesContainer.querySelectorAll('.selector-add-path').forEach((button) => {
    button.addEventListener('click', () => {
      const categoryKey = button.dataset.category || '';
      const input = categoriesContainer.querySelector(`[data-add-input="${CSS.escape(categoryKey)}"]`);
      const category = currentSelectorCategoryMap.get(categoryKey);
      if (!input || !category) return;

      const newPath = input.value.trim();
      if (!newPath) {
        setSelectorEditorStatus('Enter a value path before adding it.', '#ce0e2d');
        return;
      }

      const currentPaths = normalizeSelectorPaths(readNestedValue(getSelectedSelectorSectionNode(), category.pathSegments));
      const nextPaths = [newPath, ...currentPaths.filter((pathValue) => pathValue !== newPath)];
      let droppedPath = '';
      if (nextPaths.length > SELECTOR_EDITOR_MAX_PATHS) {
        droppedPath = nextPaths[SELECTOR_EDITOR_MAX_PATHS];
        nextPaths.length = SELECTOR_EDITOR_MAX_PATHS;
      }

      applySelectorCategoryPaths(category.pathSegments, nextPaths, category.valueType);
      renderSelectorEditorCategories();
      setSelectorEditorStatus(
        droppedPath
          ? `Saved new path for ${category.title}. Oldest path was removed to keep the most recent ${SELECTOR_EDITOR_MAX_PATHS}.`
          : `Saved new path for ${category.title}.`,
        droppedPath ? '#b45309' : 'green'
      );
    });
  });

  categoriesContainer.querySelectorAll('[data-add-input]').forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const categoryKey = input.getAttribute('data-add-input') || '';
      categoriesContainer.querySelector(`.selector-add-path[data-category="${CSS.escape(categoryKey)}"]`)?.click();
    });
  });

  categoriesContainer.querySelectorAll('.selector-path-delete').forEach((button) => {
    button.addEventListener('click', () => {
      const categoryKey = button.dataset.category || '';
      const category = currentSelectorCategoryMap.get(categoryKey);
      const index = Number(button.dataset.index);
      if (!category || Number.isNaN(index)) return;

      const currentPaths = normalizeSelectorPaths(readNestedValue(getSelectedSelectorSectionNode(), category.pathSegments));
      const targetPath = currentPaths[index];
      if (!targetPath) return;

      const fruit = SELECTOR_EDITOR_DELETE_FRUITS[Math.floor(Math.random() * SELECTOR_EDITOR_DELETE_FRUITS.length)];
      pendingSelectorDelete = {
        categoryKey,
        pathIndex: index,
        fruit,
        targetPath
      };

      const { modal, copy, input, status: confirmStatus } = getDeleteConfirmElements();
      copy.innerText = `Type "${fruit}" to delete this saved path from ${category.title}.`;
      input.value = '';
      confirmStatus.innerText = '';
      modal.style.display = 'flex';
      input.focus();
    });
  });
}

async function loadSelectorPathEditor() {
  const { modal, saveBtn } = getSelectorEditorElements();
  try {
    setSelectorEditorStatus('Loading shared selector paths...', '#2563eb');
    saveBtn.disabled = true;
    const config = await fetchConfig();
    selectorEditorPlatformSelectors = normalizePlatformSelectors(config.platform_selectors);

    populateSelectorEditorPlatformOptions();
    populateSelectorEditorSectionOptions();
    renderSelectorEditorCategories();
    modal.style.display = 'flex';
    setSelectorEditorStatus('');
  } catch (error) {
    console.error('Failed to load selector editor:', error);
    setStatusMessage('Unable to load selector path editor.', '#ce0e2d', 'looking');
    clearStatusMessage();
  } finally {
    saveBtn.disabled = false;
  }
}

async function saveSelectorPathEdits() {
  const { modal, saveBtn } = getSelectorEditorElements();
  try {
    saveBtn.disabled = true;
    setSelectorEditorStatus('Saving selector paths to shared events_config.json...', '#2563eb');
    await updateConfigSections({
      platform_selectors: selectorEditorPlatformSelectors
    }, selectorEditorSelectedPlatform);

    modal.style.display = 'none';
    setStatusMessage('Selector paths saved to shared events_config.json.', 'green', 'smirk');
    clearStatusMessage();
  } catch (error) {
    console.error('Failed to save selector paths:', error);
    setSelectorEditorStatus(error.message || 'Failed to save selector paths.', '#ce0e2d');
  } finally {
    saveBtn.disabled = false;
  }
}

function closeSelectorDeleteConfirmModal() {
  pendingSelectorDelete = null;
  const { modal, input } = getDeleteConfirmElements();
  modal.style.display = 'none';
  input.value = '';
  setDeleteConfirmStatus('');
}

function confirmSelectorDelete() {
  if (!pendingSelectorDelete) return;

  const { input } = getDeleteConfirmElements();
  if (input.value.trim().toLowerCase() !== pendingSelectorDelete.fruit.toLowerCase()) {
    setDeleteConfirmStatus(`Type "${pendingSelectorDelete.fruit}" exactly to confirm this delete.`, '#ce0e2d');
    return;
  }

  const category = currentSelectorCategoryMap.get(pendingSelectorDelete.categoryKey);
  if (!category) {
    closeSelectorDeleteConfirmModal();
    return;
  }

  const currentPaths = normalizeSelectorPaths(readNestedValue(getSelectedSelectorSectionNode(), category.pathSegments));
  const nextPaths = currentPaths.filter((_, index) => index !== pendingSelectorDelete.pathIndex);
  applySelectorCategoryPaths(category.pathSegments, nextPaths, category.valueType);

  closeSelectorDeleteConfirmModal();
  renderSelectorEditorCategories();
  setSelectorEditorStatus(`Deleted one saved path from ${category.title}.`, '#b45309');
}

function showSettingsAccessState({ title, message, state = '', showRetry = false }) {
  const accessState = document.getElementById('settings-access-state');
  if (!accessState) return;

  accessState.replaceChildren();
  accessState.className = `settings-access-state${state ? ` is-${state}` : ''}`;
  const heading = document.createElement('strong');
  heading.textContent = title;
  const copy = document.createElement('div');
  copy.textContent = message;
  accessState.append(heading, copy);

  if (showRetry) {
    const retryButton = document.createElement('button');
    retryButton.type = 'button';
    retryButton.className = 'btn-secondary';
    retryButton.style.marginTop = '10px';
    retryButton.textContent = 'Retry access check';
    retryButton.addEventListener('click', () => {
      void refreshSidepanelAccessView();
      window.location.reload();
    });
    accessState.appendChild(retryButton);
  }

  accessState.hidden = false;
}

function hideProtectedSettings() {
  document.querySelectorAll('[data-access-permission]').forEach((section) => {
    section.hidden = true;
  });
  document.getElementById('community-lab-section').hidden = true;
}

function setAuthStatus(message = '', color = '#475569') {
  const authStatus = document.getElementById('auth-status');
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.style.color = color;
}

function setAuthFormsDisabled(disabled) {
  document.querySelectorAll('#access-login-form input, #access-login-form select, #access-login-form button, #access-create-form input, #access-create-form button')
    .forEach((control) => { control.disabled = disabled; });
}

function hideLoginEmailSelection() {
  const group = document.getElementById('login-email-group');
  const select = document.getElementById('login_email');
  group.hidden = true;
  select.required = false;
  select.replaceChildren(new Option('Choose your email…', ''));
}

function showMiddleNameChallenge(formPrefix, message) {
  const group = document.getElementById(`${formPrefix}-middle-name-group`);
  const input = document.getElementById(`${formPrefix}_middle_name`);
  group.hidden = false;
  input.required = true;
  setAuthFormsDisabled(false);
  setAuthStatus(message || 'Another user has the same first and last name. Enter your middle name or initial.', '#92400e');
  input.focus();
}

function showLoginEmailChallenge(emails, message) {
  const group = document.getElementById('login-email-group');
  const select = document.getElementById('login_email');
  select.replaceChildren(new Option('Choose your email…', ''));
  (Array.isArray(emails) ? emails : []).forEach((email) => {
    select.appendChild(new Option(email, email));
  });
  group.hidden = false;
  select.required = true;
  setAuthFormsDisabled(false);
  setAuthStatus(message || 'Select your email, then log in with your password.', '#92400e');
  select.focus();
}

function renderExtensionAuthState(profile) {
  const isLoggedOut = !profile || profile.status === 'logged_out';
  const loggedOut = document.getElementById('auth-logged-out');
  const loggedIn = document.getElementById('auth-logged-in');
  loggedOut.hidden = !isLoggedOut;
  loggedIn.hidden = isLoggedOut;

  if (isLoggedOut) {
    setAuthStatus('Log in with an existing account or create a new user.');
    return;
  }

  document.getElementById('auth-session-name').textContent = profile.name || 'Extension user';
  const accessLabel = ['ready', 'waiting_approval'].includes(profile.status)
    ? roleLabel(profile.role)
    : 'Access unavailable';
  document.getElementById('auth-session-details').textContent = `${profile.email || 'Google identity unavailable'} · ${accessLabel}`;

  if (profile.status === 'waiting_approval') {
    setAuthStatus('Waiting for administrator approval. After an admin updates the sheet, use Retry / Refresh Access or reopen Settings.', '#92400e');
  } else if (profile.status === 'identity_error') {
    setAuthStatus('The active Google account does not match this extension session. Log out, switch accounts, and try again.', '#991b1b');
  } else if (profile.status !== 'ready') {
    setAuthStatus('The current extension session could not be verified. You can log out and try again.', '#991b1b');
  } else {
    setAuthStatus('Signed in. Your access level was refreshed from the registry.', '#166534');
  }
}

function bindExtensionAuthEvents() {
  const loginForm = document.getElementById('access-login-form');
  const createForm = document.getElementById('access-create-form');
  const loginMiddleNameGroup = document.getElementById('login-middle-name-group');
  const createMiddleNameGroup = document.getElementById('create-middle-name-group');
  const refreshButton = document.getElementById('refresh_access_user');
  const logoutButton = document.getElementById('logout_access_user');

  ['login_first_name', 'login_last_name'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      loginMiddleNameGroup.hidden = true;
      document.getElementById('login_middle_name').required = false;
      document.getElementById('login_middle_name').value = '';
      hideLoginEmailSelection();
    });
  });
  document.getElementById('login_middle_name').addEventListener('input', hideLoginEmailSelection);
  ['create_first_name', 'create_last_name'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      createMiddleNameGroup.hidden = true;
      document.getElementById('create_middle_name').required = false;
      document.getElementById('create_middle_name').value = '';
    });
  });

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const firstName = document.getElementById('login_first_name').value.trim();
    const lastName = document.getElementById('login_last_name').value.trim();
    const middleName = document.getElementById('login_middle_name').value.trim();
    const email = document.getElementById('login_email').value;
    const passwordInput = document.getElementById('login_password');
    setAuthFormsDisabled(true);
    setAuthStatus('Logging in and refreshing access…', '#2563eb');
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'loginAccessUser',
        credentials: { firstName, lastName, middleName, email, password: passwordInput.value }
      });
      if (!response?.success) throw new Error(response?.error || 'Login failed.');
      if (response.challenge === 'middle_name') {
        showMiddleNameChallenge('login', response.message);
        return;
      }
      if (response.challenge === 'email_selection') {
        showLoginEmailChallenge(response.emails, response.message);
        return;
      }
      if (!response.profile) throw new Error('Login did not return an access profile.');
      passwordInput.value = '';
      await refreshSidepanelAccessView();
      window.location.reload();
    } catch (error) {
      passwordInput.value = '';
      setAuthStatus(error.message || 'Login failed.', '#991b1b');
      setAuthFormsDisabled(false);
    }
  });

  createForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const firstName = document.getElementById('create_first_name').value.trim();
    const lastName = document.getElementById('create_last_name').value.trim();
    const middleName = document.getElementById('create_middle_name').value.trim();
    const passwordInput = document.getElementById('create_password');
    const confirmInput = document.getElementById('create_password_confirm');
    if (passwordInput.value !== confirmInput.value) {
      setAuthStatus('Passwords do not match.', '#991b1b');
      return;
    }

    setAuthFormsDisabled(true);
    setAuthStatus('Creating your account…', '#2563eb');
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'createAccessUser',
        credentials: { firstName, lastName, middleName, password: passwordInput.value }
      });
      if (!response?.success) throw new Error(response?.error || 'Account creation failed.');
      if (response.challenge === 'middle_name') {
        showMiddleNameChallenge('create', response.message);
        return;
      }
      if (!response.profile) throw new Error('Account creation did not return an access profile.');
      passwordInput.value = '';
      confirmInput.value = '';
      await refreshSidepanelAccessView();
      window.location.reload();
    } catch (error) {
      passwordInput.value = '';
      confirmInput.value = '';
      setAuthStatus(error.message || 'Account creation failed.', '#991b1b');
      setAuthFormsDisabled(false);
    }
  });

  refreshButton.addEventListener('click', async () => {
    refreshButton.disabled = true;
    setAuthStatus('Refreshing your access level from the registry…', '#2563eb');
    try {
      const response = await chrome.runtime.sendMessage({ action: 'refreshAccessProfile' });
      if (!response?.success) throw new Error(response?.error || 'Access refresh failed.');
      await refreshSidepanelAccessView();
      window.location.reload();
    } catch (error) {
      setAuthStatus(error.message || 'Access refresh failed.', '#991b1b');
      refreshButton.disabled = false;
    }
  });

  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    setAuthStatus('Logging out…', '#2563eb');
    try {
      const response = await chrome.runtime.sendMessage({ action: 'logoutAccessUser' });
      if (!response?.success) throw new Error(response?.error || 'Logout failed.');
      window.location.reload();
    } catch (error) {
      setAuthStatus(error.message || 'Logout failed.', '#991b1b');
      logoutButton.disabled = false;
    }
  });
}

function applySettingsAccess(profile) {
  document.querySelectorAll('[data-access-permission]').forEach((section) => {
    section.hidden = !hasPermission(profile, section.dataset.accessPermission);
  });
  document.getElementById('community-lab-section').hidden = true;
  document.getElementById('settings-access-state').hidden = true;
  const subtitle = document.querySelector('p.subtitle');
  if (subtitle) subtitle.textContent = `${roleLabel(profile.role)} access · ${profile.email}`;
}

function setAccessManagerStatus(message, color = '#374151') {
  const statusElement = document.getElementById('access_manager_status');
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.style.color = color;
}

function syncAllPlatformsControl() {
  const allPlatforms = document.getElementById('access_all_platforms');
  document.querySelectorAll('#access_platform_grid input[type="checkbox"]').forEach((checkbox) => {
    checkbox.disabled = Boolean(allPlatforms?.checked);
  });
}

function populateAccessUserEditor(user) {
  selectedAccessUser = user;
  const editor = document.getElementById('access_user_editor');
  document.getElementById('access_user_first_name').value = user.firstName || '';
  document.getElementById('access_user_last_name').value = user.lastName || '';
  document.getElementById('access_user_middle_name').value = user.middleName || '';
  document.getElementById('access_user_email').value = user.email || '';
  document.getElementById('access_user_role').value = user.role || 'waiting_approval';
  const managedConfig = user.managedConfig || {};
  document.getElementById('access_drive_root_id').value = managedConfig.driveRootId || '';
  document.getElementById('access_drive_root_label').value = managedConfig.driveRootLabel || '';
  document.getElementById('access_report_sheet_id').value = managedConfig.reportSheetId || '';
  document.getElementById('access_report_sheet_label').value = managedConfig.reportSheetLabel || '';
  document.getElementById('access_event_sheet_id').value = managedConfig.eventSheetId || '';
  document.getElementById('access_event_sheet_label').value = managedConfig.eventSheetLabel || '';

  const allPlatforms = document.getElementById('access_all_platforms');
  const assignedPlatforms = new Set(user.platforms || []);
  allPlatforms.checked = assignedPlatforms.has('all');

  const platformGrid = document.getElementById('access_platform_grid');
  platformGrid.replaceChildren();
  PLATFORM_CATALOG.forEach((platform) => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = platform.key;
    checkbox.checked = assignedPlatforms.has(platform.key);
    const copy = document.createElement('span');
    copy.textContent = platform.label;
    label.append(checkbox, copy);
    platformGrid.appendChild(label);
  });

  syncAllPlatformsControl();
  editor.hidden = false;
  document.getElementById('save_access_user').disabled = false;
  document.querySelectorAll('.access-user-result').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.email === user.email);
  });
  setAccessManagerStatus('');
}

function renderAccessUsers(users) {
  const results = document.getElementById('access_user_results');
  results.replaceChildren();

  if (!Array.isArray(users) || users.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'editor-empty-state';
    empty.textContent = 'No matching users found.';
    results.appendChild(empty);
    return;
  }

  users.forEach((user) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'access-user-result';
    button.dataset.email = user.email;
    const name = document.createElement('strong');
    name.textContent = user.middleName
      ? `${user.name || 'Unnamed user'} · Middle: ${user.middleName}`
      : user.name || 'Unnamed user';
    const details = document.createElement('span');
    const platformSummary = user.platforms?.includes('all') ? 'All platforms' : (user.platforms || []).join(', ') || 'No platforms';
    details.textContent = `${user.email} · ${roleLabel(user.role)} · ${platformSummary}`;
    button.append(name, details);
    button.addEventListener('click', () => populateAccessUserEditor(user));
    results.appendChild(button);
  });
}

async function loadAccessUsers(query = '') {
  const results = document.getElementById('access_user_results');
  results.innerHTML = '<div class="editor-empty-state">Loading users…</div>';
  setAccessManagerStatus('');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'listAccessUsers', query });
    if (!response?.success) throw new Error(response?.error || 'Unable to load users.');
    renderAccessUsers(response.users);
  } catch (error) {
    results.replaceChildren();
    const failure = document.createElement('div');
    failure.className = 'editor-empty-state';
    failure.textContent = error.message || 'Unable to load users.';
    results.appendChild(failure);
    setAccessManagerStatus('Access registry lookup failed.', '#ce0e2d');
  }
}

function bindAccessManagerEvents() {
  const modal = document.getElementById('access-manager-modal');
  const search = document.getElementById('access_user_search');
  const allPlatforms = document.getElementById('access_all_platforms');
  const saveButton = document.getElementById('save_access_user');

  document.getElementById('open_access_manager')?.addEventListener('click', () => {
    modal.style.display = 'flex';
    selectedAccessUser = null;
    document.getElementById('access_user_editor').hidden = true;
    saveButton.disabled = true;
    search.value = '';
    void loadAccessUsers();
    search.focus();
  });

  document.getElementById('close_access_manager')?.addEventListener('click', () => {
    modal.style.display = 'none';
    setAccessManagerStatus('');
  });

  search.addEventListener('input', () => {
    clearTimeout(accessSearchTimer);
    accessSearchTimer = setTimeout(() => void loadAccessUsers(search.value), 250);
  });

  allPlatforms.addEventListener('change', syncAllPlatformsControl);

  saveButton.addEventListener('click', async () => {
    if (!selectedAccessUser) return;
    const firstName = document.getElementById('access_user_first_name').value.trim();
    const lastName = document.getElementById('access_user_last_name').value.trim();
    const middleName = document.getElementById('access_user_middle_name').value.trim();
    const email = document.getElementById('access_user_email').value.trim();
    const role = document.getElementById('access_user_role').value;
    const platforms = allPlatforms.checked
      ? ['all']
      : Array.from(document.querySelectorAll('#access_platform_grid input[type="checkbox"]:checked'))
        .map((checkbox) => checkbox.value);
    const managedConfig = {
      driveRootId: document.getElementById('access_drive_root_id').value.trim(),
      driveRootLabel: document.getElementById('access_drive_root_label').value.trim(),
      reportSheetId: document.getElementById('access_report_sheet_id').value.trim(),
      reportSheetLabel: document.getElementById('access_report_sheet_label').value.trim(),
      eventSheetId: document.getElementById('access_event_sheet_id').value.trim(),
      eventSheetLabel: document.getElementById('access_event_sheet_label').value.trim()
    };

    if (!firstName || !lastName) {
      setAccessManagerStatus('Enter the user\'s first and last name.', '#ce0e2d');
      return;
    }

    const changesOwnUsername = email === currentAccessProfile?.email &&
      (
        firstName !== (currentAccessProfile.firstName || '') ||
        lastName !== (currentAccessProfile.lastName || '') ||
        middleName !== (currentAccessProfile.middleName || '')
      );
    const changesOwnRole = email === currentAccessProfile?.email && role !== currentAccessProfile.role;
    const changesOwnPlatforms = email === currentAccessProfile?.email &&
      [...platforms].sort().join(',') !== [...(currentAccessProfile.platforms || [])].sort().join(',');
    const changesOwnConnectivity = email === currentAccessProfile?.email &&
      JSON.stringify(managedConfig) !== JSON.stringify(currentAccessProfile.managedConfig || {});
    if (changesOwnUsername || changesOwnRole || changesOwnPlatforms || changesOwnConnectivity) {
      const confirmed = confirm('You are changing your own name, access level, platform access, or managed connectivity. Continue?');
      if (!confirmed) return;
    }

    saveButton.disabled = true;
    setAccessManagerStatus('Saving access changes…', '#2563eb');
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'updateAccessUser',
        user: { email, firstName, lastName, middleName, role, platforms, managedConfig }
      });
      if (!response?.success) throw new Error(response?.error || 'Unable to update this user.');
      selectedAccessUser = response.user;
      setAccessManagerStatus('Access updated successfully.', 'green');

      if (email === currentAccessProfile?.email) {
        setTimeout(() => window.location.reload(), 700);
        return;
      }

      await loadAccessUsers(search.value);
      const refreshedButton = Array.from(document.querySelectorAll('.access-user-result'))
        .find((button) => button.dataset.email === email);
      refreshedButton?.click();
    } catch (error) {
      setAccessManagerStatus(error.message || 'Unable to update this user.', '#ce0e2d');
    } finally {
      saveButton.disabled = false;
    }
  });
}

function openEvidenceLocker() {
  if (!hasPermission(currentAccessProfile, PERMISSIONS.SETTINGS_OPEN_LOCKER)) {
    status.style.color = '#ce0e2d';
    status.innerText = 'Your access level does not allow opening the Evidence Locker.';
    return;
  }

  const folderId = getConnectivityValue('piracy_folder_id');
  if (folderId) {
    window.open(`https://drive.google.com/drive/folders/${folderId}`, '_blank');
    return;
  }

  setClippyState('looking');
  status.style.color = '#ce0e2d';
  status.innerText = 'Please enter a Folder ID first to open the locker.';
  setTimeout(() => {
    status.innerText = '';
    setClippyState('default');
  }, 3000);
}

function bindCoreOptionsEvents() {
  document.getElementById('open_evidence_locker').addEventListener('click', openEvidenceLocker);

  let clickCount = 0;
  const headerTitle = document.querySelector('header h1');
  const easterEggOverlay = document.getElementById('easter-egg');
  headerTitle.addEventListener('click', () => {
    clickCount += 1;
    if (clickCount < 5) return;
    clickCount = 0;
    easterEggOverlay.style.display = 'flex';
    new Audio(chrome.runtime.getURL('Piratemusic.mp3')).play().catch((error) => console.warn('Audio play blocked:', error));
  });
  easterEggOverlay.addEventListener('click', () => {
    easterEggOverlay.style.display = 'none';
  });

  document.getElementById('send_suggestion').addEventListener('click', () => {
    const text = document.getElementById('suggestion_text').value.trim();
    const sugStatus = document.getElementById('suggestion_status');

    if (!text) {
      setClippyState('looking');
      sugStatus.style.color = '#ce0e2d';
      sugStatus.innerText = 'Field is empty!';
      return;
    }

    setClippyState('talking');
    sugStatus.style.color = '#2563eb';
    sugStatus.innerText = 'Transmitting...';

    chrome.runtime.sendMessage({ action: 'submitSuggestion', text }, (response) => {
      if (response && response.success) {
        setClippyState('smirk');
        sugStatus.style.color = 'green';
        sugStatus.innerText = '✅ Comms received. Thanks!';
        document.getElementById('suggestion_text').value = '';
      } else {
        setClippyState('default');
        sugStatus.style.color = '#ce0e2d';
        sugStatus.innerText = '❌ Uplink failed.';
      }
    });
  });

  document.getElementById('save').addEventListener('click', () => {
    const folderId = getConnectivityValue('piracy_folder_id');
    const sheetId = getConnectivityValue('piracy_sheet_id');
    const eventSheetId = getConnectivityValue('event_sheet_id');
    const reportMode = document.getElementById('report_mode').value;

    if (!folderId || !sheetId || !eventSheetId) {
      setClippyState('talking');
      status.style.color = '#ce0e2d';
      status.innerText = 'Missing IDs! Check Clippy for details.';

      if (window.showClippyMessage) {
        window.showClippyMessage('Missing IDs! Please check the <a href="https://flocasts.atlassian.net/wiki/spaces/FSM/pages/5634621448/FloSports+Pirate+Reporter+3.3.1+Pirate+AI#Options-Set-up" target="_blank" style="color: #2563eb; text-decoration: underline;">Setup Guide</a> to fill out all boxes.');
      }
      return;
    }

    const connectivityUpdates = {
      piracy_folder_id: folderId,
      piracy_sheet_id: sheetId,
      event_sheet_id: eventSheetId,
      report_mode: reportMode
    };
    CONNECTIVITY_FIELDS.forEach(({ inputId, storageKey }) => {
      const input = document.getElementById(inputId);
      if (input.dataset.managed !== 'true') connectivityUpdates[`manual_${storageKey}`] = input.value.trim();
    });

    chrome.storage.sync.set(connectivityUpdates, () => {
      void refreshSidepanelAccessView();
      setClippyState('smirk');
      status.style.color = 'green';
      status.innerText = 'Configurations Locked. Ready for Hunt.';

      chrome.storage.local.get(['onboarding_step'], (res) => {
        if (res.onboarding_step === 'NEEDS_CONFIG') {
          chrome.storage.local.set({ onboarding_step: 'READY_FOR_FIRST_REPORT' });
>>>>>>> Stashed changes
        }
        cursor = cursor[segment];
    }
    cursor[pathSegments[pathSegments.length - 1]] = nextValue;
}

function setStatusMessage(message, color = '#374151', clippyState = 'default') {
    setClippyState(clippyState);
    status.style.color = color;
    status.innerText = message;
}

<<<<<<< Updated upstream
function clearStatusMessage(delayMs = 3000) {
    setTimeout(() => {
        status.innerText = '';
        setClippyState('default');
    }, delayMs);
}

function renderCommunityPreview(config) {
    const highlights = normalizeCommunityHighlights(config);
    const weekly = highlights.highlight_of_the_week;
    const description = weekly.achievement || 'Team highlight coming soon.';
    const bonus = weekly.bonus_awarded || '';

    getEl('lab-instructions').innerText = highlights.lab_instructions || DEFAULT_LAB_INSTRUCTIONS;
    getEl('highlight-user').innerText = weekly.user || 'TBD';
    getEl('highlight-desc').innerHTML = bonus
        ? `${escapeHtml(description)} <span style="color:#10b981; font-weight:bold;">[${escapeHtml(bonus)}]</span>`
        : escapeHtml(description);
}

function getBriefingContentModalElements() {
    return {
        modal: getEl('briefing-content-modal'),
        modalStatus: getEl('briefing-content-status'),
        userInput: getEl('briefing_highlight_user'),
        descInput: getEl('briefing_highlight_desc'),
        bonusInput: getEl('briefing_highlight_bonus'),
        labInput: getEl('briefing_lab_instructions_input'),
        verticalSelect: getEl('double_xp_vertical'),
        eventNameInput: getEl('double_xp_event_name'),
        listContainer: getEl('double_xp_event_list'),
        saveBtn: getEl('save_briefing_content')
    };
}

function getSelectorEditorElements() {
    return {
        modal: getEl('selector-path-editor-modal'),
        platformSelect: getEl('selector_editor_platform'),
        sectionSelect: getEl('selector_editor_section'),
        categoriesContainer: getEl('selector-editor-categories'),
        status: getEl('selector-editor-status'),
        saveBtn: getEl('save_selector_editor')
    };
}

function getDeleteConfirmElements() {
    return {
        modal: getEl('selector-delete-confirm-modal'),
        copy: getEl('selector-delete-confirm-copy'),
        input: getEl('selector_delete_confirm_input'),
        status: getEl('selector-delete-confirm-status')
    };
}

function setBriefingContentStatus(message, color = '#374151') {
    const { modalStatus } = getBriefingContentModalElements();
    if (!modalStatus) return;
    modalStatus.style.color = color;
    modalStatus.innerText = message;
}

function setSelectorEditorStatus(message, color = '#374151') {
    const { status: statusEl } = getSelectorEditorElements();
    if (!statusEl) return;
    statusEl.style.color = color;
    statusEl.innerText = message;
}

function setDeleteConfirmStatus(message, color = '#374151') {
    const { status: statusEl } = getDeleteConfirmElements();
    if (!statusEl) return;
    statusEl.style.color = color;
    statusEl.innerText = message;
}

function getEventDisplayName(event) {
    return String(event?.eventName || event?.name || '').trim();
}

function collectDoubleXpEvents(verticals) {
    return normalizeVerticals(verticals)
        .flatMap((vertical) =>
            (vertical.events || [])
                .filter((event) => event?.double_xp)
                .map((event) => ({
                    verticalName: vertical.name,
                    eventName: getEventDisplayName(event)
                }))
        )
        .filter((event) => event.verticalName && event.eventName)
        .sort((a, b) => {
            const verticalCompare = a.verticalName.localeCompare(b.verticalName);
            return verticalCompare !== 0 ? verticalCompare : a.eventName.localeCompare(b.eventName);
        });
}

function populateDoubleXpVerticalOptions() {
    const { verticalSelect } = getBriefingContentModalElements();
    if (!verticalSelect) return;
    const selected = verticalSelect.value;
    const verticalNames = normalizeVerticals(editorVerticals)
        .map((vertical) => vertical.name)
        .filter(Boolean);

    verticalSelect.innerHTML = verticalNames.length > 0
        ? verticalNames.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')
        : '<option value="">No verticals found</option>';

    if (selected && verticalNames.includes(selected)) {
        verticalSelect.value = selected;
    }
}

function renderDoubleXpEventList() {
    const { listContainer } = getBriefingContentModalElements();
    if (!listContainer) return;
    const events = collectDoubleXpEvents(editorVerticals);

    if (events.length === 0) {
        listContainer.innerHTML = '<div class="editor-empty-state">No Double XP events are live right now.</div>';
        return;
    }

    listContainer.innerHTML = events
        .map((event, index) => `
            <div class="double-xp-item">
              <div>
                <div class="double-xp-item-title">${escapeHtml(event.eventName)}</div>
                <div class="double-xp-item-subtitle">${escapeHtml(event.verticalName)}</div>
              </div>
              <button class="btn-secondary remove-double-xp-event" data-index="${index}" type="button">Remove</button>
            </div>
        `)
        .join('');

    listContainer.querySelectorAll('.remove-double-xp-event').forEach((button) => {
        button.addEventListener('click', () => {
            const target = events[Number(button.dataset.index)];
            if (!target) return;

            editorVerticals = editorVerticals.map((vertical) => {
                if (vertical.name !== target.verticalName) return vertical;
                return {
                    ...vertical,
                    events: (vertical.events || []).map((event) => {
                        const matchesName = getEventDisplayName(event).toLowerCase() === target.eventName.toLowerCase();
                        return matchesName ? { ...event, double_xp: false } : event;
                    })
                };
            });

            renderDoubleXpEventList();
            setBriefingContentStatus(`Removed "${target.eventName}" from Double XP. Save to apply it.`, '#b45309');
        });
    });
}

function syncBriefingContentEditorInputs() {
    const { userInput, descInput, bonusInput, labInput } = getBriefingContentModalElements();
    const highlight = editorCommunityHighlights.highlight_of_the_week || DEFAULT_HIGHLIGHT;

    if (userInput) userInput.value = highlight.user || '';
    if (descInput) descInput.value = highlight.achievement || '';
    if (bonusInput) bonusInput.value = highlight.bonus_awarded || '';
    if (labInput) labInput.value = editorCommunityHighlights.lab_instructions || '';

    populateDoubleXpVerticalOptions();
    renderDoubleXpEventList();
}

async function loadBriefingContentEditor() {
    const { modal, saveBtn, verticalSelect, listContainer } = getBriefingContentModalElements();
    let loaded = false;
    if (modal) modal.style.display = 'flex';
    if (verticalSelect) verticalSelect.innerHTML = '<option value="">Loading verticals...</option>';
    if (listContainer) listContainer.innerHTML = '<div class="editor-empty-state">Loading Double XP events...</div>';

    try {
        setBriefingContentStatus('Loading shared briefing content...', '#2563eb');
        if (saveBtn) saveBtn.disabled = true;
        const config = await fetchConfig();
        editorCommunityHighlights = normalizeCommunityHighlights(config.community_highlights);
        editorVerticals = normalizeVerticals(config.verticals);
        syncBriefingContentEditorInputs();
        loaded = true;
        setBriefingContentStatus('');
    } catch (error) {
        console.error('Failed to load briefing content editor:', error);
        setBriefingContentStatus(error.message || 'Unable to load shared briefing content.', '#ce0e2d');
        setStatusMessage('Unable to load shared briefing content.', '#ce0e2d', 'looking');
        clearStatusMessage(4500);
    } finally {
        if (saveBtn) saveBtn.disabled = !loaded;
    }
}

function addDoubleXpEventFromInputs() {
    const { verticalSelect, eventNameInput } = getBriefingContentModalElements();
    const verticalName = verticalSelect?.value.trim() || '';
    const eventName = eventNameInput?.value.trim() || '';

    if (!verticalName || !eventName) {
        setBriefingContentStatus('Choose a vertical and enter an event name first.', '#ce0e2d');
        return;
    }

    const matchingVertical = editorVerticals.find((vertical) => vertical.name === verticalName);
    if (!matchingVertical) {
        setBriefingContentStatus('That vertical is missing from config.', '#ce0e2d');
        return;
    }

    const existingEvent = (matchingVertical.events || []).find(
        (event) => getEventDisplayName(event).toLowerCase() === eventName.toLowerCase()
    );

    if (existingEvent?.double_xp) {
        setBriefingContentStatus('That Double XP event is already live.', '#b45309');
        return;
    }

    if (existingEvent) {
        existingEvent.double_xp = true;
    } else {
        matchingVertical.events = [...(matchingVertical.events || []), { eventName, double_xp: true }];
    }

    if (eventNameInput) eventNameInput.value = '';
    renderDoubleXpEventList();
    setBriefingContentStatus(`Added "${eventName}" to Double XP. Save to apply it.`, 'green');
}

async function saveBriefingContentEdits() {
    const { modal, saveBtn, userInput, descInput, bonusInput, labInput } = getBriefingContentModalElements();
    const communityHighlights = {
        highlight_of_the_week: {
            user: userInput?.value.trim() || '',
            achievement: descInput?.value.trim() || '',
            bonus_awarded: bonusInput?.value.trim() || ''
        },
        lab_instructions: labInput?.value.trim() || ''
    };

    try {
        if (saveBtn) saveBtn.disabled = true;
        setBriefingContentStatus('Saving shared events_config.json...', '#2563eb');
        await updateConfigSections({
            community_highlights: communityHighlights,
            verticals: editorVerticals
        });

        renderCommunityPreview(communityHighlights);
        if (modal) modal.style.display = 'none';
        setStatusMessage('Briefing content saved to shared events_config.json.', 'green', 'smirk');
        clearStatusMessage();
    } catch (error) {
        console.error('Failed to save briefing content:', error);
        setBriefingContentStatus(error.message || 'Failed to save briefing content.', '#ce0e2d');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function normalizeSelectorPaths(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => {
                if (typeof item === 'string') return item;
                if (isPlainObject(item) && typeof item.selector === 'string') return item.selector;
                return '';
            })
            .filter(Boolean);
    }
    if (typeof value === 'string') return value ? [value] : [];
    return [];
}

function isEditableSelectorLeaf(pathSegments, value) {
    if (pathSegments.some((segment) => segment.startsWith('_COMMENT'))) return false;
    if (pathSegments.length === 0) return false;

    const topLevelGroup = pathSegments[0];
    const leafKey = pathSegments[pathSegments.length - 1];
    if (NON_EDITABLE_SELECTOR_GROUPS.has(topLevelGroup)) return false;
    if (NON_EDITABLE_SELECTOR_LEAFS.has(leafKey)) return false;

    return Array.isArray(value) || typeof value === 'string';
}

function flattenEditableSelectorCategories(node, pathSegments = [], results = []) {
    if (!isPlainObject(node)) return results;

    Object.entries(node).forEach(([key, value]) => {
        if (key.startsWith('_COMMENT')) return;
        const nextPath = [...pathSegments, key];

        if (isPlainObject(value)) {
            flattenEditableSelectorCategories(value, nextPath, results);
            return;
        }

        if (!isEditableSelectorLeaf(nextPath, value)) return;

        const group = nextPath.length > 1 ? nextPath[0] : 'root';
        const title = nextPath.length > 1
            ? `${prettyLabel(nextPath[0])} / ${prettyLabel(nextPath[nextPath.length - 1])}`
            : prettyLabel(nextPath[0]);

        results.push({
            pathSegments: nextPath,
            pathString: nextPath.join('.'),
            group,
            title,
            valueType: Array.isArray(value) ? 'array' : 'string',
            paths: normalizeSelectorPaths(value)
        });
    });

    return results;
}

function getSelectorEditorPlatforms() {
    return Object.entries(selectorEditorPlatformSelectors)
        .filter(([, value]) => isPlainObject(value))
        .map(([platformKey, value]) => ({
            key: platformKey,
            label: prettyLabel(platformKey),
            sections: ['autofill', 'scraper', 'session'].filter((section) => isPlainObject(value[section]))
        }))
        .filter((platform) => platform.sections.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label));
}

function getSelectorEditorSectionsForPlatform(platformKey) {
    const platformConfig = selectorEditorPlatformSelectors[platformKey];
    if (!isPlainObject(platformConfig)) return [];
    return ['autofill', 'scraper', 'session'].filter((section) => isPlainObject(platformConfig[section]));
}

function getSelectedSelectorSectionNode() {
    const platformConfig = selectorEditorPlatformSelectors[selectorEditorSelectedPlatform];
    if (!isPlainObject(platformConfig)) return null;
    return platformConfig[selectorEditorSelectedSection] || null;
}

function populateSelectorEditorPlatformOptions() {
    const { platformSelect } = getSelectorEditorElements();
    if (!platformSelect) return;
    const platforms = getSelectorEditorPlatforms();

    platformSelect.innerHTML = platforms.length > 0
        ? platforms.map((platform) => `<option value="${escapeHtml(platform.key)}">${escapeHtml(platform.label)}</option>`).join('')
        : '<option value="">No editable platforms</option>';

    if (!platforms.some((platform) => platform.key === selectorEditorSelectedPlatform)) {
        selectorEditorSelectedPlatform = platforms[0]?.key || '';
    }
    platformSelect.value = selectorEditorSelectedPlatform;
}

function populateSelectorEditorSectionOptions() {
    const { sectionSelect } = getSelectorEditorElements();
    if (!sectionSelect) return;
    const sections = getSelectorEditorSectionsForPlatform(selectorEditorSelectedPlatform);

    sectionSelect.innerHTML = sections.length > 0
        ? sections.map((section) => `<option value="${escapeHtml(section)}">${escapeHtml(prettyLabel(section))}</option>`).join('')
        : '<option value="">No editable sections</option>';

    if (!sections.includes(selectorEditorSelectedSection)) {
        selectorEditorSelectedSection = sections[0] || '';
    }
    sectionSelect.value = selectorEditorSelectedSection;
}

function buildSelectorHelpText(platformKey, sectionKey, pathSegments) {
    const pathString = pathSegments.join('.');
    const explicitHelp = SELECTOR_HELP_TEXT?.[platformKey]?.[sectionKey]?.[pathString];
    if (explicitHelp) return explicitHelp;

    const leafLabel = prettyLabel(pathSegments[pathSegments.length - 1] || pathString);
    const groupLabel = prettyLabel(pathSegments[0] || sectionKey);
    if (sectionKey === 'autofill') {
        return `${prettyLabel(platformKey)} autofill: update the paths used to locate "${leafLabel}" inside the ${groupLabel} area of the reporting workflow.`;
    }
    if (sectionKey === 'session') {
        return `${prettyLabel(platformKey)} session: update the paths used to verify accounts or session state for "${leafLabel}".`;
    }
    return `${prettyLabel(platformKey)} scraper: update the paths used to capture "${leafLabel}" from the page during evidence gathering.`;
}

function applySelectorCategoryPaths(pathSegments, nextPaths, valueType) {
    const sectionNode = getSelectedSelectorSectionNode();
    if (!isPlainObject(sectionNode)) return;

    let nextValue;
    if (nextPaths.length === 0) {
        nextValue = valueType === 'string' ? '' : [];
    } else if (valueType === 'string' && nextPaths.length === 1) {
        nextValue = nextPaths[0];
    } else {
        nextValue = nextPaths;
    }

    setNestedValue(sectionNode, pathSegments, nextValue);
}

function renderSelectorEditorCategories() {
    const { categoriesContainer } = getSelectorEditorElements();
    if (!categoriesContainer) return;
    const sectionNode = getSelectedSelectorSectionNode();

    if (!isPlainObject(sectionNode)) {
        categoriesContainer.innerHTML = '<div class="editor-empty-state">No editable categories are available for this platform section.</div>';
        currentSelectorCategoryMap = new Map();
        return;
    }

    const categories = flattenEditableSelectorCategories(sectionNode);
    currentSelectorCategoryMap = new Map(categories.map((category) => [category.pathString, category]));

    if (categories.length === 0) {
        categoriesContainer.innerHTML = '<div class="editor-empty-state">No editable categories are available for this platform section.</div>';
        return;
    }

    const groupedCategories = categories.reduce((accumulator, category) => {
        const groupKey = category.group || 'root';
        if (!accumulator[groupKey]) accumulator[groupKey] = [];
        accumulator[groupKey].push(category);
        return accumulator;
    }, {});

    categoriesContainer.innerHTML = Object.entries(groupedCategories)
        .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
        .map(([groupKey, groupCategories]) => `
            <div class="selector-category-group">
              <div class="selector-group-title">${escapeHtml(groupKey === 'root' ? 'General' : prettyLabel(groupKey))}</div>
              ${groupCategories.map((category) => {
                const helpText = buildSelectorHelpText(selectorEditorSelectedPlatform, selectorEditorSelectedSection, category.pathSegments);
                const pathsMarkup = category.paths.length > 0
                    ? category.paths.map((pathValue, index) => `
                        <div class="selector-path-row">
                          <div class="selector-path-text">${escapeHtml(pathValue)}</div>
                          <button
                            class="icon-button selector-path-delete"
                            type="button"
                            title="Delete this saved path"
                            data-category="${escapeHtml(category.pathString)}"
                            data-index="${index}"
                          >x</button>
                        </div>
                    `).join('')
                    : '<div class="editor-empty-state">No saved paths for this category yet.</div>';

                return `
                  <details class="selector-category">
                    <summary>
                      <div class="selector-category-label">
                        <span class="selector-category-title">${escapeHtml(category.title)}</span>
                        <span class="selector-category-count">${category.paths.length} saved</span>
                      </div>
                      <button
                        class="help-pill selector-help-trigger"
                        type="button"
                        data-help="${escapeHtml(helpText)}"
                        title="What this category controls"
                      >?</button>
                    </summary>
                    <div class="selector-category-body">
                      <div class="selector-help-text">${escapeHtml(helpText)}</div>
                      <div class="selector-path-list">${pathsMarkup}</div>
                      <div class="selector-add-row">
                        <input
                          type="text"
                          placeholder="Add a new selector / XPath / regex path"
                          data-add-input="${escapeHtml(category.pathString)}"
                        >
                        <button
                          class="btn-secondary selector-add-path"
                          type="button"
                          data-category="${escapeHtml(category.pathString)}"
                        >Add New Value Path</button>
                      </div>
                    </div>
                  </details>
                `;
            }).join('')}
            </div>
        `)
        .join('');

    categoriesContainer.querySelectorAll('.selector-help-trigger').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            alert(button.dataset.help || 'No help text available.');
        });
    });

    categoriesContainer.querySelectorAll('.selector-add-path').forEach((button) => {
        button.addEventListener('click', () => {
            const categoryKey = button.dataset.category || '';
            const input = categoriesContainer.querySelector(`[data-add-input="${CSS.escape(categoryKey)}"]`);
            const category = currentSelectorCategoryMap.get(categoryKey);
            if (!input || !category) return;

            const newPath = input.value.trim();
            if (!newPath) {
                setSelectorEditorStatus('Enter a value path before adding it.', '#ce0e2d');
                return;
            }

            const currentPaths = normalizeSelectorPaths(readNestedValue(getSelectedSelectorSectionNode(), category.pathSegments));
            const nextPaths = [newPath, ...currentPaths.filter((pathValue) => pathValue !== newPath)];
            let droppedPath = '';
            if (nextPaths.length > SELECTOR_EDITOR_MAX_PATHS) {
                droppedPath = nextPaths[SELECTOR_EDITOR_MAX_PATHS];
                nextPaths.length = SELECTOR_EDITOR_MAX_PATHS;
            }

            applySelectorCategoryPaths(category.pathSegments, nextPaths, category.valueType);
            renderSelectorEditorCategories();
            setSelectorEditorStatus(
                droppedPath
                    ? `Saved new path for ${category.title}. Oldest path was removed to keep the most recent ${SELECTOR_EDITOR_MAX_PATHS}.`
                    : `Saved new path for ${category.title}. Save to apply it.`,
                droppedPath ? '#b45309' : 'green'
            );
        });
    });

    categoriesContainer.querySelectorAll('[data-add-input]').forEach((input) => {
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            const categoryKey = input.getAttribute('data-add-input') || '';
            categoriesContainer.querySelector(`.selector-add-path[data-category="${CSS.escape(categoryKey)}"]`)?.click();
        });
    });

    categoriesContainer.querySelectorAll('.selector-path-delete').forEach((button) => {
        button.addEventListener('click', () => {
            const categoryKey = button.dataset.category || '';
            const category = currentSelectorCategoryMap.get(categoryKey);
            const index = Number(button.dataset.index);
            if (!category || Number.isNaN(index)) return;

            const currentPaths = normalizeSelectorPaths(readNestedValue(getSelectedSelectorSectionNode(), category.pathSegments));
            const targetPath = currentPaths[index];
            if (!targetPath) return;

            const word = SELECTOR_EDITOR_DELETE_WORDS[Math.floor(Math.random() * SELECTOR_EDITOR_DELETE_WORDS.length)];
            pendingSelectorDelete = {
                categoryKey,
                pathIndex: index,
                word,
                targetPath
            };

            const { modal, copy, input, status: confirmStatus } = getDeleteConfirmElements();
            copy.innerText = `Type "${word}" to delete this saved path from ${category.title}.`;
            input.value = '';
            confirmStatus.innerText = '';
            modal.style.display = 'flex';
            input.focus();
        });
    });
}

async function loadSelectorPathEditor() {
    const { modal, saveBtn, platformSelect, sectionSelect, categoriesContainer } = getSelectorEditorElements();
    let loaded = false;
    if (modal) modal.style.display = 'flex';
    if (platformSelect) platformSelect.innerHTML = '<option value="">Loading platforms...</option>';
    if (sectionSelect) sectionSelect.innerHTML = '<option value="">Loading sections...</option>';
    if (categoriesContainer) categoriesContainer.innerHTML = '<div class="editor-empty-state">Loading selector paths...</div>';

    try {
        setSelectorEditorStatus('Loading shared selector paths...', '#2563eb');
        if (saveBtn) saveBtn.disabled = true;
        const config = await fetchConfig();
        selectorEditorPlatformSelectors = normalizePlatformSelectors(config.platform_selectors);

        populateSelectorEditorPlatformOptions();
        populateSelectorEditorSectionOptions();
        renderSelectorEditorCategories();
        loaded = true;
        setSelectorEditorStatus('');
    } catch (error) {
        console.error('Failed to load selector editor:', error);
        setSelectorEditorStatus(error.message || 'Unable to load selector path editor.', '#ce0e2d');
        setStatusMessage('Unable to load selector path editor.', '#ce0e2d', 'looking');
        clearStatusMessage(4500);
    } finally {
        if (saveBtn) saveBtn.disabled = !loaded;
    }
}

async function saveSelectorPathEdits() {
    const { modal, saveBtn } = getSelectorEditorElements();
    try {
        if (saveBtn) saveBtn.disabled = true;
        setSelectorEditorStatus('Saving selector paths to shared events_config.json...', '#2563eb');
        await updateConfigSections({
            platform_selectors: selectorEditorPlatformSelectors
        });

        if (modal) modal.style.display = 'none';
        setStatusMessage('Selector paths saved to shared events_config.json.', 'green', 'smirk');
        clearStatusMessage();
    } catch (error) {
        console.error('Failed to save selector paths:', error);
        setSelectorEditorStatus(error.message || 'Failed to save selector paths.', '#ce0e2d');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function closeSelectorDeleteConfirmModal() {
    pendingSelectorDelete = null;
    const { modal, input } = getDeleteConfirmElements();
    if (modal) modal.style.display = 'none';
    if (input) input.value = '';
    setDeleteConfirmStatus('');
}

function confirmSelectorDelete() {
    if (!pendingSelectorDelete) return;

    const { input } = getDeleteConfirmElements();
    if (input.value.trim().toLowerCase() !== pendingSelectorDelete.word.toLowerCase()) {
        setDeleteConfirmStatus(`Type "${pendingSelectorDelete.word}" exactly to confirm this delete.`, '#ce0e2d');
        return;
    }

    const category = currentSelectorCategoryMap.get(pendingSelectorDelete.categoryKey);
    if (!category) {
        closeSelectorDeleteConfirmModal();
        return;
    }

    const currentPaths = normalizeSelectorPaths(readNestedValue(getSelectedSelectorSectionNode(), category.pathSegments));
    const nextPaths = currentPaths.filter((_, index) => index !== pendingSelectorDelete.pathIndex);
    applySelectorCategoryPaths(category.pathSegments, nextPaths, category.valueType);

    closeSelectorDeleteConfirmModal();
    renderSelectorEditorCategories();
    setSelectorEditorStatus(`Deleted one saved path from ${category.title}. Save to apply it.`, '#b45309');
}

function getCurrentSettingsSnapshot() {
    return {
        piracy_folder_id: getEl('piracy_folder_id')?.value.trim() || '',
        piracy_sheet_id: getEl('piracy_sheet_id')?.value.trim() || '',
        event_sheet_id: getEl('event_sheet_id')?.value.trim() || '',
        beta_opt_in: !!getEl('beta_opt_in')?.checked,
        report_mode: getEl('report_mode')?.value || 'scout'
    };
}

function snapshotsMatch(a, b) {
    if (!a || !b) return true;
    return Object.keys(a).every((key) => a[key] === b[key]);
}

function updateSaveHint() {
    if (!saveHint) return;
    const currentSnapshot = getCurrentSettingsSnapshot();
    const hasUnsavedChanges = !snapshotsMatch(savedSettingsSnapshot, currentSnapshot);
    saveHint.textContent = hasUnsavedChanges
        ? 'Unsaved changes are waiting. Save to sync them across the extension.'
        : 'Changes are stored in Chrome sync for this extension.';
    saveHint.style.color = hasUnsavedChanges ? '#b45309' : '#6b7280';
}

function updateSetupStatus() {
    const checks = [
        { id: 'setup-folder-check', value: getEl('piracy_folder_id')?.value.trim() },
        { id: 'setup-sheet-check', value: getEl('piracy_sheet_id')?.value.trim() },
        { id: 'setup-event-check', value: getEl('event_sheet_id')?.value.trim() }
    ];

    const readyCount = checks.filter((item) => item.value).length;

    checks.forEach((item) => {
        const row = getEl(item.id);
        const state = row?.querySelector('.check-state');
        const isReady = !!item.value;
        row?.classList.toggle('ready', isReady);
        if (state) state.textContent = isReady ? 'Ready' : 'Missing';
    });

    const allReady = readyCount === checks.length;
    setupStatusPill?.classList.toggle('ready', allReady);
    if (setupStatusPill) setupStatusPill.textContent = allReady ? 'Ready' : `${checks.length - readyCount} Missing`;
    if (setupStatusCopy) {
        setupStatusCopy.textContent = allReady
            ? 'All required IDs are present. Reporting and intelligence features are ready.'
            : 'Complete the required IDs to unlock reporting and team intelligence features.';
    }
}

function syncReportMode(value) {
    const normalizedValue = value === 'all' ? 'all' : 'scout';
    const select = getEl('report_mode');
    if (select) select.value = normalizedValue;
    document.querySelectorAll('[data-report-mode-choice]').forEach((radio) => {
        radio.checked = radio.value === normalizedValue;
    });
    updateSaveHint();
}

function getBriefingCheckboxes() {
    return Array.from(document.querySelectorAll('#briefing-toggles input[type="checkbox"]'));
}

function getBriefingConfigFromUi() {
    return getBriefingCheckboxes().reduce((config, checkbox) => {
        const key = checkbox.id.replace('stat_', '');
        config[key] = checkbox.checked;
        return config;
    }, {});
}

function applyBriefingConfig(config) {
    const mergedConfig = { ...DEFAULT_BRIEFING_STATS, ...(config || {}) };
    getBriefingCheckboxes().forEach((checkbox) => {
        const key = checkbox.id.replace('stat_', '');
        checkbox.checked = mergedConfig[key] !== false;
    });
    updateBriefingCount();
}

function updateBriefingCount() {
    const checkboxes = getBriefingCheckboxes();
    const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
    if (briefingCount) {
        briefingCount.textContent = `${selectedCount} of ${checkboxes.length} modules selected`;
    }
}

function setBriefingGroups(open) {
    document.querySelectorAll('.briefing-group').forEach((group) => {
        group.open = open;
    });
    const toggleBtn = getEl('toggle_briefing_groups');
    if (toggleBtn) toggleBtn.textContent = open ? 'Collapse Groups' : 'Expand Groups';
}

function refreshBriefingGroupButton() {
    const groups = Array.from(document.querySelectorAll('.briefing-group'));
    const allOpen = groups.length > 0 && groups.every((group) => group.open);
    const toggleBtn = getEl('toggle_briefing_groups');
    if (toggleBtn) toggleBtn.textContent = allOpen ? 'Collapse Groups' : 'Expand Groups';
}

function openBriefingModal() {
    applyBriefingConfig(savedBriefingConfig);
    if (!briefingModal) return;
    briefingModal.style.display = 'flex';
    refreshBriefingGroupButton();
    getEl('briefing_select_all')?.focus();
}

function closeBriefingModal({ restoreSaved = true } = {}) {
    if (restoreSaved) applyBriefingConfig(savedBriefingConfig);
    if (briefingModal) briefingModal.style.display = 'none';
}

function updateSuggestionCounter() {
    const text = getEl('suggestion_text')?.value || '';
    if (suggestionCounter) suggestionCounter.textContent = `${text.length} / 1000`;
}

function attachInputStateListeners() {
    fieldIds.forEach((id) => {
        const field = getEl(id);
        field?.addEventListener('input', () => {
            updateSetupStatus();
            updateSaveHint();
        });
    });

    getEl('beta_opt_in')?.addEventListener('change', updateSaveHint);
    getEl('report_mode')?.addEventListener('change', (event) => syncReportMode(event.target.value));

    document.querySelectorAll('[data-report-mode-choice]').forEach((radio) => {
        radio.addEventListener('change', (event) => {
            if (event.target.checked) syncReportMode(event.target.value);
        });
    });

    getEl('suggestion_text')?.addEventListener('input', updateSuggestionCounter);
    getBriefingCheckboxes().forEach((checkbox) => {
        checkbox.addEventListener('change', updateBriefingCount);
    });
    document.querySelectorAll('.briefing-group').forEach((group) => {
        group.addEventListener('toggle', refreshBriefingGroupButton);
    });
}

function attachBriefingListeners() {
    getEl('open_briefing_settings')?.addEventListener('click', openBriefingModal);
    getEl('cancel_briefing_stats')?.addEventListener('click', () => closeBriefingModal());
    getEl('close_briefing_stats')?.addEventListener('click', () => closeBriefingModal());

    briefingModal?.addEventListener('click', (event) => {
        if (event.target === briefingModal) closeBriefingModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && briefingModal?.style.display === 'flex') {
            closeBriefingModal();
        }
    });

    getEl('briefing_select_all')?.addEventListener('click', () => {
        getBriefingCheckboxes().forEach((checkbox) => {
            checkbox.checked = true;
        });
        updateBriefingCount();
    });

    getEl('briefing_reset_defaults')?.addEventListener('click', () => {
        applyBriefingConfig(DEFAULT_BRIEFING_STATS);
    });

    getEl('toggle_briefing_groups')?.addEventListener('click', () => {
        const groups = Array.from(document.querySelectorAll('.briefing-group'));
        const shouldOpen = groups.some((group) => !group.open);
        setBriefingGroups(shouldOpen);
    });

    getEl('save_briefing_stats')?.addEventListener('click', () => {
        const newConfig = getBriefingConfigFromUi();

        chrome.storage.sync.set({ briefing_config: newConfig }, () => {
            savedBriefingConfig = { ...DEFAULT_BRIEFING_STATS, ...newConfig };
            closeBriefingModal({ restoreSaved: false });
            setClippyState('smirk');
            status.style.color = 'green';
            status.innerText = 'Briefing Preferences Saved!';
            setTimeout(() => {
                status.innerText = '';
                setClippyState('default');
            }, 3000);
        });
    });
}

function closeConfigModal(modalId) {
    const modal = getEl(modalId);
    if (modal) modal.style.display = 'none';
}

function attachSharedConfigEditorListeners() {
    getEl('open_briefing_content_editor')?.addEventListener('click', () => {
        void loadBriefingContentEditor();
    });
    getEl('cancel_briefing_content')?.addEventListener('click', () => {
        closeConfigModal('briefing-content-modal');
        setBriefingContentStatus('');
    });
    getEl('close_briefing_content')?.addEventListener('click', () => {
        closeConfigModal('briefing-content-modal');
        setBriefingContentStatus('');
    });
    getEl('briefing-content-modal')?.addEventListener('click', (event) => {
        if (event.target === getEl('briefing-content-modal')) {
            closeConfigModal('briefing-content-modal');
            setBriefingContentStatus('');
        }
    });
    getEl('clear_highlight_content')?.addEventListener('click', () => {
        const { userInput, descInput, bonusInput } = getBriefingContentModalElements();
        if (userInput) userInput.value = '';
        if (descInput) descInput.value = '';
        if (bonusInput) bonusInput.value = '';
        setBriefingContentStatus('Community highlight cleared. Save to apply it.', '#b45309');
    });
    getEl('clear_lab_instructions')?.addEventListener('click', () => {
        const { labInput } = getBriefingContentModalElements();
        if (labInput) labInput.value = '';
        setBriefingContentStatus('Lab instructions cleared. Save to apply it.', '#b45309');
    });
    getEl('add_double_xp_event')?.addEventListener('click', addDoubleXpEventFromInputs);
    getEl('double_xp_event_name')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        addDoubleXpEventFromInputs();
    });
    getEl('save_briefing_content')?.addEventListener('click', () => {
        void saveBriefingContentEdits();
    });

    const { modal, platformSelect, sectionSelect } = getSelectorEditorElements();
    getEl('open_selector_path_editor')?.addEventListener('click', () => {
        void loadSelectorPathEditor();
    });
    getEl('cancel_selector_editor')?.addEventListener('click', () => {
        closeConfigModal('selector-path-editor-modal');
        setSelectorEditorStatus('');
    });
    getEl('close_selector_editor')?.addEventListener('click', () => {
        closeConfigModal('selector-path-editor-modal');
        setSelectorEditorStatus('');
    });
    modal?.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeConfigModal('selector-path-editor-modal');
            setSelectorEditorStatus('');
        }
    });
    platformSelect?.addEventListener('change', () => {
        selectorEditorSelectedPlatform = platformSelect.value;
        populateSelectorEditorSectionOptions();
        renderSelectorEditorCategories();
        setSelectorEditorStatus('');
    });
    sectionSelect?.addEventListener('change', () => {
        selectorEditorSelectedSection = sectionSelect.value;
        renderSelectorEditorCategories();
        setSelectorEditorStatus('');
    });
    getEl('save_selector_editor')?.addEventListener('click', () => {
        void saveSelectorPathEdits();
    });

    const { modal: deleteModal, input: deleteInput } = getDeleteConfirmElements();
    getEl('cancel_selector_delete')?.addEventListener('click', closeSelectorDeleteConfirmModal);
    getEl('close_selector_delete')?.addEventListener('click', closeSelectorDeleteConfirmModal);
    getEl('confirm_selector_delete')?.addEventListener('click', confirmSelectorDelete);
    deleteInput?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        confirmSelectorDelete();
    });
    deleteModal?.addEventListener('click', (event) => {
        if (event.target === deleteModal) closeSelectorDeleteConfirmModal();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (deleteModal?.style.display === 'flex') {
            closeSelectorDeleteConfirmModal();
            return;
        }
        if (getEl('selector-path-editor-modal')?.style.display === 'flex') {
            closeConfigModal('selector-path-editor-modal');
            return;
        }
        if (getEl('briefing-content-modal')?.style.display === 'flex') {
            closeConfigModal('briefing-content-modal');
        }
    });
}

function attachCoreActionListeners() {
    getEl('open_evidence_locker')?.addEventListener('click', () => {
        const folderId = getEl('piracy_folder_id')?.value.trim();
        if (folderId) {
            window.open(`https://drive.google.com/drive/folders/${folderId}`, '_blank');
        } else {
            setClippyState('looking');
            status.style.color = '#ce0e2d';
            status.innerText = 'Please enter a Folder ID first to open the locker.';
            setTimeout(() => {
                status.innerText = '';
                setClippyState('default');
            }, 3000);
        }
    });

    let clickCount = 0;
    const headerTitle = document.querySelector('header h1');
    const easterEggOverlay = getEl('easter-egg');

    headerTitle?.addEventListener('click', () => {
        clickCount++;
        if (clickCount >= 5) {
            clickCount = 0;
            if (easterEggOverlay) easterEggOverlay.style.display = 'flex';
            new Audio(chrome.runtime.getURL('Piratemusic.mp3')).play().catch((err) => console.warn('Audio play blocked:', err));
        }
    });

    easterEggOverlay?.addEventListener('click', () => {
        easterEggOverlay.style.display = 'none';
    });
}

function attachFeedbackListener() {
    getEl('send_suggestion')?.addEventListener('click', async () => {
        const text = getEl('suggestion_text')?.value.trim();
        const sugStatus = getEl('suggestion_status');

        if (!text) {
            setClippyState('looking');
            sugStatus.style.color = '#ce0e2d';
            sugStatus.innerText = 'Field is empty!';
            return;
        }

        setClippyState('talking');
        sugStatus.style.color = '#2563eb';
        sugStatus.innerText = 'Transmitting...';

        chrome.runtime.sendMessage({ action: 'submitSuggestion', text }, (response) => {
            if (response && response.success) {
                setClippyState('smirk');
                sugStatus.style.color = 'green';
                sugStatus.innerText = 'Comms received. Thanks!';
                getEl('suggestion_text').value = '';
                updateSuggestionCounter();
            } else {
                setClippyState('default');
                sugStatus.style.color = '#ce0e2d';
                sugStatus.innerText = 'Uplink failed.';
            }
        });
    });
}

function attachSaveListener() {
    getEl('save')?.addEventListener('click', () => {
        const folderId = getEl('piracy_folder_id').value.trim();
        const sheetId = getEl('piracy_sheet_id').value.trim();
        const eventSheetId = getEl('event_sheet_id').value.trim();
        const betaOptIn = getEl('beta_opt_in').checked;
        const reportMode = getEl('report_mode').value;

        if (!folderId || !sheetId || !eventSheetId) {
            setClippyState('talking');
            status.style.color = '#ce0e2d';
            status.innerText = 'Missing IDs! Check Clippy for details.';

            if (window.showClippyMessage) {
                window.showClippyMessage('Missing IDs! Please check the <a href="https://flocasts.atlassian.net/wiki/spaces/FSM/pages/5634621448/FloSports+Pirate+Reporter+3.3.1+Pirate+AI#Options-Set-up" target="_blank" style="color: #2563eb; text-decoration: underline;">Setup Guide</a> to fill out all boxes.');
            }
            return;
        }

        chrome.storage.sync.set({
            piracy_folder_id: folderId,
            piracy_sheet_id: sheetId,
            event_sheet_id: eventSheetId,
            beta_opt_in: betaOptIn,
            report_mode: reportMode
        }, () => {
            savedSettingsSnapshot = getCurrentSettingsSnapshot();
            updateSaveHint();
            updateSetupStatus();
            setClippyState('smirk');
            status.style.color = 'green';
            status.innerText = 'Configurations Locked. Ready for Hunt.';

            chrome.storage.local.get(['onboarding_step'], (res) => {
                if (res.onboarding_step === 'NEEDS_CONFIG') {
                    chrome.storage.local.set({ onboarding_step: 'READY_FOR_FIRST_REPORT' });
                }
            });

            setTimeout(() => {
                status.innerText = '';
                setClippyState('default');
            }, 3000);
        });
    });
}

async function initializeOptionsPage() {
    if (globalThis.__floOptionsPageInitialized) return;
    globalThis.__floOptionsPageInitialized = true;

    attachInputStateListeners();
    attachBriefingListeners();
    attachSharedConfigEditorListeners();
    attachCoreActionListeners();
    attachFeedbackListener();
    attachSaveListener();
    updateSuggestionCounter();

    chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id', 'beta_opt_in', 'report_mode', 'briefing_config'], (items) => {
        if (items.piracy_folder_id) getEl('piracy_folder_id').value = items.piracy_folder_id;
        if (items.piracy_sheet_id) getEl('piracy_sheet_id').value = items.piracy_sheet_id;
        if (items.event_sheet_id) getEl('event_sheet_id').value = items.event_sheet_id;
        getEl('beta_opt_in').checked = !!items.beta_opt_in;

        syncReportMode(items.report_mode || 'scout');
        savedBriefingConfig = { ...DEFAULT_BRIEFING_STATS, ...(items.briefing_config || {}) };
        applyBriefingConfig(savedBriefingConfig);

        savedSettingsSnapshot = getCurrentSettingsSnapshot();
        updateSetupStatus();
        updateSaveHint();
    });

    try {
        setClippyState('looking');
        const config = await fetchConfig();
        renderCommunityPreview(config?.community_highlights);
        setClippyState('default');
    } catch (err) {
        console.error('Failed to load community highlights:', err);
        getEl('highlight-user').innerText = 'Team Sync Required';
        getEl('highlight-desc').innerText = 'Verify your Folder ID to see team updates.';
        setClippyState('default');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        void initializeOptionsPage();
    }, { once: true });
} else {
    void initializeOptionsPage();
}
=======
function bindBriefingContentModalEvents() {
  const briefingContentModal = document.getElementById('briefing-content-modal');
  document.getElementById('open_briefing_content_editor')?.addEventListener('click', () => {
    void loadBriefingContentEditor();
  });
  document.getElementById('cancel_briefing_content')?.addEventListener('click', () => {
    briefingContentModal.style.display = 'none';
    setBriefingContentStatus('');
  });
  document.getElementById('clear_highlight_content')?.addEventListener('click', () => {
    const { userInput, descInput, bonusInput } = getBriefingContentModalElements();
    userInput.value = '';
    descInput.value = '';
    bonusInput.value = '';
    setBriefingContentStatus('Community highlight cleared. Save to apply it.', '#b45309');
  });
  document.getElementById('clear_lab_instructions')?.addEventListener('click', () => {
    const { labInput } = getBriefingContentModalElements();
    labInput.value = '';
    setBriefingContentStatus('Lab instructions cleared. Save to apply it.', '#b45309');
  });
  document.getElementById('add_double_xp_event')?.addEventListener('click', addDoubleXpEventFromInputs);
  document.getElementById('double_xp_event_name')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addDoubleXpEventFromInputs();
  });
  document.getElementById('save_briefing_content')?.addEventListener('click', () => {
    void saveBriefingContentEdits();
  });
}

function bindSelectorEditorEvents() {
  const { modal, platformSelect, sectionSelect } = getSelectorEditorElements();
  document.getElementById('open_selector_path_editor')?.addEventListener('click', () => {
    void loadSelectorPathEditor();
  });
  document.getElementById('cancel_selector_editor')?.addEventListener('click', () => {
    modal.style.display = 'none';
    setSelectorEditorStatus('');
  });
  platformSelect.addEventListener('change', () => {
    selectorEditorSelectedPlatform = platformSelect.value;
    populateSelectorEditorSectionOptions();
    renderSelectorEditorCategories();
    setSelectorEditorStatus('');
  });
  sectionSelect.addEventListener('change', () => {
    selectorEditorSelectedSection = sectionSelect.value;
    renderSelectorEditorCategories();
    setSelectorEditorStatus('');
  });
  document.getElementById('save_selector_editor')?.addEventListener('click', () => {
    void saveSelectorPathEdits();
  });

  const { modal: deleteModal, input: deleteInput } = getDeleteConfirmElements();
  document.getElementById('cancel_selector_delete')?.addEventListener('click', closeSelectorDeleteConfirmModal);
  document.getElementById('confirm_selector_delete')?.addEventListener('click', confirmSelectorDelete);
  deleteInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    confirmSelectorDelete();
  });
  deleteModal.addEventListener('click', (event) => {
    if (event.target === deleteModal) {
      closeSelectorDeleteConfirmModal();
    }
  });
}

async function loadInitialOptionsState({ loadIntelligenceConfig = false } = {}) {
  const items = await chrome.storage.sync.get([
    'piracy_folder_id',
    'piracy_sheet_id',
    'event_sheet_id',
    'beta_opt_in',
    'report_mode',
    'briefing_config'
  ]);
  renderConnectivityFields(currentAccessProfile, items);
  document.getElementById('beta_opt_in').checked = !!items.beta_opt_in;
  document.getElementById('report_mode').value = items.report_mode || 'scout';

  const briefingConfig = items.briefing_config || BRIEFING_DEFAULTS;
  document.querySelectorAll('#briefing-toggles input[type="checkbox"]').forEach((el) => {
    const key = el.id.replace('stat_', '');
    el.checked = briefingConfig[key] !== false;
  });
  window.dispatchEvent(new CustomEvent('floAccessConfigReady'));

  if (loadIntelligenceConfig) {
    try {
      setClippyState('looking');
      const config = await fetchConfig();
      renderCommunityPreview(config.community_highlights);
      setClippyState('default');
    } catch (error) {
      console.error('Failed to load community highlights:', error);
      document.getElementById('highlight-user').innerText = 'Team Sync Required';
      document.getElementById('highlight-desc').innerText = 'Verify your Folder ID to see team updates.';
      setClippyState('default');
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  bindExtensionAuthEvents();
  hideProtectedSettings();

  try {
    const accessResponse = await Promise.race([
      chrome.runtime.sendMessage({ action: 'getAccessProfile', forceRefresh: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Access check timed out.')), 12000))
    ]);
    if (!accessResponse?.success || !accessResponse.profile) {
      throw new Error(accessResponse?.error || 'The access registry did not return a profile.');
    }

    currentAccessProfile = accessResponse.profile;
    renderExtensionAuthState(currentAccessProfile);
    if (currentAccessProfile.status === 'logged_out') {
      document.getElementById('settings-access-state').hidden = true;
      return;
    }

    if (currentAccessProfile.status === 'identity_error') {
      showSettingsAccessState({
        title: 'Google account mismatch',
        message: 'Log out of the extension, switch to the Google account associated with this user, and log in again.',
        state: 'error',
        showRetry: true
      });
      return;
    }

    if (currentAccessProfile.status !== 'ready') {
      document.getElementById('settings-access-state').hidden = true;
      return;
    }

    applySettingsAccess(currentAccessProfile);
    bindCoreOptionsEvents();

    const canUseIntelligenceTools = hasPermission(currentAccessProfile, PERMISSIONS.SETTINGS_INTELLIGENCE_TOOLS);
    if (hasPermission(currentAccessProfile, PERMISSIONS.SETTINGS_BRIEFING_STATS)) {
      bindBriefingStatsModalEvents();
    }
    if (hasPermission(currentAccessProfile, PERMISSIONS.SETTINGS_BRIEFING_CONTENT)) {
      bindBriefingContentModalEvents();
    }
    if (hasPermission(currentAccessProfile, PERMISSIONS.SETTINGS_SELECTOR_PATHS)) {
      bindSelectorEditorEvents();
    }
    if (hasPermission(currentAccessProfile, PERMISSIONS.SETTINGS_ADMIN_ACCESS)) {
      bindAccessManagerEvents();
    }

    await loadInitialOptionsState({ loadIntelligenceConfig: canUseIntelligenceTools });
  } catch (error) {
    console.error('Settings access initialization failed:', error);
    renderExtensionAuthState(currentAccessProfile || {
      status: 'registry_error',
      role: 'waiting_approval',
      name: 'Extension session',
      email: '',
      platforms: []
    });
    showSettingsAccessState({
      title: 'Access could not be verified',
      message: error.message || 'Check your Google sign-in and access to the user registry.',
      state: 'error',
      showRetry: true
    });
  }
});
>>>>>>> Stashed changes
