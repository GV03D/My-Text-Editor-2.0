import {
    leftToggleButton,
    searchInput,
    newDocButton,
    currentDocTitleElement,
    editorArea,
    mainContent
} from './domElements.js';
import { focusAtStart, debounce } from './utils.js';
import {
    getEditableContentElement,
    getToggleTitleElement,
    updatePlaceholderVisibility,
    getCalloutPrimaryContentElement
} from './blockUtils.js';
import { toggleLeftSidebar, filterDocuments, renderInitialDocList } from './sidebarController.js';
import { debouncedUpdateTitle, updateDocumentTitle } from './titleController.js';
import { createNewDocument, debouncedSave, checkAndSetInitialPlaceholderState, loadDocument } from './documentManager.js';
import { initializeAreaSelection, handleBlockCmdCtrlClick, handleTextSelectionMouseDown } from './selectionManager.js';
import { setupGlobalKeyboardListeners, handleBlockKeyDown } from './eventHandlers/keyboardHandler.js';
import { handlePaste } from './eventHandlers/pasteHandler.js';
import { handleCheckboxClick, handleToggleIndicatorClick, handleBlockFocus } from './eventHandlers/miscHandlers.js';
import { initializeSlashMenu, hideMenu as hideSlashMenu } from './slashMenuController.js';
import { initializeDragAndDrop } from './eventHandlers/dragAndDropHandler.js';
import { initializeHandleContextMenu, showHandleContextMenu, hideHandleContextMenu, isHandleContextMenuActive } from './handleContextMenuController.js';
import { initializeImageMenu, showImageMenu, hideImageMenu } from './imageMenuController.js';
import { initializeTextContextMenu, hideMenu as hideTextContextMenu } from './textContextMenuController.js';
import { initializeColorMenu, hideColorMenuExport as hideColorMenu } from './colorMenuController.js';
import { initializeLinkMenu, hideMenu as hideLinkMenu, isLinkMenuVisible } from './linkMenuController.js';
import { initializeLinkHoverMenu, showMenu as showLinkHoverMenu, hideMenu as hideLinkHoverMenu } from './linkHoverMenuController.js';
import { initializeLinkEditMenu, hideMenu as hideLinkEditMenu, isLinkEditMenuVisible } from './linkEditMenuController.js';
import { initializeComments, handleHighlightClick, collapseAllCommentGroups, expandCommentGroup } from './commentController.js';
import { initializeCommentActionMenus, handleCommentActionClick, hideCommentContextMenus } from './commentActionMenuController.js';
import { initializeReactionMenu, hideMenu as hideReactionMenu, isReactionMenuVisible } from './reactionMenuController.js';
import { getActiveDocId } from './state.js';
import { INTERNAL_LINK_PREFIX } from './config.js';

let currentlyHoveredBlockId = null;

