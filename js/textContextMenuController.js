// js/textContextMenuController.js
// Управляет контекстным меню, появляющимся при выделении текста.
// --- ВЕРСИЯ 41: Добавлена кнопка "Комментировать" ---

import { editorArea } from './domElements.js';
import { debouncedSave } from './documentManager.js';
import { debounce } from './utils.js';
import { showColorMenu, hideColorMenu } from './colorMenuController.js';
import { showMenu as showLinkMenu, isLinkMenuVisible } from './linkMenuController.js';
import { isLinkEditMenuVisible } from './linkEditMenuController.js';
import {
    toggleClassForRange, isRangeAllClass,
    toggleTagForRange, isRangeAllTag,
    normalizeBlocks
} from './utils.js';
// --- НОВЫЙ ИМПОРТ ---
import { startCommenting } from './commentController.js'; // Импортируем функцию начала комментирования

// --- Состояние модуля ---
let menuElement = null;
let tooltipElement = null;
let isVisible = false;
let currentSelectionRange = null;
let potentialMouseSelection = false;
let mouseDownCoords = { x: 0, y: 0 };
let clickOutsideListenerAdded = false;
let escKeyListenerAdded = false;
let selectionChangeListenerActive = true;
let currentTooltipTarget = null;
let tooltipShowTimeoutId = null;

// --- Константы ---
const MIN_DRAG_DISTANCE = 5;
const SELECTION_CHECK_DELAY_MS = 10;
const SELECTION_CHANGE_DEBOUNCE_MS = 200;
const MARKER_ID_PREFIX = 'sel-marker-';
const TOOLTIP_OFFSET_Y = -8;
const TOOLTIP_SHOW_DELAY = 700;

// --- SVG иконки и стрелки ---
const COLOR_ICON_SVG_CONTENT = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="text-context-menu-icon-svg">
  <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
    <path d="m9 11l-6 6v3h9l3-3"/>
    <path d="m22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>
  </g>
</svg>
`;

const CHEVRON_DOWN_SVG_CONTENT = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 6" class="text-context-menu-arrow-svg">
  <path d="M1 1 L4 4 L7 1"
        fill="none"
        stroke="var(--secondary-text-color, #555)"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"/>
</svg>
`;

// --- Конфигурация кнопок меню (ДОБАВЛЕНА КНОПКА КОММЕНТИРОВАНИЯ) ---
const menuItems = [
    { action: 'bold',          label: 'Жирный',        shortcut: 'Cmd+B',       iconHtml: '<img src="Icons/Bold.svg" alt="Жирный">',        tag: 'b' },
    { action: 'italic',        label: 'Курсивный',     shortcut: 'Cmd+I',       iconHtml: '<img src="Icons/Italic.svg" alt="Курсив">',       tag: 'i' },
    { action: 'underline',     label: 'Подчеркнутый',  shortcut: 'Cmd+U',       iconHtml: '<img src="Icons/Underline.svg" alt="Подчеркнутый">', tag: 'u' },
    { action: 'strikethrough', label: 'Зачеркнутый',   shortcut: 'Cmd+Shift+S', iconHtml: '<img src="Icons/Strikethrough.svg" alt="Зачеркнутый">', tag: 's' },
    { action: 'code',          label: 'Код',           shortcut: 'Cmd+E',       iconHtml: '<img src="Icons/Code.svg" alt="Код">',           className: 'inline-code' },
    // Разделитель будет добавлен после 'code'
    { action: 'createLink',    label: 'Вставить ссылку', shortcut: 'Cmd+K',     iconHtml: '<img src="Icons/Link.svg" alt="Ссылка">',        hasSubmenu: true },
    { action: 'highlight',     label: 'Выделить цветом', shortcut: 'Cmd+Shift+H', hasSubmenu: true },
    // --- НОВЫЙ ПУНКТ МЕНЮ ---
    { action: 'comment',       label: 'Комментировать', shortcut: null,         iconHtml: '<img src="Icons/Comment.svg" alt="Комментировать">', isCommentAction: true },
    // Разделитель будет добавлен после 'comment'
];

