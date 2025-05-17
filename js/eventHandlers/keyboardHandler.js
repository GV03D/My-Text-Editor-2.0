// js/eventHandlers/keyboardHandler.js
// Обработка событий клавиатуры в редакторе и глобально.
// --- ВЕРСИЯ 30: Полный код, исправлен вызов showLinkMenu по Cmd+K ---

import { MAX_INDENT_LEVEL, MAX_OL_INDENT_LEVEL, MAX_UL_INDENT_LEVEL } from '../config.js';
import { editorArea, currentDocTitleElement, searchInput } from '../domElements.js';
import {
    getSelectedBlockIds, setSelectAllState, setLastCursorXPosition, getNextBlockIdAndIncrement,
    getSelectAllState, hasSelectedBlockId, clearSelectedBlockIds as clearSelectionStateData,
    setSelectionAnchorId, setSelectionFocusId, getActiveDocId, removeDocument, getDocuments,
    getLastCursorXPosition, addSelectedBlockId,
    getLastUsedColor, // Импорт для шортката (применение/сброс цвета)
    setLastUsedColor // Импорт для сохранения последнего цвета
} from '../state.js';
import {
    isBlockContentEmpty, getEditableContentElement, getBlockParentContainer, getToggleTitleElement,
    getToggleChildrenWrapperElement, isCursorAtStartOfContent, isCursorAtEndOfContent,
    isCursorOnFirstVisualLine, isCursorOnLastVisualLine, getCalloutPrimaryContentElement,
    updatePlaceholderVisibility
} from '../blockUtils.js';
import {
    focusAtStart, focusAtEnd, focusAt, getCursorClientX, findOffsetForClientX,
    showTemporaryErrorHighlight, getCursorPosition,
    applyStyleToRange, // Для применения цвета
    processRangeNodesGeneric, // Для ручного применения/удаления стилей/тегов/классов
    toggleClassForRange, // Для кода
    toggleTagForRange,   // Для B, I, U, S
    normalizeBlocks,      // Для нормализации после изменений
    isRangeAllStyle,     // Для проверки стиля выделения (не используется для toggle)
} from '../utils.js';
import { updateListAttributes } from '../listManager.js';
import { updateQuoteConnectionsAround, updateAllQuoteConnections, updateQuoteConnection } from '../quoteManager.js';
import { saveDocumentContent, debouncedSave, checkAndSetInitialPlaceholderState } from '../documentManager.js';
import { changeBlockType, resetToParagraph } from '../blockFormatter.js';
import { clearBlockSelection, updateSelectionVisuals, moveSelectedBlocks, getBlockIdsInOrder } from '../selectionManager.js';
import { createBlockElement } from '../blockFactory.js';
import { showMenu, hideMenu, isMenuActive, handleMenuKeyDown } from '../slashMenuController.js';
import { showMenu as showLinkMenu } from '../linkMenuController.js'; // Используем правильный импорт

// Состояние для переключения шортката Cmd+Shift+H
let lastShortcutAction = null; // 'apply' or 'reset'
let lastActionRange = null; // Сохраненный Range объект

// Константа для маркеров выделения (для B, I, U, S, E и Цвета)
const MARKER_ID_PREFIX = 'kb-marker-';

// Вспомогательные функции для цвета (Нужны для Cmd+Shift+H)
function normalizeColorLocal(colorStr) {
    if (!colorStr || typeof colorStr !== 'string') return null;
    const lowerColor = colorStr.toLowerCase().trim();
    if (lowerColor === 'transparent' || lowerColor.startsWith('rgba(') && lowerColor.endsWith(', 0)')) return 'transparent';
    if (lowerColor === 'inherit') return 'inherit';
    const temp = document.createElement('div');
    temp.style.color = '#111';
    temp.style.color = lowerColor;
    temp.style.display = 'none';
    document.body.appendChild(temp);
    let computedColor = null;
    try { computedColor = window.getComputedStyle(temp).color; } catch(e) { console.error("Error getting computed style:", e); }
    document.body.removeChild(temp);
    if (!computedColor || computedColor === 'rgba(0, 0, 0, 0)') {
        if (lowerColor === 'transparent' || (lowerColor.startsWith('rgba(') && lowerColor.endsWith(', 0)'))) return 'transparent';
        return null;
    }
    return computedColor;
}
function isDefaultColorOrHighlight(colorValue, type) {
    const normalizedValue = normalizeColorLocal(colorValue);
    if (!normalizedValue || normalizedValue === 'inherit') return true;
    if (normalizedValue === 'transparent') return true;
    if (type === 'text') {
        const defaultEditorColor = normalizeColorLocal(getComputedStyle(editorArea || document.body).color);
        const black = 'rgb(0, 0, 0)'; const darkGray = 'rgb(51, 51, 51)';
        return normalizedValue === defaultEditorColor || normalizedValue === black || normalizedValue === darkGray;
    } else {
        const white = 'rgb(255, 255, 255)';
        return normalizedValue === white || normalizedValue === 'rgba(0, 0, 0, 0)';
    }
}

// Вспомогательные функции для Backspace и Enter
function isQuoteBlock(blockElement) {
    return !!blockElement?.matches('.editor-block[data-block-type="quote"], .editor-block[data-in-quote="true"]');
}
function calculateLength(node) {
    if (!node) return 0;
    if (node.nodeType === Node.TEXT_NODE) return node.length;
    if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'BR') return 1;
        let len = 0;
        node.childNodes.forEach(child => len += calculateLength(child));
        return len;
    }
    return 0;
}
function rangesAreEqual(range1, range2) {
    if (!range1 || !range2) return range1 === range2;
    return (
        range1.startContainer === range2.startContainer &&
        range1.startOffset === range2.startOffset &&
        range1.endContainer === range2.endContainer &&
        range1.endOffset === range2.endOffset &&
        range1.collapsed === range2.collapsed
    );
}

/**
 * Основной обработчик нажатий клавиш внутри редактируемых элементов блоков.
 * @param {KeyboardEvent} e - Событие клавиатуры.
 */
