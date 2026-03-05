import { getAuthToken } from './auth.js';

// REMOVED: Hardcoded EVENT_SHEET_ID
const WHITELIST_TAB = 'Handles White List';

// --- HELPER: GET USER OPTIONS ---
const getOptions = async () => {
  const data = await chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id']);
  return {
    driveRootId: data.piracy_folder_id,
    reportSheetId: data.piracy_sheet_id,
    eventSheetId: data.event_sheet_id
  };
};

// --- HELPER: VALIDATE CONFIG ---
export async function isConfigComplete() {
    const { driveRootId, reportSheetId, eventSheetId } = await getOptions();
    return !!(driveRootId && reportSheetId && eventSheetId);
}

// --- HELPER: CLEAN HANDLES FOR COMPARISON ---
function normalizeHandle(input) {
  if (!input) return "";
  let clean = input.toString().toLowerCase().trim();
  clean = clean.replace(/^(https?:\/\/)?(www\.)?/, "");
  clean = clean.replace(/^(tiktok\.com\/|instagram\.com\/|twitter\.com\/|x\.com\/|youtube\.com\/|facebook\.com\/)/, "");
  clean = clean.replace(/^@/, "").replace(/\/$/, "");
  return clean;
}

// --- HELPER: FIND FILE BY NAME ---
export async function findFileId(name, mimeType, parentId = null) {
  const token = await getAuthToken();
  let query = `name = '${name}' and trashed = false`;
  if (mimeType) query += ` and mimeType = '${mimeType}'`;
  if (parentId) query += ` and '${parentId}' in parents`;

  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  
  if (data.files && data.files.length > 0) return data.files[0].id;
  return null;
}

// ==========================================
// 1. EVENT URL MANAGER (Dynamic Search)
// ==========================================

export async function getEventData(vertical) {
  const token = await getAuthToken();
  const { eventSheetId } = await getOptions();
  
  if (!eventSheetId) throw new Error("Event Sheet ID not configured.");
  
  const range = `${vertical}!A1:I`; 
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/${range}`;
  
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  
  if (!data.values || data.values.length < 1) {
    return { searchUrl: null, eventMap: {} };
  }

  const searchUrl = (data.values[0] && data.values[0][1]) ? data.values[0][1] : null;
  const eventRows = data.values.length > 2 ? data.values.slice(2) : []; 

  const eventMap = {};
  eventRows.forEach((row, index) => {
    if (row[0]) {
      const originalName = row[0].trim();
      const cleanName = originalName.toLowerCase(); 
      eventMap[cleanName] = {
        name: originalName,
        rowIndex: index + 3,
        urls: {
            tiktok:    row[1] || null,
            instagram: row[2] || null,
            youtube:   row[3] || null,
            twitter:   row[4] || null,
            twitch:    row[5] || null,
            facebook:  row[6] || null,
            discord:   row[7] || null,
            rumble:    row[8] || null
        }
      };
    }
  });

  return { searchUrl, eventMap };
}

function getColumnLetter(platform) {
  const map = {
    'tiktok': 'B', 'instagram': 'C', 'youtube': 'D', 'twitter': 'E',
    'twitch': 'F', 'facebook': 'G', 'discord': 'H', 'rumble': 'I'
  };
  return map[platform?.toLowerCase()] || 'B'; 
}

export async function checkIfAuthorized(platform, handle) {
  if (!handle) return false;
  const token = await getAuthToken();
  const { eventSheetId } = await getOptions();
  
  if (!eventSheetId) return false;

  const platformIndexMap = {
    'tiktok': 0, 'instagram': 1, 'twitter': 2, 'x': 2, 'discord': 3,
    'youtube': 4, 'facebook': 5, 'reddit': 6, 'rumble': 7     
  };
  const targetIndex = platformIndexMap[platform?.toLowerCase()];
  
  if (targetIndex === undefined) return false;

  const range = `${WHITELIST_TAB}!B2:I`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/${range}`;

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();

    if (!data.values || data.values.length === 0) return false;

    const targetHandle = normalizeHandle(handle);
    return data.values.some(row => {
      if (row.length <= targetIndex) return false;
      const rawCellValue = row[targetIndex];
      const normalizedCell = normalizeHandle(rawCellValue);
      return normalizedCell === targetHandle;
    });

  } catch (e) {
    console.error("❌ Error checking whitelist:", e);
    return false;
  }
}

