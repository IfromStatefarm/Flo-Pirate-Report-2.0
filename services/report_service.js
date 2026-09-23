import { CUSTOMER_ACCESS_PROFILE_CACHE_KEY } from '../utils/access_control.js';
import { getAuthToken } from '../utils/auth.js';

async function sendReportCommand(body,scope,{fetchImpl=fetch,tokenProvider=getAuthToken}={}) {
  const settingsResponse=await fetchImpl(chrome.runtime.getURL('config/customer_bootstrap.json'),{cache:'no-store'});
  if(!settingsResponse.ok) throw new Error('Report API configuration could not be loaded.');
  const settings=await settingsResponse.json();
  const endpoint=new URL(settings.dataEndpoint || new URL('data',settings.bootstrapEndpoint));
  if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Report API endpoint is invalid.');
  const sameScope=async()=>{
    const profile=(await chrome.storage.local.get(CUSTOMER_ACCESS_PROFILE_CACHE_KEY))[CUSTOMER_ACCESS_PROFILE_CACHE_KEY];
    if(!scope?.customerId || !scope?.userId || profile?.customerId!==scope.customerId || profile?.userId!==scope.userId) throw new Error('The account changed during reporting.');
  };
  await sameScope();
  const token=await tokenProvider({interactive:false});
  await sameScope();
  const response=await fetchImpl(endpoint.href,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(60000),body:JSON.stringify(body)});
  const text=await response.text();
  if(text.length>8*1024*1024) throw new Error('The report response is oversized.');
  let envelope;try{envelope=JSON.parse(text);}catch{throw new Error('The report service returned invalid JSON.');}
  if(!response.ok) throw new Error(envelope?.error?.message || 'The licensed report service is unavailable.');
  await sameScope();
  if(envelope.customerId!==scope.customerId || envelope.userId!==scope.userId) throw new Error('Report response did not match the signed-in customer.');
  return envelope;
}

export async function generatePDF(data,options) {
  const report={reportId:String(data.reportId),eventId:data.dataScope?.eventId,eventName:String(data.eventName||'Unknown Event'),vertical:String(data.vertical||'General'),handle:String(data.handle||''),items:data.items.map(item=>({url:String(item.url),screenshotLink:item.screenshotLink==='No Screenshot Available'?'':String(item.screenshotLink||''),views:String(item.views||'N/A')}))};
  const envelope=await sendReportCommand({protocol_version:1,operation:'generate_report',report},data.dataScope,options);
  if(envelope.reportId!==report.reportId || typeof envelope.pdf!=='string' || envelope.pdf.length>6*1024*1024) throw new Error('The generated report response is invalid.');
  const bytes=Uint8Array.from(atob(envelope.pdf),char=>char.charCodeAt(0));
  if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-') throw new Error('The server did not return a PDF.');
  return new Blob([bytes],{type:'application/pdf'});
}

export async function finalizeReportBatch(scope,batchId,reports,options) {
  const envelope=await sendReportCommand({protocol_version:1,operation:'finalize_report_batch',batch:{batchId,reports}},scope,options);
  if(envelope.batchId!==batchId || !Array.isArray(envelope.reports) || envelope.reports.length!==reports.length || envelope.reports.some((receipt,index)=>receipt.reportId!==reports[index].reportId || receipt.eventId!==reports[index].eventId)) throw new Error('The accepted batch does not match the prepared reports.');
  if(!Number.isSafeInteger(envelope.streak?.streakCount) || !Number.isSafeInteger(envelope.streak?.freezes) || !/^\d{4}-\d\d-\d\d$/.test(envelope.streak?.lastReportDate||'')) throw new Error('The report reward state is invalid.');
  return envelope;
}
