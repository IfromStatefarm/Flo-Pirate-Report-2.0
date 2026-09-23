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
  const event={customer_id:f.id,user_id:actor.memberId,event_id:report.eventId,event_type:'report.submitted',occurred_at:Date.now()-100000,attributes:{report_id:report.reportId,platform:'youtube',urls:[report.items[0].url],url_count:9999,scout_points:999999,enforcer_points:999999,pdf_url:'https://drive.google.com/file/d/pdf-one/view'}};
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
  await t.test('uncertain projection reconciles without granting permission to append twice',async()=>{
    let attempts=0;
    await assert.rejects(repo.projectReport(actor,report.reportId,async(value,options)=>{attempts++;assert.equal(options.reconcileOnly,false);assert.equal(value.attributes.url_count,1);throw Error('Response lost after append');}),/Response lost/);
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
    await assert.rejects(repo.runIntegrationOperation(actor,uncertain,async()=>{throw Error('Provider timeout');}),/Provider timeout/);
    await assert.rejects(repo.runIntegrationOperation(actor,uncertain,work),{code:'operation_uncertain'});assert.equal(calls,1);
  });
  await t.test('whole-batch rewards use accepted manifests, roll back on failure and replay without new credit',async()=>{
    const bf=await teamFixture(pool),ba=await repo.requireActiveMember(bf.identity);
    const now=Date.now(),yesterday=new Date(now-86400000).toISOString().slice(0,10);
    await pool.query('INSERT INTO customer_reward_state(customer_id,user_id,last_report_date,streak_count,freezes) VALUES($1,$2,$3,2,0)',[bf.id,ba.memberId,yesterday]);
    const submissions=[];
    for(let group=0;group<2;group++) {
      const report={reportId:`batch-report-${group}`,eventId:`batch-event-${group}`,eventName:'Batch Final',vertical:'Sports',handle:`pirate${group}`,items:Array.from({length:26},(_,i)=>({url:`https://tiktok.com/@pirate${group}/video/${i}`,views:'10',screenshotLink:''}))};
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
    assert.deepEqual(await repo.finalizeReportBatch(ba,batch,now+86400000),accepted);
    assert.equal((await pool.query('SELECT event_id FROM customer_events WHERE customer_id=$1',[bf.id])).rows.length,2);
    await assert.rejects(repo.finalizeReportBatch(ba,{...batch,batchId:'new-batch-id'},now),{code:'report_already_accepted'});
    await assert.rejects(repo.finalizeReportBatch(ba,{...batch,reports:[submissions[0]]},now),{code:'batch_conflict'});
    await assert.rejects(repo.finalizeReportBatch(foreign,batch,now),{code:'report_required'});
    await pool.query("UPDATE customer_memberships SET platforms=ARRAY['youtube'] WHERE member_id=$1",[ba.memberId]);
    await assert.rejects(repo.finalizeReportBatch(ba,batch,now),{code:'scope_mismatch'});
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
