# View logs for Device 1 (129065548A000773)
adb -s 129065548A000773 logcat *:S ReactNativeJS:V | Select-String -Pattern "CallUser|AnswerCall|WebRTC|ICE|ChatScreen|IncomingCall|Socket|callUser|EVENT|Setting up|Cleanup"
