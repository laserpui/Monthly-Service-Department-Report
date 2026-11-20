"use strict";

const RepairData = (() => {
  const statuses = {
    PENDING_INSPECTION: "รอตรวจสอบ", INSPECTING: "กำลังตรวจสอบ", REPAIRING: "กำลังซ่อม",
    WAITING_PARTS: "รออะไหล่", WAITING_FACTORY: "รอโรงงานตอบกลับ", WAITING_CUSTOMER_APPROVAL: "รอลูกค้าอนุมัติ",
    WAITING_TEST: "รอทดสอบ", REPAIR_FAILED: "ซ่อมไม่สำเร็จ", REPAIR_COMPLETED: "ซ่อมเสร็จ",
    WAITING_RETURN: "รอส่งคืนลูกค้า", CLOSED: "ปิดงาน"
  };
  const types = { IN_HOUSE: "In-House", ON_SITE: "On-Site" };
  const locations = { ...types, FACTORY: "โรงงาน", OTHER: "อื่น ๆ" };
  const priorities = { CRITICAL: "วิกฤต", HIGH: "สูง", MEDIUM: "ปานกลาง", LOW: "ต่ำ" };
  const tests = { PASS: "ผ่าน", FAIL: "ไม่ผ่าน", INCONCLUSIVE: "ยังสรุปไม่ได้" };
  const reasons = ["ยังไม่พบสาเหตุที่แท้จริง", "เปลี่ยนอะไหล่แล้วปัญหายังคงอยู่", "ปัญหาเกิดขึ้นเป็นบางครั้ง", "ต้องได้รับคำแนะนำจากโรงงาน", "ไม่มีอะไหล่สำหรับทดสอบ", "อื่น ๆ"];
  const customers = Object.fromEntries(["เอเวอร์โกลว์ คลินิก", "เดอะสกิน สตูดิโอ", "เวลลิส เมดิคอล", "ไพรม์ แอสเธติก", "ลูมิน่า คลินิก", "ออรา เวลเนส", "ไบรท์เดย์ คลินิก", "เมอริเดียน สกิน"].map((name, index) => ["CUS-" + (index + 1), name]));
  const engineers = { "TEC-1": "ธีรภัทร", "TEC-2": "ธนวัฒน์", "TEC-3": "พีรพล", "TEC-4": "ณัฐวุฒิ" };
  const serviceEngineers = {
    "TEC-STAFF-01":"ประวิทย์", "TEC-STAFF-02":"เอกเลิศ", "TEC-STAFF-03":"สมชาย", "TEC-STAFF-04":"อภิลักษณ์",
    "TEC-STAFF-05":"ธนาธิป", "TEC-STAFF-06":"พงษ์ศักดิ์", "TEC-STAFF-07":"ธนบูรณ์", "TEC-STAFF-08":"จีรศักดิ์",
    "TEC-STAFF-09":"ชาติชาย", "TEC-STAFF-10":"กันต์ศักดิ์", "TEC-STAFF-11":"ณัฐพงษ์", "TEC-STAFF-12":"กษิเดช",
    "TEC-STAFF-13":"ภัควัฒน์", "TEC-STAFF-OTHER":"อื่นๆ"
  };
  const modelsByBrand = {
    Fotona:["SP Dynamis Nx","SP Dynamis","XP Dynamis","XS Dynamis","SP Spectro","XP Focus","StarWalker MaQX","StarWalker PQX","StarWalker Pico Pro","TimeWalker","StarFormer","AvalancheLase","LightWalker","SkyPulse","อื่นๆ"],
    Jeisys:["IntraGen","AcGen","Cellec","Cellec V","Density","LinearZ","Edge One","UltraCel Q+","อื่นๆ"],
    Solta:["Vaser 2.2","Power X","อื่นๆ"],
    Elesys:["1000Nain","อื่นๆ"],
    Hypertech:["Biaxis QS","Biaxis GV","Biaxis Pico","อื่นๆ"],
    BlueCore:["IRIS","Trinity","อื่นๆ"],
    "Dae Yang":["CM Slim","WinBack","Aquatouch","Therma B","อื่นๆ"],
    Lutronic:["Pico Plus","Spectra XT","Spectra","eCo2 Plus","Healite II","Mosaic","อื่นๆ"],
    DAEJU:["Pentagon G-Slim","อื่นๆ"],
    SHEnB:["VirtueRF","อื่นๆ"],
    Brera:["Jovena","อื่นๆ"],
    "อื่นๆ":["อื่นๆ"]
  };
  const normalizeName = value => String(value ?? "").trim().normalize("NFC");
  function addServiceEngineers(directory) {
    const merged = { ...directory };
    const names = new Set(Object.values(merged).map(normalizeName));
    for (const [id,name] of Object.entries(serviceEngineers)) {
      if (!Object.hasOwn(merged,id) && !names.has(normalizeName(name))) merged[id] = name;
    }
    return merged;
  }
  const machineNames = [["Candela", "GentleMax Pro"], ["Lutronic", "Clarity II"], ["Cynosure", "PicoSure"], ["Alma", "Soprano ICE"], ["Cutera", "excel HR"], ["Fotona", "SP Dynamis"], ["Lumenis", "M22"], ["Quanta", "Discovery Pico"]];
  const machines = machineNames.map(([brand, model], index) => ({ machine_id: "MCH-" + (index + 1), customer_id: "CUS-" + (index + 1), brand, model, serial_number: ["GMP-05281","CL2-10472","PS-30812","SI-70611","EXH-54780","SPD-01069","M22-76523","DP-80619"][index] }));
  const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
  const bangkokDay = (value = new Date()) => {
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parts = Object.fromEntries(dayFormat.formatToParts(new Date(value)).map(part => [part.type, part.value]));
    return [parts.year, parts.month, parts.day].join("-");
  };
  const today = bangkokDay();
  const month = today.slice(0, 7);
  const shiftMonth = (key, offset) => {
    const [year, number] = key.split("-").map(Number);
    return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
  };
  const shiftDay = offset => new Date(Date.parse(today) + offset * 86400000).toISOString().slice(0, 10);
  const closedDay = repair => {
    if (repair.status !== "CLOSED") return "";
    const date = repair.repair_completed_at || repair.closed_at;
    return date ? bangkokDay(date) : "";
  };
  const age = repair => Math.max(0, Math.round((Date.parse(closedDay(repair) || today) - Date.parse(bangkokDay(repair.reported_at))) / 86400000));
  const overdue = repair => repair.status !== "CLOSED" && !!repair.due_date && bangkokDay(repair.due_date) < today;
  const failed = repair => repair.attempts.filter(attempt => attempt.test_result === "FAIL").length;
  const active = repair => repair.status !== "CLOSED";
  const search = (repair, query, directory = { customers, engineers }) => [repair.srn, repair.repair_id, repair.machine_id, repair.serial_number, directory.customers[repair.customer_id], repair.brand, repair.model, directory.engineers[repair.assigned_engineer_id]]
    .some(value => String(value || "").toLowerCase().includes(query.trim().toLowerCase()));
  const byMonth = (repairs, target, type = "") => Array.from(new Map(repairs.filter(repair => bangkokDay(repair.reported_at).slice(0, 7) === target && bangkokDay(repair.reported_at) <= today && (!type || repair.initial_service_type === type)).map(repair => [repair.repair_id, repair])).values());
  function monthly(repairs, start, end, type = "") {
    const months = [];
    for (let key = start; key <= end; key = shiftMonth(key, 1)) {
      const records = byMonth(repairs, key, type);
      const in_house = records.filter(repair => repair.initial_service_type === "IN_HOUSE").length;
      const on_site = records.filter(repair => repair.initial_service_type === "ON_SITE").length;
      months.push({ month: key, in_house, on_site, total: in_house + on_site, invalid: records.length - in_house - on_site });
    }
    return months;
  }
  const id = () => globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  const history = (event_type, note, old_value = "", new_value = "", at = new Date().toISOString(), actor = "Admin Demo") =>
    ({ event_id: id(), occurred_at: at, actor, event_type, old_value, new_value, note });

  function seed() {
    const issues = ["พลังงานเลเซอร์ไม่คงที่หลังอุ่นเครื่อง", "ระบบทำความเย็นแสดงข้อผิดพลาด", "เครื่องหยุดทำงานระหว่างยิงทดสอบ", "หัวทรีตเมนต์ตรวจไม่พบ", "หน้าจอค้างระหว่างเริ่มระบบ", "ต้องตรวจสอบการรั่วในวงจรน้ำ"];
    const liveStatuses = ["WAITING_PARTS","WAITING_FACTORY","REPAIR_FAILED","REPAIRING","WAITING_CUSTOMER_APPROVAL","WAITING_TEST","INSPECTING","PENDING_INSPECTION","REPAIR_COMPLETED","WAITING_RETURN"];
    const volumes = [11,14,0,10,16,13,18,15,20,17,25,19];
    const repairs = [];
    for (let offset = 0; offset < volumes.length; offset++) {
      const key = shiftMonth(month, offset - 11);
      for (let index = 0; index < volumes[offset]; index++) {
        const number = repairs.length + 1;
        const machine = machines[(number - 1) % machines.length];
        const opening = number % 3 === 0 ? "ON_SITE" : "IN_HOUSE";
        const isCurrent = offset === 11;
        const isLive = isCurrent || (offset === 10 && index < 5);
        const reported_at = key + "-" + String(1 + index % (isCurrent ? Number(today.slice(-2)) : 26)).padStart(2, "0");
        const status = isLive ? liveStatuses[index % liveStatuses.length] : "CLOSED";
        const lastUpdate = isLive ? shiftDay(-Math.min(Math.max(0, Math.floor((Date.parse(today) - Date.parse(reported_at)) / 86400000)), index % 6)) : reported_at;
        const repeated = isCurrent && index < 3 ? 5 - index : 0;
        const attempts = Array.from({ length: repeated }, (_, attempt) => ({
          attempt_id: "ATT-" + number + "-" + attempt, attempt_no: attempt + 1, attempt_at: lastUpdate, test_result: "FAIL",
          engineer_id: "TEC-" + (number % 4 + 1), location_type: "IN_HOUSE", actions_taken: ["ตรวจสอบระบบควบคุมและบันทึกผล", "ทดสอบวงจรและเปรียบเทียบค่ามาตรฐาน", "ทำการทดสอบซ้ำหลังปรับตั้ง"][attempt % 3], failure_reason: reasons[attempt % 3]
        }));
        repairs.push({
          ...machine, repair_id: "REP-" + key.slice(0, 4) + "-" + String(number).padStart(5, "0"), srn: "SRN-" + key.slice(2, 4) + "-" + String(1040 + number).padStart(4, "0"),
          initial_service_type: opening, current_location_type: isCurrent && index === 2 ? "IN_HOUSE" : opening, reported_at, status,
          assigned_engineer_id: "TEC-" + (number % 4 + 1), priority: repeated ? "HIGH" : "MEDIUM",
          updated_at: lastUpdate, due_date: isLive ? shiftDay(index % 3 === 0 ? -2 : 7 + index) : "",
          issue_description: issues[index % issues.length], hold_reason: index === 0 && isLive ? "รออะไหล่จากผู้จัดจำหน่าย" : "",
          next_action: isLive ? "ยืนยันผลทดสอบและแจ้งความคืบหน้า" : "",
          closed_at: isLive ? "" : reported_at, final_outcome: isLive ? "" : "ซ่อมสำเร็จ",
          close_note: isLive ? "" : "ทดสอบเครื่องก่อนส่งคืนแล้ว", test_result: isLive ? "" : "PASS",
          attempts, visits: opening === "ON_SITE" ? [{ visit_id: "VIS-" + number, scheduled_visit_at: reported_at, site_location: customers[machine.customer_id], visit_engineer_id: "TEC-" + (number % 4 + 1), visit_findings: "ตรวจสอบเบื้องต้นที่หน้างาน" }] : [],
          parts: isLive && index === 0 ? [{ part_number: "SP-DEMO-01", part_name: "ชุดควบคุมระบบทำความเย็น", quantity: 1, part_status: "รอส่ง", eta_at: shiftDay(5) }] : [],
          quotes: [],
          history: [history("เปิดงาน", "รับแจ้งซ่อม", "", "PENDING_INSPECTION", reported_at, "ทีมรับแจ้ง (Demo)"), ...(status === "PENDING_INSPECTION" ? [] : [history(status === "CLOSED" ? "ปิดงาน" : "เปลี่ยนสถานะ", isLive ? "บันทึกความคืบหน้า" : "ส่งมอบงานแล้ว", "PENDING_INSPECTION", status, lastUpdate, "ทีมบริการ (Demo)")])]
        });
      }
    }
    return { version: 1, repairs, settings: { watch: 2, repeated: 3, manager: 4, critical: 5 }, machines, customers, engineers:addServiceEngineers(engineers), statuses: { ...statuses } };
  }

  const storageKey = "service-repair-tracking-demo:v1";
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved?.version === 1 && Array.isArray(saved.repairs)) {
        return { ...saved, engineers:addServiceEngineers(saved.engineers || engineers) };
      }
    } catch { /* Use fixtures if browser storage is unavailable. */ }
    return seed();
  }
  function save(state) {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }
  return { statuses, types, locations, priorities, tests, reasons, modelsByBrand, today, month, bangkokDay, shiftMonth, closedDay, age, overdue, failed, active, search, monthly, byMonth, history, id, seed, load, save };
})();
if (typeof module !== "undefined") module.exports = RepairData;
