import {scannerRowKey,newlyStruckUrls} from '../scanner_rewards.js';
import { getDoubleXpRetentionDays, isValidDoubleXpRetentionDays, reconcileDoubleXpVerticals } from '../../utils/double_xp_retention.js';
import { isValidGamificationLevels } from '../../utils/gamification_levels.js';
import crypto from 'node:crypto';
import defaults from '../../events_config.json' with { type: 'json' };
import { neutralEventConfig } from '../../scripts/release_policy.mjs';
import { createGoogleAdapter } from './google_adapter.js';
import { googleConnectorToken } from './google_credentials.js';
import { assert, ApiError } from '../api_error.js';
import { requirePermission } from '../access_policy.js';
import { requirePlatforms, requireUrlPlatforms } from '../platform_policy.js';

const READS = new Set(['fetchConfig','getEventData','checkIfAuthorized','getColumnHDataWithFormatting','getRecommendedStartRow']);
const PERMISSIONS = {
  fetchConfig: 'sidepanel.report', getEventData: 'sidepanel.report', checkIfAuthorized: 'sidepanel.report',
  updateEventUrl: 'sidepanel.report', addNewEventToSheet: 'sidepanel.report',
  ensureRogueScreenshotFolder: 'sidepanel.report', ensureYearlyReportFolder: 'sidepanel.report', ensureDailyScreenshotFolder: 'sidepanel.report',
  ensureBriefingFolder: 'sidepanel.intel', uploadToDrive: 'sidepanel.report',
  patchConfigSelector: 'sidepanel.repair', updateConfigSections: 'settings.intelligenceTools',
  getColumnHDataWithFormatting: 'sidepanel.automate', getRecommendedStartRow: 'sidepanel.automate',
  addEnforcerBonusPoints: 'sidepanel.automate', updateRowStatus: 'sidepanel.automate', updateCellWithRichText: 'sidepanel.automate',
  submitSuggestionToSheet: 'settings.feedbackComms'
};
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
  assert(Object.hasOwn(PERMISSIONS, command.name) && id(command.requestId) && Array.isArray(command.args), 400, 'invalid_operation', 'Unsupported Google operation.');
  requirePermission(actor, PERMISSIONS[command.name]);
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
      assert(Object.keys(a[0]).every(k=>['verticals','platform_selectors','double_xp_settings','gamification_levels','community_highlights','briefing_content'].includes(k)),400,'invalid_operation','Unsupported configuration section.');
      if (['platform_selectors','double_xp_settings','gamification_levels'].some(k=>Object.hasOwn(a[0],k))) requirePermission(actor,'settings.adminAccess');
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

