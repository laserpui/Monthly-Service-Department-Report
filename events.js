"use strict";

function monthSummary() {
  openDialog("สถิติการรับแจ้ง", "ตารางรายเดือน", exportButton("monthly") + '<div class="table-scroll" tabindex="0"><table><thead><tr><th scope="col">เดือน</th><th scope="col">In-House</th><th scope="col">On-Site</th><th scope="col">รวม</th></tr></thead><tbody>' +
    monthlyTotals().map(row => '<tr><td><div class="row-copy"><button class="text-button" data-month="' + row.month + '">' + monthLabel(row.month) + '</button>' +
      copyItemButton("คัดลอกยอดเดือน " + monthLabel(row.month),[monthLabel(row.month),"In-House " + row.in_house,"On-Site " + row.on_site,"รวม " + row.total].join("\n"),true) + '</div></td><td>' + row.in_house + '</td><td>' + row.on_site + '</td><td>' + row.total + '</td></tr>').join("") + '</tbody></table></div>');
}
function monthDetail(month) {
  const rows = monthlyRepairs(month);
  openDialog("งานที่รับแจ้งรายเดือน",monthLabel(month) + " · " + rows.length + " งาน",'<div class="data-actions"><button class="button compact" data-action="month-summary">ตารางรายเดือน</button>' + exportButton("month",month) + '</div>' +
    records("รายการรับแจ้งซ่อม",rows,row => '<button class="text-button" data-open="' + esc(row.repair_id) + '">' + esc(row.srn) + '</button><p>' + esc(row.repair_id + " · " + state.customers[row.customer_id] + " · " + R.types[row.initial_service_type]) + '</p>'));
}
function clearFilters() {
  Object.keys(filters).forEach(key => { filters[key] = ""; });
  tablePage = 1;
}
function commit(form, next, message) {
  try {
    R.save(next);
  } catch {
    throw new Error("บันทึกไม่ได้ กรุณาตรวจสอบพื้นที่จัดเก็บของเบราว์เซอร์");
  }
  state = next;
  if (dialog.open) dialog.close();
  render();
  notify(message);
}
function requireRule(condition, message) {
  if (!condition) throw new Error(message);
}
function copyState() {
  return JSON.parse(JSON.stringify(state));
}

function openReopenRepair(id) {
  const row = findRepair(id);
  if (row?.status !== "CLOSED") return;
  const statuses = activeStatuses();
  const closing = [...row.history].reverse().find(entry => entry.event_type === "ปิดงาน" && entry.new_value === "CLOSED");
  const status = Object.hasOwn(statuses,closing?.old_value) ? closing.old_value : "PENDING_INSPECTION";
  openDialog("จัดการงานซ่อม","ยืนยันเปิดงานอีกครั้ง",
    '<p class="subtitle">' + esc(row.srn) + ' จะกลับมาบันทึกข้อมูลได้ และระบบจะเก็บข้อมูลการปิดครั้งเดิมไว้ในประวัติ</p>' +
    '<form data-form="reopen" data-repair="' + esc(id) + '" data-updated-at="' + esc(row.updated_at || "") + '">' +
    fields([pick("status","สถานะหลังเปิดงาน",statuses)],{status}) +
    '<p class="error" role="alert" hidden></p><div class="actions">' +
    '<button type="button" class="button" data-action="cancel-reopen">ยกเลิก</button>' +
    '<button type="submit" class="button primary">' + icon("check") + ' ยืนยันเปิดงานอีกครั้ง</button></div></form>');
}

function saveReopenedRepair(form,values) {
  const next = copyState();
  const row = next.repairs.find(job => job.repair_id === form.dataset.repair);
  requireRule(row?.status === "CLOSED","กรุณาเลือกงานที่ปิดแล้ว");
  requireRule((row.updated_at || "") === form.dataset.updatedAt,"งานนี้มีการเปลี่ยนแปลง กรุณาเปิดหน้าต่างยืนยันใหม่");
  requireRule(Object.hasOwn(activeStatuses(),values.status),"กรุณาเลือกสถานะหลังเปิดงาน");
  const closureFields = ["closed_at","repair_completed_at","test_result","final_outcome","close_note","service_report_url"];
  const previous = Object.fromEntries(closureFields.map(key => [key,row[key] ?? ""]));
  const entry = R.history("เปิดงานอีกครั้ง","กลับมาดำเนินการต่อ",JSON.stringify({status:row.status,...previous,returned_to_customer_at:row.returned_to_customer_at || ""}),values.status);
  row.history.push(entry);
  closureFields.forEach(key => { row[key] = ""; });
  row.status = values.status;
  row.updated_at = entry.occurred_at;
  showReopenedAdminRepair(row.repair_id);
  commit(form,next,"เปิดงานอีกครั้งแล้ว");
}

