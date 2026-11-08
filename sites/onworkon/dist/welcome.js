import { WelcomeFlow } from './welcome-flow.js';

const screen = document.querySelector('.mobile-screen');
const conversation = document.querySelector('.conversation');
const flow = new WelcomeFlow();
let pendingSubmission;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const inputMeasure = document.createElement('span');
inputMeasure.className = 'entry-measure';
inputMeasure.setAttribute('aria-hidden', 'true');
document.body.append(inputMeasure);
let typing;
let advancing = false;
let pointerStart;
let confirmedEntry = null;

function typeText(element, text, input = null) {
  const characters = Array.from(segmenter.segment(text), item => item.segment);
  const underlineSteps = input ? 4 : 0;
  const totalSteps = characters.length + underlineSteps;
  let index = 0;
  let timer;
  let done = false;
  conversation.setAttribute('aria-busy', 'true');

  function finish() {
    if (done) return;
    done = true;
    clearTimeout(timer);
    element.textContent = text;
    if (input) {
      input.hidden = false;
      input.readOnly = false;
      input.tabIndex = 0;
      input.classList.remove('entry-input--typing');
      input.style.removeProperty('--underline-progress');
    }
    typing = null;
    conversation.setAttribute('aria-busy', 'false');
  }

  typing = { finish };
  function tick() {
    if (done) return;
    index += 1;
    if (index <= characters.length) {
      element.textContent = characters.slice(0, index).join('');
    } else if (input) {
      // The underline is the final four characters of the same typing sequence.
      input.style.setProperty('--underline-progress', (index - characters.length) / underlineSteps);
      input.hidden = false;
    }
    if (index >= totalSteps) finish();
    else timer = setTimeout(tick, 42);
  }

  if (reducedMotion.matches) finish();
  else tick();
}

function createInput(state, label) {
  const form = document.createElement('form');
  form.className = 'entry-form';
  form.noValidate = true;
  const input = document.createElement('input');
  input.className = 'entry-input entry-input--typing';
  input.id = state.step + '-input';
  input.name = state.step === 'name' ? 'name' : 'invitation-code';
  input.type = 'text';
  input.hidden = true;
  input.readOnly = true;
  input.tabIndex = -1;
  input.maxLength = 32;
  input.autocomplete = state.step === 'name' ? 'given-name' : 'off';
  input.enterKeyHint = 'done';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', state.step === 'name' ? 'words' : 'off');
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
  });
  label.htmlFor = input.id;
  form.append(label, input);

  input.addEventListener('focus', () => resumeEditing(input));
  input.addEventListener('input', () => {
    resumeEditing(input);
    sizeInput(input);
  });
  const sizeAfterComposition = () => requestAnimationFrame(() => {
    if (input.isConnected) sizeInput(input);
  });
  input.addEventListener('compositionupdate', sizeAfterComposition);
  input.addEventListener('compositionend', sizeAfterComposition);

  if (state.step === 'name') {
    input.required = true;
  } else {
    input.inputMode = 'text';
    input.addEventListener('input', () => {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      conversation.querySelector('.code-error')?.remove();
    });
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    void advance();
  });
  return form;
}

function sizeInput(input) {
  const style = getComputedStyle(input);
  inputMeasure.style.font = style.font;
  inputMeasure.style.letterSpacing = style.letterSpacing;
  inputMeasure.style.wordSpacing = style.wordSpacing;
  // Measure rendered glyphs, including Hangul fallback fonts and mixed text.
  inputMeasure.textContent = '0000';
  const minimumWidth = inputMeasure.getBoundingClientRect().width;
  inputMeasure.textContent = input.value;
  const textWidth = inputMeasure.getBoundingClientRect().width;
  input.style.setProperty('--entry-width', Math.ceil(Math.max(minimumWidth, textWidth) + 2) + 'px');
}

function resizeCurrentInput() {
  const input = conversation.querySelector('.message--current .entry-input');
  if (input) sizeInput(input);
}

void document.fonts.ready.then(resizeCurrentInput);
document.fonts.addEventListener('loadingdone', resizeCurrentInput);

function resumeEditing(input) {
  if (input.disabled || input.classList.contains('entry-input--typing')) return;
  confirmedEntry = null;
  input.readOnly = false;
  input.classList.remove('entry-input--confirmed');
}

function confirmEntry(input) {
  if (!input.value.trim() || input.disabled) return false;
  if (confirmedEntry?.input === input && confirmedEntry.value === input.value) {
    resumeEditing(input);
    return true;
  }
  // The first outside action ends editing; a separate second action submits.
  confirmedEntry = { input, value: input.value };
  input.readOnly = true;
  input.classList.add('entry-input--confirmed');
  input.blur();
  screen.focus({ preventScroll: true });
  return false;
}

