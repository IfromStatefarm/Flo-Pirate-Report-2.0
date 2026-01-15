// options.js
document.addEventListener('DOMContentLoaded', () => {
  // CHANGED: keys must match what google_api.js expects
  chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id'], (items) => {
    // We check if the element exists before setting value to prevent errors
    const folderInput = document.getElementById('piracy_folder_id');
    const sheetInput = document.getElementById('piracy_sheet_id');
    
    if (folderInput) folderInput.value = items.piracy_folder_id || '';
    if (sheetInput) sheetInput.value = items.piracy_sheet_id || '';
  });
});

document.getElementById('save').addEventListener('click', () => {
  // CHANGED: Get values from the correct Input IDs
  const folderId = document.getElementById('piracy_folder_id').value;
  const sheetId = document.getElementById('piracy_sheet_id').value;

  // CHANGED: Save using the keys google_api.js is listening for
  chrome.storage.sync.set({ 
    piracy_folder_id: folderId.trim(), 
    piracy_sheet_id: sheetId.trim() 
  }, () => {
    const status = document.getElementById('status');
    status.innerText = 'Settings Saved!';
    setTimeout(() => status.innerText = '', 2000);
  });
});
