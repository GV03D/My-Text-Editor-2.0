// js/eventHandlers/dragAndDropHandler.js
// Логика для Drag and Drop блоков редактора
// --- ВЕРСИЯ С ИЗМЕНЕНИЯМИ ДЛЯ ЕДИНОГО ПОВЕДЕНИЯ ИНДИКАТОРА ---
// --- ВЕРСИЯ С ИЗМЕНЕНИЯМИ ДЛЯ СКРЫТИЯ ИНДИКАТОРА В НЕОПРЕДЕЛЕННЫХ ЗОНАХ КОНТЕЙНЕРА ---
// --- ВЕРСИЯ С ИЗМЕНЕНИЯМИ ДЛЯ ПОДСВЕТКИ СПИСКОВ (ФИНАЛЬНАЯ 3) ---
// --- ВЕРСИЯ С ИЗМЕНЕНИЯМИ ДЛЯ ШИРИНЫ НАПРАВЛЯЮЩЕЙ (ФИНАЛЬНАЯ 4) ---
// --- ДОБАВЛЕНО: Отложенный старт DND для разделения клика и перетаскивания ручки ---
// --- ИЗМЕНЕНО: Закомментирована проверка allowMove в handleDragEnd для диагностики ---
// --- ДОБАВЛЕНО: Детальное логирование в moveBlocksToTarget ---
// --- ИЗМЕНЕНО: Логика findDropTargetAndShowIndicator для сохранения последней цели ---
// --- ДОБАВЛЕНО: Детальное логирование в findDropTargetAndShowIndicator и handleDragEnd ---
// --- ИЗМЕНЕНО: Увеличены константы DROP_ZONE_HEIGHT_RATIO и MIN_DROP_ZONE_HEIGHT (в findTargetBetweenBlocks больше не используются) ---
// --- ИЗМЕНЕНО: Упрощена логика findTargetBetweenBlocks (использует top/bottom half) ---
// --- ИСПРАВЛЕНО: getFinalDropTarget теперь использует currentDropTarget независимо от видимости индикатора ---

import { editorArea, mainContent } from '../domElements.js';
import {
    getSelectedBlockIds, hasSelectedBlockId, addSelectedBlockId, clearSelectedBlockIds as clearSelectionStateData,
    setSelectionAnchorId, setSelectionFocusId
} from '../state.js';
import { getBlockIdsInOrder, updateSelectionVisuals } from '../selectionManager.js';
import { saveDocumentContent } from '../documentManager.js';
import { updateListAttributes } from '../listManager.js';
import { updateAllQuoteConnections, updateQuoteConnection, updateQuoteConnectionsAround } from '../quoteManager.js';
import { changeBlockType } from '../blockFormatter.js';
import { getBlockParentContainer, getEditableContentElement, getToggleChildrenWrapperElement } from '../blockUtils.js';
import { NESTED_BLOCK_INDENT_STEP, MAX_INDENT_LEVEL } from '../config.js';

// --- Состояние модуля ---
let isDragging = false; // Флаг, что идет активное перетаскивание
let potentialDrag = false; // Флаг, что был mousedown на ручке и возможно начнется перетаскивание
let dragStartThresholdMet = false; // Флаг, что порог движения мыши для старта DND пройден
let draggedBlockIds = new Set();
let sourceBlock = null;
let draggedElements = [];
let ghostElement = null;
let dropIndicator = null;
let startX = 0;
let startY = 0;
let currentDropTarget = {
    beforeBlock: null, indentLevel: 0, parentContainer: null, isInsideContainer: false,
    indicatorType: 1, contextBlockType: 'p', explicitIndent: false,
    zoneType: null, baseBlock: null, draggedBlockType: 'p'
};
let scrollInterval = null;
let lastClientY = 0;
let highlightedListSequence = { parent: null, children: [] };
const HIGHLIGHT_PARENT_CLASS = 'list-highlight-parent';
const HIGHLIGHT_CHILD_CLASS = 'list-highlight-child';
const LAST_HIGHLIGHT_CHILD_CLASS = 'last-highlight-child';
const HIGHLIGHT_OFFSET_VAR = '--highlight-offset-left';

// --- Константы ---
const GHOST_OPACITY = 0.6;
const INDICATOR_HEIGHT = 4;
// Увеличенные значения (в новой findTargetBetweenBlocks НЕ используются, но могут использоваться в findTargetInContainer)
const DROP_ZONE_HEIGHT_RATIO = 0.45;
const CONTAINER_INNER_DROP_ZONE_RATIO = 0.45;
const MIN_DROP_ZONE_HEIGHT = 15;
// ---
const CONTAINER_EDGE_THRESHOLD = 10;
const INDENT_DETECTION_THRESHOLD = NESTED_BLOCK_INDENT_STEP * 0.75;
const DECREASE_INDENT_THRESHOLD_MULTIPLIER = 1.5;
const SCROLL_ZONE_HEIGHT = 50;
const SCROLL_STEP = 15;
const LIST_ITEM_BASE_TEXT_PADDING_PX = 27;
const GHOST_OFFSET_X = 10;
const GHOST_OFFSET_Y = 10;
const LEVEL_1_INDICATOR_ADJUSTMENT_PX = -27;
const LEVEL_2_INDICATOR_ADJUSTMENT_PX = -26;
const DRAG_START_DISTANCE_THRESHOLD = 5; // Пиксели, на которые нужно сдвинуть мышь для старта DND

