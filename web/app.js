const $ = (id) => document.getElementById(id);

const roomInput = $("room");
const joinPanel = $("joinPanel");
const callPanel = $("callPanel");
const localVideo = $("localVideo");
const remoteVideo = $("remoteVideo");
const statusEl = $("status");
const waitingEl = $("waiting");

const clientId = crypto.randomUUID ? crypto.randomUUID() :
  Math.random().toString(36).slice(2) + Date.now();

let roomId = "";
let localStream = null;
let pc = null;
let peerId = "";
let lastMessageId = "";
let polling = false;
let makingOffer = false;
let ignoreOffer = false;
let polite = false;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ]
};

function setStatus(text) {
  statusEl.textContent = text;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function createPeerConnection() {
  if (pc) pc.close();

  pc = new RTCPeerConnection(rtcConfig);

  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    waitingEl.classList.add("hidden");
  };

  pc.onicecandidate = ({candidate}) => {
    if (candidate && peerId) {
      sendSignal({type: "candidate", candidate});
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === "connected") setStatus("Connected");
    else if (state === "connecting") setStatus("Connecting…");
    else if (state === "failed") setStatus("Connection failed");
    else if (state === "disconnected") setStatus("Disconnected");
  };

  pc.onnegotiationneeded = async () => {
    if (!peerId) return;
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      await sendSignal({type: "description", description: pc.localDescription});
    } catch (e) {
      console.error(e);
    } finally {
      makingOffer = false;
    }
  };
}

async function sendSignal(payload) {
  if (!peerId) return;
  await api("/api/signal", {
    room: roomId,
    sender: clientId,
    target: peerId,
    payload
  });
}

async function handleSignal(message) {
  const payload = message.payload;
  if (!payload) return;

  if (payload.type === "description") {
    const description = payload.description;
    const offerCollision =
      description.type === "offer" &&
      (makingOffer || pc.signalingState !== "stable");

    ignoreOffer = !polite && offerCollision;
    if (ignoreOffer) return;

    await pc.setRemoteDescription(description);

    if (description.type === "offer") {
      await pc.setLocalDescription();
      await sendSignal({type: "description", description: pc.localDescription});
    }
  }

  if (payload.type === "candidate") {
    try {
      await pc.addIceCandidate(payload.candidate);
    } catch (e) {
      if (!ignoreOffer) throw e;
    }
  }
}

async function poll() {
  polling = true;
  while (polling) {
    try {
      const url = `/api/poll?room=${encodeURIComponent(roomId)}&client=${encodeURIComponent(clientId)}&after=${encodeURIComponent(lastMessageId)}`;
      const res = await fetch(url, {cache: "no-store"});
      const data = await res.json();

      if (data.peers && data.peers.length) {
        const foundPeer = data.peers[0];
        if (!peerId) {
          peerId = foundPeer;
          // Stable role choice for perfect negotiation.
          polite = clientId.localeCompare(peerId) > 0;
          setStatus("Peer found");
          // The lexicographically smaller peer initiates.
          if (clientId.localeCompare(peerId) < 0 && pc.signalingState === "stable") {
            try {
              makingOffer = true;
              await pc.setLocalDescription(await pc.createOffer());
              await sendSignal({type: "description", description: pc.localDescription});
            } finally {
              makingOffer = false;
            }
          }
        }
      }

      for (const msg of data.messages || []) {
        lastMessageId = msg.id;
        if (!peerId) {
          peerId = msg.sender;
          polite = clientId.localeCompare(peerId) > 0;
        }
        await handleSignal(msg);
      }
    } catch (e) {
      console.error("poll", e);
      setStatus("Reconnecting signaling…");
    }
    await new Promise(r => setTimeout(r, 700));
  }
}

async function joinRoom() {
  roomId = roomInput.value.trim();
  if (!roomId) {
    alert("Enter a room ID.");
    return;
  }

  try {
    setStatus("Requesting camera…");
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {facingMode: "user"},
      audio: true
    });
    localVideo.srcObject = localStream;

    const joined = await api("/api/join", {room: roomId, client: clientId});

    createPeerConnection();
    joinPanel.classList.add("hidden");
    callPanel.classList.remove("hidden");
    $("roomName").textContent = roomId;
    setStatus(joined.peerCount > 1 ? "Finding peer…" : "Waiting for peer");
    history.replaceState(null, "", `?room=${encodeURIComponent(roomId)}`);
    poll();
  } catch (e) {
    console.error(e);
    alert(e.message || "Could not join call.");
    setStatus("Not connected");
    if (localStream) localStream.getTracks().forEach(t => t.stop());
  }
}

async function leaveRoom() {
  polling = false;
  try {
    if (roomId) await api("/api/leave", {room: roomId, client: clientId});
  } catch (_) {}
  if (pc) pc.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  location.href = location.pathname;
}

$("joinBtn").onclick = joinRoom;
$("newRoomBtn").onclick = () => {
  roomInput.value = Math.random().toString(36).slice(2, 8);
};
$("hangupBtn").onclick = leaveRoom;

$("micBtn").onclick = () => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $("micBtn").textContent = track.enabled ? "🎙 Mic on" : "🔇 Mic off";
};

$("camBtn").onclick = () => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $("camBtn").textContent = track.enabled ? "📷 Camera on" : "🚫 Camera off";
};

$("copyBtn").onclick = async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`;
  await navigator.clipboard.writeText(url);
  $("copyBtn").textContent = "Copied!";
  setTimeout(() => $("copyBtn").textContent = "Copy invite link", 1500);
};

const params = new URLSearchParams(location.search);
if (params.get("room")) roomInput.value = params.get("room");

window.addEventListener("beforeunload", () => {
  if (roomId) {
    navigator.sendBeacon(
      "/api/leave",
      new Blob([JSON.stringify({room: roomId, client: clientId})],
               {type: "application/json"})
    );
  }
});
