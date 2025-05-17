import { editorArea } from './domElements.js';
import {
    getActiveDocId,
    addCommentToState,
    getCommentsForDoc,
    getNextCommentId,
    getCommentById,
    deleteCommentFromState,
    addReplyToState,
    updateCommentInState,
    addReactionToCommentInState,
    removeReactionFromCommentInState,
    addReactionToReplyInState,
    removeReactionFromReplyInState,
    getNextReplyId,
    CURRENT_USER_NAME,
    CURRENT_USER_ID
} from './state.js';
import { debouncedSave } from './documentManager.js';
import { getEditableContentElement, getToggleTitleElement } from './blockUtils.js';
import { showMenu as showReactionMenu, isReactionMenuVisible, hideMenu as hideReactionMenu, getReactionMenuAnchor } from './reactionMenuController.js';
import { showNotification } from './utils.js';
import { updateReplyButtonActiveState } from './commentActionMenuController.js';

let rightSidebarContainer = null;
let activeCommentInputPanelWrapper = null;
let activeCommentEditPanel = null;

let replyContextMenuElement = null;
let currentReplyActionTarget = null;

const COMMENT_HIGHLIGHT_CLASS = 'comment-highlight';
const HIGHLIGHT_SPAN_TAG = 'SPAN';
const COMMENT_GROUP_WRAPPER_CLASS = 'comment-group-wrapper';

const COMMENT_PANEL_CLASS = 'comment-panel';
const COMMENT_REPLY_CLASS = 'comment-reply';
const COMMENT_INPUT_PANEL_WRAPPER_CLASS = 'comment-input-panel-wrapper';

const TEXTAREA_FOCUSED_CLASS = 'textarea-focused';

function getRightSidebarContainer() {
    if (rightSidebarContainer && document.body.contains(rightSidebarContainer)) {
        let panelWrapper = rightSidebarContainer.querySelector('.comment-panels-wrapper');
        if (panelWrapper && rightSidebarContainer.contains(panelWrapper)) return panelWrapper;
        rightSidebarContainer.innerHTML = '';
        panelWrapper = document.createElement('div');
        panelWrapper.className = 'comment-panels-wrapper';
        rightSidebarContainer.appendChild(panelWrapper);
        return panelWrapper;
    }
    const rightSidebarElement = document.querySelector('.right-sidebar-placeholder');
    if (!rightSidebarElement) return null;
    rightSidebarContainer = rightSidebarElement;
    rightSidebarContainer.classList.remove('collapsed');
    Object.assign(rightSidebarContainer.style, {
        width: 'var(--dynamic-comment-panel-width, var(--sidebar-width, 300px))',
        opacity: '1', padding: '0'
    });
    let panelWrapper = rightSidebarContainer.querySelector('.comment-panels-wrapper');
    if (!panelWrapper) {
        panelWrapper = document.createElement('div');
        panelWrapper.className = 'comment-panels-wrapper';
        rightSidebarContainer.appendChild(panelWrapper);
    }
    return panelWrapper;
}

function formatTimestamp(timestamp) {
    const now = Date.now();
    const diffSeconds = Math.round((now - timestamp) / 1000);
    const rtf = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });

    if (diffSeconds < 60) return "только что";
    const diffMinutes = Math.round(diffSeconds / 60);
    if (diffMinutes < 60) return rtf.format(-diffMinutes, 'minute');
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return rtf.format(-diffHours, 'hour');

    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return `Сегодня, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    }
    if (date.toDateString() === yesterday.toDateString()) {
        return `Вчера, ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(' г.', '');
}


function unwrapElement(element) {
    const parent = element.parentNode;
    if (!parent) return;
    while (element.firstChild) {
        parent.insertBefore(element.firstChild, element);
    }
    parent.removeChild(element);
    parent.normalize();
}

function removeHighlight(commentId) {
    if (editorArea) {
        editorArea.querySelectorAll(`.${COMMENT_HIGHLIGHT_CLASS}[data-comment-id="${commentId}"]`).forEach(unwrapElement);
        editorArea.normalize();
    }
}

function processRangeTextNodes(range, wrapFunction) {
    if (!range || range.collapsed) return;
    const commonAncestor = range.commonAncestorContainer;
    const walker = document.createTreeWalker(commonAncestor, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const nodesToProcess = [];
    let tempNode;
    while (tempNode = walker.nextNode()) nodesToProcess.push(tempNode);
    if (nodesToProcess.length === 0) {
        if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
            nodesToProcess.push(range.startContainer);
        } else { return; }
    }
    nodesToProcess.forEach(textNode => {
        if (!textNode.parentNode || !document.body.contains(textNode)) return;
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(textNode);
        const isStartNode = (textNode === range.startContainer);
        const isEndNode = (textNode === range.endContainer);
        const start = isStartNode ? range.startOffset : 0;
        const end = isEndNode ? range.endOffset : textNode.length;
        if (start >= end) return;
        try {
            let nodeToWrap = textNode;
            if (end < textNode.length) {
                nodeToWrap = textNode.splitText(end);
                if (start > 0) { textNode.splitText(start); nodeToWrap = textNode.nextSibling; }
                else { nodeToWrap = textNode; }
            } else if (start > 0) { nodeToWrap = textNode.splitText(start); }
            if (nodeToWrap && nodeToWrap.length > 0 && nodeToWrap.parentNode) {
                 const wrapper = wrapFunction(nodeToWrap);
                 if (wrapper) { nodeToWrap.parentNode.insertBefore(wrapper, nodeToWrap); wrapper.appendChild(nodeToWrap); }
            }
        } catch (e) { textNode.parentNode?.normalize(); }
    });
    try { commonAncestor.normalize(); } catch(e) {}
}

function getEditableParts(blockElement) {
    if (!blockElement) return [];
    const parts = [];
    const mainContent = getEditableContentElement(blockElement);
    if (mainContent) parts.push(mainContent);
    const toggleTitle = getToggleTitleElement(blockElement);
    if (toggleTitle) parts.push(toggleTitle);
    return parts;
}

