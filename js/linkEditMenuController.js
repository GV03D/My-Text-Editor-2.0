// js/linkEditMenuController.js
// Управляет меню для редактирования текста и URL существующих ссылок.
// --- ВЕРСИЯ 2: Фокус устанавливается на поле "Текст ссылки" при открытии ---

import { mainContent } from './domElements.js';
import { debouncedSave } from './documentManager.js';
import { INTERNAL_LINK_PREFIX } from './config.js';

// --- Состояние модуля ---
let menuElement = null;          // DOM-элемент самого меню
let textInputElement = null;     // Поле ввода для текста ссылки
let urlInputElement = null;      // Поле ввода для URL
let applyButtonElement = null;   // Кнопка "Применить"
let targetLinkElement = null;    // Текущий редактируемый элемент <a>
let isVisible = false;           // Флаг видимости меню
let clickOutsideListener = null; // Ссылка на обработчик клика вне меню
let keydownListener = null;      // Ссылка на обработчик нажатия клавиш

// --- Вспомогательные функции ---

/**
 * Creates the DOM structure for the menu if it doesn't exist.
 */
function ensureMenuDOM() {
    if (menuElement) return;

    menuElement = document.createElement('div');
    menuElement.id = 'link-edit-menu';
    menuElement.className = 'link-edit-menu'; // Класс для стилизации из style.css

    // Заголовок для текста ссылки
    const textLabel = document.createElement('div');
    textLabel.className = 'link-edit-label';
    textLabel.textContent = 'Текст ссылки';

    // Поле ввода текста ссылки
    textInputElement = document.createElement('input');
    textInputElement.type = 'text';
    textInputElement.className = 'link-edit-input';
    textInputElement.dataset.field = 'text'; // Идентификатор поля
    textInputElement.placeholder = 'Введите текст...'; // Плейсхолдер на всякий случай

    // Заголовок для URL
    const urlLabel = document.createElement('div');
    urlLabel.className = 'link-edit-label';
    urlLabel.textContent = 'Ссылка';

    // Поле ввода URL
    urlInputElement = document.createElement('input');
    urlInputElement.type = 'text';
    urlInputElement.className = 'link-edit-input';
    urlInputElement.dataset.field = 'url'; // Идентификатор поля
    urlInputElement.placeholder = 'Введите URL...'; // Плейсхолдер

    // Кнопка "Применить"
    applyButtonElement = document.createElement('button');
    applyButtonElement.className = 'link-edit-apply-button'; // Класс для стилизации
    applyButtonElement.textContent = 'Применить';

    // Добавляем элементы в меню
    menuElement.appendChild(textLabel);
    menuElement.appendChild(textInputElement);
    menuElement.appendChild(urlLabel);
    menuElement.appendChild(urlInputElement);
    menuElement.appendChild(applyButtonElement);

    // Добавляем меню в body
    document.body.appendChild(menuElement);

    // Добавляем обработчики событий для элементов меню
    textInputElement.addEventListener('focus', handleInputFocus);
    textInputElement.addEventListener('blur', handleInputBlur);
    urlInputElement.addEventListener('focus', handleInputFocus);
    urlInputElement.addEventListener('blur', handleInputBlur);
    applyButtonElement.addEventListener('click', handleApplyClick);

    // Предотвращаем закрытие меню при клике внутри него
    menuElement.addEventListener('mousedown', (e) => e.stopPropagation());

    console.log("Link Edit Menu DOM created.");
}

/**
 * Positions the menu near the target link element.
 * @param {Element} linkElement - The <a> element to position the menu relative to.
 */
