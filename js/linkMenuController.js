// js/linkMenuController.js
// Управляет кастомным меню для вставки/редактирования ссылок (внешних и внутренних).
// --- ВЕРСИЯ 9: Исправлено горизонтальное выравнивание при вызове из меню ---

import { editorArea } from './domElements.js';
import { getDocuments, getDocumentById, getActiveDocId } from './state.js';
import { debounce } from './utils.js';
import { debouncedSave } from './documentManager.js';
import { INTERNAL_LINK_PREFIX } from './config.js';

// --- Состояние модуля ---
let menuElement = null;
let inputElement = null;
let resultsListElement = null;
let isVisible = false;
let positionAnchor = null;       // Якорь для позиционирования (Element или Range)
let currentSelectionRange = null; // Range выделения, к которому применяется ссылка
let documentsCache = [];
let filteredDocuments = [];
let recentDocuments = [];
let currentSelectedIndex = -1;
let clickOutsideListener = null;
let keydownListener = null;

const MAX_RECENT_DOCS = 5;
const MENU_VERTICAL_OFFSET = 5; // Отступ между меню, когда одно вызывается из другого

// --- Вспомогательные функции ---

/**
 * Creates the DOM structure for the menu.
 */
function createMenuDOM() {
    if (menuElement) return;

    menuElement = document.createElement('div');
    menuElement.id = 'link-input-menu';
    menuElement.className = 'link-menu';
    menuElement.style.display = 'none';
    menuElement.style.position = 'absolute';
    menuElement.style.zIndex = '1080';

    inputElement = document.createElement('input');
    inputElement.type = 'text';
    inputElement.placeholder = 'Вставьте ссылку или найдите документ...';
    inputElement.className = 'link-menu-input';

    resultsListElement = document.createElement('ul');
    resultsListElement.className = 'link-menu-results';

    menuElement.appendChild(inputElement);
    menuElement.appendChild(resultsListElement);
    document.body.appendChild(menuElement);

    inputElement.addEventListener('input', debounce(handleInput, 150));
    inputElement.addEventListener('keydown', handleInputKeyDown);
    resultsListElement.addEventListener('click', handleResultItemClick);
    menuElement.addEventListener('mousedown', (e) => e.stopPropagation());

    // console.log("Link Input Menu DOM created."); // DEBUG LOG
}

/**
 * Positions the menu relative to the anchor (Element or Range).
 * Adds a vertical gap and aligns left edge to the button if the anchor is an Element.
 */
