package com.compnay

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
        
        fun startRingtone(context: Context) {
            val intent = Intent(context, RingtoneService::class.java).apply {
                action = ACTION_START_RINGTONE
            }
            // Use startService() instead of startForegroundService()
            // We only call this from IncomingCallActivity when app is running,
            // so we don't need a foreground service (which requires startForeground())
            context.startService(intent)
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
            ACTION_START_RINGTONE -> startRinging()
            ACTION_STOP_RINGTONE -> stopRinging()
        }
        return START_NOT_STICKY
    }
    
    private fun startRinging() {
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