// --- Вспомогательные функции ---

function createMenuDOM() {
    if (!menuElement) {
        menuElement = document.createElement('div');
        menuElement.id = 'text-context-menu';
        menuElement.className = 'text-context-menu';
        menuElement.style.display = 'none';
        menuElement.style.position = 'absolute';
        menuElement.style.zIndex = '1070';

        menuItems.forEach(item => {
            const button = document.createElement('button');
            button.className = 'text-context-menu-button';
            button.dataset.action = item.action;

            if (item.action === 'highlight') {
                button.innerHTML = COLOR_ICON_SVG_CONTENT;
            } else if (item.iconHtml) {
                button.innerHTML = item.iconHtml;
            } else {
                button.textContent = item.label || '?';
            }

            if (item.hasSubmenu) {
                const arrowSpan = document.createElement('span');
                arrowSpan.className = 'text-context-menu-arrow';
                arrowSpan.innerHTML = CHEVRON_DOWN_SVG_CONTENT;
                button.appendChild(arrowSpan);
            }

            menuElement.appendChild(button);

            // Добавляем разделители после 'code' и 'comment'
            if (item.action === 'code' || item.action === 'comment') {
                const separator = document.createElement('div');
                separator.className = 'text-context-menu-separator';
                menuElement.appendChild(separator);
            }
        });

        document.body.appendChild(menuElement);
        menuElement.addEventListener('mousedown', (e) => e.stopPropagation());
        menuElement.addEventListener('click', handleMenuClick);
        menuElement.addEventListener('mouseover', handleButtonMouseOver);
        menuElement.addEventListener('mouseout', handleButtonMouseOut);
        // console.log("Text Context Menu DOM created."); // DEBUG LOG
    }
    if (!tooltipElement) {
        tooltipElement = document.createElement('div');
        tooltipElement.id = 'custom-tooltip';
        tooltipElement.className = 'custom-tooltip';
        tooltipElement.style.display = 'none';
        tooltipElement.style.position = 'absolute';
        tooltipElement.style.zIndex = '1090';
        tooltipElement.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltipElement);
        // console.log("Custom Tooltip element created."); // DEBUG LOG
    }
}

function positionMenu() {
    if (!isVisible || !menuElement || !currentSelectionRange) return;
    const rangeRect = currentSelectionRange.getBoundingClientRect();
    const menuRect = menuElement.getBoundingClientRect();

    if (rangeRect.width === 0 && rangeRect.height === 0 && rangeRect.top === 0) {
        hideMenu();
        return;
    }

    let top = rangeRect.top + window.scrollY - menuRect.height - 8;
    let left = rangeRect.left + window.scrollX + (rangeRect.width / 2) - (menuRect.width / 2);

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left < 10) { left = 10; }
    else if (left + menuRect.width > viewportWidth - 10) {
        left = viewportWidth - menuRect.width - 10;
    }
    if (top < window.scrollY + 10 || rangeRect.top < 0) {
        top = rangeRect.bottom + window.scrollY + 8;
    }
    if (top + menuRect.height > window.scrollY + viewportHeight - 10) {
        top = window.scrollY + viewportHeight - menuRect.height - 10;
    }

    menuElement.style.top = `${top}px`;
    menuElement.style.left = `${left}px`;
}

function rangesAreEqual(range1, range2) {
    if (!range1 || !range2) return range1 === range2;
    return (
        range1.startContainer === range2.startContainer &&
        range1.startOffset === range2.startOffset &&
        range1.endContainer === range2.endContainer &&
        range1.endOffset === range2.endOffset
    );
}

