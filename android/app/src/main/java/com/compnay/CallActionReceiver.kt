package com.compnay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import java.io.OutputStream
import org.json.JSONObject

/**
 * BroadcastReceiver to handle Answer/Decline actions from notification buttons
 */
class CallActionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "CallActionReceiver"
        const val ACTION_ANSWER = "com.compnay.NOTIFICATION_ANSWER"
        const val ACTION_DECLINE = "com.compnay.NOTIFICATION_DECLINE"
        private const val API_URL = "https://media-1-aue5.onrender.com"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        val callerId = intent.getStringExtra("callerId")
        val callerName = intent.getStringExtra("callerName")
        val callType = intent.getStringExtra("callType")
        
        Log.e(TAG, "========== [CallActionReceiver] onReceive CALLED ==========")
        Log.e(TAG, "Action: $action")
        Log.e(TAG, "Caller: $callerName ($callerId)")
        Log.e(TAG, "Call Type: $callType")

        when (action) {
            ACTION_ANSWER -> {
                Log.e(TAG, "✅✅✅ [CallActionReceiver] Answer button pressed!")
                
                // Stop ringtone immediately
                try {
                    RingtoneService.stopRingtone(context)
                    Log.d(TAG, "✅ Ringtone stopped")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Error stopping ringtone: ${e.message}")
                }
                
                // Store call data in SharedPreferences first (same as MainActivity does)
                try {
                    val prefs = context.getSharedPreferences("CallDataPrefs", Context.MODE_PRIVATE)
                    prefs.edit().apply {
                        putString("callerId", callerId)
                        putString("callerName", callerName ?: "Unknown")
                        putString("callType", callType ?: "audio")
                        putBoolean("shouldAutoAnswer", true)
                        putBoolean("hasPendingCall", true)
                        apply()
                    }
                    Log.e(TAG, "✅✅✅ [CallActionReceiver] Call data stored in SharedPreferences")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Error storing call data: ${e.message}")
                }
                
                // Launch MainActivity with shouldAutoAnswer=true
                // Use both startActivity AND sendBroadcast to ensure it works when app is running/killed
                try {
                    val mainIntent = Intent(context, MainActivity::class.java).apply {
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK or 
                                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                                Intent.FLAG_ACTIVITY_SINGLE_TOP
                        putExtra("shouldAutoAnswer", true)
                        putExtra("callerId", callerId)
                        putExtra("callerName", callerName)
                        putExtra("callType", callType ?: "audio")
                        putExtra("isFromNotification", true)
                    }
                    Log.e(TAG, "✅✅✅ [CallActionReceiver] Launching MainActivity with intent flags: ${mainIntent.flags}")
                    Log.e(TAG, "✅✅✅ [CallActionReceiver] Intent extras: callerId=$callerId, callerName=$callerName, callType=$callType")
                    
                    // Try startActivity first
                    context.startActivity(mainIntent)
                    Log.e(TAG, "✅✅✅ [CallActionReceiver] MainActivity.startActivity() called successfully")
                    
                    // Also send broadcast in case startActivity is blocked (when app is running)
                    val broadcastIntent = Intent("com.compnay.ANSWER_CALL_FROM_NOTIFICATION").apply {
                        putExtra("callerId", callerId)
                        putExtra("callerName", callerName)
                        putExtra("callType", callType ?: "audio")
                        putExtra("shouldAutoAnswer", true)
                    }
                    context.sendBroadcast(broadcastIntent)
                    Log.e(TAG, "✅✅✅ [CallActionReceiver] Broadcast sent as backup")
                } catch (e: Exception) {
                    Log.e(TAG, "❌❌❌ [CallActionReceiver] ERROR launching MainActivity: ${e.message}")
                    Log.e(TAG, "❌❌❌ [CallActionReceiver] Stack trace:", e)
                    e.printStackTrace()
                }
                
                // Dismiss notification
                try {
                    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                    notificationManager.cancel(1001)
                    Log.d(TAG, "✅ Notification dismissed")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Error dismissing notification: ${e.message}")
                }
            }
            
            ACTION_DECLINE -> {
                Log.e(TAG, "========== [CallActionReceiver] DECLINE pressed ==========")
                Log.e(TAG, "CallerId: $callerId")

                // Stop ringtone immediately
                RingtoneService.stopRingtone(context)

                // P0: Match IncomingCallActivity – store cancel, HTTP cancel, CHECK_PENDING_CANCEL
                if (callerId != null) {
                    val prefs = context.getSharedPreferences("CallDataPrefs", Context.MODE_PRIVATE)
                    prefs.edit().apply {
                        putString("callerIdToCancel", callerId)
                        putBoolean("shouldCancelCall", true)
                        putBoolean("hasPendingCancel", true)
                        apply()
                    }
                    Log.e(TAG, "✅ [CallActionReceiver] Cancel data stored in SharedPreferences")

                    val receiverId = prefs.getString("currentUserId", null)
                    if (receiverId != null) {
                        Log.e(TAG, "✅ [CallActionReceiver] Sending HTTP cancel - caller: $callerId, receiver: $receiverId")
                        sendCancelToBackend(context, callerId, receiverId)
                    } else {
                        Log.w(TAG, "⚠️ [CallActionReceiver] No currentUserId - cancel will be sent via socket when app opens")
                    }
                }

                // Trigger pending cancel check (if app is running)
                val broadcastIntent = Intent("com.compnay.CHECK_PENDING_CANCEL").apply {
                    setPackage(context.packageName)
                }
                context.sendBroadcast(broadcastIntent)
                Log.e(TAG, "✅ [CallActionReceiver] Sent CHECK_PENDING_CANCEL broadcast")

                // Close IncomingCallActivity if open
                val closeIntent = Intent("com.compnay.CLOSE_INCOMING_CALL").apply {
                    putExtra("action", "decline")
                }
                context.sendBroadcast(closeIntent)

                // Dismiss notification
                try {
                    val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                    notificationManager.cancel(1001)
                    Log.d(TAG, "✅ Notification dismissed on decline")
                } catch (e: Exception) {
                    Log.e(TAG, "❌ Error dismissing notification: ${e.message}")
                }
            }
        }
    }

    private fun sendCancelToBackend(context: Context, callerId: String, receiverId: String) {
        Thread {
            try {
                val url = URL("$API_URL/api/call/cancel")
                val connection = url.openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.setRequestProperty("Content-Type", "application/json")
                connection.doOutput = true
                connection.connectTimeout = 5000
                connection.readTimeout = 5000

                val requestBody = JSONObject().apply {
                    put("conversationId", callerId)
                    put("sender", receiverId)
                }
                val outputStream: OutputStream = connection.outputStream
                outputStream.write(requestBody.toString().toByteArray())
                outputStream.flush()
                outputStream.close()

                val responseCode = connection.responseCode
                if (responseCode == HttpURLConnection.HTTP_OK || responseCode == HttpURLConnection.HTTP_ACCEPTED || responseCode == HttpURLConnection.HTTP_CREATED) {
                    Log.e(TAG, "✅ [CallActionReceiver] Cancel sent to backend (HTTP $responseCode)")
                } else {
                    Log.w(TAG, "⚠️ [CallActionReceiver] Backend returned HTTP $responseCode")
                }
                connection.disconnect()
            } catch (e: java.net.UnknownHostException) {
                Log.w(TAG, "⚠️ [CallActionReceiver] Cannot reach backend - cancel via socket when app opens")
            } catch (e: java.net.SocketTimeoutException) {
                Log.w(TAG, "⚠️ [CallActionReceiver] Backend timeout - cancel via socket when app opens")
            } catch (e: Exception) {
                Log.w(TAG, "⚠️ [CallActionReceiver] Error sending cancel: ${e.message}")
            }
        }.start()
    }
}
