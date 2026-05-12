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
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.firebase.database.DatabaseReference;
import com.google.firebase.database.FirebaseDatabase;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;

/**
 * LocationTrackingService — Persistent Foreground Service (v4.0 - Firebase Direct)
 *
 * CAMBIO CLAVE vs v3.0:
 * Ahora sube las coordenadas DIRECTAMENTE a Firebase Realtime Database
 * desde Java, SIN depender del WebView. Esto hace que el GPS siga
 * funcionando aunque Samsung mate el WebView/Activity.
 *
 * FLUJO ANTERIOR (v3.0 - fallaba):
 *   GPS → Service Java → WebView (JS) → Firebase
 *   (Samsung mata el WebView → GPS se pierde)
 *
 * FLUJO NUEVO (v4.0 - inmortal):
 *   GPS → Service Java → Firebase (directo desde Java)
 *   (El Service es un Foreground Service, Android no lo mata)
 *
 * ANTI-KILL STRATEGY (4 capas):
 *   1. startForeground() + foregroundServiceType="location"
 *   2. PARTIAL_WAKE_LOCK → CPU activo con pantalla apagada
 *   3. START_STICKY → Android re-crea el Service si muere
 *   4. GPS_PROVIDER + NETWORK_PROVIDER nativos del OS
 */
public class LocationTrackingService extends Service {

    private static final String TAG = "FleetGPS";
    private static final String CHANNEL_ID = "fleet_gps_tracking";
    private static final int NOTIFICATION_ID = 7001;
    private static final String PREFS_NAME = "fleet_gps_prefs";

    // GPS Config
    private static final long MIN_TIME_MS = 5000;   // 5 segundos
    private static final float MIN_DISTANCE_M = 0f;

    // State
    private LocationManager locationManager;
    private PowerManager.WakeLock wakeLock;
    private LocationListener gpsListener;
    private LocationListener networkListener;
    private Handler watchdogHandler;
    private Runnable watchdogRunnable;
    private boolean isTracking = false;

    // Firebase Direct
    private DatabaseReference dbRef;
    private String userId;
    private String driverName;

    // Last data
    private double lastLat = 0;
    private double lastLng = 0;
    private float lastSpeed = 0;
    private float lastBearing = 0;
    private long lastGPSTimestamp = 0;