function positionMenu() {
    if (!isVisible || !menuElement || !positionAnchor) {
        console.warn("positionMenu: Aborted - Menu not visible or no anchor.");
        return;
    }

    let anchorRect;
    let parentMenuRect = null; // Для хранения координат родительского меню
    let isAnchorElement = false;

    try {
        if (positionAnchor instanceof Element) {
            anchorRect = positionAnchor.getBoundingClientRect(); // Координаты кнопки-якоря
            const parentContextMenu = positionAnchor.closest('#text-context-menu');
            if (parentContextMenu) {
                parentMenuRect = parentContextMenu.getBoundingClientRect(); // Координаты меню форматов
                // console.log("positionMenu: Anchor is Element, using button rect and parent menu rect:", anchorRect, parentMenuRect); // DEBUG LOG
            } else {
                // console.log("positionMenu: Anchor is Element, but parent text context menu not found. Using element rect only:", anchorRect); // DEBUG LOG
                parentMenuRect = anchorRect; // Используем координаты кнопки как базовые для top
            }
            isAnchorElement = true;
        } else if (positionAnchor instanceof Range) {
            anchorRect = positionAnchor.getBoundingClientRect();
            // console.log("positionMenu: Anchor is Range, using range rect:", anchorRect); // DEBUG LOG
            if (anchorRect.width === 0 && anchorRect.height === 0 && anchorRect.top === 0) {
                 const parentElement = positionAnchor.startContainer.parentElement;
                 if (parentElement) {
                    anchorRect = parentElement.getBoundingClientRect();
                    // console.log("positionMenu: Range rect invalid, using parent element rect:", anchorRect); // DEBUG LOG
                 } else {
                    console.warn("positionMenu: Cannot position, invalid Range rect and no parent element.");
                    hideMenu();
                    return;
                 }
            }
        } else {
            console.warn("LinkMenu: Invalid positionAnchor type.");
            hideMenu();
            return;
        }
    } catch (e) {
        console.error("LinkMenu: Error getting anchor bounding rect:", e);
        hideMenu();
        return;
    }


    const menuRect = menuElement.getBoundingClientRect();
    const menuGap = isAnchorElement ? MENU_VERTICAL_OFFSET : 0;
    // --- ИЗМЕНЕНИЕ: Расчет top и left ---
    // Top: от нижней границы родительского меню (или кнопки, если меню не найдено) + отступ
    let top = (parentMenuRect ? parentMenuRect.bottom : anchorRect.bottom) + window.scrollY + menuGap;
    // Left: от левой границы кнопки-якоря (если якорь - элемент) или от левой границы выделения
    let left = anchorRect.left + window.scrollX;
    // --- КОНЕЦ ИЗМЕНЕНИЯ ---

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Adjust position horizontally
    if (left + menuRect.width > viewportWidth - 10) {
        left = viewportWidth - menuRect.width - 10;
    }
    if (left < 10) left = 10;

    // Adjust position vertically
    // Проверяем, поместится ли меню снизу (относительно якоря - кнопки или выделения)
    if (top + menuRect.height > viewportHeight + window.scrollY - 10) {
         // Пытаемся разместить сверху от якоря (кнопки или выделения)
         let topAnchorBoundary = (parentMenuRect && isAnchorElement) ? parentMenuRect.top : anchorRect.top; // Верхняя граница меню форматов или выделения
         if (topAnchorBoundary > menuRect.height + menuGap + 10) { // Проверяем, есть ли место сверху
             top = topAnchorBoundary + window.scrollY - menuRect.height - menuGap;
         } else { // Если и сверху не лезет, прижимаем к верху экрана
             top = window.scrollY + 10;
         }
    }
     if (top < window.scrollY + 10) top = window.scrollY + 10; // Дополнительная проверка


    // console.log(`positionMenu: Calculated - Top: ${top}, Left: ${left}, Gap: ${menuGap}`); // DEBUG LOG
    menuElement.style.top = `${top}px`;
    menuElement.style.left = `${left}px`;
}

/**
 * Updates the results list in the menu.
 * @param {Array} documentsToShow - Array of document objects to display.
 * @param {string} [title="Недавние"] - Section title.
 */
function updateResultsList(documentsToShow, title = "Недавние") {
    if (!resultsListElement) return;
    resultsListElement.innerHTML = '';

    if (documentsToShow.length === 0 && inputElement.value.trim() !== '' && !isUrl(inputElement.value.trim())) {
        resultsListElement.innerHTML = '<li class="link-menu-no-results">Документы не найдены</li>';
        currentSelectedIndex = -1;
        return;
    }

     if (documentsToShow.length > 0 || title === "Недавние") {
         const titleElement = document.createElement('div');
         titleElement.className = 'link-menu-section-title';
         titleElement.textContent = title;
         resultsListElement.appendChild(titleElement);
     }

    documentsToShow.forEach((doc, index) => {
        const listItem = document.createElement('li');
        listItem.dataset.docId = doc.id;
        listItem.dataset.index = String(index);
        listItem.innerHTML = `
            <i class="far fa-file-alt"></i>
            <span>${doc.title || `Без названия ${doc.id}`}</span>
        `;
        resultsListElement.appendChild(listItem);
    });

    currentSelectedIndex = -1;
    if (documentsToShow.length > 0 && !isUrl(inputElement.value.trim())) {
        currentSelectedIndex = 0;
        highlightSelectedItem();
    } else {
        highlightSelectedItem();
    }
}

