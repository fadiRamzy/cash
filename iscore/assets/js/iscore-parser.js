"use strict";
/* ============================================================
   محرك تحليل تقارير آيسكور — IscoreParser
   يحتوي على منطق الاستخراج المستخدم بواسطة أداة التحليل.
   تم فصله في ملف مستقل حتى يمكن إعادة استخدامه من أكثر من صفحة
   ولتسهيل الصيانة دون المساس بمنطق الاستخراج الأصلي الذي يعمل بنجاح.
   ============================================================ */
(function (global) {

  const ARABIC_MONTHS = "يناير|فبراير|مارس|أبريل|إبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر";
  const MONTH_INDEX = {
    "يناير": 0, "فبراير": 1, "مارس": 2, "أبريل": 3, "إبريل": 3, "ابريل": 3, "مايو": 4, "يونيو": 5,
    "يوليو": 6, "أغسطس": 7, "اغسطس": 7, "سبتمبر": 8, "أكتوبر": 9, "اكتوبر": 9, "نوفمبر": 10, "ديسمبر": 11,
  };

  function collapse(t) { return t.replace(/\s+/g, " ").trim(); }

  function cleanExtracted(t) {
    return t.normalize("NFKC").replace(/\u0000/g, "").replace(/\u06BE/g, "\u0647")
      .replace(/\uFEFF/g, "").replace(/[\u064B-\u0652]/g, "")
      .replace(/قرض\s*شخ(?!\s*صي)(?=\s|\||$)/g, "قرض شخصي");
  }

  // يعيد صياغة صيغة "ضامن شخصي" المبتورة (مثل "ضامن شخ") إلى شكلها الكامل عند وضوح السياق،
  // دون المساس بقيمة "ضامن" المستقلة التي تمثل علاقة مختلفة.
  function normalizeRelationship(raw) {
    if (!raw) return raw;
    const v = collapse(String(raw));
    if (/^ضامن\s*ش(?:\s*خ)?(?:\s*ص)?$/.test(v)) return "ضامن شخصي";
    return v;
  }

  function canon(code) {
    const letters = (code.match(/[A-Za-z]+/g) || []).join("").toUpperCase();
    const digits = (code.match(/\d+/g) || []).join("");
    return letters + digits;
  }

  // بعض ملفات آيسكور تفقد رابطة الحروف "لا" أثناء استخراج النص (مشكلة شائعة في بعض الخطوط
  // المضمنة بملفات PDF)، فتتحول مثلاً "الميلاد" إلى "الميد" و"الاستعلام" إلى "استعم".
  // هذه الدالة تبني تعبيرًا نمطيًا يتقبل ظهور أو غياب "لا" في أي موضع بالكلمة.
  function looseLabel(label) {
    return label.split("لا").join("(?:لا)?");
  }

  function toNumber(str) {
    if (!str) return null;
    const cleaned = String(str).replace(/,/g, "").trim();
    if (!cleaned || /غ\s*م/.test(cleaned) || !/\d/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  function fmtNumber(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return "غير متاح";
    try { return n.toLocaleString("ar-EG-u-nu-latn"); } catch { return String(n); }
  }

  // يحاول تحويل تاريخ عربي نصي مثل "11 نوفمبر 2024" أو "-11نوفمبر2024-" إلى Date
  function parseArabicDate(str) {
    if (!str) return null;
    const m = String(str).match(new RegExp(`(\\d{1,2})\\s*(${ARABIC_MONTHS})\\s*(\\d{4})`));
    if (!m) return null;
    const day = Number(m[1]);
    const month = MONTH_INDEX[m[2]];
    const year = Number(m[3]);
    if (month === undefined) return null;
    const d = new Date(Date.UTC(year, month, day || 1));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /* ===================== كشف تنسيق التقرير ===================== */
  function detectFormat(rawText) {
    const cleaned = collapse(cleanExtracted(rawText));
    const hasDetailed = /التسهيل ائتماني\s*\d+\s*\|/.test(cleaned);
    const summaryMarker = new RegExp(`${looseLabel("التسهيلات المغلقة")}|${looseLabel("التسهيلات السارية")}`);
    const hasSummary = summaryMarker.test(cleaned);
    const looksLikeIscore = /i-?score|آيسكور|تقرير ائتماني/i.test(cleaned);
    if (hasDetailed && hasSummary) return { format: "detailed+summary", recognized: true, looksLikeIscore };
    if (hasDetailed) return { format: "detailed", recognized: true, looksLikeIscore };
    if (hasSummary) return { format: "summary", recognized: true, looksLikeIscore };
    return { format: "unknown", recognized: false, looksLikeIscore };
  }

  /* ===================== بيانات العميل ===================== */
  function extractClientInfo(rawText, diagnostics) {
    const text = collapse(cleanExtracted(rawText));
    const info = {
      name: null, nationalId: null, score: null, dob: null,
      occupation: null, queryDate: null, gender: null, maritalStatus: null,
    };
    try {
      const idMatch = text.match(/\b(\d{14})\b/);
      if (idMatch) info.nationalId = idMatch[1];

      // ترتيب "التسمية: القيمة" (شائع في سطر معايير البحث)
      const nameMatch = text.match(/اسم\s*:?\s*([\u0600-\u06FF][\u0600-\u06FF\s]{2,40}?)\s*(?:نوع التعريف|تاريخ)/);
      // ترتيب معكوس "القيمة : التسمية" (شائع في بطاقة الملف الشخصي)
      const nameMatchReversed = !nameMatch && text.match(/([\u0600-\u06FF]+(?:\s[\u0600-\u06FF]+){1,5})\s*:\s*اسم(?=\s|$)/);
      if (nameMatch) info.name = nameMatch[1].trim();
      else if (nameMatchReversed) info.name = nameMatchReversed[1].trim();

      const scoreNear = text.match(/(?:التقييم الرقمي|التقييم ائتماني|التقييم الائتماني)[\s\S]{0,20}?([3-8]\d{2})\b/);
      if (scoreNear) info.score = scoreNear[1];

      if (!info.name || !info.score) {
        const rowMatch = text.match(/(\d{14})\s+([\u0600-\u06FF][\u0600-\u06FF\s]{0,80}?)\s*([3-8]\d{2})/);
        if (rowMatch) {
          if (!info.score) info.score = rowMatch[3];
          if (!info.name) {
            const words = rowMatch[2].trim().split(/\s+/);
            info.name = (words.length % 2 === 0 && words.length >= 4)
              ? words.slice(0, words.length / 2).join(" ") : rowMatch[2].trim();
          }
        }
      }

      const dobLabelShort = "تاريخ\\s*(?:الميلاد|الميد)"; // تحمّل فقد رابطة "لا"
      const dobMatch = text.match(new RegExp(`${dobLabelShort}[\\s\\S]{0,15}?(\\d{1,2}\\s*-?\\s*(?:${ARABIC_MONTHS})\\s*-?\\s*\\d{4})`))
        || text.match(new RegExp(`(\\d{1,2}\\s*-?\\s*(?:${ARABIC_MONTHS})\\s*-?\\s*\\d{4})\\s*:?\\s*${dobLabelShort}`));
      if (dobMatch) info.dob = collapse(dobMatch[1]);

      const queryLabelShort = "تاريخ\\s*(?:الاستعلام|استعم|الاستعم)"; // تحمّل فقد رابطة "لا"
      const queryDateMatch = text.match(new RegExp(`${queryLabelShort}[\\s\\S]{0,15}?(\\d{1,2}\\s*-?\\s*(?:${ARABIC_MONTHS})\\s*-?\\s*\\d{4})`))
        || text.match(new RegExp(`(\\d{1,2}\\s*-?\\s*(?:${ARABIC_MONTHS})\\s*-?\\s*\\d{4})\\s*:?\\s*${queryLabelShort}`));
      if (queryDateMatch) info.queryDate = collapse(queryDateMatch[1]);

      // نقيّد القيمة بكلمة واحدة عادة (مثل "آخرون"، "موظف") لتفادي التقاط نص من حقول سابقة
      const occMatch = text.match(/(?:الاشغال|الأشغال)\s*:?\s*([\u0600-\u06FF]+)(?:\s+اتصال|\s+هاتف|\s*$)/)
        || text.match(/([\u0600-\u06FF]+)\s*:\s*(?:الاشغال|الأشغال|اشغال)(?=\s|$)/);
      if (occMatch) info.occupation = collapse(occMatch[1]);

      const genderMatch = text.match(/النوع\s*:?\s*(ذكر|أنثى|انثى)/) || text.match(/(ذكر|أنثى|انثى)\s*:\s*النوع/);
      if (genderMatch) info.gender = genderMatch[1];

      const maritalMatch = text.match(/الحالة\s*الاجتماعية\s*:?\s*(متزوج|أعزب|اعزب|مطلق|أرمل|ارمل)/)
        || text.match(/(متزوج|أعزب|اعزب|مطلق|أرمل|ارمل)\s*:\s*الحالة\s*اجتماعية/);
      if (maritalMatch) info.maritalStatus = maritalMatch[1];
    } catch (err) {
      diagnostics && diagnostics.push({ stage: "بيانات العميل", message: err.message });
    }
    return info;
  }

  /* ===================== التنسيق المفصل ("تقرير ائتماني افراد") ===================== */
  function parseDetailed(rawText, lookup, diagnostics) {
    const text = cleanExtracted(rawText);
    const parts = text.split(/(?=التسهيل ائتماني\s*\d+\s*\|)/);
    const facilities = [];
    const VAL = "(?:غ\\s*م|[\\d,]+)";
    const paymentTypeWords = "شهرى|بشكل متعاقب|الطلب|ربع سنوى|نصف سنوى|سنوى";

    for (const part of parts) {
      try {
        const seg = collapse(part);
        const header = seg.match(/التسهيل ائتماني\s*(\d+)\s*\|\s*([^\|]{1,150}?)\s*\|\s*تاريخ اخر اقرار[^ك]{0,300}?كود الجهة\s*:\s*([A-Za-z0-9]{6,12})/);
        if (!header) continue;
        const [, , type, code] = header;

        const dateAmount = seg.match(new RegExp(`-?\\s*(\\d{1,2})\\s*-?\\s*(${ARABIC_MONTHS})-?\\s*(\\d{4})\\s*-?\\s*جنيه\\s*م\\S{0,3}\\s+([\\d,]+)\\s*(?:غ\\s*م|[\\d,]+)\\s*([\\d,]+)?`));
        let date = "غير متاح", amount = "غير متاح", installment = "غير متاح";
        if (dateAmount) {
          date = `${dateAmount[1]} ${dateAmount[2]} ${dateAmount[3]}`;
          amount = dateAmount[4];
          installment = dateAmount[5] || "غير متاح";
        }

        // بعض التقارير تعرض "بيانات اصدار" التسهيل بترتيب مختلف (المبلغ قبل العملة بدلاً من بعدها)،
        // أو يتم فصل يوم التاريخ عن الشهر/السنة بسبب التفاف عمود التاريخ عبر أكثر من سطر أثناء
        // استخراج النص، بحيث تقع بيانات أعمدة أخرى (المبلغ، العملة، القسط...) بين جزأي التاريخ.
        // نستخدم قسم "بيانات اصدار" وحده (قبل "بيانات السداد") كنطاق بديل أضيق لاستكمال أي حقل
        // تعذّر استخراجه بالنمط الأعلى، دون المساس بالنتائج التي نجح النمط الأصلي في استخراجها.
        const issuanceBlockMatch = seg.match(/بيانات\s*اصدار([\s\S]*?)(?=بيانات\s*السداد|$)/);
        const issuanceBlock = issuanceBlockMatch ? issuanceBlockMatch[1] : "";
        if (issuanceBlock) {
          if (date === "غير متاح") {
            const dayFallback = issuanceBlock.match(/-\s*(\d{1,2})(?!\d)/);
            const monthYearFallback = issuanceBlock.match(new RegExp(`(${ARABIC_MONTHS})-?\\s*(\\d{4})`));
            if (dayFallback && monthYearFallback) {
              date = `${dayFallback[1]} ${monthYearFallback[1]} ${monthYearFallback[2]}`;
            }
          }
          if (amount === "غير متاح" || installment === "غير متاح") {
            const amountInstallmentFallback = issuanceBlock.match(/([\d,]{3,})\s*جنيه\s*م\S{0,3}\s+([\d,]+|غ\s*م)/);
            if (amountInstallmentFallback) {
              if (amount === "غير متاح") amount = amountInstallmentFallback[1];
              if (installment === "غير متاح") {
                installment = /غ\s*م/.test(amountInstallmentFallback[2]) ? "غير متاح" : amountInstallmentFallback[2];
              }
            }
          }
        }

        // الحالة الأدق: تاريخ الإغلاق ملاصق لكلمة "مغلق" في بيانات موقف التسهيل
        const closedWithDate = seg.match(new RegExp(`(\\d{1,2}\\s*-?\\s*(?:${ARABIC_MONTHS})\\s*-?\\s*\\d{4})-?\\s*(مغلق)`));
        const statusMatch = closedWithDate
          ? [null, closedWithDate[2]]
          : (seg.match(/(?<![\u0600-\u06FF])(ساري|مغلق|معلق|غير ساري)(?![\u0600-\u06FF])/) || seg.match(/(ساري|مغلق|معلق|غير ساري)/));
        const closeDate = closedWithDate ? collapse(closedWithDate[1]) : null;

        const regularityMatch = seg.match(/(?<![\u0600-\u06FF])(منتظم|متأخر)(?![\u0600-\u06FF])/);
        const bucketMatch = seg.match(/حتى\s*(\d+)[^\d]{0,3}يوم/) || seg.match(/من\s*(\d+)\s*إلى\s*(\d+)\s*يوم/);

        const delayBlock = seg.match(new RegExp(`عدد\\s*اقساط.{0,15}عدد\\s*أيام\\s*التأخير\\s*المبلغ\\s*المت[أا]خر[\\s\\S]{0,150}?(${VAL})\\s+(${VAL})\\s+(${VAL})\\s+(${VAL})\\s+(${VAL})`))
          || seg.match(new RegExp(`عدد اقساط المتأخرة[\\s\\S]{0,150}?(${VAL})\\s+(${VAL})\\s+(${VAL})\\s+(${VAL})\\s+(${VAL})`))
          || seg.match(/(\d+)\s+(\d+)\s+([\d,]+)\s+(\d+)\s+(\d+)\s+غ\s*م\s+(?:منتظم|متأخر)/);
        const delayDays = delayBlock ? delayBlock[2] : "غير متاح";
        const overdueAmount = delayBlock ? delayBlock[3] : "غير متاح";

        const lastPayMatch = seg.match(new RegExp(`(?:${ARABIC_MONTHS})-?\\s*\\d{4}\\s+([\\d,]+|غ\\s*م)\\s+\\d{1,2}-?\\s*(?:${ARABIC_MONTHS})-?\\s*\\d{4}\\s+غ\\s*م\\s+شهرى`))
          || seg.match(/غ\s*م\s+([\d,]+|غ\s*م)\s+غ\s*م\s+غ\s*م\s+شهرى/)
          || seg.match(new RegExp(`(?:${ARABIC_MONTHS})-?\\s*\\d{4}\\s+(غ\\s*م|[\\d,]+)\\s+غ\\s*م\\s+غ\\s*م\\s+شهرى`));
        const lastPayment = lastPayMatch ? lastPayMatch[1] : "غير متاح";

        // الرصيد المستحق: يظهر مباشرة بعد نوع السداد (شهرى / بشكل متعاقب / الطلب...)
        const balanceMatch = seg.match(new RegExp(`(?:${paymentTypeWords})\\s+(${VAL})`));
        const outstandingBalance = balanceMatch ? balanceMatch[1] : "غير متاح";

        // بعض التقارير تُفصل بيانات "لمعرف المقترض" عن قيمتها الفعلية بمحتوى دخيل (فواصل صفحات،
        // ترويسة/تذييل الصفحة، أو خلايا جدول أخرى وقعت بينهما أثناء استخراج النص)، لذا نسمح بفجوة
        // محدودة بين بداية العبارة وعلامتها المميزة بدلاً من اشتراط التلاصق المباشر.
        const relKnownGuarantorPersonal = seg.match(/لمعرف المقترض\s*ُ?[\s\S]{0,120}?ضامن\s*(?:ش\s*خ\s*ص\s*ي|شيخ|شخصي|شخ(?!\s*صي))/);
        const relKnownBorrower = !relKnownGuarantorPersonal && seg.match(/لمعرف المقترض\s*ُ?[\s\S]{0,120}?مقترض\s*\/\s*حامل[\s\S]{0,80}?البطاقة\s*(?:ال)?اساسية/);
        const relKnownOwner = !relKnownGuarantorPersonal && !relKnownBorrower
          && seg.match(/لمعرف المقترض\s*ُ?[\s\S]{0,120}?صاحب[\s\S]{0,60}?منش[أا]ة\s*فردية/);
        const relKnownOther = !relKnownGuarantorPersonal && !relKnownBorrower && !relKnownOwner
          && seg.match(/لمعرف المقترض\s*ُ?\s*(كفيل\s*شركة|كفيل\s*شخصي|مقترض|ضامن|كفيل)/);
        const relMatch = !relKnownGuarantorPersonal && !relKnownBorrower && !relKnownOwner && !relKnownOther
          && seg.match(/لمعرف المقترض\s*ُ?\s*([\u0600-\u06FF\s\/]+?)\s*(?:متناهي الصغر|تجاري)/);

        // بعض التقارير لا تستخدم عبارة "لمعرف المقترض" كعلامة مرجعية إطلاقًا، بل تضع علاقة العميل
        // مباشرة داخل قسم "بيانات اصدار" التسهيل (بعد مؤشر الضمانة وقبل مؤشر طبيعة التسهيل). نبحث
        // هنا عن نفس القيم المعروفة ضمن هذا القسم فقط كحل احتياطي أخير، حتى لا نلتقط نصًا من أقسام
        // أخرى غير متعلقة (كالإجراءات القانونية أو الشكاوى) بالخطأ.
        const relFallbackScope = issuanceBlock || seg;
        const relFallbackGuarantorPersonal = !relKnownGuarantorPersonal && !relKnownBorrower && !relKnownOwner && !relKnownOther && !relMatch
          && relFallbackScope.match(/ضامن\s*(?:ش\s*خ\s*ص\s*ي|شيخ|شخصي|شخ(?!\s*صي))/);
        const relFallbackBorrower = !relKnownGuarantorPersonal && !relKnownBorrower && !relKnownOwner && !relKnownOther && !relMatch && !relFallbackGuarantorPersonal
          && relFallbackScope.match(/مقترض\s*\/\s*حامل[\s\S]{0,20}?البطاقة\s*(?:ال)?اساسية/);
        const relFallbackOwner = !relKnownGuarantorPersonal && !relKnownBorrower && !relKnownOwner && !relKnownOther && !relMatch && !relFallbackGuarantorPersonal && !relFallbackBorrower
          && relFallbackScope.match(/صاحب[\s\S]{0,20}?منش[أا]ة\s*فردية/);
        const relFallbackOther = !relKnownGuarantorPersonal && !relKnownBorrower && !relKnownOwner && !relKnownOther && !relMatch
          && !relFallbackGuarantorPersonal && !relFallbackBorrower && !relFallbackOwner
          && relFallbackScope.match(/(كفيل\s*شركة|كفيل\s*شخصي)/);

        const relationship = relKnownGuarantorPersonal ? "ضامن شخصي"
          : relKnownBorrower ? "مقترض / حامل البطاقة الأساسية"
          : relKnownOwner ? "صاحب منشأة فردية"
          : relKnownOther ? relKnownOther[1].trim()
          : relMatch ? collapse(relMatch[1].replace(/يوجد/g, "")).trim()
          : relFallbackGuarantorPersonal ? "ضامن شخصي"
          : relFallbackBorrower ? "مقترض / حامل البطاقة الأساسية"
          : relFallbackOwner ? "صاحب منشأة فردية"
          : relFallbackOther ? relFallbackOther[1].trim()
          : "غير متاح";

        const institutionCodeMatch = seg.match(/كود الجهة\s*:\s*([A-Za-z0-9]{6,12})/);
        const institutionCode = institutionCodeMatch ? institutionCodeMatch[1] : code;
        const info = lookup ? lookup.get(canon(institutionCode)) : null;

        facilities.push({
          index: facilities.length + 1,
          code: institutionCode,
          name: info ? info.name : "غير معروف",
          type: type.trim(),
          date, amount, installment, lastPayment, relationship,
          outstandingBalance,
          status: statusMatch ? statusMatch[1] : "غير متاح",
          closeDate,
          delayDays, overdueAmount,
          delay: regularityMatch ? (regularityMatch[1] === "متأخر" ? `متأخر (حتى ${bucketMatch ? bucketMatch[1] : "؟"} يوم)` : "منتظم") : "غير متاح",
        });
      } catch (err) {
        diagnostics && diagnostics.push({ stage: "تسهيل ائتماني (تنسيق مفصل)", message: err.message });
      }
    }
    return facilities;
  }

  /* ===================== تنسيق الملخص ("تقرير الاستعلام الائتماني") — محفوظ كما هو ===================== */
  function parseSummary(rawText, lookup, diagnostics) {
    const text = collapse(cleanExtracted(rawText));
    const facilities = [];
    try {
      const closedBlockMatch = text.match(/التسهيلات المغلقة([\s\S]{0,30000}?)(?=التسهيلات السارية|$)/);
      if (closedBlockMatch) {
        const re = /(مقترض\s*\/\s*حامل\s*البطاقة\s*الاساسية|ضامن\s*ش\s*خ\s*ص\s*ي|كفيل\s*شركة|كفيل\s*شخصي|مقترض|ضامن|كفيل|[^\d]{1,20}?)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d,]+)\s+([A-Za-z0-9]{6,12})\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(مغلق|ساري|معلق)/g;
        let m;
        while ((m = re.exec(closedBlockMatch[1]))) {
          const [, relationship, delayDays, , , amount, code, closeDate, status] = m;
          const info = lookup ? lookup.get(canon(code)) : null;
          facilities.push({
            index: facilities.length + 1,
            code, name: info ? info.name : "غير معروف", type: "تسهيل مغلق",
            date: closeDate, amount, installment: "غير متاح", lastPayment: "غير متاح", relationship: normalizeRelationship(relationship.trim()),
            outstandingBalance: "0", status, closeDate, delayDays, overdueAmount: "غير متاح",
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
          const info = lookup ? lookup.get(canon(code)) : null;
          facilities.push({
            index: facilities.length + 1,
            code, name: info ? info.name : "غير معروف", type: facilityType.trim(),
            date: approvalDate, amount, installment, lastPayment: "غير متاح", status: "ساري", relationship: normalizeRelationship(relationship.trim()),
            outstandingBalance: amount, closeDate: null, delayDays, overdueAmount,
            delay: Number(delayDays) > 0 ? `متأخر (${delayDays} يوم)` : "منتظم",
          });
        }
      }
    } catch (err) {
      diagnostics && diagnostics.push({ stage: "تسهيلات (تنسيق الملخص)", message: err.message });
    }
    return facilities;
  }

  /* ===================== ملخص المؤشرات الائتمانية (محسوب من التسهيلات المستخرجة) ===================== */
  function buildCreditSummary(facilities, rawText, diagnostics) {
    const summary = {
      totalFacilities: facilities.length,
      activeFacilities: 0,
      closedFacilities: 0,
      otherStatusFacilities: 0,
      institutionsCount: 0,
      totalCreditAmount: null,
      totalOutstandingBalance: null,
      totalInstallments: null,
      delayedFacilitiesCount: 0,
      totalOverdueAmount: null,
      bouncedChecksCount: null,
      bouncedChecksAmount: null,
    };
    try {
      const institutions = new Set();
      let sumAmount = 0, hasAmount = false;
      let sumBalance = 0, hasBalance = false;
      let sumInstallment = 0, hasInstallment = false;
      let sumOverdue = 0, hasOverdue = false;

      facilities.forEach((f) => {
        if (f.code) institutions.add(f.code);
        if (f.status === "ساري") summary.activeFacilities++;
        else if (f.status === "مغلق") summary.closedFacilities++;
        else summary.otherStatusFacilities++;

        const amt = toNumber(f.amount);
        if (amt !== null) { sumAmount += amt; hasAmount = true; }
        const bal = toNumber(f.outstandingBalance);
        if (bal !== null) { sumBalance += bal; hasBalance = true; }
        const inst = toNumber(f.installment);
        if (inst !== null) { sumInstallment += inst; hasInstallment = true; }
        if (typeof f.delay === "string" && f.delay.startsWith("متأخر")) summary.delayedFacilitiesCount++;
        const over = toNumber(f.overdueAmount);
        if (over !== null && over > 0) { sumOverdue += over; hasOverdue = true; }
      });

      summary.institutionsCount = institutions.size;
      summary.totalCreditAmount = hasAmount ? sumAmount : null;
      summary.totalOutstandingBalance = hasBalance ? sumBalance : null;
      summary.totalInstallments = hasInstallment ? sumInstallment : null;
      summary.totalOverdueAmount = hasOverdue ? sumOverdue : null;

      const text = collapse(cleanExtracted(rawText || ""));
      const bouncedLabel = looseLabel("شيكات مرتدة");
      const bouncedMatch = text.match(new RegExp(`${bouncedLabel}[\\s\\S]{0,60}?(?:EGP|جنيه\\s*م\\S{0,3})\\s*(\\d+)\\s+([\\d,]+)`));
      if (bouncedMatch) {
        summary.bouncedChecksCount = Number(bouncedMatch[1]);
        summary.bouncedChecksAmount = toNumber(bouncedMatch[2]);
      }
    } catch (err) {
      diagnostics && diagnostics.push({ stage: "ملخص التسهيلات", message: err.message });
    }
    return summary;
  }

  /* ===================== الخط الزمني للعميل ===================== */
  function buildTimeline(facilities, diagnostics) {
    const events = [];
    try {
      facilities.forEach((f) => {
        const openDate = parseArabicDate(f.date);
        const closeDateParsed = f.closeDate ? parseArabicDate(f.closeDate) : null;
        // مرساة التاريخ لحدث "منح تسهيل": نفضّل تاريخ المنح، وإلا تاريخ الغلق إن وُجد. وجود سجل
        // تسهيل واحد صالح يكفي لبناء الخط الزمني حتى لو لم يتوفر لهذا التسهيل بالذات تاريخ قابل
        // للتحويل — في هذه الحالة نبني الحدث حول بيانات التسهيل المتاحة دون اختلاق تاريخ، ونضعه في
        // نهاية الترتيب الزمني بدلاً من إسقاطه بالكامل.
        const anchorDate = openDate || closeDateParsed;
        events.push({
          date: anchorDate ? anchorDate.toISOString().slice(0, 10) : "9999-99-99",
          dateLabel: (f.date && f.date !== "غير متاح") ? f.date : ((f.closeDate && f.closeDate !== "غير متاح") ? f.closeDate : "غير متاح"),
          type: "منح تسهيل",
          title: `منح تسهيل: ${f.type}${f.name && f.name !== "غير معروف" ? " — " + f.name : ""}`,
          detail: f.amount && f.amount !== "غير متاح" ? `المبلغ الممنوح: ${f.amount}` : null,
        });
        if (f.closeDate && closeDateParsed) {
          events.push({
            date: closeDateParsed.toISOString().slice(0, 10),
            dateLabel: f.closeDate,
            type: "إغلاق تسهيل",
            title: `إغلاق تسهيل: ${f.type}${f.name && f.name !== "غير معروف" ? " — " + f.name : ""}`,
            detail: null,
          });
        }
        if (typeof f.delay === "string" && f.delay.startsWith("متأخر") && f.overdueAmount && f.overdueAmount !== "غير متاح") {
          // نستخدم تاريخ المنح (أو الغلق كبديل) كمرساة زمنية تقريبية لعرض التأخير المرتبط بالتسهيل
          // عندما لا يتوفر تاريخ محدد للتأخير نفسه.
          const anchor = openDate || closeDateParsed;
          if (anchor) {
            events.push({
              date: anchor.toISOString().slice(0, 10),
              dateLabel: f.date,
              type: "تأخير سداد",
              title: `تأخير سداد على تسهيل: ${f.type}`,
              detail: `عدد أيام التأخير: ${f.delayDays} — المبلغ المتأخر: ${f.overdueAmount}`,
              severity: "warn",
            });
          }
        }
      });
      events.sort((a, b) => a.date.localeCompare(b.date));
    } catch (err) {
      diagnostics && diagnostics.push({ stage: "الخط الزمني", message: err.message });
    }
    return events;
  }

  /* ===================== نقطة الدخول الرئيسية ===================== */
  async function analyzeText(fullText, lookup) {
    const diagnostics = [];
    const cleaned = collapse(cleanExtracted(fullText));
    const detection = detectFormat(fullText);

    let facilities = [];
    if (detection.format === "detailed" || detection.format === "detailed+summary") {
      facilities = facilities.concat(parseDetailed(fullText, lookup, diagnostics));
    }
    if (detection.format === "summary" || detection.format === "detailed+summary") {
      facilities = facilities.concat(parseSummary(fullText, lookup, diagnostics));
    }

    if (facilities.length === 0 && detection.format === "unknown") {
      diagnostics.push({ stage: "كشف التنسيق", message: "تعذر التعرف على تنسيق التقرير تلقائيًا." });
    }

    const client = extractClientInfo(fullText, diagnostics);
    const creditSummary = buildCreditSummary(facilities, fullText, diagnostics);
    const timeline = buildTimeline(facilities, diagnostics);

    return {
      detection,
      client,
      facilities,
      creditSummary,
      timeline,
      diagnostics,
      textLength: cleaned.length,
      analyzedAt: new Date().toISOString(),
    };
  }

  global.IscoreParser = {
    ARABIC_MONTHS,
    collapse,
    cleanExtracted,
    canon,
    toNumber,
    fmtNumber,
    parseArabicDate,
    detectFormat,
    extractClientInfo,
    parseDetailed,
    parseSummary,
    buildCreditSummary,
    buildTimeline,
    analyzeText,
  };

})(window);
