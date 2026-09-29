(() => {
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

  document.addEventListener('DOMContentLoaded', addPasswordToggles);
})();
