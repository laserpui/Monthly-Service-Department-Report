"use strict";

const monthsShort = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const monthLabel = key => monthsShort[Number(key.slice(5)) - 1] + " " + key.slice(0, 4);
const waiting = ["WAITING_PARTS","WAITING_FACTORY","WAITING_CUSTOMER_APPROVAL"];
const filters = { query: "", location: "", status: "", flag: "", quoteScope: "", assignment: "", quoteNumber: "", from: "", to: "" };
let tablePage = 1;
const chart = { start: R.shiftMonth(R.month, -11), end: R.month, type: "" };
const isQuotationJob = repair => repair.status === "WAITING_CUSTOMER_APPROVAL" || repair.quotes?.length > 0;
const repairingStatuses = ["INSPECTING","REPAIRING","WAITING_PARTS","WAITING_FACTORY","WAITING_TEST","REPAIR_FAILED"];
const repairSections = {
  "#repairs": { title:"งานรอตรวจสอบ", description:"รายการที่รับแจ้งแล้วและรอเริ่มตรวจสอบ", statuses:["PENDING_INSPECTION"],
    matches:repair => repair.status === "PENDING_INSPECTION" },
  "#in-progress": { title:"อยู่ระหว่างซ่อม", description:"งานที่เริ่มดำเนินการและยังซ่อมไม่เสร็จ", statuses:repairingStatuses,
    matches:repair => repairingStatuses.includes(repair.status) && !isQuotationJob(repair) },
  "#quotations": { title:"เสนอราคา", description:"ใบเสนอราคาและงานรอลูกค้าอนุมัติ เฉพาะงานที่ยังไม่ปิด",
    matches:isQuotationJob }
};
const dashboardSection = (hash = location.hash) => repairSections[hash];
const isQuotationView = () => location.hash === "#quotations";
const isRepairQueue = () => location.hash === "#in-progress";
const hasDateRange = () => Boolean(filters.from || filters.to);
const quotationJobScope = () => filters.quoteScope || (hasDateRange() ? "all" : "open");
const byRisk = (a, b) => R.failed(b) - R.failed(a) || Number(R.overdue(b)) - Number(R.overdue(a)) || R.age(b) - R.age(a);
const isSpecial = row => R.failed(row) >= state.settings.repeated || R.overdue(row) || R.age(row) > 30;
const statusTone = status => Object.hasOwn(R.statuses,status) ? "status-" + status.toLowerCase().replaceAll("_","-") : "neutral";
const flagChecks = {
  active:R.active, overdue:R.overdue,
  waiting:r => waiting.includes(r.status), special:r => R.active(r) && isSpecial(r),
  "active-repeated":r => R.active(r) && R.failed(r) >= state.settings.repeated
};
const flagLabels = {active:"งานซ่อมคงค้าง",overdue:"เกินกำหนด",waiting:"งานที่รอ",special:"งานที่ต้องติดตาม","active-repeated":"งานเปิดที่ซ่อมไม่ผ่านหลายครั้ง"};

