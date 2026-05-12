package com.jose07castro.fleetadminpro;

import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * MainActivity — Capacitor Bridge + Native Service Launcher (v4.0)
 *
 * Cambios v4.0:
 *   - startTracking(userId, driverName) ahora recibe parámetros
 *   - Los pasa al Service via Intent extras
 *   - El Service sube GPS directo a Firebase sin necesitar WebView
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "FleetGPS";
    private static final String PREFS_NAME = "fleet_gps_prefs";

    // Referencia estática para que el Service inyecte JS (respaldo UI).
    public static WebView webView = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Capturar referencia al WebView
        this.bridge.getWebView().post(() -> {
            webView = this.bridge.getWebView();
            webView.addJavascriptInterface(new NativeServiceBridge(), "NativeServiceBridge");
            Log.i(TAG, "✅ NativeServiceBridge registrado en el WebView");
        });
    }

    @Override
    public void onDestroy() {
        webView = null;
        super.onDestroy();
    }

    // =================================================================
    // BRIDGE JS → JAVA
    // =================================================================

    private class NativeServiceBridge {

        /**
         * Arranca el Foreground Service con userId y driverName.
         * Llamado desde JS: window.NativeServiceBridge.startTracking(userId, driverName)
         */
        @JavascriptInterface
        public void startTracking(String userId, String driverName) {
            Log.i(TAG, "📱 JS → startTracking('" + userId + "', '" + driverName + "')");
            
            Intent serviceIntent = new Intent(MainActivity.this, LocationTrackingService.class);
            serviceIntent.putExtra("userId", userId);
            serviceIntent.putExtra("driverName", driverName);
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        }

        /**
         * Versión sin parámetros (retrocompatibilidad).
         * Intenta recuperar userId de SharedPreferences.
         */
        @JavascriptInterface
        public void startTracking() {
            Log.i(TAG, "📱 JS → startTracking() (sin parámetros, usando SharedPreferences)");
            
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String savedUserId = prefs.getString("userId", null);
            String savedDriverName = prefs.getString("driverName", "Chofer");
            
            if (savedUserId != null) {
                startTracking(savedUserId, savedDriverName);
            } else {
                // Arrancar de todas formas (GPS corre pero no sube a Firebase hasta recibir userId)
                Intent serviceIntent = new Intent(MainActivity.this, LocationTrackingService.class);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent);
                } else {
                    startService(serviceIntent);
                }
            }
        }

        @JavascriptInterface
        public void stopTracking() {
            Log.i(TAG, "📱 JS → stopTracking()");
            Intent serviceIntent = new Intent(MainActivity.this, LocationTrackingService.class);
            stopService(serviceIntent);
            
            // Limpiar SharedPreferences
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            prefs.edit().clear().apply();
        }

        @JavascriptInterface
        public void requestBatteryExemption() {
            Log.i(TAG, "📱 JS → requestBatteryExemption()");
            try {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } else {
                    Log.i(TAG, "✅ Ya exenta de optimización de batería");
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Error battery exemption:", e);
            }
        }

        @JavascriptInterface
        public boolean isBatteryOptimized() {
            try {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                return pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName());
            } catch (Exception e) {
                return true;
            }
        }
    }
}
