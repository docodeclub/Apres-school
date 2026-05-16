import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve("dist");
const assetDir = path.join(distDir, "assets");
const referencedExtensions = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".xml", ".txt"]);
const prunableExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"]);
const junkFileNames = new Set([".DS_Store", "Thumbs.db"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : fullPath;
  }));
  return files.flat();
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(distDir)) || !(await exists(assetDir))) {
  console.log("No dist assets to prune.");
  process.exit(0);
}

const files = await walk(distDir);
const referenceText = (
  await Promise.all(files
    .filter((file) => referencedExtensions.has(path.extname(file).toLowerCase()))
    .map((file) => readFile(file, "utf8").catch(() => "")))
).join("\n");

let removed = 0;
let removedBytes = 0;

for (const file of files) {
  if (junkFileNames.has(path.basename(file))) {
    const details = await stat(file);
    await rm(file);
    removed += 1;
    removedBytes += details.size;
    continue;
  }

  const extension = path.extname(file).toLowerCase();
  if (!prunableExtensions.has(extension)) continue;

  const publicPath = `/${path.relative(distDir, file).split(path.sep).join("/")}`;
  if (referenceText.includes(publicPath)) continue;

  const details = await stat(file);
  await rm(file);
  removed += 1;
  removedBytes += details.size;
}

const mb = (removedBytes / 1024 / 1024).toFixed(2);
console.log(`Pruned ${removed} unused public image asset${removed === 1 ? "" : "s"} from dist (${mb} MB).`);
