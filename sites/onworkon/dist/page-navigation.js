import { resolvePageCode } from './page-routes.js';

const form = document.querySelector('.page-navigation');
const input = form.querySelector('.page-code-input');
const error = form.querySelector('.page-code-error');
const currentCode = input.defaultValue;
const measure = document.createElement('span');
measure.className = 'entry-measure';
measure.setAttribute('aria-hidden', 'true');
document.body.append(measure);
let composing = false;
let navigating = false;

function sizeInput() {
  const style = getComputedStyle(input);
  measure.style.font = style.font;
  measure.style.letterSpacing = style.letterSpacing;
  measure.style.wordSpacing = style.wordSpacing;
  measure.textContent = input.value || ' ';
  input.style.setProperty('--page-code-width', Math.ceil(measure.getBoundingClientRect().width + 2) + 'px');
}

function clearError() {
  error.hidden = true;
  error.textContent = '';
  input.removeAttribute('aria-invalid');
  input.setAttribute('aria-describedby', 'page-code-help');
}

function restoreCurrentCode() {
  clearError();
  input.value = currentCode;
  sizeInput();
}

// Editing the navigation must not advance the welcome conversation behind it.
for (const type of ['pointerdown', 'pointerup', 'click', 'keydown']) {
  form.addEventListener(type, event => event.stopPropagation());
}
input.addEventListener('focus', () => input.select());
input.addEventListener('input', () => {
  clearError();
  sizeInput();
});
input.addEventListener('compositionstart', () => { composing = true; });
input.addEventListener('compositionupdate', () => requestAnimationFrame(sizeInput));
input.addEventListener('compositionend', () => {
  composing = false;
  requestAnimationFrame(sizeInput);
});
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229 || event.repeat)) event.preventDefault();
  if (event.key === 'Escape' && !composing) {
    event.preventDefault();
    restoreCurrentCode();
    input.blur();
  }
});
input.addEventListener('blur', () => {
  if (!navigating) restoreCurrentCode();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  event.stopPropagation();
  if (composing || navigating) return;
  const destination = resolvePageCode(input.value);
  if (!destination) {
    error.textContent = input.value.trim() ? 'Unknown code.' : 'Enter a page code.';
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', 'page-code-help page-code-error');
    input.focus();
    return;
  }
  if (new URL(destination, location.href).pathname === location.pathname) {
    restoreCurrentCode();
    input.blur();
    return;
  }
  navigating = true;
  input.readOnly = true;
  input.blur();
  location.assign(destination);
});
window.addEventListener('pageshow', () => {
  navigating = false;
  input.readOnly = false;
  restoreCurrentCode();
});
sizeInput();
void document.fonts.ready.then(sizeInput);
document.fonts.addEventListener('loadingdone', sizeInput);
