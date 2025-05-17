// js/utils.js
// Общие утилитарные функции
// --- ВЕРСИЯ 32: Добавлена централизованная система уведомлений ---

import { editorArea, mainContent } from './domElements.js'; // mainContent нужен для ensureNotificationDOM

// --- Состояние модуля для уведомлений ---
let notificationElement = null;
let notificationTimeoutId = null;
const NOTIFICATION_DURATION = 3000; // мс

// +++ ЛОКАЛЬНАЯ ФУНКЦИЯ normalizeColor +++
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
    try { computedColor = window.getComputedStyle(temp).color; } catch(e) { console.error("Error getting computed style for color normalization:", e); }
    document.body.removeChild(temp);
    if (!computedColor || computedColor === 'rgba(0, 0, 0, 0)') {
        if (lowerColor === 'transparent' || (lowerColor.startsWith('rgba(') && lowerColor.endsWith(', 0)'))) return 'transparent';
        return null;
    }
    return computedColor;
}
// +++ КОНЕЦ ЛОКАЛЬНОЙ ФУНКЦИИ +++

/**
 * Создает и возвращает новую версию переданной функции,
 * которая откладывает свой вызов до тех пор, пока не пройдет `wait`
 * миллисекунд с момента последнего вызова.
 * @param {Function} func Функция для debounce.
 * @param {number} wait Время ожидания в миллисекундах.
 * @returns {Function} Debounced-версия функции.
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Устанавливает фокус в начало редактируемого элемента.
 * @param {Element | null} element Элемент (contenteditable).
 */
export function focusAtStart(element) {
    if (!element || !element.hasAttribute('contenteditable')) {
         return;
    }
    element.focus({ preventScroll: true });
    try {
        const selection = window.getSelection();
        const range = document.createRange();
        let firstContentNode = null;
        for (let i = 0; i < element.childNodes.length; i++) {
            const node = element.childNodes[i];
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0) {
                firstContentNode = node;
                break;
            } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR' && node.textContent.trim().length > 0) {
                 range.setStart(node, 0);
                 range.collapse(true);
                 selection.removeAllRanges();
                 selection.addRange(range);
                 return;
            }
        }
        if (firstContentNode) {
            range.setStart(firstContentNode, 0);
        } else {
            range.setStart(element, 0);
        }
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch (e) {
        console.warn("[Utils focusAtStart] error:", e);
        element.focus();
    }
}


/**
 * Устанавливает фокус в конец редактируемого элемента.
 * @param {Element | null} element Элемент (contenteditable).
 */
export function focusAtEnd(element) {
    if (!element || !element.hasAttribute('contenteditable')) return;
    element.focus({ preventScroll: true });
    try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    } catch (e) {
        console.warn("[Utils focusAtEnd] error:", e);
        element.focus();
    }
}

/**
 * Устанавливает фокус в указанную позицию (смещение) внутри редактируемого элемента.
 * @param {Element | null} element Элемент (contenteditable).
 * @param {number} offset Смещение (количество символов от начала).
 */
export function focusAt(element, offset) {
    if (!element || !element.hasAttribute('contenteditable') || offset < 0) {
        if (element) focusAtEnd(element);
        return;
    }
    element.focus({ preventScroll: true });
    try {
        const selection = window.getSelection();
        const range = document.createRange();
        let charCount = 0;
        let nodeFound = false;
        function findNodeRecursive(node) {
            if (nodeFound) return;
            if (node.nodeType === Node.TEXT_NODE) {
                const nextCharCount = charCount + node.length;
                if (offset >= charCount && offset <= nextCharCount) {
                    range.setStart(node, offset - charCount);
                    range.collapse(true);
                    nodeFound = true;
                } else {
                    charCount = nextCharCount;
                }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.tagName === 'BR') {
                    if (offset === charCount) {
                         range.setStartBefore(node);
                         range.collapse(true);
                         nodeFound = true;
                         return;
                    }
                    charCount++;
                     if (offset === charCount) {
                         range.setStartAfter(node);
                         range.collapse(true);
                         nodeFound = true;
                     }
                } else {
                    for (let i = 0; i < node.childNodes.length && !nodeFound; i++) {
                        findNodeRecursive(node.childNodes[i]);
                    }
                }
            }
        }
        findNodeRecursive(element);
        if (!nodeFound) {
            range.selectNodeContents(element);
            range.collapse(false);
        }
        selection.removeAllRanges();
        selection.addRange(range);
    } catch (err) {
        console.error("[Utils focusAt] Error setting focus offset:", err);
        focusAtEnd(element);
    }
}


/**
 * Возвращает текущий объект Range выделения.
 * @returns {Range | null}
 */
