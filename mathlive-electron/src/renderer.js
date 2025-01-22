// src/renderer.js

window.addEventListener('DOMContentLoaded', () => {
  const copyBtn = document.getElementById('copyMathMLBtn');
  const mathField = document.getElementById('mathfield');

  copyBtn.addEventListener('click', () => {
    const mathML = mathField.getValue('mathml');
    // Use the function exposed by preload
    window.electronAPI.copyText(mathML);
  });
});