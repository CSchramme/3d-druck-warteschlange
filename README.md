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
4. **Discord** – Mit Bot steht die Warteschlange als **eine** Nachricht im Kanal
   (die obersten 3 groß, dahinter die nächsten), die sich bei jeder Änderung
   selbst aktualisiert. Anfrage-Nachrichten zeigen nach dem Freigeben, Ablehnen
   oder Drucken den neuen Stand. Ohne Bot (nur Webhook) kommt eine neue
   Nachricht, sobald sich an den obersten 3 etwas ändert.
5. **Konten** – Jeder, der im Admin-Bereich helfen soll, bekommt ein eigenes Konto
   (Menü **Konten**). Passwörter werden nur verschlüsselt (als scrypt-Hash)
   gespeichert; nach 5 falschen Versuchen ist ein Konto 5 Minuten gesperrt.
6. **Verlauf** – Im Menü **Verlauf** steht, wer wann was gemacht hat: neue
   Anfragen, Freigaben, Gedrucktes, Löschungen, Anmeldungen, Kontoänderungen.

## Als App aufs Handy

Die Seite ist eine richtige Web-App (PWA): mit eigenem Logo, eigenem Symbol auf
dem Home-Bildschirm, ohne Browser-Leiste und mit einer Offline-Seite, wenn mal
kein Internet da ist. Am Handy erscheint unten von selbst ein Hinweis
**„Als App aufs Handy“**:

- **Android (Chrome):** auf **Installieren** tippen – fertig. Ohne Hinweis geht's
  auch über Menü (⋮) → **App installieren**. Langes Drücken aufs App-Symbol
  zeigt Abkürzungen zu *Einreichen*, *Warteschlange* und *Aufträge*.
- **iPhone/iPad (Safari):** auf **Teilen** tippen (bei neuem iOS evtl. erst auf
  „…“) → **Zum Home-Bildschirm**.

Gut zu wissen:

- Die App braucht **HTTPS** (in Plesk: SSL/TLS-Zertifikat, z. B. Let's Encrypt).
- Die App zeigt immer den aktuellen Stand vom Server – gespeichert werden auf dem
  Handy nur Aussehen, Skripte und Logo, keine Aufträge oder Namen.
- Nach `run aktualisieren` holt sich die App die neuen Dateien von selbst.
- Wer den Hinweis wegklickt, sieht ihn 30 Tage lang nicht mehr.

## Wartungsmodus

Im Admin-Bereich unter **Aufträge** ganz unten: Schalter **„Seite für Besucher
schließen“**. Solange er an ist, sehen alle anderen nur eine Wartungsseite mit
deinem Text; Aufträge abschicken geht dann nicht.

- **Wer rein darf:** alle angemeldeten Konten – oder mit **„Nur ich“** nur dein
  Konto.
- **Anmelden während der Wartung:** auf der Wartungsseite oben rechts auf das
  kleine, blasse Schloss tippen – oder direkt `/admin/login` öffnen.
- **Per Internet-Adresse (IP):** Adressen, die im Kasten eingetragen sind, kommen
  auch ohne Anmeldung rein. **„Meine Adresse hinzufügen“** trägt deine aktuelle
  ein (bei IPv6 gleich dein ganzes Heimnetz, weil Geräte den hinteren Teil
  ständig wechseln). Achtung: Zuhause und am Handy ändert sich die Adresse oft –
  das Anmelden ist sicherer. MAC-Adressen gehen nicht: Die verlassen dein
  Heimnetz nie, kein Webserver bekommt sie zu sehen.
- Oben auf jeder Seite erinnert dich ein Hinweis mit **Ausschalten**-Knopf daran,
  dass die Seite gerade zu ist.
- **Notausgang:** Kommst du selbst nicht mehr rein, schaltet der npm-Befehl
  `wartung aus` den Wartungsmodus aus (`wartung` allein zeigt den Stand).

## AGB, Datenschutz & Cookies

Beim ersten Besuch sieht jeder – auch Admins – einen kurzen Dialog: **Cookies &
AGB akzeptieren**. Erst danach lässt sich die Seite benutzen und ein Auftrag
abschicken. Unten auf jeder Seite stehen die Links **AGB** und **Datenschutz &
Cookies**.

- Die Seite setzt nur ein technisch notwendiges Cookie (Formularschutz,
  Anmeldung, die Zustimmung selbst) – kein Tracking.
- Texte ändern: **Konten** → **AGB & Datenschutz** → **Texte bearbeiten**. Mit
  dem Haken **„Alle müssen neu zustimmen“** sieht jeder beim nächsten Besuch den
  Dialog wieder; ohne Haken (z. B. bei Tippfehlern) gelten die bisherigen
  Zustimmungen weiter.
- **Wichtig:** Ganz unten im Datenschutz-Hinweis deinen Namen und eine
  Kontaktmöglichkeit eintragen – bis dahin erinnert dich der Admin-Bereich daran.
- Die mitgelieferten Texte sind eine Vorlage für ein privates Familien-Angebot,
  keine Rechtsberatung.

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

### 1. Discord-Bot anlegen

Mit Bot sieht es in Discord am besten aus: **eine** Warteschlangen-Nachricht, die
sich bei jeder Änderung selbst aktualisiert, Anfragen, die nach dem Freigeben
„Freigegeben“ bzw. „Abgelehnt“ zeigen, farbige Kästen, Vorschaubilder und dieselben
Symbole wie auf der Seite.

1. <https://discord.com/developers/applications> → **New Application**, Namen
   vergeben (z. B. „3D-Druck“), unter **General Information** ein Bild setzen
   (z. B. `public/icon-512.png`).
2. Links **Bot** → **Reset Token** → Token kopieren. Der Token ist wie ein
   Passwort: nie in den Code oder auf GitHub, nur in die Einstellungen unten.
   Falls er doch mal öffentlich wird: einfach nochmal **Reset Token**.
3. Bot in deinen Server holen – diesen Link öffnen und `DEINE_ANWENDUNGS_ID`
   durch die **Application ID** (General Information) ersetzen:
   `https://discord.com/oauth2/authorize?client_id=DEINE_ANWENDUNGS_ID&permissions=347136&integration_type=0&scope=bot`
   (Rechte: Kanal sehen, Nachrichten senden, Links einbetten, Verlauf lesen,
   externe Emojis). `npm run pruefen` zeigt den fertigen Link auch an.
4. Kanal-ID kopieren: Discord → Einstellungen → Erweitert → **Entwicklermodus**,
   dann Rechtsklick auf den Kanal → **Kanal-ID kopieren**. (Hast du schon eine
   `DISCORD_WEBHOOK_URL` eingetragen, kannst du dir das sparen – der Bot nimmt
   dann den Kanal dieses Webhooks.)

Die eigenen Symbole lädt die App beim ersten Start selbst zum Bot hoch. Der Bot
steht in der Mitgliederliste als „offline“ – das ist normal, weil er keine
Dauerverbindung braucht; schreiben und bearbeiten kann er trotzdem.

**Ohne Bot** geht es auch per Webhook (dann ist jede Änderung eine neue
Nachricht): Rechtsklick auf den Kanal → **Kanal bearbeiten** → **Integrationen** →
**Webhooks** → **Neuer Webhook** → **Webhook-URL kopieren** und als
`DISCORD_WEBHOOK_URL` eintragen.

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
| `DISCORD_BOT_TOKEN` | der Bot-Token aus Schritt 1 |
| `DISCORD_CHANNEL_ID` | die Kanal-ID aus Schritt 1 (oder stattdessen `DISCORD_WEBHOOK_URL`) |
| `PUBLIC_URL` | z. B. `https://druck.deine-domain.de` (empfohlen: dann gibt es in Discord Vorschaubilder und Knöpfe direkt zur Freigabe) |
| `COOKIE_SECURE` | `true`, sobald HTTPS aktiv ist |
| `DISCORD_PING_USER_ID` | optional: deine Discord-Benutzer-ID – dann wirst du bei neuen Anfragen angepingt und bekommst sicher eine Push-Nachricht |
| `DISCORD_CHANNEL_ID_ANFRAGEN` | optional: eigener Kanal für neue Anfragen |
| `DISCORD_WEBHOOK_URL` | nur ohne Bot: Webhook-URL (siehe Schritt 1) |
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

Zum Test unten bei „Discord“ auf **Warteschlange neu posten** (mit Bot) bzw.
**Jetzt an Discord senden** (mit Webhook) klicken – dann siehst du sofort, ob es
funktioniert. Mit Bot sagt dir `npm run pruefen` außerdem genau, was noch fehlt.

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
| `pruefen` | Prüft alles: Node-Version, Datenbank-Verbindung, Discord (Bot: angemeldet?, im Server?, Kanal?, Symbole), Konten, Anzahl der Aufträge – und sagt, was fehlt. Zeigt keine Passwörter. |
| `passwort tim` | Setzt für das Konto `tim` ein neues, zufälliges Passwort (und hebt eine Sperre auf) – oder legt das Konto an, falls es das noch nicht gibt: `passwort tim Tim Schmidt`. Das Passwort steht in der Ausgabe; danach unter **Konten** ändern. |
| `einstellen` | Zeigt die Werte aus der Datei `.env` (Passwörter verdeckt). Mit `einstellen DB_NAME=abc DB_USER=abc` trägst du Werte ein, mit `einstellen NAME=` entfernst du einen. Nur nötig, falls Plesk die Umgebungsvariablen an npm-Befehle nicht weitergibt (`pruefen` sagt dir das). |
| `wartung` | Zeigt, ob der Wartungsmodus an ist. `wartung aus` schaltet ihn aus (Notausgang, falls du nicht mehr reinkommst), `wartung an` schaltet ihn an. |

## Ohne Plesk

```bash
npm install
ADMIN_PASSWORD=… DISCORD_WEBHOOK_URL=… npm start   # läuft auf Port 3000 (oder $PORT)
```

## Hinweise

- **Spam-Schutz:** Weil die Startseite offen ist, hat das Formular ein
  unsichtbares Fangfeld für Bots, muss mindestens 2 Sekunden offen sein, bevor es
  abgeschickt wird, nimmt von jedem Besucher **höchstens 5 Anfragen pro Minute**
  an und keine neuen mehr, wenn schon 50 auf Freigabe warten (einstellbar mit
  `MIN_FORM_SECONDS`, `MAX_ANFRAGEN_PRO_MINUTE` und `MAX_PENDING`). Wer zu schnell
  ist, bekommt eine Meldung, wie viele Sekunden er noch warten muss – seine
  Eingaben bleiben stehen. Besucher werden an ihrer IP-Adresse erkannt; alle im
  selben WLAN teilen sich deshalb die 5 pro Minute.
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
- **Bot schreibt nichts?** `npm run pruefen` zeigt, ob der Token stimmt, ob der
  Bot im Server ist (sonst mit Einladungslink) und ob er den Kanal sieht. Im Kanal
  braucht er „Nachrichten senden“ und „Links einbetten“.
- **Warteschlangen-Nachricht weit oben?** Mit **Warteschlange neu posten** wird die
  alte gelöscht und unten neu geschickt. Löschst du sie in Discord von Hand, kommt
  beim nächsten Mal automatisch eine neue.
- **Discord nicht erreichbar?** Dann steht im Admin-Bereich unter „Discord“ der
  Fehler. Beim nächsten Klick wird automatisch neu versucht.
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
