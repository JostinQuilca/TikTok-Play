#!/usr/bin/env python3
"""
TikTok Printer Live - server.py
Backend WebSocket + HTTP server for the TikTok LIVE Printer Game.
Run with: python server.py          (connects to TikTok LIVE)
           python server.py --mock  (simulator mode, no TikTok needed)
"""

import asyncio
import json
import logging
import sys
import random
import argparse
import pathlib
import aiohttp
from aiohttp import web
import websockets
from websockets.server import serve

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_DIR = pathlib.Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"

def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

CONFIG = load_config()
WS_PORT   = CONFIG.get("websocket_port", 8765)
HTTP_PORT = CONFIG.get("http_port", 8000)
WEB_DIR   = BASE_DIR / "web"

# ---------------------------------------------------------------------------
# WebSocket client registry
# ---------------------------------------------------------------------------
CLIENTS: set = set()

async def register(ws):
    CLIENTS.add(ws)
    log.info("Client connected (%d total)", len(CLIENTS))

async def unregister(ws):
    CLIENTS.discard(ws)
    log.info("Client disconnected (%d total)", len(CLIENTS))

async def broadcast(payload: dict):
    if not CLIENTS:
        return
    msg = json.dumps(payload)
    await asyncio.gather(
        *[ws.send(msg) for ws in list(CLIENTS)],
        return_exceptions=True,
    )

# ---------------------------------------------------------------------------
# Gift classification
# ---------------------------------------------------------------------------
def classify_gift(diamond_count: int) -> str:
    tiers = CONFIG.get("gift_tiers", {})
    vip_min = tiers.get("vip", {}).get("min_diamonds", 100)
    big_min = tiers.get("big", {}).get("min_diamonds", 30)
    if diamond_count >= vip_min:
        return "vip"
    elif diamond_count >= big_min:
        return "big"
    return "print"

# ---------------------------------------------------------------------------
# TikTok LIVE handler
# ---------------------------------------------------------------------------
def extract_avatar(user) -> str:
    """Extract highest quality avatar URL from TikTokLive user object."""
    if not user:
        return ""
    for attr in ["avatar_large", "avatar_medium", "avatar_thumb"]:
        avatar_obj = getattr(user, attr, None)
        if avatar_obj and getattr(avatar_obj, "url_list", None):
            urls = avatar_obj.url_list
            if urls and len(urls) > 0 and urls[0]:
                return urls[0]
    return ""

def setup_tiktok_client(username: str):
    try:
        from TikTokLive import TikTokLiveClient
        from TikTokLive.events import GiftEvent, ConnectEvent, DisconnectEvent
        try:
            from TikTokLive.events import FollowEvent, CommentEvent
        except ImportError:
            FollowEvent = None
            CommentEvent = None
    except ImportError:
        log.error("TikTokLive not installed. Run: pip install TikTokLive")
        return None

    clean_username = username.lstrip("@").strip()
    log.info("Connecting to TikTok LIVE unique_id: '%s'", clean_username)
    client = TikTokLiveClient(unique_id=clean_username)

    @client.on(ConnectEvent)
    async def on_connect(event):
        log.info("Connected to TikTok LIVE as %s (Room ID: %s)", clean_username, getattr(event, 'room_id', 'N/A'))
        await broadcast({"type": "status", "connected": True, "user": clean_username})

    @client.on(DisconnectEvent)
    async def on_disconnect(event):
        log.info("Disconnected from TikTok LIVE")
        await broadcast({"type": "status", "connected": False})

    @client.on(GiftEvent)
    async def on_gift(event):
        # Avoid duplicate streak events
        if event.gift.streakable and event.streaking:
            return

        avatar_url = extract_avatar(event.user)
        diamond_count = getattr(event.gift, "diamond_count", 0) or 0
        repeat_count  = getattr(event, "repeat_count", 1) or 1
        gift_name     = getattr(event.gift, "name", "Unknown")
        gift_id       = getattr(event.gift, "gift_id", 0)

        # Check gift_mappings first, fallback to diamond_count classification
        gift_map = CONFIG.get("gift_mappings", {})
        if gift_name in gift_map:
            tier = gift_map[gift_name]["tier"]
            diamond_count = gift_map[gift_name].get("diamonds", diamond_count)
        else:
            tier = classify_gift(diamond_count)

        payload = {
            "type":     "print_job",
            "user":     event.user.nickname or event.user.unique_id or "Unknown",
            "avatar":   avatar_url,
            "tier":     tier,
            "gift":     gift_name,
            "gift_id":  gift_id,
            "count":    repeat_count,
            "diamonds": diamond_count,
        }
        log.info("Gift: %s → %s (tier=%s, diamonds=%d x%d, avatar=%s)", payload["user"], gift_name, tier, diamond_count, repeat_count, "OK" if avatar_url else "NONE")
        await broadcast(payload)

    if FollowEvent:
        @client.on(FollowEvent)
        async def on_follow(event):
            if not CONFIG.get("print_on_follow", False):
                return
            avatar_url = extract_avatar(event.user)
            payload = {
                "type":     "print_job",
                "user":     event.user.nickname or event.user.unique_id or "NewFollower",
                "avatar":   avatar_url,
                "tier":     "print",
                "gift":     "Follow",
                "gift_id":  0,
                "count":    1,
                "diamonds": 0,
            }
            log.info("Follow: %s", payload["user"])
            await broadcast(payload)

    if CommentEvent:
        @client.on(CommentEvent)
        async def on_comment(event):
            if not CONFIG.get("print_on_comment", False):
                return
            avatar_url = extract_avatar(event.user)
            payload = {
                "type":     "print_job",
                "user":     event.user.nickname or event.user.unique_id or "Commenter",
                "avatar":   avatar_url,
                "tier":     "print",
                "gift":     "Comment",
                "gift_id":  0,
                "count":    1,
                "diamonds": 0,
            }
            log.info("Comment from %s", payload["user"])
            await broadcast(payload)

    return client

