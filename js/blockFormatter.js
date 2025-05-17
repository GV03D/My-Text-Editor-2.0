// js/blockFormatter.js
// Логика для изменения типа блока и применения команд форматирования.
// --- ИЗМЕНЕНО: Запрещено создание toggle внутри toggle ---
// --- ИЗМЕНЕНО: changeBlockType теперь возвращает измененный/созданный элемент ---

import { createBlockElement } from './blockFactory.js';
import { saveDocumentContent } from './documentManager.js';
import { updateListAttributes } from './listManager.js';
import { updateQuoteConnectionsAround } from './quoteManager.js';
import { getEditableContentElement, getToggleTitleElement, getToggleChildrenWrapperElement, getCalloutPrimaryContentElement, updatePlaceholderVisibility } from './blockUtils.js';
import { focusAtStart, showTemporaryErrorHighlight } from './utils.js';
import { getNextBlockIdAndIncrement, getSelectedBlockIds } from './state.js';
import { editorArea } from './domElements.js';
import { getBlockIdsInOrder, clearBlockSelection } from './selectionManager.js';

/**
 * Вспомогательная функция для установки фокуса после изменения типа блока.
 * @param {Element | null} blockElement - Новый или измененный элемент блока.
 */
function focusAfterTrigger(blockElement) {
    requestAnimationFrame(() => {
        const blockId = blockElement?.dataset?.blockId;
        if (!blockId || !editorArea) return;
        // Используем document.querySelector для поиска по всему документу,
        // так как блок мог быть перемещен в другой контейнер
        const currentBlockInDOM = document.querySelector(`.editor-block[data-block-id="${blockId}"]`);
        if (!currentBlockInDOM) return;

        let contentElement = null;
        const blockType = currentBlockInDOM.dataset.blockType;

        if (blockType === 'toggle') { contentElement = getToggleTitleElement(currentBlockInDOM); }
        else if (blockType === 'callout') { contentElement = getCalloutPrimaryContentElement(currentBlockInDOM); }
        // --- ИЗМЕНЕНИЕ: Не фокусируемся на плейсхолдере image ---
        else if (blockType !== 'image') { // Изображение не имеет стандартного contenteditable для фокуса
             contentElement = getEditableContentElement(currentBlockInDOM);
        }
        // --- КОНЕЦ ИЗМЕНЕНИЯ ---


        if (contentElement && document.body.contains(contentElement)) { focusAtStart(contentElement); }
        // --- ИЗМЕНЕНИЕ: Не фокусируем сам блок image ---
        // else { console.warn("focusAfterTrigger: Could not find content element to focus in block", blockId); if (currentBlockInDOM.focus && blockType !== 'image') currentBlockInDOM.focus(); }
        else if (blockType !== 'image') { // Не выводим warning для image
             console.warn("focusAfterTrigger: Could not find content element to focus in block", blockId);
             if (currentBlockInDOM.focus) currentBlockInDOM.focus();
        }
        // --- КОНЕЦ ИЗМЕНЕНИЯ ---
    });
}

/**
 * Изменяет тип существующего блока на новый.
 * Сохраняет контент, ID и основные атрибуты, где это возможно.
 * @param {Element} blockElement - Текущий элемент блока для изменения.
 * @param {string} newType - Новый тип блока.
 * @param {string | null} listType - Тип списка ('ol' или 'ul').
 * @param {object} options - Доп. опции: indentLevel, inQuote, checked, html.
 * @returns {Element | null} - Измененный или новый элемент блока, или null в случае ошибки/отмены.
 */
