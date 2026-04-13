import { getAuthToken } from './auth.js';

const WHITELIST_TAB = 'Handles White List';
const TARGET_TAB_NAME = 'Report Submissions and status'; // Explicitly target your tab

// --- HELPER: SAFE FETCH ---
// This catches HTML 400/404/500 pages from Google and throws a readable error
// instead of letting `.json()` crash with "Unexpected token '<'".
async function safeFetchJson(url, options, retries = 5, delay = 1000) {
    const res = await fetch(url, options);

    // Exponential backoff for 429 Too Many Requests
    if (res.status === 429 && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        return safeFetchJson(url, options, retries - 1, delay * 2);
    }

    const text = await res.text();
    
    if (!res.ok) {
        if (res.status === 401) {
            throw new Error("Your session expired! Click my 'Check Account' button to get back in the hunt.");
        }
        let parsedMsg = text;
        try {
            const jsonObj = JSON.parse(text);
            parsedMsg = jsonObj.error ? jsonObj.error.message : JSON.stringify(jsonObj);
        } catch(e) {
            // It's an HTML error page. Truncate it so it doesn't flood the logs.
            parsedMsg = text.substring(0, 150).replace(/\n/g, ' ') + '...';
        }
        
        // Extract just the endpoint name for cleaner error reading in the UI
        const endpoint = url.split('?')[0].split('/').pop();
        throw new Error(`Google API Error (${res.status} on ${endpoint}): ${parsedMsg}`);
    }
    
    try {
        return JSON.parse(text);
    } catch(e) {
        throw new Error(`Invalid JSON response from Google API.`);
    }
}

// --- HELPER: GET USER OPTIONS ---
const getOptions = async () => {
  const data = await chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id']);
  return {
    // We strictly trim here so if you accidentally pasted a space in the options page, 
    // it won't break the Google API URL format and cause an HTML 400 response.
    driveRootId: data.piracy_folder_id?.trim(),
    reportSheetId: data.piracy_sheet_id?.trim(),
    eventSheetId: data.event_sheet_id?.trim()
  };
};

// --- HELPER: GET SPECIFIC TAB INFO ---
async function getTargetSheetInfo(token, spreadsheetId) {
    const metaData = await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    
    let sheetId = 0;
    let sheetName = TARGET_TAB_NAME;

    if (metaData.sheets) {
        // Look for the specific tab (ignoring case and whitespace)
        const targetSheet = metaData.sheets.find(s => 
            s.properties.title.trim().toLowerCase() === TARGET_TAB_NAME.trim().toLowerCase()
        );
        if (targetSheet) {
            sheetId = targetSheet.properties.sheetId;
            sheetName = targetSheet.properties.title;
        } else {
            // Fallback to first sheet if the specific one isn't found
            sheetId = metaData.sheets[0].properties.sheetId;
            sheetName = metaData.sheets[0].properties.title;
        }
    }
    return { sheetId, sheetName };
}

// --- HELPER: VALIDATE CONFIG ---
export async function isConfigComplete() {
    const { driveRootId, reportSheetId, eventSheetId } = await getOptions();
    return !!(driveRootId && reportSheetId && eventSheetId);
}

// --- HELPER: ROGUE DOMAIN NORMALIZATION & LOGGING ---
export function normalizeRogueDomain(urlStr) {
  try {
    const url = new URL(urlStr);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    return urlStr || "unknown_domain";
  }
}

// Helper to convert index to Sheets column letters (e.g. 0->A, 26->AA)
function getColLetter(index) {
  let letter = '';
  while (index >= 0) {
    letter = String.fromCharCode((index % 26) + 65) + letter;
    index = Math.floor(index / 26) - 1;
  }
  return letter;
}

