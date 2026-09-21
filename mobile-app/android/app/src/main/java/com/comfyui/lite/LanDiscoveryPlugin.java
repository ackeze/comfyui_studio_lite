package com.comfyui.lite;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

@CapacitorPlugin(name = "LanDiscovery")
public class LanDiscoveryPlugin extends Plugin {
    private final AtomicBoolean scanning = new AtomicBoolean(false);
    private static final String SERVICE_TYPE = "_comfy-studio._tcp.";
    private static final int DEFAULT_PORT = 8188;
    private static final int MAX_SUBNET_HOSTS = 4096;

    @PluginMethod
    public void scan(PluginCall call) {
        if (!scanning.compareAndSet(false, true)) {
            call.reject("Discovery already running");
            return;
        }
        new Thread(() -> discover(call), "ComfyDiscovery").start();
    }

    private void discover(PluginCall call) {
        NsdManager manager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        List<NsdServiceInfo> found = new ArrayList<>();
        CountDownLatch discoveryDone = new CountDownLatch(1);
        AtomicReference<String> failure = new AtomicReference<>();
        NsdManager.DiscoveryListener listener = new NsdManager.DiscoveryListener() {
            public void onDiscoveryStarted(String type) {}
            public void onDiscoveryStopped(String type) { discoveryDone.countDown(); }
            public void onStartDiscoveryFailed(String type, int code) {
                failure.set("mDNS discovery failed: " + code);
                discoveryDone.countDown();
            }
            public void onStopDiscoveryFailed(String type, int code) {}
            public void onServiceFound(NsdServiceInfo service) {
                if (!service.getServiceType().equals(SERVICE_TYPE)) return;
                synchronized (found) {
                    for (NsdServiceInfo existing : found) {
                        if (existing.getServiceName().equals(service.getServiceName())) return;
                    }
                    if (found.size() < 16) found.add(service);
                }
            }
            public void onServiceLost(NsdServiceInfo service) {
                synchronized (found) {
                    found.removeIf(item -> item.getServiceName().equals(service.getServiceName()));
                }
            }
        };
        boolean started = false;
        WifiManager.MulticastLock multicastLock = null;
        try {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                multicastLock = wifi.createMulticastLock("comfy-studio-discovery");
                multicastLock.setReferenceCounted(false);
                multicastLock.acquire();
            }
            JSONArray servers = new JSONArray();
            Set<String> seen = new HashSet<>();
            if (manager != null) {
                try {
                    manager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener);
                    started = true;
                    discoveryDone.await(5, TimeUnit.SECONDS);
                } catch (Exception error) {
                    failure.set(error.getMessage());
                }
                if (failure.get() == null) {
                    List<NsdServiceInfo> candidates;
                    synchronized (found) { candidates = new ArrayList<>(found); }
                    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(15);
                    for (NsdServiceInfo candidate : candidates) {
                        if (System.nanoTime() >= deadline) break;
                        CountDownLatch resolved = new CountDownLatch(1);
                        AtomicReference<NsdServiceInfo> result = new AtomicReference<>();
                        try {
                            manager.resolveService(candidate, new NsdManager.ResolveListener() {
                                public void onResolveFailed(NsdServiceInfo service, int code) { resolved.countDown(); }
                                public void onServiceResolved(NsdServiceInfo service) { result.set(service); resolved.countDown(); }
                            });
                            if (!resolved.await(3, TimeUnit.SECONDS)) break;
                        } catch (Exception ignored) {
                            continue;
                        }
                        NsdServiceInfo service = result.get();
                        if (service == null || service.getHost() == null) continue;
                        JSONObject verified = verify(service);
                        addServer(servers, verified, seen);
                    }
                }
            }
            scanLocalSubnet(servers, seen);
            call.resolve(new JSObject().put("servers", servers));
        } catch (Exception error) {
            call.reject("Discovery failed: " + error.getMessage());
        } finally {
            if (started) {
                try { manager.stopServiceDiscovery(listener); }
                catch (IllegalArgumentException ignored) {}
            }
            if (multicastLock != null && multicastLock.isHeld()) multicastLock.release();
            scanning.set(false);
        }
    }

    private JSONObject verify(NsdServiceInfo service) {
        if (service.getHost() == null) return null;
        return verify(service.getHost(), service.getPort(), 2000);
    }

    private void scanLocalSubnet(JSONArray servers, Set<String> seen) throws InterruptedException {
        Set<String> hosts = localSubnetHosts();
        if (hosts.isEmpty()) return;
        ExecutorService workers = Executors.newFixedThreadPool(Math.min(32, hosts.size()));
        CountDownLatch finished = new CountDownLatch(hosts.size());
        for (String host : hosts) {
            workers.execute(() -> {
                try {
                    JSONObject verified = verifyAddress(host, DEFAULT_PORT, 550);
                    addServer(servers, verified, seen);
                } finally {
                    finished.countDown();
                }
            });
        }
        finished.await(8, TimeUnit.SECONDS);
        workers.shutdownNow();
    }

    private Set<String> localSubnetHosts() {
        Set<String> hosts = new LinkedHashSet<>();
        try {
            java.util.Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback() || network.isVirtual()) continue;
                for (InterfaceAddress entry : network.getInterfaceAddresses()) {
                    InetAddress address = entry.getAddress();
                    if (!(address instanceof Inet4Address) || !address.isSiteLocalAddress()) continue;
                    short prefix = entry.getNetworkPrefixLength();
                    if (prefix < 20 || prefix > 30) continue;
                    int hostBits = 32 - prefix;
                    int addressValue = ipv4Value((Inet4Address) address);
                    int networkValue = addressValue & (-1 << hostBits);
                    int broadcastValue = networkValue | ((1 << hostBits) - 1);
                    if (broadcastValue - networkValue - 1 > MAX_SUBNET_HOSTS) continue;
                    for (int value = networkValue + 1; value < broadcastValue; value++) {
                        if (value != addressValue) hosts.add(ipv4String(value));
                    }
                }
            }
        } catch (Exception ignored) {
            hosts.clear();
        }
        return hosts;
    }

    private int ipv4Value(Inet4Address address) {
        byte[] bytes = address.getAddress();
        return ((bytes[0] & 255) << 24) | ((bytes[1] & 255) << 16)
                | ((bytes[2] & 255) << 8) | (bytes[3] & 255);
    }

    private String ipv4String(int value) {
        return ((value >>> 24) & 255) + "." + ((value >>> 16) & 255) + "."
                + ((value >>> 8) & 255) + "." + (value & 255);
    }

    private JSONObject verifyAddress(String host, int port, int timeoutMs) {
        try {
            return verify(InetAddress.getByName(host), port, timeoutMs);
        } catch (Exception ignored) {
            return null;
        }
    }

    private JSONObject verify(InetAddress address, int port, int timeoutMs) {
        HttpURLConnection connection = null;
        try {
            if (address.isLoopbackAddress() || address.isAnyLocalAddress()) return null;
            if (port < 1 || port > 65535) return null;
            String host = address.getHostAddress();
            String authority = host.contains(":") ? "[" + host.replace("%", "%25") + "]" : host;
            String origin = "http://" + authority + ":" + port;
            String challenge = UUID.randomUUID().toString().replace("-", "");
            connection = (HttpURLConnection) new URL(origin + "/launcher/discover?challenge=" + challenge).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
            if (connection.getResponseCode() != 200) return null;
            byte[] buffer = new byte[8193];
            int size = 0;
            try (InputStream input = connection.getInputStream()) {
                int read;
                while (size < buffer.length && (read = input.read(buffer, size, buffer.length - size)) != -1) size += read;
            }
            if (size == buffer.length) return null;
            JSONObject data = new JSONObject(new String(buffer, 0, size, StandardCharsets.UTF_8));
            if (!"comfy-studio".equals(data.optString("app"))
                    || data.optInt("protocol") != 1
                    || !challenge.equals(data.optString("challenge"))
                    || data.optInt("port") != port) return null;
            return new JSONObject().put("url", origin).put("name", data.optString("name", "Comfy Studio"))
                    .put("app", "comfy-studio").put("protocol", 1);
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void addServer(JSONArray servers, JSONObject verified, Set<String> seen) {
        if (verified == null) return;
        String url = verified.optString("url", "");
        synchronized (servers) {
            if (url.isEmpty() || seen.contains(url) || servers.length() >= 16) return;
            seen.add(url);
            servers.put(verified);
        }
    }
}