function dashboard() {
  const total = state.repairs.length;
  const active = state.repairs.filter(R.active);
  const count = condition => active.filter(condition).length;
  const repeated = count(row => R.failed(row) >= state.settings.repeated);
  const metrics = [
    ["งานซ่อมทั้งหมด", total, "list", "teal", "รวมทุกสถานะ", "all"],
    ["งานซ่อมคงค้าง", active.length, "briefcase", "teal", "In-House " + count(r => r.current_location_type === "IN_HOUSE") + " · On-Site " + count(r => r.current_location_type === "ON_SITE"), "active"],
    ["ปิดงานแล้ว", total - active.length, "check", "teal", "ดูรายการที่ปิดงาน", "closed"],
    ["เกินกำหนด", count(R.overdue), "clock", "amber", "ค้างเกิน 30 วัน " + count(r => R.age(r) > 30) + " งาน", "overdue"],
    ["งานที่รอ", count(r => waiting.includes(r.status)), "hourglass", "blue", "อะไหล่ " + count(r => r.status === waiting[0]) + " · โรงงาน " + count(r => r.status === waiting[1]) + " · อนุมัติ " + count(r => r.status === waiting[2]), "waiting"],
    ["ซ่อมไม่สำเร็จหลายครั้ง", repeated, "triangle", "rose", "งานเปิดที่ซ่อมไม่ผ่านตั้งแต่ " + state.settings.repeated + " ครั้ง", "active-repeated"]
  ];
  const follow = active.filter(isSpecial).sort(byRisk);
  return '<header class="hero"><div><h1>ติดตามงานซ่อม</h1><p class="subtitle">ภาพรวมงานซ่อมทุกสถานะ แนวโน้มการรับแจ้ง และงานที่ต้องติดตาม</p></div></header>' +
    (portalAvailable() ? '<nav class="portal-shortcuts" aria-label="ข้อมูลฝ่ายบริการ">' +
      Array.from(portalModules, ([route, module]) =>
        '<a class="button" href="#' + route + '">' + icon(module.icon) + esc(module.title) + icon("chevron") + '</a>').join("") + '</nav>' : "") +
    '<div class="dashboard-overview"><section class="panel dashboard-summary"><header class="section-head"><h2 class="icon-title">' + icon("briefcase") + ' สรุปงานซ่อม</h2></header>' +
    '<div class="metrics">' + metrics.map(([name, count, symbol, color, detail, flag]) =>
      '<button class="metric" data-metric="' + flag + '"><div class="metric-row"><span class="metric-label">' + name + '</span><span class="tile-icon ' + color + '">' + icon(symbol) + '</span></div><div class="metric-value"><strong>' + count + '</strong><span>งาน</span></div><small>' + detail + '</small></button>').join("") + '</div></section>' +
    '<section class="panel" id="monthly-panel">' + monthlyPanel() + '</section></div>' + dashboardStatuses(total) +
    '<section class="panel dashboard-follow"><header class="section-head"><div><h2 class="icon-title">' + icon("bell") + ' งานที่ต้องติดตาม</h2><p>งานเกินกำหนด ค้างนาน หรือซ่อมหลายครั้ง</p></div>' +
    '<div class="data-actions"><span class="badge rose">' + follow.length + ' งาน</span><button class="button compact" data-metric="special">ดูงานที่ต้องติดตามทั้งหมด</button></div></header><div class="case-list">' +
    (follow.slice(0, 3).map(row => '<button class="case" data-open="' + esc(row.repair_id) + '"><span class="tile-icon rose">' + icon("triangle") + '</span><span><strong>' + esc(row.srn) + '</strong><small>' + esc(row.brand + " " + row.model) + '</small></span><span class="case-count">' + (R.failed(row) >= state.settings.repeated ? 'ไม่ผ่าน ' + R.failed(row) + ' ครั้ง' : R.overdue(row) ? 'เกินกำหนด' : 'ค้าง ' + R.age(row) + ' วัน') + '</span></button>').join("") || '<p class="empty">ไม่มีงานที่ต้องติดตามเป็นพิเศษ</p>') +
    '</div></section>' + repairList("งานซ่อมทั้งหมด");
}

function dashboardStatuses(total) {
  const counts = new Map();
  state.repairs.forEach(row => counts.set(row.status,(counts.get(row.status) || 0) + 1));
  return '<section class="panel dashboard-status"><header class="section-head"><div><h2>งานตามสถานะ</h2><p>เลือกสถานะเพื่อดูรายการงานซ่อม</p></div></header><div class="status-grid">' +
    Object.entries(state.statuses).map(([status,label]) => {
      const count = counts.get(status) || 0;
      return '<button type="button" class="status-card ' + statusTone(status) + '" data-dashboard-status="' + esc(status) + '"><span>' + esc(label) + '</span><strong>' +
        count + '</strong><span class="status-track" aria-hidden="true"><span style="width:' + (total ? count / total * 100 : 0) + '%"></span></span></button>';
    }).join("") + '</div></section>';
}

function repairIndex(section) {
  return '<header class="hero"><div><h1>' + section.title + '</h1><p class="subtitle"' + (isQuotationView() ? ' id="quotation-scope"' : '') + '>' + section.description + '</p></div></header>' + repairList(isQuotationView() ? "รายการใบเสนอราคา" : "รายการงานซ่อม");
}

function repairList(title) {
  const total = isQuotationView() ? '<span class="badge" id="quotation-total"></span>' : '';
  return '<section class="panel table-panel" id="repair-list"><header class="section-head"><div><h2 class="icon-title" tabindex="-1">' + icon("list") + ' ' + title + '</h2><p>เลือกเลขที่ SRN เพื่อดูรายละเอียดและประวัติของเครื่อง</p></div><div class="data-actions"><span class="badge" id="result-count" role="status"></span>' + total + exportButton("dashboard") + '</div></header>' + tableControls() + '<div id="table-output"></div></section>';
}

