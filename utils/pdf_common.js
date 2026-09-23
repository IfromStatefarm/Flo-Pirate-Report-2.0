import * as jsPDFModule from '../lib/jspdf.umd.min.js';
import { buildRuntimeTheme } from './runtime_theme.js';

export function resolvePdfTheme(context) {
  if (context?.product && context?.colors) return context;
  return buildRuntimeTheme(context);
}

export function hexToRgb(value, fallback = [51, 65, 85]) {
  const match = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i.exec(String(value || ''));
  return match ? match.slice(1).map((part) => Number.parseInt(part, 16)) : fallback;
}

export function applyDataScopeMetadata(doc, scope, title, creator) {
  if (!scope?.customerId || !scope?.userId || !scope?.eventId || typeof doc.setProperties !== 'function') return;
  doc.setProperties({
    title,
    subject: `Customer ${scope.customerId}; User ${scope.userId}; Event ${scope.eventId}`,
    keywords: `customer_id:${scope.customerId},user_id:${scope.userId},event_id:${scope.eventId}`,
    creator
  });
}

// --- HELPER: Resolve jsPDF Constructor ---
export function getJsPdfConstructor() {
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

