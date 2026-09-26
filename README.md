# 🖨️ 3D-Druck-Warteschlange

Eine kleine Website, über die Familie und Freunde 3D-Druckaufträge einreichen
können. Du genehmigst jeden Auftrag, sortierst die Warteschlange, und die
**obersten 3 Aufträge** werden automatisch in deinen **Discord-Kanal**
geschickt – aber **nur, wenn sich an ihnen etwas ändert**.

## So funktioniert's

1. **Einreichen** – Auf der Startseite gibt jemand seinen Namen ein und
   - fügt einen **MakerWorld-Link** ein (Titel darf dann leer bleiben), oder
   - beschreibt ohne Link, was gedruckt werden soll. Solche Aufträge sind überall
     mit **„kein Link“** markiert, damit du weißt: Das Modell musst du selbst
     besorgen oder erstellen.
   Dazu kommen noch Anzahl, Farbe/Material und Wünsche.
2. **Genehmigen** – Unter `/admin` siehst du alle neuen Anfragen und kannst sie
   **genehmigen**, **bearbeiten** (z. B. selbst einen Link nachtragen oder eine
   Notiz wie „PETG, 0,2 mm“ dazuschreiben) oder **ablehnen**.
3. **Warteschlange** – Genehmigte Aufträge werden hinten angehängt. Mit
   ⤒ ↑ ↓ ⤓ änderst du die Reihenfolge, mit **✓ Gedruckt** ist ein Auftrag fertig.
   Du kannst auch eigene Aufträge direkt in die Warteschlange legen.
4. **Discord** – Nach jeder Änderung wird geprüft, ob sich die obersten 3
   geändert haben (andere Aufträge, andere Reihenfolge oder geänderte Details).
   Nur dann kommt eine neue Nachricht. Rutscht zum Beispiel ein neuer Auftrag
   auf Platz 5, bleibt Discord ruhig.

Die Familie sieht auf der Startseite die aktuelle Warteschlange, was noch auf
Genehmigung wartet, und was zuletzt gedruckt wurde.

## Einrichten

### 1. Discord-Webhook anlegen

In Discord: Rechtsklick auf den gewünschten Kanal → **Kanal bearbeiten** →
**Integrationen** → **Webhooks** → **Neuer Webhook** → **Webhook-URL kopieren**.

### 2. Konfiguration

```bash
cp .env.example .env
```

In der `.env` mindestens `ADMIN_PASSWORD` und `DISCORD_WEBHOOK_URL` eintragen.
Wenn die Seite aus dem Internet erreichbar ist, solltest du außerdem ein
`FAMILY_PASSWORD` setzen – dann muss man es einmal pro Gerät eingeben, bevor man
etwas sehen oder einreichen kann.

| Variable | Bedeutung |
| --- | --- |
| `ADMIN_PASSWORD` | Passwort für `/admin` (Pflicht) |
| `FAMILY_PASSWORD` | Optionales Passwort für die Familie; leer = offen |
| `DISCORD_WEBHOOK_URL` | Webhook-URL des Discord-Kanals |
| `DISCORD_TOP_N` | Wie viele Aufträge gemeldet werden (Standard `3`) |
| `PUBLIC_URL` | Adresse der Seite; dann steht ein Link zu `/admin` in der Discord-Nachricht |
| `COOKIE_SECURE` | `true`, wenn die Seite nur über HTTPS läuft |
| `FETCH_MAKERWORLD_INFO` | Titel & Vorschaubild automatisch von MakerWorld laden (`true`/`false`) |
| `TIMEZONE` | Zeitzone für die Anzeige (Standard `Europe/Berlin`) |

### 3. Starten mit Docker (empfohlen)

```bash
docker compose up -d --build
```

Die Seite läuft dann auf `http://<dein-server>:8000`. Die Daten (SQLite-Datenbank)
liegen im Docker-Volume `daten` und überleben Updates und Neustarts.

Update auf eine neue Version:

```bash
git pull
docker compose up -d --build
```

### Alternativ: ohne Docker

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
set -a; . ./.env; set +a
gunicorn --workers 1 --threads 4 --bind 0.0.0.0:8000 "app:create_app()"
```

Die Daten landen dann im Ordner `data/`. Bitte immer **nur einen Worker**
verwenden – so kann es nie zu doppelten Discord-Nachrichten kommen.

### Von außen erreichbar machen

Damit die Familie auch von unterwegs Aufträge einreichen kann, brauchst du einen
Weg ins Internet, z. B. einen **Cloudflare Tunnel**, **Tailscale Funnel** oder
einen Reverse-Proxy (Caddy, Nginx Proxy Manager …) mit HTTPS. Dann
`COOKIE_SECURE=true` und `PUBLIC_URL=https://…` setzen und ein
`FAMILY_PASSWORD` vergeben.

## Hinweise

- **MakerWorld-Infos:** Beim Einreichen versucht die App, Titel und Vorschaubild
  von der MakerWorld-Seite zu laden. Blockiert MakerWorld das (Bot-Schutz),
  heißt der Auftrag einfach „MakerWorld-Modell 12345“ – du kannst den Titel und
  ein Vorschaubild jederzeit unter **Bearbeiten** ändern.
- **Discord nicht erreichbar?** Dann steht im Admin-Bereich unter „Discord“ der
  Fehler. Beim nächsten Klick wird automatisch neu versucht, oder du drückst
  **Jetzt an Discord senden**.
- In Discord werden keine `@everyone`-/`@here`-Erwähnungen aus Namen oder
  Notizen ausgelöst.

## Entwicklung

```bash
pip install -r requirements-dev.txt
pytest
flask --app app run --debug   # mit ADMIN_PASSWORD=… in der Umgebung
```
