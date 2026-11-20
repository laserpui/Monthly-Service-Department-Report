"use strict";

const exportButton = (scope, key = "") => '<button type="button" class="button compact" data-export-view="' + scope +
  '" data-key="' + esc(key) + '">' + icon("download") + ' Export CSV</button>';
const copyItemButton = (label, text, iconOnly = false) => '<button type="button" class="button compact copy-item' + (iconOnly ? ' copy-item-icon' : '') +
  '" data-copy-item' + (text === undefined ? '' : ' data-copy-text="' + esc(text) + '"') + ' title="' + esc(label) + '" aria-label="' + esc(label) + '">' +
  icon("copy") + (iconOnly ? "" : " คัดลอก") + '</button>';

const repairColumns = ["Repair ID","SRN","ลูกค้า","ยี่ห้อ","รุ่น","Serial Number","ประเภทเปิดงาน","สถานที่ปัจจุบัน","ช่าง","สถานะ","ความเร่งด่วน","ซ่อมไม่ผ่าน","อายุงาน (วัน)","วันที่รับแจ้ง","อัปเดตล่าสุด","กำหนดเสร็จ","อาการเสีย","เหตุผลที่ติดขัด","แผนถัดไป"];
const repairCells = repair => [
  repair.repair_id, repair.srn, state.customers[repair.customer_id], repair.brand, repair.model, repair.serial_number,
  R.types[repair.initial_service_type], R.locations[repair.current_location_type], assignedEngineer(repair),
  state.statuses[repair.status], R.priorities[repair.priority], R.failed(repair), R.age(repair),
  repair.reported_at, repair.updated_at, repair.due_date, repair.issue_description, repair.hold_reason, repair.next_action
];
const repairCopyButton = repair => {
  const cells = repairCells(repair);
  const text = repairColumns.flatMap((label,index) => cells[index] == null || cells[index] === "" ? [] : [label + " " + cells[index]]).join("\n");
  return copyItemButton("คัดลอกงาน " + repair.srn,text,true);
};
const quotationColumns = ["SRN","ลูกค้า","เลขใบเสนอราคา","ยอดเงิน (บาท)","สถานะใบเสนอราคา","สถานะงานซ่อม","วันที่เสนอราคา","วันที่ตัดสินใจ","เหตุผลที่ปฏิเสธ","เครื่อง","รูปใบเสนอราคา"];
const quotationCells = ({ repair, quote }) => [
  repair.srn,state.customers[repair.customer_id],quote ? quote.quotation_number ?? "" : quotationLabel(null),quote?.quoted_amount_thb,
  quote?.quotation_status,state.statuses[repair.status],quote?.quoted_at,quote?.decision_at,quote?.rejection_reason,
  repair.brand + " " + repair.model,quote?.image_drive?.path || (isQuoteImage(quote?.image_data_url) ? quoteImagePath(quote).path : "")
];
const quotationCopyText = entry => {
  const cells = quotationCells(entry);
  return quotationColumns.flatMap((label,index) => cells[index] == null || cells[index] === "" ? [] : [label + " " + cells[index]]).join("\n");
};
const monthlyRepairs = month => R.byMonth(state.repairs, month, chart.type)
  .filter(repair => Object.hasOwn(R.types,repair.initial_service_type));
const monthlyTotals = () => R.monthly(state.repairs,chart.start,chart.end,chart.type);
const repairReport = (name, records) => ({ name, rows:[repairColumns,...records.map(repairCells)] });

function detailReport(repair) {
  const rows = [["หมวด","รายการ","ข้อมูล"]];
  const cells = repairCells(repair);
  repairColumns.forEach((label,index) => rows.push(["งานซ่อม",label,cells[index]]));
  repair.visits.forEach(visit => rows.push(["การเข้าบริการ",visit.site_location,[visit.actual_visit_at || visit.scheduled_visit_at,state.engineers[visit.visit_engineer_id],visit.visit_findings].filter(Boolean).join(" · ")]));
  repair.attempts.forEach(attempt => rows.push(["รอบการซ่อม",attempt.attempt_no,[attempt.attempt_at,R.tests[attempt.test_result],attempt.actions_taken,attempt.failure_reason].filter(Boolean).join(" · ")]));
  repair.parts.forEach(part => rows.push(["อะไหล่",part.part_number,[part.part_name,part.quantity,part.part_status].filter(Boolean).join(" · ")]));
  repair.quotes.forEach(quote => rows.push(["ใบเสนอราคา",quotationLabel(quote),[quote.quoted_at,quote.quoted_amount_thb,quote.quotation_status,quote.image_drive?.path || (isQuoteImage(quote.image_data_url) ? quoteImagePath(quote).path : "")].filter(Boolean).join(" · ")]));
  return { name:repair.srn, rows };
}

