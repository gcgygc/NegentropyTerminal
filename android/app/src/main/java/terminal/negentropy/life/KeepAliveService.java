package terminal.negentropy.life;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.atomic.AtomicInteger;

public class KeepAliveService extends Service {

    private static final String TAG = "NegentropyKeepAlive";
    private static final int NOTIFICATION_ID = 1001;
    private static final String CHANNEL_ID = "KeepAliveChannel";
    public static final String HIGH_IMPORTANCE_CHANNEL_ID = "high_importance_channel";
    public static final String PREFS_NAME = "negentropy_bg_config";
    public static final String KEY_APP_IN_FOREGROUND = "appInForeground";
    public static final String BACKGROUND_DIAGNOSTICS_LOG_KEY = "background_diagnostics_log";
    private static final int MAX_BACKGROUND_DIAGNOSTICS_LOGS = 80;
    private static final int BACKGROUND_AI_MAX_RETRIES = 3;
    private static final long[] BACKGROUND_AI_RETRY_DELAYS_MS = new long[]{0L, 800L, 1800L};
    private static final long PROACTIVE_WINDOW_MS = 6L * 60L * 60L * 1000L;
    public static final String KEY_PROACTIVE_WINDOW_START = "proactiveWindowStart";
    public static final String KEY_PROACTIVE_LAST_CHECK_AT = "proactiveLastCheckAt";
    public static final String KEY_PROACTIVE_LAST_DELIVERED_AT = "proactiveLastDeliveredAt";
    public static final String KEY_PROACTIVE_LAST_ROLL = "proactiveLastRoll";
    public static final String KEY_PROACTIVE_LAST_REASON = "proactiveLastReason";
    public static final String KEY_PENDING_NOTIFICATIONS = "pending_notifications";
    private static final int MAX_PENDING_NOTIFICATIONS = 50;

    private WifiManager.WifiLock wifiLock;
    private PowerManager.WakeLock wakeLock;
    private BroadcastReceiver notificationRequestReceiver;
    private boolean checkInProgress = false;
    private static volatile boolean serviceRunning = false;

    // ============================================================
    //  方案 4：静音音频播放伪装成音乐播放器
    //  AudioTrack 持续写入静音 PCM 数据 + MediaSession，
    //  让系统误以为这是音乐 App，杀后台容忍度最高。
    //  ============================================================
    private AudioTrack silentAudioTrack;
    private MediaSession mediaSession;
    private Thread silentPlaybackThread;
    private volatile boolean playbackActive = false;

    // 用递增 ID 防止通知覆盖
    private final AtomicInteger notificationIdCounter = new AtomicInteger(2002);

    // 后台状态追踪
    private long lastSleepNagTime = 0;
    private long lastWaterReminderTime = 0;
    private long lastExerciseReminderTime = 0;
    private long lastMealReminderTime = 0;
    private long nextSleepNagInterval = (long) ((Math.random() * 5 + 3) * 60 * 1000); // 3-8 min

    private static final class BackgroundNotificationResult {
        String text;
        boolean usedFallback;
        int attemptCount;
        String lastError;
        String markerEmotion;
        String rawEmotion;
        String cueType;
        boolean markerDetected;
        String provider;
        String modelId;
        String baseUrlSummary;
    }

