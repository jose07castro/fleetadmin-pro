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

import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;
import com.google.android.gms.tasks.Task;

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

        // Solicitar permisos de ubicación al iniciar la app si no están ya otorgados
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            boolean hasFine = checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
            boolean hasBg = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                hasBg = checkSelfPermission(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
            }

            if (!hasFine) {
                // Si no tiene primer plano, pedir primer plano
                requestPermissions(new String[]{
                    android.Manifest.permission.ACCESS_FINE_LOCATION,
                    android.Manifest.permission.ACCESS_COARSE_LOCATION
                }, 7001);
            } else if (!hasBg) {
                // Si tiene primer plano pero no background, pedir background ("Permitir todo el tiempo")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    requestPermissions(new String[]{
                        android.Manifest.permission.ACCESS_BACKGROUND_LOCATION
                    }, 7002);
                }
            }
        }

        // Capturar referencia al WebView
        this.bridge.getWebView().post(() -> {
            webView = this.bridge.getWebView();
            webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
            webView.addJavascriptInterface(new NativeServiceBridge(), "NativeServiceBridge");
            Log.i(TAG, "✅ NativeServiceBridge registrado en el WebView");
        });

        // Verificar actualizaciones al iniciar
        checkPlayStoreUpdate();
    }

    private static final int MY_REQUEST_CODE = 9001;

    private void checkPlayStoreUpdate() {
        try {
            AppUpdateManager appUpdateManager = AppUpdateManagerFactory.create(this);
            Task<AppUpdateInfo> appUpdateInfoTask = appUpdateManager.getAppUpdateInfo();
            appUpdateInfoTask.addOnSuccessListener(appUpdateInfo -> {
                if (appUpdateInfo.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                        && appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                    try {
                        appUpdateManager.startUpdateFlowForResult(
                            appUpdateInfo,
                            AppUpdateType.IMMEDIATE,
                            this,
                            MY_REQUEST_CODE
                        );
                    } catch (Exception e) {
                        Log.e(TAG, "Error starting immediate update flow: " + e.getMessage());
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error checking play store update: " + e.getMessage());
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        try {
            AppUpdateManager appUpdateManager = AppUpdateManagerFactory.create(this);
            appUpdateManager.getAppUpdateInfo().addOnSuccessListener(appUpdateInfo -> {
                if (appUpdateInfo.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
                    try {
                        appUpdateManager.startUpdateFlowForResult(
                            appUpdateInfo,
                            AppUpdateType.IMMEDIATE,
                            this,
                            MY_REQUEST_CODE
                        );
                    } catch (Exception e) {
                        Log.e(TAG, "Error resuming update flow: " + e.getMessage());
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error checking active update in resume: " + e.getMessage());
        }
        checkPlayStoreUpdate();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == MY_REQUEST_CODE) {
            if (resultCode != RESULT_OK) {
                Log.e(TAG, "In-app update failed or cancelled by user. Result code: " + resultCode);
                checkPlayStoreUpdate();
            }
        }
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
         * Arranca el Foreground Service con userId, driverName, fleetId y serverUrl.
         * Llamado desde JS: window.NativeServiceBridge.startTracking(userId, driverName, fleetId, serverUrl)
         */
        @JavascriptInterface
        public void startTracking(String userId, String driverName, String fleetId, String serverUrl) {
            Log.i(TAG, "📱 JS → startTracking('" + userId + "', '" + driverName + "', '" + fleetId + "', '" + serverUrl + "')");
            
            Intent serviceIntent = new Intent(MainActivity.this, LocationTrackingService.class);
            serviceIntent.putExtra("userId", userId);
            serviceIntent.putExtra("driverName", driverName);
            serviceIntent.putExtra("fleetId", fleetId);
            serviceIntent.putExtra("serverUrl", serverUrl);
            
            androidx.core.content.ContextCompat.startForegroundService(MainActivity.this, serviceIntent);
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
            String savedFleetId = prefs.getString("fleetId", null);
            String savedServerUrl = prefs.getString("serverUrl", "https://fleetadmin-web-nueva.onrender.com");
            
            if (savedUserId != null) {
                startTracking(savedUserId, savedDriverName, savedFleetId, savedServerUrl);
            } else {
                // Arrancar de todas formas (GPS corre pero no sube a Firebase hasta recibir userId)
                Intent serviceIntent = new Intent(MainActivity.this, LocationTrackingService.class);
                androidx.core.content.ContextCompat.startForegroundService(MainActivity.this, serviceIntent);
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
                    // Intento 1: Diálogo directo de confirmación (funciona en AOSP estándar)
                    try {
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + getPackageName()));
                        startActivity(intent);
                        Log.i(TAG, "✅ Diálogo directo de batería abierto");
                        return;
                    } catch (Exception e1) {
                        Log.w(TAG, "⚠️ ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS falló, intentando lista de optimización...", e1);
                    }

                    // Intento 2: Pantalla con la lista de aplicaciones optimizadas (Xiaomi, OnePlus, etc.)
                    try {
                        Intent intentList = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                        startActivity(intentList);
                        Log.i(TAG, "✅ Lista de optimización de batería abierta");
                        return;
                    } catch (Exception e2) {
                        Log.w(TAG, "⚠️ ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS falló, abriendo ajustes de la app...", e2);
                    }

                    // Intento 3 (Universal): Información de la aplicación — disponible en el 100% de los Android
                    try {
                        Intent intentAppDetails = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        intentAppDetails.setData(Uri.parse("package:" + getPackageName()));
                        startActivity(intentAppDetails);
                        Log.i(TAG, "✅ Ajustes de la aplicación abiertos (fallback universal)");
                    } catch (Exception e3) {
                        Log.e(TAG, "❌ No se pudo abrir ninguna pantalla de configuración de batería", e3);
                    }
                } else {
                    Log.i(TAG, "✅ Ya exenta de optimización de batería");
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Error general en requestBatteryExemption:", e);
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

        @JavascriptInterface
        public boolean isBackgroundLocationGranted() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                return checkSelfPermission(android.Manifest.permission.ACCESS_BACKGROUND_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
            }
            return true;
        }

        @JavascriptInterface
        public void requestBackgroundLocationPermission() {
            Log.i(TAG, "📱 JS → requestBackgroundLocationPermission()");
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    // En Android 11+ (API 30+), redirigir directamente a Ajustes para permitir al usuario seleccionar "Permitir todo el tiempo"
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Verificamos primero si tenemos permiso de primer plano.
                    if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        // En Android 10 (API 29), solicitar ACCESS_BACKGROUND_LOCATION
                        requestPermissions(new String[]{android.Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 7002);
                    } else {
                        // Si no tiene primer plano, pedirlo primero
                        requestPermissions(new String[]{
                            android.Manifest.permission.ACCESS_FINE_LOCATION,
                            android.Manifest.permission.ACCESS_COARSE_LOCATION
                        }, 7001);
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Error requesting background location permission, falling back to app details:", e);
                try {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception ex) {
                    Log.e(TAG, "❌ Fallback intent failed:", ex);
                }
            }
        }

        @JavascriptInterface
        public String getAppVersionName() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                Log.e(TAG, "Error getting versionName", e);
                return "1.2.44";
            }
        }

        @JavascriptInterface
        public int getAppVersionCode() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    return (int) getPackageManager().getPackageInfo(getPackageName(), 0).getLongVersionCode();
                } else {
                    return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
                }
            } catch (Exception e) {
                Log.e(TAG, "Error getting versionCode", e);
                return 53;
            }
        }
    }
}
