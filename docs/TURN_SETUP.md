# TURN Server Setup for WhatsApp-Like Call Reliability

WebRTC uses **STUN** for NAT discovery and **TURN** as a relay fallback. When both peers are behind restrictive networks (mobile data, corporate WiFi, or one user is off-app), direct connection can fail. TURN relays media through your server so calls still connect.

**TURN credentials are stored in the backend** (thredtrain) and served via `GET /api/call/ice-servers`. The mobile app fetches them when the user is logged in.

**Add these lines to `D:\thredtrain\.env`** (or your backend root `.env`):

```
# TURN for WebRTC (Metered.ca)
TURN_USERNAME=115397ad1c434d33fa30c2da
TURN_CREDENTIAL=NYg2PEQ1x0yGcFSP
```

Restart the backend after adding them.

## When You Need TURN

- **Off-app answer flow**: User receives call while app is backgrounded, answers from notification → often fails without TURN
- **Callback after cancel**: User A calls B, B cancels, B calls A back while A is off-app → call may not reach A without TURN
- **Symmetric NAT / strict firewalls**: Some networks block direct P2P; TURN is the only way to connect

## Options

### 1. Self-Host (coturn) – Recommended for production

1. Rent a VPS (DigitalOcean, AWS, etc.) with a public IP
2. Install coturn:
   ```bash
   # Ubuntu/Debian
   sudo apt install coturn
   ```
3. Configure `/etc/turnserver.conf`:
   ```conf
   listening-port=3478
   external-ip=YOUR_SERVER_PUBLIC_IP
   realm=yourdomain.com
   user=webrtc:PASSWORD_YOU_CHOOSE
   ```
4. Add to `src/utils/constants.ts`:
   ```ts
   TURN_SERVERS: [
     { urls: 'turn:YOUR_SERVER_IP:3478', username: 'webrtc', credential: 'PASSWORD_YOU_CHOOSE' }
   ],
   ```

### 2. Metered.ca (Free tier)

1. Sign up at https://www.metered.ca/
2. Get TURN credentials from the dashboard
3. Add to `constants.ts`:
   ```ts
   TURN_SERVERS: [
     { urls: 'turn:global.relay.metered.ca:443', username: 'YOUR_USERNAME', credential: 'YOUR_CREDENTIAL' }
   ],
   ```

### 3. Twilio (Paid)

1. Create a Twilio account and enable TURN
2. Use the provided TURN URL and credentials in `constants.ts`

## Enable TURN in Your App

Edit `D:\trueapp\mobile\src\utils\constants.ts`:

```ts
TURN_SERVERS: [
  { urls: 'turn:your-turn-host:3478', username: 'your_user', credential: 'your_password' }
],
```

Restart the app. TURN is used automatically when direct connection fails.
