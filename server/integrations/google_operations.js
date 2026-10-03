import {scannerRowKey,newlyStruckUrls} from '../scanner_rewards.js';
import { getDoubleXpRetentionDays, reconcileDoubleXpVerticals } from '../../utils/double_xp_retention.js';
import crypto from 'node:crypto';
import defaults from '../../events_config.json' with { type: 'json' };
import { neutralEventConfig } from '../../scripts/release_policy.mjs';
import { createGoogleAdapter } from './google_adapter.js';
import { createGoogleResourceGuard } from './google_resource_guard.js';
import { googleConnectorToken } from './google_credentials.js';
import { assert, ApiError } from '../api_error.js';
import { validateGoogleCommand, GOOGLE_OPERATION_PERMISSIONS } from './google_command_policy.js';
export { validateGoogleCommand } from './google_command_policy.js';
import { requirePlatforms, requireUrlPlatforms } from '../platform_policy.js';
import { uploadOperationKey } from '../integration_journal.js';

const READS = new Set(['fetchConfig','getEventData','checkIfAuthorized','getColumnHDataWithFormatting','getRecommendedStartRow']);
export function createGoogleOperations({ repository, fetchImpl = fetch, tokenProvider = googleConnectorToken } = {}) {
  async function adapterFor(actor, delegatedToken, {permission = 'sidepanel.report', writeJournal} = {}) {
    const token = await tokenProvider(actor.customerId,{delegatedToken,fetchImpl});
    const integrations = actor.customerConfig.destinations;
    const resourceGuard = createGoogleResourceGuard({actor, token, permission, repository, fetchImpl});
    await resourceGuard.verifyConfigured();
    const adapter = createGoogleAdapter({token,integrations,actor,resourceGuard,writeJournal,fetchImpl,defaults: actor.customerId === 'flosports' ? defaults : neutralEventConfig(defaults)});
    return {adapter,token,integrations,resourceGuard};
  }

  async function execute(actor, candidate, delegatedToken) {
    let command=validateGoogleCommand(actor,candidate);
    const responseRequestId=command.requestId;
    actor=await repository.claimIntegrationResources(actor);
    validateGoogleCommand(actor,command);
    // Reject guessed folders from our scoped journal before any Google metadata
    // request, so foreign and nonexistent IDs cannot act as an existence probe.
    if (command.name === 'uploadToDrive') await repository.requireUploadFolder(actor, command.args[0]);
    let journal;
    const writeJournal = {beforeWrite: () => {
      assert(journal, 500, 'configuration_error', 'A journal is required before a provider write.');
      return journal.beforeWrite();
    }};
    const {adapter,token,integrations,resourceGuard}=await adapterFor(actor,delegatedToken,{permission:GOOGLE_OPERATION_PERMISSIONS[command.name],writeJournal});
    const args=command.args;
    if (command.name === 'uploadToDrive') await resourceGuard.assertFolder(args[0], true);
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
    const work=async(admittedActor=actor, admittedJournal)=>{
      actor=admittedActor;
      journal=admittedJournal;
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
          const bytes=Buffer.from(args[2],'base64');
          const valid=args[3]==='application/pdf' ? bytes.subarray(0,5).toString()==='%PDF-' : args[3]==='image/png' ? bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a' : bytes[0]===255 && bytes[1]===216;
          assert(valid && bytes.length>0 && bytes.length<=4*1024*1024,400,'invalid_operation','The file content does not match its type.');
          result=await adapter.uploadToDrive(token,args[0],args[1],new Blob([bytes],{type:args[3]}),args[3],{customerId:actor.customerId,userId:actor.memberId,eventId:args[4],operationKey:uploadOperationKey(actor,command)});
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
    const result=READS.has(command.name)?await work():await repository.runIntegrationOperation(actor,command,work);
    // A journal result is not a permanent capability: files/folders may have
    // moved to another tenant since the original operation completed.
    if (['ensureRogueScreenshotFolder','ensureYearlyReportFolder','ensureDailyScreenshotFolder','ensureBriefingFolder'].includes(command.name)) {
      await resourceGuard.assertFolder(result);
    } else if (command.name === 'uploadToDrive') {
      await resourceGuard.assertFile(result?.id, args[3]);
    }
    return {customerId:actor.customerId,userId:actor.memberId,requestId:responseRequestId,result};
  }
  async function reconcileUpload(actor, candidate, delegatedToken) {
    const command = validateGoogleCommand(actor, candidate);
    assert(command.name === 'uploadToDrive', 400, 'invalid_operation', 'Only evidence uploads support receipt reconciliation.');
    let resourceGuard;
    const result = await repository.reconcileIntegrationUpload(actor, command, async (current, options) => {
      actor = await repository.claimIntegrationResources(current);
      const args = command.args;
      await repository.requireUploadFolder(actor, args[0]);
      const connection = await adapterFor(actor, delegatedToken);
      resourceGuard = connection.resourceGuard;
      const bytes = Buffer.from(args[2], 'base64');
      return connection.adapter.reconcileUpload(args[0], args[1], args[3],
        {customerId: actor.customerId, userId: actor.memberId, eventId: args[4], operationKey: uploadOperationKey(actor, command)},
        crypto.createHash('sha256').update(bytes).digest('hex'), bytes.length, options);
    });
    // Completed receipts must also pass today's resource authorization checks.
    if (!resourceGuard) ({resourceGuard} = await adapterFor(actor, delegatedToken));
    await resourceGuard.assertFile(result?.id, command.args[3]);
    return {customerId: actor.customerId, userId: actor.memberId, requestId: command.requestId, result};
  }
  return {execute,adapterFor,reconcileUpload};
}
