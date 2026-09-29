from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
import json
import threading
import time
import os

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "10000"))
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

# room_id -> {"messages": [...], "clients": {client_id: last_seen}}
rooms = {}
lock = threading.Lock()

def cleanup_rooms():
    while True:
        time.sleep(60)
        now = time.time()
        with lock:
            dead_rooms = []
            for room_id, room in rooms.items():
                room["clients"] = {
                    cid: seen for cid, seen in room["clients"].items()
                    if now - seen < 120
                }
                # Keep only recent signaling messages.
                room["messages"] = [
                    m for m in room["messages"]
                    if now - m["time"] < 120
                ]
                if not room["clients"]:
                    dead_rooms.append(room_id)
            for room_id in dead_rooms:
                rooms.pop(room_id, None)

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args))

    def send_json(self, obj, status=200):
        data = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 1024 * 1024:
                raise ValueError("Request too large")
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            return None

    def do_POST(self):
        path = urlparse(self.path).path
        body = self.read_json()
        if body is None:
            return self.send_json({"error": "Invalid JSON"}, 400)

        if path == "/api/join":
            room_id = str(body.get("room", "")).strip()[:64]
            client_id = str(body.get("client", "")).strip()[:64]
            if not room_id or not client_id:
                return self.send_json({"error": "room and client required"}, 400)

            with lock:
                room = rooms.setdefault(room_id, {"messages": [], "clients": {}})
                # This demo supports two peers per room.
                active = [c for c in room["clients"] if c != client_id]
                if len(active) >= 2:
                    return self.send_json({"error": "Room is full"}, 409)
                room["clients"][client_id] = time.time()
                peer_count = len(room["clients"])

            return self.send_json({"ok": True, "peerCount": peer_count})

        if path == "/api/signal":
            room_id = str(body.get("room", "")).strip()[:64]
            sender = str(body.get("sender", "")).strip()[:64]
            target = str(body.get("target", "")).strip()[:64]
            payload = body.get("payload")

            if not room_id or not sender or payload is None:
                return self.send_json({"error": "Missing signaling fields"}, 400)

            with lock:
                room = rooms.setdefault(room_id, {"messages": [], "clients": {}})
                room["clients"][sender] = time.time()
                room["messages"].append({
                    "id": f"{time.time_ns()}-{sender}",
                    "sender": sender,
                    "target": target,
                    "payload": payload,
                    "time": time.time()
                })
            return self.send_json({"ok": True})

        if path == "/api/leave":
            room_id = str(body.get("room", "")).strip()[:64]
            client_id = str(body.get("client", "")).strip()[:64]
            with lock:
                if room_id in rooms:
                    rooms[room_id]["clients"].pop(client_id, None)
            return self.send_json({"ok": True})

        self.send_json({"error": "Not found"}, 404)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/poll":
            q = parse_qs(parsed.query)
            room_id = q.get("room", [""])[0][:64]
            client_id = q.get("client", [""])[0][:64]
            after = q.get("after", [""])[0]

            if not room_id or not client_id:
                return self.send_json({"error": "room and client required"}, 400)

            with lock:
                room = rooms.setdefault(room_id, {"messages": [], "clients": {}})
                room["clients"][client_id] = time.time()
                peers = [cid for cid in room["clients"] if cid != client_id]

                messages = []
                passed_after = (after == "")
                for m in room["messages"]:
                    if not passed_after:
                        if m["id"] == after:
                            passed_after = True
                        continue
                    if m["sender"] != client_id and (not m["target"] or m["target"] == client_id):
                        messages.append(m)

                # If the cursor disappeared because old messages were cleaned,
                # return currently retained messages for this client.
                if after and not passed_after:
                    messages = [
                        m for m in room["messages"]
                        if m["sender"] != client_id and
                        (not m["target"] or m["target"] == client_id)
                    ]

            return self.send_json({"messages": messages, "peers": peers})

        super().do_GET()

if __name__ == "__main__":
    threading.Thread(target=cleanup_rooms, daemon=True).start()
    print(f"PeerCall server listening on {HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
