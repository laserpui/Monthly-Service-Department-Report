function saveRepairDatabase(request) {
  const email = repairUserEmail_();
  repairCheck_(request && typeof request.requestId === 'string' && /^[A-Za-z0-9-]{8,100}$/.test(request.requestId),'รหัสคำขอไม่ถูกต้อง');
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const db = readRepairDatabase_();
    const role = repairUserRole_(db,email);
    repairCheck_(role === 'ADMIN','บัญชีนี้ไม่มีสิทธิ์บันทึก');
    requireRepairAdminSession_(request.adminToken,email);
    const prior = db.Request_Log.rows.find(row => row.request_id === request.requestId);
    if (prior) {
      repairCheck_(prior.actor === email && prior.operation === request.operation,'รหัสคำขอซ้ำ');
      return repairClientState_(db,role);
    }

    const writes = [];
    const now = new Date().toISOString();
    const ctx = { db,writes,now,email };
    const values = request.values || {};
    const op = request.operation;
    let affectedRepairId = request.repairId || '';
    if (op === 'create') {
      affectedRepairId = saveRepairRecord_(ctx,values,null);
    } else if (['edit','progress','visit','attempt','transfer','quote','quote-number','quote-edit','close','reopen'].includes(op)) {
      const row = db.Repair_Master.rows.find(item => item.repair_id === request.repairId);
      repairCheck_(row,'ไม่พบงานซ่อม');
      repairCheck_(String(row.updated_at || '') === String(request.updatedAt || ''),'มีการแก้ไขงานนี้จากอีกหน้าจอ กรุณาโหลดข้อมูลใหม่ก่อนบันทึก');
      if (op === 'edit') saveRepairRecord_(ctx,values,row);
      else if (op === 'reopen') reopenRepairRecord_(ctx,values,row);
      else saveRepairActivity_(ctx,op,row,values,request);
    } else {
      saveRepairSettings_(ctx,op,values);
    }
    repairAppend_(writes,db.Request_Log,{
      request_id:request.requestId,operation:op,actor:email,created_at:now,
      result_json:JSON.stringify({ repair_id:affectedRepairId,quotation_id:request.quoteId || '' })
    });
    Sheets.Spreadsheets.batchUpdate({requests:writes},REPAIR_DATABASE_ID_);
    return repairClientState_(readRepairDatabase_(),role);
  } finally {
    lock.releaseLock();
  }
}

function repairText_(values,key,required = false) {
  const value = values[key];
  repairCheck_(value == null || typeof value === 'string' || typeof value === 'number','ข้อมูลไม่ถูกต้องใน ' + key);
  const text = String(value ?? '').trim();
  repairCheck_((!required || text) && text.length <= 10000,'กรุณาตรวจข้อมูล ' + key);
  return text;
}

function repairFields_(values,fields) {
  return Object.fromEntries(fields.split(' ').filter(key => Object.hasOwn(values,key)).map(key => [key,repairText_(values,key)]));
}

function repairEnum_(values,key,choices) {
  const text = repairText_(values,key,true);
  repairCheck_(choices.includes(text),'ตัวเลือกไม่ถูกต้องใน ' + key);
  return text;
}

function validRepairDay_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}

function repairDay_(values,key,required = false) {
  const text = repairText_(values,key,required);
  repairCheck_(!text || validRepairDay_(text),'วันที่ไม่ถูกต้องใน ' + key);
  return text;
}

function repairClosingFields_(values,closing) {
  const changes = repairFields_(values,'final_outcome close_note service_report_url');
  const url = changes.service_report_url;
  repairCheck_(!url || /^https?:\/\/[^\s]+$/i.test(url),'ลิงก์รายงานต้องขึ้นต้นด้วย http:// หรือ https://');
  for (const key of ['repair_completed_at','returned_to_customer_at']) {
    if (closing || Object.hasOwn(values,key)) changes[key] = repairDay_(values,key,closing && key === 'repair_completed_at');
  }
  if (closing) {
    changes.final_outcome = repairText_(values,'final_outcome',true);
    changes.close_note = repairText_(values,'close_note',true);
    changes.service_report_url = url || '';
  }
  if (closing || Object.hasOwn(values,'test_result')) {
    const result = repairText_(values,'test_result',closing);
    repairCheck_(!result || REPAIR_TESTS_.includes(result),'ตัวเลือกไม่ถูกต้องใน test_result');
    changes.test_result = result;
  }
  return changes;
}

