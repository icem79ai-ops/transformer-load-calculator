/* =====================================================================
   app.js — คำนวนโหลดหม้อแปลงและวงจรแรงต่ำสำหรับโครงการที่อยู่อาศัย
   © 2026 icem79ai-ops — All Rights Reserved / สงวนลิขสิทธิ์ทุกประการ
   ห้ามนำไปใช้ ดัดแปลง คัดลอก หรือเผยแพร่โดยไม่ได้รับอนุญาตเป็นลายลักษณ์อักษร
   ===================================================================== */

"use strict";

/* =====================================================================
   ฐานข้อมูลอ้างอิง (มาตรฐาน PEA)
   ===================================================================== */

/* --- มิเตอร์มาตรฐาน (Mock data ตามมาตรฐาน PEA/MEA) ---
   ⚠ หลักปฏิบัติ PEA: คิดโหลดมิเตอร์จากกระแส "หน้ากรวงเล็บ" (ตัวฐาน)
   เช่น 5(15)A ใช้ 5A, 15(45)A ใช้ 15A, 30(100)A ใช้ 30A
   - baseA = กระแสฐาน (หน้ากรวงเล็บ) ใช้คำนวณโหลด
   - kva   = โหลดของมิเตอร์ 1 เครื่อง (kVA) คำนวณจาก baseA
   - ampA  = กระแสที่ใช้ตรวจสอบสายไฟ = baseA
   ค่าจากหลักวิศวกรรม:
     เฟสเดียว 240V : kVA = baseA × 240V / 1000
     3 เฟส 416V    : kVA = √3 × baseA × 416V / 1000          */
const METERS = [
  { id: "1p15",  label: "มิเตอร์เฟสเดียว 5(15)A",   short: "5(15)A",   phase: "1P", baseA: 5,  kva: 1.2,  ampA: 5 },
  { id: "1p45",  label: "มิเตอร์เฟสเดียว 15(45)A",  short: "15(45)A",  phase: "1P", baseA: 15, kva: 3.6,  ampA: 15 },
  { id: "1p100", label: "มิเตอร์เฟสเดียว 30(100)A", short: "30(100)A", phase: "1P", baseA: 30, kva: 7.2,  ampA: 30 },
  { id: "3p45",  label: "มิเตอร์ 3 เฟส 15(45)A",    short: "15(45)A",  phase: "3P", baseA: 15, kva: 10.8, ampA: 15 },
  { id: "3p100", label: "มิเตอร์ 3 เฟส 30(100)A",   short: "30(100)A", phase: "3P", baseA: 30, kva: 21.6, ampA: 30 },
];

/* --- สายไฟแรงต่ำ (อลูมิเนียม THW-A) พิกัดทนกระแส --- */
const CABLES = {
  "50": { name: "THW-A 50 ตร.มม.", ampacity: 130 },
  "95": { name: "THW-A 95 ตร.มม.", ampacity: 209 },
};

/* --- หม้อแปลงมาตรฐาน (catalog รวมทุกขนาด) ---
   30 kVA  เป็นชนิด 1 เฟส 480/240V
   50–500  เป็นชนิด 3 เฟส 416/240V                            */
const TX_CATALOG = [
  { kva: 30,   phase: "1P", volt: "480/240V" },
  { kva: 50,   phase: "3P", volt: "416/240V" },
  { kva: 100,  phase: "3P", volt: "416/240V" },
  { kva: 160,  phase: "3P", volt: "416/240V" },
  { kva: 250,  phase: "3P", volt: "416/240V" },
  { kva: 315,  phase: "3P", volt: "416/240V" },
  { kva: 500,  phase: "3P", volt: "416/240V" },
];

/* ขนาดที่เลือกได้ ตามประเภทการติดตั้ง
   เสาเดียว  : 30, 50, 100, 160, 250 kVA
   นั่งร้าน   : 50, 100, 160, 250, 315, 500 kVA                */
const SIZE_BY_INSTALL = {
  pole:     [30, 50, 100, 160, 250],
  platform: [50, 100, 160, 250, 315, 500],
};

const txOf = (kva) => TX_CATALOG.find((t) => t.kva === kva);
const txLabel = (tx) => (tx ? tx.phase + " " + tx.kva + " kVA (" + tx.volt + ")" : "");

/* --- วงจรที่เปิดใช้งานตามประเภทการติดตั้ง ---
   เสาเดียว : วงจร 1 (ซ้าย), 3 (ขวา)
   นั่งร้าน  : วงจร 1, 3 (ซ้าย) และ 2, 4 (ขวา)               */
const CIRCUIT_SET = {
  pole:     [1, 3],
  platform: [1, 2, 3, 4],
};

/* แสดงฝั่งของวงจร — ขึ้นกับประเภทการติดตั้ง:
   เสาเดียว ว.1 = ซ้าย / ว.3 = ขวา (2 สายของหม้อแปลง 1 เฟส)
   นั่งร้าน  ว.1,3 = ซ้าย / ว.2,4 = ขวา (ฝั่งละ 2 วงจร)      */
function circuitSide(n) {
  if (state.installType === "pole") return n === 1 ? "ซ้าย" : "ขวา";
  return (n === 1 || n === 3) ? "ซ้าย" : "ขวา";
}

/* แรงดันใช้งานฝั่งแรงต่ำ (ใช้แปลง kVA → กระแสสำหรับวงจรเฟสเดียว) */
const LV_VOLT = 240; // V

/* =====================================================================
   State ของแอป (เก็บข้อมูลการกรอกทั้งหมด เพื่อให้ย้อนกลับแล้วไม่หาย)
   ===================================================================== */
const state = {
  mode: "A",                 // "A" = ติดตั้งหม้อแปลงใหม่ | "B" = เพิ่มโหลดในหม้อแปลงเดิม
  installType: "pole",       // "pole" | "platform"
  maxLoadPct: 80,            // เปอร์เซ็นต์โหลดสูงสุดที่ยอมรับได้
  newTxSize: "auto",         // (โหมด A) "auto" = ระบบแนะนำ | หรือขนาด kVA ที่เลือกเอง
  existingSize: 30,          // (โหมด B) ขนาดหม้อแปลงตัวเดิม (kVA)
  circuits: {                // ข้อมูลวงจรทั้ง 4 (วงจรที่ปิดอยู่จะไม่ถูกนำมาคำนวณ)
    // โหลดเดิม (โหมด B, โหลดที่หม้อแปลงจ่ายอยู่ก่อนขยายเขต):
    //   existingMode = "kva"   → กรอกค่า kVA รวมเดิมตรงๆ (existingKva)
    //                  "meter" → นับมิเตอร์เดิมตามขนาด (existingMeters)
    // โหลดเพิ่ม (ขยายเขต) = มิเตอร์ใหม่ ใช้ meters เสมอ (ไม่เปลี่ยน)
    1: { cable: "50", existingMode: "kva", existingKva: 0, existingMeters: [], meters: [] },
    2: { cable: "50", existingMode: "kva", existingKva: 0, existingMeters: [], meters: [] },
    3: { cable: "50", existingMode: "kva", existingKva: 0, existingMeters: [], meters: [] },
    4: { cable: "50", existingMode: "kva", existingKva: 0, existingMeters: [], meters: [] },
  },
};
let view = "input";          // สลับหน้าจอ "input" <-> "result"

