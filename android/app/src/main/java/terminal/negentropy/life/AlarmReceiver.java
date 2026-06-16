package terminal.negentropy.life;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * 闹钟唤醒接收器。
 *
 * 由 BackgroundAlarmScheduler 设置的闹钟触发。
 * 负责将 KeepAliveService 重新拉起（如果已被杀），并触发一次后台检查。
 *
 * 同时发送 HEARTBEAT 广播通知前台 Activity（如果还活着的话）。
 */
public class AlarmReceiver extends BroadcastReceiver {

    private static final String TAG = "NegentropyAlarmRecv";

    /**
     * 用于标记此次是由闹钟触发的 Service 启动
     */
    static final String EXTRA_FROM_ALARM = "from_alarm";
    static final String EXTRA_ALARM_LABEL = "alarm_label";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        String label = action != null && action.contains("BACKUP") ? "BACKUP" : "PRIMARY";

        Log.d(TAG, "Alarm received: " + action);

        // 1. 尝试发送心跳给前台 WebView（如果 Activity 还活着）
        Intent heartbeatIntent = new Intent("terminal.negentropy.life.HEARTBEAT");
        heartbeatIntent.setPackage(context.getPackageName());
        context.sendBroadcast(heartbeatIntent);

        // 2. 启动/唤醒 KeepAliveService
        Intent serviceIntent = new Intent(context, KeepAliveService.class);
        serviceIntent.putExtra(EXTRA_FROM_ALARM, true);
        serviceIntent.putExtra(EXTRA_ALARM_LABEL, label);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
            Log.d(TAG, "KeepAliveService started via " + label + " alarm");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start KeepAliveService from alarm", e);
            // 极端情况：连前台服务都起不来，尝试用 WorkManager 兜底
            // 但我们没有 WorkManager 依赖，所以仅记录日志
        }
    }
}
