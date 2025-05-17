// js/linkHoverMenuController.js
// Управляет всплывающим меню при наведении на ссылки в редакторе.
// --- ВЕРСИЯ 12: Использует централизованную showNotification из utils.js ---

import { editorArea, mainContent } from './domElements.js'; // mainContent не используется напрямую для уведомлений здесь
import { getDocumentById } from './state.js';
import { loadDocument, debouncedSave } from './documentManager.js';
import { INTERNAL_LINK_PREFIX } from './config.js';
import { showTooltip, hideTooltip } from './textContextMenuController.js';
import { showMenu as showLinkEditMenu, isLinkEditMenuVisible } from './linkEditMenuController.js';
import { showNotification } from './utils.js'; // <--- ИМПОРТ showNotification

// --- Состояние модуля ---
let menuElement = null;
let targetLinkElement = null;
let isVisible = false;
let showTimeoutId = null;
let hideTimeoutId = null;
let currentTooltipTarget = null;
let tooltipShowTimeoutId = null;
// let editorCopyNotificationElement = null; // Удалено
// let copyNotificationTimeoutId = null; // Удалено
// let editorUnlinkNotificationElement = null; // Удалено
// let unlinkNotificationTimeoutId = null; // Удалено

const SHOW_DELAY = 150;
const HIDE_DELAY = 250;
const TOOLTIP_SHOW_DELAY = 700;
// const NOTIFICATION_DURATION = 3000; // Удалено
const TOOLTIP_OFFSET_Y = -8;

// --- Вспомогательные функции ---

function ensureMenuDOM() {
    if (menuElement) return;
    menuElement = document.createElement('div');
    menuElement.id = 'link-hover-menu';
    menuElement.className = 'link-hover-menu';
    menuElement.addEventListener('mouseenter', handleMenuMouseEnter);
    menuElement.addEventListener('mouseleave', handleMenuMouseLeave);
    menuElement.addEventListener('click', handleMenuClick);
    document.body.appendChild(menuElement);
}

// Функции ensureCopyNotificationDOM, showCopyNotification (старая), hideCopyNotification (старая) УДАЛЕНЫ
// Функции ensureUnlinkNotificationDOM, showUnlinkNotification (старая), hideUnlinkNotification (старая) УДАЛЕНЫ

function getDomainName(urlString) {
    try {
        const url = new URL(urlString);
        let hostname = url.hostname;
        if (hostname.startsWith('www.')) {
            hostname = hostname.substring(4);
        }
        return hostname;
    } catch (e) {
        return urlString;
    }
}

function populateMenu(linkElement) {
    if (!menuElement || !linkElement) return;
    const href = linkElement.getAttribute('href') || '';
    let displayText = href;
    let fullHref = href;
    let isInternal = false;

    if (href.startsWith(INTERNAL_LINK_PREFIX)) {
        isInternal = true;
        const docIdString = href.substring(INTERNAL_LINK_PREFIX.length);
        const docId = parseInt(docIdString, 10);
        if (!isNaN(docId)) {
            const doc = getDocumentById(docId);
            if (doc) {
                displayText = doc.title || `Документ ${docId}`;
            } else {
                displayText = `Документ #${docIdString} (не найден)`;
                fullHref = '#';
            }
        } else {
            displayText = `Некорректная ссылка (${href})`;
            fullHref = '#';
        }
    } else {
        displayText = getDomainName(href);
    }

    menuElement.innerHTML = '';
    const leftPart = document.createElement('div');
    leftPart.className = 'link-hover-part link-hover-left link-hover-action-open';
    const globeIcon = document.createElement('img');
    globeIcon.src = 'Icons/Globe.svg';
    globeIcon.alt = 'Открыть';
    globeIcon.className = 'link-hover-icon';
    leftPart.appendChild(globeIcon);

    const centerPart = document.createElement('div');
    centerPart.className = 'link-hover-part link-hover-center link-hover-action-open';
    const linkTextSpan = document.createElement('span');
    linkTextSpan.className = 'link-hover-text';
    linkTextSpan.textContent = displayText;
    linkTextSpan.addEventListener('mouseover', handleLinkTextMouseOver);
    linkTextSpan.addEventListener('mouseout', handleGenericMouseOut);
    centerPart.appendChild(linkTextSpan);

    const rightPart = document.createElement('div');
    rightPart.className = 'link-hover-part link-hover-right';
    const copyIcon = document.createElement('img');
    copyIcon.src = 'Icons/Duplicate.svg';
    copyIcon.alt = 'Копировать';
    copyIcon.className = 'link-hover-icon link-hover-action-copy';
    copyIcon.addEventListener('mouseover', handleCopyIconMouseOver);
    copyIcon.addEventListener('mouseout', handleGenericMouseOut);
    const unlinkIcon = document.createElement('img');
    unlinkIcon.src = 'Icons/Unlink.svg';
    unlinkIcon.alt = 'Удалить ссылку';
    unlinkIcon.className = 'link-hover-icon link-hover-action-unlink';
    unlinkIcon.addEventListener('mouseover', handleUnlinkIconMouseOver);
    unlinkIcon.addEventListener('mouseout', handleGenericMouseOut);
    const editIcon = document.createElement('img');
    editIcon.src = 'Icons/Edit.svg';
    editIcon.alt = 'Изменить';
    editIcon.className = 'link-hover-icon link-hover-action-edit';
    editIcon.addEventListener('mouseover', handleEditIconMouseOver);
    editIcon.addEventListener('mouseout', handleGenericMouseOut);
    rightPart.appendChild(copyIcon);
    rightPart.appendChild(unlinkIcon);
    rightPart.appendChild(editIcon);
    menuElement.appendChild(leftPart);
    menuElement.appendChild(centerPart);
    menuElement.appendChild(rightPart);
    menuElement.dataset.fullHref = fullHref;
    menuElement.dataset.isInternal = String(isInternal);
}

