const REPAIR_WEB_ORIGINS_ = new Set(['https://laserpui.github.io','http://127.0.0.1:8765','http://localhost:8765']);

function doGet(e) {
  const parameters = e?.parameter || {};
  if (parameters.bridge === '1') {
    const {origin,nonce} = parameters;
    if (!REPAIR_WEB_ORIGINS_.has(origin) || !/^[a-f0-9-]{36}$/.test(nonce || '')) {
      return HtmlService.createHtmlOutput('Invalid connection request');
    }
    const bridge = HtmlService.createTemplateFromFile('Bridge');
    bridge.webOrigin = origin;
    bridge.webNonce = nonce;
    return bridge.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  if (parameters.authorize === '1') {
    return HtmlService.createHtmlOutput('<html lang="th"><meta charset="utf-8"><p>กลับไปที่หน้าเว็บแล้วกด “ลองใหม่” เพื่อเชื่อมต่อ Google Sheets</p></html>')
      .setTitle('เชื่อมต่อ Google Sheets');
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Service Repair Tracking')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
