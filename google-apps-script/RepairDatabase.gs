const REPAIR_DATABASE_ID_ = '1vuoYA9ItELkkk-A3fX50vUW-dRVeS3Zt84zqC9R4kmQ';

const REPAIR_DATES_ = new Set('reported_at due_date received_at_company_at repair_started_at returned_to_customer_at repair_completed_at scheduled_visit_at actual_visit_at next_visit_at attempt_at quoted_at decision_at'.split(' '));
const REPAIR_TIMESTAMPS_ = new Set('created_at updated_at occurred_at closed_at'.split(' '));
const REPAIR_STATUS_ = 'PENDING_INSPECTION INSPECTING REPAIRING WAITING_PARTS WAITING_FACTORY WAITING_CUSTOMER_APPROVAL WAITING_TEST REPAIR_FAILED REPAIR_COMPLETED WAITING_RETURN CLOSED'.split(' ');
const REPAIR_TYPES_ = ['IN_HOUSE','ON_SITE'];
const REPAIR_LOCATIONS_ = [...REPAIR_TYPES_,'FACTORY','OTHER'];
const REPAIR_TESTS_ = ['PASS','FAIL','INCONCLUSIVE'];
const REPAIR_SECONDARY_ENGINEER_EVENT_ = 'แก้ไขช่างผู้รับผิดชอบคนที่ 2';

function repairSecondaryEngineer_(events) {
  const latest = events.reduce((current,event) => {
    if (event.event_type !== REPAIR_SECONDARY_ENGINEER_EVENT_) return current;
    return !current || String(event.occurred_at) >= String(current.occurred_at) ? event : current;
  },null);
  return latest?.new_value || '';
}

function getRepairDatabase() {
  const email = repairUserEmail_();
  const db = readRepairDatabase_();
  return repairClientState_(db,repairUserRole_(db,email));
}

function repairUserEmail_() {
  const email = String(Session.getActiveUser().getEmail()).trim().toLowerCase();
  const effective = String(Session.getEffectiveUser().getEmail()).trim().toLowerCase();
  repairCheck_(email && email === effective,'เปิด Web App ด้วยบัญชี Google ที่ได้รับสิทธิ์');
  return email;
}

function repairUserRole_(db,email) {
  const user = db.Users.rows.find(row => String(row.user_email).trim().toLowerCase() === email && repairActive_(row.active));
  const role = String(user?.role ?? '').trim().toUpperCase();
  if (!db.Users.rows.length) {
    const file = Drive.Files.get(REPAIR_DATABASE_ID_,{fields:'ownedByMe,trashed',supportsAllDrives:true});
    if (file.ownedByMe && !file.trashed) return 'ADMIN';
  }
  repairCheck_(['ADMIN','VIEWER'].includes(role),'บัญชีนี้ไม่มีสิทธิ์ใช้งานในแท็บ Users');
  return role;
}

function repairCheck_(condition,message) {
  if (!condition) throw new Error(message);
}

function repairActive_(value) {
  return value === true || /^(true|yes|1)$/i.test(String(value).trim());
}

function repairDateValue_(value,header) {
  if (typeof value !== 'number' || (!REPAIR_DATES_.has(header) && !REPAIR_TIMESTAMPS_.has(header))) return value;
  const local = Date.UTC(1899,11,30) + Math.round(value * 86400000);
  return REPAIR_DATES_.has(header) && Number.isInteger(value)
    ? new Date(local).toISOString().slice(0,10)
    : new Date(local - 7 * 3600000).toISOString();
}