export async function logRogueToSheet(token, data, userNotes) {
  const { eventSheetId } = await getOptions();
  const tabName = 'Pirate Websites';
  const domain = normalizeRogueDomain(data.url);
  
  // 1. Fetch Row 1 to find if Domain Column already exists
  const headerData = await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/'${tabName}'!1:1`, { headers: { Authorization: `Bearer ${token}` } });
  const headers = headerData.values ? headerData.values[0] : [];
  
  // Case-insensitive search to ensure we match correctly (e.g., "Timstreams.net" === "timstreams.net")
  let targetColIdx = headers.findIndex(h => h && h.trim().toLowerCase() === domain);
  
  // 2. Create new Column-Pair if Domain is new (ensuring it starts on an odd index like B(1), D(3), F(5)...)
  if (targetColIdx === -1) {
    targetColIdx = headers.length % 2 !== 0 ? headers.length : headers.length + 1;
    
    // Write Row 1 (Domain) and Row 2 (Sub-headers) for the brand new site
    await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/'${tabName}'!${getColLetter(targetColIdx)}1:${getColLetter(targetColIdx + 1)}2?valueInputOption=USER_ENTERED`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
          values: [
              [domain, ""],
              ["Video links", "Notes"]
          ] 
      })
    });
  }

  // 3. Find the first empty row strictly within this column pair
  const colData = await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/'${tabName}'!${getColLetter(targetColIdx)}:${getColLetter(targetColIdx + 1)}`, { headers: { Authorization: `Bearer ${token}` } });
  
  // Calculate the next row, ensuring it always starts at Row 3 (below the sub-headers)
  let nextRow = (colData.values ? colData.values.length : 0) + 1;
  if (nextRow < 3) nextRow = 3;

  const scrapedInfo = `URL: ${data.url}\nIframes:\n${data.iframes?.join('\n') || 'None'}\nVideos:\n${data.videos?.join('\n') || 'None'}`;
  
  // 4. Append scraped details (Odd Col) and user notes (Even Col)
  await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/'${tabName}'!${getColLetter(targetColIdx)}${nextRow}:${getColLetter(targetColIdx + 1)}${nextRow}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[scrapedInfo, userNotes || ""]] })
  });
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
  const data = await safeFetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
  
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
  
  const range = `'${vertical}'!A1:I`; 
  const fields = "sheets(data(rowData(values(userEnteredValue,formattedValue,effectiveFormat(textFormat(strikethrough))))))";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=${encodeURIComponent(fields)}`;
  
  const data = await safeFetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
  const rowData = data.sheets?.[0]?.data?.[0]?.rowData || [];
  
  if (rowData.length < 1) {
    return { searchUrl: null, eventMap: {} };
  }

  // Row 1, Col B is the search URL (index 1)
  const searchUrl = rowData[0]?.values?.[1]?.formattedValue || rowData[0]?.values?.[1]?.userEnteredValue?.stringValue || null;
  const eventRows = rowData.length > 2 ? rowData.slice(2) : []; 

  const eventMap = {};
  eventRows.forEach((row, index) => {
    const cells = row.values || [];
    
    // Safely extract text and strikethrough status
    const getCellStr = (colIdx) => cells[colIdx]?.formattedValue || cells[colIdx]?.userEnteredValue?.stringValue || null;
    const isStruck = (colIdx) => cells[colIdx]?.effectiveFormat?.textFormat?.strikethrough === true;

    const eventName = getCellStr(0);
    if (eventName) {
      const originalName = eventName.trim();
      const cleanName = originalName.toLowerCase(); 
      eventMap[cleanName] = {
        name: originalName,
        rowIndex: index + 3,
        urls: {
            tiktok:    isStruck(1) ? null : getCellStr(1),
            instagram: isStruck(2) ? null : getCellStr(2),
            youtube:   isStruck(3) ? null : getCellStr(3),
            twitter:   isStruck(4) ? null : getCellStr(4),
            twitch:    isStruck(5) ? null : getCellStr(5),
            facebook:  isStruck(6) ? null : getCellStr(6),
            discord:   isStruck(7) ? null : getCellStr(7),
            rumble:    isStruck(8) ? null : getCellStr(8)
        }
      };
    }
  });

  return { searchUrl, eventMap };
}

