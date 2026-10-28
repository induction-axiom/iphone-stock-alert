#!/usr/bin/env python3
"""Duo Watch 本地报警助手（只用 Python 标准库）。

- 收到扩展的 /alert：把音量开到最大、循环响警报 + 中文语音、弹出对话框，直到你点"我知道了"
- 运行期间阻止 Mac 睡眠（caffeinate，屏幕可以黑）
- 看门狗：扩展超过 2 分钟没动静，或 5 分钟没成功查到一次库存，就语音提醒你

用法：
  python3 duo_alarm.py            # 正常运行
  python3 duo_alarm.py --test     # 立刻试一次真实警报（很响！）
  python3 duo_alarm.py --dry-run  # 只打印动作，不出声，用来调试

可选环境变量：
  NTFY_TOPIC=一串随机字符   同时推送到手机上的 ntfy App（最高优先级）
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
PING_STALE_S = 120
OK_STALE_S = 300
WARN_EVERY_S = 900
ALARM_MAX_S = 15 * 60

lock = threading.Lock()
state = {"last_ping": None, "last_ok": None, "first_ping": None, "last_error": "", "last_warn": 0, "stopped": False}
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


def chinese_voice():
    if DRY_RUN:
        return "Tingting"
    names = [
        line.split("(")[0].split("  ")[0].strip()
        for line in subprocess.run(["say", "-v", "?"], capture_output=True, text=True).stdout.splitlines()
        if "zh_CN" in line
    ]
    return "Tingting" if "Tingting" in names else (names[0] if names else None)


VOICE = chinese_voice()


def speak(text):
    run(["say", "-v", VOICE, text] if VOICE else ["say", "iPhone Duo in stock"])


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
        log("ntfy 推送失败：", e)


def alarm(title, message, url):
    global alarm_stop
    with lock:
        if alarm_stop and not alarm_stop.is_set():
            log("警报已经在响，忽略重复的 /alert")
            return
        alarm_stop = stop = threading.Event()
    log("🚨 有货！", message.replace("\n", " | "))

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
            f'display dialog "{safe}" with title "{title}" buttons {{"我知道了"}} '
            f'default button 1 with icon caution giving up after {ALARM_MAX_S}'
        )
        log("对话框关闭：", btn or "(超时)")
        stop.set()

    threading.Thread(target=dialog, daemon=True).start()

    deadline = time.time() + ALARM_MAX_S
    while not stop.is_set() and time.time() < deadline:
        for _ in range(3):
            run(["afplay", "/System/Library/Sounds/Sosumi.aiff"])
        if stop.is_set():
            break
        speak("iPhone Duo 有货了！快去下单！")
        if DRY_RUN:
            stop.wait(2)

    stop.set()
    if old_volume:
        osa(f"set volume output volume {old_volume}")
    if old_muted == "true":
        osa("set volume with output muted")
    log("警报结束")


def ack():
    with lock:
        if alarm_stop:
            alarm_stop.set()
    # the dialog may still be open; close it
    run(["pkill", "-f", "display dialog"], wait=True)


def warn(text):
    now = time.time()
    if now - state["last_warn"] < WARN_EVERY_S:
        return
    state["last_warn"] = now
    log("⚠️", text)
    osa(f'display notification "{text}" with title "Duo Watch" sound name "Basso"')
    speak(text)


def watchdog():
    while True:
        time.sleep(30)
        with lock:
            s = dict(state)
        if s["stopped"] or not s["first_ping"]:
            continue
        now = time.time()
        if now - s["last_ping"] > PING_STALE_S:
            warn("库存监控停了，Chrome 扩展已经两分钟没有动静，去看一下")
        elif now - (s["last_ok"] or s["first_ping"]) > OK_STALE_S:
            warn("库存监控已经五分钟没有成功查到库存，可能被 Apple 暂时限制了")


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

        if self.path == "/ping":
            now = time.time()
            with lock:
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
            args = (str(body.get("title", "iPhone Duo 有货了")), str(body.get("message", "")), str(body.get("url", "")))
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
        alarm("Duo Watch 测试", "这是测试警报：Apple Store 某某店 Available Today", "")
        return
    if not DRY_RUN:
        # -i: no idle sleep, -s: no system sleep on AC power, -m: no disk sleep. Display may still sleep.
        subprocess.Popen(["caffeinate", "-ims", "-w", str(os.getpid())])
    threading.Thread(target=watchdog, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    log(f"Duo Watch 助手已启动：http://127.0.0.1:{PORT}  语音={VOICE}  手机推送={'开' if NTFY_TOPIC else '关'}")
    log("保持这个窗口开着。Ctrl+C 退出。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
