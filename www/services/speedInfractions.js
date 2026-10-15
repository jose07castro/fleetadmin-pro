/**
 * services/speedInfractions.js
 *
 * Módulo para la detección y reporte automático de posibles infracciones
 * por exceso de velocidad al pasar por radares y cámaras de fotomulta.
 *
 * Formato requerido para el grupo de WhatsApp "Trabajo":
 * "Alerta, posible infracion , el conductor ( [Nombre] ) ,  al mando de la unidad [Unidad] es posible que alla cometido una onfraccion en la calles: ([Calle1]) intercecion con la calle ([Calle2])."
 */

const fs = require('fs');
const path = require('path');

let _db = null;
let _whatsappBot = null;
let _staticRadars = [];

// JID por defecto del grupo de WhatsApp "Trabajo"
const DEFAULT_TRABAJO_JID = '120363233913674611@g.us';

// Cooldown para evitar alertas repetidas en el mismo radar por el mismo chofer (5 minutos)
const INFRACTION_COOLDOWN_MS = 5 * 60 * 1000;
const _recentInfractions = new Map(); // key: driverId_radarId -> timestamp

/**
 * Cargar base de datos oficial de radares
 */
function _loadRadars() {
    try {
        const radarPath = path.join(__dirname, '..', 'data', 'static_radars.json');
        if (fs.existsSync(radarPath)) {
            _staticRadars = JSON.parse(fs.readFileSync(radarPath, 'utf8'));
            console.log(`📡 [SPEED-INFRACTIONS] Cargados ${_staticRadars.length} radares oficiales para monitoreo.`);
        } else {
            console.warn('⚠️ [SPEED-INFRACTIONS] No se encontró data/static_radars.json');
        }
    } catch (e) {
        console.error('❌ [SPEED-INFRACTIONS] Error cargando static_radars.json:', e.message);
    }
}

/**
 * Inicializar módulo con referencias de Firebase y WhatsappBot
 */
function init(db, whatsappBot) {
    _db = db;
    _whatsappBot = whatsappBot;
    _loadRadars();

    // Limpieza periódica de cooldowns antiguos
    const cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, time] of _recentInfractions.entries()) {
            if (now - time > INFRACTION_COOLDOWN_MS) {
                _recentInfractions.delete(key);
            }
        }
    }, 60000);
    if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

    console.log('🛡️ [SPEED-INFRACTIONS] Servicio de detección de fotomultas inicializado ✅');
}

/**
 * Fórmula de Haversine para distancia en metros
 */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Parsea el nombre o dirección del radar para extraer intersecciones o altura
 */
function parseRadarAddress(radar) {
    const raw = (radar.name || radar.address || '').trim();
    
    // Buscar intersección con " y "
    const partsY = raw.split(/\s+y\s+/i);
    if (partsY.length >= 2) {
        return {
            isIntersection: true,
            street1: partsY[0].trim(),
            street2: partsY.slice(1).join(' y ').trim()
        };
    }

    // Buscar calle con altura numérica (ej: "Laprida 850", "San Lorenzo 1550")
    const numMatch = raw.match(/^(.*?)\s+(\d+)$/);
    if (numMatch) {
        return {
            isIntersection: false,
            street1: numMatch[1].trim(),
            number: numMatch[2].trim()
        };
    }

    return {
        isIntersection: false,
        street1: raw,
        number: null
    };
}

/**
 * Genera el texto del informe con el formato exacto requerido por el usuario
 */
function formatInfractionMessage(driverName, vehicleName, radar, speed) {
    const parsed = parseRadarAddress(radar);
    let locationText = '';

    if (parsed.isIntersection) {
        locationText = `en la calles: (${parsed.street1}) intercecion con la calle (${parsed.street2})`;
    } else if (parsed.number) {
        locationText = `en la calle: (${parsed.street1}) a la altura (${parsed.number})`;
    } else {
        locationText = `en la calle: (${parsed.street1})`;
    }

    const speedRound = Math.round(speed);
    const limit = radar.limit || 40;

    return `Alerta, posible infracion , el conductor ( ${driverName} ) ,  al mando de la unidad ${vehicleName} es posible que alla cometido una onfraccion ${locationText}.\nVelocidad registrada: ${speedRound} km/h (Máxima permitida: ${limit} km/h).`;
}

