import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPostgresRepository } from '../server/postgres_repository.js';
import { createCustomerApiService } from '../server/customer_api_service.js';
import { handleCustomerApi } from '../server/http.js';
import { withCustomerTransaction } from '../server/tenant_transaction.js';
import { resolveInside } from '../server/customer_authorization.js';
import { migrateTeamTestDatabase, teamFixture } from './team_fixture.mjs';

const tenantTables = [
  'customers','customer_memberships','membership_audit','customer_events',
  'customer_provisioning_audit','customer_configuration_audit','customer_subscriptions',
  'subscription_audit','billing_order_links','generated_reports','team_change_requests',
  'customer_integration_resources','integration_operations','report_projection_jobs',
  'integration_uploaded_files','reported_targets','customer_reward_state','report_batches','scanner_resolutions'
].sort();
const sellerOnly = new Set(['customer_provisioning_audit','customer_configuration_audit','subscription_audit','billing_order_links']);
const report = {reportId:'same-report',eventId:'same-event',eventName:'Fixture',vertical:'Sports',handle:'fixture',items:[{url:'https://youtube.com/watch?v=one',screenshotLink:'',views:'1'}]};
const event = (actor, id='same-observation') => ({event_id:id,customer_id:actor.customerId,user_id:actor.memberId,event_type:'activity.item_added',occurred_at:Date.now(),attributes:{platform:'youtube',target_url:'https://youtube.com/watch?v=one'}});