function isDefaultColor(colorValue, type) {
    if (colorValue === null || colorValue === '' || colorValue === 'inherit') return true;
    const lowerColor = String(colorValue).toLowerCase();
    if (lowerColor.startsWith('rgba(') && lowerColor.endsWith(', 0)')) return true;
    if (lowerColor === 'transparent') return true;

    if (type === 'text') {
        const defaultEditorColor = getComputedStyle(editorArea).color.toLowerCase();
        return lowerColor === 'rgb(0, 0, 0)' || lowerColor === '#000000' || lowerColor === 'black' || lowerColor === defaultEditorColor || lowerColor === 'rgb(51, 51, 51)';
    } else {
        const defaultEditorBg = getComputedStyle(editorArea).backgroundColor.toLowerCase();
        const defaultButtonBg = 'rgb(255, 255, 255)';
        return lowerColor === defaultButtonBg || lowerColor === '#ffffff' || lowerColor === 'white' || lowerColor === defaultEditorBg;
    }
}

export function updateButtonStates(textMenuEl) {
    if (!textMenuEl || !isVisible || !currentSelectionRange) {
        return;
    }

    menuItems.forEach(item => {
        const button = textMenuEl.querySelector(`button[data-action="${item.action}"]`);
        if (!button) return;

        button.classList.remove('active');

        try {
            if (item.tag) {
                if (isRangeAllTag(currentSelectionRange, item.tag)) {
                    button.classList.add('active');
                }
            }
            else if (item.className) {
                if (isRangeAllClass(currentSelectionRange, item.className)) {
                    button.classList.add('active');
                }
            }
            else if (item.action === 'createLink') {
                const selection = window.getSelection();
                if(selection && selection.rangeCount > 0){
                    const node = selection.anchorNode;
                    let linkElement = null;
                    if (node) {
                        linkElement = node.nodeType === Node.ELEMENT_NODE ? node.closest('a') : node.parentElement?.closest('a');
                    }
                    if (linkElement && currentSelectionRange.intersectsNode(linkElement)) {
                        button.classList.add('active');
                    }
                }
            }
            else if (item.action === 'highlight') {
                const iconSvg = button.querySelector('svg.text-context-menu-icon-svg');
                if (iconSvg) {
                    let textColor = null, highlightColor = null;
                    try {
                        textColor = document.queryCommandValue('foreColor');
                        highlightColor = document.queryCommandValue('hiliteColor');
                        if (isDefaultColor(highlightColor, 'highlight')){
                            highlightColor = document.queryCommandValue('backColor');
                        }
                    } catch (e) {
                        // console.warn("Could not query color command values", e); // DEBUG LOG
                    }

                    const isTextDefault = isDefaultColor(textColor, 'text');
                    const isHighlightDefault = isDefaultColor(highlightColor, 'highlight');

                    iconSvg.style.color = '';
                    button.style.color = '';
                    button.style.backgroundColor = '';
                    button.classList.remove('active');

                    if (!isHighlightDefault) {
                        button.style.backgroundColor = highlightColor;
                    }
                    if (!isTextDefault) {
                        iconSvg.style.color = textColor;
                    }
                    if (!isTextDefault || !isHighlightDefault) {
                        button.classList.add('active');
                    }
                }
            }
            // Состояние кнопки "Комментировать" пока не обновляем (она всегда активна при выделении)
        } catch (e) {
            console.warn(`Error updating button state for ${item.action}:`, e);
        }
    });
}

function showMenuInternal() {
    if (!menuElement) createMenuDOM();
    if (!currentSelectionRange) {
        hideMenu();
        return;
    }

    updateButtonStates(menuElement);

    menuElement.style.display = 'flex';
    isVisible = true;
    positionMenu();

    if (!clickOutsideListenerAdded) {
        document.addEventListener('mousedown', handleClickOutside, true);
        clickOutsideListenerAdded = true;
    }
    if (!escKeyListenerAdded) {
        document.addEventListener('keydown', handleKeyDown, true);
        escKeyListenerAdded = true;
    }
}

export function hideMenu() {
    if (!isVisible) return;

    hideColorMenu();
    hideTooltip();

    if (menuElement) {
        menuElement.style.display = 'none';
    }
    isVisible = false;
    currentSelectionRange = null;

    if (clickOutsideListenerAdded) {
        document.removeEventListener('mousedown', handleClickOutside, true);
        clickOutsideListenerAdded = false;
    }
    if (escKeyListenerAdded) {
        document.removeEventListener('keydown', handleKeyDown, true);
        escKeyListenerAdded = false;
    }
    potentialMouseSelection = false;
}

