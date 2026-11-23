"use strict";

const isLiveDatabase = () => document.body.dataset.liveDatabase === "true";
let liveError = "";
let liveBusy = false;
const liveRequests = new WeakMap();
let hostedRepairBridge;

function configuredRepairScript() {
  try {
    const url = new URL(document.body.dataset.scriptUrl);
    if (url.origin === "https://script.google.com" && /^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname)) return url;
  } catch { /* The Apps Script page and Demo do not need a separate connection. */ }
  return null;
}

function isBridgeFrame(source, root) {
  for (let depth = 0; source && source !== window && depth < 8; depth++) {
    if (source === root) return true;
    const parent = source.parent;
    if (source === parent) break;
    source = parent;
  }
  return false;
}

function connectHostedRepairBridge(url) {
  if (location.origin === "null") throw new Error("กรุณาเปิดหน้านี้ผ่านเว็บไซต์เพื่อเชื่อมต่อ Google Sheets");
  if (window.top !== window) throw new Error("กรุณาเปิดหน้าเว็บไซต์ในแท็บของเบราว์เซอร์โดยตรง");
  const protocol = "service-repair-bridge-v1";
  const nonce = crypto.randomUUID();
  const frame = document.createElement("iframe");
  frame.title = "เชื่อมต่อ Google Sheets";
  frame.hidden = true;
  url.search = new URLSearchParams({bridge:"1",origin:location.origin,nonce}).toString();
  frame.src = url.href;
  const pending = new Map();
  let peer, peerOrigin, resolveReady, rejectReady;
  const ready = new Promise((resolve,reject) => { resolveReady = resolve; rejectReady = reject; });
  const readyTimer = setTimeout(() => disconnect(new Error("เชื่อมต่อ Google Sheets ไม่สำเร็จ กรุณาตรวจสิทธิ์บัญชี Google แล้วลองใหม่")),25_000);

  function disconnect(error) {
    clearTimeout(readyTimer);
    window.removeEventListener("message",receive);
    frame.remove();
    hostedRepairBridge = undefined;
    rejectReady(error);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }

  function receive(event) {
    const message = event.data;
    if (message?.protocol !== protocol || message.nonce !== nonce) return;
    if (!peer) {
      const googleFrame = /^https:\/\/(?:[a-z0-9-]+-)?script\.googleusercontent\.com$/.test(event.origin);
      if (!googleFrame || message.type !== "ready" || !isBridgeFrame(event.source,frame.contentWindow)) return;
      peer = event.source;
      peerOrigin = event.origin;
      clearTimeout(readyTimer);
      resolveReady();
      return;
    }
    if (event.source !== peer || event.origin !== peerOrigin || message.type !== "result") return;
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(message.id);
    if (message.ok) request.resolve(message.value);
    else request.reject(new Error(message.error || "เรียกข้อมูล Google Sheets ไม่สำเร็จ"));
  }

  window.addEventListener("message",receive);
  document.body.append(frame);
  return async (method,args) => {
    await ready;
    return new Promise((resolve,reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => disconnect(new Error("Google Sheets ใช้เวลาตอบกลับนาน กรุณาลองใหม่")),60_000);
      pending.set(id,{resolve,reject,timer});
      try {
        peer.postMessage({protocol,nonce,type:"call",id,method,args},peerOrigin);
      } catch (error) {
        disconnect(error);
      }
    });
  };
}

async function callRepairServer(method, ...args) {
  const script = configuredRepairScript();
  if (script) {
    hostedRepairBridge ||= connectHostedRepairBridge(script);
    return hostedRepairBridge(method,args);
  }
  return new Promise((resolve,reject) => {
    const bridge = window.google?.script?.run;
    if (!bridge) return reject(new Error("เปิดผ่าน URL /exec ของ Apps Script"));
    bridge.withSuccessHandler(resolve).withFailureHandler(reject)[method](...args);
  });
}

let repairAdminSession = null;

function repairAdminUnlocked() {
  return !isLiveDatabase() || Boolean(repairAdminSession?.expiresAt > Date.now());
}

