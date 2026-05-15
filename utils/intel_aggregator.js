/**
 * utils/intel_aggregator.js
 * Responsibility: Processing raw Google Sheet arrays into Tactical Intelligence Objects.
 */

export function normalize2k(val) {
    if (typeof val !== 'number') return val;
    return val >= 1000 ? (val / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : val.toString();
}

export function levenshtein(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1, 
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

export function getConsolidatedEventName(rawName, existingNames) {
    if (rawName === "Unknown Event") return rawName;
    
    const cleanStr = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
    const extractYear = (s) => { 
        const m = s.match(new RegExp('\\b(20\\d{2})\\b')); 
        return m ? m[1] : null; 
    };

    const nameYear = extractYear(rawName);
    const nameClean = cleanStr(rawName);

    for (const existing of existingNames) {
        if (extractYear(existing) === nameYear) {
            const distance = levenshtein(nameClean, cleanStr(existing));
            if (distance <= Math.ceil(nameClean.length * 0.25)) { 
                return existing; 
            }
        }
    }
    return rawName;
}

export function aggregateIntelligenceData(rows, startDateStr, endDateStr) {
    if (!rows || rows.length < 2) return null;

    const cutoffDate = new Date(startDateStr + 'T00:00:00');
    const ctNow = new Date(endDateStr + 'T23:59:59');

    let totalReported = 0;
    let totalResolved = 0;
    let totalUrls = 0;
    let totalEstimatedViews = 0;

    let globalWeightedDaysSum = 0;
    let globalUnweightedDaysSum = 0;
    let globalResolvedCalcCount = 0;
    let globalTotalCalcCount = 0;
    
    const scoutCounts = {};
    const enforcerCounts = {};
    const handleStats = {};
    const platformPirates = {};
    const eventCounts = {};
    const eventViewStats = {};
    const platformStats = {};
    const timelineData = {};
    const userStats = {};

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue;

        const rowDate = new Date(row[0]);
        if (rowDate >= cutoffDate && rowDate <= ctNow) {
            totalReported++;

            const isResolved = (row[9] || "").trim().toLowerCase() === "resolved";
            if (isResolved) {
                totalResolved++;
            }

            const normalizeName = (name) => (name || "").toLowerCase().replace(/\./g, ' ').trim().split('@')[0];
            const scout = normalizeName(row[6]);
            const enforcer = normalizeName(row[12]);
            
            const urlString = row[7] || "";
            // Replaced regex literal with RegExp to prevent parser comment interference
            const urlMatch = urlString.match(new RegExp('https?:\\\\/\\\\/', 'g'));
            const urlCount = urlMatch ? urlMatch.length : 1;
            totalUrls += urlCount;

            const viewsStr = String(row[5] || "0").toLowerCase();
            let rowViews = 0;
            
            if (viewsStr !== "pending" && viewsStr !== "n/a" && viewsStr !== "deleted" && viewsStr !== "error") {
                const viewItems = viewsStr.split(/[\n,]+/);
                rowViews = viewItems.reduce((sum, v) => {
                    if (v.includes('k')) return sum + (parseFloat(v) * 1000 || 0);
                    if (v.includes('m')) return sum + (parseFloat(v) * 1000000 || 0);
                    return sum + (parseFloat(v.replace(/[^\d.]/g, '')) || 0);
                }, 0);
            }
            
             if (rowViews === 0 && urlCount > 0) {
                rowViews = urlCount * 1500; 
            }
            
            totalEstimatedViews += rowViews;
            
            // Single declaration for date string
            const dateStr = new Date(row[0]).toLocaleDateString("en-US", { year: 'numeric', month: 'numeric', day: 'numeric' });

            if (scout) {
                if (!userStats[scout]) {
                    userStats[scout] = { scouted: 0, enforced: 0, urls: 0, resolved: 0, total: 0, activeDays: new Set(), wDaysSum: 0, wCalcCount: 0, uwDaysSum: 0, uwCalcCount: 0 };
                }
                userStats[scout].total++;
                userStats[scout].scouted += urlCount;
                userStats[scout].urls += urlCount;
                userStats[scout].activeDays.add(dateStr);
                if (isResolved) {
                    userStats[scout].resolved++;
                }
            }
            
            if (enforcer) {
                if (!userStats[enforcer]) {
                    userStats[enforcer] = { scouted: 0, enforced: 0, urls: 0, resolved: 0, total: 0, activeDays: new Set(), wDaysSum: 0, wCalcCount: 0, uwDaysSum: 0, uwCalcCount: 0 };
                }
                userStats[enforcer].enforced += urlCount;
                userStats[enforcer].activeDays.add(dateStr);
                if (scout !== enforcer) {
                    userStats[enforcer].total++;
                    userStats[enforcer].urls += urlCount;
                    if (isResolved) {
                        userStats[enforcer].resolved++;
                    }
                }
            }

            if (scout) scoutCounts[scout] = (scoutCounts[scout] || 0) + 1;
            if (enforcer) enforcerCounts[enforcer] = (enforcerCounts[enforcer] || 0) + 1;

            const kText = (row[10] || "").trim();
            const handleMatch = kText.match(/@([^\s\n]+)/);
            let rawHandle = handleMatch ? handleMatch[1] : "Unknown";
            let handle = rawHandle.replace(/^@/, "").toLowerCase().trim();
            
            if (handle === "unknown" && row[7] && row[7].includes('@')) {
                const urlMatch = row[7].match(/@([^\s/?]+)/);
                if (urlMatch) {
                    handle = urlMatch[1].toLowerCase().trim();
                }
            }

            const platform = (row[3] || "Unknown").trim();
            const reportDate = new Date(row[0]);
            let burndownDays = 0;
            let isResolvedCalc = false;
            const today = new Date();

            if (!isNaN(reportDate.getTime())) {
                if (isResolved && row[21]) {
                    const resolveDate = new Date(row[21]);
                    if (!isNaN(resolveDate.getTime())) {
                        burndownDays = Math.max(0, (resolveDate - reportDate) / (1000 * 60 * 60 * 24));
                        isResolvedCalc = true;
                    }
                } 
                
                if (!isResolvedCalc) {
                    const daysOpen = Math.max(0, (today - reportDate) / (1000 * 60 * 60 * 24));
                    burndownDays = daysOpen + 14; 
                }

                globalUnweightedDaysSum += burndownDays;
                globalTotalCalcCount++;
                
                if (isResolvedCalc) {
                    globalWeightedDaysSum += burndownDays;
                    globalResolvedCalcCount++;
                }

                if (scout) {
                    if (isResolvedCalc) { userStats[scout].wDaysSum += burndownDays; userStats[scout].wCalcCount++; }
                    else { userStats[scout].uwDaysSum += burndownDays; userStats[scout].uwCalcCount++; }
                }
                if (enforcer && scout !== enforcer) {
                    if (isResolvedCalc) { userStats[enforcer].wDaysSum += burndownDays; userStats[enforcer].wCalcCount++; }
                    else { userStats[enforcer].uwDaysSum += burndownDays; userStats[enforcer].uwCalcCount++; }
                }
            }

            if (!handleStats[handle]) {
                handleStats[handle] = { reports: 0, urls: 0, platforms: new Set() };
            }
            handleStats[handle].reports += 1;
            handleStats[handle].urls += urlCount;
            
              if (platform && platform.toLowerCase() !== "unknown") {
                const cleanPlatform = platform.toUpperCase();
                handleStats[handle].platforms.add(cleanPlatform);
                
                if (!platformStats[cleanPlatform]) {
                    platformStats[cleanPlatform] = { reports: 0, urls: 0 };
                }
                platformStats[cleanPlatform].reports += 1;
                platformStats[cleanPlatform].urls += urlCount;

                if (!platformPirates[cleanPlatform]) platformPirates[cleanPlatform] = {};
                if (!platformPirates[cleanPlatform][handle]) platformPirates[cleanPlatform][handle] = { urls: 0, reports: 0 };
                platformPirates[cleanPlatform][handle].urls += urlCount;
                platformPirates[cleanPlatform][handle].reports += 1;
            }  

            const eventName = (row[2] || "Unknown Event").trim();
            eventCounts[eventName] = (eventCounts[eventName] || 0) + 1;

            if (!eventViewStats[eventName]) {
                eventViewStats[eventName] = 0;
            }
            eventViewStats[eventName] += rowViews;

            if (!timelineData[dateStr]) {
                timelineData[dateStr] = { count: 0, resolved: 0 };
            }
            timelineData[dateStr].count += 1;
            if (isResolved) {
                timelineData[dateStr].resolved += 1;
            }
        }
    } 

    const sortObj = (obj, key) => {
        return Object.keys(obj).map(k => {
            return { name: k, count: key ? obj[k][key] : obj[k] };
        }).sort((a, b) => b.count - a.count);
    };

    const allUsers = new Set([...Object.keys(scoutCounts), ...Object.keys(enforcerCounts)]);
    let mvp = { name: "N/A", total: 0 };
    
    allUsers.forEach(user => {
        const total = (scoutCounts[user] || 0) + (enforcerCounts[user] || 0);
        if (total > mvp.total) {
            mvp = { name: user, total: total };
        }
    });

   const teamStats = Object.keys(userStats).map(name => {
        const stats = userStats[name];
        const resRate = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) + '%' : '0%';
        const displayName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        
        const wBurndown = stats.wCalcCount > 0 ? (stats.wDaysSum / stats.wCalcCount).toFixed(1) : 'N/A';
        const uwBurndown = stats.uwCalcCount > 0 ? (stats.uwDaysSum / stats.uwCalcCount).toFixed(1) : 'N/A';

        return { 
            name: displayName, 
            urls: stats.urls, 
            scouted: stats.scouted, 
            enforced: stats.enforced, 
            resolvedNum: stats.resolved,
            resolvedRate: resRate, 
            wBurndown: wBurndown, 
            uwBurndown: uwBurndown,
            daysReported: stats.activeDays.size
        };
    }).sort((a, b) => b.urls - a.urls);

    const platformTotals = Object.keys(platformStats).map(k => {
        return { 
            name: k, 
            reports: platformStats[k].reports, 
            urls: platformStats[k].urls 
        };
    }).sort((a, b) => b.reports - a.reports);

    const topPirates = Object.keys(handleStats).map(k => {
        return {
            handle: k,
            reports: handleStats[k].reports,
            urls: handleStats[k].urls,
             platforms: handleStats[k].platforms.size > 0 ? Array.from(handleStats[k].platforms).join(', ') : "Unknown"
        };
    }).sort((a, b) => b.urls - a.urls);

    const topPiratesByPlatform = {};
    Object.keys(platformPirates).forEach(plat => {
        topPiratesByPlatform[plat] = Object.keys(platformPirates[plat]).map(h => ({
            handle: h,
            urls: platformPirates[plat][h].urls,
            reports: platformPirates[plat][h].reports
        })).sort((a, b) => b.urls - a.urls);
    });

    const eventViews = Object.keys(eventViewStats).map(k => {
        return {
            name: k,
            views: eventViewStats[k],
            formattedViews: normalize2k(eventViewStats[k])
        };
    }).sort((a, b) => b.views - a.views);

    const globalWeightedBurndown = globalResolvedCalcCount > 0 ? (globalWeightedDaysSum / globalResolvedCalcCount).toFixed(1) : 'N/A';
    const globalUnweightedBurndown = globalTotalCalcCount > 0 ? (globalUnweightedDaysSum / globalTotalCalcCount).toFixed(1) : 'N/A';
    const finalResolvedRate = totalReported > 0 ? Math.round((totalResolved / totalReported) * 100) + '%' : '0%';
    const globalUnweightedResolved = totalResolved - globalResolvedCalcCount;

    return {
        totalReported: normalize2k(totalReported),
        rawReportedNum: totalReported,
        totalResolved: normalize2k(totalResolved),
        rawResolvedNum: totalResolved,
        globalWeightedResolvedNum: globalResolvedCalcCount,
        globalUnweightedResolvedNum: Math.max(0, globalUnweightedResolved),
        totalUrls: normalize2k(totalUrls),
        totalEstimatedViews: normalize2k(totalEstimatedViews),
        resolvedRate: finalResolvedRate,
        globalWeightedBurndown: globalWeightedBurndown,
        globalUnweightedBurndown: globalUnweightedBurndown,
        platformTotals: platformTotals,
        topScouts: sortObj(scoutCounts).slice(0, 5),
        topEnforcers: sortObj(enforcerCounts).slice(0, 5),
        topPirates: topPirates,
        topPiratesByPlatform: topPiratesByPlatform,
        topEvents: sortObj(eventCounts).slice(0, 10),
        eventViews: eventViews,
        timelineData: timelineData,
        teamStats: teamStats,
        mvp: mvp,
        startDate: startDateStr,
        endDate: endDateStr
    };
}