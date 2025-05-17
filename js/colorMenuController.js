// js/colorMenuController.js
// Управляет подменю выбора цвета текста и выделения.
// --- ВЕРСИЯ 19: Добавлены подробные логи для отладки восстановления выделения ---

import { editorArea } from './domElements.js';
import { debouncedSave } from './documentManager.js';
import { hideTextContextMenu, updateButtonStates as updateTextMenuButtonStates } from './textContextMenuController.js'; // Переименовал импорт
import { setLastUsedColor } from './state.js';
// Импортируем функции для работы со стилями и нормализации
import { applyStyleToRange, removeStyleFromRange, normalizeBlocks } from './utils.js';

// --- Состояние модуля ---
let colorMenuElement = null;
let isVisible = false;
let savedSelectionRange = null; // Сохраненный Range выделения (теперь используется как fallback)
let startMarkerId = null;       // ID начального маркера
let endMarkerId = null;         // ID конечного маркера
let affectedBlocks = new Set(); // Блоки, затронутые изменением стиля
let recentColors = [];
const MAX_RECENT_COLORS = 10;
let clickOutsideListenerAdded = false;

// +++ ЛОКАЛЬНАЯ ФУНКЦИЯ normalizeColor (скопирована из keyboardHandler/utils) +++
/**
 * Нормализует строку цвета к стандартному формату (rgb/rgba или ключевые слова).
 * @param {string | null} colorStr - Входящая строка цвета (hex, rgb, name, null).
 * @returns {string | null} - Нормализованный цвет (чаще всего rgba) или null/inherit/transparent.
 */
function normalizeColor(colorStr) {
    if (!colorStr || typeof colorStr !== 'string') return null;
    const lowerColor = colorStr.toLowerCase().trim();

    if (lowerColor === 'transparent' || lowerColor.startsWith('rgba(') && lowerColor.endsWith(', 0)')) return 'transparent';
    if (lowerColor === 'inherit') return 'inherit';

    const temp = document.createElement('div');
    temp.style.color = '#111'; // Default color that is unlikely to be the target
    temp.style.color = lowerColor; // Apply the user's color
    temp.style.display = 'none';
    document.body.appendChild(temp);
    let computedColor = null;
    try {
        computedColor = window.getComputedStyle(temp).color;
    } catch(e) {
        console.error("Error getting computed style for color normalization:", e);
    }
    document.body.removeChild(temp);

    // Handle cases where computedStyle might return transparent or invalid
    if (!computedColor || computedColor === 'rgba(0, 0, 0, 0)') {
        // Re-check original string for explicit transparency
        if (lowerColor === 'transparent' || (lowerColor.startsWith('rgba(') && lowerColor.endsWith(', 0)'))) {
             return 'transparent';
        }
        // If it wasn't explicitly transparent, return null or the original if needed
        return null; // Or perhaps return colorStr if you want to preserve invalid inputs?
    }

    // Return the computed color (likely in rgb or rgba format)
    return computedColor;
}
// +++ КОНЕЦ ЛОКАЛЬНОЙ ФУНКЦИИ +++


