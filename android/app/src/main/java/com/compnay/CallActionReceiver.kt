package com.compnay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * BroadcastReceiver to handle Answer/Decline actions from IncomingCallActivity
 */
class CallActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        val callerId = intent.getStringExtra("callerId")
        val callerName = intent.getStringExtra("callerName")
        val callType = intent.getStringExtra("callType")

        when (action) {
            "com.compnay.CALL_ANSWERED" -> {
                // Call was answered - MainActivity will handle navigation
                // The intent extras are already passed to MainActivity
            }
            "com.compnay.CALL_DECLINED" -> {
                // Call was declined - can emit socket event here if needed
                // For now, MainActivity will handle it
            }
        }
    }
}
