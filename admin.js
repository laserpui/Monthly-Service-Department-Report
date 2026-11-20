"use strict";

const adminTabs = { manage:["จัดการงานซ่อม","list"], new:["เปิดงานใหม่","plus"], update:["บันทึกและปิดงาน","history"], settings:["ข้อมูลหลักและตั้งค่า","settings"] };
let adminTab = "manage", selectedId = "", activity = "progress", adminPage = 1;
const adminFilters = {
  manage:{query:"",status:"",from:"",to:""},
  update:{query:"",scope:""}
};
const lookupKey = value => String(value ?? "").trim().normalize("NFC").toLowerCase();
const isOtherBrand = brand => lookupKey(brand).replace(/\s+/g,"") === "อื่นๆ";
const findMachineBySerial = (directory, serial) => directory.machines.find(machine => lookupKey(machine.serial_number) === lookupKey(serial));
const choiceCollator = new Intl.Collator("th",{sensitivity:"base",numeric:true});
const compareChoices = (a,b) => Number(a === "อื่นๆ") - Number(b === "อื่นๆ") || choiceCollator.compare(a,b);
const engineerChoices = () => Object.fromEntries(Object.entries(state.engineers).sort((a,b) => compareChoices(a[1],b[1])));
function machineChoices(field, brand = "") {
  const catalog = field === "brand" ? Object.keys(R.modelsByBrand) : Object.hasOwn(R.modelsByBrand,brand) ? R.modelsByBrand[brand] : [];
  const recorded = [...state.machines,...state.repairs]
    .filter(item => !brand || item.brand === brand)
    .map(item => item[field]).filter(Boolean);
  return Object.fromEntries([...new Set([...catalog,...recorded])].sort(compareChoices).map(value => [value,value]));
}
const inHouseFields = [["received_at_company_at","วันที่รับเครื่อง","date"],["storage_location","สถานที่เก็บเครื่อง"],["received_by","ผู้รับเครื่อง"],["repair_started_at","วันที่เริ่มซ่อม","date"],["returned_to_customer_at","วันที่ส่งคืน","date"]];

function fields(spec, values = {}) {
  return '<div class="form-grid">' + spec.map(([key,label,type = "text",required = false,choices]) => {
    const raw = values[key] ?? "";
    const value = type === "date" && raw && !isNaN(Date.parse(raw)) ? R.bangkokDay(raw) : raw;
    let input;
    if (choices) input = '<select name="' + key + '" ' + (required ? "required" : "") + '>' + options(choices, value, "เลือก" + label) + '</select>';
    else if (type === "textarea") input = '<textarea name="' + key + '" rows="2" ' + (required ? "required" : "") + '>' + esc(value) + '</textarea>';
    else input = '<input type="' + type + '" name="' + key + '" value="' + esc(value) + '" ' + (type === "number" ? 'min="1"' : type === "decimal" ? 'inputmode="decimal"' : "") + ' ' + (required ? "required" : "") + '>';
    return '<label class="field ' + (type === "textarea" ? "span" : "") + '">' + '<span>' + label + (required ? ' <em aria-label="จำเป็น">*</em>' : "") + '</span>' + input + '</label>';
  }).join("") + '</div>';
}
const pick = (name, label, choices, required = true) => [name,label,"select",required,choices];
const closingFields = [
  ["repair_completed_at","วันที่ซ่อมเสร็จ","date",true],["returned_to_customer_at","วันที่ส่งคืน","date"],
  pick("test_result","ผลทดสอบ",R.tests),["final_outcome","ผลสรุปงาน","text",true],
  ["service_report_url","ลิงก์รายงานบริการ","url"],["close_note","หมายเหตุปิดงาน","textarea",true]
];
const formFooter = label => '<p class="error" role="alert" hidden></p><div class="actions"><button class="button primary" type="submit">' + icon("check") + ' ' + label + '</button></div>';
const fieldset = (title, html, attributes = "") => '<fieldset ' + attributes + '><legend>' + title + '</legend>' + html + '</fieldset>';

