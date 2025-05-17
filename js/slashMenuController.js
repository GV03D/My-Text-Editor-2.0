// js/slashMenuController.js
// Управляет контекстным меню команд, вызываемым по '/'
// --- ИЗМЕНЕНО: Вызывает showImageMenu после создания блока 'image' ---

import { editorArea } from './domElements.js';
import { changeBlockType } from './blockFormatter.js';
import { focusAtStart } from './utils.js';
import { getEditableContentElement, updatePlaceholderVisibility } from './blockUtils.js';
// --- НОВЫЙ ИМПОРТ ---
import { showImageMenu } from './imageMenuController.js'; // Импортируем функцию показа меню изображения

// --- Переменные состояния модуля ---
let menuElement = null;
let targetBlockElement = null; // Блок, из которого вызвано меню
let currentSelectedIndex = -1;
let menuItemsData = [];

// --- Конфигурация меню ---
export const blockTypes = [
    { type: 'image',   label: 'Изображение',        iconHtml: '<img src="Icons/Image.svg" alt="Изображение">',      markdownHint: '' },
    { type: 'quote',   label: 'Цитата',             iconHtml: '<img src="Icons/Quote.svg" alt="Цитата">',         markdownHint: '"' },
    { type: 'callout', label: 'Примечание',         iconHtml: '<img src="Icons/Callout.svg" alt="Примечание">',     markdownHint: '!' },
    { type: 'h1',      label: 'Заголовок 1',        iconHtml: '<img src="Icons/H1.svg" alt="Заголовок 1">',        markdownHint: '#' },
    { type: 'h2',      label: 'Заголовок 2',        iconHtml: '<img src="Icons/H2.svg" alt="Заголовок 2">',        markdownHint: '##' },
    { type: 'h3',      label: 'Заголовок 3',        iconHtml: '<img src="Icons/H3.svg" alt="Заголовок 3">',        markdownHint: '###' },
    { type: 'todo',    label: 'Список задач',       iconHtml: '<img src="Icons/To-do List.svg" alt="Список задач">', markdownHint: '[]' },
    { type: 'toggle',  label: 'Выпадающий список',  iconHtml: '<img src="Icons/Toggle List.svg" alt="Выпадающий список">', markdownHint: '>' },
    { type: 'li',      listType: 'ol', label: 'Нумерованный список',  iconHtml: '<img src="Icons/Numbered List.svg" alt="Нумерованный список">',  markdownHint: '1.' },
    { type: 'li',      listType: 'ul', label: 'Маркированный список', iconHtml: '<img src="Icons/Bulleted List.svg" alt="Маркированный список">', markdownHint: '-' },
];

/**
 * Создает DOM-элемент меню, если он еще не создан.
 */
function ensureMenuElement() {
    if (!menuElement) {
        menuElement = document.createElement('div');
        menuElement.id = 'slash-command-menu';
        menuElement.className = 'slash-menu';
        menuElement.style.display = 'none';
        menuElement.setAttribute('tabindex', '-1');
        document.body.appendChild(menuElement);
        console.log("Slash command menu element created and appended to body.");
    }
}

/**
 * Обновляет подсветку выбранного элемента в меню.
 */
function updateHighlight() {
    const items = menuElement.querySelectorAll('.slash-menu-item');
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === currentSelectedIndex);
        if (index === currentSelectedIndex) {
            item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });
}

/**
 * Очищает временный плейсхолдер из целевого блока.
 */
function clearBlockPlaceholder() {
    if (targetBlockElement && document.body.contains(targetBlockElement)) {
        const contentElement = getEditableContentElement(targetBlockElement);
        if (contentElement && contentElement.classList.contains('is-slash-placeholder')) {
            console.log("Clearing slash placeholder from block:", targetBlockElement.dataset.blockId);
            contentElement.classList.remove('is-slash-placeholder');
            contentElement.innerHTML = '';
            updatePlaceholderVisibility(targetBlockElement);
        }
    }
}

/**
 * Выбирает и выполняет действие для текущего выделенного элемента.
 */
function selectCurrentItem() {
    if (currentSelectedIndex >= 0 && currentSelectedIndex < menuItemsData.length) {
        const selectedData = menuItemsData[currentSelectedIndex];
        console.log("Selected item:", selectedData);

        if (targetBlockElement) {
            clearBlockPlaceholder();

            // Вызываем changeBlockType и сохраняем результат (новый элемент)
            const newBlockElement = changeBlockType(targetBlockElement, selectedData.type, selectedData.listType || null);

            // --- НОВАЯ ЛОГИКА: Показ меню для image ---
            if (selectedData.type === 'image' && newBlockElement) {
                // Вызываем меню для нового блока 'image' с небольшой задержкой
                 setTimeout(() => {
                    // Дополнительно проверяем, что блок все еще в DOM
                    if (document.body.contains(newBlockElement)) {
                        showImageMenu(newBlockElement);
                    }
                 }, 50); // 50ms задержка
            }
            // --- КОНЕЦ НОВОЙ ЛОГИКИ ---

        } else {
            console.error("Target block element is missing for selection.");
        }
        hideMenu(); // Скрываем slash-меню в любом случае
    } else {
        console.warn("No item selected or index out of bounds.");
        hideMenu();
    }
}