function render() {
  confirmedEntry = null;
  const state = flow.state;
  for (const old of conversation.querySelectorAll('.message--previous')) {
    old.classList.replace('message--previous', 'message--leaving');
    setTimeout(() => old.remove(), 500);
  }

  const previous = conversation.querySelector('.message--current');
  previous.classList.replace('message--current', 'message--previous');
  previous.setAttribute('aria-hidden', 'true');
  const oldForm = previous.querySelector('form');
  if (oldForm) {
    const summary = document.createElement('p');
    summary.className = 'message__text';
    summary.textContent = oldForm.querySelector('label').textContent + ' ' + oldForm.querySelector('input').value;
    previous.replaceChildren(summary);
  }
  previous.querySelector('.save-error')?.remove();

  const message = document.createElement('div');
  message.className = 'message message--current';
  message.dataset.step = state.step;
  const needsInput = state.step === 'name' || state.step === 'code';
  const text = document.createElement(needsInput ? 'label' : 'p');
  text.className = 'message__text';
  text.title = state.text;
  const form = needsInput ? createInput(state, text) : null;
  message.append(form || text);
  conversation.append(message);
  if (form) sizeInput(form.querySelector('input'));
  typeText(text, state.text, form?.querySelector('input'));
}

async function saveName(name) {
  // Retry the same value with the same ID; edits after a failure start a new submission.
  if (!pendingSubmission || pendingSubmission.name !== name) {
    pendingSubmission = {
      name,
      id: globalThis.crypto.randomUUID?.()
        ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join(''),
    };
  }
  const response = await fetch('/api/names', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, submissionId: pendingSubmission.id }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Name could not be saved.');
  const result = await response.json();
  if (result.saved !== true) throw new Error('Name storage was not confirmed.');
}

function submitCode() {
  if (typing || flow.state.step !== 'code') return;
  const input = conversation.querySelector('#code-input');
  if (!input || input.disabled || !input.value.trim()) return;
  conversation.querySelector('.code-error')?.remove();

  if (!flow.submitCode(input.value)) {
    const error = document.createElement('p');
    error.className = 'save-error code-error';
    error.id = 'code-error';
    error.setAttribute('role', 'alert');
    error.textContent = input.value.trim() ? 'That code isn’t right. Try again.' : 'Please enter the code.';
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', error.id);
    conversation.querySelector('.message--current').append(error);
    return;
  }

  input.disabled = true;
  input.blur();
  window.location.assign(flow.state.destination);
}

async function advance() {
  if (advancing) return;
  if (typing) {
    typing.finish();
    return;
  }
  const entry = conversation.querySelector('.message--current .entry-input');
  if (entry && !confirmEntry(entry)) return;
  if (flow.state.step === 'code') {
    submitCode();
    return;
  }
  const nameInput = flow.state.step === 'name' ? conversation.querySelector('#name-input') : null;
  if (nameInput) {
    if (!flow.completeName(nameInput.value)) return;
    nameInput.value = flow.state.name;
    sizeInput(nameInput);
    nameInput.disabled = true;
    nameInput.blur();
  }
  advancing = true;
  conversation.querySelector('.save-error')?.remove();
  conversation.setAttribute('aria-busy', 'true');
  try {
    if (await flow.next(saveName)) render();
  } catch {
    const error = document.createElement('p');
    error.className = 'save-error';
    error.setAttribute('role', 'alert');
    error.textContent = 'Couldn’t save. Tap to retry.';
    conversation.querySelector('.message--current').append(error);
  } finally {
    advancing = false;
    if (nameInput?.isConnected) nameInput.disabled = false;
    if (!typing) conversation.setAttribute('aria-busy', 'false');
  }
}

function inputNearPointer(event) {
  const input = conversation.querySelector('.message--current .entry-input');
  if (!input || input.hidden || input.classList.contains('entry-input--typing') || input.disabled) return null;
  if (event.target === input) return input;
  const bounds = input.getBoundingClientRect();
  // The 44px-tall field also accepts taps 12px to either side of its underline.
  return event.clientX >= bounds.left - 12 && event.clientX <= bounds.right + 12
    && event.clientY >= bounds.top && event.clientY <= bounds.bottom ? input : null;
}

screen.addEventListener('pointerdown', event => {
  if (event.target.closest('.page-navigation')) return;
  const input = inputNearPointer(event);
  pointerStart = { input, x: event.clientX, y: event.clientY };
  if (input) resumeEditing(input);
  if (input && event.target !== input) {
    event.preventDefault();
    input.focus({ preventScroll: true });
  }
});

screen.addEventListener('pointercancel', () => {
  pointerStart = null;
});

screen.addEventListener('click', event => {
  const start = pointerStart;
  pointerStart = null;
  if (event.target.closest('.page-navigation')) return;
  if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
  const input = start?.input || inputNearPointer(event);
  if (input) {
    resumeEditing(input);
    if (event.target !== input) {
      event.preventDefault();
      input.focus({ preventScroll: true });
    }
    return;
  }
  event.preventDefault();
  void advance();
});

screen.addEventListener('keydown', event => {
  if (event.target !== screen || !['Enter', ' '].includes(event.key) || event.repeat) return;
  event.preventDefault();
  void advance();
});

// Hello! remains at y353 until the first tap. There is no automatic progression.
