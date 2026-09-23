import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceReportingStreak,reportReward} from '../server/reward_policy.js';
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
test('server reward formula preserves Flo base, Double XP, 50-item threshold and streak bonuses',()=>{
  assert.deepEqual(reportReward({itemCount:3}),{scoutPoints:30,enforcerPoints:60,scoringVersion:2});
  assert.equal(reportReward({itemCount:3,multiplier:2,streakCount:3}).enforcerPoints,170);
  assert.equal(reportReward({itemCount:3,batchSize:50}).enforcerPoints,60);
  assert.equal(reportReward({itemCount:3,batchSize:51}).enforcerPoints,72);
  assert.equal(reportReward({itemCount:26,batchSize:52,multiplier:2,streakCount:3}).enforcerPoints,1298);
  for(const context of [{itemCount:0},{itemCount:101},{itemCount:2,batchSize:1},{itemCount:1,multiplier:100},{itemCount:1,streakCount:-1}])assert.throws(()=>reportReward(context));
});