function settingsReport() {
  const rows = [["หมวด","รหัส","ข้อมูล"]];
  for (const [label, values] of [["เกณฑ์แจ้งเตือน",state.settings],["สถานะ",state.statuses],["ช่าง",state.engineers],["ลูกค้า",state.customers]]) {
    Object.entries(values).forEach(([key,value]) => rows.push([label,key,value]));
  }
  state.machines.forEach(machine => rows.push(["เครื่อง",machine.machine_id,[machine.brand,machine.model,machine.serial_number,state.customers[machine.customer_id]].join(" · ")]));
  return { name:"master-data", rows };
}

function getReport(scope, key) {
  if (scope === "dashboard" && isQuotationView()) {
    const name = filters.quoteScope ? "quotations-" + filters.quoteScope : "quotations";
    return { name, rows:[quotationColumns,...quotationRows().map(quotationCells)] };
  }
  if (scope === "dashboard" && !isAdmin()) return repairReport(dashboardSection() ? location.hash.slice(1) : "dashboard-repairs",dashboardRows());
  if (scope === "admin") {
    const rows = Object.hasOwn(adminFilters,adminTab) ? adminRows(adminTab) : state.repairs;
    return repairReport("admin-repairs",rows);
  }
  if (scope === "monthly") return { name:"monthly-repairs", rows:[["เดือน","In-House","On-Site","รวม"],...monthlyTotals().map(row => [row.month,row.in_house,row.on_site,row.total])] };
  if (scope === "month") return repairReport("repairs-" + key,monthlyRepairs(key));
  if (scope === "settings") return settingsReport();
  const repair = findRepair(key);
  return repair ? detailReport(repair) : null;
}

function spreadsheetText(value) {
  const text = String(value ?? "");
  return typeof value === "string" && (/^[\t\r\n]/.test(text) || /^\s*[=+@-]/.test(text)) ? "'" + text : text;
}
function csvText(rows) {
  return "\uFEFF" + rows.map(row => row.map(value => '"' + spreadsheetText(value).replace(/"/g,'""') + '"').join(",")).join("\r\n");
}


const safeFilename = value => String(value ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]+/g,"-").replace(/^[ .]+|[ .]+$/g,"").slice(0,70) || "file";
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url),5000);
}

async function copyText(text) {
  const value = text.trim();
  if (!value) return notify("ไม่มีข้อความให้คัดลอก");
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const previous = document.activeElement;
    const field = document.createElement("textarea");
    field.className = "clipboard-field";
    field.value = value;
    const parent = dialog.open ? dialog : document.body;
    parent.append(field);
    field.select();
    let copied = false;
    try { copied = document.execCommand("copy"); }
    catch { /* Clipboard access can be disabled by browser policy. */ }
    finally { field.remove(); previous?.focus(); }
    if (!copied) return notify("คัดลอกไม่ได้ กรุณาตรวจสิทธิ์คลิปบอร์ดของเบราว์เซอร์");
  }
  notify("คัดลอกแล้ว");
}

const driveUploads = new Set();
const canUploadQuoteToDrive = () => typeof window.google?.script?.run?.withSuccessHandler === "function";

function quoteDriveControls(repairId, quote) {
  if (quote.image_drive || !canUploadQuoteToDrive()) return "";
  const busy = driveUploads.has(quote.quotation_id);
  return '<button type="button" class="button compact" data-upload-quote="' + esc(quote.quotation_id) +
    '" data-repair="' + esc(repairId) + '"' + (busy ? ' disabled' : '') + '>' +
    (busy ? 'กำลังอัปโหลด…' : 'อัปโหลดไป Google Drive') + '</button>';
}

