import { fetchConfig } from '../utils/google_api.js';
import { getClippyAssetForState } from '../utils/clippy_assets.js';

const clippy = document.getElementById('clippy-img');
const status = document.getElementById('status');

// Helper to swap Clippy assets
function setClippyState(state) {
    if (!clippy) return;
    clippy.src = getClippyAssetForState(state);
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Load basic saved settings
  chrome.storage.sync.get(['piracy_folder_id', 'piracy_sheet_id', 'event_sheet_id', 'beta_opt_in', 'report_mode', 'briefing_config'], (items) => {
    if (items.piracy_folder_id) document.getElementById('piracy_folder_id').value = items.piracy_folder_id;
    if (items.piracy_sheet_id) document.getElementById('piracy_sheet_id').value = items.piracy_sheet_id;
    if (items.event_sheet_id) document.getElementById('event_sheet_id').value = items.event_sheet_id;
    document.getElementById('beta_opt_in').checked = !!items.beta_opt_in;
    document.getElementById('report_mode').value = items.report_mode || 'scout';

    // Load Briefing Stats Config
    const defaultStats = { kpi: true, leaderboard: true, timeline: true, platform: true, targets: true, team: true, events: true, appendix: true };
    const briefingConfig = items.briefing_config || defaultStats;
    ['kpi', 'leaderboard', 'timeline', 'platform', 'targets', 'team', 'events', 'appendix'].forEach(stat => {
        const el = document.getElementById(`stat_${stat}`);
        if (el) el.checked = briefingConfig[stat] !== false; // Default to true if undefined
    });
  });

  // 2. Fetch dynamic content
  try {
    setClippyState('looking');
    const config = await fetchConfig();
    if (config && config.community_highlights) {
        const highlights = config.community_highlights;
        const weekly = highlights.highlight_of_the_week;
        
        document.getElementById('lab-instructions').innerText = highlights.lab_instructions || "Test new features and earn badges!";
        document.getElementById('highlight-user').innerText = weekly.user || "TBD";
        document.getElementById('highlight-desc').innerHTML = `${weekly.achievement} <span style="color:#10b981; font-weight:bold;">[${weekly.bonus_awarded}]</span>`;
    }
    setClippyState('default');
  } catch (err) {
    console.error("Failed to load community highlights:", err);
    document.getElementById('highlight-user').innerText = "Team Sync Required";
    document.getElementById('highlight-desc').innerText = "Verify your Folder ID to see team updates.";
    setClippyState('default');
  }

  // Evidence Locker Button Logic
  document.getElementById('open_evidence_locker').addEventListener('click', () => {
    const folderId = document.getElementById('piracy_folder_id').value.trim();
    if (folderId) {
      window.open(`https://drive.google.com/drive/folders/${folderId}`, '_blank');
    } else {
      setClippyState('looking');
      const statusEl = document.getElementById('status');
      statusEl.style.color = '#ce0e2d';
      statusEl.innerText = 'Please enter a Folder ID first to open the locker.';
      setTimeout(() => { statusEl.innerText = ''; setClippyState('default'); }, 3000);
    }
  });

  // Easter Egg Trigger Logic
  let clickCount = 0;
  const headerTitle = document.querySelector('header h1');
  const easterEggOverlay = document.getElementById('easter-egg');
  
  headerTitle.addEventListener('click', () => {
    clickCount++;
    if (clickCount >= 5) {
      clickCount = 0;
      easterEggOverlay.style.display = 'flex';
      
      // Fire the jingle along with the gif animation
      new Audio(chrome.runtime.getURL('Piratemusic.mp3')).play().catch(e => console.warn("Audio play blocked:", e));
    }
  });

  // Close Easter Egg
  easterEggOverlay.addEventListener('click', () => {
    easterEggOverlay.style.display = 'none';
  });

  // Briefing Settings Modal Logic
  const briefingModal = document.getElementById('briefing-modal');
  document.getElementById('open_briefing_settings')?.addEventListener('click', () => {
      briefingModal.style.display = 'flex';
  });
  document.getElementById('cancel_briefing_stats')?.addEventListener('click', () => {
      briefingModal.style.display = 'none';
  });
  document.getElementById('save_briefing_stats')?.addEventListener('click', () => {
      const newConfig = {};
      ['kpi', 'leaderboard', 'timeline', 'platform', 'targets', 'team', 'events', 'appendix'].forEach(stat => {
          const el = document.getElementById(`stat_${stat}`);
          if (el) newConfig[stat] = el.checked;
      });
      chrome.storage.sync.set({ briefing_config: newConfig }, () => {
          briefingModal.style.display = 'none';
          setClippyState('smirk');
          status.style.color = 'green';
          status.innerText = 'Briefing Preferences Saved!';
          setTimeout(() => { status.innerText = ''; setClippyState('default'); }, 3000);
      });
  });
});

document.getElementById('send_suggestion').addEventListener('click', async () => {
    const text = document.getElementById('suggestion_text').value.trim();
    const sugStatus = document.getElementById('suggestion_status');

    if (!text) {
        setClippyState('looking');
        sugStatus.style.color = '#ce0e2d';
        sugStatus.innerText = 'Field is empty!';
        return;
    }

    setClippyState('talking');
    sugStatus.style.color = '#2563eb';
    sugStatus.innerText = 'Transmitting...';
    
    chrome.runtime.sendMessage({ action: 'submitSuggestion', text: text }, (response) => {
        if (response && response.success) {
            setClippyState('smirk');
            sugStatus.style.color = 'green';
            sugStatus.innerText = '✅ Comms received. Thanks!';
            document.getElementById('suggestion_text').value = '';
        } else {
            setClippyState('default');
            sugStatus.style.color = '#ce0e2d';
            sugStatus.innerText = '❌ Uplink failed.';
        }
    });
});

document.getElementById('save').addEventListener('click', () => {
  const folderId = document.getElementById('piracy_folder_id').value.trim();
  const sheetId = document.getElementById('piracy_sheet_id').value.trim();
  const eventSheetId = document.getElementById('event_sheet_id').value.trim();
  const betaOptIn = document.getElementById('beta_opt_in').checked;
  const reportMode = document.getElementById('report_mode').value;

  if (!folderId || !sheetId || !eventSheetId) {
    setClippyState('talking');
    status.style.color = '#ce0e2d';
    status.innerText = 'Missing IDs! Check Clippy for details.';
    
    if (window.showClippyMessage) {
        window.showClippyMessage('Missing IDs! Please check the <a href="https://flocasts.atlassian.net/wiki/spaces/FSM/pages/5634621448/FloSports+Pirate+Reporter+3.3.1+Pirate+AI#Options-Set-up" target="_blank" style="color: #2563eb; text-decoration: underline;">Setup Guide</a> to fill out all boxes.');
    }
    return;
  }

  chrome.storage.sync.set({ 
    piracy_folder_id: folderId, 
    piracy_sheet_id: sheetId,
    event_sheet_id: eventSheetId,
    beta_opt_in: betaOptIn,
    report_mode: reportMode
  }, () => {
    setClippyState('smirk');
    status.style.color = 'green';
    status.innerText = 'Configurations Locked. Ready for Hunt.';
    
    // Mark onboarding step if it was pending
    chrome.storage.local.get(['onboarding_step'], (res) => {
        if (res.onboarding_step === 'NEEDS_CONFIG') {
            chrome.storage.local.set({ onboarding_step: 'READY_FOR_FIRST_REPORT' });
        }
    });

    setTimeout(() => {
        status.innerText = '';
        setClippyState('default');
    }, 3000);
  });
});
