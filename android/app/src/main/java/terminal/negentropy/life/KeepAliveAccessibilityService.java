package terminal.negentropy.life;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;

/**
 * 方案 6：无障碍服务保活。
 *
 * 无障碍服务在 Android 系统中享有最高优先级，包括 ColorOS 在内的国产 ROM
 * 几乎不会杀掉无障碍服务（杀了会影响残障用户的辅助功能）。
 *
 * 此服务本身不做任何辅助功能操作，仅用于：
 * 1. 提升整个 App 进程的优先级
 * 2. 在 onServiceConnected 时确保 KeepAliveService 在运行
 * 3. 在 onDestroy 时尝试重新拉起（部分 ROM 会回调此方法）
 */
public class KeepAliveAccessibilityService extends AccessibilityService {

    private static final String TAG = "NegentropyAccessSvc";

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // 不处理任何无障碍事件，仅用于保活
    }

    @Override
    public void onInterrupt() {
        // 不处理中断
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        Log.d(TAG, "AccessibilityService connected - process priority elevated");

        // 确保前台 KeepAliveService 在运行
        Intent serviceIntent = new Intent(this, KeepAliveService.class);
        try {
            startService(serviceIntent);
            Log.d(TAG, "KeepAliveService start requested from AccessibilityService");
        } catch (Exception e) {
            Log.e(TAG, "Failed to start KeepAliveService from AccessibilityService", e);
        }
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "AccessibilityService onDestroy - attempting restart");
        // 尝试重新拉起 KeepAliveService（如果进程还没死的话）
        Intent serviceIntent = new Intent(this, KeepAliveService.class);
        try {
            startService(serviceIntent);
        } catch (Exception e) {
            Log.e(TAG, "Failed to restart KeepAliveService on destroy", e);
        }
        super.onDestroy();
    }
}
