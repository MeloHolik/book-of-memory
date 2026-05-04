(function () {
  'use strict';

  var API_URL = '/api/v1/persons/';
  var API_LIMIT = 200;

  var COVER_PAGES = 2;           // p1..p2 — передняя обложка и внутренняя обложка
  var CONTENT_START = 3;         // с p3 начинаются сгенерированные страницы (сначала книжное оглавление, потом записи)
  var BACK_COVERS = 2;           // последняя внутренняя + внешняя обложка

  var PAGE_W = 460;
  var PAGE_H = 570;

  var state = {
    persons: [],
    pageModels: [],              // сюда входят и страницы книжного оглавления, и страницы записей
    toc: [],                     // overlay-оглавление (список записей с реальными страницами)
    totalPages: 0,
    bookReady: false
  };

  var $book = $('#book');
  var $status = $('#status');
  var PHOTO_RENDER_W = 155;
  var photoSizeByUrl = {};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fetchBatch(offset, limit) {
    return $.ajax({
      url: API_URL,
      dataType: 'json',
      data: { offset: offset, limit: limit }
    });
  }

  function fetchAllPersons() {
    var d = $.Deferred();
    var all = [];
    var offset = 0;

    function step() {
      fetchBatch(offset, API_LIMIT)
        .done(function (arr) {
          if (!$.isArray(arr)) arr = [];
          all = all.concat(arr);
          offset += arr.length;

          if (arr.length < API_LIMIT) d.resolve(all);
          else step();
        })
        .fail(function (xhr) {
          d.reject(xhr);
        });
    }

    step();
    return d.promise();
  }

  function waitForBookFonts() {
    var d = $.Deferred();

    if (!document.fonts || !document.fonts.load) {
      d.resolve();
      return d.promise();
    }

    Promise.all([
      document.fonts.load('17px "Stempel-Garamond-W01-Roman"', 'Архив памяти Кира Йошикаге'),
      document.fonts.load('38px "Stempel-Garamond-W01-Roman"', 'Архив памяти Кира Йошикаге'),
      document.fonts.ready
    ]).then(function () {
      d.resolve();
    }).catch(function () {
      d.resolve();
    });

    return d.promise();
  }

  function preloadImageSize(url) {
    var d = $.Deferred();

    if (!url) {
      d.resolve();
      return d.promise();
    }

    var img = new Image();
    var finished = false;

    function finish(saveSize) {
      if (finished) return;
      finished = true;

      if (saveSize && img.naturalWidth && img.naturalHeight) {
        photoSizeByUrl[url] = {
          w: img.naturalWidth,
          h: img.naturalHeight
        };
      }

      d.resolve();
    }

    img.onload = function () {
      finish(true);
    };

    img.onerror = function () {
      finish(false);
    };

    img.src = url;

    if (img.complete) {
      finish(!!img.naturalWidth);
    }

    return d.promise();
  }

  function preloadPersonPhotos(persons) {
    var seen = {};
    var jobs = [];

    for (var i = 0; i < persons.length; i++) {
      var url = persons[i] && persons[i].photo_path;

      if (!url || seen[url]) continue;

      seen[url] = true;
      jobs.push(preloadImageSize(url));
    }

    if (!jobs.length) {
      return $.Deferred().resolve().promise();
    }

    return $.when.apply($, jobs);
  }

  function createMeasurer() {
    var host = document.createElement('div');
    host.className = 'sj-book';
    host.style.cssText =
      'position:fixed;left:-99999px;top:0;' +
      'visibility:hidden;overflow:hidden;pointer-events:none;';

    var page = document.createElement('div');
    page.className = 'own-size';
    page.style.cssText =
      'width:' + PAGE_W + 'px;' +
      'height:' + PAGE_H + 'px;' +
      'overflow:hidden;';

    host.appendChild(page);
    document.body.appendChild(host);

    return {
      fits: function (html) {
        page.innerHTML = html;

        var node = page.firstElementChild; // .book-content
        if (!node) return true;

        return node.scrollHeight <= node.clientHeight + 1;
      },
      destroy: function () {
        if (host.parentNode) host.parentNode.removeChild(host);
      }
    };
  }

  var PARA_TOKEN = '__PARA__';

  function tokenize(text) {
    var s = String(text || '').replace(/\r/g, '').trim();
    if (!s) return [];

    var parts = s.split(/\n\s*\n/);
    var out = [];

    for (var i = 0; i < parts.length; i++) {
      var p = $.trim(parts[i]);
      if (!p) continue;

      if (out.length) out.push(PARA_TOKEN);

      var words = p.split(/\s+/);
      for (var j = 0; j < words.length; j++) {
        if (words[j]) out.push(words[j]);
      }
    }

    return out;
  }

  function tokensToHtml(tokens, withPhoto, photoUrl, alt) {
    if (!tokens.length) return '<p class="no-indent">Описание отсутствует.</p>';

    var paras = [];
    var cur = [];

    for (var i = 0; i < tokens.length; i++) {
      if (tokens[i] === PARA_TOKEN) {
        if (cur.length) paras.push(cur.join(' '));
        cur = [];
      } else {
        cur.push(tokens[i]);
      }
    }

    if (cur.length) paras.push(cur.join(' '));

    var html = '';
    for (var k = 0; k < paras.length; k++) {
      var txt = esc(paras[k]);

      if (k === 0 && withPhoto && photoUrl) {
        var sizeAttrs = '';
        var size = photoSizeByUrl[photoUrl];

        if (size && size.w > 0 && size.h > 0) {
          sizeAttrs =
            ' width="' + PHOTO_RENDER_W + '"' +
            ' height="' + Math.round(PHOTO_RENDER_W * size.h / size.w) + '"';
        }

        html += '<p class="no-indent"><img class="mem-photo" src="' +
          esc(photoUrl) + '" alt="' + esc(alt) + '"' + sizeAttrs + '>' + txt + '</p>';
      } else {
        html += '<p>' + txt + '</p>';
      }
    }

    return html;
  }

  function renderPersonPage(person, part, totalParts, tokenSlice) {
    var title = esc(person.full_name || 'Без имени');
    var subtitle = (totalParts > 1)
      ? ('Запись · часть ' + (part + 1) + ' / ' + totalParts)
      : 'Запись';

    var photoUrl = (part === 0) ? (person.photo_path || '') : '';
    var body = tokensToHtml(tokenSlice, part === 0, photoUrl, person.full_name || '');

    return '' +
      '<div class="book-content">' +
        '<div class="mem-subtitle">' + esc(subtitle) + '</div>' +
        '<h1>' + title + '</h1>' +
        body +
      '</div>';
  }

  function renderEmptyRecordsPage() {
    return '' +
      '<div class="book-content">' +
        '<h1>Пока нет записей</h1>' +
        '<p class="no-indent">Добавьте людей через панель админа — и они появятся в книге.</p>' +
      '</div>';
  }

  function renderBookTocPage(items) {
    return '' +
      '<div class="book-content book-toc-content">' +
        '<h1>Оглавление</h1>' +
        '<div class="book-toc-list">' + tocItemsToHtml(items) + '</div>' +
      '</div>';
  }

  function tocItemsToHtml(items) {
    var html = '';

    for (var i = 0; i < items.length; i++) {
      html += '' +
        '<div class="book-toc-item">' +
          '<button type="button" class="book-toc-link" data-page="' + items[i].page + '">' +
            esc(items[i].title) +
          '</button>' +
          '<span class="book-toc-dots" aria-hidden="true"></span>' +
          '<span class="book-toc-page">' + items[i].page + '</span>' +
        '</div>';
    }

    return html;
  }

  function findFit(items, render, measurer) {
    var lo = 0;
    var hi = items.length;
    var best = 0;

    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (measurer.fits(render(items.slice(0, mid)))) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return best;
  }

  function buildPersonModels(persons) {
    var models = [];
    var rawToc = [];
    var measurer = createMeasurer();
    var relativeStartPage = 1; // 1-я страница контента после книжного оглавления

    if (!persons.length) {
      models.push(function () {
        return renderEmptyRecordsPage();
      });

      measurer.destroy();
      return {
        models: models,
        rawToc: [],
        isEmpty: true
      };
    }

    for (var i = 0; i < persons.length; i++) {
      var person = persons[i];

      rawToc.push({
        id: person.id,
        title: person.full_name || ('Запись #' + (i + 1)),
        relativePage: relativeStartPage
      });

      var tokens = tokenize(person.short_info);
      if (!tokens.length) tokens = [PARA_TOKEN, 'Описание', 'отсутствует.'];

      var parts = [];
      var rest = tokens.slice();

      var firstRender = function (slice) {
        return renderPersonPage(person, 0, 1, slice);
      };

      var take = findFit(rest, firstRender, measurer);
      if (!take) take = 1;

      parts.push(rest.slice(0, take));
      rest = rest.slice(take);

      while (rest.length) {
        var partIndex = parts.length;

        (function (currentPartIndex) {
          var contRender = function (slice) {
            return renderPersonPage(person, currentPartIndex, 1, slice);
          };

          var t = findFit(rest, contRender, measurer);
          if (!t) t = 1;

          parts.push(rest.slice(0, t));
          rest = rest.slice(t);
        })(partIndex);
      }

      for (var k = 0; k < parts.length; k++) {
        (function (personRef, partIndex, totalParts, tokenSlice) {
          models.push(function () {
            return renderPersonPage(personRef, partIndex, totalParts, tokenSlice);
          });
        })(person, k, parts.length, parts[k]);

        relativeStartPage++;
      }
    }

    measurer.destroy();

    return {
      models: models,
      rawToc: rawToc,
      isEmpty: false
    };
  }

  function makeAbsoluteToc(rawToc, tocPageCount) {
    var out = [];

    for (var i = 0; i < rawToc.length; i++) {
      out.push({
        id: rawToc[i].id,
        title: rawToc[i].title,
        page: COVER_PAGES + tocPageCount + rawToc[i].relativePage
      });
    }

    return out;
  }

  function buildBookTocModels(tocEntries) {
    if (!tocEntries.length) return [];

    var models = [];
    var rest = tocEntries.slice();
    var measurer = createMeasurer();

    while (rest.length) {
      var take = findFit(rest, function (slice) {
        return renderBookTocPage(slice);
      }, measurer);

      if (!take) take = 1;

      (function (chunk) {
        models.push(function () {
          return renderBookTocPage(chunk);
        });
      })(rest.slice(0, take));

      rest = rest.slice(take);
    }

    measurer.destroy();
    return models;
  }

  function buildModels(persons) {
    var personsBuilt = buildPersonModels(persons);

    if (personsBuilt.isEmpty) {
      return {
        models: personsBuilt.models,
        toc: [{ title: 'Пока нет записей', page: CONTENT_START }]
      };
    }

    // fixed-point пересчёт:
    // количество страниц книжного оглавления влияет на реальные номера страниц записей,
    // а реальные номера страниц влияют на то, сколько места занимает само оглавление.
    var tocPageCount = 0;
    var prevTocPageCount = -1;
    var overlayToc = [];
    var bookTocModels = [];
    var safety = 0;

    while (tocPageCount !== prevTocPageCount && safety < 10) {
      prevTocPageCount = tocPageCount;
      overlayToc = makeAbsoluteToc(personsBuilt.rawToc, tocPageCount);
      bookTocModels = buildBookTocModels(overlayToc);
      tocPageCount = bookTocModels.length;
      safety++;
    }

    overlayToc = makeAbsoluteToc(personsBuilt.rawToc, tocPageCount);
    bookTocModels = buildBookTocModels(overlayToc);

    return {
      models: bookTocModels.concat(personsBuilt.models),
      toc: overlayToc
    };
  }

  function updateDepth(book, newPage) {
    var page = book.turn('page');
    var pages = book.turn('pages');
    var backInnerPage = state.totalPages - 1;

    newPage = newPage || page;

    var depthWidth = 16 * Math.min(1, page * 2 / pages);

    if (newPage > 3) {
      $('.sj-book .p2 .depth').css({
        width: depthWidth,
        left: 20 - depthWidth
      });
    } else {
      $('.sj-book .p2 .depth').css({
        width: 0
      });
    }

    depthWidth = 16 * Math.min(1, (pages - page) * 2 / pages);

    if (newPage < pages - 3) {
      $('.sj-book .p' + backInnerPage + ' .depth').css({
        width: depthWidth,
        right: 20 - depthWidth
      });
    } else {
      $('.sj-book .p' + backInnerPage + ' .depth').css({
        width: 0
      });
    }
  }

  function makeBackInner(page) {
    return $('<div />', {
      'class': 'hard fixed back-side cover-back-inner p' + page,
      html: '<div class="depth"></div>'
    });
  }

  function makeBackOuter(page) {
    return $('<div />', {
      'class': 'hard cover-back-outer p' + page
    });
  }

  function addPage(page, book) {
    if (book.turn('hasPage', page)) return;

    var contentEnd = CONTENT_START + state.pageModels.length - 1;

    if (page >= CONTENT_START && page <= contentEnd) {
      var idx = page - CONTENT_START;

      var $el = $('<div />', {
        'class': 'own-size ' + (page % 2 === 0 ? 'even' : 'odd') + ' p' + page,
        css: { width: PAGE_W, height: PAGE_H }
      }).html('<div class="loader"></div>');

      book.turn('addPage', $el, page);
      $el.html(state.pageModels[idx](page));
      return;
    }

    if (page === state.totalPages - 1) {
      book.turn('addPage', makeBackInner(page), page);
      return;
    }

    if (page === state.totalPages) {
      book.turn('addPage', makeBackOuter(page), page);
      return;
    }

    var $blank = $('<div />', {
      'class': 'own-size p' + page,
      css: { width: PAGE_W, height: PAGE_H }
    }).html('<div class="book-content"><p class="no-indent">…</p></div>');

    book.turn('addPage', $blank, page);
  }

  function buildTocOverlay() {
    var $list = $('#tocList').empty();

    for (var i = 0; i < state.toc.length; i++) {
      var item = state.toc[i];

      var $btn = $('<button />', {
        'class': 'toc-item',
        'data-page': item.page,
        type: 'button',
        html: '<span>' + esc(item.title) + '</span><span class="p">' + item.page + '</span>'
      });

      $list.append($btn);
    }
  }

  function updateStatus() {
    if (!state.bookReady) return;

    var pages = $book.turn('pages');
    var view = $book.turn('view') || [];
    var shown = [];

    for (var i = 0; i < view.length; i++) {
      if (view[i]) shown.push(view[i]);
    }

    var label = shown.length >= 2
      ? (shown[0] + '–' + shown[shown.length - 1])
      : String($book.turn('page'));

    $('#pageLabel').text('Стр. ' + label + ' / ' + pages);

    $('#prevBtn').prop('disabled', $book.turn('page') <= 1);
    $('#nextBtn').prop('disabled', $book.turn('page') >= pages);
    $status.text('Записей: ' + state.persons.length);
  }

  function initBook() {
    $book.turn({
      elevation: 50,
      acceleration: true,
      autoCenter: true,
      gradients: true,
      duration: 1600,
      pages: state.totalPages,
      when: {
        turning: function (e, page) {
          var backInnerPage = state.totalPages - 1;

          if (page >= 2) {
            $('.sj-book .p2').addClass('fixed');
          } else {
            $('.sj-book .p2').removeClass('fixed');
          }

          if (page < state.totalPages) {
            $('.sj-book .p' + backInnerPage).addClass('fixed');
          } else {
            $('.sj-book .p' + backInnerPage).removeClass('fixed');
          }

          updateDepth($book, page);
        },

        turned: function (e, page) {
          updateDepth($book, page);
          updateStatus();
        },

        end: function () {
          updateStatus();
        },

        missing: function (e, pages) {
          for (var i = 0; i < pages.length; i++) {
            addPage(pages[i], $book);
          }
        }
      }
    });

    addPage(state.totalPages - 1, $book);
    addPage(state.totalPages, $book);

    state.bookReady = true;
    $('#canvas').css({ visibility: '' });

    updateDepth($book, 1);
    updateStatus();
  }

  function start() {
    $('#canvas').css({ visibility: 'hidden' });
    $status.text('Загрузка…');

    fetchAllPersons()
      .done(function (persons) {
        state.persons = persons || [];

        $status.text('Подготовка страниц…');

        $.when(waitForBookFonts(), preloadPersonPhotos(state.persons))
          .always(function () {
            var built = buildModels(state.persons);
            state.pageModels = built.models;
            state.toc = built.toc;

            state.totalPages = COVER_PAGES + state.pageModels.length + BACK_COVERS;

            if (state.totalPages % 2 !== 0) {
              state.totalPages++;
            }

            buildTocOverlay();
            initBook();
          });
      })
      .fail(function () {
        $('#canvas').css({ visibility: '' });
        $status.text('Ошибка /api/v1/persons/');
      });
  }

  $(function () {
    $('#prevBtn').on('click', function () {
      if (state.bookReady) $book.turn('previous');
    });

    $('#nextBtn').on('click', function () {
      if (state.bookReady) $book.turn('next');
    });

    // Старые прозрачные половины больше не должны перехватывать клики,
    // иначе ссылки в книжном оглавлении не будут нажиматься.
    $('#clickLeft, #clickRight').css('pointer-events', 'none');

    // Перелистывание по клику по левой/правой половине книги.
//    $('#book-zoom').on('click', function (e) {
//      if (!state.bookReady) return;
//
//      // Если нажали на название в книжном оглавлении — не перелистываем.
//      if ($(e.target).closest('.book-toc-link').length) return;
//
//      var rect = this.getBoundingClientRect();
//      var x = e.clientX - rect.left;
//
//      if (x < rect.width / 2) {
//        $book.turn('previous');
//      } else {
//        $book.turn('next');
//      }
//    });

    // Overlay TOC
    $('#tocBtn').on('click', function () {
      $('#tocOverlay').show();
    });

    $('#tocOverlay').on('click', function (e) {
      if (e.target.id === 'tocOverlay') $('#tocOverlay').hide();
    });

    $('#tocList').on('click', '.toc-item', function () {
      var page = parseInt($(this).attr('data-page'), 10);
      $('#tocOverlay').hide();

      if (state.bookReady && page) {
        $book.turn('page', page);
      }
    });

    // Книжное оглавление внутри книги
    $book.on('click', '.book-toc-link', function (e) {
      e.preventDefault();
      e.stopPropagation();

      var page = parseInt($(this).attr('data-page'), 10);
      if (state.bookReady && page) {
        $book.turn('page', page);
      }
    });

    // keys
    $(document).on('keydown', function (e) {
      if (!state.bookReady) return;
      if (e.keyCode === 37) $book.turn('previous');
      if (e.keyCode === 39) $book.turn('next');
    });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        console.log('Шрифты загружены. Ждем отрисовку...');
        setTimeout(start, 100);
      });
    } else {
      $(window).on('load', start);
    }
  });

})();