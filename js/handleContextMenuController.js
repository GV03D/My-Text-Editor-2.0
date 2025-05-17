// js/handleContextMenuController.js
// Управляет контекстным меню, вызываемым кликом по ручке блока
// --- ДОБАВЛЕНО: Иконки для пунктов основного меню ---

import { editorArea } from './domElements.js';
import { getSelectedBlockIds, getActiveDocId } from './state.js';
import { blockTypes as slashMenuItemsData } from './slashMenuController.js'; // Импортируем данные для подменю
import { changeBlockType } from './blockFormatter.js';
import { saveDocumentContent } from './documentManager.js';
import { updateListAttributes } from './listManager.js';
import { updateAllQuoteConnections, updateQuoteConnectionsAround, updateQuoteConnection } from './quoteManager.js';
import { createBlockElement } from './blockFactory.js';
import { getBlockParentContainer, getEditableContentElement, getToggleTitleElement, getCalloutPrimaryContentElement, updatePlaceholderVisibility } from './blockUtils.js';
import { getBlockIdsInOrder, clearBlockSelection, updateSelectionVisuals } from './selectionManager.js';
import { focusAtStart } from './utils.js';
// --- ИМПОРТ checkAndSetInitialPlaceholderState ---
// (Если он нужен в performDelete, нужно добавить его импорт)
import { checkAndSetInitialPlaceholderState } from './documentManager.js';


// --- Состояние модуля ---
let mainMenuElement = null;
let subMenuElement = null;
let targetBlockElement = null; // Блок, для которого открыто меню
let isMainMenuVisible = false;
let isSubMenuVisible = false;
let submenuTimeoutId = null; // Для задержки скрытия подменю

const SUBMENU_SHOW_DELAY = 150; // мс - задержка перед показом подменю при наведении
const SUBMENU_HIDE_DELAY = 250; // мс - задержка перед скрытием подменю при уводе курсора

// --- Конфигурация основного меню (с иконками) ---
const mainMenuItems = [
    { action: 'delete',      label: 'Удалить',        icon: 'Icons/Delete.svg' },         // <--- Иконка добавлена
    { action: 'duplicate',   label: 'Дублировать',    icon: 'Icons/Duplicate.svg' },      // <--- Иконка добавлена
    { action: 'change-type', label: 'Изменить блок',  icon: 'Icons/Change Block.svg', hasSubmenu: true } // <--- Иконка добавлена
];

// --- Вспомогательные функции ---

/**
 * Создает и добавляет DOM-элементы меню (основного и подменю) в body.
 */
function createMenuElements() {
    if (!mainMenuElement) {
        mainMenuElement = document.createElement('div');
        mainMenuElement.id = 'handle-context-menu';
        mainMenuElement.className = 'handle-menu'; // Используйте свой класс CSS
        document.body.appendChild(mainMenuElement);
    }
    if (!subMenuElement) {
        subMenuElement = document.createElement('div');
        subMenuElement.id = 'handle-context-submenu';
        subMenuElement.className = 'handle-menu submenu'; // Используйте свой класс CSS
        document.body.appendChild(subMenuElement);
    }
}

/**
 * Заполняет основное меню элементами.
 */
function populateMainMenu() {
    if (!mainMenuElement) return;
    mainMenuElement.innerHTML = ''; // Очищаем

    mainMenuItems.forEach(itemData => {
        const menuItem = document.createElement('div');
        menuItem.className = 'handle-menu-item'; // Используйте свой класс CSS
        menuItem.dataset.action = itemData.action;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'handle-menu-icon'; // Используйте свой класс CSS
        // --- Используем путь из itemData.icon ---
        iconSpan.innerHTML = `<img src="${itemData.icon}" alt="">`;

        const labelSpan = document.createElement('span');
        labelSpan.className = 'handle-menu-label'; // Используйте свой класс CSS
        labelSpan.textContent = itemData.label;

        menuItem.appendChild(iconSpan);
        menuItem.appendChild(labelSpan);

        if (itemData.hasSubmenu) {
            const arrowSpan = document.createElement('span');
            arrowSpan.className = 'handle-menu-arrow'; // Используйте свой класс CSS
            arrowSpan.innerHTML = '&#9654;'; // Треугольник вправо
            menuItem.appendChild(arrowSpan);
            menuItem.classList.add('has-submenu'); // Класс для стилизации/логики
        }

        mainMenuElement.appendChild(menuItem);
    });
}

