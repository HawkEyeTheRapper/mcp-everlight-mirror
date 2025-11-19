const recordsUrl = new URL('data/records.json', window.location.href);

async function loadRecords() {
  const res = await fetch(recordsUrl);
  if (!res.ok) throw new Error('Failed to load records.json');
  return res.json();
}

function renderFilters(records) {
  const filterEl = document.getElementById('filters');
  if (!filterEl) return { setTagFilter: () => {} };

  const tags = new Set();
  records.forEach(({ tags: tagList }) => (tagList || []).forEach(tag => tags.add(tag)));
  const sorted = Array.from(tags).sort();

  let activeTag = null;
  sorted.forEach(tag => {
    const btn = document.createElement('button');
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      if (activeTag === tag) {
        activeTag = null;
        btn.classList.remove('active');
      } else {
        activeTag = tag;
        document.querySelectorAll('#filters button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      window.dispatchEvent(new CustomEvent('tag-filter-change', { detail: activeTag }));
    });
    filterEl.appendChild(btn);
  });

  return {
    setTagFilter(tag) {
      activeTag = tag;
    },
  };
}

function renderResults(records) {
  const listEl = document.getElementById('results');
  const countEl = document.getElementById('result-count');
  if (!listEl) return;

  listEl.innerHTML = '';
  const fragment = document.createDocumentFragment();

  records.forEach(record => {
    const card = document.createElement('article');
    card.className = 'card';

    const title = document.createElement('h3');
    title.textContent = record.title;
    card.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const accountLabel = record.accounts && record.accounts.length
      ? record.accounts.join(', ')
      : 'Unspecified account';
    meta.innerHTML = `
      <span>${accountLabel}</span>
      <span>${record.message_count} messages</span>
      ${record.tags.map(tag => `<span>#${tag}</span>`).join('')}
    `;
    card.appendChild(meta);

    const summary = document.createElement('p');
    summary.className = 'summary';
    summary.textContent = record.summary;
    card.appendChild(summary);

    const link = document.createElement('a');
    link.href = `everlight_context/logs/${record.filename}`;
    link.textContent = 'View full log';
    link.setAttribute('target', '_blank');
    card.appendChild(link);

    fragment.appendChild(card);
  });

  listEl.appendChild(fragment);
  if (countEl) {
    countEl.textContent = `${records.length} record${records.length === 1 ? '' : 's'} shown`;
  }
}

function setupSearch(records) {
  const input = document.getElementById('search-input');
  if (!input) {
    renderResults(records);
    return;
  }

  let activeTag = null;
  window.addEventListener('tag-filter-change', event => {
    activeTag = event.detail;
    applyFilters();
  });

  input.addEventListener('input', () => applyFilters());

  function applyFilters() {
    const query = input.value.trim().toLowerCase();
    const filtered = records.filter(record => {
      const haystack = [
        record.title,
        record.summary,
        (record.accounts || []).join(' '),
        (record.tags || []).join(' '),
      ]
        .join(' ')
        .toLowerCase();

      const matchesQuery = !query || haystack.includes(query);
      const matchesTag = !activeTag || (record.tags || []).includes(activeTag);

      return matchesQuery && matchesTag;
    });

    renderResults(filtered);
  }

  applyFilters();
}

async function boot() {
  try {
    const records = await loadRecords();
    renderFilters(records);
    setupSearch(records);
  } catch (error) {
    console.error(error);
    const results = document.getElementById('results');
    if (results) {
      results.innerHTML = '<p>Unable to load codex data. Check records.json.</p>';
    }
  }
}

boot();
