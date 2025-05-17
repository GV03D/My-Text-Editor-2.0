// js/documentManager.js
// Управление документами: загрузка, сохранение, создание, переключение.
// --- ВЕРСИЯ 3: Интеграция загрузки комментариев ---
// --- ИЗМЕНЕНО: Убран флаг isInitialDocPlaceholderActive ---
// --- ИЗМЕНЕНО: Добавление data-initial-placeholder проверяется динамически после загрузки ---
// --- ИЗМЕНЕНО: checkAndSetInitialPlaceholderState и debouncedSave теперь экспортируются ---

import { editorArea, mainContent, docList, currentDocTitleElement, searchInput } from './domElements.js';
import {
    getActiveDocId, setActiveDocId, getDocumentById, getDocuments,
    updateDocumentContentBlocks, setNextBlockId, getNextDocIdAndIncrement,
    addDocument, clearSelectedBlockIds as clearSelectionState,
    setLastCursorXPosition, updateDocument
} from './state.js';
import { createBlockElement } from './blockFactory.js';
import {
    getEditableContentElement, getToggleTitleElement, getToggleChildrenWrapperElement,
    getCalloutPrimaryContentElement, updatePlaceholderVisibility, isBlockContentEmpty
} from './blockUtils.js';
import { updateListAttributes } from './listManager.js';
import { updateAllQuoteConnections } from './quoteManager.js'; // updateQuoteConnectionsAround, updateQuoteConnection убраны, т.к. не используются напрямую здесь
import { debounce, focusAtStart } from './utils.js';
import { setActiveDocumentListItem, filterDocuments, addDocToListUI } from './sidebarController.js';
import { displayDocumentTitle } from './titleController.js';
import { clearBlockSelection, updateSelectionVisuals } from './selectionManager.js';
// --- НОВЫЙ ИМПОРТ ---
import { loadCommentsForDocument } from './commentController.js'; // Импортируем загрузчик комментариев

// --- Вспомогательные функции сохранения ---
function saveBlocksRecursive(parentElement) {
    const blocksData = [];
    const childBlocks = parentElement.querySelectorAll(':scope > .editor-block');
    childBlocks.forEach((blockEl) => {
        const blockId = parseInt(blockEl.dataset.blockId, 10);
        if (isNaN(blockId)) { console.warn("Skipping block with invalid ID during save:", blockEl); return; }
        const blockType = blockEl.dataset.blockType || 'p';
        const blockData = { id: blockId, type: blockType };

        // Убираем атрибут перед сбором данных
        blockEl.removeAttribute('data-initial-placeholder');

        blockData.indentLevel = parseInt(blockEl.dataset.indentLevel || '0', 10);
        blockData.inQuote = blockEl.hasAttribute('data-in-quote');

        if (blockType === 'callout') {
            const wrapper = blockEl.querySelector(':scope > .callout-content-wrapper');
            blockData.children = wrapper ? saveBlocksRecursive(wrapper) : [];
            delete blockData.listType; delete blockData.indentLevel; delete blockData.inQuote; delete blockData.listResetBefore; delete blockData.html; delete blockData.checked;
        } else if (blockType === 'toggle') {
            const titleElement = getToggleTitleElement(blockEl);
            const wrapper = getToggleChildrenWrapperElement(blockEl);
            blockData.titleHtml = titleElement ? titleElement.innerHTML : '';
            blockData.isOpen = blockEl.dataset.isOpen === 'true';
            blockData.children = wrapper ? saveBlocksRecursive(wrapper) : [];
            delete blockData.listType; delete blockData.checked; if (!blockData.inQuote) delete blockData.inQuote; delete blockData.listResetBefore; delete blockData.html;
        } else if (blockType === 'quote') {
            const contentEl = getEditableContentElement(blockEl);
            blockData.html = contentEl ? contentEl.innerHTML : '';
             delete blockData.listType; delete blockData.indentLevel; if (!blockData.inQuote) delete blockData.inQuote; delete blockData.listResetBefore; delete blockData.checked;
        } else if (blockType === 'image') { // Сохраняем src для image
            blockData.src = blockEl.dataset.imageSrc || blockEl.querySelector('img')?.src || null;
            delete blockData.html; // У image нет html
            delete blockData.listType; delete blockData.checked; delete blockData.indentLevel; delete blockData.inQuote; delete blockData.listResetBefore;
        } else { // Стандартные блоки
            const contentEl = getEditableContentElement(blockEl);
            blockData.html = contentEl ? contentEl.innerHTML : '';
            if (blockType === 'li') { blockData.listType = blockEl.dataset.listType || 'ul'; } else { delete blockData.listType; }
            if (blockType === 'todo') { blockData.checked = blockEl.dataset.checked === 'true'; } else { delete blockData.checked; }
            if (blockData.indentLevel === 0 && !['li', 'todo'].includes(blockType)) { delete blockData.indentLevel; }
            if (!blockData.inQuote) delete blockData.inQuote;
             delete blockData.listResetBefore;
        }

        // Общая очистка пустых/дефолтных значений
        Object.keys(blockData).forEach(key => {
            if (blockData[key] === null || blockData[key] === undefined) { delete blockData[key]; }
            if (key === 'indentLevel' && blockData[key] === 0 && !['li', 'todo'].includes(blockData.type)) { delete blockData[key]; }
            if (key === 'inQuote' && blockData[key] === false) { delete blockData[key]; }
            if (key === 'src' && blockData[key] === null) { delete blockData[key]; } // Не сохраняем пустой src
        });
        blocksData.push(blockData);
    });
    return blocksData;
}

