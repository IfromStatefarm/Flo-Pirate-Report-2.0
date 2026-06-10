import { fetchConfig, updateConfigSections } from '../utils/google_api.js';
import { getClippyAssetForState } from '../utils/clippy_assets.js';

const clippy = document.getElementById('clippy-img');
const status = document.getElementById('status');

const DEFAULT_LAB_INSTRUCTIONS = "Test new features and earn badges!";
const DEFAULT_HIGHLIGHT = Object.freeze({
  user: '',
  achievement: '',
  bonus_awarded: ''
});

const BRIEFING_DEFAULTS = Object.freeze({
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
});

const SELECTOR_EDITOR_MAX_PATHS = 7;
const SELECTOR_EDITOR_DELETE_FRUITS = Object.freeze([
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
  'label',
  'value',
  'option_value',
  'action'
]);

const SELECTOR_HELP_TEXT = Object.freeze({
  instagram: {
    scraper: {
      handle: 'Instagram scraper: finds the visible account handle on posts, reels, or stories.',
      profile_links: 'Instagram scraper: fallback profile links used to derive the creator username from the page URL structure.',
      meta_description: 'Instagram scraper: meta tags used as a backup source for views or page text when DOM selectors shift.',
      json_scripts: 'Instagram scraper: JSON script blocks searched for creator and reel view data.',
      'json_patterns.handle': 'Instagram scraper: regex patterns used to pull the reel/post owner username out of embedded page JSON.',
      'json_patterns.view_count': 'Instagram scraper: regex patterns used to pull the reel view count out of embedded page JSON.'
    },
    autofill: {
      'fields.relationship_radio': 'Instagram report form Step 1: chooses the relationship-to-rights-owner answer.',
      'fields.full_name': 'Instagram report form Step 1: fills "Your full name".',
      'fields.email': 'Instagram report form Step 1: fills the contact email.',
      'fields.confirm_email': 'Instagram report form Step 1: fills "Confirm your email address".',
      'fields.rights_owner_name': 'Instagram report form Step 1: fills the rights owner / authorized representative field.',
      'fields.country_select': 'Instagram report form Step 1: selects where rights are being asserted.',
      'fields.work_type_select': 'Instagram report form Step 1: selects the copyrighted work type.',
      'fields.source_url': 'Instagram report form Step 2: fills the original FloSports source URL.',
      'fields.copyrighted_work_description': 'Instagram report form Step 2: fills the event or copyrighted work description.',
      'fields.content_type_post': 'Instagram report form Step 2: checks the "Photo, video or post" content type.',
      'fields.content_type_story': 'Instagram report form Step 2: checks the "Story" content type.',
      'fields.content_urls': 'Instagram report form Step 3: fills the reported pirate URL boxes, including extra Link 11-30 fields.',
      'fields.additional_links_checkbox': 'Instagram report form Step 3: expands the extra link boxes after Link 10.',
      'fields.infringement_explanation': 'Instagram report form Step 3: fills the infringement explanation text area.',
      'fields.signature': 'Instagram report form Step 3: fills the electronic signature.'
    }
  },
  rumble: {
    scraper: {
      handle: 'Rumble scraper: finds the creator or channel name on the video page.',
      candidate_channel_links: 'Rumble scraper: fallback channel links used to derive the creator handle.',
      views: 'Rumble scraper: paths searched for the visible view count.',
      live_viewer_count: 'Rumble scraper: paths searched for the "users watching now" live viewer count.',
      live_indicators: 'Rumble scraper: signals used to decide whether the video is live.'
    },
    autofill: {
      menu_button: 'Rumble report flow: opens the three-dot action menu on the current video page.',
      direct_report_button: 'Rumble report flow: opens the report modal when Rumble exposes the report action directly instead of behind the three-dot menu.',
      report_button: 'Rumble report flow: clicks the "Report" action inside the menu.',
      copyright_reason: 'Rumble report flow: selects the "It violates copyright" radio option in the popup.',
      submit_button: 'Rumble report flow: submits the copyright report popup.',
      success_text: 'Rumble report flow: success copy checked after submission.',
      success_indicators: 'Rumble report flow: success modal/container selectors checked after submission.'
    }
  }
});

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

