/* ================================================================
   KrishiMitra AI — ISRO Satellite Intelligence Report
   PDF Export Module — Helper Functions + exportPDF()
   Libraries used: jsPDF 2.5.1, jspdf-autotable, html2canvas, QRCode.js
   Vanilla JavaScript only. No frameworks.
   ================================================================ */

/* ================================================================
   1. COLOR PALETTE
   ================================================================ */
const PDF_PALETTE = {
    darkGreen: [8, 18, 13],
    green: [53, 195, 123],
    greenDeep: [16, 94, 60],
    yellow: [224, 165, 48],
    orange: [255, 122, 26],
    red: [224, 72, 61],
    blue: [47, 143, 224],
    white: [255, 255, 255],
    ink: [20, 20, 20],
    muted: [110, 122, 116],
    track: [230, 236, 232],
    cardBg: [245, 250, 247],
    cardBorder: [210, 224, 216],
};

/* ================================================================
   2. SAFE GETTERS / FORMATTERS
   ================================================================ */
function pdfGetSafe(obj, path, fallback) {
    try {
        const val = path.split('.').reduce(
            (acc, key) => (acc !== undefined && acc !== null ? acc[key] : undefined),
            obj
        );
        return (val === undefined || val === null || val === '') ? fallback : val;
    } catch (e) {
        return fallback;
    }
}

function pdfFormatNumber(val, decimals, fallback) {
    fallback = fallback === undefined ? 'N/A' : fallback;
    decimals = decimals === undefined ? 2 : decimals;
    try {
        if (val === undefined || val === null || val === '' || isNaN(val)) return fallback;
        return Number(val).toFixed(decimals);
    } catch (e) {
        return fallback;
    }
}

function pdfClamp(val, min, max) {
    if (isNaN(val)) return min;
    return Math.min(Math.max(val, min), max);
}

function pdfNormalize(val, min, max) {
    try {
        if (val === undefined || val === null || isNaN(val)) return 0;
        const pct = ((val - min) / (max - min)) * 100;
        return pdfClamp(pct, 0, 100);
    } catch (e) {
        return 0;
    }
}

/* ================================================================
   3. STATUS / COLOR MAPPERS
   ================================================================ */
function pdfGetUrgencyColor(urgency) {
    const map = {
        Low: PDF_PALETTE.green,
        Moderate: PDF_PALETTE.yellow,
        High: PDF_PALETTE.orange,
        Critical: PDF_PALETTE.red,
    };
    return map[urgency] || PDF_PALETTE.muted;
}

function pdfGetStressColor(stress) {
    const map = {
        'Healthy': PDF_PALETTE.green,
        'Mild Stress': PDF_PALETTE.yellow,
        'Moderate Stress': PDF_PALETTE.orange,
        'Severe Stress': PDF_PALETTE.red,
    };
    return map[stress] || PDF_PALETTE.muted;
}

function pdfComputeHealthScore(d) {
    try {
        const ndvi = Number(pdfGetSafe(d, 'satellite_features.optical.NDVI', 0.5));
        const stress = pdfGetSafe(d, 'ai_prediction.predicted_stress', 'Healthy');
        const penalty = { 'Healthy': 0, 'Mild Stress': 12, 'Moderate Stress': 30, 'Severe Stress': 50 };
        let score = Math.round(pdfClamp(ndvi, 0, 1) * 100);
        score = score - (penalty[stress] !== undefined ? penalty[stress] : 10);
        return Math.round(pdfClamp(score, 0, 100));
    } catch (e) {
        return 50;
    }
}

function pdfHealthLabel(score) {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    if (score >= 20) return 'Poor';
    return 'Critical';
}

function pdfHealthColor(score) {
    if (score >= 80) return PDF_PALETTE.green;
    if (score >= 60) return [123, 195, 53];
    if (score >= 40) return PDF_PALETTE.yellow;
    if (score >= 20) return PDF_PALETTE.orange;
    return PDF_PALETTE.red;
}

/* ================================================================
   4. LOW-LEVEL DRAWING HELPERS
   ================================================================ */

/** Simulated linear gradient using stacked thin rectangles (jsPDF has no native gradient fill). */
function drawGradientRect(doc, x, y, w, h, colorStart, colorEnd, vertical, steps) {
    try {
        vertical = vertical === undefined ? true : vertical;
        steps = steps || 40;
        const segLen = (vertical ? h : w) / steps;
        for (let i = 0; i < steps; i++) {
            const t = i / (steps - 1);
            const r = Math.round(colorStart[0] + (colorEnd[0] - colorStart[0]) * t);
            const g = Math.round(colorStart[1] + (colorEnd[1] - colorStart[1]) * t);
            const b = Math.round(colorStart[2] + (colorEnd[2] - colorStart[2]) * t);
            doc.setFillColor(r, g, b);
            if (vertical) {
                doc.rect(x, y + i * segLen, w, segLen + 0.5, 'F');
            } else {
                doc.rect(x + i * segLen, y, segLen + 0.5, h, 'F');
            }
        }
    } catch (e) {
        // fallback: flat fill, never crash
        try {
            doc.setFillColor(colorStart[0], colorStart[1], colorStart[2]);
            doc.rect(x, y, w, h, 'F');
        } catch (e2) { /* silent */ }
    }
}

