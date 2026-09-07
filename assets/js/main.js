/* Shared, dependency-free interactions for Tingrui Guo's pages. */
(function () {
  'use strict';

  var THEME_KEY = 'tg-theme';
  var root = document.documentElement;

  var themeButton = document.querySelector('.theme-toggle');
  if (themeButton) {
    themeButton.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    });
  }

  var navButton = document.querySelector('.nav-toggle');
  var navLinks = document.querySelector('.nav-links');
  if (navButton && navLinks) {
    navButton.addEventListener('click', function () {
      var open = navButton.getAttribute('aria-expanded') !== 'true';
      navButton.setAttribute('aria-expanded', String(open));
      navButton.classList.toggle('is-open', open);
      navLinks.classList.toggle('is-open', open);
    });
    navLinks.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        navButton.setAttribute('aria-expanded', 'false');
        navButton.classList.remove('is-open');
        navLinks.classList.remove('is-open');
      }
    });
  }

  document.querySelectorAll('[data-collapsible]').forEach(function (list) {
    var show = parseInt(list.getAttribute('data-show') || '5', 10);
    var items = Array.prototype.slice.call(list.children);
    var button = (list.parentElement || document).querySelector('[data-toggle]');
    if (!button || items.length <= show) { if (button) button.hidden = true; return; }
    function setOpen(open) {
      items.forEach(function (item, index) {
        item.classList.toggle('is-clipped', !open && index >= show);
      });
      button.textContent = open ? 'Show less ↑' : 'Show more ↓';
      button.setAttribute('aria-expanded', String(open));
    }
    button.addEventListener('click', function () {
      setOpen(button.getAttribute('aria-expanded') !== 'true');
    });
    setOpen(false);
  });

  var filterBar = document.querySelector('[data-filters]');
  if (filterBar) {
    var publications = Array.prototype.slice.call(document.querySelectorAll('[data-topics]'));
    filterBar.addEventListener('click', function (event) {
      var chip = event.target.closest('button[data-filter]');
      if (!chip) return;
      filterBar.querySelectorAll('button[data-filter]').forEach(function (button) {
        button.setAttribute('aria-pressed', String(button === chip));
      });
      var filter = chip.getAttribute('data-filter');
      publications.forEach(function (publication) {
        var topics = (publication.getAttribute('data-topics') || '').split(/\s+/);
        publication.hidden = filter !== 'all' && topics.indexOf(filter) === -1;
      });
    });
  }

  var revealItems = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window && !reduceMotion) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
    revealItems.forEach(function (item) { observer.observe(item); });
  } else {
    revealItems.forEach(function (item) { item.classList.add('is-in'); });
  }

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var source = document.getElementById(button.getAttribute('data-copy'));
      if (!source || !navigator.clipboard) return;
      navigator.clipboard.writeText(source.innerText).then(function () {
        var old = button.textContent;
        button.textContent = 'Copied ✓';
        setTimeout(function () { button.textContent = old; }, 1600);
      }).catch(function () {});
    });
  });

  /* Render the enlarged thumbnail as a fresh image at its target size.
     Scaling the 200px layout box directly can make browsers upscale a
     cached texture; cloning the original src avoids that soft result. */
  var zoomThumbs = Array.prototype.slice.call(document.querySelectorAll('.selected-publications .pub-thumb, .publications-page .pub-thumb'));
  var zoomImage = null;
  var zoomOrigin = null;
  var zoomReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function clearZoom() {
    if (zoomImage) {
      var closingImage = zoomImage;
      var origin = zoomOrigin;
      zoomImage = null;
      zoomOrigin = null;
      closingImage.classList.remove('is-visible');
      closingImage.classList.add('is-closing');
      /* Force the closing state to paint before transitioning back to the
         thumbnail rect, so shrinking is animated instead of skipped. */
      void closingImage.offsetWidth;
      if (origin) {
        closingImage.style.width = origin.width + 'px';
        closingImage.style.height = origin.height + 'px';
        closingImage.style.left = origin.left + 'px';
        closingImage.style.top = origin.top + 'px';
      }
      window.setTimeout(function () { closingImage.remove(); }, 260);
    }
    document.body.classList.remove('image-zoom-active');
  }
  function showZoom(image) {
    if (zoomReduced || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    clearZoom();
    var rect = image.getBoundingClientRect();
    var isPublicationThumbnail = !!image.closest('.publications-page');
    var scaleLimit = 3;
    var scale = Math.min(scaleLimit, (window.innerWidth * 0.9) / rect.width, (window.innerHeight * 0.82) / rect.height);
    var width = rect.width * scale;
    var height = rect.height * scale;
    var left = rect.left - (width - rect.width) * 0.3;
    var top = rect.top - (height - rect.height) * 0.5;
    /* Fit the original figure. In landscape, anchor its left edge to the
       thumbnail so the preview expands to the right without filling the page. */
    if (isPublicationThumbnail) {
      var viewportWidth = document.documentElement.clientWidth;
      var viewportHeight = window.innerHeight;
      var ratio = (image.naturalWidth || image.width) / (image.naturalHeight || image.height);
      width = Math.min(960, viewportWidth - 48, (viewportHeight - 64) * ratio);
      height = width / ratio;
      left = (viewportWidth - width) / 2;
      top = (viewportHeight - height) / 2;
      if (viewportWidth > viewportHeight) {
        left = Math.max(24, Math.min(rect.left, viewportWidth - 48));
        width = Math.min(600, rect.width * 3, viewportWidth * 0.55,
          viewportWidth - left - 24, viewportHeight * 0.65 * ratio);
        height = width / ratio;
        top = Math.max(24, Math.min(rect.top + (rect.height - height) / 2,
          viewportHeight - height - 24));
      }
    }
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
    zoomOrigin = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    zoomImage = image.cloneNode(true);
    // Never inherit thumbnail classes: their more specific rules override
    // fixed positioning and z-index when the clone is inside publications-page.
    zoomImage.className = 'pub-thumb-zoom';
    zoomImage.alt = '';
    zoomImage.setAttribute('aria-hidden', 'true');
    zoomImage.loading = 'eager';
    zoomImage.decoding = 'sync';
    zoomImage.style.width = rect.width + 'px';
    zoomImage.style.height = rect.height + 'px';
    zoomImage.style.left = rect.left + 'px';
    zoomImage.style.top = rect.top + 'px';
    document.body.appendChild(zoomImage);
    document.body.classList.add('image-zoom-active');
    var openingImage = zoomImage;
    window.requestAnimationFrame(function () {
      if (zoomImage !== openingImage) return;
      openingImage.style.width = width + 'px';
      openingImage.style.height = height + 'px';
      openingImage.style.left = left + 'px';
      openingImage.style.top = top + 'px';
      openingImage.classList.add('is-visible');
    });
  }
  zoomThumbs.forEach(function (image) {
    image.addEventListener('mouseenter', function () { showZoom(image); });
    image.addEventListener('mouseleave', clearZoom);
  });
  window.addEventListener('blur', clearZoom);
  window.addEventListener('resize', clearZoom);
  window.addEventListener('scroll', clearZoom, true);

  document.querySelectorAll('[data-year]').forEach(function (element) {
    element.textContent = String(new Date().getFullYear());
  });
})();
