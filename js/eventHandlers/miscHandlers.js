// js/eventHandlers/miscHandlers.js
// Обработчики для прочих событий: клик по чекбоксу, индикатору toggle, получение фокуса.
// --- ИЗМЕНЕНО: handleBlockFocus убирает атрибут data-initial-placeholder ---
// --- ИЗМЕНЕНО: Логика поиска блока в handleCheckboxClick, добавлены логи ---

import { saveDocumentContent, debouncedSave } from '../documentManager.js';
// --- УБРАН импорт флагов начального плейсхолдера ---
import { getSelectedBlockIds, setSelectAllState } from '../state.js';
import { clearBlockSelection } from '../selectionManager.js';
import { updatePlaceholderVisibility } from '../blockUtils.js';

/**
 * Обрабатывает клик по чекбоксу в блоке 'todo'.
 * Переключает состояние data-checked и сохраняет документ.
 * --- УБРАНА ПРОВЕРКА e.target, используется e.target.closest() ---
 * @param {Event} e - Событие click.
 */
export function handleCheckboxClick(e) {
    console.log('[handleCheckboxClick] >>> Start <<<'); // ЛОГ: Начало функции
    e.stopPropagation(); // Останавливаем всплытие события

    // Находим родительский блок todo НАПРЯМУЮ от e.target
    // Функция вызывается только если init.js определил клик как релевантный
    const blockElement = e.target.closest('.editor-block[data-block-type="todo"]');
    console.log('[handleCheckboxClick] Found blockElement via e.target.closest():', blockElement); // ЛОГ: Найденный блок

    if (!blockElement) {
        // Эта проверка на всякий случай, хотя init.js уже должен был это сделать
        console.log('[handleCheckboxClick] Could not find parent todo block from e.target. Ignoring.');
        return; // Клик не на чекбоксе todo-блока
    }

    const blockId = blockElement.dataset.blockId;
    console.log(`[handleCheckboxClick] Block ID: ${blockId}`); // ЛОГ: ID блока

    // Получаем текущее состояние (строка 'true' или 'false' или null)
    const currentState = blockElement.dataset.checked === 'true';
    console.log(`[handleCheckboxClick] Current 'data-checked' state (boolean): ${currentState}`); // ЛОГ: Текущее состояние

    // Инвертируем и устанавливаем новое состояние
    const newStateString = String(!currentState);
    console.log(`[handleCheckboxClick] Setting 'data-checked' attribute to: "${newStateString}"`); // ЛОГ: Новое состояние (строка)
    blockElement.setAttribute('data-checked', newStateString);

    // ПРОВЕРЯЕМ АТРИБУТ СРАЗУ ПОСЛЕ УСТАНОВКИ
    const attributeAfterSet = blockElement.getAttribute('data-checked');
    console.log(`[handleCheckboxClick] Attribute value IMMEDIATELY AFTER setAttribute: "${attributeAfterSet}"`); // ЛОГ: Проверка атрибута

    // Сохраняем документ сразу, т.к. изменение состояния важно
    console.log('[handleCheckboxClick] Calling saveDocumentContent()...'); // ЛОГ: Перед сохранением
    saveDocumentContent();
    console.log('[handleCheckboxClick] saveDocumentContent() finished.'); // ЛОГ: После сохранения

    // ПРОВЕРЯЕМ АТРИБУТ ПОСЛЕ СОХРАНЕНИЯ (на всякий случай)
    const attributeAfterSave = blockElement.getAttribute('data-checked');
    console.log(`[handleCheckboxClick] Attribute value AFTER saveDocumentContent: "${attributeAfterSave}"`); // ЛОГ: Проверка атрибута после сохранения

    console.log('[handleCheckboxClick] >>> End <<<'); // ЛОГ: Конец функции
}


/**
 * Обрабатывает клик по индикатору раскрытия/сворачивания в блоке 'toggle'.
 * Переключает состояние data-is-open и сохраняет документ (с задержкой).
 * @param {Event} e - Событие click.
 */