function validateRepairCompletion_(completed,reported,now) {
  const today = Utilities.formatDate(new Date(now),'Asia/Bangkok','yyyy-MM-dd');
  const reportedDay = Utilities.formatDate(new Date(reported),'Asia/Bangkok','yyyy-MM-dd');
  repairCheck_(completed >= reportedDay && completed <= today,'วันที่ซ่อมเสร็จต้องอยู่ระหว่างวันที่รับแจ้งถึงวันนี้');
}

function repairEngineer_(db,values,key,required = false) {
  const id = repairText_(values,key,required);
  repairCheck_(!id || db.Technicians.rows.some(row => row.technician_id === id),'ไม่พบช่างที่เลือก');
  return id;
}

const repairKey_ = value => String(value ?? '').trim().normalize('NFC').toLowerCase();
const repairId_ = prefix => prefix + '-' + Utilities.getUuid();

function findRepairCustomer_(db,name,machine,row) {
  const matches = db.Customers.rows.filter(item => repairKey_(item.customer_name) === repairKey_(name));
  return matches.find(item => item.customer_id === machine?.customer_id) ||
    matches.find(item => item.customer_id === row?.customer_id) || matches[0];
}

function saveRepairRecord_(ctx,values,row) {
  const { db,writes,now,email } = ctx;
  const today = Utilities.formatDate(new Date(),'Asia/Bangkok','yyyy-MM-dd');
  const srn = repairText_(values,'srn',true);
  const reported = repairDay_(values,'reported_at',true);
  repairCheck_(reported <= today,'วันที่รับแจ้งต้องไม่เกินวันนี้');
  repairCheck_(!db.Repair_Master.rows.some(item => item.repair_id !== row?.repair_id && repairKey_(item.srn) === repairKey_(srn)),'เลขที่ SRN นี้มีอยู่แล้ว');
  const customerName = repairText_(values,'customer_name',true);
  const serial = repairText_(values,'serial_number');
  const brand = repairText_(values,'brand',true);
  const model = repairText_(values,'model',true);
  const assignedEngineer = Object.hasOwn(values,'assigned_engineer_id') ? repairEngineer_(db,values,'assigned_engineer_id') : row?.assigned_engineer_id || '';
  const previousSecondary = row ? repairSecondaryEngineer_(db.Repair_History.rows.filter(event => event.repair_id === row.repair_id)) : '';
  const secondaryEngineer = Object.hasOwn(values,'secondary_engineer_id') ? repairEngineer_(db,values,'secondary_engineer_id') : previousSecondary;
  repairCheck_(!secondaryEngineer || assignedEngineer,'กรุณาเลือกช่างผู้รับผิดชอบคนแรกก่อน');
  repairCheck_(!secondaryEngineer || secondaryEngineer !== assignedEngineer,'ช่างผู้รับผิดชอบทั้งสองคนต้องเป็นคนละคน');
  const existingMachine = serial ? db.Machines.rows.find(item => repairKey_(item.serial_number) === repairKey_(serial)) : null;
  const customer = findRepairCustomer_(db,customerName,existingMachine,row);
  const customerId = customer?.customer_id || repairId_('CUS');
  repairCheck_(!existingMachine || existingMachine.customer_id === customerId,'Serial Number นี้อยู่ในข้อมูลของลูกค้ารายอื่น');
  if (!customer) repairAppend_(writes,db.Customers,{customer_id:customerId,customer_name:customerName,active:true});
  const machineId = serial ? existingMachine?.machine_id || repairId_('MCH') : '';
  const serial_number = existingMachine?.serial_number || serial;
  if (serial && !existingMachine) repairAppend_(writes,db.Machines,{machine_id:machineId,customer_id:customerId,brand,model,serial_number,active:true});

  const base = {
    srn,reported_at:reported,customer_id:customerId,machine_id:machineId,brand,model,serial_number,
    initial_service_type:repairEnum_(values,'initial_service_type',REPAIR_TYPES_),
    current_location_type:repairEnum_(values,'current_location_type',REPAIR_LOCATIONS_),
    issue_description:repairText_(values,'issue_description',true),
    assigned_engineer_id:assignedEngineer,
    priority:repairEnum_(values,'priority',['CRITICAL','HIGH','MEDIUM','LOW']),
    ...repairFields_(values,'storage_location received_by'),updated_at:now,updated_by:email
  };
  for (const key of ['received_at_company_at','repair_started_at','returned_to_customer_at']) {
    if (Object.hasOwn(values,key)) base[key] = repairDay_(values,key);
  }
  if (row) {
    const reason = repairText_(values,'edit_reason',true);
    if (row.status === 'CLOSED') {
      Object.assign(base,repairClosingFields_(values,false));
      const completed = base.repair_completed_at ?? row.repair_completed_at;
      repairCheck_(!row.repair_completed_at || completed,'กรุณาระบุวันที่ซ่อมเสร็จ');
      if (completed) {
        const completedDay = Utilities.formatDate(new Date(completed),'Asia/Bangkok','yyyy-MM-dd');
        validateRepairCompletion_(completedDay,reported,now);
      } else if (row.closed_at) {
        const closedDay = Utilities.formatDate(new Date(row.closed_at),'Asia/Bangkok','yyyy-MM-dd');
        repairCheck_(reported <= closedDay,'วันที่รับแจ้งต้องไม่หลังวันปิดงาน');
      }
    }
    const keys = Object.keys(base).filter(key => !['updated_at','updated_by'].includes(key) && String(row[key] ?? '') !== String(base[key]));
    repairUpdate_(writes,db.Repair_Master,row,base);
    if (secondaryEngineer !== previousSecondary) repairHistory_(ctx,row.repair_id,REPAIR_SECONDARY_ENGINEER_EVENT_,reason,previousSecondary,secondaryEngineer);
    if (keys.includes('current_location_type')) repairHistory_(ctx,row.repair_id,'ย้ายสถานที่',reason,row.current_location_type,base.current_location_type);
    repairHistory_(ctx,row.repair_id,'แก้ไขข้อมูลงาน',reason,
      JSON.stringify(Object.fromEntries(keys.map(key => [key,row[key] ?? '']))),
      JSON.stringify(Object.fromEntries(keys.map(key => [key,base[key]]))));
  } else {
    const year = today.slice(0,4);
    const number = Math.max(0,...db.Repair_Master.rows.map(item => {
      const match = String(item.repair_id).match(/^REP-(\d{4})-(\d+)$/);
      return match?.[1] === year ? Number(match[2]) : 0;
    })) + 1;
    const id = 'REP-' + year + '-' + String(number).padStart(5,'0');
    const status = repairEnum_(values,'status',REPAIR_STATUS_.filter(code => code !== 'CLOSED'));
    repairAppend_(writes,db.Repair_Master,{...base,repair_id:id,status,created_at:now,created_by:email});
    repairHistory_(ctx,id,'เปิดงาน','รับแจ้งซ่อม','',status);
    if (secondaryEngineer) repairHistory_(ctx,id,REPAIR_SECONDARY_ENGINEER_EVENT_,'เปิดงาน','',secondaryEngineer);
    return id;
  }
}

