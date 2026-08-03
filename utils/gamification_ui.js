function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderLeaderboard(listEl, users = [], emptyCopy = 'No scores yet.') {
  if (!listEl || !Array.isArray(users)) return;

  const visibleUsers = users.filter(Boolean);
  if (visibleUsers.length === 0) {
    listEl.innerHTML = `<li>${escapeHtml(emptyCopy)}</li>`;
    return;
  }

  listEl.innerHTML = visibleUsers
    .map(
      (user, index) =>
        `<li><strong>#${index + 1}</strong> <span style="text-transform:capitalize">${escapeHtml(user.name)}</span> - ${escapeHtml(user.points)} pts</li>`
    )
    .join('');
}

const GOAL_TARGET = 1000;
const GOAL_CELEBRATION_VIDEO_URL = 'https://drive.google.com/file/d/1MiSptWYxbKdt41lNpinBw3_gTghwJBKb/preview';
const MVP_CELEBRATION_VIDEO_URL = 'https://drive.google.com/file/d/1IbF2ty0ZJ9tqeyTnVIYpHHh_GULSn0sl/preview';
const LEVEL3_CELEBRATION_VIDEO_URL = 'https://drive.google.com/file/d/11tFAYNbKd5CKoT3E1tOuBAbTZckZw6E-/preview';

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getCompactRankLabel(rank, fallback = 'Level 1') {
  const normalizedRank = String(rank || '').trim();
  if (!normalizedRank) return fallback;
  if (/offline/i.test(normalizedRank)) return 'Offline';

  const levelMatch = normalizedRank.match(/Level\s+\d+/i);
  if (levelMatch) {
    return levelMatch[0].replace(/\s+/g, ' ');
  }

  return normalizedRank.replace(/^🚀\s*Pioneer\s*/i, '').trim() || fallback;
}

function getNextLevelCopy(points) {
  const numericPoints = toFiniteNumber(points);
  if (numericPoints === null) return 'Score unavailable.';
  if (numericPoints > 1000) return 'Max level reached';

  const nextLevel = numericPoints > 500 ? 'Level 3' : 'Level 2';
  const nextLevelTarget = numericPoints > 500 ? 1001 : 501;
  const remainingPoints = Math.max(0, nextLevelTarget - numericPoints);
  const label = remainingPoints === 1 ? 'pt' : 'pts';

  return `${remainingPoints} ${label} to ${nextLevel}`;
}

function getMvpGapCopy(stats) {
  if (stats.error && !stats.stale) return stats.errorMessage || 'Leaderboard unavailable.';
  if (stats.stale) return 'Showing last synced leaderboard.';
  if (stats.isCurrentMvp) return 'You are the current MVP.';

  const myTotal = (toFiniteNumber(stats.scoutPoints) || 0) + (toFiniteNumber(stats.enforcerPoints) || 0);
  const mvpPoints = toFiniteNumber(stats.mvp?.points);

  if (mvpPoints === null) return 'Leaderboard unavailable.';
  if (mvpPoints <= 0 && myTotal <= 0) return 'First report sets the pace.';
  if (myTotal >= mvpPoints) return 'You are at the MVP pace.';

  const gap = mvpPoints - myTotal;
  return `${gap} pt${gap === 1 ? '' : 's'} behind MVP`;
}

function getGoalRemainingCopy(teamTotalValue) {
  if (teamTotalValue === null) return 'Goal tracking offline.';
  if (teamTotalValue >= GOAL_TARGET) return 'Goal reached this month. Victory clip unlocked.';

  const remainingReports = GOAL_TARGET - teamTotalValue;
  return `About ${remainingReports} more report${remainingReports === 1 ? '' : 's'} to goal.`;
}

