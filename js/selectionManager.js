// js/selectionManager.js
// Управление выделением блоков (Ctrl/Cmd+Click, Shift+Click, Lasso)
// и выделением текста между блоками.
// --- ВЕРСИЯ 4: Без изменений для кросс-блочного форматирования (логика в других файлах) ---

import { editorArea, mainContent, getSelectionRectangleElement, setSelectionRectangleElement } from './domElements.js';
import {
    getSelectedBlockIds, hasSelectedBlockId, addSelectedBlockId, removeSelectedBlockId,
    clearSelectedBlockIds as clearSelectionState,
    getSelectionAnchorId, setSelectionAnchorId, getSelectionFocusId, setSelectionFocusId,
    getIsSelectingArea, setIsSelectingArea, getSelectionRectStart, setSelectionRectStart,
    getIsMouseSelectingText, setIsMouseSelectingText, // Геттер/сеттер для флага используется
    setSelectAllState, setLastCursorXPosition
} from './state.js';
// Дополнительные импорты
import { updateListAttributes } from './listManager.js';
import { updateAllQuoteConnections } from './quoteManager.js';
import { saveDocumentContent } from './documentManager.js';

// --- Глобальные переменные модуля для кросс-блочного выделения текста ---
// Храним начальную точку (anchor) выделения
let crossBlockAnchorNode = null;
let crossBlockAnchorOffset = 0;

// --- Внутренние Вспомогательные Функции ---

/**
 * Получает массив ID блоков верхнего уровня в текущем порядке их следования в DOM.
 * @returns {Array<string>} Массив строковых ID блоков.
 */
export function getBlockIdsInOrder() {
    if (!editorArea) return [];
    return Array.from(editorArea.children)
        .filter(el => el.matches('.editor-block') && el.dataset.blockId)
        .map(el => el.dataset.blockId);
}

/**
 * Обновляет визуальное представление выделенных блоков (добавляет/удаляет класс).
 */
export function updateSelectionVisuals() {
    if (!editorArea) return;
    const currentSelectedIds = getSelectedBlockIds();
    // Обрабатываем блоки верхнего уровня
    editorArea.querySelectorAll(':scope > .editor-block').forEach(block => {
        const blockId = block.dataset.blockId;
        if (!blockId) return;
        const isSelected = currentSelectedIds.has(blockId);
        block.classList.toggle('block-selected', isSelected);
    });
    // Обрабатываем вложенные блоки (снимаем выделение, если родитель выделен)
     editorArea.querySelectorAll('.callout-content-wrapper > .editor-block, .toggle-children-wrapper > .editor-block').forEach(block => {
         const blockId = block.dataset.blockId;
         if (!blockId) return;
         const parentBlock = block.closest('.editor-block[data-block-type="callout"], .editor-block[data-block-type="toggle"]');
         const parentId = parentBlock?.dataset.blockId;
         const isParentSelected = parentId ? currentSelectedIds.has(parentId) : false;
         // Если родитель выделен, убираем выделение с дочернего элемента
         if (isParentSelected && block.classList.contains('block-selected')) {
              block.classList.remove('block-selected');
         }
         // Дополнительно: Если родитель НЕ выделен, но дочерний выделен - это некорректно, убираем
         // (Хотя такое состояние не должно возникать при правильной логике)
         // else if (!isParentSelected && block.classList.contains('block-selected')) {
         //     block.classList.remove('block-selected');
         //     removeSelectedBlockId(blockId); // Убираем и из состояния
         // }
     });
}

/**
 * Выделяет диапазон блоков между anchorId и focusId.
 * @param {string} anchorId - ID начального блока выделения.
 * @param {string} focusId - ID конечного блока выделения.
 */
