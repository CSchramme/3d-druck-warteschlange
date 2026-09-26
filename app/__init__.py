"""3D-Druck-Warteschlange: Familie reicht Druckaufträge ein, der Admin genehmigt
sie, und die obersten Aufträge der Warteschlange werden an Discord gemeldet."""

import logging
import os
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from flask import Flask, abort, request, session

from . import db, makerworld
from .views import admin, public

log = logging.getLogger(__name__)


def _env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "ja", "on")


def _load_secret_key(data_dir: Path) -> str:
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    # Ohne SECRET_KEY einen zufälligen Schlüssel erzeugen und im Datenordner
    # merken, damit Logins einen Neustart überleben.
    key_file = data_dir / "secret_key"
    if key_file.exists():
        return key_file.read_text().strip()
    key = secrets.token_hex(32)
    key_file.write_text(key)
    key_file.chmod(0o600)
    return key


def create_app(config=None):
    app = Flask(__name__)

    data_dir = Path(os.environ.get("DATA_DIR", "data")).resolve()
    app.config.update(
        DATA_DIR=data_dir,
        DATABASE=str(data_dir / "warteschlange.db"),
        ADMIN_PASSWORD=os.environ.get("ADMIN_PASSWORD", ""),
        FAMILY_PASSWORD=os.environ.get("FAMILY_PASSWORD", ""),
        DISCORD_WEBHOOK_URL=os.environ.get("DISCORD_WEBHOOK_URL", "").strip(),
        DISCORD_TOP_N=int(os.environ.get("DISCORD_TOP_N") or 3),
        PUBLIC_URL=os.environ.get("PUBLIC_URL", "").strip().rstrip("/"),
        TIMEZONE=os.environ.get("TIMEZONE") or "Europe/Berlin",
        FETCH_MAKERWORLD_INFO=_env_bool("FETCH_MAKERWORLD_INFO", True),
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=_env_bool("COOKIE_SECURE", False),
        PERMANENT_SESSION_LIFETIME=timedelta(days=365),
        MAX_CONTENT_LENGTH=64 * 1024,
    )
    if config:
        app.config.update(config)

    Path(app.config["DATA_DIR"]).mkdir(parents=True, exist_ok=True)
    if not app.config.get("SECRET_KEY"):
        app.secret_key = _load_secret_key(Path(app.config["DATA_DIR"]))
    if not app.config["ADMIN_PASSWORD"]:
        log.warning("ADMIN_PASSWORD ist nicht gesetzt – der Admin-Login ist deaktiviert.")

    db.init_app(app)
    app.register_blueprint(public.bp)
    app.register_blueprint(admin.bp)

    tz = ZoneInfo(app.config["TIMEZONE"])

    @app.template_filter("datum")
    def format_datum(value):
        if not value:
            return ""
        return datetime.fromisoformat(value).astimezone(tz).strftime("%d.%m.%Y, %H:%M")

    def csrf_token():
        if "csrf" not in session:
            session["csrf"] = secrets.token_urlsafe(32)
            session.permanent = True  # offene Tabs bleiben auch nach Tagen gültig
        return session["csrf"]

    app.jinja_env.globals["csrf_token"] = csrf_token
    app.jinja_env.globals["is_makerworld"] = makerworld.is_makerworld

    @app.before_request
    def check_csrf():
        if request.method != "POST":
            return
        expected = session.get("csrf")
        sent = request.form.get("csrf_token", "")
        if not expected or not secrets.compare_digest(expected, sent):
            abort(400, "Formular abgelaufen – bitte die Seite neu laden und nochmal versuchen.")

    return app
