#!/usr/bin/env python3
"""Duo Watch Mac alarm helper (Python standard library only).

- On /alert from the extension: volume to max, siren + spoken alert on a loop and a dialog,
  until you click the dialog button
- Keeps the Mac from idle-sleeping while it runs (caffeinate; the display may still sleep)
- Watchdog: speaks up if the extension goes quiet for 90s, or no check has worked for 5 minutes

Usage:
  python3 duo_alarm.py              # run it
  python3 duo_alarm.py --test       # fire a real alarm now (loud!); add --zh for Chinese
  python3 duo_alarm.py --dry-run    # print what it would do, no sound

Optional environment variable:
  NTFY_TOPIC=some-random-string     also push to the ntfy app on your phone (max priority)

Voice and dialogs follow the language picked in the extension panel (EN / 中).
"""
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765
NTFY_TOPIC = os.environ.get("NTFY_TOPIC")
DRY_RUN = "--dry-run" in sys.argv
PING_STALE_S = 90  # the extension pings at least every 30s while running
OK_STALE_S = 300
WARN_EVERY_S = 900
ALARM_MAX_S = 15 * 60

TEXT = {
    "en": {
        "speak": "iPhone Duo is in stock! Go buy it now!",
        "button": "Got it",
        "title": "iPhone Duo in stock",
        "stalled": "Stock monitor stopped. The Chrome extension has been silent for 90 seconds.",
        "blocked": "Stock monitor has not had a successful check in 5 minutes. Apple may be blocking it.",
        "test_title": "Duo Watch test",
        "test_message": "This is a test alarm: Apple Somewhere — Available Today",
    },
    "zh": {
        "speak": "iPhone Duo 有货了！快去下单！",
        "button": "我知道了",
        "title": "iPhone Duo 有货了",
        "stalled": "库存监控停了，Chrome 扩展已经一分半没有动静，去看一下",
        "blocked": "库存监控已经五分钟没有成功查到库存，可能被 Apple 暂时限制了",
        "test_title": "Duo Watch 测试",
        "test_message": "这是测试警报：Apple 某某店 Available Today",
    },
}

lock = threading.Lock()
state = {"last_ping": None, "last_ok": None, "first_ping": None, "last_error": "", "last_warn": 0, "stopped": False, "lang": "en"}
alarm_stop = None  # threading.Event while an alarm is ringing


def log(*args):
    print(time.strftime("%H:%M:%S"), *args, flush=True)


def run(cmd, wait=True):
    if DRY_RUN:
        log("[dry-run]", " ".join(cmd))
        return ""
    if wait:
        return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()
    subprocess.Popen(cmd)
    return ""


def osa(script):
    return run(["osascript", "-e", script])


def pick_voices():
    if DRY_RUN:
        return {"en": "Samantha", "zh": "Tingting"}
    voices = {}
    for line in subprocess.run(["say", "-v", "?"], capture_output=True, text=True).stdout.splitlines():
        name = line.split("(")[0].split("  ")[0].strip()
        for lang, locale, preferred in (("zh", "zh_CN", "Tingting"), ("en", "en_US", "Samantha")):
            if locale in line and (lang not in voices or name == preferred):
                voices[lang] = name
    return voices


VOICES = pick_voices()


def lang_of(value):
    return "zh" if value == "zh" else "en"


def speak(text, lang):
    voice = VOICES.get(lang)
    run(["say", "-v", voice, text] if voice else ["say", text])


def push_phone(title, message, url):
    if not NTFY_TOPIC:
        return
    body = {"topic": NTFY_TOPIC, "title": title, "message": message, "priority": 5, "tags": ["rotating_light"]}
    if url:
        body["click"] = url
    if DRY_RUN:
        log("[dry-run] ntfy", body)
        return
    try:
        req = urllib.request.Request("https://ntfy.sh/", data=json.dumps(body).encode(), method="POST")
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        log("ntfy push failed:", e)


