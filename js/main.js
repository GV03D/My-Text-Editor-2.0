// js/main.js
// Точка входа в приложение редактора.
// Импортирует и запускает инициализацию после загрузки DOM.

import { initializeEditor } from './init.js'; // Импортируем главную функцию инициализации

// Ожидаем полной загрузки и разбора HTML-документа
document.addEventListener('DOMContentLoaded', () => {
    // Запускаем инициализацию редактора
    initializeEditor();
});