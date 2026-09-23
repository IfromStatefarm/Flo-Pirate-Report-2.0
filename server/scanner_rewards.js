import crypto from 'node:crypto';
export function scannerRowKey(spreadsheetId,rowIndex,text) {
  return crypto.createHash('sha256').update(JSON.stringify([spreadsheetId,rowIndex,text])).digest('hex');
}
function struckAt(index,runs,base=false) {
  if(base) return true;
  let format;
  for(const run of runs || []) {if(run.startIndex>index)break;format=run.format;}
  return format?.strikethrough===true;
}
export function newlyStruckUrls(current,nextRuns) {
  return [...new Set([...current.text.matchAll(/https?:\/\/[^\s,]+/g)]
    .filter(match=>!struckAt(match.index,current.formatRuns,current.cellStrikethrough) && struckAt(match.index,nextRuns,current.cellStrikethrough))
    .map(match=>match[0]))];
}
