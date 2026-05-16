import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const distDir = path.resolve("dist");
const indexPath = path.join(distDir, "index.html");
const routes = [
  "bookings",
  "holiday-clubs",
  "wraparound",
  "schools",
  "magicbooking",
  "book-pebble",
  "payments",
  "cancellations",
  "policies",
  "contact",
  "staff-application",
];

const indexHtml = await readFile(indexPath, "utf8");

for (const route of routes) {
  await writeFile(path.join(distDir, `${route}.html`), indexHtml);
  const routeDir = path.join(distDir, route);
  await mkdir(routeDir, { recursive: true });
  await writeFile(path.join(routeDir, "index.html"), indexHtml);
}

console.log(`Created static entry files for ${routes.length} public routes.`);
