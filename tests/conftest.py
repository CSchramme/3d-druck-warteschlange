import pytest

from app import create_app, discord

CSRF = "test-csrf-token"


@pytest.fixture
def sent(monkeypatch):
    """Fängt alle Discord-Nachrichten ab, statt sie zu verschicken."""
    messages = []
    monkeypatch.setattr(discord, "post_webhook", lambda url, payload: messages.append(payload))
    return messages


@pytest.fixture
def app(tmp_path, sent):
    return create_app({
        "TESTING": True,
        "SECRET_KEY": "test",
        "DATA_DIR": tmp_path,
        "DATABASE": str(tmp_path / "test.db"),
        "ADMIN_PASSWORD": "geheim",
        "FAMILY_PASSWORD": "",
        "DISCORD_WEBHOOK_URL": "https://discord.example/api/webhooks/1/abc",
        "DISCORD_TOP_N": 3,
        "FETCH_MAKERWORLD_INFO": False,
    })


class Client:
    def __init__(self, flask_client):
        self.c = flask_client
        with self.c.session_transaction() as s:
            s["csrf"] = CSRF

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, data=None, **kw):
        return self.c.post(url, data={"csrf_token": CSRF, **(data or {})}, **kw)

    def login_admin(self):
        with self.c.session_transaction() as s:
            s["admin"] = True

    def submit(self, **fields):
        data = {"requester": "Oma", "quantity": "1", **fields}
        return self.post("/auftrag", data)


@pytest.fixture
def client(app):
    return Client(app.test_client())


@pytest.fixture
def admin(app):
    c = Client(app.test_client())
    c.login_admin()
    return c