export function handleBlockKeyDown(e) {
    // Проверка активного меню
    if (isMenuActive()) {
        if (handleMenuKeyDown(e)) { return; }
        else { const key = e.key; const isModifier = key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta'; const isNavigation = key.startsWith('Arrow') || key === 'Escape' || key === 'Enter' || key === 'Tab'; if (!isModifier && !isNavigation && key.length === 1) { hideMenu(); } }
    }
    const targetElement = e.target;
    if (!targetElement || !targetElement.hasAttribute || !targetElement.hasAttribute('contenteditable') || !targetElement.closest('.editor-block')) { return; }
    const currentBlock = targetElement.closest('.editor-block');
    if (!currentBlock) { return; }
    const blockId = currentBlock.dataset.blockId; const blockType = currentBlock.dataset.blockType || 'p'; const listType = currentBlock.dataset.listType; const isInQuote = currentBlock.hasAttribute('data-in-quote') || blockType === 'quote'; const currentIndentLevel = parseInt(currentBlock.dataset.indentLevel || '0', 10); const calloutWrapper = currentBlock.parentElement?.closest('.callout-content-wrapper'); const isInCalloutWrapper = !!calloutWrapper; const parentCalloutBlock = isInCalloutWrapper ? calloutWrapper.closest('.editor-block[data-block-type="callout"]') : null; const toggleBlock = targetElement.closest('.editor-block[data-block-type="toggle"]'); const isToggleTitleFocused = targetElement.matches('.toggle-title') && !!toggleBlock; const toggleChildrenWrapper = currentBlock.parentElement?.closest('.toggle-children-wrapper'); const isInToggleWrapper = !!toggleChildrenWrapper; const parentToggleBlock = isInToggleWrapper ? toggleChildrenWrapper.closest('.editor-block[data-block-type="toggle"]') : null; const isToggleOpen = parentToggleBlock ? parentToggleBlock.dataset.isOpen === 'true' : (toggleBlock ? toggleBlock.dataset.isOpen === 'true' : false); const isInsideContainer = isInCalloutWrapper || isInToggleWrapper; const parentContainer = getBlockParentContainer(currentBlock); if (!parentContainer) { console.error("KEYDOWN: Could not find parent container for block:", currentBlock); return; } const isToggleInsideCallout = isInToggleWrapper && parentToggleBlock && parentToggleBlock.parentElement?.closest('.callout-content-wrapper');
    const selection = window.getSelection(); const range = selection?.rangeCount > 0 ? selection.getRangeAt(0) : null; const isCollapsed = range?.collapsed; let blockIsEmpty = false; let cursorIsAtStart = false; if (range) { blockIsEmpty = isBlockContentEmpty(targetElement); cursorIsAtStart = isCursorAtStartOfContent(range, targetElement); } const initialTextContent = targetElement.textContent;

    // Обработка '/'
    if (e.key === '/') { if (blockIsEmpty && blockType === 'p' && cursorIsAtStart && !isInQuote && !isInsideContainer && !currentBlock.hasAttribute('data-initial-placeholder')) { e.preventDefault(); const contentEditableElement = getEditableContentElement(currentBlock); if (contentEditableElement) { contentEditableElement.textContent = 'Выберите блок'; contentEditableElement.classList.add('is-slash-placeholder'); } showMenu(currentBlock); return; } }
    // Обработка TAB
    else if (e.key === 'Tab') {
        e.preventDefault(); setSelectAllState(0); let targetBlockForIndent = currentBlock;
        if (targetBlockForIndent.dataset.blockType === 'callout' || isToggleTitleFocused) { showTemporaryErrorHighlight(targetBlockForIndent); return; }
        if (targetBlockForIndent.hasAttribute('data-in-quote')) { showTemporaryErrorHighlight(targetBlockForIndent); return; }
        let requiresSave = false; let requiresListUpdate = false; let currentLevel = parseInt(targetBlockForIndent.dataset.indentLevel || '0', 10); let newLevel; let indentChanged = false; const targetBlockType = targetBlockForIndent.dataset.blockType; const currentListTypeForMax = targetBlockForIndent.dataset.listType;
        if (e.shiftKey) { if (currentLevel > 0) { newLevel = currentLevel - 1; targetBlockForIndent.setAttribute('data-indent-level', String(newLevel)); if (newLevel === 0 && !['li', 'todo'].includes(targetBlockType)) { targetBlockForIndent.removeAttribute('data-indent-level'); } indentChanged = true; } else { if (['li', 'todo'].includes(targetBlockType)) { changeBlockType(targetBlockForIndent, 'p', null, { indentLevel: 0 }); indentChanged = false; requiresSave = false; requiresListUpdate = false; } else { indentChanged = false; } } } else { let maxIndentForBlock = MAX_INDENT_LEVEL; if (targetBlockType === 'li') { if (currentListTypeForMax === 'ol') maxIndentForBlock = MAX_OL_INDENT_LEVEL; else if (currentListTypeForMax === 'ul') maxIndentForBlock = MAX_UL_INDENT_LEVEL; } else if (targetBlockType === 'todo') { maxIndentForBlock = MAX_INDENT_LEVEL; } else if (!['p', 'toggle'].includes(targetBlockType)) { maxIndentForBlock = 0; } if (currentLevel < maxIndentForBlock) { const prevBlock = targetBlockForIndent.previousElementSibling?.closest('.editor-block'); const isPrevBlockInSameContainer = !isInsideContainer || (prevBlock && prevBlock.parentElement === targetBlockForIndent.parentElement); const prevLevel = isPrevBlockInSameContainer ? parseInt(prevBlock?.dataset.indentLevel || '0', 10) : -1; if (!prevBlock || !isPrevBlockInSameContainer || prevLevel >= currentLevel || ['toggle', 'callout'].includes(prevBlock?.dataset.blockType)) { newLevel = currentLevel + 1; targetBlockForIndent.setAttribute('data-indent-level', String(newLevel)); indentChanged = true; } else { if (targetBlockType === 'li' && prevBlock?.dataset?.blockType === 'li') { if (!targetBlockForIndent.classList.contains('shake-marker')) { targetBlockForIndent.classList.add('shake-marker'); setTimeout(() => targetBlockForIndent?.classList.remove('shake-marker'), 400); } } indentChanged = false; } } else { indentChanged = false; if (['li', 'todo', 'p', 'toggle'].includes(targetBlockType)) { showTemporaryErrorHighlight(targetBlockForIndent); } } }
        if (indentChanged) { requiresSave = true; if (['li', 'todo'].includes(targetBlockType)) { requiresListUpdate = true; } updateQuoteConnectionsAround(targetBlockForIndent); updatePlaceholderVisibility(targetBlockForIndent); }
        if (requiresSave) saveDocumentContent(); if (requiresListUpdate) updateListAttributes();
        if (indentChanged || (e.shiftKey && currentLevel === 0 && ['li', 'todo'].includes(targetBlockType))) { setLastCursorXPosition(null); requestAnimationFrame(() => { const potentiallyNewBlock = editorArea?.querySelector(`.editor-block[data-block-id="${blockId}"]`) || targetBlockForIndent; const elToFocus = getEditableContentElement(potentiallyNewBlock) || getToggleTitleElement(potentiallyNewBlock); if(elToFocus) focusAtStart(elToFocus); }); }
        return;
    }
    // Обработка ARROW KEYS
    else if (range && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        let handled = false; let targetBlock = null; const moveDirection = (e.key === 'ArrowUp') ? -1 : 1;
        if (e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); handled = true; const atStart = isCursorAtStartOfContent(range, targetElement); const atEnd = isCursorAtEndOfContent(range, targetElement); if (moveDirection === -1) { if (!atStart) { focusAtStart(targetElement); } else { if (isToggleTitleFocused) { targetBlock = toggleBlock.previousElementSibling; } else if (isInsideContainer && currentBlock === parentContainer.querySelector(':scope > .editor-block:first-child')) { if (parentToggleBlock?.dataset.blockType === 'toggle') { targetBlock = parentToggleBlock; } else { targetBlock = parentCalloutBlock?.previousElementSibling; } } else { targetBlock = currentBlock.previousElementSibling; } while(targetBlock && !targetBlock.matches('.editor-block')) targetBlock = targetBlock.previousElementSibling; if (targetBlock) { let elementToFocus = getEditableContentElement(targetBlock) || getToggleTitleElement(targetBlock); if (elementToFocus) focusAtStart(elementToFocus); else console.warn("Alt+Up: Target block found but no content/title element inside."); } } } else { if (!atEnd) { focusAtEnd(targetElement); } else { if (isToggleTitleFocused) { if (isToggleOpen) { targetBlock = getToggleChildrenWrapperElement(toggleBlock)?.querySelector(':scope > .editor-block:first-child'); } if (!targetBlock) targetBlock = toggleBlock.nextElementSibling; } else if (isInsideContainer && currentBlock === parentContainer.querySelector(':scope > .editor-block:last-child')) { targetBlock = (parentToggleBlock || parentCalloutBlock)?.nextElementSibling; } else { targetBlock = currentBlock.nextElementSibling; } while(targetBlock && !targetBlock.matches('.editor-block')) targetBlock = targetBlock.nextElementSibling; if (targetBlock) { let elementToFocus = getEditableContentElement(targetBlock) || getToggleTitleElement(targetBlock); if (elementToFocus) focusAtEnd(elementToFocus); else console.warn("Alt+Down: Target block found but no content/title element inside."); } } } setLastCursorXPosition(null); setSelectAllState(0); return; }
        else if (isCollapsed && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) { const isFirstChildInToggle = isInToggleWrapper && currentBlock === toggleChildrenWrapper?.querySelector(':scope > .editor-block:first-child'); const isLastChildInToggle = isInToggleWrapper && currentBlock === toggleChildrenWrapper?.querySelector(':scope > .editor-block:last-child'); const isFirstChildInCallout = isInCalloutWrapper && currentBlock === calloutWrapper?.querySelector(':scope > .editor-block:first-child'); const isLastChildInCallout = isInCalloutWrapper && currentBlock === calloutWrapper?.querySelector(':scope > .editor-block:last-child'); const onFirstLine = isCursorOnFirstVisualLine(range, targetElement); const onLastLine = isCursorOnLastVisualLine(range, targetElement); const isOnEdge = (moveDirection === -1) ? onFirstLine : onLastLine; if (isOnEdge) { if (moveDirection === -1) { if (isToggleTitleFocused) { targetBlock = toggleBlock.previousElementSibling; } else if (isFirstChildInToggle) { targetBlock = parentToggleBlock; } else if (isFirstChildInCallout) { targetBlock = parentCalloutBlock?.previousElementSibling; } else { targetBlock = currentBlock.previousElementSibling; } } else { if (isToggleTitleFocused) { if (isToggleOpen) { targetBlock = getToggleChildrenWrapperElement(toggleBlock)?.querySelector(':scope > .editor-block:first-child'); } if (!targetBlock) targetBlock = toggleBlock.nextElementSibling; } else if (isLastChildInToggle) { targetBlock = parentToggleBlock?.nextElementSibling; } else if (isLastChildInCallout) { targetBlock = parentCalloutBlock?.nextElementSibling; } else { targetBlock = currentBlock.nextElementSibling; } } while(targetBlock && !targetBlock.matches('.editor-block')) { targetBlock = (moveDirection === -1) ? targetBlock.previousElementSibling : targetBlock.nextElementSibling; } if (targetBlock) { e.preventDefault(); handled = true; let targetContentElement = null; let focusTargetIsTitle = false; if (targetBlock.dataset.blockType === 'toggle') { targetContentElement = getToggleTitleElement(targetBlock); focusTargetIsTitle = true; } else if (targetBlock.dataset.blockType === 'callout') { targetContentElement = getCalloutPrimaryContentElement(targetBlock); } else { targetContentElement = getEditableContentElement(targetBlock); } if (targetContentElement) { let currentX = getLastCursorXPosition(); if (currentX === null) { currentX = getCursorClientX(range); if (currentX !== null) setLastCursorXPosition(currentX); } const targetContentRect = targetContentElement.getBoundingClientRect(); let targetY = (moveDirection === -1) ? (targetContentRect.bottom - 5) : (targetContentRect.top + 5); let targetOffset = null; if (currentX !== null) { targetOffset = findOffsetForClientX(targetContentElement, currentX, targetY); } if (targetOffset !== null && !focusTargetIsTitle) { focusAt(targetContentElement, targetOffset); } else { if (moveDirection === -1) { focusAtEnd(targetContentElement); } else { focusAtStart(targetContentElement); } setLastCursorXPosition(null); } } else { setLastCursorXPosition(null); targetBlock.focus?.(); } } else { setLastCursorXPosition(null); } } else { setLastCursorXPosition(null); handled = false; } if (handled) { setSelectAllState(0); return; } }
        else { setLastCursorXPosition(null); }
        return;
    }
    // Обработка ENTER
    else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault(); setSelectAllState(0); setLastCursorXPosition(null);
        if (currentBlock.hasAttribute('data-initial-placeholder')) { return; }
        if (isInQuote && blockIsEmpty) { changeBlockType(currentBlock, 'p', null, { inQuote: false, indentLevel: 0 }); return; }
        const rangeForSplit = range; let newBlockData = null; let contentBefore = ''; let contentAfter = ''; let focusTarget = null; let containerToInsert = parentContainer; let insertRef = currentBlock.nextSibling; let splitCurrentContent = true; let forceSave = false; let removeCurrentBlock = false; let focusTargetBlockIdAfterEnter = null;
        if (splitCurrentContent && !blockIsEmpty && rangeForSplit && !isCursorAtEndOfContent(rangeForSplit, targetElement)) { try { const postRange = rangeForSplit.cloneRange(); postRange.selectNodeContents(targetElement); postRange.setStart(rangeForSplit.endContainer, rangeForSplit.endOffset); const postFragment = postRange.extractContents(); const tempDivAfter = document.createElement('div'); tempDivAfter.appendChild(postFragment); contentAfter = tempDivAfter.innerHTML; if (!rangeForSplit.collapsed) rangeForSplit.deleteContents(); contentBefore = targetElement.innerHTML; targetElement.innerHTML = contentBefore; } catch (splitError) { console.warn("Error splitting content on Enter:", splitError); contentBefore = targetElement.innerHTML; contentAfter = ''; } }
        else if (!blockIsEmpty) { contentBefore = targetElement.innerHTML; contentAfter = ''; if (rangeForSplit && !rangeForSplit.collapsed) { rangeForSplit.deleteContents(); targetElement.innerHTML = rangeForSplit.commonAncestorContainer.innerHTML || rangeForSplit.commonAncestorContainer.textContent || ''; } }
        let requiresListUpdate = false;
        const isFirstChildInToggle = isInToggleWrapper && currentBlock === toggleChildrenWrapper?.querySelector(':scope > .editor-block:first-child'); const isLastChildInToggle = isInToggleWrapper && currentBlock === toggleChildrenWrapper?.querySelector(':scope > .editor-block:last-child'); const isFirstChildInCallout = isInCalloutWrapper && currentBlock === calloutWrapper?.querySelector(':scope > .editor-block:first-child'); const isLastChildInCallout = isInCalloutWrapper && currentBlock === calloutWrapper?.querySelector(':scope > .editor-block:last-child');
        if (isToggleTitleFocused) { splitCurrentContent = false; let createdNewChild = false; const childrenWrapper = getToggleChildrenWrapperElement(toggleBlock); let firstChild = childrenWrapper?.querySelector(':scope > .editor-block:first-child'); if (!firstChild && childrenWrapper) { const firstChildData = { type: 'p', html: '' }; firstChild = createBlockElement(firstChildData); if (firstChild) { childrenWrapper.appendChild(firstChild); updatePlaceholderVisibility(firstChild); forceSave = true; updateQuoteConnectionsAround(firstChild); createdNewChild = true; } else { firstChild = null; console.error("[Enter Toggle Title] Failed to create first child element!"); } } let elementToFocusImmediately = null; if (firstChild) { elementToFocusImmediately = getEditableContentElement(firstChild); } if (createdNewChild && elementToFocusImmediately) { const newChildId = firstChild.dataset.blockId; if (newChildId) { focusTargetBlockIdAfterEnter = newChildId; } focusTarget = null; } else if (elementToFocusImmediately) { focusTarget = elementToFocusImmediately; } else { focusTarget = targetElement; } if (!isToggleOpen) { toggleBlock.setAttribute('data-is-open', 'true'); if (!forceSave) forceSave = true; } newBlockData = null; }
        else if (isInToggleWrapper || isInCalloutWrapper) { if (blockIsEmpty && (blockType === 'li' || blockType === 'todo')) { splitCurrentContent = false; if (currentIndentLevel > 0) { const newLevel = currentIndentLevel - 1; currentBlock.setAttribute('data-indent-level', String(newLevel)); if (newLevel === 0) currentBlock.removeAttribute('data-indent-level'); focusTarget = targetElement; requestAnimationFrame(() => focusAtStart(focusTarget)); requiresListUpdate = true; forceSave = true; updateQuoteConnectionsAround(currentBlock); updatePlaceholderVisibility(currentBlock); newBlockData = null; } else { changeBlockType(currentBlock, 'p', null, { indentLevel: 0 }); newBlockData = null; requiresListUpdate = false; forceSave = false; } } else if (blockIsEmpty && blockType === 'p') { splitCurrentContent = false; if (isInToggleWrapper && !isToggleInsideCallout) { removeCurrentBlock = true; newBlockData = { type: 'p', html: '', indentLevel: 0 }; if (!parentToggleBlock || !parentToggleBlock.parentNode) { console.error("Enter key: Could not find parentToggleBlock or its parent for exiting toggle."); newBlockData = null; removeCurrentBlock = false; focusTarget = getEditableContentElement(currentBlock); updatePlaceholderVisibility(currentBlock); } else { containerToInsert = parentToggleBlock.parentNode; insertRef = parentToggleBlock.nextSibling; } requiresListUpdate = true; forceSave = true; } else if (isInToggleWrapper && isToggleInsideCallout) { splitCurrentContent = false; removeCurrentBlock = true; newBlockData = { type: 'p', html: '', indentLevel: 0 }; if (!parentToggleBlock || !parentToggleBlock.parentNode) { console.error("Enter key: Could not find parentToggleBlock or its parent for exiting nested toggle."); newBlockData = null; removeCurrentBlock = false; focusTarget = getEditableContentElement(currentBlock); updatePlaceholderVisibility(currentBlock); } else { containerToInsert = parentToggleBlock.parentNode; insertRef = parentToggleBlock.nextSibling; } requiresListUpdate = true; forceSave = true; } else { removeCurrentBlock = true; newBlockData = { type: 'p', html: '', indentLevel: 0 }; if (!parentCalloutBlock || !parentCalloutBlock.parentNode) { console.error("Enter key: Could not find parentCalloutBlock or its parent for exiting callout."); newBlockData = null; removeCurrentBlock = false; focusTarget = getEditableContentElement(currentBlock); updatePlaceholderVisibility(currentBlock); } else { containerToInsert = parentCalloutBlock.parentNode; insertRef = parentCalloutBlock.nextSibling; } requiresListUpdate = true; forceSave = true; } } else if (!blockIsEmpty) { let newBlockType = 'p'; let newListType = null; let newCheckedState = undefined; if (blockType === 'li') { newBlockType = 'li'; newListType = listType; } if (blockType === 'todo') { newBlockType = 'todo'; newCheckedState = false; } let newIndentLevel = currentIndentLevel; newBlockData = { type: newBlockType, listType: newListType, checked: newCheckedState, html: contentAfter, indentLevel: newIndentLevel, inQuote: isInQuote }; if (!newBlockData.listType) delete newBlockData.listType; if (newBlockData.checked === undefined) delete newBlockData.checked; if (!newBlockData.inQuote) delete newBlockData.inQuote; if (newBlockData.type !== 'p' && newBlockData.type !== 'li' && newBlockData.type !== 'todo') { newBlockType = 'p'; newBlockData.type = 'p'; delete newBlockData.listType; delete newBlockData.checked; } containerToInsert = parentContainer; insertRef = currentBlock.nextSibling; requiresListUpdate = true; forceSave = true; } else { newBlockData = { type: 'p', html: '', indentLevel: 0 }; const parentContainerBlock = isInToggleWrapper ? parentToggleBlock : parentCalloutBlock; if (!parentContainerBlock || !parentContainerBlock.parentNode) { console.error("Enter Error: Could not find parentContainerBlock for non-empty exit."); newBlockData = null; } else { containerToInsert = parentContainerBlock.parentNode; insertRef = parentContainerBlock.nextSibling; } splitCurrentContent = false; const blockIsOnlyChild = currentBlock === parentContainer.querySelector(':scope > .editor-block:first-child') && currentBlock === parentContainer.querySelector(':scope > .editor-block:last-child'); if (blockIsOnlyChild && newBlockData !== null) { const contentEl = getEditableContentElement(currentBlock) || getToggleTitleElement(currentBlock); if (contentEl) contentEl.innerHTML = ''; updatePlaceholderVisibility(currentBlock); newBlockData = null; containerToInsert = parentContainer; insertRef = currentBlock.nextSibling; focusTarget = contentEl; } else if (newBlockData !== null) { if (currentBlock.parentNode) { removeCurrentBlock = true; } } else { focusTarget = getEditableContentElement(currentBlock) || getToggleTitleElement(currentBlock); updatePlaceholderVisibility(currentBlock); } requiresListUpdate = true; forceSave = true; } }
        else { if ((blockType === 'li' || blockType === 'todo') && blockIsEmpty) { if (currentIndentLevel > 0 && !isInQuote) { const newLevel = currentIndentLevel - 1; currentBlock.setAttribute('data-indent-level', String(newLevel)); if (newLevel === 0 && !['li', 'todo'].includes(blockType)) { currentBlock.removeAttribute('data-indent-level'); } else if (newLevel === 0 && ['li', 'todo'].includes(blockType)){ if(!currentBlock.hasAttribute('data-indent-level')){ currentBlock.setAttribute('data-indent-level', '0'); } } newBlockData = null; focusTarget = targetElement; requestAnimationFrame(()=>focusAtStart(focusTarget)); requiresListUpdate = true; splitCurrentContent = false; forceSave = true; updateQuoteConnectionsAround(currentBlock); updatePlaceholderVisibility(currentBlock); } else { changeBlockType(currentBlock, 'p', null, { inQuote: isInQuote, indentLevel: 0 }); newBlockData = null; requiresListUpdate = false; splitCurrentContent = false; forceSave = false; } } else if (blockType.startsWith('h')) { newBlockData = { type: 'p', html: contentAfter, indentLevel: 0, inQuote: false }; requiresListUpdate = false; forceSave = true; } else if (blockType === 'quote' && !blockIsEmpty) { newBlockData = { type: 'quote', html: contentAfter, inQuote: true }; requiresListUpdate = false; forceSave = true; } else if (blockIsEmpty && blockType !== 'p' && !['li', 'todo', 'quote'].includes(blockType)) { changeBlockType(currentBlock, 'p', null, { inQuote: isInQuote, indentLevel: currentIndentLevel }); newBlockData = null; requiresListUpdate = false; splitCurrentContent = false; forceSave = false; } else { let newBlockType = 'p'; let newListType = null; let newCheckedState = undefined; let newIndentLevel = currentIndentLevel; let newInQuote = isInQuote; if (blockType === 'li') { newBlockType = 'li'; newListType = listType; } if (blockType === 'todo') { newBlockType = 'todo'; newCheckedState = false; } if (blockType === 'quote') { newBlockType = 'quote'; newInQuote = true; } newBlockData = { type: newBlockType, listType: newListType, checked: newCheckedState, html: contentAfter, indentLevel: newIndentLevel, inQuote: newInQuote }; if (!newBlockData.listType) delete newBlockData.listType; if (!newBlockData.inQuote) delete newBlockData.inQuote; if (newBlockData.indentLevel === 0 && !['li', 'todo', 'quote'].includes(newBlockData.type)) delete newBlockData.indentLevel; if (newBlockData.type !== 'todo') delete newBlockData.checked; requiresListUpdate = (newBlockType === 'li' || newBlockType === 'todo'); forceSave = true; } }
        let newBlockElement = null; if (newBlockData) { newBlockData.id = getNextBlockIdAndIncrement(); newBlockElement = createBlockElement(newBlockData); if (newBlockElement) { const isRefNodeValid = insertRef === null || containerToInsert?.contains(insertRef); const prevNodeForCheck = insertRef ? insertRef.previousSibling : (removeCurrentBlock ? null : currentBlock); const isPrevNodeValid = !prevNodeForCheck || containerToInsert?.contains(prevNodeForCheck); const isContainerValid = containerToInsert === editorArea || containerToInsert?.matches('.callout-content-wrapper, .toggle-children-wrapper') || containerToInsert?.parentElement === editorArea; if (containerToInsert && isContainerValid && (isRefNodeValid || isPrevNodeValid) ) { containerToInsert.insertBefore(newBlockElement, insertRef); if (focusTarget === null && focusTargetBlockIdAfterEnter === null) { focusTarget = getEditableContentElement(newBlockElement) || getToggleTitleElement(newBlockElement); } updateQuoteConnectionsAround(newBlockElement); updatePlaceholderVisibility(newBlockElement); } else { console.error("Enter: Could not find valid container or reference node to insert new block into.", {containerToInsert, insertRef, isRefNodeValid, isPrevNodeValid, isContainerValid, parentToggleBlock, parentCalloutBlock}); focusTarget = targetElement; newBlockElement = null; removeCurrentBlock = false; } } else { console.error("Enter: Failed to create new block element.", newBlockData); focusTarget = targetElement; removeCurrentBlock = false; } }
        if (removeCurrentBlock && currentBlock.parentNode) { const blockToRemoveId = currentBlock.dataset.blockId; const nextSiblingAfterRemove = currentBlock.nextElementSibling; const prevSiblingAfterRemove = currentBlock.previousElementSibling; currentBlock.remove(); updateQuoteConnection(nextSiblingAfterRemove); if (prevSiblingAfterRemove) { updateQuoteConnectionsAround(prevSiblingAfterRemove); } requestAnimationFrame(checkAndSetInitialPlaceholderState); } else if (!removeCurrentBlock && currentBlock && document.body.contains(currentBlock)) { updatePlaceholderVisibility(currentBlock); }
        if (focusTarget && focusTargetBlockIdAfterEnter === null) { requestAnimationFrame(() => { if (focusTarget && document.body.contains(focusTarget)) focusAtStart(focusTarget); }); } else if (!blockIsEmpty && splitCurrentContent && !newBlockElement && focusTargetBlockIdAfterEnter === null) { requestAnimationFrame(() => { if (targetElement && document.body.contains(targetElement)) focusAtEnd(targetElement); }); }
        if (focusTargetBlockIdAfterEnter) { const targetId = focusTargetBlockIdAfterEnter; setTimeout(() => { const block = editorArea?.querySelector(`.editor-block[data-block-id="${targetId}"]`); const content = block ? getEditableContentElement(block) : null; if (content && document.body.contains(content)) { const styles = window.getComputedStyle(content); if (styles.display !== 'none' && styles.visibility !== 'hidden' && content.offsetWidth > 0 && content.offsetHeight > 0) { focusAtStart(content); } else { console.warn(`[Deferred Focus] Element ${targetId} content NOT visible or has no dimensions. Cannot focus.`); } } else { console.warn(`[Deferred Focus] Could not find block/content for ID ${targetId} or it's not in DOM.`); } }, 100); }
        if (forceSave) saveDocumentContent(); if (requiresListUpdate) updateListAttributes();
        return;
    }
    // Обработка BACKSPACE
    else if (e.key === 'Backspace') {
        let focusTargetElement = null; let focusOffset = null; let focusAtEndFlag = false; if (getSelectedBlockIds().size > 1 && hasSelectedBlockId(blockId)) { e.preventDefault(); return; } if (getSelectedBlockIds().size === 1 && hasSelectedBlockId(blockId) && !targetElement.matches('[contenteditable="true"]')) { e.preventDefault(); return; } if (!isCollapsed) { setSelectAllState(0); debouncedSave(); setTimeout(() => updatePlaceholderVisibility(currentBlock), 0); return; } let cursorIsAtStartForBackspace = false; if (range) { try { cursorIsAtStartForBackspace = isCursorAtStartOfContent(range, targetElement); } catch(er) { console.warn("Error checking cursor position for Backspace:", er); } }
        if (cursorIsAtStartForBackspace) {
            e.preventDefault(); let handled = true; let requiresListUpdate = false; let requiresSave = false; let checkInitialPlaceholderAfter = false; const isFirstChildInToggle = isInToggleWrapper && currentBlock === toggleChildrenWrapper?.querySelector(':scope > .editor-block:first-child'); const isFirstChildInCallout = isInCalloutWrapper && currentBlock === calloutWrapper?.querySelector(':scope > .editor-block:first-child');
            if (blockIsEmpty && blockType === 'p' && isInToggleWrapper && isToggleInsideCallout) { const prevBlockInToggle = currentBlock.previousElementSibling?.closest('.editor-block'); if (prevBlockInToggle) { focusTargetElement = getEditableContentElement(prevBlockInToggle); if (focusTargetElement) { const blockAfterRemoved = currentBlock.nextElementSibling; if (currentBlock.parentNode) currentBlock.remove(); focusAtEndFlag = true; requiresSave = true; requiresListUpdate = true; updateQuoteConnection(blockAfterRemoved); updatePlaceholderVisibility(prevBlockInToggle); checkInitialPlaceholderAfter = true; } else { handled = false; } } else { focusTargetElement = getToggleTitleElement(parentToggleBlock); if (focusTargetElement) { const blockAfterRemoved = currentBlock.nextElementSibling; if (currentBlock.parentNode) currentBlock.remove(); focusAtEndFlag = true; requiresSave = true; requiresListUpdate = true; updateQuoteConnection(blockAfterRemoved); if (toggleChildrenWrapper && toggleChildrenWrapper.children.length === 0) {} checkInitialPlaceholderAfter = true; } else { handled = false; } } }
            else if (isInQuote && blockIsEmpty) { const prevBlockQuote = currentBlock.previousElementSibling?.closest('.editor-block'); if (prevBlockQuote && parentContainer && (!isInsideContainer || prevBlockQuote.parentElement === currentBlock.parentElement) && isQuoteBlock(prevBlockQuote)) { const blockAfterRemoved = currentBlock.nextElementSibling; if (currentBlock.parentNode) currentBlock.remove(); focusTargetElement = getEditableContentElement(prevBlockQuote) || getToggleTitleElement(prevBlockQuote); focusAtEndFlag = true; requiresSave = true; requiresListUpdate = true; updateQuoteConnection(blockAfterRemoved); updatePlaceholderVisibility(prevBlockQuote); checkInitialPlaceholderAfter = true; } else { changeBlockType(currentBlock, 'p', null, { inQuote: false, indentLevel: 0 }); requiresSave = false; requiresListUpdate = false; handled = false; checkInitialPlaceholderAfter = true; } }
            else if (isToggleTitleFocused) { changeBlockType(toggleBlock, 'p'); requiresListUpdate = true; requiresSave = false; handled = false; checkInitialPlaceholderAfter = true; }
            else if (isInToggleWrapper && isFirstChildInToggle) { focusTargetElement = getToggleTitleElement(parentToggleBlock); if (focusTargetElement) { if (blockIsEmpty) { const blockAfterRemoved = currentBlock.nextElementSibling; if(currentBlock.parentNode) currentBlock.remove(); requiresSave = true; requiresListUpdate = true; updateQuoteConnection(blockAfterRemoved); if (toggleChildrenWrapper && toggleChildrenWrapper.children.length === 0) { const pData = { type: 'p', html: '' }; const pEl = createBlockElement(pData); if(pEl) toggleChildrenWrapper.appendChild(pEl); updatePlaceholderVisibility(pEl); updateQuoteConnectionsAround(pEl); } checkInitialPlaceholderAfter = true; } focusAtEndFlag = true; } else { handled = false; showTemporaryErrorHighlight(currentBlock); } }
            else if (isInCalloutWrapper && isFirstChildInCallout) { if (blockIsEmpty) { if (parentCalloutBlock) { const nextFocusTarget = parentCalloutBlock.nextElementSibling; changeBlockType(parentCalloutBlock, 'p'); requiresSave = false; requiresListUpdate = true; handled = false; checkInitialPlaceholderAfter = true; if(nextFocusTarget && nextFocusTarget.matches('.editor-block')) { const content = getEditableContentElement(nextFocusTarget) || getToggleTitleElement(nextFocusTarget); if(content) requestAnimationFrame(() => focusAtStart(content)); } } else { console.error("Backspace Error: Could not find parent callout block."); handled = false; showTemporaryErrorHighlight(currentBlock); } } else { showTemporaryErrorHighlight(currentBlock); handled = false; } }
            else if ((isInsideContainer || !isInQuote) && (blockType === 'li' || blockType === 'todo') && currentIndentLevel > 0) { let newLevel = Math.max(0, currentIndentLevel - 1); currentBlock.setAttribute('data-indent-level', String(newLevel)); if (newLevel === 0) currentBlock.removeAttribute('data-indent-level'); focusTargetElement = targetElement; focusAtEndFlag = false; requiresSave = true; requiresListUpdate = true; updateQuoteConnectionsAround(currentBlock); handled = true; updatePlaceholderVisibility(currentBlock); }
            else if (currentIndentLevel > 0 && !isInQuote && blockType !== 'quote' && ['p', 'toggle'].includes(blockType)) { let newLevel = Math.max(0, currentIndentLevel - 1); currentBlock.setAttribute('data-indent-level', String(newLevel)); if (newLevel === 0) currentBlock.removeAttribute('data-indent-level'); focusTargetElement = targetElement; focusAtEndFlag = false; requiresSave = true; requiresListUpdate = false; updateQuoteConnectionsAround(currentBlock); handled = true; updatePlaceholderVisibility(currentBlock); }
            else if ((!isInQuote || blockType === 'p') && (blockType === 'li' || blockType === 'todo') && currentIndentLevel === 0) { changeBlockType(currentBlock, 'p', null, { inQuote: isInQuote, indentLevel: 0 }); requiresSave = false; requiresListUpdate = false; handled = false; checkInitialPlaceholderAfter = true; }
            else {
                const prevBlock = currentBlock.previousElementSibling?.closest('.editor-block');
                const inCorrectContainer = parentContainer && prevBlock && prevBlock.parentElement === parentContainer;
                if (prevBlock && inCorrectContainer) {
                     const prevBlockType = prevBlock.dataset.blockType;
                     checkInitialPlaceholderAfter = true;
                     if (prevBlockType === 'toggle') { if (blockIsEmpty) { const blockAfterRemoved = currentBlock.nextElementSibling; if (currentBlock.parentNode) currentBlock.remove(); focusTargetElement = getToggleTitleElement(prevBlock); focusAtEndFlag = true; requiresSave = true; requiresListUpdate = true; updateQuoteConnection(blockAfterRemoved); updatePlaceholderVisibility(prevBlock); handled = true; } else { const currentContent = targetElement.innerHTML; const toggleTitle = getToggleTitleElement(prevBlock); if (toggleTitle) { focusTargetElement = toggleTitle; focusOffset = calculateLength(toggleTitle); toggleTitle.innerHTML += currentContent; const blockAfterRemoved = currentBlock.nextElementSibling; if (currentBlock.parentNode) currentBlock.remove(); focusAtEndFlag = false; requiresSave = true; requiresListUpdate = true; updateQuoteConnection(blockAfterRemoved); updatePlaceholderVisibility(prevBlock); handled = true; } else { handled = false; } } }
                     else if (prevBlockType === 'callout') { const firstChildInCallout = prevBlock.querySelector('.callout-content-wrapper > .editor-block:first-child'); const firstChildContent = firstChildInCallout ? getEditableContentElement(firstChildInCallout) : null; if (blockIsEmpty && firstChildContent) { const blockAfterRemoved = currentBlock.nextElementSibling; if (currentBlock.parentNode) currentBlock.remove(); focusTargetElement = firstChildContent; focusAtEndFlag = true; requiresSave = true; requiresListUpdate = true; updateQuoteConnection(blockAfterRemoved); updatePlaceholderVisibility(firstChildInCallout); handled = true; } else if (!blockIsEmpty && firstChildContent) { const currentContent = targetElement.innerHTML; focusTargetElement = firstChildContent; focusOffset = calculateLength(firstChildContent); firstChildContent.innerHTML += currentContent; const blockAfterRemoved = currentBlock.nextElementSibling; if (currentBlock.parentNode) currentBlock.remove(); focusAtEndFlag = false; requiresSave = true; requiresListUpdate = true; updateQuoteConnection(blockAfterRemoved); updatePlaceholderVisibility(firstChildInCallout); handled = true; } else { handled = false; } }
                     else { const prevContentElement = getEditableContentElement(prevBlock); if (prevContentElement) { if (blockIsEmpty) { const blockAfterRemoved = currentBlock.nextElementSibling; if (currentBlock.parentNode) currentBlock.remove(); focusTargetElement = prevContentElement; focusAtEndFlag = true; requiresSave = true; requiresListUpdate = true; updateQuoteConnection(blockAfterRemoved); updatePlaceholderVisibility(prevBlock); handled = true; } else { const currentContent = targetElement.innerHTML; focusTargetElement = prevContentElement; focusOffset = calculateLength(prevContentElement); prevContentElement.innerHTML += currentContent; const blockAfterRemoved = currentBlock.nextElementSibling; if (currentBlock.parentNode) currentBlock.remove(); focusAtEndFlag = false; requiresSave = true; requiresListUpdate = true; updateQuoteConnection(blockAfterRemoved); updatePlaceholderVisibility(prevBlock); handled = true; } } else { handled = false; } }
                } else { if (blockIsEmpty && !['p', 'toggle'].includes(blockType) && currentIndentLevel === 0 && !isInQuote) { changeBlockType(currentBlock, 'p', null, { inQuote: false, indentLevel: 0 }); requiresSave = false; requiresListUpdate = false; handled = false; checkInitialPlaceholderAfter = true; } else { handled = false; checkInitialPlaceholderAfter = false; if (blockIsEmpty) { /* Don't shake empty block */ } else showTemporaryErrorHighlight(currentBlock); } }
            }
            if (handled) { if (requiresSave) saveDocumentContent(); if (requiresListUpdate) updateListAttributes(); if (focusTargetElement) { requestAnimationFrame(() => { if (document.body.contains(focusTargetElement)) { if (focusAtEndFlag) { focusAtEnd(focusTargetElement); } else if (focusOffset !== null) { focusAt(focusTargetElement, focusOffset); } else { focusAtStart(focusTargetElement); } } if(checkInitialPlaceholderAfter) { checkAndSetInitialPlaceholderState(); } }); } else if (checkInitialPlaceholderAfter) { requestAnimationFrame(checkAndSetInitialPlaceholderState); } setSelectAllState(0); setLastCursorXPosition(null); return; }
            else if(checkInitialPlaceholderAfter) { requestAnimationFrame(checkAndSetInitialPlaceholderState); }
        } else { setSelectAllState(0); setLastCursorXPosition(null); debouncedSave(); setTimeout(() => updatePlaceholderVisibility(currentBlock), 0); }
    }
    // Обработка MARKDOWN TRIGGERS (SPACE)
    else if (e.key === ' ' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) { if (isToggleTitleFocused) { return; } if (!isCollapsed) { return; } const currentInitialText = targetElement.textContent; let commandExecuted = false; let listNeedsUpdate = false; const deleteTriggerAndChangeType = (len, newType, newListType = null, options = {}) => { if (targetElement.textContent === currentInitialText) { const textBeforeTrigger = currentInitialText.slice(0, -len); targetElement.innerHTML = textBeforeTrigger; e.preventDefault(); changeBlockType(currentBlock, newType, newListType, { ...options, inQuote: options.inQuote ?? isInQuote, indentLevel: options.indentLevel ?? currentIndentLevel, html: textBeforeTrigger }); commandExecuted = true; listNeedsUpdate = ['li', 'todo', 'quote', 'toggle', 'callout'].includes(newType); } }; if (!commandExecuted && blockType === 'p' && !isInQuote) { if (currentInitialText === '###') { deleteTriggerAndChangeType(3, 'h3'); } else if (currentInitialText === '##') { deleteTriggerAndChangeType(2, 'h2'); } else if (currentInitialText === '#') { deleteTriggerAndChangeType(1, 'h1'); } else if (currentInitialText === '1.') { deleteTriggerAndChangeType(2, 'li', 'ol'); } else if (currentInitialText === '*') { deleteTriggerAndChangeType(1, 'li', 'ul'); } else if (currentInitialText === '-') { deleteTriggerAndChangeType(1, 'li', 'ul'); } else if (currentInitialText === '[]') { deleteTriggerAndChangeType(2, 'todo'); } else if (currentInitialText === '[ ]') { deleteTriggerAndChangeType(3, 'todo'); } else if (currentInitialText === '"' || currentInitialText === '”') { deleteTriggerAndChangeType(1, 'quote'); } else if (currentInitialText === '>') { deleteTriggerAndChangeType(1, 'toggle'); } else if (currentInitialText === '!') { deleteTriggerAndChangeType(1, 'callout'); } } if (commandExecuted) { setSelectAllState(0); setLastCursorXPosition(null); if (listNeedsUpdate) updateListAttributes(); return; } }
    // Обработка прочих клавиш
    if (!(e.metaKey || e.ctrlKey || e.altKey || e.key === 'Shift' || e.key.startsWith('Arrow') || e.key === 'Tab' || e.key === 'Escape' )) { if (e.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(e.key)) { setSelectAllState(0); } }
} // --- Конец handleBlockKeyDown ---


