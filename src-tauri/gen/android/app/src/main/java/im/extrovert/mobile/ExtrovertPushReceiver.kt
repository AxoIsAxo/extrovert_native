package im.extrovert.mobile

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import androidx.core.app.NotificationCompat
import org.unifiedpush.android.connector.MessagingReceiver

/**
 * UnifiedPush receiver — receives push messages from the user's chosen
 * distributor (ntfy, Gotify, Nextcloud, etc.). Fully open-source, no Google.
 *
 * When the distributor assigns an endpoint URL (onNewEndpoint), we store it
 * in SharedPreferences so the Rust/TS side can POST it to the server on next
 * app foreground. When a push message arrives (onMessage), we show a
 * full-screen ringing notification exactly like WhatsApp/Signal.
 */
class ExtrovertPushReceiver : MessagingReceiver() {

    override fun onNewEndpoint(context: Context, endpoint: String, instance: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_ENDPOINT, endpoint).apply()
    }

    override fun onMessage(context: Context, message: ByteArray, instance: String) {
        val body = String(message, Charsets.UTF_8)
        val data = try { parseSimple(body) } catch (_: Exception) { return }
        val type = data["type"] ?: return
        val from = data["from_display"] ?: data["from"] ?: "Someone"
        when (type) {
            "call" -> showCallNotification(context, from, data["cancel_token"])
            "missed_call" -> showMissedCallNotification(context, from)
        }
    }

    override fun onRegistrationFailed(context: Context, reason: String) {
        // Registration failed — user may not have a distributor installed.
        // Phase 1 offline calling still works (ring-on-reconnect + missed-call).
        android.util.Log.w("ExtrovertPush", "UnifiedPush registration failed: $reason")
    }

    override fun onUnregistered(context: Context, instance: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(KEY_ENDPOINT).apply()
    }

    private fun showCallNotification(context: Context, fromDisplayName: String, cancelToken: String?) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureChannel(nm)

        val answerIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("call_answer", true)
            if (cancelToken != null) putExtra("cancel_token", cancelToken)
        }
        val answerPending = PendingIntent.getActivity(
            context, REQ_ANSWER, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val dismissIntent = Intent(context, CallActionReceiver::class.java).apply {
            action = "im.extrovert.mobile.DECLINE_CALL"
            if (cancelToken != null) putExtra("cancel_token", cancelToken)
        }
        val dismissPending = PendingIntent.getBroadcast(
            context, REQ_DISMISS, dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Incoming call")
            .setContentText("$fromDisplayName is calling")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setTimeoutAfter(CALL_TIMEOUT_MS)
            .setFullScreenIntent(answerPending, true)
            .addAction(0, "Answer", answerPending)
            .addAction(0, "Decline", dismissPending)
            .setOngoing(true)

        nm.notify(NOTIFICATION_ID, builder.build())
    }

    private fun showMissedCallNotification(context: Context, fromDisplayName: String) {
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        ensureChannel(nm)

        val openIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPending = PendingIntent.getActivity(
            context, REQ_MISSED_OPEN, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Missed call")
            .setContentText("from $fromDisplayName")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openPending)

        nm.notify(MISSED_NOTIFICATION_ID, builder.build())
    }

    private fun ensureChannel(nm: NotificationManager) {
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(
            CHANNEL_ID, "Incoming calls",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Ringing notifications for incoming voice calls"
        }
        nm.createNotificationChannel(channel)
    }

    /** Minimal JSON parser for our flat {key:value} payload. */
    private fun parseSimple(json: String): Map<String, String> {
        val result = mutableMapOf<String, String>()
        val trimmed = json.trim().removeSurrounding("{", "}")
        for (pair in trimmed.split(",")) {
            val i = pair.indexOf(':')
            if (i < 0) continue
            val key = pair.substring(0, i).trim().removeSurrounding("\"")
            val value = pair.substring(i + 1).trim().removeSurrounding("\"")
            result[key] = value
        }
        return result
    }

    companion object {
        private const val CHANNEL_ID = "extrovert_calls"
        private const val NOTIFICATION_ID = 1001
        private const val MISSED_NOTIFICATION_ID = 1002
        private const val REQ_ANSWER = 2001
        private const val REQ_DISMISS = 2002
        private const val REQ_MISSED_OPEN = 2003
        private const val CALL_TIMEOUT_MS = 120_000L  // 2 min, matches server PENDING_TTL
        const val PREFS_NAME = "extrovert_push"
        const val KEY_ENDPOINT = "push_endpoint"
    }
}
