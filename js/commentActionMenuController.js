import {
    showCommentEditPanel,
    deleteCommentAndHighlight,
    triggerReplyToComment,
    triggerReplyToReply
} from './commentController.js';
import { getCommentById } from './state.js';
import { showNotification } from './utils.js';
import { showMenu as showReactionMenu, isReactionMenuVisible, hideMenu as hideReactionMenu } from './reactionMenuController.js';

let contextMenuElement = null;
let replyContextMenuElement = null;

let currentTargetCommentId = null;
let currentTargetIsReply = false;
let currentTargetReplyId = null;
let currentContextMenuAnchorButton = null;


const mainCommentContextMenuItems = [
    { action: 'edit-comment', label: 'Изменить комментарий', icon: 'Icons/Edit.svg' },
    { action: 'copy-link', label: 'Скопировать ссылку', icon: 'Icons/Link.svg' },
    { action: 'delete-comment', label: 'Удалить комментарий', icon: 'Icons/Trash.svg' }
];

const replyContextMenuItems = [
    { action: 'edit-reply', label: 'Изменить ответ', icon: 'Icons/Edit.svg' },
    { action: 'delete-reply', label: 'Удалить ответ', icon: 'Icons/Trash.svg' }
];


function ensureContextMenuDOM(isReplyContext = false) {
    const menuId = isReplyContext ? 'reply-action-context-menu' : 'comment-action-context-menu';
    let menuToEnsure = isReplyContext ? replyContextMenuElement : contextMenuElement;

    if (menuToEnsure && document.body.contains(menuToEnsure)) {
        return;
    }
    if (menuToEnsure) {
        menuToEnsure.remove();
    }

    menuToEnsure = document.createElement('div');
    menuToEnsure.id = menuId;
    menuToEnsure.className = 'comment-action-context-menu';

    const itemsToRender = isReplyContext ? replyContextMenuItems : mainCommentContextMenuItems;

    itemsToRender.forEach(item => {
        const menuItemEl = document.createElement('div');
        menuItemEl.className = 'comment-context-menu-item';
        menuItemEl.dataset.action = item.action;
        menuItemEl.innerHTML = `
            <img src="${item.icon}" alt="" class="comment-context-menu-icon">
            <span class="comment-context-menu-label">${item.label}</span>
        `;
        menuToEnsure.appendChild(menuItemEl);
    });

    document.body.appendChild(menuToEnsure);

    if (isReplyContext) {
        replyContextMenuElement = menuToEnsure;
        replyContextMenuElement.addEventListener('click', handleContextMenuClick);
        replyContextMenuElement.addEventListener('mousedown', (e) => e.stopPropagation());
    } else {
        contextMenuElement = menuToEnsure;
        contextMenuElement.addEventListener('click', handleContextMenuClick);
        contextMenuElement.addEventListener('mousedown', (e) => e.stopPropagation());
    }
}

function positionContextMenu(anchorButton) {
    const menuToPosition = currentTargetIsReply ? replyContextMenuElement : contextMenuElement;
    if (!menuToPosition || !anchorButton) return;

    const buttonRect = anchorButton.getBoundingClientRect();
    menuToPosition.style.display = 'block';
    const menuRect = menuToPosition.getBoundingClientRect();

    let top = buttonRect.bottom + window.scrollY + 5;
    let left = buttonRect.right + window.scrollX - menuRect.width;

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    if (left < 10) left = 10;
    if (left + menuRect.width > viewportWidth - 10) left = viewportWidth - menuRect.width - 10;

    if (top + menuRect.height > viewportHeight + window.scrollY - 10) {
        top = buttonRect.top + window.scrollY - menuRect.height - 5;
    }
    if (top < 10) top = 10;

    menuToPosition.style.top = `${top}px`;
    menuToPosition.style.left = `${left}px`;
}

function hideContextMenus() {
    if (contextMenuElement) {
        contextMenuElement.style.display = 'none';
        contextMenuElement.querySelectorAll('.comment-context-menu-item').forEach(item => item.removeAttribute('data-comment-id'));
    }
    if (replyContextMenuElement) {
        replyContextMenuElement.style.display = 'none';
        replyContextMenuElement.querySelectorAll('.comment-context-menu-item').forEach(item => {
            item.removeAttribute('data-comment-id');
            item.removeAttribute('data-reply-id');
        });
    }
    document.removeEventListener('mousedown', handleClickOutsideContextMenu, true);
    currentTargetCommentId = null;
    currentTargetIsReply = false;
    currentTargetReplyId = null;
    currentContextMenuAnchorButton = null;
}

function handleClickOutsideContextMenu(event) {
    const activeMenu = currentTargetIsReply ? replyContextMenuElement : contextMenuElement;
    if (activeMenu && activeMenu.style.display !== 'none' &&
        !activeMenu.contains(event.target) &&
        currentContextMenuAnchorButton && !currentContextMenuAnchorButton.contains(event.target) &&
        (!isReactionMenuVisible() || !document.getElementById('reaction-emoji-menu')?.contains(event.target))) {
        hideContextMenus();
    }
}

