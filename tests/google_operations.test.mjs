import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { validateGoogleCommand, createGoogleOperations } from '../server/integrations/google_operations.js';
import { googleConnectorToken } from '../server/integrations/google_credentials.js';
import { verifyReportPolicy, authoritativeReportAttributes } from '../server/report_policy.js';
import { assertMessageSender } from '../utils/message_policy.js';
import { ApiError } from '../server/api_error.js';
const config=JSON.parse(await fs.readFile(new URL('../migrations/flosports/customer.json',import.meta.url)));
const actor={customerId:'flosports',memberId:'user',email:'operator@flosports.tv',name:'Operator',role:'admin',platforms:['youtube'],customerConfig:config};
const command=(name,args)=>({name,args,requestId:'op-1'});

test('Google gateway rejects authority, arbitrary provider calls and client-specified destinations',()=>{
  for(const c of [command('fetch',['https://private']),{...command('fetchConfig',[]),customerId:'other'},command('fetchConfig',['other-root']),command('addEnforcerBonusPoints',[2,100000]),command('checkIfAuthorized',['tiktok','a']),command('patchConfigSelector',['youtube','session','authorized_handles','@bad',null])]) assert.throws(()=>validateGoogleCommand(actor,c));
  assert.throws(()=>validateGoogleCommand({...actor,role:'employee'},command('updateConfigSections',[{verticals:[]}])));
  assert.throws(()=>validateGoogleCommand(actor,command('updateConfigSections',[JSON.parse('{"verticals":{"__proto__":{"polluted":true}}}')])));
  assert.equal({}.polluted,undefined);
  validateGoogleCommand(actor,command('updateRowStatus',[2,'Resolved']));
});

test('unconfigured connector fails closed; legacy delegation must be explicitly scoped',async()=>{
  await assert.rejects(googleConnectorToken('customer-b',{connectors:'{}',delegatedToken:'token',legacyCustomers:'customer-a'}),{code:'connector_unavailable'});
  assert.equal(await googleConnectorToken('customer-a',{connectors:'{}',delegatedToken:'token',legacyCustomers:'customer-a'}),'token');
  let sent;
  const token=await googleConnectorToken('customer-a',{connectors:JSON.stringify({'customer-a':{clientId:'id',clientSecret:'secret',refreshToken:'refresh'}}),fetchImpl:async(url,options)=>{sent={url,options};return Response.json({access_token:'server-token'});}});
  assert.equal(token,'server-token');assert.equal(sent.url,'https://oauth2.googleapis.com/token');assert.equal(sent.options.redirect,'error');
});

test('gateway denies a folder outside the configured customer root before upload',async()=>{
  let uploaded=false;
  const service=createGoogleOperations({repository:{claimIntegrationResources:async()=>actor,requireUploadFolder:async()=>{throw new ApiError(403,'scope_mismatch','Folder unavailable');},verifyGoogleResourceScope:async()=>actor,runIntegrationOperation:async(_a,_c,work)=>work()},tokenProvider:async()=> 'server-token',fetchImpl:async(url)=>{
    if(url.includes('/upload/')) uploaded=true;
    const id = new URL(url).pathname.split('/').at(-1);
    return Response.json({id,trashed:false,driveId:'fixture-google-home',mimeType:[config.destinations.driveRootFolderId,'outside-folder-1','fixture-google-home'].includes(id) ? 'application/vnd.google-apps.folder' : 'application/vnd.google-apps.spreadsheet',parents:id==='fixture-google-home'?[]:['fixture-google-home'],capabilities:{canListChildren:true,canAddChildren:true}});
  }});
  await assert.rejects(service.execute(actor,command('uploadToDrive',['outside-folder-1','x.pdf',Buffer.from('%PDF-x').toString('base64'),'application/pdf','evt-1'])),{code:'scope_mismatch'});
  assert.equal(uploaded,false);
});

test('report policy checks catalog, whitelist, duplicate URLs and server expiry for Double XP',async()=>{
  const report={reportId:'r',eventId:'e',vertical:'Sports',eventName:'Final',handle:'pirate',items:[{url:'https://youtube.com/watch?v=1',views:'999999',screenshotLink:''}]};
  const adapter={fetchConfig:async()=>({verticals:[{name:'Sports',events:[{name:'Final',double_xp:true,double_xp_expires_at:'2000-01-01'}]}]}),getEventData:async()=>({eventMap:{final:{name:'Final'}}}),checkIfAuthorized:async()=>false};
  adapter.resolveYoutubeTargetAccount=async()=>`UC${'a'.repeat(22)}`;
  adapter.resolveYoutubeAccount=async()=>`UC${'a'.repeat(22)}`;
  const policy=await verifyReportPolicy(actor,report,adapter);
  const attributes=authoritativeReportAttributes(report,policy,{url_count:10000,scout_points:1000000,enforcer_points:1000000,outcome:'confirmed',pdf_url:'https://drive.google.com/file/d/x'});
  assert.equal(attributes.url_count,1);assert.equal(attributes.scout_points,50);assert.equal(attributes.enforcer_points,20);assert.equal(attributes.outcome,'operator_prepared');
  await assert.rejects(verifyReportPolicy(actor,{...report,items:[...report.items,...report.items]},adapter),{code:'invalid_report'});
  await assert.rejects(verifyReportPolicy(actor,{...report,vertical:'Foreign'},adapter),{code:'rights_policy_denied'});
  adapter.checkIfAuthorized=async()=>true;
  await assert.rejects(verifyReportPolicy(actor,report,adapter),{code:'authorized_target'});
  adapter.checkIfAuthorized=async()=>{throw Error('Google unavailable');};
  await assert.rejects(verifyReportPolicy(actor,report,adapter),/Google unavailable/);
});

test('runtime messages reject foreign extensions, privilege escalation and mismatched capture tabs',()=>{
  const sender={id:'id',url:'https://youtube.com/watch?v=1',tab:{id:1,url:'https://youtube.com/watch?v=1'},frameId:0};
  assertMessageSender({action:'processNewItem',data:{url:sender.url}},sender,'id');
  assert.throws(()=>assertMessageSender({action:'teamAccess'},sender,'id'));
  assert.throws(()=>assertMessageSender({action:'processNewItem',data:{url:'https://private.test'}},sender,'id'));
  assert.throws(()=>assertMessageSender({action:'getConfig'},{...sender,id:'foreign'},'id'));
  assert.throws(()=>assertMessageSender({action:'getConfig'},{...sender,url:'https://embed.test',frameId:2},'id'));
  assertMessageSender({action:'teamAccess'},{id:'id',url:'chrome-extension://id/options/team.html'},'id');
});
