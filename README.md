# Service Repair Tracking System

Web App ภาษาไทยสำหรับติดตามงานซ่อม ค้นหางานที่เปิดอยู่ จัดการใบเสนอราคา และบันทึกประวัติการดำเนินงาน

## ฐานข้อมูล Google Sheets ใหม่

ใช้ [Service Repair Tracking Database — ฐานข้อมูลใหม่](https://docs.google.com/spreadsheets/d/1vuoYA9ItELkkk-A3fX50vUW-dRVeS3Zt84zqC9R4kmQ) โดย `google-apps-script/RepairDatabase.gs` กำหนด Spreadsheet ID เป็น `1vuoYA9ItELkkk-A3fX50vUW-dRVeS3Zt84zqC9R4kmQ` ฐานใหม่เริ่มจากข้อมูลหลักของช่าง 14 รายการและค่าเกณฑ์แจ้งเตือน 4 ค่า

- งาน ลูกค้า เครื่อง Visits, Attempts, ประวัติ และใบเสนอราคาเก็บแยกแท็บตาม `Schema.gs`
- ระบบบันทึกเวลาและอีเมลผู้บันทึกในประวัติ คำขอที่ส่งซ้ำใช้ `Request_Log` ตรวจรายการเดิม และการแก้ไขงานตรวจเวลาอัปเดตก่อนเขียน
- รูปใบเสนอราคาเก็บในโฟลเดอร์ Google Drive ที่กำหนดใน `QuotationDrive.gs` โดยใช้ชื่อ `SRN_ลูกค้า.นามสกุล` และโฟลเดอร์ `YYYY/MM` ตามวันที่เสนอราคาหรือวันที่แนบรูป ชีต `Quotations` เก็บ ID และตำแหน่งรูป
- เมื่อแท็บ `Users` ว่าง เจ้าของ Google Sheet สามารถเริ่มใช้งานในสิทธิ์ Admin ได้ หากกำหนดรายชื่อแล้ว ให้เพิ่มอีเมลเจ้าของพร้อม `ADMIN` และ `TRUE` ในแท็บนั้นด้วย บทบาท `VIEWER` เปิดอ่านได้ ผู้ใช้ต้องมีสิทธิ์เข้าถึง Sheet และผู้บันทึกรูปต้องเพิ่มไฟล์ในโฟลเดอร์ Drive ได้

## เปิดใช้งานผ่าน Apps Script

1. ใช้ [Apps Script](https://script.google.com/home) เพื่อสร้างโปรเจกต์ด้วยบัญชีเจ้าของฐานข้อมูลใหม่ เพิ่ม `Code.gs`, `Schema.gs`, `RepairDatabase.gs`, `RepairWrites.gs`, `QuotationDrive.gs` และ `Bridge.html` จากโฟลเดอร์ `google-apps-script/`
2. สร้างไฟล์ HTML ชื่อ `Index` แล้วใช้เนื้อหาจาก `google-apps-script/Index.html` หากแก้ไฟล์เว็บ ให้สร้างไฟล์นี้ใหม่ด้วย `node scripts/build-apps-script.cjs`
3. ใน **Project Settings** เปิดการแสดง `appsscript.json` แล้วใช้ manifest ในโฟลเดอร์โครงการ ซึ่งตั้งค่าเวลา `Asia/Bangkok` พร้อมบริการ **Google Sheets API v4** และ **Drive API v3** หากใช้ Google Cloud Project แบบกำหนดเอง ให้เปิด API ทั้งสองใน Cloud Project ด้วย [คู่มือ Advanced Google Services](https://developers.google.com/apps-script/guides/services/advanced)
4. เลือก **Deploy → New deployment → Web app** ตั้ง **Execute as → User accessing the web app** และเริ่มด้วย **Only myself** จากนั้นเปิด URL `/exec` และอนุญาตสิทธิ์ Google Sheets และ Drive [คู่มือ Web Apps](https://developers.google.com/apps-script/guides/web)
5. มุมขวาบนควรขึ้น **Google Sheets** หากเพิ่งเริ่มใช้ รายการงานจะว่าง เมื่อพร้อมเปิดงานจริงให้บันทึกผ่านหน้า Admin แล้วตรวจรายการใน `Repair_Master` และเหตุการณ์ใน `Repair_History`

## เปิดจาก GitHub Pages

เผยแพร่ `index.html` พร้อมไฟล์ JavaScript และ CSS ที่ root ของ repository ผู้ใช้ทำงานบน GitHub Pages โดยตรง และหน้าเว็บเชื่อมกับ Google Sheets ผ่าน Apps Script เบื้องหลังด้วยสิทธิ์ของบัญชี Google เดิม [คู่มือ GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

Apps Script อนุญาตเว็บจาก `https://laserpui.github.io` และเว็บทดสอบบนพอร์ต `8765` ของเครื่อง หากใช้โดเมนอื่น ให้ระบุใน `REPAIR_WEB_ORIGINS_` ของ `Code.gs` แล้วเผยแพร่ Apps Script เวอร์ชันใหม่

หากหน้าเว็บแจ้งว่าเปิดฐานข้อมูลไม่ได้ ให้กด **ตรวจสิทธิ์บัญชี Google** จากนั้นกลับมาแท็บเดิมแล้วกด **ลองใหม่** การเชื่อมต่ออาศัยเซสชัน Google ในเบราว์เซอร์และการอนุญาตให้ใช้เซสชันนั้นในเฟรมของเว็บ

## รหัสเข้า Admin สำหรับระบบงานซ่อม

- ใน Apps Script เปิด **Project Settings → Script Properties** และเพิ่ม `REPAIR_ADMIN_PASSWORD` โดยใช้รหัสที่กำหนด อย่าใส่ค่ารหัสในไฟล์เว็บหรือ GitHub
- เพิ่ม `AdminAccess.gs` และอัปเดต `RepairWrites.gs`, `QuotationDrive.gs`, `Bridge.html` และ `Index.html` ในโปรเจกต์ Apps Script เดิม
- เผยแพร่ Apps Script เวอร์ชันใหม่ที่ deployment เดิมควบคู่กับการอัปโหลด `app.js`, `events.js`, `live.js` และ `output.js` ไปที่ GitHub Pages เว็บและ Apps Script ต้องใช้เวอร์ชันที่รองรับรหัส Admin ทั้งคู่ก่อนเริ่มบันทึก
- เปิด Admin ด้วยบัญชี Google ที่มีบทบาท `ADMIN` แล้วกรอกรหัส เซสชันมีอายุสูงสุด 1 ชั่วโมงและต้องกรอกใหม่เมื่อรีเฟรชหน้า Dashboard และหน้าอ่านข้อมูลยังเปิดด้วยสิทธิ์เดิม

## โหมด Demo

เปิด `demo.html` เพื่อทดลองด้วยข้อมูลจำลอง ไฟล์นี้เป็นต้นทางสำหรับสร้างทั้ง `index.html` และ `google-apps-script/Index.html` ด้วยคำสั่ง `node scripts/build-apps-script.cjs`

หากต้องการเก็บรูปจาก Demo ลงเครื่อง สามารถเลือกโฟลเดอร์หลักใน Chrome หรือ Edge และเปิดหรือดาวน์โหลดรูปจากรายละเอียดงานได้

## การตรวจสอบ

รัน `node --test tests/demo.test.cjs` เพื่อตรวจโหมด Demo และจำลองการอ่านเขียนของ Apps Script รวมการสร้างงาน ประวัติ การส่งคำขอซ้ำ สิทธิ์ และการผูกไฟล์ใบเสนอราคา

## แก้ไขผลใบเสนอราคา

ในหน้าเสนอราคา บัญชี Admin กดค่าหรือไอคอนดินสอในคอลัมน์สถานะใบเสนอราคา วันที่ตัดสินใจ หรือเหตุผลที่ปฏิเสธ เพื่อเปิดฟอร์มข้อมูลเดิม แล้วบันทึกหรือยกเลิกได้ รองรับงานที่ปิดแล้วและเก็บประวัติการแก้ไข โดยใช้ใบเสนอราคาเดิมพร้อมรูปและยอดเงินเดิม

ชุดนี้ต้องอัปโหลด `dashboard.js`, `events.js`, `live.js` ไปยังเว็บ และอัปเดต `RepairWrites.gs` กับ `Index.html` ใน Apps Script แล้ว Deploy เวอร์ชันใหม่ที่ deployment เดิมก่อนใช้งานจริง
