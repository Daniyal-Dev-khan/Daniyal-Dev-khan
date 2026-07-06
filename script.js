// ============================================================
// Daniyal Ahmad Khan — Portfolio interactions
// ============================================================

// Nav: shadow on scroll
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

// Mobile menu
const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');
navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));
navLinks.querySelectorAll('a').forEach(a =>
  a.addEventListener('click', () => navLinks.classList.remove('open'))
);

// Scroll-reveal animations
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

// Project cards: expand "my role"
document.querySelectorAll('.gcard-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const card = btn.closest('.gcard');
    const open = card.classList.toggle('open');
    btn.textContent = open ? '− less' : '+ my role';
  });
});

// Hide broken remote screenshots gracefully
document.querySelectorAll('img.phone').forEach(img => {
  img.addEventListener('error', () => { img.style.display = 'none'; });
});
