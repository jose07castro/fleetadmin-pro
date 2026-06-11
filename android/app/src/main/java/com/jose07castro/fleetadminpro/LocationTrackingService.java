package com.jose07castro.fleetadminpro;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.Process;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.net.wifi.WifiManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.firebase.database.DataSnapshot;
import com.google.firebase.database.DatabaseError;
import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;
import com.google.firebase.database.ValueEventListener;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * LocationTrackingService — Persistent Foreground Service (v5.2 - Background Inmortal)
 *
 * CAMBIOS v5.2 (Background fixes):
 *   - Notificación sube de PRIORITY_MIN a PRIORITY_LOW: Android no mata servicios con prioridad baja.
 *   - onTaskRemoved(): usa startForegroundService() en lugar de startService() para Android 12+.
 *   - onLowMemory(): re-adquiere WakeLock si lo soltó por presión de memoria.
 *   - onDestroy(): auto-reinicio via Intent demorado para sobrevivir kills del sistema.
 */
public class LocationTrackingService extends Service implements TextToSpeech.OnInitListener {

    private static final String TAG = "FleetGPS";
    private static final String CHANNEL_ID = "fleet_gps_tracking";
    private static final int NOTIFICATION_ID = 7001;
    private static final String PREFS_NAME = "fleet_gps_prefs";

    // GPS Config
    private static final long MIN_TIME_MS = 1000;   // 1 segundo (agresivo para evitar suspension del GPS)
    private static final float MIN_DISTANCE_M = 0f;

    // Proximity Config (Radarbot)
    private static final int PROXIMITY_RADIUS_M = 600;  // Avisar a 600 metros
    private static final long COOLDOWN_MS = 4 * 60 * 1000; // 4 min entre avisos del mismo radar

    // State
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private LocationDbHelper dbHelper;
    private Handler watchdogHandler;
    private Runnable watchdogRunnable;
    private boolean isTracking = false;
    private boolean isSendingQueue = false;

    // Text To Speech (Radarbot Voice)
    private TextToSpeech tts;
    private boolean isTtsInitialized = false;

    // Background Thread
    private HandlerThread serviceThread;
    private Handler serviceHandler;

    // Firebase Direct
    private DatabaseReference dbRef;
    private DatabaseReference alertsRef;
    private String userId;
    private String driverName;
    private String fleetId;
    private String serverUrl;

    // Heartbeat monitoring
    private long lastHeartbeatTime = 0;
    private Handler heartbeatHandler;
    private Runnable heartbeatRunnable;
    private android.content.BroadcastReceiver gpsStatusReceiver;
    private boolean lastPermissionsOk = true;

    // Data lists for Proximity
    private final List<TrafficAlert> activeAlerts = new ArrayList<>();
    private final Map<String, Long> lastAlertTimestamps = new HashMap<>();
    private final List<String> spokenAlertIds = new ArrayList<>();
    private long serviceStartTime = 0;

    // Last data
    private double lastLat = 0;
    private double lastLng = 0;
    private float lastSpeed = 0;
    private float lastBearing = 0;
    private long lastGPSTimestamp = 0;

    // Entity for internal alert tracking
    private static class TrafficAlert {
        String id;
        String type;
        double lat;
        double lng;
        String location;
        String originalText;
        long timestamp;
        String audioUrl;

        TrafficAlert(String id, String type, double lat, double lng, String location, String originalText, long timestamp, String audioUrl) {
            this.id = id;
            this.type = type;
            this.lat = lat;
            this.lng = lng;
            this.location = location;
            this.originalText = originalText;
            this.timestamp = timestamp;
            this.audioUrl = audioUrl;
        }
    }

    // ================================================================
    // LIFECYCLE
    // ================================================================    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "🚀 onCreate() — Inicializando motor GPS Indestructible v5.1");
        serviceStartTime = System.currentTimeMillis();

        createNotificationChannel();

        // 1. Thread de fondo prioritario
        serviceThread = new HandlerThread("GPSServiceThread", Process.THREAD_PRIORITY_URGENT_DISPLAY);
        serviceThread.start();
        serviceHandler = new Handler(serviceThread.getLooper());

        // Inicializar SQLite
        dbHelper = new LocationDbHelper(this);
        try {
            dbHelper.pruneQueue(100); // Limitar la cola a los últimos 100 puntos en el arranque para evitar sobrecarga y batería
        } catch (Exception e) {
            Log.e(TAG, "❌ Error al podar la cola de base de datos:", e);
        }

        // 2. Firebase Database Ref
        try {
            dbRef = FirebaseDatabase.getInstance().getReference("driver_positions");
            dbRef.keepSynced(true);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error al conectar con Firebase:", e);
        }

