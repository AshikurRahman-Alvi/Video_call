# PeerCall — Render Ready

A lightweight 1-to-1 WebRTC video-call demo with a dependency-free Python signaling server.

## Deploy to Render

1. Upload this whole folder to a GitHub repository.
2. Sign in to Render and create a new Blueprint, or create a Web Service from the repository.
3. Render can read `render.yaml` automatically.
4. Deploy.
5. Open the generated `https://<name>.onrender.com` URL.
6. Generate a room and share the invite URL with the second participant.

No `pip install` is required.

## Local run

```bash
python server.py
```

By default it listens on port 10000 locally. You can choose another port:

Linux / Termux:
```bash
PORT=8080 python server.py
```

Windows PowerShell:
```powershell
$env:PORT=8080
python server.py
```

## Architecture

- Python: serves the frontend and exchanges signaling messages.
- WebRTC: transports audio/video.
- STUN: helps establish peer-to-peer connections.
- Render: hosts the HTTPS web/signaling service.

## Limitations

- Two participants per room.
- In-memory rooms disappear when the Render process restarts.
- No authentication.
- No TURN server is included.
- Some restrictive/mobile networks may require TURN for media connectivity.
- This is a learning/demo project rather than a production calling service.
