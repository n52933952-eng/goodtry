package com.compnay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService

/**
 * BroadcastReceiver to handle OneSignal notification action button clicks
 * Similar to CallActionReceiver but for OneSignal notifications (likes, comments, follows, etc.)
 */
class OneSignalActionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "OneSignalActionReceiver"
        const val ACTION_VIEW_POST = "com.compnay.ONESIGNAL_VIEW_POST"
        const val ACTION_VIEW_PROFILE = "com.compnay.ONESIGNAL_VIEW_PROFILE"
        const val ACTION_MARK_READ = "com.compnay.ONESIGNAL_MARK_READ"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        val notificationData = intent.getStringExtra("notificationData")
        val postId = intent.getStringExtra("postId")
        val userId = intent.getStringExtra("userId")
        val notificationType = intent.getStringExtra("notificationType")
        
        Log.e(TAG, "========== [OneSignalActionReceiver] onReceive CALLED ==========")
        Log.e(TAG, "Action: $action")
        Log.e(TAG, "Notification Type: $notificationType")
        Log.e(TAG, "Post ID: $postId")
        Log.e(TAG, "User ID: $userId")

        // Store action data in SharedPreferences so React Native can read it
        try {
            val prefs = context.getSharedPreferences("OneSignalActionPrefs", Context.MODE_PRIVATE)
            prefs.edit().apply {
                putString("action", action)
                putString("notificationType", notificationType)
                putString("postId", postId)
                putString("userId", userId)
                putString("notificationData", notificationData)
                putLong("actionTimestamp", System.currentTimeMillis())
                apply()
            }
            Log.e(TAG, "✅ [OneSignalActionReceiver] Action data stored in SharedPreferences")
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error storing action data: ${e.message}")
        }

        when (action) {
            ACTION_VIEW_POST -> {
                Log.e(TAG, "✅✅✅ [OneSignalActionReceiver] View Post button pressed!")
                
                // Launch MainActivity and navigate to post
                try {
                    val mainIntent = Intent(context, MainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or 
                                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP
                        putExtra("onesignalAction", "view_post")
                        putExtra("postId", postId)
                        putExtra("notificationType", notificationType)
                        putExtra("notificationData", notificationData)
                    }
                    Log.e(TAG, "✅✅✅ [OneSignalActionReceiver] Launching MainActivity for View Post")
                    context.startActivity(mainIntent)
                } catch (e: Exception) {
                    Log.e(TAG, "❌❌❌ [OneSignalActionReceiver] ERROR launching MainActivity: ${e.message}")
                    e.printStackTrace()
                }
            }
            
            ACTION_VIEW_PROFILE -> {
                Log.e(TAG, "✅✅✅ [OneSignalActionReceiver] View Profile button pressed!")
                
                // Launch MainActivity and navigate to profile
                try {
                    val mainIntent = Intent(context, MainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or 
                                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP
                        putExtra("onesignalAction", "view_profile")
                        putExtra("userId", userId)
                        putExtra("notificationType", notificationType)
                        putExtra("notificationData", notificationData)
                    }
                    Log.e(TAG, "✅✅✅ [OneSignalActionReceiver] Launching MainActivity for View Profile")
                    context.startActivity(mainIntent)
                } catch (e: Exception) {
                    Log.e(TAG, "❌❌❌ [OneSignalActionReceiver] ERROR launching MainActivity: ${e.message}")
                    e.printStackTrace()
                }
            }
            
            ACTION_MARK_READ -> {
                Log.e(TAG, "✅✅✅ [OneSignalActionReceiver] Mark as Read button pressed!")
                
                // Store mark as read action - React Native will handle API call
                try {
                    val mainIntent = Intent(context, MainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or 
                                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP
                        putExtra("onesignalAction", "mark_read")
                        putExtra("notificationType", notificationType)
                        putExtra("notificationData", notificationData)
                    }
                    Log.e(TAG, "✅✅✅ [OneSignalActionReceiver] Launching MainActivity for Mark as Read")
                    context.startActivity(mainIntent)
                } catch (e: Exception) {
                    Log.e(TAG, "❌❌❌ [OneSignalActionReceiver] ERROR launching MainActivity: ${e.message}")
                    e.printStackTrace()
                }
            }
        }
        
        // Dismiss notification after action
        try {
            val notificationId = intent.getIntExtra("notificationId", -1)
            if (notificationId != -1) {
                val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                notificationManager.cancel(notificationId)
                Log.d(TAG, "✅ Notification dismissed (ID: $notificationId)")
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error dismissing notification: ${e.message}")
        }
    }
}