// --- Вспомогательные функции ---
function createDropIndicator() { if (!dropIndicator) { dropIndicator = document.createElement('div'); dropIndicator.className = 'drop-indicator'; dropIndicator.style.position = 'absolute'; dropIndicator.style.height = `var(--drop-indicator-height, ${INDICATOR_HEIGHT}px)`; dropIndicator.style.pointerEvents = 'none'; dropIndicator.style.zIndex = '100'; dropIndicator.style.display = 'none'; dropIndicator.style.setProperty('--indent-size-l1', '0px'); dropIndicator.style.setProperty('--indent-size-l2', '0px'); document.body.appendChild(dropIndicator); } }
function createGhostElement(blocksToDrag, event) { if (ghostElement) ghostElement.remove(); ghostElement = document.createElement('div'); ghostElement.style.position = 'absolute'; ghostElement.style.pointerEvents = 'none'; ghostElement.style.zIndex = '1000'; ghostElement.style.opacity = '0'; let maxWidth = 0; blocksToDrag.forEach(block => { if (block.offsetWidth > maxWidth) maxWidth = block.offsetWidth; }); ghostElement.style.width = `${maxWidth || 300}px`; blocksToDrag.forEach(block => { const clone = block.cloneNode(true); clone.classList.remove('block-selected', 'handle-visible', 'dragging'); clone.classList.add('dragging-clone'); clone.style.marginLeft = getComputedStyle(block).marginLeft; clone.style.marginBottom = getComputedStyle(block).marginBottom; clone.style.width = '100%'; ghostElement.appendChild(clone); }); document.body.appendChild(ghostElement); requestAnimationFrame(() => { if (!ghostElement) return; try { const initialGhostLeft = event.clientX + GHOST_OFFSET_X; const initialGhostTop = event.clientY + GHOST_OFFSET_Y; ghostElement.style.left = `${initialGhostLeft}px`; ghostElement.style.top = `${initialGhostTop}px`; ghostElement.style.opacity = String(GHOST_OPACITY); } catch(e) { console.error("[DND Ghost] Error setting initial ghost position:", e); ghostElement.style.left = `0px`; ghostElement.style.top = `${event.clientY - 30}px`; ghostElement.style.opacity = String(GHOST_OPACITY); } }); }
function updateDragGhost(clientX, clientY) { if (ghostElement) { ghostElement.style.left = `${clientX + GHOST_OFFSET_X}px`; ghostElement.style.top = `${clientY + GHOST_OFFSET_Y}px`; ghostElement.style.transform = ''; } }
function getBlocksToDrag(clickedBlock) { const clickedBlockId = clickedBlock.dataset.blockId; const currentSelectedIds = getSelectedBlockIds(); let blockElementsToDrag = []; const isNested = clickedBlock.parentElement !== editorArea; if (!isNested && currentSelectedIds.size > 0 && currentSelectedIds.has(clickedBlockId)) { draggedBlockIds = new Set(currentSelectedIds); const orderedIds = getBlockIdsInOrder(); orderedIds.forEach(id => { if (draggedBlockIds.has(id)) { const blockEl = editorArea?.querySelector(`:scope > .editor-block[data-block-id="${id}"]`); if (blockEl) { blockElementsToDrag.push(blockEl); } else { draggedBlockIds.delete(id); } } }); if (blockElementsToDrag.length === 0) { draggedBlockIds = new Set([clickedBlockId]); blockElementsToDrag = [clickedBlock]; clearSelectionStateData(); updateSelectionVisuals(); } else { setSelectionAnchorId(blockElementsToDrag[0]?.dataset.blockId || null); setSelectionFocusId(blockElementsToDrag[blockElementsToDrag.length - 1]?.dataset.blockId || null); } } else { draggedBlockIds = new Set([clickedBlockId]); blockElementsToDrag = [clickedBlock]; if (currentSelectedIds.size > 0) { clearSelectionStateData(); updateSelectionVisuals(); } } return blockElementsToDrag; }

// --- Логика Авто-скролла ---
function startScrolling(direction) { if (scrollInterval) clearInterval(scrollInterval); scrollInterval = setInterval(() => { if (!isDragging || !mainContent) { stopScrolling(); return; } const currentDraggedType = sourceBlock?.dataset?.blockType || 'p'; mainContent.scrollTop += direction * SCROLL_STEP; findDropTargetAndShowIndicator(startX, lastClientY, currentDraggedType); }, 30); }
function stopScrolling() { if (scrollInterval) { clearInterval(scrollInterval); scrollInterval = null; } }
function checkAndHandleScrolling(clientY) { if (!mainContent) return; const containerRect = mainContent.getBoundingClientRect(); if (clientY < containerRect.top + SCROLL_ZONE_HEIGHT) { if (mainContent.scrollTop > 0) startScrolling(-1); else stopScrolling(); } else if (clientY > containerRect.bottom - SCROLL_ZONE_HEIGHT) { if (mainContent.scrollHeight > mainContent.scrollTop + mainContent.clientHeight) startScrolling(1); else stopScrolling(); } else { stopScrolling(); } }

// --- Функции для подсветки списков ---
function findListSequenceNearBlock(block) { if (!block || !block.matches('.editor-block[data-block-type="li"], .editor-block[data-block-type="todo"]')) { return { parent: null, children: [] }; } const currentIndent = parseInt(block.dataset.indentLevel || '0', 10); if (currentIndent === 0) { return { parent: null, children: [] }; } const expectedParentIndent = currentIndent - 1; let parentBlock = null; let sibling = block.previousElementSibling; while (sibling) { if (sibling.matches('.editor-block')) { const siblingIndent = parseInt(sibling.dataset.indentLevel || '0', 10); if (siblingIndent === expectedParentIndent) { parentBlock = sibling; break; } else if (siblingIndent < expectedParentIndent) { break; } } sibling = sibling.previousElementSibling; } if (!parentBlock) { return { parent: null, children: [] }; } const children = []; sibling = parentBlock.nextElementSibling; while (sibling) { if (sibling.matches('.editor-block')) { const siblingIndent = parseInt(sibling.dataset.indentLevel || '0', 10); if (siblingIndent === currentIndent) { children.push(sibling); } else if (siblingIndent < currentIndent) { break; } } sibling = sibling.nextElementSibling; } return { parent: parentBlock, children: children }; }
function clearListHighlight() { if (highlightedListSequence.parent) { highlightedListSequence.parent.classList.remove(HIGHLIGHT_PARENT_CLASS, LAST_HIGHLIGHT_CHILD_CLASS); highlightedListSequence.parent.style.removeProperty(HIGHLIGHT_OFFSET_VAR); } highlightedListSequence.children.forEach(child => { child.classList.remove(HIGHLIGHT_CHILD_CLASS, LAST_HIGHLIGHT_CHILD_CLASS); child.style.removeProperty(HIGHLIGHT_OFFSET_VAR); }); highlightedListSequence = { parent: null, children: [] }; }
function applyListHighlight(sequence) { if (!sequence || !sequence.parent) return; clearListHighlight(); const parentBlock = sequence.parent; const children = sequence.children || []; const setHighlightOffset = (block, parentBlockForContext) => { const indentLevel = parseInt(block.dataset.indentLevel || '0', 10); let levelDeltaForOffset = 0; if (parentBlockForContext) { const parentIndentLevel = parseInt(parentBlockForContext.dataset.indentLevel || '0', 10); levelDeltaForOffset = indentLevel - parentIndentLevel; } else { levelDeltaForOffset = 0; } const offsetLeft = -1 * levelDeltaForOffset * NESTED_BLOCK_INDENT_STEP; block.style.setProperty(HIGHLIGHT_OFFSET_VAR, `${offsetLeft}px`); }; parentBlock.classList.add(HIGHLIGHT_PARENT_CLASS); setHighlightOffset(parentBlock, null); children.forEach(child => { child.classList.add(HIGHLIGHT_CHILD_CLASS); setHighlightOffset(child, parentBlock); }); const lastElement = children.length > 0 ? children[children.length - 1] : parentBlock; if (lastElement) { lastElement.classList.add(LAST_HIGHLIGHT_CHILD_CLASS); } highlightedListSequence = sequence; }


// --- Обработчики событий DND ---

/**
 * ИНИЦИИРУЕТ ВОЗМОЖНОЕ перетаскивание при mousedown на ручке.
 * Фактический старт DND отложен до handleDragMove.
 */
function handleDragStart(event) {
    // console.log("DND: handleDragStart triggered");
    const handle = event.target.closest('.drag-handle');
    if (!handle || event.button !== 0) {
        // console.log("DND: Not a left-click on a handle, ignoring.");
        return;
    }

    sourceBlock = handle.closest('.editor-block');
    if (!sourceBlock) {
        // console.log("DND: Could not find source block.");
        return;
    }

    event.preventDefault();
    potentialDrag = true;
    dragStartThresholdMet = false;
    isDragging = false;

    startX = event.clientX;
    startY = event.clientY;
    lastClientY = event.clientY;

    draggedElements = getBlocksToDrag(sourceBlock);
    if (draggedElements.length === 0) {
        potentialDrag = false;
        return;
    }

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);
    // console.log("DND: Potential drag initiated on block:", sourceBlock.dataset.blockId);
}


