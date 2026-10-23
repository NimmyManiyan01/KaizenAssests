import fs from "node:fs";
import path from "node:path";

const src = path.resolve(".output/public");
const targets = [path.resolve("build"), path.resolve("dist")];

if (fs.existsSync(src)) {
  const assetsDir = path.join(src, "assets");
  let scriptTags = "";
  let styleTags = "";

  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    const cssFiles = files.filter((f) => f.endsWith(".css"));

    // Sort JS files so root/index bundles are loaded first
    const jsFiles = files.filter(
      (f) =>
        f.endsWith(".js") &&
        (f.startsWith("root-") ||
          f.startsWith("index-") ||
          f.startsWith("router-") ||
          f.startsWith("routes-") ||
          f.startsWith("start-")),
    );

    styleTags = cssFiles.map((f) => `<link rel="stylesheet" href="/assets/${f}">`).join("\n  ");
    scriptTags = jsFiles.map((f) => `<script type="module" src="/assets/${f}"></script>`).join("\n  ");
  }

  const indexHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>KaizenAssests Enterprise Logistics OS</title>
  ${styleTags}
</head>
<body class="bg-white text-slate-900 selection:bg-cyan-600 selection:text-white">
  <div id="root"></div>
  ${scriptTags}
</body>
</html>`;

  const indexHtmlPath = path.join(src, "index.html");
  fs.writeFileSync(indexHtmlPath, indexHtmlContent, "utf-8");
  console.log(`[copy-build] Generated index.html with linked assets: \n${indexHtmlContent}`);

  for (const target of targets) {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(src, target, { recursive: true });
    console.log(`[copy-build] Successfully copied ${src} -> ${target}`);
  }
} else {
  console.warn(`[copy-build] Source directory ${src} does not exist.`);
}
