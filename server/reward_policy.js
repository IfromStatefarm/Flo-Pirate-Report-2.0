// Reward rules are based on accepted server work, never browser counters.
// UTC reporting days preserve the existing Flo extension's ISO-date behavior.
export function advanceReportingStreak(previous, acceptedAt) {
  const today=new Date(acceptedAt).toISOString().slice(0,10);
  const yesterday=new Date(acceptedAt-86400000).toISOString().slice(0,10);
  const lastDate=previous?.lastReportDate || null;
  let streakCount=Number(previous?.streakCount || 0),freezes=Number(previous?.freezes || 0);
  if(lastDate===today) return {lastReportDate:today,streakCount,freezes};
  if(lastDate===yesterday) streakCount+=1;
  else if(freezes>0) {freezes-=1;streakCount+=1;}
  else streakCount=1;
  if(streakCount>0 && streakCount%5===0) freezes+=1;
  return {lastReportDate:today,streakCount,freezes};
}

export function reportReward({itemCount,batchSize=itemCount,multiplier=1,streakCount=1}) {
  if(!Number.isSafeInteger(itemCount)||itemCount<1||itemCount>100||!Number.isSafeInteger(batchSize)||batchSize<itemCount||batchSize>100||![1,2].includes(multiplier)||!Number.isSafeInteger(streakCount)||streakCount<1) throw new Error('Invalid authoritative reward context.');
  return {
    scoutPoints:itemCount*10*multiplier,
    enforcerPoints:Math.floor(itemCount*20*multiplier*(batchSize>50?1.2:1))+(streakCount>=3?50:0),
    scoringVersion:2
  };
}
