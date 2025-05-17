// js/imageMenuController.js
// Управляет меню для добавления изображений (загрузка/вставка по ссылке)
// --- ИЗМЕНЕНО: handleClickOutside теперь закрывает меню при клике на targetBlockElement ---
// --- ИЗМЕНЕНО: replacePlaceholderWithImage модифицирует блок, а не заменяет его ---
// --- ИЗМЕНЕНО: Логика добавления/удаления слушателя handleClickOutside (убрано once: true) ---
// --- ДОБАВЛЕНО: Логика включения/выключения кнопки "Загрузить" по URL ---

import { createBlockElement } from './blockFactory.js'; // Используется косвенно через saveDocumentContent
import { saveDocumentContent } from './documentManager.js';
import { updatePlaceholderVisibility } from './blockUtils.js'; // Может понадобиться для других блоков

// --- Состояние модуля ---
let menuElement = null;
let targetBlockElement = null; // Блок 'image', для которого открыто меню
let fileInputElement = null; // Скрытый input[type=file]
let urlInputElement = null; // Поле ввода URL
let urlLoadButton = null; // Кнопка "Загрузить" для URL
let uploadTabButton = null;
let linkTabButton = null;
let uploadTabContent = null;
let linkTabContent = null;
let currentActiveTab = 'upload'; // 'upload' или 'link'

const MAX_FILE_SIZE_MB = 5; // Максимальный размер файла (как на макете)
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// --- Вспомогательные функции ---

/**
 * Создает DOM-элементы меню и добавляет их в body (скрытыми).
 */
function createMenuDOM() {
    if (menuElement) return; // Уже создано

    menuElement = document.createElement('div');
    menuElement.id = 'image-block-menu';
    menuElement.className = 'image-menu'; // Используйте CSS-класс для стилизации
    menuElement.style.display = 'none'; // Скрыто по умолчанию

    // Создаем контейнер для вкладок
    const tabContainer = document.createElement('div');
    tabContainer.className = 'image-menu-tabs';

    uploadTabButton = document.createElement('button');
    uploadTabButton.textContent = 'Загрузить';
    uploadTabButton.className = 'image-menu-tab active'; // Активна по умолчанию
    uploadTabButton.dataset.tab = 'upload';

    linkTabButton = document.createElement('button');
    linkTabButton.textContent = 'Вставить ссылку';
    linkTabButton.className = 'image-menu-tab';
    linkTabButton.dataset.tab = 'link';

    tabContainer.appendChild(uploadTabButton);
    tabContainer.appendChild(linkTabButton);

    // Создаем контейнер для содержимого вкладок
    const contentContainer = document.createElement('div');
    contentContainer.className = 'image-menu-content';

    // Содержимое вкладки "Загрузить"
    uploadTabContent = document.createElement('div');
    uploadTabContent.className = 'image-menu-tab-content active'; // Видима по умолчанию
    uploadTabContent.dataset.tabContent = 'upload';

    const uploadButton = document.createElement('button');
    uploadButton.textContent = 'Выберите файл';
    uploadButton.className = 'image-menu-button'; // Класс для стилизации
    uploadButton.type = 'button';

    const maxSizeInfo = document.createElement('p');
    maxSizeInfo.className = 'image-menu-info';
    maxSizeInfo.textContent = `Максимальный размер изображения — ${MAX_FILE_SIZE_MB} МБ`;

    // Скрытый input для выбора файла
    fileInputElement = document.createElement('input');
    fileInputElement.type = 'file';
    fileInputElement.accept = 'image/png, image/jpeg, image/gif, image/webp'; // Допустимые типы
    fileInputElement.style.display = 'none';

    uploadTabContent.appendChild(uploadButton);
    uploadTabContent.appendChild(maxSizeInfo);
    uploadTabContent.appendChild(fileInputElement); // Добавляем скрытый input

    // Содержимое вкладки "Вставить ссылку"
    linkTabContent = document.createElement('div');
    linkTabContent.className = 'image-menu-tab-content'; // Скрыта по умолчанию
    linkTabContent.dataset.tabContent = 'link';

    urlInputElement = document.createElement('input');
    urlInputElement.type = 'text';
    urlInputElement.placeholder = 'Вставьте ссылку на изображение...';
    urlInputElement.className = 'image-menu-input'; // Класс для стилизации

    urlLoadButton = document.createElement('button');
    urlLoadButton.textContent = 'Загрузить';
    urlLoadButton.className = 'image-menu-button primary'; // Класс для стилизации (основная кнопка)
    urlLoadButton.type = 'button';

    const linkInfo = document.createElement('p');
    linkInfo.className = 'image-menu-info';
    linkInfo.textContent = 'Работает с любым изображением из интернета';

    linkTabContent.appendChild(urlInputElement);
    linkTabContent.appendChild(urlLoadButton);
    linkTabContent.appendChild(linkInfo);

    // Собираем меню
    contentContainer.appendChild(uploadTabContent);
    contentContainer.appendChild(linkTabContent);
    menuElement.appendChild(tabContainer);
    menuElement.appendChild(contentContainer);

    // Добавляем в DOM
    document.body.appendChild(menuElement);

    // Добавляем обработчики событий для вкладок и кнопок
    uploadTabButton.addEventListener('click', () => switchTab('upload'));
    linkTabButton.addEventListener('click', () => switchTab('link'));
    uploadButton.addEventListener('click', handleUploadButtonClick);
    fileInputElement.addEventListener('change', handleFileInputChange);
    urlLoadButton.addEventListener('click', handleUrlLoadButtonClick);
    // Обработчик для Enter в поле URL
    urlInputElement.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // Не выполняем по Enter, если кнопка неактивна
            if (!urlLoadButton.disabled) {
                 handleUrlLoadButtonClick();
            }
        }
    });

    // Отслеживание ввода в поле URL для включения/выключения кнопки
    urlInputElement.addEventListener('input', () => {
        const isEmpty = urlInputElement.value.trim() === '';
        urlLoadButton.disabled = isEmpty;
    });

    // Установка начального состояния кнопки (неактивна)
    urlLoadButton.disabled = true;

} // Конец createMenuDOM

