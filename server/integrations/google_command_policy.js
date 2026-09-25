import { CONFIG_SECTION_PERMISSIONS } from '../../utils/permission_policy.js';
import { assert } from '../api_error.js';
import { requirePermission } from '../access_policy.js';
import { requirePlatforms, requireUrlPlatforms } from '../platform_policy.js';
import { isValidDoubleXpRetentionDays } from '../../utils/double_xp_retention.js';
import { isValidGamificationLevels } from '../../utils/gamification_levels.js';

export const GOOGLE_OPERATION_PERMISSIONS = Object.freeze({
  fetchConfig: 'sidepanel.report', getEventData: 'sidepanel.report', checkIfAuthorized: 'sidepanel.report',
  updateEventUrl: 'sidepanel.report', addNewEventToSheet: 'sidepanel.report',
  ensureRogueScreenshotFolder: 'sidepanel.report', ensureYearlyReportFolder: 'sidepanel.report', ensureDailyScreenshotFolder: 'sidepanel.report',
  ensureBriefingFolder: 'sidepanel.intel', uploadToDrive: 'sidepanel.report',
  patchConfigSelector: 'sidepanel.repair', updateConfigSections: 'settings.intelligenceTools',
  getColumnHDataWithFormatting: 'sidepanel.automate', getRecommendedStartRow: 'sidepanel.automate',
  addEnforcerBonusPoints: 'sidepanel.automate', updateRowStatus: 'sidepanel.automate', updateCellWithRichText: 'sidepanel.automate',
  submitSuggestionToSheet: 'settings.feedbackComms'
});
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function text(value, maximum = 240, multiline = false) {
  const forbidden = multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
  assert(typeof value === 'string' && value.length <= maximum && !forbidden.test(value), 400, 'invalid_operation', 'Invalid operation text.');
  return value;
}
const row = value => { assert(Number.isSafeInteger(value) && value >= 1 && value <= 1000000, 400, 'invalid_operation', 'Invalid row.'); return value; };
function exact(value, keys) {
  assert(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value,k)), 400, 'invalid_operation', 'Invalid operation fields.');
}
function safeTree(value, depth = 0) {
  assert(depth < 20, 400, 'invalid_operation', 'Configuration is too deeply nested.');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!['__proto__','prototype','constructor'].includes(key), 400, 'invalid_operation', 'Unsafe configuration key.');
    safeTree(child, depth + 1);
  }
}

export function validateGoogleCommand(actor, command) {
  exact(command, ['name','args','requestId']);
  assert(Object.hasOwn(GOOGLE_OPERATION_PERMISSIONS, command.name) && id(command.requestId) && Array.isArray(command.args), 400, 'invalid_operation', 'Unsupported Google operation.');
  requirePermission(actor, GOOGLE_OPERATION_PERMISSIONS[command.name]);
  const a = command.args;
  const arity = { fetchConfig:0,getEventData:1,checkIfAuthorized:2,updateEventUrl:4,addNewEventToSheet:4,
    ensureRogueScreenshotFolder:0,ensureYearlyReportFolder:1,ensureDailyScreenshotFolder:1,ensureBriefingFolder:0,
    uploadToDrive:5,patchConfigSelector:5,updateConfigSections:1,getColumnHDataWithFormatting:0,getRecommendedStartRow:0,
    addEnforcerBonusPoints:1,updateRowStatus:2,updateCellWithRichText:3,submitSuggestionToSheet:1 };
  assert(a.length === arity[command.name], 400, 'invalid_operation', 'Invalid operation arguments.');
  safeTree(a);
  switch(command.name) {
    case 'getEventData': text(a[0],120); break;
    case 'checkIfAuthorized': requirePlatforms(actor,[a[0]]); text(a[1],160); assert(a[1],400,'invalid_operation','A handle is required.'); break;
    case 'updateEventUrl': text(a[0],120); row(a[1]); requireUrlPlatforms(actor,[a[2]],a[3]); break;
    case 'addNewEventToSheet': text(a[0],120); text(a[1],160); requireUrlPlatforms(actor,[a[2]],a[3]); break;
    case 'ensureYearlyReportFolder': assert(Number.isInteger(a[0]) && a[0]>=2000 && a[0]<=2100,400,'invalid_operation','Invalid year.'); break;
    case 'ensureDailyScreenshotFolder': assert(/^\d{4}-\d\d-\d\d$/.test(a[0]),400,'invalid_operation','Invalid date.'); break;
    case 'uploadToDrive':
      assert(/^[A-Za-z0-9_-]{10,256}$/.test(a[0]),400,'invalid_operation','Invalid folder.'); text(a[1],200);
      assert(['image/jpeg','image/png','application/pdf'].includes(a[3]) && typeof a[2]==='string' && a[2].length<=5600000 && /^[A-Za-z0-9+/]*={0,2}$/.test(a[2]),400,'invalid_operation','Invalid file.');
      assert(id(a[4]),400,'invalid_operation','Invalid evidence event.'); break;
    case 'patchConfigSelector':
      requirePlatforms(actor,[a[0]]); assert(['scraper','autofill'].includes(a[1]),400,'invalid_operation','Only scraper and autofill selectors can be patched.');
      text(a[2],160); assert(a[2].split('.').every(p=>/^[a-zA-Z0-9_-]+$/.test(p)&&!['__proto__','constructor','prototype'].includes(p)),400,'invalid_operation','Invalid selector path.');
      text(a[3],2000); assert(a[4]===null || ['click','type','select','wait','scroll','input','change','check'].includes(a[4]),400,'invalid_operation','Invalid selector action.'); break;
    case 'updateConfigSections':
      assert(a[0] && !Array.isArray(a[0]) && typeof a[0]==='object',400,'invalid_operation','Invalid configuration.');
      assert(Object.keys(a[0]).every(k=>Object.hasOwn(CONFIG_SECTION_PERMISSIONS,k)),400,'invalid_operation','Unsupported configuration section.');
      for (const section of Object.keys(a[0])) requirePermission(actor, CONFIG_SECTION_PERMISSIONS[section]);
      assert(JSON.stringify(a[0]).length<=128*1024,400,'invalid_operation','Configuration is oversized.');
      if(a[0].verticals) assert(Array.isArray(a[0].verticals),400,'invalid_operation','Verticals must be a list.');
      if(a[0].gamification_levels) assert(isValidGamificationLevels(a[0].gamification_levels),400,'invalid_operation','Invalid level thresholds.');
      if(a[0].double_xp_settings) assert(isValidDoubleXpRetentionDays(a[0].double_xp_settings.retention_days),400,'invalid_operation','Invalid Double XP retention.');
      if (a[0].platform_selectors) requirePlatforms(actor,Object.keys(a[0].platform_selectors));
      break;
    case 'addEnforcerBonusPoints': row(a[0]); break;
    case 'updateRowStatus': row(a[0]); assert(['Resolved','Investigating'].includes(a[1]),400,'invalid_operation','Invalid status.'); break;
    case 'updateCellWithRichText': row(a[0]); text(a[1],30000,true); assert(Array.isArray(a[2])&&a[2].length<=500,400,'invalid_operation','Invalid formatting.'); break;
    case 'submitSuggestionToSheet': text(a[0],4000,true); break;
  }
  return command;
}

