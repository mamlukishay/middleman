// The style guide under design/system must not drift from the app: every CSS line a
// preview quotes between `/* app: <file> */` and `/* end app */` has to exist,
// character for character (whitespace aside), in that file at the repo root — except
// the backup-c cards, which document the "option C" design that only exists in the
// skeuo worktree, so they are held against that worktree and skipped when it is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const sys = join(root, 'design/system');
const skeuo = join(root, '.claude/worktrees/skeuo/');
const norm = s => s.replace(/\s+/g, ' ').trim();
const app = {};
const appHas = (appRoot, file, line) => {
  const key = appRoot + file;
  app[key] ??= norm(readFileSync(join(appRoot, file), 'utf8'));
  return app[key].includes(norm(line));
};

function* previews(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* previews(p);
    else if (n.endsWith('.html')) yield p;
  }
}

for (const p of previews(sys)) {
  const rel = p.slice(root.length);
  const backup = rel.startsWith('design/system/backup-c/');
  const appRoot = backup ? skeuo : root;
  const skip = backup && !existsSync(join(skeuo, 'style.css')) && 'the skeuo worktree is gone';
  const html = readFileSync(p, 'utf8');
  test(`${rel} is a self-contained card`, () => {
    assert.match(html.split('\n')[0], /^<!-- @dsCard group="[^"]+" -->$/, 'first line is the card marker');
    assert.doesNotMatch(html, /<(link|script)[^>]+(href|src)=["']https?:/, 'no external assets');
  });
  test(`${rel} quotes the app's CSS verbatim`, { skip }, () => {
    const blocks = [...html.matchAll(/\/\* app: ([\w./-]+) \*\/([\s\S]*?)\/\* end app \*\//g)];
    assert.ok(blocks.length, 'at least one quoted block');
    for (const [, file, body] of blocks) {
      // one rule per line, or a rule spread over lines that end mid-declaration:
      // join until braces balance so a multi-line rule is checked as one unit
      let buf = '';
      for (const line of body.split('\n')) {
        if (!line.trim() || line.trim().startsWith('/*')) continue;
        buf += (buf ? '\n' : '') + line;
        const open = (buf.match(/{/g) || []).length, close = (buf.match(/}/g) || []).length;
        if (open > close) continue;
        assert.ok(appHas(appRoot, file, buf), `${file} lacks: ${norm(buf).slice(0, 80)}`);
        buf = '';
      }
    }
  });
}