/**
 * Переключает активную вкладку в меню.
 * @param {'upload' | 'link'} tabName Имя вкладки для активации.
 */
function switchTab(tabName) {
    if (currentActiveTab === tabName) return; // Уже активна

    currentActiveTab = tabName;

    // Обновляем стили кнопок вкладок
    uploadTabButton.classList.toggle('active', tabName === 'upload');
    linkTabButton.classList.toggle('active', tabName === 'link');

    // Показываем/скрываем содержимое вкладок
    uploadTabContent.classList.toggle('active', tabName === 'upload');
    linkTabContent.classList.toggle('active', tabName === 'link');

    // Если переключились на вкладку Link, ставим фокус в поле ввода
    if (tabName === 'link') {
        urlInputElement.focus();
    }
}

/**
 * Позиционирует меню рядом с целевым блоком.
 */
function positionMenu() {
    if (!menuElement || !targetBlockElement) return;

    const blockRect = targetBlockElement.getBoundingClientRect();
    const menuRect = menuElement.getBoundingClientRect();

    let top = blockRect.bottom + window.scrollY + 8; // Ниже блока с отступом
    let left = blockRect.left + window.scrollX;

    // Корректировка по горизонтали (чтобы меню было по центру блока, если возможно)
    left = blockRect.left + window.scrollX + (blockRect.width / 2) - (menuRect.width / 2);

    // Корректировка, чтобы не вылезало за экран
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    if (left + menuRect.width > viewportWidth - 10) {
        left = viewportWidth - menuRect.width - 10;
    }
    if (top + menuRect.height > viewportHeight - 10) {
        // Если не помещается снизу, пробуем показать сверху
        top = blockRect.top + window.scrollY - menuRect.height - 8;
    }
    if (left < 10) left = 10;
    if (top < 10) top = 10; // Если и сверху не лезет, прижимаем к верху

    menuElement.style.top = `${top}px`;
    menuElement.style.left = `${left}px`;
}

/**
 * Обработчик клика вне меню для его закрытия.
 */
function handleClickOutside(event) {
    // Закрываем меню, если оно видимо и клик был НЕ внутри него.
    if (menuElement && menuElement.style.display !== 'none' && !menuElement.contains(event.target)) {
        console.log('Image Menu: Click outside menu detected. Hiding menu.'); // Для отладки
        hideImageMenu();
    }
}


/**
 * Обработчик нажатия кнопки "Выберите файл".
 */
function handleUploadButtonClick() {
    fileInputElement?.click(); // Вызываем клик на скрытом input'е
}

/**
 * Обработчик изменения в input[type=file].
 */
function handleFileInputChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    // Проверка типа файла (дополнительно)
    if (!file.type.startsWith('image/')) {
        alert('Пожалуйста, выберите файл изображения.');
        return;
    }

    // Проверка размера файла
    if (file.size > MAX_FILE_SIZE_BYTES) {
        alert(`Файл слишком большой. Максимальный размер: ${MAX_FILE_SIZE_MB} МБ.`);
        return;
    }

    // Читаем файл как Data URL
    const reader = new FileReader();
    reader.onload = (e) => {
        const dataUrl = e.target?.result;
        if (typeof dataUrl === 'string') {
            replacePlaceholderWithImage(dataUrl);
            hideImageMenu(); // Закрываем меню после успешной загрузки
        } else {
            console.error('Ошибка чтения файла.');
            alert('Не удалось прочитать файл изображения.');
        }
    };
    reader.onerror = () => {
        console.error('Ошибка FileReader:', reader.error);
        alert('Произошла ошибка при чтении файла.');
    };
    reader.readAsDataURL(file);

    // Сбрасываем значение input, чтобы можно было выбрать тот же файл снова
    event.target.value = '';
}

