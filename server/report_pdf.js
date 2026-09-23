import { resolvePdfTheme, hexToRgb, applyDataScopeMetadata, getJsPdfConstructor } from '../utils/pdf_common.js';

export async function generatePDF(data) {
  const pdfTheme = resolvePdfTheme(data?.customerContext);
  const brandRgb = hexToRgb(pdfTheme.colors.primary);
  const ownerName = pdfTheme.legal.ownerName || pdfTheme.legal.companyName || 'Rights Owner';
  const companyName = pdfTheme.legal.companyName || ownerName;
  try {
    const jsPDF = getJsPdfConstructor();
    
    const doc = new jsPDF();
    applyDataScopeMetadata(
      doc,
      data?.dataScope,
      `${pdfTheme.product.displayName} Report ${data?.reportId || ''}`.trim(),
      pdfTheme.product.productName
    );
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
    doc.setTextColor(...brandRgb);
    doc.text(`${pdfTheme.product.displayName.toUpperCase()} REPORT`, pageWidth / 2, y, { align: "center" });
    if (pdfTheme.logoDataUrl) {
      try { doc.addImage(pdfTheme.logoDataUrl, 15, 10, 18, 18); } catch (error) { console.warn('PDF logo skipped:', error.message); }
    }
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

    const reportId = data.reportId || `RR-${Math.floor(Math.random()*10000)}`;
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

    drawWrappedText(`RE: IMMEDIATE CEASE AND DESIST – UNAUTHORIZED DISTRIBUTION OF ${ownerName.toUpperCase()} PROPRIETARY CONTENT`, margin, pageWidth - (margin * 2), 10);

    doc.setFont("helvetica", "normal");
    const p1 = `This notice is served by ${companyName} to formally notify you that your social media account is in direct violation of the Digital Millennium Copyright Act (DMCA) and governing intellectual property laws.`;
    drawWrappedText(p1, margin, pageWidth - (margin * 2), 6);

    const p2 = `${ownerName} has documented the unauthorized use of its copyrighted material on your profile. This content is the exclusive property of ${ownerName}, and no license or permission has been granted for its redistribution, public performance, or display.`;
    drawWrappedText(p2, margin, pageWidth - (margin * 2), 10);

    ensureSpace(25);
    doc.setFont("helvetica", "bold");
    doc.text("MANDATORY REQUIREMENTS:", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.text("Effective immediately, you are required to:", margin, y);
    y += 6;
    
    drawWrappedText(`1. CEASE all live streaming, uploading, or linking to ${ownerName} proprietary content.`, margin + 5, pageWidth - (margin * 2) - 5, 3);
    drawWrappedText("2. REMOVE all existing infringing materials from your account history and archives.", margin + 5, pageWidth - (margin * 2) - 5, 3);
    drawWrappedText(`3. DESIST from any future use of ${ownerName} intellectual property.`, margin + 5, pageWidth - (margin * 2) - 5, 8);

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

    ensureSpace(55);
    doc.setFont("helvetica", "bold");
    doc.text(`Authorized Representative of ${companyName}`, margin, y); y += 5;
    doc.setFont("helvetica", "normal");
    if (pdfTheme.legal.addressLine1) { doc.text(pdfTheme.legal.addressLine1, margin, y); y += 5; }
    const locality = [pdfTheme.legal.city, pdfTheme.legal.region, pdfTheme.legal.postalCode].filter(Boolean).join(', ');
    if (locality) { doc.text(locality, margin, y); y += 5; }
    if (pdfTheme.legal.country) { doc.text(pdfTheme.legal.country, margin, y); y += 5; }
    if (pdfTheme.legal.reportingEmail) { doc.text(`Primary Contact: ${pdfTheme.legal.reportingEmail}`, margin, y); y += 5; }
    if (pdfTheme.legal.secondaryEmail) { doc.text(`Secondary Contact: ${pdfTheme.legal.secondaryEmail}`, margin, y); y += 5; }
    if (pdfTheme.legal.phone) doc.text(`Phone: ${pdfTheme.legal.phone}`, margin, y);

    return doc.output('blob');

  } catch (error) {
    console.error("PDF Gen Failed, using Text fallback:", error);
    
    const textContent = `
    ${pdfTheme.product.displayName.toUpperCase()} REPORT (FALLBACK TEXT VERSION)
    --------------------------------------------------
    INFRINGER: @${data.handle}
    DATE: ${new Date().toLocaleString()}
    REPORT ID: ${data.reportId || "Unknown"}
    CUSTOMER ID: ${data.dataScope?.customerId || "Unknown"}
    USER ID: ${data.dataScope?.userId || "Unknown"}
    EVENT ID: ${data.dataScope?.eventId || "Unknown"}
    REPORTER: ${data.reporterName}
    
    EVENT: ${data.eventName}
    VERTICAL: ${data.vertical}
    
    INFRINGING URLS:
    ${data.items ? data.items.map(i => `- ${i.url} (Views: ${i.views}) [Evidence: ${i.screenshotLink || "N/A"}]`).join('\n') : "No items."}
    
    --------------------------------------------------
    FORMAL NOTICE OF COPYRIGHT INFRINGEMENT
    
    This notice is served by ${companyName} to formally notify you that your social media account is in direct violation of the Digital Millennium Copyright Act (DMCA).
    
    MANDATORY REQUIREMENTS:
    1. CEASE all live streaming/uploading of ${ownerName} content.
    2. REMOVE all infringing materials immediately.
    3. DESIST from future use.
    
    Authorized Representative of ${companyName}
    ${[pdfTheme.legal.addressLine1, pdfTheme.legal.city, pdfTheme.legal.region, pdfTheme.legal.postalCode, pdfTheme.legal.country].filter(Boolean).join(', ')}
    ${pdfTheme.legal.reportingEmail || ''}
    `;
    
     return new Blob([textContent], { type: 'text/plain' });
  }
}