function selectRange(anchorId, focusId) {
    clearSelectionState(); // Очищаем предыдущее выделение блоков
    const allTopLevelIds = getBlockIdsInOrder();
    const anchorIndex = allTopLevelIds.indexOf(anchorId);
    const focusIndex = allTopLevelIds.indexOf(focusId);

    // Если один из ID не найден среди блоков верхнего уровня
    if (anchorIndex === -1 || focusIndex === -1) {
        console.warn("selectRange: Anchor or Focus ID not found in top-level blocks.", { anchorId, focusId });
        // Пытаемся выделить хотя бы один из существующих блоков
        if (focusIndex !== -1 && allTopLevelIds.includes(focusId)) {
            addSelectedBlockId(focusId);
            setSelectionFocusId(focusId);
            setSelectionAnchorId(focusId);
        } else if (anchorIndex !== -1 && allTopLevelIds.includes(anchorId)) {
            addSelectedBlockId(anchorId);
            setSelectionFocusId(anchorId);
            setSelectionAnchorId(anchorId);
        } else { // Ни один не найден
            setSelectionFocusId(null);
            setSelectionAnchorId(null);
        }
        updateSelectionVisuals();
        return;
    }

    // Определяем начальный и конечный индексы диапазона
    const startIndex = Math.min(anchorIndex, focusIndex);
    const endIndex = Math.max(anchorIndex, focusIndex);

    // Добавляем все блоки в диапазоне в выделение
    for (let i = startIndex; i <= endIndex; i++) {
        if (allTopLevelIds[i]) {
            addSelectedBlockId(allTopLevelIds[i]);
        }
    }

    // Устанавливаем anchor и focus в состоянии
    setSelectionAnchorId(anchorId);
    setSelectionFocusId(focusId);

    // Обновляем визуальное представление
    updateSelectionVisuals();
}

// --- Экспортируемые Функции Управления Выделением ---

/**
 * Сбрасывает выделение блоков.
 * @param {object} options - Опции.
 * @param {boolean} [options.updateVisuals=true] - Обновлять ли визуальное представление.
 */
export function clearBlockSelection(options = { updateVisuals: true }) {
    clearSelectionState(); // Очищаем состояние
    if (options.updateVisuals) {
        updateSelectionVisuals(); // Обновляем DOM
    }
}

/**
 * Обрабатывает Cmd/Ctrl+Click и Shift+Click на блоках верхнего уровня для выделения.
 * Вызывается в контексте кликнутого блока (.call(blockElement, e)).
 * @param {MouseEvent} e - Событие мыши.
 */
export function handleBlockCmdCtrlClick(e) {
    const clickedBlock = this; // 'this' - это блок, на котором произошел клик
    if (!clickedBlock || !clickedBlock.matches('.editor-block')) {
        console.warn("handleBlockCmdCtrlClick: 'this' is not a valid block element.");
        return;
    }
    // Обрабатываем только клики на блоках ВЕРХНЕГО УРОВНЯ
    if (clickedBlock.parentElement !== editorArea) {
        console.warn("Cmd/Ctrl click handler called on non-top-level block:", clickedBlock);
        return;
    }
    // Проверяем, зажаты ли нужные клавиши
    if (!(e.metaKey || e.ctrlKey || e.shiftKey)) {
        return; // Обычный клик без модификаторов
    }

    e.preventDefault(); // Предотвращаем стандартное выделение текста
    e.stopPropagation(); // Останавливаем всплытие

    const clickedBlockId = clickedBlock.dataset.blockId;
    if (!clickedBlockId) {
        console.warn("handleBlockCmdCtrlClick: Block has no ID.");
        return;
    }

    // Сбрасываем выделение текста браузера и фокус
    window.getSelection()?.removeAllRanges();
    if (document.activeElement && editorArea?.contains(document.activeElement) && document.activeElement.blur) {
        document.activeElement.blur();
    }

    const alreadySelected = hasSelectedBlockId(clickedBlockId);
    const currentAnchorId = getSelectionAnchorId();

    // --- Логика Shift+Click ---
    if (e.shiftKey && currentAnchorId) {
        // Если есть anchor, выделяем диапазон от anchor до текущего блока
        selectRange(currentAnchorId, clickedBlockId);
    } else if (e.shiftKey && !currentAnchorId) {
        // Если anchor нет, просто выделяем текущий блок и делаем его anchor
        clearSelectionState();
        addSelectedBlockId(clickedBlockId);
        setSelectionAnchorId(clickedBlockId);
        setSelectionFocusId(clickedBlockId);
    }
    // --- Логика Cmd/Ctrl+Click ---
    else if (e.metaKey || e.ctrlKey) {
        if (alreadySelected) {
            // Если кликнули на уже выделенный блок
            if (getSelectedBlockIds().size === 1) {
                // Если это был единственный выделенный блок, снимаем выделение
                clearSelectionState();
            } else {
                // Иначе убираем его из выделения
                removeSelectedBlockId(clickedBlockId);
                // Пересчитываем anchor и focus на основе оставшихся
                const remainingTopLevelIds = getBlockIdsInOrder().filter(id => hasSelectedBlockId(id));
                const newAnchor = remainingTopLevelIds[0] || null;
                const newFocus = remainingTopLevelIds[remainingTopLevelIds.length - 1] || newAnchor;
                setSelectionAnchorId(newAnchor);
                setSelectionFocusId(newFocus);
                // Если ничего не осталось, сбрасываем anchor/focus
                if (remainingTopLevelIds.length === 0) {
                    setSelectionAnchorId(null);
                    setSelectionFocusId(null);
                }
            }
        } else {
            // Если кликнули на невыделенный блок, добавляем его к выделению
            addSelectedBlockId(clickedBlockId);
            setSelectionFocusId(clickedBlockId); // Делаем его focus
            // Если anchor не был установлен или это первый выделенный блок, делаем его anchor
            if (!currentAnchorId || getSelectedBlockIds().size === 1) {
                setSelectionAnchorId(clickedBlockId);
            }
        }
    }

    updateSelectionVisuals(); // Обновляем DOM
    setSelectAllState(0); // Сбрасываем состояние Cmd+A
}