function handleEditorAreaClick(e) {
    const target = e.target;

    const highlightSpan = target.closest('.comment-highlight[data-comment-id]');
    if (highlightSpan) {
        const commentId = highlightSpan.dataset.commentId;
        if (commentId) {
            e.stopPropagation();
            e.preventDefault();
            expandCommentGroup(commentId);
            handleHighlightClick(commentId);
            return;
        }
    }

    const commentActionButton = target.closest('.comment-action-button');
    const parentCommentOrReply = target.closest('.comment-panel, .comment-reply');
    if (commentActionButton && parentCommentOrReply) {
        e.stopPropagation();
        handleCommentActionClick(e, parentCommentOrReply);
        return;
    }


    if (isHandleContextMenuActive() && !target.closest('.handle-menu')) hideHandleContextMenu();
    if (document.getElementById('text-context-menu')?.style.display !== 'none' && !target.closest('.text-context-menu') && !target.closest('.color-menu')) hideTextContextMenu();
    if (document.getElementById('slash-command-menu')?.style.display !== 'none' && !target.closest('.slash-menu')) hideSlashMenu();
    if (document.getElementById('image-block-menu')?.style.display !== 'none' && !target.closest('.image-menu')) hideImageMenu();
    if (isLinkMenuVisible() && !target.closest('.link-menu')) hideLinkMenu();
    if (isLinkEditMenuVisible() && !target.closest('.link-edit-menu')) hideLinkEditMenu();
    if (document.getElementById('link-hover-menu')?.style.display !== 'none' && !target.closest('.link-hover-menu')) hideLinkHoverMenu(true);
    if (isReactionMenuVisible() && !target.closest('.reaction-menu') && !target.closest('.comment-action-button[data-action="react"]')) hideReactionMenu();
    if ((document.getElementById('comment-action-context-menu')?.style.display !== 'none' && !target.closest('#comment-action-context-menu')) ||
        (document.getElementById('reply-action-context-menu')?.style.display !== 'none' && !target.closest('#reply-action-context-menu'))) {
        if (!target.closest('.comment-action-button[data-action="more"]')) {
            hideCommentContextMenus();
        }
    }


    const linkElement = target.closest('a');
    if (linkElement && editorArea.contains(linkElement)) {
        const linkEditMenu = document.getElementById('link-edit-menu');
        if (isLinkEditMenuVisible() && linkEditMenu?.dataset.targetLinkId === linkElement.dataset.internalId) {
            // Do nothing if edit menu for this link is already open
        } else {
           hideLinkEditMenu(); // Hide if open for another link or not open
        }
        e.preventDefault();
        e.stopPropagation();
        const href = linkElement.getAttribute('href');
        if (href) {
            if (href.startsWith(INTERNAL_LINK_PREFIX)) {
                const docIdString = href.substring(INTERNAL_LINK_PREFIX.length);
                const docId = parseInt(docIdString, 10);
                if (!isNaN(docId)) {
                    loadDocument(docId);
                } else {
                    alert(`Некорректная внутренняя ссылка: ${href}`);
                }
            } else {
                try {
                    window.open(href, '_blank', 'noopener,noreferrer');
                } catch (error) {
                    alert(`Не удалось открыть ссылку: ${href}`);
                }
            }
        }
        return;
    }

    const dragHandle = target.closest('.drag-handle');
    if (dragHandle) {
        e.preventDefault();
        e.stopPropagation();
        const blockElement = dragHandle.closest('.editor-block');
        if (blockElement) {
            if (isHandleContextMenuActive()) {
                hideHandleContextMenu();
            } else {
                hideTextContextMenu();
                hideImageMenu();
                hideSlashMenu();
                hideLinkMenu();
                hideLinkEditMenu();
                hideReactionMenu();
                hideCommentContextMenus();
                showHandleContextMenu(blockElement, e);
            }
        }
        return;
    }

    const clickedBlock = target.closest('.editor-block');
    if (clickedBlock && clickedBlock.dataset.blockType === 'image' && clickedBlock.classList.contains('image-placeholder-block')) {
        e.preventDefault();
        e.stopPropagation();
        hideTextContextMenu();
        hideHandleContextMenu();
        hideSlashMenu();
        hideLinkMenu();
        hideLinkEditMenu();
        hideReactionMenu();
        hideCommentContextMenus();
        showImageMenu(clickedBlock);
        return;
    }

    let blockElementForCheckbox = null;
    const clickedCheckboxSpan = target.closest('.block-checkbox');
    if (clickedCheckboxSpan) {
        const parentTodoBlock = clickedCheckboxSpan.closest('.editor-block[data-block-type="todo"]');
        if (parentTodoBlock) blockElementForCheckbox = parentTodoBlock;
    } else if (target.matches('.block-content')) {
        const parentTodoBlock = target.closest('.editor-block[data-block-type="todo"]');
        if (parentTodoBlock) {
            try {
                const blockRect = parentTodoBlock.getBoundingClientRect();
                const handleWidth = 28;
                const checkboxWidth = 20;
                const clickXRelative = e.clientX - blockRect.left + handleWidth;
                const checkboxClickZone = checkboxWidth;
                if (clickXRelative >= 0 && clickXRelative < checkboxClickZone) {
                    blockElementForCheckbox = parentTodoBlock;
                }
            } catch (rectError) {}
        }
    }
    if (blockElementForCheckbox) {
        handleCheckboxClick(e);
        return;
    }

    const indicatorContainer = target.closest('.toggle-indicator-container');
    if (indicatorContainer) {
        const toggleBlock = indicatorContainer.closest('.editor-block[data-block-type="toggle"]');
        if (toggleBlock) {
            e.stopPropagation();
            handleToggleIndicatorClick(e);
            return;
        }
    }

    const isClickInsideAnyMenu = target.closest('.handle-menu, .text-context-menu, .color-menu, .image-menu, .link-menu, .link-edit-menu, .slash-menu, .link-hover-menu, .comment-action-context-menu, #reply-context-menu, .reaction-menu');
    const isClickInsideCommentGroup = target.closest('.comment-group-wrapper');

    if (!target.closest('.editor-block') && !isClickInsideAnyMenu && !isClickInsideCommentGroup) {
         hideTextContextMenu();
         hideHandleContextMenu();
         hideImageMenu();
         hideSlashMenu();
         hideLinkMenu();
         hideLinkEditMenu();
         hideReactionMenu();
         hideCommentContextMenus();
    }
}

