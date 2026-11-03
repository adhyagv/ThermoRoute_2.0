import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = JSON.parse(fs.readFileSync(path.join(root, 'VERSION.json'), 'utf8')).version;
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
if (packageVersion !== canonical || lock.version !== canonical || lock.packages?.['']?.version !== canonical) {
  console.error(`Version mismatch: VERSION.json=${canonical}, package.json=${packageVersion}, package-lock=${lock.version}`);
  process.exit(1);
}
if (!html.includes(`ThermoRoute ${canonical}`)) {
  console.error(`index.html title/description does not include canonical version ${canonical}`);
  process.exit(1);
}
console.log(`ThermoRoute version aligned: ${canonical}`);