export function getColumnLetter(platform) {
  const map = {
    'tiktok': 'B', 'instagram': 'C', 'youtube': 'D', 'twitter': 'E', 'x': 'E',
    'twitch': 'F', 'facebook': 'G', 'discord': 'H', 'rumble': 'I', 'other': 'J'
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

  const range = `'${WHITELIST_TAB}'!B2:I`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/${encodeURIComponent(range)}`;

  try {
    const data = await safeFetchJson(url, { headers: { Authorization: `Bearer ${token}` } });

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
  const range = `'${vertical}'!${colLetter}${rowIndex}`;
  const body = { values: [[newUrl]] };
  
  await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export async function addNewEventToSheet(vertical, eventName, eventUrl, platform = 'tiktok') {
  const token = await getAuthToken();
  const { eventSheetId } = await getOptions();
  const range = `'${vertical}'!A:A`; // Forces the append API to find the next empty row based strictly on Column A where event names are, ensuring no gaps if URLs are missing in other columns. The API will append to the first empty row in Column A, which is where we put event names.
  
  const row = new Array(9).fill(""); 
  row[0] = eventName;

  const colMap = {
    'tiktok': 1, 'instagram': 2, 'youtube': 3, 'twitter': 4, 
    'twitch': 5, 'facebook': 6, 'discord': 7, 'rumble': 8
  };
  
  const targetIndex = colMap[platform?.toLowerCase()] || 1;
  row[targetIndex] = eventUrl;

  const body = { values: [row] };

  await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// ==========================================
// 2. DRIVE & FOLDER MANAGEMENT
// ==========================================

export async function ensureRogueScreenshotFolder(token) {
  const { driveRootId } = await getOptions();
  if (!driveRootId) throw new Error("Drive Root ID not configured.");
  
  const currentYear = new Date().getFullYear();
  return await findOrCreateFolder(token, driveRootId, `${currentYear} 3rd party pirate screen shots`);
}

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

async function findOrCreateFolder(token, parentId, name) {
  const query = `mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and name='${name}' and trashed=false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`;
  const data = await safeFetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
  if (data.files && data.files.length > 0) return data.files[0].id;
  
  const d = await safeFetchJson('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
  });
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
  
  const data = await safeFetchJson('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form
  });
  
  // Fetch folder link for the sheet log
  const folderData = await safeFetchJson(`https://www.googleapis.com/drive/v3/files/${folderId}?fields=webViewLink`, {
     headers: { Authorization: `Bearer ${token}` }
  });
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
  const data = await safeFetchJson(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
     headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!data.files || data.files.length === 0) {
    throw new Error("Config file not found. Folder appears empty or inaccessible.");
  }

  const fileId = data.files[0].id;
  return await safeFetchJson(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}
/**
 * Patches the config file using etags to prevent race conditions.
 */