function repairHistory_(ctx,id,type,note,oldValue = '',newValue = '') {
  repairAppend_(ctx.writes,ctx.db.Repair_History,{
    event_id:repairId_('EVT'),repair_id:id,occurred_at:ctx.now,actor:ctx.email,event_type:type,note,
    old_value:oldValue,new_value:newValue
  });
}

function reopenRepairRecord_(ctx,values,row) {
  repairCheck_(row.status === 'CLOSED','กรุณาเลือกงานที่ปิดแล้ว');
  const status = repairEnum_(values,'status',REPAIR_STATUS_.filter(code => code !== 'CLOSED'));
  const fields = ['closed_at','repair_completed_at','test_result','final_outcome','close_note','service_report_url'];
  const previous = Object.fromEntries(fields.map(key => [key,row[key] ?? '']));
  const reset = Object.fromEntries(fields.map(key => [key,'']));
  repairUpdate_(ctx.writes,ctx.db.Repair_Master,row,{...reset,status,updated_at:ctx.now,updated_by:ctx.email});
  repairHistory_(ctx,row.repair_id,'เปิดงานอีกครั้ง','กลับมาดำเนินการต่อ',
    JSON.stringify({status:row.status,...previous,returned_to_customer_at:row.returned_to_customer_at || ''}),status);
}