export function changeBlockType(blockElement, newType, listType = null, options = {}) {
    if (!blockElement || !blockElement.dataset?.blockId) { console.error("changeBlockType called with invalid blockElement:", blockElement); return null; }

    const currentId = blockElement.dataset.blockId;
    const currentType = blockElement.dataset.blockType;
    const wasInQuote = blockElement.hasAttribute('data-in-quote') || currentType === 'quote';
    const parentWrapper = blockElement.parentElement;
    const wasInToggleWrapper = parentWrapper?.classList.contains('toggle-children-wrapper');
    const currentBlockId = parseInt(currentId, 10);
    if (isNaN(currentBlockId)) { console.error(`Invalid block ID "${currentId}" during changeBlockType.`); return null; }

    const isListOrDisallowedHeading = ['li', 'todo', 'h1', 'h2', 'h3'].includes(newType);
    const isContainerType = ['callout', 'toggle'].includes(newType);
    // --- ДОБАВЛЕНО: Проверка на image ---
    const isImageType = newType === 'image';

    // Проверка 1: Запрет ЛЮБОГО контейнера, списка/заголовка или изображения внутри цитаты
    if (wasInQuote && (isListOrDisallowedHeading || isContainerType || isImageType)) {
        console.warn(`Prevented creating block type "${newType}" inside a quote.`);
        showTemporaryErrorHighlight(blockElement);
        return null; // <-- Возвращаем null
    }
    // Проверка 2: Запрет ТОЛЬКО toggle внутри другого toggle
    if (newType === 'toggle' && wasInToggleWrapper) {
        console.warn(`Prevented creating nested toggle block inside another toggle.`);
        showTemporaryErrorHighlight(blockElement);
        return null; // <-- Возвращаем null
    }
    // --- ДОБАВЛЕНО: Проверка 3: Запрет изображения внутри callout или toggle ---
    if (isImageType && (parentWrapper?.classList.contains('callout-content-wrapper') || wasInToggleWrapper)) {
        console.warn(`Prevented creating image block inside a callout or toggle.`);
        showTemporaryErrorHighlight(blockElement);
        return null; // <-- Возвращаем null
    }


    const currentListType = blockElement.dataset.listType;
    const currentIndent = parseInt(blockElement.dataset.indentLevel || '0', 10);
    const currentCheckedState = blockElement.dataset.checked;
    let currentHtml = options.html ?? '';
    let currentTitleHtml = '';
    let currentIsOpen = false;
    let currentSrc = null; // Для image

    // Получаем текущее содержимое (если оно не передано в options)
    if (options.html === undefined) {
        if (currentType === 'callout') { const firstChildContent = getCalloutPrimaryContentElement(blockElement); if (firstChildContent) currentHtml = firstChildContent.innerHTML; }
        else if (currentType === 'toggle') { const titleEl = getToggleTitleElement(blockElement); if (titleEl) currentTitleHtml = titleEl.innerHTML; currentIsOpen = blockElement.dataset.isOpen === 'true'; currentHtml = ''; }
        // --- ДОБАВЛЕНО: Получение src для image ---
        else if (currentType === 'image') { currentSrc = blockElement.querySelector('img')?.src || blockElement.dataset.imageSrc || null; currentHtml = ''; }
        // --- КОНЕЦ ДОБАВЛЕНИЯ ---
        else { const contentElement = getEditableContentElement(blockElement); if (contentElement) currentHtml = contentElement.innerHTML; }
    }

    const isIndentChanging = (options.indentLevel !== undefined && options.indentLevel !== currentIndent);
    const isInQuoteChanging = (options.inQuote !== undefined && options.inQuote !== wasInQuote);
    const isCheckedChanging = (options.checked !== undefined && String(options.checked) !== currentCheckedState);
    const wasInsideContainer = wasInToggleWrapper || parentWrapper?.classList.contains('callout-content-wrapper');

    // Если тип не меняется и опции не меняются - ничего не делаем
    if (currentType === newType && (newType !== 'li' || currentListType === listType) && !isIndentChanging && !isInQuoteChanging && (newType !== 'todo' || !isCheckedChanging)) {
        const contentElement = getEditableContentElement(blockElement);
        // --- ИЗМЕНЕНИЕ: Не фокусируем image ---
        if (contentElement && newType !== 'image' && document.activeElement !== contentElement && document.body.contains(blockElement)) { requestAnimationFrame(() => focusAtStart(contentElement)); }
        return blockElement; // <-- Возвращаем текущий элемент
    }

    let newBlockElement = null; // Переменная для нового элемента

    // --- Смена ТИПА из контейнера (Callout/Toggle) ---
    if ((currentType === 'callout' || currentType === 'toggle') && newType !== currentType) {
        // Проверка на запрет создания image после callout/toggle (если нужно)
        if (isImageType) {
             console.warn(`Prevented changing container type (${currentType}) directly to image.`);
             showTemporaryErrorHighlight(blockElement);
             return null; // Запрещаем
        }
        const sourceHtml = (currentType === 'toggle' ? currentTitleHtml : currentHtml);
        const replacementData = { id: currentBlockId, type: newType, html: sourceHtml, listType: (newType === 'li') ? (listType ?? 'ul') : null, checked: (newType === 'todo') ? (options.checked ?? false) : undefined, indentLevel: options.indentLevel ?? 0, inQuote: options.inQuote ?? false, };
        // Очистка данных
        if (!replacementData.listType) delete replacementData.listType; if (replacementData.checked === undefined) delete replacementData.checked; if (replacementData.indentLevel === 0 && !['li', 'todo'].includes(newType)) delete replacementData.indentLevel; if (!replacementData.inQuote) delete replacementData.inQuote;
        try {
            newBlockElement = createBlockElement(replacementData); // <-- Присваиваем результат
            if (!newBlockElement) throw new Error("Failed to create replacement block.");
            if (!blockElement.parentNode) throw new Error("Old block has no parent node.");
            blockElement.parentNode.replaceChild(newBlockElement, blockElement);
            updateQuoteConnectionsAround(newBlockElement);
            updatePlaceholderVisibility(newBlockElement);
            // Фокус на контент (кроме image)
            if (!isImageType) {
                 const newContent = getEditableContentElement(newBlockElement);
                 if (newContent) requestAnimationFrame(() => focusAtStart(newContent));
            }
            saveDocumentContent(); updateListAttributes();
        } catch (error) { console.error(`Error changing FROM ${currentType} ${currentId}:`, error); saveDocumentContent(); return null; }
        return newBlockElement; // <-- Возвращаем новый элемент
    }

    // --- Смена ТИПА на контейнер (Callout/Toggle) ---
    if (isContainerType && currentType !== newType) {
        const sourceHtml = (currentType === 'image' ? '' : currentHtml); // Не переносим картинку в заголовок/контент контейнера
        const newBlockData = { id: currentBlockId, type: newType };
        if (newType === 'toggle') { newBlockData.titleHtml = sourceHtml; newBlockData.isOpen = false; newBlockData.children = []; }
        else { newBlockData.html = sourceHtml; newBlockData.children = []; }
        try {
            newBlockElement = createBlockElement(newBlockData); // <-- Присваиваем результат
            if (!newBlockElement) throw new Error(`Failed to create ${newType} block.`);
            if (!blockElement.parentNode) throw new Error("Old block has no parent node.");
            blockElement.parentNode.replaceChild(newBlockElement, blockElement);
            updateQuoteConnectionsAround(newBlockElement);
            updatePlaceholderVisibility(newBlockElement);
            const childrenWrapper = (newType === 'toggle') ? getToggleChildrenWrapperElement(newBlockElement) : newBlockElement.querySelector('.callout-content-wrapper');
            childrenWrapper?.querySelectorAll(':scope > .editor-block').forEach(updatePlaceholderVisibility);
            let elementToFocus = (newType === 'toggle') ? getToggleTitleElement(newBlockElement) : getCalloutPrimaryContentElement(newBlockElement);
            if (elementToFocus) { setTimeout(() => { /* ... (логика отложенного фокуса без изменений) ... */ if (elementToFocus && document.body.contains(elementToFocus)) { const styles = window.getComputedStyle(elementToFocus); if (styles.display !== 'none' && styles.visibility !== 'hidden' && elementToFocus.offsetWidth > 0 && elementToFocus.offsetHeight > 0) { focusAtStart(elementToFocus); } else { console.warn(`[changeBlockType Focus] Target element ${newType === 'toggle' ? 'title' : 'content'} not visible/interactive for focus.`); } } else { console.warn(`[changeBlockType Focus] Target element ${newType === 'toggle' ? 'title' : 'content'} not found in DOM for focus.`); } }, 100); }
            else { console.warn(`[changeBlockType] Could not find initial elementToFocus for new container block ${newBlockData.id}:`, newBlockElement); }
            saveDocumentContent(); updateListAttributes();
        } catch (error) { console.error(`Error changing TO ${newType} ${currentId}:`, error); saveDocumentContent(); return null; }
         return newBlockElement; // <-- Возвращаем новый элемент
    }

    // --- Стандартная смена типа (включая image) ---
    const newBlockData = { id: currentBlockId, type: newType, html: (isImageType ? '' : currentHtml), // Для image html не нужен
                           src: (isImageType ? currentSrc : null) // Переносим src, если меняем на image (маловероятно, но возможно)
                         };
    newBlockData.listType = (newType === 'li') ? (listType ?? currentListType ?? 'ul') : null;
    if (options.inQuote !== undefined) { newBlockData.inQuote = options.inQuote; } else if (newType === 'quote') { newBlockData.inQuote = true; } else if (wasInQuote && ['p', 'h1', 'h2', 'h3', 'image'].includes(newType)) { newBlockData.inQuote = false; } else { newBlockData.inQuote = wasInQuote; } // image не может быть inQuote
    if (options.indentLevel !== undefined) { newBlockData.indentLevel = Math.max(0, options.indentLevel); } else { if (!newBlockData.inQuote && !wasInsideContainer && ['p', 'li', 'todo'].includes(newType)) { newBlockData.indentLevel = currentIndent; } else { newBlockData.indentLevel = 0; } }
    if (newBlockData.inQuote && !['li', 'todo'].includes(newType)) { newBlockData.indentLevel = 0; } if (options.inQuote === false) { newBlockData.indentLevel = 0; } if (newType === 'todo') { newBlockData.checked = options.checked ?? (currentType === 'todo' ? (currentCheckedState === 'true') : false); }
    // Очистка ненужных полей
    if (!newBlockData.listType) delete newBlockData.listType; if (!newBlockData.inQuote) delete newBlockData.inQuote; if (newBlockData.indentLevel === 0 && !['li', 'todo'].includes(newType)) delete newBlockData.indentLevel; if (newType !== 'todo') delete newBlockData.checked; if (!newBlockData.src) delete newBlockData.src; if (newType !== 'image') delete newBlockData.src;

    try {
        newBlockElement = createBlockElement(newBlockData); // <-- Присваиваем результат
        if (!newBlockElement) throw new Error("createBlockElement returned null during standard change.");
        if (blockElement.parentNode) {
            let currentRange = null; const selection = window.getSelection();
            if (selection && selection.rangeCount > 0 && selection.anchorNode && blockElement.contains(selection.anchorNode)) { try { currentRange = selection.getRangeAt(0).cloneRange(); } catch(e) { console.warn("Could not clone range before block type change"); } }
            blockElement.parentNode.replaceChild(newBlockElement, blockElement);
            updateQuoteConnectionsAround(newBlockElement);
            updatePlaceholderVisibility(newBlockElement);

            // Восстанавливаем курсор или ставим в начало (кроме image)
            if (!isImageType) {
                 let elementToFocus = getEditableContentElement(newBlockElement);
                 if (elementToFocus) {
                     requestAnimationFrame(() => {
                          if (document.body.contains(newBlockElement)) {
                              let rangeRestored = false;
                              if (currentRange && elementToFocus.contains(currentRange.commonAncestorContainer)) { try { selection.removeAllRanges(); selection.addRange(currentRange); rangeRestored = true; } catch (rangeErr) { console.warn("Could not restore original range after type change.", rangeErr); } }
                              if (!rangeRestored) { focusAtStart(elementToFocus); }
                          }
                     });
                 }
            }
        } else { console.error("Old blockElement has no parentNode during changeBlockType."); }
        saveDocumentContent(); updateListAttributes();
    } catch (error) { console.error(`Error during standard changeBlockType for block ${currentId}:`, error); saveDocumentContent(); return null; }
    return newBlockElement; // <-- Возвращаем новый элемент
}


