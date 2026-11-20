"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = filename => fs.readFileSync(path.join(root, filename), "utf8");
const scripts = [];
const html = read("demo.html")
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
