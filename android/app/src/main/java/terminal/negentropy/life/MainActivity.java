package terminal.negentropy.life;

import android.Manifest;
import android.app.AlarmManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "NegentropyMainActivity";
    private static final int PERMISSION_REQUEST_CODE = 123;
    private BroadcastReceiver heartbeatReceiver;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        checkAndRequestPermissions();
        requestIgnoreBatteryOptimizations();
        setupHeartbeatReceiver();
        
        // 注册桥接接口，供 JS 调用（使用匿名对象，与原版一致）
        if (bridge != null && bridge.getWebView() != null) {
            final Context appContext = getApplicationContext();
            bridge.getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void postNotification(String title, String body) {
                    Log.d(TAG, "JS requested native notification via Interface");
                    Intent intent = new Intent("terminal.negentropy.life.SHOW_NOTIFICATION");
                    intent.putExtra("title", title);
                    intent.putExtra("body", body);
                    intent.setPackage(appContext.getPackageName());
                    appContext.sendBroadcast(intent);
                }

                @JavascriptInterface
                public void playHapticPattern(String patternJson) {
                    EmotionHaptics.playPatternJson(appContext, patternJson);
                }

                @JavascriptInterface
                public void cancelHaptics() {
                    EmotionHaptics.cancel(appContext);
                }

                @JavascriptInterface
                public void startStreamingChat(String requestId, String requestJson) {
                    try {
                        OpenAIStreamingBridge.startStreamingChat(bridge.getWebView(), requestId, requestJson);
                    } catch (Exception error) {
                        Log.e(TAG, "Failed to start native streaming chat", error);
                        if (bridge != null && bridge.getWebView() != null) {
                            OpenAIStreamingBridge.emitBridgeError(
                                    bridge.getWebView(),
                                    requestId,
                                    error.getMessage() != null ? error.getMessage() : "Failed to start native streaming chat"
                            );
                        }
                    }
                }

                @JavascriptInterface
                public void cancelStreamingChat(String requestId) {
                    OpenAIStreamingBridge.cancelStreamingChat(requestId);
                }

                @JavascriptInterface
                public String getHapticStatus() {
                    try {
                        JSONObject status = new JSONObject();
                        status.put("bridgeReady", true);
                        status.put("hasVibrator", EmotionHaptics.hasVibrator(appContext));
                        status.put("nativeAvailable", EmotionHaptics.hasVibrator(appContext));
                        status.put("lastNativeError", EmotionHaptics.getLastError());
                        return status.toString();
                    } catch (Exception error) {
                        Log.e(TAG, "Failed to build haptic status", error);
                        return "{\"bridgeReady\":true,\"hasVibrator\":false,\"nativeAvailable\":false,\"lastNativeError\":\""
                                + String.valueOf(error.getMessage()).replace("\"", "'")
                                + "\"}";
                    }
                }

                @JavascriptInterface
                public String getBackgroundDiagnosticsLog() {
                    try {
                        return KeepAliveService.getStoredBackgroundDiagnosticsLog(appContext);
                    } catch (Exception error) {
                        Log.e(TAG, "Failed to read background diagnostics log", error);
                        return "[]";
                    }
                }

                @JavascriptInterface
                public void clearBackgroundDiagnosticsLog() {
                    try {
                        KeepAliveService.clearStoredBackgroundDiagnosticsLog(appContext);
                    } catch (Exception error) {
                        Log.e(TAG, "Failed to clear background diagnostics log", error);
                    }
                }

                @JavascriptInterface
                public String drainPendingNotifications() {
                    try {
                        return KeepAliveService.drainPendingNotifications(appContext);
                    } catch (Exception error) {
                        Log.e(TAG, "Failed to drain pending notifications", error);
                        return "[]";
                    }
                }

                @JavascriptInterface
                public String getPermissionStatus() {
                    try {
                        JSONObject status = new JSONObject();
                        status.put("manufacturer", Build.MANUFACTURER);
                        status.put("model", Build.MODEL);
                        status.put("androidVersion", Build.VERSION.SDK_INT);

                        // 通知权限
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            boolean granted = ContextCompat.checkSelfPermission(appContext,
                                    Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
                            status.put("notificationPermission", granted);
                        } else {
                            status.put("notificationPermission", true);
                        }

                        // 电池优化白名单
                        PowerManager pm = (PowerManager) appContext.getSystemService(Context.POWER_SERVICE);
                        if (pm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            status.put("batteryOptimizationWhitelisted", pm.isIgnoringBatteryOptimizations(appContext.getPackageName()));
                        } else {
                            status.put("batteryOptimizationWhitelisted", "unknown");
                        }

                        // 精确闹钟权限
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            AlarmManager am = (AlarmManager) appContext.getSystemService(Context.ALARM_SERVICE);
                            status.put("canScheduleExactAlarms", am != null && am.canScheduleExactAlarms());
                        } else {
                            status.put("canScheduleExactAlarms", true);
                        }

                        // 前台服务是否在运行
                        status.put("keepAliveServiceRunning", KeepAliveService.isRunning());

                        return status.toString();
                    } catch (Exception error) {
                        Log.e(TAG, "Failed to build permission status", error);
                        return "{\"error\":\"" + String.valueOf(error.getMessage()).replace("\"", "'") + "\"}";
                    }
                }

                @JavascriptInterface
                public void openAutoStartSettings() {
                    try {
                        String manufacturer = Build.MANUFACTURER.toLowerCase();
                        Intent intent = new Intent();

                        // 根据不同厂商尝试跳转到自启动管理页
                        if (manufacturer.contains("oneplus") || manufacturer.contains("oppo") || manufacturer.contains("realme")) {
                            // ColorOS / OxygenOS / RealmeUI
                            intent.setAction("com.coloros.safecenter.permission.PermissionTopActivity");
                        } else if (manufacturer.contains("xiaomi") || manufacturer.contains("redmi")) {
                            // MIUI / HyperOS
                            intent.setAction("miui.intent.action.AUTO_START");
                        } else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
                            // HarmonyOS / MagicUI
                            intent.setAction("huawei.intent.action.AUTO_LAUNCH");
                        } else if (manufacturer.contains("vivo")) {
                            intent.setAction("com.vivo.permissionmanager");
                        } else if (manufacturer.contains("samsung")) {
                            intent.setAction("com.samsung.android.sm.ACTION_BATTERY");
                        }

                        if (intent.getAction() != null) {
                            try {
                                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                appContext.startActivity(intent);
                                return;
                            } catch (Exception ignored) {}
                        }

                        // 通用回退：打开应用详情页
                        Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        fallback.setData(Uri.parse("package:" + appContext.getPackageName()));
                        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        appContext.startActivity(fallback);
                    } catch (Exception error) {
                        Log.e(TAG, "Failed to open auto-start settings", error);
                    }
                }

                @JavascriptInterface
                public void openExternalUrl(String rawUrl) {
                    if (rawUrl == null || rawUrl.trim().isEmpty()) return;

                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(rawUrl.trim()));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        appContext.startActivity(intent);
                    } catch (Exception error) {
                        Log.e(TAG, "Failed to open external url: " + rawUrl, error);

                        if (rawUrl.startsWith("market://")) {
                            try {
                                Uri marketUri = Uri.parse(rawUrl);
                                String packageId = marketUri.getQueryParameter("id");
                                if (packageId != null && !packageId.trim().isEmpty()) {
                                    Intent fallbackIntent = new Intent(
                                            Intent.ACTION_VIEW,
                                            Uri.parse("https://play.google.com/store/apps/details?id=" + packageId.trim())
                                    );
                                    fallbackIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                    appContext.startActivity(fallbackIntent);
                                }
                            } catch (Exception fallbackError) {
                                Log.e(TAG, "Failed to open Play Store fallback for url: " + rawUrl, fallbackError);
                            }
                        }
                    }
                }

                @JavascriptInterface
                public void syncConfig(String jsonConfig) {
                    try {
                        JSONObject config = new JSONObject(jsonConfig);
                        SharedPreferences prefs = appContext.getSharedPreferences(
                                KeepAliveService.PREFS_NAME, MODE_PRIVATE);
                        SharedPreferences.Editor editor = prefs.edit();

                        if (config.has("personaName")) editor.putString("personaName", config.getString("personaName"));
                        if (config.has("voiceTone")) editor.putString("voiceTone", config.getString("voiceTone"));
                        if (config.has("targetSleepTime")) editor.putString("targetSleepTime", config.getString("targetSleepTime"));
                        if (config.has("wakeUpTime")) editor.putString("wakeUpTime", config.getString("wakeUpTime"));

                        if (config.has("provider")) editor.putString("provider", config.getString("provider"));
                        if (config.has("apiKey")) editor.putString("apiKey", config.getString("apiKey"));
                        if (config.has("modelId")) editor.putString("modelId", config.getString("modelId"));
                        if (config.has("baseUrl")) editor.putString("baseUrl", config.optString("baseUrl", ""));

                        if (config.has("notificationProvider")) editor.putString("notificationProvider", config.optString("notificationProvider", ""));
                        if (config.has("notificationApiKey")) editor.putString("notificationApiKey", config.optString("notificationApiKey", ""));
                        if (config.has("notificationModelId")) editor.putString("notificationModelId", config.optString("notificationModelId", ""));
                        if (config.has("notificationBaseUrl")) editor.putString("notificationBaseUrl", config.optString("notificationBaseUrl", ""));

                        if (config.has("notificationPrompt")) editor.putString("notificationPrompt", config.getString("notificationPrompt"));
                        if (config.has("proactivePrompt")) editor.putString("proactivePrompt", config.optString("proactivePrompt", ""));

                        if (config.has("isSleeping")) editor.putBoolean("isSleeping", config.getBoolean("isSleeping"));
                        if (config.has("lastDrinkTime")) editor.putLong("lastDrinkTime", config.getLong("lastDrinkTime"));
                        if (config.has("lastMealTime")) editor.putLong("lastMealTime", config.getLong("lastMealTime"));
                        if (config.has("energy")) editor.putFloat("energy", (float) config.getDouble("energy"));
                        if (config.has("exercisedToday")) editor.putBoolean("exercisedToday", config.getBoolean("exercisedToday"));
                        if (config.has("hapticsEnabled")) editor.putBoolean("hapticsEnabled", config.getBoolean("hapticsEnabled"));
                        if (config.has("healthContextSummary")) editor.putString("healthContextSummary", config.optString("healthContextSummary", ""));

                        editor.apply();
                        Log.d(TAG, "Config synced to SharedPreferences");
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to sync config", e);
                    }
                }
            }, "NativeNotify");
        }
    }

    private void setupHeartbeatReceiver() {
        heartbeatReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if ("terminal.negentropy.life.HEARTBEAT".equals(intent.getAction())) {
                    triggerJsHeartbeat();
                }
            }
        };
        IntentFilter filter = new IntentFilter("terminal.negentropy.life.HEARTBEAT");
        ContextCompat.registerReceiver(this, heartbeatReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    public void onStop() {
        super.onStop();
        updateForegroundFlag(false);
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        updateForegroundFlag(false);
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().resumeTimers();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        updateForegroundFlag(true);
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().resumeTimers();
        }
    }

    /**
     * 标记 App 是否在前台，供 KeepAliveService 判断是否需要执行原生后台检测。
     * 前台时 JS 端的 setInterval 已经负责所有 AI 检测，原生层应静默以
     * 避免重复调用 AI 导致消息轰炸。
     */
    private void updateForegroundFlag(boolean inForeground) {
        try {
            getSharedPreferences(KeepAliveService.PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .putBoolean(KeepAliveService.KEY_APP_IN_FOREGROUND, inForeground)
                    .apply();
        } catch (Exception e) {
            Log.e(TAG, "Failed to update foreground flag", e);
        }
    }

    private void checkAndRequestPermissions() {
        boolean notificationGranted = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }

        // 通知权限
        if (!notificationGranted && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST_CODE);
        }

        // Android 14+ 精确闹钟权限（对保活至关重要）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am != null && !am.canScheduleExactAlarms()) {
                BackgroundAlarmScheduler.requestExactAlarmPermission(this);
            }
        }

        // 无论通知权限是否已授权，都启动保活服务
        startKeepAliveService();
    }

    private void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            String packageName = getPackageName();
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                try {
                    Intent intent = new Intent();
                    intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + packageName));
                    startActivity(intent);
                } catch (Exception e) {
                    Log.e(TAG, "Request battery optimization failed", e);
                }
            }
        }
    }

    public void triggerJsHeartbeat() {
        this.runOnUiThread(() -> {
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().resumeTimers();
                bridge.getWebView().evaluateJavascript(
                    "window.sendNativeNotification = function(t, b) { if(window.NativeNotify) NativeNotify.postNotification(t, b); }; " +
                    "if(window.onNativeHeartbeat) { window.onNativeHeartbeat(); }", 
                    null
                );
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startKeepAliveService();
        }
    }

    private void startKeepAliveService() {
        Intent serviceIntent = new Intent(this, KeepAliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (heartbeatReceiver != null) unregisterReceiver(heartbeatReceiver);
    }
}