export async function patchConfigSelector(platform, section, field, newSelector, actionType, retryCount = 0) {
    const { driveRootId } = await getOptions();
    if (!driveRootId) throw new Error("Drive Root ID is missing in Options.");
    
    // Force fresh token to prevent 401s/hangs if SW idled during the recording phase
    let cachedToken = await getAuthToken();
    await new Promise(resolve => chrome.identity.removeCachedAuthToken({ token: cachedToken }, resolve));
    const token = await getAuthToken();
    
    // 1. Find the events_config.json file
    const query = `'${driveRootId}' in parents and name='events_config.json' and trashed=false`;
    const searchData = await safeFetchJson(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    
    if (!searchData.files || searchData.files.length === 0) {
        throw new Error("Config file not found in Drive.");
    }
    const fileId = searchData.files[0].id;

    // 2. Download the current JSON content and capture the ETag
    const getRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (!getRes.ok) throw new Error(`Failed to fetch config: ${getRes.statusText}`);
    
    const currentConfig = await getRes.json();
    const currentEtag = getRes.headers.get('ETag');

    // 3. Patch the JSON with the new selector using the provided section (e.g., 'autofill' or 'scraper')
    if (!currentConfig.platform_selectors) currentConfig.platform_selectors = {};
    if (!currentConfig.platform_selectors[platform]) currentConfig.platform_selectors[platform] = {};
    if (!currentConfig.platform_selectors[platform][section]) currentConfig.platform_selectors[platform][section] = {};

    const existing = currentConfig.platform_selectors[platform][section][field];
    const newEntry = actionType ? { "selector": newSelector, "action": actionType } : newSelector;
    
    // If it's already an array, prepend and prune
    if (Array.isArray(existing)) {
        const isDuplicate = existing.some(item => (item.selector || item) === newSelector);
        if (!isDuplicate) {
            existing.unshift(newEntry);
            // Limit to the 5 most recent selectors to prevent array bloat
            if (existing.length > 5) existing.length = 5; 
        }
    } else if (existing && (existing.selector || existing) !== newSelector) {
        // Convert existing string to an array, preserving both with the new one first
        currentConfig.platform_selectors[platform][section][field] = [newEntry, existing];
    } else {
        // Otherwise overwrite the string
        currentConfig.platform_selectors[platform][section][field] = newEntry;
    }

    // 4. Update with If-Match header to ensure no one else modified it in the meantime
    try {
        const url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`;
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 
                Authorization: `Bearer ${token}`, 
                'Content-Type': 'application/json',
                'If-Match': currentEtag
            },
            body: JSON.stringify(currentConfig, null, 2)
        });

        if (res.status === 412) { // Precondition Failed: Someone else updated the file
            if (retryCount < 5) {
                const delay = Math.pow(2, retryCount) * 1000;
                await new Promise(r => setTimeout(r, delay));
                return await patchConfigSelector(platform, section, field, newSelector, retryCount + 1);
            }
            throw new Error("Conflict: Config was updated by another user. Please try again.");
        }

        if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`);
        return currentConfig;
    } catch (error) {
        console.error("Patch error:", error);
        throw error;
    }
}

/**
 * Appends a row and automatically formats URLs in Column H as hyperlinks.
 */
export async function appendToSheet(token, logData) {
  const { reportSheetId } = await getOptions();
  const { sheetName } = await getTargetSheetInfo(token, reportSheetId);
  
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
        logData.scoutedBy || logData.reporterName || "Unknown",
        logData.enforcedBy || logData.reporterName || "Unknown",
      ]];
  }

  const range = `'${sheetName}'!A1`;
  const appendData = await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });

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
  const { sheetId } = await getTargetSheetInfo(token, reportSheetId);

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
      
      // Reset formatting immediately after the link ONLY if it's not the very end of the string
      const endIndex = match.index + match[0].length;
      if (endIndex < urlString.length) {
          textFormatRuns.push({
              startIndex: endIndex,
              format: { link: null, foregroundColor: { red: 0, green: 0, blue: 0 }, underline: false }
          });
      }
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

  await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
  });
}

export async function setColumnKRichText(rowIndex, channelUrl, handle, pdfUrl) {
  const { reportSheetId } = await getOptions();
  const token = await getAuthToken();
  const { sheetId } = await getTargetSheetInfo(token, reportSheetId);

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

  return await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
  });
}

// ==========================================
// 5. FETCH RIGHTS PDF
// ==========================================

