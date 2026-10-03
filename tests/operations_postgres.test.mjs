import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { createPostgresRepository } from '../server/postgres_repository.js';
import { migrateTeamTestDatabase, teamFixture } from './team_fixture.mjs';

test('architecture controls against isolated Postgres',{skip:!process.env.TEST_DATABASE_URL},async t=>{
  assert.equal(process.env.TEST_DATABASE_ISOLATED,'true');
  const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:6});t.after(()=>pool.end());
  await migrateTeamTestDatabase(pool);
  const repo=createPostgresRepository({pool});
  const f=await teamFixture(pool), other=await teamFixture(pool);
  const actor=await repo.requireActiveMember(f.identity), foreign=await repo.requireActiveMember(other.identity);
  const report={reportId:'report-1',eventId:'event-1',eventName:'Final',vertical:'Sports',handle:'pirate',items:[{url:'https://youtube.com/watch?v=one',screenshotLink:'',views:'123'}]};
  const policy={version:1,platform:'youtube',multiplier:1};
  const render=async()=>new Blob(['%PDF-fixture'],{type:'application/pdf'});
  const event={customer_id:f.id,user_id:actor.memberId,event_id:report.eventId,event_type:'report.submitted',occurred_at:Date.now()-100000,attributes:{mode:'enforcer',report_id:report.reportId,platform:'youtube',urls:[report.items[0].url],url_count:9999,scout_points:999999,enforcer_points:999999,pdf_url:'https://drive.google.com/file/d/pdf-one/view'}};
  await t.test('destination reservation rejects sharing across tenants',async()=>{
    await assert.rejects(pool.query("UPDATE customers SET config=jsonb_set(config,'{destinations,driveRootFolderId}',to_jsonb($2::text)) WHERE customer_id=$1",[other.id,actor.customerConfig.destinations.driveRootFolderId]),{code:'23514'});
    assert.equal((await pool.query("SELECT customer_id FROM customer_integration_resources WHERE resource_id=$1",[actor.customerConfig.destinations.driveRootFolderId])).rows[0].customer_id,f.id);
  });
  await t.test('forged facts require a generated report and matching owned PDF digest',async()=>{
    await assert.rejects(repo.recordEvent(actor,event,Date.now()),{code:'report_required'});
    const result=await repo.generateReport(actor,report,render,policy);
    assert.deepEqual(await repo.generateReport(actor,report,render,policy),result);
    await assert.rejects(repo.generateReport(actor,{...report,handle:'changed'},render,policy),{code:'report_conflict'});
    await assert.rejects(repo.generateReport(actor,{...report,reportId:'foreign-image',eventId:'foreign-event',items:[{...report.items[0],screenshotLink:'https://drive.google.com/file/d/foreign'}]},render,policy),{code:'evidence_scope_mismatch'});
    await assert.rejects(repo.recordEvent(actor,event,Date.now()),{code:'evidence_scope_mismatch'});
    const hash=crypto.createHash('sha256').update(Buffer.from(result.pdf,'base64')).digest('hex');
    await repo.recordUploadedFile(foreign,event.event_id,'application/pdf',{id:'foreign-file',webViewLink:event.attributes.pdf_url},hash);
    await assert.rejects(repo.recordEvent(actor,event,Date.now()),{code:'evidence_scope_mismatch'});
    await repo.recordUploadedFile(actor,event.event_id,'application/pdf',{id:'pdf-one',webViewLink:event.attributes.pdf_url},hash);
    const acceptedAt=Date.now();await repo.recordEvent(actor,event,acceptedAt);await repo.recordEvent(actor,event,acceptedAt);
    const stored=(await pool.query('SELECT * FROM customer_events WHERE customer_id=$1 AND event_id=$2',[f.id,event.event_id])).rows;
    assert.equal(stored.length,1);assert.equal(stored[0].attributes.url_count,1);assert.equal(stored[0].attributes.scout_points,10);assert.equal(stored[0].attributes.enforcer_points,20);
    assert.equal(new Date(stored[0].occurred_at).valueOf(),acceptedAt);
    await assert.rejects(repo.recordEvent(actor,{...event,attributes:{...event.attributes,url_count:2}},Date.now()),{code:'event_conflict'});
    await assert.rejects(repo.recordEvent(actor,{...event,event_id:'invented-id'},Date.now()),{code:'report_required'});
  });
  await t.test('a new event and report ID cannot earn credit twice for the same target/work',async()=>{
    const duplicate={...report,reportId:'duplicate-report',eventId:'duplicate-event',items:[{...report.items[0],url:'https://youtu.be/one'}]};
    const pdf=await repo.generateReport(actor,duplicate,render,policy);
    const url='https://drive.google.com/file/d/duplicate-pdf/view';
    await repo.recordUploadedFile(actor,duplicate.eventId,'application/pdf',{id:'duplicate-pdf',webViewLink:url},crypto.createHash('sha256').update(Buffer.from(pdf.pdf,'base64')).digest('hex'));
    await assert.rejects(repo.recordEvent(actor,{...event,event_id:duplicate.eventId,attributes:{...event.attributes,report_id:duplicate.reportId,urls:[duplicate.items[0].url],pdf_url:url}},Date.now()),{code:'duplicate_report_target'});
    assert.equal((await pool.query('SELECT event_id FROM customer_events WHERE customer_id=$1 AND event_id=$2',[f.id,duplicate.eventId])).rows.length,0);
  });
  await t.test('projection preflight failures leave accepted work pending and retryable',async()=>{
    await assert.rejects(repo.projectReport(actor,report.reportId,async(_value,options)=>{
      assert.equal(options.reconcileOnly,false);
      throw Error('Google metadata unavailable');
    }),/Google metadata unavailable/);
    const job=(await pool.query('SELECT status,attempts FROM report_projection_jobs WHERE customer_id=$1 AND report_id=$2',[f.id,report.reportId])).rows[0];
    assert.equal(job.status,'pending');assert.equal(job.attempts,1);
  });
  await t.test('uncertain projection reconciles without granting permission to append twice',async()=>{
    let attempts=0;
    await assert.rejects(repo.projectReport(actor,report.reportId,async(value,options)=>{attempts++;assert.equal(options.reconcileOnly,false);assert.equal(value.attributes.url_count,1);await options.beforeAppend();throw Error('Response lost after append');}),/Response lost/);
    await repo.projectReport(actor,report.reportId,async(value,options)=>{attempts++;assert.equal(options.reconcileOnly,true);assert.equal(value.reportId,report.reportId);});
    await repo.projectReport(actor,report.reportId,async()=>{throw Error('Must not project a completed job');});
    assert.equal(attempts,2);
    await assert.rejects(repo.projectReport(foreign,report.reportId,async()=>{}),{code:'report_required'});
  });
  await t.test('operation journal replays completed work and refuses uncertain or altered requests',async()=>{
    let calls=0;const command={name:'updateRowStatus',args:[2,'Resolved'],requestId:'operation-one'};
    const work=async()=>{calls++;return {ok:true};};
    assert.deepEqual(await repo.runIntegrationOperation(actor,command,work),{ok:true});
    assert.deepEqual(await repo.runIntegrationOperation(actor,command,work),{ok:true});assert.equal(calls,1);
    await assert.rejects(repo.runIntegrationOperation(actor,{...command,args:[3,'Resolved']},work),{code:'operation_conflict'});
    const uncertain={...command,requestId:'uncertain'};
    await assert.rejects(repo.runIntegrationOperation(actor,uncertain,async(_actor,journal)=>{await journal.beforeWrite();throw Error('Provider timeout');}),/Provider timeout/);
    await assert.rejects(repo.runIntegrationOperation(actor,uncertain,work),{code:'operation_uncertain'});assert.equal(calls,1);
  });
  await t.test('pre-write retry, fencing and upload reconciliation use the real tenant journal', async () => {
    const bytes = Buffer.from('%PDF-journal');
    const command = {name:'uploadToDrive',args:[actor.customerConfig.destinations.driveRootFolderId,'journal.pdf',bytes.toString('base64'),'application/pdf','journal-event'],requestId:'journal-retry'};
    await assert.rejects(repo.runIntegrationOperation(actor,command,async()=>{throw Error('Guard unavailable');}),/Guard unavailable/);
    const status = async () => (await pool.query('SELECT status FROM integration_operations WHERE customer_id=$1 AND operation_id=$2',[f.id,command.requestId])).rows[0].status;
    assert.equal(await status(),'retryable');
    await assert.rejects(repo.runIntegrationOperation(actor,command,async(_actor,journal)=>{
      const rejected = await journal.beforeWrite();
      assert.equal(await status(),'uncertain');
      await rejected(); throw Error('Provider rejected');
    }),/Provider rejected/);
    assert.equal(await status(),'retryable');
    await assert.rejects(repo.runIntegrationOperation(actor,command,async(_actor,journal)=>{await journal.beforeWrite();throw Error('Response lost');}),/Response lost/);
    await assert.rejects(repo.reconcileIntegrationUpload(foreign,command,()=>assert.fail('Foreign receipt lookup')),{code:'operation_unavailable'});
    const receipt={id:'journal-upload-file',webViewLink:'https://drive.google.com/file/d/journal-upload-file/view'};
    const reconcile=()=>repo.reconcileIntegrationUpload(actor,command,async()=>receipt);
    assert.deepEqual(await Promise.all([reconcile(),reconcile()]),[receipt,receipt]);
    assert.equal(await status(),'completed');
    assert.deepEqual(await repo.runIntegrationOperation(actor,command,()=>assert.fail('Duplicate upload')),receipt);
    assert.equal((await pool.query('SELECT content_sha256 FROM integration_uploaded_files WHERE customer_id=$1 AND file_id=$2',[f.id,receipt.id])).rows[0].content_sha256,crypto.createHash('sha256').update(bytes).digest('hex'));

    const staleCommand={...command,requestId:'journal-expired'};
    let entered, resume;
    const ready=new Promise(resolve=>{entered=resolve;});
    const gate=new Promise(resolve=>{resume=resolve;});
    const stale=repo.runIntegrationOperation(actor,staleCommand,async(_actor,journal)=>{entered();await gate;await journal.beforeWrite();assert.fail('Stale attempt wrote');});
    await ready;
    await assert.rejects(repo.runIntegrationOperation(actor,staleCommand,()=>assert.fail('Concurrent callback')),{code:'operation_in_progress'});
    await pool.query("UPDATE integration_operations SET lease_expires_at=now()-interval '1 second' WHERE customer_id=$1 AND operation_id=$2",[f.id,staleCommand.requestId]);
    await repo.runIntegrationOperation(actor,staleCommand,async()=>receipt);
    resume(); await assert.rejects(stale,{code:'operation_uncertain'});
  });
  await t.test('whole-batch rewards use accepted manifests, roll back on failure and replay without new credit',async()=>{
    const bf=await teamFixture(pool),ba=await repo.requireActiveMember(bf.identity);
    const now=Date.now(),yesterday=new Date(now-86400000).toISOString().slice(0,10);
    await pool.query('INSERT INTO customer_reward_state(customer_id,user_id,last_report_date,streak_count,freezes) VALUES($1,$2,$3,2,0)',[bf.id,ba.memberId,yesterday]);
    const submissions=[];
    for(let group=0;group<2;group++) {
      // Distinct, nonzero video IDs across both reports: handles do not change
      // TikTok identity, and this reward fixture requires 52 unique targets.
      const report={reportId:`batch-report-${group}`,eventId:`batch-event-${group}`,eventName:'Batch Final',vertical:'Sports',handle:`pirate${group}`,items:Array.from({length:26},(_,i)=>({url:`https://tiktok.com/@pirate${group}/video/${group*26+i+1}`,views:'10',screenshotLink:''}))};
      const pdf=await repo.generateReport(ba,report,render,{version:1,platform:'tiktok',multiplier:group===0?2:1});
      const url=`https://drive.google.com/file/d/batch-${group}/view`;
      await repo.recordUploadedFile(ba,report.eventId,'application/pdf',{id:`batch-file-${group}`,webViewLink:url},crypto.createHash('sha256').update(Buffer.from(pdf.pdf,'base64')).digest('hex'));
      submissions.push({reportId:report.reportId,eventId:report.eventId,pdfUrl:url,mode:'enforcer',contentType:'VOD'});
    }
    const batch={batchId:'batch-1',reports:submissions};
    await assert.rejects(repo.finalizeReportBatch(ba,{...batch,reports:[submissions[0],{...submissions[1],pdfUrl:'https://drive.google.com/file/d/forged/view'}]},now),{code:'evidence_scope_mismatch'});
    assert.equal((await pool.query('SELECT event_id FROM customer_events WHERE customer_id=$1',[bf.id])).rows.length,0);
    assert.equal((await pool.query('SELECT streak_count FROM customer_reward_state WHERE customer_id=$1',[bf.id])).rows[0].streak_count,2);
    const accepted=await repo.finalizeReportBatch(ba,batch,now);
    assert.equal(accepted.streak.streakCount,3);assert.equal(accepted.reports[0].scoutPoints,520);assert.equal(accepted.reports[0].enforcerPoints,1298);assert.equal(accepted.reports[1].enforcerPoints,674);
    // Both attempts may finish their reads while pending; only one may append.
    let entered=0,appends=0,release;
    const ready=new Promise(resolve=>{release=resolve;});
    const work=async(_value,options)=>{
      if(++entered===2) release();
      await ready;
      assert.equal(options.reconcileOnly,false);
      await options.beforeAppend();
      appends++;
      throw Error('Append response lost');
    };
    const attempts=await Promise.allSettled([repo.projectReport(ba,submissions[0].reportId,work),repo.projectReport(ba,submissions[0].reportId,work)]);
    assert.equal(appends,1);
    assert.equal(attempts.filter(result=>result.status==='rejected' && result.reason.code==='projection_uncertain').length,1);
    assert.equal(attempts.filter(result=>result.status==='rejected' && result.reason.message==='Append response lost').length,1);
    await repo.projectReport(ba,submissions[0].reportId,async(_value,options)=>{assert.equal(options.reconcileOnly,true);});
    assert.deepEqual(await repo.finalizeReportBatch(ba,batch,now+86400000),accepted);
    assert.equal((await pool.query('SELECT event_id FROM customer_events WHERE customer_id=$1',[bf.id])).rows.length,2);
    await assert.rejects(repo.finalizeReportBatch(ba,{...batch,batchId:'new-batch-id'},now),{code:'report_already_accepted'});
    await assert.rejects(repo.finalizeReportBatch(ba,{...batch,reports:[submissions[0]]},now),{code:'batch_conflict'});
    await assert.rejects(repo.finalizeReportBatch(foreign,batch,now),{code:'report_required'});
    // A cached admin actor cannot replay or persist enforcement after downgrade.
    await pool.query("UPDATE customer_memberships SET role='employee' WHERE member_id=$1",[ba.memberId]);
    await assert.rejects(repo.finalizeReportBatch(ba,batch,now),{code:'access_changed'});
    await assert.rejects(repo.finalizeReportBatch(ba,{...batch,batchId:'after-downgrade'},now),{code:'access_changed'});
    await assert.rejects(repo.recordEvent(ba,{customer_id:bf.id,user_id:ba.memberId,event_id:'after-downgrade',event_type:'report.submitted',occurred_at:now,attributes:{mode:'enforcer',urls:['https://tiktok.com/@pirate/video/1']}},now),{code:'access_changed'});
    const downgraded=await repo.requireActiveMember(bf.identity);
    await assert.rejects(repo.finalizeReportBatch(downgraded,batch,now),{code:'not_authorized'});
    await assert.rejects(repo.finalizeReportBatch(downgraded,{...batch,batchId:'after-downgrade'},now),{code:'not_authorized'});
    await pool.query("UPDATE customer_memberships SET role='admin' WHERE member_id=$1",[ba.memberId]);
    await pool.query("UPDATE customer_memberships SET platforms=ARRAY['youtube'] WHERE member_id=$1",[ba.memberId]);
    await assert.rejects(repo.finalizeReportBatch(ba,batch,now),{code:'scope_mismatch'});
  });
  await t.test('scanner reservations deduplicate observations, survive retry and isolate customer awards',async()=>{
    const rowKey=crypto.createHash('sha256').update('scanner-row').digest('hex');
    const urls=['https://youtube.com/watch?v=scanner-one','https://youtube.com/watch?v=scanner-two'];
    await repo.recordScannerResolutions(actor,rowKey,[...urls,urls[0]]);
    await repo.recordScannerResolutions(actor,rowKey,urls);
    assert.equal(await repo.reserveScannerBonus(foreign,rowKey),null);
    const [first,retry]=await Promise.all([repo.reserveScannerBonus(actor,rowKey),repo.reserveScannerBonus(actor,rowKey)]);
    assert.deepEqual(first,retry);assert.equal(first.points,30);
    await repo.recordScannerResolutions(actor,rowKey,['https://youtube.com/watch?v=scanner-three']);
    assert.deepEqual(await repo.reserveScannerBonus(actor,rowKey),first);
    await Promise.all([repo.completeScannerBonus(actor,rowKey,first.awardId,2),repo.completeScannerBonus(actor,rowKey,first.awardId,2)]);
    const second=await repo.reserveScannerBonus(actor,rowKey);
    assert.equal(second.points,15);assert.notEqual(second.awardId,first.awardId);
    await repo.completeScannerBonus(actor,rowKey,second.awardId,2);
    await repo.completeScannerBonus(actor,rowKey,second.awardId,2);
    assert.equal(await repo.reserveScannerBonus(actor,rowKey),null);
    await repo.recordScannerResolutions(actor,rowKey,urls);
    assert.equal(await repo.reserveScannerBonus(actor,rowKey),null);
    const rows=(await pool.query("SELECT attributes FROM customer_events WHERE customer_id=$1 AND attributes->>'provenance'='server_reward'",[f.id])).rows;
    assert.equal(rows.length,2);assert.equal(rows.reduce((sum,row)=>sum+row.attributes.enforcer_points,0),45);
    assert.ok(rows.every(row=>row.attributes.reason==='operator_observed_resolution'));
    await repo.recordScannerResolutions(actor,rowKey,['https://youtube.com/watch?v=scanner-four']);
    await pool.query("UPDATE customer_memberships SET platforms=ARRAY['tiktok'] WHERE member_id=$1",[actor.memberId]);
    await assert.rejects(repo.reserveScannerBonus(actor,rowKey),{code:'scope_mismatch'});
    await pool.query("UPDATE customer_memberships SET platforms=ARRAY['youtube','tiktok'] WHERE member_id=$1",[actor.memberId]);
  });
  await t.test('platform revocation is rechecked inside the transaction and observation scores are ignored',async()=>{
    await repo.recordEvent(actor,{...event,event_id:'observation',event_type:'automation.row_status_changed',attributes:{row_index:2,enforcer_points:999999}},Date.now());
    const row=(await pool.query('SELECT attributes FROM customer_events WHERE customer_id=$1 AND event_id=$2',[f.id,'observation'])).rows[0];
    assert.equal(row.attributes.enforcer_points,undefined);assert.equal(row.attributes.provenance,'operator_observation');
    await pool.query("UPDATE customer_memberships SET platforms=ARRAY['tiktok'] WHERE member_id=$1",[actor.memberId]);
    await assert.rejects(repo.generateReport(actor,{...report,reportId:'now-forbidden'},render,policy),{code:'scope_mismatch'});
    await assert.rejects(repo.recordEvent(actor,{...event,event_id:'now-forbidden'},Date.now()),{code:'scope_mismatch'});
    await assert.rejects(repo.queryStatistics(actor,'scoreboard',{dashboard_id:actor.customerConfig.stats.dashboardId,platforms:['youtube']},Date.now()),{code:'scope_mismatch'});
  });
});
