package com.compnay

import android.content.Intent
import android.content.SharedPreferences
import android.content.BroadcastReceiver
import android.content.Context
import android.content.IntentFilter
import android.content.Context.RECEIVER_EXPORTED
import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.bridge.WritableMap

class MainActivity : ReactActivity() {
  
  // BroadcastReceiver to listen for pending cancel check trigger
  private val pendingCancelReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == "com.compnay.CHECK_PENDING_CANCEL") {
        android.util.Log.e("MainActivity", "📡 [MainActivity] Received CHECK_PENDING_CANCEL broadcast - triggering check")
        // Emit event to React Native to check SharedPreferences
        emitCheckPendingCancelEvent()
      }
    }
  }

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
    android.util.Log.e("MainActivity", "========== [MainActivity] onNewIntent CALLED ==========")
    android.util.Log.e("MainActivity", "========== ACTIVITY ALREADY RUNNING - RECEIVED NEW INTENT ==========")
    android.util.Log.e("MainActivity", "Intent action: ${intent.action}")
    android.util.Log.e("MainActivity", "Intent shouldAutoAnswer: ${intent.getBooleanExtra("shouldAutoAnswer", false)}")
    android.util.Log.e("MainActivity", "Intent shouldCancelCall: ${intent.getBooleanExtra("shouldCancelCall", false)}")
    android.util.Log.e("MainActivity", "Intent callerId: ${intent.getStringExtra("callerId")}")
    android.util.Log.e("MainActivity", "Intent callerName: ${intent.getStringExtra("callerName")}")
    android.util.Log.e("MainActivity", "Intent callType: ${intent.getStringExtra("callType")}")
    setIntent(intent)
    
    // CRITICAL: If shouldCancelCall is true, handle it immediately and DON'T navigate
    // This prevents the app from navigating to home screen
    val shouldCancelCall = intent.getBooleanExtra("shouldCancelCall", false)
    if (shouldCancelCall) {
      android.util.Log.e("MainActivity", "📴📴📴 [MainActivity] shouldCancelCall detected in onNewIntent - handling immediately")
      handleIntent(intent)
      // Don't call super or do anything else - just handle the cancel and stay on current screen
      return
    }
    
    // Handle immediately if activity is already running (no delay needed)
    android.util.Log.e("MainActivity", "========== [MainActivity] Calling handleIntent from onNewIntent ==========")
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
    val shouldCancelCall = intent.getBooleanExtra("shouldCancelCall", false)
    android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] handleIntent STARTED - screen=$screen, shouldAutoAnswer=$shouldAutoAnswer, shouldCancelCall=$shouldCancelCall")
    android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent extras: ${intent.extras?.keySet()?.joinToString()}")
    
    // Handle shouldCancelCall from IncomingCallActivity (Decline button)
    if (shouldCancelCall) {
      val callerId = intent.getStringExtra("callerId")
      if (callerId != null) {
        android.util.Log.e("MainActivity", "📴📴📴 [MainActivity] shouldCancelCall=true - CALLER TO CANCEL: $callerId")
        
        // Store cancel data in SharedPreferences so React Native can read it
        val prefs = getSharedPreferences("CallDataPrefs", android.content.Context.MODE_PRIVATE)
        prefs.edit().apply {
          putString("callerIdToCancel", callerId)
          putBoolean("shouldCancelCall", true)
          putBoolean("hasPendingCancel", true)
          apply()
        }
        android.util.Log.e("MainActivity", "📴📴📴 [MainActivity] Cancel data stored in SharedPreferences")
        
        // Emit CancelCallFromNotification event to React Native
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        var attempts = 0
        val maxAttempts = 10
        
        fun trySendCancelEvent() {
          attempts++
          try {
            val reactContext = reactNativeHost.reactInstanceManager.currentReactContext
            reactContext?.let { context ->
              android.util.Log.e("MainActivity", "📴📴📴 [MainActivity] React Native READY! Emitting CancelCallFromNotification (attempt $attempts)")
              val cancelParams = com.facebook.react.bridge.Arguments.createMap().apply {
                putString("callerId", callerId)
              }
              context
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("CancelCallFromNotification", cancelParams)
              android.util.Log.e("MainActivity", "📴📴📴 [MainActivity] CancelCallFromNotification event sent")
            } ?: run {
              if (attempts < maxAttempts) {
                android.util.Log.e("MainActivity", "⏳ [MainActivity] React Native NOT READY, retrying cancel event... (attempt $attempts/$maxAttempts)")
                handler.postDelayed({ trySendCancelEvent() }, 500)
              } else {
                android.util.Log.e("MainActivity", "❌ [MainActivity] FAILED: React Native context not available after $maxAttempts attempts")
              }
            }
          } catch (e: Exception) {
            android.util.Log.e("MainActivity", "❌ [MainActivity] Error sending cancel event", e)
            e.printStackTrace()
          }
        }
        trySendCancelEvent()
        return // Don't process other intents if we're handling cancel
      }
    }
    
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
              // Send more frequently and for longer to ensure listener is set up
              sendNavigateEvent(0)      // Immediate
              sendNavigateEvent(500)    // After 500ms
              sendNavigateEvent(1000)   // After 1 second
              sendNavigateEvent(1500)   // After 1.5 seconds
              sendNavigateEvent(2000)   // After 2 seconds
              sendNavigateEvent(3000)   // After 3 seconds (backup)
              sendNavigateEvent(4000)   // After 4 seconds (backup)
              sendNavigateEvent(5000)   // After 5 seconds (backup)
              
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
    val isKilledState = savedInstanceState == null
    android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] onCreate CALLED - App starting from ${if (isKilledState) "KILLED STATE" else "BACKGROUND"}")
    
    // CRITICAL: If app was killed, check SharedPreferences immediately for pending cancel
    if (isKilledState) {
      android.util.Log.e("MainActivity", "📴 [MainActivity] App started from KILLED STATE - checking SharedPreferences for pending cancel...")
      val prefs = getSharedPreferences("CallDataPrefs", android.content.Context.MODE_PRIVATE)
      val hasPendingCancel = prefs.getBoolean("hasPendingCancel", false) || prefs.getBoolean("shouldCancelCall", false)
      val callerIdToCancel = prefs.getString("callerIdToCancel", null)
      android.util.Log.e("MainActivity", "📴 [MainActivity] Pending cancel check: hasPendingCancel=$hasPendingCancel, callerIdToCancel=$callerIdToCancel")
      
      if (hasPendingCancel && callerIdToCancel != null) {
        android.util.Log.e("MainActivity", "📴 [MainActivity] PENDING CANCEL FOUND! Will trigger CheckPendingCancel event when React Native is ready")
        // Store flag to trigger event when React Native is ready
        // We'll check this in onResume or when React Native is ready
      }
    }
    
    // Register BroadcastReceiver to listen for pending cancel check trigger
    try {
      val filter = IntentFilter("com.compnay.CHECK_PENDING_CANCEL")
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        registerReceiver(pendingCancelReceiver, filter, RECEIVER_EXPORTED)
      } else {
        @Suppress("DEPRECATION")
        registerReceiver(pendingCancelReceiver, filter)
      }
      android.util.Log.e("MainActivity", "✅ [MainActivity] Registered CHECK_PENDING_CANCEL receiver")
    } catch (e: Exception) {
      android.util.Log.e("MainActivity", "❌ [MainActivity] Failed to register CHECK_PENDING_CANCEL receiver: ${e.message}")
    }
    
    // Handle intent immediately - React Native will be ready soon
    if (intent != null) {
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent found in onCreate")
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent screen: ${intent.getStringExtra("screen")}")
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent callerId: ${intent.getStringExtra("callerId")}")
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent shouldAutoAnswer: ${intent.getBooleanExtra("shouldAutoAnswer", false)}")
      android.util.Log.e("MainActivity", "🔥🔥🔥 [MainActivity] Intent shouldCancelCall: ${intent.getBooleanExtra("shouldCancelCall", false)}")
      
      // CRITICAL: If shouldCancelCall is true, handle it immediately
      // This prevents default navigation to home screen
      val shouldCancelCall = intent.getBooleanExtra("shouldCancelCall", false)
      if (shouldCancelCall) {
        android.util.Log.e("MainActivity", "📴📴📴 [MainActivity] shouldCancelCall detected in onCreate - will handle after React Native ready")
        // Wait for React Native to be ready, then handle cancel (no navigation)
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
          handleIntent(intent)
        }, 300)
      } else {
        // Wait a bit for React Native to initialize, then handle intent
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
          handleIntent(intent)
        }, 300)
      }
    } else {
      android.util.Log.d("MainActivity", "⚠️ [MainActivity] No intent found")
    }
  }

  override fun onResume() {
    super.onResume()
    android.util.Log.e("MainActivity", "📱 [MainActivity] onResume CALLED")
    
    val prefs = getSharedPreferences("CallDataPrefs", android.content.Context.MODE_PRIVATE)
    
    // CRITICAL: Check for pending cancel FIRST (before checking for pending call)
    val hasPendingCancel = prefs.getBoolean("hasPendingCancel", false) || prefs.getBoolean("shouldCancelCall", false)
    val callerIdToCancel = prefs.getString("callerIdToCancel", null)
    
    if (hasPendingCancel && callerIdToCancel != null) {
      android.util.Log.e("MainActivity", "📴 [MainActivity] onResume - PENDING CANCEL FOUND! Triggering CheckPendingCancel event")
      android.util.Log.e("MainActivity", "📴 [MainActivity] Caller ID to cancel: $callerIdToCancel")
      // Trigger CheckPendingCancel event to React Native
      emitCheckPendingCancelEvent()
    }
    
    // Check SharedPreferences for pending call data (backup for when intent doesn't reach onNewIntent)
    val hasPendingCall = prefs.getBoolean("hasPendingCall", false)
    
    if (hasPendingCall) {
      val callerId = prefs.getString("callerId", null)
      val callerName = prefs.getString("callerName", null)
      val callType = prefs.getString("callType", "audio")
      val shouldAutoAnswer = prefs.getBoolean("shouldAutoAnswer", false)
      
      android.util.Log.e("MainActivity", "📱📱📱 [MainActivity] onResume - Found pending call in SharedPreferences!")
      android.util.Log.e("MainActivity", "📱📱📱 [MainActivity] Caller: $callerName ($callerId), shouldAutoAnswer: $shouldAutoAnswer")
      
      if (callerId != null && shouldAutoAnswer) {
        // Create intent from SharedPreferences data and handle it
        val intentFromPrefs = Intent().apply {
          putExtra("shouldAutoAnswer", true)
          putExtra("callerId", callerId)
          putExtra("callerName", callerName)
          putExtra("callType", callType)
          putExtra("isFromNotification", true)
        }
        
        // Clear SharedPreferences after reading
        prefs.edit().remove("hasPendingCall").apply()
        
        // Handle the intent
        android.util.Log.e("MainActivity", "📱📱📱 [MainActivity] Handling intent from SharedPreferences...")
        handleIntent(intentFromPrefs)
      }
    }
  }
  
  override fun onDestroy() {
    super.onDestroy()
    try {
      unregisterReceiver(pendingCancelReceiver)
      android.util.Log.e("MainActivity", "✅ [MainActivity] Unregistered CHECK_PENDING_CANCEL receiver")
    } catch (e: Exception) {
      // Receiver might not be registered
      android.util.Log.e("MainActivity", "⚠️ [MainActivity] Error unregistering receiver: ${e.message}")
    }
  }
  
  /**
   * Emit event to React Native to trigger pending cancel check
   */
  private fun emitCheckPendingCancelEvent() {
    android.util.Log.e("MainActivity", "📡 [MainActivity] Emitting CheckPendingCancel event to React Native")
    
    val handler = android.os.Handler(android.os.Looper.getMainLooper())
    var attempts = 0
    val maxAttempts = 10
    
    fun trySendEvent() {
      attempts++
      try {
        val reactContext = reactNativeHost.reactInstanceManager.currentReactContext
        reactContext?.let { context ->
          android.util.Log.e("MainActivity", "✅ [MainActivity] React Native READY! Emitting CheckPendingCancel (attempt $attempts)")
          context
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("CheckPendingCancel", null)
          android.util.Log.e("MainActivity", "✅ [MainActivity] CheckPendingCancel event emitted successfully")
        } ?: run {
          if (attempts < maxAttempts) {
            android.util.Log.e("MainActivity", "⏳ [MainActivity] React Native not ready yet, retrying in 200ms (attempt $attempts/$maxAttempts)")
            handler.postDelayed({ trySendEvent() }, 200)
          } else {
            android.util.Log.e("MainActivity", "❌ [MainActivity] React Native not ready after $maxAttempts attempts")
          }
        }
      } catch (e: Exception) {
        android.util.Log.e("MainActivity", "❌ [MainActivity] Error sending CheckPendingCancel event", e)
        e.printStackTrace()
      }
    }
    
    // Start trying immediately
    trySendEvent()
  }
}
