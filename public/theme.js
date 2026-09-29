(() => {
  const themeKey = 'sattwikTheme';
  const root = document.documentElement;

  try {
    root.dataset.theme = localStorage.getItem(themeKey) === 'dark' ? 'dark' : 'light';
  } catch (error) {
    root.dataset.theme = 'light';
  }
  root.classList.toggle('theme-dark', root.dataset.theme === 'dark');

  function addPasswordToggles() {
    document.querySelectorAll('input[type="password"]').forEach((input) => {
      if (input.dataset.visibilityToggle === 'true') return;
      input.dataset.visibilityToggle = 'true';

      const wrapper = document.createElement('span');
      wrapper.className = 'password-control';
      input.parentNode.insertBefore(wrapper, input);
      wrapper.append(input);

      const button = document.createElement('button');
      button.className = 'password-toggle';
      button.type = 'button';
      button.setAttribute('aria-controls', input.id);
      button.setAttribute('aria-label', 'Show password');
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
      button.addEventListener('click', () => {
        const isVisible = input.type === 'password';
        input.type = isVisible ? 'text' : 'password';
        button.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
        button.setAttribute('aria-pressed', String(isVisible));
      });
      wrapper.append(button);
    });
  }

  function mountThemeToggle() {
    if (document.getElementById('themeToggle')) return;
    const button = document.createElement('button');
    button.id = 'themeToggle';
    button.className = 'theme-toggle';
    button.type = 'button';
    button.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = theme;
      root.classList.toggle('theme-dark', theme === 'dark');
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
      button.textContent = `${theme === 'dark' ? 'Light' : 'Dark'} mode`;
      try {
        localStorage.setItem(themeKey, theme);
      } catch (error) {
        // The selected theme remains active for this page if storage is unavailable.
      }
    });

    const host = document.querySelector('.header-actions, .toolbar, .orders-actions, .delivery-header > div:last-child');
    if (host) host.prepend(button);
    else {
      button.style.position = 'fixed';
      button.style.top = '16px';
      button.style.right = '16px';
      button.style.zIndex = '1200';
      button.style.boxShadow = '0 5px 18px rgba(0, 0, 0, .12)';
      document.body.append(button);
    }

    const theme = root.dataset.theme;
    button.setAttribute('aria-pressed', String(theme === 'dark'));
    button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
    button.textContent = `${theme === 'dark' ? 'Light' : 'Dark'} mode`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    addPasswordToggles();
    mountThemeToggle();
  });
})();