function saveRepairActivity_(ctx,op,row,values,request) {
  const {db,writes,now,email} = ctx;
  const id = row.repair_id;
  repairCheck_(row.status !== 'CLOSED' || op === 'quote-edit','งานนี้ปิดแล้ว');
  const changes = {updated_at:now,updated_by:email};
  const created = {repair_id:id,created_at:now,created_by:email};
  if (op === 'progress') {
    const status = repairEnum_(values,'status',REPAIR_STATUS_.filter(code => code !== 'CLOSED'));
    Object.assign(changes,repairFields_(values,'hold_reason next_action'),{status});
    repairHistory_(ctx,id,status === row.status ? 'บันทึกความคืบหน้า' : 'เปลี่ยนสถานะ',repairText_(values,'note',true),row.status,status);
  } else if (op === 'transfer') {
    const location = repairEnum_(values,'current_location_type',REPAIR_LOCATIONS_);
    repairCheck_(location !== row.current_location_type,'กรุณาเลือกสถานที่ใหม่');
    changes.current_location_type = location;
    repairHistory_(ctx,id,'ย้ายสถานที่',repairText_(values,'note',true),row.current_location_type,location);
  } else if (op === 'visit') {
    const locations = {IN_HOUSE:'In-House',ON_SITE:'On-Site',FACTORY:'โรงงาน',OTHER:'อื่น ๆ'};
    const currentLocation = Object.hasOwn(locations,row.current_location_type) ? locations[row.current_location_type] : 'ไม่ระบุสถานที่';
    const location = repairText_(values,'site_location') || currentLocation;
    const date = repairDay_(values,'scheduled_visit_at',true);
    const followup = repairEnum_(values,'follow_up_required',['yes','no']) === 'yes';
    repairAppend_(writes,db.Service_Visits,{
      ...created,visit_id:repairId_('VIS'),scheduled_visit_at:date,actual_visit_at:repairDay_(values,'actual_visit_at'),
      site_location:location,visit_engineer_id:repairEngineer_(db,values,'visit_engineer_id',true),
      visit_findings:repairText_(values,'visit_findings'),follow_up_required:followup,next_visit_at:repairDay_(values,'next_visit_at',followup)
    });
    repairHistory_(ctx,id,'เพิ่มการเข้าบริการ',location + ' · ' + date);
  } else if (op === 'attempt') {
    const result = repairEnum_(values,'test_result',REPAIR_TESTS_);
    const reason = repairText_(values,'failure_reason',result === 'FAIL');
    const visit = repairText_(values,'visit_id');
    repairCheck_(!visit || db.Service_Visits.rows.some(item => item.visit_id === visit && item.repair_id === id),'ครั้งเข้าบริการไม่ตรงกับงานนี้');
    const number = Math.max(0,...db.Repair_Attempts.rows.filter(item=>item.repair_id===id).map(item=>Number(item.attempt_no)||0)) + 1;
    const work = repairText_(values,'actions_taken',true);
    repairAppend_(writes,db.Repair_Attempts,{
      ...created,attempt_id:repairId_('ATT'),attempt_no:number,visit_id:visit,attempt_at:repairDay_(values,'attempt_at',true),
      engineer_id:repairEngineer_(db,values,'engineer_id',true),location_type:repairEnum_(values,'location_type',REPAIR_LOCATIONS_),
      ...repairFields_(values,'symptom_before parts_replaced remaining_symptom next_action'),
      actions_taken:work,test_result:result,failure_reason:reason,failure_note:repairText_(values,'failure_note',reason === 'อื่น ๆ'),
      next_owner_id:repairEngineer_(db,values,'next_owner_id')
    });
    repairHistory_(ctx,id,'เพิ่มรอบการซ่อม','ครั้งที่ ' + number + ' · ' + result + '\n' + work);
  } else if (op === 'quote') {
    const number = repairText_(values,'quotation_number');
    const amount = Number(repairText_(values,'quoted_amount_thb',true));
    repairCheck_(Number.isFinite(amount) && amount >= 0 && amount <= 1e12,'จำนวนเงินไม่ถูกต้อง');
    const date = repairDay_(values,'quoted_at');
    const nextQuote = {
      ...created,quotation_id:'QUO-' + request.requestId,quotation_number:number,quoted_at:date,quoted_amount_thb:amount,
      ...repairFields_(values,'quotation_status rejection_reason'),decision_at:repairDay_(values,'decision_at'),updated_at:now,updated_by:email
    };
    if (values.image_data_url) {
      const image = storeQuotationImage_({
        uploadId:nextQuote.quotation_id,srn:row.srn,customer:db.Customers.rows.find(item=>item.customer_id===row.customer_id)?.customer_name,
        date,source:values.image_data_url
      });
      nextQuote.image_drive_id = image.id;
      nextQuote.image_drive_path = image.path;
    }
    repairAppend_(writes,db.Quotations,nextQuote);
    repairHistory_(ctx,id,'เพิ่มใบเสนอราคา',number || 'ยังไม่ระบุเลขใบเสนอราคา');
  } else if (op === 'quote-edit') {
    const quote = db.Quotations.rows.find(item => item.quotation_id === request.quoteId && item.repair_id === id);
    repairCheck_(quote,'ไม่พบใบเสนอราคาในงานนี้');
    const fields = ['quotation_status','decision_at','rejection_reason'];
    const previous = Object.fromEntries(fields.map(key => [key,quote[key] || '']));
    const updated = {quotation_status:repairText_(values,'quotation_status'),decision_at:repairDay_(values,'decision_at'),rejection_reason:repairText_(values,'rejection_reason')};
    repairUpdate_(writes,db.Quotations,quote,{...updated,updated_at:now,updated_by:email});
    repairHistory_(ctx,id,'แก้ไขใบเสนอราคา',quote.quotation_number || 'ยังไม่ระบุเลขใบเสนอราคา',JSON.stringify(previous),JSON.stringify(updated));
  } else if (op === 'quote-number') {
    const quote = db.Quotations.rows.find(item => item.quotation_id === request.quoteId && item.repair_id === id);
    repairCheck_(quote && !quote.quotation_number,'ไม่พบใบเสนอราคาที่ยังรอเลข');
    const number = repairText_(values,'quotation_number',true);
    repairUpdate_(writes,db.Quotations,quote,{quotation_number:number,updated_at:now,updated_by:email});
    repairHistory_(ctx,id,'กรอกเลขใบเสนอราคา',number);
  } else if (op === 'close') {
    Object.assign(changes,repairClosingFields_(values,true),{status:'CLOSED',closed_at:now});
    validateRepairCompletion_(changes.repair_completed_at,row.reported_at,now);
    repairHistory_(ctx,id,'ปิดงาน',changes.close_note,row.status,'CLOSED');
  }
  repairUpdate_(writes,db.Repair_Master,row,changes);
}