def alarm(title, message, url, lang):
    global alarm_stop
    with lock:
        if alarm_stop and not alarm_stop.is_set():
            log("Alarm already ringing, ignoring duplicate /alert")
            return
        alarm_stop = stop = threading.Event()
    text = TEXT[lang]
    log("🚨 IN STOCK:", message.replace("\n", " | "))

    old_volume = osa("output volume of (get volume settings)")
    old_muted = osa("output muted of (get volume settings)")
    osa("set volume without output muted")
    osa("set volume output volume 100")
    if url.startswith("https://www.apple.com/"):
        run(["open", url])
    push_phone(title, message, url)

    def dialog():
        safe = message.replace("\\", "\\\\").replace('"', '\\"')
        btn = osa(
            f'display dialog "{safe}" with title "{title}" buttons {{"{text["button"]}"}} '
            f'default button 1 with icon caution giving up after {ALARM_MAX_S}'
        )
        log("Dialog closed:", btn or "(timed out)")
        stop.set()

    threading.Thread(target=dialog, daemon=True).start()

    deadline = time.time() + ALARM_MAX_S
    while not stop.is_set() and time.time() < deadline:
        for _ in range(3):
            run(["afplay", "/System/Library/Sounds/Sosumi.aiff"])
        if stop.is_set():
            break
        speak(text["speak"], lang)
        if DRY_RUN:
            stop.wait(2)

    stop.set()
    if old_volume:
        osa(f"set volume output volume {old_volume}")
    if old_muted == "true":
        osa("set volume with output muted")
    log("Alarm finished")


def ack():
    with lock:
        if alarm_stop:
            alarm_stop.set()
    # the dialog may still be open; close it
    run(["pkill", "-f", "display dialog"], wait=True)


def warn(key):
    now = time.time()
    if now - state["last_warn"] < WARN_EVERY_S:
        return
    state["last_warn"] = now
    lang = state["lang"]
    text = TEXT[lang][key]
    log("⚠️", text)
    osa(f'display notification "{text}" with title "Duo Watch" sound name "Basso"')
    speak(text, lang)


def watchdog():
    last_tick = time.time()
    grace_until = 0
    while True:
        time.sleep(30)
        now = time.time()
        if now - last_tick > 90:
            # The 30s sleep took far longer, so the Mac was asleep. Give Chrome time to catch up.
            log(f"Mac just woke up (slept ~{int((now - last_tick) / 60)} min); no watchdog warnings for 3 minutes")
            grace_until = now + 180
        last_tick = now
        with lock:
            s = dict(state)
        if s["stopped"] or not s["first_ping"] or now < grace_until:
            continue
        if now - s["last_ping"] > PING_STALE_S:
            warn("stalled")
        elif now - (s["last_ok"] or s["first_ping"]) > OK_STALE_S:
            warn("blocked")


class Handler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/status":
            with lock:
                return self._json(200, {**state, "ringing": bool(alarm_stop and not alarm_stop.is_set())})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        # Only the extension sends this header; a web page can't without a CORS preflight we never allow.
        if self.headers.get("X-Duo-Watch") != "1":
            return self._json(403, {"error": "forbidden"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self._json(400, {"error": "bad json"})
        lang = lang_of(body.get("lang"))

        if self.path == "/ping":
            now = time.time()
            with lock:
                state["lang"] = lang
                state["stopped"] = bool(body.get("stopped"))
                state["last_ping"] = now
                state["first_ping"] = state["first_ping"] or now
                if body.get("ok"):
                    state["last_ok"] = now
                    state["last_error"] = ""
                elif body.get("error"):
                    state["last_error"] = body["error"]
            return self._json(200, {"ok": True})
        if self.path == "/alert":
            args = (str(body.get("title") or TEXT[lang]["title"]), str(body.get("message", "")), str(body.get("url", "")), lang)
            threading.Thread(target=alarm, args=args, daemon=True).start()
            return self._json(200, {"ok": True})
        if self.path == "/ack":
            ack()
            return self._json(200, {"ok": True})
        self._json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        if self.path != "/ping":
            log("HTTP", fmt % args)


def main():
    if "--test" in sys.argv:
        lang = "zh" if "--zh" in sys.argv else "en"
        alarm(TEXT[lang]["test_title"], TEXT[lang]["test_message"], "", lang)
        return
    if not DRY_RUN:
        # -i: no idle sleep, -s: no system sleep on AC power, -m: no disk sleep. Display may still sleep.
        subprocess.Popen(["caffeinate", "-ims", "-w", str(os.getpid())])
    threading.Thread(target=watchdog, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log(f"Duo Watch helper running on http://127.0.0.1:{PORT}  voices={VOICES}  phone push={'on' if NTFY_TOPIC else 'off'}")
    log("Keep this window open. Ctrl+C to quit.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