export function getCursorPosition() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        try {
            return selection.getRangeAt(0).cloneRange();
        } catch (e) {
             console.warn("[Utils getCursorPosition] Could not clone range", e);
             return selection.getRangeAt(0);
        }
    }
    return null;
}

/**
 * Получает X-координату клиентской области для текущего курсора (или начала выделения).
 * @param {Range | null} range - Объект Range, для которого нужно получить координату. Если null, используется текущее выделение.
 * @returns {number | null} ClientX координата или null.
 */
export function getCursorClientX(range = null) {
    const currentRange = range || getCursorPosition();
    if (!currentRange) return null;
    let rect;
    try {
        if (currentRange.collapsed) {
            const rects = currentRange.getClientRects();
            rect = rects.length > 0 ? rects[0] : null;
        } else {
            rect = currentRange.getBoundingClientRect();
        }
    } catch(e) {
        console.warn("[Utils getCursorClientX] Error getting client rects", e);
        return null;
    }
    return rect ? rect.left : null;
}


/**
 * Пытается найти смещение (offset) внутри элемента, соответствующее заданным координатам X/Y.
 * @param {Element} targetElement - Элемент, внутри которого ищется смещение.
 * @param {number} clientX - X-координата.
 * @param {number} targetY - Y-координата.
 * @returns {number | null} Найденное смещение или null.
 */
export function findOffsetForClientX(targetElement, clientX, targetY) {
    if (!targetElement || clientX === null || targetY === null) {
        return null;
    }
    try {
        if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(clientX, targetY);
            if (pos && targetElement.contains(pos.offsetNode)) {
                let offset = 0;
                let found = false;
                function traverse(node) {
                    if (found) return;
                    if (node === pos.offsetNode) {
                        offset += pos.offset;
                        found = true;
                        return;
                    }
                    if (node.nodeType === Node.TEXT_NODE) {
                        offset += node.length;
                    } else if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.tagName === 'BR') {
                            offset++;
                        } else {
                            for (let i = 0; i < node.childNodes.length; i++) {
                                traverse(node.childNodes[i]);
                                if (found) return;
                            }
                        }
                    }
                }
                traverse(targetElement);
                return found ? offset : null;
            } else {
                return null;
            }
        }
        else if (document.caretRangeFromPoint) {
            console.warn("[Utils findOffsetForClientX] Using less precise caretRangeFromPoint.");
            const range = document.caretRangeFromPoint(clientX, targetY);
            if (range && targetElement.contains(range.startContainer)) {
                console.warn("[Utils findOffsetForClientX] caretRangeFromPoint is not fully supported for offset calculation.");
                return null;
            }
        }
        return null;
    } catch (err) {
        console.error("[Utils findOffsetForClientX] Error:", err);
        return null;
    }
}


// --- Функции форматирования номеров списков ---
export function formatNumberDecimal(num) {
    return String(num);
}

export function formatNumberLowerAlpha(num) {
    if (num <= 0) return '';
    let alpha = '';
    while (num > 0) {
        let remainder = (num - 1) % 26;
        alpha = String.fromCharCode(97 + remainder) + alpha;
        num = Math.floor((num - 1) / 26);
    }
    return alpha;
}