function monthlyPanel() {
  const [prev, now] = R.monthly(state.repairs, R.shiftMonth(R.month, -1), R.month, chart.type);
  const series = R.monthly(state.repairs, chart.start, chart.end, chart.type);
  const peak = Math.max(4, Math.ceil(Math.max(...series.map(item => item.total)) / 4) * 4);
  const delta = now.total - prev.total;
  const percent = prev.total ? ((delta / prev.total) * 100).toFixed(1) + "%" : "N/A";
  const signed = value => (delta > 0 ? "+" : "") + value;
  return '<header class="section-head"><div><h2 class="icon-title">' + icon("chart") + ' จำนวนการแจ้งซ่อมรายเดือน</h2><p>ตามวันที่รับแจ้งและประเภทเปิดงาน รวมทุกสถานะ ' + (series.some(item => item.invalid) ? '· พบข้อมูลประเภทงานที่ไม่ถูกต้อง' : '') + '</p></div><button class="button compact" data-action="chart-range">' + icon("calendar") + ' ช่วงเดือน</button></header>' +
    '<div class="chart-summary"><div><small>เดือนนี้ (MTD)</small><b>' + now.total + ' งาน</b></div><div><small>เดือนก่อน</small><b>' + prev.total + ' งาน</b></div><div><small>เปลี่ยนแปลง MoM</small><b class="' + (delta < 0 ? "" : "delta") + '">' + signed(delta) + ' <small>(' + (prev.total ? signed(percent) : percent) + ')</small></b></div><div style="margin-left:auto"><select id="chart-type" aria-label="ประเภทเปิดงาน">' + options(R.types, chart.type, "ทุกประเภท") + '</select></div></div>' +
    '<div class="chart-scroll" tabindex="0" aria-label="กราฟจำนวนการแจ้งซ่อมรายเดือน เลื่อนได้"><div class="chart" style="--months:' + series.length + '"><div class="axis" aria-hidden="true">' +
    [0,1,2,3,4].map(step => '<span style="top:' + step * 25 + '%">' + peak * (4 - step) / 4 + '</span>').join("") +
    '</div><div class="plot" style="--months:' + series.length + '">' +
    series.map(item => {
      const label = monthLabel(item.month) + " · " + item.total + " งาน (In-House " + item.in_house + ", On-Site " + item.on_site + ")";
      return '<button aria-label="' + label + '" title="' + label + '" data-month="' + item.month + '"><span class="bar" style="--bar:' + (item.total / peak * 100) + '%"><span style="height:' + (item.total ? item.in_house / item.total * 100 : 0) + '%"></span><span style="height:' + (item.total ? item.on_site / item.total * 100 : 0) + '%"></span></span><small>' + monthLabel(item.month).split(" ")[0] + '</small></button>';
    }).join("") + '</div></div></div><div class="keys"><span class="key"><i class="house"></i>In-House</span><span class="key"><i class="site"></i>On-Site</span><button class="text-button key" data-action="month-summary">ตารางรายเดือน</button></div>' + '<div class="chart-data-actions">' + exportButton("monthly") + '</div>';
}

function dateRangeControls(values = filters, admin = false) {
  const label = isQuotationView() ? "วันที่เสนอราคา" : "วันที่รับแจ้ง";
  const filterAttribute = admin ? "data-admin-filter" : "data-filter";
  const resetAction = admin ? "reset-admin-filters" : "clear-filters";
  return '<fieldset class="repair-date-filter"><legend><span class="repair-date-heading">' + icon("calendar") + ' ช่วง' + label +
    ' <span class="badge" id="date-range-active" hidden>กำลังกรอง</span></span></legend>' +
    '<div class="repair-date-fields">' +
    '<label class="field">ตั้งแต่วันที่<input type="date" ' + filterAttribute + '="from" value="' + esc(values.from) + '" aria-describedby="date-range-error"></label>' +
    '<label class="field">ถึงวันที่<input type="date" ' + filterAttribute + '="to" value="' + esc(values.to) + '" aria-describedby="date-range-error"></label>' +
    '<button type="button" class="button filter-reset" data-action="' + resetAction + '">รีเซ็ต</button>' +
    '</div><p class="error" id="date-range-error" role="status" hidden></p></fieldset>';
}