/**
 * Обработчик нажатия кнопки "Загрузить" для URL.
 */
function handleUrlLoadButtonClick() {
    // Проверка на неактивность кнопки
    if (urlLoadButton.disabled) {
         console.log('URL Load Button clicked but disabled.'); // Для отладки
         return; // Ничего не делаем
    }

    const url = urlInputElement?.value.trim();
    if (!url) {
        alert('Пожалуйста, вставьте ссылку на изображение.');
        urlInputElement?.focus();
        return;
    }

    // Простая проверка, похожа ли строка на URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
         alert('Пожалуйста, введите корректный URL, начинающийся с http:// или https://');
         urlInputElement?.focus();
         return;
    }

    // TODO: Можно добавить проверку доступности URL или типа контента,
    // но для простоты пока просто используем URL как есть.

    replacePlaceholderWithImage(url);
    hideImageMenu(); // Закрываем меню после успешной вставки ссылки
}

/**
 * Заменяет содержимое блока-плейсхолдера изображением, сохраняя сам блок.
 * @param {string} src - URL изображения (Data URL или внешний URL).
 */
function replacePlaceholderWithImage(src) {
    if (!targetBlockElement || targetBlockElement.dataset.blockType !== 'image' || !src) {
        console.error('Image Replacement Error: Invalid target block or src.');
        return;
    }

    const blockId = targetBlockElement.dataset.blockId;
    console.log(`Updating content for image block ${blockId} with src: ${src.substring(0, 100)}...`);

    // 1. Очистить текущее содержимое (плейсхолдер)
    targetBlockElement.innerHTML = ''; // Удаляем placeholder-content и т.д.

    // 2. Удалить класс плейсхолдера
    targetBlockElement.classList.remove('image-placeholder-block');

    // 3. Создать и добавить элемент img
    const imgElement = document.createElement('img');
    imgElement.src = src;
    imgElement.alt = "Загруженное изображение"; // Можно сделать изменяемым
    imgElement.style.maxWidth = '100%';
    imgElement.style.display = 'block';
    imgElement.style.margin = 'auto'; // Для центрирования, если блок шире картинки
    targetBlockElement.appendChild(imgElement);

    // 4. Сохранить src в data-атрибуте для сохранения/загрузки документа
    targetBlockElement.setAttribute('data-image-src', src);

    // 5. Пересохранить документ
    saveDocumentContent();

    // 6. Возможно, убрать фокус с каких-либо элементов
    if (document.activeElement) {
        document.activeElement.blur();
    }
}


// --- Экспортируемые функции ---

/**
 * Инициализирует меню изображения при запуске приложения.
 */
export function initializeImageMenu() {
    createMenuDOM();
    console.log("Image Menu Initialized.");
}

/**
 * Показывает меню для добавления изображения рядом с указанным блоком.
 * Открывается только для блока в состоянии плейсхолдера.
 * @param {Element} blockElement - Элемент блока 'image'.
 */
export function showImageMenu(blockElement) {
    if (!blockElement || blockElement.dataset.blockType !== 'image') return;
    // Не показываем меню, если это не плейсхолдер
    if (!blockElement.classList.contains('image-placeholder-block')) {
         console.log('Image Menu: Not showing for non-placeholder image block.');
         return;
    }
    if (!menuElement) createMenuDOM(); // Убедимся, что DOM создан

    targetBlockElement = blockElement; // Запоминаем целевой блок

    // Сбрасываем состояние меню
    switchTab('upload'); // Показываем вкладку загрузки по умолчанию
    if (urlInputElement) urlInputElement.value = ''; // Очищаем поле URL
    if (fileInputElement) fileInputElement.value = ''; // Очищаем выбор файла

    // Сброс состояния кнопки "Загрузить" (URL) на неактивное
    if (urlLoadButton) {
        urlLoadButton.disabled = true;
    }


    menuElement.style.display = 'block';
    positionMenu(); // Позиционируем относительно targetBlockElement

    // Добавляем слушатель клика вне меню (с небольшой задержкой)
    // Используем capture: true, чтобы сработать до других кликов
    // Слушатель НЕ одноразовый ({ once: true } убрано)
    setTimeout(() => {
        // Предварительно удаляем, чтобы избежать дублирования
        document.removeEventListener('click', handleClickOutside, { capture: true });
        document.addEventListener('click', handleClickOutside, { capture: true });
        console.log('Image Menu: Added persistent click outside listener.'); // Для отладки
    }, 0);
}

/**
 * Скрывает меню изображения и удаляет слушатель клика снаружи.
 */
export function hideImageMenu() {
    if (menuElement) {
        menuElement.style.display = 'none';
    }
    // ЯВНО УДАЛЯЕМ СЛУШАТЕЛЬ при скрытии меню
    document.removeEventListener('click', handleClickOutside, { capture: true });
    targetBlockElement = null; // Сбрасываем ссылку на блок
    console.log('Image Menu: Hidden and click outside listener removed.'); // Для отладки
}