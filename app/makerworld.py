"""MakerWorld-Links prüfen und (so gut es geht) Titel und Vorschaubild laden."""

import logging
import re
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlsplit

log = logging.getLogger(__name__)

MAKERWORLD_HOSTS = ("makerworld.com", "makerworld.com.cn")
BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def normalize_url(raw):
    """Gibt einen sauberen http(s)-Link zurück, None wenn leer, oder ValueError."""
    raw = (raw or "").strip()
    if not raw:
        return None
    if "://" not in raw:
        raw = "https://" + raw
    invalid = ValueError("Das sieht nicht wie ein gültiger Link aus.")
    try:
        parts = urlsplit(raw)
        parts.port  # wirft bei Unsinn wie "https://javascript:alert(1)"
    except ValueError:
        raise invalid from None
    if (parts.scheme not in ("http", "https") or "." not in (parts.hostname or "")
            or any(c.isspace() for c in raw)):
        raise invalid
    if len(raw) > 500:
        raise ValueError("Der Link ist zu lang.")
    return raw


def is_makerworld(url):
    host = (urlsplit(url).hostname or "").lower() if url else ""
    return any(host == h or host.endswith("." + h) for h in MAKERWORLD_HOSTS)


def model_id(url):
    match = re.search(r"/models/(\d+)", url or "")
    return match.group(1) if match else None


def fallback_title(url):
    mid = model_id(url)
    return f"MakerWorld-Modell {mid}" if mid else "MakerWorld-Modell"


class _MetaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta = {}
        self._in_title = False
        self.title = ""

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "meta":
            key = (attrs.get("property") or attrs.get("name") or "").lower()
            if key and "content" in attrs and key not in self.meta:
                self.meta[key] = attrs["content"] or ""
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def _clean_title(title):
    title = re.sub(r"\s+", " ", title or "").strip()
    title = re.sub(r"\s*[-|–]\s*MakerWorld.*$", "", title, flags=re.I)
    title = re.sub(r"\s*[-|–]\s*(Free\s+)?3D\s+Print(able)?\s+Model.*$", "", title, flags=re.I)
    return title.strip()[:120]


def parse_page(html):
    parser = _MetaParser()
    parser.feed(html)
    title = _clean_title(parser.meta.get("og:title") or parser.title)
    image = parser.meta.get("og:image") or parser.meta.get("twitter:image") or ""
    if not image.startswith("https://"):
        image = ""
    return {"title": title or None, "image_url": image[:500] or None}


def fetch_info(url, timeout=6):
    """Lädt Titel und Vorschaubild einer MakerWorld-Seite. Bei jedem Fehler
    (z. B. Bot-Schutz) kommt einfach ein leeres Ergebnis zurück."""
    empty = {"title": None, "image_url": None}
    if not is_makerworld(url):
        return empty
    request = urllib.request.Request(url, headers={
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    })
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            html = resp.read(2_000_000).decode("utf-8", errors="replace")
        return parse_page(html)
    except Exception as exc:  # Netzwerk, Bot-Schutz, kaputtes HTML …
        log.info("MakerWorld-Infos für %s nicht ladbar: %s", url, exc)
        return empty