// Функция для шортката цвета/сброса (Cmd+Shift+H)
function applyOrRemoveLastColor() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !editorArea || !editorArea.contains(selection.anchorNode) || !editorArea.contains(selection.focusNode)) {
        console.log("Shortcut Cmd+Shift+H: No valid non-collapsed selection found.");
        return;
    }

    const lastColor = getLastUsedColor();
    let currentRange = null;
    let startMarkerId = null;
    let endMarkerId = null;
    let blocksToNormalize = new Set();
    let actionToPerform = null;

    try {
        currentRange = selection.getRangeAt(0).cloneRange();
        if (currentRange.collapsed) {
             console.log("Shortcut Cmd+Shift+H: Range is collapsed, ignoring.");
             return;
        }
        if (!rangesAreEqual(currentRange, lastActionRange)) {
            console.log("Shortcut Cmd+Shift+H: Selection changed, resetting last action.");
            lastShortcutAction = null;
        }
        if (lastShortcutAction === 'apply') {
            actionToPerform = 'reset';
            console.log("Shortcut Cmd+Shift+H: Last action was 'apply', performing 'reset'.");
        } else {
            if (lastColor && lastColor.value && lastColor.type) {
                actionToPerform = 'apply';
                console.log("Shortcut Cmd+Shift+H: Last action was 'reset' or null, performing 'apply'.");
            } else {
                 const startNodeCheck = currentRange.startContainer;
                 const elementToCheck = startNodeCheck.nodeType === Node.ELEMENT_NODE ? startNodeCheck : startNodeCheck.parentElement;
                 let needsResetCheck = false;
                 if (elementToCheck && editorArea.contains(elementToCheck)) {
                     const relevantElement = elementToCheck.closest('span[style], [contenteditable="true"]') || elementToCheck;
                     if (relevantElement) {
                         const computedStyle = window.getComputedStyle(relevantElement);
                         if (!isDefaultColorOrHighlight(computedStyle.color, 'text') || !isDefaultColorOrHighlight(computedStyle.backgroundColor, 'highlight')) {
                             needsResetCheck = true;
                         }
                     }
                 }
                 if (needsResetCheck) {
                     actionToPerform = 'reset';
                     console.log("Shortcut Cmd+Shift+H: No last used color, but existing format found. Performing 'reset'.");
                 } else {
                     console.log("Shortcut Cmd+Shift+H: No last used color and nothing to reset.");
                     return;
                 }
            }
        }
    } catch (e) {
        console.error("Shortcut Cmd+Shift+H: Error checking state or cloning range:", e);
        return;
    }

    try {
        const timestamp = Date.now();
        startMarkerId = `${MARKER_ID_PREFIX}start-${timestamp}-${Math.random().toString(36).substring(2, 7)}`;
        endMarkerId = `${MARKER_ID_PREFIX}end-${timestamp}-${Math.random().toString(36).substring(2, 7)}`;
        const startMarker = document.createElement('span');
        startMarker.id = startMarkerId; startMarker.style.display = 'none'; startMarker.textContent = '\ufeff';
        const endMarker = document.createElement('span');
        endMarker.id = endMarkerId; endMarker.style.display = 'none'; endMarker.textContent = '\ufeff';
        const rangeForMarkers = currentRange.cloneRange();
        rangeForMarkers.collapse(false); rangeForMarkers.insertNode(endMarker);
        rangeForMarkers.setStart(currentRange.startContainer, currentRange.startOffset);
        rangeForMarkers.collapse(true); rangeForMarkers.insertNode(startMarker);
    } catch (e) {
        console.error("Shortcut Cmd+Shift+H: Error inserting markers:", e);
        document.getElementById(startMarkerId)?.remove();
        document.getElementById(endMarkerId)?.remove();
        startMarkerId = null; endMarkerId = null; currentRange = null;
        lastActionRange = null; lastShortcutAction = null;
        return;
    }

    let rangeBetweenMarkers = null;
    const startNode = document.getElementById(startMarkerId);
    const endNode = document.getElementById(endMarkerId);
    let actionExecuted = false;

    if (startNode && endNode && startNode.parentNode && endNode.parentNode) {
        try {
            rangeBetweenMarkers = document.createRange();
            rangeBetweenMarkers.setStartAfter(startNode);
            rangeBetweenMarkers.setEndBefore(endNode);
            blocksToNormalize.clear();
            const walker = document.createTreeWalker(
                rangeBetweenMarkers.commonAncestorContainer,
                NodeFilter.SHOW_ELEMENT,
                { acceptNode: (node) => (node.matches && node.matches('.editor-block') && rangeBetweenMarkers.intersectsNode(node)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT }
            );
            let blockNode;
            while(blockNode = walker.nextNode()) { blocksToNormalize.add(blockNode); }
            const startBlock = startNode.closest('.editor-block');
            const endBlock = endNode.closest('.editor-block');
            if (startBlock) blocksToNormalize.add(startBlock);
            if (endBlock) blocksToNormalize.add(endBlock);
        } catch (e) { console.error("Shortcut Cmd+Shift+H: Error creating range or finding blocks:", e); rangeBetweenMarkers = null; }
    }

    if (rangeBetweenMarkers) {
        try {
            if (actionToPerform === 'reset') {
                console.log("Shortcut Cmd+Shift+H: Resetting format manually...");
                const rangeForColorReset = rangeBetweenMarkers.cloneRange();
                const rangeForBgReset = rangeBetweenMarkers.cloneRange();
                processRangeNodesGeneric(rangeForColorReset, 'style', 'color', null);
                processRangeNodesGeneric(rangeForBgReset, 'style', 'backgroundColor', null);
                console.log("Shortcut Cmd+Shift+H: Manual style reset executed.");
                actionExecuted = true;
                lastShortcutAction = 'reset';
            } else if (actionToPerform === 'apply' && lastColor?.value && lastColor?.type) {
                let styleProperty = '';
                let styleValueToApply = lastColor.value;
                if (lastColor.type === 'text') { styleProperty = 'color'; }
                else if (lastColor.type === 'highlight') { styleProperty = 'backgroundColor'; }
                if (styleProperty) {
                    console.log(`Shortcut Cmd+Shift+H: Applying last used color -> Property: ${styleProperty}, Value: ${styleValueToApply}`);
                    const applyAffectedBlocks = applyStyleToRange(rangeBetweenMarkers, styleProperty, styleValueToApply);
                    if (applyAffectedBlocks.size > 0) {
                        actionExecuted = true;
                        lastShortcutAction = 'apply';
                    }
                }
            }
            if (actionExecuted) { debouncedSave(); }
            else { lastShortcutAction = null; lastActionRange = null; }
        } catch (error) {
            console.error("Shortcut Cmd+Shift+H: Error during style application/removal:", error);
            lastShortcutAction = null; lastActionRange = null;
        }
    } else {
        console.warn("Shortcut Cmd+Shift+H: Could not create range between markers.");
        lastShortcutAction = null; lastActionRange = null;
    }

    const finalBlocksToNormalize = new Set(blocksToNormalize);
    setTimeout(() => {
        const rafStartNode = document.getElementById(startMarkerId);
        const rafEndNode = document.getElementById(endMarkerId);
        let restoredRange = null;
        try {
            if (rafStartNode && rafEndNode && rafStartNode.parentNode && rafEndNode.parentNode) {
                restoredRange = document.createRange();
                const startFocusableParent = rafStartNode.parentElement?.closest('[contenteditable="true"]');
                if (startFocusableParent && document.activeElement !== startFocusableParent) {
                    startFocusableParent.focus({ preventScroll: true });
                }
                restoredRange.setStartAfter(rafStartNode);
                restoredRange.setEndBefore(rafEndNode);
                const currentSelection = window.getSelection();
                if (currentSelection) {
                    currentSelection.removeAllRanges();
                    currentSelection.addRange(restoredRange);
                    lastActionRange = restoredRange.cloneRange();
                    // Нормализация после восстановления выделения
                    if (finalBlocksToNormalize.size > 0) {
                        normalizeBlocks(finalBlocksToNormalize);
                    }
                }
            } else {
                console.warn("Shortcut Cmd+Shift+H setTimeout: Markers not found or detached. Cannot restore range/state.");
                lastActionRange = null; lastShortcutAction = null;
            }
        } catch (e) {
            console.error("Shortcut Cmd+Shift+H setTimeout: Error restoring selection:", e);
            lastActionRange = null; lastShortcutAction = null;
        }
        finally {
            document.getElementById(startMarkerId)?.remove();
            document.getElementById(endMarkerId)?.remove();
        }
    }, 0);
}

