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
    private static final long MIN_TIME_MS = 5000;   // 5 segundos
    private static final float MIN_DISTANCE_M = 0f;

    // Proximity Config (Radarbot)
    private static final int PROXIMITY_RADIUS_M = 600;  // Avisar a 600 metros
    private static final long COOLDOWN_MS = 4 * 60 * 1000; // 4 min entre avisos del mismo radar

    // State
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private PowerManager.WakeLock wakeLock;
    private Handler watchdogHandler;
    private Runnable watchdogRunnable;
    private boolean isTracking = false;

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

    // Data lists for Proximity
    private final List<TrafficAlert> activeAlerts = new ArrayList<>();
    private final Map<String, Long> lastAlertTimestamps = new HashMap<>();

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

        TrafficAlert(String id, String type, double lat, double lng, String location) {
            this.id = id;
            this.type = type;
            this.lat = lat;
            this.lng = lng;
            this.location = location;
        }
    }

    // ================================================================
    // LIFECYCLE
    // ================================================================    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "🚀 onCreate() — Inicializando motor GPS Indestructible v5.1");

        createNotificationChannel();

        // 1. Thread de fondo prioritario
        serviceThread = new HandlerThread("GPSServiceThread", Process.THREAD_PRIORITY_URGENT_DISPLAY);
        serviceThread.start();
        serviceHandler = new Handler(serviceThread.getLooper());

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
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "▶️ onStartCommand() — Reforzando persistencia");

        if (intent != null) {
            String intentUserId = intent.getStringExtra("userId");
            String intentDriverName = intent.getStringExtra("driverName");
            String intentFleetId = intent.getStringExtra("fleetId");

            if (intentUserId != null && !intentUserId.isEmpty()) {
                // Arranque NORMAL desde la app — guardar en SharedPreferences
                userId = intentUserId;
                driverName = intentDriverName;
                fleetId = intentFleetId;
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                SharedPreferences.Editor editor = prefs.edit();
                editor.putString("userId", userId);
                if (driverName != null) editor.putString("driverName", driverName);
                if (fleetId != null) editor.putString("fleetId", fleetId);
                editor.apply();
                Log.i(TAG, "✅ Credenciales recibidas — userId: " + userId);
            } else {
                // Reinicio del sistema con Intent vacío (onTaskRemoved / onDestroy / START_STICKY)
                // El Intent no es null pero tampoco trae userId → restaurar desde SharedPreferences
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                userId = prefs.getString("userId", userId); // mantener en memoria si ya lo tiene
                driverName = prefs.getString("driverName", driverName != null ? driverName : "Chofer");
                fleetId = prefs.getString("fleetId", fleetId);
                Log.i(TAG, "🔁 Reinicio — userId restaurado desde prefs: " + userId);
            }
        } else {
            // START_STICKY con intent=null — restaurar desde SharedPreferences
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            userId = prefs.getString("userId", null);
            driverName = prefs.getString("driverName", "Chofer");
            fleetId = prefs.getString("fleetId", null);
            Log.i(TAG, "🔁 START_STICKY — userId restaurado: " + userId);
        }

        // Notificación de alta prioridad para evitar cierre por sistema
        Notification notification = buildNotification(
            "Punto Alertas: Turno activo",
            "📍 Monitoreando ruta con protección de batería..."
        );

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
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

        return START_STICKY; // El sistema lo reinicia si muere
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.w(TAG, "⚠️ App cerrada desde recientes. Manteniendo servicio GPS activo...");
        Intent restartServiceIntent = new Intent(getApplicationContext(), this.getClass());
        restartServiceIntent.setPackage(getPackageName());
        // Bug fix v5.3: pasar userId/driverName/fleetId en el Intent de reinicio.
        // Sin esto, onStartCommand recibía Intent vacío → userId=null → GPS no escribía nada.
        if (userId != null) restartServiceIntent.putExtra("userId", userId);
        if (driverName != null) restartServiceIntent.putExtra("driverName", driverName);
        if (fleetId != null) restartServiceIntent.putExtra("fleetId", fleetId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(restartServiceIntent);
        } else {
            startService(restartServiceIntent);
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "⛔ onDestroy() — El servicio está siendo destruido por el sistema!");
        isTracking = false;
        stopLocationUpdates();
        releaseWakeLock();
        // Bug fix v5.3: pasar credenciales en el Intent de auto-reinicio.
        final String savedUserId = userId;
        final String savedDriverName = driverName;
        final String savedFleetId = fleetId;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                Intent restartIntent = new Intent(getApplicationContext(), LocationTrackingService.class);
                if (savedUserId != null) restartIntent.putExtra("userId", savedUserId);
                if (savedDriverName != null) restartIntent.putExtra("driverName", savedDriverName);
                if (savedFleetId != null) restartIntent.putExtra("fleetId", savedFleetId);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getApplicationContext().startForegroundService(restartIntent);
                } else {
                    getApplicationContext().startService(restartIntent);
                }
                Log.i(TAG, "🔁 Auto-reinicio post-destroy disparado con userId: " + savedUserId);
            } catch (Exception e) {
                Log.e(TAG, "❌ Auto-reinicio fallido:", e);
            }
        }, 2000);
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
        LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, MIN_TIME_MS)
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

        // 2. Firebase Direct (Asíncrono)
        serviceHandler.post(() -> pushToFirebase(lastLat, lastLng, lastSpeed, lastBearing));

        // 3. UI Sync (WebView)
        sendToWebView(lastLat, lastLng, lastSpeed, lastBearing);

        // 4. Update Notification
        updateNotification(
            "Punto Alertas: Turno activo",
            String.format(Locale.US, "📍 %.4f, %.4f | %.0f km/h", lastLat, lastLng, lastSpeed)
        );
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

    private final ValueEventListener alertsListener = new ValueEventListener() {
        @Override
        public void onDataChange(@NonNull DataSnapshot snapshot) {
            synchronized (activeAlerts) {
                activeAlerts.clear();
                long now = System.currentTimeMillis();

                for (DataSnapshot child : snapshot.getChildren()) {
                    try {
                        String id = child.getKey();
                        String type = child.child("type").getValue(String.class);
                        Double lat = child.child("lat").getValue(Double.class);
                        Double lng = child.child("lng").getValue(Double.class);
                        String status = child.child("status").getValue(String.class);
                        Long expiresAt = child.child("expiresAt").getValue(Long.class);

                        if (lat != null && lng != null && "active".equals(status) && (expiresAt == null || expiresAt > now)) {
                            activeAlerts.add(new TrafficAlert(id, type, lat, lng, ""));
                        }
                    } catch (Exception e) {}
                }
            }
        }

        @Override
        public void onCancelled(@NonNull DatabaseError error) {}
    };

    private void startTrafficAlertsListener() {
        if (fleetId == null || fleetId.isEmpty()) return;
        if (alertsRef != null) alertsRef.removeEventListener(alertsListener);
        alertsRef = FirebaseDatabase.getInstance().getReference("fleets").child(fleetId).child("traffic_alerts");
        alertsRef.addValueEventListener(alertsListener);
    }

    // ================================================================
    // TEXT TO SPEECH
    // ================================================================

    @Override
    public void onInit(int status) {
        if (status == TextToSpeech.SUCCESS) {
            tts.setLanguage(new Locale("es", "ES"));
            isTtsInitialized = true;
        }
    }

    private void speak(String text) {
        if (isTtsInitialized && tts != null) {
            tts.speak(text, TextToSpeech.QUEUE_ADD, null, "alert_" + System.currentTimeMillis());
        }
    }

    // ================================================================
    // FIREBASE SYNC
    // ================================================================

    private void pushToFirebase(double lat, double lng, float speed, float bearing) {
        if (dbRef == null || userId == null || userId.isEmpty()) return;

        try {
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
            String timestamp = sdf.format(new Date());

            Map<String, Object> data = new HashMap<>();
            data.put("lat", lat);
            data.put("lng", lng);
            data.put("heading", (double) bearing);
            data.put("speed", (double) speed);
            data.put("battery", getBatteryLevel());
            data.put("driverName", driverName != null ? driverName : "Chofer");
            data.put("updated_at", timestamp);
            data.put("_source", "native_foreground_v5_1");

            dbRef.child(userId).setValue(data);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error Firebase:", e);
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
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FleetAdmin::PersistentTracking");
            wakeLock.acquire(24 * 60 * 60 * 1000L); // 24 horas de protección CPU
            Log.i(TAG, "🛡️ WakeLock Reforzado Activo");
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
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
}