function checkSelectionAndShowMenu() {
    const selection = window.getSelection();
    let isValidSelection = false;
    let newRange = null;

    if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        if (editorArea.contains(container) && selection.toString().length > 0) {
            isValidSelection = true;
            try {
                newRange = range.cloneRange();
            } catch (e) {
                console.error("Error cloning range:", e);
                isValidSelection = false;
            }
        }
    }

    if (isValidSelection && newRange) {
        if (!currentSelectionRange || !rangesAreEqual(currentSelectionRange, newRange) || !isVisible) {
            currentSelectionRange = newRange;
            showMenuInternal();
        } else {
            updateButtonStates(menuElement);
            positionMenu();
        }
    } else {
        if (isVisible) {
            hideMenu();
        }
    }
}

function handleSelectionChange() {
    if (!selectionChangeListenerActive || potentialMouseSelection) {
        return;
    }
    if (isLinkMenuVisible() || isLinkEditMenuVisible()) {
         // Не скрываем меню текста, если активно одно из меню ссылок
         return;
    }
    checkSelectionAndShowMenu();
}
const debouncedHandleSelectionChange = debounce(handleSelectionChange, SELECTION_CHANGE_DEBOUNCE_MS);

function handleMenuClick(event) {
    const button = event.target.closest('button.text-context-menu-button');
    if (!button) return;
    const action = button.dataset.action;
    if (!action) return;

    let initialRange = null;
    let startMarkerId = null;
    let endMarkerId = null;
    let affectedBlocks = new Set();
    let rangeToUseForApply = null;

    // --- Получаем Range и вставляем маркеры (кроме link, highlight, comment) ---
    if (action !== 'createLink' && action !== 'highlight' && action !== 'comment') {
        const currentSelection = window.getSelection();
        if (currentSelection && currentSelection.rangeCount > 0) {
            try {
                initialRange = currentSelection.getRangeAt(0).cloneRange();
                if (!initialRange.collapsed) {
                    const timestamp = Date.now();
                    startMarkerId = `${MARKER_ID_PREFIX}start-${timestamp}-${Math.random().toString(36).substring(2, 7)}`;
                    endMarkerId = `${MARKER_ID_PREFIX}end-${timestamp}-${Math.random().toString(36).substring(2, 7)}`;
                    const startMarker = document.createElement('span');
                    startMarker.id = startMarkerId; startMarker.style.display = 'none'; startMarker.textContent = '\ufeff';
                    const endMarker = document.createElement('span');
                    endMarker.id = endMarkerId; endMarker.style.display = 'none'; endMarker.textContent = '\ufeff';

                    const rangeForMarkers = initialRange.cloneRange();
                    rangeForMarkers.collapse(false); rangeForMarkers.insertNode(endMarker);
                    rangeForMarkers.setStart(initialRange.startContainer, initialRange.startOffset);
                    rangeForMarkers.collapse(true); rangeForMarkers.insertNode(startMarker);

                    rangeToUseForApply = document.createRange();
                    rangeToUseForApply.setStartAfter(startMarker);
                    rangeToUseForApply.setEndBefore(endMarker);

                } else {
                    initialRange = null;
                }
            } catch (e) {
                console.error("Error inserting markers:", e);
                startMarkerId = null; endMarkerId = null; initialRange = null; rangeToUseForApply = null;
                document.getElementById(startMarkerId)?.remove();
                document.getElementById(endMarkerId)?.remove();
                hideMenu();
                return;
            }
        }
    } else { // Для link, highlight, comment используем сохраненный Range
        if (currentSelectionRange && !currentSelectionRange.collapsed) {
            try {
                initialRange = currentSelectionRange.cloneRange();
                rangeToUseForApply = initialRange.cloneRange(); // Используем клон для действия
            } catch(e) {
                 console.error("Error cloning currentSelectionRange:", e);
                 initialRange = null; rangeToUseForApply = null;
                 hideMenu();
                 return;
            }
        }
    }

    // Проверка на валидный Range перед выполнением действий (кроме link, highlight, comment)
    if (!rangeToUseForApply && action !== 'createLink' && action !== 'highlight' && action !== 'comment') {
        console.warn("Cannot proceed with format, no valid range obtained.");
        hideMenu();
        return;
    }

    // --- Отключаем/восстанавливаем слушатель selectionchange ---
    const disableListener = (action !== 'createLink' && action !== 'highlight' && action !== 'comment');
    if (disableListener && selectionChangeListenerActive) {
        document.removeEventListener('selectionchange', debouncedHandleSelectionChange);
        selectionChangeListenerActive = false;
    }
    // ---

    try {
        const menuItemData = menuItems.find(item => item.action === action);

        switch (action) {
            case 'bold':
            case 'italic':
            case 'underline':
            case 'strikethrough':
                if (menuItemData?.tag && rangeToUseForApply) {
                    affectedBlocks = toggleTagForRange(rangeToUseForApply, menuItemData.tag);
                } else {
                    console.warn(`No tag defined or invalid range for action: ${action}`);
                }
                break;
            case 'code':
                if (menuItemData?.className && rangeToUseForApply) {
                    affectedBlocks = toggleClassForRange(rangeToUseForApply, menuItemData.className);
                } else {
                    console.warn(`No className defined or invalid range for action: ${action}`);
                }
                break;
            case 'createLink':
                if (initialRange instanceof Range && !initialRange.collapsed) {
                    showLinkMenu(button, initialRange.cloneRange());
                } else {
                    console.warn("[handleMenuClick - createLink] Cannot create link, no valid non-collapsed selection range stored.", initialRange);
                    hideMenu();
                }
                // Не восстанавливаем слушатель здесь, так как выходим
                return;
            case 'highlight':
                showColorMenu(button, initialRange, startMarkerId, endMarkerId);
                // Не восстанавливаем слушатель здесь, так как выходим
                return;
            // --- НОВЫЙ CASE ДЛЯ КОММЕНТАРИЕВ ---
            case 'comment':
                if (rangeToUseForApply instanceof Range && !rangeToUseForApply.collapsed) {
                    startCommenting(rangeToUseForApply.cloneRange()); // Передаем клон Range
                    hideMenu(); // Скрываем меню текста после начала комментирования
                } else {
                    console.warn("[handleMenuClick - comment] Cannot comment, no valid non-collapsed selection range stored.", rangeToUseForApply);
                    hideMenu();
                }
                // Не восстанавливаем слушатель здесь, так как выходим
                return;
            // --- КОНЕЦ НОВОГО CASE ---
            default:
                console.warn(`Unknown text menu action: ${action}`);
                // Восстанавливаем слушатель, если действие не обработано
                if (disableListener && !selectionChangeListenerActive) {
                    document.addEventListener('selectionchange', debouncedHandleSelectionChange);
                    selectionChangeListenerActive = true;
                }
                return;
        }
    } finally {
        // --- Восстановление выделения и слушателя ---
        const isHandledExternally = (action === 'highlight' || action === 'createLink' || action === 'comment'); // Добавили comment
        if (startMarkerId && endMarkerId && !isHandledExternally) {
            requestAnimationFrame(() => {
                let newRange = null;
                const startNode = document.getElementById(startMarkerId);
                const endNode = document.getElementById(endMarkerId);
                try {
                    if (startNode && endNode && startNode.parentNode && endNode.parentNode) {
                        const startFocusableParent = startNode.parentElement?.closest('[contenteditable="true"]');
                        if (startFocusableParent && document.activeElement !== startFocusableParent) {
                            startFocusableParent.focus({ preventScroll: true });
                        }
                        newRange = document.createRange();
                        newRange.setStartAfter(startNode);
                        newRange.setEndBefore(endNode);
                        const selection = window.getSelection();
                        selection.removeAllRanges();
                        selection.addRange(newRange);
                        currentSelectionRange = newRange.cloneRange();
                        if (affectedBlocks.size > 0) {
                            normalizeBlocks(affectedBlocks);
                        }
                        if (isVisible && menuElement) {
                            updateButtonStates(menuElement);
                            positionMenu();
                        }
                    } else {
                        // console.warn("RAF: Markers not found or detached."); // DEBUG LOG
                        currentSelectionRange = null;
                        hideMenu();
                    }
                } catch (e) {
                    console.error("RAF: Error restoring selection:", e);
                    currentSelectionRange = null;
                    hideMenu();
                } finally {
                    if (startNode) startNode.remove();
                    if (endNode) endNode.remove();
                    // Восстанавливаем слушатель только если он был отключен
                    if (disableListener && !selectionChangeListenerActive) {
                        document.addEventListener('selectionchange', debouncedHandleSelectionChange);
                        selectionChangeListenerActive = true;
                    }
                }
            });
        } else if (!isHandledExternally) {
             // Восстанавливаем слушатель, если не было маркеров и не обработано внешне
             if (disableListener && !selectionChangeListenerActive) {
                 document.addEventListener('selectionchange', debouncedHandleSelectionChange);
                 selectionChangeListenerActive = true;
             }
        }
        // --- КОНЕЦ ВОССТАНОВЛЕНИЯ ---
    }

    if (affectedBlocks.size > 0) {
        debouncedSave();
    }
}