// --- Палитры (без изменений) ---
const defaultTextColors = [
    { label: 'По умолчанию', value: 'inherit', textColor: 'inherit', borderColor: '#333333', isDefault: true },
    { label: 'Серый', value: '#787775', textColor: '#787775', borderColor: '#E5E4E1' },
    { label: 'Коричневый', value: '#936F57', textColor: '#936F57', borderColor: '#EBE0D8' },
    { label: 'Оранжевый', value: '#C47B2D', textColor: '#C47B2D', borderColor: '#F1DECD' },
    { label: 'Желтый', value: '#BE9342', textColor: '#BE9342', borderColor: '#F3E6BF' },
    { label: 'Зеленый', value: '#5C7F64', textColor: '#5C7F64', borderColor: '#E1EADE' },
    { label: 'Синий', value: '#507DA6', textColor: '#507DA6', borderColor: '#DAE6F1' },
    { label: 'Фиолетовый', value: '#866DAC', textColor: '#866DAC', borderColor: '#E5DFEE' },
    { label: 'Розовый', value: '#AB5C88', textColor: '#AB5C88', borderColor: '#F2E1EA' },
    { label: 'Красный', value: '#BB5D4C', textColor: '#BB5D4C', borderColor: '#F4E0DA' },
];
const defaultHighlightColors = [
    { label: 'Без выделения', value: 'transparent', fillColor: '#ffffff', borderColor: '#333333', isDefault: true },
    { label: 'Серый фон', value: '#F8F8F7', fillColor: '#F8F8F7', borderColor: '#DFDEDA' },
    { label: 'Коричневый фон', value: '#F3EFEE', fillColor: '#F3EFEE', borderColor: '#E3D6CD' },
    { label: 'Оранжевый фон', value: '#F7EDDF', fillColor: '#F7EDDF', borderColor: '#EBD1B6' },
    { label: 'Желтый фон', value: '#F9F3DE', fillColor: '#F9F3DE', borderColor: '#EFDFAB' },
    { label: 'Зеленый фон', value: '#EFF3ED', fillColor: '#EFF3ED', borderColor: '#D5E1D1' },
    { label: 'Синий фон', value: '#EBF3F8', fillColor: '#EBF3F8', borderColor: '#CBDDEC' },
    { label: 'Фиолетовый фон', value: '#F7F4FC', fillColor: '#F7F4FC', borderColor: '#DFD7EC' },
    { label: 'Розовый фон', value: '#F9F2F6', fillColor: '#F9F2F6', borderColor: '#EED8E3' },
    { label: 'Красный фон', value: '#F8ECEC', fillColor: '#F8ECEC', borderColor: '#F0D5CF' },
];

// --- Вспомогательные функции (createMenuDOM, createSwatchElement, positionMenu - без изменений) ---
function createMenuDOM() {
    if (colorMenuElement) return;
    colorMenuElement = document.createElement('div');
    colorMenuElement.id = 'color-select-menu';
    colorMenuElement.className = 'color-menu';
    colorMenuElement.style.display = 'none';
    colorMenuElement.style.position = 'absolute';
    colorMenuElement.style.zIndex = '1080';
    const recentSection = document.createElement('div'); recentSection.className = 'color-menu-section recent-colors-section';
    const recentTitle = document.createElement('div'); recentTitle.className = 'color-menu-title'; recentTitle.textContent = 'Недавние';
    const recentSwatches = document.createElement('div'); recentSwatches.className = 'color-swatch-container recent-swatches';
    recentSection.appendChild(recentTitle); recentSection.appendChild(recentSwatches);
    const textSection = document.createElement('div'); textSection.className = 'color-menu-section';
    const textTitle = document.createElement('div'); textTitle.className = 'color-menu-title'; textTitle.textContent = 'Цвет текста';
    const textSwatches = document.createElement('div'); textSwatches.className = 'color-swatch-container';
    defaultTextColors.forEach(colorInfo => { textSwatches.appendChild(createSwatchElement(colorInfo, 'text')); });
    textSection.appendChild(textTitle); textSection.appendChild(textSwatches);
    const highlightSection = document.createElement('div'); highlightSection.className = 'color-menu-section';
    const highlightTitle = document.createElement('div'); highlightTitle.className = 'color-menu-title'; highlightTitle.textContent = 'Цвет выделения';
    const highlightSwatches = document.createElement('div'); highlightSwatches.className = 'color-swatch-container';
    defaultHighlightColors.forEach(colorInfo => { highlightSwatches.appendChild(createSwatchElement(colorInfo, 'highlight')); });
    highlightSection.appendChild(highlightTitle); highlightSection.appendChild(highlightSwatches);
    colorMenuElement.appendChild(recentSection); colorMenuElement.appendChild(textSection); colorMenuElement.appendChild(highlightSection);
    document.body.appendChild(colorMenuElement);
    colorMenuElement.addEventListener('click', handleColorSwatchClick);
    colorMenuElement.addEventListener('mousedown', (e) => e.stopPropagation()); // Предотвращаем закрытие при клике внутри
    console.log("Color Menu DOM created.");
    loadRecentColors();
}

