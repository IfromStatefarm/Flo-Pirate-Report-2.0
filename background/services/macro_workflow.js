export function createMacroWorkflow() {
  return {
    async startMacroSession(platform) {
      await chrome.storage.session.set({ activeMacroPlatform: platform, macroEvents: [] });
      return { success: true };
    },

    async compileMacro() {
      const data = await chrome.storage.session.get(['macroEvents', 'activeMacroPlatform']);
      const { macroEvents, activeMacroPlatform } = data;

      if (!macroEvents || macroEvents.length === 0) {
        chrome.runtime
          .sendMessage({
            action: 'macroTrainingFailed',
            reason: 'No actions were recorded. Please click elements on the page while recording.'
          })
          .catch(() => {});
        return { success: false };
      }

      const processedMacro = macroEvents.map((event, index) => ({
        action: event.action,
        selector: event.selector,
        value: event.value,
        delay: index === 0 ? 0 : event.timestamp - macroEvents[index - 1].timestamp
      }));

      chrome.runtime
        .sendMessage({
          action: 'macroTrainingComplete',
          platform: activeMacroPlatform,
          macro: processedMacro
        })
        .catch(() => {});

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        chrome.tabs
          .sendMessage(tab.id, {
            action: 'showMacroConfirmation',
            platform: activeMacroPlatform,
            macro: processedMacro
          })
          .catch((error) => {
            console.error('Failed to show confirmation UI on page:', error);
            chrome.runtime
              .sendMessage({
                action: 'macroTrainingFailed',
                reason: 'Could not reach the video page. Please refresh the video tab.'
              })
              .catch(() => {});
          });
      }

      await chrome.storage.session.remove(['macroEvents', 'activeMacroPlatform']);
      return { success: true, macro: processedMacro };
    },

    async recordMacroStep(step) {
      const data = await chrome.storage.session.get('macroEvents');
      const events = data.macroEvents || [];
      events.push(step);
      await chrome.storage.session.set({ macroEvents: events });
      return { success: true };
    }
  };
}
