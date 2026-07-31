package im.extrovert.mobile

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import org.unifiedpush.android.connector.UnifiedPush

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // Register with UnifiedPush (no-op if already registered; asks user to
    // pick a distributor if none is set). The distributor will call
    // ExtrovertPushReceiver.onNewEndpoint with the push endpoint URL.
    val instance = packageName
    val features = ArrayList<String>().apply { add(UnifiedPush.FEATURE_BYTES_MESSAGE) }
    UnifiedPush.registerApp(this, "extrovert", features, instance)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    // Inject the stored push endpoint into the webview so the TS side can
    // register it with the server via /api/v1/push/subscribe.
    val prefs = getSharedPreferences(ExtrovertPushReceiver.PREFS_NAME, MODE_PRIVATE)
    val endpoint = prefs.getString(ExtrovertPushReceiver.KEY_ENDPOINT, null)
    if (endpoint != null) {
      injectEndpoint(webView, endpoint)
    }
  }

  private fun injectEndpoint(webView: WebView, endpoint: String) {
    val escaped = endpoint.replace("\\", "\\\\").replace("'", "\\'")
    webView.evaluateJavascript(
      "window.__push_endpoint='$escaped'; window.dispatchEvent(new CustomEvent('push-endpoint', {detail:'$escaped'}))",
      null
    )
  }
}
