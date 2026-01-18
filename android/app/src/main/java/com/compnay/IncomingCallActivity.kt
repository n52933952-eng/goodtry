package com.compnay

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import android.graphics.Color

/**
 * Full-screen incoming call Activity (like WhatsApp)
 * Shows when user receives a call notification
 */
class IncomingCallActivity : Activity() {

    private var ringtone: Ringtone? = null
    private val handler = Handler(Looper.getMainLooper())
    private var callerId: String? = null
    private var callerName: String? = null
    private var callType: String? = null
    private var answerButton: Button? = null
    private var declineButton: Button? = null
    private var statusText: TextView? = null
    
    // Broadcast receiver to listen for call_ended events
    private val callEndedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action == "com.compnay.CLOSE_INCOMING_CALL") {
                android.util.Log.d("IncomingCallActivity", "🔕 [IncomingCallActivity] Received call_ended broadcast - closing")
                // Stop ringtone and close activity
                RingtoneService.stopRingtone(this@IncomingCallActivity)
                stopRingtone()
                finish()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        android.util.Log.e("IncomingCallActivity", "========== [IncomingCallActivity] onCreate CALLED ==========")
        android.util.Log.e("IncomingCallActivity", "========== ACTIVITY IS OPENING! ==========")
        android.util.Log.e("IncomingCallActivity", "Intent: $intent")
        android.util.Log.e("IncomingCallActivity", "Intent action: ${intent?.action}")
        android.util.Log.e("IncomingCallActivity", "Intent extras: ${intent?.extras}")
        android.util.Log.e("IncomingCallActivity", "Caller: ${intent.getStringExtra("callerName")}")

        // Get call data from intent
        callerId = intent.getStringExtra("callerId")
        callerName = intent.getStringExtra("callerName") ?: "Unknown"
        callType = intent.getStringExtra("callType") ?: "video"

        android.util.Log.e("IncomingCallActivity", "Caller ID: $callerId")
        android.util.Log.e("IncomingCallActivity", "Caller Name: $callerName")
        android.util.Log.e("IncomingCallActivity", "Call Type: $callType")

        // Make activity full-screen and wake up screen
        // These flags ensure it shows over lock screen
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_FULLSCREEN or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )
        
        android.util.Log.d("IncomingCallActivity", "Window flags set")

        // Set volume to max for ringtone
        val audioManager = getSystemService(AUDIO_SERVICE) as AudioManager
        audioManager.setStreamVolume(
            AudioManager.STREAM_RING,
            audioManager.getStreamMaxVolume(AudioManager.STREAM_RING),
            0
        )

        // Create simple UI
        android.util.Log.d("IncomingCallActivity", "Creating UI...")
        setContentView(createCallUI())
        android.util.Log.d("IncomingCallActivity", "UI created and set")

        // Start ringtone
        android.util.Log.d("IncomingCallActivity", "Starting ringtone...")
        startRingtone()
        android.util.Log.d("IncomingCallActivity", "Ringtone started")

        // Auto-dismiss after 60 seconds if not answered
        handler.postDelayed({
            if (!isFinishing) {
                android.util.Log.d("IncomingCallActivity", "60 second timeout - declining call")
                declineCall()
            }
        }, 60000)
        
        // Register broadcast receiver to listen for call_ended events
        // Wrap in try-catch to handle SecurityException when app is killed/restarting
        try {
            registerReceiver(callEndedReceiver, IntentFilter("com.compnay.CLOSE_INCOMING_CALL"))
            android.util.Log.d("IncomingCallActivity", "Broadcast receiver registered for call_ended")
        } catch (e: SecurityException) {
            android.util.Log.e("IncomingCallActivity", "Failed to register broadcast receiver: ${e.message}")
            // Continue anyway - we'll still be able to handle call_ended via other means
        } catch (e: Exception) {
            android.util.Log.e("IncomingCallActivity", "Error registering broadcast receiver: ${e.message}")
        }
    }

    private fun createCallUI(): View {
        // Create root layout
        val rootLayout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1a1a1a"))
            gravity = android.view.Gravity.CENTER
            setPadding(40, 80, 40, 80)
        }

        // Caller name
        val nameText = TextView(this).apply {
            text = callerName
            textSize = 28f
            setTextColor(Color.WHITE)
            gravity = android.view.Gravity.CENTER
            setPadding(0, 20, 0, 10)
        }
        rootLayout.addView(nameText)

        // Call type text
        val callTypeText = TextView(this).apply {
            text = if (callType == "video") "Incoming Video Call" else "Incoming Voice Call"
            textSize = 16f
            setTextColor(Color.parseColor("#8B98A5"))
            gravity = android.view.Gravity.CENTER
            setPadding(0, 10, 0, 60)
        }
        rootLayout.addView(callTypeText)

        // Button container
        val buttonContainer = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.HORIZONTAL
            gravity = android.view.Gravity.CENTER
            setPadding(0, 40, 0, 0)
        }

        // Status text (for showing "Connecting..." etc.)
        statusText = TextView(this).apply {
            text = ""
            textSize = 14f
            setTextColor(Color.parseColor("#8B98A5"))
            gravity = android.view.Gravity.CENTER
            setPadding(0, 20, 0, 0)
            visibility = View.GONE
        }
        rootLayout.addView(statusText)

        // Decline button
        declineButton = Button(this).apply {
            text = "Decline"
            setBackgroundColor(Color.parseColor("#F4212E"))
            setTextColor(Color.WHITE)
            textSize = 16f
            setPadding(40, 20, 40, 20)
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                marginEnd = 30
            }
            setOnClickListener { declineCall() }
        }
        buttonContainer.addView(declineButton)

        // Answer button
        answerButton = Button(this).apply {
            text = "Answer"
            setBackgroundColor(Color.parseColor("#00BA7C"))
            setTextColor(Color.WHITE)
            textSize = 16f
            setPadding(40, 20, 40, 20)
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT
            )
            setOnClickListener { answerCall() }
        }
        buttonContainer.addView(answerButton)

        rootLayout.addView(buttonContainer)

        return rootLayout
    }

    private fun startRingtone() {
        try {
            // Start native ringtone service (plays in background)
            RingtoneService.startRingtone(this)
            
            // Also play local ringtone as backup
            val soundUri: Uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            ringtone = RingtoneManager.getRingtone(applicationContext, soundUri)
            ringtone?.isLooping = true
            ringtone?.play()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun stopRingtone() {
        ringtone?.stop()
        ringtone = null
    }

    private fun answerCall() {
        android.util.Log.e("IncomingCallActivity", "========== ANSWER BUTTON PRESSED ==========")
        android.util.Log.e("IncomingCallActivity", "CallerId: $callerId, CallerName: $callerName, CallType: $callType")
        
        // STOP RINGTONE
        RingtoneService.stopRingtone(this)
        stopRingtone()
        
        // Launch MainActivity with call data - app will open and handle the call
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra("shouldAutoAnswer", true)
            putExtra("callerId", callerId)
            putExtra("callerName", callerName)
            putExtra("callType", callType)
            putExtra("isFromNotification", true)
        }
        
        android.util.Log.e("IncomingCallActivity", "Launching MainActivity with shouldAutoAnswer=true")
        android.util.Log.e("IncomingCallActivity", "Intent extras: callerId=$callerId, callerName=$callerName")
        startActivity(intent)
        android.util.Log.e("IncomingCallActivity", "MainActivity.startActivity() called")
        finish() // Close native UI - app will handle the call
        android.util.Log.e("IncomingCallActivity", "finish() called - activity closing")
    }
    

    private fun declineCall() {
        // STOP RINGTONE (native service)
        RingtoneService.stopRingtone(this)
        stopRingtone() // Also stop local ringtone if any
        
        // Just finish - no need to open app for decline
        finish()
    }

    override fun onDestroy() {
        android.util.Log.d("IncomingCallActivity", "onDestroy called")
        // Unregister broadcast receiver
        try {
            unregisterReceiver(callEndedReceiver)
        } catch (e: Exception) {
            // Receiver might not be registered
        }
        // Stop both native service ringtone and local ringtone
        RingtoneService.stopRingtone(this)
        stopRingtone()
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
    
    override fun onBackPressed() {
        // Prevent back button from closing during call
        android.util.Log.d("IncomingCallActivity", "Back button pressed - ignoring during call")
        // Don't call super - prevent closing
    }
}
