from app import db, discord, jobs, makerworld


def rows(app, status):
    conn = db.connect(app.config["DATABASE"])
    try:
        if status == "queued":
            return jobs.queue(conn)
        return conn.execute("SELECT * FROM jobs WHERE status = ?", (status,)).fetchall()
    finally:
        conn.close()


def titles(app):
    return [r["title"] for r in rows(app, "queued")]


def job_id(app, title):
    conn = db.connect(app.config["DATABASE"])
    try:
        return conn.execute("SELECT id FROM jobs WHERE title = ?", (title,)).fetchone()["id"]
    finally:
        conn.close()


def top_titles(payload):
    return [e["title"] for e in payload["embeds"]]


# --- Einreichen -------------------------------------------------------------

def test_submit_creates_pending_job(app, client, sent):
    resp = client.submit(title="Handyhalter", color="Rot", notes="fürs Auto")
    assert resp.status_code == 302
    [job] = rows(app, "pending")
    assert job["title"] == "Handyhalter"
    assert job["requester"] == "Oma"
    assert job["makerworld_url"] is None
    page = client.get("/").get_data(as_text=True)
    assert "Handyhalter" in page and "Wartet auf Genehmigung" in page
    assert sent == []  # Anfragen allein lösen nichts in Discord aus


def test_submit_with_makerworld_link_only(app, client):
    client.submit(makerworld_url="makerworld.com/de/models/123456-benchy")
    [job] = rows(app, "pending")
    assert job["title"] == "MakerWorld-Modell 123456"
    assert job["makerworld_url"] == "https://makerworld.com/de/models/123456-benchy"


def test_submit_requires_title_or_link(app, client):
    resp = client.submit()
    assert resp.status_code == 400
    assert "was gedruckt werden soll" in resp.get_data(as_text=True)
    assert rows(app, "pending") == []


def test_submit_rejects_bad_links(app, client):
    resp = client.submit(title="x", makerworld_url="javascript:alert(1)")
    assert resp.status_code == 400
    assert rows(app, "pending") == []


def test_honeypot_is_ignored(app, client):
    client.submit(title="Spam", website="http://spam.example")
    assert rows(app, "pending") == []


def test_post_without_csrf_token_is_rejected(app, client):
    resp = client.c.post("/auftrag", data={"requester": "Oma", "title": "x"})
    assert resp.status_code == 400
    assert rows(app, "pending") == []


# --- Zugang -----------------------------------------------------------------

def test_admin_requires_login(app, client):
    assert client.get("/admin/").status_code == 302
    resp = client.post("/admin/login", {"password": "falsch"})
    assert "Falsches Passwort" in resp.get_data(as_text=True)
    resp = client.post("/admin/login", {"password": "geheim"})
    assert resp.status_code == 302
    assert client.get("/admin/").status_code == 200


def test_family_password_gate(app, client):
    app.config["FAMILY_PASSWORD"] = "familie"
    assert client.get("/").headers["Location"].endswith("/zugang")
    assert client.submit(title="x").status_code == 302
    assert rows(app, "pending") == []
    client.post("/zugang", {"password": "familie"})
    assert client.get("/").status_code == 200


# --- Genehmigen & Warteschlange ----------------------------------------------

def approve_all(app, admin, *names):
    for name in names:
        admin.submit(title=name)
        admin.post(f"/admin/auftrag/{job_id(app, name)}/approve")


def test_discord_only_when_top3_changes(app, admin, sent):
    approve_all(app, admin, "A", "B", "C")
    assert [top_titles(p) for p in sent] == [["1. A"], ["1. A", "2. B"], ["1. A", "2. B", "3. C"]]

    approve_all(app, admin, "D", "E")  # landen auf Platz 4 und 5
    assert len(sent) == 3

    admin.post(f"/admin/auftrag/{job_id(app, 'E')}/up")  # tauscht Platz 4 und 5
    assert titles(app) == ["A", "B", "C", "E", "D"]
    assert len(sent) == 3

    admin.post(f"/admin/auftrag/{job_id(app, 'D')}/top")
    assert titles(app) == ["D", "A", "B", "C", "E"]
    assert top_titles(sent[-1]) == ["1. D", "2. A", "3. B"]

    admin.post(f"/admin/auftrag/{job_id(app, 'D')}/done")
    assert titles(app) == ["A", "B", "C", "E"]
    assert top_titles(sent[-1]) == ["1. A", "2. B", "3. C"]
    assert len(sent) == 5

    admin.post(f"/admin/auftrag/{job_id(app, 'E')}/delete")
    assert len(sent) == 5