const quoteImages = new WeakMap();

async function updateQuoteImage(input) {
  const file = input.files[0];
  const form = input.form;
  const status = form.querySelector("#quote-image-status");
  const preview = form.querySelector(".quote-image-preview");
  const picture = preview.querySelector("img");
  const remove = form.querySelector('[data-action="clear-quote-image"]');

  quoteImages.delete(input);
  preview.hidden = true;
  picture.removeAttribute("src");
  remove.hidden = !file;
  status.textContent = "";
  status.classList.remove("error");
  input.setCustomValidity("");
  if (!file) return;
  input.setCustomValidity("กำลังเตรียมรูปใบเสนอราคา");
  status.textContent = "กำลังเตรียมรูป…";

  try {
    requireRule(quoteImageTypes.split(",").includes(file.type), "กรุณาเลือกรูป JPG, PNG หรือ WebP");
    requireRule(file.size > 0 && file.size <= quoteImageMaxBytes, "รูปต้องมีขนาดไม่เกิน 1 MB และมีข้อมูล");
    const source = await new Promise((resolve,reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("อ่านไฟล์รูปไม่ได้ กรุณาเลือกไฟล์อีกครั้ง"));
      reader.readAsDataURL(file);
    });
    requireRule(isQuoteImage(source), "รูปแบบไฟล์ไม่ถูกต้อง");
    const image = new Image();
    image.src = source;
    await image.decode().catch(() => { throw new Error("เปิดรูปไม่ได้ กรุณาเลือกไฟล์รูปที่สมบูรณ์"); });
    if (!input.isConnected || input.files[0] !== file) return;
    quoteImages.set(input,{ file, data:source });
    picture.src = source;
    preview.hidden = false;
    status.textContent = file.name;
    input.setCustomValidity("");
  } catch (error) {
    if (!input.isConnected || input.files[0] !== file) return;
    status.textContent = error.message;
    status.classList.add("error");
    input.setCustomValidity(error.message);
  }
}

