try {
    require('firebase-admin');
    console.log('firebase-admin: OK');
} catch(e) {
    console.log('firebase-admin FAIL:', e.message.split('\n')[0]);
}

var pkg = require('./package.json');
console.log('dependencies:', JSON.stringify(pkg.dependencies || {}));
console.log('DONE');
