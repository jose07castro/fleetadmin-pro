const fs = require('fs');
const path = require('path');

function searchDir(dir, query) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            searchDir(fullPath, query);
        } else if (file.endsWith('.java') || file.endsWith('.js') || file.endsWith('.xml')) {
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                if (content.toLowerCase().includes(query.toLowerCase())) {
                    console.log(`Match in ${fullPath}`);
                    const lines = content.split('\n');
                    lines.forEach((line, idx) => {
                        if (line.toLowerCase().includes(query.toLowerCase())) {
                            console.log(`  L${idx + 1}: ${line.trim()}`);
                        }
                    });
                }
            } catch(e) {}
        }
    }
}

console.log("Searching android for 'reporte'...");
searchDir('./android', 'reporte');

console.log("\nSearching android for 'speech' or 'tts'...");
searchDir('./android', 'speech');
searchDir('./android', 'tts');

console.log("\nSearching android for 'textToSpeech'...");
searchDir('./android', 'textToSpeech');