function handleEditorAreaMouseDown(e) {
    const target = e.target;
    const blockElement = target.closest('.editor-block');

    if (!target.closest('.text-context-menu') && !target.closest('.color-menu')) hideTextContextMenu();
    if (!target.closest('.handle-menu')) hideHandleContextMenu();
    if (!target.closest('.image-menu')) hideImageMenu();
    if (!target.closest('.link-menu')) hideLinkMenu();
    if (!target.closest('.link-edit-menu')) hideLinkEditMenu();
    if (!target.closest('.slash-menu')) hideSlashMenu();
    if (!target.closest('.link-hover-menu')) hideLinkHoverMenu(true);
    if (!target.closest('.reaction-menu') && !target.closest('.comment-action-button[data-action="react"]')) hideReactionMenu();
    if ((!target.closest('#comment-action-context-menu') && !target.closest('#reply-context-menu')) && !target.closest('.comment-action-button[data-action="more"]')) {
        hideCommentContextMenus();
    }


    if (target.closest('.drag-handle')) {
        return;
    }

    if (blockElement && blockElement.parentElement === editorArea && (e.metaKey || e.ctrlKey || e.shiftKey) && e.button === 0) {
           handleBlockCmdCtrlClick.call(blockElement, e);
            if(e.defaultPrevented) return;
     }
     handleTextSelectionMouseDown(e);
}

function handleEditorAreaMouseOver(e) {
    const target = e.target;
    const linkElement = target.closest('a');
    if (linkElement && editorArea.contains(linkElement)) {
        if (isLinkEditMenuVisible() && document.getElementById('link-edit-menu')?.dataset.targetLinkId === linkElement.dataset.internalId) {
            return;
        }
        showLinkHoverMenu(linkElement);
    }
}

function handleEditorAreaMouseOut(e) {
    const target = e.target;
    const relatedTarget = e.relatedTarget;
    const linkElement = target.closest('a');
    if (linkElement && editorArea.contains(linkElement)) {
        const hoverMenu = document.getElementById('link-hover-menu');
        if ((!hoverMenu || !hoverMenu.contains(relatedTarget)) && !isLinkEditMenuVisible()) {
            hideLinkHoverMenu();
        }
    }
}

function handleEditorInput(e) {
    const target = e.target;
    const editableElement = target.closest('[contenteditable="true"]');
    if (!editableElement) return;
    const blockElement = editableElement.closest('.editor-block');
    if (blockElement) {
        if (editableElement.classList.contains('is-empty') && !blockElement.hasAttribute('data-initial-placeholder')) {
            editableElement.classList.remove('is-empty');
        }
        updatePlaceholderVisibility(blockElement);
    }
    debouncedSave();
}

function handleEditorFocus(e) {
    handleBlockFocus(e);
}

function handleEditorBlur(e) {
     if (e.target.hasAttribute && e.target.hasAttribute('contenteditable') && editorArea?.contains(e.target)) {
        const blockElement = e.target.closest('.editor-block');
        debouncedSave();
        setTimeout(() => {
             const activeElement = document.activeElement;
             const isFocusOutsideEditor = !editorArea.contains(activeElement) && activeElement !== currentDocTitleElement;
             const focusInMenu = activeElement?.closest('.text-context-menu, .color-menu, .handle-menu, .link-menu, .image-menu, .slash-menu, .link-hover-menu, .link-edit-menu, #comment-action-context-menu, #reply-context-menu, .reaction-menu');
             if (isFocusOutsideEditor && !focusInMenu) {
                 checkAndSetInitialPlaceholderState();
             }
             else if (blockElement && document.body.contains(blockElement)) {
                 updatePlaceholderVisibility(blockElement);
             }
        }, 0);
     } else {
         debouncedSave();
     }
}

function handleEditorKeyDown(e) {
    handleBlockKeyDown(e);
}

function handleEditorPaste(e) {
    handlePaste(e);
}

