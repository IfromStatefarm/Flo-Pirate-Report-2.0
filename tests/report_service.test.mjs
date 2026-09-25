import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePDF,finalizeReportBatch} from '../services/report_service.js';
import {CUSTOMER_ACCESS_PROFILE_CACHE_KEY} from '../utils/access_control.js';

test('report transport binds observations and batch receipts to the unchanged account',async t=>{
  const original=globalThis.chrome;t.after(()=>{globalThis.chrome=original;});
  const scope={customerId:'customer-a',userId:'user-a'};
  let profile={...scope},body,response,afterToken=()=>{};
  globalThis.chrome={runtime:{getURL:path=>`chrome-extension://test/${path}`},storage:{local:{get:async()=>({[CUSTOMER_ACCESS_PROFILE_CACHE_KEY]:profile})}}};
  const options={tokenProvider:async()=>{afterToken();return 'test-token';},fetchImpl:async(url,init)=>{
    if(url.startsWith('chrome-extension:'))return Response.json({dataEndpoint:'https://api.example.test/data'});
    assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
    body=JSON.parse(init.body);return Response.json(response);
  }};
  response={...scope,reportId:'r1',pdf:Buffer.from('%PDF-fixture').toString('base64')};
  const data={reportId:'r1',dataScope:{...scope,eventId:'e1'},items:[{url:'https://youtube.com/watch?v=one',views:'100K',contentType:'Live',scoutScore:999999}]};
  await generatePDF(data,options);
  assert.deepEqual(body.report.items[0],{url:data.items[0].url,screenshotLink:'',views:'100K',contentType:'Live'});
  const reports=[{reportId:'r1',eventId:'e1',pdfUrl:'https://drive.google.com/file/d/one',mode:'enforcer',contentType:'Live'}];
  response={...scope,batchId:'b1',reports:[{reportId:'r1',eventId:'e1'}],streak:{lastReportDate:'2026-09-22',streakCount:3,freezes:1}};
  assert.deepEqual(await finalizeReportBatch(scope,'b1',reports,options),response);
  response={...response,reports:[{reportId:'other',eventId:'e1'}]};
  await assert.rejects(finalizeReportBatch(scope,'b1',reports,options),/does not match/);
  response={...response,customerId:'other'};
  await assert.rejects(finalizeReportBatch(scope,'b1',reports,options),/signed-in customer/);
  afterToken=()=>{profile={customerId:'other',userId:'other'};};body=null;
  await assert.rejects(generatePDF(data,options),/account changed/);
  assert.equal(body,null);
});