// --- Логика выделения рамкой (Lasso) ---

/**
 * Обработчик mousedown для начала выделения рамкой.
 * @param {MouseEvent} e
 */
function onAreaSelectMouseDown(e) {
    // Игнорируем клик по ручке DND
    if (e.target.closest('.drag-handle')) return;
    // Игнорируем не левую кнопку мыши
    if (e.button !== 0) return;

    // Определяем, где был клик
    const clickedOnSidebar = e.target.closest('.sidebar');
    const clickedOnTitleBar = e.target.closest('.document-title-bar');
    const clickedOnScrollbar = mainContent && (e.offsetX >= mainContent.clientWidth || e.offsetY >= mainContent.clientHeight);
    const clickedOnButtonOrInput = e.target.closest('button, input, a');
    const clickedOnEditable = e.target.closest('[contenteditable="true"]');
    const clickedOnBlockControls = e.target.closest('.block-checkbox, .callout-icon, .toggle-indicator, .drag-handle');
    const clickedOnBlockItself = e.target.closest('.editor-block');
    // Проверяем, был ли это Cmd/Ctrl/Shift+Click на блоке верхнего уровня (обрабатывается отдельно)
    const isModKeyTopLevelBlockClick = clickedOnBlockItself && clickedOnBlockItself.parentElement === editorArea && (e.metaKey || e.ctrlKey || e.shiftKey);

    // НЕ начинаем лассо, если:
    // - Уже идет выделение текста мышью
    // - Клик был на сайдбаре, заголовке, скроллбаре, кнопке/инпуте
    // - Клик был на редактируемом контенте, элементах управления блока
    // - Это был Cmd/Ctrl/Shift+Click на блоке верхнего уровня
    if (getIsMouseSelectingText() || clickedOnSidebar || clickedOnTitleBar || clickedOnScrollbar || clickedOnButtonOrInput || clickedOnEditable || clickedOnBlockControls || isModKeyTopLevelBlockClick) {
        return;
    }

    // Если все проверки пройдены, начинаем выделение рамкой
    e.preventDefault(); // Предотвращаем стандартное поведение (например, выделение текста на странице)
    setIsSelectingArea(true);
    setSelectionRectStart(e.pageX, e.pageY); // Сохраняем начальные координаты

    // Если не зажат Shift, сбрасываем предыдущее выделение блоков
    if (!e.shiftKey) {
        clearBlockSelection({ updateVisuals: false }); // Не обновляем DOM сразу
    }

    // Показываем и позиционируем рамку выделения
    const selectionRect = getSelectionRectangleElement();
    if (selectionRect) {
        Object.assign(selectionRect.style, {
            left: `${e.pageX}px`,
            top: `${e.pageY}px`,
            width: '0px',
            height: '0px',
            display: 'block'
        });
    }

    // Добавляем слушатели на движение и отпускание мыши
    document.addEventListener('mousemove', onAreaSelectMouseMove);
    document.addEventListener('mouseup', onAreaSelectMouseUp);
}

/**
 * Обработчик mousemove во время выделения рамкой.
 * @param {MouseEvent} e
 */
