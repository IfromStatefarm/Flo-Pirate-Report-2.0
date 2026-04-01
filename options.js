// options.js
import { fetchConfig } from './utils/google_api.js';

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Load basic saved settings
  chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id', 'beta_opt_in'], (items) => {
    if (items.piracy_folder_id) document.getElementById('piracy_folder_id').value = items.piracy_folder_id;
    if (items.piracy_sheet_id) document.getElementById('piracy_sheet_id').value = items.piracy_sheet_id;
    if (items.event_sheet_id) document.getElementById('event_sheet_id').value = items.event_sheet_id;
    document.getElementById('beta_opt_in').checked = !!items.beta_opt_in;
  });

  // 2. Fetch dynamic content from events_config.json in Drive
  try {
    const config = await fetchConfig();
    if (config && config.community_highlights) {
        const highlights = config.community_highlights;
        const weekly = highlights.highlight_of_the_week;
        
        document.getElementById('lab-instructions').innerText = highlights.lab_instructions || "Test new features and earn badges!";
        document.getElementById('highlight-user').innerText = weekly.user || "TBD";
        document.getElementById('highlight-desc').innerHTML = `${weekly.achievement} <span style="color:#10b981; font-weight:bold;">[${weekly.bonus_awarded}]</span>`;
    }
  } catch (err) {
    console.error("Failed to load community highlights:", err);
    document.getElementById('highlight-user').innerText = "Team Sync Required";
    document.getElementById('highlight-desc').innerText = "Please ensure your Folder ID is correct to see community updates.";
  }
});
document.getElementById('send_suggestion').addEventListener('click', async () => {
    const text = document.getElementById('suggestion_text').value.trim();
    const status = document.getElementById('suggestion_status');

    if (!text) {
        status.style.color = '#ce0e2d';
        status.innerText = 'Please enter some text before sending.';
        setTimeout(() => status.innerText = '', 3000);
        return;
    }

    status.style.color = '#2563eb';
    status.innerText = 'Sending...';
    document.getElementById('send_suggestion').disabled = true;

    chrome.runtime.sendMessage({ action: 'submitSuggestion', text: text }, (response) => {
        document.getElementById('send_suggestion').disabled = false;
        if (response && response.success) {
            status.style.color = 'green';
            status.innerText = '✅ Suggestion sent successfully! Thank you.';
            document.getElementById('suggestion_text').value = '';
        } else {
            status.style.color = '#ce0e2d';
            status.innerText = '❌ Failed to send: ' + (response?.error || 'Unknown error');
        }
        setTimeout(() => status.innerText = '', 4000);
    });
});

document.getElementById('save').addEventListener('click', () => {
  const folderId = document.getElementById('piracy_folder_id').value.trim();
  const sheetId = document.getElementById('piracy_sheet_id').value.trim();
  const eventSheetId = document.getElementById('event_sheet_id').value.trim();
  const betaOptIn = document.getElementById('beta_opt_in').checked;

  chrome.storage.sync.set({ 
    piracy_folder_id: folderId, 
    piracy_sheet_id: sheetId,
    event_sheet_id: eventSheetId,
    beta_opt_in: betaOptIn
  }, () => {
    const status = document.getElementById('status');
    status.style.color = 'green';
    status.innerText = 'Settings Saved! Pioneer Status: ' + (betaOptIn ? 'Active 🚀' : 'Disabled');
    setTimeout(() => status.innerText = '', 3000);
  });
});