        // 3. Inicializar TTS
        tts = new TextToSpeech(this, this);
        
        // 4. Inicializar FusedLocation
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);

        // Registrar escuchador de GPS
        gpsStatusReceiver = new android.content.BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (android.location.LocationManager.PROVIDERS_CHANGED_ACTION.equals(intent.getAction())) {
                    android.location.LocationManager locationManager = (android.location.LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
                    boolean isGpsEnabled = locationManager.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER);
                    Log.i(TAG, "🔌 [RECEIVER] GPS status changed: isGpsEnabled = " + isGpsEnabled);
                    
                    String eventType = isGpsEnabled ? "gps_activado" : "gps_desactivado";
                    
                    // Update Firebase immediately
                    updateFirebaseGpsStatus(eventType, isGpsEnabled);
                    
                    // Send alert to server
                    sendEventToServer(eventType);
                }
            }
        };
        android.content.IntentFilter filter = new android.content.IntentFilter(android.location.LocationManager.PROVIDERS_CHANGED_ACTION);
        registerReceiver(gpsStatusReceiver, filter);
        Log.i(TAG, "🔌 Registered GPS providers BroadcastReceiver");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "▶️ onStartCommand() — Reforzando persistencia");

        if (intent != null) {
            String intentUserId = intent.getStringExtra("userId");
            String intentDriverName = intent.getStringExtra("driverName");
            String intentFleetId = intent.getStringExtra("fleetId");
            String intentServerUrl = intent.getStringExtra("serverUrl");

            if (intentUserId != null && !intentUserId.isEmpty()) {
                // Arranque NORMAL desde la app — guardar en SharedPreferences
                userId = intentUserId;
                driverName = intentDriverName;
                fleetId = intentFleetId;
                serverUrl = intentServerUrl;
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                SharedPreferences.Editor editor = prefs.edit();
                editor.putString("userId", userId);
                if (driverName != null) editor.putString("driverName", driverName);
                if (fleetId != null) editor.putString("fleetId", fleetId);
                if (serverUrl != null) editor.putString("serverUrl", serverUrl);
                editor.apply();
                Log.i(TAG, "✅ Credenciales recibidas — userId: " + userId + " | serverUrl: " + serverUrl);
            } else {
                // Reinicio del sistema con Intent vacío (onTaskRemoved / onDestroy / START_STICKY)
                // El Intent no es null pero tampoco trae userId → restaurar desde SharedPreferences
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                userId = prefs.getString("userId", userId); // mantener en memoria si ya lo tiene
                driverName = prefs.getString("driverName", driverName != null ? driverName : "Chofer");
                fleetId = prefs.getString("fleetId", fleetId);
                serverUrl = prefs.getString("serverUrl", serverUrl);
                Log.i(TAG, "🔁 Reinicio — userId restaurado desde prefs: " + userId);
            }
        } else {
            // START_STICKY con intent=null — restaurar desde SharedPreferences
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            userId = prefs.getString("userId", null);
            driverName = prefs.getString("driverName", "Chofer");
            fleetId = prefs.getString("fleetId", null);
            serverUrl = prefs.getString("serverUrl", null);
            Log.i(TAG, "🔁 START_STICKY — userId restaurado: " + userId);
        }

        // Notificación de alta prioridad para evitar cierre por sistema
        Notification notification = buildNotification(
            "Punto Alertas: Turno activo",
            "📍 Monitoreando ruta con protección de batería..."
        );

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            Log.e(TAG, "⚠️ Error startForeground:", e);
        }

        acquireWakeLock();

        if (!isTracking) {
            startLocationUpdates();
            isTracking = true;
        }

        if (fleetId != null) {
            startTrafficAlertsListener();
        }

        startWatchdog();

        // Iniciar pings periódicos
        startHeartbeatTimer();

        return START_STICKY; // El sistema lo reinicia si muere
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.w(TAG, "⚠️ App cerrada desde recientes. Manteniendo servicio GPS activo...");
        Intent restartServiceIntent = new Intent(getApplicationContext(), this.getClass());
        restartServiceIntent.setPackage(getPackageName());
        if (userId != null) restartServiceIntent.putExtra("userId", userId);
        if (driverName != null) restartServiceIntent.putExtra("driverName", driverName);
        if (fleetId != null) restartServiceIntent.putExtra("fleetId", fleetId);
        if (serverUrl != null) restartServiceIntent.putExtra("serverUrl", serverUrl);
        androidx.core.content.ContextCompat.startForegroundService(getApplicationContext(), restartServiceIntent);
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "⛔ onDestroy() — El servicio está siendo destruido");
        isTracking = false;
        stopLocationUpdates();
        releaseWakeLock();
        
        // Desregistrar receptor GPS
        try {
            unregisterReceiver(gpsStatusReceiver);
        } catch (Exception e) {}
        
        // Detener timer de latidos
        if (heartbeatHandler != null && heartbeatRunnable != null) {
            heartbeatHandler.removeCallbacks(heartbeatRunnable);
        }
        
        // Auto-reinicio solo si no fue apagado voluntario (se verifica si hay userId en SharedPreferences)
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String savedUserId = prefs.getString("userId", null);
        
        if (savedUserId != null) {
            final String savedDriverName = prefs.getString("driverName", driverName);
            final String savedFleetId = prefs.getString("fleetId", fleetId);
            final String savedServerUrl = prefs.getString("serverUrl", serverUrl);
            
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    Intent restartIntent = new Intent(getApplicationContext(), LocationTrackingService.class);
                    restartIntent.putExtra("userId", savedUserId);
                    if (savedDriverName != null) restartIntent.putExtra("driverName", savedDriverName);
                    if (savedFleetId != null) restartIntent.putExtra("fleetId", savedFleetId);
                    if (savedServerUrl != null) restartIntent.putExtra("serverUrl", savedServerUrl);
                    
                    androidx.core.content.ContextCompat.startForegroundService(getApplicationContext(), restartIntent);
                    Log.i(TAG, "🔁 Auto-reinicio post-destroy disparado");
                } catch (Exception e) {
                    Log.e(TAG, "❌ Auto-reinicio fallido:", e);
                }
            }, 2000);
        } else {
            Log.i(TAG, "🛑 Cierre voluntario detectado (sin credenciales en SharedPreferences). No se reiniciará el servicio.");
        }
        super.onDestroy();
    }

    @Override
    public void onLowMemory() {
        super.onLowMemory();
        // Fix v5.2: bajo presión de memoria, Android puede soltar el WakeLock.
        // Re-adquirirlo asegura que el CPU no entre en deep sleep mientras rastreamos.
        Log.w(TAG, "💾 onLowMemory() — Re-adquiriendo WakeLock bajo presión de memoria");
        if (isTracking) {
            releaseWakeLock();
            acquireWakeLock();
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ================================================================
    // GPS NATIVO REFORZADO
    // ================================================================

    private void startLocationUpdates() {
        LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000)
            .setMinUpdateIntervalMillis(1000)
            .setMaxUpdateDelayMillis(0)  // Sin batching — entrega inmediata de cada punto GPS
            .setMinUpdateDistanceMeters(MIN_DISTANCE_M)
            .setWaitForAccurateLocation(false)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult locationResult) {
                for (Location location : locationResult.getLocations()) {
                    processNewLocation(location);
                }
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, serviceHandler.getLooper());
            Log.i(TAG, "✅ Motor GPS Activo (Fondo)");
        } catch (SecurityException e) {
            Log.e(TAG, "❌ Permisos GPS denegados");
        }
    }

    private void stopLocationUpdates() {
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
    }

    private void processNewLocation(Location location) {
        lastLat = location.getLatitude();
        lastLng = location.getLongitude();
        lastSpeed = location.getSpeed() * 3.6f;
        lastBearing = location.getBearing();
        lastGPSTimestamp = System.currentTimeMillis();

        // 1. Radarbot Engine
        checkProximityToAlerts(location);

        // 2. Firebase Direct / SQLite Queue (Asíncrono en serviceHandler)
        serviceHandler.post(() -> {
            int battery = getBatteryLevel();
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
            String timestamp = sdf.format(new Date());

            if (isNetworkAvailable()) {
                sendQueuedLocations();
                pushSingleToFirebaseAsync(lastLat, lastLng, lastSpeed, lastBearing, battery, timestamp, "native_foreground_v5_1", (error, ref) -> {
                    if (error != null) {
                        serviceHandler.post(() -> {
                            dbHelper.enqueueLocation(lastLat, lastLng, lastSpeed, lastBearing, battery, timestamp);
                            Log.i(TAG, "💾 Firebase falló. Encolando posición actual. Cola: " + dbHelper.getQueueSize());
                            updateStatusNotification();
                        });
                    }
                });
            } else {
                dbHelper.enqueueLocation(lastLat, lastLng, lastSpeed, lastBearing, battery, timestamp);
                Log.i(TAG, "💾 Sin red. Encolando posición actual. Cola: " + dbHelper.getQueueSize());
            }

            // 3. UI Sync (WebView)
            sendToWebView(lastLat, lastLng, lastSpeed, lastBearing);

            // 4. Update Notification
            updateStatusNotification();
        });
    }

    // ================================================================
    // RADARBOT ENGINE (Proximity Check)
    // ================================================================

    private void checkProximityToAlerts(Location myLocation) {
        if (activeAlerts.isEmpty()) return;

        synchronized (activeAlerts) {
            for (TrafficAlert alert : activeAlerts) {
                float[] results = new float[1];
                Location.distanceBetween(myLocation.getLatitude(), myLocation.getLongitude(), 
                                       alert.lat, alert.lng, results);
                float distance = results[0];

                if (distance <= PROXIMITY_RADIUS_M) {
                    long now = System.currentTimeMillis();
                    long lastTime = lastAlertTimestamps.getOrDefault(alert.id, 0L);

                    if (now - lastTime > COOLDOWN_MS) {
                        speakProximityWarning(alert, distance);
                        lastAlertTimestamps.put(alert.id, now);
                    }
                }
            }
        }
    }

    private void speakProximityWarning(TrafficAlert alert, float distance) {
        String typeLabel = "alerta";
        if (alert.type != null) {
            switch (alert.type) {
                case "police": case "checkpoint": typeLabel = "control policial"; break;
                case "radar": typeLabel = "radar de velocidad"; break;
                case "helicopter": typeLabel = "operativo sanitario"; break;
                case "traffic": typeLabel = "congestión de tráfico"; break;
                case "accident": typeLabel = "accidente"; break;
            }
        }

        String message = String.format("Atención, %s a quinientos metros.", typeLabel);
        speak(message);
    }

    // ================================================================
    // TRAFFIC ALERTS LISTENER (Firebase)
    // ================================================================

    private Double getDoubleValue(DataSnapshot snapshot) {
        Object val = snapshot.getValue();
        if (val == null) return null;
        if (val instanceof Number) {
            return ((Number) val).doubleValue();
        }
        if (val instanceof String) {
            try {
                return Double.parseDouble((String) val);
            } catch (NumberFormatException e) {
                Log.w(TAG, "⚠️ Failed to parse double from string: " + val);
                return null;
            }
        }
        return null;
    }

    private Long getLongValue(DataSnapshot snapshot) {
        Object val = snapshot.getValue();
        if (val == null) return null;
        if (val instanceof Number) {
            return ((Number) val).longValue();
        }
        if (val instanceof String) {
            try {
                return Long.parseLong((String) val);
            } catch (NumberFormatException e) {
                Log.w(TAG, "⚠️ Failed to parse long from string: " + val);
                return null;
            }
        }
        return null;
    }

    private String getStringValue(DataSnapshot snapshot) {
        Object val = snapshot.getValue();
        if (val == null) return null;
        return val.toString();
    }

    private final ValueEventListener alertsListener = new ValueEventListener() {
        @Override
        public void onDataChange(@NonNull DataSnapshot snapshot) {
            Log.i(TAG, "🔔 [ALERTS] onDataChange: snapshot.getChildrenCount() = " + snapshot.getChildrenCount());
            synchronized (activeAlerts) {
                activeAlerts.clear();
                long now = System.currentTimeMillis();
                int loadedCount = 0;

                for (DataSnapshot child : snapshot.getChildren()) {
                    try {
                        String id = child.getKey();
                        String type = getStringValue(child.child("type"));
                        Double lat = getDoubleValue(child.child("lat"));
                        Double lng = getDoubleValue(child.child("lng"));
                        String location = getStringValue(child.child("location"));
                        String originalText = getStringValue(child.child("originalText"));
                        Long timestamp = getLongValue(child.child("timestamp"));
                        String status = getStringValue(child.child("status"));
                        Long expiresAt = getLongValue(child.child("expiresAt"));
                        String audioUrl = getStringValue(child.child("audioUrl"));

                        Log.d(TAG, "🔔 [ALERTS] parsing alert id=" + id + ", type=" + type + ", lat=" + lat + ", lng=" + lng + ", status=" + status + ", expiresAt=" + expiresAt);

                        if (lat != null && lng != null && "active".equals(status) && (expiresAt == null || expiresAt > now)) {
                            TrafficAlert alert = new TrafficAlert(
                                id, 
                                type, 
                                lat, 
                                lng, 
                                location != null ? location : "", 
                                originalText != null ? originalText : "", 
                                timestamp != null ? timestamp : 0L,
                                audioUrl != null ? audioUrl : ""
                            );
                            activeAlerts.add(alert);
                            loadedCount++;

                            // Immediate announcement check
                            if (alert.timestamp >= serviceStartTime - 5000 && !spokenAlertIds.contains(id)) {
                                // Skip native TTS if the alert contains an audio file (to avoid speaking "atencion reporte de voz")
                                if (alert.audioUrl == null || alert.audioUrl.isEmpty()) {
                                    speakImmediateAlert(alert);
                                } else {
                                    Log.i(TAG, "🎵 [ALERTS] Skipping native TTS for audio alert: id=" + id);
                                }
                                spokenAlertIds.add(id);
                                if (spokenAlertIds.size() > 200) {
                                    spokenAlertIds.remove(0);
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "❌ [ALERTS] Error parsing alert child: " + child.getKey(), e);
                    }
                }
                Log.i(TAG, "🔔 [ALERTS] Successfully parsed " + loadedCount + " active alerts. Total loaded in memory: " + activeAlerts.size());
            }
        }

        @Override
        public void onCancelled(@NonNull DatabaseError error) {
            Log.w(TAG, "📡 [ALERTS] Listener cancelled: " + error.getMessage());
        }
    };

    private void startTrafficAlertsListener() {
        Log.i(TAG, "📡 [ALERTS] startTrafficAlertsListener. fleetId: " + fleetId);
        if (fleetId == null || fleetId.isEmpty()) {
            Log.w(TAG, "⚠️ [ALERTS] Cannot start traffic alerts listener: fleetId is null or empty!");
            return;
        }
        if (alertsRef != null) {
            Log.i(TAG, "📡 [ALERTS] Removing previous database listener");
            alertsRef.removeEventListener(alertsListener);
        }
        alertsRef = FirebaseDatabase.getInstance().getReference("fleets").child(fleetId).child("traffic_alerts");
        alertsRef.addValueEventListener(alertsListener);
        Log.i(TAG, "📡 [ALERTS] Listening on fleets/" + fleetId + "/traffic_alerts");
    }

    // ================================================================
    // TEXT TO SPEECH
    // ================================================================

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS) {
            Locale spanish = new Locale("es", "ES");
            int result = tts.setLanguage(spanish);
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "⚠️ TTS: es_ES not supported. Trying generic 'es' locale...");
                result = tts.setLanguage(new Locale("es"));
            }
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "⚠️ TTS: 'es' not supported. Using default system locale.");
                tts.setLanguage(Locale.getDefault());
            }
            isTtsInitialized = true;
            Log.i(TAG, "🔊 TTS: TextToSpeech Initialized successfully");
        } else {
            Log.e(TAG, "❌ TTS: TextToSpeech Initialization failed with status: " + status);
        }
    }

    private void speak(String text) {
        Log.i(TAG, "🔊 [TTS] speak: \"" + text + "\"");
        if (isTtsInitialized && tts != null) {
            int result = tts.speak(text, TextToSpeech.QUEUE_ADD, null, "alert_" + System.currentTimeMillis());
            if (result == TextToSpeech.ERROR) {
                Log.e(TAG, "❌ [TTS] tts.speak() returned ERROR");
            }
        } else {
            Log.w(TAG, "⚠️ [TTS] TTS not initialized or null: isTtsInitialized=" + isTtsInitialized);
        }
    }

    private void speakImmediateAlert(TrafficAlert alert) {
        String msg = "Atención. Alerta de tráfico";
        if (alert.type != null) {
            switch (alert.type) {
                case "police": case "checkpoint": msg = "Atención. Control de policía"; break;
                case "radar": msg = "Cuidado. Radar de velocidad"; break;
                case "helicopter": msg = "Alerta. Helicóptero sanitario en zona"; break;
                case "ambulance": msg = "Precaución. Ambulancia en la vía"; break;
                case "firetruck": msg = "Atención. Bomberos en la vía"; break;
                case "municipal": msg = "Cuidado. Control municipal de tránsito"; break;
                case "accident": msg = "Atención. Accidente vial reportado"; break;
                case "traffic": msg = "Aviso. Tráfico lento reportado"; break;
                case "warning": msg = "Atención. Alerta de tráfico"; break;
            }
        }

        String loc = alert.location;
        if (loc != null) {
            loc = loc.replace(" (ubicación aprox.)", "")
                     .replace(" (ubicación aproximada)", "")
                     .replace(" y ", " esquina ");
        } else {
            loc = "";
        }

        String fullText = "";
        if (alert.originalText != null && !alert.originalText.isEmpty()) {
            String cleanText = alert.originalText
                .replaceAll("https?://\\S+", "") // Remove URL
                .replaceAll("[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ ]", " ") // Leave alphanumeric
                .replaceAll("\\s+", " ") // Normalize spaces
                .trim();

            if (cleanText.length() > 2) {
                fullText = "Atención: " + cleanText + ".";
            } else {
                fullText = !loc.isEmpty() ? msg + " en " + loc + ". Precaución." : msg + ". Precaución.";
            }
        } else {
            fullText = !loc.isEmpty() ? msg + " en " + loc + ". Precaución." : msg + ". Precaución.";
        }

        Log.i(TAG, "🔊 [IMMEDIATE ALERTS] Speaking new alert: " + fullText);
        speak(fullText);
    }

    // ================================================================
    // FIREBASE SYNC
    // ================================================================

    private void pushSingleToFirebaseAsync(double lat, double lng, float speed, float bearing, int battery, String timestamp, String source, com.google.firebase.database.DatabaseReference.CompletionListener listener) {
        if (dbRef == null || userId == null || userId.isEmpty()) {
            if (listener != null) {
                listener.onComplete(com.google.firebase.database.DatabaseError.fromException(new Exception("No user ID or db reference")), null);
            }
            return;
        }

        serviceHandler.post(() -> {
            try {
                // Obtener versión de la app nativa dinámicamente para incluirla en la posición
                String appVersion = "Desconocida";
                try {
                    appVersion = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                } catch (Exception e) {
                    Log.e(TAG, "Error getting versionName in service", e);
                }

                Map<String, Object> data = new HashMap<>();
                data.put("lat", lat);
                data.put("lng", lng);
                data.put("lat_raw", lat);
                data.put("lng_raw", lng);
                data.put("corrected", false);
                data.put("heading", (double) bearing);
                data.put("speed", (double) speed);
                data.put("battery", battery);
                data.put("driverName", driverName != null ? driverName : "Chofer");
                data.put("updated_at", timestamp);
                data.put("_source", source);
                data.put("last_heartbeat", System.currentTimeMillis());

                // Verificar dinámicamente el estado de permisos antes de reportar la ubicación
                boolean hasBgLoc = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    hasBgLoc = checkSelfPermission(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
                } else {
                    hasBgLoc = checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
                }

                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                boolean isIgnoringBatt = true;
                if (pm != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        isIgnoringBatt = pm.isIgnoringBatteryOptimizations(getPackageName());
                    }
                }

                boolean permOk = hasBgLoc && isIgnoringBatt;
                data.put("permissions_ok", permOk);
                data.put("bg_location_ok", hasBgLoc);
                data.put("battery_optimization_ok", isIgnoringBatt);
                data.put("status", permOk ? "active" : "permissions_disabled");
                data.put("gps_status", "active");
                data.put("appVersion", appVersion);

                // FIX: usar updateChildren en lugar de setValue para no borrar appVersion de report-version u otros datos persistidos
                dbRef.child(userId).updateChildren(data, (error, ref) -> {
                    if (error == null) {
                        lastHeartbeatTime = System.currentTimeMillis();
                        Log.i(TAG, "🔌 Location SDK Sent: " + source + ". Lat=" + lat + ", Lng=" + lng);
                    } else {
                        Log.w(TAG, "❌ Firebase write failed: " + error.getMessage());
                    }
                    if (listener != null) {
                        listener.onComplete(error, ref);
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "❌ Error sending location via SDK: " + e.getMessage());
                if (listener != null) {
                    listener.onComplete(com.google.firebase.database.DatabaseError.fromException(e), null);
                }
            }
        });
    }

    private void sendQueuedLocations() {
        if (isSendingQueue) return;
        isSendingQueue = true;

        serviceHandler.post(new Runnable() {
            private boolean called = false;
            private Runnable timeoutRunnable = null;

            @Override
            public void run() {
                List<LocationDbHelper.QueuedLocation> list = dbHelper.getQueuedLocations();
                if (list.isEmpty() || !isNetworkAvailable()) {
                    isSendingQueue = false;
                    updateStatusNotification();
                    return;
                }

                LocationDbHelper.QueuedLocation ql = list.get(0);

                // Timeout de 5s para evitar que la cola se congele indefinidamente si no hay internet pero isNetworkAvailable dio true
                timeoutRunnable = () -> {
                    if (!called) {
                        called = true;
                        Log.w(TAG, "⏰ Timeout esperando confirmación de Firebase para punto " + ql.id);
                        isSendingQueue = false;
                        updateStatusNotification();
                    }
                };
                serviceHandler.postDelayed(timeoutRunnable, 5000);

                pushSingleToFirebaseAsync(ql.lat, ql.lng, ql.speed, ql.bearing, ql.battery, ql.timestamp, "queued_native", (error, ref) -> {
                    serviceHandler.post(() -> {
                        if (called) return; // Ya se disparó el timeout
                        called = true;
                        if (timeoutRunnable != null) {
                            serviceHandler.removeCallbacks(timeoutRunnable);
                        }

                        if (error == null) {
                            dbHelper.deleteLocation(ql.id);
                            // Process next item with a tiny delay to not hog the thread
                            serviceHandler.postDelayed(this, 100);
                        } else {
                            Log.w(TAG, "❌ Error al enviar punto local encolado: " + (error != null ? error.getMessage() : "Desconocido"));
                            isSendingQueue = false;
                            updateStatusNotification();
                        }
                    });
                });
            }
        });
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            android.net.Network network = cm.getActiveNetwork();
            if (network == null) return false;
            NetworkCapabilities capabilities = cm.getNetworkCapabilities(network);
            return capabilities != null && (
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                    capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
        } else {
            android.net.NetworkInfo activeNetworkInfo = cm.getActiveNetworkInfo();
            return activeNetworkInfo != null && activeNetworkInfo.isConnected();
        }
    }

    private int getBatteryLevel() {
        try {
            BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
            return bm != null ? bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : -1;
        } catch (Exception e) { return -1; }
    }

    // ================================================================
    // WATCHDOG & UTILS
    // ================================================================

    private void startWatchdog() {
        if (watchdogHandler != null && watchdogRunnable != null) {
            watchdogHandler.removeCallbacks(watchdogRunnable);
        }

        watchdogHandler = serviceHandler;
        watchdogRunnable = new Runnable() {
            @Override
            public void run() {
                if (!isTracking) return;
                long silenceMs = System.currentTimeMillis() - lastGPSTimestamp;
                
                // Si el GPS no se ha movido o no ha reportado en 60s, reforzamos el binding
                if (lastGPSTimestamp > 0 && silenceMs > 60000) {
                    Log.w(TAG, "⚠️ Vigilante: GPS inactivo por 60s. Reforzando motor...");
                    stopLocationUpdates();
                    startLocationUpdates();
                }
                watchdogHandler.postDelayed(this, 45000); // Revisar cada 45s
            }
        };
        watchdogHandler.postDelayed(watchdogRunnable, 45000);
    }

    private void sendToWebView(double lat, double lng, float speed, float bearing) {
        if (MainActivity.webView == null) return;
        String js = String.format(Locale.US, "javascript:if(window._onNativeGPS) window._onNativeGPS(%f,%f,%f,%f);", lat, lng, speed, bearing);
        MainActivity.webView.post(() -> {
            try {
                if (MainActivity.webView != null) MainActivity.webView.evaluateJavascript(js, null);
            } catch (Exception e) {}
        });
    }

    private void acquireWakeLock() {
        if (wakeLock == null || !wakeLock.isHeld()) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PuntoAlertas::CpuWakeLock");
                wakeLock.acquire();
                Log.i(TAG, "🛡️ WakeLock Reforzado Activo (PuntoAlertas::CpuWakeLock)");
            }
        }
        acquireWifiLock();
    }

    private void acquireWifiLock() {
        if (wifiLock == null || !wifiLock.isHeld()) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "PuntoAlertas::WifiLock");
                } else {
                    wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL, "PuntoAlertas::WifiLock");
                }
                wifiLock.acquire();
                Log.i(TAG, "🛡️ WifiLock Activo");
            }
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
            wifiLock = null;
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Servicio de Rastreo Permanente", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Mantiene el GPS activo en segundo plano para recibir alertas de tráfico.");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String title, String text) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            // Fix v5.2: PRIORITY_LOW en lugar de PRIORITY_MIN.
            // PRIORITY_MIN le indica al sistema que el servicio no es crítico y puede matarlo
            // en situaciones de poca memoria. PRIORITY_LOW lo protege sin molestar al usuario.
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }

    private void updateNotification(String title, String text) {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(title, text));
        } catch (Exception e) {}
    }

    private void updateStatusNotification() {
        int queueSize = dbHelper.getQueueSize();
        if (queueSize > 0) {
            updateNotification(
                "Punto Alertas: Fuera de línea",
                String.format(Locale.US, "📍 Cola: %d puntos retenidos", queueSize)
            );
        } else {
            updateNotification(
                "Punto Alertas: Turno activo",
                String.format(Locale.US, "📍 %.4f, %.4f | %.0f km/h", lastLat, lastLng, lastSpeed)
            );
        }
    }

    // ================================================================
    // SISTEMA DE MONITOREO DE ESTADO Y DESCONEXIÓN (Heartbeats & GPS)
    // ================================================================

    private void startHeartbeatTimer() {
        heartbeatHandler = new Handler(Looper.getMainLooper());
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                if (!isTracking) return;
                
                // Realizar verificación periódica de permisos
                checkAndReportPermissions();

                long now = System.currentTimeMillis();
                if (now - lastHeartbeatTime >= 120000) { // 2 minutos
                    Log.i(TAG, "🏓 Enviando ping de latido silencioso (GPS sin cambio)...");
                    sendSilentHeartbeat();
                }

                // Intentar vaciar la cola por si quedó bloqueada o el conductor está quieto
                if (isNetworkAvailable() && dbHelper.getQueueSize() > 0) {
                    Log.i(TAG, "🔄 Cola activa detectada en latido (" + dbHelper.getQueueSize() + " puntos). Intentando vaciar...");
                    sendQueuedLocations();
                }
                
                heartbeatHandler.postDelayed(this, 60000); // Revisar cada minuto
            }
        };
        heartbeatHandler.postDelayed(heartbeatRunnable, 60000);
    }

    private void checkAndReportPermissions() {
        if (userId == null || userId.isEmpty()) return;

        boolean hasBgLocation = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            hasBgLocation = checkSelfPermission(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
        } else {
            hasBgLocation = checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
        }

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        boolean isIgnoringBattery = true;
        if (pm != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                isIgnoringBattery = pm.isIgnoringBatteryOptimizations(getPackageName());
            }
        }

        boolean currentPermissionsOk = hasBgLocation && isIgnoringBattery;

        // Si cambia el estado de los permisos (eliminada la condición redundante que causaba reportes cada 1 minuto)
        if (currentPermissionsOk != lastPermissionsOk) {
            Log.w(TAG, "🔒 [PERMISSIONS] Check: bgLocation=" + hasBgLocation + " | batteryIgnoring=" + isIgnoringBattery);
            
            // Actualizar Firebase RTDB
            if (dbRef != null) {
                Map<String, Object> updates = new HashMap<>();
                updates.put("permissions_ok", currentPermissionsOk);
                updates.put("bg_location_ok", hasBgLocation);
                updates.put("battery_optimization_ok", isIgnoringBattery);
                if (!currentPermissionsOk) {
                    updates.put("status", "permissions_disabled");
                } else {
                    updates.put("status", "active");
                }
                updates.put("last_heartbeat", System.currentTimeMillis());
                dbRef.child(userId).updateChildren(updates);
            }

            // Enviar evento al servidor via HTTP POST
            if (!currentPermissionsOk && lastPermissionsOk) {
                sendEventToServer("permissions_disabled");
            } else if (currentPermissionsOk && !lastPermissionsOk) {
                sendEventToServer("permissions_enabled");
            }
            
            lastPermissionsOk = currentPermissionsOk;
        }
    }

    private void sendSilentHeartbeat() {
        if (userId == null || userId.isEmpty()) return;

        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        String timestamp = sdf.format(new Date());

        pushSingleToFirebaseAsync(lastLat, lastLng, lastSpeed, lastBearing, getBatteryLevel(), timestamp, "native_heartbeat_ping", (error, ref) -> {
            if (error == null) {
                Log.i(TAG, "🏓 Ping de latido silencioso guardado via servidor");
            } else {
                Log.w(TAG, "❌ Falló el envío del latido silencioso: " + error.getMessage());
            }
        });
    }

    private void updateFirebaseGpsStatus(String eventType, boolean isEnabled) {
        if (dbRef == null || userId == null || userId.isEmpty()) return;

        serviceHandler.post(() -> {
            Map<String, Object> updates = new HashMap<>();
            updates.put("gps_status", isEnabled ? "active" : "disabled");
            updates.put("status", eventType);
            updates.put("last_heartbeat", System.currentTimeMillis());
            
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
            updates.put("updated_at", sdf.format(new Date()));

            dbRef.child(userId).updateChildren(updates, (error, ref) -> {
                if (error != null) {
                    Log.w(TAG, "❌ Firebase update status failed: " + error.getMessage());
                } else {
                    Log.i(TAG, "✅ Firebase status updated: " + eventType);
                }
            });
        });
    }

    private void sendEventToServer(String eventType) {
        if (serverUrl == null || serverUrl.isEmpty() || userId == null || userId.isEmpty()) {
            Log.w(TAG, "⚠️ Cannot send event to server: serverUrl or userId is null/empty");
            return;
        }

        serviceHandler.post(() -> {
            try {
                java.net.URL url = new java.net.URL(serverUrl + "/api/driver/gps-event");
                java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json; utf-8");
                conn.setRequestProperty("Accept", "application/json");
                conn.setDoOutput(true);
                conn.setConnectTimeout(5000);
                conn.setReadTimeout(5000);

                String jsonInputString = String.format(Locale.US,
                    "{\"driver_id\":\"%s\",\"event\":\"%s\",\"timestamp\":%d,\"fleetId\":\"%s\"}",
                    userId, eventType, System.currentTimeMillis(), fleetId != null ? fleetId : ""
                );

                try (java.io.OutputStream os = conn.getOutputStream()) {
                    byte[] input = jsonInputString.getBytes("utf-8");
                    os.write(input, 0, input.length);
                }

                int code = conn.getResponseCode();
                Log.i(TAG, "🔌 Event HTTP Sent: " + eventType + ". Response code: " + code);
                conn.disconnect();
            } catch (Exception e) {
                Log.e(TAG, "❌ Error sending event to server via HTTP: " + e.getMessage());
            }
        });
    }
}