/**
 * Обрабатывает движение мыши ВО ВРЕМЯ потенциального или активного перетаскивания.
 */
function handleDragMove(event) {
    // console.log(`DND: handleDragMove - potentialDrag: ${potentialDrag}, isDragging: ${isDragging}`);

    if (!potentialDrag && !isDragging) {
        return;
    }

    event.preventDefault();
    lastClientY = event.clientY;

    if (potentialDrag && !dragStartThresholdMet) {
        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        // console.log(`DND: Move distance: ${distance.toFixed(1)}`);

        if (distance >= DRAG_START_DISTANCE_THRESHOLD) {
            // console.log("DND: Drag threshold met. Starting actual drag.");
            dragStartThresholdMet = true;
            isDragging = true;
            potentialDrag = false;

            createGhostElement(draggedElements, event);
            createDropIndicator();
            draggedElements.forEach(block => block.classList.add('dragging'));
            document.body.style.userSelect = 'none';
            document.body.classList.add('user-is-dragging');

            const currentDraggedType = sourceBlock?.dataset?.blockType || 'p';
            findDropTargetAndShowIndicator(event.clientX, event.clientY, currentDraggedType);
            checkAndHandleScrolling(event.clientY);
        }
        return;
    }

    if (isDragging) {
        updateDragGhost(event.clientX, event.clientY);
        const currentDraggedType = sourceBlock?.dataset?.blockType || 'p';
        findDropTargetAndShowIndicator(event.clientX, event.clientY, currentDraggedType);
        checkAndHandleScrolling(event.clientY);
    }
}


/**
 * Завершает перетаскивание (при mouseup). (С ЛОГИРОВАНИЕМ)
 */
function handleDragEnd(event) {
    console.log(`DND: handleDragEnd - potentialDrag: ${potentialDrag}, isDragging: ${isDragging}`);

    const wasDragging = isDragging;

    // Сброс флагов и состояния DND
    isDragging = false;
    potentialDrag = false;
    dragStartThresholdMet = false;
    stopScrolling();
    clearListHighlight();
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('mouseup', handleDragEnd);
    document.body.style.userSelect = '';
    document.body.classList.remove('user-is-dragging');
    if (ghostElement) { ghostElement.remove(); ghostElement = null; }
    if (dropIndicator) { dropIndicator.style.display = 'none'; } // Скрываем индикатор здесь
    draggedElements.forEach(block => block?.classList.remove('dragging'));
    // --- КОНЕЦ СБРОСА ---


    if (wasDragging) {
        console.log("DND: wasDragging is true. Getting drop target...");
        // ЛОГИРУЕМ СОСТОЯНИЕ ПЕРЕД ВЫЗОВОМ getFinalDropTarget
        console.log(`[handleDragEnd] State before getFinalDropTarget: dropIndicator display=${dropIndicator?.style.display}, currentDropTarget.parentContainer=`, currentDropTarget.parentContainer); // ЛОГ E1
        const dropTargetInfo = getFinalDropTarget(); // Использует ИСПРАВЛЕННУЮ функцию
        console.log("DND: dropTargetInfo from getFinalDropTarget:", dropTargetInfo ? JSON.parse(JSON.stringify(dropTargetInfo)) : null);

        let movedSuccessfully = false;
        let allowMove = true; // Переменная остается, но проверка закомментирована

        if (dropTargetInfo && dropTargetInfo.parentContainer) {
            console.log("DND: Valid drop target found. Checking allowMove...");

            /* // Блок проверки allowMove все еще закомментирован для диагностики
            if (draggedElements.length === 1) {
                // ... проверка ...
                if (...) {
                    allowMove = false;
                }
            }
            */

            if (allowMove) {
                console.log("DND: Move allowed. Calling moveBlocksToTarget...");
                movedSuccessfully = moveBlocksToTarget(dropTargetInfo, draggedBlockIds);
                console.log(`DND: moveBlocksToTarget returned: ${movedSuccessfully}`);
            } else {
                console.log("DND: Move not allowed.");
                movedSuccessfully = false;
            }
        } else {
             console.log("DND: No valid drop target found or parentContainer missing in handleDragEnd.");
             allowMove = false; // Считаем, что перемещение невозможно, если нет цели
        }

        if (movedSuccessfully) {
             console.log("DND: Move successful, saving and updating UI.");
             // Используем setTimeout 0, чтобы операции сохранения и обновления UI
             // произошли после завершения текущего потока обработки события
             setTimeout(() => {
                saveDocumentContent();
                updateListAttributes();
                updateAllQuoteConnections();
            }, 0);
        } else {
             console.log("DND: Move failed or was not attempted.");
        }
    } else {
        console.log("DND: mouseup detected, but drag threshold wasn't met or wasn't dragging.");
    }

    // Очистка состояния DND
    draggedBlockIds.clear();
    sourceBlock = null;
    draggedElements = [];
    currentDropTarget = { beforeBlock: null, indentLevel: 0, parentContainer: null, isInsideContainer: false, indicatorType: 1, contextBlockType: 'p', explicitIndent: false, zoneType: null, baseBlock: null, draggedBlockType: 'p' };
} // --- Конец handleDragEnd ---


// --- Функции поиска цели и обновления индикатора ---
function canIncreaseIndent(contextBlock) { if (!contextBlock) return false; const contextType = contextBlock.dataset.blockType || 'p'; return ['p', 'li', 'todo'].includes(contextType) && !contextBlock.hasAttribute('data-in-quote'); }
function getListContext(beforeBlock, parentContainer) { const blockToCheckBefore = beforeBlock ? beforeBlock.previousElementSibling?.closest('.editor-block') : parentContainer.lastElementChild?.closest('.editor-block'); const blockToCheckAfter = beforeBlock?.closest('.editor-block'); let context = { isList: false, listType: null, listLevel: -1, blockType: 'p' }; const checkBlock = (block) => { if (block && ['li', 'todo'].includes(block.dataset.blockType)) { return { isList: true, listType: block.dataset.listType || (block.dataset.blockType === 'li' ? 'ul' : null), listLevel: parseInt(block.dataset.indentLevel || '0', 10), blockType: block.dataset.blockType }; } return { isList: false, listType: null, listLevel: -1, blockType: block?.dataset.blockType || 'p' }; }; const contextBefore = checkBlock(blockToCheckBefore); const contextAfter = checkBlock(blockToCheckAfter); if (contextBefore.isList && contextAfter.isList && contextBefore.blockType === contextAfter.blockType && contextBefore.listLevel === contextAfter.listLevel && contextBefore.listType === contextAfter.listType) { return contextBefore; } else if (contextBefore.isList && (!contextAfter.isList || contextAfter.blockType !== contextBefore.blockType || contextAfter.listLevel !== contextBefore.listLevel || contextAfter.listType !== contextBefore.listType)) { return contextBefore; } else if ((!contextBefore.isList || contextBefore.blockType !== contextAfter.blockType || contextBefore.listLevel !== contextAfter.listLevel || contextBefore.listType !== contextAfter.listType) && contextAfter.isList) { return contextAfter; } return context; }

