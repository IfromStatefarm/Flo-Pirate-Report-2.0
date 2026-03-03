// utils/pdf_gen.js
import * as jsPDFModule from '../lib/jspdf.umd.min.js';

export async function generatePDF(data) {
  try {
    // FIX: Exhaustive Constructor Resolution for UMD/ESM compatibility
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