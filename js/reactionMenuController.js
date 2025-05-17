// js/reactionMenuController.js
// Управляет меню выбора реакций (эмодзи)
// --- ВЕРСИЯ 5: Добавлен экспорт getReactionMenuAnchor ---

import { addReaction } from './commentController.js';

// --- Состояние модуля ---
let menuElement = null;
let searchInputElement = null;
let scrollAreaElement = null;
let isVisible = false;
let positionAnchorElement = null; // Элемент (кнопка), относительно которого позиционируется меню
let currentTargetCommentId = null;
let currentTargetType = 'comment';
let currentParentCommentIdForReply = null;

let clickOutsideListener = null;
let keydownListener = null;

const emojiData = [ // Используйте ваш полный список эмодзи здесь
    {
        name: "Недавние",
        id: "recent",
        emojis: []
    },
    {
        name: "Смайлики и люди",
        id: "smileys_people",
        emojis: [
            { emoji: "😀", keywords: ["лицо", "улыбка", "радость"] },
            { emoji: "😂", keywords: ["лицо", "слезы", "смех", "лол"] },
            { emoji: "👍", keywords: ["палец вверх", "лайк", "хорошо"] },
            { emoji: "❤️", keywords: ["сердце", "любовь"] },
            { emoji: "🎉", keywords: ["праздник", "вечеринка"] },
            { emoji: "🤔", keywords: ["размышление", "думаю"] },
            // ... (остальные ваши эмодзи для этой категории)
        ]
    },
    // ... (остальные ваши категории эмодзи)
];

const MAX_RECENT_EMOJIS = 12;

// --- Вспомогательные функции ---
function ensureMenuDOM() {
    if (menuElement && document.body.contains(menuElement)) return;
    if (menuElement) menuElement.remove();
    menuElement = document.createElement('div');
    menuElement.id = 'reaction-emoji-menu';
    menuElement.className = 'reaction-menu';
    const searchContainer = document.createElement('div');
    searchContainer.className = 'reaction-menu-search-container';
    const searchIconSvg = `
        <svg class="reaction-menu-search-icon" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.545 15.467l-3.979-3.979a6.25 6.25 0 10-2.102 2.102l3.979 3.979a1.25 1.25 0 001.768-1.768zm-11.295-3.7a3.75 3.75 0 117.5 0 3.75 3.75 0 01-7.5 0z" fill-rule="evenodd" clip-rule="evenodd"></path>
        </svg>
    `;
    searchContainer.innerHTML = searchIconSvg;
    searchInputElement = document.createElement('input');
    searchInputElement.type = 'text';
    searchInputElement.placeholder = 'Найти эмодзи...';
    searchInputElement.className = 'reaction-menu-search-input';
    searchContainer.appendChild(searchInputElement);
    scrollAreaElement = document.createElement('div');
    scrollAreaElement.className = 'reaction-menu-scroll-area';
    menuElement.appendChild(searchContainer);
    menuElement.appendChild(scrollAreaElement);
    document.body.appendChild(menuElement);
    searchInputElement.addEventListener('input', handleSearchInput);
    menuElement.addEventListener('mousedown', (e) => e.stopPropagation());
    scrollAreaElement.addEventListener('click', handleEmojiClick);
}

function populateEmojis(searchTerm = "") {
    if (!scrollAreaElement) return;
    scrollAreaElement.innerHTML = '';
    const lowerSearchTerm = searchTerm.toLowerCase().trim();
    let foundResultsOverall = false;
    emojiData.forEach(category => {
        let emojisToDisplay;
        if (category.id === "recent") {
            emojisToDisplay = lowerSearchTerm ?
                category.emojis.filter(eObj =>
                    eObj.emoji.includes(lowerSearchTerm) ||
                    (eObj.keywords && eObj.keywords.some(kw => kw.toLowerCase().includes(lowerSearchTerm)))
                ) :
                category.emojis;
        } else {
            emojisToDisplay = category.emojis.filter(eObj =>
                eObj.emoji.includes(lowerSearchTerm) ||
                (eObj.keywords && eObj.keywords.some(kw => kw.toLowerCase().includes(lowerSearchTerm))) ||
                (searchTerm && category.name.toLowerCase().includes(lowerSearchTerm))
            );
        }
        if (emojisToDisplay.length > 0) {
            foundResultsOverall = true;
            const categoryDiv = document.createElement('div');
            categoryDiv.className = 'reaction-menu-category';
            const titleDiv = document.createElement('div');
            titleDiv.className = 'reaction-menu-category-title';
            titleDiv.textContent = category.name;
            categoryDiv.appendChild(titleDiv);
            const gridDiv = document.createElement('div');
            gridDiv.className = 'reaction-emoji-grid';
            emojisToDisplay.forEach(emojiObj => {
                const emojiButton = document.createElement('button');
                emojiButton.className = 'reaction-emoji-item';
                emojiButton.textContent = emojiObj.emoji;
                emojiButton.dataset.emoji = emojiObj.emoji;
                gridDiv.appendChild(emojiButton);
            });
            categoryDiv.appendChild(gridDiv);
            scrollAreaElement.appendChild(categoryDiv);
        }
    });
    if (!foundResultsOverall && lowerSearchTerm) {
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'reaction-menu-no-results';
        noResultsDiv.textContent = 'Эмодзи не найдены';
        scrollAreaElement.appendChild(noResultsDiv);
    }
}