export function formatNumberLowerRoman(num) {
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

export function getFormattedListNumber(number, indentLevel) {
    const num = Math.max(1, Math.floor(number));
    const formatLevel = Math.max(0, indentLevel) % 3;
    switch (formatLevel) {
        case 0: return formatNumberDecimal(num);
        case 1: return formatNumberLowerAlpha(num);
        case 2: return formatNumberLowerRoman(num);
        default: return String(num);
    }
}

export function showTemporaryErrorHighlight(blockElement) {
    if (!blockElement || !document.body.contains(blockElement)) return;
    const originalTransition = blockElement.style.transition;
    blockElement.style.transition = 'background-color 0.1s ease-out';
    blockElement.style.backgroundColor = 'rgba(255, 100, 100, 0.2)';
    setTimeout(() => {
        if (document.body.contains(blockElement)) {
            blockElement.style.backgroundColor = '';
            setTimeout(() => {
                if (document.body.contains(blockElement)) {
                    blockElement.style.transition = originalTransition;
                }
            }, 150);
        }
    }, 250);
}

// --- Функции для ручного применения стилей/классов/тегов ---
function normalizeElementGeneric(elementNode, attributeName, valueToRemove) {
    if (!elementNode || elementNode.nodeType !== Node.ELEMENT_NODE) {
        return;
    }
    let shouldRemoveElement = false;
    const tagName = elementNode.tagName.toUpperCase();
    const isFormattingTag = ['B', 'I', 'U', 'S'].includes(tagName);

    if (attributeName === 'style') {
        if (elementNode.style[valueToRemove]) {
            elementNode.style.removeProperty(valueToRemove);
        }
        if (tagName === 'SPAN' && elementNode.style.length === 0 && elementNode.classList.length === 0) {
             const hasOtherAttrs = Array.from(elementNode.attributes).some(attr => !attr.name.startsWith('sel-marker-'));
             if (!hasOtherAttrs) shouldRemoveElement = true;
        }
    } else if (attributeName === 'class') {
        if (elementNode.classList.contains(valueToRemove)) {
            elementNode.classList.remove(valueToRemove);
        }
         if (tagName === 'SPAN' && elementNode.style.length === 0 && elementNode.classList.length === 0) {
             const hasOtherAttrs = Array.from(elementNode.attributes).some(attr => !attr.name.startsWith('sel-marker-'));
             if (!hasOtherAttrs) shouldRemoveElement = true;
         }
    } else if (attributeName === 'tag') {
        if (tagName === valueToRemove.toUpperCase()) {
            shouldRemoveElement = true;
        }
    }

    const hasContent = elementNode.hasChildNodes() && (elementNode.textContent.trim() !== '' || elementNode.querySelector('br, img'));
    if ((shouldRemoveElement || (!hasContent && tagName === 'SPAN')) && !elementNode.id.startsWith('sel-marker-')) {
        const parent = elementNode.parentNode;
        if (parent) {
            while (elementNode.firstChild) {
                parent.insertBefore(elementNode.firstChild, elementNode);
            }
            parent.removeChild(elementNode);
        }
    }
}

function mergeAdjacentElementsGeneric(parentNode, attributeName, tagNameOrClass = null) {
    if (!parentNode || !parentNode.hasChildNodes()) return;
    let firstElement = null;
    let currentNode = parentNode.firstChild;

    while (currentNode) {
        const nextNode = currentNode.nextSibling;
        let isMergeCandidate = false;
        let currentAttrValue = '';

        if (currentNode.nodeType === Node.ELEMENT_NODE) {
            if (attributeName === 'tag' && currentNode.tagName.toUpperCase() === tagNameOrClass?.toUpperCase()) {
                isMergeCandidate = true;
                currentAttrValue = currentNode.tagName;
            } else if (attributeName === 'style' && currentNode.tagName === 'SPAN' && currentNode.hasAttribute('style')) {
                isMergeCandidate = true;
                currentAttrValue = currentNode.getAttribute('style')?.trim() || '';
            } else if (attributeName === 'class' && currentNode.tagName === 'SPAN' && currentNode.classList.contains(tagNameOrClass)) {
                isMergeCandidate = true;
                currentAttrValue = Array.from(currentNode.classList).sort().join(' ');
            }
        }

        if (isMergeCandidate) {
            if (firstElement) {
                let firstAttrValue = '';
                 if (attributeName === 'tag') { firstAttrValue = firstElement.tagName; }
                 else if (attributeName === 'style') { firstAttrValue = firstElement.getAttribute('style')?.trim() || ''; }
                 else if (attributeName === 'class') { firstAttrValue = Array.from(firstElement.classList).sort().join(' '); }

                let canMerge = currentAttrValue === firstAttrValue;
                if (canMerge) {
                    let nodeBetween = firstElement.nextSibling;
                    while(nodeBetween && nodeBetween !== currentNode) {
                        if (nodeBetween.nodeType === Node.ELEMENT_NODE && ['B', 'I', 'U', 'S', 'SPAN'].includes(nodeBetween.tagName)) {
                             canMerge = false;
                             break;
                        }
                        if (nodeBetween.nodeType === Node.TEXT_NODE && nodeBetween.nodeValue.trim() !== '') {
                             canMerge = false;
                             break;
                        }
                        nodeBetween = nodeBetween.nextSibling;
                    }
                }

                if (canMerge) {
                    while (currentNode.firstChild) {
                        firstElement.appendChild(currentNode.firstChild);
                    }
                    parentNode.removeChild(currentNode);
                } else {
                    firstElement = currentNode;
                }
            } else {
                firstElement = currentNode;
            }
        } else if (currentNode.nodeType === Node.TEXT_NODE && currentNode.nodeValue.trim() === '') {
            parentNode.removeChild(currentNode);
        } else {
            firstElement = null;
        }
        currentNode = nextNode;
    }
}

function normalizeSpan(spanNode, styleProperty) { normalizeElementGeneric(spanNode, 'style', styleProperty); }
function mergeAdjacentSpans(parentNode) { mergeAdjacentElementsGeneric(parentNode, 'style'); }
function normalizeSpanForClass(spanNode, className) { normalizeElementGeneric(spanNode, 'class', className); }
function mergeAdjacentSpansByClass(parentNode, className) { mergeAdjacentElementsGeneric(parentNode, 'class', className); }
function normalizeTag(elementNode, tagName) { normalizeElementGeneric(elementNode, 'tag', tagName); }
function mergeAdjacentTags(parentNode, tagName) { mergeAdjacentElementsGeneric(parentNode, 'tag', tagName); }

function wrapTextSegment(textNode, start, end, attributeName, value, attributeValue) {
    const isFormattingTag = attributeName === 'tag' && ['B', 'I', 'U', 'S'].includes(value.toUpperCase());
    const tagName = isFormattingTag ? value.toUpperCase() : 'SPAN';
    if (start >= end || !value) {
        return textNode.nextSibling;
    }
    const originalParent = textNode.parentNode;
    try {
        let nodeAfterEnd = null; if (end < textNode.length) { nodeAfterEnd = textNode.splitText(end); }
        let nodeToWrap = textNode; if (start > 0) { nodeToWrap = textNode.splitText(start); }
        if (nodeToWrap.length > 0) {
            const parent = nodeToWrap.parentNode;
            let needsWrap = true;
            if (parent && parent.tagName === tagName) {
                 if (attributeName === 'style' && parent.style[value] === attributeValue) { needsWrap = false; }
                 else if (attributeName === 'class' && parent.classList.contains(value)) { needsWrap = false; }
                 else if (attributeName === 'tag') { needsWrap = false; }
            }
            if (isFormattingTag && needsWrap) {
                 let ancestor = parent;
                 while (ancestor && ancestor !== editorArea) {
                     if (ancestor.tagName === tagName) {
                         needsWrap = false;
                         break;
                     }
                     ancestor = ancestor.parentNode;
                 }
            }
            if (needsWrap) {
                const wrapperElement = document.createElement(tagName);
                if (attributeName === 'style') { wrapperElement.style[value] = attributeValue; }
                else if (attributeName === 'class') { wrapperElement.classList.add(value); }
                if (parent) {
                    parent.replaceChild(wrapperElement, nodeToWrap);
                    wrapperElement.appendChild(nodeToWrap);
                }
            }
        }
        return nodeAfterEnd ?? nodeToWrap.parentNode?.nextSibling;
    } catch (error) { console.error(`[Utils wrapTextSegment] Error wrapping text segment for ${attributeName}:`, error); originalParent?.normalize(); return textNode.nextSibling; }
}

function unwrapTextSegment(textNode, start, end, attributeName, value) {
    const isFormattingTag = attributeName === 'tag' && ['B', 'I', 'U', 'S'].includes(value.toUpperCase());
    const tagName = isFormattingTag ? value.toUpperCase() : 'SPAN';
    if (start >= end) {
        return textNode.nextSibling;
    }
    let elementToUnwrap = null;
    if (textNode.parentNode?.tagName === tagName) {
         if (attributeName === 'style' && textNode.parentNode.style[value]) { elementToUnwrap = textNode.parentNode; }
         else if (attributeName === 'class' && textNode.parentNode.classList.contains(value)) { elementToUnwrap = textNode.parentNode; }
         else if (attributeName === 'tag') { elementToUnwrap = textNode.parentNode; }
    }
    if (!elementToUnwrap && isFormattingTag) {
         elementToUnwrap = textNode.parentElement?.closest(tagName);
    }
    if (!elementToUnwrap || !elementToUnwrap.parentNode) {
         return textNode.nextSibling;
    }
    const grandParent = elementToUnwrap.parentNode;
    try {
        let nodeBeforeStart = textNode;
        let nodeToEnd = null;
        if (end < textNode.length) { nodeToEnd = nodeBeforeStart.splitText(end); }
        if (start > 0) { nodeBeforeStart = nodeBeforeStart.splitText(start); }
        const nodeToMove = nodeBeforeStart;
        const nextNodeForIteration = nodeToEnd ?? elementToUnwrap.nextSibling;
        if (nodeToMove && nodeToMove.length > 0) {
            grandParent.insertBefore(nodeToMove, elementToUnwrap);
        }
        normalizeElementGeneric(elementToUnwrap, attributeName, value);
        return nextNodeForIteration;
    } catch (error) {
        console.error(`[Utils unwrapTextSegment] Error unwrapping text segment for ${attributeName}:`, error);
        grandParent?.normalize();
        return textNode.nextSibling;
    }
}

export function processRangeNodesGeneric(range, attributeName, value, attributeValue) {
    const affectedBlocks = new Set();
    if (!range || range.collapsed || !value) {
        return affectedBlocks;
    }
    const commonAncestor = range.commonAncestorContainer;
    const nodesToProcess = [];
    const isInEditableContext = (node) => {
        const editableParent = node.parentElement?.closest('[contenteditable="true"]');
        return editableParent && editorArea.contains(editableParent);
    };
    if (commonAncestor.nodeType === Node.TEXT_NODE) {
        if (isInEditableContext(commonAncestor)) {
            nodesToProcess.push(commonAncestor);
        }
    } else if (commonAncestor.nodeType === Node.ELEMENT_NODE) {
        const walker = document.createTreeWalker(
            commonAncestor,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: node => (range.intersectsNode(node) && isInEditableContext(node))
                                     ? NodeFilter.FILTER_ACCEPT
                                     : NodeFilter.FILTER_REJECT
            },
            false
        );
        let walkerNode;
        while (walkerNode = walker.nextNode()) {
            nodesToProcess.push(walkerNode);
        }
    }

    const nodesCopy = [...nodesToProcess];
    let currentNodeIndex = 0;
    while(currentNodeIndex < nodesCopy.length) {
        const textNode = nodesCopy[currentNodeIndex];
        if (!textNode.parentNode || !document.body.contains(textNode)) {
            currentNodeIndex++;
            continue;
        }
        const block = textNode.parentElement?.closest('.editor-block');
        if (block) affectedBlocks.add(block);
        const nodeRange = document.createRange();
        nodeRange.selectNode(textNode);
        const startCompare = range.compareBoundaryPoints(Range.START_TO_START, nodeRange);
        const endCompare = range.compareBoundaryPoints(Range.END_TO_END, nodeRange);
        let effectiveStart = (range.startContainer === textNode) ? range.startOffset : (startCompare > 0 ? 0 : 0);
        let effectiveEnd = (range.endContainer === textNode) ? range.endOffset : (endCompare < 0 ? textNode.length : textNode.length);
        effectiveStart = Math.max(0, Math.min(effectiveStart, textNode.length));
        effectiveEnd = Math.max(effectiveStart, Math.min(effectiveEnd, textNode.length));

        let nextNodeToProcess = null;
        if (effectiveStart < effectiveEnd) {
            if (attributeValue !== null) {
                nextNodeToProcess = wrapTextSegment(textNode, effectiveStart, effectiveEnd, attributeName, value, attributeValue);
            } else {
                nextNodeToProcess = unwrapTextSegment(textNode, effectiveStart, effectiveEnd, attributeName, value);
            }
        } else {
            nextNodeToProcess = textNode.nextSibling;
        }
        let nextIndex = -1;
        if (nextNodeToProcess) {
             nextIndex = nodesCopy.findIndex((node, idx) => idx > currentNodeIndex && node === nextNodeToProcess);
        }
        currentNodeIndex = (nextIndex !== -1) ? nextIndex : currentNodeIndex + 1;
    }

    affectedBlocks.forEach(block => {
        const contentElements = block.querySelectorAll('[contenteditable="true"]');
        contentElements.forEach(contentElement => {
             if (editorArea.contains(contentElement)) {
                if (attributeName === 'tag') {
                     mergeAdjacentElementsGeneric(contentElement, attributeName, value);
                } else if (attributeName === 'class') {
                     mergeAdjacentElementsGeneric(contentElement, attributeName, value);
                } else {
                     mergeAdjacentElementsGeneric(contentElement, attributeName);
                }
                contentElement.normalize();
            }
        });
    });
     return affectedBlocks;
}