// --- Tooltip Handlers ---

export function showTooltip(buttonElement, options = {}) {
    if (!tooltipElement || !buttonElement) return;

    let tooltipText = '';
    let position = 'top';

    if (typeof options === 'string') {
        tooltipText = options;
    } else {
        tooltipText = options.text || '';
        position = options.position === 'bottom' ? 'bottom' : 'top';
    }

    if (!tooltipText) {
        const action = buttonElement.dataset.action;
        const itemData = menuItems.find(item => item.action === action);
        if (itemData && itemData.label) {
            tooltipText = itemData.label;
            if (itemData.shortcut) {
                tooltipText += `\n<span class="tooltip-shortcut">${itemData.shortcut.replace('Cmd', '⌘')}</span>`;
            }
        }
    }

    if (tooltipText) {
        tooltipElement.innerHTML = tooltipText;
        const buttonRect = buttonElement.getBoundingClientRect();
        tooltipElement.style.display = 'block';
        const tooltipRect = tooltipElement.getBoundingClientRect();

        let top, left;
        left = buttonRect.left + window.scrollX + (buttonRect.width / 2) - (tooltipRect.width / 2);

        if (position === 'bottom') {
            top = buttonRect.bottom + window.scrollY - TOOLTIP_OFFSET_Y + 8;
        } else {
            top = buttonRect.top + window.scrollY - tooltipRect.height + TOOLTIP_OFFSET_Y;
        }

        if (left < 5) left = 5;
        if (left + tooltipRect.width > window.innerWidth - 5) left = window.innerWidth - tooltipRect.width - 5;
        if (position === 'top' && top < window.scrollY + 5) {
            top = buttonRect.bottom + window.scrollY - TOOLTIP_OFFSET_Y + 8;
        }
        if (top + tooltipRect.height > window.innerHeight + window.scrollY - 5) {
             top = buttonRect.top + window.scrollY - tooltipRect.height + TOOLTIP_OFFSET_Y;
             if (top < window.scrollY + 5) top = window.scrollY + 5;
        }

        tooltipElement.style.top = `${top}px`;
        tooltipElement.style.left = `${left}px`;
        tooltipElement.classList.add('visible');
    } else {
        hideTooltip();
    }
}

