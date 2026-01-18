# Debug Infinite Loop in CallScreen

## Check These Patterns in Logcat:

### 1. If you see this repeating:
```
📞 [CallScreen] ========== AUTO-ANSWER CHECK ==========
```
**Problem:** useEffect is running repeatedly
**Solution:** Check `hasAttempted: false` in the log - if it's false even after calling answerCall, the ref isn't persisting

### 2. If you see this repeating:
```
✅✅✅ [CallScreen] Signal available AND call.from matches - auto-answering NOW...
```
**Problem:** Condition `call.signal && call.from === userId` is true multiple times
**Solution:** Check if `hasAttemptedAnswerRef.current` is being reset somewhere

### 3. If dependencies are changing:
Look at the `Call state:` log - check if `from`, `signal`, or `userId` are changing between runs

## Most Likely Cause:
The `call` object reference is changing, causing the useEffect to re-run, even though the values inside are the same.

## Quick Fix Test:
Temporarily remove `call.signal` and `call.from` from dependencies to see if that stops the loop.