export async function updateEventUrl(vertical, rowIndex, newUrl, platform = 'tiktok') {
  const token = await getAuthToken();
  const { eventSheetId } = await getOptions();
  const colLetter = getColumnLetter(platform);
  const range = `${vertical}!${colLetter}${rowIndex}`;
  const body = { values: [[newUrl]] };
  
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function addNewEventToSheet(vertical, eventName, eventUrl, platform = 'tiktok') {
  const token = await getAuthToken();
  const { eventSheetId } = await getOptions();
  const range = `${vertical}!A:I`; 
  
  const row = new Array(9).fill(""); 
  row[0] = eventName;

  const colMap = {
    'tiktok': 1, 'instagram': 2, 'youtube': 3, 'twitter': 4, 
    'twitch': 5, 'facebook': 6, 'discord': 7, 'rumble': 8
  };
  
  const targetIndex = colMap[platform?.toLowerCase()] || 1;
  row[targetIndex] = eventUrl;

  const body = { values: [row] };

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/${range}:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// ==========================================
// 2. DRIVE & FOLDER MANAGEMENT
// ==========================================

export async function ensureYearlyReportFolder(token, year) {
  const { driveRootId } = await getOptions();
  if (!driveRootId) throw new Error("Drive Root ID not configured.");
  
  const folderName = `Pirated Reports for ${year}`;
  return await findOrCreateFolder(token, driveRootId, folderName);
}

export async function ensureDailyScreenshotFolder(token, dateStr) {
  const { driveRootId } = await getOptions();
  if (!driveRootId) throw new Error("Drive Root ID not configured.");

  const masterScreenshotFolderId = await findOrCreateFolder(token, driveRootId, "All Screenshots");
  const dailyFolderId = await findOrCreateFolder(token, masterScreenshotFolderId, dateStr);
  return dailyFolderId;
}

export async function ensureFolderHierarchy(token, eventName, date) {
  const { driveRootId } = await getOptions();
  if (!driveRootId) throw new Error("Drive Root ID not configured.");
  
  const eventFolderId = await findOrCreateFolder(token, driveRootId, eventName);
  return await findOrCreateFolder(token, eventFolderId, date);
}

async function findOrCreateFolder(token, parentId, name) {
  const query = `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and name='${name}' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (data.files && data.files.length > 0) return data.files[0].id;
  
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
  });
  const d = await createRes.json();
  return d.id;
}

// ==========================================
// 3. FILE UPLOAD LOGIC
// ==========================================

export async function uploadToDrive(token, folderId, name, blob, mimeType) {
  const metadata = { name: name, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form
  });
  const data = await res.json();
  
  // Fetch folder link for the sheet log
  const folderRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=webViewLink`, {
     headers: { Authorization: `Bearer ${token}` }
  });
  const folderData = await folderRes.json();
  return { ...data, folderWebViewLink: folderData.webViewLink };
}

// ==========================================
// 4. CONFIG & REPORT LOGGING
// ==========================================

export async function fetchConfig() {
  const { driveRootId } = await getOptions();
  if (!driveRootId) throw new Error("Drive Root ID is missing in Options.");

  const token = await getAuthToken();
  
  const query = `'${driveRootId}' in parents and name='events_config.json' and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
     headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  
  if (!data.files || data.files.length === 0) {
    throw new Error("Config file not found. Folder appears empty or inaccessible.");
  }

  const fileId = data.files[0].id;
  const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return await contentRes.json();
}

/**
 * Appends a row and automatically formats URLs in Column H as hyperlinks.
 */
export async function appendToSheet(token, logData) {
  const { reportSheetId } = await getOptions();
  
  let values;

  // Supports both explicit row array (used by batch report) and object (fallback)
  if (logData.values && Array.isArray(logData.values)) {
      values = [logData.values];
  } 
  else {
      const now = new Date();
      values = [[
        now.toLocaleDateString(),
        logData.vertical || "Unknown",
        logData.eventName || "Unknown",
        "TikTok", 
        "VOD",
        "N/A",
        logData.reporterName || "Unknown",
        logData.urls || "",
        "DMCA takedown request",
        "Reported",
        "",
        logData.reporterName || "Unknown",
      ]];
  }

  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}/values/A1:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  
  const appendData = await response.json();

  // --- AUTOMATED HYPERLINKING FOR COLUMN H ---
  const updatedRange = appendData?.updates?.updatedRange;
  if (updatedRange) {
      const rangeMatch = updatedRange.match(/\d+/);
      if (rangeMatch) {
          const rowIndex = parseInt(rangeMatch[0], 10) - 1; // 0-based index
          const urlString = values[0][7] || ""; // Column H is index 7
          if (urlString) {
              await setColumnHLinks(token, rowIndex, urlString);
          }
      }
  }
  
  return appendData;
}

/**
 * Scans Column H text and turns every individual URL into a clickable link pointing to itself.
 */
async function setColumnHLinks(token, rowIndex, urlString) {
  const { reportSheetId } = await getOptions();
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${token}` }
  });
  const metaData = await metaRes.json();
  const sheetId = metaData.sheets?.[0]?.properties?.sheetId || 0;

  const urlRegex = /https?:\/\/[^\s,]+/g;
  let match;
  const textFormatRuns = [];

  while ((match = urlRegex.exec(urlString)) !== null) {
      textFormatRuns.push({
          startIndex: match.index,
          format: {
              link: { uri: match[0] },
              foregroundColor: { red: 0.066, green: 0.33, blue: 0.8 },
              underline: true
          }
      });
      // Reset formatting immediately after the link
      textFormatRuns.push({
          startIndex: match.index + match[0].length,
          format: { link: null, foregroundColor: { red: 0, green: 0, blue: 0 }, underline: false }
      });
  }

  if (textFormatRuns.length === 0) return;

  const requests = [{
      updateCells: {
          rows: [{
              values: [{
                  userEnteredValue: { stringValue: urlString },
                  textFormatRuns: textFormatRuns
              }]
          }],
          range: {
              sheetId: sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 7, // Column H index
              endColumnIndex: 8
          },
          fields: "userEnteredValue,textFormatRuns"
      }
  }];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
  });
}