export function applyStyleToRange(range, styleProperty, styleValue) {
    let affectedBlocks = new Set();
    if (!range || range.collapsed || !styleProperty || !styleValue) { return affectedBlocks; }
    try {
        const startContainer = range.startContainer; const startOffset = range.startOffset; const endContainer = range.endContainer; const endOffset = range.endOffset;
        const rangeCloneForRemoval = range.cloneRange();
        processRangeNodesGeneric(rangeCloneForRemoval, 'style', styleProperty, null);
        affectedBlocks = processRangeNodesGeneric(range, 'style', styleProperty, styleValue);
        if (document.body.contains(startContainer) && document.body.contains(endContainer)) {
            const validStartOffset = Math.min(startOffset, startContainer.length ?? 0); const validEndOffset = Math.min(endOffset, endContainer.length ?? 0);
            range.setStart(startContainer, validStartOffset); range.setEnd(endContainer, validEndOffset);
        }
    } catch (error) { console.error("[Utils applyStyleToRange] Error:", error); range.commonAncestorContainer?.normalize(); }
    return affectedBlocks;
}

export function removeStyleFromRange(range, styleProperty) {
     let affectedBlocks = new Set();
     if (!range || !styleProperty) { return affectedBlocks; }
     if (range.collapsed) {
         const parentSpan = range.startContainer.nodeType === Node.TEXT_NODE
                          ? range.startContainer.parentElement?.closest(`span[style*="${styleProperty}:"]`)
                          : (range.startContainer.tagName === 'SPAN' && range.startContainer.style[styleProperty] ? range.startContainer : null);
         if (parentSpan) {
             normalizeSpan(parentSpan, styleProperty);
             const grandParent = parentSpan.parentNode;
             if(grandParent) { mergeAdjacentSpans(grandParent); grandParent.normalize(); }
             const block = parentSpan.closest('.editor-block');
             if (block) affectedBlocks.add(block);
         }
         return affectedBlocks;
     }
    try {
        const startContainer = range.startContainer; const startOffset = range.startOffset; const endContainer = range.endContainer; const endOffset = range.endOffset;
        affectedBlocks = processRangeNodesGeneric(range, 'style', styleProperty, null);
        if (document.body.contains(startContainer) && document.body.contains(endContainer)) {
            const validStartOffset = Math.min(startOffset, startContainer.length ?? 0); const validEndOffset = Math.min(endOffset, endContainer.length ?? 0);
            range.setStart(startContainer, validStartOffset); range.setEnd(endContainer, validEndOffset);
        }
    } catch (error) { console.error("[Utils removeStyleFromRange] Error:", error); range.commonAncestorContainer?.normalize(); }
    return affectedBlocks;
}

