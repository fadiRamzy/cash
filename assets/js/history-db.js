"use strict";
/* ============================================================
   IscoreHistoryDB — سجل محلي فقط (IndexedDB) لآخر الملفات التي
   تم تحليلها. لا يتم رفع أي بيانات لأي خادم خارجي. لا يتم تخزين
   ملف الـ PDF الأصلي، فقط البيانات المستخلصة (ملخص، تسهيلات، خط زمني).
   ============================================================ */
(function (global) {
  const DB_NAME = "iscore_cash_local_db";
  const DB_VERSION = 1;
  const STORE = "analyses";

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB غير مدعوم في هذا المتصفح"));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("analyzedAt", "analyzedAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("تعذر فتح قاعدة البيانات المحلية"));
    });
  }

  function tx(storeMode) {
    return openDb().then((db) => db.transaction(STORE, storeMode).objectStore(STORE));
  }

  function genId() {
    return "a_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  /**
   * record: { fileName, status, client, creditSummary, facilities, timeline, diagnostics }
   * لا تُخزَّن بيانات الملف الثنائية إطلاقًا.
   */
  async function addRecord(record) {
    const store = await tx("readwrite");
    const entry = {
      id: genId(),
      analyzedAt: new Date().toISOString(),
      fileName: record.fileName || "ملف غير معروف",
      status: record.status || "ok", // ok | partial | error
      clientName: record.client && record.client.name ? record.client.name : null,
      nationalId: record.client && record.client.nationalId ? record.client.nationalId : null,
      facilitiesCount: Array.isArray(record.facilities) ? record.facilities.length : 0,
      client: record.client || null,
      creditSummary: record.creditSummary || null,
      facilities: record.facilities || [],
      timeline: record.timeline || [],
      diagnostics: record.diagnostics || [],
      detectedFormat: record.detectedFormat || null,
    };
    return new Promise((resolve, reject) => {
      const req = store.add(entry);
      req.onsuccess = () => resolve(entry);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(limit) {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
      const items = [];
      const req = store.openCursor(null, "prev"); // الأحدث أولاً (يعتمد ترتيب المفاتيح على وقت الإدراج)
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && (!limit || items.length < limit)) {
          items.push(cursor.value);
          cursor.continue();
        } else {
          items.sort((a, b) => (b.analyzedAt || "").localeCompare(a.analyzedAt || ""));
          resolve(limit ? items.slice(0, limit) : items);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function getById(id) {
    const store = await tx("readonly");
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteById(id) {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearAll() {
    const store = await tx("readwrite");
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  global.IscoreHistoryDB = { addRecord, getAll, getById, deleteById, clearAll };
})(window);