function positionMenu(linkElement) {
    if (!menuElement || !linkElement) return;
    const linkRect = linkElement.getBoundingClientRect();
    menuElement.style.display = 'flex';
    const menuRect = menuElement.getBoundingClientRect();
    let top = linkRect.bottom + window.scrollY + 4;
    let left = linkRect.left + window.scrollX;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (left < 10) left = 10;
    if (left + menuRect.width > viewportWidth - 10) {
        left = viewportWidth - menuRect.width - 10;
    }
    if (top + menuRect.height > viewportHeight - 10 && linkRect.top > menuRect.height + 10) {
        top = linkRect.top + window.scrollY - menuRect.height - 4;
    }
    if (top < 10) top = 10;
    menuElement.style.top = `${top}px`;
    menuElement.style.left = `${left}px`;
}

function handleMenuClick(event) {
    const target = event.target;
    const fullHref = menuElement?.dataset.fullHref;
    const isInternal = menuElement?.dataset.isInternal === 'true';

    if (target.closest('.link-hover-action-open')) {
        event.stopPropagation();
        if (!fullHref) return;
        if (isInternal) {
            const docIdString = fullHref.substring(INTERNAL_LINK_PREFIX.length);
            const docId = parseInt(docIdString, 10);
            if (!isNaN(docId)) {
                loadDocument(docId);
            } else {
                alert(`Некорректный ID документа: ${docIdString}`);
            }
        } else {
            if (fullHref !== '#') {
                 window.open(fullHref, '_blank', 'noopener,noreferrer');
            } else {
                 alert("Ссылка недействительна.");
            }
        }
        hideMenu(true);
    }
    else if (target.closest('.link-hover-action-copy')) {
        event.stopPropagation();
        if (!fullHref) return;
        navigator.clipboard.writeText(fullHref)
            .then(() => {
                showNotification('Ссылка скопирована', 'Icons/Circle Check.svg'); // Используем новую функцию
            })
            .catch(err => {
                console.error('Link Hover Menu: Failed to copy link: ', err);
                showNotification('Не удалось скопировать ссылку', 'Icons/Alert.svg'); // Используем новую функцию
            });
    }
    else if (target.closest('.link-hover-action-unlink')) {
        event.stopPropagation();
        if (targetLinkElement) {
            const parent = targetLinkElement.parentNode;
            if (parent) {
                while (targetLinkElement.firstChild) {
                    parent.insertBefore(targetLinkElement.firstChild, targetLinkElement);
                }
                parent.removeChild(targetLinkElement);
                debouncedSave();
                showNotification('Ссылка удалена', 'Icons/Circle Check.svg'); // Используем новую функцию
            }
        }
        hideMenu(true);
    }
    else if (target.closest('.link-hover-action-edit')) {
        event.stopPropagation();
        if (targetLinkElement) {
            showLinkEditMenu(targetLinkElement);
        } else {
            console.warn("Cannot open edit menu, targetLinkElement is null.");
        }
        hideMenu(true);
    }
}