/* =====================================================================
   Utility
   ===================================================================== */
const $ = (sel) => document.querySelector(sel);
const activeCircuits = () => CIRCUIT_SET[state.installType];
const meterById = (id) => METERS.find((m) => m.id === id);
const cabById = (id) => CABLES[id];

/* --- โหลดเดิมของวงจร (kVA) — เฉพาะโหมด B (โหลดที่จ่ายอยู่ก่อนขยาย) ---
   คำนวณตาม existingMode: "kva" = กรอกตรง, "meter" = นับมิเตอร์เดิม */
function circuitExistingKva(circuitNum) {
  const c = state.circuits[circuitNum];
  if (state.mode !== "B") return 0;
  if (c.existingMode === "meter") {
    return c.existingMeters.reduce((sum, m) => sum + meterById(m.id).kva * m.qty, 0);
  }
  return c.existingKva || 0;
}

/* --- โหลดเพิ่มของวงจร (kVA) — โหลดมิเตอร์ใหม่ (ขยายเขต) เสมอ --- */
function circuitNewKva(circuitNum) {
  const c = state.circuits[circuitNum];
  return c.meters.reduce((sum, m) => sum + meterById(m.id).kva * m.qty, 0);
}

/* โหลดรวมของวงจร (kVA) = โหลดเดิม + โหลดเพิ่ม */
function circuitKva(circuitNum) {
  return circuitExistingKva(circuitNum) + circuitNewKva(circuitNum);
}

/* ===== การจัดเฟสของโหลด (หลักการ balance เฟส) =====
   ระบบ 3 เฟส 416/240V (หม้อแปลง 50 kVA ขึ้นไป):
     - มิเตอร์ 1 เฟส  : กระจายเฟส ABCABC ตามลำดับมิเตอร์ในวงจร (ทีละเครื่อง)
     - มิเตอร์ 3 เฟส  : โหลดครบทั้ง 3 เฟส (ampA × qty ในทุกเฟส)
     - โหลดเดิม kVA ตรง : กระจายเท่า ๆ กัน 1/3 ต่อเฟส
   ระบบ 1 เฟส (หม้อแปลง 30 kVA 480/240V):
     - ไม่มีการแยกเฟส → กระแสรวมทั้งเฟสเดียว
   % โหลดสายของวงจรใช้เฟสที่มีโหลดสูงสุด (เส้น conductor รับกระแสเฟสของตัวเอง) */

/* ระบบนี้เป็น 3 เฟส หรือไม่? (กำหนดจากขนาดหม้อแปลงที่ใช้จริง/ที่จะใช้) */
function isThreePhaseSystem() {
  if (state.mode === "B") return state.existingSize >= 50;          // หม้อแปลงเดิม ≥50kVA
  if (state.installType === "platform") return true;                 // นั่งร้าน 3P เสมอ
  if (state.newTxSize !== "auto") return parseInt(state.newTxSize, 10) >= 50;
  const p = pickFrom(totalLoadKva(), state.maxLoadPct, SIZE_BY_INSTALL.pole);
  return p.tx ? p.tx.phase === "3P" : true;
}

/* กระแสรวมวิธีเดิม (ทุกมิเตอร์ + kVA ตรง ลงเฟสเดียว) — ใช้ในระบบ 1 เฟส */
function circuitCurrentLegacy(circuitNum) {
  const c = state.circuits[circuitNum];
  let i = 0;
  if (state.mode === "B") {
    if (c.existingMode === "meter") {
      i += c.existingMeters.reduce((sum, m) => sum + meterById(m.id).ampA * m.qty, 0);
    } else if (c.existingKva) {
      i += (c.existingKva * 1000) / LV_VOLT;
    }
  }
  i += c.meters.reduce((sum, m) => sum + meterById(m.id).ampA * m.qty, 0);
  return i;
}

/* กระแสแยกเฟส A/B/C ของวงจร {A, B, C} — จัดเฟส ABCABC ให้มิเตอร์ 1 เฟส */
function phaseAmpsOf(circuitNum) {
  const c = state.circuits[circuitNum];
  const p = { A: 0, B: 0, C: 0 };
  if (!isThreePhaseSystem()) {
    p.A = circuitCurrentLegacy(circuitNum);   // 1 เฟส: รวมทั้งหมด
    return p;
  }
  const seq = ["A", "B", "C"];
  let idx = 0;

  /* มิเตอร์ 1 เฟส → เรียงเฟส ABCA... ต่อเนื่อง (เดิมก่อน แล้วมิเตอร์ใหม่) */
  const addSingle = (m) => {
    const meta = meterById(m.id);
    if (meta.phase !== "1P") return;
    for (let k = 0; k < m.qty; k++) {
      p[seq[idx % 3]] += meta.ampA;           // qty>1 → เฟสละเครื่อง
      idx++;
    }
  };
  if (state.mode === "B" && c.existingMode === "meter") c.existingMeters.forEach(addSingle);
  c.meters.forEach(addSingle);

  /* มิเตอร์ 3 เฟส → ลงครบทั้ง 3 เฟส */
  const addThree = (m) => {
    const meta = meterById(m.id);
    if (meta.phase !== "3P") return;
    const amp = meta.ampA * m.qty;
    p.A += amp; p.B += amp; p.C += amp;
  };
  if (state.mode === "B" && c.existingMode === "meter") c.existingMeters.forEach(addThree);
  c.meters.forEach(addThree);

  /* โหลดเดิม kVA ตรง → กระจายเท่า ๆ กันทั้ง 3 เฟส */
  if (state.mode === "B" && c.existingMode === "kva" && c.existingKva) {
    const per = ((c.existingKva * 1000) / LV_VOLT) / 3;
    p.A += per; p.B += per; p.C += per;
  }
  return p;
}

