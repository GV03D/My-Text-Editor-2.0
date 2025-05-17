// js/blockUtils.js
// Утилиты для работы со структурой и содержимым блоков редактора
// --- ИЗМЕНЕНО: updatePlaceholderVisibility теперь корректно обрабатывает начальный плейсхолдер ---
// --- ИЗМЕНЕНО: Логика isCursorAtStartOfContent для проверки текста перед курсором ---
// --- ИЗМЕНЕНО: Порядок проверки в getBlockParentContainer ---
// --- УДАЛЕНЫ: Диагностические логи из isCursorAtStartOfContent ---

/**
 * Находит и возвращает основной редактируемый элемент контента внутри блока.
 * Обрабатывает стандартные блоки, заголовки toggle и первый блок внутри callout.
 * @param {Element | null} blockElement - Элемент блока (.editor-block).
 * @returns {Element | null} - Редактируемый элемент (div.block-content, div.toggle-title) или null.
 */
export function getEditableContentElement(blockElement) {
    if (!blockElement) return null;

    // Пытаемся найти .block-content непосредственно внутри блока
    const directContent = blockElement.querySelector(':scope > .block-content[contenteditable="true"]');
    if (directContent) {
        return directContent;
    }

    // Специальная обработка для блока 'toggle'
    if (blockElement.dataset.blockType === 'toggle') {
        return getToggleTitleElement(blockElement);
    }

    // Специальная обработка для блока 'callout'
    if (blockElement.dataset.blockType === 'callout') {
        return null;
    }

    // Если ничего не найдено
    return null;
}

/**
 * Находит и возвращает редактируемый элемент заголовка для блока 'toggle'.
 * @param {Element | null} toggleBlockElement - Элемент блока toggle (.editor-block[data-block-type="toggle"]).
 * @returns {Element | null} - Элемент div.toggle-title или null.
 */
export function getToggleTitleElement(toggleBlockElement) {
    if (!toggleBlockElement || toggleBlockElement.dataset.blockType !== 'toggle') {
        return null;
    }
    return toggleBlockElement.querySelector(':scope > .toggle-main-content > .toggle-title[contenteditable="true"]');
}

/**
 * Находит и возвращает элемент-обертку для дочерних блоков toggle.
 * @param {Element | null} toggleBlockElement - Элемент блока toggle (.editor-block[data-block-type="toggle"]).
 * @returns {Element | null} - Элемент div.toggle-children-wrapper или null.
 */
export function getToggleChildrenWrapperElement(toggleBlockElement) {
    if (!toggleBlockElement || toggleBlockElement.dataset.blockType !== 'toggle') {
        return null;
    }
    return toggleBlockElement.querySelector(':scope > .toggle-main-content > .toggle-children-wrapper');
}

/**
 * Находит и возвращает основной редактируемый элемент контента для блока 'callout'.
 * Это контент первого дочернего блока внутри callout.
 * @param {Element | null} calloutBlockElement - Элемент блока callout (.editor-block[data-block-type="callout"]).
 * @returns {Element | null} - Редактируемый элемент первого дочернего блока или null.
 */
export function getCalloutPrimaryContentElement(calloutBlockElement) {
    if (!calloutBlockElement || calloutBlockElement.dataset.blockType !== 'callout') {
        return null;
    }
    const wrapper = calloutBlockElement.querySelector(':scope > .callout-content-wrapper');
    const firstChildBlock = wrapper?.querySelector(':scope > .editor-block:first-child');
    return firstChildBlock ? getEditableContentElement(firstChildBlock) : null;
}

/**
 * Находит ближайший родительский элемент, который является блоком редактора (.editor-block)
 * или контейнером для вложенных блоков (.callout-content-wrapper, .toggle-children-wrapper).
 * @param {Node | null} element - Элемент, от которого начинается поиск вверх по дереву.
 * @returns {Element | null} - Найденный родительский блок/контейнер или null.
 */
export function findParentBlockOrContainer(element) {
    if (!element) return null;
    return element.closest('.editor-block, .callout-content-wrapper, .toggle-children-wrapper');
}

/**
 * Находит непосредственный родительский контейнер для блока (или элемента внутри блока).
 * Это может быть .editor-area, .callout-content-wrapper или .toggle-children-wrapper.
 * --- ИЗМЕНЕНО: Порядок проверки для корректной работы с вложенными контейнерами ---
 * @param {Node | null} element - Элемент, для которого ищется родительский контейнер.
 * @returns {Element | null} - Найденный контейнер или null.
 */