// --- НОВАЯ, УПРОЩЕННАЯ ФУНКЦИЯ findTargetBetweenBlocks ---
function findTargetBetweenBlocks(clientX, clientY, blocks, draggedBlockType, commonParent) {
    let bestTarget = null;
    let minVerticalDistance = Infinity; // Будем искать ближайший блок по вертикали

    console.log(`[findTargetBetweenBlocks - Simplified] Searching among ${blocks.length} blocks.`); // Новый лог

    blocks.forEach((block, index) => {
        const rect = block.getBoundingClientRect();
        if (!rect || rect.height === 0) {
             console.log(`[findTargetBetweenBlocks - Simplified] Skipping invisible block ${block.dataset.blockId}`); // Новый лог
             return; // Пропускаем невидимые блоки
        }

        // Проверяем, находится ли курсор по вертикали ВНУТРИ или ОЧЕНЬ БЛИЗКО к блоку
        const verticalTolerance = 15; // Допуск сверху/снизу (в пикселях)
        const isVerticallyClose = (clientY >= rect.top - verticalTolerance) && (clientY <= rect.bottom + verticalTolerance);

        if (!isVerticallyClose) {
            // console.log(`[findTargetBetweenBlocks - Simplified] Cursor Y=${clientY} is too far from block ${block.dataset.blockId} (Top: ${rect.top}, Bottom: ${rect.bottom})`); // Слишком много логов, можно раскомментировать при нужде
            return; // Пропускаем блоки, которые далеко по вертикали
        }

        // Находим вертикальное расстояние до центра блока
        const blockCenterY = rect.top + rect.height / 2;
        const verticalDistance = Math.abs(clientY - blockCenterY);

        // Если этот блок ближе по вертикали, чем предыдущий найденный
        if (verticalDistance < minVerticalDistance) {
            minVerticalDistance = verticalDistance; // Обновляем минимальное расстояние

            // Определяем, над верхней или нижней половиной находится курсор
            const middleY = rect.top + rect.height / 2;
            let targetBeforeBlock = null;
            let zoneType = null;

            if (clientY < middleY) {
                // Курсор в верхней половине -> цель ПЕРЕД этим блоком
                targetBeforeBlock = block;
                zoneType = 'above';
                console.log(`[findTargetBetweenBlocks - Simplified] Tentative target: Above block ${block.dataset.blockId}`); // Новый лог
            } else {
                // Курсор в нижней половине -> цель ПОСЛЕ этого блока (перед следующим)
                let nextEl = block.nextElementSibling;
                while(nextEl && !nextEl.matches('.editor-block')) {
                     nextEl = nextEl.nextElementSibling;
                }
                const isNextDragged = nextEl?.dataset?.blockId && draggedBlockIds.has(nextEl.dataset.blockId);

                // Можно сбросить только если следующий блок не перетаскивается
                if (!isNextDragged) {
                    targetBeforeBlock = nextEl; // null, если это последний блок
                    zoneType = 'below';
                     console.log(`[findTargetBetweenBlocks - Simplified] Tentative target: Below block ${block.dataset.blockId} (before ${nextEl?.dataset?.blockId || 'null'})`); // Новый лог
                } else {
                     console.log(`[findTargetBetweenBlocks - Simplified] Cannot target below block ${block.dataset.blockId} because next is dragged.`); // Новый лог
                     // Если нельзя сбросить снизу, пропускаем обновление bestTarget для этого блока
                     return;
                }
            }

            // Логика расчета отступа (остается как была)
            const blockIndentLevel = parseInt(block.dataset.indentLevel || '0', 10);
            let targetIndentLevel = blockIndentLevel;
            let explicitIndent = false;
            const indentContextBlock = (zoneType === 'above') ? block.previousElementSibling?.closest('.editor-block') : block;
            const indentContextLevel = parseInt(indentContextBlock?.dataset.indentLevel || '0', 10);
            const baseIndentMarginPx = blockIndentLevel * NESTED_BLOCK_INDENT_STEP;
            const indentIncreasePos = rect.left + baseIndentMarginPx + INDENT_DETECTION_THRESHOLD;
            const indentDecreasePos = rect.left + baseIndentMarginPx - (INDENT_DETECTION_THRESHOLD * DECREASE_INDENT_THRESHOLD_MULTIPLIER);
            let potentialTargetLevel = blockIndentLevel;
             if (blockIndentLevel > 0 && clientX < indentDecreasePos) { potentialTargetLevel = blockIndentLevel - 1; }
             else if (clientX > indentIncreasePos && canIncreaseIndent(indentContextBlock)) { const increasedLevel = Math.min(MAX_INDENT_LEVEL, indentContextLevel + 1); if (increasedLevel <= indentContextLevel + 1) { potentialTargetLevel = increasedLevel; } }
             if (potentialTargetLevel !== blockIndentLevel) {
                 explicitIndent = true;
                 targetIndentLevel = potentialTargetLevel;
                 // Простые проверки валидности отступа (можно будет усложнить при необходимости)
                 if (zoneType === 'above' && targetIndentLevel > blockIndentLevel) { const prevBlock = block.previousElementSibling?.closest('.editor-block'); const prevIndent = parseInt(prevBlock?.dataset.indentLevel || '0', 10); if (!prevBlock || targetIndentLevel > prevIndent + 1) { targetIndentLevel = blockIndentLevel; explicitIndent = false; } }
                 console.log(`[findTargetBetweenBlocks - Simplified] Indent calculated. explicit: ${explicitIndent}, level: ${targetIndentLevel}`); // Новый лог
             }
            // --- Конец расчета отступа ---

            // Обновляем лучшую найденную цель
            bestTarget = {
                beforeBlock: targetBeforeBlock, // Блок, ПЕРЕД которым вставлять (null = в конец)
                indentLevel: targetIndentLevel,
                parentContainer: commonParent,
                distance: verticalDistance, // Вертикальное расстояние для сравнения
                isInside: commonParent !== editorArea,
                explicitIndent: explicitIndent,
                contextBlockType: block.dataset.blockType || 'p',
                zoneType: zoneType, // 'above' или 'below' относительно baseBlock
                baseBlock: block,   // Блок, над которым курсор
                draggedBlockType: draggedBlockType
            };
             console.log(`[findTargetBetweenBlocks - Simplified] Updated bestTarget based on block ${block.dataset.blockId}`); // Новый лог
        } else {
             // console.log(`[findTargetBetweenBlocks - Simplified] Block ${block.dataset.blockId} is further away (${verticalDistance}) than current best (${minVerticalDistance}).`); // Слишком много логов
        }
    }); // Конец forEach

    console.log("[findTargetBetweenBlocks - Simplified] Finished loop. Final bestTarget:", bestTarget ? {...bestTarget} : null); // Новый лог
    return bestTarget;
} // --- Конец УПРОЩЕННОЙ findTargetBetweenBlocks ---