export async function setColumnKRichText(rowIndex, channelUrl, handle, pdfUrl) {
  const { reportSheetId } = await getOptions();
  const token = await getAuthToken();
  
  // 1. Get the Sheet ID dynamically (usually 0 for the first tab)
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${token}` }
  });
  const metaData = await metaRes.json();
  const sheetId = metaData.sheets && metaData.sheets.length > 0 ? metaData.sheets[0].properties.sheetId : 0;

  // 2. Format the display strings
  const line1 = `Channel: @${handle}`;
  const line2 = `PDF Report`;
  const fullText = `${line1}\n${line2}`;
  
  const line1Len = line1.length;

  // 3. Construct the BatchUpdate request
  // We use textFormatRuns to assign DIFFERENT links to DIFFERENT parts of the same cell
  const requests = [{
      updateCells: {
          rows: [{
              values: [{
                  userEnteredValue: { stringValue: fullText },
                  textFormatRuns: [
                      { 
                        startIndex: 0, 
                        format: { link: { uri: channelUrl }, foregroundColor: { red: 0.066, green: 0.33, blue: 0.8 }, underline: true } 
                      },
                      { 
                        startIndex: line1Len, 
                        format: { link: null, foregroundColor: { red: 0, green: 0, blue: 0 }, underline: false } 
                      },
                      { 
                        startIndex: line1Len + 1, 
                        format: { link: { uri: pdfUrl }, foregroundColor: { red: 0.066, green: 0.33, blue: 0.8 }, underline: true } 
                      }
                  ]
              }]
          }],
          range: {
              sheetId: sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 10, // Column K index (0-based)
              endColumnIndex: 11
          },
          fields: "userEnteredValue,textFormatRuns"
      }
  }];

  console.log(`🚀 Forcing link update for row ${rowIndex + 1} in Column K`);

  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
  });

  return await response.json();
}

// ==========================================
// 5. FETCH RIGHTS PDF
// ==========================================

export async function fetchRightsPdf(token, eventName) {
  const fileName = `${eventName} Rights.pdf`;
  const query = `name = '${fileName}' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`;
  
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const searchData = await searchRes.json();

  if (!searchData.files || searchData.files.length === 0) {
    console.warn(`Rights file not found in Drive: ${fileName}`);
    return null;
  }

  const fileId = searchData.files[0].id;
  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  
  const fileRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  const blob = await fileRes.blob();
  return { blob, name: fileName };
}

// ==========================================
// 6. THE CLOSER: STATUS UPDATE
// ==========================================

export async function getColumnHData() {
  const { reportSheetId } = await getOptions();
  if (!reportSheetId) return [];
  const token = await getAuthToken();
  const range = "H:H"; 
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}/values/${range}`;
  
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data.values || [];
}

export async function updateRowStatus(rowIndex, status) {
  const { reportSheetId } = await getOptions();
  const token = await getAuthToken();

  const range = `J${rowIndex + 1}`; 
  const valueBody = { values: [[status]] };
  
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(valueBody)
  });

  if (status === "Resolved") {
      await formatCellAsTakenDown(rowIndex);
  }
}

export async function formatCellAsTakenDown(rowIndex) {
  const { reportSheetId } = await getOptions();
  const token = await getAuthToken();
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${token}` }
  });
  const metaData = await metaRes.json();
  const sheetId = metaData.sheets && metaData.sheets.length > 0 ? metaData.sheets[0].properties.sheetId : 0;

  const requests = [{
      repeatCell: {
          range: {
              sheetId: sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 7, 
              endColumnIndex: 8
          },
          cell: {
              userEnteredFormat: {
                  textFormat: {
                      strikethrough: true,
                      foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 }
                  }
              }
          },
          fields: "userEnteredFormat(textFormat)"
      }
  }];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
  });
}

export async function updateCellWithRichText(rowIndex, cellValue, textFormatRuns) {
  const { reportSheetId } = await getOptions();
  const token = await getAuthToken();
  const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}?fields=sheets.properties`, {
      headers: { Authorization: `Bearer ${token}` }
  });
  const metaData = await metaRes.json();
  const sheetId = metaData.sheets && metaData.sheets.length > 0 ? metaData.sheets[0].properties.sheetId : 0;

  const requests = [{
      updateCells: {
          rows: [{
              values: [{
                  userEnteredValue: { stringValue: cellValue },
                  textFormatRuns: textFormatRuns
              }]
          }],
          range: {
              sheetId: sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 7, 
              endColumnIndex: 8
          },
          fields: "userEnteredValue,textFormatRuns"
      }
  }];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
  });
}