/**
 * Highlights the selected item in the list.
 */
function highlightSelectedItem() {
    if (!resultsListElement) return;
    const items = resultsListElement.querySelectorAll('li[data-doc-id]');
    items.forEach((item, index) => {
        item.classList.remove('selected');
        if (index === currentSelectedIndex) {
            item.classList.add('selected');
            item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    });
}

/**
 * Checks if a string looks like a URL.
 * @param {string} text
 * @returns {boolean}
 */
function isUrl(text) {
    try {
        new URL(text);
        return text.startsWith('http://') || text.startsWith('https://') || text.startsWith('mailto:') || text.startsWith('tel:');
    } catch (_) {
        return text.startsWith('mailto:') || text.startsWith('tel:');
    }
}

/**
 * Applies the link to the current selection range.
 * @param {string} href - The URL or internal document identifier.
 */
function applyLink(href) {
    if (!currentSelectionRange || currentSelectionRange.collapsed) {
        console.warn("LinkMenu: Cannot apply link, no valid selection range stored.");
        hideMenu();
        return;
    }

    const selection = window.getSelection();
    if (!selection) { hideMenu(); return; }
    try {
        selection.removeAllRanges();
        selection.addRange(currentSelectionRange);
    } catch(e) {
        console.error("LinkMenu: Error restoring selection range before applying link:", e);
        hideMenu();
        return;
    }

    // console.log(`LinkMenu: Applying link with href: ${href}`); // DEBUG LOG

    try {
        document.execCommand('createLink', false, href);

        let linkElement = selection.anchorNode?.parentElement?.closest('a');
        if (!linkElement) {
             linkElement = selection.focusNode?.parentElement?.closest('a');
        }

        if (linkElement && !href.startsWith(INTERNAL_LINK_PREFIX)) {
            linkElement.setAttribute('target', '_blank');
            linkElement.setAttribute('rel', 'noopener noreferrer');
        } else if (linkElement && href.startsWith(INTERNAL_LINK_PREFIX)) {
            linkElement.removeAttribute('target');
            linkElement.removeAttribute('rel');
        }

        debouncedSave();
    } catch (e) {
        console.error("LinkMenu: Error executing createLink command:", e);
        alert("Не удалось создать ссылку.");
    }

    hideMenu();
}

// --- Event Handlers ---

/**
 * Handles input in the search/URL field.
 */
function handleInput() {
    const query = inputElement.value.trim();
    const lowerQuery = query.toLowerCase();

    if (isUrl(query)) {
        resultsListElement.innerHTML = '';
        currentSelectedIndex = -1;
    } else if (query === '') {
        const activeId = getActiveDocId();
        filteredDocuments = recentDocuments.filter(doc => doc.id !== activeId);
        updateResultsList(filteredDocuments, "Недавние");
    } else {
        const activeId = getActiveDocId();
        filteredDocuments = documentsCache.filter(doc =>
            doc.id !== activeId &&
            doc.title.toLowerCase().includes(lowerQuery)
        );
        updateResultsList(filteredDocuments, "Найденные документы");
    }
}

/**
 * Handles keydown events in the input field.
 */
function handleInputKeyDown(event) {
    const items = resultsListElement.querySelectorAll('li[data-doc-id]');
    const itemsCount = items.length;

    switch (event.key) {
        case 'Enter':
            event.preventDefault();
            const value = inputElement.value.trim();
            if (isUrl(value)) {
                applyLink(value);
            } else if (currentSelectedIndex >= 0 && currentSelectedIndex < itemsCount) {
                const selectedItem = items[currentSelectedIndex];
                const docId = selectedItem.dataset.docId;
                if (docId) {
                    applyLink(`${INTERNAL_LINK_PREFIX}${docId}`);
                }
            } else {
                hideMenu();
            }
            break;
        case 'ArrowDown':
            if (itemsCount > 0) {
                event.preventDefault();
                currentSelectedIndex = (currentSelectedIndex + 1) % itemsCount;
                highlightSelectedItem();
            }
            break;
        case 'ArrowUp':
            if (itemsCount > 0) {
                event.preventDefault();
                currentSelectedIndex = (currentSelectedIndex - 1 + itemsCount) % itemsCount;
                highlightSelectedItem();
            }
            break;
        case 'Escape':
            event.preventDefault();
            hideMenu();
            break;
    }
}

/**
 * Handles click events on items in the results list.
 */
function handleResultItemClick(event) {
    const listItem = event.target.closest('li[data-doc-id]');
    if (listItem) {
        const docId = listItem.dataset.docId;
        if (docId) {
            applyLink(`${INTERNAL_LINK_PREFIX}${docId}`);
        }
    }
}

/**
 * Handles clicks outside the menu to close it.
 */
function handleClickOutside(event) {
    if (isVisible && menuElement && !menuElement.contains(event.target)) {
         const isClickOnAnchorElement = positionAnchor instanceof Element && positionAnchor.contains(event.target);
         const isClickOnTextMenuLinkButton = event.target.closest('button[data-action="createLink"]');
         const isClickInsideTextMenu = event.target.closest('#text-context-menu');

         if (!isClickOnAnchorElement && !isClickOnTextMenuLinkButton && !isClickInsideTextMenu) {
            hideMenu();
         }
    }
}

// --- Exported functions ---

/**
 * Initializes the link input menu.
 */
export function initializeLinkMenu() {
    createMenuDOM();
    // console.log("Link Input Menu Initialized."); // DEBUG LOG
}

/**
 * Shows the link input menu.
 * @param {Element | Range} anchor - The element (button) or Range (selection)
 * to position the menu relative to.
 * @param {Range} selectionRange - The actual text Range to apply the link to.
 */
export function showMenu(anchor, selectionRange) {
    if (!menuElement) createMenuDOM();

    if (!(selectionRange instanceof Range) || selectionRange.collapsed) {
        console.error("LinkMenu: Invalid or collapsed selectionRange provided to showMenu.");
        return;
    }
    try {
        currentSelectionRange = selectionRange.cloneRange();
    } catch (e) {
        console.error("LinkMenu: Error cloning selectionRange:", e);
        currentSelectionRange = null;
        return;
    }

    if (anchor instanceof Element || anchor instanceof Range) {
        positionAnchor = anchor;
    } else {
        console.error("LinkMenu: Invalid anchor provided to showMenu.");
        positionAnchor = currentSelectionRange;
    }

    documentsCache = getDocuments();
    const activeId = getActiveDocId();
    recentDocuments = documentsCache
        .filter(doc => doc.id !== activeId)
        .slice(0, MAX_RECENT_DOCS);

    inputElement.value = '';
    filteredDocuments = recentDocuments;
    updateResultsList(filteredDocuments, "Недавние");

    menuElement.style.display = 'block';
    isVisible = true;
    positionMenu(); // Position relative to positionAnchor
    inputElement.focus();

    setTimeout(() => {
        if (clickOutsideListener) document.removeEventListener('mousedown', clickOutsideListener, true);
        if (keydownListener) document.removeEventListener('keydown', keydownListener, true);

        clickOutsideListener = (e) => handleClickOutside(e);
        keydownListener = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                hideMenu();
            }
        };
        document.addEventListener('mousedown', clickOutsideListener, true);
        document.addEventListener('keydown', keydownListener, true);
    }, 0);
}

/**
 * Hides the link input menu.
 */
export function hideMenu() {
    if (!isVisible) return;
    if (menuElement) {
        menuElement.style.display = 'none';
    }
    isVisible = false;
    positionAnchor = null;
    currentSelectionRange = null;
    inputElement.value = '';
    resultsListElement.innerHTML = '';
    currentSelectedIndex = -1;

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
 * Checks if the link menu is currently visible.
 * @returns {boolean}
 */
export function isLinkMenuVisible() {
    return isVisible;
}