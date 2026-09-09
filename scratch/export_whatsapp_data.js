const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const possiblePaths = [
    path.join(__dirname, '../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json'),
    path.join(__dirname, '../../fleetadmin-pro-firebase-adminsdk-fbsvc-2e94e5db0a.json')
];

let credPath = possiblePaths.find(p => fs.existsSync(p));

if (!credPath) {
    console.error('❌ No se encontró el archivo de credenciales de Firebase');
    process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(credPath, 'utf8'));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://fleetadmin-pro-default-rtdb.firebaseio.com'
});

const db = admin.database();

async function main() {
    console.log('🔍 Extrayendo datos de comprobantes y movimientos desde WhatsApp / Firebase...');
    const rootSnap = await db.ref().once('value');
    const data = rootSnap.val() || {};

    const rows = [];
    rows.push(['ID', 'Origen', 'Fecha', 'Tipo', 'Monto ($)', 'Emisor/Receptor', 'Concepto', 'Grupo / Teléfono', 'Detalles / Texto']);

    // 1. Movimientos en fleets/*/movements
    if (data.fleets) {
        for (const [fleetId, fleetData] of Object.entries(data.fleets)) {
            if (fleetData.movements) {
                for (const [movId, mov] of Object.entries(fleetData.movements)) {
                    rows.push([
                        mov.id || movId,
                        'WhatsApp / App',
                        mov.date || new Date(mov.createdAt || Date.now()).toISOString(),
                        mov.type || 'N/A',
                        mov.amount || 0,
                        mov.party || 'N/A',
                        mov.concept || 'N/A',
                        mov.senderPhone || fleetId,
                        `Flota: ${fleetId}`
                    ]);
                }
            }
        }
    }

    // 2. Comprobantes o Alertas en bot_alerts
    if (data.bot_alerts) {
        for (const [alertId, alert] of Object.entries(data.bot_alerts)) {
            const dateStr = alert.timestamp ? new Date(alert.timestamp).toISOString() : 'N/A';
            const groupStr = alert.group || 'N/A';
            const textStr = (alert.text || '').replace(/"/g, '""');
            rows.push([
                alertId,
                'WhatsApp Bot',
                dateStr,
                alert.analysis?.type || 'Alerta WhatsApp',
                0,
                'Grupo WhatsApp',
                alert.analysis?.description || 'Registro de Chat',
                groupStr,
                textStr
            ]);
        }
    }

    // Exportar CSV
    const csvContent = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const csvPath = path.join(__dirname, 'hoja_de_calculo_flota.csv');
    fs.writeFileSync(csvPath, csvContent, 'utf8');

    // Exportar HTML Hoja de Cálculo interactiva para abrir directamente en Excel / Navegador
    const htmlTable = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Hoja de Cálculo - Movimientos y Comprobantes Flota</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f172a; color: #f8fafc; padding: 20px; }
        h1 { color: #38bdf8; font-size: 24px; margin-bottom: 5px; }
        p { color: #94a3b8; font-size: 14px; margin-bottom: 20px; }
        .summary { display: flex; gap: 20px; margin-bottom: 20px; }
        .card { background: #1e293b; border: 1px solid #334155; padding: 15px 20px; border-radius: 8px; flex: 1; }
        .card .title { font-size: 12px; color: #94a3b8; text-transform: uppercase; }
        .card .value { font-size: 22px; font-weight: bold; margin-top: 5px; }
        .card.green .value { color: #10b981; }
        .card.red .value { color: #f43f5e; }
        .card.blue .value { color: #38bdf8; }
        table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #334155; font-size: 13px; }
        th { background: #0f172a; color: #cbd5e1; font-weight: 600; }
        tr:hover { background: #334155; }
        .badge { padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; }
        .badge.ingreso { background: rgba(16, 185, 129, 0.2); color: #34d399; }
        .badge.egreso { background: rgba(244, 63, 94, 0.2); color: #fb7185; }
        .btn-export { background: #10b981; color: white; border: none; padding: 10px 18px; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 15px; }
        .btn-export:hover { background: #059669; }
    </style>
</head>
<body>
    <h1>📊 Hoja de Cálculo — FleetAdmin Pro</h1>
    <p>Generado automáticamente con todos los movimientos y datos procesados por WhatsApp y la App.</p>
    
    <button class="btn-export" onclick="exportCSV()">📥 Descargar en Excel (.csv)</button>

    <table id="dataTable">
        <thead>
            <tr>
                ${rows[0].map(h => `<th>${h}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
            ${rows.slice(1).map(r => `
                <tr>
                    <td><code>${r[0]}</code></td>
                    <td>${r[1]}</td>
                    <td>${r[2]}</td>
                    <td><span class="badge ${String(r[3]).toLowerCase()}">${r[3]}</span></td>
                    <td><strong>$${Number(r[4]).toLocaleString('es-AR', {minimumFractionDigits: 2})}</strong></td>
                    <td>${r[5]}</td>
                    <td>${r[6]}</td>
                    <td>${r[7]}</td>
                    <td>${r[8]}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>

    <script>
        function exportCSV() {
            const a = document.createElement('a');
            a.href = './hoja_de_calculo_flota.csv';
            a.download = 'hoja_de_calculo_flota.csv';
            a.click();
        }
    </script>
</body>
</html>`;

    const htmlPath = path.join(__dirname, 'hoja_de_calculo_flota.html');
    fs.writeFileSync(htmlPath, htmlTable, 'utf8');

    console.log(`✅ Archivo CSV generado en: ${csvPath}`);
    console.log(`✅ Archivo HTML interactivo generado en: ${htmlPath}`);
    console.log(`Total registros exportados: ${rows.length - 1}`);
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
