const fs = require('fs');
const path = require('path');

function getJsFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getJsFiles(filePath));
    } else if (file.endsWith('.js')) {
      results.push(filePath);
    }
  });
  return results;
}

const jsFiles = getJsFiles('js');

console.log('=== AUDITING RUNTIME HAZARDS IN JS MODULES ===\n');

// 1. Unchecked getElementById().addEventListener / .querySelector / .style / .innerHTML
const unsafeDomAccess = [];
const unsafeDomRegex = /document\.getElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.(addEventListener|querySelector|querySelectorAll|style|classList|innerHTML|innerText|value|src|focus|click|appendChild|insertBefore)/g;

jsFiles.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  const lines = code.split('\n');
  lines.forEach((line, idx) => {
    let match;
    const lineRegex = /document\.getElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)\s*\.(addEventListener|querySelector|querySelectorAll|style|classList|innerHTML|innerText|value|src|focus|click|appendChild|insertBefore)/g;
    while ((match = lineRegex.exec(line)) !== null) {
      // Check if there is an if guard on the same line or line before
      const elementId = match[1];
      const prop = match[2];
      unsafeDomAccess.push({
        file: path.basename(f),
        lineNum: idx + 1,
        elementId,
        prop,
        snippet: line.trim()
      });
    }
  });
});

console.log(`Found ${unsafeDomAccess.length} potentially unsafe document.getElementById(...).property calls without null checks.`);

// 2. Unhandled promises (fetch or async calls without catch or try/catch)
const unhandledFetches = [];
jsFiles.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  const lines = code.split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('fetch(') && !line.includes('.catch(') && !line.includes('try {') && !line.includes('await ')) {
      unhandledFetches.push({ file: path.basename(f), lineNum: idx + 1, snippet: line.trim() });
    }
  });
});

console.log(`Found ${unhandledFetches.length} unhandled raw fetch() calls.`);

// Write detailed hazards to a log
const hazardsReport = {
  unsafeDomAccessCount: unsafeDomAccess.length,
  unsafeDomAccessSamples: unsafeDomAccess.slice(0, 30),
  unhandledFetches
};

fs.writeFileSync('scratch/hazards_report.json', JSON.stringify(hazardsReport, null, 2));
console.log('Report saved to scratch/hazards_report.json');