async function uploadQuoteToDrive(repairId, quoteId) {
  const repair = findRepair(repairId);
  const quote = repair?.quotes.find(item => item.quotation_id === quoteId);
  if (!canUploadQuoteToDrive() || !quote || quote.image_drive || !isQuoteImage(quote.image_data_url) || driveUploads.has(quoteId)) return;
  const refresh = () => {
    const latest = findRepair(repairId)?.quotes.find(item => item.quotation_id === quoteId);
    for (const controls of document.querySelectorAll("[data-quote-drive-controls]")) {
      if (latest && controls.dataset.quoteDriveControls === quoteId) controls.innerHTML = quoteDriveControls(repairId,latest);
    }
  };
  driveUploads.add(quoteId);
  refresh();
  notify("บันทึกใบเสนอราคาแล้ว กำลังอัปโหลดรูปไป Google Drive…");
  try {
    const image = await new Promise((resolve,reject) => {
      window.google.script.run.withSuccessHandler(resolve).withFailureHandler(reject).uploadQuotationImage({
        uploadId:quoteId, srn:quote.image_drive_srn || repair.srn,
        customer:quote.image_drive_customer || state.customers[repair.customer_id],
        date:R.bangkokDay(quote.quoted_at || quote.image_attached_at || R.today),
        source:quote.image_data_url
      });
    });
    if (!/^[a-zA-Z0-9_-]+$/.test(image?.id || "") || typeof image?.path !== "string") throw new Error("Invalid Drive result");
    const next = copyState();
    const stored = next.repairs.find(item => item.repair_id === repairId)?.quotes.find(item => item.quotation_id === quoteId);
    if (stored) {
      stored.image_drive = image;
      try {
        R.save(next);
        state = next;
      } catch {
        notify("อัปโหลดรูปแล้ว แต่บันทึกลิงก์ในเบราว์เซอร์ไม่ได้ ลองอัปโหลดซ้ำจากรายละเอียดงาน");
        return;
      }
    }
    notify("อัปโหลดรูปไป Google Drive แล้ว");
  } catch {
    notify("อัปโหลดรูปไป Google Drive ไม่สำเร็จ ลองอัปโหลดซ้ำจากรายละเอียดงาน");
  } finally {
    driveUploads.delete(quoteId);
    refresh();
  }
}

let quoteFolder;
const canChooseQuoteFolder = () => typeof window.showDirectoryPicker === "function" && window === window.top;

function quoteImagePath(quote) {
  const [year, month] = R.bangkokDay(quote.quoted_at || quote.image_attached_at || findRepair(quote.repair_id)?.reported_at || R.today).split("-");
  const subtype = quote.image_data_url.match(/^data:image\/(jpeg|png|webp);/i)[1].toLowerCase();
  const extension = subtype === "jpeg" ? "jpg" : subtype;
  const filename = safeFilename(quote.image_archive_label ?? quote.quotation_number) + "-" + safeFilename(quote.quotation_id) + "." + extension;
  return { year, month, filename, path:[year,month,filename].join("/") };
}

async function chooseQuoteFolder() {
  if (!canChooseQuoteFolder()) {
    notify("เลือกโฟลเดอร์ได้เมื่อเปิด Demo โดยตรงในเบราว์เซอร์ที่รองรับ เช่น Chrome หรือ Edge");
    return null;
  }
  try {
    quoteFolder = await window.showDirectoryPicker({ mode:"readwrite", id:"repair-quotation-images" });
    const status = document.querySelector("#quote-folder-status");
    if (status) status.textContent = quoteFolder.name + " / ปี / เดือน";
    return quoteFolder;
  } catch (error) {
    if (error.name !== "AbortError") notify("เปิดโฟลเดอร์ไม่ได้ กรุณาตรวจสิทธิ์การเข้าถึง");
    return null;
  }
}

function quoteImageBytes(source) {
  return Uint8Array.from(atob(source.split(",",2)[1]), character => character.charCodeAt(0));
}

async function writeQuoteImage(folder, quote) {
  const { year, month, filename, path } = quoteImagePath(quote);
  const bytes = quoteImageBytes(quote.image_data_url);
  const yearFolder = await folder.getDirectoryHandle(year,{create:true});
  const monthFolder = await yearFolder.getDirectoryHandle(month,{create:true});
  const file = await monthFolder.getFileHandle(filename,{create:true});
  const writer = await file.createWritable();
  try {
    await writer.write(bytes);
    await writer.close();
  } catch (error) {
    await writer.abort().catch(() => {});
    throw error;
  }
  return path;
}

async function saveQuoteImageToFolder(quote, choose = false) {
  const folder = choose && !quoteFolder ? await chooseQuoteFolder() : quoteFolder;
  if (!folder || !isQuoteImage(quote?.image_data_url)) return;
  try {
    const path = await writeQuoteImage(folder,quote);
    notify("บันทึกรูปลง " + folder.name + "/" + path);
  } catch {
    if (quoteFolder === folder) quoteFolder = undefined;
    notify("บันทึกรูปลงโฟลเดอร์ไม่ได้ รูปยังเปิดดูได้จากรายละเอียดงาน");
  }
}
