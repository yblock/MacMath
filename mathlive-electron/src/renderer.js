// src/renderer.js

window.addEventListener('DOMContentLoaded', () => {
  const copyMathMLBtn = document.getElementById('copyMathMLBtn');
  const copyLaTeXBtn = document.getElementById('copyLaTeXBtn');
  const mathField = document.getElementById('mathfield');

  // Ensure Mathfield is initialized
  mathField.setOptions({
    virtualKeyboardMode: 'manual'
  });

  mathField.addEventListener('input', () => {
    console.log("Mathfield content changed:", mathField.getValue('latex'));
  });

  console.log("Mathfield initialized:", mathField);

  copyMathMLBtn.addEventListener('click', () => {
    const mathML = mathField.getValue('mathML'); // Ensure correct method name
    console.log("MathML to copy:", mathML); // Debug log
    if (mathML) {
      // Use the function exposed by preload
      window.electronAPI.copyText(mathML).catch(() => {
        // Fallback to navigator.clipboard if electronAPI fails
        navigator.clipboard.writeText(mathML).then(() => {
          console.log("MathML copied to clipboard using navigator.clipboard");
        }).catch(err => {
          console.error("Failed to copy MathML:", err);
        });
      });
    } else {
      console.error("Failed to retrieve MathML value");
    }
  });

  copyLaTeXBtn.addEventListener('click', () => {
    const laTeX = mathField.getValue('latex'); // Ensure correct method name
    console.log("LaTeX to copy:", laTeX); // Debug log
    if (laTeX) {
      window.electronAPI.copyText(laTeX).catch(() => {
        // Fallback to navigator.clipboard if electronAPI fails
        navigator.clipboard.writeText(laTeX).then(() => {
          console.log("LaTeX copied to clipboard using navigator.clipboard");
        }).catch(err => {
          console.error("Failed to copy LaTeX:", err);
        });
      });
    } else {
      console.error("Failed to retrieve LaTeX value");
    }
  });

  // Additional logging to ensure Mathfield is loaded
  setTimeout(() => {
    console.log("Mathfield value after load:", mathField.getValue('latex'));
  }, 1000);
});


