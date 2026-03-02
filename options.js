// options.js
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id'], (items) => {
    const folderInput = document.getElementById('piracy_folder_id');
    const sheetInput = document.getElementById('piracy_sheet_id');
    const eventSheetInput = document.getElementById('event_sheet_id'); // NEW
    
    if (folderInput) folderInput.value = items.piracy_folder_id || '';
    if (sheetInput) sheetInput.value = items.piracy_sheet_id || '';
    if (eventSheetInput) eventSheetInput.value = items.event_sheet_id || '';
  });
});

document.getElementById('save').addEventListener('click', () => {
  const folderId = document.getElementById('piracy_folder_id').value;
  const sheetId = document.getElementById('piracy_sheet_id').value;
  const eventSheetId = document.getElementById('event_sheet_id').value; // NEW

  chrome.storage.sync.set({ 
    piracy_folder_id: folderId.trim(), 
    piracy_sheet_id: sheetId.trim(),
    event_sheet_id: eventSheetId.trim()
  }, () => {
    const status = document.getElementById('status');
    status.innerText = 'Settings Saved!';
    setTimeout(() => status.innerText = '', 2000);
  });
});