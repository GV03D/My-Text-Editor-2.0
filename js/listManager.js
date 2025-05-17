// js/listManager.js
// Логика для обновления атрибутов нумерованных (ol) и маркированных (ul) списков.
// --- ИЗМЕНЕНО: Атрибут data-list-number теперь устанавливается на span.list-marker ---

import { MAX_OL_INDENT_LEVEL } from './config.js'; // Макс. уровень автонумерации для OL
import { editorArea } from './domElements.js';
import { getEditableContentElement, getToggleChildrenWrapperElement } from './blockUtils.js'; // getEditableContentElement нужен для очистки старого атрибута

// --- Внутренние вспомогательные функции форматирования номеров ---

function formatNumberDecimal(num) {
    return String(num);
}

function formatNumberLowerAlpha(num) {
    if (num <= 0) return '';
    let alpha = '';
    while (num > 0) {
        let remainder = (num - 1) % 26;
        alpha = String.fromCharCode(97 + remainder) + alpha; // 97 is 'a'
        num = Math.floor((num - 1) / 26);
    }
    return alpha;
}

function formatNumberLowerRoman(num) {
    if (num <= 0 || num >= 4000) return String(num);
    const romanMap = {
        M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90,
        L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1
    };
    let roman = '';
    for (let key in romanMap) {
        while (num >= romanMap[key]) {
            roman += key;
            num -= romanMap[key];
        }
    }
    return roman.toLowerCase();
}

/**
 * Форматирует номер элемента списка в зависимости от уровня вложенности (0-based).
 * 0: 1, 2, 3
 * 1: a, b, c
 * 2: i, ii, iii
 * 3: 1, 2, 3 (повторяется цикл)
 * @param {number} number - Порядковый номер элемента (начиная с 1).
 * @param {number} indentLevel - Уровень вложенности (начиная с 0).
 * @returns {string} Отформатированный номер.
 */
function getFormattedListNumber(number, indentLevel) {
    const num = Math.max(1, Math.floor(number));
    const formatLevel = Math.max(0, indentLevel) % 3;
    switch (formatLevel) {
        case 0: return formatNumberDecimal(num);
        case 1: return formatNumberLowerAlpha(num);
        case 2: return formatNumberLowerRoman(num);
        default: return String(num);
    }
}


// --- Внутренняя рекурсивная функция обновления атрибутов ---

/**
 * Рекурсивно обходит блоки внутри parentElement, обновляя атрибуты
 * data-list-number для 'ol'.
 * @param {Element} parentElement - Контейнер, внутри которого ищутся блоки (editorArea, callout-wrapper, etc.).
 * @param {object} olCounters - Объект для хранения счетчиков OL для разных уровней {0: count, 1: count, ...}.
 */
