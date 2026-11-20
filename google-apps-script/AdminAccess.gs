const REPAIR_ADMIN_SESSION_SECONDS_ = 3600;

function unlockRepairAdmin(password) {
  const email = repairUserEmail_();
  repairCheck_(repairUserRole_(readRepairDatabase_(),email) === 'ADMIN','บัญชีนี้ไม่มีสิทธิ์ Admin');
  const configuredPassword = PropertiesService.getScriptProperties().getProperty('REPAIR_ADMIN_PASSWORD');
  repairCheck_(configuredPassword,'ยังไม่ได้ตั้งรหัส Admin ใน Apps Script');
  const cache = CacheService.getUserCache();
  const lock = LockService.getUserLock();
  lock.waitLock(5000);
  try {
    const attempts = Number(cache.get('repair-admin-attempts') || 0);
    repairCheck_(attempts < 5,'กรอกรหัสผิดหลายครั้ง กรุณาลองใหม่ใน 5 นาที');
    if (typeof password !== 'string' || password !== configuredPassword) {
      cache.put('repair-admin-attempts',String(attempts + 1),300);
      throw new Error('รหัส Admin ไม่ถูกต้อง');
    }
    cache.remove('repair-admin-attempts');
    const token = Utilities.getUuid() + Utilities.getUuid();
    cache.put('repair-admin:' + token,email,REPAIR_ADMIN_SESSION_SECONDS_);
    return {token,expiresAt:Date.now() + REPAIR_ADMIN_SESSION_SECONDS_ * 1000};
  } finally {
    lock.releaseLock();
  }
}

function requireRepairAdminSession_(token,email) {
  repairCheck_(typeof token === 'string' && /^[a-f0-9-]{72}$/i.test(token) &&
    CacheService.getUserCache().get('repair-admin:' + token) === email,
    '[ADMIN_SESSION] กรุณากรอกรหัส Admin อีกครั้ง');
}
