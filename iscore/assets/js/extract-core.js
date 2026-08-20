/*
 * extract-core.js
 * Shared iScore PDF extraction logic.
 * Extracted verbatim (unchanged parsing behavior) from tools/extractor.html
 * so it can be reused by both the standalone extractor tool and the Cash
 * "استخراج من الاستعلام الائتماني" feature, instead of being duplicated.
 */
(function (global) {
  "use strict";

  const ARABIC_MONTHS = "يناير|فبراير|مارس|أبريل|إبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر";
  const ARABIC_MONTH_NUM = {
    "يناير": "01", "فبراير": "02", "مارس": "03",
    "أبريل": "04", "إبريل": "04", "ابريل": "04",
    "مايو": "05", "يونيو": "06", "يوليو": "07",
    "أغسطس": "08", "اغسطس": "08", "سبتمبر": "09",
    "أكتوبر": "10", "اكتوبر": "10", "نوفمبر": "11", "ديسمبر": "12",
  };

  function canon(code) {
    const letters = (code.match(/[A-Za-z]+/g) || []).join("").toUpperCase();
    const digits = (code.match(/\d+/g) || []).join("");
    return letters + digits;
  }
  function collapse(t) { return t.replace(/\s+/g, " ").trim(); }
  function cleanExtracted(t) {
    return t.normalize("NFKC").replace(/\u0000/g, "").replace(/\u06BE/g, "\u0647")
      .replace(/\uFEFF/g, "").replace(/[\u064B-\u0652]/g, "")
      .replace(/قرض\s*شخ(?!\s*صي)(?=\s|\||$)/g, "قرض شخصي");
  }

  /* ===================== Detailed report format ("تقرير ائتماني افراد") ===================== */
  function parseDetailed(rawText, lookup) {
    const text = cleanExtracted(rawText);
    const parts = text.split(/(?=التسهيل ائتماني\s*\d+\s*\|)/);
    const facilities = [];
    for (const part of parts) {
      const seg = collapse(part);
      const header = seg.match(/التسهيل ائتماني\s*(\d+)\s*\|\s*([^\|]{1,150}?)\s*\|\s*تاريخ اخر اقرار[^ك]{0,300}?كود الجهة\s*:\s*([A-Za-z0-9]{6,12})/);
      if (!header) continue;
      const [, , type, code] = header;
      const dateAmount = seg.match(new RegExp(`-?\\s*(\\d{1,2})\\s*-?\\s*(${ARABIC_MONTHS})-?\\s*(\\d{4})\\s*-?\\s*جنيه\\s*م\\S{0,3}\\s+([\\d,]+)\\s*(?:غ\\s*م|[\\d,]+)\\s*([\\d,]+)?`));
      let date = "غير محدد", amount = "غير محدد", installment = "غير محدد";
      if (dateAmount) { date = `${dateAmount[1]} ${dateAmount[2]} ${dateAmount[3]}`; amount = dateAmount[4]; installment = dateAmount[5] || "غير محدد"; }
      const statusMatch = seg.match(/(?<![\u0600-\u06FF])(ساري|مغلق|معلق)(?![\u0600-\u06FF])/)
        || seg.match(/(ساري|مغلق|معلق)/);
      const regularityMatch = seg.match(/(?<![\u0600-\u06FF])(منتظم|متأخر)(?![\u0600-\u06FF])/);
      const bucketMatch = seg.match(/حتى\s*(\d+)[^\d]{0,3}يوم/);
      const VAL = "(?:غ\\s*م|[\\d,]+)";
      const delayBlock = seg.match(new RegExp(`عدد\\s*اقساط.{0,15}عدد\\s*أيام\\s*التأخير\\s*المبلغ\\s*المت[أا]خر[\\s\\S]{0,150}?(${VAL})\\s+(${VAL})\\s+(${VAL})\\s+(${VAL})\\s+(${VAL})`))
        || seg.match(new RegExp(`عدد اقساط المتأخرة[\\s\\S]{0,150}?(${VAL})\\s+(${VAL})\\s+(${VAL})\\s+(${VAL})\\s+(${VAL})`))
        || seg.match(/(\d+)\s+(\d+)\s+([\d,]+)\s+(\d+)\s+(\d+)\s+غ\s*م\s+(?:منتظم|متأخر)/);
      const delayDays = delayBlock ? delayBlock[2] : "غير محدد";
      const overdueAmount = delayBlock ? delayBlock[3] : "غير محدد";
      const lastPayMatch = seg.match(new RegExp(`(?:${ARABIC_MONTHS})-?\\s*\\d{4}\\s+([\\d,]+|غ\\s*م)\\s+\\d{1,2}-?\\s*(?:${ARABIC_MONTHS})-?\\s*\\d{4}\\s+غ\\s*م\\s+شهرى`))
        || seg.match(/غ\s*م\s+([\d,]+|غ\s*م)\s+غ\s*م\s+غ\s*م\s+شهرى/)
        || seg.match(new RegExp(`(?:${ARABIC_MONTHS})-?\\s*\\d{4}\\s+(غ\\s*م|[\\d,]+)\\s+غ\\s*م\\s+غ\\s*م\\s+شهرى`));
      const lastPayment = lastPayMatch ? lastPayMatch[1] : "غير محدد";
      const relKnown = seg.match(/لمعرف المقترض\s*ُ?\s*(مقترض\s*\/\s*حامل\s*البطاقة\s*الاساسية|ضامن\s*ش\s*خ\s*ص\s*ي|ضامن\s*شيخ|كفيل\s*شركة|كفيل\s*شخصي|مقترض|ضامن|كفيل)/);
      const relMatch = !relKnown && seg.match(/لمعرف المقترض\s*ُ?\s*([\u0600-\u06FF\s\/]+?)\s*(?:متناهي الصغر|تجاري)/);
      const relationship = relKnown ? collapse(relKnown[1]).trim() : relMatch ? collapse(relMatch[1].replace(/يوجد/g, "")).trim() : "غير محدد";
      const info = lookup.get(canon(code));
      facilities.push({
        code, name: info ? info.name : "غير معروف",
        type: type.trim(), date, amount, installment, lastPayment, relationship,
        status: statusMatch ? statusMatch[1] : "غير محدد",
        delayDays, overdueAmount,
        delay: regularityMatch ? (regularityMatch[1] === "متأخر" ? `متأخر (حتى ${bucketMatch ? bucketMatch[1] : "؟"} يوم)` : "منتظم") : "غير محدد",
      });
    }
    return facilities;
  }

  /* ===================== Summary report format ("تقرير الاستعلام الائتماني") ===================== */
  function parseSummary(rawText, lookup) {
    const text = collapse(cleanExtracted(rawText));
    const facilities = [];

    const closedBlockMatch = text.match(/التسهيلات المغلقة([\s\S]{0,30000}?)(?=التسهيلات السارية|$)/);
    if (closedBlockMatch) {
      const re = /(مقترض\s*\/\s*حامل\s*البطاقة\s*الاساسية|ضامن\s*ش\s*خ\s*ص\s*ي|كفيل\s*شركة|كفيل\s*شخصي|مقترض|ضامن|كفيل|[^\d]{1,20}?)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d,]+)\s+([A-Za-z0-9]{6,12})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(مغلق|ساري|معلق)/g;
      let m;
      while ((m = re.exec(closedBlockMatch[1]))) {
        const [, relationship, delayDays, , , amount, code, closeDate, status] = m;
        const info = lookup.get(canon(code));
        facilities.push({
          code, name: info ? info.name : "غير معروف", type: "تسهيل مغلق",
          date: closeDate, amount, installment: "غير محدد", lastPayment: "غير محدد", relationship: relationship.trim(),
          status, delayDays, overdueAmount: "غير محدد",
          delay: Number(delayDays) > 0 ? `متأخر (${delayDays} يوم)` : "منتظم",
        });
      }
    }

    const activeBlockMatch = text.match(/التسهيلات السارية([\s\S]{0,30000}?)(?=الإجراءات القانونية|$)/);
    if (activeBlockMatch) {
      const re = /(مقترض\s*\/\s*حامل\s*البطاقة\s*الاساسية|ضامن\s*ش\s*خ\s*ص\s*ي|كفيل\s*شركة|كفيل\s*شخصي|مقترض|ضامن|كفيل|[^\d]{1,20}?)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d+)\s+(لا يوجد|\S+)\s+(\d+)\s+(\d+)\s+([\d,]+)\s+(لا يوجد|[\d,]+)\s+(لا يوجد|\d+)\s+([\d,]+)\s+([^\d]{1,60}?)\s+([A-Za-z0-9]{6,12})\s+(\d{1,2}\/\d{1,2}\/\d{4})/g;
      let m;
      while ((m = re.exec(activeBlockMatch[1]))) {
        const [, relationship, , overdueAmount, , , delayDays, , installment, , amount, facilityType, code, approvalDate] = m;
        const info = lookup.get(canon(code));
        facilities.push({
          code, name: info ? info.name : "غير معروف", type: facilityType.trim(),
          date: approvalDate, amount, installment, lastPayment: "غير محدد", status: "ساري", relationship: relationship.trim(),
          delayDays, overdueAmount,
          delay: Number(delayDays) > 0 ? `متأخر (${delayDays} يوم)` : "منتظم",
        });
      }
    }
    return facilities;
  }

  function extractClientInfo(rawText) {
    const text = collapse(cleanExtracted(rawText));
    const idMatch = text.match(/\b(\d{14})\b/);
    let name = null, score = null;

    const nameMatch = text.match(/اسم\s*:\s*([\u0600-\u06FF][\u0600-\u06FF\s]{2,40}?)\s*تاريخ/);
    if (nameMatch) name = nameMatch[1].trim();

    const scoreNear = text.match(/(?:التقييم الرقمي|التقييم ائتماني|التقييم الائتماني)[\s\S]{0,20}?([3-8]\d{2})\b/);
    if (scoreNear) score = scoreNear[1];

    if (!name || !score) {
      const rowMatch = text.match(/(\d{14})\s+([\u0600-\u06FF][\u0600-\u06FF\s]{0,80}?)\s*([3-8]\d{2})/);
      if (rowMatch) {
        if (!score) score = rowMatch[3];
        if (!name) {
          const words = rowMatch[2].trim().split(/\s+/);
          name = (words.length % 2 === 0 && words.length >= 4) ? words.slice(0, words.length / 2).join(" ") : rowMatch[2].trim();
        }
      }
    }
    return { name: name || "غير متعرف عليه", score: score || "—", nationalId: idMatch ? idMatch[1] : "—" };
  }

  /* ===================== Combined helpers (used by consumers) ===================== */

  // Fetch + build the codes.json lookup map. codesUrl is relative to the caller's page.
  let cachedLookup = null;
  let cachedLookupUrl = null;
  async function getCodesLookup(codesUrl) {
    if (cachedLookup && cachedLookupUrl === codesUrl) return cachedLookup;
    const res = await fetch(codesUrl);
    const db = await res.json();
    const lookup = new Map();
    for (const r of db.records) lookup.set(canon(r.code), r);
    cachedLookup = lookup;
    cachedLookupUrl = codesUrl;
    return lookup;
  }

  // Run both parsers against the full extracted PDF text and merge results.
  function extractFacilities(fullText, lookup) {
    let facilities = [];
    const cleaned = cleanExtracted(fullText);
    if (/التسهيل ائتماني\s*\d+\s*\|/.test(cleaned)) {
      facilities = facilities.concat(parseDetailed(fullText, lookup));
    }
    if (/التسهيلات المغلقة|التسهيلات السارية/.test(cleaned.replace(/\s+/g, " "))) {
      facilities = facilities.concat(parseSummary(fullText, lookup));
    }
    return facilities;
  }

  // Best-effort conversion of an extracted date string to yyyy-mm-dd for <input type=date>.
  // Returns "" (rather than a guess) when the format isn't confidently recognized.
  function toIsoDate(dateStr) {
    if (!dateStr || dateStr === "غير محدد") return "";
    let m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const [, d, mo, y] = m;
      if (+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) {
        return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
      }
      return "";
    }
    m = dateStr.match(new RegExp(`^(\\d{1,2})\\s+(${ARABIC_MONTHS})\\s+(\\d{4})$`));
    if (m) {
      const [, d, monthName, y] = m;
      const mo = ARABIC_MONTH_NUM[monthName];
      if (mo) return `${y}-${mo}-${d.padStart(2, "0")}`;
    }
    return "";
  }

  // Extract full text from a PDF File object using pdf.js (caller must have pdfjsLib loaded).
  async function extractPdfText(file, pdfjsLib) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let fullText = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map((it) => it.str).join(" ") + "\n";
    }
    return fullText;
  }

  global.iScoreExtractCore = {
    canon, collapse, cleanExtracted,
    parseDetailed, parseSummary, extractClientInfo,
    getCodesLookup, extractFacilities, extractPdfText, toIsoDate,
  };
})(window);
