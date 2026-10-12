import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const deployedHtml = [
  "index.html",
  "chat.html",
  "404.html",
  "tools/qr-code/index.html",
  "tools/image-studio/index.html",
  "tools/pdf-studio/index.html",
];
const sourceHtml = [
  "tools/qr-code/client/index.html",
  "tools/image-studio/client/index.html",
];
const failures = [];

for (const relative of [...deployedHtml, ...sourceHtml]) {
  const file = join(root, relative);
  const html = readFileSync(file, "utf8");
  if (!/<html\b/i.test(html)) failures.push(`${relative}: missing <html>`);
  if (!/<meta\s+name=["']description["']/i.test(html)) failures.push(`${relative}: missing description metadata`);
  if (!/<title>[^<]+<\/title>/i.test(html)) failures.push(`${relative}: missing title`);
}

for (const relative of deployedHtml) {
  const file = join(root, relative);
  const html = readFileSync(file, "utf8");
  for (const match of html.matchAll(/(?:href|src)=["']([^"'#?]+)["']/gi)) {
    const target = match[1];
    if (/^(https?:|data:|mailto:|javascript:)/i.test(target)) continue;
    const clean = target.startsWith("/") ? target.slice(1) : target;
    const candidate = target.startsWith("/") ? normalize(join(root, clean)) : normalize(join(dirname(file), clean));
    const choices = extname(candidate) ? [candidate] : [candidate, join(candidate, "index.html"), join(candidate, "index.htm")];
    if (!choices.some((choice) => existsSync(choice))) failures.push(`${relative}: missing ${target}`);
  }
}

if (!existsSync(join(root, "CNAME"))) failures.push("CNAME is missing");
if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`Site checks passed for ${deployedHtml.length} deployed entry points.`);