/* กระแสพิจารณาของวงจร = เฟสที่รับโหลดสูงสุด (เทียบกับ ampacity สาย) */
function circuitCurrent(circuitNum) {
  const p = phaseAmpsOf(circuitNum);
  return Math.max(p.A, p.B, p.C);
}

/* ข้อความรายละเอียดเฟส เช่น "A:45 B:15 C:30" (ว่างถ้าระบบ 1 เฟส) */
function phaseDetailStr(circuitNum) {
  if (!isThreePhaseSystem()) return "";
  const p = phaseAmpsOf(circuitNum);
  return "A:" + fmt(p.A) + " B:" + fmt(p.B) + " C:" + fmt(p.C);
}

/* รายละเอียดโหลด "เพิ่ม" (มิเตอร์ใหม่) ในวงจร — สำหรับตารางผลลัพธ์ */
function meterDetailStr(circuitNum) {
  const list = state.circuits[circuitNum].meters
    .map((m) => meterById(m.id).short + " × " + m.qty)
    .join(", ");
  return list || "—";
}

/* รายละเอียดโหลด "เดิม" ของวงจร — สำหรับตารางผลลัพธ์ */
function existingDetailStr(circuitNum) {
  const c = state.circuits[circuitNum];
  if (state.mode !== "B") return "—";
  if (c.existingMode === "meter") {
    const list = c.existingMeters
      .map((m) => meterById(m.id).short + " × " + m.qty)
      .join(", ");
    return list || "—";
  }
  return "โหลด kVA ตรง (" + fmt(c.existingKva || 0) + " kVA)";
}

/* โหลดเดิมรวมทุกวงจร (kVA) — เฉพาะโหมด B */
function totalExistingKva() {
  if (state.mode !== "B") return 0;
  return activeCircuits().reduce((s, n) => s + circuitExistingKva(n), 0);
}

/* โหลดเพิ่มรวมทุกวงจร (kVA) — มิเตอร์ใหม่ (ขยายเขต) */
function totalNewKva() {
  return activeCircuits().reduce((s, n) => s + circuitNewKva(n), 0);
}

/* จำนวนมิเตอร์ที่ "เพิ่ม" ทั้งหมด (มิเตอร์ใหม่ ขยายเขต) */
function totalNewMeters() {
  return activeCircuits().reduce((sum, n) =>
    sum + state.circuits[n].meters.reduce((s, m) => s + m.qty, 0), 0);
}