/**
 * Обрабатывает команды форматирования, вызванные извне (например, панелью инструментов).
 * @param {string} command - Название команды.
 * @param {Element} blockElement - Элемент блока.
 * @param {string | null} [value=null] - Дополнительное значение.
 * @returns {Element | null} - Измененный/новый элемент или null, если команда меняла тип блока.
 */
export function handleFormatCommand(command, blockElement, value = null) {
     if (!blockElement || !blockElement.dataset || !blockElement.dataset.blockId) { console.warn("handleFormatCommand: Invalid blockElement provided."); return null; }
    const blockId = blockElement.dataset.blockId; const blockType = blockElement.dataset.blockType; const listType = blockElement.dataset.listType; const inQuote = blockElement.hasAttribute('data-in-quote') || blockType === 'quote'; const parentWrapper = blockElement.parentElement; const isInsideContainer = parentWrapper?.matches('.callout-content-wrapper, .toggle-children-wrapper');
    let blockTypeChanged = false; let listMayNeedUpdate = false; let requiresSave = false;
    let currentSelectionRange = null; const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && selection.anchorNode) { const contentElement = selection.anchorNode.parentElement?.closest('[contenteditable="true"]'); if (contentElement && blockElement.contains(contentElement)) { try { currentSelectionRange = selection.getRangeAt(0).cloneRange(); } catch(e){ console.warn("Could not clone range for format command"); } } }

    let resultingElement = blockElement; // По умолчанию возвращаем старый элемент

    switch (command) {
        // Команды, меняющие тип блока
        case 'insertOrderedList': case 'insertUnorderedList': case 'toggleTodo': case 'formatQuote': case 'formatToggle': case 'formatCallout': case 'formatBlock': {
            // --- Блок проверок на запрещенные комбинации ---
             if (inQuote && ['insertOrderedList', 'insertUnorderedList', 'toggleTodo', 'formatToggle', 'formatCallout'].includes(command)) { console.warn(`Format command '${command}' ignored inside a quote block.`); showTemporaryErrorHighlight(blockElement); return null; }
             if (inQuote && command === 'formatBlock' && value && ['h1', 'h2', 'h3'].includes(value.toLowerCase())) { console.warn(`Format command '${command}' with value '${value}' ignored inside a quote.`); showTemporaryErrorHighlight(blockElement); return null; }
             if (command === 'formatToggle' && parentWrapper?.classList.contains('toggle-children-wrapper')) { console.warn(`Format command '${command}' ignored inside another toggle.`); showTemporaryErrorHighlight(blockElement); return null; }
             // --- Конец блока проверок ---

             let targetType = blockType; let targetListType = listType; let needsTypeChange = true;
             if (command === 'insertOrderedList' || command === 'insertUnorderedList' || command === 'toggleTodo') { targetType = (command === 'toggleTodo') ? 'todo' : 'li'; targetListType = (command === 'insertOrderedList') ? 'ol' : (command === 'insertUnorderedList' ? 'ul' : null); if (blockType === targetType && (targetType !== 'li' || listType === targetListType)) { targetType = 'p'; targetListType = null; } }
             else if (command === 'formatQuote') { targetType = (blockType === 'quote') ? 'p' : 'quote'; targetListType = null; }
             else if (command === 'formatToggle') { targetType = (blockType === 'toggle') ? 'p' : 'toggle'; targetListType = null; }
             else if (command === 'formatCallout') { targetType = (blockType === 'callout') ? 'p' : 'callout'; targetListType = null; }
             else if (command === 'formatBlock' && value && ['p', 'h1', 'h2', 'h3'].includes(value.toLowerCase())) { targetType = value.toLowerCase(); if (blockType === targetType) { targetType = 'p'; } targetListType = null; }
             else { needsTypeChange = false; console.warn(`Invalid value or context for command: ${command} ${value}`); }

             if (needsTypeChange) {
                  const currentIndent = parseInt(blockElement.dataset.indentLevel || '0', 10);
                  let indentLevelOption = (targetType === 'p' && !isInsideContainer) ? 0 : currentIndent; // Сбрасываем отступ для P верхнего уровня
                  if (['h1','h2','h3','quote','callout','toggle', 'image'].includes(targetType)) { indentLevelOption = 0; } // У этих типов нет отступов
                  resultingElement = changeBlockType(blockElement, targetType, targetListType, { indentLevel: indentLevelOption }); // <-- Сохраняем результат
                  blockTypeChanged = true; listMayNeedUpdate = true;
             }
            break;
        }
        // Команды форматирования текста
        default: {
            blockTypeChanged = false; let contentElement = null; const activeEl = document.activeElement; if (activeEl?.hasAttribute('contenteditable') && blockElement.contains(activeEl)) { contentElement = activeEl.closest('.block-content[contenteditable="true"], .toggle-title[contenteditable="true"]'); } if (!contentElement && currentSelectionRange) { const ancestor = currentSelectionRange.commonAncestorContainer; if (ancestor) { contentElement = (ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement)?.closest('.block-content[contenteditable="true"], .toggle-title[contenteditable="true"]'); } } if (!contentElement) { console.warn(`Could not find editable element for inline command '${command}' in block ${blockId}`); break; } if (document.activeElement !== contentElement) { contentElement.focus(); if (currentSelectionRange && contentElement.contains(currentSelectionRange.commonAncestorContainer)) { try { selection.removeAllRanges(); selection.addRange(currentSelectionRange); } catch(e){ console.warn("Could not restore range for inline format command"); } } } try { document.execCommand(command, false, value); requiresSave = true; } catch (err) { console.error(`Error executing inline command '${command}':`, err); }
            resultingElement = blockElement; // Тип не менялся
            break;
        }
    } // Конец switch

    if (requiresSave || blockTypeChanged) { saveDocumentContent(); } if (listMayNeedUpdate) { updateListAttributes(); }
    return resultingElement; // <-- Возвращаем измененный или старый элемент
}