# ---------------------------------------------------------------------------
# HTTP server (aiohttp) – serves /web and proxies avatar images
# ---------------------------------------------------------------------------
async def handle_avatar_proxy(request: web.Request) -> web.Response:
    """Proxy avatar images to avoid CORS issues and TikTok referrer restrictions."""
    url = request.query.get("url", "")
    if not url:
        return web.Response(status=400, text="Missing url param")
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.tiktok.com/",
        }
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=8)) as resp:
                data = await resp.read()
                content_type = resp.headers.get("Content-Type", "image/jpeg")
                return web.Response(
                    body=data,
                    content_type=content_type,
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "public, max-age=86400"
                    }
                )
    except Exception as e:
        log.warning("Avatar proxy error for %s: %s", url, e)
        return web.Response(status=502, text=str(e), headers={"Access-Control-Allow-Origin": "*"})
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                data = await resp.read()
                content_type = resp.headers.get("Content-Type", "image/jpeg")
                return web.Response(body=data, content_type=content_type)
    except Exception as e:
        log.warning("Avatar proxy error for %s: %s", url, e)
        return web.Response(status=502, text=str(e))

async def handle_simulate(request: web.Request) -> web.Response:
    """POST /api/simulate – trigger a mock gift event from HTTP."""
    try:
        body = await request.json()
    except Exception:
        body = {}

    tier = body.get("tier", "print")
    seeds = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta"]
    seed  = random.choice(seeds)

    tiers_data = CONFIG.get("gift_tiers", {})
    tier_cfg   = tiers_data.get(tier, {})
    gift_names = {"print": "Rose", "big": "Doughnut", "vip": "Legendary VIP"}
    diamonds   = {"print": 1, "big": 30, "vip": 500}

    payload = {
        "type":     "print_job",
        "user":     f"User_{seed}",
        "avatar":   f"https://api.dicebear.com/9.x/avataaars/svg?seed={seed}",
        "tier":     tier,
        "gift":     gift_names.get(tier, "Rose"),
        "gift_id":  0,
        "count":    1,
        "diamonds": diamonds.get(tier, 1),
    }
    await broadcast(payload)
    return web.json_response({"ok": True, "payload": payload})

async def handle_config(request: web.Request) -> web.Response:
    """GET /api/config – send config to frontend."""
    return web.json_response(CONFIG)

def build_http_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/api/config", handle_config)
    app.router.add_post("/api/simulate", handle_simulate)
    app.router.add_get("/api/avatar", handle_avatar_proxy)
    app.router.add_static("/", WEB_DIR, show_index=True, follow_symlinks=True)
    return app

# ---------------------------------------------------------------------------
# WebSocket server handler
# ---------------------------------------------------------------------------
async def ws_handler(websocket):
    await register(websocket)
    try:
        # Send current config on connect
        await websocket.send(json.dumps({"type": "config", "data": CONFIG}))
        async for message in websocket:
            # Accept ping/pong or commands from frontend
            try:
                data = json.loads(message)
                if data.get("type") == "ping":
                    await websocket.send(json.dumps({"type": "pong"}))
            except Exception:
                pass
    except websockets.exceptions.ConnectionClosedOK:
        pass
    except websockets.exceptions.ConnectionClosedError:
        pass
    finally:
        await unregister(websocket)