function findTargetInContainer(clientX, clientY, containerWrapper, draggedBlockType) { if (!containerWrapper) return null; const innerBlocks = Array.from(containerWrapper.querySelectorAll(':scope > .editor-block:not(.dragging-clone)')).filter(block => block.offsetParent !== null && !draggedBlockIds.has(block.dataset.blockId)); let target = findTargetBetweenBlocks(clientX, clientY, innerBlocks, draggedBlockType, containerWrapper); if (!target) { const wrapperRect = containerWrapper.getBoundingClientRect(); const wrapperStyle = getComputedStyle(containerWrapper); const topPaddingZone = (parseFloat(wrapperStyle.paddingTop) || 0) + MIN_DROP_ZONE_HEIGHT / 2 + 5; const bottomPaddingZone = (parseFloat(wrapperStyle.paddingBottom) || 0) + MIN_DROP_ZONE_HEIGHT / 2 + 5; const firstChildRect = innerBlocks.length > 0 ? innerBlocks[0].getBoundingClientRect() : null; const lastChildRect = innerBlocks.length > 0 ? innerBlocks[innerBlocks.length - 1].getBoundingClientRect() : null; const isInTopPaddingZone = clientY >= wrapperRect.top && clientY < wrapperRect.top + topPaddingZone; const isAboveFirstChild = !firstChildRect || clientY < firstChildRect.top; let isInsertionAtStart = isInTopPaddingZone && isAboveFirstChild; const isInBottomPaddingZone = clientY <= wrapperRect.bottom && clientY > wrapperRect.bottom - bottomPaddingZone; const isBelowLastChild = !lastChildRect || clientY > lastChildRect.bottom; let isInsertionAtEnd = isInBottomPaddingZone && isBelowLastChild; let baseBlockForContext = null; if (isInsertionAtStart && firstChildRect) { baseBlockForContext = innerBlocks[0]; } else if (isInsertionAtEnd && lastChildRect) { baseBlockForContext = innerBlocks[innerBlocks.length - 1]; } else if (innerBlocks.length > 0) { baseBlockForContext = innerBlocks.reduce((closest, child) => { const childRect = child.getBoundingClientRect(); const dist = Math.abs(clientY - (childRect.top + childRect.height / 2)); return dist < closest.dist ? { dist, block: child } : closest; }, { dist: Infinity, block: null }).block; } if (innerBlocks.length === 0 && clientY >= wrapperRect.top && clientY <= wrapperRect.bottom) { isInsertionAtStart = true; isInsertionAtEnd = false; } if (isInsertionAtStart || isInsertionAtEnd) { target = { beforeBlock: isInsertionAtStart ? (innerBlocks[0] || null) : null, indentLevel: 0, parentContainer: containerWrapper, distance: isInsertionAtStart ? (clientY - wrapperRect.top) : (wrapperRect.bottom - clientY), isInside: true, explicitIndent: false, contextBlockType: baseBlockForContext?.dataset.blockType || 'p', zoneType: isInsertionAtStart ? 'above' : 'below', baseBlock: baseBlockForContext, draggedBlockType: draggedBlockType }; } } return target; }