    public static boolean isRunning() {
        return serviceRunning;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        serviceRunning = true;
        Log.d(TAG, "KeepAliveService onCreate");
        createNotificationChannels();
        setupNotificationRequestReceiver();

        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Negentropy::EternalWakeLock");
            if (wakeLock != null) {
                wakeLock.acquire();
                Log.d(TAG, "Permanent WakeLock acquired");
            }
        }
        WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifiManager != null) {
            wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Negentropy::EternalWifiLock");
            if (wifiLock != null) {
                wifiLock.acquire();
                Log.d(TAG, "Permanent WifiLock acquired");
            }
        }

        // —— 方案 4：启动静音音频播放（伪装音乐播放器） ——
        startSilentPlayback();
    }

    private void setupNotificationRequestReceiver() {
        notificationRequestReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                Log.d(TAG, "Received broadcast: " + intent.getAction());
                if ("terminal.negentropy.life.SHOW_NOTIFICATION".equals(intent.getAction())) {
                    String title = intent.getStringExtra("title");
                    String body = intent.getStringExtra("body");
                    Log.d(TAG, "Broadcast extras - title: " + title + ", body: " + body);
                    showAiNotification(title, body);
                }
            }
        };
        IntentFilter filter = new IntentFilter("terminal.negentropy.life.SHOW_NOTIFICATION");
        ContextCompat.registerReceiver(this, notificationRequestReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    public static String getStoredBackgroundDiagnosticsLog(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        return prefs.getString(BACKGROUND_DIAGNOSTICS_LOG_KEY, "[]");
    }

    public static void clearStoredBackgroundDiagnosticsLog(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putString(BACKGROUND_DIAGNOSTICS_LOG_KEY, "[]").apply();
    }

    /**
     * 将原生后台通知保存到 SharedPreferences 队列，
     * 供 JS 端在前台恢复时读取并写入通知收件箱。
     */
    private void saveNotificationToPendingQueue(String title, String body) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String raw = prefs.getString(KEY_PENDING_NOTIFICATIONS, "[]");
            JSONArray queue = new JSONArray(raw != null ? raw : "[]");

            JSONObject entry = new JSONObject();
            entry.put("id", System.currentTimeMillis() + "_" + Math.round(Math.random() * 100000));
            entry.put("timestamp", System.currentTimeMillis());
            entry.put("title", title != null ? title : "");
            entry.put("content", body != null ? body : "");

            // 最新的在前
            JSONArray next = new JSONArray();
            next.put(entry);
            for (int i = 0; i < queue.length() && i < MAX_PENDING_NOTIFICATIONS - 1; i++) {
                next.put(queue.getJSONObject(i));
            }

            prefs.edit().putString(KEY_PENDING_NOTIFICATIONS, next.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "Failed to save pending notification", e);
        }
    }

    /**
     * 读取并清空待处理通知队列，返回 JSON 数组字符串。
     * 由 MainActivity 的 JS 桥接调用。
     */
    public static String drainPendingNotifications(Context context) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String raw = prefs.getString(KEY_PENDING_NOTIFICATIONS, "[]");
            prefs.edit().putString(KEY_PENDING_NOTIFICATIONS, "[]").apply();
            return raw != null ? raw : "[]";
        } catch (Exception e) {
            Log.e(TAG, "Failed to drain pending notifications", e);
            return "[]";
        }
    }

    private void appendBackgroundDiagnosticsLog(
            String source,
            String status,
            String message,
            String emotion,
            Boolean markerDetected,
            Integer attempt,
            String details
    ) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String rawLogs = prefs.getString(BACKGROUND_DIAGNOSTICS_LOG_KEY, "[]");
            JSONArray existingLogs = new JSONArray(rawLogs != null ? rawLogs : "[]");
            JSONArray nextLogs = new JSONArray();

            JSONObject entry = new JSONObject();
            entry.put("id", System.currentTimeMillis() + "_" + Math.round(Math.random() * 100000));
            entry.put("timestamp", System.currentTimeMillis());
            entry.put("domain", "bg_notification");
            entry.put("source", source);
            entry.put("status", status);
            entry.put("message", message);
            entry.put("emotion", emotion != null ? emotion : JSONObject.NULL);
            entry.put("backend", JSONObject.NULL);
            entry.put("markerDetected", markerDetected != null ? markerDetected : JSONObject.NULL);
            entry.put("attempt", attempt != null ? attempt : JSONObject.NULL);
            entry.put("details", details != null ? details : JSONObject.NULL);
            nextLogs.put(entry);

            for (int i = 0; i < existingLogs.length() && i < MAX_BACKGROUND_DIAGNOSTICS_LOGS - 1; i++) {
                nextLogs.put(existingLogs.getJSONObject(i));
            }

            prefs.edit().putString(BACKGROUND_DIAGNOSTICS_LOG_KEY, nextLogs.toString()).apply();
        } catch (Exception error) {
            Log.e(TAG, "Failed to append background diagnostics log", error);
        }
    }

    private static String summarizeBaseUrl(String baseUrl) {
        if (baseUrl == null || baseUrl.isEmpty()) return "(default)";
        return baseUrl.replaceAll("/+$", "");
    }

    private String getDayPeriodLabel(int hourOfDay) {
        if (hourOfDay < 5) return "深夜";
        if (hourOfDay < 8) return "清晨";
        if (hourOfDay < 12) return "上午";
        if (hourOfDay < 14) return "中午";
        if (hourOfDay < 18) return "下午";
        if (hourOfDay < 23) return "夜晚";
        return "深夜";
    }

    private String buildLocalTimeContext() {
        Calendar calendar = Calendar.getInstance();
        Date now = calendar.getTime();
        String dateLabel = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(now);
        String weekdayLabel = new SimpleDateFormat("EEEE", Locale.CHINA).format(now);
        String timeLabel = new SimpleDateFormat("HH:mm", Locale.CHINA).format(now);
        String timezoneLabel = TimeZone.getDefault().getID();

        return "[LOCAL_TIME_CONTEXT]\n"
                + "[本地日期]: " + dateLabel + "\n"
                + "[当前星期]: " + weekdayLabel + "\n"
                + "[当前时间]: " + timeLabel + "\n"
                + "[本地时区]: " + timezoneLabel + "\n"
                + "[时间语义]: " + getDayPeriodLabel(calendar.get(Calendar.HOUR_OF_DAY)) + "\n";
    }

    private static String buildBackgroundLogDetails(BackgroundNotificationResult result) {
        return "provider=" + result.provider
                + " / model=" + result.modelId
                + " / base=" + result.baseUrlSummary
                + (result.cueType != null && !result.cueType.isEmpty() ? " / cueType=" + result.cueType : "")
                + (result.rawEmotion != null && !result.rawEmotion.isEmpty() ? " / rawEmotion=" + result.rawEmotion : "")
                + (result.lastError != null && !result.lastError.isEmpty() ? " / error=" + result.lastError : "");
    }

    private long resolveCurrentProactiveWindowStart(long now) {
        return now - (now % PROACTIVE_WINDOW_MS);
    }

    private void updateProactiveState(
            SharedPreferences prefs,
            long windowStart,
            long checkedAt,
            Double roll,
            String reason,
            Long deliveredAt
    ) {
        SharedPreferences.Editor editor = prefs.edit()
                .putLong(KEY_PROACTIVE_WINDOW_START, windowStart)
                .putLong(KEY_PROACTIVE_LAST_CHECK_AT, checkedAt)
                .putString(KEY_PROACTIVE_LAST_REASON, reason != null ? reason : "");

        if (roll != null) {
            editor.putLong(KEY_PROACTIVE_LAST_ROLL, Double.doubleToRawLongBits(roll));
        }
        if (deliveredAt != null) {
            editor.putLong(KEY_PROACTIVE_LAST_DELIVERED_AT, deliveredAt);
        }
        editor.apply();
    }

    private boolean shouldEvaluateProactiveWindow(SharedPreferences prefs, long now) {
        long currentWindowStart = resolveCurrentProactiveWindowStart(now);
        long storedWindowStart = prefs.getLong(KEY_PROACTIVE_WINDOW_START, -1L);
        return storedWindowStart != currentWindowStart;
    }

    private boolean containsHapticDirective(String text) {
        return text != null && (text.contains("[HAPTIC:") || text.contains("[HAPTIC_PATTERN]"));
    }

    private void showAiNotification(String title, String body) {
        showAiNotification(title, body, null, null);
    }

    private void showAiNotification(String title, String body, String source, BackgroundNotificationResult result) {
        Log.d(TAG, "showAiNotification called: " + title + " - " + body);
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            Log.e(TAG, "NotificationManager is null");
            return;
        }

        EmotionHaptics.ParsedHapticText parsedText = EmotionHaptics.extractFromText(body);
        String cleanBody = parsedText.cleanText;
        if (cleanBody.isEmpty()) return;
        boolean markerDetected = parsedText.markerDetected || containsHapticDirective(body);
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        boolean hapticsEnabled = prefs.getBoolean("hapticsEnabled", false);
        boolean isSleeping = prefs.getBoolean("isSleeping", false);
        boolean sleepQuietMode = isSleeping;

        if (!sleepQuietMode && hapticsEnabled && parsedText.markerDetected) {
            EmotionHaptics.playParsedCue(this, parsedText);
        }

        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        Notification notification = new NotificationCompat.Builder(this, HIGH_IMPORTANCE_CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(cleanBody)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(cleanBody))
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setFullScreenIntent(pendingIntent, true)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build();

        try {
            int id = notificationIdCounter.getAndIncrement();
            manager.notify(id, notification);
            Log.d(TAG, "Notification sent successfully with ID: " + id);
            // 保存到待处理队列，供 JS 端前台恢复时写入收件箱
            saveNotificationToPendingQueue(title, cleanBody);
            if (source != null && result != null) {
                String deliveryStatus = result.usedFallback
                        ? "fallback"
                        : parsedText.markerDetected ? "success" : "skipped";
                String deliveryMessage = result.usedFallback
                        ? "Fallback notification delivered."
                        : parsedText.markerDetected
                            ? sleepQuietMode
                                ? "AI notification delivered in sleep quiet mode."
                                : hapticsEnabled
                                ? "AI notification delivered with haptic directive."
                                : "AI notification delivered, but haptics were muted by user."
                            : "AI notification delivered without haptic marker.";
                appendBackgroundDiagnosticsLog(
                        source,
                        deliveryStatus,
                        deliveryMessage,
                        parsedText.emotion,
                        markerDetected,
                        result.attemptCount,
                        buildBackgroundLogDetails(result)
                );
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to send notification", e);
            if (source != null && result != null) {
                appendBackgroundDiagnosticsLog(
                        source,
                        "error",
                        "Notification delivery failed.",
                        parsedText.emotion,
                        markerDetected,
                        result.attemptCount,
                        buildBackgroundLogDetails(result) + " / notifyError=" + e.getMessage()
                );
            }
        }
    }

    // ============================================================
    //  核心：闹钟驱动的后台检测
    //  不再依赖 Thread.sleep 循环，而是每次由 AlarmReceiver 触发
    //  服务完成一轮检查后，调度下一次闹钟，然后等待。
    //  即使进程被 OEM 杀掉，60 秒后 AlarmManager 会重新拉起服务。
    // ============================================================

    /**
     * 执行一次完整的后台检测，然后调度下一次闹钟。
     * 此方法可在后台线程中调用。
     */
    private void performScheduledCheckAndReschedule() {
        if (checkInProgress) {
            Log.d(TAG, "Background check already in progress, skipping");
            return;
        }
        checkInProgress = true;

        try {
            Log.d(TAG, "--- SCHEDULED BACKGROUND CHECK ---");

            // 检查 App 是否在前台。前台时 JS 端的 setInterval 已经负责所有
            // AI 检测（autoCheck），原生层应静默以避免重复调用 AI 导致消息轰炸。
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            boolean appInForeground = prefs.getBoolean(KEY_APP_IN_FOREGROUND, false);

            if (appInForeground) {
                Log.d(TAG, "App is in foreground — skipping native AI check (JS handles it)");
                updateNotification("终端状态：前台交互中... [后台检测已暂停]");
            } else {
                // 1. 尝试唤醒前台 WebView（Activity 如果还活着的话）
                Intent jsIntent = new Intent("terminal.negentropy.life.HEARTBEAT");
                jsIntent.setPackage(getPackageName());
                sendBroadcast(jsIntent);

                // 2. 执行原生后台检测（检查睡眠/喝水/运动/进食/主动关怀）
                performNativeBackgroundCheck();

                // 3. 更新前台通知
                long nextAlarmIn = BackgroundAlarmScheduler.ALARM_INTERVAL_MS / 1000;
                updateNotification("终端状态：深度监视中... [下次检查: " + nextAlarmIn + "s后]");
            }

        } catch (Exception e) {
            Log.e(TAG, "Scheduled background check error", e);
        } finally {
            checkInProgress = false;
        }

        // 4. 调度下一次闹钟（无论前台还是后台，都必须维持闹钟链，
        //    这样用户切到后台后原生检测能立即恢复。）
        BackgroundAlarmScheduler.scheduleNextCheck(this);
    }

    /**
     * 在 Native 层执行后台检测逻辑，不依赖 WebView
     */
    private void performNativeBackgroundCheck() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);

        String targetSleepTime = prefs.getString("targetSleepTime", "23:00");
        String wakeUpTime = prefs.getString("wakeUpTime", "07:00");
        boolean isSleeping = prefs.getBoolean("isSleeping", false);
        String personaName = prefs.getString("personaName", "Aegis");
        String voiceTone = prefs.getString("voiceTone", "温柔、坚定");
        String apiKey = prefs.getString("apiKey", "");
        String provider = prefs.getString("provider", "gemini");
        String modelId = prefs.getString("modelId", "gemini-3-flash-preview");
        String baseUrl = prefs.getString("baseUrl", "");
        String notificationPrompt = prefs.getString("notificationPrompt", "");
        String proactivePrompt = prefs.getString("proactivePrompt", "");
        String healthContextSummary = prefs.getString("healthContextSummary", "");
        long lastDrinkTime = prefs.getLong("lastDrinkTime", System.currentTimeMillis());
        long lastMealTime = prefs.getLong("lastMealTime", 0L);
        float energy = prefs.getFloat("energy", 90f);

        // 通知专用配置（可覆盖主配置）
        String notifProvider = prefs.getString("notificationProvider", "");
        String notifApiKey = prefs.getString("notificationApiKey", "");
        String notifModelId = prefs.getString("notificationModelId", "");
        String notifBaseUrl = prefs.getString("notificationBaseUrl", "");

        boolean useNotificationOverride = notifProvider != null && !notifProvider.trim().isEmpty();

        String effectiveProvider = useNotificationOverride ? notifProvider : provider;
        String effectiveApiKey = useNotificationOverride
                ? (!notifApiKey.isEmpty() ? notifApiKey : apiKey)
                : apiKey;
        String effectiveModelId = useNotificationOverride
                ? (!notifModelId.isEmpty() ? notifModelId : modelId)
                : modelId;
        String effectiveBaseUrl = useNotificationOverride
                ? ("gemini".equals(notifProvider) ? "" : (!notifBaseUrl.isEmpty() ? notifBaseUrl : baseUrl))
                : baseUrl;

        if (effectiveApiKey.isEmpty()) {
            Log.w(TAG, "No API key configured, skipping background check");
            return;
        }

        long now = System.currentTimeMillis();
        int currentMins = getCurrentMinutes();
        String shortName = personaName.contains(" ") ? personaName.split(" ")[0] : personaName;

        Log.d(TAG, "[BG_CHECK] time=" + currentMins + "min, sleeping=" + isSleeping +
                ", sleepTarget=" + targetSleepTime + ", energy=" + energy);

        // ---- 1. 睡眠催促逻辑 ----
        int[] sleepCheck = checkSleepStatus(currentMins, targetSleepTime, wakeUpTime);
        boolean isSleepTime = sleepCheck[0] == 1;
        int overtimeMins = sleepCheck[1];

        if (isSleepTime && !isSleeping && (now - lastSleepNagTime > nextSleepNagInterval)) {
            lastSleepNagTime = now;
            nextSleepNagInterval = (long) ((Math.random() * 5 + 3) * 60 * 1000); // 3-8 min (活人感随机)
            String overtimeStr = (overtimeMins / 60) + "小时" + (overtimeMins % 60) + "分";

            Log.d(TAG, "[BG_CHECK] Triggering sleep reminder, overtime=" + overtimeStr);

            String context = "很晚了，用户超时 " + overtimeStr + " 没睡。生成一句简短催睡警告。";
            BackgroundNotificationResult result = generateBackgroundNotificationWithRetry(
                    "sleep",
                    effectiveProvider,
                    effectiveApiKey,
                    effectiveModelId,
                    effectiveBaseUrl,
                    personaName,
                    voiceTone,
                    context,
                    notificationPrompt,
                    healthContextSummary
            );

            if (result.text != null && !result.text.isEmpty()) {
                showAiNotification("[" + shortName + "] 强制指令", result.text, "sleep", result);
            }
        }

        // ---- 2. 喝水提醒（科学饮水模式） ----
        // 规则：
        //   - 睡眠中/睡前2小时不提醒
        //   - 饭后 60-90 分钟内不提醒（食物含水分，吃饭本身也是补水）
        //   - 晨起窗口（起床后 30-60 分钟）优先提醒第一次水
        //   - 日间：距上次喝水 90-120 分钟提醒（有随机性）
        //   - 距上次提醒至少 90 分钟，避免轰炸
        boolean inPreSleepWindow = isInPreSleepWindow(currentMins, targetSleepTime);

        if (!isSleeping && !isSleepTime && !inPreSleepWindow) {
            long minsSinceLastDrink = (now - lastDrinkTime) / 60000;
            long minsSinceLastReminder = (now - lastWaterReminderTime) / 60000;
            long minsSinceLastMeal = lastMealTime > 0 ? (now - lastMealTime) / 60000 : Long.MAX_VALUE;

            // 饭后 60-90 分钟内食物含水分，推迟补水提醒
            long postMealDelayMin = 60 + (long) (Math.random() * 30);
            boolean inPostMealWindow = minsSinceLastMeal < postMealDelayMin;

            // 晨起窗口：起床后 30-60 分钟
            boolean inMorningWindow = isInMorningHydrationWindow(currentMins, wakeUpTime);
            boolean drinkBeforeWakeUp = lastDrinkTime < getWakeUpTimeMillis(wakeUpTime);

            long requiredDrinkGap;
            String context;

            if (inPostMealWindow) {
                // 饭后不久，跳过本次检查（日志记录但不发通知）
                if (minsSinceLastReminder > 90) {
                    Log.d(TAG, "[BG_CHECK] Water skipped: post-meal window ("
                            + minsSinceLastMeal + "min since last meal, need " + postMealDelayMin + "min)");
                }
                requiredDrinkGap = Long.MAX_VALUE; // 跳过
                context = null;
            } else if (inMorningWindow && drinkBeforeWakeUp) {
                // 早上第一杯水：起床后 30-45 分钟
                requiredDrinkGap = 30 + (long) (Math.random() * 15);
                context = "晨起补水窗口。用户刚起床不久，需要第一杯水唤醒身体。语气温柔鼓励。";
            } else {
                // 日间正常节奏：距上次喝水 90-120 分钟
                requiredDrinkGap = 90 + (long) (Math.random() * 30);
                context = "根据生物节律，现在是最佳补水时间。生成一句简短的提醒，可以略带命令语气或关心。";
            }

            if (minsSinceLastDrink > requiredDrinkGap && minsSinceLastReminder > 90) {
                lastWaterReminderTime = now;
                Log.d(TAG, "[BG_CHECK] Triggering water reminder (drinkGap="
                        + minsSinceLastDrink + "min, requiredGap=" + requiredDrinkGap
                        + "min, postMeal=" + minsSinceLastMeal + "min)");

                BackgroundNotificationResult result = generateBackgroundNotificationWithRetry(
                        "water",
                        effectiveProvider,
                        effectiveApiKey,
                        effectiveModelId,
                        effectiveBaseUrl,
                        personaName,
                        voiceTone,
                        context,
                        notificationPrompt,
                        healthContextSummary
                );

                if (result.text != null && !result.text.isEmpty()) {
                    showAiNotification("[" + shortName + "] 生理警报", result.text, "water", result);
                }
            }
        }

        // ---- 3. 运动提醒 (睡前 2-4 小时) ----
        if (!isSleeping) {
            int sleepMins = parseTimeToMins(targetSleepTime);
            int minsToSleep = (sleepMins - currentMins + 1440) % 1440;
            boolean exercisedToday = prefs.getBoolean("exercisedToday", false);
            long todayStart = getTodayStartMillis();

            if (minsToSleep <= 240 && minsToSleep >= 120 && !exercisedToday && lastExerciseReminderTime < todayStart) {
                lastExerciseReminderTime = now;
                Log.d(TAG, "[BG_CHECK] Triggering exercise reminder");

                String context = "检测到用户今天还没有运动，距离睡觉没几个小时了。生成一句简短的提醒，督促其运动。";
                BackgroundNotificationResult result = generateBackgroundNotificationWithRetry(
                        "exercise",
                        effectiveProvider,
                        effectiveApiKey,
                        effectiveModelId,
                        effectiveBaseUrl,
                        personaName,
                        voiceTone,
                        context,
                        notificationPrompt,
                        healthContextSummary
                );

                if (result.text != null && !result.text.isEmpty()) {
                    showAiNotification("[" + shortName + "] 运动指令", result.text, "exercise", result);
                }
            }
        }

        // ---- 4. 进食/能量提醒（能量过低时触发，固定120分钟间隔） ----
        if (!isSleeping && energy <= 30 && (now - lastMealReminderTime > 120 * 60 * 1000)) {

            String context = "检测到用户能量值过低。生成一句简短的提醒，督促其进食补充能量。";
            BackgroundNotificationResult result = generateBackgroundNotificationWithRetry(
                    "meal",
                    effectiveProvider,
                    effectiveApiKey,
                    effectiveModelId,
                    effectiveBaseUrl,
                    personaName,
                    voiceTone,
                    context,
                    notificationPrompt,
                    healthContextSummary
            );

            if (result.text != null && !result.text.isEmpty()) {
                showAiNotification("[" + shortName + "] 能量警报", result.text, "meal", result);
            }
        }

        // ---- 5. 主动关怀逻辑（每 6 小时一个窗口，10% 概率）----
        if (shouldEvaluateProactiveWindow(prefs, now)) {
            long currentWindowStart = resolveCurrentProactiveWindowStart(now);
            double roll = Math.random();
            updateProactiveState(
                    prefs,
                    currentWindowStart,
                    now,
                    roll,
                    "probability_pending",
                    null
            );

            if (roll < 0.10d) {
                Log.d(TAG, "[BG_CHECK] Triggering proactive background message");
                BackgroundNotificationResult result = generateBackgroundProactiveMessageWithRetry(
                        effectiveProvider,
                        effectiveApiKey,
                        effectiveModelId,
                        effectiveBaseUrl,
                        personaName,
                        voiceTone,
                        proactivePrompt,
                        healthContextSummary,
                        isSleeping
                );

                if (result.text != null && !result.text.isEmpty() && !"NO_ACTION".equalsIgnoreCase(result.text.trim())) {
                    updateProactiveState(
                            prefs,
                            currentWindowStart,
                            now,
                            roll,
                            "delivered",
                            now
                    );
                    showAiNotification("[" + shortName + "] 接入请求", result.text, "proactive", result);
                } else {
                    updateProactiveState(
                            prefs,
                            currentWindowStart,
                            now,
                            roll,
                            "no_action",
                            null
                    );
                }
            } else {
                updateProactiveState(
                        prefs,
                        currentWindowStart,
                        now,
                        roll,
                        "probability_miss",
                        null
                );
                appendBackgroundDiagnosticsLog(
                        "proactive",
                        "skipped",
                        "Proactive 6-hour window missed the 10% probability roll.",
                        null,
                        false,
                        null,
                        "roll=" + String.format(Locale.US, "%.4f", roll)
                );
            }
        }
    }

    // ============================================================
    //  辅助方法：时间判断
    // ============================================================

    private int getCurrentMinutes() {
        Calendar cal = Calendar.getInstance();
        return cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE);
    }

    private int parseTimeToMins(String time) {
        try {
            String[] parts = time.split(":");
            return Integer.parseInt(parts[0]) * 60 + Integer.parseInt(parts[1]);
        } catch (Exception e) {
            return 23 * 60; // fallback to 23:00
        }
    }

    /**
     * @return int[2]: [0]=isSleepTime (0 or 1), [1]=overtimeMins
     */
    private int[] checkSleepStatus(int currentMins, String targetSleepTime, String wakeUpTime) {
        int startMins = parseTimeToMins(targetSleepTime);
        int endMins = parseTimeToMins(wakeUpTime);

        boolean inRange;
        if (startMins < endMins) {
            inRange = currentMins >= startMins && currentMins < endMins;
        } else {
            inRange = currentMins >= startMins || currentMins < endMins;
        }

        if (!inRange) return new int[]{0, 0};

        int overtime;
        if (currentMins >= startMins) {
            overtime = currentMins - startMins;
        } else {
            overtime = (24 * 60 - startMins) + currentMins;
        }

        return new int[]{1, overtime};
    }

    private long getTodayStartMillis() {
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, 0);
        cal.set(Calendar.MINUTE, 0);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        return cal.getTimeInMillis();
    }

    /**
     * 当前时间是否在睡前 2 小时窗口内（应该停止喝水提醒）
     */
    private boolean isInPreSleepWindow(int currentMins, String targetSleepTime) {
        int sleepMins = parseTimeToMins(targetSleepTime);
        // 睡前 2 小时 = sleepMins - 120，需要处理跨天（如 23:00 睡觉，21:00 开始窗口）
        int preSleepStart = (sleepMins - 120 + 1440) % 1440;
        int sleepEnd = sleepMins;

        if (preSleepStart < sleepEnd) {
            return currentMins >= preSleepStart && currentMins < sleepEnd;
        } else {
            // 跨天情况（如 01:00 睡觉，23:00 开始窗口跨越午夜）
            return currentMins >= preSleepStart || currentMins < sleepEnd;
        }
    }

    /**
     * 当前时间是否在晨起补水窗口内（起床后 30-60 分钟）
     */
    private boolean isInMorningHydrationWindow(int currentMins, String wakeUpTime) {
        int wakeMins = parseTimeToMins(wakeUpTime);
        int windowStart = (wakeMins + 30) % 1440;  // 起床后 30 分钟
        int windowEnd = (wakeMins + 60) % 1440;    // 起床后 60 分钟

        if (windowStart < windowEnd) {
            return currentMins >= windowStart && currentMins < windowEnd;
        } else {
            return currentMins >= windowStart || currentMins < windowEnd;
        }
    }

    /**
     * 获取今天的起床时间戳（毫秒），用于判断上次喝水是否在起床前
     */
    private long getWakeUpTimeMillis(String wakeUpTime) {
        int wakeMins = parseTimeToMins(wakeUpTime);
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, wakeMins / 60);
        cal.set(Calendar.MINUTE, wakeMins % 60);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        return cal.getTimeInMillis();
    }

    // ============================================================
    //  核心：直接调用 Gemini/OpenAI API
    // ============================================================

    private BackgroundNotificationResult generateBackgroundNotificationWithRetry(
            String source,
            String provider,
            String apiKey,
            String modelId,
            String baseUrl,
            String personaName,
            String voiceTone,
            String context,
            String notificationPrompt,
            String healthContextSummary
    ) {
        BackgroundNotificationResult result = new BackgroundNotificationResult();
        result.provider = provider;
        result.modelId = modelId;
        result.baseUrlSummary = summarizeBaseUrl(baseUrl);

        String lastError = null;

        for (int attempt = 1; attempt <= BACKGROUND_AI_MAX_RETRIES; attempt++) {
            try {
                if (attempt > 1) {
                    Thread.sleep(BACKGROUND_AI_RETRY_DELAYS_MS[Math.min(attempt - 1, BACKGROUND_AI_RETRY_DELAYS_MS.length - 1)]);
                }

                String text = callAiNotificationOnce(provider, apiKey, modelId, baseUrl, personaName, voiceTone, context, notificationPrompt, healthContextSummary);
                if (text != null && !text.trim().isEmpty()) {
                    EmotionHaptics.ParsedHapticText parsed = EmotionHaptics.extractFromText(text);
                    result.text = text.trim();
                    result.usedFallback = false;
                    result.attemptCount = attempt;
                    result.lastError = null;
                    result.markerEmotion = parsed.emotion;
                    result.rawEmotion = parsed.rawEmotion;
                    result.cueType = parsed.cueType;
                    result.markerDetected = parsed.markerDetected || containsHapticDirective(text);

                    appendBackgroundDiagnosticsLog(
                            source,
                            parsed.markerDetected ? "success" : "skipped",
                            "Background AI notification generated.",
                            parsed.emotion,
                            result.markerDetected,
                            attempt,
                            buildBackgroundLogDetails(result)
                    );
                    return result;
                }

                lastError = "Empty AI response";
                appendBackgroundDiagnosticsLog(
                        source,
                        "error",
                        "Background AI returned an empty response.",
                        null,
                        false,
                        attempt,
                        "provider=" + provider + " / model=" + modelId + " / base=" + summarizeBaseUrl(baseUrl)
                );
            } catch (Exception error) {
                lastError = error.getMessage() != null ? error.getMessage() : "Unknown background AI error";
                appendBackgroundDiagnosticsLog(
                        source,
                        "error",
                        "Background AI attempt failed.",
                        null,
                        false,
                        attempt,
                        "provider=" + provider + " / model=" + modelId + " / base=" + summarizeBaseUrl(baseUrl) + " / error=" + lastError
                );
                Log.e(TAG, "Background AI attempt " + attempt + " failed", error);
            }
        }

        String fallbackText = getLocalFallbackMessage(source, personaName);
        EmotionHaptics.ParsedHapticText fallbackParsed = EmotionHaptics.extractFromText(fallbackText);

        result.text = fallbackText;
        result.usedFallback = true;
        result.attemptCount = BACKGROUND_AI_MAX_RETRIES;
        result.lastError = lastError;
        result.markerEmotion = fallbackParsed.emotion;
        result.rawEmotion = fallbackParsed.rawEmotion;
        result.cueType = fallbackParsed.cueType;
        result.markerDetected = fallbackParsed.markerDetected || containsHapticDirective(fallbackText);

        appendBackgroundDiagnosticsLog(
                source,
                "fallback",
                "Background AI failed after 3 attempts. Using local fallback.",
                fallbackParsed.emotion,
                result.markerDetected,
                BACKGROUND_AI_MAX_RETRIES,
                buildBackgroundLogDetails(result)
        );

        return result;
    }

    private BackgroundNotificationResult generateBackgroundProactiveMessageWithRetry(
            String provider,
            String apiKey,
            String modelId,
            String baseUrl,
            String personaName,
            String voiceTone,
            String proactivePrompt,
            String healthContextSummary,
            boolean isSleeping
    ) {
        BackgroundNotificationResult result = new BackgroundNotificationResult();
        result.provider = provider;
        result.modelId = modelId;
        result.baseUrlSummary = summarizeBaseUrl(baseUrl);

        String lastError = null;

        for (int attempt = 1; attempt <= BACKGROUND_AI_MAX_RETRIES; attempt++) {
            try {
                if (attempt > 1) {
                    Thread.sleep(BACKGROUND_AI_RETRY_DELAYS_MS[Math.min(attempt - 1, BACKGROUND_AI_RETRY_DELAYS_MS.length - 1)]);
                }

                String text = callAiProactiveOnce(
                        provider,
                        apiKey,
                        modelId,
                        baseUrl,
                        personaName,
                        voiceTone,
                        proactivePrompt,
                        healthContextSummary,
                        isSleeping
                );
                if (text == null || text.trim().isEmpty()) {
                    lastError = "Empty proactive AI response";
                    continue;
                }

                result.text = text.trim();
                result.usedFallback = false;
                result.attemptCount = attempt;
                result.lastError = null;

                if (!"NO_ACTION".equalsIgnoreCase(result.text)) {
                    EmotionHaptics.ParsedHapticText parsed = EmotionHaptics.extractFromText(result.text);
                    result.markerEmotion = parsed.emotion;
                    result.rawEmotion = parsed.rawEmotion;
                    result.cueType = parsed.cueType;
                    result.markerDetected = parsed.markerDetected || containsHapticDirective(result.text);
                    appendBackgroundDiagnosticsLog(
                            "proactive",
                            parsed.markerDetected ? "success" : "skipped",
                            isSleeping
                                    ? "Sleep-aware proactive message generated."
                                    : "Background proactive message generated.",
                            parsed.emotion,
                            result.markerDetected,
                            attempt,
                            buildBackgroundLogDetails(result)
                    );
                } else {
                    appendBackgroundDiagnosticsLog(
                            "proactive",
                            "skipped",
                            "Proactive AI returned NO_ACTION for this 6-hour window.",
                            null,
                            false,
                            attempt,
                            "provider=" + provider + " / model=" + modelId + " / base=" + summarizeBaseUrl(baseUrl)
                    );
                }
                return result;
            } catch (Exception error) {
                lastError = error.getMessage() != null ? error.getMessage() : "Unknown proactive AI error";
                appendBackgroundDiagnosticsLog(
                        "proactive",
                        "error",
                        "Proactive AI attempt failed.",
                        null,
                        false,
                        attempt,
                        "provider=" + provider + " / model=" + modelId + " / base=" + summarizeBaseUrl(baseUrl) + " / error=" + lastError
                );
                Log.e(TAG, "Proactive AI attempt " + attempt + " failed", error);
            }
        }

        result.text = "NO_ACTION";
        result.usedFallback = false;
        result.attemptCount = BACKGROUND_AI_MAX_RETRIES;
        result.lastError = lastError;
        return result;
    }

    private String callAiNotificationOnce(String provider, String apiKey, String modelId,
                                          String baseUrl, String personaName, String voiceTone,
                                          String context, String notificationPrompt, String healthContextSummary) throws Exception {
        // 构建 prompt
        String userPrompt;
        if (notificationPrompt != null && !notificationPrompt.isEmpty()) {
            userPrompt = notificationPrompt
                    .replace("{context}", context)
                    .replace("{name}", personaName);
        } else {
            userPrompt = "场景：" + context + "\n请以你的人设（" + personaName + "）生成一句简短的提醒。可以略带命令语气或关心。" +
                    "\n要求：\n1. 每次的动作描写必须不同，要有随机性和新鲜感。" +
                    "\n2. 保持简短，像是一条突然弹出的系统短信。" +
                    "\n3. 必须且仅允许一个 haptic directive，优先使用 [HAPTIC:emotion]。" +
                    "\n4. 如果 canonical emotion 都不贴切，才允许改用一个 [HAPTIC_PATTERN]{json}[/HAPTIC_PATTERN]，json 至少包含 label、timings、amplitudes、repeat(-1)。" +
                    "\n5. 严禁输出任何工具调用、独立 JSON 或代码块；唯一允许的 JSON 仅限 HAPTIC_PATTERN block 内。" +
                    "\n6. 随机因子: " + (int)(Math.random() * 1000);
        }

        String systemPrompt = "[SYSTEM_INIT]: 启动通知生成协议。\n" +
                "[核心人设]: " + personaName + "\n" +
                "[语气]: " + voiceTone + "\n" +
                buildLocalTimeContext() +
                ((healthContextSummary != null && !healthContextSummary.isEmpty()) ? (healthContextSummary + "\n") : "") +
                "[规则]:\n" +
                "1. 你现在的任务是仅生成一条简短的通知文本。\n" +
                "2. **绝对禁止**尝试调用任何工具、函数或获取数据。你没有工具权限。\n" +
                "3. **绝对禁止**输出独立 JSON 或 Markdown 代码块；唯一允许的 JSON 仅限 HAPTIC_PATTERN block 内。\n" +
                "4. 你必须且仅允许一个 haptic directive，优先使用 [HAPTIC:emotion]。\n" +
                "5. canonical 可用情绪：warning, alert, panic, anger, comfort, gentle, calm, sadness, melancholy, heartbeat, affection, longing, excitement, nervousness, pride, determination, success, error, curiosity, teasing。\n" +
                "6. 如果 canonical emotion 都不贴切，才允许改用一个 [HAPTIC_PATTERN]{json}[/HAPTIC_PATTERN]，json 至少包含 label、timings、amplitudes、repeat(-1)。\n" +
                "7. 不允许同时输出两种 directive。直接输出最终要显示给用户的纯文本内容，不要解释标记。\n" +
                "8. 禁止无端在每条通知前附时间戳；但如果当前场景确实和今天、今晚、周末、星期几有关，可以自然使用这些时间语义。\n" +
                "9. 拒绝千篇一律，发挥创造力，使用赛博朋克或人设特定的隐喻。";

        if ("gemini".equals(provider)) {
            return callGeminiApi(apiKey, modelId, baseUrl, systemPrompt, userPrompt);
        }
        return callOpenAiCompatibleApi(apiKey, modelId, baseUrl, provider, systemPrompt, userPrompt);
    }

    private String callAiProactiveOnce(
            String provider,
            String apiKey,
            String modelId,
            String baseUrl,
            String personaName,
            String voiceTone,
            String proactivePrompt,
            String healthContextSummary,
            boolean isSleeping
    ) throws Exception {
        String userPrompt;
        if (isSleeping) {
            userPrompt = "[SYSTEM_OVERRIDE]: 用户目前处于睡眠状态。请生成一条简短的、偷偷发给用户的消息。可以是关心、想念，或者看着用户睡觉时的自言自语。语气必须符合你的人设。";
        } else if (proactivePrompt != null && !proactivePrompt.trim().isEmpty()) {
            userPrompt = proactivePrompt;
        } else {
            userPrompt = "[SYSTEM BACKGROUND TASK]: 主动分析用户状态并决定是否发送关怀消息。\n"
                    + "1. 结合当前时间与健康摘要，生成一条主动发给用户的消息。可以是关心、想念、吐槽或者日常问候。\n"
                    + "2. 保持简短，像是一条突然弹出的短信。\n"
                    + "3. 如果你觉得现在不适合打扰用户，请严格回复：NO_ACTION。\n"
                    + "4. 如果你决定发消息，则必须且仅允许一个 [HAPTIC:emotion] 标记，放在开头或结尾。";
        }

        String systemPrompt = "[SYSTEM_INIT]: 启动主动关怀协议。\n"
                + "[核心人设]: " + personaName + "\n"
                + "[语气]: " + voiceTone + "\n"
                + buildLocalTimeContext()
                + ((healthContextSummary != null && !healthContextSummary.isEmpty()) ? (healthContextSummary + "\n") : "")
                + "[规则]:\n"
                + "1. 仅输出纯文本消息或 NO_ACTION。\n"
                + "2. **绝对禁止**调用工具、函数或输出代码块。\n"
                + "3. 如果输出实际消息，则必须且仅允许一个 haptic directive，优先使用 [HAPTIC:emotion]。\n"
                + "4. canonical 可用情绪：warning, alert, panic, anger, comfort, gentle, calm, sadness, melancholy, heartbeat, affection, longing, excitement, nervousness, pride, determination, success, error, curiosity, teasing。\n"
                + "5. 如果 canonical emotion 都不贴切，才允许改用一个 [HAPTIC_PATTERN]{json}[/HAPTIC_PATTERN]。\n"
                + "6. 当前处于睡眠状态时，消息应更轻、更安静，像偷偷发来的关心，不要显得像闹钟。";

        String text;
        if ("gemini".equals(provider)) {
            text = callGeminiApi(apiKey, modelId, baseUrl, systemPrompt, userPrompt);
        } else {
            text = callOpenAiCompatibleApi(apiKey, modelId, baseUrl, provider, systemPrompt, userPrompt);
        }

        if (text == null) return null;
        return text.replaceAll("<.*?>", "").trim();
    }

    /**
     * 调用 Gemini REST API (不依赖 SDK)
     */
    private String callGeminiApi(String apiKey, String modelId, String baseUrl,
                                  String systemPrompt, String userPrompt) throws Exception {
        if (modelId == null || modelId.isEmpty()) modelId = "gemini-3-flash-preview";

        String urlStr;
        if (baseUrl != null && !baseUrl.isEmpty()) {
            // 自定义代理
            urlStr = baseUrl.replaceAll("/+$", "") + "/v1beta/models/" + modelId + ":generateContent?key=" + apiKey;
        } else {
            urlStr = "https://generativelanguage.googleapis.com/v1beta/models/" + modelId + ":generateContent?key=" + apiKey;
        }

        JSONObject requestBody = new JSONObject();

        // system_instruction
        JSONObject systemInstruction = new JSONObject();
        JSONArray systemParts = new JSONArray();
        JSONObject systemTextPart = new JSONObject();
        systemTextPart.put("text", systemPrompt);
        systemParts.put(systemTextPart);
        systemInstruction.put("parts", systemParts);
        requestBody.put("system_instruction", systemInstruction);

        // contents
        JSONArray contents = new JSONArray();
        JSONObject userContent = new JSONObject();
        userContent.put("role", "user");
        JSONArray userParts = new JSONArray();
        JSONObject userTextPart = new JSONObject();
        userTextPart.put("text", userPrompt);
        userParts.put(userTextPart);
        userContent.put("parts", userParts);
        contents.put(userContent);
        requestBody.put("contents", contents);

        Log.d(TAG, "[GEMINI_API] Calling: " + modelId);
        String responseStr = doHttpPost(urlStr, requestBody.toString(), null);

        // 解析响应
        JSONObject response = new JSONObject(responseStr);
        JSONArray candidates = response.optJSONArray("candidates");
        if (candidates != null && candidates.length() > 0) {
            JSONObject firstCandidate = candidates.getJSONObject(0);
            JSONObject content = firstCandidate.optJSONObject("content");
            if (content != null) {
                JSONArray parts = content.optJSONArray("parts");
                if (parts != null && parts.length() > 0) {
                    String text = parts.getJSONObject(0).optString("text", "");
                    // 清洗
                    text = text.replaceAll("<.*?>", "").replaceAll("\\*\\*", "").replaceAll("\\*", "").trim();
                    Log.d(TAG, "[GEMINI_API] Response: " + text);
                    return text;
                }
            }
        }

        // 检查错误
        JSONObject error = response.optJSONObject("error");
        if (error != null) {
            Log.e(TAG, "[GEMINI_API] Error: " + error.toString());
        }

        return null;
    }

    /**
     * 调用 OpenAI 兼容 API (OpenAI / DeepSeek / 自定义代理)
     */
    private String callOpenAiCompatibleApi(String apiKey, String modelId, String baseUrl,
                                            String provider, String systemPrompt, String userPrompt) throws Exception {
        String url;
        if (baseUrl != null && !baseUrl.isEmpty()) {
            url = baseUrl.replaceAll("/+$", "") + "/chat/completions";
        } else if ("deepseek".equals(provider)) {
            url = "https://api.deepseek.com/chat/completions";
        } else {
            url = "https://api.openai.com/v1/chat/completions";
        }

        JSONObject requestBody = new JSONObject();
        requestBody.put("model", modelId);
        requestBody.put("temperature", 0.7);

        JSONArray messages = new JSONArray();
        JSONObject systemMsg = new JSONObject();
        systemMsg.put("role", "system");
        systemMsg.put("content", systemPrompt);
        messages.put(systemMsg);

        JSONObject userMsg = new JSONObject();
        userMsg.put("role", "user");
        userMsg.put("content", userPrompt);
        messages.put(userMsg);

        requestBody.put("messages", messages);

        Log.d(TAG, "[OPENAI_API] Calling: " + modelId + " via " + url);
        String responseStr = doHttpPost(url, requestBody.toString(), "Bearer " + apiKey);

        JSONObject response = new JSONObject(responseStr);
        JSONArray choices = response.optJSONArray("choices");
        if (choices != null && choices.length() > 0) {
            JSONObject message = choices.getJSONObject(0).optJSONObject("message");
            if (message != null) {
                String text = message.optString("content", "");
                text = text.replaceAll("<.*?>", "").replaceAll("\\*\\*", "").replaceAll("\\*", "").trim();
                Log.d(TAG, "[OPENAI_API] Response: " + text);
                return text;
            }
        }

        return null;
    }

    /**
     * 通用 HTTP POST
     */
    private String doHttpPost(String urlStr, String body, String authHeader) throws Exception {
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(15000);
        conn.setDoOutput(true);

        if (authHeader != null && !authHeader.isEmpty()) {
            conn.setRequestProperty("Authorization", authHeader);
        }

        try (OutputStream os = conn.getOutputStream()) {
            os.write(body.getBytes(StandardCharsets.UTF_8));
            os.flush();
        }

        int responseCode = conn.getResponseCode();
        BufferedReader reader;
        if (responseCode >= 200 && responseCode < 300) {
            reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
        } else {
            reader = new BufferedReader(new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8));
        }

        StringBuilder sb = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) {
            sb.append(line);
        }
        reader.close();
        conn.disconnect();

        String result = sb.toString();
        if (responseCode < 200 || responseCode >= 300) {
            Log.e(TAG, "[HTTP] Error " + responseCode + ": " + result);
            throw new Exception("HTTP " + responseCode + ": " + result);
        }

        return result;
    }

    /**
     * 当 API 调用失败时的本地 fallback 消息
     */
    private String getLocalFallbackMessage(String source, String personaName) {
        String shortName = (personaName == null || personaName.isEmpty()) ? "终端" : personaName;

        if ("sleep".equals(source)) {
            String[] msgs = new String[]{
                    "[HAPTIC:warning]" + shortName + " 夜巡记录已经写满了。现在关屏，去睡。",
                    "[HAPTIC:alert]别再硬撑了。眼睛和神经都在报警，立刻休眠。",
                    "[HAPTIC:warning]你还在线。我不喜欢看见你拿明天的状态做燃料。",
                    "[HAPTIC:determination]把手机放下，去床上。剩下的事情，睡醒再处理。"
            };
            return msgs[(int) (Math.random() * msgs.length)];
        } else if ("water".equals(source)) {
            String[] msgs = new String[]{
                    "[HAPTIC:gentle]抬手，喝水。别让我等到你头痛才想起来。",
                    "[HAPTIC:comfort]你今天的细胞已经在催补给了。现在去接一杯水。",
                    "[HAPTIC:curiosity]我很好奇，你是不是又把喝水这件事假装忘掉了？",
                    "[HAPTIC:gentle]先喝两口水，再回来继续忙。就现在。"
            };
            return msgs[(int) (Math.random() * msgs.length)];
        } else if ("exercise".equals(source)) {
            String[] msgs = new String[]{
                    "[HAPTIC:determination]今天的运动额度还是零。起身，哪怕先走十分钟。",
                    "[HAPTIC:pride]让我看看你今天不是只会坐着耗电。现在去活动。",
                    "[HAPTIC:alert]身体已经僵住了。拉伸、快走、深蹲，选一个立刻开始。",
                    "[HAPTIC:determination]再拖下去就只剩借口了。去动。"
            };
            return msgs[(int) (Math.random() * msgs.length)];
        } else if ("meal".equals(source)) {
            String[] msgs = new String[]{
                    "[HAPTIC:warning]能量储备正在见底。去吃点真正的食物，不是空气。",
                    "[HAPTIC:comfort]先补点吃的，别让身体继续空转。",
                    "[HAPTIC:alert]低能量状态持续过久。现在执行进食协议。",
                    "[HAPTIC:gentle]去找点能让你稳下来的食物，别再拖。"
            };
            return msgs[(int) (Math.random() * msgs.length)];
        }

        return "[HAPTIC:gentle]该照顾一下自己了。";
    }

    // ============================================================
    //  方案 4：静音音频播放（伪装音乐播放器保活）
    //  ============================================================

    private void startSilentPlayback() {
        try {
            // —— MediaSession：让系统把服务当作真正的音乐播放器 ——
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mediaSession = new MediaSession(this, "NegentropySilentPlayback");
                mediaSession.setActive(true);
                PlaybackState.Builder stateBuilder = new PlaybackState.Builder()
                        .setState(PlaybackState.STATE_PLAYING, 0, 1.0f);
                mediaSession.setPlaybackState(stateBuilder.build());
                Log.d(TAG, "MediaSession created and active (PLAYING state)");
            }

            // —— AudioTrack：静音 PCM 循环播放 ——
            int sampleRate = 44100;
            int channelConfig = AudioFormat.CHANNEL_OUT_MONO;
            int audioFormat = AudioFormat.ENCODING_PCM_16BIT;
            int bufferSize = AudioTrack.getMinBufferSize(sampleRate, channelConfig, audioFormat);
            if (bufferSize < 1024) bufferSize = 1024;

            AudioAttributes audioAttrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_UNKNOWN)  // 不抢占音频焦点，不影响用户播放音乐
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build();

            AudioFormat format = new AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setChannelMask(channelConfig)
                    .setEncoding(audioFormat)
                    .build();

            silentAudioTrack = new AudioTrack.Builder()
                    .setAudioAttributes(audioAttrs)
                    .setAudioFormat(format)
                    .setBufferSizeInBytes(bufferSize * 2)
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build();

            if (silentAudioTrack.getState() == AudioTrack.STATE_UNINITIALIZED) {
                Log.e(TAG, "AudioTrack failed to initialize");
                return;
            }

            playbackActive = true;
            silentAudioTrack.play();

            final byte[] silence = new byte[bufferSize];
            silentPlaybackThread = new Thread(() -> {
                android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
                Log.d(TAG, "Silent playback loop started");
                while (playbackActive && silentAudioTrack != null) {
                    try {
                        int written = silentAudioTrack.write(silence, 0, silence.length);
                        if (written < 0) {
                            Log.w(TAG, "AudioTrack write returned " + written + ", breaking loop");
                            break;
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Silent playback write error", e);
                        break;
                    }
                }
                Log.d(TAG, "Silent playback loop ended");
            }, "SilentPlaybackThread");
            silentPlaybackThread.setDaemon(true);
            silentPlaybackThread.start();

            Log.d(TAG, "Silent AudioTrack playback started (mediaPlayback disguise active)");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start silent playback", e);
        }
    }

    private void stopSilentPlayback() {
        playbackActive = false;

        if (silentPlaybackThread != null && silentPlaybackThread.isAlive()) {
            try {
                silentPlaybackThread.join(2000);
            } catch (InterruptedException ignored) {}
            silentPlaybackThread = null;
        }

        if (silentAudioTrack != null) {
            try {
                if (silentAudioTrack.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) {
                    silentAudioTrack.stop();
                }
            } catch (Exception e) {
                Log.e(TAG, "Error stopping AudioTrack", e);
            }
            try {
                silentAudioTrack.release();
            } catch (Exception e) {
                Log.e(TAG, "Error releasing AudioTrack", e);
            }
            silentAudioTrack = null;
        }

        if (mediaSession != null) {
            try {
                mediaSession.setActive(false);
                mediaSession.release();
            } catch (Exception e) {
                Log.e(TAG, "Error releasing MediaSession", e);
            }
            mediaSession = null;
        }

        Log.d(TAG, "Silent playback stopped and resources released");
    }

    // ============================================================
    //  Service 生命周期
    // ============================================================

    private void updateNotification(String content) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, createNotification(content));
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = createNotification("终端后台协议已激活...");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                    | ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                    | ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // 检查是否由闹钟触发
        boolean fromAlarm = intent != null && intent.getBooleanExtra(AlarmReceiver.EXTRA_FROM_ALARM, false);
        String alarmLabel = intent != null ? intent.getStringExtra(AlarmReceiver.EXTRA_ALARM_LABEL) : null;

        Log.d(TAG, "onStartCommand fromAlarm=" + fromAlarm + " label=" + alarmLabel);

        // 在后台线程执行检测，避免阻塞主线程
        new Thread(() -> {
            performScheduledCheckAndReschedule();
        }).start();

        return START_STICKY;
    }

    private Notification createNotification(String content) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Negentropy Terminal")
                .setContentText(content)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setContentIntent(pendingIntent)
                .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                NotificationChannel serviceChannel = new NotificationChannel(
                        CHANNEL_ID, "核心保活通道", NotificationManager.IMPORTANCE_LOW);
                manager.createNotificationChannel(serviceChannel);

                NotificationChannel existingHighChannel = manager.getNotificationChannel(HIGH_IMPORTANCE_CHANNEL_ID);
                if (existingHighChannel != null) {
                    manager.deleteNotificationChannel(HIGH_IMPORTANCE_CHANNEL_ID);
                }

                NotificationChannel highChannel = new NotificationChannel(
                        HIGH_IMPORTANCE_CHANNEL_ID, "AI 紧急指令通道", NotificationManager.IMPORTANCE_HIGH);
                highChannel.enableVibration(false);
                highChannel.setVibrationPattern(new long[]{0L});
                highChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(highChannel);
            }
        }
    }

    @Override
    public void onDestroy() {
        serviceRunning = false;
        stopSilentPlayback();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (notificationRequestReceiver != null) unregisterReceiver(notificationRequestReceiver);
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
        }
        // 注意：不取消闹钟。闹钟是独立的，即使服务被系统杀掉，
        // 下一次闹钟仍会重新拉起服务。这就是分层唤醒架构的核心。
        super.onDestroy();
    }
}