function removeHighlightInRange(range) {
    if (!range) return;
    const commonAncestor = range.commonAncestorContainer;
    if (!commonAncestor) return;
    const spansToRemove = [];
    const walker = document.createTreeWalker( commonAncestor, NodeFilter.SHOW_ELEMENT,
        { acceptNode: (node) => (node.tagName === HIGHLIGHT_SPAN_TAG && node.classList.contains(COMMENT_HIGHLIGHT_CLASS) && range.intersectsNode(node)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP }
    );
    let currentNode;
    while (currentNode = walker.nextNode()) spansToRemove.push(currentNode);
    spansToRemove.forEach(span => unwrapElement(span));
    if (spansToRemove.length > 0) try { commonAncestor.normalize(); } catch (e) {}
}

function applyHighlight(range, commentId) {
    if (!range || range.collapsed) return { success: false };
    const highlightedText = range.toString();
    const startContainer = range.startContainer;
    const startBlockElement = startContainer.nodeType === Node.ELEMENT_NODE ? startContainer.closest('.editor-block') : startContainer.parentElement?.closest('.editor-block');
    if (!startBlockElement || !startBlockElement.dataset.blockId) return { success: false };
    const blockId = startBlockElement.dataset.blockId;
    const editableParts = getEditableParts(startBlockElement);
    if (editableParts.length === 0) return { success: false };
    let foundStartOffset = -1, foundEndOffset = -1;
    function findOffset(targetNode, targetOffsetInNode) {
        let cumulativeOffset = 0;
        for (const part of editableParts) {
            const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
            let node;
            while(node = walker.nextNode()) {
                if (node === targetNode) return cumulativeOffset + targetOffsetInNode;
                cumulativeOffset += node.length;
            }
        }
        return -1;
    }
    foundStartOffset = findOffset(range.startContainer, range.startOffset);
    foundEndOffset = findOffset(range.endContainer, range.endOffset);
    try {
        removeHighlightInRange(range.cloneRange());
        processRangeTextNodes(range.cloneRange(), () => {
            const wrapper = document.createElement(HIGHLIGHT_SPAN_TAG);
            wrapper.className = COMMENT_HIGHLIGHT_CLASS;
            wrapper.dataset.commentId = commentId;
            return wrapper;
        });
        return { success: true, blockId, startOffset: foundStartOffset !== -1 ? foundStartOffset : undefined, endOffset: foundEndOffset !== -1 ? foundEndOffset : undefined, text: highlightedText };
    } catch (error) { return { success: false }; }
}

function restoreHighlight(commentData) {
    const { id, blockId, startOffset, endOffset, highlightedText } = commentData;
    if (editorArea) {
        const existingSpan = editorArea.querySelector(`.${COMMENT_HIGHLIGHT_CLASS}[data-comment-id="${id}"]`);
        if (existingSpan) return;
    }
    if (!blockId || highlightedText === undefined) return;
    const blockElement = editorArea?.querySelector(`.editor-block[data-block-id="${blockId}"]`);
    if (!blockElement) return;
    const editableParts = getEditableParts(blockElement);
    if (editableParts.length === 0) return;
    let reconstructedRange = null;
    if (startOffset !== undefined && endOffset !== undefined && startOffset < endOffset) {
        let currentCumulativeOffset = 0;
        let rangeStartNode = null, rangeStartOffsetInNode = 0, rangeEndNode = null, rangeEndOffsetInNode = 0;
        for (const part of editableParts) {
            const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
            let node;
            while (node = walker.nextNode()) {
                const nodeLength = node.length;
                if (!rangeStartNode && startOffset >= currentCumulativeOffset && startOffset <= currentCumulativeOffset + nodeLength) { rangeStartNode = node; rangeStartOffsetInNode = startOffset - currentCumulativeOffset; }
                if (!rangeEndNode && endOffset > currentCumulativeOffset && endOffset <= currentCumulativeOffset + nodeLength) { rangeEndNode = node; rangeEndOffsetInNode = endOffset - currentCumulativeOffset; }
                currentCumulativeOffset += nodeLength;
                if (rangeStartNode && rangeEndNode) break;
            }
            if (rangeStartNode && rangeEndNode) break;
        }
        if (rangeStartNode && rangeEndNode) try { reconstructedRange = document.createRange(); reconstructedRange.setStart(rangeStartNode, rangeStartOffsetInNode); reconstructedRange.setEnd(rangeEndNode, rangeEndOffsetInNode); if (reconstructedRange.toString() !== highlightedText) reconstructedRange = null; } catch (e) { reconstructedRange = null; }
    }
    if (!reconstructedRange && highlightedText) {
        for (const part of editableParts) {
            const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
            let node;
            while (node = walker.nextNode()) {
                let indexInNode = -1, searchStartIndex = 0;
                while ((indexInNode = node.textContent.indexOf(highlightedText, searchStartIndex)) !== -1) {
                    const potentialRange = document.createRange(); potentialRange.setStart(node, indexInNode); potentialRange.setEnd(node, indexInNode + highlightedText.length);
                    let alreadyHighlighted = false;
                    const tempWalker = document.createTreeWalker(potentialRange.commonAncestorContainer, NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.tagName === HIGHLIGHT_SPAN_TAG && n.classList.contains(COMMENT_HIGHLIGHT_CLASS) && potentialRange.intersectsNode(n)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP });
                    if (tempWalker.nextNode()) alreadyHighlighted = true;
                    if (!alreadyHighlighted) { reconstructedRange = potentialRange; break; }
                    searchStartIndex = indexInNode + 1;
                }
                if (reconstructedRange) break;
            }
            if (reconstructedRange) break;
        }
    }
    if (reconstructedRange && !reconstructedRange.collapsed) try { processRangeTextNodes(reconstructedRange, () => { const wrapper = document.createElement(HIGHLIGHT_SPAN_TAG); wrapper.className = COMMENT_HIGHLIGHT_CLASS; wrapper.dataset.commentId = id; return wrapper; }); } catch (error) {}
}

