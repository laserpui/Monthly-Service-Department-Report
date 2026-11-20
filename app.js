"use strict";

const R = RepairData;
let state = document.body.dataset.liveDatabase === "true" ? null : R.load();
const app = document.querySelector("#app");
const dialog = document.querySelector("#dialog");
const dialogBody = document.querySelector("#dialog-body");
const paths = {
  wrench:'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-7 7a2.1 2.1 0 0 1-3-3l7-7a6 6 0 0 1 7.9-7.9z"/>',
  layout:'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="white"/><circle cx="15" cy="17" r="2" fill="white"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/>',
  chevron:'<path d="m9 18 6-6-6-6"/>', x:'<path d="m18 6-12 12M6 6l12 12"/>',
  activity:'<path d="M22 12h-4l-3 8L9 4l-3 8H2"/>',
  history:'<path d="M3 12a9 9 0 1 1 2.6 6.4M3 12V5m0 7h7m2-5v5l3 2"/>',
  briefcase:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  hourglass:'<path d="M6 3h12M6 21h12m-11-1v-3l5-5-5-5V4m10 16v-3l-5-5 5-5V4"/>',
  triangle:'<path d="M10.3 4.5 2.9 18a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0zM12 9v4m0 4h.01"/>',
  chart:'<path d="M3 3v18h18M8 16v-3m5 3V8m5 8V5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  list:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8m-8 4h8m-8 4h5"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  filter:'<path d="M4 6h16M7 12h10m-7 6h4"/>',
  receipt:'<path d="M5 3l2 1.5L9.5 3 12 4.5 14.5 3 17 4.5 19 3v18l-2-1.5-2.5 1.5-2.5-1.5L9.5 21 7 19.5 5 21V3Zm4 6h6m-6 4h6m-6 4h3"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-6-6L3 21"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  edit:'<path d="m15 5 4 4M4 20l4-.6L20 7l-4-4L4.6 15z"/>',
  check:'<path d="m5 12 4 4L19 6"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || "") + '</svg>';
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[character]);
const shortDate = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { timeZone:"Asia/Bangkok", year:"numeric", month:"short", day:"numeric" });
const date = value => value && !isNaN(Date.parse(value)) ? shortDate.format(new Date(value)) : "—";
const timestamp = value => value?.length > 10 ? date(value) + " " + new Date(value).toLocaleTimeString("th-TH", { timeZone:"Asia/Bangkok", hour:"2-digit", minute:"2-digit" }) : date(value);
const options = (choices, selected, placeholder = null) => (placeholder === null ? "" : '<option value="">' + esc(placeholder) + '</option>') +
  Object.entries(choices).map(([key, label]) => '<option value="' + esc(key) + '" ' + (key === selected ? "selected" : "") + '>' + esc(label) + '</option>').join("");
const activeStatuses = () => Object.fromEntries(Object.entries(state.statuses).filter(([key]) => key !== "CLOSED"));
const badge = (label, tone = "neutral") => '<span class="badge ' + tone + '"><i></i>' + esc(label) + '</span>';
const toggle = (name, value, label, selected, symbol) => '<button type="button" data-' + name + '="' + value + '" aria-pressed="' + selected + '">' + icon(symbol) + esc(label) + '</button>';
const findRepair = id => state.repairs.find(row => row.repair_id === id);
const assignedEngineerNames = repair => [repair.assigned_engineer_id,repair.secondary_engineer_id]
  .map(id => state.engineers[id]).filter(Boolean);
const assignedEngineer = repair => assignedEngineerNames(repair).join(" · ") || "ยังไม่จ่ายงาน";
const isAdmin = () => location.hash === "#admin";

