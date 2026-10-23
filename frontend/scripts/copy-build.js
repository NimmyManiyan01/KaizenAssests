import fs from "node:fs";
import path from "node:path";

const src = path.resolve(".output/public");
const targets = [path.resolve("build"), path.resolve("dist")];

if (fs.existsSync(src)) {
  for (const target of targets) {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(src, target, { recursive: true });
    console.log(`[copy-build] Successfully copied ${src} -> ${target}`);
  }
} else {
  console.warn(`[copy-build] Source directory ${src} does not exist.`);
}