/**
 * Obtiene el JID del grupo "Trabajo" dinámicamente o retorna el conocido
 */
function getTrabajoGroupJid() {
    if (_whatsappBot && typeof _whatsappBot.getGroupCache === 'function') {
        const cache = _whatsappBot.getGroupCache();
        for (const [jid, name] of Object.entries(cache)) {
            if (typeof name === 'string' && name.trim().toLowerCase().includes('trabajo')) {
                return jid;
            }
        }
    }
    return DEFAULT_TRABAJO_JID;
}

/**
 * Resuelve el conductor y la unidad (vehículo) activa desde Firebase Fleets
 */
async function resolveDriverAndVehicle(driverId, fallbackDriverName) {
    if (!_db) {
        return {
            driverName: fallbackDriverName || 'Chofer',
            vehicleName: 'Unidad de Flota',
            fleetId: null
        };
    }

    try {
        const fleetsSnap = await _db.ref('fleets').once('value');
        const fleets = fleetsSnap.val() || {};

        for (const [fleetId, fleetData] of Object.entries(fleets)) {
            const shifts = fleetData.shifts || {};
            const activeShift = Object.values(shifts).find(s => 
                s.status === 'active' && 
                (s.driverId === driverId || (s.driverName && fallbackDriverName && s.driverName.toLowerCase() === fallbackDriverName.toLowerCase()))
            );

            if (activeShift) {
                let vName = activeShift.vehicleName || '';
                if (!vName && activeShift.vehicleId && fleetData.vehicles && fleetData.vehicles[activeShift.vehicleId]) {
                    const v = fleetData.vehicles[activeShift.vehicleId];
                    vName = (v.name || 'Vehículo') + (v.plate ? ` — ${v.plate}` : '');
                }
                return {
                    driverName: activeShift.driverName || fallbackDriverName || 'Chofer',
                    vehicleName: vName || 'Unidad de Flota',
                    fleetId: fleetId
                };
            }
        }
    } catch (e) {
        console.warn('⚠️ [SPEED-INFRACTIONS] Error buscando turno activo:', e.message);
    }

    return {
        driverName: fallbackDriverName || 'Chofer',
        vehicleName: 'Unidad de Flota',
        fleetId: null
    };
}

/**
 * Reporta una infracción al grupo "Trabajo" y la almacena en Firebase
 */
async function reportInfraction({ driverId, driverName, radar, speed, source = 'monitor' }) {
    if (!radar || !driverId) return { ok: false, reason: 'missing_params' };

    const radarId = radar.id || radar.name;
    const cooldownKey = `${driverId}_${radarId}`;
    const now = Date.now();

    // Comprobar cooldown para no repetir aviso de la misma pasada
    const lastAlert = _recentInfractions.get(cooldownKey) || 0;
    if (now - lastAlert < INFRACTION_COOLDOWN_MS) {
        return { ok: false, reason: 'in_cooldown' };
    }
    _recentInfractions.set(cooldownKey, now);

    // Resolver chofer y vehículo real desde el turno activo
    const resolved = await resolveDriverAndVehicle(driverId, driverName);
    const finalDriverName = resolved.driverName;
    const finalVehicleName = resolved.vehicleName;
    const fleetId = resolved.fleetId;

    // Generar mensaje
    const messageText = formatInfractionMessage(finalDriverName, finalVehicleName, radar, speed);
    console.log(`🚨 [SPEED-INFRACTION] Detectada infracción de ${finalDriverName} (${finalVehicleName}) a ${Math.round(speed)} km/h en radar ${radar.name}:`);
    console.log(messageText);

    // Enviar al grupo "Trabajo" de WhatsApp
    let waResult = null;
    const targetGroupJid = getTrabajoGroupJid();
    if (_whatsappBot && typeof _whatsappBot.sendTextMessage === 'function') {
        try {
            waResult = await _whatsappBot.sendTextMessage(targetGroupJid, messageText);
            console.log(`📤 [SPEED-INFRACTION] Enviado a WhatsApp grupo Trabajo (${targetGroupJid}) ->`, waResult);
        } catch (we) {
            console.error('❌ [SPEED-INFRACTION] Error enviando a WhatsApp:', we.message);
        }
    } else {
        console.warn('⚠️ [SPEED-INFRACTION] WhatsappBot no disponible para enviar mensaje.');
    }

    // Guardar en Firebase para auditoría e historial
    if (_db) {
        try {
            const infractionLog = {
                timestamp: now,
                driverId: driverId,
                driverName: finalDriverName,
                vehicleName: finalVehicleName,
                radarId: radar.id || null,
                radarName: radar.name || null,
                radarAddress: radar.address || null,
                speed: parseFloat(speed) || 0,
                speedLimit: radar.limit || 40,
                source: source,
                targetGroup: targetGroupJid,
                sentWhatsApp: waResult?.success === true
            };

            await _db.ref('speed_infractions').push(infractionLog);
            if (fleetId) {
                await _db.ref(`fleets/${fleetId}/speed_infractions`).push(infractionLog);
            }
        } catch (fe) {
            console.warn('⚠️ [SPEED-INFRACTIONS] Error guardando log en Firebase:', fe.message);
        }
    }

    return { ok: true, message: messageText, waResult };
}