function admin() {
  return '<section class="hero"><div><h1>จัดการงานซ่อม</h1><p class="subtitle">' + (isLiveDatabase() ? "เปิดงาน บันทึกความคืบหน้า และดูแลข้อมูลหลัก" : "เปิดงาน บันทึกความคืบหน้า และดูแลข้อมูลหลักในโหมดสาธิต") + '</p></div>' +
    '<div class="data-actions">' + (adminTab === "settings" ? exportButton("settings") : (["edit","update"].includes(adminTab) && findRepair(selectedId) ? exportButton("detail",selectedId) : exportButton("admin"))) +
    '<button class="button primary" data-admin-tab="new">' + icon("plus") + ' เปิดงานใหม่</button></div></section><div class="segment admin-nav" aria-label="เมนูจัดการ">' +
    Object.entries(adminTabs).map(([key,[label,symbol]]) => toggle("admin-tab",key,label,key === (adminTab === "edit" ? "manage" : adminTab),symbol)).join("") + '</div>' +
    '<section class="panel admin-panel">' + adminContent() + '</section>';
}

function adminContent() {
  const current = findRepair(selectedId);
  if (adminTab === "new" || adminTab === "edit") return repairForm(adminTab === "edit" ? current : null);
  if (adminTab === "settings") return settingsForm();
  if (adminTab === "update") return updateForm(current);
  return '<header class="section-head"><div><h2>ค้นหาและแก้ไขงานเดิม</h2></div></header>' +
    adminSearchControls("manage") + '<div id="admin-results"></div>';
}

function adminSearchControls(tab) {
  const values = adminFilters[tab];
  const manage = tab === "manage";
  const queryId = manage ? "admin-query" : "update-job-query";
  const searchFields = "SRN, ลูกค้า, Serial Number" + (manage ? ", ช่าง" : "");
  const toolbar = '<div class="toolbar repair-toolbar"><label class="search grow">' + icon("search") +
    '<input type="search" id="' + queryId + '" data-admin-filter="query" aria-label="ค้นหาจาก ' + searchFields + '" placeholder="ค้นหา ' + searchFields +
    '" value="' + esc(values.query) + '" autocomplete="off" aria-controls="' + (manage ? "admin-results" : "update-job-results") + '"></label>' +
    (manage
      ? '<select data-admin-filter="status" aria-label="สถานะงานซ่อม">' + options(state.statuses,values.status,"ทุกสถานะ") + '</select>'
      : '<select data-admin-filter="scope" aria-label="กลุ่มงาน">' + options({open:"งานที่ยังเปิด",closed:"งานที่ปิดแล้ว"},values.scope,"ทุกงาน") +
        '</select><button type="button" class="button" data-action="reset-admin-filters">รีเซ็ต</button>') + '</div>';
  return manage ? '<div class="repair-filter-layout">' + toolbar + dateRangeControls(values,true) + '</div>' : toolbar;
}

function resetAdminFilters(tab) {
  Object.keys(adminFilters[tab]).forEach(key => { adminFilters[tab][key] = ""; });
  if (tab === "manage") adminPage = 1;
}

function showSavedAdminRepair(srn) {
  resetAdminFilters("manage");
  adminFilters.manage.query = srn;
  adminTab = "manage";
}

function showReopenedAdminRepair(id) {
  selectedId = id;
  adminTab = "update";
  activity = "progress";
}

const reopenJobButton = id => '<button type="button" class="button compact" data-reopen-job="' + esc(id) + '">เปิดงานอีกครั้ง</button>';

