# 🖨️ 3D-Druck-Warteschlange

Eine kleine Website, über die Familie und Freunde 3D-Druckaufträge einreichen
können. Jede neue Anfrage wird dir **sofort per Discord gemeldet**, du gibst sie
frei, sortierst die Warteschlange, und die **obersten 3 Aufträge** landen
automatisch in deinem **Discord-Kanal** – aber **nur, wenn sich an ihnen etwas
ändert**.

Läuft mit **Node.js** (ab Version 18), z. B. direkt in **Plesk**. Alle Aufträge –
neue Anfragen, Warteschlange, Archiv – liegen in einer **MariaDB/MySQL-Datenbank**
(ohne Datenbank-Einstellungen notfalls in Dateien im Ordner `data/`).

## So funktioniert's

1. **Einreichen** – Die Startseite ist für alle offen, ohne Anmeldung. Dort gibt
   jemand seinen Namen ein und
   - fügt einen **MakerWorld-Link** ein (Titel darf dann leer bleiben), oder
   - beschreibt ohne Link, was gedruckt werden soll. Solche Aufträge sind überall
     mit **„kein Link“** markiert: Das Modell musst du selbst besorgen oder erstellen.

   Dazu kommen Anzahl, Farbe/Material und Wünsche. Du bekommst sofort eine
   Discord-Nachricht „Neue Anfrage – wartet auf deine Freigabe“ mit Link.
   Öffentlich sichtbar wird die Anfrage erst, wenn du sie freigegeben hast.
2. **Freigeben** – Im Admin-Bereich (Anmeldung mit Benutzername und Passwort)
   siehst du ganz oben alle offenen Anfragen und
   kannst sie **freigeben**, **bearbeiten** (z. B. selbst einen Link nachtragen
   oder eine Notiz wie „PETG, 0,2 mm“ dazuschreiben) oder **ablehnen**.
3. **Warteschlange** – Freigegebene Aufträge werden hinten angehängt. Mit
   ⤒ ↑ ↓ ⤓ änderst du die Reihenfolge, mit **✓ Gedruckt** ist ein Auftrag fertig.
   Eigene Aufträge kannst du direkt in die Warteschlange legen.
4. **Discord** – Nach jeder Änderung wird geprüft, ob sich die obersten 3
   geändert haben (andere Aufträge, andere Reihenfolge oder geänderte Details).
   Nur dann kommt eine neue Nachricht. Rutscht z. B. ein neuer Auftrag auf
   Platz 5, bleibt Discord ruhig.
5. **Konten** – Jeder, der im Admin-Bereich helfen soll, bekommt ein eigenes Konto
   (Menü **Konten**). Passwörter werden nur verschlüsselt (als scrypt-Hash)
   gespeichert; nach 5 falschen Versuchen ist ein Konto 5 Minuten gesperrt.
6. **Verlauf** – Im Menü **Verlauf** steht, wer wann was gemacht hat: neue
   Anfragen, Freigaben, Gedrucktes, Löschungen, Anmeldungen, Kontoänderungen.

## Druck-Archiv

Unter **Archiv** (oben im Menü, sobald du als Admin angemeldet bist) findest du
alles, was du je gedruckt hast:

- **Automatisch:** Jeder Auftrag, den du mit **✓ Gedruckt** abhakst, landet dort.
- **Suchen:** Das Suchfeld filtert schon beim Tippen – über Titel, Person, Farbe,
  Wünsche, deine Notizen, Link und Datum (z. B. „2025“ oder „Dezember“). Umlaute
  sind egal: „krauter“ findet auch „Kräuterschilder“. Mehrere Wörter grenzen
  weiter ein („oma drache“).
- **Filtern & sortieren:** nach Person, neueste/älteste zuerst, nach Titel.
- **Nochmal drucken:** legt eine Kopie mit einem Klick hinten in die Warteschlange –
  der Eintrag im Archiv bleibt.
- **➕ Druck eintragen:** für alles, was nicht über die Warteschlange lief – z. B.
  was du für dich selbst druckst, oder ältere Drucke von früher. Einzeln mit Datum,
  oder viele MakerWorld-Links auf einmal (einer pro Zeile). Titel, Datum, Bild und
  Notizen lassen sich jederzeit unter **Bearbeiten** ändern.