/** Rounded "glass" card with soft drop-shadow illusion + border. */
function drawCard(doc, x, y, w, h, opts) {
    opts = opts || {};
    const radius = opts.radius !== undefined ? opts.radius : 3;
    const fill = opts.fill || PDF_PALETTE.cardBg;
    const border = opts.border || PDF_PALETTE.cardBorder;
    const shadow = opts.shadow !== false;
    try {
        if (shadow) {
            doc.setFillColor(0, 0, 0);
            doc.setGState && doc.setGState(new doc.GState({ opacity: 0.06 }));
            doc.roundedRect(x + 1, y + 1.4, w, h, radius, radius, 'F');
            doc.setGState && doc.setGState(new doc.GState({ opacity: 1 }));
        }
    } catch (e) { /* GState not supported in some builds — ignore shadow */ }
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.setDrawColor(border[0], border[1], border[2]);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, radius, radius, 'FD');
}

/** Section title with colored accent bar. */
function drawSectionTitle(doc, text, x, y, color) {
    color = color || PDF_PALETTE.greenDeep;
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(x, y - 4.2, 3, 6, 1, 1, 'F');
    doc.setTextColor(color[0], color[1], color[2]);
    doc.setFontSize(12.5);
    doc.setFont(undefined, 'bold');
    doc.text(text, x + 6, y);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
}

/** Rounded horizontal progress bar with label + value. */
function drawProgressBar(doc, x, y, w, h, pct, color, label, valueText) {
    pct = pdfClamp(Number(pct) || 0, 0, 100);
    color = color || PDF_PALETTE.green;
    try {
        if (label) {
            doc.setFontSize(8.5);
            doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
            doc.setFont(undefined, 'normal');
            doc.text(label, x, y - 1.6);
        }
        doc.setFillColor(PDF_PALETTE.track[0], PDF_PALETTE.track[1], PDF_PALETTE.track[2]);
        doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
        const fillW = Math.max(h, (w * pct) / 100);
        doc.setFillColor(color[0], color[1], color[2]);
        doc.roundedRect(x, y, fillW, h, h / 2, h / 2, 'F');
        if (valueText !== undefined) {
            doc.setFontSize(8.5);
            doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
            doc.text(String(valueText), x + w + 4, y + h - 0.3);
        }
    } catch (e) { /* never crash the report over a bar */ }
}

/** Donut-style circular gauge (0–100) built from pie-slice triangles. */
function drawCircularGauge(doc, cx, cy, r, pct, color, label) {
    try {
        pct = pdfClamp(Number(pct) || 0, 0, 100);
        color = color || PDF_PALETTE.green;
        const innerR = r * 0.68;

        doc.setFillColor(PDF_PALETTE.track[0], PDF_PALETTE.track[1], PDF_PALETTE.track[2]);
        doc.circle(cx, cy, r, 'F');

        const startAngle = -90;
        const sweep = 360 * (pct / 100);
        const steps = Math.max(2, Math.round(sweep / 3));
        doc.setFillColor(color[0], color[1], color[2]);
        for (let i = 0; i < steps; i++) {
            const a1 = ((startAngle + (sweep * i) / steps) * Math.PI) / 180;
            const a2 = ((startAngle + (sweep * (i + 1)) / steps) * Math.PI) / 180;
            const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
            const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
            doc.triangle(cx, cy, x1, y1, x2, y2, 'F');
        }

        doc.setFillColor(PDF_PALETTE.white[0], PDF_PALETTE.white[1], PDF_PALETTE.white[2]);
        doc.circle(cx, cy, innerR, 'F');

        doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
        doc.setFontSize(17);
        doc.setFont(undefined, 'bold');
        doc.text(String(Math.round(pct)), cx, cy - 0.5, { align: 'center' });
        doc.setFontSize(7.5);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
        doc.text('/ 100', cx, cy + 5, { align: 'center' });

        if (label) {
            doc.setFontSize(9);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(color[0], color[1], color[2]);
            doc.text(label, cx, cy + r + 7, { align: 'center' });
        }
        doc.setFont(undefined, 'normal');
    } catch (e) { /* never crash on gauge */ }
}