function validateUrl(value) {
  if (!value) return;
  let url;
  try { url = new URL(value); } catch {}
  requireRule(url && ["https:","http:"].includes(url.protocol), "ลิงก์เอกสารต้องขึ้นต้นด้วย https:// หรือ http://");
}
function saveRepair(form, values) {
  const next = copyState();
  const editing = adminTab === "edit";
  const current = editing ? next.repairs.find(row => row.repair_id === selectedId) : null;
  requireRule(values.reported_at <= R.today, "วันที่รับแจ้งต้องไม่เกินวันนี้");
  requireRule(!values.due_date || values.due_date >= values.reported_at, "กำหนดเสร็จต้องไม่ก่อนวันที่รับแจ้ง");
  if (current?.status === "CLOSED") {
    const completion = values.repair_completed_at ?? current.repair_completed_at;
    requireRule(!current.repair_completed_at || completion, "กรุณาระบุวันที่ซ่อมเสร็จ");
    if (completion) validateRepairCompletion(completion,values.reported_at);
    else requireRule(!R.closedDay(current) || values.reported_at <= R.closedDay(current), "วันที่รับแจ้งต้องไม่หลังวันปิดงาน");
  }
  requireRule(!next.repairs.some(row => row.repair_id !== current?.repair_id && row.srn.toLowerCase() === values.srn.toLowerCase()), "เลขที่ SRN นี้มีอยู่แล้ว");
  const customerName = values.customer_name?.trim();
  const serial = values.serial_number?.trim() || "";
  const { brand, model } = values;
  requireRule(customerName, "กรุณากรอกชื่อลูกค้า");
  const assigned_engineer_id = values.assigned_engineer_id ?? current?.assigned_engineer_id ?? "";
  const secondary_engineer_id = values.secondary_engineer_id ?? current?.secondary_engineer_id ?? "";
  requireRule([assigned_engineer_id,secondary_engineer_id].every(id => !id || Object.hasOwn(next.engineers,id)), "กรุณาเลือกช่างผู้รับผิดชอบจากรายการ");
  requireRule(!secondary_engineer_id || assigned_engineer_id, "กรุณาเลือกช่างผู้รับผิดชอบคนแรกก่อน");
  requireRule(!secondary_engineer_id || secondary_engineer_id !== assigned_engineer_id, "ช่างผู้รับผิดชอบทั้งสองคนต้องเป็นคนละคน");
  requireRule(brand && model?.trim() && (isOtherBrand(brand) || Object.hasOwn(machineChoices("model",brand),model)), "กรุณาระบุยี่ห้อและรุ่นของเครื่อง");
  String(values.attachments || "").split(/\s+/).filter(Boolean).forEach(validateUrl);

  const existingMachine = !serial ? null : current && lookupKey(current.serial_number) === lookupKey(serial)
    ? next.machines.find(machine => machine.machine_id === current.machine_id) || findMachineBySerial(next,serial)
    : findMachineBySerial(next,serial);
  const customers = Object.entries(next.customers).filter(([,name]) => lookupKey(name) === lookupKey(customerName));
  const existingCustomer = customers.find(([id]) => id === existingMachine?.customer_id)
    || customers.find(([id]) => id === current?.customer_id) || customers[0];
  const customer_id = existingCustomer?.[0] || "CUS-" + R.id();
  requireRule(!existingMachine || existingMachine.customer_id === customer_id, "Serial Number นี้อยู่ในข้อมูลของลูกค้ารายอื่น กรุณาตรวจสอบชื่อลูกค้า");

  if (!existingCustomer) next.customers[customer_id] = customerName;
  const machine_id = serial ? existingMachine?.machine_id || "MCH-" + R.id() : "";
  const serial_number = existingMachine && machine_id === current?.machine_id ? current.serial_number : existingMachine?.serial_number || serial;
  if (serial && !existingMachine) next.machines.push({ machine_id, customer_id, brand, model, serial_number });

  const now = new Date().toISOString();
  const { edit_reason, customer_name, status, closed_at, ...changes } = values;
  if (current?.status === "CLOSED") validateUrl(changes.service_report_url);
  const data = { ...changes, ...(!editing ? {status} : {}), customer_id, machine_id, serial_number, assigned_engineer_id, secondary_engineer_id, updated_at:now };
  if (current) {
    const keys = Object.keys(data).filter(key => key !== "updated_at" && String(current[key] ?? "") !== String(data[key] ?? ""));
    if (keys.includes("current_location_type")) current.history.push(R.history("ย้ายสถานที่",edit_reason,current.current_location_type,data.current_location_type));
    const oldValues = Object.fromEntries(keys.map(key => [key,current[key] ?? ""]));
    const newValues = Object.fromEntries(keys.map(key => [key,data[key] ?? ""]));
    current.history.push(R.history("แก้ไขข้อมูลงาน",edit_reason,JSON.stringify(oldValues),JSON.stringify(newValues)));
    Object.assign(current,data);
  } else {
    const year = R.today.slice(0,4);
    const number = next.repairs.reduce((maximum,row) => row.repair_id.startsWith("REP-" + year + "-") ? Math.max(maximum,Number(row.repair_id.split("-")[2])) : maximum, 0) + 1;
    next.repairs.push({ ...data, repair_id:"REP-" + year + "-" + String(number).padStart(5,"0"), created_at:now, history:[R.history("เปิดงาน","รับแจ้งซ่อม","",data.status)], attempts:[], visits:[], quotes:[], parts:[] });
  }
  showSavedAdminRepair(values.srn);
  commit(form,next,editing ? "บันทึกการแก้ไขแล้ว" : "เปิดงานซ่อมแล้ว");
}
function validateRepairCompletion(completion, reported) {
  requireRule(completion && completion >= R.bangkokDay(reported) && completion <= R.today, "วันที่ซ่อมเสร็จต้องอยู่ระหว่างวันที่รับแจ้งถึงวันนี้");
}

