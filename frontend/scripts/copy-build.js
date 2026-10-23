import fs from "node:fs";
import path from "node:path";

const src = path.resolve(".output/public");
const targets = [path.resolve("build"), path.resolve("dist")];

// Generate index.html if not present so static file hosts can serve a root document
const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>KaizenAssests Enterprise Logistics OS</title>
</head>
<body>
  <div id="root"></div>
</body>
</html>`;

if (fs.existsSync(src)) {
  const indexHtmlPath = path.join(src, "index.html");
  if (!fs.existsSync(indexHtmlPath)) {
    fs.writeFileSync(indexHtmlPath, fallbackHtml, "utf-8");
  }

  for (const target of targets) {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(src, target, { recursive: true });
    console.log(`[copy-build] Successfully copied ${src} -> ${target}`);
  }
} else {
  console.warn(`[copy-build] Source directory ${src} does not exist.`);
}