// --- Функция проверки и установки начального плейсхолдера ---
/**
 * Проверяет и устанавливает состояние начального плейсхолдера после загрузки/изменения документа.
 */
export function checkAndSetInitialPlaceholderState() { // Экспортируем
    if (!editorArea) return;

    const blocks = editorArea.querySelectorAll(':scope > .editor-block');
    const firstBlock = blocks.length === 1 ? blocks[0] : null;

    // Убираем атрибут с любого блока, если условие больше не выполняется
    editorArea.querySelectorAll('.editor-block[data-initial-placeholder="true"]')
        .forEach(block => {
            const editable = getEditableContentElement(block) || getToggleTitleElement(block);
            if (block !== firstBlock || !editable || !isBlockContentEmpty(editable) || document.activeElement === editable) {
                block.removeAttribute('data-initial-placeholder');
                updatePlaceholderVisibility(block); // Обновляем видимость после снятия атрибута
            }
        });

    if (firstBlock) {
        const editableElement = getEditableContentElement(firstBlock) || getToggleTitleElement(firstBlock);
        if (editableElement) {
            const isEmpty = isBlockContentEmpty(editableElement);
            const hasFocus = document.activeElement === editableElement;

            // Условие: Ровно один блок, он пуст и не имеет фокуса
            if (isEmpty && !hasFocus) {
                if (!firstBlock.hasAttribute('data-initial-placeholder')) {
                    firstBlock.setAttribute('data-initial-placeholder', 'true');
                    console.log('[checkAndSetInitialPlaceholderState] Установлен атрибут для блока:', firstBlock.dataset.blockId);
                    updatePlaceholderVisibility(firstBlock); // Обновляем видимость после добавления атрибута
                } else {
                    updatePlaceholderVisibility(firstBlock);
                }
            }
        }
         if (document.activeElement !== editableElement) {
            updatePlaceholderVisibility(firstBlock);
         }
    }
}


// --- Основные экспортируемые функции ---

export function saveDocumentContent() { // Экспортируем
     const currentDocId = getActiveDocId();
    if (currentDocId === null || !editorArea) return;
    const doc = getDocumentById(currentDocId);
    if (!doc) { console.error(`Save Error: Document with ID ${currentDocId} not found in state.`); return; }
    try {
        const currentBlocksData = saveBlocksRecursive(editorArea);
        // --- СОХРАНЕНИЕ КОММЕНТАРИЕВ ---
        // Комментарии уже должны быть в doc.comments благодаря commentController и state.js
        // Просто обновляем contentBlocks
        updateDocumentContentBlocks(currentDocId, currentBlocksData);
        // console.log(`Document ${currentDocId} content saved.`); // Для отладки
    } catch (error) { console.error(`Error during saveBlocksRecursive for doc ${currentDocId}:`, error); }
}
export const debouncedSave = debounce(saveDocumentContent, 350); // Экспортируем

