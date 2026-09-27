import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleAdapter } from '../server/integrations/google_adapter.js';

const report={reportId:'report-one',createdAt:'2026-09-26T12:00:00Z',reporterName:'Operator',email:'operator@example.test',attributes:{urls:['https://youtube.com/watch?v=one'],vertical:'Sports',source_event_name:'Final',platform:'youtube',content_type:'VOD',pdf_url:'https://drive.google.com/file/d/pdf-one/view',scout_points:10,enforcer_points:20}};

function fixture(failure) {
  let status='pending',claims=0,metadataReads=0,appendRequests=0,formatted=0;
  const rows=[];
  const fail=phase=>{
    if(failure===phase) { failure=null; throw Error(`Failed at ${phase}`); }
  };
  const phaseFor=(url,options)=>url.includes(':append?')?'append':url.endsWith(':batchUpdate')?'format':options.method==='PUT'?'header':url.includes('/values/')?'ids':'metadata';
  const adapter=createGoogleAdapter({token:'test',integrations:{reportSpreadsheetId:'report-sheet'},resourceGuard:{authorizeRequest:async(url,options)=>{
    if(phaseFor(url,options)==='append') fail('authorize-append');
  }},fetchImpl:async(url,options)=>{
    const phase=phaseFor(url,options);
    if(phase==='metadata') {
      metadataReads++;
      fail(metadataReads===2?'append-metadata':'metadata');
      return Response.json({sheets:[{properties:{title:'Report Submissions and status',sheetId:1}}]});
    }
    if(phase==='ids') { fail('ids'); return Response.json({values:rows}); }
    if(phase==='header') { rows[0]=['Rights Reporter ID']; fail('header'); return Response.json({}); }
    if(phase==='append') {
      assert.equal(status,'uncertain','claim must be durable before dispatch');
      appendRequests++;
      fail('append-before-commit');
      rows.push([JSON.parse(options.body).values[0][22]]);
      fail('append-after-commit');
      return Response.json({updates:{updatedRange:"'Report Submissions and status'!A2:W2"}});
    }
    if(phase==='format') { fail('format'); formatted++; return Response.json({}); }
    throw Error(`Unexpected request: ${url}`);
  }});
  const project=async()=>{
    if(status==='completed') return;
    await adapter.projectReport(report,{reconcileOnly:status==='uncertain',beforeAppend:async()=>{
      assert.equal(status,'pending');
      fail('claim');
      status='uncertain';claims++;
    }});
    status='completed';
  };
  return {project,rows,state:()=>({status,claims,appendRequests,formatted})};
}

for(const phase of ['metadata','ids','header','append-metadata','authorize-append','claim']) {
  test(`projection retries ${phase} failure without an uncertain append`,async()=>{
    const f=fixture(phase);
    await assert.rejects(f.project(),new RegExp(`Failed at ${phase}`));
    assert.deepEqual(f.state(),{status:'pending',claims:0,appendRequests:0,formatted:0});
    await f.project();
    assert.deepEqual(f.state(),{status:'completed',claims:1,appendRequests:1,formatted:1});
    assert.deepEqual(f.rows,[['Rights Reporter ID'],[report.reportId]]);
  });
}

for(const phase of ['append-after-commit','format']) {
  test(`projection reconciles ${phase} failure without appending again`,async()=>{
    const f=fixture(phase);
    await assert.rejects(f.project(),new RegExp(`Failed at ${phase}`));
    assert.deepEqual(f.state(),{status:'uncertain',claims:1,appendRequests:1,formatted:0});
    await f.project();
    await f.project();
    assert.deepEqual(f.state(),{status:'completed',claims:1,appendRequests:1,formatted:1});
  });
}

test('an ambiguous append with no visible row still requires reconciliation',async()=>{
  const f=fixture('append-before-commit');
  await assert.rejects(f.project(),/Failed at append-before-commit/);
  await assert.rejects(f.project(),/previous append is uncertain/);
  assert.deepEqual(f.state(),{status:'uncertain',claims:1,appendRequests:1,formatted:0});
});
