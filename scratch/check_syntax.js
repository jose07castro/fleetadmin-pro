const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getFiles(d) {
  let r = [];
  for (const f of fs.readdirSync(d)) {
    if (f === 'node_modules' || f === '.git') continue;
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) {
      r = r.concat(getFiles(p));
    } else if (f.endsWith('.js')) {
      r.push(p);
    }
  }
  return r;
}

const files = getFiles('.');
console.log(`Found ${files.length} JS files.`);
let errs = [];
for (const f of files) {
  try {
    execSync(`node --check "${f}"`, { stdio: 'pipe' });
  } catch (e) {
    errs.push({ file: f, err: e.stderr ? e.stderr.toString() : e.message });
  }
}

if (errs.length > 0) {
  console.log('SYNTAX ERRORS:');
  console.log(JSON.stringify(errs, null, 2));
} else {
  console.log('All JS files passed syntax check!');
}
