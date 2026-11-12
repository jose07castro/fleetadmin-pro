package com.jose07castro.fleetadminpro;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.core.content.ContextCompat;

/**
 * Receptor de resurrección automática del servicio GPS en segundo plano.
 * Revive LocationTrackingService ante:
 *  - Alarmas periódicas de vigilancia durante un turno activo (ACTION_KEEPALIVE_SHIFT)
 *  - Cierre forzado / muerte por batería o RAM en onDestroy
 *  - Reinicio del teléfono (BOOT_COMPLETED / QUICKBOOT_POWERON)
 *  - Actualización de la app (MY_PACKAGE_REPLACED)
 */
public class ShiftKeepAliveReceiver extends BroadcastReceiver {

    private static final String TAG = "FleetGPS";
    private static final String PREFS_NAME = "fleet_gps_prefs";
    public static final String ACTION_KEEPALIVE_SHIFT = "com.jose07castro.fleetadminpro.ACTION_KEEPALIVE_SHIFT";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null) return;
        String action = (intent != null && intent.getAction() != null) ? intent.getAction() : ACTION_KEEPALIVE_SHIFT;

        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String userId = prefs.getString("userId", null);
            boolean isShiftActive = prefs.getBoolean("is_shift_active", false);

            if (userId == null || userId.isEmpty()) {
                return;
            }

            // Si hay turno activo y el servicio no está corriendo (o es un chequeo de keepalive / boot), levantarlo
            if (isShiftActive || LocationTrackingService.instance == null) {
                Log.i(TAG, "🛡️ [KEEPALIVE-RECEIVER] Acción recibida (" + action + ") | Turno activo=" + isShiftActive + " | Service vivo=" + (LocationTrackingService.instance != null) + " → Asegurando LocationTrackingService...");

                String driverName = prefs.getString("driverName", "Chofer");
                String fleetId = prefs.getString("fleetId", null);
                String serverUrl = prefs.getString("serverUrl", "https://fleetadmin-web-nueva.onrender.com");

                Intent serviceIntent = new Intent(context, LocationTrackingService.class);
                serviceIntent.putExtra("userId", userId);
                serviceIntent.putExtra("driverName", driverName);
                serviceIntent.putExtra("fleetId", fleetId);
                serviceIntent.putExtra("serverUrl", serverUrl);
                serviceIntent.putExtra("isShiftActive", isShiftActive);

                ContextCompat.startForegroundService(context, serviceIntent);
            }

            // Si el turno sigue activo, reprogramar el próximo ciclo de vigilancia
            if (isShiftActive) {
                LocationTrackingService.scheduleKeepAliveAlarmStatic(context, 90000L);
            }
        } catch (Exception e) {
            Log.e(TAG, "⚠️ [KEEPALIVE-RECEIVER] Error al revivir LocationTrackingService:", e);
        }
    }
}