function matchesDateRange(value, { from,to } = filters) {
  if (!from && !to) return true;
  if (!Number.isFinite(Date.parse(value))) return false;
  const day = R.bangkokDay(value);
  return (!from || day >= from) && (!to || day <= to);
}

function updateDateRangeFeedback({ from,to } = filters) {
  document.querySelector("#date-range-active").hidden = !from && !to;
  const error = document.querySelector("#date-range-error");
  const invalidRange = from && to && from > to;
  error.textContent = invalidRange ? "วันที่เริ่มต้นต้องไม่อยู่หลังวันที่สิ้นสุด" : "";
  error.hidden = !invalidRange;
}

function tableControls() {
  const section = dashboardSection();
  const quotes = isQuotationView();
  const examples = quotes ? "เลขใบเสนอราคา, ลูกค้า, รุ่น" : "SRN, รุ่น, ช่าง, อาการเสีย";
  const select = (key,label,choices,placeholder) => '<select aria-label="' + label + '" data-filter="' + key + '">' + options(choices,filters[key],placeholder) + '</select>';
  const locationFilter = () => select("location","สถานที่ซ่อม",R.locations,"ทุกสถานที่");
  const statusFilter = statuses => select("status","สถานะงานซ่อม",statuses,"ทุกสถานะ");
  let controls;
  if (quotes) {
    controls = select("quoteScope","สถานะงานซ่อม",{open:"เฉพาะงานที่ยังเปิด",closed:"เฉพาะงานที่ปิดแล้ว",all:"ทุกสถานะงานซ่อม"},"สถานะงานซ่อม (อัตโนมัติ)") +
      select("quoteNumber","เลขใบเสนอราคา",{missing:"ยังไม่ระบุเลขใบเสนอราคา"},"ทุกเลขใบเสนอราคา");
  } else if (isRepairQueue()) {
    const statuses = Object.fromEntries(section.statuses.map(code => [code,state.statuses[code] || R.statuses[code]]));
    controls = statusFilter(statuses) + select("flag","กำหนดเสร็จ",{overdue:"เฉพาะงานเกินกำหนด"},"ทุกกำหนดเสร็จ");
  } else if (section) {
    controls = locationFilter() + select("assignment","การจ่ายงาน",{unassigned:"ยังไม่จ่ายช่าง",assigned:"จ่ายช่างแล้ว"},"การจ่ายงานทั้งหมด");
  } else {
    controls = statusFilter(state.statuses) + locationFilter();
  }
  const drilldown = !section && filters.flag ? '<span class="badge">' + esc(flagLabels[filters.flag]) + '</span>' : '';
  return '<div class="repair-filter-layout"><div class="toolbar repair-toolbar"><label class="search grow">' + icon("search") +
    '<input type="search" aria-label="ค้นหาด้วยคีย์เวิร์ด" placeholder="ค้นหา เช่น ' + examples + '" value="' + esc(filters.query) + '" data-filter="query"></label>' +
    controls + drilldown + '</div>' + dateRangeControls() + '</div>';
}

const keywordTerms = query => lookupKey(query).split(/\s+/).filter(Boolean);
const keywordText = values => values.map(lookupKey).filter(Boolean).join("\n");
const searchableDates = (...values) => values.filter(value => value && Number.isFinite(Date.parse(value)))
  .flatMap(value => [value,date(value)]);

function repairKeywordText(repair) {
  const details = [
    repair.error_code,repair.initial_findings,repair.root_cause,repair.attachments,repair.storage_location,repair.received_by,
    repair.final_outcome,repair.close_note,repair.service_report_url,R.tests[repair.test_result],R.overdue(repair) ? "เกินกำหนด" : "",
    ...searchableDates(repair.reported_at,repair.updated_at,repair.due_date,repair.received_at_company_at,
      repair.repair_started_at,repair.returned_to_customer_at,R.closedDay(repair))
  ];
  const visits = (repair.visits || []).flatMap(visit => [
    visit.site_location,state.engineers[visit.visit_engineer_id],visit.visit_findings,visit.follow_up_required ? "ต้องเข้าซ้ำ" : "",
    ...searchableDates(visit.scheduled_visit_at,visit.actual_visit_at,visit.next_visit_at)
  ]);
  const attempts = (repair.attempts || []).flatMap(attempt => [
    attempt.attempt_no,state.engineers[attempt.engineer_id],R.locations[attempt.location_type],R.tests[attempt.test_result],
    attempt.symptom_before,attempt.actions_taken,attempt.parts_replaced,attempt.remaining_symptom,
    attempt.failure_reason,attempt.failure_note,attempt.next_action,state.engineers[attempt.next_owner_id],
    ...searchableDates(attempt.attempt_at)
  ]);
  const parts = (repair.parts || []).flatMap(part => [
    part.part_number,part.part_name,part.quantity,part.part_status,part.po_number,part.claim_number,part.tracking_number,
    ...searchableDates(part.ordered_at,part.eta_at,part.received_at)
  ]);
  return keywordText([...repairCells(repair),repair.machine_id,...details,...visits,...attempts,...parts]);
}