function createSwatchElement(colorInfo, type) {
    const swatch = document.createElement('button');
    swatch.className = 'color-swatch';
    swatch.dataset.color = colorInfo.value;
    swatch.dataset.type = type;
    swatch.title = colorInfo.label || `${type === 'text' ? 'Текст' : 'Выделение'}: ${colorInfo.value}`;
    swatch.setAttribute('aria-label', swatch.title);
    swatch.innerHTML = '';
    if (type === 'text') {
        swatch.classList.add('color-swatch-text');
        const textSpan = document.createElement('span');
        textSpan.textContent = 'А';
        textSpan.style.color = colorInfo.textColor === 'inherit' ? 'var(--primary-text-color, #333)' : colorInfo.textColor;
        swatch.style.borderColor = colorInfo.borderColor;
        swatch.style.backgroundColor = '#ffffff';
        swatch.appendChild(textSpan);
    } else {
        swatch.classList.add('color-swatch-highlight');
        if (colorInfo.isDefault || colorInfo.value === 'transparent') {
            swatch.style.backgroundColor = '#ffffff';
            swatch.style.borderColor = colorInfo.borderColor;
            const lineSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="0" y1="100" x2="100" y2="0" vector-effect="non-scaling-stroke"/></svg>`;
            swatch.innerHTML = lineSvg;
        } else {
            swatch.style.backgroundColor = colorInfo.fillColor;
            swatch.style.borderColor = colorInfo.borderColor;
        }
    }
    return swatch;
}

function positionMenu(anchorButton) {
    if (!isVisible || !colorMenuElement || !anchorButton) return;
    const anchorRect = anchorButton.getBoundingClientRect();
    const menuRect = colorMenuElement.getBoundingClientRect();
    let top = anchorRect.bottom + window.scrollY + 4;
    let left = anchorRect.left + window.scrollX;
    const viewportWidth = window.innerWidth; const viewportHeight = window.innerHeight;
    if (left < 10) { left = 10; } else if (left + menuRect.width > viewportWidth - 10) { left = viewportWidth - menuRect.width - 10; }
    if (top + menuRect.height > window.scrollY + viewportHeight - 10) { top = anchorRect.top + window.scrollY - menuRect.height - 4; }
    if (top < window.scrollY + 10) { top = window.scrollY + 10; }
    colorMenuElement.style.top = `${top}px`; colorMenuElement.style.left = `${left}px`;
}

/**
 * Удаляет временные маркеры выделения из DOM.
 */
function removeMarkers() {
    const startNode = startMarkerId ? document.getElementById(startMarkerId) : null;
    const endNode = endMarkerId ? document.getElementById(endMarkerId) : null;
    if (startNode) startNode.remove();
    if (endNode) endNode.remove();
    console.log(`[ColorMenu LOG] Markers removed (if existed): Start=${startMarkerId}, End=${endMarkerId}`); // LOG
    startMarkerId = null;
    endMarkerId = null;
}

/**
 * Скрывает меню цвета и удаляет маркеры, если они есть.
 */
export function hideColorMenu() {
    if (!isVisible || !colorMenuElement) return;
    console.log("[ColorMenu LOG] Hiding color menu."); // LOG
    colorMenuElement.style.display = 'none';
    isVisible = false;
    savedSelectionRange = null; // Сбрасываем сохраненный range
    removeMarkers(); // Удаляем маркеры при скрытии
    affectedBlocks.clear(); // Очищаем затронутые блоки
    if (clickOutsideListenerAdded) {
        document.removeEventListener('mousedown', handleClickOutsideColorMenu, true);
        clickOutsideListenerAdded = false;
        console.log("[ColorMenu LOG] Removed click outside listener."); // LOG
    }
    // Не скрываем основное меню текста здесь, оно само закроется или останется
}

/**
 * Обработчик клика по образцу цвета.
 */
function handleColorSwatchClick(event) {
    event.preventDefault(); // Предотвращаем любые стандартные действия кнопки
    event.stopPropagation(); // Останавливаем всплытие, чтобы не закрыть меню сразу
    console.log("[ColorMenu LOG] handleColorSwatchClick: START"); // LOG

    const swatch = event.target.closest('.color-swatch');
    if (!swatch) return;
    const colorValue = swatch.dataset.color;
    const type = swatch.dataset.type; // 'text' или 'highlight'
    if (!colorValue || !type) return;

    console.log(`[ColorMenu LOG] Swatch clicked: Type=${type}, Value=${colorValue}`); // LOG

    // --- 1. Получение диапазона между маркерами ---
    let rangeBetweenMarkers = null;
    const startNode = startMarkerId ? document.getElementById(startMarkerId) : null;
    const endNode = endMarkerId ? document.getElementById(endMarkerId) : null;
    let rangeToRestoreAfterRAF = null; // Сохраняем копию для RAF

    if (startNode && endNode && startNode.parentNode && endNode.parentNode) {
        try {
            rangeBetweenMarkers = document.createRange();
            rangeBetweenMarkers.setStartAfter(startNode);
            rangeBetweenMarkers.setEndBefore(endNode);
            rangeToRestoreAfterRAF = rangeBetweenMarkers.cloneRange(); // Клонируем ДО изменений
            console.log("[ColorMenu LOG] Created range between markers for formatting.", rangeBetweenMarkers); // LOG
        } catch (e) {
            console.error("[ColorMenu LOG] Error creating range between markers:", e); // LOG
            rangeBetweenMarkers = null;
        }
    } else {
        console.warn("[ColorMenu LOG] Markers not found or detached. Trying fallback range."); // LOG
        // Используем savedSelectionRange как fallback, если маркеры не найдены
        if (savedSelectionRange && document.body.contains(savedSelectionRange.startContainer) && document.body.contains(savedSelectionRange.endContainer)) {
            rangeBetweenMarkers = savedSelectionRange.cloneRange();
            rangeToRestoreAfterRAF = rangeBetweenMarkers.cloneRange(); // Клонируем ДО изменений
            console.log("[ColorMenu LOG] Using fallback savedSelectionRange.", rangeBetweenMarkers); // LOG
        }
    }

    if (!rangeBetweenMarkers || rangeBetweenMarkers.collapsed) {
        console.error("[ColorMenu LOG] Cannot apply style: Invalid or collapsed range."); // LOG
        // Не скрываем меню здесь, чтобы пользователь мог попробовать еще раз
        // hideColorMenu();
        return;
    }
    // --- Конец получения диапазона ---

    // --- 2. Определение свойства стиля и значения ---
    let styleProperty = '';
    let styleValueToApply = null; // null означает удаление стиля
    let isReset = false;

    if (type === 'text') {
        styleProperty = 'color';
        if (colorValue !== 'inherit') { styleValueToApply = colorValue; }
        else { isReset = true; }
    } else if (type === 'highlight') {
        styleProperty = 'backgroundColor';
        if (colorValue !== 'transparent') { styleValueToApply = colorValue; }
        else { isReset = true; }
    } else {
        console.error("[ColorMenu LOG] Unknown color type:", type); // LOG
        hideColorMenu(); // Скрываем при серьезной ошибке
        return;
    }

    console.log(`[ColorMenu LOG] Applying style -> Property: ${styleProperty}, Value: ${styleValueToApply}, IsReset: ${isReset}`); // LOG

    // --- 3. Применение/удаление стиля вручную ---
    let styleAppliedSuccessfully = false;
    affectedBlocks.clear(); // Очищаем перед применением

    // --- ЛОГ: Состояние выделения ДО применения стиля ---
    console.log(`[ColorMenu LOG] Selection BEFORE style application: "${window.getSelection().toString()}"`); // LOG

    try {
        // Выполняем ручное форматирование (работает с переданным range)
        if (isReset) {
            affectedBlocks = removeStyleFromRange(rangeBetweenMarkers, styleProperty);
        } else if (styleValueToApply) {
            affectedBlocks = applyStyleToRange(rangeBetweenMarkers, styleProperty, styleValueToApply);
        }
        styleAppliedSuccessfully = true;
        console.log("[ColorMenu LOG] Style application function called. Affected blocks:", affectedBlocks); // LOG

        // --- ЛОГ: Состояние выделения ПОСЛЕ применения стиля (ПЕРЕД RAF) ---
        console.log(`[ColorMenu LOG] Selection AFTER style application (before RAF): "${window.getSelection().toString()}"`); // LOG

        // --- 4. Восстановление Selection (с задержкой через RAF) ---
        // Сохраняем ID маркеров для использования в RAF
        const currentStartMarkerId = startMarkerId;
        const currentEndMarkerId = endMarkerId;
        const blocksToNormalize = new Set(affectedBlocks); // Копируем Set

        requestAnimationFrame(() => {
            console.log("%c[ColorMenu LOG] RAF: START", "color: orange; font-weight: bold;"); // LOG
            const rafStartNode = currentStartMarkerId ? document.getElementById(currentStartMarkerId) : null;
            const rafEndNode = currentEndMarkerId ? document.getElementById(currentEndMarkerId) : null;
            let newRange = null;

            console.log("[ColorMenu LOG] RAF: Found markers - Start:", rafStartNode, "End:", rafEndNode); // LOG

            try {
                // --- ЛОГ: Состояние выделения ВНУТРИ RAF (ДО восстановления) ---
                console.log(`[ColorMenu LOG] RAF: Selection BEFORE restore attempt: "${window.getSelection().toString()}"`); // LOG

                if (rafStartNode && rafEndNode && rafStartNode.parentNode && rafEndNode.parentNode) {
                    console.log("[ColorMenu LOG] RAF: Attempting to restore selection between markers..."); // LOG
                    newRange = document.createRange();
                    try {
                        // --- Установка фокуса ПЕРЕД восстановлением ---
                        const startFocusableParent = rafStartNode.parentElement?.closest('[contenteditable="true"]');
                        if (startFocusableParent && document.activeElement !== startFocusableParent) {
                            console.log("[ColorMenu LOG] RAF: Setting focus before restoring range."); // LOG
                            startFocusableParent.focus({ preventScroll: true });
                            console.log("[ColorMenu LOG] RAF: Active element AFTER focus:", document.activeElement); // LOG
                        }
                        // ---

                        newRange.setStartAfter(rafStartNode);
                        newRange.setEndBefore(rafEndNode);

                        const selection = window.getSelection();
                        if (!selection) return;
                        selection.removeAllRanges();
                        selection.addRange(newRange);
                        // --- ЛОГ: Состояние выделения ВНУТРИ RAF (ПОСЛЕ addRange) ---
                        console.log(`[ColorMenu LOG] RAF: Selection AFTER addRange: "${window.getSelection().toString()}"`); // LOG

                        // Обновляем глобальный currentSelectionRange в textContextMenuController, если он видимый
                        const textMenu = document.getElementById('text-context-menu');
                        if (textMenu && textMenu.style.display !== 'none') {
                             // Пытаемся обновить через сохраненный объект (если textContextMenuController не экспортирует функцию)
                             if (window.textContextMenuController && window.textContextMenuController.currentSelectionRange !== undefined) {
                                 // Вместо прямой перезаписи, вызовем функцию обновления, если она есть
                                 if (typeof window.textContextMenuController.updateCurrentSelectionRange === 'function') {
                                     window.textContextMenuController.updateCurrentSelectionRange(newRange.cloneRange());
                                 } else {
                                     // Fallback: перезаписываем напрямую (менее надежно)
                                     window.textContextMenuController.currentSelectionRange = newRange.cloneRange();
                                 }
                                 console.log("[ColorMenu LOG] RAF: Updated textContextMenuController.currentSelectionRange."); // LOG
                             } else {
                                 savedSelectionRange = newRange.cloneRange(); // Обновляем локальный fallback
                                 console.log("[ColorMenu LOG] RAF: Updated local savedSelectionRange (no direct access to text menu state)."); // LOG
                             }
                        } else {
                             savedSelectionRange = newRange.cloneRange(); // Обновляем локальный fallback
                             console.log("[ColorMenu LOG] RAF: Updated local savedSelectionRange (text menu hidden)."); // LOG
                        }

                        console.log("[ColorMenu LOG] RAF: Selection restored successfully using markers. New range:", newRange); // LOG


                        // Нормализуем затронутые блоки ПОСЛЕ восстановления
                        if (blocksToNormalize.size > 0) {
                            console.log("[ColorMenu LOG] RAF: Calling normalizeBlocks for affected blocks."); // LOG
                            normalizeBlocks(blocksToNormalize);
                            // --- ЛОГ: Состояние выделения ПОСЛЕ normalizeBlocks ---
                             console.log(`[ColorMenu LOG] RAF: Selection AFTER normalizeBlocks: "${window.getSelection().toString()}"`); // LOG
                        }

                        // Обновляем состояние кнопок основного меню текста
                        if (textMenu && textMenu.style.display !== 'none') {
                            console.log("[ColorMenu LOG] RAF: Updating text context menu button states."); // LOG
                            updateTextMenuButtonStates(textMenu); // Вызываем функцию из textContextMenuController
                             // --- ЛОГ: Состояние выделения ПОСЛЕ updateButtonStates ---
                             console.log(`[ColorMenu LOG] RAF: Selection AFTER updateButtonStates: "${window.getSelection().toString()}"`); // LOG
                        }

                    } catch (rangeError) {
                        console.error("[ColorMenu LOG] RAF: Error setting range between markers:", rangeError); // LOG
                        savedSelectionRange = null; // Сбрасываем fallback
                        hideColorMenu(); // Скрываем меню цвета
                    }
                } else {
                     console.warn("[ColorMenu LOG] RAF: Markers not found or detached. Cannot restore selection precisely."); // LOG
                     // Пытаемся восстановить исходный range, если он был
                     if (savedSelectionRange && document.body.contains(savedSelectionRange.startContainer)) {
                         const selection = window.getSelection();
                         if (selection) {
                             selection.removeAllRanges();
                             selection.addRange(savedSelectionRange);
                             console.log("[ColorMenu LOG] RAF: Restored using savedSelectionRange as fallback."); // LOG
                         }
                     }
                }
            } catch (restoreError) {
                console.warn("[ColorMenu LOG] RAF: Error during selection restore process:", restoreError); // LOG
            } finally {
                // Удаляем маркеры после попытки восстановления
                removeMarkers(); // Используем новую функцию
            }
             console.log("%c[ColorMenu LOG] RAF: END", "color: orange; font-weight: bold;"); // LOG
        }); // Конец RAF

    } catch (error) {
        console.error("[ColorMenu LOG] Error during manual style application:", error); // LOG
        alert(`Не удалось применить стиль: ${error.message}`);
        styleAppliedSuccessfully = false;
        removeMarkers(); // Удаляем маркеры в случае ошибки
        hideColorMenu(); // Скрываем меню в случае ошибки
    }

    // --- 5. Сохранение и обновление UI (только если стиль применен) ---
    if (styleAppliedSuccessfully) {
        debouncedSave(); // Сохраняем документ

        // Добавляем в недавние и сохраняем последний цвет, если это не сброс
        if (!isReset) {
            addRecentColor(colorValue, type);
            setLastUsedColor(colorValue, type);
        }
    }
    // Меню больше не скрывается здесь автоматически
    // hideColorMenu();
    console.log("[ColorMenu LOG] handleColorSwatchClick: END (Menu remains open)"); // LOG
}


/**
 * Добавляет цвет в список недавних, управляя его размером.
 */
function addRecentColor(color, type) {
    let colorInfoToAdd = null;
    const palette = (type === 'text') ? defaultTextColors : defaultHighlightColors;
    const foundInPalette = palette.find(item => item.value === color);
    if (foundInPalette) { colorInfoToAdd = { ...foundInPalette, color: foundInPalette.value, type: type }; }
    else { colorInfoToAdd = { value: color, color: color, type: type, label: color }; }
    recentColors = recentColors.filter(item => !(item.color === colorInfoToAdd.color && item.type === type));
    recentColors.unshift(colorInfoToAdd);
    if (recentColors.length > MAX_RECENT_COLORS) { recentColors.length = MAX_RECENT_COLORS; }
    saveRecentColors();
    populateRecentColors();
}

/**
 * Обновляет секцию "Недавние" в DOM меню.
 */
function populateRecentColors() {
    if (!colorMenuElement) return;
    const recentSwatchesContainer = colorMenuElement.querySelector('.color-swatch-container.recent-swatches');
    const recentSection = colorMenuElement.querySelector('.color-menu-section.recent-colors-section');
    if (!recentSwatchesContainer || !recentSection) return;
    recentSwatchesContainer.innerHTML = '';
    if (recentColors.length > 0) {
        recentSection.style.display = '';
        recentColors.forEach(item => { recentSwatchesContainer.appendChild(createSwatchElement(item, item.type)); });
    } else {
        recentSection.style.display = 'none';
    }
}

/**
 * Загружает недавние цвета из localStorage.
 */
function loadRecentColors() {
    const storedColors = localStorage.getItem('editorRecentColors');
    if (storedColors) {
        try {
            recentColors = JSON.parse(storedColors);
            if (!Array.isArray(recentColors)) recentColors = [];
            recentColors = recentColors.filter(item => item && typeof item.color === 'string' && typeof item.type === 'string');
            recentColors.length = Math.min(recentColors.length, MAX_RECENT_COLORS);
        } catch (e) { console.error("Failed to parse recent colors from localStorage", e); recentColors = []; }
    } else { recentColors = []; }
    if(colorMenuElement) { populateRecentColors(); }
}

/**
 * Сохраняет недавние цвета в localStorage.
 */
function saveRecentColors() {
    try { localStorage.setItem('editorRecentColors', JSON.stringify(recentColors)); }
    catch (e) { console.error("Failed to save recent colors to localStorage", e); }
}

/**
 * Обработчик mousedown на документе для скрытия меню цвета.
 */
function handleClickOutsideColorMenu(event) {
    if (isVisible && colorMenuElement && !colorMenuElement.contains(event.target)) {
        // Проверяем, был ли клик на кнопке вызова меню цвета в основном меню
        const anchorButton = document.querySelector('.text-context-menu-button[data-action="highlight"]');
        if (!anchorButton || !anchorButton.contains(event.target)) {
            console.log("[ColorMenu LOG] Click outside detected, hiding menu."); // LOG
            hideColorMenu(); // Скроет меню и удалит маркеры
        } else {
             console.log("[ColorMenu LOG] Click on anchor button, not hiding menu."); // LOG
        }
    }
}


// --- Экспортируемые функции ---

/**
 * Инициализирует меню выбора цвета.
 */
export function initializeColorMenu() {
    createMenuDOM(); // Создаем DOM при инициализации
    console.log("Color Menu Initialized (v19 - More Logging).");
}

/**
 * Показывает меню выбора цвета.
 * @param {Element} anchorButton - Кнопка, вызвавшая меню (для позиционирования).
 * @param {Range | null} selectionRange - Текущий Range выделения (используется как fallback).
 * @param {string | null} currentStartMarkerId - ID начального маркера.
 * @param {string | null} currentEndMarkerId - ID конечного маркера.
 */
export function showColorMenu(anchorButton, selectionRange, currentStartMarkerId = null, currentEndMarkerId = null) {
    if (!anchorButton) {
        console.error("Show Color Menu: Anchor button missing.");
        return;
    }
    if (!colorMenuElement) createMenuDOM(); // На всякий случай, если DOM не был создан

    // Сохраняем ID маркеров
    startMarkerId = currentStartMarkerId;
    endMarkerId = currentEndMarkerId;
    console.log(`[ColorMenu LOG] Showing menu. Markers: Start=${startMarkerId}, End=${endMarkerId}`); // LOG

    // Сохраняем КОПИЮ Range как fallback, если маркеры не сработают
    try {
         savedSelectionRange = selectionRange ? selectionRange.cloneRange() : null;
         console.log("[ColorMenu LOG] Saved fallback range:", savedSelectionRange); // LOG
    } catch (e) {
         console.error("Failed to clone selection range for color menu fallback:", e);
         savedSelectionRange = null;
    }

    populateRecentColors(); // Обновляем недавние цвета перед показом
    colorMenuElement.style.display = 'block';
    isVisible = true;
    positionMenu(anchorButton); // Позиционируем меню

    // Добавляем слушатель клика вне меню (если еще не добавлен)
    requestAnimationFrame(() => {
        if (!clickOutsideListenerAdded) {
            document.addEventListener('mousedown', handleClickOutsideColorMenu, true);
            clickOutsideListenerAdded = true;
            console.log("[ColorMenu LOG] Added click outside listener."); // LOG
        }
    });
}

// Экспортируем функцию скрытия под другим именем, чтобы избежать конфликта
export const hideColorMenuExport = hideColorMenu;