/**
 * Сбрасывает форматирование для выделенных блоков или текущего блока к параграфу по умолчанию.
 */
export function resetToParagraph() {
    let blocksToReset = []; const currentSelection = getSelectedBlockIds(); let requiresSave = false; let requiresListUpdate = false; let firstBlockToFocusId = null; if (!editorArea) { console.error("resetToParagraph: editorArea not found."); return; }
    if (currentSelection.size > 0) { const orderedIds = getBlockIdsInOrder().filter(id => currentSelection.has(id)); orderedIds.forEach(id => { const block = editorArea.querySelector(`:scope > .editor-block[data-block-id="${id}"]`); if (block) blocksToReset.push(block); }); if (blocksToReset.length > 0) firstBlockToFocusId = blocksToReset[0].dataset.blockId; clearBlockSelection(); } else { const activeElement = document.activeElement; const focusedBlock = activeElement?.closest('.editor-block'); if (focusedBlock) { const parentCont = focusedBlock.parentElement?.closest('.editor-block[data-block-type="callout"], .editor-block[data-block-type="toggle"]'); if (parentCont) { blocksToReset = [parentCont]; firstBlockToFocusId = parentCont.dataset.blockId; } else { blocksToReset = [focusedBlock]; firstBlockToFocusId = focusedBlock.dataset.blockId; } } }
    if (blocksToReset.length === 0) return;
    blocksToReset.forEach(blockElement => { const currentType = blockElement.dataset.blockType; const currentInQuote = blockElement.hasAttribute('data-in-quote'); const currentIndent = parseInt(blockElement.dataset.indentLevel || '0', 10); const isContainer = ['callout', 'toggle'].includes(currentType); const isInContainerWrapper = !isContainer && blockElement.parentElement?.matches('.callout-content-wrapper, .toggle-children-wrapper'); let needsTypeReset = currentType !== 'p' || currentInQuote || (currentIndent > 0 && !isInContainerWrapper) || isContainer; if (needsTypeReset) { changeBlockType(blockElement, 'p', null, { indentLevel: 0, inQuote: false }); requiresListUpdate = true; } else if (currentType === 'p' && !currentInQuote && currentIndent === 0) { const contentElement = getEditableContentElement(blockElement); if (contentElement) { const hadFocus = document.activeElement === contentElement; if (!hadFocus) contentElement.focus(); try { const range = document.createRange(); range.selectNodeContents(contentElement); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(range); document.execCommand('removeFormat', false, null); sel?.collapseToStart(); requiresSave = true; if (!hadFocus && contentElement.blur) contentElement.blur(); } catch(e){ console.error("Error removing inline format:", e); if (!hadFocus && contentElement.blur) contentElement.blur(); } } } });
    if (firstBlockToFocusId && editorArea) { requestAnimationFrame(() => { const firstResetBlock = document.querySelector(`.editor-block[data-block-id="${firstBlockToFocusId}"]`); if (firstResetBlock) { let firstContent = getEditableContentElement(firstResetBlock) || getToggleTitleElement(firstResetBlock) || getCalloutPrimaryContentElement(firstResetBlock); if (firstContent && document.body.contains(firstContent) && firstResetBlock.dataset.blockType !== 'image') { focusAtStart(firstContent); } else { if (firstResetBlock.focus && firstResetBlock.dataset.blockType !== 'image') firstResetBlock.focus(); } } }); }
    if (requiresSave) saveDocumentContent(); if (requiresListUpdate) updateListAttributes();
} // --- Конец resetToParagraph ---