// Dependency-free lint: syntax check, unused imports, leftover debug statements.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['server', 'public/js', 'api', 'test', 'scripts'];
const walk = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : /\.m?js$/.test(e.name) ? [full] : [];
      })
    : [];

let problems = 0;
const report = (file, msg) => {
  problems += 1;
  console.error(`${file}: ${msg}`);
};

for (const file of ROOTS.flatMap(walk)) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    report(file, `syntax error\n${err.stderr}`);
    continue;
  }
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1]
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)) {
      const name = part.split(/\s+as\s+/).pop();
      const uses = src.split(new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`)).length - 1;
      if (uses < 2) report(file, `unused import "${name}"`);
    }
  }
  if (file.endsWith('lint.mjs')) continue;
  if (/\bdebugger\b/.test(src)) report(file, 'debugger statement');
  if (/\bTODO\b|\bFIXME\b/.test(src)) report(file, 'unresolved TODO/FIXME');
}
if (problems) {
  console.error(`\n${problems} problem(s) found.`);
  process.exit(1);
}
console.log('lint: ok');