# ---------------------------------------------------------------------------
# Mock / Simulator mode
# ---------------------------------------------------------------------------
MOCK_NAMES = [
    ("CoolViewer", "Alpha"), ("TikFan99", "Beta"), ("LiveLover", "Gamma"),
    ("StarGazer", "Delta"), ("NightOwl", "Epsilon"), ("ProGamer", "Zeta"),
    ("SunRiser", "Eta"), ("MoonChild", "Theta"), ("CloudSurfer", "Iota"),
]

async def mock_event_generator():
    """Periodically sends fake gift events in mock mode."""
    await asyncio.sleep(3)  # Give time for browser to connect
    log.info("[MOCK] Simulator started — sending random gifts every 5s")
    while True:
        await asyncio.sleep(random.uniform(4, 8))
        name, seed  = random.choice(MOCK_NAMES)
        tier_choice = random.choices(["print", "print", "big", "vip"], weights=[60, 20, 15, 5])[0]
        diamonds    = {"print": 1, "big": 30, "vip": 500}[tier_choice]
        gifts       = {"print": "Rose", "big": "Doughnut", "vip": "Legendary VIP"}

        payload = {
            "type":     "print_job",
            "user":     name,
            "avatar":   f"https://api.dicebear.com/9.x/avataaars/svg?seed={seed}&backgroundColor=b6e3f4",
            "tier":     tier_choice,
            "gift":     gifts[tier_choice],
            "gift_id":  0,
            "count":    1,
            "diamonds": diamonds,
        }
        log.info("[MOCK] Sending: %s gift from %s", tier_choice, name)
        await broadcast(payload)

# ---------------------------------------------------------------------------
# Main entrypoint
# ---------------------------------------------------------------------------
async def main(mock_mode: bool = False):
    username = CONFIG.get("tiktok_username", "@tu_usuario_aqui")
    log.info("=" * 60)
    log.info("TikTok Printer Live")
    log.info("HTTP  → http://localhost:%d", HTTP_PORT)
    log.info("WS    → ws://localhost:%d",   WS_PORT)
    log.info("User  → %s", username)
    log.info("Mode  → %s", "MOCK/SIMULATOR" if mock_mode else "TIKTOK LIVE")
    log.info("=" * 60)

    # Start WebSocket server
    ws_server = await serve(ws_handler, "localhost", WS_PORT)
    log.info("WebSocket server listening on ws://localhost:%d", WS_PORT)

    # Start HTTP server
    http_app    = build_http_app()
    http_runner = web.AppRunner(http_app)
    await http_runner.setup()
    site = web.TCPSite(http_runner, "localhost", HTTP_PORT)
    await site.start()
    log.info("HTTP server listening on http://localhost:%d", HTTP_PORT)

    tasks = []

    if mock_mode:
        tasks.append(asyncio.create_task(mock_event_generator()))
        log.info("[MOCK] No TikTok connection. Use keys 1-4 in browser to test.")
    else:
        client = setup_tiktok_client(username)
        if client:
            async def run_tiktok():
                clean_user = username.lstrip("@").strip()
                while True:
                    try:
                        log.info("Checking if @%s is LIVE on TikTok...", clean_user)
                        is_live = await client.is_live()
                        if is_live:
                            log.info("@%s is LIVE! Connecting to stream...", clean_user)
                            await broadcast({"type": "status", "connected": True, "user": clean_user})
                            await client.start()
                        else:
                            log.info("@%s is currently OFFLINE on TikTok. Retrying in 15s...", clean_user)
                            await broadcast({"type": "status", "connected": False, "user": clean_user, "offline": True})
                            await asyncio.sleep(15)
                    except asyncio.CancelledError:
                        break
                    except Exception as e:
                        log.warning("TikTok connection notice for @%s: %s. Retrying in 15s...", clean_user, e)
                        await broadcast({"type": "status", "connected": False, "error": str(e)})
                        await asyncio.sleep(15)
            tasks.append(asyncio.create_task(run_tiktok()))
        else:
            log.warning("TikTokLive unavailable, switching to MOCK mode.")
            tasks.append(asyncio.create_task(mock_event_generator()))

    try:
        await asyncio.Future()  # Run forever
    except (asyncio.CancelledError, KeyboardInterrupt):
        log.info("Shutting down...")
    finally:
        ws_server.close()
        await ws_server.wait_closed()
        await http_runner.cleanup()
        for t in tasks:
            t.cancel()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TikTok Printer Live Server")
    parser.add_argument("--mock", action="store_true", help="Run in simulator mode (no TikTok connection)")
    args = parser.parse_args()

    try:
        asyncio.run(main(mock_mode=args.mock))
    except KeyboardInterrupt:
        log.info("Goodbye!")
