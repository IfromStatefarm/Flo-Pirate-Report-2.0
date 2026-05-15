export function populateVerticalSelect(selectEl, configData, { placeholder = 'Select Vertical...' } = {}) {
  if (!selectEl) return;

  selectEl.innerHTML = `<option value="">${placeholder}</option>`;

  const verticals = configData?.verticals || [];
  verticals.forEach((vertical) => {
    const option = document.createElement('option');
    option.value = vertical.name;
    option.innerText = vertical.name;
    selectEl.appendChild(option);
  });
}

export function populateEventSelect(
  selectEl,
  configData,
  verticalName,
  {
    placeholder = 'Select Event...',
    lastValue = '',
    includeConfigDataset = false
  } = {}
) {
  if (!selectEl) return;

  const selectedVertical = configData?.verticals?.find((vertical) => vertical.name === verticalName);

  selectEl.innerHTML = `<option value="">${placeholder}</option>`;
  selectEl.disabled = false;

  const events = selectedVertical?.events || [];
  events.forEach((eventConfig) => {
    const option = document.createElement('option');
    option.value = eventConfig.eventName;
    option.innerText = eventConfig.eventName;

    if (includeConfigDataset) {
      option.dataset.config = JSON.stringify(eventConfig);
    }

    selectEl.appendChild(option);
  });

  if (!lastValue) return;

  const hasSavedValue = Array.from(selectEl.options).some((option) => option.value === lastValue);
  if (hasSavedValue) {
    selectEl.value = lastValue;
  }
}
