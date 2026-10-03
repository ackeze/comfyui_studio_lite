package com.comfyui.lite;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.webkit.CookieManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLConnection;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "StudioDownloads")
public class StudioDownloadsPlugin extends Plugin {
    private final AtomicBoolean saving = new AtomicBoolean(false);
    private byte[] pendingData;

    @PluginMethod
    public void save(PluginCall call) {
        String url = call.getString("url", "");
        String data = call.getString("base64", "");
        Uri source = Uri.parse(url);
        if (!url.isEmpty() && (!("http".equals(source.getScheme()) || "https".equals(source.getScheme())) || source.getHost() == null)) {
            call.reject("文件地址无效");
            return;
        }
        if (url.isEmpty() && (data.isEmpty() || data.length() > 45 * 1024 * 1024)) {
            call.reject("导出文件为空或过大");
            return;
        }
        if (!saving.compareAndSet(false, true)) {
            call.reject("请先完成当前文件保存");
            return;
        }
        try {
            pendingData = url.isEmpty() ? Base64.decode(data, Base64.DEFAULT) : null;
            if (pendingData != null && pendingData.length > 32 * 1024 * 1024) throw new IllegalArgumentException("导出文件超过 32 MiB");
        } catch (IllegalArgumentException error) {
            pendingData = null;
            saving.set(false);
            call.reject("导出数据无效或过大", error);
            return;
        }
        // Activity state must not persist a large Base64 payload in its Bundle.
        call.getData().remove("base64");
        String filename = call.getString("filename", "comfy-studio-file").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (filename.isEmpty() || filename.equals(".") || filename.equals("..")) filename = "comfy-studio-file";
        String mime = call.getString("mime", URLConnection.guessContentTypeFromName(filename));
        if (mime == null || !mime.matches("[\\w.+-]+/[\\w.+-]+")) mime = "application/octet-stream";
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mime);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, intent, "savedLocation");
            } catch (android.content.ActivityNotFoundException error) {
                pendingData = null;
                saving.set(false);
                call.reject("系统文件保存窗口不可用", error);
            }
        });
    }

    @ActivityCallback
    private void savedLocation(PluginCall call, ActivityResult result) {
        if (call == null) {
            pendingData = null;
            saving.set(false);
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            pendingData = null;
            saving.set(false);
            JSObject response = new JSObject();
            response.put("cancelled", true);
            call.resolve(response);
            return;
        }
        Uri destination = result.getData().getData();
        new Thread(() -> writeFile(call, destination), "ComfyDownload").start();
    }

    private void writeFile(PluginCall call, Uri destination) {
        HttpURLConnection connection = null;
        try {
            InputStream input;
            String url = call.getString("url", "");
            if (!url.isEmpty()) {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(60000);
                connection.setInstanceFollowRedirects(false);
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) connection.setRequestProperty("Cookie", cookie);
                if (connection.getResponseCode() != 200) throw new IOException("服务器返回 HTTP " + connection.getResponseCode());
                input = connection.getInputStream();
            } else {
                if (pendingData == null) throw new IOException("导出缓存已丢失，请重新导出");
                input = new ByteArrayInputStream(pendingData);
            }
            long written = 0;
            try (InputStream stream = input; OutputStream output = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("无法打开保存位置");
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = stream.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                    written += count;
                }
                String expected = connection == null ? null : connection.getHeaderField("Content-Length");
                if (expected != null && written != Long.parseLong(expected)) throw new IOException("文件传输不完整，请重试");
            }
            JSObject response = new JSObject();
            response.put("bytes", written);
            call.resolve(response);
        } catch (IOException | IllegalArgumentException | SecurityException error) {
            try {
                if (!DocumentsContract.deleteDocument(getContext().getContentResolver(), destination)) throw new IOException("无法删除未完成的文件");
            } catch (IOException | SecurityException cleanupError) {
                call.reject("保存失败，请删除未完成的文件：" + error.getMessage(), error);
                return;
            }
            call.reject("文件保存失败：" + error.getMessage(), error);
        } finally {
            if (connection != null) connection.disconnect();
            pendingData = null;
            saving.set(false);
        }
    }
}
