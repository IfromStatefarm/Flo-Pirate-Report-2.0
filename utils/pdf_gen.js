import * as jsPDFModule from '../lib/jspdf.umd.min.js';

// --- HELPER: Resolve jsPDF Constructor ---
function getJsPdfConstructor() {
    let jsPDF = null;
    
    if (jsPDFModule && typeof jsPDFModule.jsPDF === 'function') {
        jsPDF = jsPDFModule.jsPDF;
    } else if (jsPDFModule && typeof jsPDFModule.default === 'function') {
        jsPDF = jsPDFModule.default;
    } else if (jsPDFModule && jsPDFModule.default && typeof jsPDFModule.default.jsPDF === 'function') {
        jsPDF = jsPDFModule.default.jsPDF;
    } else if (typeof globalThis !== 'undefined' && globalThis.jspdf && typeof globalThis.jspdf.jsPDF === 'function') {
        jsPDF = globalThis.jspdf.jsPDF;
    } else if (typeof self !== 'undefined' && self.jspdf && typeof self.jspdf.jsPDF === 'function') {
        jsPDF = self.jspdf.jsPDF;
    } else if (typeof window !== 'undefined' && window.jspdf && typeof window.jspdf.jsPDF === 'function') {
        jsPDF = window.jspdf.jsPDF;
    } else if (typeof globalThis !== 'undefined' && typeof globalThis.jsPDF === 'function') {
        jsPDF = globalThis.jsPDF;
    } else if (typeof self !== 'undefined' && typeof self.jsPDF === 'function') {
        jsPDF = self.jsPDF;
    }

    if (typeof jsPDF !== 'function') {
        console.error("jsPDF Import Debug - Module:", jsPDFModule, "Global:", typeof globalThis !== 'undefined' ? globalThis.jspdf : null); 
        throw new Error("jsPDF library not loaded correctly - Constructor not found");
    }
    return jsPDF;
}

