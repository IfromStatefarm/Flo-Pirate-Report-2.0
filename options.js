// options.js
document.addEventListener('DOMContentLoaded', () => {
  // Load existing values including the new event_sheet_id
  chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id'], (items) => {
    const folderInput = document.getElementById('piracy_folder_id');
    const sheetInput = document.getElementById('piracy_sheet_id');
    const eventInput = document.getElementById('event_sheet_id');
    
    if (folderInput) folderInput.value = items.piracy_folder_id || '';
    if (sheetInput) sheetInput.value = items.piracy_sheet_id || '';
    if (eventInput) eventInput.value = items.event_sheet_id || '';
  });
});

document.getElementById('save').addEventListener('click', () => {
  const folderId = document.getElementById('piracy_folder_id').value.trim();
  const sheetId = document.getElementById('piracy_sheet_id').value.trim();
  const eventSheetId = document.getElementById('event_sheet_id').value.trim();

  // Save all three required IDs to sync storage
  chrome.storage.sync.set({ 
    piracy_folder_id: folderId, 
    piracy_sheet_id: sheetId,
    event_sheet_id: eventSheetId
  }, () => {
    const status = document.getElementById('status');
    status.innerText = '✅ Settings Saved! You can now use the Side Panel.';
    
    // Optional: Close options page after saving
    setTimeout(() => {
        status.innerText = '';
    }, 3000);
  });
});
