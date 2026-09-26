'use strict';

// Warteschlangen-Logik. Alle Funktionen arbeiten auf dem Datenobjekt aus
// store.readData()/updateData(): { nextId, jobs: [...] }.

const EDITABLE_FIELDS = [
  'title', 'requester', 'makerworldUrl', 'imageUrl', 'quantity', 'color', 'notes', 'adminNote', 'finishedAt',
];
const COPY_FIELDS = [
  'title', 'requester', 'makerworldUrl', 'imageUrl', 'quantity', 'color', 'notes', 'adminNote',
];

const now = () => new Date().toISOString();

function create(data, fields) {
  const job = {
    id: data.nextId++,
    title: fields.title,
    requester: fields.requester,
    makerworldUrl: fields.makerworldUrl || null,
    imageUrl: fields.imageUrl || null,
    quantity: fields.quantity || 1,
    color: fields.color || null,
    notes: fields.notes || null,
    adminNote: fields.adminNote || null,
    status: 'pending',
    position: null,
    createdAt: now(),
    approvedAt: null,
    finishedAt: null,
  };
  data.jobs.push(job);
  return job;
}

const get = (data, id) => data.jobs.find((job) => job.id === id) || null;

const pending = (data) => data.jobs.filter((job) => job.status === 'pending');

function queue(data, limit) {
  const list = data.jobs
    .filter((job) => job.status === 'queued')
    .sort((a, b) => a.position - b.position || a.id - b.id);
  return limit === undefined ? list : list.slice(0, limit);
}

function finished(data, limit = 20) {
  return data.jobs
    .filter((job) => job.status === 'done' || job.status === 'rejected')
    .sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || '') || b.id - a.id)
    .slice(0, limit);
}

function writePositions(list) {
  list.forEach((job, index) => {
    job.position = index + 1;
  });
}

/** Gibt einen Auftrag frei (oder holt ihn zurück) und hängt ihn hinten an. */
function enqueue(data, id) {
  const job = get(data, id);
  const rest = queue(data).filter((other) => other.id !== id);
  Object.assign(job, { status: 'queued', approvedAt: now(), finishedAt: null });
  writePositions([...rest, job]);
}

function leaveQueue(data, id, status, fields = {}) {
  Object.assign(get(data, id), { status, position: null, ...fields });
  writePositions(queue(data));
}

const reject = (data, id) => leaveQueue(data, id, 'rejected', { finishedAt: now() });
const markDone = (data, id) => leaveQueue(data, id, 'done', { finishedAt: now() });
const backToPending = (data, id) =>
  leaveQueue(data, id, 'pending', { approvedAt: null, finishedAt: null });

/** Verschiebt einen Auftrag in der Warteschlange: up, down, top oder bottom. */
function move(data, id, direction) {
  const list = queue(data);
  const index = list.findIndex((job) => job.id === id);
  if (index === -1) return;
  const [job] = list.splice(index, 1);
  const target = {
    up: Math.max(index - 1, 0),
    down: Math.min(index + 1, list.length),
    top: 0,
    bottom: list.length,
  }[direction];
  list.splice(target, 0, job);
  writePositions(list);
}

/** Legt einen alten Druck direkt im Archiv an (für Drucke von vor der App). */
function addPrinted(data, fields, printedAt) {
  const job = create(data, fields);
  Object.assign(job, { status: 'done', createdAt: printedAt, approvedAt: printedAt, finishedAt: printedAt });
  return job;
}

/** Legt eine Kopie eines (gedruckten) Auftrags hinten in die Warteschlange. */
function duplicate(data, id) {
  const source = get(data, id);
  const copy = create(data, Object.fromEntries(COPY_FIELDS.map((key) => [key, source[key]])));
  enqueue(data, copy.id);
  return copy;
}

// --- Archiv & Suche -------------------------------------------------------------

/** Kleinbuchstaben, ohne Akzente, ß -> ss: „Kräuter“ findet man auch mit „krauter“. */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function searchText(job, extra = '') {
  return normalize([
    job.title, job.requester, job.color, job.notes, job.adminNote, job.makerworldUrl, extra,
  ].filter(Boolean).join(' '));
}

/** Alle Suchwörter müssen vorkommen (egal in welchem Feld). */
function matches(text, query) {
  return normalize(query).split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}

const ARCHIVE_SORTS = {
  neu: (a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || '') || b.id - a.id,
  alt: (a, b) => (a.finishedAt || '').localeCompare(b.finishedAt || '') || a.id - b.id,
  titel: (a, b) => a.title.localeCompare(b.title, 'de', { sensitivity: 'base' }) || b.id - a.id,
  person: (a, b) => a.requester.localeCompare(b.requester, 'de', { sensitivity: 'base' })
    || ARCHIVE_SORTS.neu(a, b),
};

/** Alle gedruckten Aufträge, optional nur für eine Person, sortiert. */
function archive(data, { person = '', sort = 'neu' } = {}) {
  const wanted = normalize(person);
  return data.jobs
    .filter((job) => job.status === 'done' && (!wanted || normalize(job.requester) === wanted))
    .sort(ARCHIVE_SORTS[sort] || ARCHIVE_SORTS.neu);
}

/** Personen im Archiv mit Anzahl der Drucke, alphabetisch. */
function archivePeople(data) {
  const counts = new Map();
  for (const job of data.jobs) {
    if (job.status === 'done') counts.set(job.requester, (counts.get(job.requester) || 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

function update(data, id, fields) {
  const job = get(data, id);
  for (const key of EDITABLE_FIELDS) {
    if (key in fields) job[key] = fields[key] ?? null;
  }
}

function remove(data, id) {
  data.jobs = data.jobs.filter((job) => job.id !== id);
  writePositions(queue(data));
}

module.exports = {
  create, get, pending, queue, finished, enqueue, reject, markDone, backToPending,
  move, update, remove, addPrinted, duplicate,
  normalize, searchText, matches, archive, archivePeople, ARCHIVE_SORTS,
};
