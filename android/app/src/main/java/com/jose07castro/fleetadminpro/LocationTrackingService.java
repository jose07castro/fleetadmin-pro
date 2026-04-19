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
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * LocationTrackingService — Persistent Foreground Service
 * 
 * Este servicio se ejecuta con startForeground() para sobrevivir a:
 *   - Doze Mode (pantalla apagada)
 *   - App Standby Buckets (Android 9+)
 *   - Restricciones de background del OEM (Xiaomi, Samsung, Huawei)
 *   - Task killers del usuario
 *
 * Estrategia:
 *   1. startForeground() con foregroundServiceType="location" → Android NO lo mata
 *   2. LocationManager con GPS_PROVIDER a 5 segundos de heartbeat
 *   3. WakeLock parcial como safety net anti-Doze
 *   4. Los datos de posición se envían al WebView via JavaScript evaluateJavascript()
 *      para que el código existente los suba a Firebase
 */
public class LocationTrackingService extends Service {

    private static final String TAG = "FleetGPS";
    private static final String CHANNEL_ID = "fleet_gps_tracking";
    private static final int NOTIFICATION_ID = 7001;

    // Heartbeat de 5 segundos (5000ms)
    private static final long MIN_TIME_MS = 5000;
    // Distancia mínima: 0 metros (reportar cada heartbeat)
    private static final float MIN_DISTANCE_M = 0f;

    private LocationManager locationManager;
    private PowerManager.WakeLock wakeLock;
    private LocationListener locationListener;

    // Último dato para enviar al WebView
    private double lastLat = 0;
    private double lastLng = 0;
    private float lastSpeed = 0;
    private float lastBearing = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "🚀 LocationTrackingService.onCreate() — Foreground Service creado");

        createNotificationChannel();
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "🚀 LocationTrackingService.onStartCommand() — Activando GPS de alta precisión");

        // === 1. FOREGROUND NOTIFICATION (obligatorio en <1 segundo tras startService) ===
        Notification notification = buildNotification("Punto Remis: Turno activo", "Enviando coordenadas al radar de la flota...");

        // Android 14+ (API 34): DEBE especificar foregroundServiceType al arrancar
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // === 2. INICIAR GPS NATIVO ===
        startLocationUpdates();

        // START_STICKY: Android re-crea el servicio si el OEM lo mata
        return START_STICKY;
    }

    /**
     * Registra un LocationListener nativo con GPS_PROVIDER.
     * Esto bypasea COMPLETAMENTE el WebView — funciona con pantalla apagada.
     */
    private void startLocationUpdates() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);

        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                lastLat = location.getLatitude();
                lastLng = location.getLongitude();
                lastSpeed = location.getSpeed() * 3.6f; // m/s → km/h
                lastBearing = location.getBearing();

                Log.d(TAG, String.format("📍 GPS: %.6f, %.6f | %.1f km/h | bearing: %.0f°",
                        lastLat, lastLng, lastSpeed, lastBearing));

                // Actualizar la notificación con las coordenadas actuales
                updateNotification(
                    "Punto Remis: Turno activo",
                    String.format("📍 %.4f, %.4f | %.0f km/h", lastLat, lastLng, lastSpeed)
                );

                // Enviar al WebView para que Firebase lo suba
                sendToWebView(lastLat, lastLng, lastSpeed, lastBearing);
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {}

            @Override
            public void onProviderEnabled(String provider) {
                Log.i(TAG, "✅ GPS Provider habilitado: " + provider);
            }

            @Override
            public void onProviderDisabled(String provider) {
                Log.w(TAG, "⚠️ GPS Provider deshabilitado: " + provider);
                updateNotification("⚠️ GPS desactivado", "Activá el GPS del teléfono para continuar el rastreo");
            }
        };

        try {
            // Prioridad: GPS_PROVIDER (satélite) > FUSED > NETWORK
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        MIN_TIME_MS,
                        MIN_DISTANCE_M,
                        locationListener
                );
                Log.i(TAG, "✅ GPS_PROVIDER registrado (heartbeat: " + MIN_TIME_MS + "ms)");
            }

            // También registrar NETWORK_PROVIDER como fallback
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        MIN_TIME_MS,
                        MIN_DISTANCE_M,
                        locationListener
                );
                Log.i(TAG, "✅ NETWORK_PROVIDER registrado como fallback");
            }
        } catch (SecurityException e) {
            Log.e(TAG, "❌ SecurityException: Permisos de ubicación no concedidos", e);
        }
    }

    /**
     * Envía las coordenadas al WebView (Capacitor Bridge) para que el JS
     * las suba a Firebase sin depender del GPS del navegador.
     */
    private void sendToWebView(double lat, double lng, float speed, float bearing) {
        try {
            // Usar el bridge de Capacitor para ejecutar JS en el WebView
            String js = String.format(
                "if(typeof window._onNativeGPS === 'function'){" +
                "  window._onNativeGPS(%f, %f, %f, %f);" +
                "}",
                lat, lng, speed, bearing
            );

            // El WebView ejecuta esto en el UI thread → actualize Firebase
            if (MainActivity.webView != null) {
                MainActivity.webView.post(() -> {
                    try {
                        MainActivity.webView.evaluateJavascript(js, null);
                    } catch (Exception e) {
                        Log.w(TAG, "evaluateJavascript falló (WebView pausado?)", e);
                    }
                });
            }
        } catch (Exception e) {
            Log.w(TAG, "sendToWebView error", e);
        }
    }

    // === NOTIFICATION CHANNEL (Android 8+) ===

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Rastreo GPS de Flota",
                    NotificationManager.IMPORTANCE_LOW // Sin sonido, sin vibración
            );
            channel.setDescription("Notificación persistente del servicio de rastreo GPS");
            channel.setShowBadge(false);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification(String title, String text) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(pendingIntent)
                .setOngoing(true)             // No se puede deslizar para cerrar
                .setSilent(true)              // Sin sonido
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }

    private void updateNotification(String title, String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification(title, text));
        }
    }

    // === WAKELOCK (safety net anti-Doze) ===

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "FleetAdmin::GPSTrackingLock"
            );
            wakeLock.acquire(12 * 60 * 60 * 1000L); // 12 horas (duración máxima de un turno)
            Log.i(TAG, "🛡️ WakeLock PARTIAL adquirido (12h max)");
        }
    }

    // === LIFECYCLE ===

    @Override
    public void onDestroy() {
        Log.w(TAG, "⛔ LocationTrackingService.onDestroy() — Limpiando recursos");

        // Detener GPS
        if (locationManager != null && locationListener != null) {
            locationManager.removeUpdates(locationListener);
        }

        // Liberar WakeLock
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            Log.i(TAG, "🛡️ WakeLock liberado");
        }

        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // No es un bound service
    }
}