// Обновленная функция поиска цели и показа индикатора (С ЛОГИРОВАНИЕМ)
function findDropTargetAndShowIndicator(clientX, clientY, draggedBlockType) {
    console.log(`[findDropTarget] MouseMove at X: ${clientX}, Y: ${clientY}`); // ЛОГ M1
    let finalTarget = null;
    let sequenceToHighlight = { parent: null, children: [] };

    const targetElement = document.elementFromPoint(clientX, clientY);
    console.log(`[findDropTarget] Element at point:`, targetElement); // ЛОГ M2

    // 1. Проверка: Курсор ВНЕ основной области контента?
    if (!targetElement || !mainContent?.contains(targetElement)) {
        console.log(`[findDropTarget] Cursor outside mainContent. Resetting target.`); // ЛОГ M3
        if (dropIndicator) dropIndicator.style.display = 'none';
        clearListHighlight();
        // СБРАСЫВАЕМ цель только если курсор вне зоны
        currentDropTarget = { beforeBlock: null, indentLevel: 0, parentContainer: null, isInsideContainer: false, indicatorType: 1, contextBlockType: 'p', explicitIndent: false, zoneType: null, baseBlock: null, draggedBlockType: 'p' };
        return; // Выходим
    }

    // 2. Логика поиска цели
    console.log(`[findDropTarget] Searching for target...`); // ЛОГ M4
    const hoveredContainerBlock = targetElement.closest('.editor-block[data-block-type="callout"], .editor-block[data-block-type="toggle"]');
    if (hoveredContainerBlock && !draggedBlockIds.has(hoveredContainerBlock.dataset.blockId)) {
        console.log(`[findDropTarget] Hovering over container block ID: ${hoveredContainerBlock.dataset.blockId}`); // ЛОГ M5
        const containerRect = hoveredContainerBlock.getBoundingClientRect();
        const isNearTopEdge = clientY < containerRect.top + CONTAINER_EDGE_THRESHOLD;
        const isNearBottomEdge = clientY > containerRect.bottom - CONTAINER_EDGE_THRESHOLD;
        let considerOutside = isNearTopEdge || isNearBottomEdge;
        let containerWrapper = null;
        if (hoveredContainerBlock.dataset.blockType === 'callout') {
            containerWrapper = hoveredContainerBlock.querySelector(':scope > .callout-content-wrapper');
        } else {
            containerWrapper = getToggleChildrenWrapperElement(hoveredContainerBlock);
        }
        if (containerWrapper) {
            console.log(`[findDropTarget] Searching inside container wrapper:`, containerWrapper); // ЛОГ M6
            finalTarget = findTargetInContainer(clientX, clientY, containerWrapper, draggedBlockType);
             console.log(`[findDropTarget] Result from findTargetInContainer:`, finalTarget ? {...finalTarget} : null); // ЛОГ M7
        }
        if (!finalTarget) {
            if (!considerOutside) {
                 console.log(`[findDropTarget] Not inside container target & not near edge.`); // ЛОГ M8
                 finalTarget = null;
            } else {
                 console.log(`[findDropTarget] Near container edge or no inner target, searching outside...`); // ЛОГ M9
                 const outerParentContainer = getBlockParentContainer(hoveredContainerBlock);
                 if (outerParentContainer) {
                     const potentialOuterTarget = findTargetBetweenBlocks(clientX, clientY, [hoveredContainerBlock], draggedBlockType, outerParentContainer); // Используем новую функцию
                     console.log(`[findDropTarget] Result from findTargetBetweenBlocks (outside container):`, potentialOuterTarget ? {...potentialOuterTarget} : null); // ЛОГ M10
                     if (potentialOuterTarget) {
                         finalTarget = potentialOuterTarget;
                         finalTarget.isInside = false;
                         if (clientY < containerRect.top + containerRect.height / 2) { finalTarget.beforeBlock = hoveredContainerBlock; finalTarget.zoneType = 'above'; } else { let nextSibling = hoveredContainerBlock.nextElementSibling; while(nextSibling && !nextSibling.matches('.editor-block')) { nextSibling = nextSibling.nextElementSibling; } finalTarget.beforeBlock = nextSibling; finalTarget.zoneType = 'below'; }
                     }
                 } else {
                     console.log(`[findDropTarget] No outer parent container found.`); // ЛОГ M11
                 }
            }
        }
    } else {
         console.log(`[findDropTarget] Not hovering known container block. Searching general blocks...`); // ЛОГ M12
         const directHoveredBlock = targetElement.closest('.editor-block:not(.dragging-clone)');
         const parentContainer = getBlockParentContainer(directHoveredBlock || targetElement);
         console.log(`[findDropTarget] Calculated parentContainer:`, parentContainer); // ЛОГ M13
         if (parentContainer) {
            const isInsideHandledContainer = parentContainer.matches('.callout-content-wrapper, .toggle-children-wrapper');
            if (!isInsideHandledContainer) {
                 console.log(`[findDropTarget] Searching blocks in parentContainer:`, parentContainer); // ЛОГ M14
                 const blocksInScope = Array.from(parentContainer.querySelectorAll(':scope > .editor-block:not(.dragging-clone)')).filter(block => block.offsetParent !== null && !draggedBlockIds.has(block.dataset.blockId));
                 finalTarget = findTargetBetweenBlocks(clientX, clientY, blocksInScope, draggedBlockType, parentContainer); // Используем новую функцию
                 console.log(`[findDropTarget] Result from findTargetBetweenBlocks (general):`, finalTarget ? {...finalTarget} : null); // ЛОГ M15
            } else {
                 console.log(`[findDropTarget] Parent is handled container, skipping general search.`); // ЛОГ M16
            }
        }
    }

    // 3. Обновление индикатора и СОСТОЯНИЯ ЦЕЛИ
    if (finalTarget) {
        console.log(`[findDropTarget] Final target FOUND:`, finalTarget); // ЛОГ M17
        let absoluteIndentLevel = finalTarget.indentLevel;
        if (finalTarget.isInside && finalTarget.parentContainer) { const parentContainerBlock = finalTarget.parentContainer.closest('.editor-block[data-block-type="callout"], .editor-block[data-block-type="toggle"]'); if (parentContainerBlock) { const parentIndent = parseInt(parentContainerBlock.dataset.indentLevel || '0', 10); absoluteIndentLevel = parentIndent + finalTarget.indentLevel; } }
        absoluteIndentLevel = Math.min(absoluteIndentLevel, MAX_INDENT_LEVEL);
        finalTarget.indentLevel = absoluteIndentLevel;
        let finalIndicatorType = 1;
        const isListContext = (finalTarget.contextBlockType === 'li' || finalTarget.contextBlockType === 'todo');
        if (isListContext) { if (absoluteIndentLevel === 2) finalIndicatorType = 4; else if (absoluteIndentLevel === 1) finalIndicatorType = 3; }
        finalTarget.indicatorType = finalIndicatorType;

        updateDropIndicator(finalTarget); // Показываем/обновляем индикатор
        currentDropTarget = { ...finalTarget }; // СОХРАНЯЕМ найденную цель
        console.log(`[findDropTarget] currentDropTarget updated:`, JSON.parse(JSON.stringify(currentDropTarget))); // ЛОГ M18
        sequenceToHighlight = findListSequenceNearBlock(finalTarget.baseBlock);
    } else {
        console.log(`[findDropTarget] Final target NOT FOUND.`); // ЛОГ M19
        // Скрываем индикатор, НЕ СБРАСЫВАЕМ currentDropTarget
        if (dropIndicator) dropIndicator.style.display = 'none';
        sequenceToHighlight = { parent: null, children: [] };
        console.log("[findDropTarget] Hiding indicator, keeping last target state. Current state:", JSON.parse(JSON.stringify(currentDropTarget))); // ЛОГ M20
    }

    // 4. Обновление подсветки списка
    const isSameParent = sequenceToHighlight.parent === highlightedListSequence.parent;
    const currentChildIds = highlightedListSequence.children.map(c => c.dataset.blockId);
    const newChildIds = sequenceToHighlight.children.map(c => c.dataset.blockId);
    const isSameChildren = currentChildIds.length === newChildIds.length && currentChildIds.every((id, index) => id === newChildIds[index]);
    if (!isSameParent || !isSameChildren) { if (sequenceToHighlight.parent) { applyListHighlight(sequenceToHighlight); } else { clearListHighlight(); } }

} // --- Конец findDropTargetAndShowIndicator ---


function updateDropIndicator(targetInfo) { const { beforeBlock, indentLevel, parentContainer, indicatorType, contextBlockType } = targetInfo; if (!dropIndicator || !parentContainer) { if (dropIndicator) dropIndicator.style.display = 'none'; return; } const containerRect = parentContainer.getBoundingClientRect(); let targetTop = 0; let targetLeft = 0; let targetWidth = 0; const containerStyle = getComputedStyle(parentContainer); const containerPaddingLeft = parseFloat(containerStyle.paddingLeft) || 0; const containerPaddingRight = parseFloat(containerStyle.paddingRight) || 0; targetLeft = containerRect.left + window.scrollX + containerPaddingLeft; targetWidth = parentContainer.clientWidth - containerPaddingLeft - containerPaddingRight; let indentSizePxL1 = 0; let indentSizePxL2 = 0; const isListTarget = (contextBlockType === 'li' || contextBlockType === 'todo'); const calculateIndentPx = (level) => { if (level <= 0) return 0; let size = 0; if (isListTarget) { const effectiveLevel = Math.min(level, 2); const indentMarginPx = effectiveLevel * NESTED_BLOCK_INDENT_STEP; size = indentMarginPx + LIST_ITEM_BASE_TEXT_PADDING_PX; if (effectiveLevel === 1) size += LEVEL_1_INDICATOR_ADJUSTMENT_PX; else if (effectiveLevel === 2) size += LEVEL_2_INDICATOR_ADJUSTMENT_PX; } else { size = level * NESTED_BLOCK_INDENT_STEP; } return Math.max(0, size); }; if (indicatorType === 3 || indicatorType === 4) { indentSizePxL1 = calculateIndentPx(1); } if (indicatorType === 4) { indentSizePxL2 = calculateIndentPx(2); if (indentSizePxL1 > indentSizePxL2) { indentSizePxL1 = indentSizePxL2; } } dropIndicator.style.setProperty('--indent-size-l1', `${indentSizePxL1}px`); dropIndicator.style.setProperty('--indent-size-l2', `${indentSizePxL2}px`); const indicatorColorValue = getComputedStyle(document.documentElement).getPropertyValue('--drop-indicator-color').trim() || '#8FCDFF'; let rgbString = '143, 205, 255'; if (indicatorColorValue.startsWith('#')) { const hex = indicatorColorValue.substring(1); if (hex.length === 3) { const r = parseInt(hex[0] + hex[0], 16); const g = parseInt(hex[1] + hex[1], 16); const b = parseInt(hex[2] + hex[2], 16); rgbString = `${r}, ${g}, ${b}`; } else if (hex.length === 6) { const r = parseInt(hex.substring(0, 2), 16); const g = parseInt(hex.substring(2, 4), 16); const b = parseInt(hex.substring(4, 6), 16); rgbString = `${r}, ${g}, ${b}`; } } else if (indicatorColorValue.startsWith('rgb(')) { rgbString = indicatorColorValue.substring(4, indicatorColorValue.length - 1).split(',').map(s => s.trim()).join(', '); } dropIndicator.style.setProperty('--drop-indicator-color-rgb', rgbString); dropIndicator.style.left = `${targetLeft}px`; dropIndicator.style.width = `${targetWidth}px`; dropIndicator.classList.remove('indicator-level-0', 'indicator-fade', 'indicator-level-2-fade'); if (indicatorType === 1) { dropIndicator.classList.add('indicator-level-0'); } else if (indicatorType === 3) { dropIndicator.classList.add('indicator-fade'); } else if (indicatorType === 4) { dropIndicator.classList.add('indicator-level-2-fade'); } else { dropIndicator.classList.add('indicator-level-0'); } if (beforeBlock) { const beforeRect = beforeBlock.getBoundingClientRect(); targetTop = beforeRect.top + window.scrollY - (INDICATOR_HEIGHT / 2); } else { const lastBlock = parentContainer.lastElementChild?.matches('.editor-block') ? parentContainer.lastElementChild : null; if (lastBlock) { const lastRect = lastBlock.getBoundingClientRect(); targetTop = lastRect.bottom + window.scrollY + (INDICATOR_HEIGHT / 4); } else { const parentPaddingTop = parseFloat(containerStyle.paddingTop) || 0; targetTop = containerRect.top + window.scrollY + parentPaddingTop + 1; } } dropIndicator.style.top = `${targetTop}px`; dropIndicator.style.display = 'block'; }