export async function fetchRightsPdf(token, eventName) {
  const fileName = `${eventName} Rights.pdf`;
  const query = `name = '${fileName}' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`;
  
  const searchData = await safeFetchJson(searchUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!searchData.files || searchData.files.length === 0) {
    console.warn(`Rights file not found in Drive: ${fileName}`);
    return null;
  }

  const fileId = searchData.files[0].id;
  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  
  // This uses a raw fetch because we need the blob, not JSON
  const fileRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` }
  });
  
  if (!fileRes.ok) return null;
  
  const blob = await fileRes.blob();
  return { blob, name: fileName };
}

// ==========================================
// 6. THE CLOSER: STATUS UPDATE
// ==========================================

export async function getColumnHDataWithFormatting() {
  const { reportSheetId } = await getOptions();
  if (!reportSheetId) throw new Error("Report Sheet ID not configured in Options.");
  
  const token = await getAuthToken();
  const { sheetName } = await getTargetSheetInfo(token, reportSheetId);

  // Fetch specific range with grid data for styling evaluation
  const range = `'${sheetName}'!H:H`;
  
  // ADDED 'startRow' to fields so we know if Google skipped leading blank rows
  const fields = "sheets(data(startRow,rowData(values(userEnteredValue,formattedValue,textFormatRuns,userEnteredFormat,effectiveFormat))))";
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=${encodeURIComponent(fields)}`;

  const data = await safeFetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
  
  const gridData = data.sheets?.[0]?.data?.[0];
  const startRow = gridData?.startRow || 0;
  const rowData = gridData?.rowData || [];
  
  // Create an array that accurately represents the absolute row indices
  // by filling empty placeholders up to the startRow where data actually begins.
  const emptyPad = new Array(startRow).fill({ text: "", formatRuns: [], cellStrikethrough: false });
  
  const mappedRows = rowData.map(row => {
      const cell = row.values?.[0];
      if (!cell) return { text: "", formatRuns: [], cellStrikethrough: false };
      
      const text = cell.formattedValue || cell.userEnteredValue?.stringValue || "";
      const formatRuns = cell.textFormatRuns || [];
      
      // Catch if the ENTIRE cell has base formatting applied to it
      const cellStrikethrough = cell.userEnteredFormat?.textFormat?.strikethrough || cell.effectiveFormat?.textFormat?.strikethrough || false;
      
      return { text, formatRuns, cellStrikethrough };
  });

  return emptyPad.concat(mappedRows);
}

export async function getColumnHData() {
  const { reportSheetId } = await getOptions();
  if (!reportSheetId) return [];
  const token = await getAuthToken();
  const { sheetName } = await getTargetSheetInfo(token, reportSheetId);

  const range = `'${sheetName}'!H:H`; 
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}/values/${encodeURIComponent(range)}`;
  
  const data = await safeFetchJson(url, { headers: { Authorization: `Bearer ${token}` } });
  return data.values || [];
}

export async function updateRowStatus(rowIndex, status) {
  const { reportSheetId } = await getOptions();
  const token = await getAuthToken();
  const { sheetName } = await getTargetSheetInfo(token, reportSheetId);

  const range = `'${sheetName}'!J${rowIndex + 1}`; 
  const valueBody = { values: [[status]] };
  
  await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(valueBody)
  });

  if (status === "Resolved") {
      await formatCellAsTakenDown(rowIndex);
  }
}
// --- THE CLOSER: ADD ENFORCER BONUS POINTS ---
export async function addEnforcerBonusPoints(rowIndex, bonusPoints) {
    const { reportSheetId } = await getOptions();
    const token = await getAuthToken();
    const { sheetName } = await getTargetSheetInfo(token, reportSheetId);
    
    // Fetch current Enforcer Points (Column O / Index 14) and append the bonus
    const range = `'${sheetName}'!O${rowIndex + 1}`;
    const cellData = await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${token}` } });
    
    const currentScore = parseInt(cellData.values?.[0]?.[0]) || 0;
    await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[currentScore + bonusPoints]] })
    });
}

export async function formatCellAsTakenDown(rowIndex) {
  const { reportSheetId } = await getOptions();
  const token = await getAuthToken();
  const { sheetId } = await getTargetSheetInfo(token, reportSheetId);

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

  await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
  });
}

export async function updateCellWithRichText(rowIndex, cellValue, textFormatRuns) {
  const { reportSheetId } = await getOptions();
  const token = await getAuthToken();
  const { sheetId } = await getTargetSheetInfo(token, reportSheetId);

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

  await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
  });
}