function render() {
  if (isLiveDatabase() && !state) return showLiveDatabaseStatus();
  const section = dashboardSection();
  const canUseAdmin = !isLiveDatabase() || state.role === "ADMIN";
  if (isLiveDatabase()) {
    document.querySelector("#source-status").textContent = "Google Sheets";
    document.querySelector("#refresh-db").hidden = false;
    document.querySelector(".side-footer small").textContent = "ข้อมูลจริง";
  }
  const route = isAdmin() ? "admin" : section ? location.hash.slice(1) : "dashboard";
  document.querySelectorAll("[data-route]").forEach(link => {
    if (link.dataset.route === "admin") link.hidden = !canUseAdmin;
    if (link.dataset.route === route) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.querySelector("#breadcrumb").textContent = isAdmin() ? "Admin" : section?.title || "Dashboard";
  app.innerHTML = isAdmin() ? (canUseAdmin ? admin() : '<section class="panel"><h1>บัญชีนี้มีสิทธิ์ดูข้อมูล</h1></section>') : section ? repairIndex(section) : dashboard();
  if (isAdmin() && canUseAdmin) afterAdmin();
  else if (!isAdmin()) table();
}

function openDialog(kicker, title, body) {
  document.querySelector("#dialog-kicker").textContent = kicker;
  document.querySelector("#dialog-title").textContent = title;
  dialogBody.innerHTML = body;
  if (!dialog.open) dialog.showModal();
  else document.querySelector("#dialog-close").focus();
  dialog.scrollTop = 0;
}
const meta = items => '<div class="detail-meta">' + items.filter(([,value]) => value !== undefined && value !== "").map(([label,value]) =>
  '<div class="meta-item"><span><small>' + esc(label) + '</small><strong>' + esc(value) + '</strong></span>' + copyItemButton("คัดลอก" + label,value,true) + '</div>').join("") + '</div>';
const copyableItem = (html, label) => '<div class="record copyable-item"><div class="copy-content">' + html + '</div>' + copyItemButton(label) + '</div>';
const records = (title, rows, format) => '<section class="detail-section"><h3>' + esc(title) + '</h3>' +
  (rows.length ? rows.map((row,index) => copyableItem(format(row),"คัดลอก" + title + " รายการที่ " + (index + 1))).join("") : '<div class="record"><p>ยังไม่มีบันทึก</p></div>') + '</section>';
const copyableRecord = (title, text, extra = "") => '<section class="detail-section"><h3>' + esc(title) + '</h3>' +
  copyableItem('<p>' + linkifyText(text) + '</p>' + extra,"คัดลอก" + title) + '</section>';
const record = (title, detail) => '<strong>' + linkifyText(title) + '</strong><p>' + linkifyText(detail) + '</p>';
const link = (url, text) => {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (["https:", "http:"].includes(parsed.protocol)) return '<a href="' + esc(parsed.href) + '" target="_blank" rel="noopener noreferrer">' + esc(text) + '</a>';
  } catch { /* Render invalid URLs as text. */ }
  return esc(url);
};

function linkifyText(value) {
  const text = String(value ?? "");
  let html = "", cursor = 0;
  for (const match of text.matchAll(/(^|[\s([{<>"'“‘])((?:https?:\/\/)[^\s<>"'“”‘’]+)/gi)) {
    const start = match.index + match[1].length;
    const candidate = match[2];
    const surplus = { ")":0, "]":0, "}":0 };
    for (const character of candidate) {
      if (Object.hasOwn(surplus,character)) surplus[character]++;
      if (character === "(") surplus[")"]--;
      if (character === "[") surplus["]"]--;
      if (character === "{") surplus["}"]--;
    }
    let end = candidate.length;
    while (end > 0) {
      const character = candidate[end - 1];
      if (surplus[character] > 0) surplus[character]--;
      else if (!/[.,!?;:…。，]/.test(character)) break;
      end--;
    }
    const url = candidate.slice(0,end);
    html += esc(text.slice(cursor,start)) + link(url,url);
    cursor = start + end;
  }
  return html + esc(text.slice(cursor));
}
const textFields = (item, fields) => fields.map(([key,label]) => item[key] ? label + " " + item[key] : "").filter(Boolean).join("\n");
const visitRecord = visit => record(visit.site_location, [
  "นัดหมาย " + date(visit.scheduled_visit_at),
  visit.actual_visit_at && "เข้าบริการจริง " + date(visit.actual_visit_at),
  state.engineers[visit.visit_engineer_id],
  visit.visit_findings,
  visit.follow_up_required && "ต้องเข้าซ้ำ · " + date(visit.next_visit_at)
].filter(Boolean).join("\n"));
const attemptRecord = attempt => record("ครั้งที่ " + attempt.attempt_no + " · " + R.tests[attempt.test_result] + " · " + date(attempt.attempt_at), [
  [state.engineers[attempt.engineer_id], R.locations[attempt.location_type]].filter(Boolean).join(" · "),
  textFields(attempt,[["symptom_before","อาการก่อนซ่อม"],["actions_taken","การดำเนินการ"],["parts_replaced","อะไหล่ที่เปลี่ยน"],["remaining_symptom","อาการที่ยังพบ"],["failure_reason","สาเหตุที่ไม่สำเร็จ"],["failure_note","รายละเอียด"],["next_action","ขั้นตอนถัดไป"]]),
  attempt.next_owner_id && "ผู้รับผิดชอบต่อ " + state.engineers[attempt.next_owner_id]
].filter(Boolean).join("\n"));
const partRecord = part => record(part.part_name + " · " + part.part_number, [
  part.quantity + " ชิ้น",
  textFields(part,[["part_status","สถานะ"],["ordered_at","วันที่สั่ง"],["eta_at","คาดว่าจะได้รับ"],["received_at","วันที่ได้รับ"],["po_number","PO"],["claim_number","เลขเคลม"],["tracking_number","เลขติดตาม"]])
].filter(Boolean).join("\n"));
const isQuoteImage = source => typeof source === "string" && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/]+={0,2}$/i.test(source);
const quoteCurrency = new Intl.NumberFormat("th-TH",{style:"currency",currency:"THB"});
const quotationLabel = quote => quote ? quote.quotation_number || "ยังไม่ระบุเลขใบเสนอราคา" : "ยังไม่มีใบเสนอราคา";
function quoteImageButton(quote, repairId) {
  const driveId = quote?.image_drive?.id;
  const label = icon("image") + ' เปิดรูปภาพ';
  if (/^[A-Za-z0-9_-]+$/.test(driveId || "")) {
    return '<a class="button compact quote-image-trigger" target="_blank" rel="noopener noreferrer" href="https://drive.google.com/file/d/' +
      driveId + '/view">' + label + '</a>';
  }
  if (!isQuoteImage(quote?.image_data_url)) return "";
  return '<button type="button" class="button compact quote-image-trigger" data-quote-image="' + esc(quote.quotation_id) +
    '" data-key="' + esc(repairId) + '">' + label + '</button>';
}

function localQuoteActions(quote, repairId) {
  if (!isQuoteImage(quote.image_data_url)) return "";
  const filename = quote.image_name || quoteImagePath(quote).filename;
  return '<div class="data-actions"><a class="button compact" href="' + esc(quote.image_data_url) +
    '" download="' + esc(filename) + '">' + icon("download") + ' ดาวน์โหลดรูป</a>' +
    (canChooseQuoteFolder() ? '<button type="button" class="button compact" data-archive-quote="' + esc(quote.quotation_id) +
      '" data-key="' + esc(repairId) + '">บันทึกรูปลงโฟลเดอร์</button>' : '') +
    '<span data-quote-drive-controls="' + esc(quote.quotation_id) + '">' + quoteDriveControls(repairId,quote) + '</span></div>';
}
const quoteRecord = (quote, repairId) => '<div class="record-text">' + record(quotationLabel(quote), [
  quoteCurrency.format(quote.quoted_amount_thb),
  textFields(quote,[["quoted_at","วันที่เสนอราคา"],["quotation_status","สถานะ"],["decision_at","วันที่ตัดสินใจ"],["rejection_reason","เหตุผลที่ปฏิเสธ"]])
].filter(Boolean).join("\n")) + '</div>' + quoteImageButton(quote,repairId) + localQuoteActions(quote,repairId);

function openQuoteImage(repairId, quoteId) {
  const quote = findRepair(repairId)?.quotes.find(item => item.quotation_id === quoteId);
  if (!isQuoteImage(quote?.image_data_url)) return;
  const mime = quote.image_data_url.slice(5,quote.image_data_url.indexOf(";")).toLowerCase();
  const url = URL.createObjectURL(new Blob([quoteImageBytes(quote.image_data_url)],{type:mime}));
  window.open(url,"_blank","noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url),60_000);
}

function detail(id) {
  const row = findRepair(id);
  if (!row) return;
  const failures = R.failed(row);
  const risk = failures >= state.settings.critical ? "ติดตามเร่งด่วน" : failures >= state.settings.manager ? "ให้ผู้จัดการตรวจสอบ" : failures >= state.settings.repeated ? "ซ่อมไม่สำเร็จหลายครั้ง" : failures >= state.settings.watch ? "เฝ้าระวัง" : "";
  const related = state.repairs.filter(other => other.repair_id !== id &&
    ((row.machine_id && other.machine_id === row.machine_id) || (row.serial_number && other.serial_number === row.serial_number)))
    .sort((a,b) => Date.parse(b.reported_at) - Date.parse(a.reported_at));
  const closedDay = R.closedDay(row);
  const recurrent = related.some(other => {
    const previousClose = R.closedDay(other);
    return previousClose && other.test_result === "PASS" && previousClose <= R.bangkokDay(row.reported_at);
  });
  const statusEvent = [...row.history].reverse().find(event => event.old_value !== event.new_value && Object.hasOwn(state.statuses, event.new_value));
  const statusAge = statusEvent ? R.age({ reported_at: statusEvent.occurred_at, status: row.status, closed_at: row.closed_at }) : null;
  openDialog("รายละเอียดงานซ่อม", row.srn,
    '<div class="detail-heading"><div class="flags">' + badge(state.statuses[row.status], statusTone(row.status)) + (risk ? badge(risk + " · ไม่ผ่าน " + failures + " ครั้ง", "rose") : "") + (recurrent ? badge("พบประวัติเครื่องซ่อมสำเร็จก่อนเปิดเคสนี้", "purple") : "") + '</div>' + exportButton("detail",id) + '</div>' +
    '<section class="detail-section"><h3>ข้อมูลงานซ่อม</h3>' + meta([["รหัสงาน",row.repair_id],["ลูกค้า",state.customers[row.customer_id]],["ยี่ห้อและรุ่น",row.brand + " " + row.model],["Serial Number",row.serial_number || "ยังไม่ระบุ"],["Machine ID",row.machine_id],["ช่าง",assignedEngineer(row)],["ความเร่งด่วน",R.priorities[row.priority]],["ประเภทเปิดงาน",R.types[row.initial_service_type]],["สถานที่ซ่อมปัจจุบัน",R.locations[row.current_location_type]],["วันที่รับแจ้ง",date(row.reported_at)],["กำหนดเสร็จ",date(row.due_date)],["อัปเดตล่าสุด",timestamp(row.updated_at)],["อายุงาน",R.age(row) + " วัน"],["อยู่ในสถานะนี้",statusAge === null ? "—" : statusAge + " วัน"],["ซ่อมไม่ผ่าน",failures + " ครั้ง"]]) + '</section>' +
    copyableRecord("อาการเสียและความคืบหน้า", row.issue_description + "\n" + textFields(row,[["error_code","Error Code"],["initial_findings","ผลตรวจสอบ"],["root_cause","สาเหตุ"],["hold_reason","เหตุผลที่ติดขัด"],["next_action","ขั้นตอนถัดไป"]])) +
    (row.received_at_company_at || row.storage_location || row.repair_started_at || row.returned_to_customer_at ? copyableRecord("ข้อมูล In-House", textFields(row,[["received_at_company_at","รับเครื่อง"],["storage_location","ที่เก็บเครื่อง"],["received_by","ผู้รับเครื่อง"],["repair_started_at","เริ่มซ่อม"],["returned_to_customer_at","ส่งคืน"]])) : '') +
    (closedDay ? copyableRecord("ปิดงาน · " + date(closedDay), [row.final_outcome, R.tests[row.test_result], row.close_note].filter(Boolean).join(" · "),link(row.service_report_url,"เปิดรายงานบริการ")) : "") +
    records("การเข้าบริการ (Visits)", row.visits, visitRecord) +
    records("รอบการซ่อม (Attempts)", row.attempts, attemptRecord) +
    records("อะไหล่", row.parts, partRecord) +
    records("ใบเสนอราคา", row.quotes, quote => quoteRecord(quote,id)) +
    records("เอกสาร", String(row.attachments || "").split(/\s+/).filter(Boolean), url => link(url, url)) +
    records("ประวัติเครื่องเดียวกัน", related, other => '<button class="text-button" data-open="' + esc(other.repair_id) + '">' + esc(other.srn) + '</button><p>' + date(other.reported_at) + ' · ' + esc(state.statuses[other.status]) + '</p>'));
}

function notify(message) {
  const toast = document.querySelector("#toast");
  clearTimeout(notify.timer);
  (dialog.open ? dialog : document.body).append(toast);
  toast.textContent = message;
  toast.hidden = false;
  notify.timer = setTimeout(() => { toast.hidden = true; }, 3200);
}

document.querySelectorAll("[data-icon]").forEach(element => { element.innerHTML = icon(element.dataset.icon); });
document.querySelector("#dialog-close").addEventListener("click", () => dialog.close());
window.addEventListener("hashchange", () => {
  if (dialog.open) dialog.close();
  clearFilters();
  render();
  window.scrollTo(0,0);
});
window.addEventListener("DOMContentLoaded", () => isLiveDatabase() ? loadLiveDatabase() : render());
