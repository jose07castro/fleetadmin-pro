const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('🔄 Syncing js/ to www/js/...');
copyDir('js', 'www/js');

console.log('🔄 Syncing css/ to www/css/...');
if (fs.existsSync('css')) {
  copyDir('css', 'www/css');
}

console.log('🔄 Syncing index.html to www/index.html...');
if (fs.existsSync('index.html')) {
  fs.copyFileSync('index.html', 'www/index.html');
}

console.log('✅ Synchronized all files to www/ directory!');
