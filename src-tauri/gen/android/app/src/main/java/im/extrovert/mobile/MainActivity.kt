package im.extrovert.mobile

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null
  private var pendingCallAnswer = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Own push channel: a foreground service keeps a WS to the server so calls
    // ring even when the app UI is closed (no Google, no third-party relay).
    ContextCompat.startForegroundService(this, Intent(this, PushService::class.java))

    requestNotificationPermissions()
    requestBatteryExemption()
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
    flushToWebview()
  }

  // Notifications on Android 13+ need a runtime permission; full-screen ring
  // on Android 14+ is denied by default and must be granted via Settings.
  private fun requestNotificationPermissions() {
    if (Build.VERSION.SDK_INT >= 33 &&
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
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

  // Always-on connections get killed by aggressive battery managers; ask once
  // for the standard exemption (same as WhatsApp/Signal).
  private fun requestBatteryExemption() {
    try {
      val pm = getSystemService(PowerManager::class.java)
      if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
        val prefs = getSharedPreferences("extrovert_perms", MODE_PRIVATE)
        if (!prefs.getBoolean("battery_prompted", false)) {
          prefs.edit().putBoolean("battery_prompted", true).apply()
          val intent = Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:$packageName")
          )
          try {
            startActivity(intent)
          } catch (_: Exception) {}
        }
      }
    } catch (_: Exception) {}
  }

  companion object {
    private const val REQ_PERMISSIONS = 3001
  }
}
