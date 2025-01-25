# MathLive Electron App

This is an Electron application that integrates the MathLive library to provide a Mathfield editor. The app allows users to input mathematical expressions and copy them as MathML or LaTeX.

## Features

- Mathfield editor using MathLive
- Copy MathML and LaTeX to clipboard
- Electron tray application with a popover window

## Prerequisites

- [Node.js](https://nodejs.org/) (v14 or later)
- [npm](https://www.npmjs.com/)

## Installation

1. Clone the repository:
    ```sh
    git clone https://github.com/colby/MacMath.git
    cd MacMath/mathlive-electron
    ```

2. Install dependencies:
    ```sh
    npm install
    ```

## Running the Application

To start the Electron application, run:
```sh
npm start
```

## Project Structure

- `src/index.html`: Main HTML file containing the Mathfield editor and buttons.
- `src/renderer.js`: Renderer process script handling the Mathfield interactions and clipboard operations.
- `src/preload.js`: Preload script exposing clipboard functionality to the renderer process.
- `main.js`: Main process script setting up the Electron window and tray.

## Usage

1. Open the application using `npm start`.
2. Use the Mathfield editor to input mathematical expressions.
3. Click the "Copy MathML" or "Copy LaTeX" button to copy the respective format to the clipboard.

## Troubleshooting

If you encounter issues with copying to the clipboard, ensure that:
- The Mathfield element is properly initialized.
- The correct methods are used to retrieve MathML and LaTeX values.
- The Electron clipboard API is functioning correctly.

Check the console logs for any error messages or debug information.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.

## License

This project is licensed under the MIT License.