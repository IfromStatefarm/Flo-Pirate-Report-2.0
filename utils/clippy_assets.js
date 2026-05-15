const CLIPPY_STATE_ASSETS = Object.freeze({
  default: 'images/clippy starting postion.png',
  talking: 'images/clippy talking.gif',
  smirk: 'images/clippy smrik.gif',
  looking: 'images/clippy looking.gif'
});

export function getClippyAssetForState(state) {
  return CLIPPY_STATE_ASSETS[state] || CLIPPY_STATE_ASSETS.default;
}
