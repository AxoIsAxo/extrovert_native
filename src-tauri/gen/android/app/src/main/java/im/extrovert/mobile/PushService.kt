package im.extrovert.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.File
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

/**
 * The app's own push channel — no Google, no third-party relay.
 *
 * Holds a foreground WebSocket to the Extrovert signaling server
 * (wss://extrovert.redforged.eu/ws?token=…), registered as a push channel
 * ({type:'push_register'}). When someone calls an offline user, the server
 * delivers {type:'call'} here → full-screen ringing notification with
 * Answer/Decline, exactly like WhatsApp/Signal. Unanswered calls produce a
 * {type:'missed_call'} notification after the server's 2-minute TTL.
 *
 * Android requires any always-on background process to show a persistent
 * notification: this is the low-priority "Extrovert" chip, no sound.
 */
class PushService : Service() {

    private var ws: WebSocket? = null
    private var reconnectDelay = 1000L
    private var connecting = false
    private var refreshInFlight = false
    private val handler = Handler(Looper.getMainLooper())

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            reconnectDelay = 1000L
            Log.d(TAG, "push WS open")
            sendJson("push_register", JSONObject())
            sendJson("ping", JSONObject())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val data = try { JSONObject(text) } catch (_: Exception) { return }
            when (data.optString("type")) {
                "call" -> {
                    val from = data.optString("from_display").ifEmpty { data.optString("from") }.ifEmpty { "Someone" }
                    showCallNotification(from, data.optString("cancel_token"))
                }
                "missed_call" -> {
                    val from = data.optString("from_display").ifEmpty { data.optString("from") }.ifEmpty { "Someone" }
                    showMissedCallNotification(from)
                }
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "push WS failure: ${t.message}")
            ws = null
            scheduleReconnect()
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            Log.d(TAG, "push WS closed: $code $reason")
            ws = null
            if (code == 1008 || code == 4401) {
                // Auth failure — try refreshing the token once, then reconnect.
                handler.post { refreshTokenAndReconnect() }
            } else {
                scheduleReconnect()
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannels()
        startForeground(NOTIF_SERVICE, buildServiceNotification())
        connect()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (readTokens().first == null) {
            Log.d(TAG, "no access token — stopping push service")
            stopSelf()
            return START_NOT_STICKY
        }
        connect()
        return START_STICKY
    }

    override fun onDestroy() {
        ws?.close(1000, "service destroyed")
        ws = null
        super.onDestroy()
    }

    private fun connect() {
        if (connecting || ws != null) return
        val token = readTokens().first ?: return
        connecting = true
        val client = OkHttpClient.Builder()
            .pingInterval(30, TimeUnit.SECONDS)
            .connectTimeout(15, TimeUnit.SECONDS)
            .build()
        val req = Request.Builder()
            .url("$WS_URL?token=${URLEncoder.encode(token, "UTF-8")}")
            .build()
        ws = client.newWebSocket(req, listener)
    }

    private fun sendJson(type: String, obj: JSONObject) {
        val w = ws ?: return
        obj.put("type", type)
        try { w.send(obj.toString()) } catch (_: Exception) {}
    }

    private fun scheduleReconnect() {
        if (connecting) connecting = false
        handler.postDelayed({
            if (readTokens().first == null) { stopSelf(); return@postDelayed }
            connect()
        }, reconnectDelay)
        reconnectDelay = (reconnectDelay * 2).coerceAtMost(MAX_RECONNECT_MS)
    }

    private fun refreshTokenAndReconnect() {
        if (refreshInFlight) return
        refreshInFlight = true
        Thread {
            try {
                val ok = refreshToken()
                Log.d(TAG, "token refresh: $ok")
                handler.post { connecting = false; ws = null; connect() }
            } finally {
                refreshInFlight = false
            }
        }.start()
    }

