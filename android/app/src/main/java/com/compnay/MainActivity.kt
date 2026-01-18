package com.compnay

import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.WritableMap

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "mobile"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Handle new intent when activity is already running
   */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    android.util.Log.d("MainActivity", "🔥 [MainActivity] onNewIntent called - activity already running")
    setIntent(intent)
    // Handle immediately if activity is already running (no delay needed)
    handleIntent(intent)
  }

  /**
   * Process intent extras and send to React Native
   * Called after React Native is initialized
   */
  private fun handleIntent(intent: Intent?) {
    if (intent == null) {
      android.util.Log.e("MainActivity", "⚠️ [MainActivity] handleIntent: intent is null")
      return
    }

    val screen = intent.getStringExtra("screen")
    val shouldAutoAnswer = intent.getBooleanExtra("shouldAutoAnswer", false)
    android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] handleIntent STARTED - screen=$screen, shouldAutoAnswer=$shouldAutoAnswer")
    android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent extras: ${intent.extras?.keySet()?.joinToString()}")
    
    // Handle shouldAutoAnswer from IncomingCallActivity
    if (shouldAutoAnswer) {
      val callerId = intent.getStringExtra("callerId")
      val callerName = intent.getStringExtra("callerName")
      val callType = intent.getStringExtra("callType")
      
      if (callerId != null) {
        android.util.Log.e("MainActivity", "✅✅✅ [MainActivity] shouldAutoAnswer=true - CALLER FOUND: $callerName ($callerId)")
        android.util.Log.e("MainActivity", "✅✅✅ [MainActivity] Call type: $callType")
        
        // Store call data in SharedPreferences so React Native can read it immediately
        val prefs = getSharedPreferences("CallDataPrefs", android.content.Context.MODE_PRIVATE)
        prefs.edit().apply {
          putString("callerId", callerId)
          putString("callerName", callerName ?: "Unknown")
          putString("callType", callType ?: "audio")
          putBoolean("shouldAutoAnswer", true)
          putBoolean("hasPendingCall", true)
          apply()
        }
        android.util.Log.e("MainActivity", "✅✅✅ [MainActivity] Call data stored in SharedPreferences")
        
        android.util.Log.e("MainActivity", "✅✅✅ [MainActivity] Starting event emission process...")
        
        // Wait for React Native to be ready, then send NavigateToCallScreen and CallAnswered events
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        var attempts = 0
        val maxAttempts = 20
        
        fun trySendEvents() {
          attempts++
          try {
            val reactContext = reactNativeHost.reactInstanceManager.currentReactContext
            reactContext?.let { context ->
              android.util.Log.e("MainActivity", "✅✅✅ [MainActivity] React Native READY! (attempt $attempts)")
              android.util.Log.e("MainActivity", "✅✅✅ [MainActivity] CallerId: $callerId, CallerName: $callerName, CallType: $callType")
              
              // Send NavigateToCallScreen event multiple times with delays to ensure it's caught
              // IMPORTANT: Create a NEW WritableMap for each emit() call (they can't be reused!)
              fun sendNavigateEvent(delay: Long) {
                android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                  android.util.Log.d("MainActivity", "🔥 [MainActivity] Sending NavigateToCallScreen event (delay: ${delay}ms)")
                  try {
                    // Create a NEW map for each emit call - WritableMap can't be reused
                    val navParams = com.facebook.react.bridge.Arguments.createMap().apply {
                      putString("callerId", callerId)
                      putString("callerName", callerName ?: "Unknown")
                      putString("callType", callType ?: "audio")
                      putBoolean("isFromNotification", true)
                      putBoolean("shouldAutoAnswer", true)
                    }
                    context
                      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                      .emit("NavigateToCallScreen", navParams)
                    android.util.Log.d("MainActivity", "✅ [MainActivity] NavigateToCallScreen event sent (delay: ${delay}ms)")
                  } catch (e: Exception) {
                    android.util.Log.e("MainActivity", "❌ [MainActivity] Error emitting NavigateToCallScreen:", e)
                  }
                }, delay)
              }
              
              // Send NavigateToCallScreen at multiple intervals to ensure React Native catches it
              sendNavigateEvent(0)      // Immediate
              sendNavigateEvent(500)    // After 500ms
              sendNavigateEvent(1000)   // After 1 second
              sendNavigateEvent(2000)   // After 2 seconds (backup)
              
            } ?: run {
              if (attempts < maxAttempts) {
                android.util.Log.e("MainActivity", "⏳⏳⏳ [MainActivity] React Native NOT READY, retrying... (attempt $attempts/$maxAttempts)")
                handler.postDelayed({ trySendEvents() }, 500)
              } else {
                android.util.Log.e("MainActivity", "❌❌❌ [MainActivity] FAILED: React Native context not available after $maxAttempts attempts")
              }
            }
          } catch (e: Exception) {
            android.util.Log.e("MainActivity", "❌ [MainActivity] Error sending events", e)
            e.printStackTrace()
          }
        }
        trySendEvents()
        return // Don't process screen intent if we're handling auto-answer
      }
    }
    
    if (screen == "CallScreen") {
      android.util.Log.e("MainActivity", "✅✅✅ [MainActivity] CallScreen intent detected")
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] CallerId: ${intent.getStringExtra("callerId")}")
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] CallerName: ${intent.getStringExtra("callerName")}")
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] ShouldAutoAnswer: ${intent.getBooleanExtra("shouldAutoAnswer", false)}")
      
      // Wait for React Native to be ready, then send event
      val handler = android.os.Handler(android.os.Looper.getMainLooper())
      var attempts = 0
      val maxAttempts = 20
      
      fun trySendEvent() {
        attempts++
        try {
          val reactContext = reactNativeHost.reactInstanceManager.currentReactContext
          reactContext?.let { context ->
            android.util.Log.e("MainActivity", "✅✅✅ [MainActivity] React Native context available, sending event (attempt $attempts)")
            val params = com.facebook.react.bridge.Arguments.createMap().apply {
              putString("screen", "CallScreen")
              putString("callerId", intent.getStringExtra("callerId"))
              putString("callerName", intent.getStringExtra("callerName"))
              putString("callType", intent.getStringExtra("callType"))
              putBoolean("isFromNotification", intent.getBooleanExtra("isFromNotification", false))
              putBoolean("shouldAutoAnswer", intent.getBooleanExtra("shouldAutoAnswer", false))
              putBoolean("shouldDecline", intent.getBooleanExtra("shouldDecline", false))
            }
            context
              .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("NavigateToCallScreen", params)
            android.util.Log.e("MainActivity", "✅✅✅ [MainActivity] NavigateToCallScreen event SENT to React Native")

          } ?: run {
            // React Native not ready yet, try again
            if (attempts < maxAttempts) {
              android.util.Log.e("MainActivity", "⏳⏳⏳ [MainActivity] React Native NOT READY, retrying... (attempt $attempts/$maxAttempts)")
              handler.postDelayed({ trySendEvent() }, 500)
            } else {
              android.util.Log.e("MainActivity", "❌❌❌ [MainActivity] FAILED: React Native context not available after $maxAttempts attempts")
            }
          }
        } catch (e: Exception) {
          android.util.Log.e("MainActivity", "❌ [MainActivity] Error sending navigation event", e)
          e.printStackTrace()
        }
      }
      
      // Start trying immediately - React Native might already be ready
      trySendEvent()
    } else {
      android.util.Log.d("MainActivity", "⚠️ [MainActivity] Not a CallScreen intent, screen=$screen")
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] onCreate CALLED - App starting from ${if (savedInstanceState == null) "KILLED STATE" else "BACKGROUND"}")
    
    // Handle intent immediately - React Native will be ready soon
    if (intent != null) {
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent found in onCreate")
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent screen: ${intent.getStringExtra("screen")}")
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent callerId: ${intent.getStringExtra("callerId")}")
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent shouldAutoAnswer: ${intent.getBooleanExtra("shouldAutoAnswer", false)}")
      
      // Wait a bit for React Native to initialize, then handle intent
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
        handleIntent(intent)
      }, 300)
    } else {
      android.util.Log.d("MainActivity", "⚠️ [MainActivity] No intent found")
    }
  }
}
