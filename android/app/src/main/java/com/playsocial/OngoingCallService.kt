package com.playsocial

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * OngoingCallService — keeps a 1:1 / group call alive while the app is backgrounded.
 *
 * Behaviour the product wants (WhatsApp style):
 *  - User presses HOME / opens another app  → call keeps running, audio keeps flowing
 *    (a foreground service of type `microphone` prevents Android from killing the process).
 *  - User SWIPES the app away from recents   → onTaskRemoved fires → we stop the service and
 *    let the process die, which drops the LiveKit room and ends the call for both sides.
 *
 * Started/stopped from JS via CallDataModule.startOngoingCall() / stopOngoingCall().
 */
class OngoingCallService : Service() {

    companion object {
        const val ACTION_START = "START_ONGOING_CALL"
        const val ACTION_STOP = "STOP_ONGOING_CALL"
        private const val NOTIFICATION_ID = 1003
        private const val CHANNEL_ID = "ongoing_call_service"

        fun start(context: Context, callerName: String?, withCamera: Boolean = false) {
            val intent = Intent(context, OngoingCallService::class.java).apply {
                action = ACTION_START
                putExtra("callerName", callerName)
                putExtra("withCamera", withCamera)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, OngoingCallService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startForegroundInternal(
                intent.getStringExtra("callerName"),
                intent.getBooleanExtra("withCamera", false)
            )
            ACTION_STOP -> stopSelfInternal()
        }
        return START_NOT_STICKY
    }

    private fun startForegroundInternal(callerName: String?, withCamera: Boolean) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Ongoing Call",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                setShowBadge(false)
                setSound(null, null)
            }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }

        val tapIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or
            (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
        val contentIntent = PendingIntent.getActivity(this, 0, tapIntent ?: Intent(), piFlags)

        // withCamera is only set for live streaming in this app, so use broadcast wording there.
        val title = if (withCamera) "Live broadcast" else "Ongoing call"
        val text = when {
            withCamera -> "You're live — tap to return"
            !callerName.isNullOrBlank() -> "In call with $callerName"
            else -> "Call in progress"
        }

        val notification: Notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_stat_ic_launcher)
                .setOngoing(true)
                .setContentIntent(contentIntent)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_stat_ic_launcher)
                .setOngoing(true)
                .setContentIntent(contentIntent)
                .build()
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // For live streaming we also keep the CAMERA alive in the background so the host's
                // face-cam doesn't freeze while they switch to another app (e.g. a chess game).
                var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                if (withCamera) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                }
                startForeground(NOTIFICATION_ID, notification, types)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            // Some OEMs reject the camera-typed start — fall back to microphone-only, then untyped.
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
                } else {
                    startForeground(NOTIFICATION_ID, notification)
                }
            } catch (_: Exception) {
                try { startForeground(NOTIFICATION_ID, notification) } catch (_: Exception) {}
            }
        }
    }

    private fun stopSelfInternal() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
        } catch (_: Exception) {}
        stopSelf()
    }

    /** User swiped the app away from recents → end the call immediately. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        try {
            // Mark it so JS can report a clean "call ended" if it ever resumes.
            getSharedPreferences("CallDataPrefs", Context.MODE_PRIVATE)
                .edit()
                .putBoolean("endedByTaskRemoval", true)
                .apply()
        } catch (_: Exception) {}

        // Notify JS (if still alive) to leave the LiveKit room gracefully.
        try {
            sendBroadcast(Intent("com.playsocial.END_CALL_TASK_REMOVED"))
        } catch (_: Exception) {}

        // Also dismiss any leftover call notifications.
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.cancel(NOTIFICATION_ID)
        } catch (_: Exception) {}

        stopSelfInternal()
        super.onTaskRemoved(rootIntent)

        // Force the process down so the LiveKit websocket drops at once → the call ends instantly
        // for the other side (instead of waiting for Android to reclaim the backgrounded process).
        try {
            android.os.Process.killProcess(android.os.Process.myPid())
        } catch (_: Exception) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