function saveActivity(form, values) {
  const next = copyState();
  const row = next.repairs.find(item => item.repair_id === selectedId);
  requireRule(row && R.active(row), "กรุณาเลือกงานที่ยังเปิดอยู่");
  let entry;
  let savedQuote;
  if (activity === "progress") {
    entry = R.history(values.status === row.status ? "บันทึกความคืบหน้า" : "เปลี่ยนสถานะ",values.note,row.status,values.status);
    const { note, ...changes } = values;
    Object.assign(row,changes);
  } else if (activity === "visit") {
    requireRule(values.follow_up_required !== "yes" || values.next_visit_at, "ระบุวันนัดครั้งต่อไปเมื่อเลือกว่าต้องเข้าซ้ำ");
    const location = values.site_location?.trim() || R.locations[row.current_location_type] || "ไม่ระบุสถานที่";
    row.visits.push({ ...values, site_location:location, visit_id:R.id(), repair_id:row.repair_id, follow_up_required:values.follow_up_required === "yes" });
    entry = R.history("เพิ่มการเข้าบริการ",location + " · " + date(values.scheduled_visit_at));
  } else if (activity === "attempt") {
    requireRule(values.test_result !== "FAIL" || values.failure_reason, "ระบุสาเหตุที่ซ่อมไม่สำเร็จ");
    requireRule(values.failure_reason !== "อื่น ๆ" || values.failure_note, "ระบุรายละเอียดสาเหตุอื่น ๆ");
    const attempt_no = row.attempts.length + 1;
    row.attempts.push({ ...values, attempt_id:R.id(), repair_id:row.repair_id, attempt_no, created_at:new Date().toISOString(), created_by:"Admin Demo" });
    entry = R.history("เพิ่มรอบการซ่อม","ครั้งที่ " + attempt_no + " · " + R.tests[values.test_result] + "\n" + values.actions_taken);
  } else if (activity === "transfer") {
    requireRule(values.current_location_type !== row.current_location_type, "กรุณาเลือกสถานที่ใหม่");
    entry = R.history("ย้ายสถานที่",values.note,row.current_location_type,values.current_location_type);
    row.current_location_type = values.current_location_type;

  } else if (activity === "quote") {
    savedQuote = { ...values, repair_id:row.repair_id, quotation_id:R.id() };
    if (savedQuote.image_data_url) {
      savedQuote.image_attached_at = new Date().toISOString();
      savedQuote.image_archive_label = savedQuote.quotation_number || "quotation";
      savedQuote.image_drive_srn = row.srn;
      savedQuote.image_drive_customer = next.customers[row.customer_id];
    }
    row.quotes.push(savedQuote);
    entry = R.history("เพิ่มใบเสนอราคา",quotationLabel(savedQuote));
  } else if (activity === "close") {
    validateRepairCompletion(values.repair_completed_at,row.reported_at);
    validateUrl(values.service_report_url);
    entry = R.history("ปิดงาน",values.close_note,row.status,"CLOSED");
    Object.assign(row,values,{ status:"CLOSED", closed_at:new Date().toISOString() });
  }
  row.history.push(entry);
  row.updated_at = entry.occurred_at;
  activity = savedQuote && !savedQuote.quotation_number ? "quote" : "progress";
  commit(form,next,"บันทึกการดำเนินงานแล้ว");
  return savedQuote;
}
function openQuoteNumber(repairId,quoteId) {
  const row = findRepair(repairId);
  const quote = row?.quotes.find(item => item.quotation_id === quoteId);
  if (!row || !R.active(row) || !quote || quote.quotation_number) return;
  openDialog("ใบเสนอราคา", "กรอกเลขใบเสนอราคา",
    '<p class="subtitle">' + esc([row.srn,quote.quoted_at ? date(quote.quoted_at) : "",quoteCurrency.format(quote.quoted_amount_thb)].filter(Boolean).join(" · ")) + '</p>' +
    '<form class="quote-number-form" data-form="quote-number" data-repair="' + esc(repairId) + '" data-key="' + esc(quoteId) + '">' +
    fields([["quotation_number","เลขใบเสนอราคา","text",true]]) + formFooter("บันทึกเลขใบเสนอราคา") + '</form>');
}

function saveQuoteNumber(form, values) {
  const next = copyState();
  const row = next.repairs.find(item => item.repair_id === form.dataset.repair);
  const quote = row?.quotes.find(item => item.quotation_id === form.dataset.key);
  requireRule(row && R.active(row) && quote && !quote.quotation_number, "ไม่พบใบเสนอราคาที่ยังรอเลขในงานที่เปิดอยู่");
  const number = values.quotation_number?.trim();
  requireRule(number, "กรุณากรอกเลขใบเสนอราคา");
  if (quote.image_data_url && quote.image_archive_label === undefined) quote.image_archive_label = "file";
  quote.quotation_number = number;
  const entry = R.history("กรอกเลขใบเสนอราคา",number);
  row.history.push(entry);
  row.updated_at = entry.occurred_at;
  commit(form,next,"บันทึกเลขใบเสนอราคาแล้ว");
}