export function hideTooltip() {
    clearTimeout(tooltipShowTimeoutId);
    if (tooltipElement) {
        tooltipElement.classList.remove('visible');
        setTimeout(() => {
            if (tooltipElement && !tooltipElement.classList.contains('visible')) {
                 tooltipElement.style.display = 'none';
            }
        }, 150);
    }
}

function handleButtonMouseOver(event) {
    const button = event.target.closest('.text-context-menu-button');
    if (button) {
        clearTimeout(tooltipShowTimeoutId);
        tooltipShowTimeoutId = setTimeout(() => {
            if (button.matches(':hover')) {
                showTooltip(button);
                currentTooltipTarget = button;
            }
        }, TOOLTIP_SHOW_DELAY);
    }
}

function handleButtonMouseOut(event) {
    clearTimeout(tooltipShowTimeoutId);
    const button = event.target.closest('.text-context-menu-button');
    if (button && !button.contains(event.relatedTarget)) {
        hideTooltip();
        currentTooltipTarget = null;
    } else if (!button) {
        hideTooltip();
        currentTooltipTarget = null;
    }
}

// --- Document Event Handlers ---

function handleEditorMouseDown(event) {
    if (menuElement && menuElement.contains(event.target)) return;
    if (tooltipElement && tooltipElement.contains(event.target)) return;
    if (event.button !== 0) return;

    if (isVisible) {
        hideMenu();
    }

    mouseDownCoords = { x: event.clientX, y: event.clientY };
    potentialMouseSelection = true;

    document.addEventListener('mouseup', handleEditorMouseUp, { once: true, capture: true });
}