function quotationKeywordText(repair,quote) {
  return keywordText([...quotationCells({repair,quote}),quotationLabel(quote),quote?.description,quote?.image_name,
    quote?.quoted_amount_thb != null && quote.quoted_amount_thb !== "" ? quoteCurrency.format(quote.quoted_amount_thb) : "",
    ...searchableDates(quote?.quoted_at,quote?.decision_at)]);
}

function repairMatchesSearch(repair,terms) {
  if (!terms.length) return true;
  const text = repairKeywordText(repair);
  if (terms.every(term => text.includes(term))) return true;
  const quoteTexts = (repair.quotes || []).map(quote => quotationKeywordText(repair,quote));
  return terms.every(term => text.includes(term) || quoteTexts.some(quote => quote.includes(term)));
}

function dashboardRows() {
  const section = dashboardSection();
  const scope = isQuotationView() ? quotationJobScope() : section ? "open" : "all";
  const terms = isQuotationView() ? [] : keywordTerms(filters.query);
  const rows = state.repairs.filter(r => (scope === "all" || R.active(r) === (scope === "open")) && (!section?.matches || section.matches(r)) &&
    (isQuotationView() || matchesDateRange(r.reported_at)) &&
    (!filters.location || r.current_location_type === filters.location) && (!filters.status || r.status === filters.status) &&
    (!filters.assignment || Boolean(r.assigned_engineer_id) === (filters.assignment === "assigned")) &&
    (!filters.flag || flagChecks[filters.flag](r)) && repairMatchesSearch(r,terms));
  rows.sort(byRisk);
  return rows;
}

function quotationRows() {
  const terms = keywordTerms(filters.query);
  const scope = quotationJobScope();
  return dashboardRows().flatMap(repair => {
    const text = terms.length ? repairKeywordText(repair) : "";
    const quotes = repair.quotes?.length ? repair.quotes : scope === "open" ? [null] : [];
    return quotes
      .filter(quote => matchesDateRange(quote?.quoted_at))
      .filter(quote => !filters.quoteNumber || (quote && !String(quote.quotation_number || "").trim()))
      .filter(quote => {
        if (terms.every(term => text.includes(term))) return true;
        const quoteText = quotationKeywordText(repair,quote);
        return terms.every(term => text.includes(term) || quoteText.includes(term));
      })
      .map(quote => ({ repair, quote }));
  });
}

const repairTableColumns = ["SRN","ลูกค้า","ยี่ห้อ","รุ่น","Serial Number","สถานที่ปัจจุบัน","ช่าง","สถานะ","ซ่อมไม่ผ่าน","อายุงาน (วัน)","อัปเดตล่าสุด","กำหนดเสร็จ"];

function quotationTableRow({ repair, quote }) {
  const link = '<button class="text-button serial" data-open="' + esc(repair.repair_id) + '">' + esc(repair.srn) + '</button>';
  const number = quotationLabel(quote);
  const copy = copyItemButton("คัดลอก " + (quote ? number : repair.srn),quotationCopyText({repair,quote}),true);
  const amount = quote?.quoted_amount_thb != null && quote.quoted_amount_thb !== "" ? quoteCurrency.format(quote.quoted_amount_thb) : "—";
  const editable = quote && (!isLiveDatabase() || state.role === "ADMIN");
  const editField = (value, field, label) => editable ? '<button type="button" class="text-button" data-edit-quote="' + esc(quote.quotation_id) + '" data-repair="' + esc(repair.repair_id) + '" data-field="' + field + '" title="แก้ไข' + label + '" aria-label="แก้ไข' + label + '">' + value + ' ' + icon("edit") + '</button>' : value;
  return '<tr data-open="' + esc(repair.repair_id) + '"><td>' + link + '</td><td>' + esc(state.customers[repair.customer_id]) +
    '</td><td><div class="row-copy">' + esc(number) + copy + '</div></td><td>' + esc(amount) +
    '</td><td>' + editField(esc(quote?.quotation_status || "—"),"quotation_status","สถานะใบเสนอราคา") + '</td><td>' + badge(state.statuses[repair.status],statusTone(repair.status)) +
    '</td><td>' + date(quote?.quoted_at) + '</td><td>' + editField(date(quote?.decision_at),"decision_at","วันที่ตัดสินใจ") +
    '</td><td class="quote-note">' + editField(esc(quote?.rejection_reason || "—"),"rejection_reason","เหตุผลที่ปฏิเสธ") + '</td><td>' + esc(repair.brand + " " + repair.model) +
    '</td><td>' + (quoteImageButton(quote,repair.repair_id) || "—") + '</td></tr>';
}

