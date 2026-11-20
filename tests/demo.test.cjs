"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const R = require("../data.js");

test("Bangkok grouping counts each repair once, includes closed cases, and preserves opening type", () => {
  const records = [
    { repair_id:"A", reported_at:"2025-01-31T17:01:00Z", status:"CLOSED", initial_service_type:"ON_SITE", current_location_type:"IN_HOUSE", visits:[{},{}], attempts:[{},{}] },
    { repair_id:"B", reported_at:"2025-01-31T16:59:00Z", status:"REPAIRING", initial_service_type:"IN_HOUSE" }
  ];
  assert.equal(R.bangkokDay(records[0].reported_at),"2025-02-01");
  assert.deepEqual(R.monthly([...records,records[0]],"2025-01","2025-03"),[
    { month:"2025-01", in_house:1, on_site:0, total:1, invalid:0 },
    { month:"2025-02", in_house:0, on_site:1, total:1, invalid:0 },
    { month:"2025-03", in_house:0, on_site:0, total:0, invalid:0 }
  ]);
  assert.equal(R.monthly(records,"2025-02","2025-02","IN_HOUSE")[0].total,0);
});

test("only CLOSED is excluded from Active and only FAIL contributes to failed attempts", () => {
  assert.equal(R.active({status:"REPAIR_COMPLETED"}),true);
  assert.equal(R.active({status:"CLOSED"}),false);
  assert.equal(R.failed({attempts:["FAIL","FAIL","PASS","INCONCLUSIVE","FAIL"].map(test_result => ({test_result}))}),3);
  assert.equal(R.overdue({status:"CLOSED", due_date:"2025-01-01"}),false);
});

test("closed details and repair age use the completed day with a fallback for legacy records", () => {
  const { run, node } = openDemo();
  run(`const closed = state.repairs.find(row => row.status === "CLOSED");
       Object.assign(closed,{reported_at:"2025-01-01",repair_completed_at:"2025-01-03",closed_at:"2025-01-06T18:21:00Z"});
       detail(closed.repair_id);`);
  assert.equal(run("R.closedDay(closed)"),"2025-01-03");
  assert.equal(run("R.age(closed)"),2);
  assert.ok(node("#dialog-body").innerHTML.includes(run('"ปิดงาน · " + date("2025-01-03")')));
  assert.ok(!node("#dialog-body").innerHTML.includes(run('timestamp(closed.closed_at)')));
  assert.equal(run('R.closedDay({...closed,repair_completed_at:""})'),"2025-01-07");
  assert.equal(run('R.closedDay({...closed,status:"REPAIR_COMPLETED"})'),"");
});

const root = path.resolve(__dirname,"..");
test("the static entry renders the app on site and configures the Google Sheets connection", () => {
  const page = fs.readFileSync(path.join(root,"index.html"),"utf8");
  const [,url] = page.match(/<body data-live-database="true" data-script-url="([^"]+)">/);
  assert.match(url,/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/);
  assert.match(page,/<main id="app"/);
  assert.doesNotMatch(page,/location\.replace\(/);
});

test("the standalone web connection accepts the expected Google iframe and rejects unrelated messages", async () => {
  const context = {
    URL,URLSearchParams,crypto:globalThis.crypto,WeakMap,Map,
    location:{origin:"https://laserpui.github.io"},setTimeout:()=>1,clearTimeout(){},
    document:{body:{dataset:{scriptUrl:"https://script.google.com/macros/s/test/exec"}},createElement:()=>frame}
  };
  let listener,sent;
  const rootFrame = {};
  const frame = {contentWindow:rootFrame,remove(){}};
  const peer = {parent:rootFrame,postMessage:(message,target) => { sent={message,target}; }};
  context.document.body.append = () => {};
  context.window = { addEventListener:(name,callback) => { listener=callback; },removeEventListener(){} };
  context.window.top = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,"live.js"),"utf8"),context);
  const result = vm.runInContext('callRepairServer("getRepairDatabase")',context);
  const address = new URL(frame.src);
  assert.equal(address.searchParams.get("origin"),context.location.origin);
  assert.equal(frame.hidden,true);
  const nonce = address.searchParams.get("nonce");
  const googleOrigin = "https://n-qa-script.googleusercontent.com";
  const message = (source,origin,data) => listener({source,origin,data:{protocol:"service-repair-bridge-v1",nonce,...data}});
  message({parent:null},googleOrigin,{type:"ready"});
  message(peer,"https://unrelated.example",{type:"ready"});
  message(peer,googleOrigin,{type:"ready",nonce:"wrong"});
  await Promise.resolve();
  assert.equal(sent,undefined);
  message(peer,googleOrigin,{type:"ready"});
  await Promise.resolve();
  assert.equal(sent.target,googleOrigin);
  assert.equal(sent.message.method,"getRepairDatabase");
  const reply = {type:"result",id:sent.message.id,ok:true,value:{repairs:[]}};
  message({parent:rootFrame},googleOrigin,{...reply,value:{unexpected:true}});
  message(peer,googleOrigin,reply);
  assert.deepEqual(await result,{repairs:[]});
});

test("Apps Script permits the data connection only from configured web origins", () => {
  const output = {setXFrameOptionsMode(mode){return mode;}};
  const bridge = {evaluate:()=>output};
  const context = vm.createContext({HtmlService:{
    XFrameOptionsMode:{ALLOWALL:"bridge"},
    createTemplateFromFile:()=>bridge,createHtmlOutput:message=>message
  }});
  vm.runInContext(fs.readFileSync(path.join(root,"google-apps-script/Code.gs"),"utf8"),context);
  const parameters = {bridge:"1",nonce:"4ea71527-6127-4e25-88bd-209fbf4ccd57"};
  assert.equal(context.doGet({parameter:{...parameters,origin:"https://other.github.io"}}),"Invalid connection request");
  assert.equal(context.doGet({parameter:{...parameters,origin:"https://laserpui.github.io.evil.example"}}),"Invalid connection request");
  assert.equal(context.doGet({parameter:{...parameters,origin:"https://laserpui.github.io"}}),"bridge");
  assert.equal(bridge.webOrigin,"https://laserpui.github.io");
  assert.equal(bridge.webNonce,parameters.nonce);
});

function openDemo() {
  const nodes = new Map();
  const local = new Map();
  const listeners = new Map();
  const node = selector => {
    if (!nodes.has(selector)) {
      nodes.set(selector,{ innerHTML:"", textContent:"", dataset:{}, classList:{toggle(){}}, append(){}, open:false, addEventListener(){}, focus(){}, close(){ this.open = false; }, showModal(){ this.open = true; } });
    }
    return nodes.get(selector);
  };
  const nav = ["dashboard","repairs","in-progress","quotations","admin"].map(route => ({
    dataset:{ route }, setAttribute(name,value) { this[name] = value; }, removeAttribute(name) { delete this[name]; }
  }));
  const context = vm.createContext({
    Intl, atob, Blob, FormData:class { constructor(form) { return form.entries; } }, crypto:globalThis.crypto, location:{hash:"#dashboard"}, URL, setTimeout:()=>0, clearTimeout(){},
    document:{body:node("body"),querySelector:selector=>selector.startsWith("form") ? null : node(selector),querySelectorAll:selector=>selector === "[data-route]" ? nav : [],addEventListener:(type,handler)=>listeners.set(type,handler)},
    window:{addEventListener:(type,handler)=>listeners.set(type,handler),scrollTo(){}},
    localStorage:{getItem:key=>local.get(key),setItem:(key,value)=>local.set(key,value)}
  });
  const run = code => vm.runInContext(code,context);
  const page = fs.readFileSync(path.join(root,"demo.html"),"utf8");
  const scripts = [...page.matchAll(/<script defer src="([^"]+)">/g)].map(match => match[1]);
  scripts.forEach(file => run(fs.readFileSync(path.join(root,file),"utf8")));
  const currentRoutes = () => nav.filter(link => link["aria-current"] === "page").map(link => link.dataset.route);
  const dispatch = (type,event) => listeners.get(type)(event);
  return { run, node, currentRoutes, dispatch, nav };
}