function showRepairAdminLogin() {
  if (document.querySelector("#admin-login-dialog")?.open) return;
  app.innerHTML = '<dialog id="admin-login-dialog" aria-labelledby="admin-login-title" aria-describedby="admin-login-description">' +
    '<div class="admin-login-header"><span class="admin-login-mark">' + icon("lock") + '</span>' +
    '<button class="icon-button admin-login-close" type="button" aria-label="ปิด">' + icon("x") + '</button>' +
    '<h2 id="admin-login-title">เข้าสู่ Admin</h2>' +
    '<p id="admin-login-description" class="subtitle">กรอกรหัสเพื่อจัดการและบันทึกงานซ่อม</p></div>' +
    '<form data-form="admin-login"><label class="field"><span>รหัส Admin</span>' +
    '<input type="password" name="password" autocomplete="current-password" required autofocus></label>' +
    formFooter("เข้าสู่ระบบ") + '</form></dialog>';
  const modal = document.querySelector("#admin-login-dialog");
  document.querySelector(".admin-login-close").onclick = () => modal.close();
  modal.onclose = () => {
    if (modal.isConnected && isAdmin() && !repairAdminUnlocked()) location.hash = "dashboard";
  };
  modal.showModal();
}

async function submitRepairAdminLogin(form,password) {
  const button = form.querySelector('button[type="submit"]');
  const error = form.querySelector(".error");
  button.disabled = true;
  error.hidden = true;
  try {
    const session = await callRepairServer("unlockRepairAdmin",password);
    const modal = document.querySelector("#admin-login-dialog");
    if (!form.isConnected || !modal?.open || !isAdmin()) return;
    repairAdminSession = session;
    modal.close();
    render();
    if (pendingQuoteEdit) {
      const {repairId,quoteId,field} = pendingQuoteEdit;
      openQuoteEdit(repairId,quoteId,field);
    }
  } catch (failure) {
    error.textContent = failure.message || "เข้าสู่ Admin ไม่สำเร็จ";
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

function acceptLiveState(data) {
  if (!Array.isArray(data?.repairs) || !data.settings || !data.role) throw new Error("ข้อมูลที่ได้รับจาก Google Sheets ไม่ครบ");
  state = { ...data, statuses:{...R.statuses,...data.statuses} };
}

function showLiveDatabaseStatus() {
  const source = document.querySelector("#source-status");
  source.textContent = liveError ? "เชื่อมต่อไม่ได้" : "กำลังโหลด Google Sheets";
  const script = configuredRepairScript();
  if (script) script.searchParams.set("authorize","1");
  const authorize = script ? '<a class="button" href="' + esc(script.href) + '" target="_blank" rel="noopener noreferrer">ตรวจสิทธิ์บัญชี Google</a>' : "";
  app.innerHTML = '<section class="panel live-status"><h1>' + (liveError ? "เปิดฐานข้อมูลไม่ได้" : "กำลังโหลดข้อมูลจาก Google Sheets") + '</h1>' +
    (liveError ? '<p class="subtitle">' + esc(liveError) + '</p><div class="data-actions"><button class="button primary" data-action="reload-live-data">ลองใหม่</button>' +
      authorize + '</div>' : '') + '</section>';
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
  if (!repairAdminUnlocked()) {
    error.textContent = "กรุณากรอกรหัสในหน้า Admin แล้วลองบันทึกอีกครั้ง";
    error.hidden = false;
    return;
  }
  if (liveBusy) {
    error.textContent = "กำลังบันทึกคำขอก่อนหน้า";
    error.hidden = false;
    return;
  }
  const kind = form.dataset.form;
  const operation = kind === "repair" ? (adminTab === "edit" ? "edit" : "create") : kind === "activity" ? activity : kind;
  const repairId = operation === "edit" || kind === "activity" ? selectedId : form.dataset.repair || "";
  const updatedAt = ["reopen","quote-edit"].includes(kind) ? form.dataset.updatedAt : findRepair(repairId)?.updated_at || "";
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
    const saved = await callRepairServer("saveRepairDatabase",{operation,repairId,updatedAt,quoteId,values,requestId:request.requestId,adminToken:repairAdminSession.token});
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
    const expired = failure.message?.includes("[ADMIN_SESSION]");
    if (expired) repairAdminSession = null;
    const message = expired ? "กรุณากรอกรหัส Admin อีกครั้ง" : failure.message || "บันทึกลง Google Sheets ไม่สำเร็จ";
    if (expired && isAdmin()) {
      if (dialog.open) dialog.close();
      render();
    }
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