export function deleteCommentAndHighlight(commentId) {
    if (!commentId) return;
    removeHighlight(commentId);
    const wasDeletedFromState = deleteCommentFromState(commentId);

    const container = getRightSidebarContainer();
    if (!container) return;

    const groupWrapper = container.querySelector(`.${COMMENT_GROUP_WRAPPER_CLASS}[data-main-comment-id="${commentId}"]`);
    if (groupWrapper) {
        groupWrapper.remove();
    }

    if (activeCommentInputPanelWrapper && activeCommentInputPanelWrapper.dataset.parentCommentId === commentId) {
        activeCommentInputPanelWrapper.remove();
        activeCommentInputPanelWrapper = null;
    }
    if (activeCommentEditPanel && activeCommentEditPanel.dataset.commentId === commentId) {
        activeCommentEditPanel.remove();
        activeCommentEditPanel = null;
    }

    if (wasDeletedFromState) debouncedSave();
}

function renderCommentOrReplyReactions(targetId, targetType, reactionsAreaEl, parentCommentIdForReply = null) {
    if (!reactionsAreaEl) return;
    reactionsAreaEl.innerHTML = '';
    let targetObject;
    if (targetType === 'comment') {
        targetObject = getCommentById(targetId);
    } else if (targetType === 'reply' && parentCommentIdForReply) {
        const parentComment = getCommentById(parentCommentIdForReply);
        targetObject = parentComment?.replies?.find(r => r.id === targetId);
    }
    const reactions = (targetObject && Array.isArray(targetObject.reactions)) ? targetObject.reactions : [];

    if (reactions.length === 0) {
        reactionsAreaEl.style.display = 'none';
        const addReactionBtn = document.createElement('button');
        addReactionBtn.className = 'comment-add-reaction-button';
        addReactionBtn.title = "Добавить реакцию";
        addReactionBtn.innerHTML = `<img src="Icons/Plus.svg" alt="Добавить реакцию">`;
        addReactionBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            showReactionMenu(addReactionBtn, targetId, targetType, parentCommentIdForReply);
        });
        reactionsAreaEl.appendChild(addReactionBtn);
        reactionsAreaEl.style.display = 'flex';
        return;
    }
    reactionsAreaEl.style.display = 'flex';

    reactions.forEach(reaction => {
        if (!reaction.emoji || !Array.isArray(reaction.users) || reaction.users.length === 0) return;
        const reactionButton = document.createElement('button');
        reactionButton.className = 'comment-reaction-emoji';
        reactionButton.dataset.emoji = reaction.emoji;
        if (reaction.users.includes(CURRENT_USER_ID)) reactionButton.classList.add('user-reacted');
        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'emoji'; emojiSpan.textContent = reaction.emoji;
        reactionButton.appendChild(emojiSpan);
        if (reaction.users.length >= 1) {
            const countSpan = document.createElement('span');
            countSpan.className = 'count'; countSpan.textContent = reaction.users.length;
            reactionButton.appendChild(countSpan);
        }
        reactionButton.addEventListener('click', () => handleReactionPillClick(targetId, targetType, reaction.emoji, parentCommentIdForReply));
        reactionsAreaEl.appendChild(reactionButton);
    });

    const addReactionBtn = document.createElement('button');
    addReactionBtn.className = 'comment-add-reaction-button';
    addReactionBtn.title = "Добавить реакцию";
    addReactionBtn.innerHTML = `<img src="Icons/Plus.svg" alt="Добавить реакцию">`;
    addReactionBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        showReactionMenu(addReactionBtn, targetId, targetType, parentCommentIdForReply);
    });
    reactionsAreaEl.appendChild(addReactionBtn);
}

function handleReactionPillClick(targetId, targetType, emoji, parentCommentIdForReply = null) {
    let stateChanged = false;
    if (targetType === 'comment') {
        stateChanged = removeReactionFromCommentInState(targetId, emoji, CURRENT_USER_ID);
        if (!stateChanged) {
            stateChanged = addReactionToCommentInState(targetId, emoji, CURRENT_USER_ID);
        }
    } else if (targetType === 'reply' && parentCommentIdForReply) {
        stateChanged = removeReactionFromReplyInState(parentCommentIdForReply, targetId, emoji, CURRENT_USER_ID);
        if (!stateChanged) {
            stateChanged = addReactionToReplyInState(parentCommentIdForReply, targetId, emoji, CURRENT_USER_ID);
        }
    }
    if (stateChanged) {
        const container = getRightSidebarContainer();
        let targetPanel = (targetType === 'comment') ?
            container?.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${targetId}"]`) :
            container?.querySelector(`.${COMMENT_REPLY_CLASS}[data-reply-id="${targetId}"]`);
        if (targetPanel) {
            const reactionsArea = targetPanel.querySelector('.comment-reactions-area');
            if (reactionsArea) renderCommentOrReplyReactions(targetId, targetType, reactionsArea, parentCommentIdForReply);
        }
        debouncedSave();
    }
}

export function addReaction(targetId, targetType, emoji, parentCommentIdForReply = null) {
    let stateChanged = false;
    if (targetType === 'comment') {
        stateChanged = addReactionToCommentInState(targetId, emoji, CURRENT_USER_ID);
    } else if (targetType === 'reply' && parentCommentIdForReply) {
        stateChanged = addReactionToReplyInState(parentCommentIdForReply, targetId, emoji, CURRENT_USER_ID);
    }
    if (stateChanged) {
        const container = getRightSidebarContainer();
        let targetPanel = (targetType === 'comment') ?
            container?.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${targetId}"]`) :
            container?.querySelector(`.${COMMENT_REPLY_CLASS}[data-reply-id="${targetId}"]`);

        if (targetPanel) {
             const contentContainer = targetPanel.querySelector('.comment-content-container');
             if (contentContainer) {
                let reactionsArea = contentContainer.querySelector('.comment-reactions-area');
                if (!reactionsArea) {
                    reactionsArea = document.createElement('div');
                    reactionsArea.className = 'comment-reactions-area';
                    const bodyContent = contentContainer.querySelector('.comment-body-content');
                    if (bodyContent) {
                        bodyContent.appendChild(reactionsArea);
                    } else {
                         contentContainer.appendChild(reactionsArea);
                    }
                }
                reactionsArea.style.display = 'flex';
                renderCommentOrReplyReactions(targetId, targetType, reactionsArea, parentCommentIdForReply);
            }
        }
        debouncedSave();
    }
}

