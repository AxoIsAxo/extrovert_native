package im.extrovert.mobile

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import org.unifiedpush.android.connector.UnifiedPush

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var pendingCallAnswer = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Register with UnifiedPush (no-op if already registered; asks user to
    // pick a distributor if none is set). The distributor will call
    // ExtrovertPushReceiver.onNewEndpoint with the push endpoint URL.
    val instance = packageName
    val features = ArrayList<String>().apply { add(UnifiedPush.FEATURE_BYTES_MESSAGE) }
    UnifiedPush.registerApp(this, "extrovert", features, instance)

    requestNotificationPermissions()
    handleCallIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleCallIntent(intent)
  }

  // Notification "Answer" action: the webview auto-answers the pending call
  // once the signaling socket reconnects (the server delivers the offer).
  // Decline is handled by CallActionReceiver without launching the app.
  private fun handleCallIntent(intent: Intent?) {
    val extras = intent?.extras ?: return
    if (extras.getBoolean("call_answer", false)) {
      pendingCallAnswer = true
    }
    flushToWebview()
  }

  private fun flushToWebview() {
    val wv = webView ?: return
    if (pendingCallAnswer) {
      pendingCallAnswer = false
      wv.evaluateJavascript(
        "window.__call_answer=true; window.dispatchEvent(new Event('call-answer'))",
        null
      )
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    this.webView = webView
    // Inject the stored push endpoint into the webview so the TS side can
    // register it with the server via /api/v1/push/subscribe.
    val prefs = getSharedPreferences(ExtrovertPushReceiver.PREFS_NAME, MODE_PRIVATE)
    val endpoint = prefs.getString(ExtrovertPushReceiver.KEY_ENDPOINT, null)
    if (endpoint != null) {
      injectEndpoint(webView, endpoint)
    }
    flushToWebview()
  }

  private fun injectEndpoint(webView: WebView, endpoint: String) {
    val escaped = endpoint.replace("\\", "\\\\").replace("'", "\\'")
    webView.evaluateJavascript(
      "window.__push_endpoint='$escaped'; window.dispatchEvent(new CustomEvent('push-endpoint', {detail:'$escaped'}))",
      null
    )
  }

  // Notifications on Android 13+ need a runtime permission; full-screen ring
  // on Android 14+ is denied by default and must be granted via Settings.
  private fun requestNotificationPermissions() {
    if (Build.VERSION.SDK_INT >= 33) {
      requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_PERMISSIONS)
    }
    if (Build.VERSION.SDK_INT >= 34) {
      val nm = getSystemService(NotificationManager::class.java)
      if (nm != null && !nm.canUseFullScreenIntent()) {
        val prefs = getSharedPreferences("extrovert_perms", MODE_PRIVATE)
        if (!prefs.getBoolean("fsi_prompted", false)) {
          prefs.edit().putBoolean("fsi_prompted", true).apply()
          try {
            startActivity(
              Intent(
                Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                Uri.parse("package:$packageName")
              )
            )
          } catch (_: Exception) {}
        }
      }
    }
  }

  // Token-authenticated cancel endpoint — no OAuth needed, the token is a
  // secret delivered only over the push channel.
  companion object {
    private const val REQ_PERMISSIONS = 3001
  }
}