function table() {
  const quotes = isQuotationView();
  const rows = quotes ? quotationRows() : dashboardRows();
  const columns = quotes ? quotationColumns : repairTableColumns;
  const size = 10;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  tablePage = Math.min(tablePage, pages);
  const start = (tablePage - 1) * size;
  document.querySelector("#result-count").textContent = rows.length + " รายการ";
  updateDateRangeFeedback();
  if (quotes) {
    const scope = quotationJobScope();
    document.querySelector("#quotation-scope").textContent = {
      open:dashboardSection().description,
      closed:"เฉพาะใบเสนอราคาของงานที่ปิดแล้ว",
      all:"ใบเสนอราคาของทั้งงานที่ยังเปิดและงานที่ปิดแล้ว"
    }[scope];
    const satang = rows.reduce((total,{ quote }) => total + Math.round((Number(quote?.quoted_amount_thb) || 0) * 100),0);
    document.querySelector("#quotation-total").textContent = "ยอดเสนอราคารวม " + quoteCurrency.format(satang / 100);
  }
  const visibleRows = rows.slice(start,start + size);
  const rowHtml = quotes ? visibleRows.map(quotationTableRow).join("") : visibleRows.map(r => '<tr data-open="' + esc(r.repair_id) + '"><td><div class="row-copy"><button class="text-button serial" data-open="' + esc(r.repair_id) + '">' + esc(r.srn) + '</button>' + repairCopyButton(r) + '</div></td><td>' + esc(state.customers[r.customer_id]) + '</td><td>' + esc(r.brand) + '</td><td>' + esc(r.model) + '</td><td>' + esc(r.serial_number || "—") + '</td><td>' + esc(R.locations[r.current_location_type]) + '</td><td>' + esc(assignedEngineer(r)) + '</td><td>' + badge(state.statuses[r.status], statusTone(r.status)) + '</td><td>' + (R.failed(r) >= state.settings.repeated ? badge(R.failed(r) + " ครั้ง", "rose") : R.failed(r)) + '</td><td>' + R.age(r) + '</td><td>' + date(r.updated_at) + '</td><td>' + (R.overdue(r) ? badge(date(r.due_date) + " · เกินกำหนด", "amber") : date(r.due_date)) + '</td></tr>').join("");
  const label = quotes ? "ตารางรายการใบเสนอราคา" : "ตารางรายการงานซ่อม";
  const empty = '<tr><td colspan="' + columns.length + '" class="empty">' + (quotes ? "ไม่พบรายการเสนอราคาที่ตรงกับตัวกรอง" : "ไม่พบงานซ่อมที่ตรงกับตัวกรอง") + '</td></tr>';
  document.querySelector("#table-output").innerHTML =
    '<div class="table-scroll" tabindex="0" aria-label="' + label + ' เลื่อนได้"><table><thead><tr>' +
    columns.map(name => '<th scope="col">' + name + '</th>').join("") +
    '</tr></thead><tbody>' + (rowHtml || empty) +
    '</tbody></table></div><div class="pagination"><span>' + (rows.length ? (start + 1) + '–' + Math.min(rows.length, start + size) + ' จาก ' + rows.length : '0 รายการ') + '</span><div class="segment"><button data-page="' + (tablePage - 1) + '" ' + (tablePage <= 1 ? "disabled" : "") + '>ก่อนหน้า</button><button data-page="' + (tablePage + 1) + '" ' + (tablePage >= pages ? "disabled" : "") + '>ถัดไป</button></div></div>';
}
