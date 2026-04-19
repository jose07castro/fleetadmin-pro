package com.jose07castro.fleetadminpro;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * LocationTrackingService — Persistent Foreground Service (v3.0 Senior)
 *
 * ┌────────────────────────────────────────────────────────────────────┐
 * │  ANTI-KILL STRATEGY (4 capas de protección):                      │
 * │                                                                    │
 * │  1. startForeground() + foregroundServiceType="location"           │
 * │     → Android clasifica este proceso como VISIBLE, no lo mata     │
 * │                                                                    │
 * │  2. PARTIAL_WAKE_LOCK → CPU no se suspende con pantalla apagada   │
 * │                                                                    │
 * │  3. START_STICKY → Android re-crea este Service si el OEM lo mata │
 * │                                                                    │
 * │  4. GPS_PROVIDER (satélite) + NETWORK_PROVIDER (fallback)         │
 * │     → Registrados con requestLocationUpdates() nativo del OS      │
 * │     → NO depende del WebView, funciona con app en background      │
 * │                                                                    │
 * │  FLUJO DE DATOS:                                                   │
 * │  GPS nativo → onLocationChanged() → evaluateJavascript()          │
 * │  → window._onNativeGPS() → firebaseDB.ref().set()                │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * Notificación obligatoria: "Punto Remis: Turno activo"
 *   - setOngoing(true) → NO se puede deslizar para cerrar
 *   - Se actualiza cada 5s con coordenadas reales
 */
public class LocationTrackingService extends Service {

    private static final String TAG = "FleetGPS";
    private static final String CHANNEL_ID = "fleet_gps_tracking";
    private static final int NOTIFICATION_ID = 7001;

    // === GPS CONFIG ===
    // Heartbeat: 5 segundos
    private static final long MIN_TIME_MS = 5000;
    // Distancia mínima: 0m (reportar cada heartbeat independientemente del movimiento)
    private static final float MIN_DISTANCE_M = 0f;

    // === STATE ===
    private LocationManager locationManager;
    private PowerManager.WakeLock wakeLock;
    private LocationListener gpsListener;
    private LocationListener networkListener;
    private Handler watchdogHandler;
    private Runnable watchdogRunnable;
    private boolean isTracking = false;