// ==========================================
// 7. BULK CART MANAGER (Double Tap Helper)
// ==========================================
export async function bulkAddToCart(items) {
    const storage = await chrome.storage.local.get('piracy_cart');
    let cart = storage.piracy_cart || [];
    
    // Add new items and deduplicate by URL to prevent double-reporting
    cart = [...cart, ...items];
    const uniqueCart = Array.from(new Map(cart.map(item => [item.url, item])).values());
    
    await chrome.storage.local.set({ 'piracy_cart': uniqueCart });
    return uniqueCart.length;
}
// ==========================================
// 8. GAMIFICATION & LEADERBOARD (WEEKLY RESET)
// ==========================================
export async function fetchLeaderboardData(userEmail) {
    const { reportSheetId } = await getOptions();
    if (!reportSheetId) return null;
    
    const token = await getAuthToken();
    const { sheetName } = await getTargetSheetInfo(token, reportSheetId);

    const range = `'${sheetName}'!A:O`;
    const data = await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}/values/${encodeURIComponent(range)}`, { headers: { Authorization: `Bearer ${token}` } });
    
    const rows = data.values || [];
    if (rows.length < 2) return { scoutPoints: 0, enforcerPoints: 0, leaderboard: [], rank: "Rookie Spotter" };

    // Get Last Sunday Midnight Central Time
    const ctDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
    ctDate.setDate(ctDate.getDate() - ctDate.getDay());
    ctDate.setHours(0, 0, 0, 0);

    const scoutScores = {};
    const enforcerScores = {};
    const overallScores = {};

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue;
        
        // Only count rows that occurred on or after the most recent Sunday
        if (new Date(row[0]) >= ctDate) {
            let scout = (row[6] || "").trim().toLowerCase();     // Column G (Index 6)
            let enforcer = (row[12] || "").trim().toLowerCase(); // Column M (Index 12)
            
            scout = scout.replace(/@flosports\.tv/g, '').replace(/\./g, ' ');
            enforcer = enforcer.replace(/@flosports\.tv/g, '').replace(/\./g, ' ');
            
            const sPts = parseInt(row[13]) || 0; // Col N (Scout Points)
            const ePts = parseInt(row[14]) || 0; // Col O (Enforcer Points)

            if (scout) {
                scoutScores[scout] = (scoutScores[scout] || 0) + sPts;
                overallScores[scout] = (overallScores[scout] || 0) + sPts;
            }
            if (enforcer) {
                enforcerScores[enforcer] = (enforcerScores[enforcer] || 0) + ePts;
                overallScores[enforcer] = (overallScores[enforcer] || 0) + ePts;
            }
        }
    }

    let emailLower = userEmail.toLowerCase();
    emailLower = emailLower.replace(/@flosports\.tv/g, '').replace(/\./g, ' ');
    const myStats = { s: scoutScores[emailLower] || 0, e: enforcerScores[emailLower] || 0 };
    
    let scoutRank = "Deckhand";
    if (myStats.s > 500) scoutRank = "Captain";
    else if (myStats.s > 100) scoutRank = "First Mate";

    let enforcerRank = "Privateer";
    if (myStats.e > 500) enforcerRank = "Davy's Hand";
    else if (myStats.e > 100) enforcerRank = "Plank Master";

    // --- BETA TESTER PERK (PIONEER BADGE) ---
    const { beta_opt_in } = await chrome.storage.sync.get('beta_opt_in');
    if (beta_opt_in) {
        scoutRank = `🚀 Pioneer ${scoutRank}`;
        enforcerRank = `🚀 Pioneer ${enforcerRank}`;
    }

    const sortDesc = (obj) => Object.keys(obj).map(n => ({ name: n, points: obj[n] })).sort((a, b) => b.points - a.points);
    const topScouts = sortDesc(scoutScores).slice(0, 5);
    const topEnforcers = sortDesc(enforcerScores).slice(0, 5);
    const overallLeaderboard = sortDesc(overallScores);
    
    const mvp = overallLeaderboard.length > 0 ? overallLeaderboard[0] : null;
    const teamTotal = Object.values(enforcerScores).reduce((sum, pts) => sum + Math.floor(pts / 20), 0);

    return { scoutPoints: myStats.s, enforcerPoints: myStats.e, topScouts, topEnforcers, overallLeaderboard, scoutRank, enforcerRank, mvp, teamTotal };
}

export async function submitSuggestionToSheet(token, text, userEmail) {
    const { eventSheetId } = await getOptions();
    if (!eventSheetId) throw new Error("Event Sheet ID not configured in Options.");

    const now = new Date().toLocaleString("en-US");
    // Values: Date, User, Suggestion/Bug Text
    const values = [[now, userEmail, text]];
    const range = `'Suggestions'!A1`;

    return await safeFetchJson(`https://sheets.googleapis.com/v4/spreadsheets/${eventSheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values })
    });
}