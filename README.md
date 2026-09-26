# 🖨️ 3D-Druck-Warteschlange

Eine kleine Website, über die Familie und Freunde 3D-Druckaufträge einreichen
können. Du genehmigst jeden Auftrag, sortierst die Warteschlange, und die
**obersten 3 Aufträge** werden automatisch in deinen **Discord-Kanal**
geschickt – aber **nur, wenn sich an ihnen etwas ändert**.

Läuft mit **Node.js** (ab Version 18), z. B. direkt in **Plesk**. Es wird keine
Datenbank gebraucht – alles liegt in kleinen Dateien im Ordner `data/`.

## So funktioniert's

1. **Einreichen** – Auf der Startseite gibt jemand seinen Namen ein und
   - fügt einen **MakerWorld-Link** ein (Titel darf dann leer bleiben), oder
   - beschreibt ohne Link, was gedruckt werden soll. Solche Aufträge sind überall
     mit **„kein Link“** markiert: Das Modell musst du selbst besorgen oder erstellen.

   Dazu kommen Anzahl, Farbe/Material und Wünsche.
2. **Genehmigen** – Unter `/admin` siehst du alle neuen Anfragen und kannst sie
   **genehmigen**, **bearbeiten** (z. B. selbst einen Link nachtragen oder eine
   Notiz wie „PETG, 0,2 mm“ dazuschreiben) oder **ablehnen**.
3. **Warteschlange** – Genehmigte Aufträge werden hinten angehängt. Mit
   ⤒ ↑ ↓ ⤓ änderst du die Reihenfolge, mit **✓ Gedruckt** ist ein Auftrag fertig.
   Eigene Aufträge kannst du direkt in die Warteschlange legen.
4. **Discord** – Nach jeder Änderung wird geprüft, ob sich die obersten 3
   geändert haben (andere Aufträge, andere Reihenfolge oder geänderte Details).
   Nur dann kommt eine neue Nachricht. Rutscht z. B. ein neuer Auftrag auf
   Platz 5, bleibt Discord ruhig.

## Einrichten in Plesk

### 1. Discord-Webhook anlegen

In Discord: Rechtsklick auf den Kanal → **Kanal bearbeiten** → **Integrationen**
→ **Webhooks** → **Neuer Webhook** → **Webhook-URL kopieren**.

Die URL ist wie ein Passwort: Wer sie hat, kann in deinen Kanal schreiben. Sie
gehört **nie** in den Code oder auf GitHub, sondern nur in die Einstellungen
unten. Falls sie doch mal öffentlich wird: Webhook in Discord löschen und neu
anlegen.

### 2. Domain vorbereiten

Am besten eine eigene Subdomain anlegen, z. B. `druck.deine-domain.de`
(**Websites & Domains → Subdomain hinzufügen**). Unter **SSL/TLS-Zertifikate**
gleich ein kostenloses **Let's Encrypt**-Zertifikat aktivieren.

### 3. Code hochladen

Entweder mit der **Git**-Funktion von Plesk (Repository-URL eintragen, Branch
wählen, in den Ordner der Domain bereitstellen) – oder auf GitHub **Code →
Download ZIP**, dann in Plesk unter **Dateien** in den Ordner der Domain
hochladen und entpacken. Danach sollten dort `app.js`, `package.json`, `src/`
und `public/` liegen.

### 4. Node.js einstellen

In Plesk bei der Domain auf **Node.js** klicken und eintragen:

| Einstellung | Wert |
| --- | --- |
| Node.js-Version | 18 oder neuer (am besten die neueste) |
| Anwendungsmodus (Application Mode) | `production` |
| Anwendungsstamm (Application Root) | der Ordner mit `package.json`, z. B. `/httpdocs` |
| Dokumentenstamm (Document Root) | der Unterordner `public`, z. B. `/httpdocs/public` |
| Anwendungsstartdatei (Startup File) | `app.js` |

Wichtig: Der Dokumentenstamm muss auf `public` zeigen, damit niemand die Daten
oder Einstellungen im Browser abrufen kann.

Dann auf **NPM install** klicken.

> Siehst du den Menüpunkt **Node.js** nicht, muss dein Hoster bzw. Plesk-Admin
> die Node.js-Erweiterung erst freischalten.

### 5. Einstellungen eintragen

Im selben Node.js-Fenster unter **Benutzerdefinierte Umgebungsvariablen**
(Custom environment variables):

| Variable | Wert |
| --- | --- |
| `ADMIN_PASSWORD` | dein Passwort für `/admin` (**Pflicht**) |
| `FAMILY_PASSWORD` | Passwort für die Familie (empfohlen, sonst kann jeder einreichen) |
| `DISCORD_WEBHOOK_URL` | die Webhook-URL aus Schritt 1 |
| `PUBLIC_URL` | z. B. `https://druck.deine-domain.de` (optional, dann ist in Discord ein Link zum Admin-Bereich) |
| `COOKIE_SECURE` | `true`, sobald HTTPS aktiv ist |

Weitere, seltener gebrauchte Einstellungen stehen in `.env.example`. Statt in
Plesk kannst du die Werte auch in eine Datei `.env` im Anwendungsstamm schreiben
(Vorlage: `.env.example`).

### 6. Starten

**Node.js aktivieren** bzw. **App neu starten** klicken, dann die Domain im
Browser öffnen. Unter `/admin` anmelden und unten bei „Discord“ auf **Jetzt an
Discord senden** klicken – dann siehst du sofort, ob der Webhook funktioniert.

### Updates

Neuen Code hochladen (bzw. in Plesk bei Git **Pull** / **Bereitstellen**), dann
**NPM install** und **App neu starten**. Den Ordner `data/` dabei **nicht
löschen** – dort liegen alle Aufträge. Ihn ab und zu zu sichern schadet nicht.

## Ohne Plesk

```bash
npm install
ADMIN_PASSWORD=… DISCORD_WEBHOOK_URL=… npm start   # läuft auf Port 3000 (oder $PORT)
```

## Hinweise

- **MakerWorld-Infos:** Beim Einreichen versucht die App, Titel und Vorschaubild
  von der MakerWorld-Seite zu laden. Blockiert MakerWorld das (Bot-Schutz),
  heißt der Auftrag einfach „MakerWorld-Modell 12345“ – Titel und Vorschaubild
  kannst du jederzeit unter **Bearbeiten** ändern.
- **Discord nicht erreichbar?** Dann steht im Admin-Bereich unter „Discord“ der
  Fehler. Beim nächsten Klick wird automatisch neu versucht, oder du drückst
  **Jetzt an Discord senden**.
- In Discord werden keine `@everyone`-/`@here`-Erwähnungen aus Namen oder
  Notizen ausgelöst.

## Entwicklung

```bash
npm install
npm test
```