function createCommentOrReplyHeader(data, isReply = false) {
    const headerElement = document.createElement('div');
    headerElement.className = 'comment-header';

    const authorTimeGroup = document.createElement('div');
    authorTimeGroup.className = 'comment-author-time-group';

    const authorNameSpan = document.createElement('span');
    authorNameSpan.className = 'comment-author';
    authorNameSpan.textContent = data.author || "Аноним";

    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'comment-timestamp';
    timestampSpan.textContent = formatTimestamp(data.timestamp);

    authorTimeGroup.appendChild(authorNameSpan);
    authorTimeGroup.appendChild(timestampSpan);
    headerElement.appendChild(authorTimeGroup);

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'comment-reply-actions-hover-menu';

    const replyButton = document.createElement('button');
    replyButton.className = 'comment-action-button';
    replyButton.dataset.action = 'reply';
    replyButton.title = "Ответить";
    replyButton.innerHTML = `<img src="Icons/Reply.svg" alt="Ответить">`;
    actionsContainer.appendChild(replyButton);

    const reactButton = document.createElement('button');
    reactButton.className = 'comment-action-button';
    reactButton.dataset.action = 'react';
    reactButton.title = "Добавить реакцию";
    reactButton.innerHTML = `<img src="Icons/Reaction.svg" alt="Реакция">`;
    actionsContainer.appendChild(reactButton);

    if (!isReply) {
        const acceptButton = document.createElement('button');
        acceptButton.className = 'comment-action-button';
        acceptButton.dataset.action = 'accept';
        acceptButton.title = "Принять комментарий";
        acceptButton.innerHTML = `<img src="Icons/Circle Check.svg" alt="Принять">`;
        actionsContainer.appendChild(acceptButton);
    }

    const moreButton = document.createElement('button');
    moreButton.className = 'comment-action-button';
    moreButton.dataset.action = 'more';
    moreButton.title = "Дополнительные действия";
    moreButton.innerHTML = `<img src="Icons/Menu.svg" alt="Еще">`;
    actionsContainer.appendChild(moreButton);

    headerElement.appendChild(actionsContainer);

    return headerElement;
}

function createCommentBody(commentData, isReply = false) {
    const bodyContentElement = document.createElement('div');
    bodyContentElement.className = 'comment-body-content';

    if (!isReply && commentData.highlightedText && commentData.highlightedText.trim() !== '') {
        const originalTextElement = document.createElement('div');
        originalTextElement.className = 'comment-original-text';
        originalTextElement.textContent = commentData.highlightedText;
        bodyContentElement.appendChild(originalTextElement);
    }

    const textElement = document.createElement('div');
    textElement.className = 'comment-text';
    textElement.innerHTML = (commentData.text || "").replace(/\n/g, '<br>');
    bodyContentElement.appendChild(textElement);

    const reactionsAreaElement = document.createElement('div');
    reactionsAreaElement.className = 'comment-reactions-area';
    bodyContentElement.appendChild(reactionsAreaElement);

    return bodyContentElement;
}

function createCommentPanelDOM(commentData) {
    const panelElement = document.createElement('div');
    panelElement.className = COMMENT_PANEL_CLASS;
    panelElement.dataset.commentId = commentData.id;

    const avatarContainer = document.createElement('div');
    avatarContainer.className = 'comment-avatar-container';
    const avatarImg = document.createElement('img');
    avatarImg.src = 'Icons/User.svg';
    avatarImg.alt = commentData.author || "Аватар";
    avatarImg.className = 'comment-avatar';
    avatarContainer.appendChild(avatarImg);

    const contentContainer = document.createElement('div');
    contentContainer.className = 'comment-content-container';

    const headerElement = createCommentOrReplyHeader(commentData, false);
    const bodyElement = createCommentBody(commentData, false);

    contentContainer.appendChild(headerElement);
    contentContainer.appendChild(bodyElement);

    panelElement.appendChild(avatarContainer);
    panelElement.appendChild(contentContainer);

    const reactionsArea = bodyElement.querySelector('.comment-reactions-area');
    renderCommentOrReplyReactions(commentData.id, 'comment', reactionsArea, null);

    return panelElement;
}

function createReplyPanelDOM(replyData, parentCommentId) {
    const replyElement = document.createElement('div');
    replyElement.className = COMMENT_REPLY_CLASS;
    replyElement.dataset.replyId = replyData.id;
    replyElement.dataset.parentCommentId = parentCommentId;
    if (replyData.parentReplyId) {
        replyElement.dataset.parentReplyId = replyData.parentReplyId;
    }

    const avatarContainer = document.createElement('div');
    avatarContainer.className = 'comment-avatar-container';
    const avatarImg = document.createElement('img');
    avatarImg.src = 'Icons/User.svg';
    avatarImg.alt = replyData.author || "Аватар";
    avatarImg.className = 'comment-avatar';
    avatarContainer.appendChild(avatarImg);

    const contentContainer = document.createElement('div');
    contentContainer.className = 'comment-content-container';

    const headerElement = createCommentOrReplyHeader(replyData, true);
    const bodyElement = createCommentBody(replyData, true);

    contentContainer.appendChild(headerElement);
    contentContainer.appendChild(bodyElement);

    replyElement.appendChild(avatarContainer);
    replyElement.appendChild(contentContainer);

    const reactionsArea = bodyElement.querySelector('.comment-reactions-area');
    renderCommentOrReplyReactions(replyData.id, 'reply', reactionsArea, parentCommentId);

    return replyElement;
}


