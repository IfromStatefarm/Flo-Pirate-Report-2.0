// Neutral package policy; the Flo development config remains unchanged.
export function neutralEventConfig(candidate) {
  const config = structuredClone(candidate);
  config.verticals = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/^(authorized|approved)_(handles|channel_ids|studio_manager_ids|studio_ids)$/.test(key)) value[key] = [];
      else visit(child);
    }
  }
  visit(config);
  return config;
}
