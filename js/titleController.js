// js/titleController.js
// Управление отображением и обновлением заголовка документа
// --- ИСПРАВЛЕНИЕ: Используем класс .doc-title-text для обновления заголовка в сайдбаре ---

import { currentDocTitleElement, docList } from './domElements.js';
import { getActiveDocId, getDocumentById, updateDocument, setLastCursorXPosition } from './state.js';
import { debounce } from './utils.js';

/**
 * Обновляет заголовок документа в состоянии (state.js) и в элементе списка
 * боковой панели на основе текста из editable-title.
 * @param {string} newTitleText - Текст, введенный в #current-doc-title.
 */
export function updateDocumentTitle(newTitleText) {
    const currentId = getActiveDocId();
    if (currentId === null) return; // Нет активного документа

    // Нормализуем заголовок
    const trimmedTitle = newTitleText.trim();
    // Если заголовок пустой, используем "Без названия [ID]"
    const finalTitle = trimmedTitle === '' ? `Без названия ${currentId}` : trimmedTitle;

    // Получаем текущие данные документа из состояния
    const doc = getDocumentById(currentId);

    // Обновляем состояние, только если заголовок действительно изменился
    if (doc && doc.title !== finalTitle) {
        // Обновляем документ в state.js (это также обновит keywords)
        updateDocument(currentId, { title: finalTitle });

        // Обновляем заголовок в элементе списка слева
        if (docList) {
            const listItem = docList.querySelector(`.document-item[data-id='${currentId}']`);
            if (listItem) {
                // --- ИСПРАВЛЕНИЕ: Ищем span с классом .doc-title-text ---
                const titleSpan = listItem.querySelector('.doc-title-text');
                if (titleSpan) {
                    titleSpan.textContent = finalTitle;
                } else {
                    console.warn(`[TitleController] Could not find .doc-title-text in list item for doc ID ${currentId}`);
                }
            }
        }
    }

    // Управляем плейсхолдером для #current-doc-title
    if (currentDocTitleElement) {
        const isEmptyForPlaceholder = finalTitle === `Без названия ${currentId}` || finalTitle === '';
        const isVisuallyEmpty = currentDocTitleElement.innerText.trim() === '';

        if (isVisuallyEmpty && isEmptyForPlaceholder) {
            currentDocTitleElement.setAttribute('data-placeholder-active', 'true');
        } else {
            currentDocTitleElement.removeAttribute('data-placeholder-active');
        }
    }
}

/** Debounced-версия обновления заголовка (для использования в слушателе 'input'). */
export const debouncedUpdateTitle = debounce(updateDocumentTitle, 400);

/**
 * Отображает заголовок активного документа в элементе #current-doc-title.
 * @param {number | null} docId - ID активного документа (или null).
 */
export function displayDocumentTitle(docId) {
    if (!currentDocTitleElement) {
        console.error("TitleController: #current-doc-title element not found.");
        return;
    }

    const doc = getDocumentById(docId); // Получаем документ из состояния

    if (doc) {
        currentDocTitleElement.innerText = doc.title;
        currentDocTitleElement.removeAttribute('data-placeholder-active');
        if (document.activeElement === currentDocTitleElement) {
            currentDocTitleElement.blur();
        }
         if (doc.title === '' || doc.title === `Без названия ${doc.id}`) {
              if (currentDocTitleElement.innerText.trim() === '') {
                    currentDocTitleElement.setAttribute('data-placeholder-active', 'true');
              }
         }

    } else {
        currentDocTitleElement.innerText = '';
        currentDocTitleElement.setAttribute('placeholder', 'Документ не выбран');
        currentDocTitleElement.setAttribute('data-placeholder-active', 'true');
    }

    setLastCursorXPosition(null);
}