/**
 * Заполняет подменю типами блоков.
 */
function populateSubMenu() {
    if (!subMenuElement) return;
    subMenuElement.innerHTML = ''; // Очищаем

    // Используем данные из slashMenuController
    slashMenuItemsData.forEach(itemData => {
        const subMenuItem = document.createElement('div');
        subMenuItem.className = 'handle-menu-item'; // Используйте свой класс CSS
        subMenuItem.dataset.blockType = itemData.type;
        if (itemData.listType) {
            subMenuItem.dataset.listType = itemData.listType;
        }

        const iconSpan = document.createElement('span');
        iconSpan.className = 'handle-menu-icon'; // Используйте свой класс CSS
        // Используем iconHtml из slashMenuItemsData, который уже содержит <img>
        iconSpan.innerHTML = itemData.iconHtml || '';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'handle-menu-label'; // Используйте свой класс CSS
        labelSpan.textContent = itemData.label;

        subMenuItem.appendChild(iconSpan);
        subMenuItem.appendChild(labelSpan);

        subMenuElement.appendChild(subMenuItem);
    });
}

/**
 * Позиционирует меню относительно элемента или события.
 * @param {Element} menuEl - Элемент меню для позиционирования.
 * @param {Element | MouseEvent} anchor - Элемент или событие, относительно которого позиционировать.
 * @param {boolean} isSub - Флаг, является ли это подменю.
 */