function onAreaSelectMouseMove(e) {
    if (!getIsSelectingArea()) return; // Если выделение не активно, выходим

    e.preventDefault(); // Предотвращаем выделение текста ВО ВРЕМЯ рисования рамки

    const startPos = getSelectionRectStart();
    const currentX = e.pageX;
    const currentY = e.pageY;

    // Рассчитываем размеры и позицию рамки
    const rectX = Math.min(startPos.x, currentX);
    const rectY = Math.min(startPos.y, currentY);
    const rectWidth = Math.abs(currentX - startPos.x);
    const rectHeight = Math.abs(currentY - startPos.y);

    // Обновляем стиль рамки
    const selectionRect = getSelectionRectangleElement();
    if (!selectionRect) { // На всякий случай, если элемент пропал
        setIsSelectingArea(false);
        document.removeEventListener('mousemove', onAreaSelectMouseMove);
        document.removeEventListener('mouseup', onAreaSelectMouseUp);
        return;
    }
    Object.assign(selectionRect.style, {
        left: `${rectX}px`,
        top: `${rectY}px`,
        width: `${rectWidth}px`,
        height: `${rectHeight}px`
    });

    // Определяем, какие блоки пересекаются с рамкой
    const selectionRectBounds = selectionRect.getBoundingClientRect();
    const newlySelectedTopLevelIds = new Set(getSelectedBlockIds()); // Начинаем с уже выделенных (для Shift)
    const originalSelectedIds = getSelectedBlockIds(); // Запоминаем, что было выделено до этого шага

    if (editorArea) {
        editorArea.querySelectorAll(':scope > .editor-block').forEach(block => {
            const blockRect = block.getBoundingClientRect();
            const blockId = block.dataset.blockId;
            if (!blockId) return;

            // Проверка пересечения прямоугольников
            const intersects = !(
                blockRect.right < selectionRectBounds.left ||
                blockRect.left > selectionRectBounds.right ||
                blockRect.bottom < selectionRectBounds.top ||
                blockRect.top > selectionRectBounds.bottom
            );

            if (intersects) {
                newlySelectedTopLevelIds.add(blockId); // Добавляем пересекающийся блок
            }
            // При выделении рамкой обычно не снимают выделение с блоков,
            // которые перестали пересекаться, до mouseup.
            // Но если нужно динамическое снятие, можно добавить else { newlySelectedTopLevelIds.delete(blockId); }
        });
    }

    // Обновляем состояние и DOM, только если набор выделенных блоков изменился
    if (newlySelectedTopLevelIds.size !== originalSelectedIds.size || ![...originalSelectedIds].every(id => newlySelectedTopLevelIds.has(id))) {
        clearSelectionState(); // Очищаем старое состояние
        newlySelectedTopLevelIds.forEach(id => addSelectedBlockId(id)); // Добавляем новые ID
        // Обновляем anchor и focus на основе порядка в DOM
        const orderedSelectedIds = getBlockIdsInOrder().filter(id => newlySelectedTopLevelIds.has(id));
        setSelectionAnchorId(orderedSelectedIds[0] || null);
        setSelectionFocusId(orderedSelectedIds[orderedSelectedIds.length - 1] || null);
        updateSelectionVisuals(); // Обновляем DOM
    }
}

/**
 * Обработчик mouseup для завершения выделения рамкой.
 * @param {MouseEvent} e
 */
function onAreaSelectMouseUp(e) {
    if (!getIsSelectingArea()) return; // Если выделение не активно, выходим

    setIsSelectingArea(false); // Завершаем режим выделения рамкой

    // Скрываем рамку
    const selectionRect = getSelectionRectangleElement();
    if (selectionRect) {
        selectionRect.style.display = 'none';
    }

    // Удаляем слушатели
    document.removeEventListener('mousemove', onAreaSelectMouseMove);
    document.removeEventListener('mouseup', onAreaSelectMouseUp);

    // Финально устанавливаем anchor и focus на основе выделенных блоков
    const finalSelectedIds = getSelectedBlockIds();
    const finalSelectedIdsOrdered = getBlockIdsInOrder().filter(id => finalSelectedIds.has(id));
    setSelectionAnchorId(finalSelectedIdsOrdered[0] || null);
    setSelectionFocusId(finalSelectedIdsOrdered[finalSelectedIdsOrdered.length - 1] || null);

    // Финальное обновление DOM (на случай, если в mousemove не обновилось)
    updateSelectionVisuals();
    setSelectAllState(0); // Сбрасываем состояние Cmd+A
}

/**
 * Инициализирует функционал выделения рамкой.
 */
export function initializeAreaSelection() {
    // Проверяем, создан ли уже элемент рамки
    if (document.getElementById('selection-rectangle')) return;

    // Создаем элемент рамки
    const rectElement = document.createElement('div');
    rectElement.id = 'selection-rectangle';
    document.body.appendChild(rectElement);
    setSelectionRectangleElement(rectElement); // Сохраняем ссылку на элемент

    // Добавляем слушатель mousedown на основной контент
    if (mainContent) {
        mainContent.addEventListener('mousedown', onAreaSelectMouseDown);
    } else {
        console.error("SelectionManager: mainContent not found for area selection initialization.");
    }
}

