// js/quoteManager.js
// Логика для обновления и управления стилями блоков цитат
// --- ИЗМЕНЕНО: Используется класс 'quote-block-following' на блоке для CSS-перекрытия ---
// --- ЛОГИ ОБНОВЛЕНЫ ---

import { editorArea } from './domElements.js'; // Импортируем корневой элемент редактора

// --- Внутренняя вспомогательная функция ---

/**
 * Проверяет, является ли блок частью цитаты (сам блок quote или вложенный в quote).
 * @param {Element | null} blockElement Элемент блока (.editor-block).
 * @returns {boolean} true, если блок относится к цитате, иначе false.
 */
function isQuoteBlock(blockElement) {
    // Проверяем наличие атрибута data-block-type="quote" ИЛИ data-in-quote="true"
    return !!blockElement?.matches('.editor-block[data-block-type="quote"], .editor-block[data-in-quote="true"]');
}

// --- Экспортируемые функции ---

/**
 * Обновляет класс 'quote-block-following' для ТЕКУЩЕГО блока,
 * основываясь на том, является ли ПРЕДЫДУЩИЙ блок также частью цитаты.
 * Этот класс используется CSS для применения отрицательного margin-top.
 * @param {Element | null} blockElement - Блок, для которого нужно обновить класс.
 */
export function updateQuoteConnection(blockElement) {
    const blockId = blockElement?.dataset?.blockId ?? 'N/A';
    // console.log(`[updateQuoteConnection] Running for block ID: ${blockId}`); // Можно оставить для детальной отладки

    if (!blockElement || !blockElement.matches('.editor-block')) {
        // console.log(`[updateQuoteConnection] ID: ${blockId} - Not a valid block element.`);
        return;
    }

    // Находим предыдущий элемент-сосед
    const prevBlock = blockElement.previousElementSibling;

    // Проверяем, являются ли оба блока частью цитаты
    const isCurrentQuote = isQuoteBlock(blockElement);
    const isPreviousQuote = isQuoteBlock(prevBlock);

    // --- ИЗМЕНЕННАЯ ЛОГИКА ---
    // Добавляем/удаляем класс на сам БЛОК
    const connectionClass = 'quote-block-following'; // Имя класса для блока

    // console.log(`[updateQuoteConnection] ID: ${blockId} - isCurrentQuote: ${isCurrentQuote}, prevBlock ID: ${prevBlock?.dataset?.blockId ?? 'None'}, isPreviousQuote: ${isPreviousQuote}`); // Лог проверок

    if (isCurrentQuote && isPreviousQuote) {
        // console.log(`[updateQuoteConnection] ID: ${blockId} - ADDING ${connectionClass} class to block.`);
        blockElement.classList.add(connectionClass);
    } else {
        // console.log(`[updateQuoteConnection] ID: ${blockId} - REMOVING ${connectionClass} class from block (Current: ${isCurrentQuote}, Prev: ${isPreviousQuote}).`);
        blockElement.classList.remove(connectionClass);
    }
    // --- КОНЕЦ ИЗМЕНЕННОЙ ЛОГИКИ ---
}

/**
 * Вызывает updateQuoteConnection для указанного блока и следующего за ним.
 * Используется после операций, которые могли повлиять на два соседних блока.
 * @param {Element | null} blockElement - Блок, вокруг которого нужно обновить соединения.
 */
export function updateQuoteConnectionsAround(blockElement) {
    // Обновляем сам блок (он проверит свой предыдущий элемент)
    if (blockElement && blockElement.matches('.editor-block')) {
        // console.log(`[updateQuoteConnectionsAround] Updating block ID: ${blockElement.dataset.blockId}`);
        updateQuoteConnection(blockElement);

        // Находим следующий элемент-сосед
        const nextBlock = blockElement.nextElementSibling;
        // Обновляем следующий блок (он проверит обновленный текущий blockElement как свой предыдущий)
        if (nextBlock && nextBlock.matches('.editor-block')) {
             // console.log(`[updateQuoteConnectionsAround] Updating NEXT block ID: ${nextBlock.dataset.blockId}`);
            updateQuoteConnection(nextBlock);
        } else {
             // console.log(`[updateQuoteConnectionsAround] No next block found for ID: ${blockElement.dataset.blockId}`);
        }
    } else {
         // console.log(`[updateQuoteConnectionsAround] Invalid blockElement received.`);
    }
}

/**
 * Обновляет классы соединений для ВСЕХ блоков в редакторе.
 * Вызывается после загрузки документа или других крупных изменений структуры.
 */
export function updateAllQuoteConnections() {
    if (!editorArea) {
        console.error("QuoteManager: editorArea not found for updateAllQuoteConnections.");
        return;
    }
    // console.log("[updateAllQuoteConnections] Updating all connections...");
    // Обновляем все блоки верхнего уровня
    editorArea.querySelectorAll(':scope > .editor-block').forEach(block => {
        updateQuoteConnection(block);
    });

    // Дополнительно обновим блоки внутри callout/toggle
    const nestedWrappers = editorArea.querySelectorAll('.callout-content-wrapper, .toggle-children-wrapper');
    nestedWrappers.forEach(wrapper => {
        wrapper.querySelectorAll(':scope > .editor-block').forEach(nestedBlock => {
             updateQuoteConnection(nestedBlock);
        });
    });
    // console.log("[updateAllQuoteConnections] Finished updating all connections.");
}