test("dashboard metrics and status cards filter the full repair table and its CSV", () => {
  const { run, node, dispatch, currentRoutes } = openDemo();
  run("render()");
  assert.match(node("#app").innerHTML,/dashboard-summary[\s\S]*monthly-panel[\s\S]*dashboard-follow/);
  const statusStyles = fs.readFileSync(path.join(root,"styles.css"),"utf8");
  const palette = Object.keys(R.statuses).map(status => {
    const tone = run(`statusTone(${JSON.stringify(status)})`);
    assert.ok(node("#app").innerHTML.includes('class="status-card ' + tone + '" data-dashboard-status="' + status + '"'));
    const colors = statusStyles.match(new RegExp("\\." + tone + "\\{--status-bg:(#[a-f0-9]{6});--status-fg:(#[a-f0-9]{6})\\}"));
    assert.ok(colors,"Missing color for " + status);
    return colors.slice(1);
  });
  assert.equal(new Set(palette.map(([background]) => background)).size,palette.length);
  assert.equal(new Set(palette.map(([,color]) => color)).size,palette.length);
  assert.match(node("#app").innerHTML,/id="repair-list"[\s\S]*id="table-output"/);
  assert.equal(run("dashboardRows().length"),run("state.repairs.length"));
  dispatch("click",{ target:{closest:()=>({dataset:{metric:"overdue"}})} });
  assert.equal(run("location.hash"),"#dashboard");
  assert.deepEqual(currentRoutes(),["dashboard"]);
  assert.equal(run("filters.flag"),"overdue");
  assert.match(node("#app").innerHTML,/<span class="badge">เกินกำหนด<\/span>/);
  assert.deepEqual([...node("#app").innerHTML.matchAll(/<select[^>]+data-filter="([^"]+)"/g)].map(match => match[1]),["status","location"]);
  assert.equal(run("dashboardRows().length"),run("state.repairs.filter(R.overdue).length"));

  dispatch("click",{target:{closest:()=>({dataset:{dashboardStatus:"CLOSED"}})}});
  assert.match(node("#table-output").innerHTML,/ปิดงาน/);
  assert.equal(run('getReport("dashboard").rows.length - 1'),run("state.repairs.filter(row => !R.active(row)).length"));
  dispatch("click",{target:{closest:()=>({dataset:{metric:"all"}})}});
  assert.equal(run("dashboardRows().length"),run("state.repairs.length"));
  run("monthDetail(R.shiftMonth(R.month,-1))");
  assert.match(node("#dialog-body").innerHTML,/REP-/);
  run("detail(state.repairs.find(r => r.initial_service_type === 'ON_SITE').repair_id)");
  assert.match(node("#dialog-body").innerHTML,/การเข้าบริการ/);
  run("state.repairs = state.repairs.filter(r => r.reported_at.startsWith(R.month)); render()");
  assert.match(node("#app").innerHTML,/N\/A/);
});

test("demo admin creates, rejects duplicate SRN, adds visits/attempts, transfers and closes with audit", () => {
  const { run, node } = openDemo();
  run("location.hash = '#admin'; adminTab = 'new'; render()");
  assert.match(node("#app").innerHTML,/เปิดงานซ่อมใหม่/);
  assert.doesNotMatch(node("#app").innerHTML,/ข้อมูลเพิ่มเติม/);
  assert.match(node("#app").innerHTML,/<select name="assigned_engineer_id"\s*>/);
  assert.match(node("#app").innerHTML,/name="brand"[^>]*required/);
  assert.match(node("#app").innerHTML,/name="model"[^>]*required/);
  const newForm = node("#app").innerHTML;
  assert.match(newForm,/<input type="text" name="customer_name"[\s\S]*<select name="brand"[\s\S]*<select name="model"[\s\S]*<input type="text" name="serial_number"/);
  assert.doesNotMatch(newForm,/<select name="customer_id"|<select name="machine_id"/);
  run(`const payload = { srn:"QA-DEMO-1", reported_at:R.today, customer_name:state.customers["CUS-1"], serial_number:"gmp-05281", brand:"Candela", model:"GentleMax Pro", initial_service_type:"ON_SITE", current_location_type:"ON_SITE", status:"PENDING_INSPECTION", priority:"HIGH", issue_description:"ตัวอย่าง QA" };
       saveRepair(null,payload); selectedId = state.repairs.at(-1).repair_id;
       const reportCount = () => R.monthly(state.repairs,R.month,R.month,"ON_SITE")[0].total;
       const originalTotal = reportCount();`);
  assert.equal(run("findRepair(selectedId).assigned_engineer_id"),"");
  assert.equal(run("findRepair(selectedId).brand"),"Candela");
  assert.equal(run("findRepair(selectedId).model"),"GentleMax Pro");
  assert.equal(run("findRepair(selectedId).serial_number"),run('state.machines.find(m => m.machine_id === "MCH-1").serial_number'));
  assert.equal(run("assignedEngineer(findRepair(selectedId))"),"ยังไม่จ่ายงาน");
  assert.throws(() => run("adminTab = 'new'; saveRepair(null,payload)"),/SRN/);
  run(`Object.assign(findRepair(selectedId),{ error_code:"OLD-01", root_cause:"ข้อมูลเดิม", attachments:"https://example.test/old" });
       adminTab = "edit"; render();`);
  assert.match(node("#app").innerHTML,/<select name="assigned_engineer_id"\s*>/);
  assert.match(node("#app").innerHTML,/<option value="Candela" selected>Candela<\/option>/);
  assert.match(node("#app").innerHTML,/<option value="GentleMax Pro" selected>GentleMax Pro<\/option>/);
  assert.doesNotMatch(node("#app").innerHTML,/name="error_code"|name="attachments"/);
  run(`const { status, ...editPayload } = payload;
       saveRepair(null,{...editPayload,brand:"Lutronic",model:"Clarity II",assigned_engineer_id:"TEC-1",edit_reason:"จ่ายงาน"});
       `);
  assert.equal(run("findRepair(selectedId).assigned_engineer_id"),"TEC-1");
  assert.equal(run("findRepair(selectedId).model"),"Clarity II");
  assert.equal(run("findRepair(selectedId).machine_id"),"MCH-1");
  assert.equal(run("findRepair(selectedId).error_code"),"OLD-01");
  assert.equal(run("findRepair(selectedId).root_cause"),"ข้อมูลเดิม");
  assert.equal(run("findRepair(selectedId).attachments"),"https://example.test/old");
  assert.equal(run("findRepair(selectedId).history.at(-1).note"),"จ่ายงาน");
  run(`adminTab = "manage";
       activity = "visit"; saveActivity(null,{scheduled_visit_at:R.today, site_location:"QA", follow_up_required:"no"});
       activity = "visit"; saveActivity(null,{scheduled_visit_at:R.today, follow_up_required:"no"});
       for (const result of ["FAIL","PASS","FAIL","INCONCLUSIVE","FAIL"]) {
         activity = "attempt"; saveActivity(null,{test_result:result, failure_reason:R.reasons[0], actions_taken:"QA"});
       }
       activity = "progress"; saveActivity(null,{status:"REPAIR_COMPLETED",note:"QA status"});
       activity = "transfer"; saveActivity(null,{current_location_type:"IN_HOUSE",note:"QA transfer"});
       activity = "close"; saveActivity(null,{repair_completed_at:R.today,test_result:"PASS",final_outcome:"สำเร็จ",close_note:"QA close"});`);
  assert.equal(run("findRepair(selectedId).visits.length"),2);
  assert.equal(run("findRepair(selectedId).visits[0].site_location"),"QA");
  assert.equal(run("findRepair(selectedId).visits[1].site_location"),"On-Site");
  assert.equal(run("R.failed(findRepair(selectedId))"),3);
  assert.equal(run("findRepair(selectedId).current_location_type"),"IN_HOUSE");
  assert.equal(run("findRepair(selectedId).initial_service_type"),"ON_SITE");
  assert.equal(run("reportCount() === originalTotal"),true);
  assert.equal(run("R.active(findRepair(selectedId))"),false);
  assert.equal(run("findRepair(selectedId).history.at(-1).actor"),"Admin Demo");
  assert.equal(run("R.load().repairs.at(-1).status"),"CLOSED");
  run(`const closedOn = findRepair(selectedId).closed_at;
       adminTab = "edit";
       saveRepair(null,{...editPayload,current_location_type:"IN_HOUSE",status:"PENDING_INSPECTION",closed_at:"",
         assigned_engineer_id:"TEC-1",test_result:"PASS",final_outcome:"ตรวจสอบเรียบร้อย",close_note:"แก้หมายเหตุ",
         returned_to_customer_at:R.today,edit_reason:"ปรับข้อมูลส่งคืน"});`);
  assert.equal(run("findRepair(selectedId).closed_at"),run("closedOn"));
  assert.equal(run("R.load().repairs.at(-1).status"),"CLOSED");
  assert.equal(run("R.load().repairs.at(-1).close_note"),"แก้หมายเหตุ");
  assert.equal(run("findRepair(selectedId).history.at(-1).note"),"ปรับข้อมูลส่งคืน");
});

test("each repair queue exposes only its two relevant filters and searches in scope", () => {
  const { run, node, currentRoutes, dispatch } = openDemo();
  run("render()");
  assert.deepEqual(currentRoutes(),["dashboard"]);
  const count = () => Number.parseInt(node("#result-count").textContent,10);

  run("location.hash = '#repairs'; render()");
  assert.deepEqual(currentRoutes(),["repairs"]);
  assert.match(node("#app").innerHTML,/<h1>งานรอตรวจสอบ<\/h1>/);
  assert.equal(count(),run("state.repairs.filter(row => row.status === 'PENDING_INSPECTION').length"));
  const selectors = () => [...node("#app").innerHTML.matchAll(/<select[^>]+data-filter="([^"]+)"/g)].map(match => match[1]);
  const change = (filter,value) => dispatch("change",{target:{dataset:{filter},value}});
  assert.deepEqual(selectors(),["location","assignment"]);
  change("location","IN_HOUSE");
  assert.equal(count(),run("state.repairs.filter(row => row.status === 'PENDING_INSPECTION' && row.current_location_type === 'IN_HOUSE').length"));
  change("assignment","unassigned");
  assert.equal(run("dashboardRows().every(row => !row.assigned_engineer_id)"),true);

  run("location.hash = '#in-progress'; clearFilters(); render()");
  assert.deepEqual(currentRoutes(),["in-progress"]);
  assert.match(node("#app").innerHTML,/<h1>อยู่ระหว่างซ่อม<\/h1>/);
  assert.equal(run("dashboardRows().some(row => ['PENDING_INSPECTION','REPAIR_COMPLETED','WAITING_RETURN','CLOSED'].includes(row.status))"),false);
  assert.deepEqual(selectors(),["status","flag"]);
  change("status","REPAIRING");
  assert.equal(count(),run("state.repairs.filter(row => row.status === 'REPAIRING').length"));
  const engineer = run("state.engineers[dashboardRows()[0].assigned_engineer_id]");
  dispatch("input",{target:{dataset:{filter:"query"},value:engineer}});
  assert.ok(count() > 0);
  assert.equal(run("dashboardRows().every(row => state.engineers[row.assigned_engineer_id] === filters.query)"),true);
  change("flag","overdue");
  assert.equal(run("dashboardRows().every(R.overdue)"),true);

  run(`const quoted = state.repairs.find(row => row.status === "CLOSED");
       quoted.quotes.push({quotation_number:"QT-QA",quoted_amount_thb:100});
       location.hash = "#quotations"; clearFilters(); render();`);
  assert.match(node("#app").innerHTML,/<h1>เสนอราคา<\/h1>/);
  assert.deepEqual(currentRoutes(),["quotations"]);
  assert.equal(count(),run("state.repairs.filter(row => R.active(row) && row.status === 'WAITING_CUSTOMER_APPROVAL').length"));
  assert.doesNotMatch(node("#table-output").innerHTML,/QT-QA/);
  run("location.hash = '#dashboard'; filters.query = quoted.srn; render()");
  assert.match(node("#table-output").innerHTML,/ปิดงาน/);
  run("detail(quoted.repair_id)");
  assert.match(node("#dialog-body").innerHTML,/QT-QA/);
});

test("keyword search covers repair details and remains inside the selected work queue", () => {
  const { run,node } = openDemo();
  run(`const pending = state.repairs.find(row => row.status === "PENDING_INSPECTION");
       const closed = state.repairs.find(row => row.status === "CLOSED");
       pending.brand = "QA-Aurora";
       pending.issue_description = "เสียงปั๊มผิดปกติ";
       pending.visits.push({site_location:"QA-RIVER"});
       pending.attempts.push({actions_taken:"QA-ALIGNMENT"});
       pending.parts.push({part_name:"QA-FIBER"});
       closed.issue_description = pending.issue_description;
       location.hash = "#repairs"; filters.query = "aurora เสียงปั๊ม QA-RIVER qa-alignment qa-fiber"; render();`);
  assert.equal(node("#result-count").textContent,"1 รายการ");
  assert.equal(run('getReport("dashboard").rows[1][1]'),run("pending.srn"));
  run('filters.query = "เสียงปั๊ม"; table()');
  assert.equal(node("#result-count").textContent,"1 รายการ");
  run('location.hash = "#dashboard"; render()');
  assert.equal(node("#result-count").textContent,"2 รายการ");
});

test("quotation view searches quote fields and exports results without matching sibling quotes", () => {
  const { run, node } = openDemo();
  run(`const pending = state.repairs.find(row => row.status === "WAITING_CUSTOMER_APPROVAL");
       pending.quotes.push(
         { quotation_id:"A", quotation_number:"QT-NEW-001", quoted_at:"2026-11-03", quoted_amount_thb:"1250.50", quotation_status:"รออนุมัติ" },
         { quotation_id:"B", quotation_number:"QT-NEW-002", quoted_amount_thb:"100", decision_at:"2026-11-04", rejection_reason:"ปรับงบประมาณ" }
       );
       location.hash = "#quotations"; filters.query = pending.srn; render();`);
  const view = node("#table-output");
  assert.match(view.innerHTML,/ยอดเงิน \(บาท\)/);
  assert.match(view.innerHTML,/QT-NEW-001/);
  assert.match(view.innerHTML,/QT-NEW-002/);
  assert.match(view.innerHTML,/ปรับงบประมาณ/);
  run('filters.query = "qt-new-001"; table()');
  assert.match(view.innerHTML,/QT-NEW-001/);
  assert.doesNotMatch(view.innerHTML,/QT-NEW-002/);
  assert.equal(run('getReport("dashboard").rows.length'),2);
  assert.equal(run('getReport("dashboard").rows[1][3]'),"1250.50");
  run('filters.query = pending.serial_number + " ปรับงบประมาณ"; table()');
  assert.match(view.innerHTML,/QT-NEW-002/);
  assert.doesNotMatch(view.innerHTML,/QT-NEW-001/);
  run('pending.status = "CLOSED"; table()');
  assert.match(view.innerHTML,/ไม่พบรายการเสนอราคา/);
  assert.equal(run('getReport("dashboard").rows.length'),1);
  assert.equal(run("pending.quotes.length"),2);
});

test("the in-progress CSV excludes quotation jobs while dashboard retains them", () => {
  const { run, node, dispatch } = openDemo();
  run(`const pendingApproval = state.repairs.find(row => row.status === "WAITING_CUSTOMER_APPROVAL");
       const quotedRepair = state.repairs.find(row => row.status === "REPAIRING");
       quotedRepair.quotes.push({quotation_id:"PENDING-NUMBER"});
       location.hash = "#in-progress"; render();`);
  assert.doesNotMatch(node("#app").innerHTML,/value="WAITING_CUSTOMER_APPROVAL"/);
  for (const job of ["pendingApproval","quotedRepair"]) {
    run(`filters.query = ${job}.srn; table()`);
    assert.equal(node("#result-count").textContent,"0 รายการ");
    assert.equal(run('getReport("dashboard").rows.length'),1);
  }
  run('location.hash = "#quotations"; filters.query = quotedRepair.srn; render()');
  assert.match(node("#table-output").innerHTML,/ยังไม่ระบุเลขใบเสนอราคา/);
  dispatch("change",{target:{dataset:{filter:"quoteNumber"},value:"missing"}});
  assert.equal(run("quotationRows().length"),1);
  run('location.hash = "#dashboard"; clearFilters(); filters.query = quotedRepair.srn; render()');
  assert.equal(node("#result-count").textContent,"1 รายการ");
});

test("quotation status works with dates, search and CSV while defaulting to open work", () => {
  const { run, node, dispatch } = openDemo();
  run(`const closed = state.repairs.find(row => row.status === "CLOSED");
       const pending = state.repairs.find(row => row.status === "WAITING_CUSTOMER_APPROVAL");
       const priorMonth = R.shiftMonth(R.month,-1);
       closed.quotes.push(
         {quotation_number:"QA-CLOSED-CURRENT",quoted_at:R.month + "-01",quoted_amount_thb:"1250.10"},
         {quotation_number:"QA-CLOSED-PRIOR",quoted_at:priorMonth + "-15",quoted_amount_thb:"500"},
         {quotation_number:"QA-UNDATED",quoted_amount_thb:"25"});
       pending.quotes.push({quotation_number:"QA-OPEN-CURRENT",quoted_at:R.month + "-01",quoted_amount_thb:"50.20"});
       location.hash = "#quotations"; render();`);
  const main = node("#table-output");
  const app = node("#app");
  assert.equal(run("quotationRows().some(({repair}) => repair.status === 'CLOSED')"),false);
  assert.doesNotMatch(app.innerHTML,/เดือนที่เสนอราคา/);
  const press = action => dispatch("click",{target:{closest:()=>({dataset:{action}})}});
  const change = (filter,value) => dispatch("change",{target:{dataset:{filter},value}});
  const report = () => run('getReport("dashboard").rows');

  assert.deepEqual([...app.innerHTML.matchAll(/<select[^>]+data-filter="([^"]+)"/g)].map(match => match[1]),["quoteScope","quoteNumber"]);
  change("from",run('R.month + "-01"'));
  change("to",run('R.month + "-01"'));
  assert.match(main.innerHTML,/QA-CLOSED-CURRENT/);
  assert.match(main.innerHTML,/QA-OPEN-CURRENT/);
  assert.doesNotMatch(main.innerHTML,/QA-CLOSED-PRIOR|QA-UNDATED/);
  assert.equal(report().length,3);
  assert.match(node("#quotation-total").textContent,/1,300\.30/);
  assert.equal(node("#dialog-body").innerHTML,"");

  change("quoteScope","open");
  assert.equal(report().length,2);
  assert.equal(report()[1][2],"QA-OPEN-CURRENT");
  change("quoteScope","closed");
  assert.equal(report().length,2);
  assert.equal(report()[1][2],"QA-CLOSED-CURRENT");
  change("from","");
  change("to","");
  assert.match(main.innerHTML,/QA-CLOSED-PRIOR/);
  assert.ok(report().some(row => row[2] === "QA-UNDATED"));
  change("quoteScope","all");
  assert.equal(report().length,5);
  run('filters.query = "QA-CLOSED-PRIOR"; table()');
  assert.equal(report().length,2);
  assert.equal(report()[1][2],"QA-CLOSED-PRIOR");
  change("quoteScope","");
  assert.equal(report().length,1);
  press("clear-filters");
  assert.equal(run("filters.quoteScope"),"");
  assert.equal(run("filters.query"),"");
  assert.equal(run("quotationRows().some(({repair}) => repair.status === 'CLOSED')"),false);
});

test("date filters use inclusive Bangkok dates and the date appropriate to each table", () => {
  const { run,node,dispatch } = openDemo();
  const change = (filter,value) => dispatch("change",{target:{dataset:{filter},value}});
  run(`const pending = state.repairs.find(row => row.status === "PENDING_INSPECTION");
       const repairing = state.repairs.find(row => row.status === "REPAIRING");
       const closed = state.repairs.find(row => row.status === "CLOSED");
       pending.reported_at = "2026-02-28T17:00:00Z";
       repairing.reported_at = "2026-03-02";
       closed.reported_at = "2026-02-01";
       closed.quotes.push({quotation_number:"QA-MARCH",quoted_at:"2026-03-03"},
         {quotation_number:"QA-UNDATED"}, {quotation_number:"QA-FEBRUARY",quoted_at:"2026-02-28"});
       state.repairs = [pending,repairing,closed];
       render();`);
  assert.match(node("#app").innerHTML,/ช่วงวันที่รับแจ้ง/);
  const assertFilterLayout = () => assert.match(node("#app").innerHTML,/<div class="repair-filter-layout"><div class="toolbar repair-toolbar">[\s\S]*?<fieldset class="repair-date-filter">[\s\S]*?data-filter="from"[\s\S]*?data-filter="to"[\s\S]*?data-action="clear-filters">รีเซ็ต<\/button>[\s\S]*?<\/fieldset>/);
  assertFilterLayout();
  assert.doesNotMatch(node("#app").innerHTML,/<details class="repair-date-filter"/);
  assert.equal(node("#date-range-active").hidden,true);
  change("from","2026-03-01");
  assert.equal(run("dashboardRows().length"),2);
  change("to","2026-03-01");
  assert.equal(run("dashboardRows()[0].repair_id === pending.repair_id"),true);
  assert.equal(run('getReport("dashboard").rows.length'),2);
  change("from","2026-03-02");
  assert.equal(node("#date-range-error").hidden,false);
  assert.equal(run("dashboardRows().length"),0);
  change("from","");
  assert.equal(node("#date-range-error").hidden,true);
  assert.equal(run("dashboardRows().length"),2);

  for (const [section,expected] of [["#repairs","pending"],["#in-progress","repairing"]]) {
    run(`location.hash = "${section}"; clearFilters(); render();`);
    assertFilterLayout();
    change("from","2026-03-01");
    assert.equal(run(`dashboardRows()[0].repair_id === ${expected}.repair_id`),true);
    assert.equal(run("dashboardRows().length"),1);
  }

  run('location.hash = "#quotations"; clearFilters(); render();');
  assertFilterLayout();
  assert.match(node("#app").innerHTML,/ช่วงวันที่เสนอราคา/);
  assert.equal(run("quotationRows().length"),0);
  change("from","2026-03-01");
  assert.equal(run('getReport("dashboard").rows[1][2]'),"QA-MARCH");
  change("quoteScope","open");
  assert.equal(run("quotationRows().length"),0);
  change("quoteScope","closed");
  change("from","");
  change("to","2026-02-28");
  assert.equal(run('getReport("dashboard").rows[1][2]'),"QA-FEBRUARY");
  assert.equal(run("quotationRows().length"),1);
  dispatch("click",{target:{closest:()=>({dataset:{action:"clear-filters"}})}});
  assert.equal(run("quotationRows().length"),0);
  assert.equal(node("#date-range-active").hidden,true);
});

test("quotation attachment persists and is shown only for supported image sources", () => {
  const { run, node } = openDemo();
  run(`location.hash = "#admin";
       adminTab = "update"; activity = "quote";
       selectedId = state.repairs.find(R.active).repair_id;
       render();`);
  assert.match(node("#app").innerHTML,/name="quote_image" type="file"/);
  const source = "data:image/png;base64,iVBORw0KGgo=";
  run(`const quote = { quotation_number:"QT-IMAGE",quoted_amount_thb:"1250",image_name:"quote.png",image_data_url:"${source}" };
       saveActivity(null,quote);
       state = R.load();
       detail(selectedId);`);
  assert.equal(run("findRepair(selectedId).quotes.at(-1).image_name"),"quote.png");
  assert.match(node("#dialog-body").innerHTML,/เปิดรูปภาพ/);
  const detailBefore = node("#dialog-body").innerHTML;
  assert.match(detailBefore,/download="quote.png"/);
  run(`let openedImage;
       window.open = (...args) => { openedImage = args; };
       openQuoteImage(selectedId,findRepair(selectedId).quotes.at(-1).quotation_id);`);
  const [imageUrl,target,features] = run("openedImage");
  try {
    assert.match(imageUrl,/^blob:/);
    assert.equal(target,"_blank");
    assert.equal(features,"noopener,noreferrer");
    assert.equal(node("#dialog-body").innerHTML,detailBefore);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
  assert.doesNotMatch(run('quoteRecord({ ...quote, image_data_url:"data:image/svg+xml;base64,PHN2Zz4=" })'),/เปิดรูปภาพ/);
  assert.doesNotMatch(run('quoteRecord({ quotation_number:"QT-NO-IMAGE",quoted_amount_thb:100 })'),/เปิดรูปภาพ/);
});

test("CSV covers filtered repairs beyond the page, monthly summaries, and Admin data", () => {
  const { run } = openDemo();
  assert.equal(run('getReport("dashboard").rows.length - 1'),run("state.repairs.length"));
  run(`filters.query = state.repairs.find(R.active).serial_number;`);
  assert.equal(run('getReport("dashboard").rows.length - 1'),run("state.repairs.filter(r => r.serial_number === filters.query).length"));
  run('location.hash = "#quotations"; clearFilters()');
  assert.equal(run('getReport("dashboard").rows.length - 1'),run('state.repairs.filter(r => R.active(r) && r.status === "WAITING_CUSTOMER_APPROVAL").length'));
  assert.equal(run('getReport("monthly").rows.length'),13);
  assert.equal(run('getReport("month",R.month).rows.length - 1'),run("monthlyRepairs(R.month).length"));
  assert.equal(run('getReport("settings").name'),"master-data");
  assert.equal(run('getReport("detail",state.repairs[0].repair_id).rows[0][0]'),"หมวด");
  const csv = run(`csvText([["ภาษาไทย",'a"b',"=SUM(1,2)",-2]])`);
  assert.equal(csv,"\uFEFF\"ภาษาไทย\",\"a\"\"b\",\"'=SUM(1,2)\",\"-2\"");

});

test("quote image archive creates Bangkok year/month directories and writes original bytes", async () => {
  const { run } = openDemo();
  await run(`const writes = [];
    const folder = {
      async getDirectoryHandle(name,opts) { writes.push(["folder",name,opts.create]); return this; },
      async getFileHandle(name,opts) {
        writes.push(["file",name,opts.create]);
        return { async createWritable() {
          return { async write(bytes) { writes.push(Array.from(bytes)); }, async close() { writes.push("closed"); } };
        } };
      }
    };
    const savedPath = writeQuoteImage(folder,{
      quotation_id:"ABC",quotation_number:"QT/01",image_data_url:"data:image/png;base64,AQID",image_attached_at:"2026-12-31T17:01:00Z"
    });
    savedPath;`);
  assert.equal(await run("savedPath"),"2027/01/QT-01-ABC.png");
  assert.deepEqual(JSON.parse(run("JSON.stringify(writes)")),[
    ["folder","2027",true],["folder","01",true],["file","QT-01-ABC.png",true],[1,2,3],"closed"
  ]);
  assert.equal(run(`quoteImagePath({quoted_at:"2025-08-01",image_attached_at:"2026-12-31T17:01:00Z",
    quotation_id:"ABC",quotation_number:"QT",image_data_url:"data:image/jpeg;base64,AQID"}).path`),"2025/08/QT-ABC.jpg");
});

test("links embedded in repair text use safe anchors and keep the surrounding text", () => {
  const { run,node } = openDemo();
  run('const linkedRepair = state.repairs[0]; linkedRepair.issue_description = "ดูภาพ (https://drive.google.com/open?id=sample&mode=view), แล้วดู https://example.test/Page_(detail).\\n<script>alert(1)</script> javascript:alert(1)"; detail(linkedRepair.repair_id);');
  const body = node("#dialog-body").innerHTML;
  assert.match(body,/\(<a href="https:\/\/drive\.google\.com\/open\?id=sample&amp;mode=view" target="_blank" rel="noopener noreferrer">https:\/\/drive\.google\.com\/open\?id=sample&amp;mode=view<\/a>\), แล้วดู/);
  assert.match(body,/<a href="https:\/\/example\.test\/Page_\(detail\)"[^>]*>https:\/\/example\.test\/Page_\(detail\)<\/a>\.\n&lt;script&gt;/);
  assert.doesNotMatch(body,/<script>|href="javascript:/);
  assert.equal(run('record("ผลตรวจ","http://[::1]:8000/help")').includes('href="http://[::1]:8000/help"'),true);
  assert.equal(run('linkifyText("ข้อความธรรมดา https://)")'),"ข้อความธรรมดา https://)");
});

test("copy controls target individual repair rows, months and detail entries", () => {
  const { run, node } = openDemo();
  run("location.hash = '#in-progress'; render()");
  const table = node("#table-output").innerHTML;
  assert.equal((table.match(/data-copy-item/g) || []).length,10);
  assert.doesNotMatch(node("#app").innerHTML,/data-copy-(view|section-button)/);
  const [first, second] = run("dashboardRows().slice(0,2).map(row => row.srn)");
  const button = run("repairCopyButton(dashboardRows()[0])");
  assert.ok(button.includes(first));
  assert.ok(!button.includes(second));

  run("monthSummary()");
  assert.equal((node("#dialog-body").innerHTML.match(/data-copy-item/g) || []).length,12);

  run(`const detailRow = dashboardRows()[0];
       detailRow.history.push(R.history("แก้ไขข้อมูลงาน","QA_AUDIT_NOTE"));
       detail(detailRow.repair_id);`);
  const detail = node("#dialog-body").innerHTML;
  assert.doesNotMatch(detail,/ประวัติความคืบหน้า|QA_AUDIT_NOTE/);
  assert.doesNotMatch(run('csvText(getReport("detail",detailRow.repair_id).rows)'),/QA_AUDIT_NOTE/);
  assert.equal(run("detailRow.history.at(-1).note"),"QA_AUDIT_NOTE");
  assert.match(detail,/data-copy-item data-copy-text="[^"]+" title="คัดลอกSerial Number"/);
  assert.match(detail,/title="คัดลอกรอบการซ่อม \(Attempts\) รายการที่ 1"/);
  assert.match(detail,/title="คัดลอกรอบการซ่อม \(Attempts\) รายการที่ 2"/);
  assert.doesNotMatch(detail,/data-copy-(view|section-button)/);
});

test("typed customer and serial reuse matching records and add a new pair only once", () => {
  const { run } = openDemo();
  run(`const payload = { srn:"QA-CUSTOMER-1", reported_at:R.today, customer_name:"QA Customer", serial_number:"QA-NEW-SERIAL",
      brand:"Candela",model:"GentleMax Pro",status:"PENDING_INSPECTION" };
    const customerCount = Object.keys(state.customers).length;
    const machineCount = state.machines.length;
    adminTab = "new"; saveRepair(null,payload);
    const first = state.repairs.at(-1);
    adminTab = "new"; saveRepair(null,{ ...payload, srn:"QA-CUSTOMER-2", customer_name:"qa customer", serial_number:"qa-new-serial" });
    const second = state.repairs.at(-1);`);
  assert.equal(run("first.customer_id === second.customer_id && first.machine_id === second.machine_id"),true);
  assert.equal(run("Object.keys(state.customers).length - customerCount"),1);
  assert.equal(run("state.machines.length - machineCount"),1);
  assert.equal(run("second.serial_number"),"QA-NEW-SERIAL");
  assert.throws(() => run('adminTab = "new"; saveRepair(null,{...payload,srn:"QA-CUSTOMER-3",customer_name:"Another Customer"})'),/ลูกค้ารายอื่น/);
  assert.throws(() => run('saveRepair(null,{...payload,srn:"QA-CUSTOMER-3",model:"Clarity II"})'),/ระบุยี่ห้อและรุ่น/);
  assert.equal(run("Object.keys(state.customers).length - customerCount"),1);
  assert.equal(run("state.machines.length - machineCount"),1);
});

test("model options follow brand and typing a known serial supplies the matching choices", () => {
  const { run } = openDemo();
  run(`const form = { dataset:{}, elements:{ brand:{value:""}, model:{value:""}, serial_number:{value:"gmp-05281"} } };
    syncRepairModels(form);`);
  assert.equal(run("form.elements.model.disabled"),true);
  run("syncRepairSerial(form)");
  assert.equal(run("form.elements.brand.value"),"Candela");
  assert.equal(run("form.elements.model.disabled"),false);
  assert.match(run("form.elements.model.innerHTML"),/<option value="GentleMax Pro" selected>/);
  assert.doesNotMatch(run("form.elements.model.innerHTML"),/Clarity II/);
});

test("Admin management filters and exports across pages independently of the activity search", () => {
  const { run,node,dispatch } = openDemo();
  const press = dataset => dispatch("click",{target:{closest:()=>({dataset})}});
  const filter = (adminFilter,value) => dispatch(adminFilter === "query" ? "input" : "change",{target:{dataset:{adminFilter},value}});
  run('location.hash = "#admin"; render()');
  const app = node("#app");
  const results = node("#admin-results");
  assert.match(app.innerHTML,/data-admin-filter="status"[\s\S]*?data-admin-filter="from"[\s\S]*?data-action="reset-admin-filters">รีเซ็ต/);
  const shownJobs = () => [...results.innerHTML.matchAll(/data-edit="([^"]+)"/g)].map(match => match[1]);
  assert.match(results.innerHTML,/หน้า 1 จาก/);
  assert.deepEqual(shownJobs(),JSON.parse(run("JSON.stringify(adminRows().slice(0,10).map(row => row.repair_id))")));
  press({adminPage:"2"});
  assert.match(results.innerHTML,/หน้า 2 จาก/);
  assert.deepEqual(shownJobs(),JSON.parse(run("JSON.stringify(adminRows().slice(10,20).map(row => row.repair_id))")));
  const closed = run('state.repairs.find(row => row.status === "CLOSED")');
  filter("status","CLOSED");
  assert.equal(run("adminPage"),1);
  filter("from",run('R.bangkokDay(state.repairs.find(row => row.status === "CLOSED").reported_at)'));
  filter("to",run("adminFilters.manage.from"));
  filter("query",closed.srn);
  assert.match(results.innerHTML,/พบ 1 งาน/);
  assert.equal(run('getReport("admin").rows[1][1]'),closed.srn);

  press({adminTab:"update"});
  filter("scope","open");
  assert.equal(run('adminRows("update").every(R.active)'),true);
  press({action:"reset-admin-filters"});
  assert.equal(run('adminRows("update").length'),0);
  press({adminTab:"manage"});
  assert.equal(run("adminFilters.manage.query"),closed.srn);
  press({action:"reset-admin-filters"});
  assert.equal(run("Object.values(adminFilters.manage).every(value => value === '')"),true);
  assert.equal(run("adminRows().length"),run("state.repairs.length"));
});

test("an Admin can cancel reopening or confirm and continue work on the same repair", () => {
  const { run,node,dispatch } = openDemo();
  const press = dataset => dispatch("click",{target:{closest:()=>({dataset})}});
  run(`location.hash = "#admin";
       const closedJob = state.repairs.find(row => row.status === "CLOSED");
       closedJob.close_note = "ปิดงานเดิม";
       closedJob.history.push(R.history("ปิดงาน","ปิดงานเดิม","REPAIRING","CLOSED"));
       adminFilters.manage.query = closedJob.srn;
       render();`);
  const id = run("closedJob.repair_id");
  assert.match(node("#admin-results").innerHTML,/data-reopen-job=/);
  press({reopenJob:id});
  assert.match(node("#dialog-body").innerHTML,/data-form="reopen"/);
  assert.match(node("#dialog-body").innerHTML,/<option value="REPAIRING" selected>/);
  press({action:"cancel-reopen"});
  assert.equal(node("#dialog").open,false);
  assert.equal(run("findRepair(closedJob.repair_id).status"),"CLOSED");
  assert.equal(run("findRepair(closedJob.repair_id).close_note"),"ปิดงานเดิม");
  press({reopenJob:id});
  const form = {dataset:{form:"reopen",repair:id,updatedAt:run("closedJob.updated_at")},entries:[["status","REPAIRING"]],
    querySelector:()=>({}),querySelectorAll:()=>[{name:"status"}],isConnected:true};
  dispatch("submit",{target:form,preventDefault(){}});
  assert.equal(run("selectedId"),id);
  assert.equal(run("findRepair(selectedId).status"),"REPAIRING");
  assert.equal(run("findRepair(selectedId).closed_at"),"");
  assert.equal(run("JSON.parse(findRepair(selectedId).history.at(-1).old_value).close_note"),"ปิดงานเดิม");
  assert.match(node("#app").innerHTML,/data-form="activity"/);
  run('saveActivity(null,{status:"INSPECTING",note:"ตรวจเพิ่มหลังเปิดงาน"})');
  assert.equal(run("findRepair(selectedId).status"),"INSPECTING");
});

test("Admin searches repair jobs and opens an edit form for closed jobs", () => {
  const { run, node, dispatch } = openDemo();
  run('location.hash = "#admin"; adminTab = "update"; render()');
  const input = value => dispatch("input",{target:{id:"update-job-query",value,dataset:{adminFilter:"query"}}});
  const press = dataset => dispatch("click",{target:{closest:()=>({dataset})}});
  const app = node("#app");
  const results = node("#update-job-results");

  assert.match(app.innerHTML,/<input type="search" id="update-job-query"/);
  assert.doesNotMatch(app.innerHTML,/data-form="activity"|choose-job/);
  assert.equal(results.hidden,true);
  input("no-such-srn-qa");
  assert.match(node("#update-job-count").textContent,/ไม่พบงานซ่อม/);

  const job = run("state.repairs.find(R.active)");
  for (const query of [job.srn,job.serial_number,run("state.customers[state.repairs.find(R.active).customer_id]")]) {
    input(query);
    assert.ok(results.innerHTML.includes(job.srn));
  }
  input(job.srn);
  assert.equal(run('getReport("admin").rows.length'),2);
  press({update:job.repair_id});
  assert.equal(run("selectedId"),job.repair_id);
  assert.match(app.innerHTML,/data-form="activity"/);
  press({activity:"visit"});
  assert.match(app.innerHTML,/name="scheduled_visit_at"/);
  assert.doesNotMatch(app.innerHTML,/name="site_location"/);
  assert.doesNotMatch(app.innerHTML,/เพิ่มอะไหล่|data-activity="part"/);
  press({action:"change-update-job"});
  assert.equal(run("selectedId"),"");
  assert.equal(results.hidden,true);

  const closed = run('state.repairs.find(job=>job.status === "CLOSED")');
  dispatch("change",{target:{dataset:{adminFilter:"scope"},value:"closed"}});
  input(closed.srn);
  assert.ok(results.innerHTML.includes(closed.srn));
  press({update:closed.repair_id});
  assert.match(app.innerHTML,/แก้ไขงานที่ปิดแล้ว/);
  assert.doesNotMatch(app.innerHTML,/data-form="activity"/);
  press({edit:closed.repair_id});
  assert.match(app.innerHTML,/data-form="repair"/);
  assert.match(app.innerHTML,/ข้อมูลปิดงาน/);
  assert.match(app.innerHTML,/name="close_note"/);
  assert.match(app.innerHTML,/name="edit_reason" required/);
  assert.doesNotMatch(app.innerHTML,/name="status"|name="closed_at"/);
  assert.equal([...app.innerHTML.matchAll(/name="returned_to_customer_at"/g)].length,1);
});

test("previously recorded spare parts remain visible and exportable", () => {
  const { run, node } = openDemo();
  run("const repairWithPart = state.repairs.find(row=>row.parts.length); detail(repairWithPart.repair_id)");
  const part = run("repairWithPart.parts[0]");
  assert.ok(node("#dialog-body").innerHTML.includes(part.part_number));
  assert.ok(run('getReport("detail",repairWithPart.repair_id).rows.some(row=>row[0] === "อะไหล่" && row[1] === repairWithPart.parts[0].part_number)'));
});

test("quote number is optional at creation and can be filled later on the same quote", () => {
  const { run, node, dispatch } = openDemo();
  run(`location.hash = "#admin"; adminTab = "update"; activity = "quote";
       selectedId = state.repairs.find(R.active).repair_id; render();`);
  const app = node("#app");
  assert.match(app.innerHTML,/name="quotation_number"/);
  assert.doesNotMatch(app.innerHTML,/name="quotation_number"[^>]*required/);

  run(`const createdQuote = saveActivity(null,{ quotation_number:"", quoted_amount_thb:"1250.50", quoted_at:"2026-11-03",
    image_name:"quote.png", image_data_url:"data:image/png;base64,AQID" });
    const originalImagePath = quoteImagePath(createdQuote).path;`);
  const quoteId = run("createdQuote.quotation_id");
  const repairId = run("selectedId");
  assert.match(app.innerHTML,/data-fill-quote-number=/);

  dispatch("click",{target:{closest:()=>({dataset:{fillQuoteNumber:quoteId,repair:repairId}})}});
  assert.match(node("#dialog-body").innerHTML,/data-form="quote-number"/);
  assert.match(node("#dialog-body").innerHTML,/name="quotation_number"[^>]*required/);

  const error = { hidden:true };
  const form = {
    dataset:{ form:"quote-number", repair:repairId, key:quoteId },
    isConnected:true, querySelector:()=>error, querySelectorAll:()=>[{name:"quotation_number"}],
    entries:[["quotation_number"," QT-LATER-001 "]]
  };
  dispatch("submit",{ target:form, preventDefault(){} });
  const after = run("R.load().repairs.find(repair => repair.repair_id === selectedId)");
  assert.equal(error.hidden,true);
  assert.equal(after.quotes.length,1);
  assert.equal(after.quotes[0].quotation_id,quoteId);
  assert.equal(after.quotes[0].quotation_number,"QT-LATER-001");
  assert.equal(after.quotes[0].quoted_amount_thb,"1250.50");
  assert.equal(after.quotes[0].image_name,"quote.png");
  assert.equal(after.history.at(-1).event_type,"กรอกเลขใบเสนอราคา");
  assert.equal(run("quoteImagePath(findRepair(selectedId).quotes[0]).path === originalImagePath"),true);
  assert.doesNotMatch(app.innerHTML,/data-fill-quote-number=/);
});

test("Apps Script saves quote images under the configured Drive folder and retries by upload ID", () => {
  const files = [];
  const rootId = "1aWKbfboU9NVDwKLP4DbhsJmT5Rkf1W6u";
  const mimeFolder = "application/vnd.google-apps.folder";
  let email = "test@example.test";
  let mayWrite = true;
  let releases = 0;
  const context = vm.createContext({
    Session:{
      getActiveUser:()=>({getEmail:()=>email}),
      getEffectiveUser:()=>({getEmail:()=>"test@example.test"})
    },
    LockService:{ getScriptLock:()=>({waitLock(){},releaseLock(){releases++;}}) },
    repairCheck_:(ok,message)=>{if(!ok) throw new Error(message);},
    repairUserRole_:()=>"ADMIN",readRepairDatabase_:()=>({}),repairUserEmail_:()=>email,requireRepairAdminSession_(){},
    Drive:{Files:{
      get(id){
        assert.equal(id,rootId);
        return {id,driveId:"test-shared-drive",mimeType:mimeFolder,capabilities:{canAddChildren:mayWrite}};
      },
      list(options){
        assert.equal(options.driveId,"test-shared-drive");
        assert.equal(options.supportsAllDrives,true);
        const parentId = options.q.match(/'([^']+)' in parents/)[1];
        const folderName = options.q.match(/name = '([^']+)'/);
        const marker = options.q.match(/value='([^']+)'/);
        return {files:files.filter(file => file.parents[0] === parentId &&
          (folderName ? file.name === folderName[1] && file.mimeType === mimeFolder : file.appProperties?.quotationUploadId === marker?.[1]))};
      },
      create(metadata,blob){
        const file = {...metadata,blob,id:"file-" + (files.length + 1)};
        files.push(file);
        return {id:file.id,name:file.name};
      }
    }},
    Utilities:{
      formatDate:(_,zone)=>{assert.equal(zone,"Asia/Bangkok"); return "2026-11-19";},
      base64Decode:value=>[...Buffer.from(value,"base64")],
      newBlob:(bytes,mimeType,name)=>({bytes,mimeType,name})
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root,"google-apps-script","QuotationDrive.gs"),"utf8"),context);
  const payload = {uploadId:"quote-123",srn:"SRN-0199",customer:"คลินิก ตัวอย่าง",date:"2026-10-22",source:"data:image/png;base64,iVBORw0KGgo="};
  const upload = input => context.uploadQuotationImage(input);
  const first = upload(payload);
  assert.equal(first.name,"SRN-0199_คลินิก ตัวอย่าง.png");
  assert.equal(first.path,"2026/10/SRN-0199_คลินิก ตัวอย่าง.png");
  assert.equal(files[0].parents[0],rootId);
  assert.equal(files[1].parents[0],files[0].id);
  assert.equal(files[2].parents[0],files[1].id);
  assert.equal(upload(payload).id,first.id);
  assert.equal(files.length,3);
  assert.notEqual(upload({...payload,uploadId:"quote-124"}).id,first.id);
  assert.equal(files.length,4);
  assert.equal(upload({...payload,uploadId:"quote-125",date:""}).path,"2026/11/SRN-0199_คลินิก ตัวอย่าง.png");
  assert.throws(()=>upload({...payload,source:"data:image/png;base64,AQID"}),/ไม่ตรงกับชนิดรูป/);
  assert.throws(()=>upload({...payload,date:"2026-02-31"}),/วันที่จัดเก็บรูปไม่ถูกต้อง/);
  mayWrite = false;
  assert.throws(()=>upload({...payload,uploadId:"quote-126"}),/ไม่มีสิทธิ์/);
  assert.equal(releases,5);
  email = "";
  assert.throws(()=>upload(payload),/บัญชี Google/);
});

test("Drive upload stores the returned file and opens it directly from the quotation table and detail", async () => {
  const { run, node, dispatch } = openDemo();
  await run(`location.hash = "#admin"; adminTab = "update"; activity = "quote";
    selectedId = state.repairs.find(R.active).repair_id;
    const quote = saveActivity(null,{quotation_number:"QT-DRIVE",quoted_amount_thb:100,quoted_at:"2026-10-03",
      image_data_url:"data:image/png;base64,iVBORw0KGgo="});
    let request;
    window.google = { script:{ run:{
      withSuccessHandler(fn){ this.success = fn; return this; },
      withFailureHandler(){ return this; },
      uploadQuotationImage(input){ request = input; this.success({id:"drive-file-123",path:"2026/10/quote.png",name:"quote.png"}); }
    }}};
    uploadQuoteToDrive(selectedId,quote.quotation_id);`);
  assert.equal(run("request.srn"),run("findRepair(selectedId).srn"));
  assert.equal(run("request.customer"),run("state.customers[findRepair(selectedId).customer_id]"));
  assert.equal(run("request.date"),"2026-10-03");
  assert.equal(run("R.load().repairs.find(row=>row.repair_id === selectedId).quotes[0].image_drive.id"),"drive-file-123");
  const directLink = /<a[^>]+target="_blank"[^>]+href="https:\/\/drive\.google\.com\/file\/d\/drive-file-123\/view"[^>]*>[\s\S]*?เปิดรูปภาพ<\/a>/;
  run('location.hash = "#quotations"; render()');
  assert.match(node("#table-output").innerHTML,directLink);
  dispatch("click",{target:{closest:selector=>selector.includes(", a,") ? {dataset:{}} : {dataset:{open:run("selectedId")}}}});
  assert.equal(node("#dialog-body").innerHTML,"");
  run("detail(selectedId)");
  assert.match(node("#dialog-body").innerHTML,directLink);
});

test("repair form adds and alphabetizes the provided staff and machine catalog in existing demos", () => {
  const { run,node } = openDemo();
  run(`const saved = R.seed();
    saved.engineers = {"TEC-1":"ธีรภัทร","TEC-CUSTOM":"ประวิทย์","TEC-LOCAL":"ช่างท้องถิ่น"};
    R.save(saved);
    state = R.load();
    location.hash = "#admin"; adminTab = "new"; render();`);
  assert.equal(run('state.engineers["TEC-1"]'),"ธีรภัทร");
  assert.equal(run('state.engineers["TEC-LOCAL"]'),"ช่างท้องถิ่น");
  assert.equal(run('Object.values(state.engineers).filter(name=>name==="ประวิทย์").length'),1);

  const sorted = values => {
    assert.equal(values.at(-1),"อื่นๆ");
    const standard = values.slice(0,-1);
    const collator = new Intl.Collator("th",{sensitivity:"base",numeric:true});
    assert.deepEqual(standard,[...standard].sort(collator.compare));
  };
  const staff = JSON.parse(run("JSON.stringify(Object.values(engineerChoices()))"));
  for (const name of ["ประวิทย์","เอกเลิศ","สมชาย","อภิลักษณ์","ธนาธิป","พงษ์ศักดิ์","ธนบูรณ์","จีรศักดิ์","ชาติชาย","กันต์ศักดิ์","ณัฐพงษ์","กษิเดช","ภัควัฒน์"]) {
    assert.ok(staff.includes(name),name);
  }
  sorted(staff);
  const brands = JSON.parse(run('JSON.stringify(Object.values(machineChoices("brand")))'));
  sorted(brands);
  const catalog = JSON.parse(run("JSON.stringify(R.modelsByBrand)"));
  assert.equal(Object.keys(catalog).length,12);
  for (const [brand, models] of Object.entries(catalog)) {
    assert.ok(brands.includes(brand),brand);
    const choices = JSON.parse(run('JSON.stringify(Object.values(machineChoices("model",' + JSON.stringify(brand) + ')))'));
    for (const model of models) assert.ok(choices.includes(model),brand + " / " + model);
    sorted(choices);
  }
  assert.ok(run('Object.hasOwn(machineChoices("model","Lutronic"),"Clarity II")'));
  assert.match(node("#app").innerHTML,/<select name="assigned_engineer_id"\s*>/);

  run(`const assigned = Object.entries(engineerChoices()).find(([,name])=>name==="ธนบูรณ์")[0];
     saveRepair(null,{ srn:"QA-CATALOG-OPEN", reported_at:R.today, customer_name:"ลูกค้าทดสอบ",
       serial_number:"QA-CATALOG-SN", brand:"Jeisys", model:"UltraCel Q+", assigned_engineer_id:assigned,
       status:"PENDING_INSPECTION" });`);
  assert.equal(run("assignedEngineer(state.repairs.at(-1))"),"ธนบูรณ์");
  assert.equal(run("R.load().repairs.at(-1).model"),"UltraCel Q+");
});

function openSheetBackend() {
  const grids = new Map();
  let serial = 0;
  let batchCount = 0;
  let mayUseOwner = true;
  const entries = new Map();
  const cache = {get:key=>entries.get(key),put:(key,value)=>entries.set(key,value),remove:key=>entries.delete(key)};
  const unlocked = () => context.unlockRepairAdmin("test-only-password");
  const email = "owner@example.test";
  const context = vm.createContext({
    Date:class extends Date { constructor(...args) { super(...(args.length ? args : ["2026-11-19T08:00:00.000Z"])); } },
    Session:{ getActiveUser:()=>({getEmail:()=>email}),getEffectiveUser:()=>({getEmail:()=>email}) },
    Drive:{ Files:{ get:()=>({ownedByMe:mayUseOwner}) } },
    LockService:{ getScriptLock:()=>({waitLock(){},releaseLock(){}}),getUserLock:()=>({waitLock(){},releaseLock(){}}) },
    Utilities:{ formatDate:value=>R.bangkokDay(value), getUuid:()=>globalThis.crypto.randomUUID() },
    PropertiesService:{getScriptProperties:()=>({getProperty:()=>"test-only-password"})},
    CacheService:{getUserCache:()=>cache},
    storeQuotationImage_:input=>({id:"image-id",path:"2026/11/" + input.srn + "_" + input.customer + ".png"}),
    Sheets:{ Spreadsheets:{
      get:()=>({sheets:[...grids.entries()].map(([title,grid])=>({properties:{title,sheetId:grid.id}}))}),
      Values:{ batchGet:(_,options)=>({valueRanges:options.ranges.map(range=>({values:grids.get(range.slice(1,-1)).rows}))}) },
      batchUpdate({requests}){
        batchCount++;
        for (const request of requests) {
          const data = request.appendCells || request.updateCells;
          const grid = [...grids.values()].find(table=>table.id === (data.sheetId ?? data.start.sheetId));
          const values = data.rows[0].values.map(cell=>Object.values(cell.userEnteredValue || {})[0] ?? "");
          if (request.appendCells) grid.rows.push(values);
          else grid.rows[data.start.rowIndex][data.start.columnIndex] = values[0];
        }
      }
    }}
  });
  for (const file of ["Schema.gs","RepairDatabase.gs","RepairWrites.gs","AdminAccess.gs"]) vm.runInContext(fs.readFileSync(path.join(root,"google-apps-script",file),"utf8"),context);
  const columns = vm.runInContext("REPAIR_DATABASE_COLUMNS_",context);
  Object.entries(columns).forEach(([title,columns],index)=>grids.set(title,{id:index,rows:[columns.split(" ")]}));
  grids.get("Technicians").rows.push(["TEC-001","ประวิทย์",true]);
  const {token} = unlocked();
  const save = (operation,values,extra = {}) => context.saveRepairDatabase({operation,values,requestId:"request-" + (++serial),adminToken:token,...extra});
  return {context,grids,save,batches:()=>batchCount,disableOwner:()=>{mayUseOwner=false;}};
}

test("Sheet backend reads the empty database, saves linked records and audit rows, and deduplicates retries", () => {
  const { context,grids,save,batches,disableOwner } = openSheetBackend();
  assert.equal(context.getRepairDatabase().repairs.length,0);
  const fields = {
    srn:"SRN-QA-1",reported_at:"2026-11-18",customer_name:"คลินิกทดสอบ",serial_number:"SN-009",
    brand:"Fotona",model:"SP Dynamis",initial_service_type:"IN_HOUSE",current_location_type:"IN_HOUSE",
    issue_description:"=literal text",priority:"MEDIUM",status:"PENDING_INSPECTION",assigned_engineer_id:"TEC-001"
  };
  let state = save("create",fields,{requestId:"create-request-123"});
  const job = state.repairs[0];
  assert.equal(job.issue_description,"=literal text");
  assert.equal(state.customers[job.customer_id],"คลินิกทดสอบ");
  assert.equal(job.history[0].actor,"owner@example.test");
  assert.equal(JSON.parse(grids.get("Request_Log").rows[1][2]).repair_id,job.repair_id);
  assert.equal(save("create",fields,{requestId:"create-request-123"}).repairs.length,1);
  assert.equal(batches(),1);
  assert.throws(()=>save("create",fields),/SRN นี้มีอยู่แล้ว/);
  assert.throws(()=>save("close",{}, {repairId:job.repair_id,updatedAt:"stale"}),/อีกหน้าจอ/);
  state = save("visit",{scheduled_visit_at:"2026-11-19",visit_engineer_id:"TEC-001",follow_up_required:"no"},{repairId:job.repair_id,updatedAt:job.updated_at});
  assert.equal(state.repairs[0].visits[0].site_location,"In-House");
  state = save("quote",{quoted_amount_thb:"1000",image_data_url:"data:image/png;base64,iVBORw0KGgo="},{repairId:job.repair_id,updatedAt:state.repairs[0].updated_at});
  const quote = state.repairs[0].quotes[0];
  assert.equal(quote.image_drive.id,"image-id");
  assert.equal(quote.image_drive.path,"2026/11/SRN-QA-1_คลินิกทดสอบ.png");
  state = save("quote-number",{quotation_number:"QT-01"},{repairId:job.repair_id,quoteId:quote.quotation_id,updatedAt:state.repairs[0].updated_at});
  assert.equal(state.repairs[0].quotes[0].quotation_number,"QT-01");
  const closeValues = {test_result:"PASS",final_outcome:"สำเร็จ",close_note:"ส่งคืนแล้ว"};
  const closeTarget = {repairId:job.repair_id,updatedAt:state.repairs[0].updated_at};
  assert.throws(()=>save("close",closeValues,closeTarget),/repair_completed_at/);
  for (const day of ["2026-11-17","2026-11-20"]) {
    assert.throws(()=>save("close",{...closeValues,repair_completed_at:day},closeTarget),/วันที่ซ่อมเสร็จต้องอยู่ระหว่าง/);
  }
  state = save("close",{...closeValues,repair_completed_at:"2026-11-18"},closeTarget);
  assert.equal(state.repairs[0].status,"CLOSED");
  assert.equal(R.closedDay(state.repairs[0]),"2026-11-18");
  const { closed_at, updated_at } = state.repairs[0];
  const edit = { ...fields, issue_description:"อาการที่ตรวจสอบแล้ว",edit_reason:"แก้ข้อมูลหลังปิดงาน",
    close_note:"ส่งคืนพร้อมคู่มือ",test_result:"PASS",repair_completed_at:"2026-11-19",returned_to_customer_at:"2026-11-18",closed_at:"" };
  assert.throws(()=>save("edit",{...edit,service_report_url:"file:///report"},{repairId:job.repair_id,updatedAt:updated_at}),/ลิงก์รายงาน/);
  state = save("edit",edit,{repairId:job.repair_id,updatedAt:updated_at});
  const edited = state.repairs[0];
  assert.equal(edited.repair_id,job.repair_id);
  assert.equal(edited.status,"CLOSED");
  assert.equal(edited.closed_at,closed_at);
  assert.equal(R.closedDay(edited),"2026-11-19");
  assert.equal(edited.final_outcome,"สำเร็จ");
  assert.equal(edited.close_note,edit.close_note);
  assert.equal(edited.issue_description,edit.issue_description);
  assert.equal(edited.returned_to_customer_at,edit.returned_to_customer_at);
  assert.equal(edited.quotes[0].quotation_id,quote.quotation_id);
  assert.equal(edited.history.at(-1).note,edit.edit_reason);
  assert.throws(()=>save("progress",{}, {repairId:job.repair_id,updatedAt:state.repairs[0].updated_at}),/งานนี้ปิดแล้ว/);
  const reopenTarget = {repairId:job.repair_id,updatedAt:edited.updated_at,requestId:"test-reopen-request"};
  assert.throws(()=>save("reopen",{status:"REPAIRING"},{...reopenTarget,updatedAt:"stale"}),/อีกหน้าจอ/);
  assert.throws(()=>save("reopen",{status:"CLOSED"},reopenTarget),/ตัวเลือกไม่ถูกต้อง/);
  const reopened = save("reopen",{status:"REPAIRING"},reopenTarget).repairs[0];
  assert.equal(reopened.repair_id,job.repair_id);
  assert.equal(reopened.status,"REPAIRING");
  assert.equal(reopened.closed_at,"");
  assert.equal(reopened.repair_completed_at,"");
  assert.equal(reopened.visits[0].visit_id,edited.visits[0].visit_id);
  assert.equal(reopened.quotes[0].quotation_id,quote.quotation_id);
  assert.equal(reopened.history.at(-1).event_type,"เปิดงานอีกครั้ง");
  assert.equal(JSON.parse(reopened.history.at(-1).old_value).close_note,edit.close_note);
  assert.equal(save("reopen",{status:"REPAIRING"},reopenTarget).repairs[0].history.length,reopened.history.length);
  assert.throws(()=>save("reopen",{status:"REPAIRING"},{repairId:job.repair_id,updatedAt:reopened.updated_at}),/งานที่ปิดแล้ว/);
  const resumed = save("progress",{status:"WAITING_TEST",note:"รอทดสอบหลังเปิดงาน"},{repairId:job.repair_id,updatedAt:reopened.updated_at}).repairs[0];
  assert.equal(resumed.status,"WAITING_TEST");
  assert.equal(save("close",{...closeValues,repair_completed_at:"2026-11-19"},{repairId:job.repair_id,updatedAt:resumed.updated_at}).repairs[0].status,"CLOSED");
  disableOwner();
  assert.throws(()=>context.getRepairDatabase(),/Users/);
  grids.get("Users").rows.push(["owner@example.test","VIEWER",true]);
  assert.equal(context.getRepairDatabase().role,"VIEWER");
  assert.throws(()=>save("create",{...fields,srn:"SRN-QA-2"}),/ไม่มีสิทธิ์บันทึก/);
});

test("Apps Script mode loads only Sheet data and routes form saves to the server", async () => {
  const { run,node,dispatch } = openDemo();
  const { context } = openSheetBackend();
  const fresh = JSON.stringify(context.getRepairDatabase());
  run(`document.body.dataset.liveDatabase = "true";
    let request;
    window.google = {script:{run:{
      withSuccessHandler(fn){this.done=fn;return this;}, withFailureHandler(){return this;},
      getRepairDatabase(){this.done(${fresh});},
      unlockRepairAdmin(input){if(input!=="test-only-password") throw new Error("รหัส Admin ไม่ถูกต้อง"); this.done({token:"test-session",expiresAt:Date.now()+10000});},
      saveRepairDatabase(input){request=input;this.done(${fresh});}
    }}};`);
  await dispatch("DOMContentLoaded");
  assert.equal(run("state.repairs.length"),0);
  assert.equal(node("#source-status").textContent,"Google Sheets");
  run('location.hash = "#admin"; adminTab = "new"; render()');
  const feedback = {};
  const login = {dataset:{form:"admin-login"},entries:{get:()=>"wrong"},querySelector:()=>feedback,isConnected:true};
  await dispatch("submit",{target:login,preventDefault(){}});
  assert.match(feedback.textContent,/รหัส Admin ไม่ถูกต้อง/);
  login.entries.get = ()=>"test-only-password";
  await dispatch("submit",{target:login,preventDefault(){}});
  assert.match(node("#app").innerHTML,/เปิดงานใหม่/);
  const form = {dataset:{form:"repair"},entries:[["srn","SRN-QA"]],querySelector:()=>({}),querySelectorAll:()=>[],isConnected:true};
  await dispatch("submit",{target:form,preventDefault(){}});
  assert.equal(run("request.operation"),"create");
  assert.equal(run("request.adminToken"),"test-session");
  assert.equal(run("request.values.srn"),"SRN-QA");
  assert.equal(node("#toast").textContent,"บันทึกลง Google Sheets แล้ว");

});

test("Other brand switches the model control to free text and saves the typed model", () => {
  const { run,node,dispatch } = openDemo();
  run(`const form = { dataset:{}, elements:{brand:{value:"อื่นๆ"},model:{value:"SP Dynamis",tagName:"SELECT"}} };
    syncRepairModels(form,"");`);
  assert.match(run("form.elements.model.outerHTML"),/<input type="text" name="model" value="" required>/);
  run(`form.elements.model = {value:"Custom 900",tagName:"INPUT"};
    form.elements.brand.value = "Lutronic";`);
  dispatch("change",{target:{name:"brand",dataset:{},form:{
    dataset:{form:"repair"},elements:run("form.elements")
  }}});
  assert.match(run("form.elements.model.outerHTML"),/<select name="model" required>.*Clarity II/);
  assert.doesNotMatch(run("form.elements.model.outerHTML"),/Custom 900/);

  run(`location.hash = "#admin"; adminTab = "new";
    const customPayload = {srn:"QA-OTHER-900",reported_at:R.today,customer_name:"คลินิกทดสอบ",serial_number:"SN-CUSTOM-900",
      brand:"อื่นๆ",model:"Custom 900",status:"PENDING_INSPECTION"};
    saveRepair(null,customPayload); selectedId = state.repairs.at(-1).repair_id;
    adminTab = "edit"; render();`);
  assert.equal(run("R.load().repairs.at(-1).model"),"Custom 900");
  assert.match(node("#app").innerHTML,/<input type="text" name="model" value="Custom 900"[^>]+required/);
  assert.throws(()=>run('adminTab = "new"; saveRepair(null,{...customPayload,srn:"QA-NO-MODEL",model:" "})'),/ระบุยี่ห้อและรุ่น/);
});

test("unset serials can be completed later without matching unrelated repair history", () => {
  const { run,node } = openDemo();
  run(`location.hash="#admin"; adminTab="new"; render();
    const repairValues = {srn:"NO-SERIAL-01",reported_at:R.today,customer_name:"ชื่อลูกค้าทดสอบ",serial_number:"",
      brand:"Fotona",model:"SP Dynamis",initial_service_type:"IN_HOUSE", current_location_type:"IN_HOUSE",
      issue_description:"demo",priority:"MEDIUM",status:"PENDING_INSPECTION"};
    const machinesBefore = state.machines.length;
    saveRepair(null,repairValues);
    const jobId = state.repairs.at(-1).repair_id;
    adminTab="new"; saveRepair(null,{...repairValues,srn:"NO-SERIAL-02"});
    detail(jobId);`);
  assert.equal(run("state.machines.length"),run("machinesBefore"));
  assert.equal(run("findRepair(jobId).machine_id"),"");
  assert.match(node("#dialog-body").innerHTML,/ยังไม่ระบุ/);
  assert.doesNotMatch(node("#dialog-body").innerHTML,/NO-SERIAL-02/);
  run(`selectedId=jobId; adminTab="edit"; render();`);
  assert.doesNotMatch(node("#app").innerHTML,/<input[^>]+name="serial_number"[^>]+required/);
  run(`saveRepair(null,{...repairValues,serial_number:"SN-ADDED-LATER",edit_reason:"ระบุหมายเลขเครื่อง"});`);
  assert.equal(run("findRepair(jobId).serial_number"),"SN-ADDED-LATER");
  assert.equal(run("state.machines.length"),run("machinesBefore + 1"));
});

test("Admin can save an optional second engineer and find the job by either engineer", () => {
  const {run,node} = openDemo();
  run('location.hash = "#admin"; adminTab = "new"; render()');
  assert.match(node("#app").innerHTML,/<select name="secondary_engineer_id"\s*>/);
  run(`const twoEngineerValues = {srn:"QA-TWO-ENGINEERS",reported_at:R.today,customer_name:"คลินิกทดสอบ",
        brand:"Fotona",model:"SP Dynamis",initial_service_type:"ON_SITE",current_location_type:"ON_SITE",
        issue_description:"ทดสอบการจ่ายงานสองคน",priority:"MEDIUM",status:"REPAIRING",
        assigned_engineer_id:"TEC-1",secondary_engineer_id:"TEC-2"};`);
  assert.throws(() => run('saveRepair(null,{...twoEngineerValues,assigned_engineer_id:""})'),/คนแรก/);
  assert.throws(() => run('saveRepair(null,{...twoEngineerValues,secondary_engineer_id:"TEC-1"})'),/คนละคน/);
  run(`saveRepair(null,twoEngineerValues);
       state = R.load();
       const job = state.repairs.at(-1);
       selectedId = job.repair_id;
       adminTab = "edit"; render();`);
  assert.match(node("#app").innerHTML,/<select name="secondary_engineer_id"\s*>(?:(?!<\/select>)[\s\S])*?<option value="TEC-2" selected>/);
  assert.equal(run("assignedEngineer(job)"),run('[state.engineers["TEC-1"],state.engineers["TEC-2"]].join(" · ")'));
  assert.ok(run('repairCells(job).includes(assignedEngineer(job))'));
  run('adminFilters.manage.query = state.engineers["TEC-2"];');
  assert.equal(run("adminRows().some(row => row.repair_id === job.repair_id)"),true);
  run('location.hash = "#in-progress"; filters.query = state.engineers["TEC-2"];');
  assert.equal(run("dashboardRows().some(row => row.repair_id === job.repair_id)"),true);
  run(`saveRepair(null,{...twoEngineerValues,secondary_engineer_id:"",edit_reason:"ปรับผู้รับผิดชอบ"});`);
  assert.equal(run("findRepair(selectedId).secondary_engineer_id"),"");
});

test("Sheet backend stores, keeps and clears a second engineer using the existing history table", () => {
  const {context,grids,save,batches} = openSheetBackend();
  grids.get("Technicians").rows.push(["TEC-002","ทดสอบคนที่สอง",true]);
  const input = {srn:"QA-PARTNER",reported_at:"2026-11-18",customer_name:"คลินิกทดสอบ",
    brand:"Fotona",model:"SP Dynamis",initial_service_type:"ON_SITE",current_location_type:"ON_SITE",
    issue_description:"ทดสอบช่างสองคน",priority:"MEDIUM",status:"REPAIRING",assigned_engineer_id:"TEC-001"};
  assert.throws(()=>save("create",{...input,secondary_engineer_id:"TEC-001"}),/คนละคน/);
  assert.throws(()=>save("create",{...input,assigned_engineer_id:"",secondary_engineer_id:"TEC-002"}),/คนแรก/);
  assert.throws(()=>save("create",{...input,secondary_engineer_id:"UNKNOWN"}),/ไม่พบช่าง/);
  assert.equal(batches(),0);
  let job = save("create",{...input,secondary_engineer_id:"TEC-002"}).repairs[0];
  assert.equal(job.assigned_engineer_id,"TEC-001");
  assert.equal(job.secondary_engineer_id,"TEC-002");
  assert.ok(!grids.get("Repair_Master").rows[0].includes("secondary_engineer_id"));
  assert.equal(context.getRepairDatabase().repairs[0].secondary_engineer_id,"TEC-002");
  const edit = { ...input,edit_reason:"ปรับข้อมูล" };
  job = save("edit",edit,{repairId:job.repair_id,updatedAt:job.updated_at}).repairs[0];
  assert.equal(job.secondary_engineer_id,"TEC-002");
  job = save("edit",{...edit,secondary_engineer_id:""},{repairId:job.repair_id,updatedAt:job.updated_at}).repairs[0];
  assert.equal(job.secondary_engineer_id,"");
  assert.equal(job.assigned_engineer_id,"TEC-001");
  assert.equal(context.getRepairDatabase().repairs[0].secondary_engineer_id,"");
});

test("Sheet backend opens a repair with no serial and links its machine after editing", () => {
  const { grids,save } = openSheetBackend();
  const fields = {srn:"SRN-QA-NO-SERIAL",reported_at:"2026-11-18",customer_name:"คลินิกทดสอบ",
    brand:"Fotona",model:"SP Dynamis",initial_service_type:"IN_HOUSE",current_location_type:"IN_HOUSE",
    issue_description:"ทดสอบรอหมายเลขเครื่อง",priority:"MEDIUM",status:"PENDING_INSPECTION"};
  const before = save("create",fields).repairs[0];
  assert.equal(before.serial_number,"");
  assert.equal(before.machine_id,"");
  assert.equal(grids.get("Machines").rows.length,1);
  const edited = save("edit",{...fields,serial_number:"SN-REAL-LATER",edit_reason:"ทราบหมายเลขเครื่องแล้ว"},
    {repairId:before.repair_id,updatedAt:before.updated_at}).repairs[0];
  assert.equal(edited.repair_id,before.repair_id);
  assert.equal(edited.serial_number,"SN-REAL-LATER");
  assert.ok(edited.machine_id);
  assert.equal(grids.get("Machines").rows.length,2);
});

test("Admin remains reachable while repair access is checked and only admins see editing tools", () => {
  const { run, node, nav, currentRoutes } = openDemo();
  const adminLink = nav.find(link => link.dataset.route === "admin");
  run('document.body.dataset.liveDatabase = "true"; location.hash = "#admin"; const demoState = state; state = null; render();');
  assert.notEqual(adminLink.hidden,true);
  assert.deepEqual(currentRoutes(),["admin"]);
  assert.match(node("#app").innerHTML,/กำลังโหลดข้อมูลจาก Google Sheets/);

  run('state = {...demoState, role:"VIEWER"}; render();');
  assert.notEqual(adminLink.hidden,true);
  assert.match(node("#app").innerHTML,/ต้องใช้บัญชีที่ได้รับสิทธิ์ Admin/);
  assert.doesNotMatch(node("#app").innerHTML,/เปิดงานใหม่/);

  run('state.role = "ADMIN"; render();');
  assert.match(node("#app").innerHTML,/<dialog id="admin-login-dialog"/);
  assert.match(node("#app").innerHTML,/type="password"[^>]+autofocus/);
  assert.equal(node("#admin-login-dialog").open,true);
  run('repairAdminSession = {expiresAt:Date.now()+10000}; render();');
  assert.notEqual(adminLink.hidden,true);
  assert.match(node("#app").innerHTML,/เปิดงานใหม่/);
});

test("repair writes require an Admin session and wrong passwords are rate limited", () => {
  const {context,batches}=openSheetBackend();
  assert.throws(()=>context.saveRepairDatabase({requestId:"missing-admin-1"}),/กรุณากรอกรหัส Admin/);
  assert.throws(()=>context.saveRepairDatabase({requestId:"invalid-admin-1",adminToken:"invalid"}),/กรุณากรอกรหัส Admin/);
  assert.equal(batches(),0);
  for (let i=0;i<5;i++) assert.throws(()=>context.unlockRepairAdmin("wrong-test-password"),/รหัส Admin ไม่ถูกต้อง/);
  assert.throws(()=>context.unlockRepairAdmin("test-only-password"),/ลองใหม่ใน 5 นาที/);
});
