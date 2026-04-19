package com.jose07castro.fleetadminpro;

import android.content.Intent;
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
 * MainActivity — Capacitor Bridge + Native Service Launcher
 *
 * Responsabilidades:
 *   1. Exponer WebView estático para que LocationTrackingService inyecte GPS.
 *   2. Registrar un @JavascriptInterface que permite al JS arrancar/detener
 *      el Foreground Service nativo SIN depender de plugins intermediarios.
 *   3. Proveer el Intent de REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
 *      para que el JS pueda pedir la exención de batería.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "FleetGPS";

    // Referencia estática para que el Service inyecte JS.
    // Es segura porque Activity y Service corren en el mismo proceso.
    public static WebView webView = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Capturar referencia al WebView una vez que Capacitor lo inicialice
        this.bridge.getWebView().post(() -> {
            webView = this.bridge.getWebView();

            // Registrar el bridge JS → Java para arrancar el Service nativo
            webView.addJavascriptInterface(new NativeServiceBridge(), "NativeServiceBridge");
            Log.i(TAG, "✅ NativeServiceBridge registrado en el WebView");
        });
    }

    @Override
    public void onDestroy() {
        webView = null; // Evitar memory leak
        super.onDestroy();
    }

    // =================================================================
    // BRIDGE JS → JAVA
    //
    // Desde JS se llama:
    //   window.NativeServiceBridge.startTracking()
    //   window.NativeServiceBridge.stopTracking()
    //   window.NativeServiceBridge.requestBatteryExemption()
    // =================================================================

    private class NativeServiceBridge {

        @JavascriptInterface
        public void startTracking() {
            Log.i(TAG, "📱 JS → startTracking() — Arrancando LocationTrackingService");
            Intent serviceIntent = new Intent(MainActivity.this, LocationTrackingService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        }

        @JavascriptInterface
        public void stopTracking() {
            Log.i(TAG, "📱 JS → stopTracking() — Deteniendo LocationTrackingService");
            Intent serviceIntent = new Intent(MainActivity.this, LocationTrackingService.class);
            stopService(serviceIntent);
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
                    Log.i(TAG, "✅ La app ya está exenta de optimización de batería");
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Error solicitando battery exemption:", e);
            }
        }

        @JavascriptInterface
        public boolean isBatteryOptimized() {
            try {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                return pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName());
            } catch (Exception e) {
                return true; // Asumir optimizado si falla
            }
        }
    }
}