function isCursorInHandleActivationZone(mouseX, mouseY, blockElement) {
    try {
        const rect = blockElement.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) return false;
        if (mouseY < rect.top || mouseY > rect.bottom) return false;
        const editorAreaRect = editorArea.getBoundingClientRect();
        const handleActivationWidth = 35;
        const handleVisibleZoneStart = Math.max(editorAreaRect.left, rect.left - handleActivationWidth);
        const handleVisibleZoneEnd = rect.left;
        return mouseX >= handleVisibleZoneStart && mouseX < handleVisibleZoneEnd;
    } catch (e) {
        return false;
    }
}

function updateHandleVisibility(event) {
    const isCurrentlyDragging = document.body.classList.contains('user-is-dragging');
    if (!editorArea || isCurrentlyDragging) {
        hideAllHandles();
        return;
    }
    const mouseX = event.clientX;
    const mouseY = event.clientY;
    let targetElement = document.elementFromPoint(mouseX, mouseY);

    const rightSidebarForCheck = document.querySelector('.right-sidebar-placeholder');
    if (!targetElement || !mainContent?.contains(targetElement) || (rightSidebarForCheck && rightSidebarForCheck.contains(targetElement) && !targetElement.closest('.comment-panels-wrapper'))) {
        hideAllHandles();
        return;
    }

    let bestMatchBlock = targetElement.closest('.editor-block');
    if (!bestMatchBlock) {
        const allBlocks = editorArea.querySelectorAll('.editor-block');
        let minDistance = Infinity;
        allBlocks.forEach(block => {
            try {
                const rect = block.getBoundingClientRect();
                if (!rect || rect.height === 0) return;
                const blockCenterY = rect.top + rect.height / 2;
                const distance = Math.abs(mouseY - blockCenterY);
                const isHorizontallyAligned = mouseX >= rect.left - 50 && mouseX <= rect.right + 50;
                if (isHorizontallyAligned && distance < minDistance) {
                    minDistance = distance;
                    bestMatchBlock = block;
                }
            } catch(e) {}
        });
    }

    let blockToShowHandleFor = bestMatchBlock;
    if (bestMatchBlock) {
        const parentWrapper = bestMatchBlock.parentElement;
        const isFirstInCallout = parentWrapper?.matches('.callout-content-wrapper') && bestMatchBlock === parentWrapper.firstElementChild;
        if (isFirstInCallout) {
            blockToShowHandleFor = null;
        }
    }
    const targetBlockId = blockToShowHandleFor?.dataset.blockId || null;

    if (currentlyHoveredBlockId !== targetBlockId) {
        if (currentlyHoveredBlockId) {
            const prevBlock = document.querySelector(`.editor-block[data-block-id="${currentlyHoveredBlockId}"]`);
            prevBlock?.classList.remove('handle-visible');
        }
        if (targetBlockId && blockToShowHandleFor && isCursorInHandleActivationZone(mouseX, mouseY, blockToShowHandleFor) && !isHandleContextMenuActive()) {
            blockToShowHandleFor.classList.add('handle-visible');
            currentlyHoveredBlockId = targetBlockId;
        } else {
            currentlyHoveredBlockId = null;
        }
    } else if (targetBlockId && blockToShowHandleFor) {
        if (!isCursorInHandleActivationZone(mouseX, mouseY, blockToShowHandleFor) || isHandleContextMenuActive()) {
            blockToShowHandleFor.classList.remove('handle-visible');
            currentlyHoveredBlockId = null;
        }
    }
}

function hideAllHandles() {
    if (currentlyHoveredBlockId) {
        const prevBlock = document.querySelector(`.editor-block[data-block-id="${currentlyHoveredBlockId}"]`);
        prevBlock?.classList.remove('handle-visible');
        currentlyHoveredBlockId = null;
    }
    if (editorArea) {
        editorArea.querySelectorAll('.editor-block.handle-visible').forEach(b => b.classList.remove('handle-visible'));
    }
}