function createInputPanelDOM(parentCommentId, parentReplyId = null, isMainCommentInput = false) {
    const wrapperElement = document.createElement('div');
    wrapperElement.className = COMMENT_INPUT_PANEL_WRAPPER_CLASS;
    if (parentCommentId) wrapperElement.dataset.parentCommentId = parentCommentId;
    if (parentReplyId) wrapperElement.dataset.parentReplyId = parentReplyId;

    const avatarContainer = document.createElement('div');
    avatarContainer.className = 'comment-avatar-container';
    const avatarImg = document.createElement('img');
    avatarImg.src = 'Icons/User.svg';
    avatarImg.alt = CURRENT_USER_NAME;
    avatarImg.className = 'comment-avatar';
    avatarContainer.appendChild(avatarImg);

    const contentContainer = document.createElement('div');
    contentContainer.className = 'comment-content-container';

    const textareaWrapper = document.createElement('div');
    textareaWrapper.className = 'comment-textarea-wrapper';

    const textarea = document.createElement('textarea');
    textarea.className = 'comment-textarea';
    textarea.placeholder = isMainCommentInput || !parentCommentId ? 'Добавить комментарий...' : 'Ответить...';
    textarea.rows = 1;

    const sendButton = document.createElement('button');
    sendButton.className = 'comment-send-button';
    sendButton.disabled = true;
    sendButton.innerHTML = '<img src="Icons/Send Arrow.svg" alt="Отправить">';
    sendButton.title = isMainCommentInput || !parentCommentId ? "Отправить комментарий" : "Отправить ответ";

    textareaWrapper.appendChild(textarea);
    textareaWrapper.appendChild(sendButton);
    contentContainer.appendChild(textareaWrapper);

    wrapperElement.appendChild(avatarContainer);
    wrapperElement.appendChild(contentContainer);

    textarea.addEventListener('focus', () => textareaWrapper.classList.add(TEXTAREA_FOCUSED_CLASS));
    textarea.addEventListener('blur', () => {
        textareaWrapper.classList.remove(TEXTAREA_FOCUSED_CLASS);
        if (parentReplyId) {
            updateReplyButtonActiveState(parentReplyId, false);
        } else if (parentCommentId) {
            updateReplyButtonActiveState(parentCommentId, false);
        }
    });
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, parseFloat(getComputedStyle(textarea).maxHeight))}px`;
        sendButton.disabled = textarea.value.trim() === '';
    });

    sendButton.addEventListener('click', () => {
        if (isMainCommentInput) {
             const tempCommentId = getNextCommentId();
             const tempRangeInfo = { text: "Новый комментарий без выделения", blockId: null, startOffset: null, endOffset: null };
             handleSendComment(tempCommentId, "Новый комментарий без выделения", textarea.value, tempRangeInfo, true);
        } else if (parentCommentId && !parentReplyId) {
            handleSendReply(parentCommentId, textarea.value, null);
        } else if (parentCommentId && parentReplyId) {
            handleSendReply(parentCommentId, textarea.value, parentReplyId);
        }
        textarea.value = '';
        textarea.style.height = 'auto';
        sendButton.disabled = true;
    });

    textarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!sendButton.disabled) sendButton.click();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            wrapperElement.remove();
            if (activeCommentInputPanelWrapper === wrapperElement) {
                activeCommentInputPanelWrapper = null;
            }
            if (parentReplyId) {
                updateReplyButtonActiveState(parentReplyId, false);
            } else if (parentCommentId) {
                updateReplyButtonActiveState(parentCommentId, false);
            }
        }
    });
    return { wrapperElement, textarea, sendButton };
}


export function showCommentInputPanel(commentId, highlightedText, rangeInfo) {
    const container = getRightSidebarContainer();
    if (!container) return;

    if (activeCommentInputPanelWrapper && container.contains(activeCommentInputPanelWrapper)) {
        activeCommentInputPanelWrapper.remove();
    }
    if (activeCommentEditPanel && container.contains(activeCommentEditPanel)) {
        const displayPanel = container.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${activeCommentEditPanel.dataset.commentId}"]`);
        if (displayPanel) displayPanel.style.display = 'flex';
        activeCommentEditPanel.remove();
        activeCommentEditPanel = null;
    }

    const { wrapperElement, textarea } = createInputPanelDOM(null, null, true);
    activeCommentInputPanelWrapper = wrapperElement;
    activeCommentInputPanelWrapper.dataset.commentId = commentId;
    activeCommentInputPanelWrapper.dataset.isMainInput = "true";

    const textareaInPanel = activeCommentInputPanelWrapper.querySelector('.comment-textarea');
    const sendButtonInPanel = activeCommentInputPanelWrapper.querySelector('.comment-send-button');

    sendButtonInPanel.onclick = () => handleSendComment(commentId, highlightedText, textareaInPanel.value, rangeInfo);
    textareaInPanel.onkeydown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!sendButtonInPanel.disabled) sendButtonInPanel.click();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            removeHighlight(commentId);
            if (activeCommentInputPanelWrapper && container.contains(activeCommentInputPanelWrapper)) {
                activeCommentInputPanelWrapper.remove();
                activeCommentInputPanelWrapper = null;
            }
        }
    };

    const existingMainCommentInput = container.querySelector(`.${COMMENT_INPUT_PANEL_WRAPPER_CLASS}[data-is-main-input="true"]`);
    if (existingMainCommentInput) existingMainCommentInput.remove();

    container.appendChild(activeCommentInputPanelWrapper);
    textarea.focus();
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    sendButtonInPanel.disabled = textarea.value.trim() === '';
}

