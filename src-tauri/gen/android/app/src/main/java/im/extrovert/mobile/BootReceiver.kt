package im.extrovert.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restarts the push service after a device reboot. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            try {
                context.startForegroundService(Intent(context, PushService::class.java))
            } catch (_: Exception) {}
        }
    }
}
