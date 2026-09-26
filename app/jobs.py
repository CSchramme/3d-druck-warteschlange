"""Datenzugriff und Warteschlangen-Logik für Druckaufträge."""

from datetime import datetime, timezone

STATUS_LABELS = {
    "pending": "Wartet auf Genehmigung",
    "queued": "In der Warteschlange",
    "done": "Gedruckt",
    "rejected": "Abgelehnt",
}

EDITABLE_FIELDS = (
    "title",
    "requester",
    "makerworld_url",
    "image_url",
    "quantity",
    "color",
    "notes",
    "admin_note",
)


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def create(conn, *, title, requester, makerworld_url=None, image_url=None,
           quantity=1, color=None, notes=None):
    with conn:
        cur = conn.execute(
            "INSERT INTO jobs (title, requester, makerworld_url, image_url, quantity,"
            " color, notes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
            (title, requester, makerworld_url, image_url, quantity, color, notes, now()),
        )
    return cur.lastrowid


def get(conn, job_id):
    return conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()


def pending(conn):
    return conn.execute(
        "SELECT * FROM jobs WHERE status = 'pending' ORDER BY created_at, id"
    ).fetchall()


def queue(conn, limit=None):
    sql = "SELECT * FROM jobs WHERE status = 'queued' ORDER BY position, id"
    if limit is not None:
        return conn.execute(sql + " LIMIT ?", (limit,)).fetchall()
    return conn.execute(sql).fetchall()


def finished(conn, limit=20):
    return conn.execute(
        "SELECT * FROM jobs WHERE status IN ('done', 'rejected')"
        " ORDER BY finished_at DESC, id DESC LIMIT ?",
        (limit,),
    ).fetchall()


def _queue_ids(conn):
    return [row["id"] for row in conn.execute(
        "SELECT id FROM jobs WHERE status = 'queued' ORDER BY position, id"
    )]


def _write_positions(conn, ids):
    conn.executemany(
        "UPDATE jobs SET position = ? WHERE id = ?",
        [(pos, job_id) for pos, job_id in enumerate(ids, start=1)],
    )


def enqueue(conn, job_id):
    """Genehmigt einen Auftrag (oder holt ihn zurück) und hängt ihn hinten an."""
    with conn:
        ids = [i for i in _queue_ids(conn) if i != job_id]
        conn.execute(
            "UPDATE jobs SET status = 'queued', approved_at = ?, finished_at = NULL"
            " WHERE id = ?",
            (now(), job_id),
        )
        _write_positions(conn, ids + [job_id])


def _leave_queue(conn, job_id, status):
    with conn:
        conn.execute(
            "UPDATE jobs SET status = ?, position = NULL, finished_at = ? WHERE id = ?",
            (status, now(), job_id),
        )
        _write_positions(conn, _queue_ids(conn))


def reject(conn, job_id):
    _leave_queue(conn, job_id, "rejected")


def mark_done(conn, job_id):
    _leave_queue(conn, job_id, "done")


def back_to_pending(conn, job_id):
    with conn:
        conn.execute(
            "UPDATE jobs SET status = 'pending', position = NULL, approved_at = NULL,"
            " finished_at = NULL WHERE id = ?",
            (job_id,),
        )
        _write_positions(conn, _queue_ids(conn))


def move(conn, job_id, direction):
    """Verschiebt einen Auftrag in der Warteschlange: up, down, top oder bottom."""
    with conn:
        ids = _queue_ids(conn)
        if job_id not in ids:
            return
        i = ids.index(job_id)
        ids.pop(i)
        new_index = {
            "up": max(i - 1, 0),
            "down": min(i + 1, len(ids)),
            "top": 0,
            "bottom": len(ids),
        }[direction]
        ids.insert(new_index, job_id)
        _write_positions(conn, ids)


def update(conn, job_id, fields):
    fields = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
    if not fields:
        return
    assignments = ", ".join(f"{k} = ?" for k in fields)
    with conn:
        conn.execute(
            f"UPDATE jobs SET {assignments} WHERE id = ?",
            (*fields.values(), job_id),
        )


def delete(conn, job_id):
    with conn:
        conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
        _write_positions(conn, _queue_ids(conn))
