/* =====================================================================
   app.js — คำนวนโหลดหม้อแปลงและวงจรแรงต่ำสำหรับโครงการบ้านจัดสรร
   สคริปต์ Vanilla JS ทำงานแบบ Offline ไม่พึ่ง CDN
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
const CIRCUIT_SIDE = {
  1: "ซ้าย", 2: "ขวา", 3: "ซ้าย", 4: "ขวา",
};

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
    1: { cable: "50", existingKva: 0, meters: [] },  // meters: [{id, qty}, ...]
    2: { cable: "50", existingKva: 0, meters: [] },
    3: { cable: "50", existingKva: 0, meters: [] },
    4: { cable: "50", existingKva: 0, meters: [] },
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

/* --- โหลดเดิมของวงจร (kVA) — เฉพาะโหมด B --- */
function circuitExistingKva(circuitNum) {
  const c = state.circuits[circuitNum];
  return (state.mode === "B" ? (c.existingKva || 0) : 0);
}

/* --- โหลดเพิ่มจากมิเตอร์ใหม่ของวงจร (kVA) --- */
function circuitNewKva(circuitNum) {
  const c = state.circuits[circuitNum];
  return c.meters.reduce((sum, m) => sum + meterById(m.id).kva * m.qty, 0);
}

/* โหลดรวมของวงจร (kVA) = โหลดเดิม + โหลดมิเตอร์ใหม่ */
function circuitKva(circuitNum) {
  return circuitExistingKva(circuitNum) + circuitNewKva(circuitNum);
}

/* กระแสรวมของวงจร (A) = กระแสจากโหลดเดิม + ผลรวมกระแสของมิเตอร์ใหม่ */
function circuitCurrent(circuitNum) {
  const c = state.circuits[circuitNum];
  let i = 0;
  if (state.mode === "B" && c.existingKva) i += (c.existingKva * 1000) / LV_VOLT;
  i += c.meters.reduce((sum, m) => sum + meterById(m.id).ampA * m.qty, 0);
  return i;
}

/* รายละเอียดมิเตอร์ในวงจร: "5(15)A × 2, 15(45)A × 1" */
function meterDetailStr(circuitNum) {
  return state.circuits[circuitNum].meters
    .map((m) => {
      const meta = meterById(m.id);
      return meta.short + " × " + m.qty;
    })
    .join(", ");
}

/* โหลดเดิมรวมทุกวงจร (kVA) — เฉพาะโหมด B */
function totalExistingKva() {
  if (state.mode !== "B") return 0;
  return activeCircuits().reduce((s, n) => s + (state.circuits[n].existingKva || 0), 0);
}

/* โหลดมิเตอร์ใหม่รวมทุกวงจร (kVA) */
function totalNewKva() {
  return activeCircuits().reduce((s, n) => s + circuitKvaRaw(n), 0);
  function circuitKvaRaw(n) {
    return state.circuits[n].meters.reduce((sum, m) => sum + meterById(m.id).kva * m.qty, 0);
  }
}