function adminRows(tab = "manage") {
  const values = adminFilters[tab];
  const query = lookupKey(values.query);
  const manage = tab === "manage";
  if (!manage && !query && !values.scope) return [];
  return state.repairs.filter(row => {
    if (manage) {
      if ((values.status && row.status !== values.status) || !matchesDateRange(row.reported_at,values)) return false;
    } else if (values.scope && R.active(row) !== (values.scope === "open")) return false;
    const fields = [row.srn,state.customers[row.customer_id],row.serial_number];
    if (manage) fields.push(...assignedEngineerNames(row));
    return fields.some(value => lookupKey(value).includes(query));
  }).sort((a,b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

function setAdminFilter(key,value) {
  const values = adminFilters[adminTab];
  if (!values || !Object.hasOwn(values,key)) return;
  values[key] = value;
  if (adminTab === "manage") {
    adminPage = 1;
    adminResults();
  } else updateJobResults();
}
function adminResults() {
  const results = adminRows();
  const list = document.querySelector("#admin-results");
  if (!list) return;
  updateDateRangeFeedback(adminFilters.manage);
  const size = 10;
  const pages = Math.max(1,Math.ceil(results.length / size));
  adminPage = Math.min(adminPage,pages);
  const start = (adminPage - 1) * size;
  list.innerHTML = '<p class="subtitle" role="status">พบ ' + results.length + ' งาน</p><div class="table-scroll" tabindex="0"><table><thead><tr>' +
    ["SRN","ลูกค้า","เครื่อง","ช่าง","สถานะ","จัดการ"].map(label => '<th scope="col">' + label + '</th>').join("") + '</tr></thead><tbody>' +
    (results.slice(start,start + size).map(row => '<tr><td><div class="row-copy"><button class="text-button serial" data-open="' + esc(row.repair_id) + '">' + esc(row.srn) + '</button>' + repairCopyButton(row) + '</div></td><td>' + esc(state.customers[row.customer_id]) + '</td><td>' + esc(row.brand + " " + row.model) + '</td><td>' + esc(assignedEngineer(row)) + '</td><td>' + badge(state.statuses[row.status],statusTone(row.status)) +
      '</td><td><button class="button compact" data-edit="' + esc(row.repair_id) + '">แก้ไข</button>' +
      ' ' + (R.active(row) ? '<button class="button compact" data-update="' + esc(row.repair_id) + '">บันทึก</button>' : reopenJobButton(row.repair_id)) +
      '</td></tr>').join("") || '<tr><td colspan="6" class="empty">ไม่พบงานซ่อม</td></tr>') + '</tbody></table></div>' +
    (pages > 1 ? '<div class="pagination"><span>หน้า ' + adminPage + ' จาก ' + pages + '</span><div class="segment">' +
      '<button type="button" data-admin-page="' + (adminPage - 1) + '"' + (adminPage === 1 ? ' disabled' : '') + '>ก่อนหน้า</button>' +
      '<button type="button" data-admin-page="' + (adminPage + 1) + '"' + (adminPage === pages ? ' disabled' : '') + '>ถัดไป</button></div></div>' : '');
}
function afterAdmin() {
  if (adminTab === "manage") adminResults();
  if (adminTab === "update" && !findRepair(selectedId)) updateJobResults();
  const form = document.querySelector('form[data-form="repair"]');
  if (form) {
    syncRepairModels(form);
    syncRepairLocation(form);
  }
}
function repairForm(current) {
  const closed = current?.status === "CLOSED";
  const engineers = engineerChoices();
  const initial = current ? { ...current, customer_name:state.customers[current.customer_id] } :
    { reported_at:R.today, status:"PENDING_INSPECTION", priority:"MEDIUM", initial_service_type:"IN_HOUSE", current_location_type:"IN_HOUSE" };
  return '<header class="section-head"><div><h2 id="repair-form-title" tabindex="-1">' + (current ? "แก้ไข " + esc(current.srn) : "เปิดงานซ่อมใหม่") + '</h2><p>' + (current ? esc(current.repair_id) : "ระบบจะสร้างรหัสงานเมื่อบันทึก") + '</p></div>' +
    (closed ? badge(state.statuses.CLOSED,statusTone("CLOSED")) : '') + '</header><form data-form="repair">' +
    fieldset("ข้อมูลรับแจ้ง", fields([
      ["srn","เลขที่ใบงานซ่อม (SRN)","text",true],["reported_at","วันที่รับแจ้ง","date",true],
      ["customer_name","ลูกค้า","text",true],
      pick("brand","ยี่ห้อ",machineChoices("brand")),
      isOtherBrand(initial.brand) ? ["model","รุ่น","text",true] : pick("model","รุ่น",initial.brand ? machineChoices("model",initial.brand) : {}),
      ["serial_number","Serial Number","text"],
      pick("assigned_engineer_id","ช่างผู้รับผิดชอบ",engineers,Boolean(current?.assigned_engineer_id)),
      pick("secondary_engineer_id","ช่างผู้รับผิดชอบคนที่ 2",engineers,false),
      pick("priority","ความเร่งด่วน",R.priorities),
      pick("initial_service_type","ประเภทเมื่อเปิดงาน",R.types),pick("current_location_type","สถานที่ดำเนินงาน",R.locations),
      ...(current ? [] : [pick("status","สถานะเริ่มต้น", activeStatuses())]),["issue_description","อาการเสียที่แจ้ง","textarea",true]
    ],initial) + (current ? '<label class="field">เหตุผลการแก้ไข <em aria-label="จำเป็น">*</em><input name="edit_reason" required></label>' : '')) +
    fieldset("ข้อมูล In-House",fields(closed ? inHouseFields.filter(([key]) => key !== "returned_to_customer_at") : inHouseFields,initial),'id="in-house-fields"') +
    (closed ? fieldset("ข้อมูลปิดงาน",fields(closingFields.map(([key,label,type,,choices]) =>
      [key,label,type,key === "repair_completed_at" && Boolean(current.repair_completed_at),choices]),initial)) : '') +
    formFooter(current ? "บันทึกการแก้ไข" : "บันทึกงานซ่อม") + '</form>';
}
function syncRepairModels(form, selected = form.elements.model.value) {
  const brand = form.elements.brand.value;
  const model = form.elements.model;
  if (isOtherBrand(brand)) {
    if (model.tagName === "INPUT") model.value = selected;
    else model.outerHTML = '<input type="text" name="model" value="' + esc(selected) + '" required>';
    return;
  }
  const choices = options(brand ? machineChoices("model",brand) : {},selected,brand ? "เลือกรุ่น" : "เลือกยี่ห้อก่อน");
  if (model.tagName === "INPUT") {
    model.outerHTML = '<select name="model" required' + (brand ? '' : ' disabled') + '>' + choices + '</select>';
  } else {
    model.innerHTML = choices;
    model.disabled = !brand;
  }
}

function syncRepairSerial(form) {
  const machine = findMachineBySerial(state,form.elements.serial_number.value);
  if (!machine) return;
  const previous = state.machines.find(item => item.machine_id === form.dataset.suggestedMachine);
  const { brand, model } = form.elements;
  const matchesSuggestion = previous && brand.value === previous.brand && model.value === previous.model;
  if (!brand.value || matchesSuggestion) {
    brand.value = machine.brand;
    syncRepairModels(form,machine.model);
    form.dataset.suggestedMachine = machine.machine_id;
  } else if (brand.value === machine.brand && !model.value) {
    model.value = machine.model;
  }
}

function syncRepairLocation(form) {
  const inHouse = document.querySelector("#in-house-fields");
  inHouse.hidden = form.elements.current_location_type.value !== "IN_HOUSE";
  inHouse.disabled = inHouse.hidden;
}

const quoteImageTypes = "image/jpeg,image/png,image/webp";
const quoteImageMaxBytes = 1024 * 1024;
const quoteImageField = () => '<div class="quote-upload"><label class="field" for="quote-image">รูปใบเสนอราคา (ไม่บังคับ)</label>' +
  '<input id="quote-image" name="quote_image" type="file" accept="' + quoteImageTypes + '" aria-describedby="quote-image-help quote-image-status">' +
  '<p class="subtitle" id="quote-image-help">JPG, PNG หรือ WebP ขนาดไม่เกิน 1 MB</p>' +
  '<p class="quote-image-status" id="quote-image-status" role="status"></p>' +
  '<div class="quote-image-preview" hidden><img alt="ตัวอย่างรูปใบเสนอราคา"></div>' +
  '<button type="button" class="button compact" data-action="clear-quote-image" hidden>นำรูปออก</button>' +
  (canUploadQuoteToDrive() ? '<p class="subtitle">รูปจะถูกอัปโหลดไปยัง Google Drive เมื่อบันทึกใบเสนอราคา</p>' :
    '<p class="subtitle">โหมด Demo เก็บรูปในเบราว์เซอร์ ใช้ Web App ของ Apps Script สำหรับอัปโหลดไป Google Drive</p>') +
  (canChooseQuoteFolder() && !canUploadQuoteToDrive() ? '<div class="quote-folder"><button type="button" class="button compact" data-action="choose-quote-folder">เลือกโฟลเดอร์เก็บรูป</button> <small id="quote-folder-status">' +
    esc(quoteFolder ? quoteFolder.name + " / ปี / เดือน" : "รูปเก็บในเบราว์เซอร์ เลือกโฟลเดอร์เพื่อบันทึกสำเนาแยกตามปีและเดือน") + '</small></div>' : '') +
  '</div>';

const activityTabs = { progress:"ความคืบหน้า", visit:"เพิ่ม Visit", attempt:"เพิ่ม Attempt", transfer:"ย้ายสถานที่", quote:"เพิ่มใบเสนอราคา", close:"ปิดงาน" };
const jobSummary = job => [state.customers[job.customer_id],job.serial_number, [job.brand,job.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");

function updateJobResults() {
  const list = document.querySelector("#update-job-results");
  const count = document.querySelector("#update-job-count");
  const { query,scope } = adminFilters.update;
  const jobs = adminRows("update");
  count.textContent = !query.trim() && !scope ? "พิมพ์คำค้นหรือเลือกกลุ่มงาน" : jobs.length ? "พบ " + jobs.length + " งาน" : "ไม่พบงานซ่อมที่ตรงกับตัวกรอง";
  list.hidden = jobs.length === 0;
  list.innerHTML = jobs.map(job => '<button type="button" class="case" data-update="' + esc(job.repair_id) + '">' +
    '<span class="tile-icon teal">' + icon("briefcase") + '</span><span><strong>' + esc(job.srn) + '</strong><small>' +
    esc(jobSummary(job)) + '</small></span>' + badge(state.statuses[job.status],statusTone(job.status)) + '</button>').join("");
}

function updateForm(current) {
  const start = '<header class="section-head"><div><h2>บันทึกการดำเนินงาน</h2></div></header>';
  if (!current) return start + '<div class="job-search">' + adminSearchControls("update") +
    '<p id="update-job-count" class="subtitle" role="status"></p><div id="update-job-results" class="case-list job-results" role="region" aria-label="ผลการค้นหางานซ่อม" hidden></div></div>';
  const selected = '<div class="job-current"><div><strong id="update-job-title" tabindex="-1">' + esc(current.srn) + '</strong><p class="subtitle">' +
    esc(jobSummary(current)) + '</p></div>' + badge(state.statuses[current.status],statusTone(current.status)) +
    '<div class="data-actions"><button type="button" class="button" data-action="change-update-job">' + icon("search") + ' ค้นหางานอื่น</button>' +
    '<button type="button" class="button" data-open="' + esc(current.repair_id) + '">ดูรายละเอียดงาน</button>' +
    (current.status === "CLOSED" ? '<button type="button" class="button" data-edit="' + esc(current.repair_id) + '">แก้ไขงานที่ปิดแล้ว</button>' + reopenJobButton(current.repair_id) : '') + '</div></div>';
  if (current.status === "CLOSED") return start + selected;
  const choices = Object.fromEntries(current.visits.map(v => [v.visit_id,date(v.actual_visit_at || v.scheduled_visit_at) + " · " + v.site_location]));
  const reasonChoices = Object.fromEntries(R.reasons.map(reason => [reason,reason]));
  const definitions = {
    progress:[pick("status","สถานะ",activeStatuses()),["hold_reason","เหตุผลที่ติดขัด"],["next_action","ขั้นตอนถัดไป"],["note","บันทึกความคืบหน้า","textarea",true]],
    visit:[["scheduled_visit_at","วันนัดหมาย","date",true],["actual_visit_at","วันที่เข้าบริการจริง","date"],pick("visit_engineer_id","ช่างที่เข้าบริการ",state.engineers),pick("follow_up_required","ต้องเข้าซ้ำ",{yes:"ใช่",no:"ไม่"}),["next_visit_at","วันที่นัดครั้งถัดไป","date"],["visit_findings","ผลตรวจสอบ","textarea"]],
    attempt:[["attempt_at","วันที่ดำเนินการ","date",true],pick("engineer_id","ช่างผู้ดำเนินการ",state.engineers),pick("location_type","สถานที่",R.locations),pick("visit_id","เชื่อมกับ Visit",choices,false),pick("test_result","ผลทดสอบ",R.tests),["symptom_before","อาการก่อนซ่อม"],["parts_replaced","อะไหล่ที่เปลี่ยน"],["remaining_symptom","อาการที่ยังพบ"],pick("failure_reason","สาเหตุที่ไม่สำเร็จ",reasonChoices,false),["failure_note","รายละเอียดสาเหตุอื่น ๆ"],["actions_taken","งานที่ดำเนินการ","textarea",true],["next_action","แผนถัดไป"],pick("next_owner_id","ผู้รับผิดชอบขั้นตอนถัดไป",state.engineers,false)],
    transfer:[pick("current_location_type","สถานที่ดำเนินงานใหม่",R.locations),["note","เหตุผลการย้าย","textarea",true]],

    quote:[["quotation_number","เลขใบเสนอราคา","text"],["quoted_at","วันที่เสนอราคา","date"],["quoted_amount_thb","จำนวนเงิน (บาท)","number",true],["quotation_status","สถานะใบเสนอราคา"],["decision_at","วันที่ตัดสินใจ","date"],["rejection_reason","เหตุผลที่ปฏิเสธ"]],
    close:closingFields
  };
  const unnamedQuotes = activity === "quote" ? current.quotes.filter(quote => !quote.quotation_number) : [];
  const pendingNumbers = unnamedQuotes.length ? records("ใบเสนอราคาที่ยังไม่ระบุเลข",unnamedQuotes,quote =>
    quoteRecord(quote,current.repair_id) + '<button type="button" class="button compact quote-number-trigger" data-fill-quote-number="' + esc(quote.quotation_id) +
    '" data-repair="' + esc(current.repair_id) + '">' + icon("edit") + ' กรอกเลขใบเสนอราคา</button>') : "";
  const defaults = { ...current, attempt_at:R.today, scheduled_visit_at:R.today, visit_engineer_id:current.assigned_engineer_id, engineer_id:current.assigned_engineer_id, location_type:current.current_location_type, closed_at:R.today, follow_up_required:"no" };
  return start + selected + '<div class="segment admin-nav" aria-label="ประเภทการบันทึก">' +
    Object.entries(activityTabs).map(([key,label]) => toggle("activity",key,label,activity === key,"plus")).join("") + '</div><form data-form="activity">' +
    fields(definitions[activity], defaults).replace('name="quoted_amount_thb"', 'name="quoted_amount_thb" step="0.01"').replace('step="0.01" value="" min="1"', 'step="0.01" value="" min="0"') +
    (activity === "quote" ? quoteImageField() : "") +
    formFooter(activity === "close" ? "ยืนยันปิดงาน" : "บันทึก") + '</form>' + pendingNumbers;
}
function settingsForm() {
  return '<header class="section-head"><div><h2>ข้อมูลหลักและตั้งค่า</h2><p>' + (isLiveDatabase() ? "การตั้งค่าใช้กับผู้ใช้ฐานข้อมูลนี้" : "ใช้กับข้อมูลสาธิตในเบราว์เซอร์นี้") + '</p></div></header>' +
    '<form data-form="thresholds">' + fieldset("เกณฑ์แจ้งเตือนตามจำนวนครั้งที่ซ่อมไม่ผ่าน", fields([["watch","เฝ้าระวัง","number",true],["repeated","ซ่อมไม่สำเร็จหลายครั้ง","number",true],["manager","ผู้จัดการตรวจสอบ","number",true],["critical","ติดตามเร่งด่วน","number",true]],state.settings)) + formFooter("บันทึกเกณฑ์") + '</form>' +
    '<section class="detail-section"><h3>สถานะงาน</h3><form data-form="status-label">' + fields([pick("code","สถานะ",state.statuses),["label","ชื่อแสดงผล","text",true]]) + formFooter("บันทึกชื่อสถานะ") + '</form></section>' +
    '<section class="detail-section"><h3>ช่างผู้รับผิดชอบ</h3><p class="subtitle">' + esc(Object.values(state.engineers).join(" · ")) + '</p><form data-form="engineer">' + fields([["name","ชื่อช่าง","text",true]]) + formFooter("เพิ่มช่าง") + '</form></section>' +
    '<section class="detail-section"><h3>ลูกค้า</h3><form data-form="customer">' + fields([["name","ชื่อลูกค้า","text",true]]) + formFooter("เพิ่มลูกค้า") + '</form></section>' +
    '<section class="detail-section"><h3>ยี่ห้อ รุ่น และเครื่อง</h3><p class="subtitle">' + esc([...new Set(state.machines.map(m => m.brand + " " + m.model))].join(" · ")) + '</p><form data-form="machine">' +
    fields([pick("customer_id","ลูกค้า",state.customers),["brand","ยี่ห้อ","text",true],["model","รุ่น","text",true],["serial_number","Serial Number","text",true]]) + formFooter("เพิ่มเครื่อง") + '</form></section>';
}
