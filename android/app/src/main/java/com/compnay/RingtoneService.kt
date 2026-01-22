package com.compnay

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator

/**
 * Service to play ringtone and vibrate for incoming calls
 * Works even when app is closed
 */
class RingtoneService : Service() {
    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    
    companion object {
        const val ACTION_START_RINGTONE = "START_RINGTONE"
        const val ACTION_STOP_RINGTONE = "STOP_RINGTONE"
        private const val NOTIFICATION_ID = 1002
        private const val CHANNEL_ID = "ringtone_service"
        
        fun startRingtone(context: Context) {
            val intent = Intent(context, RingtoneService::class.java).apply {
                action = ACTION_START_RINGTONE
            }
            // Use startService() when app is running (from IncomingCallActivity)
            context.startService(intent)
        }
        
        fun startRingtoneForeground(context: Context) {
            val intent = Intent(context, RingtoneService::class.java).apply {
                action = ACTION_START_RINGTONE
                putExtra("isForeground", true)
            }
            // Use startForegroundService() when app is killed (from MyFirebaseMessagingService)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
        
        fun stopRingtone(context: Context) {
            val intent = Intent(context, RingtoneService::class.java).apply {
                action = ACTION_STOP_RINGTONE
            }
            context.startService(intent)
        }
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_RINGTONE -> {
                val isForeground = intent.getBooleanExtra("isForeground", false)
                if (isForeground) {
                    // Start as foreground service (required when app is killed)
                    startForegroundService()
                }
                startRinging()
            }
            ACTION_STOP_RINGTONE -> stopRinging()
        }
        return START_NOT_STICKY
    }
    
    private fun startForegroundService() {
        // Create notification channel
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Incoming Call",
                NotificationManager.IMPORTANCE_LOW // Low importance to hide from notification bar
            ).apply {
                setShowBadge(false)
                setSound(null, null) // No sound - we play ringtone directly
            }
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
        }
        
        // Create a silent notification for foreground service
        // Use a low-importance channel to minimize notification visibility
        val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Incoming Call")
                .setContentText("Playing ringtone...")
                .setSmallIcon(R.drawable.ic_stat_ic_launcher)
                .setPriority(Notification.PRIORITY_LOW)
                .setOngoing(true)
                .setSound(null) // Silent notification
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("Incoming Call")
                .setContentText("Playing ringtone...")
                .setSmallIcon(R.drawable.ic_stat_ic_launcher)
                .setPriority(Notification.PRIORITY_LOW)
                .setSound(null) // Silent notification
                .build()
        }
        
        startForeground(NOTIFICATION_ID, notification)
    }
    
    private fun startRinging() {
        // If already playing, don't restart
        if (mediaPlayer?.isPlaying == true) {
            return
        }
        
        // Start vibration
        vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        val pattern = longArrayOf(0, 1000, 1000) // Vibrate pattern: wait 0ms, vibrate 1000ms, wait 1000ms, repeat
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } else {
            @Suppress("DEPRECATION")
            vibrator?.vibrate(pattern, 0)
        }
        
        // Start ringtone
        try {
            // Use system ringtone
            val ringtoneUri: Uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            
            mediaPlayer = MediaPlayer().apply {
                setDataSource(applicationContext, ringtoneUri)
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                } else {
                    @Suppress("DEPRECATION")
                    setAudioStreamType(AudioManager.STREAM_RING)
                }
                
                // Set volume to max
                val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                val maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_RING)
                audioManager.setStreamVolume(AudioManager.STREAM_RING, maxVolume, 0)
                
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
    
    private fun stopRinging() {
        mediaPlayer?.apply {
            if (isPlaying) stop()
            release()
        }
        mediaPlayer = null
        
        vibrator?.cancel()
        vibrator = null
        
        stopSelf()
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    override fun onDestroy() {
        stopRinging()
        super.onDestroy()
    }
}
