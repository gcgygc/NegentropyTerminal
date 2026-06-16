package terminal.negentropy.life;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * 系统事件接收器 —— 捕捉一切可能间接唤醒进程的信号。
 *
 * 除了开机完成，还监听了：
 * - 时区/时间变更（可能触发系统调度刷新）
 * - 应用更新/替换
 * - 用户解锁/亮屏
 * - 电源连接/断开（系统在电源状态变化时会短暂恢复后台任务）
 *
 * 每个信号都是一次"重新拉起 KeepAliveService"的机会。
 */
public class RestartReceiver extends BroadcastReceiver {

    private static final String TAG = "NegentropyRestartRecv";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        Log.d(TAG, "Restart signal received: " + action);

        try {
            Intent serviceIntent = new Intent(context, KeepAliveService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to start KeepAliveService from " + action + ": " + e.getMessage());
        }
    }
}