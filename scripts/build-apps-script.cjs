"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = filename => fs.readFileSync(path.join(root, filename), "utf8");
const scriptUrl = "https://script.google.com/macros/s/AKfycbw_FxrH_1bJS4-ZM60f8OyHh5YfgUDHGxYJO6gSAMiOIw5Va-B27RZghK-K0FXoNtxQKQ/exec";
const template = read("demo.html");
fs.writeFileSync(path.join(root,"index.html"),template
  .replace('<body>', '<body data-live-database="true" data-script-url="' + scriptUrl + '">')
  .replace('ข้อมูลจำลอง</span>', 'กำลังโหลด Google Sheets</span>')
  .replace('</main>', '<noscript>เปิด JavaScript เพื่อใช้งานระบบติดตามงานซ่อม</noscript></main>'));
const scripts = [];
const html = template
  .replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, filename) => "<style>\n" + read(filename) + "\n</style>")
  .replace(/ *<script defer src="([^"]+)"><\/script>\r?\n/g, (_, filename) => {
    scripts.push("<script>\n" + read(filename).replace(/<\/script/gi, "<\\/script") + "\n</script>");
    return "";
  })
  .replace("<body>", '<body data-live-database="true">')
  .replace("</body>", () => scripts.join("\n") + "\n</body>");
const output = path.join(root, "google-apps-script", "Index.html");
fs.writeFileSync(output, html);
console.log("Built " + output);