- **⬇️ HTML mit Suche:** lädt eine einzige HTML-Datei mit **allen** Drucken
  herunter. Die Datei bringt Suche, Personenfilter und Sortierung selbst mit und
  funktioniert auch ohne Internet und ohne Server – einfach doppelklicken, im
  Browser öffnen, weitergeben oder ausdrucken.
- **⬇️ CSV:** lädt die aktuelle Auswahl als Tabelle herunter – öffnet sich direkt in
  Excel oder LibreOffice.

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
| `ADMIN_PASSWORD` | Einrichtungs-Code für dein erstes Konto (**Pflicht** beim ersten Start, danach nicht mehr nötig) |
| `DISCORD_WEBHOOK_URL` | die Webhook-URL aus Schritt 1 |
| `PUBLIC_URL` | z. B. `https://druck.deine-domain.de` (empfohlen: dann kommst du aus Discord mit einem Klick zur Freigabe) |
| `COOKIE_SECURE` | `true`, sobald HTTPS aktiv ist |
| `DISCORD_PING_USER_ID` | optional: deine Discord-Benutzer-ID – dann wirst du bei neuen Anfragen angepingt und bekommst sicher eine Push-Nachricht |
| `DISCORD_WEBHOOK_URL_ANFRAGEN` | optional: eigener Webhook, falls neue Anfragen in einen anderen Kanal sollen |
| `DB_HOST` | `localhost` |
| `DB_PORT` | `3306` |
| `DB_NAME` | Name der Datenbank (Plesk → **Datenbanken**) |
| `DB_USER` | Datenbank-Benutzer (Plesk → Datenbanken → **Benutzerverwaltung**) |
| `DB_PASSWORD` | Passwort dieses Datenbank-Benutzers |

Deine Benutzer-ID findest du so: Discord → Einstellungen → Erweitert →
**Entwicklermodus** einschalten, dann Rechtsklick auf deinen Namen → **Benutzer-ID
kopieren**.

**Datenbank:** Die App legt beim ersten Start selbst ihre Tabellen an:
`druck_auftraege` (alle Aufträge), `druck_nutzer` (Konten), `druck_verlauf` (wer hat
was gemacht) und `druck_zustand` (interne Merker, z. B. was zuletzt an Discord
ging). Andere Tabellen in der Datenbank werden nicht angefasst.
Hattest du vorher schon Aufträge in `data/auftraege.json`, werden sie beim ersten
Start automatisch übernommen; die Datei heißt danach `auftraege.json.importiert`.
In **phpMyAdmin** (Plesk → Datenbanken) kannst du alles ansehen.

Weitere, seltener gebrauchte Einstellungen stehen in `.env.example`. Statt in
Plesk kannst du die Werte auch in eine Datei `.env` im Anwendungsstamm schreiben
(Vorlage: `.env.example`).

### 6. Starten und erstes Konto anlegen

**Node.js aktivieren** bzw. **App neu starten** klicken, dann die Domain im
Browser öffnen und oben auf **Anmelden** klicken. Solange es noch kein Konto gibt,
kommst du zur **Ersteinrichtung**: Als Einrichtungs-Code gibst du dein
`ADMIN_PASSWORD` ein, dazu Benutzername, Name und dein neues Passwort. Danach
brauchst du `ADMIN_PASSWORD` nicht mehr und kannst es in Plesk löschen.

Statt der Ersteinrichtung im Browser geht auch der npm-Befehl `passwort tim` –
er legt das Konto `tim` an und zeigt dir das Passwort.

Zum Test unten bei „Discord“ auf **Jetzt an Discord senden** klicken – dann siehst
du sofort, ob der Webhook funktioniert.

### Updates

Einfach den npm-Befehl **`aktualisieren`** ausführen (siehe unten). Er holt die
neueste Version von GitHub, installiert neue Pakete und startet die App neu – deine
Daten, `data/` und `.env` bleiben unberührt.

Die Aufträge liegen in der Datenbank; für Sicherungen nutze in Plesk **Sichern &
Wiederherstellen** oder den Export in phpMyAdmin. Den Ordner `data/` nicht löschen
(dort liegt der Schlüssel für die Logins).

## Befehle für Plesk (npm)