    // Último dato para notificación y WebView
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
        Log.i(TAG, "🚀 LocationTrackingService.onCreate()");
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "🚀 onStartCommand() — Activando GPS de alta precisión");

        // ── PASO 1: Notificación obligatoria (DEBE ocurrir en <5s tras startForegroundService) ──
        Notification notification = buildNotification(
            "Punto Remis: Turno activo",
            "Iniciando rastreo GPS..."
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // Android 14+ (API 34): DEBE especificar foregroundServiceType
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Android 10-13 (API 29-33): foregroundServiceType del Manifest es suficiente
            startForeground(NOTIFICATION_ID, notification);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        Log.i(TAG, "✅ startForeground() ejecutado — notificación persistente activa");

        // ── PASO 2: WakeLock (CPU activo con pantalla apagada) ──
        acquireWakeLock();

        // ── PASO 3: GPS nativo ──
        if (!isTracking) {
            startLocationUpdates();
            isTracking = true;
        }

        // ── PASO 4: Watchdog (re-registra GPS si deja de reportar por 30s) ──
        startWatchdog();

        // START_STICKY: Android re-crea el servicio si el OEM lo mata
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "⛔ onDestroy() — Limpiando recursos GPS");
        isTracking = false;

        // Detener GPS listeners
        if (locationManager != null) {
            if (gpsListener != null) {
                locationManager.removeUpdates(gpsListener);
            }
            if (networkListener != null) {
                locationManager.removeUpdates(networkListener);
            }
        }

        // Detener watchdog
        if (watchdogHandler != null && watchdogRunnable != null) {
            watchdogHandler.removeCallbacks(watchdogRunnable);
        }

        // Liberar WakeLock
        releaseWakeLock();

        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // No es un bound service
    }

    // ================================================================
    // GPS NATIVO — LocationManager
    // ================================================================

    private void startLocationUpdates() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) {
            Log.e(TAG, "❌ LocationManager es null — no se puede rastrear");
            return;
        }

        // ── Listener principal: GPS_PROVIDER (satélites, alta precisión) ──
        gpsListener = createLocationListener("GPS");
        // ── Listener fallback: NETWORK_PROVIDER (torres/WiFi, menor precisión) ──
        networkListener = createLocationListener("NETWORK");

        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    MIN_TIME_MS,
                    MIN_DISTANCE_M,
                    gpsListener,
                    Looper.getMainLooper()
                );
                Log.i(TAG, "✅ GPS_PROVIDER registrado (heartbeat: " + MIN_TIME_MS + "ms)");
            } else {
                Log.w(TAG, "⚠️ GPS_PROVIDER no disponible");
            }

            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    MIN_TIME_MS,
                    MIN_DISTANCE_M,
                    networkListener,
                    Looper.getMainLooper()
                );
                Log.i(TAG, "✅ NETWORK_PROVIDER registrado como fallback");
            }
        } catch (SecurityException e) {
            Log.e(TAG, "❌ SecurityException: Permisos de ubicación no concedidos", e);
        }

        // Intentar obtener última posición conocida inmediatamente
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

                Log.d(TAG, String.format("📍 [%s] %.6f, %.6f | %.1f km/h | bearing: %.0f°",
                    source, lastLat, lastLng, lastSpeed, lastBearing));

                // Actualizar notificación persistente con coordenadas reales
                updateNotification(
                    "Punto Remis: Turno activo",
                    String.format("📍 %.4f, %.4f | %.0f km/h", lastLat, lastLng, lastSpeed)
                );

                // Enviar al WebView → Firebase
                sendToWebView(lastLat, lastLng, lastSpeed, lastBearing);
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {
                Log.d(TAG, "📡 " + source + " status changed: " + status);
            }

            @Override
            public void onProviderEnabled(String provider) {
                Log.i(TAG, "✅ Provider habilitado: " + provider);
            }

            @Override
            public void onProviderDisabled(String provider) {
                Log.w(TAG, "⚠️ Provider deshabilitado: " + provider);
                updateNotification(
                    "⚠️ GPS desactivado",
                    "Activá el GPS del teléfono para continuar el rastreo"
                );
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

                Log.i(TAG, String.format("📍 LastKnown: %.6f, %.6f", lastLat, lastLng));
                sendToWebView(lastLat, lastLng, lastSpeed, lastBearing);
            }
        } catch (SecurityException e) {
            Log.w(TAG, "getLastKnownLocation sin permisos", e);
        }
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
                    // GPS lleva >30s sin reportar → posible kill silencioso
                    Log.w(TAG, "⚠️ WATCHDOG: GPS silencioso por " + (silenceMs / 1000) + "s — re-registrando listeners");
                    stopLocationUpdates();
                    startLocationUpdates();
                }

                // Re-ejecutar cada 15 segundos
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
    // WEBVIEW BRIDGE — Enviar coordenadas al JS
    // ================================================================

    private void sendToWebView(double lat, double lng, float speed, float bearing) {
        try {
            // JavaScript que ejecuta la función global registrada por android-services.js
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
                        Log.w(TAG, "evaluateJavascript falló (WebView pausado?)", e);
                    }
                });
            } else {
                Log.w(TAG, "⚠️ WebView es null — no se pueden enviar coordenadas al JS");
            }
        } catch (Exception e) {
            Log.w(TAG, "sendToWebView error", e);
        }
    }

    // ================================================================
    // WAKELOCK — CPU activo con pantalla apagada
    // ================================================================

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            Log.d(TAG, "🛡️ WakeLock ya adquirido, saltando");
            return;
        }

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "FleetAdmin::GPSTrackingLock"
            );
            // 12 horas = duración máxima de un turno
            wakeLock.acquire(12 * 60 * 60 * 1000L);
            Log.i(TAG, "🛡️ PARTIAL_WAKE_LOCK adquirido (12h timeout)");
        } else {
            Log.e(TAG, "❌ PowerManager es null — WakeLock no disponible");
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
    // NOTIFICATION — Persistente, no se puede cerrar
    // ================================================================

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Rastreo GPS de Flota",
                NotificationManager.IMPORTANCE_LOW  // Sin sonido, sin vibración
            );
            channel.setDescription("Notificación persistente del servicio de rastreo GPS en segundo plano");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
                Log.i(TAG, "✅ Notification Channel creado: " + CHANNEL_ID);
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
            .setOngoing(true)                              // NO se puede deslizar para cerrar
            .setSilent(true)                               // Sin sonido
            .setOnlyAlertOnce(true)                        // No vibrar en cada update
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