    // POST /api/v1/oauth/token with the refresh token (same grant the Rust
    // core uses); writes the fresh pair back to tokens.json (Rust's store).
    private fun refreshToken(): Boolean {
        val tokens = readTokens()
        val refresh = tokens.second ?: return false
        val conn = java.net.URL(TOKEN_URL).openConnection() as java.net.HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            val body = "grant_type=refresh_token&client_id=$CLIENT_ID&refresh_token=${URLEncoder.encode(refresh, "UTF-8")}"
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code != 200) {
                Log.w(TAG, "token refresh http $code")
                return false
            }
            val resp = JSONObject(conn.inputStream.bufferedReader().readText())
            val access = resp.optString("access_token")
            val newRefresh = resp.optString("refresh_token").ifEmpty { refresh }
            if (access.isEmpty()) return false
            val file = tokensFile()
            val tmp = File(file.parentFile, "tokens.json.tmp")
            tmp.writeText(JSONObject()
                .put("access_token", access)
                .put("refresh_token", newRefresh)
                .toString())
            if (!tmp.renameTo(file)) {
                file.writeText(tmp.readText())
                tmp.delete()
            }
            return true
        } catch (e: Exception) {
            Log.w(TAG, "token refresh failed", e)
            return false
        } finally {
            conn.disconnect()
        }
    }

    private fun tokensFile(): File = File(filesDir.parentFile ?: filesDir, "tokens.json")

    private fun readTokens(): Pair<String?, String?> {
        return try {
            val f = tokensFile()
            if (!f.exists()) return null to null
            val o = JSONObject(f.readText())
            o.optString("access_token").ifEmpty { null } to o.optString("refresh_token").ifEmpty { null }
        } catch (_: Exception) {
            null to null
        }
    }

    // ---- notification UI ----

    private fun createChannels() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(
            NotificationChannel(CALL_CHANNEL_ID, "Incoming calls", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Ringing notifications for incoming voice calls"
            }
        )
        nm.createNotificationChannel(
            NotificationChannel(SERVICE_CHANNEL_ID, "Connection status", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Keeps Extrovert able to receive calls (required by Android)"
            }
        )
    }

    private fun buildServiceNotification(): Notification =
        NotificationCompat.Builder(this, SERVICE_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_share)
            .setContentTitle("Extrovert")
            .setContentText("Connected — calls will ring")
            .setOngoing(true)
            .build()

    private fun showCallNotification(fromDisplayName: String, cancelToken: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val answerIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("call_answer", true)
        }
        val answerPending = PendingIntent.getActivity(
            this, REQ_ANSWER, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val dismissIntent = Intent(this, CallActionReceiver::class.java).apply {
            action = "im.extrovert.mobile.DECLINE_CALL"
            if (cancelToken.isNotEmpty()) putExtra("cancel_token", cancelToken)
        }
        val dismissPending = PendingIntent.getBroadcast(
            this, REQ_DISMISS, dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CALL_CHANNEL_ID)
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

    private fun showMissedCallNotification(fromDisplayName: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val openIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPending = PendingIntent.getActivity(
            this, REQ_MISSED_OPEN, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CALL_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Missed call")
            .setContentText("from $fromDisplayName")
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(openPending)

        nm.notify(MISSED_NOTIFICATION_ID, builder.build())
    }

    companion object {
        private const val TAG = "ExtrovertPush"
        private const val WS_URL = "wss://extrovert.redforged.eu/ws"
        private const val TOKEN_URL = "https://extrovert.redforged.eu/api/v1/oauth/token"
        private const val CLIENT_ID = "86add8101780d8afeb3b258e22743b2b2ff74f46d903c3ff"
        private const val MAX_RECONNECT_MS = 30000L
        private const val CALL_CHANNEL_ID = "extrovert_calls"
        private const val SERVICE_CHANNEL_ID = "extrovert_service"
        private const val NOTIF_SERVICE = 1000
        private const val NOTIFICATION_ID = 1001
        private const val MISSED_NOTIFICATION_ID = 1002
        private const val REQ_ANSWER = 2001
        private const val REQ_DISMISS = 2002
        private const val REQ_MISSED_OPEN = 2003
        private const val CALL_TIMEOUT_MS = 120_000L  // matches server PENDING_TTL
    }
}
