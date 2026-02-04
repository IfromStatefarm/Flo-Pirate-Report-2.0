// utils/pdf_gen.js
import jsPDF from '../lib/jspdf.umd.min.js';

export async function generatePDF(data) {
  try {
    // Check if jsPDF loaded correctly
    if (!jsPDF) throw new Error("jsPDF library not loaded");

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 15;
    let y = 20;

    // --- TITLE ---
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.setTextColor(206, 14, 45); // FloSports Red
    doc.text("FLO PIRACY REPORT", pageWidth / 2, y, { align: "center" });
    y += 15;

    // --- HEADER INFO (Big Bold Handle) ---
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
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("INFRINGING URLS & EVIDENCE", margin, y);
    y += 8;

    doc.setFontSize(10);
    // Table Header
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, y - 5, pageWidth - (margin * 2), 8, 'F');
    doc.text("URL", margin + 2, y);
    doc.text("VIEWS", margin + 110, y);
    doc.text("SCREENSHOT", margin + 140, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    
    let totalViews = 0;

    // Items Loop
    data.items.forEach((item, index) => {
        // Parse views for total
        let viewCount = 0;
        if (item.views && item.views !== "N/A") {
            const v = item.views.toLowerCase();
            if(v.includes('k')) viewCount = parseFloat(v) * 1000;
            else if(v.includes('m')) viewCount = parseFloat(v) * 1000000;
            else viewCount = parseFloat(v.replace(/,/g, '')) || 0;
        }
        totalViews += viewCount;

        // Truncate URL for display
        let displayUrl = item.url.length > 55 ? item.url.substring(0, 52) + "..." : item.url;

        // Add Row
        doc.text(displayUrl, margin + 2, y);
        doc.text(item.views || "N/A", margin + 110, y);
        
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
        
        // Page break check (simple)
        if (y > 270) {
            doc.addPage();
            y = 20;
        }
    });

    y += 5;
    doc.setFont("helvetica", "bold");
    doc.text(`TOTAL VIEWS AFFECTED: ${totalViews.toLocaleString()}`, margin, y);
    y += 10;
    doc.line(margin, y, pageWidth - margin, y);
    y += 15;

    // --- CEASE & DESIST LETTER ---
    // Start C&D on a new page if space is tight, else continue
    if (y > 180) {
        doc.addPage();
        y = 20;
    }

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

    doc.text("RE: IMMEDIATE CEASE AND DESIST – UNAUTHORIZED DISTRIBUTION OF FLOSPORTS PROPRIETARY CONTENT", margin, y, { maxWidth: pageWidth - (margin * 2) });
    y += 12;

    doc.setFont("helvetica", "normal");
    const p1 = "This notice is served by FloSports, Inc. to formally notify you that your social media account is in direct violation of the Digital Millennium Copyright Act (DMCA) and governing intellectual property laws.";
    doc.text(p1, margin, y, { maxWidth: pageWidth - (margin * 2) });
    y += 12;

    const p2 = "FloSports has documented the unauthorized use of its copyrighted broadcast material on your profile. This content is the exclusive property of FloSports, and no license or permission has been granted for its redistribution, public performance, or display.";
    doc.text(p2, margin, y, { maxWidth: pageWidth - (margin * 2) });
    y += 15;

    doc.setFont("helvetica", "bold");
    doc.text("MANDATORY REQUIREMENTS:", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text("Effective immediately, you are required to:", margin, y);
    y += 6;
    
    doc.text("1. CEASE all live streaming, uploading, or linking to FloSports proprietary content.", margin + 5, y); y += 5;
    doc.text("2. REMOVE all existing infringing materials from your account history and archives.", margin + 5, y); y += 5;
    doc.text("3. DESIST from any future use of FloSports intellectual property.", margin + 5, y); 
    y += 10;

    doc.setFont("helvetica", "bold");
    doc.text("ENFORCEMENT ACTION:", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    const p3 = "This is your final notice. We have logged your account information and documented the infringing activity. Failure to comply immediately will result in:";
    doc.text(p3, margin, y, { maxWidth: pageWidth - (margin * 2) });
    y += 10;

    const bullets = [
        "Formal Takedown Requests submitted to the platform's legal department, which typically results in immediate content removal and permanent account suspension.",
        "Escalation to Legal Counsel for the recovery of statutory damages and legal fees associated with these infringements."
    ];
    bullets.forEach(b => {
        doc.text("• " + b, margin + 5, y, { maxWidth: pageWidth - (margin * 2) - 5 });
        y += 10;
    });
    
    y += 5;
    const p4 = "This is a notice of violation. No response is required provided that all infringing content is removed immediately and no further violations occur.";
    doc.text(p4, margin, y, { maxWidth: pageWidth - (margin * 2) });
    y += 15;

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
    ${data.items.map(i => `- ${i.url} (Views: ${i.views}) [Evidence: ${i.screenshotLink || "N/A"}]`).join('\n')}
    
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
