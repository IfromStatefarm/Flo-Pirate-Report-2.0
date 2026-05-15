/**
 * PURE LOGIC ONLY - No chrome.storage or fetch() calls allowed here.
 * This file processes raw arrays from Google Sheets into UI-ready objects.
 */

/**
 * Parses view strings (e.g., "1.2k", "5M") into raw integers.
 */
export const normalizeViews = (viewString) => {
    const vStr = String(viewString || "0").toLowerCase();
    if (["pending", "n/a", "deleted", "error", "0"].includes(vStr)) return 0;

    const viewItems = vStr.split(/[\n,]+/);
    return viewItems.reduce((sum, v) => {
        if (v.includes('k')) return sum + (parseFloat(v) * 1000 || 0);
        if (v.includes('m')) return sum + (parseFloat(v) * 1000000 || 0);
        return sum + (parseFloat(v.replace(/[^\d.]/g, '')) || 0);
    }, 0);
};

/**
 * Formats numbers back to readable strings (e.g., 1500 -> "1.5k")
 */
export const normalize2k = (val) => {
    if (typeof val !== 'number') return val;
    return val >= 1000 ? (val / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : val.toString();
};

/**
 * Standard Levenshtein algorithm for fuzzy matching event names.
 */
export const fuzzyMatch = (a, b) => {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
            else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
        }
    }
    return matrix[b.length][a.length];
};

/**
 * Centralized XP logic for Scouts and Enforcers.
 */
export const calculateXP = (itemsCount, currentStreak, isBounty = false, cartTotal = 0) => {
    const xpMult = isBounty ? 2 : 1;
    const queueMult = cartTotal > 50 ? 1.2 : 1;
    
    const enforcerXP = Math.floor(((itemsCount * 20) * xpMult * queueMult)) + (currentStreak >= 3 ? 50 : 0);
    const scoutXP = (itemsCount * 10) * xpMult;

    return { enforcerXP, scoutXP };
};

/**
 * Aggregates raw row data into an intelligence object.
 * Removed the async/await and Google API logic to keep this function pure.
 */
export const processBriefing = (rows, startDate, endDate) => {
    const cutoffDate = new Date(startDate + 'T00:00:00');
    const ctNow = new Date(endDate + 'T23:59:59');

    let totalReported = 0;
    let totalResolved = 0;
    let totalUrls = 0;
    let totalEstimatedViews = 0;

    const scoutCounts = {};
    const enforcerCounts = {};
    const handleStats = {};
    const platformStats = {};
    const timelineData = {};

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue;

        const rowDate = new Date(row[0]);
        if (rowDate >= cutoffDate && rowDate <= ctNow) {
            totalReported++;
            
            const isResolved = (row[9] || "").trim().toLowerCase() === "resolved";
            if (isResolved) totalResolved++;

            const urlString = row[7] || "";
            const urlCount = (urlString.match(/https?:\/\//g) || []).length || 1;
            totalUrls += urlCount;

            const rowViews = normalizeViews(row[5]);
            totalEstimatedViews += (rowViews === 0) ? (urlCount * 1500) : rowViews;
            
            // Timeline mapping
            const dateStr = rowDate.toLocaleDateString();
            if (!timelineData[dateStr]) timelineData[dateStr] = { count: 0, resolved: 0 };
            timelineData[dateStr].count++;
            if (isResolved) timelineData[dateStr].resolved++;
        }
    }

    return {
        totalReported: normalize2k(totalReported),
        totalResolved: normalize2k(totalResolved),
        totalUrls: normalize2k(totalUrls),
        totalEstimatedViews: normalize2k(totalEstimatedViews),
        resolvedRate: totalReported > 0 ? Math.round((totalResolved / totalReported) * 100) + '%' : '0%',
        timelineData,
        startDate,
        endDate
    };
};

/**
 * Processes leaderboard standings from raw rows.
 */
export const computeLeaderboard = (rows, userEmail) => {
    const ctDate = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
    ctDate.setDate(1);
    ctDate.setHours(0, 0, 0, 0);

    const scoutScores = {};
    const enforcerScores = {};

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0] || new Date(row[0]) < ctDate) continue;

        const scout = (row[6] || "").trim().toLowerCase().split('@')[0].replace(/\./g, ' ');
        const enforcer = (row[12] || "").trim().toLowerCase().split('@')[0].replace(/\./g, ' ');

        if (scout) scoutScores[scout] = (scoutScores[scout] || 0) + (parseInt(row[19]) || 0);
        if (enforcer) enforcerScores[enforcer] = (enforcerScores[enforcer] || 0) + (parseInt(row[20]) || 0);
    }

    const sortArr = (obj) => Object.keys(obj).map(n => ({ name: n, points: obj[n] })).sort((a, b) => b.points - a.points);

    return {
        topScouts: sortArr(scoutScores).slice(0, 5),
        topEnforcers: sortArr(enforcerScores).slice(0, 5),
        myPoints: {
            scout: scoutScores[userEmail?.split('@')[0].replace(/\./g, ' ')] || 0,
            enforcer: enforcerScores[userEmail?.split('@')[0].replace(/\./g, ' ')] || 0
        }
    };
};