const stage = document.querySelector('.card-stage');
const canvas = document.querySelector('.card-canvas');
const hint = document.querySelector('.card-hint');
stage.setAttribute('aria-busy', 'true');

function showReady() {
  stage.classList.remove('card-stage--fallback');
  stage.classList.add('card-stage--ready');
  stage.setAttribute('aria-busy', 'false');
  canvas.hidden = false;
  hint.textContent = 'Drag to rotate';
}

function showFallback() {
  stage.classList.remove('card-stage--ready', 'card-stage--dragging');
  stage.classList.add('card-stage--fallback');
  stage.setAttribute('aria-busy', 'false');
  canvas.hidden = true;
  hint.textContent = 'Front / back';
}

// Keep both views hidden while the 3D bundle and textures load.
try {
  const { createCard } = await import('./card-viewer.js');
  await createCard({ showReady, showFallback });
} catch (error) {
  console.warn('The 3D card could not be initialized.', error);
  showFallback();
}
