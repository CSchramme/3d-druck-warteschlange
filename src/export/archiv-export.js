// Suche, Filter und Sortierung für die exportierte Archiv-Datei.
// Läuft komplett offline im Browser – ohne Server.
(function () {
  var list = document.getElementById('liste');
  if (!list) return;
  var items = Array.prototype.slice.call(list.children);
  var search = document.getElementById('suche');
  var person = document.getElementById('person');
  var sort = document.getElementById('sortierung');
  var empty = document.getElementById('leer');
  var collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

  // Muss zu normalize() in src/jobs.js passen.
  function normalize(text) {
    return text.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function attr(item, name) {
    return item.getAttribute('data-' + name) || '';
  }

  var sorters = {
    neu: function (a, b) { return attr(b, 'date').localeCompare(attr(a, 'date')); },
    alt: function (a, b) { return attr(a, 'date').localeCompare(attr(b, 'date')); },
    titel: function (a, b) { return collator.compare(attr(a, 'title'), attr(b, 'title')); },
    person: function (a, b) {
      return collator.compare(attr(a, 'person'), attr(b, 'person')) || sorters.neu(a, b);
    },
  };

  function setStat(name, count) {
    var number = document.getElementById('stat-' + name);
    var label = number.nextElementSibling;
    number.textContent = count;
    label.textContent = label.getAttribute(count === 1 ? 'data-one' : 'data-many');
  }

  function apply() {
    var words = normalize(search.value).split(/\s+/).filter(Boolean);
    var who = person.value;
    var prints = 0;
    var pieces = 0;
    var people = {};
    items.slice().sort(sorters[sort.value] || sorters.neu).forEach(function (item) {
      list.appendChild(item);
      var text = attr(item, 'search');
      var show = (!who || attr(item, 'person') === who)
        && words.every(function (word) { return text.indexOf(word) !== -1; });
      item.hidden = !show;
      if (show) {
        prints += 1;
        pieces += Number(attr(item, 'qty')) || 1;
        people[attr(item, 'person')] = true;
      }
    });
    setStat('drucke', prints);
    setStat('teile', pieces);
    setStat('personen', Object.keys(people).length);
    empty.hidden = prints > 0;
  }

  search.addEventListener('input', apply);
  person.addEventListener('change', apply);
  sort.addEventListener('change', apply);
  document.getElementById('filter').addEventListener('submit', function (e) { e.preventDefault(); });

  // Offline laden die Vorschaubilder nicht – dann bleibt das Platzhalter-Icon darunter sichtbar.
  Array.prototype.forEach.call(document.querySelectorAll('.thumb img'), function (img) {
    if (img.complete && !img.naturalWidth) img.remove();
  });

  apply();
})();