/* โหลดรวมทั้งหมดที่ต้องใช้เทียบกับหม้อแปลง */
function totalLoadKva() {
  return totalExistingKva() + totalNewKva();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

const fmt = (v, d = 1) => (typeof v === "number" ? v.toFixed(d) : v);

/* อัปเดตหัวการ์ดวงจร (เลขกระแส + แถบ + % + โหลด kVA) เมื่อข้อมูลในวงจรเปลี่ยน */
function refreshCircuitUI(n) {
  const cur = document.getElementById("cur-" + n);
  const bar = document.getElementById("bar-" + n);
  const pctEl = document.getElementById("pct-" + n);
  const kvaEl = document.getElementById("kva-" + n);
  if (!cur || !bar || !pctEl) return;
  const current = circuitCurrent(n);
  const ampacity = cabById(state.circuits[n].cable).ampacity;
  const pct = ampacity > 0 ? (current / ampacity) * 100 : 0;
  cur.textContent = fmt(current, 0);
  cur.classList.toggle("over", current > ampacity);
  bar.style.width = Math.min(pct, 100) + "%";
  bar.className = "cablebar-fill " + (pct > 100 ? "bar-over" : pct >= 80 ? "bar-warn" : "bar-ok");
  pctEl.textContent = fmt(pct, 0);
  pctEl.classList.toggle("over", pct > 100);
  /* บรรทัดโหลด kVA รายวงจร (เรียลไทม์) — Mode B แยก เดิม/เพิ่ม/รวม */
  if (kvaEl) {
    if (state.mode === "B") {
      kvaEl.innerHTML = `โหลดวงจร: เดิม <b>${fmt(circuitExistingKva(n))}</b> + เพิ่ม <b>${fmt(circuitNewKva(n))}</b> = <b>${fmt(circuitKva(n))}</b> kVA
        <span class="phase-detail" id="ph-${n}">${phaseDetailStr(n)}</span>`;
    } else {
      kvaEl.innerHTML = `โหลดวงจร: <b>${fmt(circuitNewKva(n))}</b> kVA
        <span class="phase-detail" id="ph-${n}">${phaseDetailStr(n)}</span>`;
    }
  }
}

/* =====================================================================
   ระบบคำนวณหลัก
   ===================================================================== */

/* เลือกขนาดหม้อแปลงที่เล็กที่สุดที่โหลดไม่เกินเกณฑ์ จากรายการที่ให้มา
   คืน { tx, loadPct, ok } — ok=false แปลว่าไม่มีขนาดใดในรายการพอ */
function pickFrom(totalKva, maxPct, sizeList) {
  for (const kva of sizeList) {
    const loadPct = (totalKva / kva) * 100;
    if (loadPct <= maxPct + 1e-9) {
      return { tx: txOf(kva), loadPct, ok: true };
    }
  }
  const kva = sizeList[sizeList.length - 1];
  return { tx: txOf(kva), loadPct: (totalKva / kva) * 100, ok: false };
}

/* หาขนาดที่แนะนำเมื่อต้องอัปเกรด: เลือกขนาดเล็กสุดที่ totalKva ≤ size × max%
   จากรายการที่ให้มา คืน tx หรือ null                           */
function suggestFrom(totalKva, maxPct, sizeList) {
  for (const kva of sizeList) {
    if (totalKva <= kva * (maxPct / 100) + 1e-9) return txOf(kva);
  }
  return null;
}

/* คำนวณผลลัพธ์ทั้งหมดจาก state ปัจจุบัน
   คืน object ที่ใช้เรนเดอร์หน้าจอผลลัพธ์ */
function runCalculation() {
  const maxPct = state.maxLoadPct;
  const sizes = SIZE_BY_INSTALL[state.installType];
  const totalKva = totalLoadKva();
  const existingKva = totalExistingKva();
  const newKva = totalNewKva();
  const circuitRows = [];
  let anyOver = false;

  /* --- สรุปกระแสไฟฟ้ารายวงจร (เฉพาะวงจรที่ใช้งาน) --- */
  activeCircuits().forEach((n) => {
    const c = state.circuits[n];
    const kvaEx = circuitExistingKva(n);  // โหลดเดิม (kVA)
    const kvaNew = circuitNewKva(n);      // โหลดเพิ่ม/มิเตอร์ใหม่ (kVA)
    const kva = kvaEx + kvaNew;           // โหลดรวม (kVA)
    const current = circuitCurrent(n);
    const cable = cabById(c.cable);
    const over = current > cable.ampacity;
    if (over) anyOver = true;
    circuitRows.push({
      num: n,
      side: circuitSide(n),
      kva, kvaEx, kvaNew, current,
      meters: meterDetailStr(n),          // รายละเอียดมิเตอร์ใหม่ (ขยายเขต)
      existing: existingDetailStr(n),     // รายละเอียดโหลดเดิม (kVA ตรง หรือ นับมิเตอร์เดิม)
      phase: phaseDetailStr(n),           // กระแสแยกรายเฟส "A:.. B:.. C:.." (ว่างถ้า 1P)
      cable: cable.name, ampacity: cable.ampacity, over,
    });
  });

  /* --- บทสรุปหม้อแปลง --- */
  let txSummary;
  let conclusion = { tone: "ok", text: "", sub: "" };
  let recommendedTx = null;   // ขนาดหม้อแปลงที่ควรใช้ (ใช้ตอนโหลดเกินต้องการอัปเกรด)

  if (state.mode === "A") {
    /* โหมด A: ใช้ขนาดที่ผู้ใช้เลือก หรือระบบแนะนำอัตโนมัติ */
    let pick;
    if (state.newTxSize === "auto") {
      pick = pickFrom(totalKva, maxPct, sizes); // เลือกเล็กสุดที่พอดี
      txSummary = {
        title: "ขนาดหม้อแปลงที่ระบบแนะนำ",
        main: txLabel(pick.tx),
        loadKva: totalKva,
        loadPct: pick.loadPct,
        phase: pick.tx.phase,
      };
    } else {
      const selKva = parseInt(state.newTxSize, 10);
      pick = {
        tx: txOf(selKva),
        loadPct: (totalKva / selKva) * 100,
        ok: (totalKva / selKva) * 100 <= maxPct + 1e-9,
      };
      txSummary = {
        title: "ขนาดหม้อแปลงที่เลือก",
        main: txLabel(pick.tx),
        loadKva: totalKva,
        loadPct: pick.loadPct,
        phase: pick.tx.phase,
      };
    }

    if (!pick.ok) {
      if (state.installType === "pole") {
        /* โหลดเกินขนาดที่เลือก/เกณฑ์ของเสาเดียว → แนะนำขนาดใหญ่ขึ้นในรายการ หรือเปลี่ยนเป็นนั่งร้าน */
        const alt = suggestFrom(totalKva, maxPct, sizes);
        if (alt && alt.kva !== (pick.tx ? pick.tx.kva : null)) {
          recommendedTx = alt;
          conclusion = {
            tone: "over",
            text: "โหลดรวม " + fmt(totalKva) + " kVA (" + fmt(pick.loadPct) + "%) เกินเกณฑ์ " + maxPct + "% ของขนาดที่เลือก",
            sub: "ขนาดที่เลือกไม่เพียงพอต่อโหลดรวม",
          };
        } else {
          const plat = suggestFrom(totalKva, maxPct, SIZE_BY_INSTALL.platform);
          if (plat) recommendedTx = plat;
          conclusion = {
            tone: "over",
            text: "โหลดรวม " + fmt(totalKva) + " kVA เกินพิกัดหม้อแปลงแขวนเสาเดียวทุกรุ่น (สูงสุด 250 kVA) ที่โหลด " + maxPct + "%",
            sub: plat
              ? "ต้องเปลี่ยนเป็นหม้อแปลงนั่งร้าน (3 เฟส 416/240V)"
              : "ต้องตัดแบ่งโหลดหรือแยกสถานีหม้อแปลงหลายชุด",
          };
        }
      } else {
        const alt = suggestFrom(totalKva, maxPct, sizes);
        if (alt && alt.kva !== (pick.tx ? pick.tx.kva : null)) {
          recommendedTx = alt;
          conclusion = {
            tone: "over",
            text: "โหลดรวม " + fmt(totalKva) + " kVA (" + fmt(pick.loadPct) + "%) เกินเกณฑ์ " + maxPct + "% ของขนาดที่เลือก",
            sub: "ขนาดที่เลือกไม่เพียงพอต่อโหลดรวม",
          };
        } else {
          conclusion = {
            tone: "over",
            text: "โหลดรวม " + fmt(totalKva) + " kVA เกินพิกัดหม้อแปลงนั่งร้านขนาดใหญ่สุด (500 kVA)",
            sub: "ต้องตัดแบ่งโหลดเป็นวงจร/หม้อแปลงหลายชุด หรือลดจำนวนมิเตอร์",
          };
        }
      }
    } else {
      conclusion = {
        tone: "ok",
        text: "ใช้หม้อแปลงขนาด " + txLabel(pick.tx) + " ได้ — โหลดรวม " + fmt(totalKva) +
              " kVA คิดเป็น " + fmt(pick.loadPct) + "% ไม่เกิน " + maxPct + "%",
        sub: pick.tx.phase + " แรงดัน " + pick.tx.volt + (anyOver ? " (แต่มีวงจรแรงต่ำเกินพิกัดสาย — ดูตารางด้านล่าง)" : ""),
      };
    }
  } else {
    /* โหมด B: หม้อแปลงเดิม — โหลดเดิมกรอกเป็น kVA ต่อวงจร ระบบรวมให้อัตโนมัติ */
    const tx = txOf(state.existingSize);
    const loadPct = (totalKva / state.existingSize) * 100;

    txSummary = {
      title: "สถานะหม้อแปลงเดิม (" + txLabel(tx) + ")",
      main: txLabel(tx),
      loadKva: totalKva,
      loadPct,
      phase: tx.phase,
      detail: "โหลดเดิม " + fmt(existingKva) + " kVA + ใหม่ " + fmt(newKva) + " kVA = " + fmt(totalKva) + " kVA",
    };

    if (loadPct <= maxPct + 1e-9) {
      conclusion = {
        tone: "ok",
        text: "สามารถใช้หม้อแปลงเดิมขนาด " + state.existingSize + " kVA ต่อไปได้",
        sub: "โหลดรวม " + fmt(totalKva) + " kVA = " + fmt(loadPct) + " % ไม่เกินเกณฑ์ " + maxPct + "%" +
             (anyOver ? " (แต่มีวงจรแรงต่ำเกินพิกัดสาย — ดูตารางด้านล่าง)" : ""),
      };
    } else {
      /* โหลดเกิน → แนะนำอัปเกรด (ดูทั้งรายการหม้อแปลงที่มี) */
      const allSizes = [].concat(SIZE_BY_INSTALL.platform, SIZE_BY_INSTALL.pole).filter((v, i, a) => a.indexOf(v) === i).sort((x, y) => x - y);
      const up = suggestFrom(totalKva, maxPct, allSizes);
      if (up) {
        recommendedTx = up;
        conclusion = {
          tone: "over",
          text: "โหลดรวม " + fmt(totalKva) + " kVA (" + fmt(loadPct) + "%) เกินเกณฑ์ " + maxPct + "% ของหม้อแปลงเดิม — ต้องอัปเกรดหม้อแปลง",
          sub: "หม้อแปลงเดิมขนาด " + state.existingSize + " kVA ไม่เพียงพอต่อโหลดรวมหลังขยายเขต",
        };
      } else {
        conclusion = {
          tone: "over",
          text: "โหลดรวม " + fmt(totalKva) + " kVA เกินพิกัดหม้อแปลงขนาดใหญ่สุด (500 kVA) ทั้งหมด",
          sub: "ต้องแยกเป็นสถานีหม้อแปลงหลายชุด หรือลดจำนวนมิเตอร์",
        };
      }
    }
  }

  if (anyOver) {
    /* มีวงจรอย่างน้อย 1 วงจรที่กระแสเกินพิกัดสายไฟ */
    const overCircuits = circuitRows.filter((r) => r.over).map((r) => "วงจรที่ " + r.num).join(", ");
    conclusion = {
      tone: "warn",
      text: "⚠ กระแสไฟฟ้าเกินพิกัดสายไฟใน " + overCircuits + " — ต้องเปลี่ยนขนาดสายเป็น THW-A 95 ตร.มม. หรือกระจายมิเตอร์ไปวงจรอื่น",
      sub: "สายไฟที่เกินพิกัดแสดงเป็นสีแดงตัวหนาในตารางด้านล่าง",
    };
  }

  return { txSummary, circuitRows, conclusion, recommendedTx };
}

/* =====================================================================
   Render UI
   ===================================================================== */

/* เรนเดอร์ dropdown มิเตอร์ในแต่ละวงจร (เลือกชนิดมิเตอร์แล้วกดเพิ่ม) */
function renderMeterSelectOptions(select) {
  select.innerHTML = METERS.map((m) =>
    `<option value="${m.id}">${m.label} — ${fmt(m.kva)} kVA</option>`).join("");
}

/* เรนเดอร์หน้าจอ "กรอกข้อมูล" ทั้งหน้าจอใหม่ (จาก state) */
function renderInput() {
  /* --- โหมด + เปอร์เซ็นต์โหลดสูงสุด --- */
  $("#mode-a-btn").classList.toggle("active", state.mode === "A");
  $("#mode-b-btn").classList.toggle("active", state.mode === "B");
  $("#max-load-pct").value = state.maxLoadPct;

  /* --- ส่วนของหม้อแปลง (เปลี่ยนตามโหมด) --- */
  $("#mode-a-box").classList.toggle("hidden", state.mode !== "A");
  $("#mode-b-box").classList.toggle("hidden", state.mode !== "B");

  $("#install-pole-btn").classList.toggle("active", state.installType === "pole");
  $("#install-platform-btn").classList.toggle("active", state.installType === "platform");

  /* dropdown ขนาดหม้อแปลงใหม่ (โหมด A) — "อัตโนมัติ" + ทุกขนาดที่เลือกได้ตามประเภทการติดตั้ง */
  const newSel = $("#new-tx-size");
  const sizes = SIZE_BY_INSTALL[state.installType];
  newSel.innerHTML =
    `<option value="auto">อัตโนมัติ (ระบบแนะนำ)</option>` +
    sizes.map((k) => `<option value="${k}">${txLabel(txOf(k))}</option>`).join("");
  newSel.value = String(state.newTxSize);
  if (!newSel.value) newSel.value = "auto";

  /* dropdown ขนาดหม้อแปลงเดิม (โหมด B) ขึ้นกับประเภทการติดตั้ง */
  const sizeSel = $("#existing-size");
  sizeSel.innerHTML = sizes.map((k) => `<option value="${k}">${txLabel(txOf(k))}</option>`).join("");
  sizeSel.value = String(state.existingSize);
  if (!sizeSel.value) sizeSel.value = String(sizes[0]);

  /* --- เรนเดอร์การ์ดวงจร — จัดแยกเป็นคอลัมน์ "ฝั่งซ้าย" / "ฝั่งขวา" ---
     เสาเดียว  : วงจร 1 (ซ้าย) | วงจร 3 (ขวา)
     นั่งร้าน   : วงจร 1,3 (ซ้าย) | วงจร 2,4 (ขวา)                */
  const container = $("#circuits-container");
  container.innerHTML = `
    <div class="side-col" id="col-left">
      <div class="side-col-head"><span class="arrow">&#8592;</span> ฝั่งซ้าย</div>
      <div id="col-left-body"></div>
    </div>
    <div class="side-col" id="col-right">
      <div class="side-col-head">ฝั่งขวา <span class="arrow">&#8594;</span></div>
      <div id="col-right-body"></div>
    </div>`;
  const leftBody = $("#col-left-body");
  const rightBody = $("#col-right-body");

  activeCircuits().forEach((n) => {
    const c = state.circuits[n];
    const current = circuitCurrent(n);
    const ampacity = cabById(c.cable).ampacity;
    const pct = ampacity > 0 ? (current / ampacity) * 100 : 0;     // % โหลดสายวงจรนี้
    const barCls = pct > 100 ? "bar-over" : pct >= 80 ? "bar-warn" : "bar-ok";

    const card = document.createElement("div");
    card.className = "circuit-card";

    /* หัวการ์ด : ชื่อวงจร + กระแสสด + แถบ % โหลดสายเทียบพิกัด */
    const head = document.createElement("div");
    head.className = "circuit-head";
    head.innerHTML = `
      <div class="circuit-title">
        <span class="circuit-side">ฝั่ง${circuitSide(n)}</span>
        วงจรที่ ${n}
      </div>
      <div class="circuit-live">
        กระแสรวม <span class="cur ${current > ampacity ? "over" : ""}" id="cur-${n}">${fmt(current, 0)}</span> A
        <span style="opacity:.7">/ พิกัด ${ampacity} A</span>
        <div class="cablebar"><div class="cablebar-fill ${barCls}" id="bar-${n}" style="width:${Math.min(pct, 100)}%"></div></div>
        โหลดสาย <span class="cable-pct ${pct > 100 ? "over" : ""}" id="pct-${n}">${fmt(pct, 0)}</span> %
        <div class="circuit-kva" id="kva-${n}"></div>
      </div>`;
    card.appendChild(head);

    /* เลือกขนาดสายไฟ */
    const cableRow = document.createElement("div");
    cableRow.className = "form-row";
    cableRow.style.marginTop = "6px";
    cableRow.innerHTML = `
      <div>
        <label class="field-label">สายเมนแรงต่ำ (อลูมิเนียม THW-A)</label>
        <select data-cable="${n}">
          <option value="50">THW-A 50 ตร.มม. (พิกัด 130 A)</option>
          <option value="95">THW-A 95 ตร.มม. (พิกัด 209 A)</option>
        </select>
      </div>`;
    cableRow.querySelector("select").value = c.cable;
    card.appendChild(cableRow);

    /* ===== โหลดเดิม (เฉพาะโหมด B) — เลือกวิธีกรอก: kVA รวมตรง / นับมิเตอร์เดิม ===== */
    if (state.mode === "B") {
      const existingBox = document.createElement("div");
      existingBox.className = "existing-load-box";
      existingBox.innerHTML = `
        <div class="existing-load-head">โหลดเดิมของวงจร (ก่อนขยายเขต)</div>
        <div class="seg-row seg-row-sm">
          <button class="seg-btn ${c.existingMode === "kva" ? "active" : ""}" data-existingmode="kva" data-n="${n}">ใส่ kVA รวม</button>
          <button class="seg-btn ${c.existingMode === "meter" ? "active" : ""}" data-existingmode="meter" data-n="${n}">นับมิเตอร์เดิม</button>
        </div>`;

      /* ช่องกรอกตามวิธีที่เลือก */
      if (c.existingMode === "kva") {
        existingBox.innerHTML += `
        <div class="kva-direct-input">
          <label class="field-label">โหลดเดิมรวมของวงจร (kVA)</label>
          <input type="number" min="0" step="0.5" value="${c.existingKva || 0}" data-existing-kva="${n}">
        </div>`;
      } else {
        existingBox.innerHTML += `
        <div class="existing-meter-list" data-existing-list="${n}"></div>
        <div class="meter-add-bar" style="margin-top:6px">
          <select class="existing-new-meter" data-existing-select="${n}"></select>
          <input type="number" class="existing-qty" data-existing-qty="${n}" value="1" min="1" max="999">
          <button class="btn btn-primary btn-sm" data-existing-add-btn="${n}">+ เพิ่มมิเตอร์เดิม</button>
        </div>`;
      }
      card.appendChild(existingBox);

      /* เติม option + รายการมิเตอร์เดิม */
      if (c.existingMode === "meter") {
        const esSel = existingBox.querySelector("[data-existing-select]");
        renderMeterSelectOptions(esSel);
        renderExistingMeterList(n);
      }
    }

    /* ===== โหลดเพิ่ม (ขยายเขต) — นับมิเตอร์ใหม่เสมอ ===== */
    const addLabel = document.createElement("div");
    addLabel.className = "add-load-head";
    addLabel.textContent = state.mode === "B" ? "โหลดเพิ่ม (ขยายเขต)" : "โหลด (มิเตอร์)";
    card.appendChild(addLabel);

    const list = document.createElement("div");
    list.className = "meter-list";
    list.dataset.circuit = n;
    card.appendChild(list);

    const addBar = document.createElement("div");
    addBar.className = "meter-add-bar";
    addBar.innerHTML = `
      <select class="new-meter" data-add-select="${n}"></select>
      <input type="number" class="new-qty" data-add-qty="${n}" value="1" min="1" max="999">
      <button class="btn btn-primary btn-sm" data-add-btn="${n}">+ เพิ่มมิเตอร์</button>`;
    card.appendChild(addBar);
    renderMeterSelectOptions(addBar.querySelector("select"));

    /* ใส่การ์ดลงคอลัมน์ตามฝั่ง: เสาเดียว ว.1=ซ้าย ว.3=ขวา | นั่งร้าน ว.1,3=ซ้าย ว.2,4=ขวา */
    const target = circuitSide(n) === "ซ้าย" ? leftBody : rightBody;
    target.appendChild(card);

    renderMeterList(n);
  });

  /* ถ้าฝั่งใดไม่มีวงจรถูกวางอยู่ ซ่อนคอลัมน์นั้น
   (คิดจาก "ฝั่งของวงจร" ไม่ใช่เลขวงจร — เสาเดียว ว.3 = ขวา) */
  const hasLeftSide = activeCircuits().some((n) => circuitSide(n) === "ซ้าย");
  const hasRightSide = activeCircuits().some((n) => circuitSide(n) === "ขวา");
  if (!hasLeftSide) $("#col-left").style.display = "none";
  if (!hasRightSide) $("#col-right").style.display = "none";

  $("#active-circuit-badge").textContent = activeCircuits().length + " วงจร";
  updateLiveSummary();
}

/* เรนเดอร์รายการมิเตอร์ "เพิ่ม" (ขยายเขต) ภายในวงจร */
function renderMeterList(circuitNum) {
  const list = document.querySelector(`.meter-list[data-circuit="${circuitNum}"]`);
  if (!list) return;
  const c = state.circuits[circuitNum];
  list.innerHTML = c.meters.length === 0
    ? `<div class="empty-note" style="color:var(--text-muted);font-size:12px;padding:2px 4px">ยังไม่มีมิเตอร์ใหม่ — เพิ่มจากด้านล่าง</div>`
    : c.meters.map((m, idx) => {
        const meta = meterById(m.id);
        const sub = fmt(meta.kva * m.qty);
        return `
        <div class="meter-row">
          <div>
            <div class="meter-name">${meta.label}</div>
            <div class="meter-spec">${fmt(meta.kva)} kVA/เครื่อง × ${m.qty} เครื่อง</div>
          </div>
          <div class="meter-subtotal">${sub} kVA</div>
          <button class="meter-remove" data-remove-circuit="${circuitNum}" data-remove-idx="${idx}" title="ลบ">&#10005;</button>
        </div>`;
      }).join("");
  updateLiveSummary();
  refreshCircuitUI(circuitNum);
}

/* เรนเดอร์รายการมิเตอร์ "เดิม" (ก่อนขยายเขต) ภายในวงจร */
function renderExistingMeterList(circuitNum) {
  const list = document.querySelector(`[data-existing-list="${circuitNum}"]`);
  if (!list) return;
  const c = state.circuits[circuitNum];
  list.innerHTML = c.existingMeters.length === 0
    ? `<div class="empty-note" style="color:var(--text-muted);font-size:12px;padding:2px 4px">ยังไม่มีมิเตอร์เดิม — เพิ่มจากด้านล่าง</div>`
    : c.existingMeters.map((m, idx) => {
        const meta = meterById(m.id);
        const sub = fmt(meta.kva * m.qty);
        return `
        <div class="meter-row">
          <div>
            <div class="meter-name">${meta.label}</div>
            <div class="meter-spec">${fmt(meta.kva)} kVA/เครื่อง × ${m.qty} เครื่อง</div>
          </div>
          <div class="meter-subtotal">${sub} kVA</div>
          <button class="meter-remove" data-existing-remove-circuit="${circuitNum}" data-existing-remove-idx="${idx}" title="ลบ">&#10005;</button>
        </div>`;
      }).join("");
  updateLiveSummary();
  refreshCircuitUI(circuitNum);
}

/* สรุปโหลดสดด้านล่างหน้าจอกรอกข้อมูล */
function updateLiveSummary() {
  const newKva = totalNewKva();
  const meters = totalNewMeters();
  const maxPct = state.maxLoadPct;
  const sizes = SIZE_BY_INSTALL[state.installType];

  $("#live-total-kva").textContent = fmt(newKva) + " kVA";
  $("#live-meter-count").textContent = meters + " เครื่อง";

  if (state.mode === "A") {
    $("#live-tx-label").textContent = "หม้อแปลง " + (state.newTxSize === "auto" ? "(อัตโนมัติ ≤ " + maxPct + "%)" : "(ที่เลือก)") ;
    const pick = pickFrom(totalNewKva(), maxPct, sizes);
    const el = $("#live-total-load");
    el.textContent = state.newTxSize === "auto"
      ? (pick.ok ? txLabel(pick.tx) : "เกินพิกัดรูปแบบนี้")
      : txLabel(txOf(parseInt(state.newTxSize, 10)));
    el.classList.toggle("warn", !pick.ok);
  } else {
    $("#live-tx-label").textContent = "โหลดรวม (เดิม " + fmt(totalExistingKva()) + " + ใหม่ " + fmt(newKva) + ")";
    const total = totalLoadKva();
    const pct = state.existingSize > 0 ? (total / state.existingSize) * 100 : 0;
    const el = $("#live-total-load");
    el.textContent = fmt(total) + " kVA (" + fmt(pct) + "%)";
    el.classList.toggle("warn", pct > maxPct);
  }
}

/* เรนเดอร์หน้าจอผลลัพธ์ */
function renderResult() {
  const r = runCalculation();

  /* --- บทสรุปหม้อแปลง --- */
  const metrics = $("#result-metrics");
  const loadOk = r.txSummary.loadPct <= state.maxLoadPct + 1e-9;
  const detailLine = r.txSummary.detail
    ? `<div class="metric-label">${r.txSummary.detail}</div>`
    : `<div class="metric-label">${r.txSummary.title}</div>`;
  metrics.innerHTML = `
    <div class="metric-card">
      <div class="metric-value ${loadOk ? "ok" : "over"}">${r.txSummary.main}</div>
      ${detailLine}
    </div>
    <div class="metric-card">
      <div class="metric-value">${fmt(r.txSummary.loadKva)} kVA</div>
      <div class="metric-label">โหลดรวมทั้งหมด</div>
    </div>
    <div class="metric-card">
      <div class="metric-value ${loadOk ? "ok" : "over"}">${fmt(r.txSummary.loadPct)} %</div>
      <div class="metric-label">โหลดหม้อแปลง (เกณฑ์ ≤ ${state.maxLoadPct}%)</div>
    </div>`;

  const concl = $("#result-conclusion");

  /* แถบ "หม้อแปลงที่ควรใช้" — เด่นชัดเมื่อโหลดเกินจนต้องอัปเกรด/เปลี่ยนขนาด */
  let recommendHtml = "";
  if (r.recommendedTx) {
    const recPct = (r.txSummary.loadKva / r.recommendedTx.kva) * 100;
    recommendHtml = `
      <div class="recommend-box">
        <div class="recommend-title">&#9213; หม้อแปลงที่ควรใช้</div>
        <div class="recommend-main">${txLabel(r.recommendedTx)}</div>
        <div class="recommend-sub">โหลดรวม ${fmt(r.txSummary.loadKva)} kVA จะอยู่ที่ ${fmt(recPct)}% ของพิกัด (เกณฑ์ ≤ ${state.maxLoadPct}%)</div>
      </div>`;
  }
  concl.innerHTML = recommendHtml +
    `<div class="conclusion-box ${r.conclusion.tone}">${r.conclusion.text}<span class="sub">${r.conclusion.sub}</span></div>`;

  /* --- ตารางสรุปกระแสไฟฟ้ารายวงจร --- */
  /* โหมด A ไม่มีโหลดเดิม → ซ่อนคอลัมน์ "โหลดเดิม" */
  const isModeB = state.mode === "B";
  $("#th-kva-ex").style.display = isModeB ? "" : "none";
  if (!isModeB) {
    $("#th-kva-new").textContent = "โหลด (kVA)";
    $("#th-meter").textContent = "มิเตอร์ในวงจร (ขนาด × จำนวน)";
  } else {
    $("#th-kva-new").textContent = "โหลดเพิ่ม (kVA)";
    $("#th-meter").textContent = "มิเตอร์ใหม่ (ขยายเขต) — ขนาด × จำนวน";
  }

  const tbody = $("#result-circuit-rows");
  tbody.innerHTML = r.circuitRows.map((row) => {
    const overCls = row.over ? "over-cell" : "";
    /* รายละเอียดโหลดเดิม (โหมด B) + มิเตอร์ใหม่ */
    const meterCell = row.meters || "—";
    const kvaExCell = isModeB
      ? `<td>${row.existing || "—"}<div class="cell-sub">รวม ${fmt(row.kvaEx)} kVA</div></td><td>${fmt(row.kvaNew)}</td>`
      : "";
    return `
    <tr>
      <td><b>วงจรที่ ${row.num}</b> <span style="color:var(--text-muted)">(ฝั่ง${row.side})</span></td>
      <td class="meter-cell">${meterCell}</td>
      ${kvaExCell}
      <td>${fmt(row.kva)}</td>
      <td class="${overCls}">${fmt(row.current)}${row.phase ? `<div class="cell-sub">${row.phase}</div>` : ""}${row.over ? '<span class="alert-tag">เกินพิกัด!</span>' : ""}</td>
      <td class="${overCls}">${row.cable}</td>
      <td>${row.ampacity} A</td>
      <td>${row.over
        ? `<span class="status-chip over">กระแสเกินพิกัด ${fmt(row.current)} A > ${row.ampacity} A</span>`
        : `<span class="status-chip ok">โอเค (${fmt(row.current)} A ≤ ${row.ampacity} A)</span>`}
      </td>
    </tr>`;
  }).join("");

  switchView("result");
}

/* สลับหน้าจอระหว่าง "input" และ "result" */
function switchView(v) {
  view = v;
  $("#view-input").classList.toggle("hidden", v !== "input");
  $("#view-result").classList.toggle("hidden", v !== "result");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* =====================================================================
   Event listeners (Event Delegation)
   ===================================================================== */

/* --- โหมดการคำนวณ A / B --- */
$("#mode-a-btn").addEventListener("click", () => {
  state.mode = "A";
  renderInput();
});
$("#mode-b-btn").addEventListener("click", () => {
  state.mode = "B";
  renderInput();
});

/* --- ประเภทการติดตั้ง --- */
$("#install-pole-btn").addEventListener("click", () => {
  state.installType = "pole";
  renderInput();
});
$("#install-platform-btn").addEventListener("click", () => {
  state.installType = "platform";
  renderInput();
});

/* --- เปอร์เซ็นต์โหลดสูงสุด --- */
$("#max-load-pct").addEventListener("input", (e) => {
  const v = parseFloat(e.target.value);
  if (v >= 1 && v <= 100) { state.maxLoadPct = v; updateLiveSummary(); }
});

/* --- โหมด A: เลือกขนาดหม้อแปลงใหม่ --- */
$("#new-tx-size").addEventListener("change", (e) => {
  state.newTxSize = e.target.value;   // "auto" หรือ ตัวเลข
  updateLiveSummary();
});

/* --- โหมด B: เลือกขนาดหม้อแปลงเดิม --- */
$("#existing-size").addEventListener("change", (e) => {
  state.existingSize = parseInt(e.target.value, 10);
  updateLiveSummary();
});

/* --- Delegation: เปลี่ยนสาย / เพิ่มมิเตอร์ / ลบมิเตอร์ / กดคำนวณ --- */
document.addEventListener("click", (e) => {
  /* ลบมิเตอร์ "เพิ่ม" (ขยายเขต) ออกจากวงจร */
  const rm = e.target.closest("[data-remove-circuit]");
  if (rm) {
    const n = parseInt(rm.dataset.removeCircuit, 10);
    const idx = parseInt(rm.dataset.removeIdx, 10);
    state.circuits[n].meters.splice(idx, 1);
    renderMeterList(n);
    return;
  }

  /* ลบมิเตอร์ "เดิม" ออกจากวงจร */
  const rmEx = e.target.closest("[data-existing-remove-circuit]");
  if (rmEx) {
    const n = parseInt(rmEx.dataset.existingRemoveCircuit, 10);
    const idx = parseInt(rmEx.dataset.existingRemoveIdx, 10);
    state.circuits[n].existingMeters.splice(idx, 1);
    renderExistingMeterList(n);
    return;
  }

  /* เพิ่มมิเตอร์ "เพิ่ม" (ขยายเขต) เข้าสู่วงจร */
  const addBtn = e.target.closest("[data-add-btn]");
  if (addBtn) {
    const n = parseInt(addBtn.dataset.addBtn, 10);
    const select = document.querySelector(`[data-add-select="${n}"]`);
    const qtyInput = document.querySelector(`[data-add-qty="${n}"]`);
    const id = select.value;
    const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    state.circuits[n].meters.push({ id, qty });
    renderMeterList(n);
    return;
  }

  /* เพิ่มมิเตอร์ "เดิม" (ก่อนขยายเขต) เข้าสู่วงจร */
  const addExBtn = e.target.closest("[data-existing-add-btn]");
  if (addExBtn) {
    const n = parseInt(addExBtn.dataset.existingAddBtn, 10);
    const select = document.querySelector(`[data-existing-select="${n}"]`);
    const qtyInput = document.querySelector(`[data-existing-qty="${n}"]`);
    const id = select.value;
    const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    state.circuits[n].existingMeters.push({ id, qty });
    renderExistingMeterList(n);
    return;
  }

  /* โหมด B: สลับวิธีกรอก "โหลดเดิม" (kVA รวมตรง / นับมิเตอร์เดิม) */
  const existingModeBtn = e.target.closest("[data-existingmode]");
  if (existingModeBtn) {
    const n = parseInt(existingModeBtn.dataset.n, 10);
    state.circuits[n].existingMode = existingModeBtn.dataset.existingmode;
    renderInput();   // เรนเดอร์การ์ดใหม่ให้แสดง/ซ่อนฟิลด์ตามโหมด
    return;
  }

  /* ปุ่มคำนวณ */
  if (e.target.closest("#btn-calculate")) {
    if (state.mode === "B" && totalLoadKva() <= 0) {
      toast("กรุณากรอกโหลดเดิม kVA หรือโหลดเพิ่มของแต่ละวงจร");
      return;
    }
    if (state.mode === "A" && totalNewKva() <= 0) {
      toast("กรุณาเพิ่มมิเตอร์อย่างน้อย 1 เครื่องในวงจร");
      return;
    }
    renderResult();
    return;
  }

  /* ปุ่มย้อนกลับ (บนและล่างของหน้าจอผลลัพธ์) */
  if (e.target.closest("#btn-back") || e.target.closest("#btn-back-bottom")) {
    renderInput();   // เรนเดอร์หน้าเดิมจาก state → ข้อมูลไม่หาย
    switchView("input");
    return;
  }
});

/* --- ปรับค่าจำนวนมิเตอร์ / เปลี่ยนสายไฟ / โหลดเดิม (live) --- */
document.addEventListener("input", (e) => {
  /* เปลี่ยนขนาดสายไฟในวงจร */
  const cableSel = e.target.closest("[data-cable]");
  if (cableSel) {
    const n = parseInt(cableSel.dataset.cable, 10);
    state.circuits[n].cable = cableSel.value;
    updateLiveSummary();
    refreshCircuitUI(n);
    return;
  }

  /* โหมด B: กรอกโหลดเดิม kVA ของวงจร (วิธี "ใส่ kVA รวม") */
  const exKva = e.target.closest("[data-existing-kva]");
  if (exKva) {
    const n = parseInt(exKva.dataset.existingKva, 10);
    const v = parseFloat(exKva.value);
    state.circuits[n].existingKva = (v > 0 && isFinite(v)) ? v : 0;
    updateLiveSummary();
    refreshCircuitUI(n);
    return;
  }
});

/* =====================================================================
   Init
   ===================================================================== */
renderInput();