/** Small pill badge. */
function drawBadge(doc, x, y, text, color, fontSize) {
    fontSize = fontSize || 9;
    try {
        doc.setFontSize(fontSize);
        doc.setFont(undefined, 'bold');
        const padX = 4;
        const textW = doc.getTextWidth(text);
        const w = textW + padX * 2;
        const h = fontSize * 0.55 + 3.5;
        doc.setFillColor(color[0], color[1], color[2]);
        doc.roundedRect(x, y, w, h, h / 2, h / 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(text, x + w / 2, y + h / 2 + fontSize * 0.16, { align: 'center' });
        doc.setFont(undefined, 'normal');
        doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
        return w;
    } catch (e) {
        return 0;
    }
}

/* ================================================================
   5. HEADER / FOOTER
   ================================================================ */
function drawHeader(doc, pageW, opts) {
    opts = opts || {};
    const compact = !!opts.compact;
    const h = compact ? 20 : 38;
    try {
        drawGradientRect(doc, 0, 0, pageW, h, [4, 12, 9], PDF_PALETTE.greenDeep, true, 30);

        const logoR = compact ? 6 : 8;
        const logoCx = compact ? 12 : 18;
        const logoCy = h / 2;
        doc.setFillColor(PDF_PALETTE.green[0], PDF_PALETTE.green[1], PDF_PALETTE.green[2]);
        doc.circle(logoCx, logoCy, logoR, 'F');
        doc.setTextColor(PDF_PALETTE.darkGreen[0], PDF_PALETTE.darkGreen[1], PDF_PALETTE.darkGreen[2]);
        doc.setFontSize(compact ? 10 : 13);
        doc.setFont(undefined, 'bold');
        doc.text('K', logoCx, logoCy + (compact ? 1.2 : 1.5), { align: 'center' });

        const textX = logoCx + logoR + 6;
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(compact ? 12 : 19);
        doc.setFont(undefined, 'bold');
        doc.text('KrishiMitra AI', textX, compact ? 9 : 16);

        doc.setFontSize(compact ? 7.5 : 9.5);
        doc.setFont(undefined, 'normal');
        doc.text('ISRO H2S 2026 · Team SpaceHack · AI Crop & Irrigation Advisory', textX, compact ? 15 : 23);

        if (!compact) {
            const now = new Date();
            doc.setFontSize(8.5);
            doc.text('Generated Date: ' + now.toLocaleDateString(), pageW - 15, 15, { align: 'right' });
            doc.text('Generated Time: ' + now.toLocaleTimeString(), pageW - 15, 21, { align: 'right' });
            doc.setFontSize(8);
            doc.setTextColor(200, 230, 215);
            doc.text('ISRO SATELLITE INTELLIGENCE REPORT', pageW - 15, 29, { align: 'right' });
        }

        doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
        doc.setFont(undefined, 'normal');
        return h;
    } catch (e) {
        return compact ? 20 : 38;
    }
}

/** Runs once at the very end, after all pages exist, so "Page X of Y" is accurate. */
function drawFooterAllPages(doc) {
    try {
        const pageCount = doc.internal.getNumberOfPages();
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        for (let p = 1; p <= pageCount; p++) {
            doc.setPage(p);
            doc.setDrawColor(PDF_PALETTE.cardBorder[0], PDF_PALETTE.cardBorder[1], PDF_PALETTE.cardBorder[2]);
            doc.setLineWidth(0.2);
            doc.line(14, pageH - 12, pageW - 14, pageH - 12);
            doc.setFontSize(7.8);
            doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
            doc.text('KrishiMitra AI  ·  ISRO H2S 2026  ·  Team SpaceHack  ·  Generated Automatically', 14, pageH - 7);
            doc.text('Page ' + p + ' of ' + pageCount, pageW - 14, pageH - 7, { align: 'right' });
        }
    } catch (e) { /* footer must never break export */ }
}

/* ================================================================
   6. ASYNC CAPTURE HELPERS (map screenshot + QR code)
   ================================================================ */
async function captureMapDataURL() {
    try {
        if (typeof html2canvas !== 'function') return null;
        const mapEl = document.getElementById('map');
        if (!mapEl || !mapEl.offsetHeight) return null;
        const canvas = await html2canvas(mapEl, {
            useCORS: true,
            logging: false,
            backgroundColor: '#0b1512',
            scale: 1.5,
        });
        return canvas.toDataURL('image/png');
    } catch (e) {
        console.error('Map capture failed:', e);
        return null;
    }
}

async function generateQRDataURL(text, size) {
    size = size || 180;
    let holder = null;
    try {
        if (typeof QRCode !== 'function') return null;
        holder = document.createElement('div');
        holder.style.position = 'fixed';
        holder.style.left = '-9999px';
        holder.style.top = '-9999px';
        document.body.appendChild(holder);

        new QRCode(holder, {
            text: text,
            width: size,
            height: size,
            correctLevel: (QRCode.CorrectLevel && QRCode.CorrectLevel.M) || 1,
        });

        // QRCode.js renders synchronously via canvas in modern browsers.
        await new Promise(resolve => setTimeout(resolve, 60));

        const canvas = holder.querySelector('canvas');
        if (canvas) {
            const dataUrl = canvas.toDataURL('image/png');
            document.body.removeChild(holder);
            return dataUrl;
        }
        const img = holder.querySelector('img');
        if (img && img.src) {
            const src = img.src;
            document.body.removeChild(holder);
            return src;
        }
        document.body.removeChild(holder);
        return null;
    } catch (e) {
        console.error('QR generation failed:', e);
        try { if (holder && holder.parentNode) document.body.removeChild(holder); } catch (e2) { /* ignore */ }
        return null;
    }
}

/* ================================================================
   7. SECTION-SPECIFIC CARD DRAWERS
   ================================================================ */

function drawFarmerCard(doc, x, y, w, h, d) {
    drawCard(doc, x, y, w, h, { fill: PDF_PALETTE.cardBg });
    const padX = 6;
    let ty = y + 9;

    doc.setFontSize(13.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
    doc.text(String(pdfGetSafe(d, 'field.name', 'Unnamed Field')), x + padX, ty);

    doc.setFontSize(8.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
    doc.text('Field ID: ' + pdfGetSafe(d, 'field.id', 'N/A'), x + padX, ty + 6);

    const rows = [
        ['District', pdfGetSafe(d, 'field.district', 'N/A')],
        ['State', pdfGetSafe(d, 'field.state', 'N/A')],
        ['Latitude', pdfGetSafe(d, 'field.lat', 'N/A')],
        ['Longitude', pdfGetSafe(d, 'field.lon', 'N/A')],
        ['Date', pdfGetSafe(d, 'field.date', 'N/A')],
    ];

    let colX = x + padX;
    let colY = ty + 15;
    const colW = (w - padX * 2) / 3;
    rows.forEach((row, i) => {
        const cx = colX + (i % 3) * colW;
        const cy = colY + Math.floor(i / 3) * 14;
        doc.setFontSize(7.5);
        doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
        doc.text(row[0].toUpperCase(), cx, cy);
        doc.setFontSize(9.5);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
        doc.text(String(row[1]), cx, cy + 5);
        doc.setFont(undefined, 'normal');
    });
}

function drawRiskBadgeLarge(doc, x, y, d) {
    const urgency = pdfGetSafe(d, 'advisory.urgency', 'Moderate');
    const color = pdfGetUrgencyColor(urgency);
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(x, y, 42, 15, 4, 4, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(String(urgency), x + 21, y + 7, { align: 'center' });
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'normal');
    doc.text('RISK LEVEL', x + 21, y + 12, { align: 'center' });
    doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
}

function drawPredictionCard(doc, x, y, w, h, d) {
    drawCard(doc, x, y, w, h, { fill: PDF_PALETTE.cardBg });
    drawSectionTitle(doc, 'AI Prediction', x + 6, y + 8, PDF_PALETTE.greenDeep);

    const crop = pdfGetSafe(d, 'ai_prediction.predicted_crop', 'N/A');
    const stress = pdfGetSafe(d, 'ai_prediction.predicted_stress', 'N/A');
    const cropConf = Number(pdfGetSafe(d, 'ai_prediction.crop_confidence', 0)) * 100;
    const stressConf = Number(pdfGetSafe(d, 'ai_prediction.stress_confidence', 0)) * 100;

    doc.setFontSize(9);
    doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
    doc.text('Predicted Crop', x + 6, y + 17);
    doc.setFontSize(11.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
    doc.text(String(crop), x + 6, y + 23);
    doc.setFont(undefined, 'normal');

    const stressColor = pdfGetStressColor(stress);
    const bw = drawBadge(doc, x + w - 6 - 34, y + 15, String(stress), stressColor, 8);

    drawProgressBar(doc, x + 6, y + 32, w - 12, 3.2, cropConf, PDF_PALETTE.green,
        'Crop Confidence', Math.round(cropConf) + '%');
    drawProgressBar(doc, x + 6, y + 44, w - 12, 3.2, stressConf, PDF_PALETTE.orange,
        'Stress Confidence', Math.round(stressConf) + '%');
}

function drawWeatherCard(doc, x, y, w, h, d) {
    drawCard(doc, x, y, w, h, { fill: PDF_PALETTE.cardBg });
    drawSectionTitle(doc, 'Weather Snapshot', x + 6, y + 8, PDF_PALETTE.blue);

    const metrics = [
        ['Temperature', pdfGetSafe(d, 'weather.temperature', 'N/A'), '°C'],
        ['Humidity', pdfGetSafe(d, 'weather.humidity', 'N/A'), '%'],
        ['Rainfall', pdfGetSafe(d, 'weather.rainfall', 'N/A'), 'mm'],
        ['Wind', pdfGetSafe(d, 'weather.wind', 'N/A'), 'km/h'],
        ['Pressure', pdfGetSafe(d, 'weather.pressure', 'N/A'), 'hPa'],
    ];

    const colW = (w - 12) / metrics.length;
    metrics.forEach((m, i) => {
        const cx = x + 6 + i * colW;
        doc.setFontSize(7.5);
        doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
        doc.text(m[0].toUpperCase(), cx, y + 17);
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(PDF_PALETTE.blue[0], PDF_PALETTE.blue[1], PDF_PALETTE.blue[2]);
        const val = (m[1] === 'N/A' || m[1] === undefined) ? 'N/A' : (m[1] + ' ' + m[2]);
        doc.text(String(val), cx, y + 25);
        doc.setFont(undefined, 'normal');
    });
}

/** Returns the y-coordinate after drawing; adds a page automatically if content overflows. */
function drawSatelliteCard(doc, x, y, w, pageH, d) {
    const feats = pdfGetSafe(d, 'satellite_features', {});
    const ndvi = Number(pdfGetSafe(feats, 'optical.NDVI', 0));
    const ndwi = Number(pdfGetSafe(feats, 'optical.NDWI', 0));
    const msi = Number(pdfGetSafe(feats, 'optical.MSI', 0));
    const vv = Number(pdfGetSafe(feats, 'sar.VV_dB', -15));
    const vh = Number(pdfGetSafe(feats, 'sar.VH_dB', -20));
    const ratio = Number(pdfGetSafe(feats, 'sar.VV_VH_ratio', 1));
    const stage = pdfGetSafe(feats, 'growth_stage', 'N/A');
    const source = pdfGetSafe(feats, 'source', 'N/A');
    const health = pdfComputeHealthScore(d);

    const cardH = 96;
    if (y + cardH > pageH - 20) {
        doc.addPage();
        drawHeader(doc, doc.internal.pageSize.getWidth(), { compact: true });
        y = 30;
    }

    drawCard(doc, x, y, w, cardH, { fill: PDF_PALETTE.cardBg });
    drawSectionTitle(doc, 'Satellite Feature Analysis', x + 6, y + 9, PDF_PALETTE.greenDeep);

    let by = y + 20;
    const barW = w - 60;
    drawProgressBar(doc, x + 6, by, barW, 3.4, pdfNormalize(ndvi, 0, 1), PDF_PALETTE.green,
        'NDVI (Vegetation Index)', pdfFormatNumber(ndvi, 3));
    by += 13;
    drawProgressBar(doc, x + 6, by, barW, 3.4, pdfNormalize(ndwi, -1, 1), PDF_PALETTE.blue,
        'NDWI (Water Index)', pdfFormatNumber(ndwi, 3));
    by += 13;
    drawProgressBar(doc, x + 6, by, barW, 3.4, pdfNormalize(msi, 0, 2), PDF_PALETTE.yellow,
        'MSI (Moisture Stress Index)', pdfFormatNumber(msi, 3));
    by += 13;
    drawProgressBar(doc, x + 6, by, barW, 3.4, pdfNormalize(vv, -30, 0), PDF_PALETTE.orange,
        'SAR VV (dB)', pdfFormatNumber(vv, 2) + ' dB');
    by += 13;
    drawProgressBar(doc, x + 6, by, barW, 3.4, pdfNormalize(vh, -30, 0), [180, 100, 220],
        'SAR VH (dB)', pdfFormatNumber(vh, 2) + ' dB');
    by += 13;
    drawProgressBar(doc, x + 6, by, barW, 3.4, pdfNormalize(ratio, 0, 5), PDF_PALETTE.red,
        'VV / VH Ratio', pdfFormatNumber(ratio, 2));

    doc.setFontSize(8);
    doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
    doc.text('Growth Stage: ' + stage, x + 6, y + cardH - 8);
    doc.text('Source: ' + source, x + 6, y + cardH - 3);
    doc.text('Health Score: ' + health + '/100 (' + pdfHealthLabel(health) + ')', x + w / 2, y + cardH - 3);

    return y + cardH + 8;
}

/** Returns the y-coordinate after drawing; adds a page automatically if content overflows. */
function drawIrrigationCard(doc, x, y, w, pageH, d) {
    const adv = pdfGetSafe(d, 'advisory', {});
    const urgency = pdfGetSafe(adv, 'urgency', 'Moderate');
    const color = pdfGetUrgencyColor(urgency);
    const actionHi = pdfGetSafe(adv, 'action_hi', 'Advisory not available.');
    const water = pdfGetSafe(adv, 'recommended_water_mm', 'N/A');
    const demand = pdfGetSafe(adv, 'crop_water_demand_mm_day', 'N/A');
    const stressLevel = pdfGetSafe(adv, 'stress_level', 'N/A');

    const wrapped = doc.splitTextToSize(String(actionHi), w - 16);
    const cardH = 36 + wrapped.length * 5.2;

    if (y + cardH > pageH - 20) {
        doc.addPage();
        drawHeader(doc, doc.internal.pageSize.getWidth(), { compact: true });
        y = 30;
    }

    drawCard(doc, x, y, w, cardH, { fill: [246, 251, 248], border: color });
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(x, y, 3, cardH, 'F');

    doc.setTextColor(color[0], color[1], color[2]);
    doc.setFontSize(11.5);
    doc.setFont(undefined, 'bold');
    doc.text(urgency + ' Urgency  ·  ' + stressLevel, x + 8, y + 9);

    doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
    doc.setFontSize(9.5);
    doc.setFont(undefined, 'normal');
    doc.text(wrapped, x + 8, y + 17);

    const textBottom = y + 17 + wrapped.length * 5.2;
    doc.setFont(undefined, 'bold');
    doc.setFontSize(9.5);
    doc.text('Recommended Water: ' + water + ' mm', x + 8, textBottom + 5);
    doc.text('Crop Water Demand: ' + demand + ' mm/day', x + 8, textBottom + 11);
    doc.setFont(undefined, 'normal');

    return y + cardH + 8;
}

/** Reasoning items as individual rounded bordered boxes (not a table). Handles page breaks. */
function drawReasoningBoxes(doc, x, y, w, pageH, d) {
    const reasoning = pdfGetSafe(d, 'advisory.reasoning', []);
    if (!Array.isArray(reasoning) || reasoning.length === 0) {
        doc.setFontSize(9);
        doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
        doc.text('No reasoning data available for this field.', x, y + 5);
        return y + 12;
    }

    drawSectionTitle(doc, 'AI Reasoning', x, y, PDF_PALETTE.greenDeep);
    let by = y + 8;

    reasoning.forEach((item) => {
        const text = String(item);
        const wrapped = doc.splitTextToSize(text, w - 16);
        const boxH = wrapped.length * 5 + 8;

        if (by + boxH > pageH - 20) {
            doc.addPage();
            drawHeader(doc, doc.internal.pageSize.getWidth(), { compact: true });
            by = 30;
        }

        doc.setDrawColor(PDF_PALETTE.cardBorder[0], PDF_PALETTE.cardBorder[1], PDF_PALETTE.cardBorder[2]);
        doc.setFillColor(252, 253, 253);
        doc.setLineWidth(0.25);
        doc.roundedRect(x, by, w, boxH, 2.2, 2.2, 'FD');

        doc.setFillColor(PDF_PALETTE.green[0], PDF_PALETTE.green[1], PDF_PALETTE.green[2]);
        doc.circle(x + 6, by + 6, 1.3, 'F');

        doc.setFontSize(9);
        doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
        doc.text(wrapped, x + 11, by + 6.5);

        by += boxH + 4;
    });

    return by;
}

/** Horizontal metric bar-chart block for Page 3 (pure jsPDF drawing, no chart libraries). */
function drawChartsSection(doc, x, y, w, d) {
    drawSectionTitle(doc, 'Metric Charts', x, y, PDF_PALETTE.greenDeep);
    let by = y + 10;

    const ndvi = Number(pdfGetSafe(d, 'satellite_features.optical.NDVI', 0));
    const ndwi = Number(pdfGetSafe(d, 'satellite_features.optical.NDWI', 0));
    const msi = Number(pdfGetSafe(d, 'satellite_features.optical.MSI', 0));
    const cropConf = Number(pdfGetSafe(d, 'ai_prediction.crop_confidence', 0)) * 100;
    const stressConf = Number(pdfGetSafe(d, 'ai_prediction.stress_confidence', 0)) * 100;
    const health = pdfComputeHealthScore(d);

    const rows = [
        ['NDVI', pdfNormalize(ndvi, 0, 1), PDF_PALETTE.green, pdfFormatNumber(ndvi, 3)],
        ['NDWI', pdfNormalize(ndwi, -1, 1), PDF_PALETTE.blue, pdfFormatNumber(ndwi, 3)],
        ['MSI', pdfNormalize(msi, 0, 2), PDF_PALETTE.yellow, pdfFormatNumber(msi, 3)],
        ['Crop Confidence', cropConf, PDF_PALETTE.green, Math.round(cropConf) + '%'],
        ['Stress Confidence', stressConf, PDF_PALETTE.orange, Math.round(stressConf) + '%'],
        ['Health Score', health, pdfHealthColor(health), health + '/100'],
    ];

    rows.forEach((row) => {
        drawProgressBar(doc, x, by, w - 40, 4.2, row[1], row[2], row[0], row[3]);
        by += 14;
    });

    return by;
}

/* ================================================================
   8. MAIN EXPORT FUNCTION
   ================================================================ */
async function exportPDF() {
    try {
        if (!currentField) {
            alert('Please select a field first.');
            return;
        }
        if (!window.jspdf) {
            alert('jsPDF not loaded');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');

        if (typeof doc.autoTable !== 'function') {
            alert('AutoTable plugin not loaded');
            return;
        }

        const d = currentField;
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();

        /* -------------------- PAGE 1 : COVER -------------------- */
        drawHeader(doc, pageW, { compact: false });

        let y = 46;
        const farmerCardH = 50;
        drawFarmerCard(doc, 14, y, pageW - 28, farmerCardH, d);
        drawRiskBadgeLarge(doc, pageW - 14 - 42, y + 6, d);

        y += farmerCardH + 8;

        const halfW = (pageW - 28 - 8) / 2;
        const rowH = 58;
        drawCard(doc, 14, y, halfW, rowH, { fill: PDF_PALETTE.cardBg });
        drawSectionTitle(doc, 'AI Health Score', 20, y + 9, PDF_PALETTE.greenDeep);
        const healthScore = pdfComputeHealthScore(d);
        drawCircularGauge(doc, 14 + halfW / 2, y + 34, 16, healthScore, pdfHealthColor(healthScore), pdfHealthLabel(healthScore));

        drawPredictionCard(doc, 14 + halfW + 8, y, halfW, rowH, d);

        y += rowH + 8;

        const weatherH = 34;
        drawWeatherCard(doc, 14, y, pageW - 28, weatherH, d);
        y += weatherH + 8;

        /* -------- Leaflet map screenshot (never blocks export) -------- */
        const mapCardH = 58;
        drawCard(doc, 14, y, pageW - 28, mapCardH, { fill: PDF_PALETTE.cardBg });
        drawSectionTitle(doc, 'Field Location — Satellite Map', 20, y + 9, PDF_PALETTE.blue);
        let mapImg = null;
        try {
            mapImg = await captureMapDataURL();
        } catch (e) {
            mapImg = null;
        }
        if (mapImg) {
            try {
                doc.addImage(mapImg, 'PNG', 20, y + 13, pageW - 40, mapCardH - 19);
            } catch (e) {
                doc.setFontSize(9);
                doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
                doc.text('Map preview could not be embedded.', 20, y + 30);
            }
        } else {
            doc.setFontSize(9);
            doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
            doc.text('Live map snapshot unavailable — view the field on the KrishiMitra dashboard.', 20, y + 30);
        }
        y += mapCardH + 8;

        /* -------- QR Code (never blocks export) -------- */
        const qrCardH = 26;
        if (y + qrCardH > pageH - 18) {
            doc.addPage();
            drawHeader(doc, pageW, { compact: true });
            y = 28;
        }
        drawCard(doc, 14, y, pageW - 28, qrCardH, { fill: PDF_PALETTE.cardBg });
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(PDF_PALETTE.ink[0], PDF_PALETTE.ink[1], PDF_PALETTE.ink[2]);
        doc.text('Scan for Field Summary', 44, y + 9);
        doc.setFont(undefined, 'normal');
        doc.setFontSize(8);
        doc.setTextColor(PDF_PALETTE.muted[0], PDF_PALETTE.muted[1], PDF_PALETTE.muted[2]);
        const qrLines = [
            'Farmer: ' + pdfGetSafe(d, 'field.name', 'N/A'),
            'Field ID: ' + pdfGetSafe(d, 'field.id', 'N/A') + '   ·   District: ' + pdfGetSafe(d, 'field.district', 'N/A'),
            'Crop: ' + pdfGetSafe(d, 'ai_prediction.predicted_crop', 'N/A') + '   ·   Stress: ' + pdfGetSafe(d, 'ai_prediction.predicted_stress', 'N/A'),
            'Date: ' + pdfGetSafe(d, 'field.date', 'N/A') + '   ·   Recommended Water: ' + pdfGetSafe(d, 'advisory.recommended_water_mm', 'N/A') + ' mm',
        ];
        doc.text(qrLines, 44, y + 15);

        try {
            const qrText = [
                'Farmer: ' + pdfGetSafe(d, 'field.name', 'N/A'),
                'Field ID: ' + pdfGetSafe(d, 'field.id', 'N/A'),
                'District: ' + pdfGetSafe(d, 'field.district', 'N/A'),
                'Crop: ' + pdfGetSafe(d, 'ai_prediction.predicted_crop', 'N/A'),
                'Stress: ' + pdfGetSafe(d, 'ai_prediction.predicted_stress', 'N/A'),
                'Date: ' + pdfGetSafe(d, 'field.date', 'N/A'),
                'Recommended Water: ' + pdfGetSafe(d, 'advisory.recommended_water_mm', 'N/A') + ' mm',
            ].join('\n');
            const qrDataUrl = await generateQRDataURL(qrText, 160);
            if (qrDataUrl) {
                doc.addImage(qrDataUrl, 'PNG', 16, y + 3, qrCardH - 6, qrCardH - 6);
            } else {
                doc.setFontSize(7.5);
                doc.text('QR\nN/A', 16 + (qrCardH - 6) / 2, y + qrCardH / 2, { align: 'center' });
            }
        } catch (e) {
            /* QR failure must never block PDF generation */
        }

        /* -------------------- PAGE 2 : SATELLITE ANALYSIS -------------------- */
        doc.addPage();
        drawHeader(doc, pageW, { compact: true });
        y = 28;

        y = drawSatelliteCard(doc, 14, y, pageW - 28, pageH, d) + 2;
        y = drawIrrigationCard(doc, 14, y, pageW - 28, pageH, d) + 2;
        y = drawReasoningBoxes(doc, 14, y, pageW - 28, pageH, d);

        /* -------------------- PAGE 3 : TABLES + CHARTS -------------------- */
        doc.addPage();
        drawHeader(doc, pageW, { compact: true });
        y = 28;
        drawSectionTitle(doc, 'Detailed Data Tables', 14, y, PDF_PALETTE.greenDeep);
        y += 6;

        const feats = pdfGetSafe(d, 'satellite_features', {});
        const ai = pdfGetSafe(d, 'ai_prediction', {});
        const adv = pdfGetSafe(d, 'advisory', {});

        try {
            doc.autoTable({
                startY: y,
                margin: { left: 14, right: 14 },
                head: [['Farmer Details', 'Value']],
                headStyles: { fillColor: PDF_PALETTE.greenDeep, textColor: 255, fontSize: 9 },
                bodyStyles: { fontSize: 8.5, textColor: [60, 70, 65] },
                body: [
                    ['Farmer Name', pdfGetSafe(d, 'field.name', 'N/A')],
                    ['Field ID', pdfGetSafe(d, 'field.id', 'N/A')],
                    ['District', pdfGetSafe(d, 'field.district', 'N/A')],
                    ['State', pdfGetSafe(d, 'field.state', 'N/A')],
                    ['Latitude', pdfGetSafe(d, 'field.lat', 'N/A')],
                    ['Longitude', pdfGetSafe(d, 'field.lon', 'N/A')],
                    ['Date', pdfGetSafe(d, 'field.date', 'N/A')],
                ],
            });
            y = doc.lastAutoTable.finalY + 6;
        } catch (e) { /* skip table on failure, keep going */ }

        try {
            doc.autoTable({
                startY: y,
                margin: { left: 14, right: 14 },
                head: [['Satellite Features', 'Value']],
                headStyles: { fillColor: PDF_PALETTE.greenDeep, textColor: 255, fontSize: 9 },
                bodyStyles: { fontSize: 8.5, textColor: [60, 70, 65] },
                body: [
                    ['NDVI', pdfFormatNumber(pdfGetSafe(feats, 'optical.NDVI', null), 3)],
                    ['NDWI', pdfFormatNumber(pdfGetSafe(feats, 'optical.NDWI', null), 3)],
                    ['MSI', pdfFormatNumber(pdfGetSafe(feats, 'optical.MSI', null), 3)],
                    ['SAR VV (dB)', pdfFormatNumber(pdfGetSafe(feats, 'sar.VV_dB', null), 2)],
                    ['SAR VH (dB)', pdfFormatNumber(pdfGetSafe(feats, 'sar.VH_dB', null), 2)],
                    ['VV/VH Ratio', pdfFormatNumber(pdfGetSafe(feats, 'sar.VV_VH_ratio', null), 2)],
                    ['Growth Stage', pdfGetSafe(feats, 'growth_stage', 'N/A')],
                    ['Source', pdfGetSafe(feats, 'source', 'N/A')],
                ],
            });
            y = doc.lastAutoTable.finalY + 6;
        } catch (e) { /* skip */ }

        if (y > pageH - 80) {
            doc.addPage();
            drawHeader(doc, pageW, { compact: true });
            y = 28;
        }

        try {
            doc.autoTable({
                startY: y,
                margin: { left: 14, right: 14 },
                head: [['Prediction', 'Value']],
                headStyles: { fillColor: PDF_PALETTE.greenDeep, textColor: 255, fontSize: 9 },
                bodyStyles: { fontSize: 8.5, textColor: [60, 70, 65] },
                body: [
                    ['Predicted Crop', pdfGetSafe(ai, 'predicted_crop', 'N/A')],
                    ['Crop Confidence', pdfFormatNumber(Number(pdfGetSafe(ai, 'crop_confidence', null)) * 100, 1) + '%'],
                    ['Predicted Stress', pdfGetSafe(ai, 'predicted_stress', 'N/A')],
                    ['Stress Confidence', pdfFormatNumber(Number(pdfGetSafe(ai, 'stress_confidence', null)) * 100, 1) + '%'],
                    ['Health Score', pdfComputeHealthScore(d) + '/100'],
                ],
            });
            y = doc.lastAutoTable.finalY + 6;
        } catch (e) { /* skip */ }

        try {
            doc.autoTable({
                startY: y,
                margin: { left: 14, right: 14 },
                head: [['Water Recommendation', 'Value']],
                headStyles: { fillColor: PDF_PALETTE.greenDeep, textColor: 255, fontSize: 9 },
                bodyStyles: { fontSize: 8.5, textColor: [60, 70, 65] },
                body: [
                    ['Urgency', pdfGetSafe(adv, 'urgency', 'N/A')],
                    ['Stress Level', pdfGetSafe(adv, 'stress_level', 'N/A')],
                    ['Recommended Water', pdfGetSafe(adv, 'recommended_water_mm', 'N/A') + ' mm'],
                    ['Crop Water Demand', pdfGetSafe(adv, 'crop_water_demand_mm_day', 'N/A') + ' mm/day'],
                ],
            });
            y = doc.lastAutoTable.finalY + 6;
        } catch (e) { /* skip */ }

        try {
            doc.autoTable({
                startY: y,
                margin: { left: 14, right: 14 },
                head: [['Metadata', 'Value']],
                headStyles: { fillColor: PDF_PALETTE.greenDeep, textColor: 255, fontSize: 9 },
                bodyStyles: { fontSize: 8.5, textColor: [60, 70, 65] },
                body: [
                    ['Report Type', 'ISRO Satellite Intelligence Report'],
                    ['Generated On', new Date().toLocaleString()],
                    ['Platform', 'KrishiMitra AI — ISRO H2S 2026 — Team SpaceHack'],
                ],
            });
            y = doc.lastAutoTable.finalY + 10;
        } catch (e) { /* skip */ }

        if (y > pageH - 90) {
            doc.addPage();
            drawHeader(doc, pageW, { compact: true });
            y = 28;
        }
        drawChartsSection(doc, 14, y, pageW - 28, d);

        /* -------------------- FOOTERS (all pages, accurate page count) -------------------- */
        drawFooterAllPages(doc);

        doc.save('KrishiMitra_ISRO_Report_' + pdfGetSafe(d, 'field.id', 'field') + '.pdf');
    } catch (err) {
        console.error(err);
        alert('PDF generation failed: ' + (err && err.stack ? err.stack : err));
    }
}

