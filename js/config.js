// js/config.js
// Константы, извлеченные из глобальной области видимости оригинального скрипта
// --- ДОБАВЛЕНО: Префикс для внутренних ссылок ---

export const MAX_INDENT_LEVEL = 8;
export const MAX_OL_INDENT_LEVEL = 2; // Макс. уровень для авто-форматирования OL
export const MAX_UL_INDENT_LEVEL = 2; // Макс. уровень для авто-форматирования UL
export const SPACES_PER_INDENT = 4;   // Для парсинга вставки
export const NESTED_BLOCK_INDENT_STEP = 28; // Шаг отступа в px для DND и стилей

// --- НОВАЯ КОНСТАНТА ---
// Префикс, используемый для идентификации внутренних ссылок на документы
export const INTERNAL_LINK_PREFIX = 'doc://';