function positionMenu(menuEl, anchor, isSub = false) {
    const menuRect = menuEl.getBoundingClientRect();
    let anchorRect;

    if (anchor instanceof Element) {
        anchorRect = anchor.getBoundingClientRect();
    } else if (anchor instanceof MouseEvent) {
        anchorRect = { top: anchor.clientY, bottom: anchor.clientY, left: anchor.clientX, right: anchor.clientX, width: 0, height: 0 };
    } else {
        console.error("Invalid anchor for positioning menu");
        return;
    }

    let top, left;

    if (isSub && anchor instanceof Element) {
        top = anchorRect.top;
        left = anchorRect.right + 2;
    } else {
        top = anchorRect.bottom + 5;
        left = anchorRect.left;
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left + menuRect.width > viewportWidth) {
        left = isSub ? anchorRect.left - menuRect.width - 2 : viewportWidth - menuRect.width - 10;
    }
    if (top + menuRect.height > viewportHeight) {
        top = viewportHeight - menuRect.height - 10;
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    menuEl.style.top = `${top}px`;
    menuEl.style.left = `${left}px`;
}


// --- Функции для выполнения действий ---

/**
 * Логика удаления блока(ов).
 */
function performDelete() {
    if (!targetBlockElement) return;

    const blockIdToDelete = targetBlockElement.dataset.blockId;
    const selectedIds = getSelectedBlockIds();
    let blocksToRemove = [];
    let requireFocusLogic = true;

    if (selectedIds.size > 0 && selectedIds.has(blockIdToDelete)) {
        console.log("Handle Menu: Deleting selected blocks:", selectedIds);
        const orderedTopLevelIds = getBlockIdsInOrder();
        let firstBlockToRemove = null;
        let lastBlockToRemove = null;

        selectedIds.forEach(id => {
            const block = document.querySelector(`.editor-block[data-block-id="${id}"]`);
            if (block) {
                blocksToRemove.push(block);
                const topLevelAncestor = block.closest('.editor-area > .editor-block');
                 if (topLevelAncestor && orderedTopLevelIds.includes(topLevelAncestor.dataset.blockId)) {
                     const index = orderedTopLevelIds.indexOf(topLevelAncestor.dataset.blockId);
                     if (index !== -1) {
                          if (firstBlockToRemove === null || index < orderedTopLevelIds.indexOf(firstBlockToRemove.dataset.blockId)) firstBlockToRemove = topLevelAncestor;
                          if (lastBlockToRemove === null || index > orderedTopLevelIds.indexOf(lastBlockToRemove.dataset.blockId)) lastBlockToRemove = topLevelAncestor;
                     }
                 }
            }
        });

        if (blocksToRemove.length === 0) { clearBlockSelection(); return; }

        let focusNextBlock = null;
        let focusEnd = false;
        if (lastBlockToRemove) { let nextSibling = lastBlockToRemove.nextElementSibling; while(nextSibling && !nextSibling.matches('.editor-block')) nextSibling = nextSibling.nextElementSibling; if (nextSibling?.matches('.editor-block')) focusNextBlock = nextSibling; }
        if (!focusNextBlock && firstBlockToRemove) { let prevSibling = firstBlockToRemove.previousElementSibling; while(prevSibling && !prevSibling.matches('.editor-block')) prevSibling = prevSibling.previousElementSibling; if (prevSibling?.matches('.editor-block')) { focusNextBlock = prevSibling; focusEnd = true; } }

        blocksToRemove.forEach(block => block.remove());
        clearBlockSelection();

        if (editorArea && editorArea.children.length === 0) {
             const newBlock = createBlockElement({ type: 'p', html: '' });
             if(newBlock) {
                 editorArea.appendChild(newBlock);
                 newBlock.setAttribute('data-initial-placeholder', 'true');
                 updatePlaceholderVisibility(newBlock);
                 requireFocusLogic = false;
             }
        }

        if (requireFocusLogic && focusNextBlock) {
            requestAnimationFrame(() => {
                const content = getEditableContentElement(focusNextBlock) || getToggleTitleElement(focusNextBlock);
                if (content) { focusEnd ? focusAtEnd(content) : focusAtStart(content); }
                else { focusNextBlock.focus?.(); }
            });
        }
    } else {
        console.log("Handle Menu: Deleting single block:", blockIdToDelete);
        const blockToRemove = document.querySelector(`.editor-block[data-block-id="${blockIdToDelete}"]`);
        if (!blockToRemove) return;

        const nextBlock = blockToRemove.nextElementSibling?.closest('.editor-block');
        const prevBlock = blockToRemove.previousElementSibling?.closest('.editor-block');
        const parentContainer = getBlockParentContainer(blockToRemove);

        blockToRemove.remove();
        clearBlockSelection();

        if (parentContainer && parentContainer !== editorArea && parentContainer.children.length === 0) {
            const containerBlock = parentContainer.closest('.editor-block');
            if (containerBlock?.dataset.blockType === 'callout') {
                 console.warn(`Callout block ${containerBlock.dataset.blockId} became empty after deletion.`);
            } else if (containerBlock?.dataset.blockType === 'toggle') {
                 const pData = { type: 'p', html: '' };
                 const pEl = createBlockElement(pData);
                 if(pEl && parentContainer.appendChild) parentContainer.appendChild(pEl);
                 updatePlaceholderVisibility(pEl);
            }
        }
        else if (editorArea && editorArea.children.length === 0) {
             const newBlock = createBlockElement({ type: 'p', html: '' });
             if(newBlock) {
                 editorArea.appendChild(newBlock);
                 newBlock.setAttribute('data-initial-placeholder', 'true');
                 updatePlaceholderVisibility(newBlock);
                 requireFocusLogic = false;
             }
        }

        if (requireFocusLogic) {
             requestAnimationFrame(() => {
                let focusTarget = nextBlock || prevBlock;
                let focusAtEndFlag = !nextBlock && prevBlock;
                if (focusTarget) {
                    const content = getEditableContentElement(focusTarget) || getToggleTitleElement(focusTarget);
                    if (content) { focusAtEndFlag ? focusAtEnd(content) : focusAtStart(content); }
                    else { focusTarget.focus?.(); }
                } else {
                     console.log("Delete single block: No adjacent block to focus.");
                }
            });
        }
    }

    saveDocumentContent();
    updateListAttributes();
    updateAllQuoteConnections();
    requestAnimationFrame(() => {
        checkAndSetInitialPlaceholderState();
    });
}

/**
 * Рекурсивно собирает данные для одного блока.
 * @param {Element} blockElement - Элемент блока.
 * @returns {object | null} - Объект с данными блока или null.
 */
function getBlockDataRecursive(blockElement) {
    const blockId = parseInt(blockElement?.dataset.blockId, 10);
    if (!blockElement || isNaN(blockId)) { return null; }

    const blockType = blockElement.dataset.blockType || 'p';
    const blockData = { type: blockType };

    blockData.indentLevel = parseInt(blockElement.dataset.indentLevel || '0', 10);
    blockData.inQuote = blockElement.hasAttribute('data-in-quote');

    if (blockType === 'callout') {
        const wrapper = blockElement.querySelector(':scope > .callout-content-wrapper');
        blockData.children = wrapper ? Array.from(wrapper.children).map(child => getBlockDataRecursive(child)).filter(Boolean) : [];
    } else if (blockType === 'toggle') {
        const titleElement = getToggleTitleElement(blockElement);
        const wrapper = getToggleChildrenWrapperElement(blockElement);
        blockData.titleHtml = titleElement ? titleElement.innerHTML : '';
        blockData.isOpen = blockElement.dataset.isOpen === 'true';
        blockData.children = wrapper ? Array.from(wrapper.children).map(child => getBlockDataRecursive(child)).filter(Boolean) : [];
    } else {
        const contentEl = getEditableContentElement(blockElement);
        blockData.html = contentEl ? contentEl.innerHTML : '';
        if (blockType === 'li') { blockData.listType = blockElement.dataset.listType || 'ul'; }
        if (blockType === 'todo') { blockData.checked = blockElement.dataset.checked === 'true'; }
    }

    Object.keys(blockData).forEach(key => {
        if (blockData[key] === null || blockData[key] === undefined || blockData[key] === false) {
             if (key !== 'checked' && key !== 'isOpen') delete blockData[key];
        }
        if (key === 'indentLevel' && blockData[key] === 0 && !['li', 'todo'].includes(blockData.type)) { delete blockData[key]; }
         if (key === 'inQuote' && blockData[key] === false) { delete blockData[key]; }
    });
    return blockData;
}

/**
 * Логика дублирования блока(ов).
 */
function performDuplicate() {
    if (!targetBlockElement) return;

    const sourceBlockId = targetBlockElement.dataset.blockId;
    const selectedIds = getSelectedBlockIds();
    let blocksToDuplicateElements = [];
    let lastOriginalBlock = null;

    if (selectedIds.size > 0 && selectedIds.has(sourceBlockId)) {
        console.log("Handle Menu: Duplicating selected blocks:", selectedIds);
        const orderedIds = getBlockIdsInOrder();
        orderedIds.forEach(id => {
             if (selectedIds.has(id)) {
                 const blockEl = document.querySelector(`.editor-block[data-block-id="${id}"]`);
                 if (blockEl) { blocksToDuplicateElements.push(blockEl); }
             }
        });
        lastOriginalBlock = blocksToDuplicateElements[blocksToDuplicateElements.length - 1];
    } else {
        console.log("Handle Menu: Duplicating single block:", sourceBlockId);
        const blockEl = document.querySelector(`.editor-block[data-block-id="${sourceBlockId}"]`);
         if (blockEl) { blocksToDuplicateElements.push(blockEl); lastOriginalBlock = blockEl; }
    }

    if (blocksToDuplicateElements.length === 0 || !lastOriginalBlock) { console.error("Duplicate error: No valid blocks found to duplicate."); return; }

    let lastDuplicatedElement = null;
    const fragment = document.createDocumentFragment();

    blocksToDuplicateElements.forEach(originalBlock => {
        const blockData = getBlockDataRecursive(originalBlock);
        if (blockData) {
            delete blockData.id;
            const newBlockElement = createBlockElement(blockData);
            if (newBlockElement) {
                 fragment.appendChild(newBlockElement);
                 lastDuplicatedElement = newBlockElement;
                 updatePlaceholderVisibility(newBlockElement);
            } else { console.error("Duplicate error: Failed to create new block element for:", blockData); }
        } else { console.error("Duplicate error: Failed to get block data for:", originalBlock.dataset.blockId); }
    });

    const parentContainer = getBlockParentContainer(lastOriginalBlock);
    if (parentContainer && fragment.childNodes.length > 0) {
         parentContainer.insertBefore(fragment, lastOriginalBlock.nextSibling);
         saveDocumentContent();
         updateListAttributes();
         updateAllQuoteConnections();

         if (lastDuplicatedElement) {
              requestAnimationFrame(() => {
                 let elementToFocus = getEditableContentElement(lastDuplicatedElement)
                                       || getToggleTitleElement(lastDuplicatedElement)
                                       || getCalloutPrimaryContentElement(lastDuplicatedElement);
                 if (elementToFocus) { focusAtStart(elementToFocus); }
                 else { lastDuplicatedElement.focus?.(); }
             });
         }
    } else if (fragment.childNodes.length === 0) { console.warn("Duplicate warning: No blocks were actually duplicated."); }
    else { console.error("Duplicate error: Could not find parent container for insertion."); }
    clearBlockSelection();
}


// --- Обработчики событий меню ---

function handleMenuItemClick(event) {
    const menuItem = event.target.closest('.handle-menu-item');
    if (!menuItem || !mainMenuElement.contains(menuItem)) return;

    const action = menuItem.dataset.action;
    console.log("Handle Menu: Clicked on action -", action);

    switch (action) {
        case 'delete': performDelete(); break;
        case 'duplicate': performDuplicate(); break;
        case 'change-type': return; // Действие при наведении/клике на подменю
        default: console.warn("Unknown menu action:", action); break;
    }
    hideHandleContextMenu();
}

function handleSubmenuItemClick(event) {
    const subMenuItem = event.target.closest('.handle-menu-item');
    if (!subMenuItem || !subMenuElement.contains(subMenuItem)) return;

    const blockType = subMenuItem.dataset.blockType;
    const listType = subMenuItem.dataset.listType || null;

    console.log(`Handle Submenu: Clicked on type - ${blockType}, listType - ${listType}`);

    if (targetBlockElement && blockType) {
        changeBlockType(targetBlockElement, blockType, listType);
    } else { console.error("Submenu click error: Target block or blockType missing."); }
    hideHandleContextMenu();
}

function handleMouseEnterSubmenuTrigger(event) {
    const menuItem = event.target.closest('.handle-menu-item[data-action="change-type"]');
    if (!menuItem) return;
    clearTimeout(submenuTimeoutId);
    submenuTimeoutId = setTimeout(() => { showBlockTypeSubmenu(menuItem); }, SUBMENU_SHOW_DELAY);
}

function handleMouseLeaveSubmenuTrigger(event) {
    clearTimeout(submenuTimeoutId);
    submenuTimeoutId = setTimeout(() => { /* Do nothing here, wait for leave main/sub menu */ }, SUBMENU_HIDE_DELAY);
}

function handleMouseEnterSubmenu(event) {
    clearTimeout(submenuTimeoutId);
}

function handleMouseLeaveMainMenu(event) {
    submenuTimeoutId = setTimeout(() => {
        if (!subMenuElement || !subMenuElement.matches(':hover')) { hideBlockTypeSubmenu(); }
    }, SUBMENU_HIDE_DELAY);
}

function handleMouseLeaveSubmenu(event) {
     submenuTimeoutId = setTimeout(() => { hideBlockTypeSubmenu(); }, SUBMENU_HIDE_DELAY);
}

function handleClickOutside(event) {
    if (isMainMenuVisible && mainMenuElement && !mainMenuElement.contains(event.target) &&
        (!isSubMenuVisible || !subMenuElement || !subMenuElement.contains(event.target)) )
    {
        const handle = targetBlockElement?.querySelector('.drag-handle');
        if (!handle || !handle.contains(event.target)) {
            console.log("Handle Menu: Click outside detected.");
            hideHandleContextMenu();
        }
    }
}

// --- Функции показа/скрытия ---

function showBlockTypeSubmenu(anchorElement) {
    if (!subMenuElement || !mainMenuElement) createMenuElements();
    if (!anchorElement) return;
    populateSubMenu();
    subMenuElement.style.display = 'block';
    isSubMenuVisible = true;
    positionMenu(subMenuElement, anchorElement, true);
    subMenuElement.removeEventListener('click', handleSubmenuItemClick); // Убедимся, что нет дублей
    subMenuElement.addEventListener('click', handleSubmenuItemClick);
    subMenuElement.removeEventListener('mouseenter', handleMouseEnterSubmenu);
    subMenuElement.removeEventListener('mouseleave', handleMouseLeaveSubmenu);
    subMenuElement.addEventListener('mouseenter', handleMouseEnterSubmenu);
    subMenuElement.addEventListener('mouseleave', handleMouseLeaveSubmenu);
}

function hideBlockTypeSubmenu() {
    clearTimeout(submenuTimeoutId);
    if (subMenuElement) {
        subMenuElement.style.display = 'none';
        subMenuElement.removeEventListener('click', handleSubmenuItemClick);
        subMenuElement.removeEventListener('mouseenter', handleMouseEnterSubmenu);
        subMenuElement.removeEventListener('mouseleave', handleMouseLeaveSubmenu);
    }
    isSubMenuVisible = false;
}


// --- Экспортируемые функции ---

/**
 * Инициализирует элементы контекстного меню при загрузке.
 */
export function initializeHandleContextMenu() {
    createMenuElements();
    console.log("Handle Context Menu initialized.");
}

/**
 * Показывает контекстное меню для указанного блока.
 * @param {Element} blockElement - Блок, для которого показываем меню.
 * @param {MouseEvent} event - Событие клика, вызвавшее меню.
 */
export function showHandleContextMenu(blockElement, event) {
    if (!blockElement || !event) return;
    if (isMainMenuVisible && targetBlockElement !== blockElement) { hideHandleContextMenu(); }

    console.log(`Showing handle context menu for block: ${blockElement.dataset.blockId}`);
    targetBlockElement = blockElement;

    if (!mainMenuElement) createMenuElements();
    populateMainMenu();
    mainMenuElement.style.display = 'block';
    isMainMenuVisible = true;
    positionMenu(mainMenuElement, event);

    // --- Переносим добавление слушателей сюда ---
    mainMenuElement.removeEventListener('click', handleMenuItemClick);
    mainMenuElement.addEventListener('click', handleMenuItemClick);

    const changeTypeItem = mainMenuElement.querySelector('.handle-menu-item[data-action="change-type"]');
    changeTypeItem?.removeEventListener('mouseenter', handleMouseEnterSubmenuTrigger);
    changeTypeItem?.removeEventListener('mouseleave', handleMouseLeaveSubmenuTrigger);
    changeTypeItem?.addEventListener('mouseenter', handleMouseEnterSubmenuTrigger);
    changeTypeItem?.addEventListener('mouseleave', handleMouseLeaveSubmenuTrigger);

    mainMenuElement.removeEventListener('mouseleave', handleMouseLeaveMainMenu);
    mainMenuElement.addEventListener('mouseleave', handleMouseLeaveMainMenu);
    // --- Конец переноса слушателей ---

    setTimeout(() => {
        document.addEventListener('click', handleClickOutside, { capture: true, once: true });
    }, 0);
}

/**
 * Скрывает контекстное меню и подменю.
 */
export function hideHandleContextMenu() {
    hideBlockTypeSubmenu();

    if (mainMenuElement) {
        mainMenuElement.style.display = 'none';
        // --- Удаляем слушатели при скрытии ---
        mainMenuElement.removeEventListener('click', handleMenuItemClick);
        mainMenuElement.removeEventListener('mouseleave', handleMouseLeaveMainMenu);
        const changeTypeItem = mainMenuElement.querySelector('.handle-menu-item[data-action="change-type"]');
        changeTypeItem?.removeEventListener('mouseenter', handleMouseEnterSubmenuTrigger);
        changeTypeItem?.removeEventListener('mouseleave', handleMouseLeaveSubmenuTrigger);
        // --- Конец удаления ---
    }
    isMainMenuVisible = false;
    targetBlockElement = null;
}

/**
 * Проверяет, активно ли основное контекстное меню.
 * @returns {boolean}
 */
export function isHandleContextMenuActive() {
    return isMainMenuVisible;
}