function handleMenuMouseEnter() {
    clearTimeout(hideTimeoutId);
}

function handleMenuMouseLeave() {
    hideTimeoutId = setTimeout(() => {
        hideMenu(true);
    }, HIDE_DELAY);
}

function handleLinkTextMouseOver(event) {
    const linkTextElement = event.currentTarget;
    const fullHref = menuElement?.dataset.fullHref;
    clearTimeout(tooltipShowTimeoutId);
    tooltipShowTimeoutId = setTimeout(() => {
        if (linkTextElement && fullHref && linkTextElement.matches(':hover')) {
            showTooltip(linkTextElement, { text: fullHref, position: 'bottom' });
            currentTooltipTarget = linkTextElement;
        }
    }, TOOLTIP_SHOW_DELAY);
}

function handleCopyIconMouseOver(event) {
    const iconElement = event.currentTarget;
    clearTimeout(tooltipShowTimeoutId);
    tooltipShowTimeoutId = setTimeout(() => {
        if (iconElement && iconElement.matches(':hover')) {
            showTooltip(iconElement, { text: 'Копировать ссылку', position: 'top' });
            currentTooltipTarget = iconElement;
        }
    }, TOOLTIP_SHOW_DELAY);
}

function handleUnlinkIconMouseOver(event) {
    const iconElement = event.currentTarget;
    clearTimeout(tooltipShowTimeoutId);
    tooltipShowTimeoutId = setTimeout(() => {
        if (iconElement && iconElement.matches(':hover')) {
            showTooltip(iconElement, { text: 'Удалить ссылку', position: 'top' });
            currentTooltipTarget = iconElement;
        }
    }, TOOLTIP_SHOW_DELAY);
}

function handleEditIconMouseOver(event) {
    const iconElement = event.currentTarget;
    clearTimeout(tooltipShowTimeoutId);
    tooltipShowTimeoutId = setTimeout(() => {
        if (iconElement && iconElement.matches(':hover')) {
            showTooltip(iconElement, { text: 'Изменить ссылку', position: 'top' });
            currentTooltipTarget = iconElement;
        }
    }, TOOLTIP_SHOW_DELAY);
}

function handleGenericMouseOut() {
    clearTimeout(tooltipShowTimeoutId);
    if (currentTooltipTarget) {
        hideTooltip();
        currentTooltipTarget = null;
    }
}

export function initializeLinkHoverMenu() {
    ensureMenuDOM();
    // ensureCopyNotificationDOM(); // Больше не нужно
    // ensureUnlinkNotificationDOM(); // Больше не нужно
    console.log("[LinkHoverMenu LOG] Link Hover Menu Initialized (v12 - using utils.showNotification).");
}

export function showMenu(linkElement) {
    if (!linkElement || !(linkElement instanceof HTMLAnchorElement)) {
        return;
    }
    if (isLinkEditMenuVisible()) {
        return;
    }
    targetLinkElement = linkElement;
    if (isVisible && targetLinkElement === linkElement) {
        clearTimeout(hideTimeoutId);
        return;
    }
    if (isVisible) {
        hideMenu(true);
    }
    clearTimeout(showTimeoutId);
    showTimeoutId = setTimeout(() => {
        ensureMenuDOM();
        populateMenu(linkElement);
        menuElement.style.display = 'flex';
        isVisible = true;
        positionMenu(linkElement);
    }, SHOW_DELAY);
}

export function hideMenu(immediate = false) {
    clearTimeout(showTimeoutId);
    clearTimeout(tooltipShowTimeoutId);
    hideTooltip();

    if (immediate) {
        clearTimeout(hideTimeoutId);
        if (menuElement) {
            menuElement.style.display = 'none';
        }
        isVisible = false;
        targetLinkElement = null;
    } else if (isVisible) {
        clearTimeout(hideTimeoutId);
        hideTimeoutId = setTimeout(() => {
            const isHoveringLink = targetLinkElement && targetLinkElement.matches(':hover');
            const isHoveringMenu = menuElement && menuElement.matches(':hover');
            if (!isHoveringLink && !isHoveringMenu && !isLinkEditMenuVisible()) {
                if (menuElement) {
                    menuElement.style.display = 'none';
                }
                isVisible = false;
                targetLinkElement = null;
            }
        }, HIDE_DELAY);
    }
}