import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
// Без StrictMode (v1.7.5): в dev-режиме он монтирует компоненты дважды и
// прогоняет cleanup эффектов на живых узлах — модалки-«призраки» (v1.6.6) и
// fade-анимации от этого моргают. Прод-сборке StrictMode не даёт ничего,
// а полигон (dev.sh + npm start) обязан выглядеть ровно как прод.
root.render(<App />);
