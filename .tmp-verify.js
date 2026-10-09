// Verify every providers/*.js file loads and exports the function the registry maps.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname);
const registry = require(path.join(root, 'providers', 'registry.js'));
const src = fs.readFileSync(path.join(root, 'providers', 'registry.js'), 'utf8');

const fnMap = {};
const block = src.match(/const providerFunctionMap = \{([\s\S]*?)\n\};/);
for (const m of block[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) fnMap[m[1]] = m[2];

const catMap = {};
const cblock = src.match(/const providerCategoryMap = \{([\s\S]*?)\n\};/);
for (const m of cblock[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) catMap[m[1]] = m[2];

const files = fs.readdirSync(path.join(root, 'providers')).filter(f => f.endsWith('.js') && f !== 'registry.js');
console.log(`providers/ files: ${files.length}\n`);

let bad = 0;
for (const file of files.sort()) {
  const expected = fnMap[file];
  let status, detail = '';
  if (!expected) {
    status = 'NO MAP ENTRY'; detail = '-> would be registered as a broken provider';
    bad++;
  } else {
    try {
      const mod = require(path.join(root, 'providers', file));
      if (typeof mod[expected] !== 'function') {
        status = 'MISSING EXPORT'; detail = `expected ${expected}, exports: ${Object.keys(mod).join(',') || '(none)'}`;
        bad++;
      } else {
        status = 'ok';
        detail = `${expected}  [${catMap[file] || 'MoviesTv (default)'}]`;
      }
    } catch (e) {
      status = 'LOAD FAILED'; detail = e.message.split('\n')[0]; bad++;
    }
  }
  console.log(`${status.padEnd(15)} ${file.padEnd(20)} ${detail}`);
}

console.log(`\nregistered providers: ${registry.listProviders().length}`);
console.log(bad === 0 ? '\nAll provider modules load cleanly.' : `\n${bad} PROBLEM(S) FOUND`);