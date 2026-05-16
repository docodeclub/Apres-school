import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const sensitivePatterns = [
  /Maya Patel/i,
  /Jamie Clarke/i,
  /Nadia Williams/i,
  /Oakfield Primary/i,
  /Riverside School/i,
  /safeguarding issues/i,
  /incident\/safeguarding alerts/i,
  /admin CRM mock/i,
];

const requiredFiles = [
  "index.html",
  "robots.txt",
  "sitemap.xml",
  "site.webmanifest",
  "vercel.json",
  ".env.example",
  "src/app.jsx",
  "src/data.js",
  "src/styles.css",
  "supabase/migrations/0001_initial_schema.sql",
];

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return walk(path);
    return path;
  });
}

const missing = requiredFiles.filter((file) => {
  try {
    statSync(join(root, file));
    return false;
  } catch {
    return true;
  }
});

const textFiles = walk(root).filter((file) => {
  const relative = file.replace(root + "/", "");
  return /\.(html|jsx|js|css|md|json|xml|txt|sql)$/.test(file)
    && !relative.startsWith("scripts/")
    && !relative.startsWith("node_modules/")
    && !relative.startsWith("dist/");
});
const matches = [];

for (const file of textFiles) {
  const content = readFileSync(file, "utf8");
  for (const pattern of sensitivePatterns) {
    if (pattern.test(content)) matches.push(`${file.replace(root + "/", "")}: ${pattern}`);
  }
}

if (missing.length || matches.length) {
  console.error(JSON.stringify({ missing, sensitiveMatches: matches }, null, 2));
  process.exit(1);
}

console.log("Static checks passed.");