export function applyClassToRange(range, className) {
    let affectedBlocks = new Set();
    if (!range || range.collapsed || !className) { return affectedBlocks; }
    try {
        const startContainer = range.startContainer; const startOffset = range.startOffset; const endContainer = range.endContainer; const endOffset = range.endOffset;
        const rangeCloneForRemoval = range.cloneRange();
        processRangeNodesGeneric(rangeCloneForRemoval, 'class', className, null);
        affectedBlocks = processRangeNodesGeneric(range, 'class', className, className);
        if (document.body.contains(startContainer) && document.body.contains(endContainer)) {
            const validStartOffset = Math.min(startOffset, startContainer.length ?? 0); const validEndOffset = Math.min(endOffset, endContainer.length ?? 0);
            range.setStart(startContainer, validStartOffset); range.setEnd(endContainer, validEndOffset);
        }
    } catch (error) { console.error("[Utils applyClassToRange] Error:", error); range.commonAncestorContainer?.normalize(); }
    return affectedBlocks;
}

export function removeClassFromRange(range, className) {
     let affectedBlocks = new Set();
     if (!range || !className) { return affectedBlocks; }
     if (range.collapsed) {
         const parentSpan = range.startContainer.nodeType === Node.TEXT_NODE
                          ? range.startContainer.parentElement?.closest(`span.${className}`)
                          : (range.startContainer.tagName === 'SPAN' && range.startContainer.classList.contains(className) ? range.startContainer : null);
         if (parentSpan) {
             normalizeSpanForClass(parentSpan, className);
             const grandParent = parentSpan.parentNode;
             if(grandParent) { mergeAdjacentSpansByClass(grandParent, className); grandParent.normalize(); }
             const block = parentSpan.closest('.editor-block');
             if (block) affectedBlocks.add(block);
         }
         return affectedBlocks;
     }
    try {
        const startContainer = range.startContainer; const startOffset = range.startOffset; const endContainer = range.endContainer; const endOffset = range.endOffset;
        affectedBlocks = processRangeNodesGeneric(range, 'class', className, null);
        if (document.body.contains(startContainer) && document.body.contains(endContainer)) {
            const validStartOffset = Math.min(startOffset, startContainer.length ?? 0); const validEndOffset = Math.min(endOffset, endContainer.length ?? 0);
            range.setStart(startContainer, validStartOffset); range.setEnd(endContainer, validEndOffset);
        }
    } catch (error) { console.error("[Utils removeClassFromRange] Error:", error); range.commonAncestorContainer?.normalize(); }
    return affectedBlocks;
}

