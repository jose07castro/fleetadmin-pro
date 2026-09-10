const fs = require('fs');
const path = require('path');

const modulesDir = path.join(__dirname, '..', 'www', 'js', 'modules');
const files = fs.readdirSync(modulesDir).filter(f => f.endsWith('.js'));

console.log('Checking modules in www/js/modules for potential missing function definitions...');

files.forEach(file => {
    const filePath = path.join(modulesDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Find all function calls _someFunc(
    const calledFuncs = new Set();
    const regex = /_([a-zA-Z0-9]+)\s*\(/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        calledFuncs.add('_' + match[1]);
    }

    // Find all function declarations / definitions
    const declaredFuncs = new Set();
    const declRegex = /(?:function\s+(_[a-zA-Z0-9]+)|(_[a-zA-Z0-9]+)\s*=\s*(?:function|\([^)]*\)\s*=>|async))/g;
    while ((match = declRegex.exec(content)) !== null) {
        const name = match[1] || match[2];
        if (name) declaredFuncs.add(name);
    }

    // Compare
    const missing = [];
    calledFuncs.forEach(func => {
        if (!declaredFuncs.has(func)) {
            missing.push(func);
        }
    });

    if (missing.length > 0) {
        console.log(`⚠️ ${file}: Missing internal definitions for:`, missing);
    } else {
        console.log(`✅ ${file}: All internal _ functions defined.`);
    }
});
