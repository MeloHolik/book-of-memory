(() => {
  'use strict';

  const PERSONS_API_URL = '/api/v1/persons/';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function tokenizeText(text) {
    const normalized = String(text || '')
      .trim()
      .replace(/\r/g, '')
      .replace(/\n\s*\n/g, ' \n\n ');

    return normalized.split(/\s+/).filter(Boolean);
  }

  function tokensToHtml(tokens) {
    return tokens
      .map((token) => (token === '\n\n' ? '<br><br>' : escapeHtml(token)))
      .join(' ');
  }

  function computePageSize() {
    const sw = window.innerWidth;
    const sh = window.innerHeight;
    let pageH = Math.min(900, Math.floor(sh * 0.78));
    let pageW = Math.floor(pageH * 0.70);

    if (pageW * 2 > sw * 0.9) {
      pageW = Math.floor((sw * 0.9) / 2);
      pageH = Math.floor(pageW / 0.70);
    }

    document.documentElement.style.setProperty('--page-w', pageW + 'px');
    document.documentElement.style.setProperty('--page-h', pageH + 'px');

    return { pageW, pageH };
  }

  async function ensureBookFonts() {
    if (!document.fonts || !document.fonts.load) {
      return;
    }

    const probes = [
      document.fonts.load('600 48px "Cormorant Garamond"', 'Архив памяти'),
      document.fonts.load('600 36px "Cormorant Garamond"', 'Кира Йошикаге'),
      document.fonts.load('500 20px "Cormorant Garamond"', 'Летопись ведётся'),
      document.fonts.load('400 18px "Literata"', 'Меня зовут Кира Йошикаге')
    ];

    try {
      await Promise.all(probes);
      await document.fonts.ready;
    } catch {
      // Если веб-шрифты не загрузились, продолжаем с fallback-шрифтами.
    }
  }

  function makeMeasurer(pageW, pageH) {
    const host = document.createElement('div');
    host.style.cssText = [
      'position:fixed',
      'left:-99999px',
      'top:0',
      'width:' + pageW + 'px',
      'height:' + pageH + 'px',
      'visibility:hidden',
      'pointer-events:none',
      'overflow:hidden'
    ].join(';');

    document.body.appendChild(host);

    return {
      fits(html) {
        host.innerHTML = html;
        const inner = host.firstElementChild;
        if (!inner) {
          return true;
        }
        return inner.scrollHeight <= inner.clientHeight + 1;
      },
      destroy() {
        host.remove();
      }
    };
  }

  function findMaxTokensFit(tokens, render, measurer) {
    let lo = 0;
    let hi = tokens.length;
    let best = 0;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (measurer.fits(render(tokens.slice(0, mid)))) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return best;
  }

  function createImageHtml(src, alt) {
    if (!src) {
      return '<div class="photo-frame"><div class="muted">Нет изображения</div></div>';
    }

    return (
      '<div class="photo-frame">' +
        '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '">' +
      '</div>'
    );
  }

  function personPages(person, measurer) {
    const pages = [];
    let rest = tokenizeText(person.short_info);
    const title = escapeHtml(person.full_name);
    const photoHtml = createImageHtml(person.photo_path, person.full_name);

    const renderFirst = (tokens) => `
      <div class="sheet">
        <h3 class="hero-title">${title}</h3>
        ${photoHtml}
        ${tokens.length ? `<p class="book-text">${tokensToHtml(tokens)}</p>` : ''}
      </div>`;

    const renderNext = (tokens) => `
      <div class="sheet">
        <h3 class="hero-title hero-title--secondary">${title}</h3>
        <p class="book-text">${tokensToHtml(tokens)}</p>
      </div>`;

    if (rest.length) {
      const firstTake = findMaxTokensFit(rest, renderFirst, measurer);

      if (firstTake > 0) {
        pages.push(renderFirst(rest.slice(0, firstTake)));
        rest = rest.slice(firstTake);
      } else {
        pages.push(renderFirst([]));
      }
    } else {
      pages.push(renderFirst([]));
    }

    while (rest.length) {
      let take = findMaxTokensFit(rest, renderNext, measurer);
      if (take === 0) {
        take = 1;
      }
      pages.push(renderNext(rest.slice(0, take)));
      rest = rest.slice(take);
    }

    return pages;
  }

  function createPage(html) {
    const div = document.createElement('div');
    div.className = 'c-flipbook__page';
    div.innerHTML = html;
    return div;
  }

  async function fetchPersons() {
    const response = await fetch(PERSONS_API_URL);
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [];
  }

  async function init() {
    const status = document.getElementById('status');
    const bookEl = document.getElementById('book');
    const tocFloating = document.getElementById('floating-toc');
    const prevBtn = document.getElementById('prev');
    const nextBtn = document.getElementById('next');
    const rebuildBtn = document.getElementById('rebuild');

    rebuildBtn.addEventListener('click', () => window.location.reload());

    const { pageW, pageH } = computePageSize();
    status.textContent = 'Загружаю шрифты и данные…';

    let persons = [];
    try {
      const [loadedPersons] = await Promise.all([
        fetchPersons(),
        ensureBookFonts()
      ]);
      persons = loadedPersons;
    } catch (err) {
      status.textContent = 'Не удалось загрузить /api/v1/persons/';
      console.error(err);
      return;
    }

    status.textContent = 'Собираю страницы…';

    const measurer = makeMeasurer(pageW, pageH);
    const pageNodes = [];
    const tocMap = [];

    try {
      pageNodes.push(createPage(`
        <div class="sheet cover">
          <h1>Архив памяти</h1>
          <p>Вечно скоротечные воспоминания</p>
        </div>
      `));

      pageNodes.push(createPage(`
        <div class="sheet center">
          <p class="muted"><em>Архив памяти</em></p>
        </div>
      `));

      const tocHtmlParts = [
        '<div class="sheet toc-page"><h2 class="toc-title">Оглавление</h2><ul>'
      ];
      let currentPageIndex = 3;

      persons.forEach((person, idx) => {
        tocMap.push({
          label: String(idx + 1).padStart(2, '0') + '. ' + person.full_name,
          page: currentPageIndex
        });

        tocHtmlParts.push(
          '<li><button type="button" data-page="' + currentPageIndex + '">' +
            String(idx + 1).padStart(2, '0') + '. ' + escapeHtml(person.full_name) +
          '</button></li>'
        );

        const built = personPages(person, measurer);
        built.forEach((html) => pageNodes.push(createPage(html)));
        currentPageIndex += built.length;
      });

      tocHtmlParts.push('</ul></div>');
      pageNodes.splice(2, 0, createPage(tocHtmlParts.join('')));

      if (pageNodes.length % 2 === 0) {
        pageNodes.push(createPage('<div class="sheet endpaper"></div>'));
      }

      pageNodes.push(createPage(`
        <div class="sheet back-cover">
          <div class="back-cover-inner">
            <p>Летопись ведётся</p>
          </div>
        </div>
      `));
    } finally {
      measurer.destroy();
    }

    bookEl.replaceChildren(...pageNodes);

    let book;

    function renderStatus(total) {
      const active = book.getActivePages();
      if (!active || active.length === 0) {
        return;
      }

      const label = active.length >= 2
        ? (active[0] + 1) + '–' + (active[active.length - 1] + 1)
        : String(active[0] + 1);

      status.textContent = 'Страница: ' + label + ' / ' + total;
    }

    book = new FlipBook('book', {
      width: String(pageW * 2) + 'px',
      height: String(pageH) + 'px',
      nextButton: nextBtn,
      previousButton: prevBtn,
      arrowKeys: true,
      canClose: true,
      initialActivePage: 0,
      onPageTurn() {
        renderStatus(pageNodes.length);
      }
    });

    renderStatus(pageNodes.length);
    bookEl.classList.add('is-ready');

    document.body.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-page]');
      if (!btn) {
        return;
      }

      const page = Number(btn.dataset.page);
      if (Number.isFinite(page)) {
        book.turnPage(page);
      }
    });

    tocFloating.replaceChildren();
    tocMap.forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.page = String(entry.page);
      button.textContent = entry.label;
      tocFloating.appendChild(button);
    });

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => window.location.reload(), 220);
    });
  }

  init();
})();
