package com.playsocial

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Firebase Messaging Service
 * Handles FCM messages when app is in background or killed
 * Launches IncomingCallActivity for call notifications (like thredmobile)
 */
class MyFirebaseMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        // Use Log.e for higher visibility in logs
        Log.e(TAG, "========== FCM MESSAGE RECEIVED ==========")
        Log.e(TAG, "Message received from: ${remoteMessage.from}")
        Log.e(TAG, "Message data: ${remoteMessage.data}")
        Log.e(TAG, "Message notification: ${remoteMessage.notification?.title}")
        Log.e(TAG, "Message ID: ${remoteMessage.messageId}")
        Log.d(TAG, "========== FCM MESSAGE RECEIVED ==========")
        Log.d(TAG, "Message received from: ${remoteMessage.from}")
        Log.d(TAG, "Message data: ${remoteMessage.data}")
        Log.d(TAG, "Message notification: ${remoteMessage.notification?.title}")
        Log.d(TAG, "Message ID: ${remoteMessage.messageId}")

        // Acquire wake lock to ensure device stays awake
        val powerManager = getSystemService(PowerManager::class.java)
        val wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "FCM:IncomingCall"
        )
        wakeLock.acquire(60000) // Hold for 60 seconds

        try {
            // Check if this is a call notification
            val data = remoteMessage.data
            val type = data["type"]

            Log.d(TAG, "🔥 [FCM] Message type: $type")

            if (type == "incoming_call") {
                Log.d(TAG, "📞 [FCM] Incoming call notification received")
                
                val callerId = data["callerId"] ?: ""
                val callerName = data["callerName"] ?: "Unknown"
                val callType = data["callType"] ?: "video"
                
                // CRITICAL: Check if this call is for the current user (not an echo)
                // Get current user ID from SharedPreferences
                val prefs = getSharedPreferences("CallDataPrefs", Context.MODE_PRIVATE)
                val currentUserId = prefs.getString("currentUserId", null)
                
                Log.e(TAG, "📞 [FCM] Caller: $callerName ($callerId)")
                Log.e(TAG, "📞 [FCM] Call Type: $callType")
                Log.e(TAG, "📞 [FCM] Current User ID: $currentUserId")
                
                // CRITICAL: Only show incoming call UI if:
                // 1. We have current user ID
                // 2. Current user ID does NOT match caller ID (we're not calling ourselves)
                // This prevents showing incoming call UI for echo signals or when we're the caller
                if (currentUserId != null) {
                    if (currentUserId == callerId) {
                        Log.e(TAG, "⚠️ [FCM] IGNORING incoming call - caller ID matches current user (we are the caller, not the receiver)")
                        Log.e(TAG, "⚠️ [FCM] This is an echo or wrong notification - caller should not see incoming call UI")
                        // Dismiss any existing notification for this call
                        try {
                            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                            notificationManager.cancel(1001)
                            Log.e(TAG, "✅ [FCM] Dismissed notification for echo/wrong call")
                        } catch (e: Exception) {
                            Log.w(TAG, "⚠️ [FCM] Error dismissing notification: ${e.message}")
                        }
                        return // Don't show incoming call UI for our own calls
                    }
                    Log.e(TAG, "✅ [FCM] Valid incoming call - current user ($currentUserId) is the receiver, caller is ($callerId)")
                } else {
                    Log.w(TAG, "⚠️ [FCM] No current user ID found - showing incoming call UI anyway (might be first launch)")
                }

                // Launch IncomingCallActivity (full-screen UI + ringtone) - like thredmobile
                launchIncomingCallActivity(callerId, callerName, callType)
            } else if (type == "call_ended") {
                Log.d(TAG, "🔕 [FCM] Call ended notification received")
                Log.e(TAG, "🔕 [FCM] Stopping ringtone and closing incoming call UI")
                
                // Stop ringtone service
                RingtoneService.stopRingtone(this)
                
                // Close IncomingCallActivity if it's open (app killed or background)
                // Send broadcast that IncomingCallActivity listens for
                try {
                    sendBroadcast(Intent("com.playsocial.CLOSE_INCOMING_CALL").apply {
                        putExtra("action", "close")
                    })
                    Log.d(TAG, "🔕 [FCM] Broadcast sent to close IncomingCallActivity")
                } catch (e: Exception) {
                    Log.w(TAG, "🔕 [FCM] Error sending close broadcast:", e)
                }
                
                // Dismiss notification
                try {
                    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    notificationManager.cancel(1001) // Same ID as incoming call notification
                    Log.d(TAG, "🔕 [FCM] Notification dismissed")
                } catch (e: Exception) {
                    Log.w(TAG, "🔕 [FCM] Error dismissing notification:", e)
                }
            } else {
                Log.d(TAG, "⚠️ [FCM] Not a call notification, type: $type")
            }
        } finally {
            // Release wake lock after a delay
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                if (wakeLock.isHeld) {
                    wakeLock.release()
                    Log.d(TAG, "✅ [FCM] Wake lock released")
                }
            }, 5000)
        }
    }

    /**
     * Launch IncomingCallActivity with call details
     * Uses full-screen intent notification to ensure UI shows even when app is killed
     */
    private fun launchIncomingCallActivity(callerId: String, callerName: String, callType: String) {
        try {
            Log.e(TAG, "========== LAUNCHING ACTIVITY ==========")
            Log.e(TAG, "Caller: $callerName ($callerId)")
            Log.e(TAG, "Call Type: $callType")
            Log.d(TAG, "========== LAUNCHING ACTIVITY ==========")
            Log.d(TAG, "Caller: $callerName ($callerId)")
            Log.d(TAG, "Call Type: $callType")
            
            // Start ringtone service immediately as foreground service (works even when app is killed)
            // This plays continuous call ringtone, not just one notification sound
            Log.d(TAG, "Starting RingtoneService as foreground...")
            RingtoneService.startRingtoneForeground(this)
            Log.d(TAG, "RingtoneService started (foreground)")
            
            // Create intent for IncomingCallActivity
            val activityIntent = Intent(this, IncomingCallActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or 
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("callerId", callerId)
                putExtra("callerName", callerName)
                putExtra("callType", callType)
            }
            
            // Create full-screen intent (shows over lock screen when notification arrives)
            // Use request code 1001 for full-screen intent
            val fullScreenIntent = PendingIntent.getActivity(
                this,
                1001,
                activityIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            
            // Create content intent (when user taps notification in drawer)
            // Use request code 1002 for content intent (different from full-screen)
            val contentIntent = PendingIntent.getActivity(
                this,
                1002,
                activityIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Answer: open IncomingCallActivity first (call UI in manifest: showWhenLocked, turnScreenOn).
            // Many OEMs block or drop starting MainActivity directly from a notification action; this path
            // matches the full-screen intent target, then immediately forwards to MainActivity inside answerCall().
            val reqBase = 3100 + (callerId.hashCode() and 0x7FFF)
            val answerActivityIntent = Intent(this, IncomingCallActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra("callerId", callerId)
                putExtra("callerName", callerName)
                putExtra("callType", callType)
                putExtra("answerFromNotificationAction", true)
            }
            val answerActionPending = PendingIntent.getActivity(
                this,
                reqBase,
                answerActivityIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            val declineIntent = Intent(this, CallActionReceiver::class.java).apply {
                action = CallActionReceiver.ACTION_DECLINE
                putExtra("callerId", callerId)
                putExtra("callerName", callerName)
                putExtra("callType", callType)
            }
            val declineActionPending = PendingIntent.getBroadcast(
                this,
                reqBase + 1,
                declineIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            
            // Create notification channel if needed
            createNotificationChannel()
            
            // Build notification with full-screen intent, tap target, and Answer/Decline actions
            val notification = NotificationCompat.Builder(this, "call_notifications")
                .setContentTitle("Incoming Call")
                .setContentText("$callerName is calling...")
                .setSmallIcon(R.drawable.ic_stat_ic_launcher)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(contentIntent) // Handle tap on notification - opens IncomingCallActivity
                .setFullScreenIntent(fullScreenIntent, true) // This shows IncomingCallActivity over lock screen
                .addAction(
                    R.drawable.ic_stat_ic_launcher,
                    getString(R.string.notification_action_decline),
                    declineActionPending
                )
                .addAction(
                    R.drawable.ic_stat_ic_launcher,
                    getString(R.string.notification_action_answer),
                    answerActionPending
                )
                .setOngoing(true) // Keep notification persistent - activity will dismiss it
                .setAutoCancel(false) // Don't auto-dismiss - let activity handle it
                // Note: No setDefaults() - RingtoneService handles sound/vibration continuously
                .build()
            
            // Show notification (this triggers the full-screen intent)
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.notify(1001, notification)
            Log.d(TAG, "Full-screen notification shown")
            
            // Also try to launch activity directly (backup) - use Handler to ensure UI thread
            try {
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    try {
                        Log.e(TAG, "========== ATTEMPTING DIRECT ACTIVITY LAUNCH ==========")
                        Log.e(TAG, "Intent: $activityIntent")
                        Log.e(TAG, "Intent extras: callerId=$callerId, callerName=$callerName, callType=$callType")
                        Log.e(TAG, "Intent flags: ${activityIntent.flags}")
                        startActivity(activityIntent)
                        Log.e(TAG, "✅ Direct activity launch SUCCEEDED")
                        Log.d(TAG, "Activity also launched directly")
                    } catch (e: Exception) {
                        Log.e(TAG, "❌ Direct activity launch FAILED:", e)
                        Log.e(TAG, "Error message: ${e.message}")
                        Log.e(TAG, "Error stack:", e)
                        e.printStackTrace()
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "❌ Handler post failed:", e)
                Log.e(TAG, "Error message: ${e.message}")
            }
            
        } catch (e: Exception) {
            Log.e(TAG, "Error launching IncomingCallActivity:", e)
            Log.e(TAG, "Error message: ${e.message}")
            e.printStackTrace()
        }
    }
    
    /**
     * Create notification channel for call notifications
     */
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(NotificationManager::class.java)
            val existing = notificationManager.getNotificationChannel("call_notifications")
            // Keep call channel silent. We play ringtone/vibration via RingtoneService only.
            // If an old channel has sound enabled, delete and recreate to apply silent behavior.
            if (existing != null && existing.sound != null) {
                notificationManager.deleteNotificationChannel("call_notifications")
                Log.w(TAG, "Recreating call_notifications channel as silent (old channel had sound)")
            }

            val channel = NotificationChannel(
                "call_notifications",
                "Call Notifications",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Incoming call notifications"
                enableVibration(false)
                enableLights(true)
                // Critical for full-screen intents to work
                setBypassDnd(true) // Bypass Do Not Disturb
                setSound(null, null) // silent channel (RingtoneService handles audio)
            }
            
            notificationManager.createNotificationChannel(channel)
            Log.d(TAG, "Notification channel created")
        }
    }

    override fun onNewToken(token: String) {
        Log.d(TAG, "🔥 [FCM] New token: $token")
        // Token refresh is handled in React Native
    }

    companion object {
        private const val TAG = "MyFirebaseMessaging"
    }
}
