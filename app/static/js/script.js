function tokenizeText(text) {
  const normalized = (text || '').trim().replace(/\r/g, '').replace(/\n\s*\n/g, ' \n\n ');
  return normalized.split(/\s+/).filter(Boolean);
}
function tokensToHtml(tokens) {
  return tokens.map(t => t === '\n\n' ? '<br><br>' : t).join(' ');
}
function makeMeasurer(pageW, pageH) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed; left:-99999px; top:0; width:${pageW}px; height:${pageH}px; visibility:hidden; pointer-events:none;`;
  wrap.innerHTML = `<div class="page-content" style="height:${pageH}px; padding: 38px 40px;"></div>`;
  document.body.appendChild(wrap);
  const content = wrap.querySelector('.page-content');
  return {
    fits(html) {
      content.innerHTML = html;
      return content.scrollHeight <= content.clientHeight + 1;
    },
    destroy() { wrap.remove(); }
  };
}
function findMaxTokensFit(tokens, renderHtmlFn, measurer) {
  let lo = 1,
    hi = tokens.length,
    best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (measurer.fits(renderHtmlFn(tokens.slice(0, mid)))) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(1, best);
}
function buildPersonPages(person, measurer) {
  const pages = [];
  let rest = tokenizeText(person.short_info);
  const title = (person.full_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const photo = (person.photo_path || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const renderFirst = (toks) => `<div class="page-content"><h3 class="hero-title">${title}</h3><div class="photo-frame"><img src="${photo}"></div><p class="book-text">${tokensToHtml(toks)}</p></div>`;
  const renderNext = (toks) => `<div class="page-content"><h3 class="hero-title" style="font-size:1.7rem; margin-bottom:16px;">${title}</h3><p class="book-text">${tokensToHtml(toks)}</p></div>`;

  if (rest.length) {
    const take = findMaxTokensFit(rest, renderFirst, measurer);
    pages.push({ density: 'soft', html: renderFirst(rest.slice(0, take)) });
    rest = rest.slice(take);
  } else pages.push({ density: 'soft', html: renderFirst([]) });

  while (rest.length) {
    const take = findMaxTokensFit(rest, renderNext, measurer);
    pages.push({ density: 'soft', html: renderNext(rest.slice(0, take)) });
    rest = rest.slice(take);
  }
  return pages;
}

document.addEventListener('DOMContentLoaded', async () => {
  const bookEl = document.getElementById('book');
  const tocList = document.getElementById('toc-list');
  const insideBackCover = document.getElementById('inside-back-cover');

  // Размеры
  const screenW = window.innerWidth,
    screenH = window.innerHeight;
  let pageH = Math.min(940, Math.floor(screenH * 0.90));
  let pageW = Math.floor(pageH * 0.70);
  if (pageW * 2 > screenW * 0.90) {
    pageW = Math.floor((screenW * 0.90) / 2);
    pageH = Math.floor(pageW / 0.70);
  }

  document.documentElement.style.setProperty('--page-w', pageW + 'px');
  document.documentElement.style.setProperty('--page-h', pageH + 'px');

  // Данные
  let persons = [];
  try {
    const r = await fetch('/api/v1/persons/');
    if (r.ok) persons = await r.json();
  } catch (err) {
    console.error("Ошибка API");
  }

  const measurer = makeMeasurer(pageW, pageH);

  let currentPersonStartPage = 3;

  persons.forEach((person, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'toc-btn';
    btn.dataset.page = currentPersonStartPage;
    btn.textContent = `${String(i + 1).padStart(2,'0')}. ${person.full_name}`;
    li.appendChild(btn);
    tocList.appendChild(li);

    const personPages = buildPersonPages(person, measurer);
    personPages.forEach(p => {
      const pageDiv = document.createElement('div');
      pageDiv.className = 'page';
      pageDiv.setAttribute('data-density', p.density);
      pageDiv.innerHTML = p.html;
      bookEl.insertBefore(pageDiv, insideBackCover);
    });
    currentPersonStartPage += personPages.length;
  });
  measurer.destroy();

  if (bookEl.querySelectorAll('.page').length % 2 !== 0) {
    const filler = document.createElement('div');
    filler.className = 'page';
    filler.setAttribute('data-density', 'soft');
    filler.innerHTML = `<div class="page-content flex items-center justify-center"><p class="text-amber-900 opacity-60 italic text-lg">…</p></div>`;
    bookEl.insertBefore(filler, insideBackCover);
  }

  const pageFlip = new St.PageFlip(bookEl, {
    width: pageW,
    height: pageH,
    size: "fixed",
    autoSize: true,
    flippingTime: 1100,
    maxShadowOpacity: 0.60,
    showCover: true,
    disableFlipByClick: true,
    clickEventForward: true,
    swipeDistance: 95,
    useMouseEvents: true,
    showPageCorners: true
  });
  pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));

  let canNavigate = true;
  pageFlip.on('changeState', (e) => canNavigate = (e.data === 'read'));
  tocList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || !canNavigate) return;
    e.preventDefault();
    e.stopPropagation();
    pageFlip.flip(Number(btn.dataset.page), 'top');
  }, { capture: true });

  const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

  gsap.set("#isometric-root", {
    opacity: 0, scale: 0.6, y: 300,
    x: -(pageW / 2),
    rotateX: 12, rotateY: -6, rotateZ: -1
  });

  gsap.set("#book-thickness", { left: pageW, width: pageW });

  tl.to("#isometric-root", {
      opacity: 1, scale: 1, y: 0,
      duration: 1.4, ease: "back.out(1.1)"
    })
    .add(() => {
      pageFlip.flipNext();
    })
    .to("#isometric-root", {
      x: 0,
      duration: 1.1,
      ease: "power1.inOut"
    }, "+=0.0")
    .to("#book-thickness", {
      left: 0,
      width: pageW * 2,
      duration: 1.1,
      ease: "power1.inOut"
    }, "<");

  tl.to("#isometric-root", {
    y: -8, rotateX: 14, rotateY: -4, duration: 3, yoyo: true, repeat: -1, ease: "sine.inOut"
  }, "+=0.2");
});