function renderLeaderboard(listEl, users = []) {
  if (!listEl || !Array.isArray(users)) return;

  listEl.innerHTML = users
    .map(
      (user, index) =>
        `<li><strong>#${index + 1}</strong> <span style="text-transform:capitalize">${user.name}</span> - ${user.points} pts</li>`
    )
    .join('');
}

export function renderGamificationStats(stats, { doc = document } = {}) {
  if (!stats) return;

  const header = doc.getElementById('gamification-header');
  if (header) {
    header.style.display = 'block';

    let themeColor = '#ce0e2d';
    if (stats.scoutRank === 'Sentinel' || stats.enforcerRank === 'The Purge') {
      themeColor = '#9333ea';
    } else if (stats.scoutRank === 'Pathfinder' || stats.enforcerRank === 'Sheriff') {
      themeColor = '#fbbf24';
    }

    header.style.borderColor = themeColor;
    header.style.backgroundColor = stats.teamTotal >= 1000 ? '#d1fae5' : '';
  }

  const scoutRank = doc.getElementById('scout-rank');
  const enforcerRank = doc.getElementById('enforcer-rank');
  const scoutPoints = doc.getElementById('scout-points');
  const enforcerPoints = doc.getElementById('enforcer-points');
  const mvpName = doc.getElementById('mvp-name');
  const teamTakedowns = doc.getElementById('team-takedowns');

  if (scoutRank) scoutRank.innerText = stats.scoutRank || 'Spotter';
  if (enforcerRank) enforcerRank.innerText = stats.enforcerRank || 'Agent';
  if (scoutPoints) scoutPoints.innerText = stats.scoutPoints || 0;
  if (enforcerPoints) enforcerPoints.innerText = stats.enforcerPoints || 0;
  if (mvpName && stats.mvp) mvpName.innerText = stats.mvp.name;
  if (teamTakedowns) teamTakedowns.innerText = stats.teamTotal || 0;

  renderLeaderboard(doc.getElementById('scout-leaderboard'), stats.topScouts || []);
  renderLeaderboard(doc.getElementById('enforcer-leaderboard'), stats.topEnforcers || []);
}
