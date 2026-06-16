const axios = require('axios');

async function check() {
    try {
        const url = 'https://fleetadmin-web-nueva.onrender.com/sw.js';
        console.log('Fetching live sw.js from:', url);
        const res = await axios.get(url, { timeout: 8000 });
        const content = res.data;
        const match = content.match(/const CACHE_NAME = 'fleetadmin-pro-v(\d+)';/);
        if (match) {
            console.log('Live CACHE_NAME version:', match[1]);
        } else {
            console.log('No cache name match. First 100 chars of file:', content.substring(0, 100));
        }
    } catch (err) {
        console.error('Error fetching live code:', err.message);
    }
}

check();