    // ================================================================
    // LIFECYCLE
    // ================================================================

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "🚀 LocationTrackingService.onCreate() — v4.0 Firebase Direct");
        createNotificationChannel();

        // Inicializar Firebase Database
        try {
            dbRef = FirebaseDatabase.getInstance().getReference("driver_positions");
            Log.i(TAG, "✅ Firebase Database inicializado correctamente");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error inicializando Firebase Database:", e);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "🚀 onStartCommand() — Activando GPS de alta precisión + Firebase Direct");

        // Extraer userId y driverName del Intent (pasados desde MainActivity)
        if (intent != null) {
            String intentUserId = intent.getStringExtra("userId");
            String intentDriverName = intent.getStringExtra("driverName");
            
            if (intentUserId != null && !intentUserId.isEmpty()) {
                userId = intentUserId;
                driverName = intentDriverName != null ? intentDriverName : "Chofer";
                
                // Guardar en SharedPreferences para sobrevivir a reinicios (START_STICKY)
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                prefs.edit()
                    .putString("userId", userId)
                    .putString("driverName", driverName)
                    .apply();
                    
                Log.i(TAG, "✅ userId recibido del Intent: " + userId);
            }
        }

        // Si no vino del Intent, recuperar de SharedPreferences (caso START_STICKY re-create)
        if (userId == null || userId.isEmpty()) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            userId = prefs.getString("userId", null);
            driverName = prefs.getString("driverName", "Chofer");
            
            if (userId != null) {
                Log.i(TAG, "✅ userId recuperado de SharedPreferences: " + userId);
            } else {
                Log.w(TAG, "⚠️ No hay userId — GPS corre pero NO se sube a Firebase");
            }
        }

        // Notificación obligatoria (DEBE ocurrir en <5s tras startForegroundService)
        Notification notification = buildNotification(
            "Punto Alertas: Turno activo",
            "📍 Iniciando rastreo GPS..."
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        Log.i(TAG, "✅ startForeground() ejecutado — notificación persistente activa");

        // WakeLock
        acquireWakeLock();

        // GPS nativo
        if (!isTracking) {
            startLocationUpdates();
            isTracking = true;
        }

        // Watchdog
        startWatchdog();

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "⛔ onDestroy() — Limpiando recursos GPS");
        isTracking = false;

        if (locationManager != null) {
            if (gpsListener != null) locationManager.removeUpdates(gpsListener);
            if (networkListener != null) locationManager.removeUpdates(networkListener);
        }

        if (watchdogHandler != null && watchdogRunnable != null) {
            watchdogHandler.removeCallbacks(watchdogRunnable);
        }

        releaseWakeLock();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ================================================================
    // GPS NATIVO
    // ================================================================

    private void startLocationUpdates() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) {
            Log.e(TAG, "❌ LocationManager es null");
            return;
        }

        gpsListener = createLocationListener("GPS");
        networkListener = createLocationListener("NETWORK");

        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    MIN_TIME_MS, MIN_DISTANCE_M,
                    gpsListener, Looper.getMainLooper()
                );
                Log.i(TAG, "✅ GPS_PROVIDER registrado (heartbeat: " + MIN_TIME_MS + "ms)");
            }

            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    MIN_TIME_MS, MIN_DISTANCE_M,
                    networkListener, Looper.getMainLooper()
                );
                Log.i(TAG, "✅ NETWORK_PROVIDER registrado como fallback");
            }
        } catch (SecurityException e) {
            Log.e(TAG, "❌ SecurityException: Permisos no concedidos", e);
        }

        pushLastKnownLocation();
    }

    private LocationListener createLocationListener(final String source) {
        return new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                lastLat = location.getLatitude();
                lastLng = location.getLongitude();
                lastSpeed = location.getSpeed() * 3.6f; // m/s → km/h
                lastBearing = location.getBearing();
                lastGPSTimestamp = System.currentTimeMillis();

                Log.d(TAG, String.format("📍 [%s] %.6f, %.6f | %.1f km/h",
                    source, lastLat, lastLng, lastSpeed));

                // Actualizar notificación
                updateNotification(
                    "Punto Alertas: Turno activo",
                    String.format("📍 %.4f, %.4f | %.0f km/h", lastLat, lastLng, lastSpeed)
                );

                // ═══════════════════════════════════════════
                // SUBIR DIRECTO A FIREBASE (sin WebView)
                // ═══════════════════════════════════════════
                pushToFirebase(lastLat, lastLng, lastSpeed, lastBearing);

                // También notificar al WebView si está vivo (para UI)
                sendToWebView(lastLat, lastLng, lastSpeed, lastBearing);
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {}

            @Override
            public void onProviderEnabled(String provider) {
                Log.i(TAG, "✅ Provider habilitado: " + provider);
            }

            @Override
            public void onProviderDisabled(String provider) {
                Log.w(TAG, "⚠️ Provider deshabilitado: " + provider);
                updateNotification("⚠️ GPS desactivado", "Activá el GPS para continuar");
            }
        };
    }

    private void pushLastKnownLocation() {
        try {
            Location lastGPS = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            Location lastNetwork = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);

            Location best = null;
            if (lastGPS != null && lastNetwork != null) {
                best = lastGPS.getTime() > lastNetwork.getTime() ? lastGPS : lastNetwork;
            } else if (lastGPS != null) {
                best = lastGPS;
            } else {
                best = lastNetwork;
            }

            if (best != null) {
                lastLat = best.getLatitude();
                lastLng = best.getLongitude();
                lastSpeed = best.getSpeed() * 3.6f;
                lastBearing = best.getBearing();
                lastGPSTimestamp = System.currentTimeMillis();

                pushToFirebase(lastLat, lastLng, lastSpeed, lastBearing);
                sendToWebView(lastLat, lastLng, lastSpeed, lastBearing);
            }
        } catch (SecurityException e) {
            Log.w(TAG, "getLastKnownLocation sin permisos", e);
        }
    }

    // ================================================================
    // FIREBASE DIRECT — Sube GPS sin depender del WebView
    // ================================================================

    private void pushToFirebase(double lat, double lng, float speed, float bearing) {
        if (dbRef == null || userId == null || userId.isEmpty()) {
            return;
        }

        try {
            // Formato ISO 8601 para updated_at
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
            String timestamp = sdf.format(new Date());

            // Obtener nivel de batería
            int batteryLevel = getBatteryLevel();

            Map<String, Object> data = new HashMap<>();
            data.put("lat", lat);
            data.put("lng", lng);
            data.put("heading", (double) bearing);
            data.put("speed", (double) speed);
            data.put("battery", batteryLevel);
            data.put("driverName", driverName != null ? driverName : "Chofer");
            data.put("updated_at", timestamp);
            data.put("_source", "native_foreground_service_v4");

            dbRef.child(userId).setValue(data)
                .addOnSuccessListener(aVoid -> {
                    Log.d(TAG, "✅ Firebase: posición subida para " + userId);
                })
                .addOnFailureListener(e -> {
                    Log.w(TAG, "❌ Firebase: error subiendo posición: " + e.getMessage());
                });
        } catch (Exception e) {
            Log.e(TAG, "❌ pushToFirebase error:", e);
        }
    }

    private int getBatteryLevel() {
        try {
            BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
            if (bm != null) {
                return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            }
        } catch (Exception e) {}
        return -1;
    }

    // ================================================================
    // WATCHDOG — Re-registra GPS si deja de reportar
    // ================================================================

    private void startWatchdog() {
        if (watchdogHandler != null && watchdogRunnable != null) {
            watchdogHandler.removeCallbacks(watchdogRunnable);
        }

        watchdogHandler = new Handler(Looper.getMainLooper());
        watchdogRunnable = new Runnable() {
            @Override
            public void run() {
                if (!isTracking) return;

                long silenceMs = System.currentTimeMillis() - lastGPSTimestamp;
                if (lastGPSTimestamp > 0 && silenceMs > 30000) {
                    Log.w(TAG, "⚠️ WATCHDOG: GPS silencioso " + (silenceMs / 1000) + "s — re-registrando");
                    stopLocationUpdates();
                    startLocationUpdates();
                }

                watchdogHandler.postDelayed(this, 15000);
            }
        };
        watchdogHandler.postDelayed(watchdogRunnable, 15000);
        Log.i(TAG, "🐕 Watchdog GPS iniciado (check cada 15s)");
    }

    private void stopLocationUpdates() {
        if (locationManager != null) {
            if (gpsListener != null) locationManager.removeUpdates(gpsListener);
            if (networkListener != null) locationManager.removeUpdates(networkListener);
        }
    }

    // ================================================================
    // WEBVIEW BRIDGE — Respaldo para actualizar UI si está visible
    // ================================================================

    private void sendToWebView(double lat, double lng, float speed, float bearing) {
        try {
            String js = String.format(
                "javascript:void(function(){" +
                "  if(typeof window._onNativeGPS==='function'){" +
                "    window._onNativeGPS(%f,%f,%f,%f);" +
                "  }" +
                "}())",
                lat, lng, speed, bearing
            );

            if (MainActivity.webView != null) {
                MainActivity.webView.post(() -> {
                    try {
                        if (MainActivity.webView != null) {
                            MainActivity.webView.evaluateJavascript(js, null);
                        }
                    } catch (Exception e) {
                        // WebView muerto — no importa, Firebase Direct ya subió
                    }
                });
            }
        } catch (Exception e) {
            // Ignorar — Firebase Direct es el canal principal ahora
        }
    }

    // ================================================================
    // WAKELOCK
    // ================================================================

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "FleetAdmin::GPSTrackingLock"
            );
            wakeLock.acquire(12 * 60 * 60 * 1000L); // 12 horas
            Log.i(TAG, "🛡️ PARTIAL_WAKE_LOCK adquirido (12h)");
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
            Log.i(TAG, "🛡️ WakeLock liberado");
        }
    }

    // ================================================================
    // NOTIFICATION
    // ================================================================

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Rastreo GPS de Flota",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("GPS en segundo plano para la flota");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String title, String text) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }

    private void updateNotification(String title, String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(title, text));
        }
    }
}