function saveSettings(form, values) {
  const next = copyState();
  if (form.dataset.form === "thresholds") {
    const keys = ["watch","repeated","manager","critical"];
    const levels = keys.map(key => +values[key]);
    requireRule(levels.every((level,index) => Number.isSafeInteger(level) && level > (levels[index - 1] || 0)), "กำหนดเกณฑ์เป็นจำนวนเต็มและเรียงจากน้อยไปมาก");
    next.settings = Object.fromEntries(keys.map((key,index) => [key,levels[index]]));
  } else if (form.dataset.form === "status-label") {
    next.statuses[values.code] = values.label;
  } else if (form.dataset.form === "engineer") {
    next.engineers["TEC-" + R.id()] = values.name;
  } else if (form.dataset.form === "customer") {
    next.customers["CUS-" + R.id()] = values.name;
  } else if (form.dataset.form === "machine") {
    requireRule(!next.machines.some(m => m.serial_number.toLowerCase() === values.serial_number.toLowerCase()), "Serial Number นี้มีอยู่แล้ว");
    next.machines.push({ ...values, machine_id:"MCH-" + R.id() });
  }
  commit(form,next,"บันทึกข้อมูลหลักแล้ว");
}

document.addEventListener("click", event => {
  const target = event.target.closest("button, a, [data-open]");
  if (!target) return;
  const action = target.dataset;
  if (action.action === "reload-live-data") return loadLiveDatabase();
  if (action.exportView) {
    const report = getReport(action.exportView,action.key);
    if (!report) return;
    downloadBlob(new Blob([csvText(report.rows)],{type:"text/csv;charset=utf-8"}),safeFilename(report.name) + "-" + R.today + ".csv");
    return notify("ส่งออก CSV แล้ว");
  }
  if (Object.hasOwn(action,"copyItem")) {
    if (Object.hasOwn(action,"copyText")) return copyText(action.copyText);
    const content = target.closest(".copyable-item").querySelector(".copy-content");
    return copyText((content.querySelector(".record-text") || content).innerText);
  }
  if (action.fillQuoteNumber) return openQuoteNumber(action.repair,action.fillQuoteNumber);
  if (action.quoteImage) return openQuoteImage(action.key,action.quoteImage);
  if (action.uploadQuote) return uploadQuoteToDrive(action.repair,action.uploadQuote);
  if (action.archiveQuote) {
    const quote = findRepair(action.key)?.quotes.find(quote => quote.quotation_id === action.archiveQuote);
    return saveQuoteImageToFolder(quote,true);
  }
  if (action.action === "choose-quote-folder") return chooseQuoteFolder();
  if (action.reopenJob) return openReopenRepair(action.reopenJob);
  if (action.action === "cancel-reopen") return dialog.close();
  if (action.action === "change-update-job") {
    selectedId = "";
    resetAdminFilters("update");
    activity = "progress";
    render();
    document.querySelector("#update-job-query").focus();
    return;
  }
  if (action.action === "reset-admin-filters") {
    resetAdminFilters(adminTab);
    render();
    document.querySelector('[data-admin-filter="query"]')?.focus({preventScroll:true});
    return;
  }
  if (action.adminPage) {
    adminPage = Number(action.adminPage);
    adminResults();
    (document.querySelector('[data-admin-page]:not(:disabled)') || document.querySelector("#admin-query"))?.focus({preventScroll:true});
    return;
  }
  if (action.action === "clear-quote-image") {
    const input = target.form.elements.quote_image;
    input.value = "";
    updateQuoteImage(input);
    input.focus();
    return;
  }
  if (action.open) return detail(action.open);
  if (action.month) return monthDetail(action.month);
  if (action.action === "month-summary") return monthSummary();
  if (action.action === "chart-range") {
    return openDialog("จำนวนการแจ้งซ่อมรายเดือน","เลือกช่วงเดือน",'<form data-form="chart">' + fields([["start","เริ่มเดือน","month",true],["end","ถึงเดือน","month",true]],chart) + formFooter("ใช้ช่วงเดือน") + '</form>');
  }
  if (action.metric || action.dashboardStatus) {
    clearFilters();
    filters.status = action.dashboardStatus || (action.metric === "closed" ? "CLOSED" : "");
    if (Object.hasOwn(flagChecks,action.metric)) filters.flag = action.metric;
    render();
    document.querySelector("#repair-list h2")?.focus();
    return;
  }
  if (action.action === "clear-filters") {
    clearFilters();
    render();
    document.querySelector('[data-filter="query"]')?.focus({preventScroll:true});
  } else if (action.page) {
    tablePage = +action.page;
    table();
    (document.querySelector('[data-page]:not(:disabled)') || document.querySelector('[data-filter="query"]'))?.focus({ preventScroll:true });
  } else if (action.adminTab || action.edit || action.update || action.activity) {
    if (action.adminTab) adminTab = action.adminTab;
    if (action.edit || action.update) {
      selectedId = action.edit || action.update;
      adminTab = action.edit ? "edit" : "update";
      activity = "progress";
    }
    if (action.activity) activity = action.activity;
    render();
    if (action.edit) document.querySelector("#repair-form-title")?.focus();
    if (action.update) document.querySelector("#update-job-title")?.focus();
  }
});
document.addEventListener("change", event => {
  const field = event.target;
  if (field.name === "quote_image") return updateQuoteImage(field);
  if (field.dataset.adminFilter && field.dataset.adminFilter !== "query") setAdminFilter(field.dataset.adminFilter,field.value);
  if (field.dataset.filter && field.dataset.filter !== "query") {
    filters[field.dataset.filter] = field.value;
    tablePage = 1;
    table();
  }
  if (field.id === "chart-type") {
    chart.type = field.value;
    document.querySelector("#monthly-panel").innerHTML = monthlyPanel();
    document.querySelector("#chart-type").focus();
  }
  if (field.form?.dataset.form === "repair") {
    if (field.name === "initial_service_type" && adminTab === "new") field.form.elements.current_location_type.value = field.value;
    if (field.name === "brand") {
      delete field.form.dataset.suggestedMachine;
      syncRepairModels(field.form,"");
    }
    if (field.name === "serial_number") syncRepairSerial(field.form);
    if (["current_location_type","initial_service_type"].includes(field.name)) syncRepairLocation(field.form);
  }
});
document.addEventListener("input", event => {
  if (event.target.dataset.filter === "query") {
    filters.query = event.target.value;
    tablePage = 1;
    table();
  }
  if (event.target.dataset.adminFilter === "query") setAdminFilter("query",event.target.value);
  if (event.target.form?.querySelector(".error")) event.target.form.querySelector(".error").hidden = true;
});
document.addEventListener("submit", event => {
  const form = event.target;
  if (!form.dataset.form) return;
  event.preventDefault();
  if (!form.isConnected) return;
  const error = form.querySelector(".error");
  const values = Object.fromEntries([...new FormData(form)]
    .filter(([,value]) => typeof value === "string")
    .map(([key,value]) => [key,value.trim()]));
  try {
    requireRule(Array.from(form.querySelectorAll("[required]:not(:disabled)")).every(field => values[field.name]), "กรุณากรอกข้อมูลที่จำเป็นให้ครบ");
    if (form.dataset.form === "chart") {
      requireRule(values.start <= values.end && values.end <= R.month && values.end <= R.shiftMonth(values.start,23), "เลือกช่วงไม่เกิน 24 เดือน และสิ้นสุดไม่เกินเดือนปัจจุบัน");
      Object.assign(chart,values);
      dialog.close();
      document.querySelector("#monthly-panel").innerHTML = monthlyPanel();
      document.querySelector('[data-action="chart-range"]').focus();
      return;
    }
    if (form.dataset.form === "activity") {
      const input = form.elements.quote_image;
      const file = input?.files[0];
      if (file) {
        const attachment = quoteImages.get(input);
        requireRule(attachment?.file === file, "กรุณารอให้รูปตัวอย่างแสดงก่อนบันทึก");
        values.image_name = file.name;
        values.image_data_url = attachment.data;
      }
    }
    if (isLiveDatabase()) return saveLiveForm(form,values);
    if (form.dataset.form === "repair") saveRepair(form,values);
    else if (form.dataset.form === "reopen") saveReopenedRepair(form,values);
    else if (form.dataset.form === "quote-number") saveQuoteNumber(form,values);
    else if (form.dataset.form === "activity") {
      const savedQuote = saveActivity(form,values);
      if (savedQuote?.image_data_url) {
        if (canUploadQuoteToDrive()) uploadQuoteToDrive(savedQuote.repair_id,savedQuote.quotation_id);
        else saveQuoteImageToFolder(savedQuote);
      }
    } else saveSettings(form,values);
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  }
});