export async function generatePDF(data) {
  try {
    const jsPDF = getJsPdfConstructor();
    
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = 20;

    // --- PAGINATION HELPERS ---
    const ensureSpace = (neededSpace) => {
        if (y + neededSpace > pageHeight - margin) {
            doc.addPage();
            y = margin + 5; 
            return true;
        }
        return false;
    };

    const drawWrappedText = (text, x, maxWidth, paddingBottom = 5) => {
        const lines = doc.splitTextToSize(text, maxWidth);
        const lineHeight = doc.getFontSize() * 0.4; 
        const textBlockHeight = lines.length * lineHeight;
        ensureSpace(textBlockHeight);
        doc.text(lines, x, y);
        y += textBlockHeight + paddingBottom;
    };

    const drawTableHeader = () => {
        doc.setFontSize(10);
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, y - 5, pageWidth - (margin * 2), 8, 'F');
        doc.setFont("helvetica", "bold");
        doc.text("URL", margin + 2, y);
        doc.text("VIEWS", margin + 110, y);
        doc.text("SCREENSHOT", margin + 140, y);
        doc.setFont("helvetica", "normal");
        y += 8;
    };

    // --- TITLE ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(206, 14, 45); 
    doc.text("FLO PIRACY REPORT", pageWidth / 2, y, { align: "center" });
    y += 15;

    // --- HEADER INFO ---
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(18);
    doc.text(`INFRINGER: @${data.handle}`, margin, y);
    y += 10;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    const dateStr = new Date().toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' });
    doc.text(`DATE: ${dateStr}`, margin, y);
    y += 6;
    doc.text(`REPORTER: ${data.reporterName}`, margin, y);
    y += 12;

    // --- METADATA ---
    doc.setDrawColor(200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 8;
    
    doc.setFont("helvetica", "bold");
    doc.text("EVENT:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(data.eventName, margin + 25, y);
    
    doc.setFont("helvetica", "bold");
    doc.text("VERTICAL:", margin + 90, y);
    doc.setFont("helvetica", "normal");
    doc.text(data.vertical, margin + 115, y);
    y += 12;

    // --- EVIDENCE TABLE ---
    ensureSpace(20); 
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("INFRINGING URLS & EVIDENCE", margin, y);
    y += 8;

    drawTableHeader();
    
    let totalViews = 0;

    if (data.items && Array.isArray(data.items)) {
        data.items.forEach((item, index) => {
            let viewCount = 0;
            if (item.views && item.views !== "N/A" && item.views !== "PENDING" && item.views !== "DELETED") {
                const v = String(item.views).toLowerCase();
                if(v.includes('k')) viewCount = parseFloat(v) * 1000;
                else if(v.includes('m')) viewCount = parseFloat(v) * 1000000;
                else viewCount = parseFloat(v.replace(/,/g, '')) || 0;
            }
            totalViews += viewCount;

            let displayUrl = item.url.length > 55 ? item.url.substring(0, 52) + "..." : item.url;

            if (ensureSpace(10)) drawTableHeader();

            doc.text(displayUrl, margin + 2, y);
            doc.text(String(item.views || "N/A"), margin + 110, y);
            
            if (item.screenshotLink && item.screenshotLink.startsWith('http')) {
                doc.setTextColor(0, 0, 255);
                doc.textWithLink("View Evidence", margin + 140, y, { url: item.screenshotLink });
                doc.setTextColor(0, 0, 0);
            } else {
                doc.setTextColor(150);
                doc.text("No Image", margin + 140, y);
                doc.setTextColor(0);
            }
            
            y += 7;
        });
    }

    ensureSpace(20); 
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.text(`TOTAL VIEWS AFFECTED: ${totalViews.toLocaleString()}`, margin, y);
    y += 10;
    doc.line(margin, y, pageWidth - margin, y);
    y += 15;

    // --- CEASE & DESIST LETTER ---
    ensureSpace(30); 

    const reportId = data.reportId || `FS-${Math.floor(Math.random()*10000)}`;
    const fullDate = new Date().toLocaleDateString("en-US", { year: 'numeric', month: 'long', day: 'numeric' });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("FORMAL NOTICE OF COPYRIGHT INFRINGEMENT", pageWidth / 2, y, { align: "center" });
    y += 12;

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`TO: @${data.handle}`, margin, y); y += 5;
    doc.text(`DATE: ${fullDate}`, margin, y); y += 5;
    doc.text(`NOTICE ID: ${reportId}`, margin, y); y += 10;

    drawWrappedText("RE: IMMEDIATE CEASE AND DESIST – UNAUTHORIZED DISTRIBUTION OF FLOSPORTS PROPRIETARY CONTENT", margin, pageWidth - (margin * 2), 10);

    doc.setFont("helvetica", "normal");
    const p1 = "This notice is served by FloSports, Inc. to formally notify you that your social media account is in direct violation of the Digital Millennium Copyright Act (DMCA) and governing intellectual property laws.";
    drawWrappedText(p1, margin, pageWidth - (margin * 2), 6);

    const p2 = "FloSports has documented the unauthorized use of its copyrighted broadcast material on your profile. This content is the exclusive property of FloSports, and no license or permission has been granted for its redistribution, public performance, or display.";
    drawWrappedText(p2, margin, pageWidth - (margin * 2), 10);

    ensureSpace(25);
    doc.setFont("helvetica", "bold");
    doc.text("MANDATORY REQUIREMENTS:", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text("Effective immediately, you are required to:", margin, y);
    y += 6;
    
    drawWrappedText("1. CEASE all live streaming, uploading, or linking to FloSports proprietary content.", margin + 5, pageWidth - (margin * 2) - 5, 3);
    drawWrappedText("2. REMOVE all existing infringing materials from your account history and archives.", margin + 5, pageWidth - (margin * 2) - 5, 3);
    drawWrappedText("3. DESIST from any future use of FloSports intellectual property.", margin + 5, pageWidth - (margin * 2) - 5, 8);

    ensureSpace(30);
    doc.setFont("helvetica", "bold");
    doc.text("ENFORCEMENT ACTION:", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const p3 = "This is your final notice. We have logged your account information and documented the infringing activity. Failure to comply immediately will result in:";
    drawWrappedText(p3, margin, pageWidth - (margin * 2), 6);

    const bullets = [
        "Formal Takedown Requests submitted to the platform's legal department, which typically results in immediate content removal and permanent account suspension.",
        "Escalation to Legal Counsel for the recovery of statutory damages and legal fees associated with these infringements."
    ];
    bullets.forEach(b => {
        drawWrappedText("• " + b, margin + 5, pageWidth - (margin * 2) - 5, 4);
    });
    
    y += 2;
    const p4 = "This is a notice of violation. No response is required provided that all infringing content is removed immediately and no further violations occur.";
    drawWrappedText(p4, margin, pageWidth - (margin * 2), 15);

    ensureSpace(35);
    doc.setFont("helvetica", "bold");
    doc.text("Authorized Representative of FloSports", margin, y); y += 5;
    doc.setFont("helvetica", "normal");
    doc.text("301 Congress Ave #1500", margin, y); y += 5;
    doc.text("Austin, TX 78701", margin, y); y += 5;
    doc.text("Primary Contact: copyright@flosports.tv", margin, y); y += 5;
    doc.text("Secondary Contact: social@flosports.tv", margin, y); y += 5;
    doc.text("Phone: 512-270-2356", margin, y);

    return doc.output('blob');

  } catch (error) {
    console.error("PDF Gen Failed, using Text fallback:", error);
    
    const textContent = `
    FLO PIRACY REPORT (FALLBACK TEXT VERSION)
    --------------------------------------------------
    INFRINGER: @${data.handle}
    DATE: ${new Date().toLocaleString()}
    REPORT ID: ${data.reportId || "Unknown"}
    REPORTER: ${data.reporterName}
    
    EVENT: ${data.eventName}
    VERTICAL: ${data.vertical}
    
    INFRINGING URLS:
    ${data.items ? data.items.map(i => `- ${i.url} (Views: ${i.views}) [Evidence: ${i.screenshotLink || "N/A"}]`).join('\n') : "No items."}
    
    --------------------------------------------------
    FORMAL NOTICE OF COPYRIGHT INFRINGEMENT
    
    This notice is served by FloSports, Inc. to formally notify you that your social media account is in direct violation of the Digital Millennium Copyright Act (DMCA).
    
    MANDATORY REQUIREMENTS:
    1. CEASE all live streaming/uploading of FloSports content.
    2. REMOVE all infringing materials immediately.
    3. DESIST from future use.
    
    Authorized Representative of FloSports
    301 Congress Ave #1500, Austin, TX 78701
    copyright@flosports.tv
    `;
    
     return new Blob([textContent], { type: 'text/plain' });
  }
}

// ==========================================
// TACTICAL INTELLIGENCE BRIEFING (PDF)
// ==========================================

export async function generateIntelligencePDF(stats) {
  try {
    const syncData = await chrome.storage.sync.get(['briefing_config']);
    const defaultStats = {
        kpi_total_takedowns: true, kpi_takedowns_platform: true, kpi_total_urls: true, kpi_urls_platform: true,
        kpi_resolved_num_unweighted: true, kpi_resolved_num_weighted: true, kpi_resolved_pct_unweighted: true, kpi_resolved_pct_weighted: true,
        kpi_burndown_weighted: true, kpi_burndown_unweighted: true,
        leaderboard_mvp: true, leaderboard_top_3: true, leaderboard_top_5: true, leaderboard_last_3: false,
        timeline_report: true, platform_breakdown: true,
        targets_top_1: true, targets_top_5: true, targets_top_platform_1: true, targets_top_platform_3: false,
        team_col_scout: true, team_col_enforced: true, team_col_urls_resolved_num: true, team_col_urls_resolved_pct: true, team_col_burndown_rate: true, team_col_days_reported: true,
        events_top_5: true, events_top_10: true, events_top_5_pct: false, events_top_10_pct: false,
        appx_team_all: true, appx_team_half: false, appx_events_all: true, appx_events_half: false
    };
    
    const config = { ...defaultStats, ...(syncData.briefing_config || {}) };
    const jsPDF = getJsPdfConstructor();

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const maxTextWidth = pageWidth - (margin * 2);
    let y = 0;

    // --- REUSABLE PDF HELPERS (Closures) ---
    const ensureSpace = (neededSpace) => {
        if (y + neededSpace > pageHeight - margin) {
            doc.addPage();
            y = margin + 10;
            return true;
        }
        return false;
    };

    const getTeamCols = () => {
        const teamCols = [];
        teamCols.push({ header: "MEMBER", width: 45, val: (m) => m.name || "Unknown" });
        if (config.team_col_scout) teamCols.push({ header: "SCOUT", width: 18, val: (m) => String(m.scouted || 0) });
        if (config.team_col_enforced) teamCols.push({ header: "ENFORCE", width: 22, val: (m) => String(m.enforced || 0) });
        if (config.team_col_urls_resolved_num) teamCols.push({ header: "RES(#)", width: 18, val: (m) => String(m.resolvedNum || 0) });
        if (config.team_col_urls_resolved_pct) teamCols.push({ header: "RES(%)", width: 18, val: (m) => String(m.resolvedRate || "0%") });
        if (config.team_col_burndown_rate) teamCols.push({ header: "BURN(W/UW)", width: 30, val: (m) => `${m.wBurndown}d / ${m.uwBurndown}d` });
        if (config.team_col_days_reported) teamCols.push({ header: "DAYS", width: 15, val: (m) => String(m.daysReported || 0) });
        return teamCols;
    };

    const drawTeamTable = (limit, title, includeToc = false) => {
        if (includeToc) tocEntries.push({ title: title, page: doc.internal.getCurrentPageInfo().pageNumber, y: y });
        ensureSpace(35);
        doc.setTextColor(17, 24, 39);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(title, margin, y);
        y += 8;

        const teamCols = getTeamCols();
        doc.setFillColor(229, 231, 235);
        doc.rect(margin, y, maxTextWidth, 8, 'F');
        doc.setFontSize(9);
        let cX = margin + 2;
        teamCols.forEach(col => { doc.text(col.header, cX, y + 6); cX += col.width; });
        y += 12;

        doc.setFont("helvetica", "normal");
        const list = stats.teamStats || [];
        if (list.length > 0) {
            list.slice(0, limit).forEach((member, i) => {
                ensureSpace(10);
                // Striping: alternating light gray / white
                if (i % 2 !== 0) {
                    doc.setFillColor(249, 250, 251); 
                    doc.rect(margin, y - 6, maxTextWidth, 8, 'F');
                }
                
                let rowX = margin + 2;
                teamCols.forEach(col => {
                    let val = String(col.val(member));
                    // Aggressively prevent spilling
                    if (col.header === "MEMBER" && val.length > 20) val = val.substring(0, 17) + "...";
                    doc.setTextColor(17, 24, 39); // Enforce black text
                    doc.text(val, rowX, y);
                    rowX += col.width;
                });
                
                doc.setDrawColor(243, 244, 246);
                doc.line(margin, y + 2, pageWidth - margin, y + 2);
                y += 8;
            });
        } else {
            doc.text("No team data identified.", margin + 2, y);
            y += 10;
        }
        y += 5;
    };

    const drawEventsTable = (limit, title, includeToc = false) => {
        if (includeToc) tocEntries.push({ title: title, page: doc.internal.getCurrentPageInfo().pageNumber, y: y });
        ensureSpace(35);
        doc.setTextColor(17, 24, 39);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(title, margin, y);
        y += 8;

        doc.setFillColor(229, 231, 235);
        doc.rect(margin, y, maxTextWidth, 8, 'F');
        doc.setFontSize(9);
        doc.text("EVENT NAME", margin + 2, y + 6);
        doc.text("ESTIMATED VIEWS", margin + 150, y + 6);
        y += 12;

        doc.setFont("helvetica", "normal");
        const list = stats.eventViews || [];
        if (list.length > 0) {
            list.slice(0, limit).forEach((ev, i) => {
                ensureSpace(10);
                // Striping: alternating light gray / white
                if (i % 2 !== 0) {
                    doc.setFillColor(249, 250, 251); 
                    doc.rect(margin, y - 6, maxTextWidth, 8, 'F');
                }
                
                let displayEventName = String(ev.name || "Unknown");
                // Aggressive truncation for large scraped URLs representing names
                if (displayEventName.length > 55) displayEventName = displayEventName.substring(0, 52) + "...";
                
                doc.setTextColor(17, 24, 39); // Enforce black text
                doc.text(displayEventName, margin + 2, y);
                
                const safeEventViews = (isNaN(ev.views) || ev.views === 0) ? "100" : Number(ev.views).toLocaleString();
                doc.text(safeEventViews, margin + 150, y);
                
                doc.setDrawColor(243, 244, 246);
                doc.line(margin, y + 2, pageWidth - margin, y + 2);
                y += 8;
            });
        } else {
            doc.text("No event view data identified.", margin + 2, y);
            y += 10;
        }
        y += 5;
    };

    const drawTargetsTable = (limit, title) => {
        ensureSpace(35);
        doc.setTextColor(17, 24, 39);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(title, margin, y);
        y += 8;

        doc.setFillColor(229, 231, 235);
        doc.rect(margin, y, maxTextWidth, 8, 'F');
        doc.setFontSize(9);
        doc.text("PIRATE HANDLE", margin + 2, y + 6);
        doc.text("PLATFORMS", margin + 70, y + 6);
        doc.text("URLS", margin + 115, y + 6);
        doc.text("REPORTS", margin + 150, y + 6);
        y += 12;

        doc.setFont("helvetica", "normal");
        const list = stats.topPirates || [];
        if (list.length > 0) {
            list.slice(0, limit).forEach((pirate, i) => {
                ensureSpace(10);
                // Striping
                if (i % 2 !== 0) {
                    doc.setFillColor(249, 250, 251); 
                    doc.rect(margin, y - 6, maxTextWidth, 8, 'F');
                }
                
                // Aggressive truncation limits to prevent horizontal column overlap
                let displayHandle = `@${pirate.handle}`;
                if (displayHandle.length > 30) displayHandle = displayHandle.substring(0, 27) + "...";
                let displayPlatform = String(pirate.platforms || "Unknown");
                if (displayPlatform.length > 18) displayPlatform = displayPlatform.substring(0, 15) + "...";
                
                doc.setTextColor(17, 24, 39);
                doc.text(displayHandle, margin + 2, y);
                doc.text(displayPlatform, margin + 70, y);
                doc.text(String(pirate.urls), margin + 115, y);
                doc.text(String(pirate.reports), margin + 150, y);
                
                doc.setDrawColor(243, 244, 246);
                doc.line(margin, y + 2, pageWidth - margin, y + 2);
                y += 8;
            });
        } else {
            doc.text("No targets identified.", margin + 2, y);
        }
        y += 10;
    };

    const drawPlatTargetsTable = (limit, title) => {
        ensureSpace(35);
        doc.setTextColor(17, 24, 39);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(title, margin, y);
        y += 8;

        if (stats.topPiratesByPlatform) {
            Object.keys(stats.topPiratesByPlatform).forEach(plat => {
                 ensureSpace(20);
                 doc.setFillColor(229, 231, 235);
                 doc.rect(margin, y, maxTextWidth, 6, 'F');
                 doc.setFontSize(9);
                 doc.setFont("helvetica", "bold");
                 doc.text(plat.toUpperCase(), margin + 2, y + 4.5);
                 y += 10;

                 doc.setFont("helvetica", "normal");
                 const list = stats.topPiratesByPlatform[plat] || [];
                 if (list.length === 0) {
                     doc.text("None found.", margin + 2, y);
                     y += 6;
                 } else {
                     list.slice(0, limit).forEach((pirate, i) => {
                         ensureSpace(8);
                         if (i % 2 !== 0) {
                             doc.setFillColor(249, 250, 251); 
                             doc.rect(margin, y - 5, maxTextWidth, 7, 'F');
                         }
                         
                         let displayHandle = `@${pirate.handle}`;
                         if (displayHandle.length > 45) displayHandle = displayHandle.substring(0, 42) + "...";
                         
                         doc.setTextColor(17, 24, 39);
                         doc.text(displayHandle, margin + 2, y);
                         doc.text(`${pirate.urls} URLs`, margin + 115, y);
                         doc.text(`${pirate.reports} Reports`, margin + 150, y);
                         y += 6;
                     });
                 }
                 y += 4;
            });
        } else {
            doc.text("No platform targets identified.", margin + 2, y);
            y += 10;
        }
        y += 5;
    };

    const drawSquadList = (limit, title, bottom = false) => {
        ensureSpace(35);
        doc.setTextColor(17, 24, 39);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text(`ELITE SQUAD (${title}): SCOUTS`, margin, y);
        doc.text(`ELITE SQUAD (${title}): ENFORCERS`, pageWidth / 2 + 5, y);
        y += 8;

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        
        const sLen = (stats.topScouts || []).length;
        const eLen = (stats.topEnforcers || []).length;

        for (let i = 0; i < limit; i++) {
            let scout, enforcer;
            if (bottom) {
                scout = stats.topScouts?.[sLen - 1 - i] || { name: "-", count: 0 };
                enforcer = stats.topEnforcers?.[eLen - 1 - i] || { name: "-", count: 0 };
            } else {
                scout = stats.topScouts?.[i] || { name: "-", count: 0 };
                enforcer = stats.topEnforcers?.[i] || { name: "-", count: 0 };
            }

            const cap = (n) => n && n !== "-" ? n.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : n;
            
            if (i % 2 !== 0) {
                doc.setFillColor(249, 250, 251);
                doc.rect(margin, y - 5, (maxTextWidth / 2) - 5, 8, 'F');
                doc.rect(pageWidth / 2 + 5, y - 5, (maxTextWidth / 2) - 5, 8, 'F');
            }
            
            doc.setTextColor(17, 24, 39);
            
            let displayScoutName = cap(scout.name);
            if (displayScoutName.length > 20) displayScoutName = displayScoutName.substring(0, 17) + "...";
            let displayEnforcerName = cap(enforcer.name);
            if (displayEnforcerName.length > 20) displayEnforcerName = displayEnforcerName.substring(0, 17) + "...";
            
            doc.text(`${i + 1}. ${displayScoutName} (${scout.count} hits)`, margin + 2, y);
            doc.text(`${i + 1}. ${displayEnforcerName} (${enforcer.count} hits)`, pageWidth / 2 + 7, y);
            y += 8;
        }
        y += 10;
    };


    // --- 1. DARK THEME HEADER ---
    doc.setFillColor(30, 41, 59);
    doc.rect(0, 0, pageWidth, 45, 'F');

    doc.setTextColor(206, 14, 45);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("EXECUTIVE INTELLIGENCE BRIEFING", pageWidth / 2, 22, { align: "center" });

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`REPORTING PERIOD: ${stats.startDate} TO ${stats.endDate}`, pageWidth / 2, 30, { align: "center" });
    doc.text(`REPORT GENERATED: ${new Date().toLocaleString()}`, pageWidth / 2, 36, { align: "center" });
        
    const tocEntries = [];
    
    // Page 1 is now exclusively dedicated to the TOC to prevent any overlap
    // Jump to Page 2 to begin the actual Enforcement Content safely
    doc.addPage();
    y = margin + 10;

    // --- 2. ENFORCEMENT OVERVIEW (Dynamic Grid) ---
    const kpis = [];
    const topPlat = stats.platformTotals[0] || { name: 'N/A', reports: 0, urls: 0 };

    if (config.kpi_total_takedowns) kpis.push({ label: "TOTAL TAKEDOWNS", value: stats.rawReportedNum, desc: "Confirmed Reports Filed" });
    if (config.kpi_takedowns_platform) kpis.push({ label: "TOP PLATFORM (TKDWN)", value: `${topPlat.reports}`, desc: `${topPlat.name} Leads Takedowns` });
    if (config.kpi_total_urls) kpis.push({ label: "TOTAL URLS", value: stats.totalUrls, desc: "Pirated Links Processed" });
    if (config.kpi_urls_platform) kpis.push({ label: "TOP PLATFORM (URLS)", value: `${topPlat.urls}`, desc: `${topPlat.name} Leads URLs` });
    if (config.kpi_resolved_num_unweighted) kpis.push({ label: "RESOLVED (UW)", value: stats.globalUnweightedResolvedNum, desc: "Unweighted Count" });
    if (config.kpi_resolved_num_weighted) kpis.push({ label: "RESOLVED (WGT)", value: stats.globalWeightedResolvedNum, desc: "Weighted Count" });
    if (config.kpi_resolved_pct_unweighted) kpis.push({ label: "RESOLVED % (UW)", value: (stats.rawReportedNum ? Math.round((stats.globalUnweightedResolvedNum / stats.rawReportedNum)*100) : 0) + '%', desc: "Unweighted Rate" });
    if (config.kpi_resolved_pct_weighted) kpis.push({ label: "RESOLVED % (WGT)", value: (stats.rawReportedNum ? Math.round((stats.globalWeightedResolvedNum / stats.rawReportedNum)*100) : 0) + '%', desc: "Weighted Rate" });
    if (config.kpi_burndown_weighted) kpis.push({ label: "BURNDOWN (WGT)", value: stats.globalWeightedBurndown + 'd', desc: "Weighted Average" });
    if (config.kpi_burndown_unweighted) kpis.push({ label: "BURNDOWN (UW)", value: stats.globalUnweightedBurndown + 'd', desc: "Unweighted Average" });

    if (kpis.length > 0) {
        ensureSpace(40);
        tocEntries.push({ title: "Enforcement Overview", page: doc.internal.getCurrentPageInfo().pageNumber, y: y });
        doc.setTextColor(17, 24, 39);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text("ENFORCEMENT OVERVIEW", margin, y);
        y += 10;

        const gap = 5;
        const cols = 3;
        const boxWidth = (maxTextWidth - (gap * (cols - 1))) / cols;
        let kpiCount = 0;

        kpis.forEach((kpi) => {
            if (kpiCount > 0 && kpiCount % cols === 0) {
                y += 30;
                ensureSpace(35);
            }
            const colIndex = kpiCount % cols;
            const boxX = margin + (colIndex * (boxWidth + gap));
            
            doc.setFillColor(243, 244, 246);
            doc.setDrawColor(209, 213, 219);
            doc.rect(boxX, y, boxWidth, 26, 'FD');

            doc.setTextColor(107, 114, 128);
            doc.setFontSize(8);
            doc.setFont("helvetica", "bold");
            doc.text(kpi.label, boxX + (boxWidth / 2), y + 6, { align: "center" });

            doc.setTextColor(17, 24, 39);
            doc.setFontSize(14);
            doc.text(String(kpi.value), boxX + (boxWidth / 2), y + 15, { align: "center" });

            doc.setTextColor(156, 163, 175);
            doc.setFontSize(7);
            doc.setFont("helvetica", "normal");
            doc.text(kpi.desc, boxX + (boxWidth / 2), y + 22, { align: "center" });

            kpiCount++;
        });
        y += 35;
    }

    // --- 3. LEADERBOARDS & MVP ---
    if (config.leaderboard_mvp || config.leaderboard_top_3 || config.leaderboard_top_5 || config.leaderboard_last_3) {
        ensureSpace(30);
        tocEntries.push({ title: "Leaderboards & MVP", page: doc.internal.getCurrentPageInfo().pageNumber, y: y });
        
        if (config.leaderboard_mvp) {
            ensureSpace(25);
            doc.setFillColor(254, 243, 199); 
            doc.setDrawColor(251, 191, 36); 
            doc.rect(margin, y, maxTextWidth, 16, 'FD');

            doc.setTextColor(146, 64, 14);
            doc.setFontSize(12);
            doc.setFont("helvetica", "bold");
            const mvpName = stats.mvp ? stats.mvp.name.toUpperCase() : "N/A";
            const mvpTotal = stats.mvp ? stats.mvp.total : 0;
            doc.text(`SQUAD MVP: ${mvpName} (${mvpTotal} Confirmed Actions)`, pageWidth / 2, y + 10, { align: "center" });
            y += 28;
        }

        if (config.leaderboard_top_3) drawSquadList(3, "TOP 3", false);
        if (config.leaderboard_top_5) drawSquadList(5, "TOP 5", false);
        if (config.leaderboard_last_3) drawSquadList(3, "BOTTOM 3", true);
    }

    // --- 4. VECTOR GRAPHICS: TIMELINE ---
    if (config.timeline_report) {
        ensureSpace(70);
        tocEntries.push({ title: "Reports Per Day (Timeline)", page: doc.internal.getCurrentPageInfo().pageNumber, y: y });
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("REPORTS PER DAY (TIMELINE)", margin, y);
        y += 8;

        const gHeight = 45;
        doc.setFillColor(249, 250, 251);
        doc.setDrawColor(229, 231, 235);
        doc.rect(margin, y, maxTextWidth, gHeight, 'FD');

        if (stats.timelineData && Object.keys(stats.timelineData).length > 0) {
            const dates = Object.keys(stats.timelineData).sort((a, b) => new Date(a) - new Date(b));
            const counts = dates.map(d => {
                const val = stats.timelineData[d];
                return typeof val === 'object' ? val.count : val;
            });
            
            const maxCount = Math.max(...counts, 10); 
            const stepX = maxTextWidth / Math.max(dates.length, 1);
            
            const firstDate = new Date(dates[0]);
            const lastDate = new Date(dates[dates.length - 1]);
            let monthsSpan = 0;
            if (!isNaN(firstDate.getTime()) && !isNaN(lastDate.getTime())) {
                monthsSpan = (lastDate.getFullYear() - firstDate.getFullYear()) * 12 + (lastDate.getMonth() - firstDate.getMonth());
            }
            
            let requiredInterval = 0;
            if (monthsSpan > 6 && monthsSpan <= 12) requiredInterval = 1;
            else if (monthsSpan > 12 && monthsSpan <= 36) requiredInterval = 2;
            else if (monthsSpan > 36) requiredInterval = Math.floor(monthsSpan / 12);

            const labelStep = Math.ceil(dates.length / 8);

            doc.setTextColor(156, 163, 175);
            doc.setFontSize(7);
            doc.setFont("helvetica", "normal");
            
            const topY = y + 10;
            const midY = y + 10 + ((gHeight - 15) / 2);
            const bottomY = y + gHeight - 5;

            doc.text(String(maxCount), margin - 2, topY, { align: "right" });
            doc.text(String(Math.round(maxCount / 2)), margin - 2, midY, { align: "right" });
            doc.text("0", margin - 2, bottomY, { align: "right" });

            doc.setDrawColor(229, 231, 235);
            doc.setLineWidth(0.2);
            doc.line(margin, topY, margin + maxTextWidth, topY);
            doc.line(margin, midY, margin + maxTextWidth, midY);

            doc.setDrawColor(206, 14, 45); 
            doc.setFillColor(206, 14, 45);
            doc.setLineWidth(1);

            let prevX = null;
            let prevY = null;
            let lastPrintedMonthDate = new Date(0);
            let lastLabelX = -999; 

            dates.forEach((dateStr, i) => {
                const count = counts[i];
                const ptX = margin + (i * stepX) + (stepX / 2);
                const ptY = (y + gHeight) - ((count / maxCount) * (gHeight - 15)) - 5;

                if (prevX !== null && prevY !== null) {
                    doc.line(prevX, prevY, ptX, ptY); 
                }
                doc.circle(ptX, ptY, 1.5, 'FD'); 

                let shouldPrintLabel = false;
                let displayLabel = dateStr;
                const currDate = new Date(dateStr);

                if (monthsSpan > 6 && !isNaN(currDate.getTime())) {
                    const monthDiff = (currDate.getFullYear() - lastPrintedMonthDate.getFullYear()) * 12 + (currDate.getMonth() - lastPrintedMonthDate.getMonth());
                    if (monthDiff >= requiredInterval || i === dates.length - 1) {
                        shouldPrintLabel = true;
                        lastPrintedMonthDate = currDate;
                        displayLabel = currDate.toLocaleDateString("en-US", { month: 'short', year: '2-digit' });
                    }
                } else if (i % labelStep === 0 || i === dates.length - 1) {
                    shouldPrintLabel = true;
                    if (!isNaN(currDate.getTime())) {
                        displayLabel = currDate.toLocaleDateString("en-US", { month: 'numeric', day: 'numeric' });
                    }
                }

                if (shouldPrintLabel) {
                    if (ptX - lastLabelX > 14 || i === 0) {
                        doc.setTextColor(107, 114, 128);
                        doc.setFontSize(8);
                        doc.setFont("helvetica", "normal");
                        doc.text(displayLabel, ptX, y + gHeight + 5, { align: "center" });
                        lastLabelX = ptX;
                    }
                }

                prevX = ptX;
                prevY = ptY;
            });
            doc.setLineWidth(0.2); 
        } else {
            doc.setTextColor(156, 163, 175);
            doc.setFont("helvetica", "normal");
            doc.text("Insufficient data to plot timeline.", pageWidth / 2, y + (gHeight / 2), { align: "center" });
         }
        y += gHeight + 15;
    }

    // --- 4.5 PLATFORM BREAKDOWN ---
     if (config.platform_breakdown) {
        ensureSpace(30);
        doc.setTextColor(17, 24, 39);
        doc.setFontSize(12);
        doc.setFont("helvetica", "bold");
        doc.text("PLATFORM BREAKDOWN", margin, y);
        y += 8;
        
        if (stats.platformTotals && stats.platformTotals.length > 0) {
            let pX = margin;
            let pY = y;
            const tagHeight = 8;
            
            doc.setFontSize(9);
            stats.platformTotals.forEach((p) => {
                const text = `${p.name}: ${p.reports || 0} Reports / ${p.urls || 0} URLs`; 
                const tagWidth = (text.length * 2) + 8;
                
                if (pX + tagWidth > pageWidth - margin) {
                    pX = margin;
                    pY += tagHeight + 4;
                }
                
                doc.setFillColor(243, 244, 246);
                doc.setDrawColor(209, 213, 219);
                doc.rect(pX, pY, tagWidth, tagHeight, 'FD');
                
                doc.setTextColor(17, 24, 39);
                doc.setFont("helvetica", "bold");
                doc.text(text, pX + 4, pY + 5.5);
                
                pX += tagWidth + 4;
            });
            y = pY + tagHeight + 15; 
        } else {
            doc.setFontSize(10);
            doc.setFont("helvetica", "normal");
            doc.text("No platform data identified.", margin, y);
            y += 15;
        }
    }

    // --- 5. HIGH-VALUE TARGETS ---
    if (config.targets_top_1 || config.targets_top_5 || config.targets_top_platform_1 || config.targets_top_platform_3) {
        tocEntries.push({ title: "High-Value Targets", page: doc.internal.getCurrentPageInfo().pageNumber, y: y });
        
        if (config.targets_top_1) drawTargetsTable(1, "HIGH-VALUE TARGETS (TOP PIRATE)");
        if (config.targets_top_5) drawTargetsTable(5, "HIGH-VALUE TARGETS (TOP 5 PIRATES)");
        if (config.targets_top_platform_1) drawPlatTargetsTable(1, "TARGETS BY PLATFORM (TOP 1)");
        if (config.targets_top_platform_3) drawPlatTargetsTable(3, "TARGETS BY PLATFORM (TOP 3)");
    }

    // --- 6. TEAM PERFORMANCE (RANKED) ---
    const showTeamTable = config.team_col_scout || config.team_col_enforced || config.team_col_urls_resolved_num || config.team_col_urls_resolved_pct || config.team_col_burndown_rate || config.team_col_days_reported;

    if (showTeamTable) {
        drawTeamTable(20, "TEAM PERFORMANCE RANKINGS (TOP 20)", true);
    }

    // --- 7. EVENT VIEW ANALYSIS ---
    if (config.events_top_5 || config.events_top_10 || config.events_top_5_pct || config.events_top_10_pct) {
        
        if (config.events_top_5) drawEventsTable(5, "EVENT VIEW ANALYSIS (TOP 5)", true);
        if (config.events_top_10) drawEventsTable(10, "EVENT VIEW ANALYSIS (TOP 10)", true);
        
        const totalEvents = stats.eventViews ? stats.eventViews.length : 0;
        if (config.events_top_5_pct) drawEventsTable(Math.max(1, Math.ceil(totalEvents * 0.05)), "EVENT VIEW ANALYSIS (TOP 5%)", true);
        if (config.events_top_10_pct) drawEventsTable(Math.max(1, Math.ceil(totalEvents * 0.10)), "EVENT VIEW ANALYSIS (TOP 10%)", true);
    }

     // --- 9 & 10. APPENDIX ---
    if (config.appx_team_all || config.appx_team_half || config.appx_events_all || config.appx_events_half) {
        doc.addPage();
        y = margin + 10;
        
        if (config.appx_team_all) {
            tocEntries.push({ title: "Appendix: Complete Team (All)", page: doc.internal.getCurrentPageInfo().pageNumber, y: y });
            drawTeamTable(stats.teamStats ? stats.teamStats.length : 0, "APPENDIX: COMPLETE TEAM PERFORMANCE (ALL)", false);
        }
        
        if (config.appx_team_half) {
            tocEntries.push({ title: "Appendix: Complete Team (Half)", page: doc.internal.getCurrentPageInfo().pageNumber, y: y });
            drawTeamTable(stats.teamStats ? Math.ceil(stats.teamStats.length / 2) : 0, "APPENDIX: COMPLETE TEAM PERFORMANCE (HALF)", false);
        }

        if (config.appx_events_all) {
            tocEntries.push({ title: "Appendix: Event Views (All)", page: doc.internal.getCurrentPageInfo().pageNumber, y: y });
            drawEventsTable(stats.eventViews ? stats.eventViews.length : 0, "APPENDIX: EVENT VIEW ANALYSIS (ALL)", false);
        }

        if (config.appx_events_half) {
            tocEntries.push({ title: "Appendix: Event Views (Half)", page: doc.internal.getCurrentPageInfo().pageNumber, y: y });
            drawEventsTable(stats.eventViews ? Math.ceil(stats.eventViews.length / 2) : 0, "APPENDIX: EVENT VIEW ANALYSIS (HALF)", false);
        }
    }

    // --- DRAW TABLE OF CONTENTS (Page 1) ---
    doc.setPage(1);
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("TABLE OF CONTENTS", margin, 60);
    
    let currentTocY = 72;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    
    tocEntries.forEach((entry, index) => {
        doc.setTextColor(0, 0, 255); 
        doc.textWithLink(`${index + 1}. ${entry.title}`, margin, currentTocY, { pageNumber: entry.page });
        doc.textWithLink(`Page ${entry.page}`, pageWidth - margin, currentTocY, { align: "right", pageNumber: entry.page });
        currentTocY += 8;
    });

    // --- PAGE NUMBERS ---
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(156, 163, 175); 
        doc.text(
            `Page ${i} of ${totalPages}`, 
            pageWidth / 2, 
            pageHeight - 10, 
            { align: "center" }
        );
    }
    
    return doc.output('blob');

  } catch (error) {
    console.error("Intelligence PDF Gen Failed:", error);
    return new Blob(["Error generating Intelligence Report. Check extension logs."], { type: 'text/plain' });
  }
}