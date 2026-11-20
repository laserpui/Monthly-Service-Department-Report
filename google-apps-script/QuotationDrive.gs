const QUOTATION_DRIVE_ROOT_ = '1aWKbfboU9NVDwKLP4DbhsJmT5Rkf1W6u';
const QUOTATION_FOLDER_MIME_ = 'application/vnd.google-apps.folder';
const QUOTATION_IMAGE_MAX_ = 1024 * 1024;

function uploadQuotationImage(payload) {
  const active = Session.getActiveUser().getEmail();
  const effective = Session.getEffectiveUser().getEmail();
  if (!active || active.toLowerCase() !== String(effective).toLowerCase()) {
    throw new Error('กรุณาเปิด Web App ด้วยบัญชี Google ของคุณ');
  }
  const input = validateQuotationUpload_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    repairCheck_(repairUserRole_(readRepairDatabase_(),repairUserEmail_()) === 'ADMIN','บัญชีนี้ไม่มีสิทธิ์อัปโหลดรูป');
    return writeQuotationImage_(input);
  } finally {
    lock.releaseLock();
  }
}

function storeQuotationImage_(payload) {
  return writeQuotationImage_(validateQuotationUpload_(payload));
}

function writeQuotationImage_(input) {
  const root = Drive.Files.get(QUOTATION_DRIVE_ROOT_, {
      supportsAllDrives: true, fields: 'id,driveId,mimeType,trashed,capabilities(canAddChildren)'
    });
    if (root.trashed || root.mimeType !== QUOTATION_FOLDER_MIME_ || !root.capabilities?.canAddChildren) {
      throw new Error('บัญชีนี้ไม่มีสิทธิ์เพิ่มข้อมูลในโฟลเดอร์รูปใบเสนอราคา');
    }
    const yearFolder = quotationFolder_(root.id, input.year, root.driveId);
    const monthFolder = quotationFolder_(yearFolder.id, input.month, root.driveId);
    const marker = "appProperties has { key='quotationUploadId' and value='" + input.uploadId + "' }";
    const existing = quotationFindChild_(monthFolder.id, marker, root.driveId);
    const file = existing || Drive.Files.create({
      name: input.filename, mimeType: input.mimeType, parents: [monthFolder.id],
      appProperties: { quotationUploadId: input.uploadId }
    }, Utilities.newBlob(input.bytes,input.mimeType,input.filename), { supportsAllDrives:true, fields:'id,name' });
  return { id:file.id, name:file.name, path:[input.year,input.month,file.name].join('/') };
}

function quotationFindChild_(parentId, condition, sharedDriveId) {
  const options = {
    q: "'" + parentId + "' in parents and trashed = false and " + condition,
    fields: 'nextPageToken,files(id,name)', pageSize:100,
    orderBy: 'createdTime', supportsAllDrives: true, includeItemsFromAllDrives: true
  };
  if (sharedDriveId) Object.assign(options,{corpora:'drive',driveId:sharedDriveId});
  else options.corpora = 'user';
  do {
    const response = Drive.Files.list(options);
    if (response.files?.length) return response.files[0];
    options.pageToken = response.nextPageToken;
  } while (options.pageToken);
  return null;
}

function quotationFolder_(parentId, name, sharedDriveId) {
  const condition = "name = '" + name + "' and mimeType = '" + QUOTATION_FOLDER_MIME_ + "'";
  return quotationFindChild_(parentId,condition,sharedDriveId) || Drive.Files.create({
    name, mimeType:QUOTATION_FOLDER_MIME_, parents:[parentId]
  },null,{supportsAllDrives:true,fields:'id,name'});
}

function quotationNamePart_(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]+/g,'-').replace(/^[ .]+|[ .]+$/g,'').slice(0,100)
    : '';
}

function validateQuotationUpload_(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.uploadId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(payload.uploadId)) {
    throw new Error('รหัสอัปโหลดไม่ถูกต้อง');
  }
  const srn = quotationNamePart_(payload.srn);
  const customer = quotationNamePart_(payload.customer);
  if (!srn || !customer) throw new Error('ต้องมี SRN และชื่อลูกค้าสำหรับตั้งชื่อไฟล์');

  const date = payload.date || Utilities.formatDate(new Date(),'Asia/Bangkok','yyyy-MM-dd');
  const parsed = new Date(date + 'T00:00:00Z');
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== date) {
    throw new Error('วันที่จัดเก็บรูปไม่ถูกต้อง');
  }
  const source = payload.source;
  if (typeof source !== 'string' || source.length > 40 + Math.ceil(QUOTATION_IMAGE_MAX_ / 3) * 4) {
    throw new Error('รูปใบเสนอราคาต้องมีขนาดไม่เกิน 1 MB');
  }
  const image = source.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!image) throw new Error('รองรับเฉพาะรูป JPG, PNG หรือ WebP');
  let bytes;
  try { bytes = Utilities.base64Decode(image[2]); }
  catch (error) { throw new Error('ข้อมูลรูปใบเสนอราคาไม่ถูกต้อง'); }
  if (!bytes.length || bytes.length > QUOTATION_IMAGE_MAX_) throw new Error('รูปใบเสนอราคาต้องมีขนาดไม่เกิน 1 MB');
  const header = (offset, expected) => expected.every((value,index) => (bytes[offset + index] & 255) === value);
  const valid = {
    jpeg: () => header(0,[255,216,255]),
    png: () => header(0,[137,80,78,71,13,10,26,10]),
    webp: () => header(0,[82,73,70,70]) && header(8,[87,69,66,80])
  };
  if (!valid[image[1]]()) throw new Error('ข้อมูลไฟล์ไม่ตรงกับชนิดรูป');

  return {
    year:date.slice(0,4),month:date.slice(5,7),uploadId:payload.uploadId,bytes,
    mimeType:'image/' + image[1],filename:srn + '_' + customer + '.' + (image[1] === 'jpeg' ? 'jpg' : image[1])
  };
}