/**
 * Обработчик нажатий клавиш, когда меню активно.
 * @param {KeyboardEvent} event
 * @returns {boolean} - true, если клавиша обработана
 */
function handleKeyDown(event) {
    if (!menuElement || menuElement.style.display === 'none') { return false; }
    const itemsCount = menuItemsData.length;
    if (itemsCount === 0) return false;

    switch (event.key) {
        case 'ArrowDown': event.preventDefault(); currentSelectedIndex = (currentSelectedIndex + 1) % itemsCount; updateHighlight(); return true;
        case 'ArrowUp': event.preventDefault(); currentSelectedIndex = (currentSelectedIndex - 1 + itemsCount) % itemsCount; updateHighlight(); return true;
        case 'Enter': event.preventDefault(); selectCurrentItem(); return true;
        case 'Escape': event.preventDefault(); hideMenu(); if (targetBlockElement) { const contentEl = getEditableContentElement(targetBlockElement); if (contentEl && document.body.contains(contentEl)) { requestAnimationFrame(() => focusAtStart(contentEl)); } } return true;
        default: return false;
    }
}

/**
 * Обработчик клика по элементу меню.
 * @param {MouseEvent} event
 */
function handleItemClick(event) {
    const clickedItem = event.target.closest('.slash-menu-item');
    if (!clickedItem || !menuElement.contains(clickedItem)) return;
    const allItems = Array.from(menuElement.children);
    const index = allItems.indexOf(clickedItem);
    if (index !== -1) { currentSelectedIndex = index; selectCurrentItem(); }
}

/**
 * Обработчик клика вне меню для его закрытия.
 * @param {MouseEvent} event
 */
function handleClickOutside(event) {
    if (menuElement && menuElement.style.display !== 'none' && !menuElement.contains(event.target) && targetBlockElement && !targetBlockElement.contains(event.target)) {
        console.log("Click outside detected, hiding menu.");
        hideMenu();
    }
}

/**
 * Показывает и позиционирует меню рядом с указанным блоком.
 * @param {Element} blockElement - Блок параграфа, где был введен '/'.
 */
export function showMenu(blockElement) {
    if (!blockElement) return;
    if (isMenuActive() && targetBlockElement !== blockElement) { hideMenu(); }
    targetBlockElement = blockElement;
    ensureMenuElement();
    menuElement.innerHTML = '';
    menuItemsData = [];

    blockTypes.forEach(itemData => {
        menuItemsData.push(itemData);
        const menuItem = document.createElement('div');
        menuItem.className = 'slash-menu-item';
        menuItem.dataset.blockType = itemData.type;
        if (itemData.listType) { menuItem.dataset.listType = itemData.listType; }
        const iconSpan = document.createElement('span');
        iconSpan.className = 'slash-menu-icon';
        iconSpan.innerHTML = itemData.iconHtml || '';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'slash-menu-label';
        labelSpan.textContent = itemData.label;
        const hintSpan = document.createElement('span');
        hintSpan.className = 'slash-menu-hint';
        hintSpan.textContent = itemData.markdownHint || '';
        menuItem.appendChild(iconSpan);
        menuItem.appendChild(labelSpan);
        menuItem.appendChild(hintSpan);
        menuElement.appendChild(menuItem);
    });

    const rect = blockElement.getBoundingClientRect();
    const menuTop = window.scrollY + rect.bottom + 2;
    const menuLeft = window.scrollX + rect.left;
    menuElement.style.top = `${menuTop}px`;
    menuElement.style.left = `${menuLeft}px`;
    menuElement.style.display = 'block';
    console.log(`Showing menu at T: ${menuTop}, L: ${menuLeft} for block ${blockElement.dataset.blockId}`);
    currentSelectedIndex = 0;
    updateHighlight();
    setTimeout(() => {
        document.addEventListener('click', handleClickOutside, true);
        menuElement.addEventListener('click', handleItemClick);
    }, 0);
}

/**
 * Скрывает меню и очищает состояние.
 */
export function hideMenu() {
    if (menuElement && menuElement.style.display !== 'none') {
        clearBlockPlaceholder();
        menuElement.style.display = 'none';
        targetBlockElement = null;
        currentSelectedIndex = -1;
        menuItemsData = [];
        document.removeEventListener('click', handleClickOutside, true);
        menuElement.removeEventListener('click', handleItemClick);
        console.log("Menu hidden, listeners removed.");
    } else {
        if (targetBlockElement) { clearBlockPlaceholder(); targetBlockElement = null; }
    }
}

/**
 * Проверяет, активно ли меню.
 * @returns {boolean}
 */
export function isMenuActive() {
    return menuElement && menuElement.style.display !== 'none';
}

/**
 * Экспортируем функцию обработки клавиш, чтобы ее мог вызвать keyboardHandler.
 * @param {KeyboardEvent} event
 * @returns {boolean} - true, если событие было обработано меню, иначе false.
 */
export function handleMenuKeyDown(event) {
    return handleKeyDown(event);
}

/**
 * Инициализирует меню при запуске приложения.
 */
export function initializeSlashMenu() {
    ensureMenuElement();
    console.log("Slash menu initialized.");
}