function handleDocumentMouseDownForCollapse(event) {
    const target = event.target;

    if (
        target.closest('.comment-group-wrapper') ||
        target.closest('.comment-input-panel-wrapper') ||
        target.closest('.comment-edit-panel') ||
        target.closest('.comment-action-button') ||
        target.closest('.reaction-emoji-item') ||
        target.closest('.comment-add-reaction-button') ||
        target.closest('.handle-menu') ||
        target.closest('.text-context-menu') ||
        target.closest('.color-menu') ||
        target.closest('.image-menu') ||
        target.closest('.link-menu') ||
        target.closest('.link-edit-menu') ||
        target.closest('.slash-menu') ||
        target.closest('.link-hover-menu') ||
        target.closest('#comment-action-context-menu') ||
        target.closest('#reply-context-menu') ||
        target.closest('.reaction-menu') ||
        target.closest('.comment-highlight') ||
        target.closest('.drag-handle') ||
        target.closest('a') ||
        target.closest('button') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('.editor-block')
    ) {
        return;
    }

    const rightSidebar = document.querySelector('.right-sidebar-placeholder');
    const commentPanelsWrapper = rightSidebar ? rightSidebar.querySelector('.comment-panels-wrapper') : null;

    const isClickOnRightSidebarEmptySpace = rightSidebar && (target === rightSidebar || target === commentPanelsWrapper);
    const isClickOnEditorAreaPadding = target === editorArea;

    if (isClickOnRightSidebarEmptySpace || isClickOnEditorAreaPadding) {
        collapseAllCommentGroups();
    }
}


export function initializeEditor() {
    if ('paintWorklet' in CSS) {
        CSS.paintWorklet.addModule('js/smooth-corners-painter.js')
            .catch(err => {});
    }

    if (leftToggleButton) leftToggleButton.addEventListener('click', toggleLeftSidebar);
    if (searchInput) searchInput.addEventListener('input', filterDocuments);
    if (newDocButton) newDocButton.addEventListener('click', createNewDocument);

    if (currentDocTitleElement) {
        currentDocTitleElement.addEventListener('input', () => {
            debouncedUpdateTitle(currentDocTitleElement.innerText);
            if (currentDocTitleElement.hasAttribute('data-placeholder-active')) {
                currentDocTitleElement.removeAttribute('data-placeholder-active');
            }
        });
        currentDocTitleElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                currentDocTitleElement.blur();
                const firstBlock = editorArea?.querySelector(':scope > .editor-block:first-child');
                if (firstBlock) {
                    const firstEditable = getEditableContentElement(firstBlock) || getToggleTitleElement(firstBlock) || getCalloutPrimaryContentElement(firstBlock);
                    if (firstEditable) requestAnimationFrame(() => focusAtStart(firstEditable));
                }
            }
        });
        currentDocTitleElement.addEventListener('blur', () => {
            updateDocumentTitle(currentDocTitleElement.innerText);
            const currentTitle = currentDocTitleElement.innerText.trim();
            const docId = getActiveDocId();
            const isEmptyForPlaceholder = currentTitle === '' || (docId !== null && currentTitle === `Без названия ${docId}`);
            if (currentDocTitleElement.innerText.trim() === '' && isEmptyForPlaceholder) {
                currentDocTitleElement.setAttribute('data-placeholder-active', 'true');
            } else {
                currentDocTitleElement.removeAttribute('data-placeholder-active');
            }
        });
    }

    if (editorArea && mainContent) {
        editorArea.addEventListener('focus', handleEditorFocus, true);
        editorArea.addEventListener('blur', handleEditorBlur, true);
        editorArea.addEventListener('keydown', handleEditorKeyDown);
        editorArea.addEventListener('paste', handleEditorPaste);
        editorArea.addEventListener('click', handleEditorAreaClick);
        editorArea.addEventListener('mousedown', handleEditorAreaMouseDown);
        editorArea.addEventListener('input', handleEditorInput);
        editorArea.addEventListener('mouseover', handleEditorAreaMouseOver);
        editorArea.addEventListener('mouseout', handleEditorAreaMouseOut);

        const debouncedUpdateHandleVisibility = debounce(updateHandleVisibility, 50);
        mainContent.addEventListener('mousemove', debouncedUpdateHandleVisibility);
        mainContent.addEventListener('mouseleave', hideAllHandles);
    }

    const rightSidebar = document.querySelector('.right-sidebar-placeholder');
    if (rightSidebar) {
        // Mouseover/mouseout for comment actions is now handled by CSS :hover
        // and click events are delegated from commentController or handled directly.
        // So, the specific listeners for showing/hiding hover menus are removed.
    }

    setupGlobalKeyboardListeners();
    initializeAreaSelection();
    initializeSlashMenu();
    initializeDragAndDrop();
    initializeHandleContextMenu();
    initializeImageMenu();
    initializeTextContextMenu();
    initializeColorMenu();
    initializeLinkMenu();
    initializeLinkHoverMenu();
    initializeLinkEditMenu();
    initializeComments();
    initializeCommentActionMenus();
    initializeReactionMenu();
    renderInitialDocList();

    document.addEventListener('mousedown', handleDocumentMouseDownForCollapse, true);
}