/* จำนวนมิเตอร์ใหม่ทั้งหมด */
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
      side: CIRCUIT_SIDE[n],
      kva, kvaEx, kvaNew, current,
      meters: meterDetailStr(n),          // เช่น "5(15)A × 2, 15(45)A × 1"
      cable: cable.name, ampacity: cable.ampacity, over,
    });
  });

  /* --- บทสรุปหม้อแปลง --- */
  let txSummary;
  let conclusion = { tone: "ok", text: "", sub: "" };

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
          conclusion = {
            tone: "over",
            text: "โหลดรวม " + fmt(totalKva) + " kVA (" + fmt(pick.loadPct) + "%) เกินเกณฑ์ " + maxPct + "% ของขนาดที่เลือก",
            sub: "แนะนำใช้ขนาด " + txLabel(alt) + " — โหลดจะอยู่ที่ " + fmt((totalKva / alt.kva) * 100) + "%",
          };
        } else {
          const plat = suggestFrom(totalKva, maxPct, SIZE_BY_INSTALL.platform);
          conclusion = {
            tone: "over",
            text: "โหลดรวม " + fmt(totalKva) + " kVA เกินพิกัดหม้อแปลงแขวนเสาเดียวทุกรุ่น (สูงสุด 250 kVA) ที่โหลด " + maxPct + "%",
            sub: plat
              ? "ต้องเปลี่ยนเป็นหม้อแปลงนั่งร้าน (3 เฟส 416/240V) ขนาด " + txLabel(plat)
              : "ต้องตัดแบ่งโหลดหรือแยกสถานีหม้อแปลงหลายชุด",
          };
        }
      } else {
        const alt = suggestFrom(totalKva, maxPct, sizes);
        if (alt && alt.kva !== (pick.tx ? pick.tx.kva : null)) {
          conclusion = {
            tone: "over",
            text: "โหลดรวม " + fmt(totalKva) + " kVA (" + fmt(pick.loadPct) + "%) เกินเกณฑ์ " + maxPct + "% ของขนาดที่เลือก",
            sub: "แนะนำใช้ขนาด " + txLabel(alt) + " — โหลดจะอยู่ที่ " + fmt((totalKva / alt.kva) * 100) + "%",
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
        conclusion = {
          tone: "over",
          text: "โหลดรวม " + fmt(totalKva) + " kVA (" + fmt(loadPct) + "%) เกินเกณฑ์ " + maxPct + "% ของหม้อแปลงเดิม → ต้องอัปเกรดหม้อแปลง",
          sub: "แนะนำใช้หม้อแปลงขนาด " + txLabel(up) + " — โหลดจะอยู่ที่ " + fmt((totalKva / up.kva) * 100) + "%",
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

  return { txSummary, circuitRows, conclusion };
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

  /* --- เรนเดอร์การ์ดวงจรเฉพาะวงจรที่เปิดใช้งาน --- */
  const container = $("#circuits-container");
  container.innerHTML = "";
  activeCircuits().forEach((n) => {
    const c = state.circuits[n];
    const current = circuitCurrent(n);
    const ampacity = cabById(c.cable).ampacity;

    const card = document.createElement("div");
    card.className = "circuit-card";

    /* หัวการ์ด : ชื่อวงจร + กระแสสด */
    const head = document.createElement("div");
    head.className = "circuit-head";
    head.innerHTML = `
      <div class="circuit-title">
        <span class="circuit-side">ฝั่ง${CIRCUIT_SIDE[n]}</span>
        วงจรที่ ${n}
      </div>
      <div class="circuit-live">
        กระแสรวม <span class="cur ${current > ampacity ? "over" : ""}" id="cur-${n}">${fmt(current, 0)}</span> A
        <span style="opacity:.6">/ พิกัดสาย ${ampacity} A</span>
      </div>`;
    card.appendChild(head);

    /* เลือกขนาดสายไฟ + (โหมด B) โหลดเดิม kVA */
    const cableRow = document.createElement("div");
    cableRow.className = "form-row";
    cableRow.style.marginTop = "6px";
    const existingField = state.mode === "B"
      ? `<div>
          <label class="field-label">โหลดเดิมในวงจรนี้ (kVA)</label>
          <input type="number" min="0" step="0.5" value="${c.existingKva || 0}"
                 data-existing-kva="${n}">
        </div>`
      : "";
    cableRow.innerHTML = `
      <div>
        <label class="field-label">สายเมนแรงต่ำ (อลูมิเนียม THW-A)</label>
        <select data-cable="${n}">
          <option value="50">THW-A 50 ตร.มม. (พิกัด 130 A)</option>
          <option value="95">THW-A 95 ตร.มม. (พิกัด 209 A)</option>
        </select>
      </div>
      ${existingField}`;
    cableRow.querySelector("select").value = c.cable;
    card.appendChild(cableRow);

    /* รายการมิเตอร์ที่เพิ่มเข้าไปแล้ว */
    const list = document.createElement("div");
    list.className = "meter-list";
    list.dataset.circuit = n;
    card.appendChild(list);

    /* แถบเพิ่มมิเตอร์ใหม่ */
    const addBar = document.createElement("div");
    addBar.className = "meter-add-bar";
    addBar.innerHTML = `
      <select class="new-meter" data-add-select="${n}"></select>
      <input type="number" class="new-qty" data-add-qty="${n}" value="1" min="1" max="999">
      <button class="btn btn-primary btn-sm" data-add-btn="${n}">+ เพิ่มมิเตอร์</button>`;
    card.appendChild(addBar);
    container.appendChild(card);

    renderMeterSelectOptions(addBar.querySelector("select"));
    renderMeterList(n);
  });

  $("#active-circuit-badge").textContent = activeCircuits().length + " วงจร";
  updateLiveSummary();
}

/* เรนเดอร์รายการมิเตอร์ที่เพิ่มแล้วภายในวงจร */
function renderMeterList(circuitNum) {
  const list = document.querySelector(`.meter-list[data-circuit="${circuitNum}"]`);
  if (!list) return;
  const c = state.circuits[circuitNum];
  list.innerHTML = c.meters.length === 0
    ? `<div class="empty-note" style="color:var(--text-muted);font-size:12px;padding:2px 4px">ยังไม่มีมิเตอร์ในวงจรนี้ — เพิ่มจากด้านล่าง</div>`
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
  concl.className = "conclusion-box " + r.conclusion.tone;
  concl.innerHTML = r.conclusion.text + `<span class="sub">${r.conclusion.sub}</span>`;

  /* --- ตารางสรุปกระแสไฟฟ้ารายวงจร --- */
  /* โหมด A ไม่มีโหลดเดิม → ซ่อนคอลัมน์ "โหลดเดิม" */
  const isModeB = state.mode === "B";
  $("#th-kva-ex").style.display = isModeB ? "" : "none";
  if (!isModeB) $("#th-kva-new").textContent = "โหลด (kVA)";
  else $("#th-kva-new").textContent = "โหลดเพิ่ม (kVA)";

  const tbody = $("#result-circuit-rows");
  tbody.innerHTML = r.circuitRows.map((row) => {
    const overCls = row.over ? "over-cell" : "";
    /* แสดงรายละเอียดมิเตอร์ ถ้ามี มิฉะนั้นแสดง "-" */
    const meterCell = row.meters || "—";
    /* คอลัมน์โหลดเดิม/เพิ่ม ใช้เฉพาะโหมด B ส่วนโหมด A แสดงโหลดรวมในคอลัมน์ "โหลด (kVA)" */
    const kvaExCell = isModeB
      ? `<td>${fmt(row.kvaEx)}</td><td>${fmt(row.kvaNew)}</td>`
      : "";
    return `
    <tr>
      <td><b>วงจรที่ ${row.num}</b> <span style="color:var(--text-muted)">(ฝั่ง${row.side})</span></td>
      <td class="meter-cell">${meterCell}</td>
      ${kvaExCell}
      <td>${fmt(row.kva)}</td>
      <td class="${overCls}">${fmt(row.current)}${row.over ? '<span class="alert-tag">เกินพิกัด!</span>' : ""}</td>
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
  /* ลบมิเตอร์ออกจากวงจร */
  const rm = e.target.closest("[data-remove-circuit]");
  if (rm) {
    const n = parseInt(rm.dataset.removeCircuit, 10);
    const idx = parseInt(rm.dataset.removeIdx, 10);
    state.circuits[n].meters.splice(idx, 1);
    renderMeterList(n);
    return;
  }

  /* เพิ่มมิเตอร์เข้าสู่วงจร */
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

  /* ปุ่มคำนวณ */
  if (e.target.closest("#btn-calculate")) {
    if (state.mode === "B" && totalLoadKva() <= 0 && totalNewMeters() <= 0) {
      toast("กรุณากรอกโหลดเดิม kVA หรือเพิ่มมิเตอร์อย่างน้อย 1 เครื่อง");
      return;
    }
    if (state.mode === "A" && totalNewMeters() === 0) {
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
    const cur = document.getElementById("cur-" + n);
    if (cur) cur.classList.toggle("over", circuitCurrent(n) > cabById(cableSel.value).ampacity);
    return;
  }

  /* โหมด B: กรอกโหลดเดิม kVA ของวงจร */
  const exKva = e.target.closest("[data-existing-kva]");
  if (exKva) {
    const n = parseInt(exKva.dataset.existingKva, 10);
    const v = parseFloat(exKva.value);
    state.circuits[n].existingKva = (v > 0 && isFinite(v)) ? v : 0;
    updateLiveSummary();
    const cur = document.getElementById("cur-" + n);
    if (cur) cur.classList.toggle("over", circuitCurrent(n) > cabById(state.circuits[n].cable).ampacity);
    return;
  }
});

/* =====================================================================
   Init
   ===================================================================== */
renderInput();