function positionMenu() {
    if (!isVisible || !menuElement || !positionAnchorElement) return;
    const anchorRect = positionAnchorElement.getBoundingClientRect();
    menuElement.style.display = 'flex';
    const menuRect = menuElement.getBoundingClientRect();
    let top = anchorRect.top + window.scrollY;
    let left = anchorRect.right + window.scrollX + 8;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    if (left + menuRect.width > viewportWidth - 10) {
        left = anchorRect.left + window.scrollX - menuRect.width - 8;
    }
    if (top + menuRect.height > viewportHeight + window.scrollY - 10) {
        top = viewportHeight + window.scrollY - menuRect.height - 10;
    }
    if (left < 10) left = 10;
    if (top < window.scrollY + 10) top = window.scrollY + 10;
    menuElement.style.top = `${top}px`;
    menuElement.style.left = `${left}px`;
}

function handleSearchInput() {
    if (!searchInputElement) return;
    populateEmojis(searchInputElement.value);
}

function addEmojiToRecents(emojiChar) {
    const recentCategory = emojiData.find(cat => cat.id === "recent");
    if (!recentCategory) return;
    let emojiObjectToAdd = { emoji: emojiChar, keywords: [] };
    for (const category of emojiData) {
        if (category.id !== "recent") {
            const found = category.emojis.find(eObj => eObj.emoji === emojiChar);
            if (found) {
                emojiObjectToAdd = { ...found };
                break;
            }
        }
    }
    recentCategory.emojis = recentCategory.emojis.filter(eObj => eObj.emoji !== emojiChar);
    recentCategory.emojis.unshift(emojiObjectToAdd);
    if (recentCategory.emojis.length > MAX_RECENT_EMOJIS) {
        recentCategory.emojis.length = MAX_RECENT_EMOJIS;
    }
}

function handleEmojiClick(event) {
    const emojiButton = event.target.closest('.reaction-emoji-item');
    if (!emojiButton) return;
    const emoji = emojiButton.dataset.emoji;
    if (emoji) {
        if (currentTargetCommentId && currentTargetType) {
            addReaction(currentTargetCommentId, currentTargetType, emoji, currentParentCommentIdForReply);
        } else {
            console.warn("Reaction Menu: currentTargetCommentId or currentTargetType is null, cannot add reaction.");
        }
        addEmojiToRecents(emoji);
        hideMenu();
    }
}

function handleKeyDown(event) {
    if (!isVisible) return;
    if (event.key === 'Escape') {
        event.stopPropagation();
        hideMenu();
    }
}

function handleClickOutside(event) {
    if (isVisible && menuElement && !menuElement.contains(event.target) &&
        positionAnchorElement && !positionAnchorElement.contains(event.target)) {
        hideMenu();
    }
}

// --- Экспортируемые функции ---

export function initializeReactionMenu() {
    ensureMenuDOM();
    console.log("Reaction Emoji Menu Initialized (v5 - getReactionMenuAnchor export).");
}

export function showMenu(anchorElement, targetId, targetType = 'comment', parentCommentIdForReply = null) {
    if (!anchorElement) {
        console.error("ReactionMenu: Anchor element is required to show the menu.");
        return;
    }
    ensureMenuDOM();
    positionAnchorElement = anchorElement;
    currentTargetCommentId = targetId;
    currentTargetType = targetType;
    currentParentCommentIdForReply = parentCommentIdForReply;
    populateEmojis();
    if(searchInputElement) searchInputElement.value = '';
    menuElement.style.display = 'flex';
    isVisible = true;
    positionMenu();
    if(searchInputElement) searchInputElement.focus();
    setTimeout(() => {
        if (clickOutsideListener) document.removeEventListener('mousedown', clickOutsideListener, true);
        clickOutsideListener = (e) => handleClickOutside(e);
        document.addEventListener('mousedown', clickOutsideListener, true);
        if (keydownListener) document.removeEventListener('keydown', keydownListener, true);
        keydownListener = (e) => handleKeyDown(e);
        document.addEventListener('keydown', keydownListener, true);
    }, 0);
}

export function hideMenu() {
    if (!isVisible) return;
    if (menuElement) {
        menuElement.style.display = 'none';
    }
    isVisible = false;
    // positionAnchorElement = null; // Не сбрасываем здесь, чтобы getReactionMenuAnchor мог его вернуть, если меню только что скрылось
    // currentTargetCommentId, currentTargetType, currentParentCommentIdForReply также не сбрасываем здесь
    if (clickOutsideListener) {
        document.removeEventListener('mousedown', clickOutsideListener, true);
        clickOutsideListener = null;
    }
    if (keydownListener) {
        document.removeEventListener('keydown', keydownListener, true);
        keydownListener = null;
    }
}

export function isReactionMenuVisible() {
    return isVisible;
}

// --- НОВАЯ ЭКСПОРТИРУЕМАЯ ФУНКЦИЯ ---
/**
 * Возвращает элемент, относительно которого было открыто меню реакций.
 * @returns {Element | null}
 */
export function getReactionMenuAnchor() {
    return positionAnchorElement;
}