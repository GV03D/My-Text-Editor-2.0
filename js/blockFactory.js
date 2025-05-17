// js/blockFactory.js
// Фабрика для создания HTML-элементов блоков редактора
// --- ИЗМЕНЕНО: Включен spellcheck="true" для редактируемых элементов ---
// --- ИЗМЕНЕНО: Добавлен отдельный span.list-marker для блоков LI ---
// --- УДАЛЕНО: Установка атрибута placeholder для .toggle-title ---
// --- ДОБАВЛЕНО: Элемент drag-handle для перетаскивания ---
// --- ДОБАВЛЕНО: Обработка нового типа блока 'image' ---

import { getNextBlockIdAndIncrement, setNextBlockId } from './state.js';
import { getToggleTitleElement, getToggleChildrenWrapperElement, getEditableContentElement, getCalloutPrimaryContentElement } from './blockUtils.js';

/**
 * Создает и возвращает HTML-элемент для блока редактора на основе предоставленных данных.
 * @param {object | null | undefined} blockData - Объект с данными блока (id?, type, html?, listType?, indentLevel?, checked?, inQuote?, children?, titleHtml?, isOpen?, src?).
 * @returns {Element | null} - Созданный DOM-элемент блока или null в случае ошибки.
 */
export function createBlockElement(blockData) {
    // 1. Установка значений по умолчанию и валидация ID
    if (!blockData || typeof blockData !== 'object') {
        console.error('[createBlockElement] Error: Invalid or missing blockData argument.');
        return null;
    }

    const currentNextBlockId = getNextBlockIdAndIncrement();
    const finalBlockData = {
        id: blockData.id ?? (currentNextBlockId - 1),
        type: blockData.type ?? 'p',
        listType: blockData.listType ?? null,
        indentLevel: blockData.indentLevel ?? 0,
        checked: blockData.checked ?? false,
        html: blockData.html ?? '',
        inQuote: blockData.inQuote ?? false,
        children: blockData.children ?? [],
        titleHtml: blockData.titleHtml ?? '',
        isOpen: blockData.isOpen ?? false,
        src: blockData.src ?? null, // Добавляем поле для URL изображения
    };

     if (typeof finalBlockData.id !== 'number' || isNaN(finalBlockData.id)) {
         console.warn(`[createBlockElement] Invalid ID found or generated (${finalBlockData.id}), assigning new one.`);
         finalBlockData.id = getNextBlockIdAndIncrement();
     }

    if (finalBlockData.id >= (currentNextBlockId - 1)) {
         setNextBlockId(finalBlockData.id + 1);
    }

    // 2. Создание основного элемента блока (div.editor-block)
    const blockDiv = document.createElement('div');
    blockDiv.className = 'editor-block';
    blockDiv.setAttribute('data-block-id', String(finalBlockData.id));
    blockDiv.setAttribute('data-block-type', finalBlockData.type);

    // +++ ДОБАВЛЯЕМ РУЧКУ ПЕРЕТАСКИВАНИЯ +++
    const dragHandle = document.createElement('div');
    dragHandle.className = 'drag-handle';
    dragHandle.setAttribute('aria-hidden', 'true');
    dragHandle.innerHTML = `
        <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <circle cx="3" cy="3" r="1.5"/>
            <circle cx="9" cy="3" r="1.5"/>
            <circle cx="3" cy="9" r="1.5"/>
            <circle cx="9" cy="9" r="1.5"/>
            <circle cx="3" cy="15" r="1.5"/>
            <circle cx="9" cy="15" r="1.5"/>
        </svg>
    `;
    blockDiv.appendChild(dragHandle);
    // +++ КОНЕЦ ДОБАВЛЕНИЯ РУЧКИ +++


    // 3. Установка Атрибутов на основе данных
    if (finalBlockData.listType) {
         blockDiv.setAttribute('data-list-type', finalBlockData.listType);
    }
    if (finalBlockData.indentLevel > 0) {
        blockDiv.setAttribute('data-indent-level', String(finalBlockData.indentLevel));
    } else {
        blockDiv.removeAttribute('data-indent-level'); // Явно удаляем для чистоты
    }
    if (finalBlockData.type === 'todo') {
        blockDiv.setAttribute('data-checked', String(finalBlockData.checked));
    }
    if (finalBlockData.inQuote) {
        blockDiv.setAttribute('data-in-quote', 'true');
    }
    if (finalBlockData.type === 'toggle') {
        blockDiv.setAttribute('data-is-open', String(finalBlockData.isOpen));
    }
    // Сохраняем src для image, если он есть (при загрузке документа)
    if (finalBlockData.type === 'image' && finalBlockData.src) {
         blockDiv.setAttribute('data-image-src', finalBlockData.src);
    }


    // 4. Создание специфичной структуры для разных типов блоков
    switch (finalBlockData.type) {
        case 'callout':
            blockDiv.classList.add('callout-block');
            const icon = document.createElement('div');
            icon.className = 'callout-icon';
            icon.textContent = '💡';
            icon.setAttribute('contenteditable', 'false');
            icon.setAttribute('aria-hidden', 'true');
            blockDiv.appendChild(icon);
            const calloutWrapper = document.createElement('div');
            calloutWrapper.className = 'callout-content-wrapper';
            blockDiv.appendChild(calloutWrapper);
            if (!Array.isArray(finalBlockData.children) || finalBlockData.children.length === 0) {
                const firstChildData = { type: 'p', html: finalBlockData.html };
                const firstChildElement = createBlockElement(firstChildData);
                if (firstChildElement) { calloutWrapper.appendChild(firstChildElement); }
            }
            break;

        case 'toggle':
            const indicatorContainer = document.createElement('div');
            indicatorContainer.className = 'toggle-indicator-container';
            const indicator = document.createElement('div');
            indicator.className = 'toggle-indicator';
            indicator.setAttribute('contenteditable', 'false');
            indicator.setAttribute('aria-hidden', 'true');
            indicatorContainer.appendChild(indicator);

            const mainContentDiv = document.createElement('div');
            mainContentDiv.className = 'toggle-main-content';
            const titleDiv = document.createElement('div');
            titleDiv.className = 'toggle-title';
            titleDiv.setAttribute('contenteditable', 'true');
            // titleDiv.setAttribute('spellcheck', 'false'); // <-- БЫЛО ОТКЛЮЧЕНО
            titleDiv.setAttribute('spellcheck', 'true');  // <-- ВКЛЮЧЕНО
            titleDiv.innerHTML = finalBlockData.titleHtml || '';

            const childrenWrapper = document.createElement('div');
            childrenWrapper.className = 'toggle-children-wrapper';
            mainContentDiv.appendChild(titleDiv);
            mainContentDiv.appendChild(childrenWrapper);
            blockDiv.appendChild(indicatorContainer);
            blockDiv.appendChild(mainContentDiv);

            if (!Array.isArray(finalBlockData.children) || finalBlockData.children.length === 0) {
                 const firstChildData = { type: 'p', html: '' };
                 const firstChildElement = createBlockElement(firstChildData);
                 if (firstChildElement) { childrenWrapper.appendChild(firstChildElement); }
            }
            break;

        case 'li':
            const listMarkerSpan = document.createElement('span');
            listMarkerSpan.className = 'list-marker';
            listMarkerSpan.setAttribute('aria-hidden', 'true');
            listMarkerSpan.setAttribute('contenteditable', 'false');
            blockDiv.appendChild(listMarkerSpan);

            const liContent = document.createElement('div');
            liContent.className = 'block-content';
            liContent.setAttribute('contenteditable', 'true');
            // liContent.setAttribute('spellcheck', 'false'); // <-- БЫЛО ОТКЛЮЧЕНО
            liContent.setAttribute('spellcheck', 'true');  // <-- ВКЛЮЧЕНО
            liContent.innerHTML = finalBlockData.html ?? '';
            blockDiv.appendChild(liContent);
            break;

        // --- НОВЫЙ CASE ДЛЯ IMAGE ---
        case 'image':
            blockDiv.classList.add('image-placeholder-block'); // Класс для стилизации плейсхолдера

             // Если есть src (загрузка из сохраненных данных) - показываем картинку
             if (finalBlockData.src) {
                 const imgElement = document.createElement('img');
                 imgElement.src = finalBlockData.src;
                 imgElement.alt = "Изображение"; // Можно добавить alt текст позже
                 imgElement.style.maxWidth = '100%'; // Базовый стиль для адаптивности
                 imgElement.style.display = 'block'; // Чтобы занимал всю ширину строки
                 blockDiv.appendChild(imgElement);
                 blockDiv.classList.remove('image-placeholder-block'); // Убираем класс плейсхолдера
             }
             // Иначе - показываем плейсхолдер
             else {
                 const placeholderContent = document.createElement('div');
                 placeholderContent.className = 'image-placeholder-content';

                 const placeholderIcon = document.createElement('span');
                 placeholderIcon.className = 'image-placeholder-icon';
                 placeholderIcon.innerHTML = '<img src="Icons/Image.svg" alt="Image Icon">'; // Иконка

                 const placeholderText = document.createElement('span');
                 placeholderText.className = 'image-placeholder-text';
                 placeholderText.textContent = 'Добавьте изображение';

                 placeholderContent.appendChild(placeholderIcon);
                 placeholderContent.appendChild(placeholderText);
                 blockDiv.appendChild(placeholderContent);
             }
             // Нет contenteditable элемента, spellcheck не нужен
             break;
        // --- КОНЕЦ CASE IMAGE ---

        case 'quote': // Fallthrough
        case 'todo':  // Fallthrough
        case 'p':     // Fallthrough
        case 'h1':    // Fallthrough
        case 'h2':    // Fallthrough
        case 'h3':    // Fallthrough
        default:
            if (finalBlockData.type === 'quote' || finalBlockData.inQuote) {
                const quoteIndicator = document.createElement('div');
                quoteIndicator.className = 'quote-indicator';
                blockDiv.appendChild(quoteIndicator);
            }
            if (finalBlockData.type === 'todo') {
                const checkbox = document.createElement('span');
                checkbox.className = 'block-checkbox';
                checkbox.setAttribute('contenteditable', 'false');
                blockDiv.appendChild(checkbox);
            }
            const content = document.createElement('div');
            content.className = 'block-content';
            content.setAttribute('contenteditable', 'true');
            // content.setAttribute('spellcheck', 'false'); // <-- БЫЛО ОТКЛЮЧЕНО
            content.setAttribute('spellcheck', 'true');  // <-- ВКЛЮЧЕНО
            content.innerHTML = finalBlockData.html ?? '';
            blockDiv.appendChild(content);
            break;
    }

    return blockDiv;
};