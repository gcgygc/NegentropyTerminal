package terminal.negentropy.life;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * 分层闹钟调度器 —— 专治国产 ROM 杀后台。
 *
 * 策略：
 * 1. 主力：AlarmManager.setAlarmClock() —— 系统最高优先级，能从 Doze/深度休眠唤醒，
 *    会显示一个小闹钟图标，但这是保活的代价。
 * 2. 备用：setExactAndAllowWhileIdle() —— 偏移 15 秒作为冗余兜底。
 * 3. 双闹钟互为备份：即使一个被厂商阉割，另一个大概率还能触发。
 *
 * Android 15 (OnePlus 13 / ColorOS) 实测：
 * - setAlarmClock 能稳定唤醒
 * - 前台服务被杀后 60 秒内即可被闹钟重新拉起
 */
public final class BackgroundAlarmScheduler {

    private static final String TAG = "NegentropyAlarmSched";

    /**
     * 主闹钟间隔（毫秒）
     */
    static final long ALARM_INTERVAL_MS = 60_000L;

    /**
     * 备用闹钟相对于主闹钟的偏移量（毫秒）
     */
    private static final long BACKUP_ALARM_OFFSET_MS = 15_000L;

    /**
     * 主闹钟的 PendingIntent requestCode 基数
     */
    private static final int REQUEST_CODE_PRIMARY = 9001;

    /**
     * 备用闹钟的 PendingIntent requestCode 基数
     */
    private static final int REQUEST_CODE_BACKUP = 9002;

    private BackgroundAlarmScheduler() {}

    /**
     * 调度下一次后台检查。
     * 同时设置主闹钟（AlarmClock 级别）和备用闹钟（ExactAndAllowWhileIdle）。
     */
    public static void scheduleNextCheck(Context context) {
        final long now = System.currentTimeMillis();
        final long primaryTriggerAt = now + ALARM_INTERVAL_MS;
        final long backupTriggerAt = now + ALARM_INTERVAL_MS + BACKUP_ALARM_OFFSET_MS;

        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            Log.e(TAG, "AlarmManager is null, cannot schedule alarms");
            return;
        }

        // —— 主力：setAlarmClock ——
        // 在所有 Android 版本上都享有最高调度优先级。
        // Android 12+ 即使 SCHEDULE_EXACT_ALARM 被用户关闭，setAlarmClock 仍可触发
        // （系统认为用户可见的闹钟不应被静默拦截）。
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            try {
                Intent primaryIntent = buildAlarmIntent(context, "PRIMARY");
                PendingIntent primaryPi = PendingIntent.getBroadcast(
                        context,
                        REQUEST_CODE_PRIMARY,
                        primaryIntent,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                );

                AlarmManager.AlarmClockInfo clockInfo = new AlarmManager.AlarmClockInfo(
                        primaryTriggerAt,
                        PendingIntent.getActivity(
                                context,
                                0,
                                new Intent(context, MainActivity.class),
                                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                        )
                );
                am.setAlarmClock(clockInfo, primaryPi);
                Log.d(TAG, "Primary AlarmClock scheduled for +" + (primaryTriggerAt - now) / 1000 + "s");
            } catch (SecurityException e) {
                Log.w(TAG, "AlarmClock permission denied, falling back to exact alarm", e);
                // 如果 AlarmClock 被拒绝（极少见），降级到 setExactAndAllowWhileIdle
                scheduleExactAlarm(context, am, primaryTriggerAt, "PRIMARY_FALLBACK");
            } catch (Exception e) {
                Log.e(TAG, "Failed to schedule primary AlarmClock", e);
            }
        }

        // —— 备用：setExactAndAllowWhileIdle（偏移 15 秒） ——
        // 如果主闹钟被系统吞掉，备用闹钟在 15 秒后接力。
        if (canScheduleExactAlarms(context)) {
            try {
                scheduleExactAlarm(context, am, backupTriggerAt, "BACKUP");
            } catch (Exception e) {
                Log.e(TAG, "Failed to schedule backup exact alarm", e);
            }
        } else {
            Log.w(TAG, "Exact alarm permission not granted, backup alarm skipped");
            // 尝试用 setWindow 做最低限度兜底
            try {
                Intent backupIntent = buildAlarmIntent(context, "BACKUP_WINDOW");
                PendingIntent backupPi = PendingIntent.getBroadcast(
                        context,
                        REQUEST_CODE_BACKUP,
                        backupIntent,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                );
                am.setWindow(
                        AlarmManager.RTC_WAKEUP,
                        backupTriggerAt,
                        ALARM_INTERVAL_MS / 4,  // 15 秒窗口
                        backupPi
                );
                Log.d(TAG, "Backup window alarm scheduled as fallback");
            } catch (Exception e) {
                Log.e(TAG, "Failed to schedule backup window alarm", e);
            }
        }
    }

    private static void scheduleExactAlarm(Context context, AlarmManager am, long triggerAt, String label) {
        Intent intent = buildAlarmIntent(context, label);
        PendingIntent pi = PendingIntent.getBroadcast(
                context,
                label.contains("BACKUP") ? REQUEST_CODE_BACKUP : REQUEST_CODE_PRIMARY,
                intent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        } else {
            am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
        }
        Log.d(TAG, label + " exact alarm scheduled for +" + (triggerAt - System.currentTimeMillis()) / 1000 + "s");
    }

    /**
     * 取消所有由本调度器设置的闹钟。
     */
    public static void cancelAll(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        try {
            Intent primaryIntent = new Intent(context, AlarmReceiver.class);
            primaryIntent.setAction("terminal.negentropy.life.ALARM_PRIMARY");
            PendingIntent primaryPi = PendingIntent.getBroadcast(
                    context,
                    REQUEST_CODE_PRIMARY,
                    primaryIntent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_NO_CREATE
            );
            if (primaryPi != null) {
                am.cancel(primaryPi);
                primaryPi.cancel();
            }
        } catch (Exception ignored) {}

        try {
            Intent backupIntent = new Intent(context, AlarmReceiver.class);
            backupIntent.setAction("terminal.negentropy.life.ALARM_BACKUP");
            PendingIntent backupPi = PendingIntent.getBroadcast(
                    context,
                    REQUEST_CODE_BACKUP,
                    backupIntent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_NO_CREATE
            );
            if (backupPi != null) {
                am.cancel(backupPi);
                backupPi.cancel();
            }
        } catch (Exception ignored) {}

        Log.d(TAG, "All alarms cancelled");
    }

    /**
     * 检查是否有权调度精确闹钟（Android 12+）。
     * 注意：setAlarmClock 不受此权限限制，所以即使返回 false，
     * 主力闹钟仍然可以工作。此方法仅用于判断是否启用备用闹钟。
     */
    public static boolean canScheduleExactAlarms(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            return am != null && am.canScheduleExactAlarms();
        }
        return true; // Android 11 及以下默认有权限
    }

    /**
     * 跳转到系统精确闹钟权限设置页（Android 12+）。
     */
    public static void requestExactAlarmPermission(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } catch (Exception e) {
                Log.e(TAG, "Failed to open exact alarm settings", e);
            }
        }
    }

    // —— 内部工具 ——

    private static Intent buildAlarmIntent(Context context, String label) {
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction("terminal.negentropy.life.ALARM_" + label);
        // Android 12+ 要求显式 intent 或设置 package
        intent.setPackage(context.getPackageName());
        return intent;
    }
}