<<<<<<< Updated upstream
document.addEventListener('DOMContentLoaded', async () => {
  // 1. Load basic saved settings
  chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id', 'beta_opt_in', 'report_mode'], (items) => {
=======
function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? {}));
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCommunityHighlights(config) {
  const highlight = config?.highlight_of_the_week || {};
  return {
    highlight_of_the_week: {
      user: String(highlight.user || '').trim(),
      achievement: String(highlight.achievement || '').trim(),
      bonus_awarded: String(highlight.bonus_awarded || '').trim()
    },
    lab_instructions: String(config?.lab_instructions || '').trim()
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

function renderCommunityPreview(config) {
  const highlights = normalizeCommunityHighlights(config);
  const weekly = highlights.highlight_of_the_week;

  document.getElementById('lab-instructions').innerText =
    highlights.lab_instructions || DEFAULT_LAB_INSTRUCTIONS;
  document.getElementById('highlight-user').innerText = weekly.user || 'TBD';

  const desc = weekly.achievement || 'Team highlight coming soon.';
  const bonus = weekly.bonus_awarded || '';
  document.getElementById('highlight-desc').innerHTML = bonus
    ? `${desc} <span style="color:#10b981; font-weight:bold;">[${bonus}]</span>`
    : desc;
}

function setStatusMessage(message, color = '#374151', clippyState = 'default') {
  setClippyState(clippyState);
  status.style.color = color;
  status.innerText = message;
}

function clearStatusMessage(delayMs = 3000) {
  setTimeout(() => {
    status.innerText = '';
    setClippyState('default');
  }, delayMs);
}

function getBriefingContentModalElements() {
  return {
    modal: document.getElementById('briefing-content-modal'),
    modalStatus: document.getElementById('briefing-content-status'),
    userInput: document.getElementById('briefing_highlight_user'),
    descInput: document.getElementById('briefing_highlight_desc'),
    bonusInput: document.getElementById('briefing_highlight_bonus'),
    labInput: document.getElementById('briefing_lab_instructions_input'),
    verticalSelect: document.getElementById('double_xp_vertical'),
    eventNameInput: document.getElementById('double_xp_event_name'),
    listContainer: document.getElementById('double_xp_event_list'),
    saveBtn: document.getElementById('save_briefing_content')
  };
}

function getSelectorEditorElements() {
  return {
    modal: document.getElementById('selector-path-editor-modal'),
    platformSelect: document.getElementById('selector_editor_platform'),
    sectionSelect: document.getElementById('selector_editor_section'),
    categoriesContainer: document.getElementById('selector-editor-categories'),
    status: document.getElementById('selector-editor-status'),
    saveBtn: document.getElementById('save_selector_editor')
  };
}

function getDeleteConfirmElements() {
  return {
    modal: document.getElementById('selector-delete-confirm-modal'),
    copy: document.getElementById('selector-delete-confirm-copy'),
    input: document.getElementById('selector_delete_confirm_input'),
    status: document.getElementById('selector-delete-confirm-status')
  };
}

function setBriefingContentStatus(message, color = '#374151') {
  const { modalStatus } = getBriefingContentModalElements();
  modalStatus.style.color = color;
  modalStatus.innerText = message;
}

function setSelectorEditorStatus(message, color = '#374151') {
  const { status: statusEl } = getSelectorEditorElements();
  statusEl.style.color = color;
  statusEl.innerText = message;
}

function setDeleteConfirmStatus(message, color = '#374151') {
  const { status: statusEl } = getDeleteConfirmElements();
  statusEl.style.color = color;
  statusEl.innerText = message;
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
    .filter((platform) => platform.hasAutofill || platform.hasScraper)
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
    });

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

function openEvidenceLocker() {
  const folderId = document.getElementById('piracy_folder_id').value.trim();
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
    const folderId = document.getElementById('piracy_folder_id').value.trim();
    const sheetId = document.getElementById('piracy_sheet_id').value.trim();
    const eventSheetId = document.getElementById('event_sheet_id').value.trim();
    const betaOptIn = document.getElementById('beta_opt_in').checked;
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

    chrome.storage.sync.set({
      piracy_folder_id: folderId,
      piracy_sheet_id: sheetId,
      event_sheet_id: eventSheetId,
      beta_opt_in: betaOptIn,
      report_mode: reportMode
    }, () => {
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

function bindBriefingStatsModalEvents() {
  const briefingModal = document.getElementById('briefing-modal');
  document.getElementById('open_briefing_settings')?.addEventListener('click', () => {
    briefingModal.style.display = 'flex';
  });
  document.getElementById('cancel_briefing_stats')?.addEventListener('click', () => {
    briefingModal.style.display = 'none';
  });
  document.getElementById('save_briefing_stats')?.addEventListener('click', () => {
    const newConfig = {};
    document.querySelectorAll('#briefing-toggles input[type="checkbox"]').forEach((el) => {
      const key = el.id.replace('stat_', '');
      newConfig[key] = el.checked;
    });

    chrome.storage.sync.set({ briefing_config: newConfig }, () => {
      briefingModal.style.display = 'none';
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

async function loadInitialOptionsState() {
  chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id', 'beta_opt_in', 'report_mode', 'briefing_config'], (items) => {
>>>>>>> Stashed changes
    if (items.piracy_folder_id) document.getElementById('piracy_folder_id').value = items.piracy_folder_id;
    if (items.piracy_sheet_id) document.getElementById('piracy_sheet_id').value = items.piracy_sheet_id;
    if (items.event_sheet_id) document.getElementById('event_sheet_id').value = items.event_sheet_id;
    document.getElementById('beta_opt_in').checked = !!items.beta_opt_in;
    document.getElementById('report_mode').value = items.report_mode || 'scout';
<<<<<<< Updated upstream
=======

    const briefingConfig = items.briefing_config || BRIEFING_DEFAULTS;
    document.querySelectorAll('#briefing-toggles input[type="checkbox"]').forEach((el) => {
      const key = el.id.replace('stat_', '');
      el.checked = briefingConfig[key] !== false;
    });
>>>>>>> Stashed changes
  });

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

<<<<<<< Updated upstream
  // Evidence Locker Button Logic
  document.getElementById('open_evidence_locker').addEventListener('click', () => {
    const folderId = document.getElementById('piracy_folder_id').value.trim();
    if (folderId) {
      window.open(`https://drive.google.com/drive/folders/${folderId}`, '_blank');
    } else {
      setClippyState('looking');
      const statusEl = document.getElementById('status');
      statusEl.style.color = '#ce0e2d';
      statusEl.innerText = 'Please enter a Folder ID first to open the locker.';
      setTimeout(() => { statusEl.innerText = ''; setClippyState('default'); }, 3000);
    }
  });

  // Easter Egg Trigger Logic
  let clickCount = 0;
  const headerTitle = document.querySelector('header h1');
  const easterEggOverlay = document.getElementById('easter-egg');
  
  headerTitle.addEventListener('click', () => {
    clickCount++;
    if (clickCount >= 5) {
      clickCount = 0;
      easterEggOverlay.style.display = 'flex';
      
      // Fire the jingle along with the gif animation
      new Audio(chrome.runtime.getURL('Piratemusic.mp3')).play().catch(e => console.warn("Audio play blocked:", e));
    }
  });

  // Close Easter Egg
  easterEggOverlay.addEventListener('click', () => {
    easterEggOverlay.style.display = 'none';
  });
});

document.getElementById('send_suggestion').addEventListener('click', async () => {
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
    
    chrome.runtime.sendMessage({ action: 'submitSuggestion', text: text }, (response) => {
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
  const folderId = document.getElementById('piracy_folder_id').value.trim();
  const sheetId = document.getElementById('piracy_sheet_id').value.trim();
  const eventSheetId = document.getElementById('event_sheet_id').value.trim();
  const betaOptIn = document.getElementById('beta_opt_in').checked;
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

  chrome.storage.sync.set({ 
    piracy_folder_id: folderId, 
    piracy_sheet_id: sheetId,
    event_sheet_id: eventSheetId,
    beta_opt_in: betaOptIn,
    report_mode: reportMode
  }, () => {
    setClippyState('smirk');
    status.style.color = 'green';
    status.innerText = 'Configurations Locked. Ready for Hunt.';
    
    // Mark onboarding step if it was pending
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
=======
document.addEventListener('DOMContentLoaded', async () => {
  bindCoreOptionsEvents();
  bindBriefingStatsModalEvents();
  bindBriefingContentModalEvents();
  bindSelectorEditorEvents();
  await loadInitialOptionsState();
});
>>>>>>> Stashed changes
