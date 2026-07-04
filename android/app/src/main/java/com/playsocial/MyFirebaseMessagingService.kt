package com.playsocial

import android.app.ActivityManager
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
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

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

                    // Tell the caller we actually received the call (we have internet right now).
                    // This request reaching the server is a reliable "callee is reachable/ringing"
                    // signal, so the caller keeps ringing instead of doing a fast offline hang-up.
                    // (Mirrors postAckDelivered used for chat message delivery receipts.)
                    postCallRinging(callerId, currentUserId, data["callId"] ?: "")
                } else {
                    Log.w(TAG, "⚠️ [FCM] No current user ID found - showing incoming call UI anyway (might be first launch)")
                }

                // App already open: socket + CallScreen handle the ring — native IncomingCallActivity + tray
                // duplicates the in-app Answer/Decline and confuses users.
                if (isAppInForeground()) {
                    Log.d(TAG, "📞 [FCM] Foreground — skip native incoming-call UI & ringtone (RN handles call)")
                    return
                }

                // Background / killed: full-screen IncomingCallActivity + ringtone
                launchIncomingCallActivity(callerId, callerName, callType)
            } else if (type == "message" || type == "group_message" || type == "group_added") {
                handleChatPush(data)
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
                Log.d(TAG, "⚠️ [FCM] Not handled FCM type: $type")
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

            // WhatsApp-style Answer / Decline buttons on the heads-up notification.
            //
            // ANSWER: MUST be an Activity PendingIntent (getActivity), NOT a broadcast.
            // Android 12+ blocks notification "trampolines" (a BroadcastReceiver/Service starting an
            // Activity in response to a notification), which would make Answer silently fail in a
            // RELEASE build with the app killed. We launch IncomingCallActivity with the answer
            // fast-path flag: it calls answerCall() immediately (no UI drawn) → MainActivity
            // (shouldAutoAnswer → JS opens CallScreen and auto-answers). Activity→Activity is allowed.
            val answerActionIntent = Intent(this, IncomingCallActivity::class.java).apply {
                action = "com.playsocial.NOTIFICATION_ANSWER"
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                putExtra(IncomingCallActivity.EXTRA_ANSWER_FROM_NOTIFICATION_ACTION, true)
                putExtra("callerId", callerId)
                putExtra("callerName", callerName)
                putExtra("callType", callType)
            }
            val answerActionPending = PendingIntent.getActivity(
                this,
                1003,
                answerActionIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // DECLINE: broadcast is safe — CallActionReceiver only stops the ring + cancels the call,
            // it never starts an Activity, so the trampoline restriction does not apply.
            val declineActionIntent = Intent(this, CallActionReceiver::class.java).apply {
                action = CallActionReceiver.ACTION_DECLINE
                putExtra("callerId", callerId)
                putExtra("callerName", callerName)
                putExtra("callType", callType)
            }
            val declineActionPending = PendingIntent.getBroadcast(
                this,
                1004,
                declineActionIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            // Create notification channel if needed
            createNotificationChannel()
            
            // Build notification with full-screen intent, tap target, and Answer/Decline actions
            val notification = NotificationCompat.Builder(this, "call_notifications")
                .setContentTitle(getString(R.string.call_notification_title))
                .setContentText(getString(R.string.call_notification_text, callerName))
                .setSmallIcon(R.drawable.ic_stat_ic_launcher)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(contentIntent) // Tap notification → IncomingCallActivity (same as full-screen)
                .setFullScreenIntent(fullScreenIntent, true) // Incoming call UI over lock screen
                .setOngoing(true) // Keep notification persistent - activity will dismiss it
                .setAutoCancel(false) // Don't auto-dismiss - let activity handle it
                .addAction(R.drawable.ic_stat_ic_launcher, getString(R.string.notification_action_decline), declineActionPending)
                .addAction(R.drawable.ic_stat_ic_launcher, getString(R.string.notification_action_answer), answerActionPending)
                // Note: No setDefaults() - RingtoneService handles sound/vibration continuously
                .build()
            
            // Show notification (this triggers the full-screen intent)
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.notify(1001, notification)
            Log.d(TAG, "Full-screen notification shown")
            // Do NOT also startActivity(IncomingCallActivity) here — it duplicates the UI:
            // setFullScreenIntent + notify() already surfaces IncomingCallActivity on many devices,
            // and a second launch stacks another native "Answer" screen before MainActivity/React Native.
            
        } catch (e: Exception) {
            Log.e(TAG, "Error launching IncomingCallActivity:", e)
            Log.e(TAG, "Error message: ${e.message}")
            e.printStackTrace()
        }
    }
    
    /**
     * Data-only message FCM (DM) or group chat push: ack delivery, show tray, pass full payload on tap.
     */
    private fun handleChatPush(data: Map<String, String>) {
        val messageId = data["messageId"]?.trim().orEmpty()
        val pushType = data["type"]?.trim().orEmpty()
        val title = data["title"]?.trim().orEmpty().ifEmpty {
            when (pushType) {
                "group_message", "group_added" -> data["groupName"]?.trim().orEmpty().ifEmpty { "PlaySocial" }
                else -> data["senderName"]?.trim().orEmpty().ifEmpty { "PlaySocial" }
            }
        }
        val body = data["body"]?.trim().orEmpty().ifEmpty {
            when (pushType) {
                "group_message" -> "${data["senderName"]?.trim().orEmpty().ifEmpty { "Someone" }}: sent a message"
                "group_added" -> "You were added to the group"
                else -> "sent you a message"
            }
        }
        val conversationId = data["conversationId"]?.trim().orEmpty()

        val prefs = getSharedPreferences("CallDataPrefs", Context.MODE_PRIVATE)
        val recipientUserId = prefs.getString("currentUserId", null)?.trim().orEmpty()

        if (messageId.isNotEmpty() && recipientUserId.isNotEmpty()) {
            postAckDelivered(messageId, recipientUserId)
        } else if (pushType == "message") {
            Log.w(TAG, "⚠️ [FCM] message push: skip ack (messageId or currentUserId missing)")
        }

        createGeneralNotificationChannel()
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val tapIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("fromPush", true)
            for ((key, value) in data) {
                putExtra(key, value)
            }
            if (conversationId.isNotEmpty()) {
                putExtra("conversationId", conversationId)
            }
        }
        val reqCode = (messageId.ifEmpty { conversationId }.hashCode() and 0x7FFF) + 50000
        val contentPending = PendingIntent.getActivity(
            this,
            reqCode,
            tapIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notifId = (messageId.hashCode() and 0x0FFFFFFF) + 0x30000000
        val notification = NotificationCompat.Builder(this, PLAYSOC_GENERAL_CHANNEL)
            .setContentTitle(title)
            .setContentText(body)
            .setSmallIcon(R.drawable.ic_stat_ic_launcher)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(contentPending)
            .build()

        // Foreground: JS onMessage already handles UI; avoid duplicate tray noise.
        if (!isAppInForeground()) {
            notificationManager.notify(notifId, notification)
            Log.d(TAG, "✅ [FCM] Message tray notification posted")
        } else {
            Log.d(TAG, "✅ [FCM] App foreground — tray skipped, ack still sent")
        }
    }

    private fun isAppInForeground(): Boolean {
        val activityManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val appProcesses = activityManager.runningAppProcesses ?: return false
        val pkg = packageName
        for (appProcess in appProcesses) {
            if (appProcess.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND &&
                appProcess.processName == pkg
            ) {
                return true
            }
        }
        return false
    }

    /**
     * Notify the caller (via backend relay) that this device received the incoming-call push
     * and is ringing. Only succeeds when the phone has internet — which is exactly the signal
     * the caller needs to keep ringing (vs. hanging up fast for a truly-offline callee).
     */
    private fun postCallRinging(callerId: String, recipientUserId: String, callId: String) {
        if (callerId.isEmpty() || recipientUserId.isEmpty()) {
            Log.w(TAG, "⚠️ [FCM] call ringing-ack skipped (callerId or recipientUserId missing)")
            return
        }
        Thread {
            var conn: HttpURLConnection? = null
            try {
                val url = URL("$API_URL/api/call/ack-ringing")
                conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                conn.doOutput = true
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                val json = JSONObject().apply {
                    put("callerId", callerId)
                    put("recipientUserId", recipientUserId)
                    put("callId", callId)
                }
                conn.outputStream.use { os: OutputStream ->
                    os.write(json.toString().toByteArray(Charsets.UTF_8))
                }
                val code = conn.responseCode
                if (code !in 200..299) {
                    Log.w(TAG, "ack-ringing HTTP $code")
                } else {
                    Log.d(TAG, "✅ [FCM] ack-ringing ok (caller $callerId)")
                }
            } catch (e: Exception) {
                Log.w(TAG, "ack-ringing failed: ${e.message}")
            } finally {
                conn?.disconnect()
            }
        }.start()
    }

    private fun postAckDelivered(messageId: String, recipientUserId: String) {
        Thread {
            var conn: HttpURLConnection? = null
            try {
                val url = URL("$API_URL/api/message/ack-delivered")
                conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                conn.doOutput = true
                conn.connectTimeout = 15000
                conn.readTimeout = 15000
                val json = JSONObject().apply {
                    put("messageId", messageId)
                    put("recipientUserId", recipientUserId)
                }
                conn.outputStream.use { os: OutputStream ->
                    os.write(json.toString().toByteArray(Charsets.UTF_8))
                }
                val code = conn.responseCode
                if (code !in 200..299) {
                    Log.w(TAG, "ack-delivered HTTP $code")
                } else {
                    Log.d(TAG, "✅ [FCM] ack-delivered ok for $messageId")
                }
            } catch (e: Exception) {
                Log.w(TAG, "ack-delivered failed: ${e.message}")
            } finally {
                conn?.disconnect()
            }
        }.start()
    }

    private fun createGeneralNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(NotificationManager::class.java)
            if (notificationManager.getNotificationChannel(PLAYSOC_GENERAL_CHANNEL) == null) {
                val channel = NotificationChannel(
                    PLAYSOC_GENERAL_CHANNEL,
                    "Messages & activity",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Direct messages and social notifications"
                }
                notificationManager.createNotificationChannel(channel)
            }
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
        /** Must match backend fcmNotifications.js PLAYSOC_GENERAL_CHANNEL */
        private const val PLAYSOC_GENERAL_CHANNEL = "playsocial_general"
        private const val API_URL = "https://media-1-aue5.onrender.com"
    }
}