export function handleToggleIndicatorClick(e) {
    //  console.log('[handleToggleIndicatorClick] Triggered, target:', e.target); // DIAG
     const indicator = e.target; // Клик на div.toggle-indicator
     // Находим родительский блок toggle
     const toggleBlock = indicator.closest('.editor-block[data-block-type="toggle"]');

     if (toggleBlock) {
         e.stopPropagation(); // Останавливаем всплытие, чтобы не вызвать выделение блока
         const currentState = toggleBlock.dataset.isOpen === 'true';
         // Инвертируем и устанавливаем новое состояние
         toggleBlock.setAttribute('data-is-open', String(!currentState));
        //  console.log(`[handleToggleIndicatorClick] Toggled block ${toggleBlock.dataset.blockId} open state to: ${!currentState}`); // DIAG
         // Сохраняем состояние с задержкой, т.к. это не критичное изменение данных
         debouncedSave();
     } else {
        //  console.log('[handleToggleIndicatorClick] Target is not inside a toggle block.');
     }
}


/**
 * Обрабатывает получение фокуса редактируемым элементом блока.
 * Сбрасывает выделение блоков, если фокус не на выделенном блоке.
 * Сбрасывает состояние Cmd+A.
 * Убирает начальный плейсхолдер (атрибут) и обновляет видимость стандартного.
 * @param {FocusEvent} e - Событие focus.
 */
export function handleBlockFocus(e) {
    // console.log('[handleBlockFocus] Triggered, target:', e.target); // DIAG
    const focusedElement = e.target; // Элемент, получивший фокус (contenteditable)
    const currentBlock = focusedElement.closest('.editor-block'); // Блок, в котором находится фокус

    setSelectAllState(0); // Сбрасываем состояние "выделить всё" при любом фокусе

    if (!currentBlock) {
        //  console.log('[handleBlockFocus] Focus target is not inside an .editor-block.');
         return; // Фокус не внутри блока редактора
    }

    // --- ИЗМЕНЕНО: Убираем атрибут при фокусе, если он был ---
    if (currentBlock.hasAttribute('data-initial-placeholder')) {
        console.log('[handleBlockFocus] Removing initial placeholder attribute on focus.');
        currentBlock.removeAttribute('data-initial-placeholder');
        // Флаг состояния больше не используется
    }
    // --- КОНЕЦ ИЗМЕНЕНИЯ ---

    // Обновляем видимость плейсхолдера (теперь покажет стандартный, если нужно)
    updatePlaceholderVisibility(currentBlock);


    const currentBlockId = currentBlock.dataset.blockId;
    const selectedIds = getSelectedBlockIds();

    // Если есть выделенные блоки и текущий блок НЕ входит в их число
    if (selectedIds.size > 0 && !selectedIds.has(currentBlockId)) {
        let isInsideSelectedContainer = false;
        // Проверяем, не находится ли текущий блок ВНУТРИ выделенного контейнера (callout/toggle)
        const parentWrapper = currentBlock.parentElement;
        if (parentWrapper?.matches('.callout-content-wrapper, .toggle-children-wrapper')) {
            const parentBlock = parentWrapper.closest('.editor-block');
            if (parentBlock && selectedIds.has(parentBlock.dataset.blockId)) {
                // console.log('[handleBlockFocus] Focus is inside a selected container, selection maintained.'); // DIAG
                isInsideSelectedContainer = true; // Фокус внутри выделенного контейнера - НЕ сбрасываем выделение
            }
        }

        // Сбрасываем выделение блоков, только если фокус не внутри выделенного контейнера
        if (!isInsideSelectedContainer) {
            // console.log('[handleBlockFocus] Focus moved outside selected blocks, clearing selection.'); // DIAG
            clearBlockSelection(); // Используем функцию из selectionManager
        }
    } else {
        //  console.log('[handleBlockFocus] Focus is on an already selected block or no blocks were selected.'); // DIAG
    }
}