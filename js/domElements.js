// js/domElements.js
// Ссылки на основные DOM-элементы

export const editorArea = document.getElementById('editor-area');
export const mainContent = document.querySelector('.main-content');

export const leftToggleButton = document.querySelector('.left-toggle-button');
export const leftSidebar = document.querySelector('.left-sidebar');
export const searchInput = document.getElementById('doc-search-input');
export const newDocButton = document.getElementById('new-doc-btn');
export const docList = document.getElementById('document-list');
export const currentDocTitleElement = document.getElementById('current-doc-title');

// Добавим проверку на случай, если какие-то элементы не найдены
if (!editorArea) console.error("DOM Element not found: #editor-area");
if (!mainContent) console.error("DOM Element not found: .main-content");
if (!leftSidebar) console.error("DOM Element not found: .left-sidebar");
if (!docList) console.error("DOM Element not found: #document-list");
if (!currentDocTitleElement) console.error("DOM Element not found: #current-doc-title");

// Можно добавить сюда и другие часто используемые элементы, если они статичны
// Например, selectionRectangleElement, хотя он создается динамически позже
export let selectionRectangleElement = null; // Инициализируем как null

export function setSelectionRectangleElement(element) {
    selectionRectangleElement = element;
}

export function getSelectionRectangleElement() {
    return selectionRectangleElement;
}