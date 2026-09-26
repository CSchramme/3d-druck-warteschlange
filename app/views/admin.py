import secrets
import time
from functools import partial

from flask import (Blueprint, abort, current_app, flash, redirect,
                   render_template, request, session, url_for)

from .. import discord, forms, jobs
from ..db import get_db

bp = Blueprint("admin", __name__, url_prefix="/admin")

# aktion -> (funktion, meldung, erlaubte status)
ACTIONS = {
    "approve": (jobs.enqueue, "„{title}“ ist genehmigt und steht jetzt in der Warteschlange.", {"pending"}),
    "reject": (jobs.reject, "„{title}“ wurde abgelehnt.", {"pending", "queued"}),
    "done": (jobs.mark_done, "„{title}“ ist als gedruckt markiert. 🎉", {"queued"}),
    "restore": (jobs.enqueue, "„{title}“ steht wieder in der Warteschlange.", {"done", "rejected"}),
    "unapprove": (jobs.back_to_pending, "„{title}“ wartet wieder auf Genehmigung.", {"queued"}),
    "up": (partial(jobs.move, direction="up"), None, {"queued"}),
    "down": (partial(jobs.move, direction="down"), None, {"queued"}),
    "top": (partial(jobs.move, direction="top"), None, {"queued"}),
    "bottom": (partial(jobs.move, direction="bottom"), None, {"queued"}),
    "delete": (jobs.delete, "„{title}“ wurde gelöscht.", {"pending", "queued", "done", "rejected"}),
}


@bp.before_request
def require_admin():
    if request.endpoint != "admin.login" and not session.get("admin"):
        return redirect(url_for("admin.login"))


def sync_discord(force=False):
    result = discord.sync(get_db(), current_app.config, force=force)
    if result == "sent":
        flash("Die aktuellen Top-Aufträge wurden an Discord geschickt.", "info")
    elif result == "error":
        flash("Discord-Versand fehlgeschlagen – Details stehen unten bei „Discord“.", "error")
    elif force and result == "disabled":
        flash("Es ist keine DISCORD_WEBHOOK_URL eingestellt.", "error")


@bp.route("/login", methods=["GET", "POST"])
def login():
    configured = bool(current_app.config["ADMIN_PASSWORD"])
    if request.method == "POST" and configured:
        expected = current_app.config["ADMIN_PASSWORD"].encode()
        if secrets.compare_digest(request.form.get("password", "").encode(), expected):
            session["admin"] = True
            session.permanent = True
            return redirect(url_for(".dashboard"))
        time.sleep(1)  # bremst Passwort-Raten aus
        flash("Falsches Passwort.", "error")
    return render_template("admin/login.html", configured=configured)


@bp.post("/logout")
def logout():
    session.pop("admin", None)
    return redirect(url_for("public.index"))


def render_dashboard(new_values=None, status=200):
    conn = get_db()
    return render_template(
        "admin/dashboard.html",
        pending=jobs.pending(conn),
        queue=jobs.queue(conn),
        finished=jobs.finished(conn),
        discord=discord.status(conn, current_app.config),
        top_n=current_app.config["DISCORD_TOP_N"],
        new_values=new_values or {"requester": session.get("name", ""), "quantity": 1},
        open_new=new_values is not None,
    ), status


@bp.get("/")
def dashboard():
    return render_dashboard()


@bp.post("/auftrag/neu")
def create():
    values, errors = forms.parse_job_form(request.form, admin=True)
    if errors:
        for error in errors:
            flash(error, "error")
        return render_dashboard(values, status=400)
    forms.complete_from_makerworld(values, current_app.config["FETCH_MAKERWORLD_INFO"])
    conn = get_db()
    job_id = jobs.create(conn, **{k: v for k, v in values.items() if k != "admin_note"})
    jobs.update(conn, job_id, {"admin_note": values["admin_note"]})
    jobs.enqueue(conn, job_id)
    flash(f"„{values['title']}“ steht jetzt hinten in der Warteschlange.", "success")
    sync_discord()
    return redirect(url_for(".dashboard", _anchor=f"auftrag-{job_id}"))


@bp.post("/auftrag/<int:job_id>/<action>")
def job_action(job_id, action):
    if action not in ACTIONS:
        abort(404)
    conn = get_db()
    job = jobs.get(conn, job_id) or abort(404)
    func, message, allowed = ACTIONS[action]
    if job["status"] not in allowed:
        flash("Das geht bei diesem Auftrag gerade nicht.", "error")
        return redirect(url_for(".dashboard"))
    func(conn, job_id)
    if message:
        flash(message.format(title=job["title"]), "success")
    sync_discord()
    anchor = "warteschlange" if action == "delete" else f"auftrag-{job_id}"
    return redirect(url_for(".dashboard", _anchor=anchor))


@bp.route("/auftrag/<int:job_id>/bearbeiten", methods=["GET", "POST"])
def edit(job_id):
    conn = get_db()
    job = jobs.get(conn, job_id) or abort(404)
    if request.method == "POST":
        values, errors = forms.parse_job_form(request.form, admin=True)
        if errors:
            for error in errors:
                flash(error, "error")
            return render_template("admin/edit.html", job=job, values=values), 400
        link_changed = values["makerworld_url"] != job["makerworld_url"]
        if link_changed and values["image_url"] == job["image_url"]:
            values["image_url"] = None  # altes Vorschaubild gehört zum alten Link
        if link_changed or not values["title"]:
            forms.complete_from_makerworld(values, current_app.config["FETCH_MAKERWORLD_INFO"])
        jobs.update(conn, job_id, values)
        flash("Änderungen gespeichert.", "success")
        sync_discord()
        return redirect(url_for(".dashboard", _anchor=f"auftrag-{job_id}"))
    return render_template("admin/edit.html", job=job, values=dict(job))


@bp.post("/discord/senden")
def discord_send():
    sync_discord(force=True)
    return redirect(url_for(".dashboard", _anchor="discord"))
