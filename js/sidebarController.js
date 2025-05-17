// js/sidebarController.js
// Управление левой боковой панелью: список документов, поиск, сворачивание.
// --- ИЗМЕНЕНЫ ИКОНКИ ---
// --- ИСПРАВЛЕНИЕ: Добавлен класс doc-title-text для корректного обновления заголовка ---

import { leftSidebar, leftToggleButton, searchInput, docList, editorArea } from './domElements.js';
import { getDocuments, removeDocument, getActiveDocId, getDocumentById, setActiveDocId } from './state.js';
import { loadDocument } from './documentManager.js';

// Эта функция на самом деле должна быть в titleController.js ИЛИ импортирована оттуда
// Оставляем ее здесь как временное решение, если она не импортируется глобально
function displayDocumentTitle(docId) {
    const doc = getDocumentById(docId);
    const currentDocTitleElement = document.getElementById('current-doc-title');
    if (currentDocTitleElement) {
        if (doc) {
            currentDocTitleElement.innerText = doc.title;
            currentDocTitleElement.removeAttribute('data-placeholder-active');
            if (doc.title === '' || doc.title === `Без названия ${doc.id}`) {
               if(currentDocTitleElement.innerText.trim() === '') {
                   currentDocTitleElement.setAttribute('data-placeholder-active', 'true');
               }
            }
        } else {
            currentDocTitleElement.innerText = '';
            currentDocTitleElement.setAttribute('placeholder', 'Документ не выбран');
            currentDocTitleElement.setAttribute('data-placeholder-active', 'true');
        }
    }
}


/**
 * Внутренняя функция для создания DOM-элемента элемента списка документов.
 * Навешивает обработчики клика для загрузки и закрытия документа.
 * @param {object} doc - Объект документа из state.js.
 * @returns {Element} - Созданный элемент <li>.
 */
function createDocListItemElement(doc) {
    const listItem = document.createElement('li');
    listItem.className = 'document-item';
    listItem.setAttribute('data-id', String(doc.id));

    const iconContainer = document.createElement('span');
    iconContainer.className = 'doc-icon';
    iconContainer.innerHTML = `<img src="Icons/Document.svg" alt="Документ">`;

    const titleSpan = document.createElement('span');
    // --- ИСПРАВЛЕНИЕ: Добавляем класс для точного выбора ---
    titleSpan.className = 'doc-title-text';
    titleSpan.textContent = doc.title;

    const closeButton = document.createElement('button');
    closeButton.className = 'close-doc-button';
    closeButton.innerHTML = '&times;';
    closeButton.setAttribute('aria-label', `Закрыть ${doc.title}`);
    closeButton.title = `Закрыть ${doc.title}`;

    listItem.appendChild(iconContainer);
    listItem.appendChild(titleSpan);
    listItem.appendChild(closeButton);

    closeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const docIdToRemove = parseInt(listItem.getAttribute('data-id'), 10);
        const currentActiveId = getActiveDocId();
        const documents = getDocuments();
        const docIndexToRemove = documents.findIndex(d => d.id === docIdToRemove);

        if (removeDocument(docIdToRemove)) {
            listItem.remove();
            console.log(`[Sidebar] Removed document ${docIdToRemove} from list.`);
            if (currentActiveId === docIdToRemove) {
                console.log(`[Sidebar] Active document ${docIdToRemove} was removed.`);
                const remainingDocs = getDocuments();
                if (remainingDocs.length > 0) {
                    const newActiveIndex = Math.max(0, docIndexToRemove - 1);
                    console.log(`[Sidebar] Loading document at index ${newActiveIndex} (ID: ${remainingDocs[newActiveIndex].id})`);
                    loadDocument(remainingDocs[newActiveIndex].id);
                } else {
                    console.log(`[Sidebar] No documents left. Loading null.`);
                    loadDocument(null);
                }
            }
        } else {
            console.error(`Sidebar: Document with ID ${docIdToRemove} not found in state for removal.`);
        }
    });

    listItem.addEventListener('click', () => {
        if (getActiveDocId() !== doc.id) {
            console.log(`[Sidebar] Clicked on doc item ${doc.id}. Loading document...`);
            loadDocument(doc.id);
        } else {
             console.log(`[Sidebar] Clicked on already active doc item ${doc.id}. No action.`);
        }
    });

    return listItem;
}


