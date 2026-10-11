document.querySelectorAll('[data-password-toggle]').forEach((button) => {
  const input = button.parentElement.querySelector('input');
  if (!input) return;

  button.addEventListener('click', () => {
    const showPassword = input.type === 'password';
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;

    input.type = showPassword ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(showPassword));
    button.setAttribute('aria-label', showPassword ? 'Hide password' : 'Show password');
    button.title = showPassword ? 'Hide password' : 'Show password';
    input.focus();
    if (selectionStart !== null && selectionEnd !== null) {
      input.setSelectionRange(selectionStart, selectionEnd);
    }
  });
});