function saveRepairSettings_(ctx,op,values) {
  const {db,writes} = ctx;
  const setting = (key,value) => {
    const row = db.Settings.rows.find(item=>item.config_key===key);
    if (row) repairUpdate_(writes,db.Settings,row,{config_value:value});
    else repairAppend_(writes,db.Settings,{config_key:key,config_value:value});
  };
  if (op === 'thresholds') {
    const levels = ['watch','repeated','manager','critical'].map(key=>Number(repairText_(values,key,true)));
    repairCheck_(levels.every((value,index)=>Number.isSafeInteger(value)&&value>(levels[index-1]||0)),'เกณฑ์ต้องเป็นจำนวนเต็มและเรียงจากน้อยไปมาก');
    ['watch_threshold','repeated_failure_threshold','manager_threshold','critical_threshold'].forEach((key,index)=>setting(key,levels[index]));
  } else if (op === 'status-label') {
    setting('status_label:' + repairEnum_(values,'code',REPAIR_STATUS_),repairText_(values,'label',true));
  } else if (op === 'engineer') {
    repairAppend_(writes,db.Technicians,{technician_id:repairId_('TEC'),display_name:repairText_(values,'name',true),active:true});
  } else if (op === 'customer') {
    const name = repairText_(values,'name',true);
    repairCheck_(!findRepairCustomer_(db,name),'ชื่อลูกค้านี้มีอยู่แล้ว');
    repairAppend_(writes,db.Customers,{customer_id:repairId_('CUS'),customer_name:name,active:true});
  } else if (op === 'machine') {
    const customer = repairText_(values,'customer_id',true);
    const serial = repairText_(values,'serial_number',true);
    repairCheck_(db.Customers.rows.some(item=>item.customer_id===customer),'ไม่พบลูกค้าที่เลือก');
    repairCheck_(!db.Machines.rows.some(item=>repairKey_(item.serial_number)===repairKey_(serial)),'Serial Number นี้มีอยู่แล้ว');
    repairAppend_(writes,db.Machines,{
      machine_id:repairId_('MCH'),customer_id:customer,serial_number:serial,
      brand:repairText_(values,'brand',true),model:repairText_(values,'model',true),active:true
    });
  } else throw new Error('ไม่รองรับคำสั่งนี้');
}
