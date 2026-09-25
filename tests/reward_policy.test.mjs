import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceReportingStreak,observedViews,reportReward} from '../server/reward_policy.js';
import {newlyStruckUrls,scannerRowKey} from '../server/scanner_rewards.js';
const day=value=>Date.parse(`${value}T12:00:00Z`);
test('server streak matches daily increments, freezes, resets and fifth-day awards',()=>{
  let state=advanceReportingStreak(null,day('2026-09-01'));
  assert.deepEqual(state,{lastReportDate:'2026-09-01',streakCount:1,freezes:0});
  assert.deepEqual(advanceReportingStreak(state,day('2026-09-01')),state);
  for(let date=2;date<=5;date++)state=advanceReportingStreak(state,day(`2026-09-0${date}`));
  assert.deepEqual(state,{lastReportDate:'2026-09-05',streakCount:5,freezes:1});
  assert.deepEqual(advanceReportingStreak(state,day('2026-09-05')),state);
  state=advanceReportingStreak(state,day('2026-09-08'));
  assert.deepEqual(state,{lastReportDate:'2026-09-08',streakCount:6,freezes:0});
  assert.deepEqual(advanceReportingStreak(state,day('2026-09-10')),{lastReportDate:'2026-09-10',streakCount:1,freezes:0});
});
test('Flo scout view and live bonuses come from stored observations, never claimed scores',()=>{
  const item=(views,contentType='VOD')=>({url:'https://youtube.com/watch?v=one',views,contentType,scoutScore:999999});
  for(const [views,expected] of [['9,999',10],['10K',20],['99.9k views',20],['100,000',50],['1.2M',50],['N/A',10],['-100',10]]) {
    assert.equal(reportReward({itemCount:1,items:[item(views)]}).scoutPoints,expected);
    assert.equal(reportReward({itemCount:1,items:[item(views,'Live')],multiplier:2}).scoutPoints,expected*4);
  }
  assert.equal(reportReward({itemCount:1,items:[{...item('10'),url:'https://youtube.com/live/one'}]}).scoutPoints,20);
  assert.equal(observedViews('9999999999999'),1000000000);
  assert.equal(observedViews('invalid 100K'),0);
});
test('scanner rewards count only newly struck distinct URLs in a stable scoped row',()=>{
  const one='https://youtube.com/watch?v=one',two='https://youtube.com/watch?v=two';
  const text=`${one}\n${two}`,second=one.length+1;
  const current={text,formatRuns:[{startIndex:0,format:{strikethrough:true}},{startIndex:second,format:{strikethrough:false}}],cellStrikethrough:false};
  const next=[{startIndex:0,format:{strikethrough:true}}];
  assert.deepEqual(newlyStruckUrls(current,next),[two]);
  assert.deepEqual(newlyStruckUrls({...current,formatRuns:next},next),[]);
  assert.deepEqual(newlyStruckUrls({...current,cellStrikethrough:true},next),[]);
  assert.notEqual(scannerRowKey('tenant-a-sheet',1,text),scannerRowKey('tenant-b-sheet',1,text));
  assert.notEqual(scannerRowKey('tenant-a-sheet',1,text),scannerRowKey('tenant-a-sheet',2,text));
});
test('server reward formula preserves Flo base, Double XP, 50-item threshold and streak bonuses',()=>{
  assert.deepEqual(reportReward({itemCount:3}),{scoutPoints:30,enforcerPoints:60,scoringVersion:2});
  assert.equal(reportReward({itemCount:3,multiplier:2,streakCount:3}).enforcerPoints,170);
  assert.equal(reportReward({itemCount:3,batchSize:50}).enforcerPoints,60);
  assert.equal(reportReward({itemCount:3,batchSize:51}).enforcerPoints,72);
  assert.equal(reportReward({itemCount:26,batchSize:52,multiplier:2,streakCount:3}).enforcerPoints,1298);
  for(const context of [{itemCount:0},{itemCount:101},{itemCount:2,batchSize:1},{itemCount:1,multiplier:100},{itemCount:1,streakCount:-1}])assert.throws(()=>reportReward(context));
});
