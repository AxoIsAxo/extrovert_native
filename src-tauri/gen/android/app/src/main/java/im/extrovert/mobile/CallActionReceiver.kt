package im.extrovert.mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.net.HttpURLConnection
import java.net.URL

/**
 * Handles the "Decline" action on the incoming-call push notification WITHOUT
 * opening the app: posts the token-authenticated cancel so the caller is told
 * the call was declined, then lets the notification dismiss itself.
 */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val token = intent.getStringExtra("cancel_token") ?: return
        Thread {
            try {
                val conn = URL("https://extrovert.redforged.eu/push/cancel-pending").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use {
                    it.write("{\"cancel_token\":\"$token\"}".toByteArray(Charsets.UTF_8))
                }
                val code = conn.responseCode
                conn.disconnect()
                android.util.Log.d("Extrovert", "decline cancel-pending -> $code")
            } catch (e: Exception) {
                android.util.Log.w("Extrovert", "decline cancel-pending failed", e)
            }
        }.start()
    }
}