export function renderGamificationStats(stats, { doc = document } = {}) {
  if (!stats) return;

  const header = doc.getElementById('gamification-header');
  const scoutPointsValue = toFiniteNumber(stats.scoutPoints);
  const enforcerPointsValue = toFiniteNumber(stats.enforcerPoints);
  const teamTotalValue = toFiniteNumber(stats.teamTotal);
  const teamTotalDisplay = teamTotalValue === null ? String(stats.teamTotal ?? '-') : String(teamTotalValue);
  const syncUnavailable = Boolean(stats.error && !stats.stale);
  const mvpNameDisplay = syncUnavailable ? 'Unavailable' : (stats.mvp?.name || 'TBD');
  const mvpPointsValue = toFiniteNumber(stats.mvp?.points);
  const mvpPointsDisplay = mvpPointsValue === null ? '0' : String(mvpPointsValue);
  const scoutRankDisplay = stats.scoutRank || 'Level 1 Scout Reporter';
  const enforcerRankDisplay = stats.enforcerRank || 'Level 1 Enforcer';

  if (header) {
    header.style.display = 'block';

    let themeColor = '#ce0e2d';
    if ((scoutPointsValue !== null && scoutPointsValue > 1000) || (enforcerPointsValue !== null && enforcerPointsValue > 1000)) {
      themeColor = '#9333ea';
    } else if ((scoutPointsValue !== null && scoutPointsValue > 500) || (enforcerPointsValue !== null && enforcerPointsValue > 500)) {
      themeColor = '#fbbf24';
    }

    header.style.borderColor = themeColor;
    header.style.setProperty('--gamification-theme', themeColor);
    header.style.backgroundColor = teamTotalValue !== null && teamTotalValue >= 1000 ? '#d1fae5' : '';
  }

  const summaryScoutRank = doc.getElementById('summary-scout-rank');
  const summaryEnforcerRank = doc.getElementById('summary-enforcer-rank');
  const summaryMvpName = doc.getElementById('summary-mvp-name');
  const scoutRank = doc.getElementById('scout-rank');
  const enforcerRank = doc.getElementById('enforcer-rank');
  const scoutPoints = doc.getElementById('scout-points');
  const enforcerPoints = doc.getElementById('enforcer-points');
  const scoutNextLevel = doc.getElementById('scout-next-level');
  const enforcerNextLevel = doc.getElementById('enforcer-next-level');
  const scoutLevel3VideoBtn = doc.getElementById('scout-level3-video-btn');
  const enforcerLevel3VideoBtn = doc.getElementById('enforcer-level3-video-btn');
  const mvpName = doc.getElementById('mvp-name');
  const mvpPoints = doc.getElementById('mvp-points');
  const mvpGap = doc.getElementById('mvp-gap');
  const mvpVideoBtn = doc.getElementById('mvp-video-btn');
  const teamTakedowns = doc.getElementById('team-takedowns');
  const teamTakedownsInline = doc.getElementById('team-takedowns-inline');
  const teamGoalProgress = doc.getElementById('team-goal-progress');
  const teamGoalRemaining = doc.getElementById('team-goal-remaining');
  const teamGoalVideoBtn = doc.getElementById('team-goal-video-btn');
  const goalReached = teamTotalValue !== null && teamTotalValue >= GOAL_TARGET;
  const myTotalPoints = (scoutPointsValue || 0) + (enforcerPointsValue || 0);
  const isCurrentMvp = !!stats.isCurrentMvp || (mvpPointsValue !== null && mvpPointsValue > 0 && myTotalPoints >= mvpPointsValue);
  const unlockedScoutLevel3 = scoutPointsValue !== null && scoutPointsValue > 1000;
  const unlockedEnforcerLevel3 = enforcerPointsValue !== null && enforcerPointsValue > 1000;

  if (summaryScoutRank) summaryScoutRank.innerText = getCompactRankLabel(scoutRankDisplay);
  if (summaryEnforcerRank) summaryEnforcerRank.innerText = getCompactRankLabel(enforcerRankDisplay);
  if (summaryMvpName) summaryMvpName.innerText = mvpNameDisplay;
  if (scoutRank) scoutRank.innerText = scoutRankDisplay;
  if (enforcerRank) enforcerRank.innerText = enforcerRankDisplay;
  if (scoutPoints) scoutPoints.innerText = scoutPointsValue ?? 0;
  if (enforcerPoints) enforcerPoints.innerText = enforcerPointsValue ?? 0;
  if (scoutNextLevel) scoutNextLevel.innerText = getNextLevelCopy(stats.scoutPoints);
  if (enforcerNextLevel) enforcerNextLevel.innerText = getNextLevelCopy(stats.enforcerPoints);
  if (scoutLevel3VideoBtn) {
    scoutLevel3VideoBtn.hidden = !unlockedScoutLevel3;
    scoutLevel3VideoBtn.dataset.videoUrl = LEVEL3_CELEBRATION_VIDEO_URL;
    scoutLevel3VideoBtn.dataset.videoTitle = 'Scout Level 3 Celebration';
  }
  if (enforcerLevel3VideoBtn) {
    enforcerLevel3VideoBtn.hidden = !unlockedEnforcerLevel3;
    enforcerLevel3VideoBtn.dataset.videoUrl = LEVEL3_CELEBRATION_VIDEO_URL;
    enforcerLevel3VideoBtn.dataset.videoTitle = 'Enforcer Level 3 Celebration';
  }
  if (mvpName) mvpName.innerText = mvpNameDisplay;
  if (mvpPoints) mvpPoints.innerText = mvpPointsDisplay;
  if (mvpGap) mvpGap.innerText = getMvpGapCopy(stats);
  if (mvpVideoBtn) {
    mvpVideoBtn.hidden = !isCurrentMvp;
    mvpVideoBtn.dataset.videoUrl = MVP_CELEBRATION_VIDEO_URL;
    mvpVideoBtn.dataset.videoTitle = 'MVP Celebration';
  }
  if (teamTakedowns) teamTakedowns.innerText = teamTotalDisplay;
  if (teamTakedownsInline) teamTakedownsInline.innerText = teamTotalDisplay;
  if (teamGoalProgress) {
    const progressPercent = teamTotalValue === null ? 0 : Math.max(0, Math.min(100, (teamTotalValue / GOAL_TARGET) * 100));
    teamGoalProgress.style.width = `${progressPercent}%`;
  }
  if (teamGoalRemaining) {
    const goalCopy = getGoalRemainingCopy(teamTotalValue);
    teamGoalRemaining.innerText = stats.stale ? `${goalCopy} Showing last synced scores.` : goalCopy;
  }
  if (teamGoalVideoBtn) {
    teamGoalVideoBtn.hidden = !goalReached;
    teamGoalVideoBtn.dataset.videoUrl = GOAL_CELEBRATION_VIDEO_URL;
    teamGoalVideoBtn.dataset.videoTitle = 'Team Goal Celebration';
  }

  const scoutEmptyCopy = syncUnavailable ? 'Scout scores unavailable.' : 'No scout scores yet.';
  const enforcerEmptyCopy = syncUnavailable ? 'Enforcer scores unavailable.' : 'No enforcer scores yet.';
  renderLeaderboard(doc.getElementById('scout-leaderboard'), stats.topScouts || [], scoutEmptyCopy);
  renderLeaderboard(doc.getElementById('enforcer-leaderboard'), stats.topEnforcers || [], enforcerEmptyCopy);
}
