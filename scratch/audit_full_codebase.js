const fs = require('fs');
const path = require('path');

console.log('=== APP COMPREHENSIVE AUDIT ===\n');

// 1. Audit Server Endpoints vs Frontend Fetch Calls
const serverJs = fs.readFileSync('server.js', 'utf8');

// Extract all app.get('/api/...'), app.post(...), etc. from server.js
const serverRoutes = new Set();
const serverRouteRegex = /app\.(?:get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g;
let m;
while ((m = serverRouteRegex.exec(serverJs)) !== null) {
  serverRoutes.add(m[1].split('?')[0]);
}

console.log(`Server API endpoints defined in server.js (${serverRoutes.size}):`);
serverRoutes.forEach(r => console.log('  - ' + r));

// Collect frontend fetch routes
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
const fetchCalls = [];

const fetchRegex = /fetch\s*\(\s*[`'"]([^`'"]+)[`'"]/g;
const templateFetchRegex = /fetch\s*\(\s*`([^`]+)`/g;

jsFiles.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  let match;
  while ((match = fetchRegex.exec(code)) !== null) {
    if (match[1].includes('/api/')) {
      fetchCalls.push({ file: path.basename(f), url: match[1] });
    }
  }
  while ((match = templateFetchRegex.exec(code)) !== null) {
    if (match[1].includes('/api/')) {
      fetchCalls.push({ file: path.basename(f), url: match[1] });
    }
  }
});

console.log(`\nFrontend /api/ fetch calls found (${fetchCalls.length}):`);
fetchCalls.forEach(fc => console.log(`  - [${fc.file}] ${fc.url}`));

// 2. Audit DB methods defined in db.js vs DB.xxx calls in modules
const dbJs = fs.readFileSync('js/db.js', 'utf8');
const dbMethods = new Set();
const dbMethodRegex = /^\s*([a-zA-Z0-9_$]+)\s*[:=]\s*(?:async\s*)?function/gm;
let dbMatch;
while ((dbMatch = dbMethodRegex.exec(dbJs)) !== null) {
  dbMethods.add(dbMatch[1]);
}
// Also return object methods in DB = (() => { return { ... }; })();
const dbReturnRegex = /return\s*\{([^}]+)\}/s;
const returnMatch = dbReturnRegex.exec(dbJs);
if (returnMatch) {
  const keys = returnMatch[1].split(',').map(k => k.trim().split(':')[0].trim()).filter(Boolean);
  keys.forEach(k => dbMethods.add(k));
}

console.log(`\nDB methods defined in db.js (${dbMethods.size}):`);
dbMethods.forEach(m => console.log('  - ' + m));

// Find all DB.xxx calls in js/
const dbCalls = new Set();
const dbCallRegex = /DB\.([a-zA-Z0-9_$]+)\s*\(/g;
const missingDbMethods = [];

jsFiles.forEach(f => {
  if (f.endsWith('db.js')) return;
  const code = fs.readFileSync(f, 'utf8');
  let match;
  while ((match = dbCallRegex.exec(code)) !== null) {
    const methodName = match[1];
    dbCalls.add(methodName);
    if (!dbMethods.has(methodName)) {
      missingDbMethods.push({ file: path.basename(f), method: methodName });
    }
  }
});

console.log(`\nMISSING DB METHODS (called in modules but not in db.js): ${missingDbMethods.length}`);
missingDbMethods.forEach(m => console.log(`  ❌ DB.${m.method}() called in ${m.file}`));

// 3. Audit Auth methods defined in auth.js vs Auth.xxx calls
const authJs = fs.readFileSync('js/auth.js', 'utf8');
const authMethods = new Set();
const authReturnMatch = /return\s*\{([^}]+)\}/s.exec(authJs);
if (authReturnMatch) {
  const keys = authReturnMatch[1].split(',').map(k => k.trim().split(':')[0].trim()).filter(Boolean);
  keys.forEach(k => authMethods.add(k));
}

console.log(`\nAuth methods defined in auth.js (${authMethods.size}):`);
authMethods.forEach(m => console.log('  - ' + m));

const missingAuthMethods = [];
const authCallRegex = /Auth\.([a-zA-Z0-9_$]+)\s*\(/g;
jsFiles.forEach(f => {
  if (f.endsWith('auth.js')) return;
  const code = fs.readFileSync(f, 'utf8');
  let match;
  while ((match = authCallRegex.exec(code)) !== null) {
    const methodName = match[1];
    if (!authMethods.has(methodName)) {
      missingAuthMethods.push({ file: path.basename(f), method: methodName });
    }
  }
});

console.log(`\nMISSING Auth METHODS (called in modules but not in auth.js): ${missingAuthMethods.length}`);
missingAuthMethods.forEach(m => console.log(`  ❌ Auth.${m.method}() called in ${m.file}`));

// 4. Audit Assets & Media files existence
console.log('\n--- CHECKING AUDIO & ASSETS EXISTENCE ---');
const mediaRefs = new Set();
const mediaRegex = /['"`]([^'"`]+\.(?:mp3|wav|ogg|png|jpg|jpeg|svg))['"`]/gi;
jsFiles.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  let match;
  while ((match = mediaRegex.exec(code)) !== null) {
    mediaRefs.add(match[1]);
  }
});

const missingAssets = [];
mediaRefs.forEach(ref => {
  if (ref.startsWith('http')) return;
  // Clean query strings or leading slashes
  let cleanRef = ref.split('?')[0].replace(/^\//, '');
  if (!fs.existsSync(cleanRef) && !fs.existsSync(path.join('www', cleanRef))) {
    missingAssets.push(ref);
  }
});

console.log(`Missing Assets referenced in JS (${missingAssets.length}):`);
missingAssets.forEach(a => console.log(`  ❌ Missing asset file: ${a}`));