// --- Логика выделения текста между блоками ---

/**
 * Начинает процесс выделения текста между блоками.
 * Запоминает начальную точку выделения (anchor).
 * Вызывается из init.js при mousedown в editorArea.
 * @param {MouseEvent} e
 */
export function handleTextSelectionMouseDown(e) {
    // Игнорируем клики на элементах управления, с модификаторами, правую кнопку
    if (e.target.closest('.block-checkbox, .callout-icon, .toggle-indicator, .drag-handle')) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.button !== 0) return;
    // Игнорируем, если уже идет выделение рамкой
    if (getIsSelectingArea()) return;

    // Проверяем, что клик был внутри редактируемого элемента в editorArea
    const editableElement = e.target.closest('[contenteditable="true"]');
    if (!editableElement || !editorArea?.contains(editableElement)) {
        setIsMouseSelectingText(false); // Убеждаемся, что флаг сброшен
        return;
    }

    // console.log("handleTextSelectionMouseDown: Initiating cross-block text selection.");
    setIsMouseSelectingText(true); // Устанавливаем флаг начала выделения текста

    try {
        // Даем браузеру мгновение на установку начального выделения от клика
        // Это важно, чтобы selection.anchorNode/Offset были установлены корректно
        setTimeout(() => {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                // Запоминаем anchor ТОЛЬКО ПОСЛЕ небольшой задержки
                crossBlockAnchorNode = selection.anchorNode;
                crossBlockAnchorOffset = selection.anchorOffset;
                 // console.log("handleTextSelectionMouseDown: Anchor set", crossBlockAnchorNode, crossBlockAnchorOffset);

                // Вешаем слушатели на документ ТОЛЬКО если удалось захватить anchor
                document.addEventListener('mousemove', handleTextSelectionMouseMove);
                document.addEventListener('mouseup', handleTextSelectionMouseUp);
            } else {
                // Если selection пропал за время setTimeout (маловероятно, но возможно)
                setIsMouseSelectingText(false);
                crossBlockAnchorNode = null;
            }
        }, 0); // Нулевая задержка для помещения в конец очереди событий
    } catch (err) {
        console.error("Error setting initial text selection anchor:", err);
        setIsMouseSelectingText(false);
        crossBlockAnchorNode = null;
        // На всякий случай удаляем слушатели, если они были добавлены до ошибки
        document.removeEventListener('mousemove', handleTextSelectionMouseMove);
        document.removeEventListener('mouseup', handleTextSelectionMouseUp);
    }
}

/**
 * Обрабатывает движение мыши во время выделения текста между блоками.
 * Использует selection.setBaseAndExtent для корректной установки границ.
 * @param {MouseEvent} e
 */
function handleTextSelectionMouseMove(e) {
    // Работаем только если флаг установлен и anchor захвачен
    if (!getIsMouseSelectingText() || !crossBlockAnchorNode) return;

    // НЕ используем preventDefault(), чтобы разрешить скролл страницы и другие действия
    // e.preventDefault();

    let currentFocusNode = null;
    let currentFocusOffset = 0;

    try {
        // Пытаемся получить позицию каретки (курсора) под указателем мыши
        // document.caretPositionFromPoint - стандартный метод
        if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
            if (pos) {
                currentFocusNode = pos.offsetNode;
                currentFocusOffset = pos.offset;
            }
        } else if (document.caretRangeFromPoint) { // Fallback для старых браузеров
            const range = document.caretRangeFromPoint(e.clientX, e.clientY);
            if (range) {
                 currentFocusNode = range.startContainer;
                 currentFocusOffset = range.startOffset;
            }
        }
    } catch(err) {
        // Игнорируем ошибки получения позиции, если курсор вне текста
        // (например, над пустым местом или за пределами окна)
        // console.warn("Could not get caret position from point:", err);
        return; // Прерываем обработку этого события mousemove
    }

    // Если не удалось получить позицию или она вне редактора, выходим
    if (!currentFocusNode || !editorArea.contains(currentFocusNode)) {
        return;
    }

    const selection = window.getSelection();
    if (!selection) return; // На всякий случай

    try {
        // Используем selection.setBaseAndExtent
        // Base = anchor (где начали выделение)
        // Extent = focus (где курсор мыши сейчас)
        // Этот метод сам обрабатывает направление выделения (вперед/назад)
        selection.setBaseAndExtent(
            crossBlockAnchorNode,
            crossBlockAnchorOffset,
            currentFocusNode,
            currentFocusOffset
        );
    } catch (err) {
        // Ошибки могут возникать при попытке выделить "некорректные" диапазоны
        // (например, пересекающие границы элементов неожиданным образом).
        // Лучше их игнорировать, чем прерывать весь процесс выделения.
        // console.warn("Error setting base and extent:", err);
    }
}