export function isRangeAllClass(range, className) {
    if (!range || range.collapsed || !className) {
        return false;
    }
    const commonAncestor = range.commonAncestorContainer;
    let allCovered = true;
    let foundRelevantNode = false;
    const isInEditableContext = (node) => {
        const editableParent = node.parentElement?.closest('[contenteditable="true"]');
        return editableParent && editorArea.contains(editableParent);
    };
    const walker = document.createTreeWalker(
        commonAncestor,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                if (range.intersectsNode(node) && isInEditableContext(node) && node.nodeValue.trim() !== '') {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_REJECT;
            }
        },
        false
    );
    let node = walker.nextNode();
    if (!node) {
        return false;
    }
    while (node) {
        foundRelevantNode = true;
        const parentSpan = node.parentElement?.closest(`span.${className}`);
        if (!parentSpan || !parentSpan.contains(node)) {
            allCovered = false;
            break;
        }
        node = walker.nextNode();
    }
    return foundRelevantNode && allCovered;
}

export function toggleClassForRange(range, className) {
    let affectedBlocks = new Set();
    if (!range || !className) { return affectedBlocks; }
    if (range.collapsed) {
        affectedBlocks = removeClassFromRange(range, className);
        return affectedBlocks;
    }
    const isAlreadyApplied = isRangeAllClass(range.cloneRange(), className);
    if (isAlreadyApplied) {
        affectedBlocks = removeClassFromRange(range, className);
    } else {
        affectedBlocks = applyClassToRange(range, className);
    }
    return affectedBlocks;
}

