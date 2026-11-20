package com.fleetadminpro.control;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;
import androidx.core.content.FileProvider;

import com.getcapacitor.BridgeActivity;

import java.io.File;
import java.io.FileOutputStream;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "FleetControl";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Permiso de notificaciones en Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{ Manifest.permission.POST_NOTIFICATIONS }, 8001);
            }
        }

        // Registrar puente nativo en el WebView (persiste aunque navegue al servidor Render /qr)
        try {
            if (this.bridge != null && this.bridge.getWebView() != null) {
                final WebView wv = this.bridge.getWebView();
                wv.post(() -> {
                    try {
                        wv.addJavascriptInterface(new FleetControlBridge(), "FleetControlBridge");
                        Log.i(TAG, "✅ FleetControlBridge registrado en WebView");
                    } catch (Exception e) {
                        Log.w(TAG, "⚠️ Error registrando FleetControlBridge: " + e.getMessage());
                    }
                });
            }
        } catch (Exception e) {
            Log.w(TAG, "⚠️ Error inicializando WebView bridge: " + e.getMessage());
        }

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = (bridge != null) ? bridge.getWebView() : null;
                if (wv != null && wv.canGoBack()) {
                    wv.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                if (!isFinishing()) {
                    setEnabled(true);
                }
            }
        });
    }

    public class FleetControlBridge {

        @JavascriptInterface
        public boolean shareQrBase64(final String dataUrl) {
            try {
                if (dataUrl == null || dataUrl.isEmpty()) return false;
                String cleanB64 = dataUrl;
                int commaIdx = cleanB64.indexOf(',');
                if (commaIdx >= 0) {
                    cleanB64 = cleanB64.substring(commaIdx + 1);
                }
                byte[] bytes = Base64.decode(cleanB64, Base64.DEFAULT);
                File outFile = new File(getCacheDir(), "whatsapp-qr-fleetadmin.png");
                FileOutputStream fos = new FileOutputStream(outFile);
                fos.write(bytes);
                fos.flush();
                fos.close();

                final Uri contentUri = FileProvider.getUriForFile(
                    MainActivity.this,
                    getPackageName() + ".fileprovider",
                    outFile
                );

                MainActivity.this.runOnUiThread(() -> {
                    try {
                        Intent shareIntent = new Intent(Intent.ACTION_SEND);
                        shareIntent.setType("image/png");
                        shareIntent.putExtra(Intent.EXTRA_STREAM, contentUri);
                        shareIntent.putExtra(Intent.EXTRA_TEXT, "Código QR WhatsApp Bot — FleetAdmin Pro");
                        shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        Intent chooser = Intent.createChooser(shareIntent, "Compartir o Guardar QR de WhatsApp");
                        chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(chooser);
                    } catch (Exception ex) {
                        Log.e(TAG, "Error lanzando chooser shareQrBase64: " + ex.getMessage());
                    }
                });
                return true;
            } catch (Exception e) {
                Log.e(TAG, "Error en shareQrBase64: " + e.getMessage());
                return false;
            }
        }
    }
}