function readRepairDatabase_() {
  const metadata = Sheets.Spreadsheets.get(REPAIR_DATABASE_ID_,{fields:'sheets(properties(title,sheetId))'});
  const sheets = Object.fromEntries(metadata.sheets.map(sheet => [sheet.properties.title,sheet.properties.sheetId]));
  const schema = repairSheetHeaders_();
  const required = Object.keys(schema);
  for (const title of required) repairCheck_(Object.hasOwn(sheets,title),'ไม่พบแท็บ ' + title + ' ในชีตฐานข้อมูล');
  const titles = Object.hasOwn(sheets,'Spare_Parts') ? [...required,'Spare_Parts'] : required;
  const response = Sheets.Spreadsheets.Values.batchGet(REPAIR_DATABASE_ID_,{
    ranges:titles.map(title => "'" + title + "'"),valueRenderOption:'UNFORMATTED_VALUE',dateTimeRenderOption:'SERIAL_NUMBER'
  });
  return Object.fromEntries(titles.map((title,index) => {
    const [header = [],...values] = response.valueRanges[index]?.values || [];
    const requiredColumns = schema[title] || ['part_id','repair_id'];
    for (const column of requiredColumns) repairCheck_(header.includes(column),'ไม่พบคอลัมน์ ' + title + '.' + column);
    const rows = values.flatMap((cells,row) => cells[0] === undefined || cells[0] === '' ? [] : [{
      ...Object.fromEntries(header.filter(Boolean).map(key => [key,repairDateValue_(cells[header.indexOf(key)] ?? '',key)])),
      rowIndex:row + 1
    }]);
    return [title,{ id:sheets[title],header,rows }];
  }));
}

function repairRecord_(row) {
  const { rowIndex,...data } = row;
  return data;
}

function repairSettings_(db) {
  const config = Object.fromEntries(db.Settings.rows.map(row => [row.config_key,row.config_value]));
  const settings = { watch:Number(config.watch_threshold),repeated:Number(config.repeated_failure_threshold),manager:Number(config.manager_threshold),critical:Number(config.critical_threshold) };
  const values = Object.values(settings);
  const valid = values.every((value,index) => Number.isSafeInteger(value) && value > (values[index-1] || 0));
  return {
    settings:valid ? settings : {watch:2,repeated:3,manager:4,critical:5},
    statuses:Object.fromEntries(REPAIR_STATUS_.filter(code => config['status_label:' + code]).map(code => [code,String(config['status_label:' + code])]))
  };
}

function repairClientState_(db,role) {
  const quotes = db.Quotations.rows.map(quote => ({
    ...quote,image_drive:quote.image_drive_id ? { id:quote.image_drive_id,path:quote.image_drive_path } : null
  }));
  const group = rows => {
    const grouped = new Map();
    rows.forEach(row => {
      const entries = grouped.get(row.repair_id) || [];
      entries.push(repairRecord_(row));
      grouped.set(row.repair_id,entries);
    });
    return grouped;
  };
  const history = group(db.Repair_History.rows);
  const visits = group(db.Service_Visits.rows.map(row => ({ ...row,follow_up_required:repairActive_(row.follow_up_required) })));
  const attempts = group(db.Repair_Attempts.rows.map(row => ({ ...row,attempt_no:Number(row.attempt_no) })));
  const parts = group(db.Spare_Parts?.rows || []);
  const quotations = group(quotes);
  return {
    role,...repairSettings_(db),
    customers:Object.fromEntries(db.Customers.rows.map(row => [row.customer_id,row.customer_name])),
    engineers:Object.fromEntries(db.Technicians.rows.map(row => [row.technician_id,row.display_name])),
    machines:db.Machines.rows.map(repairRecord_),
    repairs:db.Repair_Master.rows.map(row => {
      const events = history.get(row.repair_id) || [];
      return {
        ...repairRecord_(row),secondary_engineer_id:repairSecondaryEngineer_(events),history:events,visits:visits.get(row.repair_id) || [],
        attempts:attempts.get(row.repair_id) || [],parts:parts.get(row.repair_id) || [],quotes:quotations.get(row.repair_id) || []
      };
    })
  };
}

function repairCell_(value) {
  if (value === '' || value == null) return {};
  if (typeof value === 'number') return { userEnteredValue:{numberValue:value} };
  if (typeof value === 'boolean') return { userEnteredValue:{boolValue:value} };
  return { userEnteredValue:{stringValue:String(value)} };
}

function repairAppend_(requests,table,data) {
  const values = table.header.map(column => repairCell_(data[column]));
  requests.push({appendCells:{sheetId:table.id,rows:[{values}],fields:'userEnteredValue'}});
}

function repairUpdate_(requests,table,row,changes) {
  for (const [name,value] of Object.entries(changes)) {
    const columnIndex = table.header.indexOf(name);
    repairCheck_(columnIndex >= 0,'ไม่พบคอลัมน์ ' + name);
    requests.push({updateCells:{
      start:{sheetId:table.id,rowIndex:row.rowIndex,columnIndex},rows:[{values:[repairCell_(value)]}],fields:'userEnteredValue'
    }});
  }
}