export function applyTagToRange(range, tagName) {
    let affectedBlocks = new Set();
    if (!range || range.collapsed || !tagName) { return affectedBlocks; }
    try {
        const startContainer = range.startContainer; const startOffset = range.startOffset; const endContainer = range.endContainer; const endOffset = range.endOffset;
        const rangeCloneForRemoval = range.cloneRange();
        processRangeNodesGeneric(rangeCloneForRemoval, 'tag', tagName, null);
        affectedBlocks = processRangeNodesGeneric(range, 'tag', tagName, tagName);
        if (document.body.contains(startContainer) && document.body.contains(endContainer)) {
            const validStartOffset = Math.min(startOffset, startContainer.length ?? 0); const validEndOffset = Math.min(endOffset, endContainer.length ?? 0);
            range.setStart(startContainer, validStartOffset); range.setEnd(endContainer, validEndOffset);
        }
    } catch (error) { console.error("[Utils applyTagToRange] Error:", error); range.commonAncestorContainer?.normalize(); }
    return affectedBlocks;
}

export function removeTagFromRange(range, tagName) {
     let affectedBlocks = new Set();
     if (!range || !tagName) { return affectedBlocks; }
     if (range.collapsed) {
         const parentElement = range.startContainer.nodeType === Node.TEXT_NODE
                          ? range.startContainer.parentElement?.closest(tagName)
                          : (range.startContainer.tagName === tagName.toUpperCase() ? range.startContainer : null);
         if (parentElement) {
             normalizeTag(parentElement, tagName);
             const grandParent = parentElement.parentNode;
             if(grandParent) { mergeAdjacentTags(grandParent, tagName); grandParent.normalize(); }
             const block = parentElement.closest('.editor-block');
             if (block) affectedBlocks.add(block);
         }
         return affectedBlocks;
     }
    try {
        const startContainer = range.startContainer; const startOffset = range.startOffset; const endContainer = range.endContainer; const endOffset = range.endOffset;
        affectedBlocks = processRangeNodesGeneric(range, 'tag', tagName, null);
        if (document.body.contains(startContainer) && document.body.contains(endContainer)) {
            const validStartOffset = Math.min(startOffset, startContainer.length ?? 0); const validEndOffset = Math.min(endOffset, endContainer.length ?? 0);
            range.setStart(startContainer, validStartOffset); range.setEnd(endContainer, validEndOffset);
        }
    } catch (error) { console.error("[Utils removeTagFromRange] Error:", error); range.commonAncestorContainer?.normalize(); }
    return affectedBlocks;
}

export function isRangeAllTag(range, tagName) {
    if (!range || range.collapsed || !tagName) {
        return false;
    }
    const upperTagName = tagName.toUpperCase();
    const commonAncestor = range.commonAncestorContainer;
    let allCovered = true;
    let foundRelevantNode = false;
    const isInEditableContext = (node) => {
        const editableParent = node.parentElement?.closest('[contenteditable="true"]');
        return editableParent && editorArea.contains(editableParent);
    };
    const walker = document.createTreeWalker(
        commonAncestor,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                if (range.intersectsNode(node) && isInEditableContext(node) && node.nodeValue.trim() !== '') {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_REJECT;
            }
        },
        false
    );
    let node = walker.nextNode();
    if (!node) {
        return false;
    }
    while (node) {
        foundRelevantNode = true;
        const parentElement = node.parentElement?.closest(upperTagName);
        if (!parentElement || !parentElement.contains(node)) {
            allCovered = false;
            break;
        }
        node = walker.nextNode();
    }
    return foundRelevantNode && allCovered;
}

export function toggleTagForRange(range, tagName) {
    let affectedBlocks = new Set();
    if (!range || !tagName) { return affectedBlocks; }
    if (range.collapsed) {
        affectedBlocks = removeTagFromRange(range, tagName);
        return affectedBlocks;
    }
    const isAlreadyApplied = isRangeAllTag(range.cloneRange(), tagName);
    if (isAlreadyApplied) {
        affectedBlocks = removeTagFromRange(range, tagName);
    } else {
        affectedBlocks = applyTagToRange(range, tagName);
    }
    return affectedBlocks;
}