/**
 * Обновляет визуальное состояние активного элемента в списке документов.
 * @param {number | null} targetItemId - ID документа, который должен стать активным, или null.
 */
export function setActiveDocumentListItem(targetItemId) {
    if (!docList) return;
    docList.querySelectorAll('.document-item').forEach(item => item.classList.remove('active'));
    if (targetItemId !== null) {
        const targetItem = docList.querySelector(`.document-item[data-id='${targetItemId}']`);
        if (targetItem) {
            targetItem.classList.add('active');
            targetItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
             console.warn(`[Sidebar] setActiveDocumentListItem: Could not find item with ID ${targetItemId} in the list.`);
        }
    }
}


/**
 * Переключает состояние левой боковой панели (свернуто/развернуто).
 */
export function toggleLeftSidebar() {
    if (!leftSidebar || !leftToggleButton) return;
    const isCollapsed = leftSidebar.classList.toggle('collapsed');

    leftToggleButton.innerHTML = isCollapsed
        ? '<img src="Icons/Arrow Right.svg" alt="Развернуть">'
        : '<img src="Icons/Arrow Left.svg" alt="Свернуть">';
    console.log(`[Sidebar] Toggled left sidebar. Collapsed: ${isCollapsed}`);
}


/**
 * Фильтрует список документов на основе текста в поле поиска.
 */
export function filterDocuments() {
    if (!searchInput || !docList) return;
    const searchTerm = searchInput.value.toLowerCase().trim();
    const listItems = docList.querySelectorAll('.document-item');
    let hasVisibleItems = false;

    listItems.forEach(item => {
        const docId = parseInt(item.getAttribute('data-id'), 10);
        const docData = getDocumentById(docId);
        const titleMatch = docData && docData.title.toLowerCase().includes(searchTerm);
        const keywordsMatch = docData && docData.keywords && docData.keywords.toLowerCase().includes(searchTerm);
        const isHidden = !(docData && (titleMatch || keywordsMatch));
        item.classList.toggle('hidden', isHidden);
        if (!isHidden) {
            hasVisibleItems = true;
        }
    });
}


/**
 * Отображает начальный список документов при загрузке приложения.
 */
export function renderInitialDocList() {
    if (!docList) {
        console.error("Sidebar: docList element not found for initial rendering.");
        return;
    }
    docList.innerHTML = '';
    const documents = getDocuments();
    const currentActiveId = getActiveDocId();
    console.log(`[Sidebar] Rendering initial doc list. Found ${documents.length} documents. Current active ID from state: ${currentActiveId}`);

    if (documents.length === 0) {
        console.log("[Sidebar] No documents found. Displaying placeholder.");
        displayDocumentTitle(null);
         if(editorArea) {
            editorArea.innerHTML = '<p class="editor-placeholder">Создайте свой первый документ!</p>';
         }
        return;
    }

    documents.forEach(doc => {
        docList.appendChild(createDocListItemElement(doc));
    });
    console.log("[Sidebar] Finished creating list item elements.");

    const initialDocId = (currentActiveId !== null && documents.some(d => d.id === currentActiveId))
        ? currentActiveId
        : documents[0].id;

    console.log(`[Sidebar] Determined initial document to load: ID ${initialDocId}`);
    loadDocument(initialDocId);
}

/**
 * Добавляет элемент для нового документа в список UI.
 * @param {object} doc - Объект нового документа.
 */
export function addDocToListUI(doc) {
     console.log('[addDocToListUI] Received doc to add to UI:', JSON.parse(JSON.stringify(doc)));
     if (docList) {
        const newDocElement = createDocListItemElement(doc);
        if (newDocElement) {
             docList.appendChild(newDocElement);
             console.log('[addDocToListUI] Appended new element to docList:', newDocElement);
        } else {
             console.error('[addDocToListUI] Failed to create newDocElement for doc:', doc.id);
        }
    } else {
        console.warn("Sidebar: docList element not found, cannot append new item visually.");
    }
}