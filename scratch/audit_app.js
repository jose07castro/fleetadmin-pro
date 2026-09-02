const fs = require('fs');
const path = require('path');

// Read index.html
const htmlContent = fs.readFileSync('index.html', 'utf8');

// Extract all id="..." from index.html
const htmlIds = new Set();
const idRegex = /id=["']([^"']+)["']/g;
let match;
while ((match = idRegex.exec(htmlContent)) !== null) {
  htmlIds.add(match[1]);
}

console.log(`Found ${htmlIds.size} IDs in index.html.`);

// Collect all JS files in js/ and js/modules/
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
console.log(`Analyzing ${jsFiles.length} JS files in js/ and js/modules/...`);

// Search for getElementById references
const missingIds = [];
const getElemRegex = /document\.getElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

jsFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = getElemRegex.exec(content)) !== null) {
    const id = m[1];
    // Check if ID is dynamically created or in HTML or inserted by components.js
    if (!htmlIds.has(id)) {
      missingIds.push({ file, id });
    }
  }
});

console.log(`Potential missing getElementById references (not statically in index.html): ${missingIds.length}`);

// Group missing IDs by ID
const missingIdMap = {};
missingIds.forEach(({ file, id }) => {
  if (!missingIdMap[id]) missingIdMap[id] = [];
  missingIdMap[id].push(path.basename(file));
});

console.log('\n--- MISSING IDs SUMMARY (Not in static index.html) ---');
Object.keys(missingIdMap).forEach(id => {
  console.log(`ID: "${id}" in [${[...new Set(missingIdMap[id])].join(', ')}]`);
});
