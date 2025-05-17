// js/eventHandlers/pasteHandler.js
// Обработка события вставки (paste) в редактор.
// --- ИЗМЕНЕНО: Добавлен вызов updatePlaceholderVisibility ---
// --- ИЗМЕНЕНО: Проверка на переносы строк перед отменой стандартной вставки ---

import { MAX_INDENT_LEVEL, SPACES_PER_INDENT } from '../config.js';
import { getBlockParentContainer, isBlockContentEmpty, getToggleTitleElement, getCalloutPrimaryContentElement, getEditableContentElement, updatePlaceholderVisibility } from '../blockUtils.js';
import { createBlockElement } from '../blockFactory.js';
import { updateQuoteConnection, updateQuoteConnectionsAround } from '../quoteManager.js';
import { saveDocumentContent, debouncedSave } from '../documentManager.js';
import { updateListAttributes } from '../listManager.js';
import { clearBlockSelection } from '../selectionManager.js';
import { getNextBlockIdAndIncrement, setLastCursorXPosition } from '../state.js';
import { focusAtStart, focusAtEnd } from '../utils.js';
import { editorArea } from '../domElements.js';

// --- Внутренняя функция парсинга текста ---
/**
 * Разбирает простой текстовый контент на массив объектов данных для блоков.
 * @param {string} text - Текст для парсинга.
 * @returns {Array<object>} Массив объектов с данными блоков.
 */
