package com.compnay

import android.app.NotificationManager
import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments

class CallDataModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "CallDataModule"

    @ReactMethod
    fun getPendingCallData(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("CallDataPrefs", android.content.Context.MODE_PRIVATE)
            val hasPendingCall = prefs.getBoolean("hasPendingCall", false)
            val hasPendingCancel = prefs.getBoolean("hasPendingCancel", false)
            
            // Return data if there's a pending call OR a pending cancel
            if (hasPendingCall || hasPendingCancel) {
                val map: WritableMap = Arguments.createMap().apply {
                    if (hasPendingCall) {
                        putString("callerId", prefs.getString("callerId", null))
                        putString("callerName", prefs.getString("callerName", null))
                        putString("callType", prefs.getString("callType", "audio"))
                        putBoolean("shouldAutoAnswer", prefs.getBoolean("shouldAutoAnswer", false))
                        putBoolean("shouldDecline", prefs.getBoolean("shouldDecline", false))
                        putBoolean("hasPendingCall", true)
                    }
                    if (hasPendingCancel) {
                        putString("callerIdToCancel", prefs.getString("callerIdToCancel", null))
                        putBoolean("shouldCancelCall", prefs.getBoolean("shouldCancelCall", false))
                        putBoolean("hasPendingCancel", true)
                    }
                }
                promise.resolve(map)
            } else {
                promise.resolve(null)
            }
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to read call data: ${e.message}", e)
        }
    }

    @ReactMethod
    fun clearCallData(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("CallDataPrefs", android.content.Context.MODE_PRIVATE)
            prefs.edit()
                .remove("hasPendingCall")
                .remove("shouldCancelCall")
                .remove("hasPendingCancel")
                .remove("callerIdToCancel")
                .remove("callerId")
                .remove("callerName")
                .remove("callType")
                .remove("shouldAutoAnswer")
                .remove("shouldDecline")
                .apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to clear call data: ${e.message}", e)
        }
    }
    
    @ReactMethod
    fun setCurrentUserId(userId: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("CallDataPrefs", android.content.Context.MODE_PRIVATE)
            prefs.edit()
                .putString("currentUserId", userId)
                .apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to store user ID: ${e.message}", e)
        }
    }
    
    @ReactMethod
    fun dismissCallNotification(promise: Promise) {
        try {
            val notificationManager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.cancel(1001) // Dismiss incoming call notification (same ID as in MyFirebaseMessagingService)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to dismiss notification: ${e.message}", e)
        }
    }

    /**
     * Generic SharedPreferences reader for small payloads (used for OneSignal action buttons).
     * Returns a map of all keys/values in the given prefsName.
     */
    @ReactMethod
    fun getSharedPreferences(prefsName: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            val all = prefs.all
            val map: WritableMap = Arguments.createMap()
            for ((key, value) in all) {
                when (value) {
                    is String -> map.putString(key, value)
                    is Boolean -> map.putBoolean(key, value)
                    is Int -> map.putInt(key, value)
                    is Double -> map.putDouble(key, value)
                    is Float -> map.putDouble(key, value.toDouble())
                    is Long -> map.putDouble(key, value.toDouble()) // JS number
                    null -> map.putNull(key)
                    else -> map.putString(key, value.toString())
                }
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to read shared prefs $prefsName: ${e.message}", e)
        }
    }

    /**
     * Clear all keys from the given SharedPreferences.
     */
    @ReactMethod
    fun clearSharedPreferences(prefsName: String, promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences(prefsName, Context.MODE_PRIVATE)
            prefs.edit().clear().apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERROR", "Failed to clear shared prefs $prefsName: ${e.message}", e)
        }
    }
}