function handleEditorMouseUp(event) {
    if (!potentialMouseSelection) return;

    const mouseUpCoords = { x: event.clientX, y: event.clientY };
    potentialMouseSelection = false;

    const deltaX = mouseUpCoords.x - mouseDownCoords.x;
    const deltaY = mouseUpCoords.y - mouseDownCoords.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distance < MIN_DRAG_DISTANCE) {
        hideMenu();
        return;
    }

    setTimeout(() => {
        const colorMenu = document.getElementById('color-select-menu');
        if (isLinkMenuVisible() || isLinkEditMenuVisible()) return;
        if (colorMenu && colorMenu.style.display !== 'none') return;

        if (selectionChangeListenerActive &&
            (!menuElement || !menuElement.contains(event.target)) )
        {
            checkSelectionAndShowMenu();
        }
    }, SELECTION_CHECK_DELAY_MS);
}

function handleClickOutside(event) {
    const colorMenu = document.getElementById('color-select-menu');
    const linkMenu = document.getElementById('link-input-menu');
    const linkEditMenu = document.getElementById('link-edit-menu');

    // --- ИЗМЕНЕНИЕ: Не скрываем, если клик на кнопке ссылки или комментирования ---
    const isClickOnLinkButton = event.target.closest('button[data-action="createLink"]');
    const isClickOnCommentButton = event.target.closest('button[data-action="comment"]');
    if (isClickOnLinkButton || isClickOnCommentButton) return;
    // --- КОНЕЦ ИЗМЕНЕНИЯ ---

    if (isVisible && menuElement && !menuElement.contains(event.target)
        && (!colorMenu || !colorMenu.contains(event.target))
        && (!linkMenu || !linkMenu.contains(event.target))
        && (!linkEditMenu || !linkEditMenu.contains(event.target))
        && !editorArea.contains(event.target) )
    {
        hideMenu();
    }
    if (!editorArea.contains(event.target)) {
        potentialMouseSelection = false;
    }
}

function handleKeyDown(event) {
    if (isVisible && event.key === 'Escape') {
        if (isLinkMenuVisible() || isLinkEditMenuVisible()) return;

        event.preventDefault();
        event.stopPropagation();
        hideMenu();
    }
}

// --- Initialization ---
export function initializeTextContextMenu() {
    createMenuDOM();
    editorArea.addEventListener('mousedown', handleEditorMouseDown, true);

    if (selectionChangeListenerActive) {
        document.addEventListener('selectionchange', debouncedHandleSelectionChange);
    } else {
         selectionChangeListenerActive = true;
         document.addEventListener('selectionchange', debouncedHandleSelectionChange);
    }
    // console.log("Text Context Menu Initialized (v41 - Comment Button Added)."); // DEBUG LOG
}

// Export hideMenu function.
export const hideTextContextMenu = hideMenu;