export function createGoogleOperations({ repository, fetchImpl = fetch, tokenProvider = googleConnectorToken } = {}) {
  async function adapterFor(actor, delegatedToken) {
    const token = await tokenProvider(actor.customerId,{delegatedToken,fetchImpl});
    const integrations = actor.customerConfig.destinations;
    const adapter = createGoogleAdapter({token,integrations,actor,fetchImpl,defaults: actor.customerId === 'flosports' ? defaults : neutralEventConfig(defaults)});
    const metadata = async resourceId => {
      const res = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(resourceId)}?fields=id,parents,mimeType,trashed&supportsAllDrives=true`, {headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
      assert(res.ok,403,'resource_unavailable','The configured Google resource is unavailable.');
      const value = await res.json(); assert(!value.trashed,403,'resource_unavailable','The Google resource was deleted.'); return value;
    };
    async function assertOwnedFolder(folderId) {
      const visited=new Set(); let current=folderId;
      for(let depth=0;depth<10;depth++) {
        assert(!visited.has(current),403,'scope_mismatch','Invalid folder ancestry.'); visited.add(current);
        const file=await metadata(current);
        assert(file.mimeType==='application/vnd.google-apps.folder',403,'scope_mismatch','A folder is required.');
        if(current===integrations.driveRootFolderId) return;
        assert(file.parents?.length===1,403,'scope_mismatch','The folder is outside the customer root.'); current=file.parents[0];
      }
      throw new ApiError(403,'scope_mismatch','The folder is outside the customer root.');
    }
    return {adapter,token,integrations,metadata,assertOwnedFolder};
  }

  async function execute(actor, candidate, delegatedToken) {
    let command=validateGoogleCommand(actor,candidate);
    const responseRequestId=command.requestId;
    actor=await repository.claimIntegrationResources(actor) || actor;
    validateGoogleCommand(actor,command);
    const {adapter,token,integrations,assertOwnedFolder}=await adapterFor(actor,delegatedToken);
    const args=command.args;
    if(['getEventData','updateEventUrl','addNewEventToSheet'].includes(command.name)) {
      const config=await adapter.fetchConfig();
      assert(config.verticals?.some(vertical=>vertical.name===args[0]),403,'rights_policy_denied','Select a configured customer vertical.');
    }
    let bonus=null,bonusRowKey;
    if(command.name==='addEnforcerBonusPoints') {
      const current=(await adapter.getColumnHDataWithFormatting())[args[0]];
      assert(current?.text && current.status==='Resolved',409,'stale_row','Only a resolved report row can receive a bonus.');
      const urls=[...new Set(current.text.match(/https?:\/\/[^\s]+/g)||[])];
      requireUrlPlatforms(actor,urls);
      bonusRowKey=scannerRowKey(integrations.reportSpreadsheetId,args[0],current.text);
      bonus=await repository.reserveScannerBonus(actor,bonusRowKey);
      if(!bonus) return {customerId:actor.customerId,userId:actor.memberId,requestId:responseRequestId,result:0};
      command={...command,requestId:bonus.awardId};
    }
    const work=async(admittedActor=actor)=>{
      actor=admittedActor;
      let result;
      switch(command.name) {
        case 'addEnforcerBonusPoints':
          requirePlatforms(actor,bonus.platforms);
          result=await adapter.addEnforcerBonusPoints(args[0],bonus.points);
          await repository.completeScannerBonus(actor,bonusRowKey,bonus.awardId,args[0]); break;
        case 'ensureRogueScreenshotFolder': result=await adapter.ensureRogueScreenshotFolder(token); break;
        case 'ensureYearlyReportFolder': result=await adapter.ensureYearlyReportFolder(token,args[0]); break;
        case 'ensureDailyScreenshotFolder': result=await adapter.ensureDailyScreenshotFolder(token,args[0]); break;
        case 'ensureBriefingFolder': result=await adapter.findOrCreateFolder(token,integrations.driveRootFolderId,'Tactical Briefings'); break;
        case 'uploadToDrive': {
          await assertOwnedFolder(args[0]);
          const bytes=Buffer.from(args[2],'base64');
          const valid=args[3]==='application/pdf' ? bytes.subarray(0,5).toString()==='%PDF-' : args[3]==='image/png' ? bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a' : bytes[0]===255 && bytes[1]===216;
          assert(valid && bytes.length>0 && bytes.length<=4*1024*1024,400,'invalid_operation','The file content does not match its type.');
          result=await adapter.uploadToDrive(token,args[0],args[1],new Blob([bytes],{type:args[3]}),args[3],{customerId:actor.customerId,userId:actor.memberId,eventId:args[4]});
          await repository.recordUploadedFile(actor,args[4],args[3],result,crypto.createHash('sha256').update(bytes).digest('hex')); break;
        }
        case 'getEventData': {
          result=await adapter.getEventData(...args);
          for(const event of Object.values(result.eventMap || {})) event.urls=Object.fromEntries(Object.entries(event.urls||{}).filter(([platform])=>actor.platforms.includes(platform)));
          break;
        }
        case 'fetchConfig': {
          result=await adapter.fetchConfig();
          result.platform_selectors=Object.fromEntries(Object.entries(result.platform_selectors||{}).filter(([platform])=>actor.platforms.includes(platform)));
          break;
        }
        case 'updateConfigSections': {
          const sections=structuredClone(args[0]);
          if(sections.verticals || sections.double_xp_settings) {
            const current=await adapter.fetchConfig();
            const retention=sections.double_xp_settings?.retention_days ?? getDoubleXpRetentionDays(current);
            sections.verticals=reconcileDoubleXpVerticals(sections.verticals || current.verticals,current.verticals,{retentionDays:retention,recalculateExisting:Boolean(sections.double_xp_settings)});
          }
          result=await adapter.updateConfigSections(sections); break;
        }
        case 'submitSuggestionToSheet': result=await adapter.submitSuggestionToSheet(token,args[0],actor.email); break;
        case 'getColumnHDataWithFormatting': {
          result=await adapter.getColumnHDataWithFormatting();
          result=result.map(value=>{try {const urls=value.text.match(/https?:\/\/[^\s]+/g)||[]; if(urls.length) requireUrlPlatforms(actor,urls); return value;} catch {return {text:'',status:'',formatRuns:[],cellStrikethrough:false};}}); break;
        }
        case 'updateRowStatus': case 'updateCellWithRichText': {
          const rows=await adapter.getColumnHDataWithFormatting(); const current=rows[args[0]];
          assert(current?.text,404,'resource_unavailable','The report row is missing.');
          requireUrlPlatforms(actor,current.text.match(/https?:\/\/[^\s]+/g)||[]);
          if(command.name==='updateCellWithRichText') {
            assert(current.text===args[1],409,'stale_row','The report row changed. Scan it again.');
            assert(args[2].every((run,index)=>(index===0 || run.startIndex>args[2][index-1].startIndex)&&Number.isSafeInteger(run.startIndex)&&run.startIndex>=0&&run.startIndex<current.text.length&&run.format&&Object.keys(run.format).every(k=>['strikethrough','foregroundColor','link','underline','bold','italic'].includes(k))),400,'invalid_operation','Invalid report formatting.');
            for(const run of args[2]) if(run.format.link) assert(current.text.includes(run.format.link.uri),400,'invalid_operation','Links must refer to the report text.');
          }
          result=await adapter[command.name](...args);
          if(command.name==='updateCellWithRichText') await repository.recordScannerResolutions(actor,scannerRowKey(integrations.reportSpreadsheetId,args[0],current.text),newlyStruckUrls(current,args[2]));
          break;
        }
        default: result=await adapter[command.name](...args);
      }
      return result ?? null;
    };
    const result=READS.has(command.name)?await work():await repository.runIntegrationOperation(actor,command,work,validateGoogleCommand);
    return {customerId:actor.customerId,userId:actor.memberId,requestId:responseRequestId,result};
  }
  return {execute,adapterFor};
}