In Plesk bei der Domain → **Node.js** → **Skript ausführen** (Run script) den
Befehl eintragen, z. B. `pruefen`, und ausführen. Die Ausgabe zeigt Plesk direkt an.

| Befehl | Was er macht |
| --- | --- |
| `aktualisieren` | Neueste Version von GitHub holen und einspielen, Pakete installieren, App neu starten. Mit `aktualisieren main` von einem anderen Branch. |
| `pruefen` | Prüft alles: Node-Version, Datenbank-Verbindung, Discord-Webhook, Konten, Anzahl der Aufträge – und sagt, was fehlt. Zeigt keine Passwörter. |
| `passwort tim` | Setzt für das Konto `tim` ein neues, zufälliges Passwort (und hebt eine Sperre auf) – oder legt das Konto an, falls es das noch nicht gibt: `passwort tim Tim Schmidt`. Das Passwort steht in der Ausgabe; danach unter **Konten** ändern. |
| `einstellen` | Zeigt die Werte aus der Datei `.env` (Passwörter verdeckt). Mit `einstellen DB_NAME=abc DB_USER=abc` trägst du Werte ein, mit `einstellen NAME=` entfernst du einen. Nur nötig, falls Plesk die Umgebungsvariablen an npm-Befehle nicht weitergibt (`pruefen` sagt dir das). |

## Ohne Plesk

```bash
npm install
ADMIN_PASSWORD=… DISCORD_WEBHOOK_URL=… npm start   # läuft auf Port 3000 (oder $PORT)
```

## Hinweise

- **Spam-Schutz:** Weil die Startseite offen ist, hat das Formular ein
  unsichtbares Fangfeld für Bots, muss mindestens 2 Sekunden offen sein, bevor es
  abgeschickt wird, und nimmt keine neuen Anfragen mehr an, wenn schon 50 auf
  Freigabe warten (einstellbar mit `MIN_FORM_SECONDS` und `MAX_PENDING`).
- **Passwort vergessen oder ausgesperrt?** npm-Befehl `passwort <benutzername>`
  ausführen – das neue Passwort steht in der Ausgabe. Oder jemand anderes mit
  Konto setzt dir unter **Konten** ein neues.
- **„Datenbank nicht erreichbar“?** Die Seite nennt den Grund (falsches Passwort,
  Datenbank gibt es nicht, Server nicht erreichbar …). Steht dort, dass Benutzer
  oder Passwort nicht stimmen, obwohl sie richtig sind, probier `DB_HOST=127.0.0.1`
  – oder trag unter `DB_SOCKET` die Socket-Datei ein (meist
  `/var/run/mysqld/mysqld.sock` oder `/var/lib/mysql/mysql.sock`).

- **MakerWorld-Infos:** Beim Einreichen versucht die App, Titel und Vorschaubild
  von der MakerWorld-Seite zu laden. Blockiert MakerWorld das (Bot-Schutz),
  heißt der Auftrag einfach „MakerWorld-Modell 12345“ – Titel und Vorschaubild
  kannst du jederzeit unter **Bearbeiten** ändern.
- **Nachrichten ohne Kästen (Embeds)?** Dann fehlt im Discord-Kanal die
  Berechtigung **„Links einbetten“** für `@everyone` (Webhooks nutzen deren
  Rechte), oder in deiner Discord-App ist unter Einstellungen → Chat
  **„Eingebettete Inhalte und Link-Vorschauen anzeigen“** ausgeschaltet.
- **Discord nicht erreichbar?** Dann steht im Admin-Bereich unter „Discord“ der
  Fehler. Beim nächsten Klick wird automatisch neu versucht, oder du drückst
  **Jetzt an Discord senden**.
- In Discord werden keine `@everyone`-/`@here`-Erwähnungen aus Namen oder
  Notizen ausgelöst.

## Entwicklung

```bash
npm install
npm test                  # schnell, mit Datei-Speicher
TEST_DB=mysql://benutzer:passwort@127.0.0.1:3306/testdatenbank npm test   # alles gegen MariaDB
```

Mit `TEST_DB` laufen alle Tests zusätzlich gegen eine echte MariaDB; jeder Test
legt dabei eigene Tabellen an und löscht sie danach wieder.
