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
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.media.MediaPlayer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
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
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
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
    public static final String CHANNEL_ID = "fleet_gps_tracking_v2";
    public static final String ALERT_CHANNEL_ID = "fleet_traffic_alerts_high";
    private static final int NOTIFICATION_ID = 7001;
    private static final int ALERT_NOTIFICATION_ID = 7002;
    private static final String PREFS_NAME = "fleet_gps_prefs";
    public static boolean isAppInForeground = false;
    public static LocationTrackingService instance = null;
    private static long lastSpokenTime = 0;
    private static String lastSpokenText = "";
    private AudioFocusRequest navAudioFocusRequest = null;

    // GPS Config
    private static final long MIN_TIME_MS = 1000;   // 1 segundo (agresivo para evitar suspension del GPS)
    private static final float MIN_DISTANCE_M = 0f;

    // Proximity Config (Radarbot)
    private static final int PROXIMITY_RADIUS_M = 500;  // Radio dinámico base (300m / 500m)
    private static final long COOLDOWN_MS = 15 * 60 * 1000L; // 15 min entre avisos del mismo punto dinámico
    private static final int RADAR_PROXIMITY_RADIUS_M = 300; // 300 metros para fotomultas fijas (conciso)
    private static final long RADAR_COOLDOWN_MS = 15 * 60 * 1000L; // 15 min entre avisos de la misma cámara
    private final Map<String, Long> lastRadarAlertTimestamps = new HashMap<>();

    /**
     * Fórmula de Haversine con radio terrestre R = 6371e3 metros (6.371.000m).
     * Prohíbe comparaciones directas de grados decimales para radios de proximidad.
     */
    public static double getDistanceInMeters(double lat1, double lon1, double lat2, double lon2) {
        final double R = 6371e3;
        double phi1 = Math.toRadians(lat1);
        double phi2 = Math.toRadians(lat2);
        double deltaPhi = Math.toRadians(lat2 - lat1);
        double deltaLambda = Math.toRadians(lon2 - lon1);

        double a = Math.sin(deltaPhi / 2.0) * Math.sin(deltaPhi / 2.0) +
                   Math.cos(phi1) * Math.cos(phi2) *
                   Math.sin(deltaLambda / 2.0) * Math.sin(deltaLambda / 2.0);
        double c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
        return R * c;
    }

    private static class BgRadarApproach {
        String radarId;
        RosarioRadars.StaticRadar radar;
        int stage; // 300, 150, 120, 90, 60, 30
        float minDistance;
        float lastDistance;
        long startedAt;

        BgRadarApproach(RosarioRadars.StaticRadar radar, float initialDist, int initialStage, long startedAt) {
            this.radarId = radar.id;
            this.radar = radar;
            this.stage = initialStage;
            this.minDistance = initialDist;
            this.lastDistance = initialDist;
            this.startedAt = startedAt;
        }
    }
    private BgRadarApproach activeBgApproach = null;
    private ToneGenerator bgToneGen = null;
    private final LinkedList<Location> recentLocations = new LinkedList<>();

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

    // Text To Speech (Radarbot Voice) & Native Audio Player
    private TextToSpeech tts;
    private boolean isTtsInitialized = false;
    private final List<String> pendingSpeakQueue = new ArrayList<>();
    private MediaPlayer mediaPlayer = null;
    public static volatile boolean isVoiceMuted = false;
    public static volatile float alertVolume = 0.85f;
    public static volatile int alertVolumePercent = 85;

    // Estado del turno: el override estilo Uber (subir volumen en modo silencio)
    // SÓLO se activa cuando el chofer tiene un TURNO INICIADO. Fuera de turno se respeta el silencio.
    public static volatile boolean isShiftActive = false;
    private int bgToneGenStream = -1;

    // Override de volumen estilo Uber: aunque el celular esté en silencio/vibración,
    // las alertas suenan por el canal ALARMA con volumen elevado temporalmente.
    private static final int ALERT_STREAM = AudioManager.STREAM_ALARM;
    private static final int ALERT_USAGE = AudioAttributes.USAGE_ALARM;
    private final Object volumeBoostLock = new Object();
    private int savedAlarmVolume = -1;
    private final Handler volumeRestoreHandler = new Handler(Looper.getMainLooper());
    private final Runnable volumeRestoreRunnable = this::restoreAlertVolumeNow;

    // Background Thread
    private HandlerThread serviceThread;
    private Handler serviceHandler;

    // Firebase Direct
    private DatabaseReference dbRef;
    private DatabaseReference alertsRef;
    private DatabaseReference globalAlertsRef;
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
    private Location lastKnownLocation = null;

    // Estabilizador del velocímetro
    private float smoothedSpeedKmh = 0f;
    private boolean isSmoothedSpeedInit = false;
    private Location lastCalcLocation = null;

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
        String authorName;
        String authorId;

        TrafficAlert(String id, String type, double lat, double lng, String location, String originalText, long timestamp, String audioUrl, String authorName, String authorId) {
            this.id = id;
            this.type = type;
            this.lat = lat;
            this.lng = lng;
            this.location = location;
            this.originalText = originalText;
            this.timestamp = timestamp;
            this.audioUrl = audioUrl;
            this.authorName = authorName;
            this.authorId = authorId;
        }
    }

    // ================================================================
    public void onCreate() {
        super.onCreate();
        instance = this;
        Log.i(TAG, "🚀 onCreate() — Inicializando motor GPS Indestructible v5.1");
        serviceStartTime = System.currentTimeMillis();

        createNotificationChannel();

        // Cargar preferencias de volumen independiente y silencio
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        alertVolumePercent = prefs.getInt("alert_volume_percent", 85);
        alertVolume = alertVolumePercent / 100.0f;
        isVoiceMuted = "off".equals(prefs.getString("radarVoice", "on"));
        isShiftActive = prefs.getBoolean("is_shift_active", false);
        try {
            Set<String> savedSpoken = prefs.getStringSet("spoken_alerts_set", null);
            if (savedSpoken != null) {
                synchronized (spokenAlertIds) {
                    spokenAlertIds.addAll(savedSpoken);
                }
            }
        } catch (Exception ignored) {}
        Log.i(TAG, "🔊 [PREFS] Volumen: " + alertVolumePercent + "% | Mute: " + isVoiceMuted + " | Turno activo: " + isShiftActive);

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
        try {
            android.content.IntentFilter filter = new android.content.IntentFilter(android.location.LocationManager.PROVIDERS_CHANGED_ACTION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(gpsStatusReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(gpsStatusReceiver, filter);
            }
            Log.i(TAG, "🔌 Registered GPS providers BroadcastReceiver");
        } catch (Exception e) {
            Log.e(TAG, "⚠️ Error registering GPS providers receiver:", e);
        }
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

        if (intent != null && intent.hasExtra("isShiftActive")) {
            isShiftActive = intent.getBooleanExtra("isShiftActive", false);
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putBoolean("is_shift_active", isShiftActive).apply();
            Log.i(TAG, "🚗 [TURNO] isShiftActive recibido en Intent: " + isShiftActive);
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
        } catch (SecurityException se) {
            Log.w(TAG, "⚠️ SecurityException en startForeground(LOCATION), usando fallback sin tipo:", se);
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception eFallback) {
                Log.e(TAG, "❌ Error fatal startForeground fallback:", eFallback);
            }
        } catch (Exception e) {
            Log.e(TAG, "⚠️ Error startForeground:", e);
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) {}
        }

        acquireWakeLock();

        instance = this;
        if (!isTracking) {
            startLocationUpdates();
            isTracking = true;
        }

        // Siempre escuchar alertas globales de tránsito (con o sin flota)
        startTrafficAlertsListener();

        startWatchdog();

        // Iniciar pings periódicos
        startHeartbeatTimer();

        return START_STICKY; // El sistema lo reinicia si muere
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.i(TAG, "📱 onTaskRemoved() — Tarea cerrada desde recientes. El servicio continúa activo en segundo plano.");

        try {
            acquireWakeLock();
            try {
                FirebaseDatabase.getInstance().goOnline();
            } catch (Exception ignored) {}

            // CRÍTICO ANTI-APAGADO: Con stopWithTask="false", este ForegroundService PERMANECE VIVO automáticamente
            // en segundo plano con su notificación activa. El chofer está trabajando con Uber/DiDi.
            // NUNCA reportar 'app_killed' al servidor ni a Firebase cuando el chofer simplemente minimiza o limpia recientes.
            if (serviceHandler != null && dbRef != null && userId != null && !userId.isEmpty()) {
                serviceHandler.post(() -> {
                    try {
                        Map<String, Object> aliveData = new HashMap<>();
                        aliveData.put("status", "active");
                        aliveData.put("last_heartbeat", System.currentTimeMillis());
                        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
                        aliveData.put("updated_at", sdf.format(new Date()));
                        dbRef.child(userId).updateChildren(aliveData);
                        Log.i(TAG, "🛡️ Estado 'active' preservado en Firebase tras onTaskRemoved");
                    } catch (Exception e) {
                        Log.e(TAG, "❌ Error actualizando Firebase en onTaskRemoved:", e);
                    }
                });
            }
        } catch (Exception e) {
            Log.e(TAG, "⚠️ Error en onTaskRemoved handler:", e);
        }

        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "⛔ onDestroy() — El servicio está siendo destruido");
        if (instance == this) instance = null;
        isTracking = false;
        try { stopLocationUpdates(); } catch (Exception ignored) {}
        try { releaseWakeLock(); } catch (Exception ignored) {}
        
        if (mediaPlayer != null) {
            try { mediaPlayer.stop(); mediaPlayer.release(); } catch (Exception ignored) {}
            mediaPlayer = null;
        }
        if (tts != null) {
            try { tts.stop(); tts.shutdown(); } catch (Exception ignored) {}
            tts = null;
            isTtsInitialized = false;
        }
        // Si el servicio muere en medio de una alerta, devolver el volumen original del usuario
        try {
            volumeRestoreHandler.removeCallbacks(volumeRestoreRunnable);
            restoreAlertVolumeNow();
        } catch (Exception ignored) {}
        
        // Desregistrar receptor GPS de forma segura
        try {
            if (gpsStatusReceiver != null) {
                unregisterReceiver(gpsStatusReceiver);
            }
        } catch (Exception ignored) {}
        
        // Detener timer de latidos
        try {
            if (heartbeatHandler != null && heartbeatRunnable != null) {
                heartbeatHandler.removeCallbacks(heartbeatRunnable);
            }
        } catch (Exception ignored) {}

        // Detener vigilante
        try {
            if (watchdogHandler != null && watchdogRunnable != null) {
                watchdogHandler.removeCallbacks(watchdogRunnable);
            }
        } catch (Exception ignored) {}

        // Detener hilo de servicio
        try {
            if (serviceThread != null) {
                serviceThread.quitSafely();
            }
        } catch (Exception ignored) {}

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
        lastKnownLocation = location;
        lastLat = location.getLatitude();
        lastLng = location.getLongitude();

        // Estabilización del velocímetro:
        // a) Priorizar valor de hardware nativo 'coords.speed' provisto por chip GPS
        float rawSpeedKmh = -1f;
        if (location.hasSpeed() && location.getSpeed() >= 0f) {
            rawSpeedKmh = location.getSpeed() * 3.6f;
        } else if (lastCalcLocation != null) {
            // b) Fallback Haversine con delta de tiempo >= 1.5s y descarte si accuracy > 15m
            long timeDeltaMs = location.getTime() - lastCalcLocation.getTime();
            float timeDeltaSec = timeDeltaMs / 1000f;
            boolean accuracyOk = !location.hasAccuracy() || location.getAccuracy() <= 15.0f;
            boolean prevAccuracyOk = !lastCalcLocation.hasAccuracy() || lastCalcLocation.getAccuracy() <= 15.0f;

            if (timeDeltaSec >= 1.5f && timeDeltaSec <= 15.0f && accuracyOk && prevAccuracyOk) {
                float distMeters = lastCalcLocation.distanceTo(location);
                float calculatedKmh = (distMeters / timeDeltaSec) * 3.6f;
                if (calculatedKmh <= 180f) {
                    rawSpeedKmh = calculatedKmh;
                }
            }
        }

        if (lastCalcLocation == null || (location.getTime() - lastCalcLocation.getTime() >= 1500)) {
            lastCalcLocation = new Location(location);
        }

        // c) Filtro de suavizado (Media Móvil Exponencial - EMA con factor alfa ~0.3)
        if (rawSpeedKmh >= 0f) {
            if (!isSmoothedSpeedInit) {
                smoothedSpeedKmh = rawSpeedKmh;
                isSmoothedSpeedInit = true;
            } else {
                smoothedSpeedKmh = (0.30f * rawSpeedKmh) + (0.70f * smoothedSpeedKmh);
            }
        }

        // d) Umbral de reposo: Si < 4 km/h, fijar en 0 km/h para eliminar ruido estacionario
        if (smoothedSpeedKmh < 4.0f) {
            smoothedSpeedKmh = 0f;
        }

        lastSpeed = smoothedSpeedKmh;
        Float reliable = getReliableBearing(location);
        lastBearing = (reliable != null) ? reliable : -1.0f;
        lastGPSTimestamp = System.currentTimeMillis();

        // 1. Radarbot Engine protegido contra excepciones
        try {
            checkProximityToAlerts(location);
        } catch (Throwable t) {
            Log.w(TAG, "⚠️ Error no fatal en checkProximityToAlerts:", t);
        }

        // 2. Firebase Direct / SQLite Queue (Asíncrono en serviceHandler)
        if (serviceHandler != null) {
            serviceHandler.post(() -> {
                try {
                    int battery = getBatteryLevel();
                    SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
                    sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
                    String timestamp = sdf.format(new Date());

                    if (isNetworkAvailable()) {
                        sendQueuedLocations();
                        float pushBearing = lastBearing >= 0 ? lastBearing : 0f;
                        pushSingleToFirebaseAsync(lastLat, lastLng, lastSpeed, pushBearing, battery, timestamp, "native_foreground_v5_1", (error, ref) -> {
                            if (error != null && serviceHandler != null && dbHelper != null) {
                                serviceHandler.post(() -> {
                                    try {
                                        dbHelper.enqueueLocation(lastLat, lastLng, lastSpeed, pushBearing, battery, timestamp);
                                        Log.i(TAG, "💾 Firebase falló. Encolando posición actual. Cola: " + dbHelper.getQueueSize());
                                        updateStatusNotification();
                                    } catch (Throwable ignored) {}
                                });
                            }
                        });
                    } else if (dbHelper != null) {
                        float queueBearing = lastBearing >= 0 ? lastBearing : 0f;
                        dbHelper.enqueueLocation(lastLat, lastLng, lastSpeed, queueBearing, battery, timestamp);
                        Log.i(TAG, "💾 Sin red. Encolando posición actual. Cola: " + dbHelper.getQueueSize());
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "⚠️ Error no fatal despachando GPS a Firebase:", t);
                }
            });
        }

        // 3. UI Sync (WebView)
        sendToWebView(lastLat, lastLng, lastSpeed, lastBearing);

        // 4. Update Notification
        updateStatusNotification();
    }

    // ================================================================
    // RADARBOT ENGINE (Proximity Check)
    // ================================================================

    private String getDriverFirstName() {
        if (driverName != null && !driverName.trim().isEmpty() && !driverName.equalsIgnoreCase("Chofer")) {
            String first = driverName.trim().split("\\s+")[0];
            if (first.length() > 1 && !first.equalsIgnoreCase("Usuario")) {
                return Character.toUpperCase(first.charAt(0)) + first.substring(1).toLowerCase();
            }
        }
        return "";
    }

    /**
     * Obtiene el rumbo real de desplazamiento vehicular.
     * Si no hay sensor nativo o la velocidad es baja, calcula el vector contra un punto previo (10m - 75m).
     */
    private Float getReliableBearing(Location currentLocation) {
        if (currentLocation == null) return null;
        long now = System.currentTimeMillis();

        synchronized (recentLocations) {
            recentLocations.addLast(new Location(currentLocation));
            while (recentLocations.size() > 8 || (recentLocations.size() > 1 && (now - recentLocations.getFirst().getTime()) > 15000)) {
                recentLocations.removeFirst();
            }

            // 1. Si el sensor o GPS nativo reporta bearing (> 0) y velocidad de marcha >= 8 km/h (2.2 m/s)
            if (currentLocation.hasBearing() && currentLocation.getBearing() > 0.0f && currentLocation.getSpeed() >= 2.2f) {
                return currentLocation.getBearing();
            }

            // 2. Vector geodésico entre el punto actual y un punto anterior con separación suficiente (10m a 75m)
            for (int i = recentLocations.size() - 2; i >= 0; i--) {
                Location prev = recentLocations.get(i);
                float dist = prev.distanceTo(currentLocation);
                long timeDiff = Math.abs(currentLocation.getTime() - prev.getTime());
                if (dist >= 10.0f && dist <= 75.0f && timeDiff <= 15000) {
                    float calculated = prev.bearingTo(currentLocation);
                    if (calculated < 0) calculated += 360.0f;
                    return calculated;
                }
            }
        }
        return null;
    }

    /**
     * Estructura del resultado de evaluación vectorial del corredor.
     */
    private static class CorridorResult {
        boolean aligned;
        float angleDiff;
        double crossTrack;
        double alongTrack;

        CorridorResult(boolean aligned, float angleDiff, double crossTrack, double alongTrack) {
            this.aligned = aligned;
            this.angleDiff = angleDiff;
            this.crossTrack = crossTrack;
            this.alongTrack = alongTrack;
        }
    }

    /**
     * Algoritmo de vector de avance y corredor estricto para fotomultas en Android:
     * a) Rumbo de avance (Heading): orientación real del desplazamiento
     * b) Ángulo hacia la cámara (Bearing): cono frontal < 30°
     * c) Desviación lateral (Cross-Track Distance): descarte absoluto si > 35m (calles paralelas)
     * d) Distancia frontal (Along-Track Distance): proyección en línea de marcha
     * e) Sentido de circulación: rechazo de mano contraria o perpendiculares
     */

    private boolean isVehicleOnRadarStreet(Location carLoc, Float carBearing, RosarioRadars.StaticRadar radar) {
        if (radar == null || carBearing == null) return true;

        // A) Rumbos explícitos asignados al radar (ej: Circunvalación en Ovidio Lagos/Uriburu, Bv. Seguí)
        if (radar.validHeadings != null && radar.validHeadings.length > 0) {
            for (int h : radar.validHeadings) {
                float diff = Math.abs(carBearing - h) % 360.0f;
                if (diff > 180.0f) diff = 360.0f - diff;
                if (diff <= 35.0f) {
                    return true;
                }
            }
            return false;
        }

        // B) Si el nombre o descripción menciona Circunvalación pero no tenía validHeadings explícito:
        if (radar.name.contains("Circunvalación") || (radar.desc != null && radar.desc.contains("Circunvalación"))) {
            int[] circHeadings = getCircunvalacionHeadings(radar.lat, radar.lng);
            for (int h : circHeadings) {
                float diff = Math.abs(carBearing - h) % 360.0f;
                if (diff > 180.0f) diff = 360.0f - diff;
                if (diff <= 35.0f) {
                    return true;
                }
            }
            return false;
        }

        return true;
    }

    private int[] getCircunvalacionHeadings(double lat, double lng) {
        // Sector Sur-Este (Ovidio Lagos, Uriburu, Ayacucho): orientación NW-SE (~135° / 315°)
        if (lat < -32.990) {
            return new int[]{135, 315};
        }
        // Sector Sur-Oeste (Pellegrini, 27 de Febrero): orientación WSW-ENE (~65° / 245°)
        if (lat >= -32.990 && lat < -32.960 && lng < -60.700) {
            return new int[]{65, 245};
        }
        // Sector Oeste (Eva Perón / Córdoba): orientación NNW-SSE (~340° / 160°)
        if (lat >= -32.960 && lat < -32.920 && lng < -60.710) {
            return new int[]{340, 160};
        }
        // Sector Norte (Baigorria): orientación N-S (~175° / 355°)
        return new int[]{175, 355};
    }

    private String formatRadarSpeechName(String name) {
        if (name == null || name.trim().isEmpty()) return "cruce con cámara";
        return name
            .replaceAll("(?i)\\bBv\\.\\s*", "Bulevar ")
            .replaceAll("(?i)\\bAv\\.\\s*", "Avenida ")
            .replaceAll("(?i)\\bRN\\s*", "Ruta ")
            .replaceAll("(?i)\\bRP\\s*", "Ruta ")
            .replaceAll("(?i)\\bAU\\s*", "Autopista ")
            .replaceAll("(?i)\\bkm\\s*", "kilómetro ")
            .replaceAll("(?i)\\s*-\\s*(Sur-Norte|Norte-Sur|Este-Oeste|Oeste-Este)", "")
            .replaceAll("\\s*\\([^)]*\\)", "")
            .trim();
    }

    private CorridorResult evaluateCorridor(Location carLoc, Float reliableBearing, RosarioRadars.StaticRadar radar, float distance) {
        if (reliableBearing == null) {
            return new CorridorResult(false, 180f, 999.0, -999.0);
        }

        // 1. REGLA ESTRICTA DE CORREDOR / CALZADA DEL RADAR:
        // Si el radar está en Circunvalación o tiene calzada específica (ej. Bv. Seguí),
        // SOLO alertar si el vehículo circula en el rumbo de esa arteria.
        // Descarta totalmente a vehículos en calles transversales como Ovidio Lagos o Uriburu.
        if (radar != null && !isVehicleOnRadarStreet(carLoc, reliableBearing, radar)) {
            return new CorridorResult(false, 180f, 999.0, -999.0);
        }

        Location targetLoc = new Location("");
        targetLoc.setLatitude(radar.lat);
        targetLoc.setLongitude(radar.lng);
        float targetBearing = carLoc.bearingTo(targetLoc);
        if (targetBearing < 0) targetBearing += 360.0f;

        float angleDiff = Math.abs(reliableBearing - targetBearing) % 360.0f;
        if (angleDiff > 180.0f) angleDiff = 360.0f - angleDiff;

        // b & e) Ángulo hacia la cámara: SOLO aproximación frontal menor a 30°
        // Descarta mano contraria (dif > 150°) y calles transversales/perpendiculares
        if (angleDiff >= 30.0f) {
            return new CorridorResult(false, angleDiff, 999.0, -999.0);
        }

        double rad = Math.toRadians(angleDiff);
        // c) Desviación lateral (Cross-Track Distance): distancia perpendicular al vector de marcha.
        // Si el vehículo está a más de 35 metros hacia los lados (calle paralela), DESCARTAR por completo.
        double crossTrack = distance * Math.abs(Math.sin(rad));
        if (crossTrack > 35.0) {
            return new CorridorResult(false, angleDiff, crossTrack, -999.0);
        }

        // d) Distancia frontal (Along-Track Distance): proyectada a lo largo del rumbo de marcha
        double alongTrack = distance * Math.cos(rad);

        return new CorridorResult(true, angleDiff, crossTrack, alongTrack);
    }

    private boolean isCorridorAligned(Location carLoc, Float reliableBearing, RosarioRadars.StaticRadar radar, float distance) {
        CorridorResult cr = evaluateCorridor(carLoc, reliableBearing, radar, distance);
        return cr.aligned;
    }

    private void playBgProximityTone(int distanceStage) {
        // Alerta obligatoria de fotomulta (override Uber solo si está en turno)
        try {
            int streamType = isShiftActive ? ALERT_STREAM : AudioManager.STREAM_NOTIFICATION;
            if (isShiftActive) {
                boostAlertVolume();
                scheduleAlertVolumeRestore();
            }
            if (bgToneGen == null || bgToneGenStream != streamType) {
                if (bgToneGen != null) {
                    try { bgToneGen.release(); } catch (Exception ignored) {}
                }
                bgToneGen = new ToneGenerator(streamType, 100);
                bgToneGenStream = streamType;
            }
            if (distanceStage <= 35) {
                bgToneGen.startTone(ToneGenerator.TONE_PROP_BEEP2, 130);
            } else if (distanceStage <= 65) {
                bgToneGen.startTone(ToneGenerator.TONE_PROP_BEEP, 100);
            } else if (distanceStage <= 95) {
                bgToneGen.startTone(ToneGenerator.TONE_PROP_BEEP, 80);
            } else { // 120m
                bgToneGen.startTone(ToneGenerator.TONE_PROP_ACK, 70);
            }
        } catch (Exception e) {
            Log.w(TAG, "bgToneGen error: " + e.getMessage());
        }
    }

    private void playBgPassedTone() {
        // Alerta obligatoria de confirmación (override Uber solo si está en turno)
        try {
            int streamType = isShiftActive ? ALERT_STREAM : AudioManager.STREAM_NOTIFICATION;
            if (isShiftActive) {
                boostAlertVolume();
                scheduleAlertVolumeRestore();
            }
            if (bgToneGen == null || bgToneGenStream != streamType) {
                if (bgToneGen != null) {
                    try { bgToneGen.release(); } catch (Exception ignored) {}
                }
                bgToneGen = new ToneGenerator(streamType, 100);
                bgToneGenStream = streamType;
            }
            bgToneGen.startTone(ToneGenerator.TONE_PROP_PROMPT, 150);
        } catch (Exception e) {}
    }

    private void speakRadarConcise(RosarioRadars.StaticRadar radar, int distanceStage) {
        String firstName = getDriverFirstName();
        String prefix = !firstName.isEmpty() ? firstName + ", " : "";
        String locationName = formatRadarSpeechName(radar.name);
        String message = String.format(Locale.getDefault(), 
            "%sfoto multa en %s a %d metros, máxima %d.", 
            prefix, locationName, distanceStage, radar.limit);
        Log.i(TAG, "📷 [RADAR NATIVO-MANDATORY] Locución obligatoria (" + distanceStage + "m): \"" + message + "\"");
        speakMandatory(message);
    }

    private void checkProximityToAlerts(Location myLocation) {
        if (myLocation == null) return;

        // Si la aplicación está en primer plano, el módulo JS (CopilotModule) se encarga de la voz y HUD
        if (isAppInForeground) {
            return;
        }

        // VALIDACIÓN DE PRECISIÓN GPS:
        // Si el GPS reporta una imprecisión mayor a 50 metros, descartar chequeo de proximidad
        // para evitar falsos positivos con ubicaciones estimadas por antenas celulares o Wi-Fi
        if (myLocation.hasAccuracy() && myLocation.getAccuracy() > 50.0f) {
            Log.w(TAG, "📡 [RADAR NATIVO] Precisión GPS insuficiente (" + myLocation.getAccuracy() + "m > 50m). Proximidad descartada.");
            return;
        }

        try {
            long now = System.currentTimeMillis();
            Float reliableBearing = (lastBearing >= 0) ? lastBearing : getReliableBearing(myLocation);

            // Umbral dinámico de proximidad según velocidad:
            // Si velocidadKmH > 60: radioAlerta = 500m. Si velocidadKmH <= 60 (o reposo/no disponible): radioAlerta = 300m.
            float speedKmh = myLocation.hasSpeed() ? (myLocation.getSpeed() * 3.6f) : (lastSpeed > 0 ? lastSpeed : 0f);
            int radioAlerta = (speedKmh > 60.0f) ? 500 : 300;

            // 1. SEGUIMIENTO DE APROXIMACIÓN A RADAR ACTIVO EN SEGUNDO PLANO
            if (activeBgApproach != null) {
                RosarioRadars.StaticRadar radar = activeBgApproach.radar;
                float distance = (float) getDistanceInMeters(myLocation.getLatitude(), myLocation.getLongitude(), 
                                                           radar.lat, radar.lng);
                CorridorResult cr = evaluateCorridor(myLocation, reliableBearing, radar, distance);

                // A) Cámara superada (<= 18m, alongTrack <= 0 tras estar cerca, o distancia aumentó tras haber estado < 35m)
                boolean passedByAlongTrack = cr.alongTrack <= 0 && distance <= 40.0f;
                boolean passedByDistanceIncrease = activeBgApproach.minDistance < 35.0f && distance > activeBgApproach.minDistance + 10.0f;
                if (distance <= 18.0f || passedByAlongTrack || passedByDistanceIncrease) {
                    Log.i(TAG, "📷 [RADAR NATIVO] 🏁 Cámara superada en background: " + radar.name);
                    playBgPassedTone();
                    lastRadarAlertTimestamps.put(radar.id, now);
                    activeBgApproach = null;
                    return;
                }

                // B) Vehículo dobló, se alejó o se desvió lateralmente (> 35m)
                boolean isMovingAway = distance > activeBgApproach.lastDistance + 9.0f;
                if (isMovingAway || (!cr.aligned && distance > 35.0f)) {
                    Log.i(TAG, "📷 [RADAR NATIVO] ↪️ Vehículo dobló o se desvió de corredor, cancelando: " + radar.name);
                    activeBgApproach = null;
                    return;
                }

                // Actualizar distancias
                if (distance < activeBgApproach.minDistance) {
                    activeBgApproach.minDistance = distance;
                }
                activeBgApproach.lastDistance = distance;

                // C) Etapas de aproximación
                if (activeBgApproach.stage == 500 && distance <= 330.0f && distance >= 270.0f) {
                    activeBgApproach.stage = 300;
                    speakRadarConcise(radar, 300);
                    return;
                }
                if (activeBgApproach.stage == 300 && distance <= 165.0f && distance >= 130.0f) {
                    activeBgApproach.stage = 150;
                    speakRadarConcise(radar, 150);
                    return;
                }
                if (activeBgApproach.stage <= 150 && distance <= 125.0f && distance > 98.0f && activeBgApproach.stage != 120) {
                    activeBgApproach.stage = 120;
                    playBgProximityTone(120);
                    return;
                }
                if (activeBgApproach.stage <= 120 && distance <= 98.0f && distance > 68.0f && activeBgApproach.stage != 90) {
                    activeBgApproach.stage = 90;
                    playBgProximityTone(90);
                    return;
                }
                if (activeBgApproach.stage <= 90 && distance <= 68.0f && distance > 38.0f && activeBgApproach.stage != 60) {
                    activeBgApproach.stage = 60;
                    playBgProximityTone(60);
                    return;
                }
                if (activeBgApproach.stage <= 60 && distance <= 38.0f && distance > 18.0f && activeBgApproach.stage != 30) {
                    activeBgApproach.stage = 30;
                    playBgProximityTone(30);
                    return;
                }
                return;
            }

            // 2. BUSCAR NUEVA FOTOMULTA OFICIAL DENTRO DE LA VENTANA DINÁMICA (radioAlerta a 50m)
            RosarioRadars.StaticRadar bestRadar = null;
            float bestRadarDistance = Float.MAX_VALUE;

            for (RosarioRadars.StaticRadar radar : RosarioRadars.ALL_RADARS) {
                float distance = (float) getDistanceInMeters(myLocation.getLatitude(), myLocation.getLongitude(), 
                                                           radar.lat, radar.lng);

                if (distance <= (radioAlerta + 50.0f)) {
                    long lastTime = lastRadarAlertTimestamps.getOrDefault(radar.id, 0L);
                    if (now - lastTime > RADAR_COOLDOWN_MS) {
                        CorridorResult cr = evaluateCorridor(myLocation, reliableBearing, radar, distance);
                        // Alertar únicamente dentro del corredor útil frontal (entre radioAlerta y 50m)
                        if (cr.aligned && cr.alongTrack >= 50.0 && cr.alongTrack <= (double)radioAlerta) {
                            if (distance < bestRadarDistance) {
                                bestRadarDistance = distance;
                                bestRadar = radar;
                            }
                        }
                    }
                }
            }

            if (bestRadar != null) {
                activeBgApproach = new BgRadarApproach(bestRadar, bestRadarDistance, radioAlerta, now);
                speakRadarConcise(bestRadar, radioAlerta);
                return;
            }

            // 3. Chequeo de Alertas Dinámicas en Vivo (Policía, operativos, etc.)
            if (!activeAlerts.isEmpty()) {
                synchronized (activeAlerts) {
                    for (TrafficAlert alert : activeAlerts) {
                        // Si el chofer actual es quien reportó la alerta, no disparar aviso de proximidad a sí mismo
                        if ((driverName != null && alert.authorName != null && driverName.trim().equalsIgnoreCase(alert.authorName.trim())) ||
                            (userId != null && alert.authorId != null && userId.trim().equalsIgnoreCase(alert.authorId.trim()))) {
                            continue;
                        }

                        float distance = (float) getDistanceInMeters(myLocation.getLatitude(), myLocation.getLongitude(), 
                                                                   alert.lat, alert.lng);

                        if (distance <= radioAlerta) {
                            // Si el chofer está detenido (< 7 km/h) y muy cerca (< 70m), evitar locución en bucle
                            if (speedKmh < 7.0f && distance < 70.0f) {
                                continue;
                            }

                            long lastTime = lastAlertTimestamps.getOrDefault(alert.id, 0L);
                            if (now - lastTime > COOLDOWN_MS) {
                                lastAlertTimestamps.put(alert.id, now);
                                speakProximityWarning(alert, distance);
                            }
                        } else if (distance > 1000.0f) {
                            // Si se aleja a más de 1 km, resetear para permitir nueva advertencia si vuelve a aproximarse
                            lastAlertTimestamps.remove(alert.id);
                        }
                    }
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "⚠️ Error capturado en checkProximityToAlerts (background):", t);
        }
    }

    private void speakProximityWarning(TrafficAlert alert, float distance) {
        String typeLabel = "control policial";
        if (alert.type != null) {
            switch (alert.type) {
                case "police": case "checkpoint": typeLabel = "control policial"; break;
                case "radar": typeLabel = "radar de velocidad"; break;
                case "helicopter": typeLabel = "operativo sanitario de helicóptero"; break;
                case "traffic": typeLabel = "congestión de tráfico"; break;
                case "accident": typeLabel = "accidente en la vía"; break;
                case "municipal": typeLabel = "control de tránsito municipal"; break;
                default: typeLabel = "alerta de tránsito"; break;
            }
        }

        String loc = alert.location != null ? alert.location.replace(" y ", " esquina ") : "";
        String first = getDriverFirstName();
        String prefix = !first.isEmpty() ? first + ", " : "";

        int distRound = Math.round(distance / 50.0f) * 50;
        if (distRound <= 50) distRound = 50;
        String distPhrase = (distRound <= 70) ? "en el lugar" : "a " + distRound + " metros";

        String message;
        if (!loc.isEmpty() && !loc.toLowerCase().contains("desconocida")) {
            message = String.format(Locale.getDefault(), "%sAtención, %s %s en %s.", prefix, typeLabel, distPhrase, loc);
        } else {
            message = String.format(Locale.getDefault(), "%sAtención, %s %s.", prefix, typeLabel, distPhrase);
        }
        Log.i(TAG, "🚨 [PROXIMITY-ALERT] Advertencia dinámica: " + message);
        postUrgentAlertNotification("🚨 " + typeLabel.toUpperCase(), message);
        wakeScreenForAlert();
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

    private void markAlertSpoken(String id) {
        if (id == null || id.isEmpty()) return;
        synchronized (spokenAlertIds) {
            if (!spokenAlertIds.contains(id)) {
                spokenAlertIds.add(id);
                if (spokenAlertIds.size() > 200) {
                    spokenAlertIds.remove(0);
                }
                try {
                    SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                    prefs.edit().putStringSet("spoken_alerts_set", new HashSet<>(spokenAlertIds)).apply();
                } catch (Exception ignored) {}
            }
        }
    }

    private boolean isAlertSpoken(String id) {
        if (id == null || id.isEmpty()) return false;
        synchronized (spokenAlertIds) {
            return spokenAlertIds.contains(id);
        }
    }

    private final Map<String, TrafficAlert> activeAlertsMap = new java.util.concurrent.ConcurrentHashMap<>();

    private void updateAlertsFromSnapshot(DataSnapshot snapshot) {
        if (snapshot == null) return;
        long now = System.currentTimeMillis();
        int loadedCount = 0;

        Map<String, TrafficAlert> freshAlertsMap = new java.util.concurrent.ConcurrentHashMap<>();

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
                String authorName = getStringValue(child.child("authorName"));
                String authorId = getStringValue(child.child("authorId"));

                // Si el conductor actual es quien envió la alerta, silenciarla inmediatamente
                if ((driverName != null && authorName != null && driverName.trim().equalsIgnoreCase(authorName.trim())) ||
                    (userId != null && authorId != null && userId.trim().equalsIgnoreCase(authorId.trim()))) {
                    markAlertSpoken(id);
                    continue;
                }

                if (lat != null && lng != null && "active".equals(status) && (expiresAt == null || expiresAt > now)) {
                    TrafficAlert alert = new TrafficAlert(
                        id, 
                        type, 
                        lat, 
                        lng, 
                        location != null ? location : "", 
                        originalText != null ? originalText : "", 
                        timestamp != null ? timestamp : 0L,
                        audioUrl != null ? audioUrl : "",
                        authorName != null ? authorName : "",
                        authorId != null ? authorId : ""
                    );
                    freshAlertsMap.put(id, alert);
                    loadedCount++;

                    // Alerta reciente: solo alertar si el vehículo está REALMENTE cerca (Geofence estricto)
                    long diff = alert.timestamp > 0 ? Math.abs(now - alert.timestamp) : 0;
                    boolean isNewOrRecent = alert.timestamp > 0 && (alert.timestamp >= serviceStartTime - 10000) && (diff < 180000);
                    if (isNewOrRecent && !isAlertSpoken(id)) {
                        markAlertSpoken(id);
                        double dist = (lastLat != 0.0 && lastLng != 0.0) ? getDistanceInMeters(lastLat, lastLng, lat, lng) : 0.0;
                        // Cobertura completa de 50 km para todo el Departamento Rosario y localidades vecinas:
                        // Rosario, Funes, Roldán, Granadero Baigorria, Capitán Bermúdez, San Lorenzo, Pérez, VGG, Alvear, Pueblo Esther, Arroyo Seco.
                        if (dist == 0.0 || dist <= 50000.0) {
                            Log.i(TAG, "📢 [ALERTA DEPARTAMENTO ROSARIO] Nueva alerta en cobertura (" + Math.round(dist) + "m): " + location);
                            speakImmediateAlert(alert);
                        } else {
                            Log.i(TAG, "📍 [ALERTA FUERA DE DPTO] Descartada por distancia (" + Math.round(dist) + "m > 50km): " + location);
                        }
                    } else if (!isAlertSpoken(id)) {
                        // Alerta antigua o histórica: marcarla para que nunca se reproduzca en bucle
                        markAlertSpoken(id);
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ [ALERTS] Error parsing alert child: " + child.getKey(), e);
            }
        }

        synchronized (activeAlerts) {
            activeAlertsMap.clear();
            activeAlertsMap.putAll(freshAlertsMap);
            activeAlerts.clear();
            activeAlerts.addAll(activeAlertsMap.values());
        }
        Log.i(TAG, "🔔 [ALERTS] Snapshot parsed (" + loadedCount + " items). Total in memory: " + activeAlerts.size());
    }

    private final ValueEventListener alertsListener = new ValueEventListener() {
        @Override
        public void onDataChange(@NonNull DataSnapshot snapshot) {
            updateAlertsFromSnapshot(snapshot);
        }

        @Override
        public void onCancelled(@NonNull DatabaseError error) {
            Log.w(TAG, "📡 [ALERTS] Listener cancelled: " + error.getMessage());
        }
    };

    private void startTrafficAlertsListener() {
        Log.i(TAG, "📡 [ALERTS] startTrafficAlertsListener. fleetId: " + fleetId);
        try {
            FirebaseDatabase.getInstance().goOnline();
        } catch (Exception ignored) {}

        // Escuchador de conectividad interna de Firebase para auto-reconexión agresiva
        try {
            DatabaseReference connectedRef = FirebaseDatabase.getInstance().getReference(".info/connected");
            connectedRef.addValueEventListener(new ValueEventListener() {
                @Override
                public void onDataChange(@NonNull DataSnapshot snapshot) {
                    Boolean connected = snapshot.getValue(Boolean.class);
                    boolean isConnected = connected != null && connected;
                    Log.i(TAG, "📡 [FIREBASE-STATE] .info/connected = " + isConnected);
                    if (!isConnected && isTracking) {
                        if (serviceHandler != null) {
                            serviceHandler.postDelayed(() -> {
                                try {
                                    if (isTracking) {
                                        FirebaseDatabase.getInstance().goOnline();
                                    }
                                } catch (Exception ignored) {}
                            }, 1500);
                        }
                    }
                }

                @Override
                public void onCancelled(@NonNull DatabaseError error) {}
            });
        } catch (Exception e) {
            Log.w(TAG, "⚠️ Error agregando listener .info/connected:", e);
        }

        if (alertsRef != null) {
            Log.i(TAG, "📡 [ALERTS] Removing previous fleet database listener");
            alertsRef.removeEventListener(alertsListener);
        }
        if (globalAlertsRef != null) {
            Log.i(TAG, "📡 [ALERTS] Removing previous global database listener");
            globalAlertsRef.removeEventListener(alertsListener);
        }

        try {
            globalAlertsRef = FirebaseDatabase.getInstance().getReference("global_traffic_alerts");
            globalAlertsRef.keepSynced(true);
            globalAlertsRef.addValueEventListener(alertsListener);
            Log.i(TAG, "📡 [ALERTS] Listening on global_traffic_alerts (keepSynced=true)");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error escuchando global_traffic_alerts:", e);
        }

        if (fleetId != null && !fleetId.isEmpty()) {
            try {
                alertsRef = FirebaseDatabase.getInstance().getReference("fleets").child(fleetId).child("traffic_alerts");
                alertsRef.keepSynced(true);
                alertsRef.addValueEventListener(alertsListener);
                Log.i(TAG, "📡 [ALERTS] Listening on fleets/" + fleetId + "/traffic_alerts");
            } catch (Exception e) {
                Log.e(TAG, "❌ Error escuchando fleet traffic_alerts:", e);
            }
        }
    }

    // ================================================================
    // AUDIO FOCUS MANAGEMENT (Ducking de Uber, DiDi, Spotify y radio)
    // ================================================================

    /**
     * Sube temporalmente el volumen del canal ALARMA al nivel configurado de alertas
     * (como hace Uber al entrar un viaje). Guarda el volumen original para restaurarlo.
     * SÓLO se aplica cuando el chofer tiene TURNO INICIADO (isShiftActive == true).
     */
    private void boostAlertVolume() {
        if (!isShiftActive) {
            Log.i(TAG, "ℹ️ [VOLUME-BOOST] Turno no activo. Omitiendo override de volumen (respetando silencio del chofer).");
            return;
        }
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            synchronized (volumeBoostLock) {
                volumeRestoreHandler.removeCallbacks(volumeRestoreRunnable);
                int current = am.getStreamVolume(ALERT_STREAM);
                if (savedAlarmVolume < 0) {
                    savedAlarmVolume = current;
                }
                int max = am.getStreamMaxVolume(ALERT_STREAM);
                int target = Math.max(1, Math.round(max * (alertVolumePercent / 100.0f)));
                if (current < target) {
                    am.setStreamVolume(ALERT_STREAM, target, 0);
                    Log.i(TAG, "📢 [VOLUME-BOOST] Turno activo: Volumen ALARMA elevado " + current + " → " + target + "/" + max + " (modo silencio: " + am.getRingerMode() + ")");
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "⚠️ [VOLUME-BOOST] No se pudo elevar el volumen:", e);
        }
    }

    /** Programa la restauración del volumen original (con margen por si llegan alertas encadenadas). */
    private void scheduleAlertVolumeRestore() {
        if (!isShiftActive) return;
        volumeRestoreHandler.removeCallbacks(volumeRestoreRunnable);
        volumeRestoreHandler.postDelayed(volumeRestoreRunnable, 2500);
    }

    private void restoreAlertVolumeNow() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            synchronized (volumeBoostLock) {
                if (savedAlarmVolume >= 0) {
                    am.setStreamVolume(ALERT_STREAM, savedAlarmVolume, 0);
                    Log.i(TAG, "🔉 [VOLUME-BOOST] Volumen ALARMA restaurado a " + savedAlarmVolume);
                    savedAlarmVolume = -1;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "⚠️ [VOLUME-BOOST] No se pudo restaurar el volumen:", e);
        }
    }

    private boolean requestNavigationAudioFocus() {
        if (isShiftActive) {
            boostAlertVolume();
        }
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return false;
            int streamType = isShiftActive ? ALERT_STREAM : AudioManager.STREAM_MUSIC;
            int usageType = isShiftActive ? ALERT_USAGE : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(usageType)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                navAudioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(attrs)
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(focusChange -> {})
                    .build();
                int res = am.requestAudioFocus(navAudioFocusRequest);
                Log.i(TAG, "🔊 [AUDIO-FOCUS] Solicitud otorgada (" + (isShiftActive ? "STREAM_ALARM" : "STREAM_MUSIC") + "): " + (res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED));
                return res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            } else {
                int res = am.requestAudioFocus(null, streamType, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
                return res == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            }
        } catch (Exception e) {
            Log.w(TAG, "⚠️ Error pidiendo audio focus de navegación:", e);
            return false;
        }
    }

    private void releaseNavigationAudioFocus() {
        if (isShiftActive) {
            scheduleAlertVolumeRestore();
        }
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (navAudioFocusRequest != null) {
                    am.abandonAudioFocusRequest(navAudioFocusRequest);
                    navAudioFocusRequest = null;
                    Log.i(TAG, "🔊 [AUDIO-FOCUS] Audio focus liberado con éxito");
                }
            } else {
                am.abandonAudioFocus(null);
            }
        } catch (Exception ignored) {}
    }

    // ================================================================
    // TEXT TO SPEECH
    // ================================================================

    public static void stopAllAudio() {
        Log.i(TAG, "⏹️ [AUDIO] stopAllAudio() solicitado");
        if (instance != null) {
            instance.stopAudioInternal();
        }
    }

    public void stopAudioInternal() {
        try {
            if (tts != null) {
                tts.stop();
            }
        } catch (Exception ignored) {}
        try {
            if (mediaPlayer != null) {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.reset();
            }
        } catch (Exception ignored) {}
    }

    public static void setVoiceMuted(boolean muted) {
        isVoiceMuted = muted;
        Log.i(TAG, "🔇 [VOZ] setVoiceMuted: " + muted);
        if (muted) {
            stopAllAudio();
        }
        if (instance != null) {
            SharedPreferences prefs = instance.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit().putString("radarVoice", muted ? "off" : "on").apply();
        }
    }

    public static void setAlertVolume(int percent, Context context) {
        alertVolumePercent = Math.max(0, Math.min(100, percent));
        alertVolume = alertVolumePercent / 100.0f;
        Log.i(TAG, "🔊 [VOLUME] Volumen independiente de alertas: " + alertVolumePercent + "% (factor " + alertVolume + ")");
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit().putInt("alert_volume_percent", alertVolumePercent).apply();
            // Ya no se modifica el volumen multimedia (música): las alertas usan el canal ALARMA,
            // que se eleva temporalmente sólo mientras suena cada alerta.
        }
    }

    public static void setDriverName(String name, Context context) {
        if (name == null || name.trim().isEmpty()) return;
        String cleanName = name.trim();
        Log.i(TAG, "👤 [DRIVER-NAME] setDriverName: " + cleanName);
        if (instance != null) {
            instance.driverName = cleanName;
        }
        Context ctx = (instance != null) ? instance : context;
        if (ctx != null) {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit().putString("driverName", cleanName).apply();
        }
    }

    public static void setShiftActive(boolean active, Context context) {
        isShiftActive = active;
        Log.i(TAG, "🚗 [TURNO-ALERTA] setShiftActive: " + active + " | Override Uber: " + (active ? "ACTIVADO (sube volumen en silencio)" : "DESACTIVADO (respeta silencio del chofer)"));
        Context ctx = (instance != null) ? instance : context;
        if (ctx != null) {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit().putBoolean("is_shift_active", active).apply();
        }
        if (instance != null) {
            if (!active) {
                instance.restoreAlertVolumeNow();
            }
            if (instance.tts != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    int usageType = active ? ALERT_USAGE : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;
                    instance.tts.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(usageType)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
                } catch (Exception ignored) {}
            }
        }
        if (staticFallbackTts != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                int usageType = active ? ALERT_USAGE : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;
                staticFallbackTts.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(usageType)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            } catch (Exception ignored) {}
        }
    }

    private static TextToSpeech staticFallbackTts = null;
    private static volatile boolean isStaticFallbackTtsReady = false;

    public static synchronized void initFallbackTts(Context context) {
        if (staticFallbackTts == null && context != null) {
            try {
                Context appContext = context.getApplicationContext();
                staticFallbackTts = new TextToSpeech(appContext, status -> {
                    if (status == TextToSpeech.SUCCESS) {
                        Locale spanish = new Locale("es", "AR");
                        int res = staticFallbackTts.setLanguage(spanish);
                        if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                            res = staticFallbackTts.setLanguage(new Locale("es", "ES"));
                        }
                        if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
                            staticFallbackTts.setLanguage(new Locale("es"));
                        }
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            int usageType = isShiftActive ? ALERT_USAGE : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;
                            staticFallbackTts.setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(usageType)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build());
                        }
                        isStaticFallbackTtsReady = true;
                        Log.i(TAG, "🔊 [STATIC-TTS] Fallback TextToSpeech inicializado con éxito");
                    } else {
                        Log.w(TAG, "⚠️ [STATIC-TTS] Error inicializando fallback TTS: " + status);
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "❌ [STATIC-TTS] Error creando fallback TextToSpeech:", e);
            }
        }
    }

    public static void speakText(String text, Context context) {
        if (text == null || text.trim().isEmpty()) return;
        if (isVoiceMuted) {
            Log.i(TAG, "🔇 [TTS] Silenciado por el usuario. Omitiendo: " + text);
            return;
        }
        if (instance != null && instance.isTtsInitialized && instance.tts != null) {
            instance.speak(text);
        } else {
            Log.i(TAG, "🔊 [TTS] Service instance not ready, attempting fallback TTS for: " + text);
            if (context != null) {
                initFallbackTts(context);
                new Handler(Looper.getMainLooper()).post(() -> {
                    try {
                        if (staticFallbackTts != null && isStaticFallbackTtsReady) {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                int usageType = isShiftActive ? ALERT_USAGE : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;
                                staticFallbackTts.setAudioAttributes(new AudioAttributes.Builder()
                                    .setUsage(usageType)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build());
                            }
                            Bundle params = new Bundle();
                            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, isShiftActive ? 1.0f : alertVolume);
                            staticFallbackTts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "fallback_" + System.currentTimeMillis());
                        } else if (staticFallbackTts != null) {
                            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                                if (staticFallbackTts != null && isStaticFallbackTtsReady) {
                                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                                        int usageType = isShiftActive ? ALERT_USAGE : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;
                                        staticFallbackTts.setAudioAttributes(new AudioAttributes.Builder()
                                            .setUsage(usageType)
                                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                            .build());
                                    }
                                    Bundle params = new Bundle();
                                    params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, isShiftActive ? 1.0f : alertVolume);
                                    staticFallbackTts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "fallback_d_" + System.currentTimeMillis());
                                }
                            }, 500);
                        }
                    } catch (Exception ex) {
                        Log.e(TAG, "❌ Error speaking via fallback TTS:", ex);
                    }
                });
            }
        }
    }

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS) {
            Locale spanish = new Locale("es", "AR");
            int result = tts.setLanguage(spanish);
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "⚠️ TTS: es_AR not supported. Trying generic 'es' locale...");
                result = tts.setLanguage(new Locale("es"));
            }
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "⚠️ TTS: 'es' not supported. Trying es_ES...");
                result = tts.setLanguage(new Locale("es", "ES"));
            }
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "⚠️ TTS: Spanish not supported. Using default system locale.");
                tts.setLanguage(Locale.getDefault());
            }

            // Configurar AudioAttributes para segundo plano y navegación vehicular
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                int usageType = isShiftActive ? ALERT_USAGE : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setUsage(usageType)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build();
                tts.setAudioAttributes(audioAttributes);
                Log.i(TAG, "🔊 [TTS] AudioAttributes " + (isShiftActive ? "USAGE_ALARM (override Uber activo)" : "USAGE_ASSISTANCE_NAVIGATION_GUIDANCE (respeta silencio)") + " configurados");
            }

            // Utterance listener para liberar audio focus al finalizar de hablar
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String utteranceId) {
                    Log.i(TAG, "🔊 [TTS] Locución iniciada: " + utteranceId);
                }

                @Override
                public void onDone(String utteranceId) {
                    Log.i(TAG, "🔊 [TTS] Locución completada: " + utteranceId);
                    releaseNavigationAudioFocus();
                }

                @Override
                public void onError(String utteranceId) {
                    Log.w(TAG, "⚠️ [TTS] Locución con error: " + utteranceId);
                    releaseNavigationAudioFocus();
                }
            });

            isTtsInitialized = true;
            Log.i(TAG, "🔊 TTS: TextToSpeech Initialized successfully");

            // Despachar cualquier anuncio que se haya intentado hablar mientras el motor cargaba
            synchronized (pendingSpeakQueue) {
                for (String pending : pendingSpeakQueue) {
                    if (!isVoiceMuted) {
                        Log.i(TAG, "🔊 [TTS] Despachando anuncio encolado: \"" + pending + "\"");
                        requestNavigationAudioFocus();
                        Bundle params = new Bundle();
                        params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, isShiftActive ? 1.0f : alertVolume);
                        tts.speak(pending, TextToSpeech.QUEUE_FLUSH, params, "pending_" + System.currentTimeMillis());
                    }
                }
                pendingSpeakQueue.clear();
            }
        } else {
            Log.e(TAG, "❌ TTS: TextToSpeech Initialization failed with status: " + status);
        }
    }

    public void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;
        if (isVoiceMuted) {
            Log.i(TAG, "🔇 [TTS] speak() ignorado porque está silenciado");
            return;
        }
        long now = System.currentTimeMillis();
        // Evitar eco o repetición idéntica en menos de 8 segundos
        if (text.trim().equalsIgnoreCase(lastSpokenText.trim()) && (now - lastSpokenTime) < 8000) {
            Log.i(TAG, "🔊 [TTS] Duplicate text ignored within 8s: " + text);
            return;
        }
        lastSpokenTime = now;
        lastSpokenText = text;

        Log.i(TAG, "🔊 [TTS] speak (vol " + alertVolumePercent + "% | turno: " + isShiftActive + "): \"" + text + "\"");
        if (isTtsInitialized && tts != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    int usageType = isShiftActive ? ALERT_USAGE : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;
                    tts.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(usageType)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
                } catch (Exception ignored) {}
            }
            requestNavigationAudioFocus();
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, isShiftActive ? 1.0f : alertVolume);
            int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "alert_" + System.currentTimeMillis());
            if (result == TextToSpeech.ERROR) {
                Log.e(TAG, "❌ [TTS] tts.speak() returned ERROR");
                releaseNavigationAudioFocus();
            }
        } else {
            Log.w(TAG, "⏳ [TTS] Motor TTS aún no listo. Encolando texto para despacho inmediato: " + text);
            synchronized (pendingSpeakQueue) {
                if (pendingSpeakQueue.size() < 10) {
                    pendingSpeakQueue.add(text);
                }
            }
        }
    }

    /**
     * Locución obligatoria para fotomultas: ignora silencio total y suena con volumen completo del SO.
     */
    public void speakMandatory(String text) {
        if (text == null || text.trim().isEmpty()) return;
        long now = System.currentTimeMillis();
        // Evitar repetición idéntica en menos de 8 segundos
        if (text.trim().equalsIgnoreCase(lastSpokenText.trim()) && (now - lastSpokenTime) < 8000) {
            return;
        }
        lastSpokenTime = now;
        lastSpokenText = text;

        Log.i(TAG, "🔊 [TTS-MANDATORY] speak obligatorio al volumen del SO (turno: " + isShiftActive + "): \"" + text + "\"");
        if (isTtsInitialized && tts != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    int usageType = isShiftActive ? ALERT_USAGE : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;
                    tts.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(usageType)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
                } catch (Exception ignored) {}
            }
            requestNavigationAudioFocus();
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, isShiftActive ? 1.0f : alertVolume);
            int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "mandatory_" + System.currentTimeMillis());
            if (result == TextToSpeech.ERROR) {
                Log.e(TAG, "❌ [TTS-MANDATORY] tts.speak() returned ERROR");
                releaseNavigationAudioFocus();
            }
        } else {
            synchronized (pendingSpeakQueue) {
                if (pendingSpeakQueue.size() < 10) {
                    pendingSpeakQueue.add(text);
                }
            }
        }
    }

    public void playAudioAlert(String audioUrl, String fallbackTtsText) {
        if (isVoiceMuted) {
            Log.i(TAG, "🔇 [NATIVE-AUDIO] Silenciado por el usuario. Omitiendo playAudioAlert.");
            return;
        }
        if (audioUrl == null || audioUrl.trim().isEmpty()) {
            speak(fallbackTtsText);
            return;
        }

        serviceHandler.post(() -> {
            try {
                String baseUrl = (serverUrl != null && !serverUrl.isEmpty()) 
                    ? serverUrl 
                    : "https://fleetadmin-web-nueva.onrender.com";
                String fullUrl = audioUrl.startsWith("http") 
                    ? audioUrl 
                    : baseUrl + (audioUrl.startsWith("/") ? "" : "/") + audioUrl;

                Log.i(TAG, "🎵 [NATIVE-AUDIO] Reproduciendo nota de voz nativa: " + fullUrl + " (vol " + alertVolumePercent + "% | turno: " + isShiftActive + ")");

                if (mediaPlayer != null) {
                    try {
                        mediaPlayer.stop();
                        mediaPlayer.release();
                    } catch (Exception ignored) {}
                    mediaPlayer = null;
                }

                mediaPlayer = new MediaPlayer();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    int usageType = isShiftActive ? ALERT_USAGE : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE;
                    AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setUsage(usageType)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                    mediaPlayer.setAudioAttributes(audioAttributes);
                } else {
                    int streamType = isShiftActive ? ALERT_STREAM : AudioManager.STREAM_MUSIC;
                    mediaPlayer.setAudioStreamType(streamType);
                }

                mediaPlayer.setDataSource(fullUrl);
                mediaPlayer.setOnPreparedListener(mp -> {
                    Log.i(TAG, "▶️ [NATIVE-AUDIO] Audio listo, reproduciendo por canal " + (isShiftActive ? "ALARMA" : "MULTIMEDIA") + " al " + alertVolumePercent + "%");
                    try {
                        requestNavigationAudioFocus();
                        float vol = isShiftActive ? 1.0f : alertVolume;
                        mp.setVolume(vol, vol);
                        mp.start();
                    } catch (Exception e) {
                        Log.e(TAG, "❌ Error al iniciar MediaPlayer:", e);
                        releaseNavigationAudioFocus();
                    }
                });

                mediaPlayer.setOnCompletionListener(mp -> {
                    Log.i(TAG, "✅ [NATIVE-AUDIO] Audio finalizado");
                    releaseNavigationAudioFocus();
                    try {
                        mp.release();
                    } catch (Exception ignored) {}
                    if (mediaPlayer == mp) mediaPlayer = null;
                });

                mediaPlayer.setOnErrorListener((mp, what, extra) -> {
                    Log.w(TAG, "⚠️ [NATIVE-AUDIO] Falló MediaPlayer (what=" + what + ", extra=" + extra + "). Usando fallback TTS...");
                    releaseNavigationAudioFocus();
                    try {
                        mp.release();
                    } catch (Exception ignored) {}
                    if (mediaPlayer == mp) mediaPlayer = null;
                    speak(fallbackTtsText);
                    return true;
                });

                mediaPlayer.prepareAsync();
            } catch (Exception e) {
                Log.e(TAG, "❌ [NATIVE-AUDIO] Error iniciando MediaPlayer:", e);
                speak(fallbackTtsText);
            }
        });
    }

    private String getImmediateAlertText(TrafficAlert alert) {
        String msg = "Alerta de tráfico";
        if (alert.type != null) {
            switch (alert.type) {
                case "police": case "checkpoint": msg = "Control de policía"; break;
                case "radar": msg = "Radar de velocidad"; break;
                case "helicopter": msg = "Helicóptero en la zona"; break;
                case "ambulance": msg = "Ambulancia en la vía"; break;
                case "firetruck": msg = "Bomberos en la vía"; break;
                case "municipal": msg = "Control de tránsito"; break;
                case "accident": msg = "Accidente reportado"; break;
                case "traffic": msg = "Demora de tráfico"; break;
                case "warning": msg = "Alerta de tráfico"; break;
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
        if (alert.originalText != null && !alert.originalText.isEmpty() && !alert.originalText.equals("[REPORTE_DE_VOZ]")) {
            String cleanText = alert.originalText
                .replaceAll("https?://\\S+", "") // Remove URL
                .replaceAll("[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑüÜ.,?!;: ]", " ") // Leave alphanumeric and basic punctuation
                .replaceAll("\\s+", " ") // Normalize spaces
                .trim();

            if (cleanText.length() > 2) {
                fullText = cleanText;
            } else {
                fullText = !loc.isEmpty() && !loc.toLowerCase().contains("desconocida") ? msg + " en " + loc : msg;
            }
        } else {
            fullText = !loc.isEmpty() && !loc.toLowerCase().contains("desconocida") ? msg + " en " + loc : msg;
        }
        return fullText;
    }

    private void speakImmediateAlert(TrafficAlert alert) {
        String fullText = getImmediateAlertText(alert);
        Log.i(TAG, "🔊 [IMMEDIATE ALERTS] Speaking new alert: " + fullText);
        postUrgentAlertNotification("⚠️ " + (alert.type != null ? alert.type.toUpperCase() : "ALERTA"), fullText);
        wakeScreenForAlert();
        if (alert.audioUrl != null && !alert.audioUrl.trim().isEmpty()) {
            playAudioAlert(alert.audioUrl, fullText);
        } else {
            // Conversión de texto a stream de audio de alta calidad si no vino pregrabado
            try {
                String encoded = java.net.URLEncoder.encode(fullText, "UTF-8");
                String streamUrl = "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encoded + "&tl=es-ES&client=tw-ob";
                playAudioAlert(streamUrl, fullText);
            } catch (Exception e) {
                speak(fullText);
            }
        }
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
                boolean hasFineLoc = checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
                boolean hasBgLoc = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    hasBgLoc = checkSelfPermission(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
                }

                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                boolean isIgnoringBatt = true;
                if (pm != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        isIgnoringBatt = pm.isIgnoringBatteryOptimizations(getPackageName());
                    }
                }

                // Para un Foreground Service activo de ubicación, FINE_LOCATION es suficiente para rastreo continuo.
                boolean permOk = hasFineLoc;
                data.put("permissions_ok", permOk);
                data.put("bg_location_ok", hasBgLoc);
                data.put("battery_optimization_ok", isIgnoringBatt);
                if (permOk) {
                    data.put("status", "active");
                } else {
                    data.put("status", "permissions_disabled");
                }
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
        // Limpiar puntos viejos (> 6 horas) antes de intentar enviar — son datos GPS obsoletos
        dbHelper.clearOldEntries(6);
        _drainQueue();
    }

    /**
     * Vacía la cola de GPS enviando de a un punto por vez.
     * IMPORTANTE: Se llama recursivamente via postDelayed con una NUEVA invocación
     * para evitar el bug de Runnable reutilizado donde 'called' quedaba en true
     * y bloqueaba todos los envíos subsiguientes indefinidamente.
     */
    private void _drainQueue() {
        serviceHandler.post(() -> {
            List<LocationDbHelper.QueuedLocation> list = dbHelper.getQueuedLocations();
            if (list.isEmpty() || !isNetworkAvailable()) {
                isSendingQueue = false;
                updateStatusNotification();
                return;
            }

            LocationDbHelper.QueuedLocation ql = list.get(0);
            final boolean[] called = {false}; // Array para mutabilidad en lambda

            Runnable timeoutRunnable = () -> {
                if (!called[0]) {
                    called[0] = true;
                    Log.w(TAG, "⏰ Timeout esperando confirmación de Firebase para punto " + ql.id);
                    isSendingQueue = false;
                    updateStatusNotification();
                }
            };
            serviceHandler.postDelayed(timeoutRunnable, 5000);

            pushSingleToFirebaseAsync(ql.lat, ql.lng, ql.speed, ql.bearing, ql.battery, ql.timestamp, "queued_native", (error, ref) -> {
                serviceHandler.post(() -> {
                    if (called[0]) return;
                    called[0] = true;
                    serviceHandler.removeCallbacks(timeoutRunnable);

                    if (error == null) {
                        dbHelper.deleteLocation(ql.id);
                        Log.i(TAG, "✅ Punto encolado enviado y eliminado. Restantes: " + dbHelper.getQueueSize());
                        // Nueva invocación — NO reutiliza Runnable, evita el bug de 'called' compartido
                        serviceHandler.postDelayed(() -> _drainQueue(), 100);
                    } else {
                        Log.w(TAG, "❌ Error al enviar punto local encolado: " + error.getMessage());
                        isSendingQueue = false;
                        updateStatusNotification();
                    }
                });
            });
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

                // 1. Re-asegurar WakeLock y WifiLock si Android los soltó
                acquireWakeLock();

                // 2. Re-asegurar socket de Firebase en segundo plano
                try {
                    FirebaseDatabase.getInstance().goOnline();
                } catch (Exception ignored) {}

                long silenceMs = System.currentTimeMillis() - lastGPSTimestamp;
                
                // Si el GPS no se ha movido o no ha reportado en 60s, reforzamos el binding
                if (lastGPSTimestamp > 0 && silenceMs > 60000) {
                    Log.w(TAG, "⚠️ Vigilante: GPS inactivo por 60s. Reforzando motor...");
                    stopLocationUpdates();
                    startLocationUpdates();
                }
                watchdogHandler.postDelayed(this, 25000); // Revisar cada 25s para mantener socket Doze activo
            }
        };
        watchdogHandler.postDelayed(watchdogRunnable, 25000);
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
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PuntoAlertas::CpuWakeLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire();
                Log.i(TAG, "🛡️ WakeLock Reforzado Activo (PuntoAlertas::CpuWakeLock)");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error acquiring wakeLock: " + e.getMessage());
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
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;

            // 1. Canal persistente para el Foreground Service (silencioso, protege de Doze y LMK)
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, 
                "Servicio de Rastreo Permanente y Radar", 
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channel.setDescription("Mantiene el GPS activo en segundo plano y recibe alertas de tránsito en vivo.");
            channel.setSound(null, null); // Silencioso para no pitar en cada fix GPS
            channel.enableVibration(false);
            manager.createNotificationChannel(channel);

            // 2. Canal de Alta Prioridad para Alertas Urgentes (suena y despierta con pantalla apagada)
            NotificationChannel alertChannel = new NotificationChannel(
                ALERT_CHANNEL_ID,
                "Alertas Urgentes de Tránsito y Radar",
                NotificationManager.IMPORTANCE_HIGH
            );
            alertChannel.setDescription("Alertas inmediatas de fotomultas, operativos y controles policiales.");
            alertChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            alertChannel.enableVibration(true);
            alertChannel.setVibrationPattern(new long[]{0, 300, 150, 300});
            alertChannel.setShowBadge(true);
            alertChannel.setBypassDnd(true);
            manager.createNotificationChannel(alertChannel);
        }
    }

    public void wakeScreenForAlert() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                @SuppressWarnings("deprecation")
                PowerManager.WakeLock screenLock = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                    "FleetGPS:ScreenAlertWakeLock"
                );
                screenLock.acquire(8000); // 8 segundos para que el conductor vea y escuche
            }
        } catch (Exception e) {
            Log.w(TAG, "⚠️ No se pudo encender pantalla para alerta: " + e.getMessage());
        }
    }

    public void postUrgentAlertNotification(String title, String body) {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 
                (int) System.currentTimeMillis(), 
                intent, 
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(Notification.DEFAULT_ALL);

            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(ALERT_NOTIFICATION_ID, builder.build());
            }

            wakeScreenForAlert();
        } catch (Exception e) {
            Log.e(TAG, "❌ Error posting urgent alert notification:", e);
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
            // IMPORTANCE_DEFAULT / PRIORITY_DEFAULT protege el proceso del LowMemoryKiller de Android y Samsung
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
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
        heartbeatHandler = (serviceHandler != null) ? new Handler(serviceHandler.getLooper()) : new Handler(Looper.getMainLooper());
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                if (!isTracking) return;
                
                // Realizar verificación periódica de permisos
                checkAndReportPermissions();

                long now = System.currentTimeMillis();
                if (now - lastHeartbeatTime >= 60000) { // Ping cada 60s para evitar sospecha de desconexión
                    Log.i(TAG, "🏓 Enviando ping de latido silencioso...");
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

        boolean hasFineLoc = checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
        boolean hasBgLocation = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            hasBgLocation = checkSelfPermission(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
        }

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        boolean isIgnoringBattery = true;
        if (pm != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                isIgnoringBattery = pm.isIgnoringBatteryOptimizations(getPackageName());
            }
        }

        // El Foreground Service requiere FINE_LOCATION. Si FINE_LOCATION está activo, el servicio funciona.
        boolean currentPermissionsOk = hasFineLoc;

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
