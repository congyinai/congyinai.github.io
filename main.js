(() => {
  const root = document.documentElement;

  // Nav background once the hero scrolls away.
  const nav = document.getElementById('nav');
  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Theme toggle (persisted per visitor).
  const darkMq = matchMedia('(prefers-color-scheme: dark)');
  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = root.dataset.theme || (darkMq.matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) {}
  });

  // Reveal on scroll.
  const targets = document.querySelectorAll('.sec-head, .statement, .pillar, .feature, .pub, .step, .contact-mail');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px' });
    targets.forEach((el) => { el.classList.add('reveal'); io.observe(el); });
  }

  document.getElementById('year').textContent = new Date().getFullYear();
})();
