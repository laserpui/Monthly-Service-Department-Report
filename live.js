"use strict";

const isLiveDatabase = () => document.body.dataset.liveDatabase === "true";
let liveError = "";
let liveBusy = false;
const liveRequests = new WeakMap();

function callRepairServer(method, ...args) {
  return new Promise((resolve,reject) => {
    const bridge = window.google?.script?.run;
    if (!bridge) return reject(new Error("เปิดผ่าน URL /exec ของ Apps Script"));
    bridge.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args);
  });
}

function acceptLiveState(data) {
  if (!Array.isArray(data?.repairs) || !data.settings || !data.role) throw new Error("ข้อมูลที่ได้รับจาก Google Sheets ไม่ครบ");
  state = { ...data, statuses:{...R.statuses,...data.statuses} };
}

function showLiveDatabaseStatus() {
  const source = document.querySelector("#source-status");
  source.textContent = liveError ? "เชื่อมต่อไม่ได้" : "กำลังโหลด Google Sheets";
  app.innerHTML = '<section class="panel live-status"><h1>' + (liveError ? "เปิดฐานข้อมูลไม่ได้" : "กำลังโหลดข้อมูลจาก Google Sheets") + '</h1>' +
    (liveError ? '<p class="subtitle">' + esc(liveError) + '</p><button class="button primary" data-action="reload-live-data">ลองใหม่</button>' : '') + '</section>';
}

async function loadLiveDatabase() {
  if (liveBusy) return;
  liveBusy = true;
  liveError = "";
  state = null;
  render();
  try {
    acceptLiveState(await callRepairServer("getRepairDatabase"));
  } catch (error) {
    liveError = error.message || "กรุณาตรวจการตั้งค่า Apps Script และสิทธิ์ Google Sheets";
  } finally {
    liveBusy = false;
    render();
  }
}

async function saveLiveForm(form, values) {
  const error = form.querySelector(".error");
  if (liveBusy) {
    error.textContent = "กำลังบันทึกคำขอก่อนหน้า";
    error.hidden = false;
    return;
  }
  const kind = form.dataset.form;
  const operation = kind === "repair" ? (adminTab === "edit" ? "edit" : "create") : kind === "activity" ? activity : kind;
  const repairId = operation === "edit" || kind === "activity" ? selectedId : form.dataset.repair || "";
  const updatedAt = kind === "reopen" ? form.dataset.updatedAt : findRepair(repairId)?.updated_at || "";
  const quoteId = form.dataset.key || "";
  const fingerprint = JSON.stringify([operation,repairId,updatedAt,quoteId,values]);
  let request = liveRequests.get(form);
  if (request?.fingerprint !== fingerprint) {
    request = { fingerprint,requestId:R.id() };
    liveRequests.set(form,request);
  }
  liveBusy = true;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  error.hidden = true;
  notify("กำลังบันทึกลง Google Sheets…");
  try {
    const saved = await callRepairServer("saveRepairDatabase",{operation,repairId,updatedAt,quoteId,values,requestId:request.requestId});
    acceptLiveState(saved);
    if (form.isConnected) {
      if (kind === "repair") showSavedAdminRepair(values.srn);
      if (kind === "reopen") showReopenedAdminRepair(repairId);
      if (kind === "activity") activity = operation === "quote" && !values.quotation_number ? "quote" : "progress";
      if (dialog.open) dialog.close();
      render();
    } else if (!document.querySelector("main form")) render();
    notify(kind === "reopen" ? "เปิดงานอีกครั้งแล้ว" : "บันทึกลง Google Sheets แล้ว");
  } catch (failure) {
    const message = failure.message || "บันทึกลง Google Sheets ไม่สำเร็จ";
    if (form.isConnected) {
      error.textContent = message;
      error.hidden = false;
    }
    notify(message);
  } finally {
    liveBusy = false;
    button.disabled = false;
  }
}