export function showReplyInputPanel(parentDomElement, parentCommentId, parentReplyId = null) {
    const container = getRightSidebarContainer();
    if (!container || !parentDomElement || !parentCommentId) return;

    if (activeCommentInputPanelWrapper && container.contains(activeCommentInputPanelWrapper)) {
        activeCommentInputPanelWrapper.remove();
        activeCommentInputPanelWrapper = null;
    }
    if (activeCommentEditPanel && container.contains(activeCommentEditPanel)) {
        const displayPanel = container.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${activeCommentEditPanel.dataset.commentId}"]`);
        if (displayPanel) displayPanel.style.display = 'flex';
        activeCommentEditPanel.remove();
        activeCommentEditPanel = null;
    }

    const existingReplyInput = container.querySelector(`.${COMMENT_INPUT_PANEL_WRAPPER_CLASS}[data-parent-comment-id="${parentCommentId}"]` + (parentReplyId ? `[data-parent-reply-id="${parentReplyId}"]` : ':not([data-parent-reply-id])'));
    if (existingReplyInput) {
        const textareaInExisting = existingReplyInput.querySelector('.comment-textarea');
        if (textareaInExisting) textareaInExisting.focus();
        return;
    }


    const { wrapperElement, textarea } = createInputPanelDOM(parentCommentId, parentReplyId);
    activeCommentInputPanelWrapper = wrapperElement;

    const groupWrapper = parentDomElement.closest(`.${COMMENT_GROUP_WRAPPER_CLASS}`);
    if (groupWrapper) {
        let insertAfterElement = parentDomElement;
        if (parentReplyId) {
             const repliesInGroup = Array.from(groupWrapper.querySelectorAll(`.${COMMENT_REPLY_CLASS}[data-parent-comment-id="${parentCommentId}"][data-parent-reply-id="${parentReplyId}"]`));
             if(repliesInGroup.length > 0) {
                insertAfterElement = repliesInGroup[repliesInGroup.length -1];
             }
        } else {
            const directReplies = Array.from(groupWrapper.querySelectorAll(`.${COMMENT_REPLY_CLASS}[data-parent-comment-id="${parentCommentId}"]:not([data-parent-reply-id])`));
             if(directReplies.length > 0) {
                insertAfterElement = directReplies[directReplies.length -1];
             } else {
                insertAfterElement = groupWrapper.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${parentCommentId}"]`);
             }
        }
        if (insertAfterElement && insertAfterElement.parentNode === groupWrapper) {
             groupWrapper.insertBefore(activeCommentInputPanelWrapper, insertAfterElement.nextSibling);
        } else {
             groupWrapper.appendChild(activeCommentInputPanelWrapper);
        }

    } else {
        container.appendChild(activeCommentInputPanelWrapper);
    }

    textarea.focus();
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
}


function handleSendComment(commentId, highlightedText, commentText, rangeInfo, isNewMainComment = false) {
    const trimmedComment = commentText.trim();
    if (!trimmedComment) return;
    const currentDocId = getActiveDocId();
    if (currentDocId === null) { alert("Не удалось сохранить комментарий: активный документ не выбран."); if(!isNewMainComment) removeHighlight(commentId); return; }

    const commentData = {
        id: commentId,
        docId: currentDocId,
        highlightedText: rangeInfo.text || highlightedText,
        text: trimmedComment,
        author: CURRENT_USER_NAME,
        timestamp: Date.now(),
        replies: [],
        reactions: [],
        blockId: rangeInfo.blockId,
        startOffset: rangeInfo.startOffset,
        endOffset: rangeInfo.endOffset
    };

    if (addCommentToState(commentData)) {
        debouncedSave();
        const container = getRightSidebarContainer();
        if (activeCommentInputPanelWrapper && container?.contains(activeCommentInputPanelWrapper)) {
            activeCommentInputPanelWrapper.remove();
            activeCommentInputPanelWrapper = null;
        }
        renderCommentGroup(commentData);
        if (isNewMainComment) {
            const { wrapperElement, textarea } = createInputPanelDOM(null, null, true);
            activeCommentInputPanelWrapper = wrapperElement;
            activeCommentInputPanelWrapper.dataset.isMainInput = "true";
            container.appendChild(activeCommentInputPanelWrapper);
            textarea.style.height = 'auto';
        }

    } else { alert("Не удалось сохранить комментарий. Возможно, он уже существует или произошла ошибка."); }
}

function handleSendReply(parentCommentId, replyText, parentReplyId = null) {
    const trimmedReply = replyText.trim();
    if (!trimmedReply) return;
    const currentDocId = getActiveDocId();
    if (currentDocId === null) { alert("Не удалось сохранить ответ: активный документ не выбран."); return; }

    const replyData = {
        id: getNextReplyId(parentCommentId),
        docId: currentDocId,
        parentCommentId: parentCommentId,
        parentReplyId: parentReplyId || null,
        text: trimmedReply,
        author: CURRENT_USER_NAME,
        timestamp: Date.now(),
        reactions: []
    };

    if (addReplyToState(parentCommentId, replyData)) {
        debouncedSave();
        const container = getRightSidebarContainer();
        if (activeCommentInputPanelWrapper && container?.contains(activeCommentInputPanelWrapper)) {
            activeCommentInputPanelWrapper.remove();
            activeCommentInputPanelWrapper = null;
        }
        updateReplyButtonActiveState(parentReplyId || parentCommentId, false);

        const groupWrapper = container.querySelector(`.${COMMENT_GROUP_WRAPPER_CLASS}[data-main-comment-id="${parentCommentId}"]`);
        if (groupWrapper) {
            const newReplyElement = createReplyPanelDOM(replyData, parentCommentId);
            let insertAfterNode = parentReplyId ?
                groupWrapper.querySelector(`.${COMMENT_REPLY_CLASS}[data-reply-id="${parentReplyId}"]`) :
                groupWrapper.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${parentCommentId}"]`);

            if (parentReplyId) {
                const siblings = Array.from(groupWrapper.children);
                let lastSiblingReplyToSameParentReply = insertAfterNode;
                for (let i = siblings.indexOf(insertAfterNode) + 1; i < siblings.length; i++) {
                    if (siblings[i].classList.contains(COMMENT_REPLY_CLASS) && siblings[i].dataset.parentReplyId === parentReplyId) {
                        lastSiblingReplyToSameParentReply = siblings[i];
                    } else { break; }
                }
                insertAfterNode = lastSiblingReplyToSameParentReply;
            } else {
                 const directRepliesToMain = Array.from(groupWrapper.children).filter(child =>
                     child.classList.contains(COMMENT_REPLY_CLASS) &&
                     child.dataset.parentCommentId === parentCommentId &&
                     !child.dataset.parentReplyId
                 );
                 if (directRepliesToMain.length > 0) {
                     insertAfterNode = directRepliesToMain[directRepliesToMain.length - 1];
                 }
            }


            if (insertAfterNode && insertAfterNode.parentNode === groupWrapper) {
                groupWrapper.insertBefore(newReplyElement, insertAfterNode.nextSibling);
            } else {
                groupWrapper.appendChild(newReplyElement);
            }
            showReplyInputPanel(groupWrapper, parentCommentId, null);
        }
    } else {
        alert("Не удалось сохранить ответ.");
    }
}