function updateListAttributesRecursive(parentElement, olCounters) {
    const blocks = parentElement.querySelectorAll(':scope > .editor-block');
    let previousBlock = null;
    const currentLevelCounters = { ...olCounters };

    blocks.forEach((currentBlock) => {
        const blockId = currentBlock.dataset.blockId;
        if (!blockId) {
            console.warn("ListManager: Block without ID found during updateListAttributes:", currentBlock);
            previousBlock = currentBlock;
            return;
        }

        const currentType = currentBlock.dataset.blockType;
        const currentIndent = parseInt(currentBlock.dataset.indentLevel || '0', 10);
        const currentListType = currentBlock.dataset.listType; // 'ol' or 'ul' or null
        const contentElement = getEditableContentElement(currentBlock); // Нужен для очистки
        const listMarkerSpan = currentBlock.querySelector(':scope > span.list-marker'); // Находим span маркера

        // --- Обработка нумерованных списков (ol) ---
        if (currentType === 'li' && currentListType === 'ol') {
            if (currentIndent <= MAX_OL_INDENT_LEVEL) {
                let needsReset = false;
                const prevIndent = parseInt(previousBlock?.dataset.indentLevel || '0', 10);
                const prevType = previousBlock?.dataset.blockType;
                const prevListType = previousBlock?.dataset.listType;

                if (!previousBlock || prevType !== 'li' || prevListType !== 'ol' || prevIndent < currentIndent) {
                    needsReset = true;
                }
                if (needsReset) { currentLevelCounters[currentIndent] = 0; }

                for (let i = currentIndent + 1; i <= MAX_OL_INDENT_LEVEL; i++) {
                    if (currentLevelCounters[i] !== 0) { currentLevelCounters[i] = 0; }
                }

                currentLevelCounters[currentIndent]++;
                const formattedNumber = getFormattedListNumber(currentLevelCounters[currentIndent], currentIndent);

                // --- ИЗМЕНЕНО: Устанавливаем атрибут на listMarkerSpan ---
                if (listMarkerSpan) {
                    listMarkerSpan.setAttribute('data-list-number', formattedNumber);
                } else {
                    console.warn(`ListManager: Could not find listMarkerSpan for li block ${blockId} to set list number.`);
                }
                // Удаляем атрибут с contentElement, если он там был по ошибке
                if (contentElement && contentElement.hasAttribute('data-list-number')) {
                    contentElement.removeAttribute('data-list-number');
                }
                // Удаляем атрибут с ОСНОВНОГО блока, если он там был по ошибке
                if (currentBlock.hasAttribute('data-list-number')) {
                     currentBlock.removeAttribute('data-list-number');
                }
                // --- КОНЕЦ ИЗМЕНЕНИЯ ---

            } else {
                // Если уровень вложенности слишком большой, удаляем номер со всех потенциальных мест
                listMarkerSpan?.removeAttribute('data-list-number'); // <-- Добавлено удаление со спана
                contentElement?.removeAttribute('data-list-number');
                currentBlock.removeAttribute('data-list-number');
                console.warn(`ListManager: OL list item ${blockId} exceeds max auto-format indent level ${MAX_OL_INDENT_LEVEL}. Numbering disabled.`);
            }
            currentBlock.removeAttribute('data-list-reset-before');

        } else {
            // --- Обработка не-OL блоков ---
            // Удаляем атрибут нумерации со всех потенциальных мест
            listMarkerSpan?.removeAttribute('data-list-number'); // <-- Добавлено удаление со спана
            contentElement?.removeAttribute('data-list-number');
            currentBlock.removeAttribute('data-list-number');
            currentBlock.removeAttribute('data-list-reset-before');
        }

        // --- Рекурсивный вызов для вложенных контейнеров ---
        if (currentType === 'callout') {
            const wrapper = currentBlock.querySelector(':scope > .callout-content-wrapper');
            if (wrapper) {
                updateListAttributesRecursive(wrapper, { 0: 0, 1: 0, 2: 0 }); // Сбрасываем счетчики
            }
        } else if (currentType === 'toggle') {
            const wrapper = getToggleChildrenWrapperElement(currentBlock);
            if (wrapper) {
                updateListAttributesRecursive(wrapper, { 0: 0, 1: 0, 2: 0 }); // Сбрасываем счетчики
            }
        }

        previousBlock = currentBlock;
    });
}

// --- Экспортируемая основная функция ---

/**
 * Обновляет атрибуты для всех списков в редакторе.
 * Запускает рекурсивный обход от корня editorArea.
 */
export function updateListAttributes() {
    if (!editorArea) {
        console.error("ListManager: editorArea not found for updateListAttributes.");
        return;
    }
    const initialCounters = {};
    for (let i = 0; i <= MAX_OL_INDENT_LEVEL; i++) { initialCounters[i] = 0; }

    try {
        updateListAttributesRecursive(editorArea, initialCounters);
    } catch (error) {
        console.error("!!!! ERROR during updateListAttributesRecursive !!!!", error);
    }
}