export function isRangeAllStyle(range, styleProperty, styleValue) {
    if (!range || range.collapsed || !styleProperty || !styleValue) {
        return false;
    }
    const normalizedExpectedValue = styleValue;
    const commonAncestor = range.commonAncestorContainer;
    let allCovered = true;
    let foundRelevantNode = false;
    const isInEditableContext = (node) => {
        const editableParent = node.parentElement?.closest('[contenteditable="true"]');
        return editableParent && editorArea.contains(editableParent);
    };
    const walker = document.createTreeWalker(
        commonAncestor,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function(node) {
                if (range.intersectsNode(node) && isInEditableContext(node) && node.nodeValue.trim() !== '') {
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_REJECT;
            }
        },
        false
    );
    let node = walker.nextNode();
    if (!node) { return false; }
    while (node) {
        foundRelevantNode = true;
        let currentNodeStyleValue = null;
        const tempSpan = document.createElement('SPAN');
        const parent = node.parentNode;
        if (parent) {
             parent.insertBefore(tempSpan, node);
             tempSpan.appendChild(node);
             try {
                 const computedStyle = window.getComputedStyle(tempSpan);
                 currentNodeStyleValue = computedStyle.getPropertyValue(styleProperty);
             } catch (e) {
                 console.warn(`[Utils isRangeAllStyle v2] Error getting computed style for temp span:`, e);
                 currentNodeStyleValue = null;
             }
             parent.insertBefore(node, tempSpan);
             parent.removeChild(tempSpan);
        } else {
             node = walker.nextNode();
             continue;
        }
        const normalizedCurrentValue = normalizeColor(currentNodeStyleValue);
        if (normalizedCurrentValue !== normalizedExpectedValue) {
            allCovered = false;
            break;
        }
        node = walker.nextNode();
    }
    return foundRelevantNode && allCovered;
}

export function normalizeBlocks(blocks) {
    blocks.forEach(block => {
        const contentElements = block.querySelectorAll('[contenteditable="true"]');
        contentElements.forEach(contentElement => {
             if (editorArea.contains(contentElement)) {
                contentElement.normalize();
            }
        });
    });
}


// --- НОВЫЕ ФУНКЦИИ ДЛЯ УВЕДОМЛЕНИЙ ---

/**
 * Гарантирует, что DOM-элемент для уведомлений создан и добавлен в mainContent.
 * Использует ID #editor-global-notification.
 */
function ensureGlobalNotificationDOM() {
    if (notificationElement && mainContent && mainContent.contains(notificationElement)) {
        return; // Элемент уже существует и находится в правильном месте
    }
    if (notificationElement) { // Если элемент существует, но не в mainContent, удаляем его
        notificationElement.remove();
        notificationElement = null;
    }

    notificationElement = document.createElement('div');
    notificationElement.id = 'editor-global-notification'; // Используем этот ID
    // Класс 'editor-copy-notification' будет применен CSS для позиционирования и стилей
    notificationElement.className = 'editor-copy-notification'; // Важно для стилей из ui-elements.css

    if (mainContent) {
        mainContent.appendChild(notificationElement);
    } else {
        // В крайнем случае, если mainContent не найден, добавляем в body,
        // но тогда позиционирование может быть некорректным.
        console.warn("Utils: mainContent not found for notification. Appending to body as fallback.");
        document.body.appendChild(notificationElement);
    }
}

/**
 * Показывает глобальное уведомление с указанным сообщением и иконкой.
 * @param {string} message - Текст сообщения.
 * @param {string} [iconSrc='Icons/Circle Check.svg'] - Путь к файлу иконки.
 */
export function showNotification(message, iconSrc = 'Icons/Circle Check.svg') {
    ensureGlobalNotificationDOM(); // Убедимся, что элемент создан и прикреплен к mainContent
    if (!notificationElement) {
        console.error("Utils: Notification element could not be ensured or found.");
        return;
    }

    notificationElement.innerHTML = `
        <img src="${iconSrc}" alt="" class="icon">
        <span>${message}</span>
    `;
    notificationElement.classList.add('visible'); // Делаем видимым

    // Очищаем предыдущий таймер, если он был
    if (notificationTimeoutId) {
        clearTimeout(notificationTimeoutId);
    }

    // Устанавливаем таймер для скрытия уведомления
    notificationTimeoutId = setTimeout(() => {
        hideGlobalNotification();
    }, NOTIFICATION_DURATION);
}

/**
 * Скрывает глобальное уведомление.
 */
function hideGlobalNotification() {
    if (notificationElement) {
        notificationElement.classList.remove('visible');
    }
    if (notificationTimeoutId) {
        clearTimeout(notificationTimeoutId);
        notificationTimeoutId = null;
    }
}
// --- КОНЕЦ ФУНКЦИЙ ДЛЯ УВЕДОМЛЕНИЙ ---