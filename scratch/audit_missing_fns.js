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

// Collect all defined global functions and window properties across all files
const definedGlobals = new Set([
  'window', 'document', 'navigator', 'console', 'localStorage', 'sessionStorage',
  'indexedDB', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'fetch', 'alert', 'confirm', 'prompt', 'parseInt', 'parseFloat', 'encodeURIComponent',
  'decodeURIComponent', 'btoa', 'atob', 'Math', 'Date', 'Array', 'Object', 'String',
  'Number', 'Boolean', 'RegExp', 'Error', 'Promise', 'JSON', 'Map', 'Set', 'URL',
  'Blob', 'FormData', 'FileReader', 'Image', 'Audio', 'Notification', 'navigator',
  'firebase', 'google', 'bcrypt', 'Capacitor', 'Cordova', 'sw'
]);

// Read all files content
const fileContents = {};
jsFiles.forEach(f => {
  fileContents[f] = fs.readFileSync(f, 'utf8');
});

// Scan for defined functions, `window.xxx =`, `function xxx(`
jsFiles.forEach(f => {
  const code = fileContents[f];
  
  // function name(...)
  const fnRegex = /function\s+([a-zA-Z0-9_$]+)\s*\(/g;
  let m;
  while ((m = fnRegex.exec(code)) !== null) {
    definedGlobals.add(m[1]);
  }

  // window.name = or window['name'] =
  const winRegex = /window\.([a-zA-Z0-9_$]+)\s*=/g;
  while ((m = winRegex.exec(code)) !== null) {
    definedGlobals.add(m[1]);
  }

  // const/let/var name = function / () =>
  const varFnRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:function|\([^)]*\)\s*=>)/g;
  while ((m = varFnRegex.exec(code)) !== null) {
    definedGlobals.add(m[1]);
  }
});

console.log(`Collected ${definedGlobals.size} defined global symbols.`);

// Now look for global function calls: functionName(...) that might be missing
const potentialCalls = [];
const callRegex = /(?<!\.\s*)(?<!function\s+)\b([a-zA-Z0-9_$]+)\s*\(/g;

jsFiles.forEach(f => {
  const code = fileContents[f];
  let m;
  while ((m = callRegex.exec(code)) !== null) {
    const fnName = m[1];
    if (
      !definedGlobals.has(fnName) &&
      !['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'delete', 'require', 'import', 'export', 'super'].includes(fnName)
    ) {
      potentialCalls.push({ file: path.basename(f), fnName });
    }
  }
});

const missingFnsMap = new Map();
potentialCalls.forEach(({ file, fnName }) => {
  if (!missingFnsMap.has(fnName)) missingFnsMap.set(fnName, new Set());
  missingFnsMap.get(fnName).add(file);
});

console.log('\n--- POTENTIALLY UNDEFINED GLOBAL FUNCTION CALLS ---');
missingFnsMap.forEach((files, fn) => {
  console.log(`Fn: "${fn}" called in [${[...files].join(', ')}]`);
});
