// Live-Suche im Druck-Archiv: filtert schon beim Tippen, ohne neu zu laden.
// Die Server-Suche (?q=…) funktioniert genauso, auch ganz ohne JavaScript.
(function () {
  // „➕ Druck eintragen“ klappt das Formular auf und setzt den Cursor hinein.
  function openEntry() {
    var details = document.querySelector('#eintragen details');
    if (!details) return;
    details.open = true;
    details.scrollIntoView({ behavior: 'smooth', block: 'start' });
    var first = details.querySelector('input[name=requester]');
    if (first) first.focus({ preventScroll: true });
  }
  document.querySelectorAll('[data-open="eintragen"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      openEntry();
    });
  });
  if (window.location.hash === '#eintragen') openEntry();

  var form = document.querySelector('.archive-filters');
  var input = document.getElementById('archiv-suche');
  var list = document.getElementById('archiv-liste');
  if (!form || !input) return;

  // Filter-Auswahl sofort anwenden.
  form.querySelectorAll('select').forEach(function (select) {
    select.addEventListener('change', function () { form.submit(); });
  });
  if (!list) return;

  var items = Array.prototype.slice.call(list.children);
  var empty = document.getElementById('archiv-leer');

  // Muss zu normalize() in src/jobs.js passen.
  function normalize(text) {
    return text.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function setStat(name, count) {
    var number = document.getElementById('stat-' + name);
    var label = number.nextElementSibling;
    number.textContent = count;
    label.textContent = label.getAttribute(count === 1 ? 'data-one' : 'data-many');
  }

  function apply() {
    var words = normalize(input.value).split(/\s+/).filter(Boolean);
    var prints = 0;
    var pieces = 0;
    var people = {};
    items.forEach(function (item) {
      var text = item.getAttribute('data-search');
      var show = words.every(function (word) { return text.indexOf(word) !== -1; });
      item.hidden = !show;
      if (show) {
        prints += 1;
        pieces += Number(item.getAttribute('data-qty')) || 1;
        people[item.getAttribute('data-person')] = true;
      }
    });
    setStat('drucke', prints);
    setStat('teile', pieces);
    setStat('personen', Object.keys(people).length);
    if (empty) empty.hidden = prints > 0;

    // Suche in der Adresse merken (für Zurück-Links und Neuladen).
    var url = new URL(window.location.href);
    if (input.value.trim()) url.searchParams.set('q', input.value.trim());
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', url);
  }

  input.addEventListener('input', apply);
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    apply();
  });
})();