export function getBlockParentContainer(element) {
    if (!element) return null;

    // СНАЧАЛА ищем самый внутренний контейнер - toggle wrapper
    const toggleWrapper = element.closest('.toggle-children-wrapper');
    if (toggleWrapper) return toggleWrapper;

    // ЗАТЕМ ищем callout wrapper
    const calloutWrapper = element.closest('.callout-content-wrapper');
    if (calloutWrapper) return calloutWrapper;

    // НАКОНЕЦ ищем editor area
    const editor = element.closest('.editor-area');
    if (editor) return editor;

    return null;
}


/**
 * Проверяет, является ли редактируемый элемент блока "пустым" с точки зрения пользователя.
 * Пустым считается элемент без видимого текста и значащих HTML-элементов (кроме <br>).
 * @param {Element | null} editableElement - Редактируемый элемент контента (.block-content, .toggle-title).
 * @returns {boolean} - true, если элемент считается пустым, иначе false.
 */
export function isBlockContentEmpty(editableElement) {
    if (!editableElement) return true;

    // 1. Проверка на видимый текст
    if (editableElement.textContent.trim() !== '') {
        return false;
    }

    // 2. Проверка на HTML-содержимое (учитываем <br> и пустые обертки)
    const innerHTML = editableElement.innerHTML.toLowerCase().trim();
    if (innerHTML === '' || innerHTML === '<br>' || innerHTML === '<div><br></div>' || innerHTML === '<span><br></span>' || innerHTML === '<p><br></p>') {
        return true;
    }

    // 3. Более глубокая проверка дочерних узлов
    let hasMeaningfulNodes = false;
    const walker = document.createTreeWalker(editableElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim() !== '') {
            hasMeaningfulNodes = true;
            break;
        }
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'BR') {
            // Дополнительно проверим, не содержит ли элемент только <br>
            if (node.childNodes.length === 1 && node.firstChild.nodeType === Node.ELEMENT_NODE && node.firstChild.tagName === 'BR') {
                // Это обертка вокруг <br>, не считаем значащей
            } else {
                hasMeaningfulNodes = true;
                break;
            }
        }
    }

    return !hasMeaningfulNodes;
}

/**
 * Проверяет, находится ли курсор (схлопнутый Range) на первой визуальной строке
 * внутри редактируемого элемента. Учитывает погрешность.
 * @param {Range | null} range - Текущий Range выделения (должен быть collapsed).
 * @param {Element | null} blockContentElement - Редактируемый элемент контента.
 * @returns {boolean} - true, если курсор на первой строке, иначе false.
 */
export function isCursorOnFirstVisualLine(range, blockContentElement) {
    if (!range || !range.collapsed || !blockContentElement) return false;
    try {
        const rects = range.getClientRects();
        // Если getClientRects пуст (например, элемент скрыт), считаем, что на первой линии
        if (rects.length === 0) return true;
        const cursorRect = rects[0];
        const contentRect = blockContentElement.getBoundingClientRect();
        // Добавляем проверку на высоту контента = 0
        if (contentRect.height === 0) return true;
        // Погрешность для сравнения
        const tolerance = Math.min(8, contentRect.height * 0.4);
        return cursorRect.top <= contentRect.top + tolerance;
    } catch (e) { console.warn("Error checking first visual line:", e); return false; }
}

/**
 * Проверяет, находится ли курсор (схлопнутый Range) на последней визуальной строке
 * внутри редактируемого элемента. Учитывает погрешность.
 * @param {Range | null} range - Текущий Range выделения (должен быть collapsed).
 * @param {Element | null} blockContentElement - Редактируемый элемент контента.
 * @returns {boolean} - true, если курсор на последней строке, иначе false.
 */
export function isCursorOnLastVisualLine(range, blockContentElement) {
    if (!range || !range.collapsed || !blockContentElement) return false;
    try {
        const rects = range.getClientRects();
        // Если getClientRects пуст (например, элемент скрыт), считаем, что на последней линии
        if (rects.length === 0) return true;
        // Берем последнюю рамку из rects
        const cursorRect = rects[rects.length - 1];
        const contentRect = blockContentElement.getBoundingClientRect();
         // Добавляем проверку на высоту контента = 0
        if (contentRect.height === 0) return true;
        // Погрешность для сравнения
        const tolerance = Math.min(8, contentRect.height * 0.4);
        // Сравниваем нижнюю границу курсора с нижней границей контента
        // Или если высота контента меньше 1.5 высоты строки курсора (для однострочных блоков)
        return cursorRect.bottom >= contentRect.bottom - tolerance || contentRect.height < cursorRect.height * 1.5;
    } catch (e) { console.warn("Error checking last visual line:", e); return false; }
}