function positionMenu(linkElement) {
    if (!isVisible || !menuElement || !linkElement) return;

    const linkRect = linkElement.getBoundingClientRect();
    const menuRect = menuElement.getBoundingClientRect();

    // Position below the link by default
    let top = linkRect.bottom + window.scrollY + 5;
    let left = linkRect.left + window.scrollX;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Adjust position to keep the menu within the viewport
    if (left + menuRect.width > viewportWidth - 10) {
        left = viewportWidth - menuRect.width - 10;
    }
    if (top + menuRect.height > viewportHeight - 10 && linkRect.top > menuRect.height + 10) {
        top = linkRect.top + window.scrollY - menuRect.height - 5; // Show above if it doesn't fit below
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10; // Stick to top if it doesn't fit above either

    menuElement.style.top = `${top}px`;
    menuElement.style.left = `${left}px`;
}

/**
 * Handles focus event on input fields.
 * Adds a 'focused' class for styling.
 * @param {FocusEvent} event
 */
function handleInputFocus(event) {
    event.target.classList.add('focused');
}

/**
 * Handles blur event on input fields.
 * Removes the 'focused' class.
 * @param {FocusEvent} event
 */
function handleInputBlur(event) {
    event.target.classList.remove('focused');
}

/**
 * Applies the changes from the input fields to the target link element.
 */
function applyChanges() {
    if (!targetLinkElement || !textInputElement || !urlInputElement) {
        console.warn("LinkEditMenu: Cannot apply changes, target element or inputs missing.");
        hideMenu();
        return;
    }

    const newText = textInputElement.value.trim();
    const newUrl = urlInputElement.value.trim();

    // Validate URL
    if (!newUrl) {
        alert("Поле 'Ссылка' не может быть пустым.");
        urlInputElement.focus();
        return;
    }

    // Use URL as text if text field is empty
    const finalText = newText || newUrl;

    console.log(`LinkEditMenu: Applying changes - Text: "${finalText}", URL: "${newUrl}"`);

    // Update link text and href
    targetLinkElement.textContent = finalText;
    targetLinkElement.setAttribute('href', newUrl);

    // Update target and rel attributes based on link type
    if (newUrl.startsWith(INTERNAL_LINK_PREFIX)) {
        targetLinkElement.removeAttribute('target');
        targetLinkElement.removeAttribute('rel');
    } else {
        targetLinkElement.setAttribute('target', '_blank');
        targetLinkElement.setAttribute('rel', 'noopener noreferrer');
    }

    // Save the document and hide the menu
    debouncedSave();
    hideMenu();
}

/**
 * Handles click event on the "Apply" button.
 */
function handleApplyClick() {
    applyChanges();
}

/**
 * Handles keydown events when the menu is visible.
 * Closes on Escape, applies changes on Cmd/Ctrl + Enter.
 * @param {KeyboardEvent} event
 */
function handleKeyDown(event) {
    if (!isVisible) return;

    // Close on Escape
    if (event.key === 'Escape') {
        event.stopPropagation();
        hideMenu();
    }
    // Apply on Cmd/Ctrl + Enter
    else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        applyChanges();
    }
}

/**
 * Handles clicks outside the menu to close it.
 * @param {MouseEvent} event
 */
function handleClickOutside(event) {
    if (isVisible && menuElement && !menuElement.contains(event.target)) {
        // Avoid closing if the click was on the edit icon that opened the menu
        const editIcon = event.target.closest('.link-hover-action-edit');
        if (!editIcon) {
            hideMenu();
        }
    }
}

// --- Exported functions ---

/**
 * Initializes the link edit menu.
 */
export function initializeLinkEditMenu() {
    ensureMenuDOM();
    console.log("Link Edit Menu Initialized.");
}

/**
 * Shows the link edit menu for the specified link element.
 * @param {Element} linkElement - The <a> element to edit.
 */
export function showMenu(linkElement) {
    if (!linkElement || linkElement.tagName !== 'A') {
        console.error("LinkEditMenu: Invalid link element provided to showMenu.");
        return;
    }
    ensureMenuDOM();

    targetLinkElement = linkElement; // Store the target link

    // Populate input fields with current values
    textInputElement.value = targetLinkElement.textContent || '';
    urlInputElement.value = targetLinkElement.getAttribute('href') || '';

    // Reset input styles to default (not focused)
    textInputElement.classList.remove('focused');
    urlInputElement.classList.remove('focused');

    menuElement.style.display = 'block'; // Show the menu
    isVisible = true;
    positionMenu(targetLinkElement); // Position it

    // --- ИЗМЕНЕНИЕ: Устанавливаем фокус на поле текста ссылки ---
    textInputElement.focus();
    // Выделяем весь текст в поле для удобства редактирования
    textInputElement.select();
    // --- КОНЕЦ ИЗМЕНЕНИЯ ---

    // Add listeners to close the menu (using setTimeout to ensure they are added after the current event cycle)
    setTimeout(() => {
        // Remove previous listeners first to avoid duplicates
        if (clickOutsideListener) document.removeEventListener('mousedown', clickOutsideListener, true);
        if (keydownListener) document.removeEventListener('keydown', keydownListener, true);

        clickOutsideListener = (e) => handleClickOutside(e);
        keydownListener = (e) => handleKeyDown(e);

        document.addEventListener('mousedown', clickOutsideListener, true);
        document.addEventListener('keydown', keydownListener, true);
    }, 0);
}

/**
 * Hides the link edit menu.
 */
export function hideMenu() {
    if (!isVisible) return;
    if (menuElement) {
        menuElement.style.display = 'none';
    }
    isVisible = false;
    targetLinkElement = null; // Clear the target link reference

    // Remove document listeners
    if (clickOutsideListener) {
        document.removeEventListener('mousedown', clickOutsideListener, true);
        clickOutsideListener = null;
    }
    if (keydownListener) {
        document.removeEventListener('keydown', keydownListener, true);
        keydownListener = null;
    }
}

/**
 * Checks if the link edit menu is currently visible.
 * @returns {boolean}
 */
export function isLinkEditMenuVisible() {
    return isVisible;
}