function renderCommentGroup(commentData) {
    const container = getRightSidebarContainer();
    if (!container) return;

    let groupWrapper = container.querySelector(`.${COMMENT_GROUP_WRAPPER_CLASS}[data-main-comment-id="${commentData.id}"]`);
    if (groupWrapper) {
        groupWrapper.innerHTML = '';
    } else {
        groupWrapper = document.createElement('div');
        groupWrapper.className = COMMENT_GROUP_WRAPPER_CLASS;
        groupWrapper.dataset.mainCommentId = commentData.id;
        const firstChild = container.firstChild;
        if (firstChild && firstChild.classList && firstChild.classList.contains(COMMENT_INPUT_PANEL_WRAPPER_CLASS) && firstChild.dataset.isMainInput === "true") {
            container.insertBefore(groupWrapper, firstChild);
        } else {
            container.insertBefore(groupWrapper, container.firstChild);
        }
    }

    const mainCommentPanel = createCommentPanelDOM(commentData);
    groupWrapper.appendChild(mainCommentPanel);

    if (Array.isArray(commentData.replies)) {
        commentData.replies.sort((a, b) => a.timestamp - b.timestamp).forEach(replyData => {
            const replyElement = createReplyPanelDOM(replyData, commentData.id);
            groupWrapper.appendChild(replyElement);
        });
    }

    const existingReplyInput = groupWrapper.querySelector(`.${COMMENT_INPUT_PANEL_WRAPPER_CLASS}:not([data-is-main-input="true"])`);
    if(existingReplyInput) existingReplyInput.remove();

    showReplyInputPanel(groupWrapper, commentData.id, null);
}


export function showCommentEditPanel(commentData) {
    const container = getRightSidebarContainer();
    const groupWrapper = container?.querySelector(`.${COMMENT_GROUP_WRAPPER_CLASS}[data-main-comment-id="${commentData.id}"]`);
    const displayPanel = groupWrapper
        ? groupWrapper.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${commentData.id}"]`)
        : container?.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${commentData.id}"]`);

    if (!container || !displayPanel) return;

    displayPanel.style.display = 'none';

    if (activeCommentInputPanelWrapper && container.contains(activeCommentInputPanelWrapper)) {
        if (activeCommentInputPanelWrapper.dataset.commentId === commentData.id) {
             removeHighlight(commentData.id);
        }
        activeCommentInputPanelWrapper.remove();
        activeCommentInputPanelWrapper = null;
    }

    if (activeCommentEditPanel && activeCommentEditPanel.dataset.commentId !== commentData.id && container.contains(activeCommentEditPanel)) {
        const otherDisplayPanel = container.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${activeCommentEditPanel.dataset.commentId}"]`);
        if (otherDisplayPanel) otherDisplayPanel.style.display = 'flex';
        activeCommentEditPanel.remove();
    }

    activeCommentEditPanel = document.createElement('div');
    activeCommentEditPanel.className = `${COMMENT_PANEL_CLASS} comment-edit-panel`;
    activeCommentEditPanel.dataset.commentId = commentData.id;

    const avatarContainer = document.createElement('div');
    avatarContainer.className = 'comment-avatar-container';
    const avatarImg = document.createElement('img');
    avatarImg.src = 'Icons/User.svg'; avatarImg.alt = commentData.author; avatarImg.className = 'comment-avatar';
    avatarContainer.appendChild(avatarImg);

    const contentContainer = document.createElement('div');
    contentContainer.className = 'comment-content-container';

    const textareaWrapper = document.createElement('div');
    textareaWrapper.className = 'comment-textarea-wrapper';

    const newTextarea = document.createElement('textarea');
    newTextarea.className = 'comment-textarea';
    newTextarea.value = commentData.text.replace(/<br\s*\/?>/gi, "\n");
    newTextarea.rows = 1;

    const updateButton = document.createElement('button');
    updateButton.className = 'comment-send-button';
    updateButton.disabled = true;
    updateButton.innerHTML = '<img src="Icons/Send Arrow.svg" alt="Обновить">';
    updateButton.title = "Обновить комментарий";

    textareaWrapper.appendChild(newTextarea);
    textareaWrapper.appendChild(updateButton);
    contentContainer.appendChild(textareaWrapper);

    activeCommentEditPanel.appendChild(avatarContainer);
    activeCommentEditPanel.appendChild(contentContainer);

    const targetContainerForEdit = groupWrapper || container;
    targetContainerForEdit.insertBefore(activeCommentEditPanel, displayPanel);

    newTextarea.addEventListener('focus', () => textareaWrapper.classList.add(TEXTAREA_FOCUSED_CLASS));
    newTextarea.addEventListener('blur', () => textareaWrapper.classList.remove(TEXTAREA_FOCUSED_CLASS));
    newTextarea.addEventListener('input', () => {
        newTextarea.style.height = 'auto';
        newTextarea.style.height = `${Math.min(newTextarea.scrollHeight, parseFloat(getComputedStyle(newTextarea).maxHeight))}px`;
        updateButton.disabled = newTextarea.value.trim() === '' || newTextarea.value.trim() === commentData.text.replace(/<br\s*\/?>/gi, "\n");
    });
    updateButton.addEventListener('click', () => handleUpdateComment(commentData.id, newTextarea.value));
    newTextarea.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!updateButton.disabled) updateButton.click(); }
        else if (event.key === 'Escape') {
            event.preventDefault();
            if (activeCommentEditPanel && targetContainerForEdit.contains(activeCommentEditPanel)) targetContainerForEdit.removeChild(activeCommentEditPanel);
            activeCommentEditPanel = null;
            displayPanel.style.display = 'flex';
        }
    });

    newTextarea.focus();
    newTextarea.select();
    newTextarea.style.height = 'auto';
    newTextarea.style.height = `${newTextarea.scrollHeight}px`;
    updateButton.disabled = newTextarea.value.trim() === '' || newTextarea.value.trim() === commentData.text.replace(/<br\s*\/?>/gi, "\n");
}