test('tenant isolation: real HTTP service, restricted SQL role and two populated customers', {skip: !process.env.TEST_DATABASE_URL}, async t => {
  assert.equal(process.env.TEST_DATABASE_ISOLATED,'true');
  const pool = new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,max:1});
  t.after(()=>pool.end());
  await migrateTeamTestDatabase(pool);
  const repo=createPostgresRepository({pool});
  const fixtures=[await teamFixture(pool),await teamFixture(pool)];
  const actors=[];
  for(const f of fixtures) {
    const actor=await repo.requireActiveMember(f.identity); actors.push(actor);
    const id=actor.customerId, member=actor.memberId;
    await repo.recordEvent(actor,event(actor),Date.now());
    await repo.generateReport(actor,report,async()=>new Blob([`%PDF-private-${id}`],{type:'application/pdf'}),{version:1,platform:'youtube'});
    await repo.recordUploadedFile(actor,report.eventId,'image/png',{id:`file-${id}`,webViewLink:`https://drive.google.com/file/d/${id}/view`},'a'.repeat(64));
    await repo.runIntegrationOperation(actor,{name:'updateRowStatus',args:[1,'Resolved'],requestId:'same-operation'},async()=>({private:id}));
    await repo.recordScannerResolutions(actor,'a'.repeat(64),['https://youtube.com/watch?v=one']);
    await repo.teamOperation(f.identity,{operation:'team_preview',requestId:'same-preview',changes:[{action:'add',email:f.email('new'),name:'New',role:'employee'}]});
    await pool.query(`INSERT INTO membership_audit(audit_id,customer_id,actor_member_id,actor_email,target_member_id,action,before_state,after_state,occurred_at)
      VALUES($1,$2,$3,$4,$3,'fixture','{}','{}',now())`,[crypto.randomUUID(),id,member,actor.email]);
    await pool.query(`INSERT INTO customer_configuration_audit(audit_id,customer_id,action,operator_email,before_config_version,after_config_version,changed_fields,request_hash,before_state,after_state,occurred_at)
      VALUES($1,$2,'customer_updated','seller@example.test',1,2,'{}',$3,'{}','{}',now())`,[crypto.randomUUID(),id,'a'.repeat(64)]);
    await pool.query("INSERT INTO billing_order_links(provider,account_id,order_id,customer_id) VALUES('wix','tenant-test',$1,$1)",[id]);
    await pool.query('INSERT INTO report_projection_jobs(customer_id,report_id) VALUES($1,$2)',[id,report.reportId]);
    await pool.query("INSERT INTO customer_events(customer_id,event_id,user_id,event_type,occurred_at,attributes,payload_hash) VALUES($1,$2,$3,'report.submitted',now(),$4,$5)",
      [id,report.eventId,member,{platform:'youtube',urls:[`https://youtube.com/watch?v=${id}`],url_count:1,scout_points:10,source_event_name:id},'b'.repeat(64)]);
    await pool.query('INSERT INTO reported_targets(customer_id,work_key,target_key,report_id) VALUES($1,$2,$2,$3)',[id,'a'.repeat(64),report.reportId]);
    await pool.query('INSERT INTO customer_reward_state(customer_id,user_id,last_report_date,streak_count,freezes) VALUES($1,$2,current_date,1,0)',[id,member]);
    await pool.query("INSERT INTO report_batches(customer_id,batch_id,user_id,request_hash,result) VALUES($1,'same-batch',$2,$3,$4)",[id,member,'a'.repeat(64),{private:id}]);
  }
  const [a,b]=actors;
  const scoped=(work,identity=fixtures[0].identity)=>withCustomerTransaction(async client=>{
    await resolveInside(client,identity); return work(client);
  },{pool});

  await t.test('every tenant table has forced RLS; runtime cannot bypass or inherit control-plane authority',async()=>{
    const tables=(await pool.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='customer_id') ORDER BY c.relname`)).rows;
    assert.deepEqual(tables.map(r=>r.relname),tenantTables,'New tenant tables require policies and test coverage');
    assert(tables.every(r=>r.relrowsecurity && r.relforcerowsecurity));
    const role=(await pool.query("SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname='rr_customer_runtime'")).rows[0];
    assert(Object.values(role).every(v=>v===false));
    assert.equal((await pool.query("SELECT 1 FROM pg_auth_members WHERE member='rr_customer_runtime'::regrole")).rowCount,0);
  });

  await t.test('unscoped SELECTs see only the current customer, and seller data remains inaccessible',async()=>{
    for(const table of tenantTables) {
      for(const actor of actors) assert((await pool.query(`SELECT 1 FROM ${table} WHERE customer_id=$1`,[actor.customerId])).rowCount>0,`${table} needs both fixtures`);
      if(sellerOnly.has(table)) {
        await assert.rejects(scoped(client=>client.query(`SELECT * FROM ${table}`)),{code:'42501'});
      } else {
        const rows=await scoped(client=>client.query(`SELECT customer_id FROM ${table}`));
        assert(rows.rowCount>0,`${table} positive control`);
        assert(rows.rows.every(r=>r.customer_id===a.customerId),`${table} leaked another tenant`);
        assert.equal((await scoped(client=>client.query(`SELECT * FROM ${table} WHERE customer_id=$1`,[b.customerId]))).rowCount,0);
      }
    }
    for(const table of ['billing_events','billing_plan_mappings','schema_migrations']) {
      await assert.rejects(scoped(client=>client.query(`SELECT * FROM ${table}`)),{code:'42501'});
    }
  });

  await t.test('missing scope denies reads; pooled commits, rollbacks and concurrent requests never retain scope',async()=>{
    const empty=()=>withCustomerTransaction(client=>client.query('SELECT * FROM customer_events'),{pool});
    assert.equal((await empty()).rowCount,0);
    await scoped(async client=>{ assert.equal((await client.query('SELECT current_user AS role')).rows[0].role,'rr_customer_runtime'); });
    assert.equal((await empty()).rowCount,0);
    await assert.rejects(scoped(()=>{throw Error('force rollback');}),/force rollback/);
    assert.equal((await empty()).rowCount,0);
    const results=await Promise.all(Array.from({length:8},(_,i)=>scoped(client=>client.query('SELECT customer_id FROM customer_events'),fixtures[i%2].identity)));
    results.forEach((r,i)=>assert(r.rows.every(row=>row.customer_id===actors[i%2].customerId)));
  });

  await t.test('a separate unprivileged login passes deployment preflight and can resolve only its authenticated tenant',async()=>{
    const role='rr_test_'+crypto.randomUUID().replaceAll('-','');
    const password=crypto.randomBytes(32).toString('hex');
    // Identifiers and password here are generated hex, never request input.
    await pool.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
    await pool.query(`GRANT rr_customer_runtime TO ${role}`);
    const connection=new URL(process.env.TEST_DATABASE_URL); connection.username=role; connection.password=password;
    const restricted=new pg.Pool({connectionString:connection.href,max:1});
    try {
      const result=await promisify(execFile)(process.execPath,['server/scripts/tenant_isolation_preflight.mjs'],{env:{...process.env,CUSTOMER_DATABASE_URL:connection.href}});
      assert.match(result.stdout,/preflight passed/);
      const restrictedRepo=createPostgresRepository({pool:restricted});
      assert.equal((await restrictedRepo.requireActiveMember(fixtures[0].identity)).customerId,a.customerId);
      assert.equal((await restricted.query('SELECT * FROM customer_events')).rowCount,0);
      await assert.rejects(restricted.query('SELECT * FROM billing_events'),{code:'42501'});
    } finally { await restricted.end(); await pool.query(`DROP ROLE ${role}`); }
  });

  await t.test('unscoped updates cannot modify foreign rows; forged writes, cross-tenant references, deletes and DDL fail',async()=>{
    const changed=await scoped(client=>client.query("UPDATE customer_events SET source='isolation-test' RETURNING customer_id"));
    assert(changed.rowCount>0 && changed.rows.every(row=>row.customer_id===a.customerId));
    assert.equal((await pool.query('SELECT source FROM customer_events WHERE customer_id=$1',[b.customerId])).rows[0].source,'chrome_extension');
    await assert.rejects(scoped(client=>client.query("INSERT INTO customer_events(customer_id,event_id,user_id,event_type,occurred_at,attributes,payload_hash) VALUES($1,'foreign-write',$2,'activity.item_added',now(),'{}',$3)",[b.customerId,b.memberId,'a'.repeat(64)])),{code:'42501'});
    await assert.rejects(scoped(client=>client.query('UPDATE customer_events SET customer_id=$1',[b.customerId])),{code:'42501'});
    await assert.rejects(scoped(client=>client.query("INSERT INTO customer_events(customer_id,event_id,user_id,event_type,occurred_at,attributes,payload_hash) VALUES($1,'foreign-member',$2,'activity.item_added',now(),'{}',$3)",[a.customerId,b.memberId,'a'.repeat(64)])),{code:'23503'});
    await assert.rejects(scoped(client=>client.query("INSERT INTO membership_audit(audit_id,customer_id,actor_member_id,actor_email,target_member_id,action,before_state,after_state,occurred_at) VALUES($1,$2,$3,'test@example.test',$4,'fixture','{}','{}',now())",[crypto.randomUUID(),a.customerId,a.memberId,b.memberId])),{code:'23503'});
    for(const sql of ['DELETE FROM customer_events','TRUNCATE customer_events','ALTER TABLE customer_events DISABLE ROW LEVEL SECURITY',"UPDATE customers SET config='{}'",'SELECT * FROM rr_private.resolve_identity(NULL,NULL)']) {
      if(sql.startsWith('SELECT')) assert.equal((await scoped(client=>client.query(sql))).rowCount,0);
      else await assert.rejects(scoped(client=>client.query(sql)),{code:'42501'});
    }
  });

  const service=createCustomerApiService({repository:repo,verifyIdentity:async request=>{
    assert.equal(request.headers.get('authorization'),'Bearer customer-a'); return fixtures[0].identity;
  }});
  const call=async(route,body,suffix='')=>{
    const response=await handleCustomerApi(route,new Request(`https://api.example.test/v1/extension/${route}${suffix}`,{method:'POST',headers:{authorization:'Bearer customer-a','content-type':'application/json','x-customer-id':b.customerId},body:JSON.stringify(body)}),{service});
    assert.equal(response.headers.get('cache-control'),'no-store');
    return {status:response.status,body:await response.json()};
  };

  await t.test('raw HTTP ignores URL/header tenant selectors and derives omitted scope hints from identity',async()=>{
    const own=event(a,'no-supplied-scope'); delete own.customer_id; delete own.user_id;
    const accepted=await call('data',{protocol_version:1,operation:'record_event',event:own},`?customer_id=${b.customerId}&user_id=${b.memberId}`);
    assert.equal(accepted.status,200); assert.equal(accepted.body.customer_id,a.customerId);
    const forged=await call('data',{protocol_version:1,operation:'record_event',event:event(b,'denied')});
    assert.equal(forged.status,403);
    const stats=await call('data',{protocol_version:1,operation:'query_statistics',query_type:'intelligence',query:{dashboard_id:a.customerConfig.stats.dashboardId,start_date:new Date().toISOString().slice(0,10),end_date:new Date().toISOString().slice(0,10),platforms:[]}},`?customerId=${b.customerId}`);
    assert.equal(stats.status,200); assert.equal(stats.body.customer_id,a.customerId);
    assert(!JSON.stringify(stats.body).includes(b.customerId));
  });

  await t.test('upload folders must be server-issued within the customer scope',async()=>{
    await repo.requireUploadFolder(a,a.customerConfig.destinations.driveRootFolderId);
    const command={name:'ensureDailyScreenshotFolder',args:['2026-09-24'],requestId:'issued-folder'};
    await repo.runIntegrationOperation(b,command,async()=> 'foreign-folder');
    for(const folder of ['foreign-folder','missing-folder',b.customerConfig.destinations.driveRootFolderId]) {
      await assert.rejects(repo.requireUploadFolder(a,folder),{code:'scope_mismatch'});
    }
    await repo.runIntegrationOperation(a,command,async()=> 'own-folder');
    await repo.requireUploadFolder(a,'own-folder');
  });

  await t.test('foreign member IDs, reviews, report projections and evidence URLs are indistinguishable from missing ones',async()=>{
    const mutate=id=>call('memberships',{protocolVersion:1,operation:'mutate_membership',mutation:{action:'disable',memberId:id,expectedVersion:1}});
    assert.deepEqual(await mutate(b.memberId),await mutate('not-present'));
    const foreignPreview=await repo.teamOperation(fixtures[1].identity,{operation:'team_preview',requestId:'foreign-only-review',changes:[{action:'add',email:fixtures[1].email('other'),name:'Other',role:'employee'}]});
    const commit=id=>call('memberships',{protocolVersion:1,operation:'team_commit',requestId:id});
    assert.deepEqual(await commit(foreignPreview.requestId),await commit('not-present'));
    const denial=async work=>{try{await work();assert.fail('Must reject');}catch(e){return {status:e.status,code:e.code,message:e.message};}};
    await repo.generateReport(b,{...report,reportId:'foreign-only-report',eventId:'foreign-only-event'},async()=>new Blob(['%PDF-foreign'],{type:'application/pdf'}),{version:1,platform:'youtube'});
    const project=id=>denial(()=>repo.projectReport(a,id,()=>assert.fail('Foreign projection')));
    assert.deepEqual(await project('foreign-only-report'),await project('not-present'));
    const evidence=url=>denial(()=>repo.generateReport(a,{...report,reportId:'evidence-attempt',items:[{...report.items[0],screenshotLink:url}]},()=>assert.fail('Foreign evidence rendered'),{version:1,platform:'youtube'}));
    assert.deepEqual(await evidence(`https://drive.google.com/file/d/${b.customerId}/view`),await evidence('https://drive.google.com/file/d/missing/view'));
    const batch=id=>call('data',{protocol_version:1,operation:'finalize_report_batch',batch:{batchId:'attack-batch',reports:[{reportId:id,eventId:'foreign-only-event',pdfUrl:'https://drive.google.com/file/d/foreign/view',mode:'scout',contentType:'VOD'}]}});
    assert.deepEqual(await batch('foreign-only-report'),await batch('not-present'));
  });

  await t.test('tenant-local invitations cannot enumerate or redirect an already-bound foreign identity',async()=>{
    for(const email of [b.email,fixtures[0].email('unregistered')]) {
      const preview=await repo.teamOperation(fixtures[0].identity,{operation:'team_preview',requestId:crypto.randomUUID(),changes:[{action:'add',email,name:'Invited',role:'employee'}]});
      const result=await repo.teamOperation(fixtures[0].identity,{operation:'team_commit',requestId:preview.requestId});
      assert.equal(result.changed,1);
    }
    assert.equal((await repo.requireActiveMember(fixtures[1].identity)).customerId,b.customerId);
    await pool.query("UPDATE customer_memberships SET status='disabled' WHERE customer_id=$1 AND member_id=$2",[b.customerId,b.memberId]);
    await assert.rejects(repo.requireActiveMember(fixtures[1].identity),{code:'not_a_member'});
  });
});