// (loadBlocksRecursive остается внутренней функцией)
function loadBlocksRecursive(blocksData, parentElement) {
    if (!Array.isArray(blocksData)) { console.error("Load Error: blocksData is not an array", blocksData); return; }

    blocksData.forEach((blockData, index) => {
        if (!blockData || typeof blockData !== 'object') { console.warn(`Load Warning: Invalid block data at index ${index}`, blockData); return; }
        if (blockData.id !== undefined && typeof blockData.id === 'number' && !isNaN(blockData.id)) { setNextBlockId(blockData.id + 1); }
        blockData.type = blockData.type || 'p';
        blockData.indentLevel = parseInt(blockData.indentLevel || '0', 10);
        if (isNaN(blockData.indentLevel)) blockData.indentLevel = 0;
        blockData.inQuote = blockData.inQuote === true || blockData.inQuote === 'true';
        if (blockData.type === 'todo') { blockData.checked = blockData.checked === true || blockData.checked === 'true'; }
        if (blockData.type === 'toggle') { blockData.isOpen = blockData.isOpen === true || blockData.isOpen === 'true'; }
        delete blockData.listResetBefore;
        if (blockData.type !== 'li') delete blockData.listType;
        if (blockData.type !== 'todo') delete blockData.checked;
        if (!['li', 'todo', 'p'].includes(blockData.type) && blockData.indentLevel === 0) delete blockData.indentLevel;
        // Убеждаемся, что src есть только у image
        if (blockData.type !== 'image') delete blockData.src;

        const blockElement = createBlockElement(blockData);

        if (blockElement) {
            try {
                parentElement.appendChild(blockElement);
            } catch (e) {
                 console.error(`[loadBlocksRecursive] ОШИБКА при добавлении блока ${index} в parent:`, e, parentElement, blockElement);
                 return;
            }

            updatePlaceholderVisibility(blockElement);
            if ((blockData.type === 'callout' || blockData.type === 'toggle') && Array.isArray(blockData.children) && blockData.children.length > 0) {
                let wrapper;
                if (blockData.type === 'callout') { wrapper = blockElement.querySelector(':scope > .callout-content-wrapper'); }
                else { wrapper = getToggleChildrenWrapperElement(blockElement); }
                if (wrapper) {
                    loadBlocksRecursive(blockData.children, wrapper);
                }
                else { console.error(`Load Error: Could not find children wrapper for ${blockData.type} block ${blockData.id}`); }
            }
        } else {
            console.error(`[loadBlocksRecursive] НЕ удалось создать block element для данных блока ${index}`, blockData);
        }
    });
}

/**
 * Загружает контент документа в редактор.
 * @param {number | null} docId - ID загружаемого документа.
 */