function handleUpdateComment(commentId, newText) {
    const trimmedText = newText.trim();
    if (!trimmedText) { alert("Текст комментария не может быть пустым."); return; }
    if (updateCommentInState(commentId, { text: trimmedText })) {
        debouncedSave();
        const container = getRightSidebarContainer();
        const groupWrapper = container?.querySelector(`.${COMMENT_GROUP_WRAPPER_CLASS}[data-main-comment-id="${commentId}"]`);
        const displayPanel = groupWrapper
            ? groupWrapper.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${commentId}"]`)
            : container?.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${commentId}"]`);

        const editPanel = (groupWrapper || container)?.querySelector(`.comment-edit-panel[data-comment-id="${commentId}"]`);

        if (editPanel) { editPanel.remove(); activeCommentEditPanel = null; }
        if (displayPanel) {
            const commentTextEl = displayPanel.querySelector('.comment-text');
            if (commentTextEl) commentTextEl.innerHTML = trimmedText.replace(/\n/g, '<br>');
            displayPanel.style.display = 'flex';
        } else {
            const commentData = getCommentById(commentId);
            if (commentData) renderCommentGroup(commentData);
        }
    } else { alert("Не удалось обновить комментарий."); }
}

export function initializeComments() {
    rightSidebarContainer = getRightSidebarContainer();
    loadCommentsForDocument(getActiveDocId());
    if (editorArea) {
        editorArea.addEventListener('click', (event) => {
            const highlightSpan = event.target.closest(`.${COMMENT_HIGHLIGHT_CLASS}[data-comment-id]`);
            if (highlightSpan) { const commentId = highlightSpan.dataset.commentId; if (commentId) { event.stopPropagation(); event.preventDefault(); handleHighlightClick(commentId); } }
        });
    }
}

export function startCommenting(range) {
    if (!range || range.collapsed) return;
    const commentId = getNextCommentId();
    const highlightResult = applyHighlight(range.cloneRange(), commentId);
    if (highlightResult.success) {
        showCommentInputPanel(commentId, highlightResult.text, highlightResult);
    } else {
        alert("Не удалось применить выделение для комментария. Попробуйте выделить другой фрагмент.");
    }
}

export function loadCommentsForDocument(docId) {
    const container = getRightSidebarContainer();
    if (!container) return;
    container.innerHTML = '';
    activeCommentInputPanelWrapper = null;
    activeCommentEditPanel = null;

    if (editorArea) {
        editorArea.querySelectorAll(`.${COMMENT_HIGHLIGHT_CLASS}[data-comment-id]`).forEach(span => unwrapElement(span));
        editorArea.normalize();
    }

    if (docId === null) {
        if (rightSidebarContainer) {
            rightSidebarContainer.classList.add('collapsed');
            rightSidebarContainer.style.width = '0';
        }
        return;
    }

    if (rightSidebarContainer && rightSidebarContainer.classList.contains('collapsed')) {
        rightSidebarContainer.classList.remove('collapsed');
        rightSidebarContainer.style.width = 'var(--dynamic-comment-panel-width, var(--sidebar-width, 300px))';
    }

    const comments = getCommentsForDoc(docId);
    comments.sort((a, b) => a.timestamp - b.timestamp);
    comments.forEach(commentData => {
        restoreHighlight(commentData);
        renderCommentGroup(commentData);
    });

    const { wrapperElement, textarea } = createInputPanelDOM(null, null, true);
    activeCommentInputPanelWrapper = wrapperElement;
    activeCommentInputPanelWrapper.dataset.isMainInput = "true";
    container.appendChild(activeCommentInputPanelWrapper);
    textarea.style.height = 'auto';
}

export function handleHighlightClick(commentId) {
    const container = getRightSidebarContainer();
    if (rightSidebarContainer && rightSidebarContainer.classList.contains('collapsed')) {
        rightSidebarContainer.classList.remove('collapsed');
        rightSidebarContainer.style.width = 'var(--dynamic-comment-panel-width, var(--sidebar-width, 300px))';
    }
    const groupWrapper = container?.querySelector(`.${COMMENT_GROUP_WRAPPER_CLASS}[data-main-comment-id="${commentId}"]`);

    if (groupWrapper) {
        groupWrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const mainPanel = groupWrapper.querySelector(`.${COMMENT_PANEL_CLASS}[data-comment-id="${commentId}"]`);
        if (mainPanel) {
            mainPanel.style.transition = 'background-color 0.5s ease, box-shadow 0.5s ease';
            mainPanel.style.backgroundColor = 'rgba(255, 249, 167, 0.15)';
            setTimeout(() => {
                if (document.body.contains(mainPanel)) {
                     mainPanel.style.backgroundColor = '';
                }
            }, 1000);
        }
    } else {
        const commentData = getCommentById(commentId);
        if (commentData) {
            renderCommentGroup(commentData);
            setTimeout(() => {
                const newlyAddedGroup = container?.querySelector(`.${COMMENT_GROUP_WRAPPER_CLASS}[data-main-comment-id="${commentId}"]`);
                if (newlyAddedGroup) newlyAddedGroup.scrollIntoView({ behavior: 'smooth', block: 'center' });
             }, 100);
        }
    }
}

export function triggerReplyToComment(parentCommentId) {
    const container = getRightSidebarContainer();
    const groupWrapper = container?.querySelector(`.${COMMENT_GROUP_WRAPPER_CLASS}[data-main-comment-id="${parentCommentId}"]`);
    if (groupWrapper) {
        showReplyInputPanel(groupWrapper, parentCommentId, null);
        updateReplyButtonActiveState(parentCommentId, true);
    }
}

export function triggerReplyToReply(parentCommentId, replyId) {
    const container = getRightSidebarContainer();
    const groupWrapper = container?.querySelector(`.${COMMENT_GROUP_WRAPPER_CLASS}[data-main-comment-id="${parentCommentId}"]`);
    const parentReplyElement = groupWrapper?.querySelector(`.${COMMENT_REPLY_CLASS}[data-reply-id="${replyId}"]`);
    if (parentReplyElement) {
        showReplyInputPanel(parentReplyElement, parentCommentId, replyId);
        updateReplyButtonActiveState(replyId, true);
    }
}

export function collapseAllCommentGroups() {
    // This function is likely obsolete with the new thread design
}

export function expandCommentGroup(commentId) {
    // This function is likely obsolete with the new thread design
    handleHighlightClick(commentId);
}