//google_api.js
import { getAuthToken } from './auth.js';

// --- CONSTANTS ---
const EVENT_SHEET_ID = '1K9QigjjGPexSIW3hsc2WQNjJvz9anT6_WfyTdPfiflE'; 

// --- HELPER: GET USER OPTIONS ---
const getOptions = () => {
  return chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id']).then(data => ({
    driveRootId: data.piracy_folder_id,
    reportSheetId: data.piracy_sheet_id
  }));
};

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

// READ: Fetches Search URL (Cell B1) and Platform Links (Columns A-H, Rows 3+)
export async function getEventData(vertical) {
  const token = await getAuthToken();
  
  // CHANGED: Range expanded from A1:B to A1:H to capture all 7 platforms
  const range = `${vertical}!A1:H`; 
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${EVENT_SHEET_ID}/values/${range}`;
  
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  
  if (!data.values || data.values.length < 1) {
    return { searchUrl: null, eventMap: {} };
  }

  // A. Get Search URL from Cell B1 (Preserves existing search functionality)
  const searchUrl = (data.values[0] && data.values[0][1]) ? data.values[0][1] : null;

  // B. Process Events starting at Row 3 (Index 2)
  // Rows 1 & 2 are headers/config. Data starts at Row 3.
  const eventRows = data.values.length > 2 ? data.values.slice(2) : []; 

  const eventMap = {};
  eventRows.forEach((row, index) => {
    if (row[0]) {
      const originalName = row[0].trim();
      const cleanName = originalName.toLowerCase(); 
      
      // MAPPING: Based on your request
      // Col A [0]: Event Name
      // Col B [1]: TikTok
      // Col C [2]: Instagram
      // Col D [3]: YouTube
      // Col E [4]: Twitter (X)
      // Col F [5]: Twitch
      // Col G [6]: Facebook
      // Col H [7]: Discord

      eventMap[cleanName] = {
        name: originalName,
        rowIndex: index + 3, // +3 because we skipped 2 header rows and index is 0-based
        urls: {
            tiktok:    row[1] || null,
            instagram: row[2] || null,
            youtube:   row[3] || null,
            twitter:   row[4] || null,
            twitch:    row[5] || null,
            facebook:  row[6] || null,
            discord:   row[7] || null
        }
      };
    }
  });

  return { searchUrl, eventMap };
}

// --- HELPER: Map Platform to Column Letter ---
function getColumnLetter(platform) {
  // A=Event, B=TikTok, C=Instagram, D=YouTube, E=Twitter, F=Twitch, G=Facebook, H=Discord
  const map = {
    'tiktok': 'B',
    'instagram': 'C',
    'youtube': 'D',
    'twitter': 'E',
    'twitch': 'F',
    'facebook': 'G',
    'discord': 'H'
  };
  // Default to B (TikTok) if platform is missing or typo
  return map[platform?.toLowerCase()] || 'B'; 
}

// UPDATE: Writes a URL to the specific column for that platform
export async function updateEventUrl(vertical, rowIndex, newUrl, platform = 'tiktok') {
  const token = await getAuthToken();
  const colLetter = getColumnLetter(platform);
  
  // Example Range: "FloGrappling!D5" (Update YouTube URL for Event on Row 5)
  const range = `${vertical}!${colLetter}${rowIndex}`;
  
  const body = { values: [[newUrl]] };
  
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${EVENT_SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// CREATE: Appends a new event, placing the URL in the correct column
export async function addNewEventToSheet(vertical, eventName, eventUrl, platform = 'tiktok') {
  const token = await getAuthToken();
  const range = `${vertical}!A:H`; // We are appending a row that spans A to H
  
  // Create an array of 8 items (Columns A-H)
  // [EventName, TikTok, Instagram, YouTube, Twitter, Twitch, Facebook, Discord]
  const row = new Array(8).fill(""); 
  row[0] = eventName; // Col A is always Event Name

  // Map platform to array index (0-based)
  // A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7
  const colMap = {
    'tiktok': 1, 'instagram': 2, 'youtube': 3, 'twitter': 4, 
    'twitch': 5, 'facebook': 6, 'discord': 7
  };
  
  const targetIndex = colMap[platform?.toLowerCase()] || 1;
  row[targetIndex] = eventUrl;

  const body = { values: [row] };

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${EVENT_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// --- NEW: Handle Centralized Screenshot Folders ---
export async function ensureDailyScreenshotFolder(token, dateStr) {
  const { driveRootId } = await getOptions();
  if (!driveRootId) throw new Error("Drive Root ID not configured.");

  const masterScreenshotFolderId = await findOrCreateFolder(token, driveRootId, "All Screenshots");
  const dailyFolderId = await findOrCreateFolder(token, masterScreenshotFolderId, dateStr);
  return dailyFolderId;
}

// ==========================================
// 2. DRIVE & FOLDER MANAGEMENT
// ==========================================

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
  console.log(`🕵️ Looking in Folder ID: "${driveRootId}"`);

  if (!driveRootId) throw new Error("Drive Root ID is missing in Options.");

  const token = await getAuthToken();
  
  // DEBUG: List ALL files in this folder to see what is visible
  const debugUrl = `https://www.googleapis.com/drive/v3/files?q='${driveRootId}' in parents&fields=files(name,id)`;
  const debugRes = await fetch(debugUrl, { headers: { Authorization: `Bearer ${token}` } });
  const debugData = await debugRes.json();
  console.log("📂 Files found in this folder:", debugData.files);

  // ORIGINAL QUERY
  const query = `'${driveRootId}' in parents and name='events_config.json' and trashed=false`;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
     headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  
  if (!data.files || data.files.length === 0) {
    // If we found OTHER files, but not the config, it's a naming issue.
    if (debugData.files && debugData.files.length > 0) {
        const names = debugData.files.map(f => f.name).join(", ");
        throw new Error(`Config missing. Found these instead: ${names}`);
    }
    // If we found NOTHING, it's a permission or ID issue.
    throw new Error("Config file not found. Folder appears empty or inaccessible.");
  }

  const fileId = data.files[0].id;
  const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return await contentRes.json();
}

export async function appendToSheet(token, logData) {
  const { reportSheetId } = await getOptions();
  
  let values;

  // 1. Check if background.js sent us a pre-built row (The new way)
  if (logData.values && Array.isArray(logData.values)) {
      // The Sheets API expects an array of arrays (rows), so we wrap our single row
      values = [logData.values];
  } 
  // 2. Fallback (The old way, just in case)
  else {
      console.warn("⚠️ Received legacy data format in appendToSheet. Using fallback.");
      const now = new Date();
      values = [[
        now.toLocaleDateString(),
        logData.vertical || "Unknown",
        logData.eventName || "Unknown",
        "TikTok", // Default if not provided
        "VOD",
        "N/A",
        logData.reporterName || "Unknown",
        logData.urls || "",
        "DMCA takedown request",
        "Reported",
        "",
        logData.reporterName || "Unknown",
        // ... (remaining empty columns)
      ]];
  }

  // 3. Send to Google Sheets
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${reportSheetId}/values/A1:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
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