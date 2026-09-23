// Google operations are authorized and executed by the customer API.
// Legacy function signatures remain so Flo workflow callers can migrate gradually.
import { googleOperation, stableOperationId } from '../services/google_operation_service.js';
export const getEventData = (vertical) => googleOperation('getEventData',[vertical]);
export const checkIfAuthorized = (platform,handle) => googleOperation('checkIfAuthorized',[platform,handle]);
export const updateEventUrl = (vertical,row,url,platform='tiktok') => googleOperation('updateEventUrl',[vertical,row,url,platform]);
export const addNewEventToSheet = (vertical,event,url,platform='tiktok') => googleOperation('addNewEventToSheet',[vertical,event,url,platform]);
export const ensureRogueScreenshotFolder = () => googleOperation('ensureRogueScreenshotFolder',[]);
export const ensureYearlyReportFolder = (_token,year) => googleOperation('ensureYearlyReportFolder',[year]);
export const ensureDailyScreenshotFolder = (_token,date) => googleOperation('ensureDailyScreenshotFolder',[date]);
export const ensureBriefingFolder = () => googleOperation('ensureBriefingFolder',[]);
export const fetchConfig = () => googleOperation('fetchConfig',[]);
export const patchConfigSelector = (platform,section,field,selector,action) => googleOperation('patchConfigSelector',[platform,section,field,selector,action || null]);
export const updateConfigSections = (sections) => googleOperation('updateConfigSections',[sections]);
export const getColumnHDataWithFormatting = () => googleOperation('getColumnHDataWithFormatting',[]);
export const getRecommendedStartRow = () => googleOperation('getRecommendedStartRow',[]);
export const updateRowStatus = (row,status) => googleOperation('updateRowStatus',[row,status]);
export const updateCellWithRichText = (row,text,runs) => googleOperation('updateCellWithRichText',[row,text,runs]);
export const submitSuggestionToSheet = (_token,text) => googleOperation('submitSuggestionToSheet',[text]);
export const addEnforcerBonusPoints = (row) => googleOperation('addEnforcerBonusPoints',[row]);
export async function uploadToDrive(_token,folderId,name,blob,mimeType,scope) {
  const bytes=new Uint8Array(await blob.arrayBuffer());
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=32768) binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  const base64=btoa(binary);
  const requestId=await stableOperationId(scope?.customerId,scope?.userId,scope?.eventId,name,base64);
  return googleOperation('uploadToDrive',[folderId,name,base64,mimeType,scope?.eventId],{requestId,expectedScope:scope});
}