// --- ИСПРАВЛЕННАЯ ФУНКЦИЯ ---
function getFinalDropTarget() {
    // Старая проверка:
    // if (dropIndicator && dropIndicator.style.display !== 'none' && currentDropTarget.parentContainer) {
    // Новая проверка: Возвращаем последнюю валидную цель, если она была найдена,
    // независимо от текущей видимости индикатора.
    if (currentDropTarget.parentContainer) {
        console.log("[getFinalDropTarget - Revised] Returning last valid target based on parentContainer:", JSON.parse(JSON.stringify(currentDropTarget))); // Лог для отладки
        return { ...currentDropTarget }; // Возвращаем копию сохраненной цели
    }
    // Если валидная цель не была найдена ранее (parentContainer is null)
    console.log("[getFinalDropTarget - Revised] No valid parentContainer in currentDropTarget. Returning null."); // Лог для отладки
    return null;
}
// --- КОНЕЦ ИСПРАВЛЕННОЙ ФУНКЦИИ ---


// --- Функция перемещения блоков (С ЛОГИРОВАНИЕМ) ---
function moveBlocksToTarget(dropTargetInfo, currentDraggedBlockIds) {
    console.log('[moveBlocksToTarget] Initiated. Target Info:', JSON.parse(JSON.stringify(dropTargetInfo)), 'Dragged IDs:', Array.from(currentDraggedBlockIds)); // ЛОГ 1

    const { beforeBlock, indentLevel, parentContainer, isInsideContainer } = dropTargetInfo;

    if (!draggedElements || draggedElements.length === 0) {
        console.warn('[moveBlocksToTarget] No valid draggedElements found.'); // ЛОГ 2
        return false;
    }
    if (!parentContainer || !document.body.contains(parentContainer)) {
         console.error('[moveBlocksToTarget] Invalid or detached parentContainer:', parentContainer); // ЛОГ 3
         return false;
    }
     console.log('[moveBlocksToTarget] Valid parentContainer:', parentContainer); // ЛОГ 4

    // --- Определение контекста списка (для форматирования) ---
    let targetListType = null;
    let targetBlockTypeContext = 'p';
    let isListContext = false;
    const blockBeforeDrop = beforeBlock ? beforeBlock.previousElementSibling?.closest('.editor-block') : parentContainer.lastElementChild?.closest('.editor-block');
    const blockAfterDrop = beforeBlock?.closest('.editor-block');
    const contextBefore = { isList: blockBeforeDrop && ['li', 'todo'].includes(blockBeforeDrop.dataset.blockType), type: blockBeforeDrop?.dataset.blockType, listType: blockBeforeDrop?.dataset.listType, indent: parseInt(blockBeforeDrop?.dataset.indentLevel || '0', 10) };
    const contextAfter = { isList: blockAfterDrop && ['li', 'todo'].includes(blockAfterDrop.dataset.blockType), type: blockAfterDrop?.dataset.blockType, listType: blockAfterDrop?.dataset.listType, indent: parseInt(blockAfterDrop?.dataset.indentLevel || '0', 10) };
    if (indentLevel > 0) { if (contextBefore.isList && (indentLevel === contextBefore.indent || indentLevel === contextBefore.indent + 1)) { isListContext = true; targetBlockTypeContext = contextBefore.type; targetListType = contextBefore.listType; } else if (contextAfter.isList && indentLevel === contextAfter.indent) { isListContext = true; targetBlockTypeContext = contextAfter.type; targetListType = contextAfter.listType; } }
    // --- Конец определения контекста ---


    const fragment = document.createDocumentFragment();
    const blocksToReformat = [];

    console.log('[moveBlocksToTarget] Preparing fragment...'); // ЛОГ 5
    draggedElements.forEach((block, index) => {
        const blockId = block?.dataset?.blockId;
        console.log(`[moveBlocksToTarget] Processing dragged block ${index}, ID: ${blockId}`); // ЛОГ 6
        if (!block || !document.contains(block)) {
             console.warn(`[moveBlocksToTarget] Skipped block ${blockId} because it's not in the document.`); // ЛОГ 7
             return;
        }
        const originalType = block.dataset.blockType || 'p';
        const originalListType = block.dataset.listType || null;
        let finalIndentLevel = indentLevel;
        let needsReformat = false;
        let newType = originalType;
        let newListType = originalListType;

        // Устанавливаем новый отступ
        block.setAttribute('data-indent-level', String(finalIndentLevel));
        if (finalIndentLevel === 0 && !['li', 'todo'].includes(originalType)) {
            block.removeAttribute('data-indent-level');
        } else if (finalIndentLevel > 0 && !block.hasAttribute('data-indent-level')) {
            // This case might not be needed if attribute is always set, but safe to keep
            block.setAttribute('data-indent-level', String(finalIndentLevel));
        }

        // Проверяем необходимость реформатирования
        if (isListContext) {
            if (!['li', 'todo'].includes(originalType)) {
                needsReformat = true; newType = targetBlockTypeContext; newListType = targetListType;
            } else if (originalType !== targetBlockTypeContext || originalListType !== targetListType) {
                needsReformat = true; newType = targetBlockTypeContext; newListType = targetListType;
            }
        } else {
            if (['li', 'todo'].includes(originalType)) {
                needsReformat = true; newType = 'p'; newListType = null;
            }
        }
        // Сброс отступа для неподдерживаемых типов вне контейнеров
        if (['h1', 'h2', 'h3', 'quote', 'callout', 'toggle'].includes(newType) && !isInsideContainer) {
            finalIndentLevel = 0;
            block.removeAttribute('data-indent-level');
        }

        if (needsReformat) {
             console.log(`[moveBlocksToTarget] Block ${blockId} marked for reformat to type: ${newType}, list: ${newListType}, indent: ${finalIndentLevel}`); // ЛОГ 8
             const contentElement = getEditableContentElement(block);
             blocksToReformat.push({ id: blockId, newType: newType, newListType: newListType, finalIndentLevel: finalIndentLevel, originalHtml: contentElement ? contentElement.innerHTML : '' });
        }

        // Убираем атрибут цитаты, если блок переносится из нее
        if (block.hasAttribute('data-in-quote')) {
             console.log(`[moveBlocksToTarget] Removing data-in-quote from block ${blockId}`); // ЛОГ 9
             block.removeAttribute('data-in-quote');
        }

        try {
             fragment.appendChild(block); // Перемещаем блок во фрагмент (удаляет из DOM)
             console.log(`[moveBlocksToTarget] Appended block ${blockId} to fragment.`); // ЛОГ 10
        } catch (appendError) {
             console.error(`[moveBlocksToTarget] Error appending block ${blockId} to fragment:`, appendError); // ЛОГ 11
        }
    });

    if (fragment.childNodes.length === 0) {
        console.warn('[moveBlocksToTarget] Fragment is empty, nothing to move.'); // ЛОГ 12
        return false;
    }
    console.log('[moveBlocksToTarget] Fragment prepared with', fragment.childNodes.length, 'nodes.'); // ЛОГ 13

    try {
        // --- Расчет точки вставки (referenceNode) ---
        let referenceNode = null;
        const intendedBeforeBlock = dropTargetInfo.beforeBlock; // Узел, ПЕРЕД которым хотим вставить
         console.log('[moveBlocksToTarget] Calculating referenceNode. Intended beforeBlock:', intendedBeforeBlock); // ЛОГ 14

        if (intendedBeforeBlock) {
            const intendedBlockId = intendedBeforeBlock.dataset?.blockId;
             console.log(`[moveBlocksToTarget] intendedBeforeBlock ID: ${intendedBlockId}`); // ЛОГ 15

            // Если узел, перед которым хотели вставить, сам является перетаскиваемым
            if (intendedBlockId && currentDraggedBlockIds.has(intendedBlockId)) {
                 console.log('[moveBlocksToTarget] intendedBeforeBlock is one of the dragged blocks. Finding next non-dragged sibling...'); // ЛОГ 16
                 let nextSibling = intendedBeforeBlock.nextElementSibling;
                 // Идем вперед, пока не найдем НЕперетаскиваемый блок или конец списка
                 while (nextSibling && nextSibling.matches('.editor-block') && currentDraggedBlockIds.has(nextSibling.dataset?.blockId)) {
                     console.log(`[moveBlocksToTarget] Skipping dragged block ID: ${nextSibling.dataset?.blockId}`); // ЛОГ 17
                     nextSibling = nextSibling.nextElementSibling;
                 }
                 referenceNode = nextSibling; // Это может быть null, если вставляем в самый конец
                 console.log('[moveBlocksToTarget] Found next non-dragged sibling (or null):', referenceNode); // ЛОГ 18
            }
            // Если узел, перед которым вставляем, существует, не перетаскивается И находится в нужном контейнере
            else if (intendedBeforeBlock.parentElement === parentContainer) {
                // Дополнительная проверка: убедимся, что этот узел все еще в DOM
                if (document.body.contains(intendedBeforeBlock)) {
                     referenceNode = intendedBeforeBlock;
                     console.log('[moveBlocksToTarget] Using intendedBeforeBlock as referenceNode:', referenceNode); // ЛОГ 19
                } else {
                     console.warn('[moveBlocksToTarget] intendedBeforeBlock is no longer in DOM. Inserting at the end.'); // ЛОГ 20
                     referenceNode = null; // Безопасный fallback - вставить в конец
                }
            }
            // Если узел есть, но не в том контейнере (странная ситуация)
            else {
                 console.warn('[moveBlocksToTarget] intendedBeforeBlock is not in the target parentContainer. Inserting at the end.'); // ЛОГ 21
                 referenceNode = null; // Вставить в конец
            }
        }
        // Если intendedBeforeBlock изначально не был указан (цель - конец контейнера)
        else {
            console.log('[moveBlocksToTarget] No intendedBeforeBlock, inserting at the end (referenceNode = null).'); // ЛОГ 22
            referenceNode = null;
        }
        // --- Конец расчета точки вставки ---

        console.log('[moveBlocksToTarget] Attempting insertion before referenceNode:', referenceNode, 'into parentContainer:', parentContainer); // ЛОГ 23
        parentContainer.insertBefore(fragment, referenceNode); // <--- САМА ВСТАВКА
        console.log('[moveBlocksToTarget] Insertion successful.'); // ЛОГ 24

        // --- Реформатирование блоков ПОСЛЕ вставки ---
        console.log('[moveBlocksToTarget] Starting reformatting...'); // ЛОГ 25
        blocksToReformat.forEach(reformatInfo => {
            // Ищем блок в DOM по ID ПОСЛЕ вставки (лучше искать по всему документу)
            const blockInDom = document.querySelector(`.editor-block[data-block-id="${reformatInfo.id}"]`);
            console.log(`[moveBlocksToTarget] Reformatting block ID ${reformatInfo.id}. Found in DOM:`, blockInDom); // ЛОГ 26
            if (blockInDom) {
                 console.log(`[moveBlocksToTarget] Calling changeBlockType for ID ${reformatInfo.id} with data:`, reformatInfo); // ЛОГ 27
                 changeBlockType(blockInDom, reformatInfo.newType, reformatInfo.newListType, { indentLevel: reformatInfo.finalIndentLevel, html: reformatInfo.originalHtml });
            } else {
                console.error(`[moveBlocksToTarget] [Reformat Error] Could not find block ${reformatInfo.id} in DOM after moving.`); // ЛОГ 28
            }
        });
        console.log('[moveBlocksToTarget] Reformatting finished.'); // ЛОГ 29

        return true; // Успех
    } catch (error) {
        console.error("[moveBlocksToTarget] [Insertion/Reformat Error] Error during DOM manipulation:", error); // ЛОГ 30
        // Попытка восстановления может быть сложной. Пока просто логируем и возвращаем false.
        return false; // Неудача
    }
} // --- Конец moveBlocksToTarget ---


// --- Инициализация ---
export function initializeDragAndDrop() {
    if (!editorArea) {
        console.error("[DND Init] Cannot initialize Drag and Drop: editorArea not found.");
        return;
    }
    // Слушатель mousedown теперь только на editorArea (делегирование для ручки)
    editorArea.addEventListener('mousedown', handleDragStart, true);
    console.log("[DND Init] Drag and Drop initialized (with delayed start).");
}

// --- Экспорт флага перетаскивания ---
export function getIsDragging() {
     return isDragging;
}