/**
 * Завершает процесс выделения текста между блоками (при mouseup).
 * @param {MouseEvent} e
 */
function handleTextSelectionMouseUp(e) {
    // Работаем только если флаг был установлен
    if (!getIsMouseSelectingText()) return;
    // console.log("handleTextSelectionMouseUp: Finishing cross-block text selection.");

    setIsMouseSelectingText(false); // Сбрасываем флаг

    // Сбрасываем сохраненную начальную точку
    crossBlockAnchorNode = null;
    crossBlockAnchorOffset = 0;

    // Удаляем слушатели с документа, так как выделение завершено
    document.removeEventListener('mousemove', handleTextSelectionMouseMove);
    document.removeEventListener('mouseup', handleTextSelectionMouseUp);

    // Сбрасываем состояние Cmd+A и позицию курсора X (на всякий случай)
    setSelectAllState(0);
    setLastCursorXPosition(null);

    // Теперь можно показать контекстное меню текста, если нужно.
    // Это делается в textContextMenuController по событию mouseup документа,
    // которое сработает после этого обработчика.
}


/**
 * Перемещает выделенные блоки вверх или вниз.
 * @param {-1 | 1} direction - Направление (-1 вверх, 1 вниз).
 */
export function moveSelectedBlocks(direction) {
    if (!editorArea) { console.error("moveSelectedBlocks: editorArea not found."); return; }

    const currentSelectedIds = getSelectedBlockIds();
    const selectedBlockElements = [];
    const allTopLevelElements = Array.from(editorArea.children).filter(el => el.matches('.editor-block'));

    // Собираем DOM-элементы выделенных блоков в порядке их следования
    allTopLevelElements.forEach(block => {
        if (block.dataset.blockId && currentSelectedIds.has(block.dataset.blockId)) {
            selectedBlockElements.push(block);
        }
    });

    // Если нет выделенных блоков или они не найдены в DOM
    if (selectedBlockElements.length === 0) {
        console.log("Move canceled: No valid top-level blocks selected to move.");
        clearBlockSelection(); // Сбрасываем выделение на всякий случай
        return;
    }

    const firstSelected = selectedBlockElements[0];
    const lastSelected = selectedBlockElements[selectedBlockElements.length - 1];
    let canMove = false;
    let anchorNode = null; // Узел, перед которым будем вставлять

    try {
        if (direction === -1) { // Движение вверх
            anchorNode = firstSelected.previousElementSibling; // Узел перед первым выделенным
            if (anchorNode) {
                // Перемещаем все выделенные блоки ПЕРЕД anchorNode
                selectedBlockElements.forEach(block => {
                    editorArea.insertBefore(block, anchorNode);
                });
                canMove = true;
            } else {
                console.log("Cannot move blocks further up."); // Уже в самом верху
            }
        } else { // Движение вниз (direction === 1)
            anchorNode = lastSelected.nextElementSibling; // Узел после последнего выделенного
            if (anchorNode) {
                 // Перемещаем все выделенные блоки ПЕРЕД anchorNode
                selectedBlockElements.forEach(block => {
                    editorArea.insertBefore(block, anchorNode);
                });
                canMove = true;
            } else {
                 // Если anchorNode === null (последний элемент), перемещаем в конец
                 selectedBlockElements.forEach(block => {
                     editorArea.appendChild(block);
                 });
                 canMove = true;
                 // console.log("Cannot move blocks further down."); // Уже в самом низу - но мы можем переместить в конец
            }
        }
    } catch (error) {
        console.error("Error during block move DOM manipulation:", error);
        return; // Прерываем в случае ошибки DOM
    }

    // Если перемещение произошло, сохраняем и обновляем UI
    if (canMove) {
        // Плавно прокручиваем к первому перемещенному блоку
        selectedBlockElements[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        // Сохраняем изменения и обновляем связанные элементы
        saveDocumentContent();
        updateListAttributes();
        updateAllQuoteConnections();
    }
}