/**
 * Проверяет, находится ли курсор (схлопнутый Range) в самом начале
 * редактируемого элемента (позиция 0).
 * --- ИЗМЕНЕНО: Использует проверку текста перед курсором. ---
 * @param {Range | null} range - Текущий Range выделения (должен быть collapsed).
 * @param {Element | null} blockContentElement - Редактируемый элемент контента.
 * @returns {boolean} - true, если курсор в начале, иначе false.
 */
export function isCursorAtStartOfContent(range, blockContentElement) {
    if (!range || !range.collapsed || !blockContentElement) return false;
    try {
        // Создаем Range от начала элемента до текущей позиции курсора
        const checkRange = document.createRange();
        checkRange.selectNodeContents(blockContentElement); // Выделяем всё
        checkRange.collapse(true); // Схлопываем в начало

        // Устанавливаем конец проверяемого диапазона в позицию курсора
        // Убедимся, что узлы курсора принадлежат blockContentElement
        if (!blockContentElement.contains(range.startContainer)) {
             // console.warn("[isCursorAtStartOfContent] Range start container is not inside the block content element."); // Убрали лог
             return false; // Не можем корректно проверить
        }
        checkRange.setEnd(range.startContainer, range.startOffset);

        // Получаем текстовое содержимое этого диапазона
        const textBeforeCursor = checkRange.toString();

        // Считаем, что курсор в начале, если текст перед ним пустой (или только пробелы)
        const isEffectivelyAtStart = textBeforeCursor.trim() === '';

        return isEffectivelyAtStart;

    } catch (e) {
        console.warn("Error checking start of content:", e);
        // В случае ошибки, для безопасности считаем, что курсор не в начале
        return false;
    }
}


/**
 * Проверяет, находится ли курсор (схлопнутый Range) в самом конце
 * редактируемого элемента.
 * @param {Range | null} range - Текущий Range выделения (должен быть collapsed).
 * @param {Element | null} blockContentElement - Редактируемый элемент контента.
 * @returns {boolean} - true, если курсор в конце, иначе false.
 */
export function isCursorAtEndOfContent(range, blockContentElement) {
    if (!range || !range.collapsed || !blockContentElement) return false;
    try {
        const endRange = document.createRange();
        endRange.selectNodeContents(blockContentElement);
        endRange.collapse(false); // Схлопываем в конец
        // Сравниваем КОНЕЦ пользовательского Range с КОНЦОМ всего контента
        // Используем END_TO_END для сравнения конечных точек
        return range.compareBoundaryPoints(Range.END_TO_END, endRange) >= 0;
    } catch (e) { console.warn("Error checking end of content:", e); return false; }
}

/**
 * Обновляет видимость плейсхолдера для блока, добавляя/удаляя CSS-класс 'is-empty'
 * на редактируемый элемент контента (.block-content или .toggle-title).
 * --- ИЗМЕНЕНО: Корректно обрабатывает начальный плейсхолдер ---
 * @param {Element | null} blockElement - Элемент блока (.editor-block).
 */
export function updatePlaceholderVisibility(blockElement) {
    if (!blockElement || !blockElement.matches('.editor-block')) {
        return;
    }

    let editableElement = null;
    const blockType = blockElement.dataset.blockType || 'p'; // Считаем 'p' по умолчанию
    const isInitialPlaceholderBlock = blockElement.hasAttribute('data-initial-placeholder');

    // Находим соответствующий редактируемый элемент
    if (blockType === 'toggle') {
        editableElement = getToggleTitleElement(blockElement);
    } else if (blockType === 'callout') {
        // У Callout нет своего редактируемого контента
        return;
    } else {
        editableElement = getEditableContentElement(blockElement);
    }

    // Если не нашли редактируемый элемент для этого типа блока
    if (!editableElement) {
        return;
    }

    // Проверяем, пуст ли элемент
    const isEmpty = isBlockContentEmpty(editableElement);
    const placeholderClass = 'is-empty'; // CSS класс для показа плейсхолдера

    // --- ИЗМЕНЕННАЯ ЛОГИКА УСЛОВИЯ ---
    let shouldShowPlaceholder = false;

    if (isInitialPlaceholderBlock) {
        // Если это блок с начальным плейсхолдером, показать если пуст (фокус не важен)
        shouldShowPlaceholder = isEmpty;
    } else if (blockType === 'p') {
        // Для обычных параграфов: показать только если пуст И имеет фокус
        const hasFocus = document.activeElement === editableElement;
        shouldShowPlaceholder = isEmpty && hasFocus;
    } else {
        // Для остальных типов (не 'p' и не начальный): показать если пуст (старая логика)
        shouldShowPlaceholder = isEmpty;
    }
    // --- КОНЕЦ ИЗМЕНЕННОЙ ЛОГИКИ ---

    // Добавляем или удаляем класс
    editableElement.classList.toggle(placeholderClass, shouldShowPlaceholder);
}