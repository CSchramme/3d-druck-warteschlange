"""Einlesen und Prüfen der Auftragsformulare (öffentlich und Admin)."""

from . import makerworld

LIMITS = {
    "title": 120,
    "requester": 60,
    "color": 60,
    "notes": 1000,
    "admin_note": 1000,
}
LABELS = {
    "title": "Titel",
    "requester": "Name",
    "color": "Farbe/Material",
    "notes": "Beschreibung",
    "admin_note": "Admin-Notiz",
}


def parse_job_form(form, *, admin=False):
    """Gibt (werte, fehler) zurück. Titel darf leer sein, wenn ein Link da ist –
    den ergänzt dann complete_from_makerworld()."""
    errors = []
    values = {}

    for name in ("requester", "title", "color", "notes") + (("admin_note",) if admin else ()):
        value = (form.get(name) or "").strip()
        if len(value) > LIMITS[name]:
            errors.append(f"{LABELS[name]} ist zu lang (max. {LIMITS[name]} Zeichen).")
        values[name] = value or None

    try:
        values["makerworld_url"] = makerworld.normalize_url(form.get("makerworld_url"))
    except ValueError as exc:
        errors.append(str(exc))
        values["makerworld_url"] = None

    if admin:
        image = (form.get("image_url") or "").strip()
        if image and not image.startswith("https://"):
            errors.append("Der Bild-Link muss mit https:// beginnen.")
        values["image_url"] = image[:500] or None

    try:
        quantity = int(form.get("quantity") or 1)
    except ValueError:
        quantity = 0
    if not 1 <= quantity <= 99:
        errors.append("Die Anzahl muss zwischen 1 und 99 liegen.")
    values["quantity"] = quantity

    if not values["requester"]:
        errors.append("Bitte gib deinen Namen an.")
    if not values["title"] and not values["makerworld_url"]:
        errors.append("Bitte schreib, was gedruckt werden soll, oder füge einen MakerWorld-Link ein.")

    return values, errors


def complete_from_makerworld(values, enabled=True):
    """Ergänzt fehlenden Titel/Vorschaubild aus der MakerWorld-Seite."""
    url = values.get("makerworld_url")
    if not url or not makerworld.is_makerworld(url):
        if not values.get("title"):
            values["title"] = "Modell über Link"
        return values
    info = makerworld.fetch_info(url) if enabled else {"title": None, "image_url": None}
    if not values.get("title"):
        values["title"] = info["title"] or makerworld.fallback_title(url)
    if not values.get("image_url"):
        values["image_url"] = info["image_url"]
    return values
