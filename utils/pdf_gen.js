// utils/pdf_gen.js
import * as jsPDFModule from '../lib/jspdf.umd.min.js';

export async function generatePDF(data) {
  try {
    // Exhaustive Constructor Resolution for UMD/ESM compatibility
    let jsPDF = null;
    
    // 1. Check standard module exports
    if (jsPDFModule && typeof jsPDFModule.jsPDF === 'function') {
        jsPDF = jsPDFModule.jsPDF;
    } else if (jsPDFModule && typeof jsPDFModule.default === 'function') {
        jsPDF = jsPDFModule.default;
    } else if (jsPDFModule && jsPDFModule.default && typeof jsPDFModule.default.jsPDF === 'function') {
        jsPDF = jsPDFModule.default.jsPDF;
    } 
    // 2. Check global scopes (where UMD scripts attach in MV3 Service Workers)
    else if (typeof globalThis !== 'undefined' && globalThis.jspdf && typeof globalThis.jspdf.jsPDF === 'function') {
        jsPDF = globalThis.jspdf.jsPDF;
    } else if (typeof self !== 'undefined' && self.jspdf && typeof self.jspdf.jsPDF === 'function') {
        jsPDF = self.jspdf.jsPDF;
    } else if (typeof globalThis !== 'undefined' && typeof globalThis.jsPDF === 'function') {
        jsPDF = globalThis.jsPDF;
    } else if (typeof self !== 'undefined' && typeof self.jsPDF === 'function') {
        jsPDF = self.jsPDF;
    }

    // Sanity check: Ensure it's a function (constructor)
    if (typeof jsPDF !== 'function') {
        console.error("jsPDF Import Debug - Module:", jsPDFModule, "Global:", typeof globalThis !== 'undefined' ? globalThis.jspdf : null); 
        throw new Error("jsPDF library not loaded correctly - Constructor not found");
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let y = 20;

    // --- PAGINATION HELPERS ---
    
    // Checks if we need a new page before drawing the next element
    const ensureSpace = (neededSpace) => {
        if (y + neededSpace > pageHeight - margin) {
            doc.addPage();
            y = margin + 5; // Reset Y to the top of the new page
            return true;
        }
        return false;
    };

    // Accurately calculates multiline text blocks to prevent overflow
    const drawWrappedText = (text, x, maxWidth, paddingBottom = 5) => {
        const lines = doc.splitTextToSize(text, maxWidth);
        const lineHeight = doc.getFontSize() * 0.4; // Approx height per line in mm
        const textBlockHeight = lines.length * lineHeight;

        ensureSpace(textBlockHeight);
        doc.text(lines, x, y);
        y += textBlockHeight + paddingBottom;
    };

    // Table Header Drawer (Can be called repeatedly if table breaks pages)
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
    doc.setTextColor(206, 14, 45); // FloSports Red
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
    ensureSpace(20); // Make sure we have room for the table header
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("INFRINGING URLS & EVIDENCE", margin, y);
    y += 8;

    drawTableHeader();
    
    let totalViews = 0;

    // Items Loop
    if (data.items && Array.isArray(data.items)) {
        data.items.forEach((item, index) => {
            // Parse views for total
            let viewCount = 0;
            if (item.views && item.views !== "N/A" && item.views !== "PENDING" && item.views !== "DELETED") {
                const v = String(item.views).toLowerCase();
                if(v.includes('k')) viewCount = parseFloat(v) * 1000;
                else if(v.includes('m')) viewCount = parseFloat(v) * 1000000;
                else viewCount = parseFloat(v.replace(/,/g, '')) || 0;
            }
            totalViews += viewCount;

            // Truncate URL for display
            let displayUrl = item.url.length > 55 ? item.url.substring(0, 52) + "..." : item.url;

            // Check space for the row
            if (ensureSpace(10)) {
                // If page broke, redraw the table header on the new page
                drawTableHeader();
            }

            // Add Row
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

    ensureSpace(20); // Check room for the total line
    y += 5;
    doc.setFont("helvetica", "bold");
    doc.text(`TOTAL VIEWS AFFECTED: ${totalViews.toLocaleString()}`, margin, y);
    y += 10;
    doc.line(margin, y, pageWidth - margin, y);
    y += 15;

    // --- CEASE & DESIST LETTER ---
    
    ensureSpace(30); // Need substantial space to start the C&D letter header

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
    
    // --- TEXT FALLBACK ---
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
    let jsPDF = null;
    if (typeof globalThis !== 'undefined' && globalThis.jspdf && typeof globalThis.jspdf.jsPDF === 'function') {
        jsPDF = globalThis.jspdf.jsPDF;
    } else if (typeof window !== 'undefined' && window.jspdf && typeof window.jspdf.jsPDF === 'function') {
        jsPDF = window.jspdf.jsPDF;
    } else if (jsPDFModule && typeof jsPDFModule.jsPDF === 'function') {
        jsPDF = jsPDFModule.jsPDF;
    } else if (jsPDFModule && typeof jsPDFModule.default === 'function') {
        jsPDF = jsPDFModule.default;
    } else {
        throw new Error("jsPDF library not loaded correctly for Intelligence Report");
    }

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const maxTextWidth = pageWidth - (margin * 2);
    let y = 0;

    // --- PAGINATION HELPERS ---
    const ensureSpace = (neededSpace) => {
        if (y + neededSpace > pageHeight - margin) {
            doc.addPage();
            y = margin + 10;
            return true;
        }
        return false;
    };

    const drawWrappedText = (text, x, maxWidth, align = "left") => {
        const lines = doc.splitTextToSize(text, maxWidth);
        const lineHeight = doc.getFontSize() * 0.4;
        const textBlockHeight = lines.length * lineHeight;
        ensureSpace(textBlockHeight);
        doc.text(lines, x, y, { align });
        y += textBlockHeight + 2;
    };

    // --- 1. DARK THEME HEADER ---
    doc.setFillColor(30, 41, 59); // FloSports Dark Gray/Black
    doc.rect(0, 0, pageWidth, 45, 'F');

    doc.setTextColor(206, 14, 45); // FloSports Red
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("EXECUTIVE INTELLIGENCE BRIEFING", pageWidth / 2, 22, { align: "center" });

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`REPORT GENERATED: ${new Date().toLocaleString()}`, pageWidth / 2, 32, { align: "center" });
    y = 60;

    // --- 2. KPI DASHBOARD (3-Column Grid) ---
    ensureSpace(40);
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("ENFORCEMENT OVERVIEW", margin, y);
    y += 10;

    const gap = 5;
    const boxWidth = (maxTextWidth - (gap * 3)) / 4;
    // Calculate a mock Efficiency Score based on volume and resolve rate
    const efficiency = parseInt(stats.resolvedRate) > 0 ? Math.min(100, Math.round(parseInt(stats.resolvedRate) * 1.1)) : 0;

    const kpis = [
      { label: "TOTAL TAKEDOWNS", value: stats.totalReported || "0" },
      { label: "TOTAL URLS", value: stats.totalUrls || "0" },
      { label: "RESOLVED RATE", value: stats.resolvedRate || "0%" },
      { label: "EFFICIENCY SCORE", value: `${efficiency}/100` }
    ];

    kpis.forEach((kpi, i) => {
      const boxX = margin + (i * (boxWidth + gap));
      doc.setFillColor(243, 244, 246); // Light Gray
      doc.setDrawColor(209, 213, 219);
      doc.rect(boxX, y, boxWidth, 22, 'FD');

      doc.setTextColor(107, 114, 128);
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text(kpi.label, boxX + (boxWidth / 2), y + 8, { align: "center" });

      doc.setTextColor(17, 24, 39);
      doc.setFontSize(16);
      doc.text(String(kpi.value), boxX + (boxWidth / 2), y + 17, { align: "center" });
    });
    y += 35;

    // --- 3. LEADERBOARDS & MVP ---
    ensureSpace(50);
    doc.setFillColor(254, 243, 199); // Gold/Amber background
    doc.setDrawColor(251, 191, 36); // Gold border
    doc.rect(margin, y, maxTextWidth, 16, 'FD');

    doc.setTextColor(146, 64, 14);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    const mvpName = stats.mvp ? stats.mvp.name.toUpperCase() : "N/A";
    const mvpTotal = stats.mvp ? stats.mvp.total : 0;
    doc.text(`SQUAD MVP: ${mvpName} (${mvpTotal} Confirmed Actions)`, pageWidth / 2, y + 10, { align: "center" });
    y += 28;

    doc.setTextColor(17, 24, 39);
    doc.setFontSize(12);
    doc.text("ELITE SQUAD: SCOUTS", margin, y);
    doc.text("ELITE SQUAD: ENFORCERS", pageWidth / 2 + 5, y);
    y += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    for (let i = 0; i < 3; i++) {
      const scout = stats.topScouts?.[i] || { name: "-", count: 0 };
      const enforcer = stats.topEnforcers?.[i] || { name: "-", count: 0 };
      
      // Helper to capitalize first and last names
      const cap = (n) => n && n !== "-" ? n.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : n;
      const sName = cap(scout.name);
      const eName = cap(enforcer.name);

      // Subtle Row Backgrounds for Leaderboard
      if (i % 2 === 0) {
          doc.setFillColor(249, 250, 251);
          doc.rect(margin, y - 5, (maxTextWidth / 2) - 5, 8, 'F');
          doc.rect(pageWidth / 2 + 5, y - 5, (maxTextWidth / 2) - 5, 8, 'F');
      }
      
      doc.text(`${i + 1}. ${sName} (${scout.count} hits)`, margin + 2, y);
      doc.text(`${i + 1}. ${eName} (${enforcer.count} hits)`, pageWidth / 2 + 7, y);
      y += 8;
    }
    y += 10;

    // --- 4. VECTOR GRAPHICS: TIMELINE ---
    ensureSpace(70);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("REPORTS PER DAY (TIMELINE)", margin, y);
    y += 8;

    const gHeight = 45;
    doc.setFillColor(249, 250, 251);
    doc.setDrawColor(229, 231, 235);
    doc.rect(margin, y, maxTextWidth, gHeight, 'FD');

    if (stats.timelineData && Object.keys(stats.timelineData).length > 0) {
        // Sort dates chronologically
        const dates = Object.keys(stats.timelineData).sort((a, b) => new Date(a) - new Date(b));
        const counts = dates.map(d => stats.timelineData[d]);
        const maxCount = Math.max(...counts, 10); // Floor max scale at 10
        const stepX = maxTextWidth / Math.max(dates.length, 1);

        doc.setDrawColor(206, 14, 45); // FloSports Red
        doc.setFillColor(206, 14, 45);
        doc.setLineWidth(1);

        let prevX = null;
        let prevY = null;

        dates.forEach((date, i) => {
            const count = counts[i];
            const ptX = margin + (i * stepX) + (stepX / 2);
            // Invert Y axis (higher counts draw higher up)
            const ptY = (y + gHeight) - ((count / maxCount) * (gHeight - 15)) - 5;

            if (prevX !== null && prevY !== null) {
                doc.line(prevX, prevY, ptX, ptY); // Connect the dots
            }
            doc.circle(ptX, ptY, 1.5, 'FD'); // Plot point

            // X-Axis labels (print alternating if too many)
            if (dates.length < 10 || i % 2 === 0) {
                doc.setTextColor(107, 114, 128);
                doc.setFontSize(8);
                doc.setFont("helvetica", "normal");
                doc.text(date, ptX, y + gHeight + 5, { align: "center" });
            }

            prevX = ptX;
            prevY = ptY;
        });
        doc.setLineWidth(0.2); // Reset
    } else {
        doc.setTextColor(156, 163, 175);
        doc.setFont("helvetica", "normal");
        doc.text("Insufficient data to plot timeline.", pageWidth / 2, y + (gHeight / 2), { align: "center" });
    }
    y += gHeight + 15;

    // --- 5. TARGET LIST (TOP 5 PIRATES) ---
    ensureSpace(40);
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("HIGH-VALUE TARGETS (TOP 5 PIRATES)", margin, y);
    y += 8;

    doc.setFillColor(229, 231, 235);
    doc.rect(margin, y, maxTextWidth, 8, 'F');
    doc.setFontSize(9);
    
    doc.text("PIRATE HANDLE", margin + 2, y + 6);
    doc.text("PLATFORM", margin + 70, y + 6);
    doc.text("URLS HIT", margin + 115, y + 6);
    doc.text("EST. VIEWS", margin + 150, y + 6);
    
    y += 12;

    doc.setFont("helvetica", "normal");
    if (stats.topPirates && stats.topPirates.length > 0) {
        stats.topPirates.forEach((pirate, i) => {
            ensureSpace(10);
            
            // Table Truncation for Handle
            let displayHandle = `@${pirate.handle}`;
            if (displayHandle.length > 32) {
                displayHandle = displayHandle.substring(0, 29) + "...";
            }
            
            // Platform String & Truncation (FIXED DECLARATION)
            let displayPlatform = String(pirate.platforms || "Unknown");
            if (displayPlatform.length > 20) {
                displayPlatform = displayPlatform.substring(0, 17) + "...";
            }

            // Construct channel URL based on the platform
            let channelUrl = `https://www.google.com/search?q=${pirate.handle}`; // fallback
            const platLower = displayPlatform.toLowerCase();
            if (platLower.includes('tiktok')) channelUrl = `https://www.tiktok.com/@${pirate.handle}`;
            else if (platLower.includes('youtube')) channelUrl = `https://www.youtube.com/@${pirate.handle}`;
            else if (platLower.includes('instagram')) channelUrl = `https://www.instagram.com/${pirate.handle}`;
            else if (platLower.includes('twitter') || platLower.includes('x')) channelUrl = `https://x.com/${pirate.handle}`;

            // Draw as a clickable blue link, then reset color
            doc.setTextColor(0, 0, 255);
            doc.textWithLink(displayHandle, margin + 2, y, { url: channelUrl });
            doc.setTextColor(17, 24, 39);
            
            doc.text(displayPlatform, margin + 70, y);
            doc.text(String(pirate.urls), margin + 115, y);

            // Estimate Views: URLs * 1500, normalized to 'k'
            const est = pirate.urls * 1500;
            const estViews = est >= 1000 ? (est / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(est);

            doc.text(estViews, margin + 150, y);

            // Add subtle row separators
            doc.setDrawColor(243, 244, 246);
            doc.line(margin, y + 2, pageWidth - margin, y + 2);
            y += 8;
        });
    } else {
        doc.text("No targets identified in this timeframe.", margin + 2, y);
    }

    // --- 6. TEAM PERFORMANCE (RANKED) ---
    ensureSpace(40);
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("TEAM PERFORMANCE RANKINGS", margin, y);
    y += 8;

    doc.setFillColor(229, 231, 235);
    doc.rect(margin, y, maxTextWidth, 8, 'F');
    doc.setFontSize(9);
    doc.text("TEAM MEMBER", margin + 2, y + 6);
    doc.text("SCOUTED", margin + 85, y + 6);
    doc.text("ENFORCED", margin + 110, y + 6);
    doc.text("TOTAL URLS", margin + 135, y + 6);
    doc.text("RESOLVED", margin + 165, y + 6);
    y += 12;

    doc.setFont("helvetica", "normal");
    if (stats.teamStats && stats.teamStats.length > 0) {
        stats.teamStats.forEach((member) => {
            ensureSpace(10);
            
            let displayName = member.name || "Unknown";
            if (displayName.length > 35) displayName = displayName.substring(0, 32) + "...";

            doc.text(displayName, margin + 2, y);
            doc.text(String(member.scouted || 0), margin + 85, y);
            doc.text(String(member.enforced || 0), margin + 110, y);
            doc.text(String(member.urls || 0), margin + 135, y);
            doc.text(String(member.resolvedRate || "0%"), margin + 165, y);

            doc.setDrawColor(243, 244, 246);
            doc.line(margin, y + 2, pageWidth - margin, y + 2);
            y += 8;
        });
    } else {
        doc.text("No team data identified in this timeframe.", margin + 2, y);
    }

    // --- 7. EVENT VIEW ANALYSIS ---
    ensureSpace(40);
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("EVENT VIEW ANALYSIS", margin, y);
    y += 8;

    doc.setFillColor(229, 231, 235);
    doc.rect(margin, y, maxTextWidth, 8, 'F');
    doc.setFontSize(9);
    doc.text("EVENT NAME", margin + 2, y + 6);
    doc.text("ESTIMATED VIEWS", margin + 150, y + 6);
    y += 12;

    doc.setFont("helvetica", "bold");
    doc.text("ALL EVENTS COMBINED", margin + 2, y);
    
    // Sum up the raw views to avoid string parsing issues, normalize output with toLocaleString()
    let calculatedTotalViews = 0;
    if (stats.eventViews && stats.eventViews.length > 0) {
        calculatedTotalViews = stats.eventViews.reduce((sum, ev) => sum + (Number(ev.views) || 0), 0);
    } else if (stats.totalEstimatedViews) {
        // Fallback safely if eventViews array isn't populated but total string is
        let valStr = String(stats.totalEstimatedViews).toLowerCase();
        if (valStr.includes('k')) calculatedTotalViews = parseFloat(valStr) * 1000;
        else if (valStr.includes('m')) calculatedTotalViews = parseFloat(valStr) * 1000000;
        else calculatedTotalViews = parseFloat(valStr.replace(/[^\d.]/g, '')) || 0;
    }

    const safeTotalViews = (isNaN(calculatedTotalViews) || calculatedTotalViews === 0) ? "100" : calculatedTotalViews.toLocaleString();
    doc.text(safeTotalViews, margin + 150, y);
    y += 8;
    
    doc.setFont("helvetica", "normal");
    if (stats.eventViews && stats.eventViews.length > 0) {
        stats.eventViews.forEach((ev) => {
            ensureSpace(10);
            
            let displayEventName = ev.name || "Unknown";
            if (displayEventName.length > 65) displayEventName = displayEventName.substring(0, 62) + "...";

            doc.text(displayEventName, margin + 2, y);
            
            // Apply normalization to individual event views too
            const safeEventViews = (isNaN(ev.views) || ev.views === 0) ? "100" : Number(ev.views).toLocaleString();
            doc.text(safeEventViews, margin + 150, y);

            doc.setDrawColor(243, 244, 246);
            doc.line(margin, y + 2, pageWidth - margin, y + 2);
            y += 8;
        });
    } else {
        doc.text("No event view data identified in this timeframe.", margin + 2, y);
    }

    return doc.output('blob');

  } catch (error) {
    console.error("Intelligence PDF Gen Failed:", error);
    return new Blob(["Error generating Intelligence Report. Check extension logs."], { type: 'text/plain' });
  }
}