// --- Глобальные слушатели клавиатуры ---
export function setupGlobalKeyboardListeners() {
    document.addEventListener('keydown', (event) => {
        if (isMenuActive() && !editorArea?.contains(event.target)) { if (handleMenuKeyDown(event)) { return; } }
        const activeElement = document.activeElement; const isInputFocused = activeElement?.matches('input, textarea') || activeElement?.hasAttribute('contenteditable'); const isTitleFocused = activeElement === currentDocTitleElement; const isSearchFocused = activeElement === searchInput; const isEditorFocusedLoose = editorArea?.contains(activeElement); const isEditorContentFocused = isEditorFocusedLoose && activeElement?.closest('[contenteditable="true"]'); const isCmdOrCtrl = event.metaKey || event.ctrlKey;

        // Обработчик Enter для плейсхолдера
        const initialPlaceholderBlockCheck = editorArea?.querySelector('.editor-block[data-initial-placeholder="true"]');
        const initialPlaceholderBlock = initialPlaceholderBlockCheck;
        if (event.key === 'Enter' && initialPlaceholderBlock) {
            event.preventDefault();
            initialPlaceholderBlock.removeAttribute('data-initial-placeholder');
            const elementToFocus = getEditableContentElement(initialPlaceholderBlock) || getToggleTitleElement(initialPlaceholderBlock) || getCalloutPrimaryContentElement(initialPlaceholderBlock);
            if (elementToFocus) { requestAnimationFrame(() => { focusAtStart(elementToFocus); }); }
            else { console.warn('[Global Enter] Could not find editable element in the block to focus.'); }
            return;
        }

        // Обработчик Cmd/Ctrl + A
        if (isCmdOrCtrl && event.key.toLowerCase() === 'a') {
            if (isTitleFocused || isSearchFocused) { return; }
            event.preventDefault();
            const currentSelectAllState = getSelectAllState();
            if (isEditorContentFocused && currentSelectAllState < 1) {
                const currentFocusedContent = activeElement?.closest('.block-content[contenteditable="true"], .toggle-title[contenteditable="true"]');
                if (currentFocusedContent) { const range = document.createRange(); range.selectNodeContents(currentFocusedContent); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range); if (getSelectedBlockIds().size > 0) { clearBlockSelection(); } setSelectAllState(1); }
            } else {
                const allTopLevelIds = getBlockIdsInOrder();
                if (allTopLevelIds.length > 0) { clearSelectionStateData(); allTopLevelIds.forEach(id => addSelectedBlockId(id)); setSelectionAnchorId(allTopLevelIds[0]); setSelectionFocusId(allTopLevelIds[allTopLevelIds.length - 1]); updateSelectionVisuals(); window.getSelection()?.removeAllRanges(); if (isEditorContentFocused && document.activeElement?.blur) { document.activeElement.blur(); } setSelectAllState(2); }
                else { setSelectAllState(0); }
            }
            lastShortcutAction = null;
            lastActionRange = null;
            return;
        }

        // Обработка стандартных шорткатов форматирования (B, I, U, S, E)
        if (isCmdOrCtrl && !event.altKey && ['b', 'i', 'u', 's', 'e'].includes(event.key.toLowerCase())) {
             if (event.key.toLowerCase() === 's' && !event.shiftKey) { /* Cmd+S (save) */ }
             else if (isEditorFocusedLoose) {
                event.preventDefault();
                const key = event.key.toLowerCase();
                const isShift = event.shiftKey;
                const selection = window.getSelection();
                if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
                    let initialRange = null;
                    let startMarkerId = null;
                    let endMarkerId = null;
                    let affectedBlocks = new Set();
                    try {
                        initialRange = selection.getRangeAt(0).cloneRange();
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
                    } catch (e) {
                        console.error(`Shortcut '${key}': Error inserting markers:`, e);
                        document.getElementById(startMarkerId)?.remove();
                        document.getElementById(endMarkerId)?.remove();
                        return;
                    }
                    let rangeBetweenMarkers = null;
                    const startNode = document.getElementById(startMarkerId);
                    const endNode = document.getElementById(endMarkerId);
                    if (startNode && endNode) {
                        try {
                            rangeBetweenMarkers = document.createRange();
                            rangeBetweenMarkers.setStartAfter(startNode);
                            rangeBetweenMarkers.setEndBefore(endNode);
                        } catch (e) { console.error(`Shortcut '${key}': Error creating range between markers:`, e); }
                    }
                    if (rangeBetweenMarkers && !rangeBetweenMarkers.collapsed) {
                        if (key === 'b') affectedBlocks = toggleTagForRange(rangeBetweenMarkers, 'b');
                        else if (key === 'i') affectedBlocks = toggleTagForRange(rangeBetweenMarkers, 'i');
                        else if (key === 'u') affectedBlocks = toggleTagForRange(rangeBetweenMarkers, 'u');
                        else if (key === 's' && isShift) affectedBlocks = toggleTagForRange(rangeBetweenMarkers, 's');
                        else if (key === 'e') affectedBlocks = toggleClassForRange(rangeBetweenMarkers, 'inline-code');
                        if (affectedBlocks.size > 0) debouncedSave();
                    } else { console.warn(`Shortcut '${key}': Range between markers is invalid or collapsed.`); }
                    requestAnimationFrame(() => {
                        const rafStartNode = document.getElementById(startMarkerId);
                        const rafEndNode = document.getElementById(endMarkerId);
                        let newRange = null;
                        try {
                            if (rafStartNode && rafEndNode && rafStartNode.parentNode && rafEndNode.parentNode) {
                                const startFocusableParent = rafStartNode.parentElement?.closest('[contenteditable="true"]');
                                if (startFocusableParent && document.activeElement !== startFocusableParent) {
                                    startFocusableParent.focus({ preventScroll: true });
                                }
                                newRange = document.createRange();
                                newRange.setStartAfter(rafStartNode);
                                newRange.setEndBefore(rafEndNode);
                                const currentSelection = window.getSelection();
                                if (currentSelection) {
                                    currentSelection.removeAllRanges();
                                    currentSelection.addRange(newRange);
                                    if (affectedBlocks.size > 0) normalizeBlocks(affectedBlocks);
                                }
                            } else { console.warn(`Shortcut '${key}' RAF: Markers not found or detached.`); }
                        } catch (e) { console.error(`Shortcut '${key}' RAF: Error restoring selection:`, e); }
                        finally {
                            document.getElementById(startMarkerId)?.remove();
                            document.getElementById(endMarkerId)?.remove();
                        }
                    });
                }
                lastShortcutAction = null;
                lastActionRange = null;
                return;
            }
        }

        // Обработчик Cmd+K для ссылки
        if (isCmdOrCtrl && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
            if (isEditorFocusedLoose) {
                event.preventDefault();
                const selection = window.getSelection();
                if (selection && selection.rangeCount > 0) {
                    try {
                        const range = selection.getRangeAt(0).cloneRange();
                        // --- ИЗМЕНЕНИЕ: Передаем Range дважды ---
                        if (!range.collapsed) {
                            showLinkMenu(range, range); // Первый range - якорь, второй - данные
                        } else {
                            console.warn("Cmd+K: Selection is collapsed, cannot create link.");
                        }
                        // --- КОНЕЦ ИЗМЕНЕНИЯ ---
                    } catch (e) {
                        console.error("Error getting selection range for Cmd+K:", e);
                    }
                } else {
                    console.warn("Cmd+K: No selection found to create link.");
                }
                return;
            }
        }

        // Остальные глобальные обработчики
        if ((event.key === 'Backspace' || event.key === 'Delete') && getSelectedBlockIds().size > 0 && !isInputFocused) {
             event.preventDefault();
             const blocksToRemove = []; let firstBlockToRemove = null; let lastBlockToRemove = null; const orderedTopLevelIds = getBlockIdsInOrder(); const selectedIds = getSelectedBlockIds(); selectedIds.forEach(id => { const block = editorArea?.querySelector(`:scope > .editor-block[data-block-id="${id}"], .editor-block[data-block-id="${id}"]`); if (block) { blocksToRemove.push(block); const parentIsEditor = block.parentElement === editorArea; const parentIsWrapper = block.parentElement?.matches('.callout-content-wrapper, .toggle-children-wrapper'); if (parentIsEditor || parentIsWrapper) { const topLevelAncestor = parentIsEditor ? block : block.closest('.editor-area > .editor-block'); if (topLevelAncestor) { const index = orderedTopLevelIds.indexOf(topLevelAncestor.dataset.blockId); if (index !== -1) { if (firstBlockToRemove === null || index < orderedTopLevelIds.indexOf(firstBlockToRemove.dataset.blockId)) firstBlockToRemove = topLevelAncestor; if (lastBlockToRemove === null || index > orderedTopLevelIds.indexOf(lastBlockToRemove.dataset.blockId)) lastBlockToRemove = topLevelAncestor; } } } } }); if (blocksToRemove.length === 0) { clearBlockSelection(); return; } let focusNextBlock = null; let focusEnd = false; let blockAfterLastRemoved = null; if (lastBlockToRemove) { let nextSibling = lastBlockToRemove.nextElementSibling; while(nextSibling && !nextSibling.matches('.editor-block')) nextSibling = nextSibling.nextElementSibling; if (nextSibling?.matches('.editor-block')) { focusNextBlock = nextSibling; blockAfterLastRemoved = nextSibling; } } if (!focusNextBlock && firstBlockToRemove) { let prevSibling = firstBlockToRemove.previousElementSibling; while(prevSibling && !prevSibling.matches('.editor-block')) prevSibling = prevSibling.previousElementSibling; if (prevSibling?.matches('.editor-block')) { focusNextBlock = prevSibling; focusEnd = true; } } blocksToRemove.forEach(block => block.remove()); clearBlockSelection(); saveDocumentContent(); updateListAttributes(); updateAllQuoteConnections(); let requireFocusLogic = true; if (editorArea && editorArea.children.length === 0) { const newBlock = createBlockElement({ type: 'p', html: '' }); if(newBlock) { editorArea.appendChild(newBlock); newBlock.setAttribute('data-initial-placeholder', 'true'); updatePlaceholderVisibility(newBlock); saveDocumentContent(); requireFocusLogic = false; } focusNextBlock = null; } requestAnimationFrame(() => { checkAndSetInitialPlaceholderState(); if (requireFocusLogic && focusNextBlock) { const content = getEditableContentElement(focusNextBlock) || getToggleTitleElement(focusNextBlock); if (content) { focusEnd ? focusAtEnd(content) : focusAtStart(content); updatePlaceholderVisibility(focusNextBlock); } else { console.warn("Delete Selection: Could not find content to focus in", focusNextBlock); if (focusNextBlock.focus) focusNextBlock.focus?.(); } if (blockAfterLastRemoved && !focusEnd) { updateQuoteConnection(blockAfterLastRemoved); } else if (focusNextBlock && focusEnd) { updateQuoteConnectionsAround(focusNextBlock); } } else if (requireFocusLogic && editorArea && editorArea.children.length > 0){ console.warn("Delete Selection: Could not determine block to focus after removal."); } }); setLastCursorXPosition(null);
             lastShortcutAction = null;
             lastActionRange = null;
             return;
        }
        if (isCmdOrCtrl && event.key === '\\') { if (isEditorFocusedLoose) { event.preventDefault(); resetToParagraph(); return; } }
        if (isCmdOrCtrl && event.shiftKey && !isTitleFocused && !isSearchFocused && getSelectedBlockIds().size > 0 && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            const selectedIds = getSelectedBlockIds(); const onlyTopLevelSelected = [...selectedIds].every(id => editorArea?.querySelector(`:scope > .editor-block[data-block-id="${id}"]`)); if (onlyTopLevelSelected) { event.preventDefault(); moveSelectedBlocks(event.key === 'ArrowUp' ? -1 : 1); setSelectAllState(0); return; } else { console.warn("Cmd+Shift+Arrow: Cannot move non-top-level selected blocks."); const activeBlock = activeElement?.closest('.editor-block'); if (activeBlock) showTemporaryErrorHighlight(activeBlock); return; }
        }

        // Обработчик шортката цвета/сброса (Cmd/Ctrl + Shift + H)
        if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'h') {
            if (isEditorFocusedLoose || (window.getSelection() && !window.getSelection().isCollapsed)) {
                event.preventDefault();
                applyOrRemoveLastColor();
                return;
            }
        }

        // Сброс SelectAllState и состояния шортката цвета при обычном вводе
        if (!(isCmdOrCtrl || event.altKey || event.key === 'Shift' || event.key.startsWith('Arrow') || event.key === 'Tab' || event.key === 'Escape' )) {
            if (event.key.length === 1 || ['Backspace', 'Delete', 'Enter'].includes(event.key)) {
                setSelectAllState(0);
                lastShortcutAction = null;
                lastActionRange = null;
            }
        }

    });

    // Дополнительно сбрасываем состояние шортката при потере фокуса редактором
    editorArea?.addEventListener('blur', () => {
        const activeEl = document.activeElement;
        if (!activeEl || !activeEl.closest('.link-menu')) { // Учитываем и меню ссылки
            lastShortcutAction = null;
            lastActionRange = null;
        }
    }, true);

} // Конец setupGlobalKeyboardListeners