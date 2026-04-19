package com.jose07castro.fleetadminpro;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

/**
 * MainActivity — Capacitor Bridge + WebView Reference
 * 
 * Expone una referencia estática al WebView para que LocationTrackingService
 * pueda inyectar coordenadas GPS nativas via evaluateJavascript().
 */
public class MainActivity extends BridgeActivity {

    // Referencia estática al WebView para que el Service pueda inyectar JS
    // NOTA: Es estática porque el Service vive en el mismo proceso pero
    // no tiene acceso directo a la Activity. Se limpia en onDestroy().
    public static WebView webView = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Obtener referencia al WebView de Capacitor después de que el bridge lo cree
        this.bridge.getWebView().post(() -> {
            webView = this.bridge.getWebView();
        });
    }

    @Override
    protected void onDestroy() {
        webView = null; // Evitar memory leak
        super.onDestroy();
    }
}