def test_rejecting_pending_job_sends_nothing(app, admin, sent):
    admin.submit(title="Nope")
    admin.post(f"/admin/auftrag/{job_id(app, 'Nope')}/reject")
    assert rows(app, "rejected")[0]["title"] == "Nope"
    assert sent == []


def test_editing_top_job_resends(app, admin, sent):
    approve_all(app, admin, "A")
    jid = job_id(app, "A")
    admin.post(f"/admin/auftrag/{jid}/bearbeiten", {
        "requester": "Oma", "title": "A", "quantity": "2", "admin_note": "PETG",
    })
    assert len(sent) == 2
    assert "2×" in sent[-1]["embeds"][0]["description"]
    assert "PETG" in sent[-1]["embeds"][0]["description"]


def test_admin_can_add_own_job_directly(app, admin, sent):
    admin.post("/admin/auftrag/neu", {"requester": "Ich", "title": "Eigenes Teil"})
    assert titles(app) == ["Eigenes Teil"]
    assert len(sent) == 1


def test_restore_and_unapprove(app, admin):
    approve_all(app, admin, "A", "B")
    admin.post(f"/admin/auftrag/{job_id(app, 'A')}/done")
    admin.post(f"/admin/auftrag/{job_id(app, 'A')}/restore")
    assert titles(app) == ["B", "A"]
    admin.post(f"/admin/auftrag/{job_id(app, 'B')}/unapprove")
    assert titles(app) == ["A"]
    assert [r["title"] for r in rows(app, "pending")] == ["B"]


def test_invalid_state_transition_is_refused(app, admin):
    admin.submit(title="A")
    admin.post(f"/admin/auftrag/{job_id(app, 'A')}/done")
    assert rows(app, "pending")[0]["title"] == "A"


# --- Discord ----------------------------------------------------------------

def test_discord_failure_is_retried_on_next_change(app, admin, sent, monkeypatch):
    def boom(url, payload):
        raise RuntimeError("Discord antwortete mit 500")

    monkeypatch.setattr(discord, "post_webhook", boom)
    approve_all(app, admin, "A")
    page = admin.get("/admin/").get_data(as_text=True)
    assert "Discord antwortete mit 500" in page

    monkeypatch.setattr(discord, "post_webhook", lambda url, payload: sent.append(payload))
    approve_all(app, admin, "B")
    assert top_titles(sent[-1]) == ["1. A", "2. B"]
    assert "Discord antwortete" not in admin.get("/admin/").get_data(as_text=True)


def test_manual_send_forces_message(app, admin, sent):
    approve_all(app, admin, "A")
    admin.post("/admin/discord/senden")
    assert len(sent) == 2


def test_no_webhook_configured(app, admin, sent):
    app.config["DISCORD_WEBHOOK_URL"] = ""
    approve_all(app, admin, "A")
    assert sent == []


def test_payload_format():
    job = {
        "id": 1, "title": "Vase", "requester": "@everyone", "makerworld_url": None,
        "image_url": None, "quantity": 1, "color": None, "notes": "**fett**", "admin_note": None,
    }
    payload = discord.build_payload([job], "https://druck.example")
    assert payload["allowed_mentions"] == {"parse": []}
    embed = payload["embeds"][0]
    assert embed["title"] == "1. Vase"
    assert "Kein MakerWorld-Link" in embed["description"]
    assert "\\*\\*fett\\*\\*" in embed["description"]
    assert "https://druck.example/admin" in payload["content"]
    assert "leer" in discord.build_payload([], "")["content"]


# --- MakerWorld -------------------------------------------------------------

def test_parse_makerworld_page():
    html = """<html><head><title>ignored</title>
      <meta property="og:title" content="Articulated Dragon - Free 3D Print Model - MakerWorld">
      <meta property="og:image" content="https://makerworld.bblmw.com/makerworld/model/x.jpg">
    </head></html>"""
    assert makerworld.parse_page(html) == {
        "title": "Articulated Dragon",
        "image_url": "https://makerworld.bblmw.com/makerworld/model/x.jpg",
    }


def test_makerworld_helpers():
    assert makerworld.is_makerworld("https://makerworld.com/de/models/1")
    assert makerworld.is_makerworld("https://www.makerworld.com/models/1")
    assert not makerworld.is_makerworld("https://makerworld.com.evil.example/models/1")
    assert makerworld.model_id("https://makerworld.com/de/models/987-foo#profileId-1") == "987"
    assert makerworld.fetch_info("https://example.com/") == {"title": None, "image_url": None}
