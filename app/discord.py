"""Meldet die obersten Aufträge der Warteschlange per Webhook an Discord –
aber nur, wenn sich an ihnen tatsächlich etwas geändert hat."""

import json
import logging
import re
import threading
import urllib.error
import urllib.request

from . import db, jobs, makerworld

log = logging.getLogger(__name__)

LAST_TOP_KEY = "discord_last_top"
LAST_SENT_KEY = "discord_last_sent_at"
LAST_ERROR_KEY = "discord_last_error"

USER_AGENT = "DiscordBot (https://github.com/cschramme/3d-druck-warteschlange, 1.0)"
EMBED_COLOR = 0x00AE42  # Bambu-Grün
SNAPSHOT_FIELDS = ("id", "title", "requester", "makerworld_url", "image_url",
                   "quantity", "color", "notes", "admin_note")

# Verhindert, dass zwei gleichzeitige Änderungen doppelt (oder veraltet) senden.
_lock = threading.Lock()


def snapshot(top):
    return json.dumps([{f: row[f] for f in SNAPSHOT_FIELDS} for row in top],
                      ensure_ascii=False, sort_keys=True)


def _esc(text):
    return re.sub(r"([\\*_~|`>\[\]])", r"\\\1", text or "")


def _cut(text, limit):
    text = text or ""
    return text if len(text) <= limit else text[: limit - 1] + "…"


def build_payload(top, public_url=""):
    if not top:
        content = "✅ **Die Druck-Warteschlange ist leer.**"
    else:
        content = f"🖨️ **Die nächsten {len(top)} Druckaufträge**"
        if len(top) == 1:
            content = "🖨️ **Der nächste Druckauftrag**"
    if public_url:
        content += f"\n<{public_url}/admin>"

    embeds = []
    for pos, job in enumerate(top, start=1):
        details = [f"👤 {_esc(job['requester'])}"]
        if job["quantity"] and job["quantity"] > 1:
            details.append(f"🔢 {job['quantity']}×")
        if job["color"]:
            details.append(f"🎨 {_esc(job['color'])}")
        lines = [" · ".join(details)]

        url = job["makerworld_url"]
        if url and makerworld.is_makerworld(url):
            lines.append(f"🔗 [Auf MakerWorld öffnen]({url})")
        elif url:
            lines.append(f"🔗 [Link zum Modell]({url})")
        else:
            lines.append("⚠️ **Kein MakerWorld-Link** – Modell selbst besorgen/erstellen")
        if job["notes"]:
            lines.append(f"📝 {_esc(_cut(job['notes'], 500))}")
        if job["admin_note"]:
            lines.append(f"🛠️ {_esc(_cut(job['admin_note'], 300))}")

        embed = {
            "title": _cut(f"{pos}. {job['title']}", 256),
            "description": "\n".join(lines),
            "color": EMBED_COLOR,
        }
        if url:
            embed["url"] = url
        if job["image_url"]:
            embed["thumbnail"] = {"url": job["image_url"]}
        embeds.append(embed)

    # Keine @everyone/@here/Rollen-Pings aus Namen oder Notizen zulassen.
    return {"content": content, "embeds": embeds, "allowed_mentions": {"parse": []}}


def post_webhook(url, payload):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as resp:
            resp.read()
    except urllib.error.HTTPError as exc:
        body = exc.read(300).decode("utf-8", errors="replace")
        raise RuntimeError(f"Discord antwortete mit {exc.code}: {body}") from None


def sync(conn, config, force=False):
    """Schickt die obersten Aufträge an Discord, falls sie sich seit dem letzten
    Versand geändert haben (oder force=True). Gibt zurück, was passiert ist:
    'unchanged', 'disabled', 'sent' oder 'error'."""
    with _lock:
        top = jobs.queue(conn, limit=config["DISCORD_TOP_N"])
        current = snapshot(top)
        if not force and current == db.get_state(conn, LAST_TOP_KEY, "[]"):
            return "unchanged"
        webhook = config["DISCORD_WEBHOOK_URL"]
        if not webhook:
            return "disabled"
        try:
            post_webhook(webhook, build_payload(top, config["PUBLIC_URL"]))
        except Exception as exc:
            log.warning("Discord-Versand fehlgeschlagen: %s", exc)
            db.set_state(conn, LAST_ERROR_KEY, f"{jobs.now()}|{exc}")
            return "error"
        db.set_state(conn, LAST_TOP_KEY, current)
        db.set_state(conn, LAST_SENT_KEY, jobs.now())
        db.set_state(conn, LAST_ERROR_KEY, "")
        return "sent"


def status(conn, config):
    error = db.get_state(conn, LAST_ERROR_KEY, "")
    error_at, _, error_msg = error.partition("|") if error else ("", "", "")
    return {
        "configured": bool(config["DISCORD_WEBHOOK_URL"]),
        "top_n": config["DISCORD_TOP_N"],
        "last_sent_at": db.get_state(conn, LAST_SENT_KEY),
        "error_at": error_at,
        "error": error_msg,
    }