function loadDocumentContent(docId) {
    console.log(`--- loadDocumentContent: Начало загрузки документа ID: ${docId} ---`);
    clearBlockSelection({ updateVisuals: false });
    const doc = getDocumentById(docId);

    if (!editorArea) { console.error("Load Error: editorArea not found!"); return; }
    editorArea.innerHTML = '';

    // --- Загрузка существующих блоков или создание дефолтного ---
    if (doc && doc.contentBlocks && Array.isArray(doc.contentBlocks) && doc.contentBlocks.length > 0) {
         let maxId = 0;
         const findMaxIdRecursive = (blocks) => { blocks?.forEach(block => { if (typeof block.id === 'number' && !isNaN(block.id)) { if (block.id > maxId) maxId = block.id; } if (Array.isArray(block.children)) { findMaxIdRecursive(block.children); } }); };
         findMaxIdRecursive(doc.contentBlocks);
         setNextBlockId(Math.max(1, maxId) + 1);
         loadBlocksRecursive(doc.contentBlocks, editorArea);
    } else {
        const firstBlockData = { type: 'p', html: '' };
        const firstBlockElement = createBlockElement(firstBlockData);
        if (firstBlockElement) {
            try {
                editorArea.appendChild(firstBlockElement);
            } catch (e) {
                console.error(`[loadDocumentContent] ОШИБКА при добавлении дефолтного блока:`, e, editorArea, firstBlockElement);
            }

            if(document.body.contains(firstBlockElement)) {
                updatePlaceholderVisibility(firstBlockElement);
                const createdId = parseInt(firstBlockElement.dataset.blockId, 10);
                if (!isNaN(createdId)) {
                    if (doc) {
                        updateDocumentContentBlocks(docId, [ { id: createdId, type: 'p', html: '' } ]);
                    } else if(docId !== null) {
                        console.error("[loadDocumentContent] Doc not found, cannot save default block state.", docId);
                    }
                } else { console.error("[loadDocumentContent] Failed to get ID from created default block."); }
            }
        } else {
            console.error("[loadDocumentContent] Failed to create default block element on load!");
        }
    }

    // --- Обновление UI и состояния после загрузки ---
    if (document.activeElement && editorArea.contains(document.activeElement)) { document.activeElement.blur(); }
    updateSelectionVisuals();
    updateListAttributes();
    updateAllQuoteConnections();
    if (mainContent) mainContent.scrollTop = 0;
    setLastCursorXPosition(null);

    // --- ПРОВЕРКА И УСТАНОВКА НАЧАЛЬНОГО ПЛЕЙСХОЛДЕРА ---
    checkAndSetInitialPlaceholderState();

    // --- Установка фокуса ---
    const firstBlock = editorArea.querySelector(':scope > .editor-block:first-child');
    if (firstBlock && !firstBlock.hasAttribute('data-initial-placeholder')) {
        setTimeout(() => {
            requestAnimationFrame(() => {
                let elementToFocus = null;
                const firstBlockType = firstBlock.dataset.blockType;
                if (firstBlockType === 'toggle') { elementToFocus = getToggleTitleElement(firstBlock); }
                else if (firstBlockType === 'callout') { elementToFocus = getCalloutPrimaryContentElement(firstBlock); }
                else if (firstBlockType !== 'image') { elementToFocus = getEditableContentElement(firstBlock); } // Не фокусируем image

                if (elementToFocus && document.body.contains(elementToFocus)) {
                    const currentFocus = document.activeElement;
                    if (currentFocus === document.body || currentFocus == null || !editorArea.contains(currentFocus)) {
                        focusAtStart(elementToFocus);
                    }
                }
            });
        }, 150);
    } else if (firstBlock && firstBlock.hasAttribute('data-initial-placeholder')) {
         console.log('[loadDocumentContent Focus] Начальный плейсхолдер активен, фокус не устанавливается.');
    } else {
         console.log('[loadDocumentContent Focus] Первый блок не найден для установки фокуса.');
    }
    console.log(`--- loadDocumentContent: Завершение загрузки контента документа ID: ${docId} ---`);
}


export function loadDocument(docId) { // Экспортируем
    const currentDocId = getActiveDocId();

    // Сохраняем текущий документ перед переключением
    if (currentDocId !== null && currentDocId !== docId) {
        saveDocumentContent(); // Сохраняем и контент, и комментарии (т.к. они часть state)
    }

    setActiveDocId(docId); // Устанавливаем новый активный ID

    if (docId === null) { // Если нужно показать состояние "нет документа"
        displayDocumentTitle(null);
        setActiveDocumentListItem(null);
        if (editorArea) { editorArea.innerHTML = '<p class="editor-placeholder">Выберите или создайте документ.</p>'; }
        clearBlockSelection();
        loadCommentsForDocument(null); // Очищаем комментарии
        return;
    }

    const docToLoad = getDocumentById(docId);
    if (!docToLoad) {
        console.error(`Load Error: Document with ID ${docId} not found in state.`);
        loadDocument(null); // Переключаемся на состояние "нет документа"
        return;
    }

    // Обновляем UI для нового документа
    displayDocumentTitle(docId);
    setActiveDocumentListItem(docId);

    // Загружаем контент и комментарии
    loadDocumentContent(docId);
    loadCommentsForDocument(docId); // <--- ЗАГРУЖАЕМ КОММЕНТАРИИ
}

export function createNewDocument() { // Экспортируем
    saveDocumentContent(); // Сохраняем текущий документ
    const newDocId = getNextDocIdAndIncrement();
    const defaultTitle = `Без названия ${newDocId}`;
    // Создаем документ с ПУСТЫМ массивом комментариев
    const newDoc = { id: newDocId, title: defaultTitle, contentBlocks: [], keywords: defaultTitle.toLowerCase(), comments: [] };
    addDocument(newDoc);
    addDocToListUI(newDoc);
    loadDocument(newDocId); // Загружаем новый документ (он также вызовет loadCommentsForDocument)
    if (searchInput) searchInput.value = ''; filterDocuments();
    if(currentDocTitleElement) {
         currentDocTitleElement.focus();
         // Выделяем текст заголовка для удобства редактирования
         const range = document.createRange();
         range.selectNodeContents(currentDocTitleElement);
         const sel = window.getSelection();
         sel?.removeAllRanges();
         sel?.addRange(range);
    }
}