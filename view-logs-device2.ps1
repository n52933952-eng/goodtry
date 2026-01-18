# View logs for Device 2 (R8YW501N1RW)
adb -s R8YW501N1RW logcat *:S ReactNativeJS:V | Select-String -Pattern "CallUser|AnswerCall|WebRTC|ICE|ChatScreen|IncomingCall|Socket|callUser|EVENT|Setting up|Cleanup"
