import secrets

from flask import (Blueprint, current_app, flash, redirect, render_template,
                   request, session, url_for)

from .. import forms, jobs
from ..db import get_db

bp = Blueprint("public", __name__)


def family_access():
    password = current_app.config["FAMILY_PASSWORD"]
    return not password or session.get("family") or session.get("admin")


@bp.before_request
def require_family_access():
    if request.endpoint != "public.zugang" and not family_access():
        return redirect(url_for("public.zugang"))


def render_index(values=None, status=200):
    conn = get_db()
    return render_template(
        "index.html",
        values=values or {"requester": session.get("name", ""), "quantity": 1},
        pending=jobs.pending(conn),
        queue=jobs.queue(conn),
        done=[j for j in jobs.finished(conn, limit=10) if j["status"] == "done"],
        top_n=current_app.config["DISCORD_TOP_N"],
    ), status


@bp.get("/")
def index():
    return render_index()


@bp.post("/auftrag")
def submit():
    # Unsichtbares Feld: Bots füllen es aus, Menschen nicht.
    if request.form.get("website"):
        return redirect(url_for(".index"))

    values, errors = forms.parse_job_form(request.form)
    if errors:
        for error in errors:
            flash(error, "error")
        return render_index(values, status=400)

    forms.complete_from_makerworld(values, current_app.config["FETCH_MAKERWORLD_INFO"])
    jobs.create(get_db(), **values)
    session["name"] = values["requester"]
    session.permanent = True
    flash(f"Danke! Dein Auftrag „{values['title']}“ ist eingegangen "
          "und wartet jetzt auf Genehmigung.", "success")
    return redirect(url_for(".index"))


@bp.route("/zugang", methods=["GET", "POST"])
def zugang():
    if family_access():
        return redirect(url_for(".index"))
    if request.method == "POST":
        expected = current_app.config["FAMILY_PASSWORD"].encode()
        if secrets.compare_digest(request.form.get("password", "").encode(), expected):
            session["family"] = True
            session.permanent = True
            return redirect(url_for(".index"))
        flash("Das Passwort stimmt nicht.", "error")
    return render_template("zugang.html")