function parsePastedText(text) {
    const blocks = [];
    if (!text) return blocks;

    const lines = text.replace(/\r\n/g, '\n').split('\n');
    let currentParagraphHTML = null;
    let prevBlockData = null;

    const finalizeParagraph = () => {
        if (currentParagraphHTML !== null) {
            const pBlockData = { type: 'p', html: currentParagraphHTML };
            if (prevBlockData && prevBlockData.type === 'p' && prevBlockData.indentLevel !== undefined) {
                pBlockData.indentLevel = prevBlockData.indentLevel;
            }
            if (pBlockData.indentLevel === 0 || pBlockData.indentLevel === undefined) {
                 delete pBlockData.indentLevel;
            }
            blocks.push(pBlockData);
            currentParagraphHTML = null;
        }
    };

    for (const line of lines) {
        const leadingSpaces = line.match(/^\s*/)[0].length;
        const indentLevel = Math.min(MAX_INDENT_LEVEL, Math.floor(leadingSpaces / SPACES_PER_INDENT));
        const trimmedLineStart = line.trimStart();
        const trimmedLineFull = trimmedLineStart.trimEnd();

        if (trimmedLineFull === '') {
            finalizeParagraph();
            prevBlockData = null;
            continue;
        }

        let blockType = 'p';
        let listType = null;
        let html = trimmedLineStart;
        let markerMatch = null;
        let checked = undefined;
        let isListItem = false;
        let inQuote = false;

        if (markerMatch = trimmedLineStart.match(/^(#{1,3})\s+(.*)/)) {
            blockType = `h${markerMatch[1].length}`;
            html = markerMatch[2]?.trimEnd() || '';
        } else if (markerMatch = trimmedLineStart.match(/^(?:>|")\s+(.*)/)) {
            blockType = 'p';
            html = markerMatch[1]?.trimEnd() || '';
            inQuote = true;
        } else if (markerMatch = trimmedLineStart.match(/^\[([x\s]?)\]\s+(.*)/i)) {
            blockType = 'todo';
            checked = markerMatch[1]?.trim().toLowerCase() === 'x';
            html = markerMatch[2]?.trimEnd() || '';
            isListItem = true;
        } else if (markerMatch = trimmedLineStart.match(/^[\*\-\•]\s+(.*)/)) {
            blockType = 'li';
            listType = 'ul';
            html = markerMatch[1]?.trimEnd() || '';
            isListItem = true;
        } else if (markerMatch = trimmedLineStart.match(/^\d+\.\s+(.*)/)) {
            blockType = 'li';
            listType = 'ol';
            html = markerMatch[1]?.trimEnd() || '';
            isListItem = true;
        }
        else {
            blockType = 'p';
            html = trimmedLineFull;
        }

        if (blockType !== 'p' || isListItem || inQuote) {
            finalizeParagraph();
            const blockData = { type: blockType, html: html };
            if (indentLevel > 0 && !blockType.startsWith('h') && !inQuote) {
                blockData.indentLevel = indentLevel;
            }
            if (listType) blockData.listType = listType;
            if (checked !== undefined) blockData.checked = checked;
            if (inQuote) blockData.inQuote = true;
            blocks.push(blockData);
            prevBlockData = blockData;
        }
        else {
            html = trimmedLineFull;
            if (currentParagraphHTML === null) {
                currentParagraphHTML = html;
                prevBlockData = { type: 'p', html: currentParagraphHTML };
                if (indentLevel > 0) prevBlockData.indentLevel = indentLevel;
            }
            else {
                currentParagraphHTML += (currentParagraphHTML.length > 0 ? ' ' : '') + html;
                if (prevBlockData && prevBlockData.type === 'p') {
                     prevBlockData.html = currentParagraphHTML;
                 }
            }
        }
    }

    finalizeParagraph();
    return blocks;
}


// --- Экспортируемая функция-обработчик события paste ---

/**
 * Обрабатывает событие вставки в редактор.
 * @param {ClipboardEvent} event - Событие вставки.
 */
export function handlePaste(event) {
    const targetElement = event.target;
    const editableElement = targetElement.closest('.block-content[contenteditable="true"], .toggle-title[contenteditable="true"]');
    const currentBlock = editableElement?.closest('.editor-block');

    if (!editableElement || !currentBlock) {
        // console.log("Paste target is not an editable block content or toggle title. Standard paste prevented.");
        // Не предотвращаем стандартное поведение, если цель не наш блок,
        // чтобы вставка работала в других местах страницы (если они есть)
        // event.preventDefault(); // Убрано
        return;
    }

    const clipboardData = event.clipboardData;
    const plainText = clipboardData?.getData('text/plain');

    // --- НОВАЯ ПРОВЕРКА ---
    // Если есть plain text и он НЕ содержит переносов строк,
    // позволяем браузеру выполнить стандартную вставку (inline).
    if (plainText && !plainText.includes('\n')) {
        console.log("Handling paste as simple inline text via default browser behavior.");
        // Не вызываем event.preventDefault()
        // Вызываем debouncedSave после небольшой задержки,
        // чтобы браузер успел вставить текст перед сохранением.
        setTimeout(() => {
             updatePlaceholderVisibility(currentBlock); // Обновляем плейсхолдер
             debouncedSave(); // Сохраняем
        }, 0);
        return; // Выходим, остальная логика не нужна
    }
    // --- КОНЕЦ НОВОЙ ПРОВЕРКИ ---

    // Если текст содержит переносы строк ИЛИ это не plain text (например, HTML),
    // используем нашу логику разбора на блоки.
    console.log("Handling paste by parsing into blocks.");
    event.preventDefault(); // Отменяем стандартную вставку браузера

    const parentContainer = getBlockParentContainer(currentBlock);
    if (!parentContainer) {
        console.error("Paste Error: Parent container not found for block:", currentBlock);
        return;
    }

    let parsedBlocksData = [];

    // Пытаемся получить и распарсить plain text (если он был с переносами)
    if (plainText) {
        parsedBlocksData = parsePastedText(plainText);
    }
    // TODO: Можно добавить обработку HTML из буфера обмена (clipboardData.getData('text/html')),
    // если нужно поддерживать вставку форматированного текста как новые блоки.
    // Пока обрабатываем только plain text.

    // Если не удалось распарсить на блоки (например, пустая строка с переносом),
    // просто игнорируем вставку (т.к. preventDefault уже вызван).
    if (parsedBlocksData.length === 0) {
        console.log("Paste parser returned no blocks. Ignoring paste.");
        return;
    }

    // --- Логика вставки распарсенных блоков ---
    const selection = window.getSelection();
    const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    let contentBefore = '';
    let contentAfter = '';
    let removeCurrentBlock = false;
    const currentIsEmpty = isBlockContentEmpty(editableElement);

    // Проверяем, покрывает ли выделение весь контент блока
    let selectionCoversAll = false;
    if (range && !range.collapsed) {
        try {
            const blockRange = document.createRange();
            blockRange.selectNodeContents(editableElement);
            if (range.compareBoundaryPoints(Range.START_TO_START, blockRange) <= 0 &&
                range.compareBoundaryPoints(Range.END_TO_END, blockRange) >= 0) {
                selectionCoversAll = true;
            }
        } catch (e) { console.warn("Error checking if selection covers all content:", e); }
    }

    // Удаляем текущий блок, если он был пуст или выделен полностью при вставке НОВЫХ блоков
    if (currentIsEmpty || selectionCoversAll) {
        removeCurrentBlock = true;
    } else if (range) { // Иначе разделяем контент текущего блока
        try {
            const postRange = range.cloneRange(); postRange.selectNodeContents(editableElement); postRange.setStart(range.endContainer, range.endOffset); const postFragment = postRange.extractContents(); const tempDivAfter = document.createElement('div'); tempDivAfter.appendChild(postFragment); contentAfter = tempDivAfter.innerHTML;
            if (!range.collapsed) range.deleteContents();
            contentBefore = editableElement.innerHTML;
        } catch (splitError) {
            console.warn("Error splitting content during paste, pasting after block.", splitError);
            contentBefore = editableElement.innerHTML; contentAfter = ''; removeCurrentBlock = false;
        }
    } else { // Если range не определен (маловероятно)
        contentBefore = editableElement.innerHTML; contentAfter = ''; removeCurrentBlock = false;
    }

    // Обновляем текущий блок, если он не удаляется
    if (!removeCurrentBlock) {
        editableElement.innerHTML = contentBefore;
        updatePlaceholderVisibility(currentBlock); // Обновляем его плейсхолдер
    }

    // Добавляем остаток контента к первому вставляемому блоку
    if (contentAfter && parsedBlocksData.length > 0) {
        if (parsedBlocksData[0].type === 'toggle') {
            parsedBlocksData[0].titleHtml = (parsedBlocksData[0].titleHtml || '') + contentAfter;
        } else {
            parsedBlocksData[0].html = (parsedBlocksData[0].html || '') + contentAfter;
        }
    }

    // --- Вставка новых блоков ---
    let lastInsertedElement = null;
    const insertTargetElement = parentContainer;
    let insertionRefNode = removeCurrentBlock ? currentBlock.nextSibling : currentBlock.nextSibling;
    while(insertionRefNode && !insertionRefNode.matches?.('.editor-block')){ insertionRefNode = insertionRefNode.nextSibling; }
    const blockBeforeInsertion = removeCurrentBlock ? currentBlock.previousElementSibling : currentBlock;

    parsedBlocksData.forEach((blockData) => {
        if (parentContainer !== editorArea) {
            blockData.indentLevel = 0;
        }
        const newBlockElement = createBlockElement(blockData);
        if (newBlockElement) {
            insertTargetElement.insertBefore(newBlockElement, insertionRefNode);
            updateQuoteConnectionsAround(newBlockElement);
            updatePlaceholderVisibility(newBlockElement); // Обновляем плейсхолдер для нового
            lastInsertedElement = newBlockElement;
        }
    });

    // --- Удаление старого блока и установка фокуса ---
    let focusTargetNode = null;
    let focusAtEndFlag = false;

    if (removeCurrentBlock) {
        let focusCandidate = blockBeforeInsertion;
        while(focusCandidate && !focusCandidate.matches?.('.editor-block')){ focusCandidate = focusCandidate.previousElementSibling; }
        focusAtEndFlag = true; // Фокус в конец предыдущего

        if (!focusCandidate) { // Если не нашли предыдущий, фокус на первый вставленный
            focusCandidate = insertTargetElement.querySelector(`:scope > .editor-block[data-block-id="${parsedBlocksData[0]?.id}"]`);
            focusAtEndFlag = false;
        }
        if (!focusCandidate) { // Если и первый вставленный не нашли, ищем последний
             focusCandidate = lastInsertedElement;
             focusAtEndFlag = false;
        }
         if (!focusCandidate) { // Если вообще ничего нет, фокус на следующий после точки удаления
              focusCandidate = insertionRefNode?.closest('.editor-block');
              focusAtEndFlag = false;
         }


        if (currentBlock.parentNode) {
            const blockToRemoveId = currentBlock.dataset.blockId;
            const nextBlock = currentBlock.nextElementSibling;
            currentBlock.remove();
            updateQuoteConnection(nextBlock); // Обновляем связь для следующего
            updateQuoteConnectionsAround(blockBeforeInsertion); // И вокруг предыдущего
        }
        if (focusCandidate) { focusTargetNode = focusCandidate; }
        else if (parentContainer !== editorArea && parentContainer.children.length === 0) { console.warn("Paste deleted last block inside a container."); }
        else if (parentContainer === editorArea && parentContainer.children.length === 0) { const newBlock = createBlockElement({ type: 'p', html: '' }); editorArea.appendChild(newBlock); updatePlaceholderVisibility(newBlock); focusTargetNode = newBlock; focusAtEndFlag = false; updateQuoteConnectionsAround(newBlock); checkAndSetInitialPlaceholderState(); } // Проверка плейсхолдера
        else { console.warn("Paste: Could not determine block to focus after removing current block."); }
         // Проверка плейсхолдера после удаления блока
         checkAndSetInitialPlaceholderState();
    } else {
        // Если текущий блок остался, и вставляли новые блоки, фокус на последний вставленный
        if (lastInsertedElement) { focusTargetNode = lastInsertedElement; focusAtEndFlag = false; }
        else { focusTargetNode = currentBlock; focusAtEndFlag = true; } // Иначе фокус в конец текущего
    }

    // Установка фокуса
    if (focusTargetNode) {
        let elementToFocus = null;
        const targetType = focusTargetNode.dataset.blockType;
        if (targetType === 'toggle') { elementToFocus = getToggleTitleElement(focusTargetNode); focusAtEndFlag = true; }
        else if (targetType === 'callout') {
             elementToFocus = getCalloutPrimaryContentElement(focusTargetNode); focusAtEndFlag = false;
             if (!elementToFocus) { elementToFocus = focusTargetNode; }
        }
        else { elementToFocus = getEditableContentElement(focusTargetNode); }

        if (elementToFocus) {
            requestAnimationFrame(() => focusAtEndFlag ? focusAtEnd(elementToFocus) : focusAtStart(elementToFocus));
        } else {
            console.warn("Paste: Could not find element to focus in target block", focusTargetNode);
             if (focusTargetNode.focus) focusTargetNode.focus();
        }
    }

    // --- Финальные действия ---
    clearBlockSelection();
    saveDocumentContent(); // Сохраняем сразу после сложной вставки
    updateListAttributes();
    setLastCursorXPosition(null);
} // --- Конец handlePaste ---