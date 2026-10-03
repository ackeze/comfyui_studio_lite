package com.comfyui.lite;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Capacitor 6: bridgeBuilder is consumed inside super.onCreate(),
        // so the plugin must be queued before it - registerPlugin() would
        // be a no-op at this point.
        initialPlugins.add(LanDiscoveryPlugin.class);
        initialPlugins.add(StudioDownloadsPlugin.class);
        super.onCreate(savedInstanceState);

        // Edge-to-edge: draw behind the system gesture pill and status bar so
        // the app content (not a white bar) sits under the Xiaomi hint line.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) {
            getWindow().setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightNavigationBars(false);
    }
}