export function handleCommentActionClick(event, commentOrReplyElement) {
    const button = event.target.closest('.comment-action-button');
    if (!button) return;

    event.stopPropagation();

    const action = button.dataset.action;
    const isReplyElement = commentOrReplyElement.classList.contains('comment-reply');
    const id = isReplyElement ? commentOrReplyElement.dataset.replyId : commentOrReplyElement.dataset.commentId;
    const parentCommentId = commentOrReplyElement.dataset.parentCommentId || (isReplyElement ? null : id);


    if (!id) {
        console.warn("CommentActionMenu: ID is missing from comment/reply element or button dataset.");
        return;
    }

    currentTargetCommentId = parentCommentId || id;
    currentTargetIsReply = isReplyElement;
    currentTargetReplyId = isReplyElement ? id : null;
    currentContextMenuAnchorButton = button;


    switch (action) {
        case 'reply':
            if (isReplyElement) {
                triggerReplyToReply(parentCommentId, id);
            } else {
                triggerReplyToComment(id);
            }
            updateReplyButtonActiveState(id, true);
            break;
        case 'react':
            showReactionMenu(button, id, isReplyElement ? 'reply' : 'comment', isReplyElement ? parentCommentId : null);
            break;
        case 'accept':
            if (!isReplyElement) {
                const commentToAccept = getCommentById(id);
                if (commentToAccept) {
                    deleteCommentAndHighlight(id);
                    showNotification("Вы приняли комментарий", "Icons/Circle Check.svg");
                } else {
                    console.warn(`CommentActionMenu: Comment "${id}" not found for 'accept' action.`);
                }
            }
            hideContextMenus();
            break;
        case 'more':
            ensureContextMenuDOM(isReplyElement);
            const menuToUse = isReplyElement ? replyContextMenuElement : contextMenuElement;
            menuToUse.querySelectorAll('.comment-context-menu-item').forEach(item => {
                item.dataset.commentId = parentCommentId; // For replies, this is the main comment ID
                if (isReplyElement) {
                    item.dataset.replyId = id;
                } else {
                    item.dataset.commentId = id; // For main comments, this is its own ID
                }
            });
            positionContextMenu(button);
            menuToUse.style.display = 'block';
            setTimeout(() => {
                document.removeEventListener('mousedown', handleClickOutsideContextMenu, true);
                document.addEventListener('mousedown', handleClickOutsideContextMenu, true);
            }, 0);
            break;
        default:
            console.warn("CommentActionMenu: Unknown action button action:", action);
            hideContextMenus();
    }
}


function handleContextMenuClick(event) {
    const menuItem = event.target.closest('.comment-context-menu-item');
    if (!menuItem) return;

    const action = menuItem.dataset.action;
    const commentId = menuItem.dataset.commentId;
    const replyId = menuItem.dataset.replyId;

    if (!commentId && !replyId) {
        console.warn("CommentActionMenu: IDs are missing from context menu item for action:", action);
        hideContextMenus();
        return;
    }

    const mainCommentIdForAction = replyId ? commentId : (commentId || currentTargetCommentId);
    const targetIdForAction = replyId || commentId;
    const isReplyAction = !!replyId;

    hideContextMenus();

    const commentData = getCommentById(mainCommentIdForAction);

    if (!commentData && action !== 'copy-link' && action !== 'delete-comment' && action !== 'delete-reply') {
        console.error(`CommentActionMenu: Comment "${mainCommentIdForAction}" not found in state for action: "${action}".`);
        return;
    }

    switch (action) {
        case 'edit-comment':
            if (commentData) {
                showCommentEditPanel(commentData);
            }
            break;
        case 'edit-reply':
            if (commentData && commentData.replies) {
                const replyToEdit = commentData.replies.find(r => r.id === targetIdForAction);
                if (replyToEdit) {
                     showNotification(`Редактирование ответа "${targetIdForAction}" пока не реализовано.`, "Icons/Alert.svg");
                } else {
                    console.error(`CommentActionMenu: Reply "${targetIdForAction}" not found in comment "${mainCommentIdForAction}" for edit.`);
                }
            }
            break;
        case 'copy-link':
            const linkToCopy = `${window.location.origin}${window.location.pathname}#comment-${mainCommentIdForAction}`;
            navigator.clipboard.writeText(linkToCopy)
                .then(() => showNotification(`Ссылка на комментарий скопирована`, "Icons/Link.svg"))
                .catch(err => {
                    console.error('CommentActionMenu: Failed to copy comment link: ', err);
                    showNotification(`Не удалось скопировать ссылку`, "Icons/Alert.svg");
                });
            break;
        case 'delete-comment':
            deleteCommentAndHighlight(targetIdForAction);
            showNotification("Комментарий удален", "Icons/Trash.svg");
            break;
        case 'delete-reply':
             if (commentData && commentData.replies) {
                const replyIndex = commentData.replies.findIndex(r => r.id === targetIdForAction);
                if (replyIndex > -1) {
                    commentData.replies.splice(replyIndex, 1);
                    updateCommentInState(mainCommentIdForAction, { replies: commentData.replies });
                    const replyElementToRemove = document.querySelector(`.comment-reply[data-reply-id="${targetIdForAction}"]`);
                    if (replyElementToRemove) replyElementToRemove.remove();
                    debouncedSave();
                    showNotification("Ответ удален", "Icons/Trash.svg");
                } else {
                     console.error(`CommentActionMenu: Reply "${targetIdForAction}" not found for deletion.`);
                }
            }
            break;
        default:
            console.warn("CommentActionMenu: Unknown context menu action:", action);
    }
}


export function initializeCommentActionMenus() {
    ensureContextMenuDOM(false);
    ensureContextMenuDOM(true);
}

export function updateReplyButtonActiveState(targetId, isActive) {
    const commentOrReplyElement = document.querySelector(`.comment-panel[data-comment-id="${targetId}"], .comment-reply[data-reply-id="${targetId}"]`);
    if (!commentOrReplyElement) return;

    const header = commentOrReplyElement.querySelector('.comment-header');
    if (!header) return;

    const replyButton = header.querySelector(`.comment-action-button[data-action="reply"]`);
    if (replyButton) {
        replyButton.classList.toggle('active', isActive);
    }
}

export { hideContextMenus as hideCommentContextMenus };