/**
 * Calcula el rumbo (bearing) geodésico de un punto A a un punto B en grados (0-360)
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    let brng = toDeg(Math.atan2(y, x));
    return (brng + 360) % 360;
}

/**
 * Evalúa la posición y velocidad actual de un chofer contra los radares oficiales
 * incorporando validación de corredor y descarte de calles paralelas.
 */
async function checkPosition({ driverId, driverName, lat, lng, speed, heading, source = 'gps' }) {
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) return;
    const speedNum = parseFloat(speed) || 0;

    // Si está detenido o va a paso de hombre (< 15 km/h), no es infracción de velocidad
    if (speedNum < 15) return;

    // Umbral de proximidad física a la cámara de fotomulta (35 metros)
    const PROXIMITY_METERS = 35;

    for (const radar of _staticRadars) {
        const limit = radar.limit || 40;
        // Solo evaluar radares si la velocidad supera el límite
        if (speedNum <= limit) continue;

        const dist = getDistanceMeters(lat, lng, radar.lat, radar.lng);
        if (dist <= PROXIMITY_METERS) {
            // Validar corredor vectorial si hay rumbo (heading) reportado
            if (typeof heading === 'number' && !isNaN(heading) && heading >= 0) {
                const targetBearing = calculateBearing(lat, lng, radar.lat, radar.lng);
                let angleDiff = Math.abs(heading - targetBearing) % 360;
                if (angleDiff > 180) angleDiff = 360 - angleDiff;
                const crossTrack = dist * Math.abs(Math.sin(angleDiff * Math.PI / 180));
                // Descarte de calles paralelas si la desviación lateral supera 35m
                if (crossTrack > 35.0) continue;
            }

            // El vehículo está pasando por la cámara superando el límite de velocidad
            await reportInfraction({
                driverId,
                driverName,
                radar,
                speed: speedNum,
                source
            });
            break;
        }
    }
}

/**
 * Método de prueba manual para verificar que el envío al grupo Trabajo funcione
 */
async function testInfraction(testDriverName = 'Pablo', testVehicleName = 'Chevrolet Cobalt LT (01)', radarIndex = 0, speed = 58) {
    const radar = _staticRadars[radarIndex] || {
        id: 'radar_test',
        name: 'España y San Lorenzo',
        limit: 40
    };

    const messageText = formatInfractionMessage(testDriverName, testVehicleName, radar, speed);
    const targetGroupJid = getTrabajoGroupJid();

    console.log(`🧪 [TEST-INFRACTION] Enviando mensaje de prueba a ${targetGroupJid}:`);
    console.log(messageText);

    if (_whatsappBot && typeof _whatsappBot.sendTextMessage === 'function') {
        return await _whatsappBot.sendTextMessage(targetGroupJid, messageText);
    }
    return { success: false, reason: 'bot_unavailable' };
}

module.exports = {
    init,
    checkPosition,
    reportInfraction,
    testInfraction,
    parseRadarAddress,
    formatInfractionMessage,
    getTrabajoGroupJid,
    resolveDriverAndVehicle,
    getRadars: () => _staticRadars
};
