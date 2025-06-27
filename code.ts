/**
 * Variables Sheet - Плагин Figma для создания таблиц переменных
 * 
 * Этот плагин автоматически генерирует красивые таблицы из коллекций переменных Figma.
 * Поддерживает все типы переменных, множественные режимы/темы, группировку по префиксам
 * и интеллектуальное форматирование значений.
 * 
 * Основные возможности:
 * - Загрузка и фильтрация коллекций переменных
 * - Группировка переменных по префиксам
 * - Поддержка цветовых индикаторов для COLOR переменных
 * - Обработка алиасов и ссылок между переменными
 * - Генерация CSS custom properties
 * - Адаптивное форматирование для разных типов данных
 * 
 * Архитектура:
 * - Строгая типизация TypeScript
 * - Кэширование для оптимизации производительности
 * - Модульная структура с разделением ответственности
 * - Централизованная обработка ошибок
 * - Мемоизация часто используемых операций
 */

figma.showUI(__html__, { width: 400, height: 700 });

// Автоматически загружаем коллекции при запуске плагина
loadCollections();

/**
 * Константы приложения для избежания магических чисел
 * Содержит настройки размеров, анимации и валидации
 */
const APP_CONSTANTS = {
  /** Размеры текста */
  TEXT_SIZE: {
    HEADER: 16,
    BODY: 14,
    SMALL: 12
  },
  /** Настройки анимации */
  ANIMATION: {
    DURATION: 200
  },
  /** Параметры валидации */
  VALIDATION: {
    MIN_WIDTH: 100,
    MAX_VARIABLES: 1000
  }
} as const;

/**
 * Строго типизированный интерфейс для настроек таблицы
 */
interface StrictTableConfig {
  readonly spacing: {
    readonly section: number;
    readonly group: number;
    readonly cell: number;
    readonly item: number;
  };
  readonly sizes: {
    readonly cellHeight: number;
    readonly colorCircle: number;
    readonly columnWidth: {
      readonly designToken: number;
      readonly devToken: number;
      readonly value: number;
    };
  };
  readonly radius: {
    readonly group: number;
    readonly header: number;
  };
}

/**
 * Валидирует входные данные на соответствие ожидаемому типу
 * @param value Значение для проверки
 * @param type Ожидаемый тип данных
 * @returns Результат валидации
 */
function validateInput(value: unknown, type: 'string' | 'number' | 'boolean'): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string' && value.length > 0;
    case 'number':
      return typeof value === 'number' && !isNaN(value) && isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

/**
 * Проверяет валидность объекта цвета RGB(A)
 * Валидирует структуру и диапазоны значений компонентов цвета
 * @param color Объект для проверки на соответствие формату цвета
 * @returns Результат валидации с type guard
 */
function _isValidColor(color: unknown): color is { r: number; g: number; b: number; a?: number } {
  if (typeof color !== 'object' || color === null) return false;
  
  const c = color as Record<string, unknown>;
  
  // Проверяем наличие и валидность обязательных компонентов RGB
  if (!validateInput(c.r, 'number') || !validateInput(c.g, 'number') || !validateInput(c.b, 'number')) {
    return false;
  }
  
  const r = c.r as number;
  const g = c.g as number;
  const b = c.b as number;
  
  // Проверяем диапазон значений RGB (0-1)
  if (r < 0 || r > 1 || g < 0 || g > 1 || b < 0 || b > 1) {
    return false;
  }
  
  // Проверяем альфа-канал (опционально)
  if (c.a !== undefined) {
    if (!validateInput(c.a, 'number')) {
      return false;
    }
    const a = c.a as number;
    if (a < 0 || a > 1) {
      return false;
    }
  }
  
  return true;
}

/**
 * Конфигурация размеров и отступов для таблицы
 */
const TABLE_CONFIG: StrictTableConfig = {
  spacing: {
    section: 24,
    group: 16,
    cell: 1,
    item: 12
  },
  sizes: {
    cellHeight: 48,
    colorCircle: 20,
    columnWidth: {
      designToken: 480,
      devToken: 552,
      value: 560
    }
  },
  radius: {
    group: 16,
    header: 16
  }
} as const;

/**
 * Цветовая схема для таблицы
 */
const TABLE_COLORS = {
  group: {
    stroke: { r: 163/255, g: 171/255, b: 187/255 },
    background: { r: 163/255, g: 171/255, b: 187/255 }
  },
  header: {
    background: { r: 29/255, g: 30/255, b: 32/255 }
  },
  dataRow: {
    background: { r: 20/255, g: 20/255, b: 21/255 }
  },
  text: {
    primary: { r: 154/255, g: 161/255, b: 177/255 }
  },
  colorCircle: {
    stroke: { r: 179/255, g: 182/255, b: 189/255 }
  }
} as const;

/**
 * Конфигурация шрифтов
 */
const FONT_CONFIG = {
  primary: { family: "JetBrains Mono", style: "Medium" },
  secondary: { family: "Inter", style: "Medium" },
  fallback: { family: "Roboto", style: "Regular" },
  header: { family: "Roboto", style: "Medium" }
} as const;

/**
 * Структура данных переменной с информацией о значениях, типах и алиасах
 */
interface VariableData {
  name: string;
  devToken: string;
  variableType: VariableResolvedDataType;
  values: { [modeId: string]: string | number | boolean | { r: number; g: number; b: number; a?: number } };
  variable: Variable;
  colorValues?: { [modeId: string]: { r: number; g: number; b: number; a?: number } | null };
  aliasVariables?: { [modeId: string]: Variable | null };
}

/**
 * Информация о режиме/теме коллекции переменных
 */
interface ModeInfo {
  modeId: string;
  name: string;
}

/**
 * Информация о группе переменных (по префиксу)
 */
interface GroupInfo {
  prefix: string;
  count: number;
  isIndividual?: boolean; // Флаг для индивидуальных переменных
  variableName?: string; // Полное имя переменной для индивидуальных элементов
}

/**
 * Конфигурация стилей для групп
 */
interface GroupStyleConfig {
  cornerRadius: number;
  strokeColor: { r: number; g: number; b: number };
  strokeOpacity: number;
  strokeWeight: number;
  fillColor: { r: number; g: number; b: number };
  fillOpacity: number;
}

/**
 * Кэш для загруженных шрифтов
 */
const fontCache = new Map<string, FontName>();

/**
 * Кэш для создания fills
 */
const fillCache = new Map<string, SolidPaint>();

/**
 * Создает заливку типа SOLID с кэшированием для оптимизации производительности
 * Используется для применения цветов к элементам Figma
 * @param color RGB цвет в формате {r, g, b} где значения от 0 до 1
 * @param opacity Прозрачность от 0 до 1 (по умолчанию 1.0)
 * @returns Объект SolidPaint для применения к элементам
 */
function createSolidFill(color: { r: number; g: number; b: number }, opacity?: number): SolidPaint {
  const key = `${color.r}-${color.g}-${color.b}-${opacity ?? 1}`;
  
  if (fillCache.has(key)) {
    return fillCache.get(key)!;
  }
  
  const fill: SolidPaint = {
    type: 'SOLID',
    color,
    ...(opacity !== undefined && { opacity })
  };
  
  fillCache.set(key, fill);
  return fill;
}

/**
 * Загружает шрифт с системой резервных вариантов и кэшированием
 * Пытается загрузить шрифты в порядке приоритета, возвращает первый доступный
 * @param type Тип шрифта для загрузки
 * @returns Промис с объектом FontName загруженного шрифта
 */
async function loadFontWithFallback(type: 'primary' | 'secondary' | 'header' | 'fallback' = 'primary'): Promise<FontName> {
  const cacheKey = type;
  
  if (fontCache.has(cacheKey)) {
    return fontCache.get(cacheKey)!;
  }
  
  const fontOrder = type === 'header' ? 
    [FONT_CONFIG.header, FONT_CONFIG.fallback] :
    type === 'secondary' ?
    [FONT_CONFIG.secondary, FONT_CONFIG.fallback] :
    [FONT_CONFIG.primary, FONT_CONFIG.secondary, FONT_CONFIG.fallback];

  for (const font of fontOrder) {
    try {
      await figma.loadFontAsync(font);
      fontCache.set(cacheKey, font);
      return font;
    } catch (error) {
      // Продолжаем к следующему шрифту
      continue;
    }
  }
  
  // Возвращаем последний fallback, если ничего не загрузилось
  fontCache.set(cacheKey, FONT_CONFIG.fallback);
  return FONT_CONFIG.fallback;
}

/**
 * Создает конфигурацию стилей для групп переменных
 * Определяет внешний вид контейнеров групп в таблице
 * @returns Объект конфигурации с настройками границ, заливки и скругления
 */
function createGroupStyles(): GroupStyleConfig {
  return {
    cornerRadius: TABLE_CONFIG.radius.group,
    strokeColor: TABLE_COLORS.group.stroke,
    strokeOpacity: 0.12,
    strokeWeight: 1,
    fillColor: TABLE_COLORS.group.background,
    fillOpacity: 0.03
  };
}

/**
 * Применяет визуальные стили к фрейму группы переменных
 * Настраивает границы, заливку и скругление углов
 * @param frame Фрейм для стилизации
 * @param styles Конфигурация стилей для применения
 */
function applyGroupStyles(frame: FrameNode, styles: GroupStyleConfig): void {
  frame.cornerRadius = styles.cornerRadius;
  frame.strokes = [{
    type: 'SOLID',
    color: styles.strokeColor,
    opacity: styles.strokeOpacity
  }];
  frame.strokeWeight = styles.strokeWeight;
  frame.fills = [{
    type: 'SOLID',
    color: styles.fillColor,
    opacity: styles.fillOpacity
  }];
}

/**
 * Мемоизированное создание базового фрейма
 */
const createBaseCellMemoized = (() => {
  const cache = new Map<string, Partial<FrameNode>>();
  
  return function(name: string, width: number, layoutMode: 'HORIZONTAL' | 'VERTICAL' = 'VERTICAL'): FrameNode {
    const cacheKey = `${width}-${layoutMode}`;
    let template = cache.get(cacheKey);
    
    if (!template) {
      template = {
        layoutMode,
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'AUTO',
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 12,
        paddingBottom: 12,
        itemSpacing: layoutMode === 'HORIZONTAL' ? TABLE_CONFIG.spacing.item : 0,
        fills: []
      };
      cache.set(cacheKey, template);
    }
    
    const cell = figma.createFrame();
    Object.assign(cell, template);
    cell.name = name;
    cell.resize(width, TABLE_CONFIG.sizes.cellHeight);
    
    return cell;
  };
})();

/**
 * Создает множество текстовых элементов в пакетном режиме для оптимизации
 * Предзагружает все необходимые шрифты перед созданием элементов
 * @param texts Массив объектов с текстом и типом шрифта
 * @returns Промис с массивом созданных текстовых элементов
 */
async function createTextNodesBatch(texts: Array<{ text: string; fontType?: 'primary' | 'secondary' | 'header' }>): Promise<TextNode[]> {
  // Предзагружаем все необходимые шрифты
  const fontTypes = [...new Set(texts.map(t => t.fontType || 'primary'))];
  await Promise.all(fontTypes.map(type => loadFontWithFallback(type)));
  
  return Promise.all(texts.map(async ({ text, fontType = 'primary' }) => {
    const textNode = figma.createText();
    textNode.fontName = await loadFontWithFallback(fontType);
    textNode.characters = text;
    textNode.fontSize = APP_CONSTANTS.TEXT_SIZE.BODY;
    textNode.fills = [createSolidFill(TABLE_COLORS.text.primary)];
    return textNode;
  }));
}

/**
 * Центральный обработчик сообщений от пользовательского интерфейса
 * Маршрутизирует команды UI на соответствующие функции плагина
 * Обеспечивает обработку ошибок и логирование операций
 */
figma.ui.onmessage = async (msg: { type: string; collectionId?: string; collectionName?: string; modes?: ModeInfo[]; groups?: GroupInfo[] }) => {
  console.log('Message received:', msg.type, msg); // Debug log
  try {
    switch (msg.type) {
      case 'load-collections':
        await loadCollections();
        break;
      
      case 'load-groups':
        if (msg.collectionId) {
          await loadGroups(msg.collectionId);
        }
        break;
      
      case 'create-table':
        console.log('Creating table with params:', {
          collectionId: msg.collectionId,
          collectionName: msg.collectionName,
          modes: msg.modes,
          groups: msg.groups
        });
        if (msg.collectionId && msg.collectionName && msg.modes && msg.groups) {
          await createVariablesTable(msg.collectionId, msg.collectionName, msg.modes, msg.groups);
        } else {
          console.error('Missing required parameters for table creation');
          figma.ui.postMessage({
            type: 'error',
            message: 'Missing required parameters for table creation'
          });
        }
        break;
      

    }
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
};

/**
 * Загружает все локальные коллекции переменных и отправляет данные в UI
 * Подсчитывает количество переменных в каждой коллекции для отображения статистики
 * Обрабатывает ошибки и отправляет уведомления об ошибках в интерфейс
 */
async function loadCollections(): Promise<void> {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const allVariables = await figma.variables.getLocalVariablesAsync();
    
    console.log('Found collections:', collections.length); // Debug log
    
    const collectionsData = collections.map(collection => {
      const variableCount = allVariables.filter(variable => 
        variable.variableCollectionId === collection.id
      ).length;
      
      return {
        id: collection.id,
        name: collection.name,
        modes: collection.modes,
        variableCount: variableCount
      };
    });

    console.log('Sending collections data:', collectionsData); // Debug log

    figma.ui.postMessage({
      type: 'collections-loaded',
      collections: collectionsData
    });
  } catch (error) {
    console.error('Error loading collections:', error); // Debug log
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to load collections: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}

/**
 * Анализирует и группирует переменные выбранной коллекции по префиксам
 * Извлекает префиксы из имен переменных (часть до первого слеша) и подсчитывает количество
 * Сортирует группы по алфавиту для удобства навигации
 * @param collectionId Идентификатор коллекции для анализа
 */
async function loadGroups(collectionId: string): Promise<void> {
  try {
    const allVariables = await figma.variables.getLocalVariablesAsync();
    const collectionVariables = allVariables.filter(variable => 
      variable.variableCollectionId === collectionId
    );
    
    const totalVariables = collectionVariables.length;
    
    // Группируем переменные по префиксам и собираем индивидуальные переменные
    const groupsMap = new Map<string, number>();
    const individualVariables: string[] = [];
    
    collectionVariables.forEach(variable => {
      const nameParts = variable.name.split('/');
      // Если переменная имеет группу (содержит слеш)
      if (nameParts.length > 1 && nameParts[0].trim()) {
        const prefix = nameParts[0];
        groupsMap.set(prefix, (groupsMap.get(prefix) || 0) + 1);
      } else {
        // Переменная без группы - добавляем как индивидуальную
        individualVariables.push(variable.name);
      }
    });
    
    // Создаем список групп
    let groups: GroupInfo[] = Array.from(groupsMap.entries())
      .map(([prefix, count]) => ({ prefix, count }))
      .sort((a, b) => a.prefix.localeCompare(b.prefix, 'en', { sensitivity: 'base' }));
    
    // Добавляем индивидуальные переменные в список
    const individualGroups: GroupInfo[] = individualVariables
      .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
      .map(variableName => ({
        prefix: variableName,
        count: 1,
        isIndividual: true,
        variableName: variableName
      }));
    
    // Объединяем группы и индивидуальные переменные
    groups = [...groups, ...individualGroups];
    
    figma.ui.postMessage({
      type: 'groups-loaded',
      groups: groups,
      totalVariables: totalVariables
    });
  } catch (error) {
    figma.ui.postMessage({
      type: 'error',
      message: 'Failed to load groups: ' + (error instanceof Error ? error.message : 'Unknown error')
    });
  }
}

/**
 * Фильтрует переменные коллекции по выбранным пользователем группам
 * Возвращает только переменные, принадлежащие к указанным префиксам
 * @param collectionId Идентификатор коллекции переменных
 * @param groups Массив выбранных групп для фильтрации
 * @returns Промис с отфильтрованным массивом переменных
 */
async function getFilteredVariables(collectionId: string, groups: GroupInfo[]): Promise<Variable[]> {
  const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
  if (!collection) {
    throw new Error('Collection not found');
  }

  // Получаем все переменные из коллекции
  const allVariables = await figma.variables.getLocalVariablesAsync();
  const collectionVariables = allVariables.filter(variable => 
    variable.variableCollectionId === collectionId
  );

  // Фильтруем переменные по выбранным группам
  const filteredVariables = collectionVariables.filter(variable => {
    const nameParts = variable.name.split('/');
    
    // Проверяем каждую выбранную группу
    return groups.some(group => {
      if (group.isIndividual) {
        // Для индивидуальных переменных сравниваем полное имя
        return variable.name === group.variableName;
      } else {
        // Для групп сравниваем префикс
        if (nameParts.length > 1 && nameParts[0].trim()) {
          return nameParts[0] === group.prefix;
        }
        return false;
      }
    });
  });

  if (filteredVariables.length === 0) {
    throw new Error('No variables found in selected groups');
  }

  return filteredVariables;
}

/**
 * Обрабатывает переменную Figma и резолвит её значения для всех режимов/тем
 * Извлекает значения, обрабатывает алиасы и подготавливает данные для отображения
 * Для цветовых переменных дополнительно резолвит фактические цвета и алиасы
 * @param variable Переменная Figma для обработки
 * @param modes Массив режимов/тем коллекции
 * @returns Промис с полностью обработанными данными переменной
 */
async function processVariableData(variable: Variable, modes: ModeInfo[]): Promise<VariableData> {
  const values: { [modeId: string]: string | number | boolean | { r: number; g: number; b: number; a?: number } } = {};
  const colorValues: { [modeId: string]: { r: number; g: number; b: number; a?: number } | null } = {};
  const aliasVariables: { [modeId: string]: Variable | null } = {};
  
  // Получаем значения для каждой темы
  for (const mode of modes) {
    const rawValue = variable.valuesByMode[mode.modeId];
    
    // Резолвим значение для отображения
    values[mode.modeId] = await resolveVariableValue(variable, mode.modeId, rawValue);
    
    // Для цветовых переменных также получаем фактический цвет
    if (variable.resolvedType === 'COLOR') {
      const resolvedColor = await resolveColorValue(variable, mode.modeId, rawValue);
      colorValues[mode.modeId] = resolvedColor;
      
      // Проверяем, является ли это алиасом и сохраняем ссылку на переменную-алиас
      if (typeof rawValue === 'object' && rawValue !== null && 'type' in rawValue && rawValue.type === 'VARIABLE_ALIAS' && 'id' in rawValue) {
        try {
          const referencedVariable = await figma.variables.getVariableByIdAsync(rawValue.id as string);
          aliasVariables[mode.modeId] = referencedVariable || null;
        } catch (error) {
          aliasVariables[mode.modeId] = null;
        }
      } else {
        // Не алиас - используем саму переменную
        aliasVariables[mode.modeId] = variable;
      }
    }
  }

  return {
    name: variable.name,
    devToken: generateDevToken(variable.name),
    variableType: variable.resolvedType,
    values,
    variable,
    colorValues: variable.resolvedType === 'COLOR' ? colorValues : undefined,
    aliasVariables: variable.resolvedType === 'COLOR' ? aliasVariables : undefined
  };
}

/**
 * Сортирует переменные иерархически: сначала по префиксам, затем по алфавиту внутри групп
 * Обеспечивает логичную группировку и упорядочивание переменных в таблице
 * @param variablesData Массив данных переменных для сортировки
 * @returns Отсортированный массив переменных
 */
function sortVariablesByPrefixAndName(variablesData: VariableData[]): VariableData[] {
  return variablesData.sort((a, b) => {
    const getPrefixAndPath = (name: string) => {
      const parts = name.split('/');
      const prefix = parts[0] || '';
      return { prefix, fullPath: name };
    };
    
    const aData = getPrefixAndPath(a.name);
    const bData = getPrefixAndPath(b.name);
    
    // Сначала сортируем по префиксам
    const prefixComparison = aData.prefix.localeCompare(bData.prefix, 'en', { sensitivity: 'base' });
    if (prefixComparison !== 0) {
      return prefixComparison;
    }
    
    // Если префиксы одинаковые, сортируем по полному пути
    return aData.fullPath.localeCompare(bData.fullPath, 'en', { sensitivity: 'base' });
  });
}

/**
 * Главная функция создания таблицы переменных из выбранной коллекции
 * Координирует весь процесс: фильтрацию, обработку данных, сортировку и создание UI
 * Обрабатывает ошибки и показывает уведомления пользователю
 * @param collectionId Идентификатор коллекции переменных
 * @param collectionName Название коллекции для отображения
 * @param modes Массив режимов/тем коллекции
 * @param groups Выбранные пользователем группы переменных
 */
async function createVariablesTable(collectionId: string, collectionName: string, modes: ModeInfo[], groups: GroupInfo[]): Promise<void> {
  try {
    // 1. Получаем и фильтруем переменные
    const filteredVariables = await getFilteredVariables(collectionId, groups);

    // 2. Подготавливаем данные переменных
    const variablesData: VariableData[] = await Promise.all(
      filteredVariables.map(variable => processVariableData(variable, modes))
    );

    // 3. Сортируем переменные
    const sortedVariablesData = sortVariablesByPrefixAndName(variablesData);
    
    // 4. Создаем таблицу
    await createTableFrame(sortedVariablesData, modes);
    
    // Показываем успешное уведомление и закрываем плагин
    figma.notify('✅ Variables table created successfully!', { timeout: 3000 });
    figma.closePlugin();
    
  } catch (error) {
    // Показываем ошибку
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    figma.notify(`❌ Error: ${errorMessage}`, { error: true, timeout: 5000 });
    
    // Отправляем сообщение в UI для показа ошибки
    figma.ui.postMessage({
      type: 'error',
      message: errorMessage
    });
  }
}

/**
 * Форматирует название переменной для отображения в таблице
 * Заменяет слэши на дефисы для улучшения читаемости
 * @param variableName Исходное название переменной из Figma
 * @returns Отформатированное название для отображения
 */
function formatVariableName(variableName: string): string {
  return variableName.replace(/\//g, '-');
}

/**
 * Генерирует CSS custom property из названия переменной Figma
 * Преобразует название в валидный формат CSS переменной с префиксом var()
 * Очищает от недопустимых символов и приводит к lowercase
 * @param variableName Исходное название переменной из Figma
 * @returns CSS custom property в формате var(--variable-name)
 */
function generateDevToken(variableName: string): string {
  const cleanName = variableName
    .replace(/\//g, '-')        // Заменяем слеши на дефисы
    .replace(/\s+/g, '-')       // Заменяем пробелы на дефисы
    .replace(/[^a-zA-Z0-9\-_]/g, ''); // Удаляем все остальные специальные символы, сохраняя заглавные буквы
  
  return `var(--${cleanName})`;
}

/**
 * Преобразует RGB(A) цвет в читаемый HEX формат для отображения
 * Конвертирует значения 0-1 в 0-255, добавляет процент прозрачности при необходимости
 * @param color Объект цвета с компонентами r, g, b и опциональным a
 * @returns Строка в формате HEX с процентами прозрачности при необходимости
 */
function formatColor(color: { r: number; g: number; b: number; a?: number }): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  
  // Формируем hex код
  const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
  
  // Если есть альфа-канал и он не равен 1 (100%)
  if (color.a !== undefined && color.a !== 1) {
    const percentage = Math.round(color.a * 100);
    return `${hexColor} ${percentage}%`;
  }
  
  return hexColor;
}

/**
 * Форматирует числовые значения для оптимального отображения в таблице
 * Убирает лишние нули, округляет до разумной точности
 * @param num Число для форматирования
 * @returns Строковое представление числа без лишних десятичных знаков
 */
function formatNumber(num: number): string {
  // Если это целое число, показываем без десятичных знаков
  if (Number.isInteger(num)) {
    return num.toString();
  }
  
  // Округляем до 3 знаков после запятой для точности
  const rounded = Math.round(num * 1000) / 1000;
  
  // Преобразуем в строку и убираем лишние нули в конце
  let result = rounded.toString();
  
  // Если число имеет десятичную часть, убираем trailing zeros
  if (result.includes('.')) {
    result = result.replace(/\.?0+$/, '');
  }
  
  return result;
}

/**
 * Резолвит значение переменной для отображения в таблице
 * Обрабатывает алиасы переменных, цветовые объекты и примитивные типы
 * Рекурсивно разрешает ссылки на другие переменные
 * @param variable Переменная Figma для обработки
 * @param modeId Идентификатор режима/темы
 * @param value Сырое значение переменной из Figma API
 * @returns Промис с разрешенным значением для отображения
 */
async function resolveVariableValue(variable: Variable, modeId: string, value: unknown): Promise<string | number | boolean | { r: number; g: number; b: number; a?: number }> {
  if (value === undefined || value === null) {
    return '';
  }

  // Проверяем на VARIABLE_ALIAS
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS' && 'id' in value) {
    try {
      const referencedVariable = await figma.variables.getVariableByIdAsync(value.id as string);
      if (referencedVariable) {
        // Для alias переменных возвращаем имя референсной переменной с форматированием
        return formatVariableName(referencedVariable.name);
      } else {
        return 'Unknown variable';
      }
    } catch (error) {
      return 'Error resolving alias';
    }
  }

  // Для прямых значений
  if (typeof value === 'object' && value !== null && 'r' in value) {
    // Это цветовое значение - возвращаем как есть для дальнейшей обработки
    return value as { r: number; g: number; b: number; a?: number };
  }

  // Для остальных типов возвращаем как есть
  return value as string | number | boolean;
}

/**
 * Рекурсивно резолвит цветовое значение переменной, включая алиасы
 * Специализированная функция для работы с цветовыми переменными и их ссылками
 * Обеспечивает fallback на доступные режимы при отсутствии значения в текущем
 * @param variable Переменная Figma для обработки
 * @param modeId Идентификатор режима/темы
 * @param value Сырое значение переменной из Figma API
 * @returns Промис с разрешенным цветовым значением или null при ошибке
 */
async function resolveColorValue(variable: Variable, modeId: string, value: unknown): Promise<{ r: number; g: number; b: number; a?: number } | null> {
  // Проверяем на undefined и null
  if (value === undefined || value === null) {
    return null;
  }

  // Если это alias (ссылка на другую переменную)
  if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS' && 'id' in value) {
    try {
      const referencedVariable = await figma.variables.getVariableByIdAsync(value.id as string);
      
      if (referencedVariable && referencedVariable.resolvedType === 'COLOR') {
        // Сначала пробуем тот же режим
        let refValue = referencedVariable.valuesByMode[modeId];
        
        // Если в том же режиме нет значения, пробуем первый доступный режим
        if (refValue === undefined) {
          const availableModes = Object.keys(referencedVariable.valuesByMode);
          if (availableModes.length > 0) {
            const firstMode = availableModes[0];
            refValue = referencedVariable.valuesByMode[firstMode];
          }
        }
        
        if (refValue !== undefined) {
          const recursiveResult = await resolveColorValue(referencedVariable, modeId, refValue);
          return recursiveResult;
        } else {
          return null;
        }
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  // Если это строка, которая может быть именем переменной (для случаев, когда resolveVariableValue уже разрешил alias)
  if (typeof value === 'string' && value.includes('/')) {
    try {
      // Получаем все переменные и ищем по имени
      const allVariables = await figma.variables.getLocalVariablesAsync();
      const foundVariable = allVariables.find(v => v.name === value && v.resolvedType === 'COLOR');
      
      if (foundVariable) {
        const foundValue = foundVariable.valuesByMode[modeId];
        if (foundValue !== undefined) {
          return await resolveColorValue(foundVariable, modeId, foundValue);
        } else {
          // Пробуем первый доступный режим
          const availableModes = Object.keys(foundVariable.valuesByMode);
          if (availableModes.length > 0) {
            const firstMode = availableModes[0];
            const fallbackValue = foundVariable.valuesByMode[firstMode];
            return await resolveColorValue(foundVariable, firstMode, fallbackValue);
          }
        }
      }
    } catch (error) {
      return null;
    }
  }

  // Для прямых цветовых значений
  if (typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value) {
    const colorResult = value as { r: number; g: number; b: number; a?: number };
    return colorResult;
  }
  
  return null;
}

/**
 * Группирует переменные по префиксам (первая часть имени до слэша)
 * @param variablesData - Массив данных переменных
 * @returns Map с группированными переменными по префиксам
 */
function groupVariablesByPrefix(variablesData: VariableData[]): Map<string, VariableData[]> {
  const groupedVariables = new Map<string, VariableData[]>();
  
  variablesData.forEach(variable => {
    const prefix = variable.name.split('/')[0] || 'other';
    if (!groupedVariables.has(prefix)) {
      groupedVariables.set(prefix, []);
    }
    groupedVariables.get(prefix)!.push(variable);
  });
  
  return groupedVariables;
}

/**
 * Создает основную таблицу с колонками Design Token и Dev Token
 * @param groupedVariables - Группированные переменные по префиксам
 * @returns FrameNode основной таблицы
 */
async function createMainVariablesTable(groupedVariables: Map<string, VariableData[]>): Promise<FrameNode> {
  const mainTableFrame = figma.createFrame();
  mainTableFrame.name = 'Main Table';
  mainTableFrame.layoutMode = 'VERTICAL';
  mainTableFrame.primaryAxisSizingMode = 'AUTO';
  mainTableFrame.counterAxisSizingMode = 'AUTO';
  mainTableFrame.itemSpacing = TABLE_CONFIG.spacing.group;
  mainTableFrame.fills = [];
  mainTableFrame.strokes = [];
  
  // Создаем группы с заголовками
  for (const [prefix, variables] of groupedVariables) {
    const groupFrame = await createVariableGroup(prefix, variables, 'main');
    mainTableFrame.appendChild(groupFrame);
  }
  
  return mainTableFrame;
}

/**
 * Создает таблицы для каждой темы с колонкой значений
 * @param groupedVariables - Группированные переменные по префиксам
 * @param modes - Массив режимов/тем
 * @returns Массив FrameNode для каждой темы
 */
async function createThemeVariablesTables(groupedVariables: Map<string, VariableData[]>, modes: ModeInfo[]): Promise<FrameNode[]> {
  const themeFrames: FrameNode[] = [];
  
  for (const mode of modes) {
    const themeFrame = figma.createFrame();
    themeFrame.name = `Theme: ${mode.name}`;
    themeFrame.layoutMode = 'VERTICAL';
    themeFrame.primaryAxisSizingMode = 'AUTO';
    themeFrame.counterAxisSizingMode = 'AUTO';
    themeFrame.itemSpacing = TABLE_CONFIG.spacing.group;
    themeFrame.fills = [];
    themeFrame.strokes = [];
    
    // Создаем группы для каждого префикса в рамках темы
    for (const [prefix, variables] of groupedVariables) {
      const themeGroupFrame = await createVariableGroup(prefix, variables, 'theme', mode);
      themeFrame.appendChild(themeGroupFrame);
    }
    
    themeFrames.push(themeFrame);
  }
  
  return themeFrames;
}

/**
 * Создает группу переменных (для основной таблицы или темы)
 * @param prefix - Префикс группы
 * @param variables - Переменные группы
 * @param type - Тип таблицы: 'main' или 'theme'
 * @param mode - Информация о режиме (только для типа 'theme')
 * @returns FrameNode группы переменных
 */
async function createVariableGroup(prefix: string, variables: VariableData[], type: 'main' | 'theme', mode?: ModeInfo): Promise<FrameNode> {
  // Создаем фрейм для группы
  const groupFrame = figma.createFrame();
  groupFrame.name = type === 'main' ? `Group: ${prefix}` : `${mode!.name} - ${prefix}`;
  groupFrame.layoutMode = 'VERTICAL';
  groupFrame.primaryAxisSizingMode = 'AUTO';
  groupFrame.counterAxisSizingMode = 'AUTO';
  groupFrame.itemSpacing = TABLE_CONFIG.spacing.cell;
  groupFrame.paddingTop = 0;
  groupFrame.paddingBottom = 0;
  groupFrame.paddingLeft = 0;
  groupFrame.paddingRight = 0;
  
  // Стили для группы
  applyGroupStyles(groupFrame, createGroupStyles());
  
  // Создаем заголовок
  const headerRow = type === 'main' 
    ? await createMainHeaderRow() 
    : await createThemeHeaderRow(mode!.name);
  groupFrame.appendChild(headerRow);
  
  // Создаем строки данных
  for (let i = 0; i < variables.length; i++) {
    try {
      const dataRow = type === 'main' 
        ? await createMainDataRow(variables[i], i === variables.length - 1)
        : await createThemeDataRow(variables[i], mode!, i === variables.length - 1);
      groupFrame.appendChild(dataRow);
    } catch (error) {
      // Пропускаем проблемные строки, но продолжаем создание таблицы
      continue;
    }
  }
  
  return groupFrame;
}

/**
 * Создает строку данных для темы (только колонка значений)
 * @param variable - Данные переменной
 * @param mode - Информация о режиме
 * @param isLast - Является ли строка последней в группе
 * @returns FrameNode строки данных
 */
async function createThemeDataRow(variable: VariableData, mode: ModeInfo, isLast: boolean): Promise<FrameNode> {
  const value = variable.values[mode.modeId];
  const colorValue = variable.colorValues?.[mode.modeId];
  const aliasVariable = variable.aliasVariables?.[mode.modeId];
  
  const valueCell = await createValueCell(value, variable.variableType, TABLE_CONFIG.sizes.columnWidth.value, colorValue, aliasVariable);
  valueCell.name = `${variable.name} - ${mode.name}`;
  
  // Оборачиваем ячейку в контейнер для правильного отступа
  const valueContainer = figma.createFrame();
  valueContainer.name = `Value: ${variable.name}`;
  valueContainer.layoutMode = 'HORIZONTAL';
  valueContainer.primaryAxisSizingMode = 'AUTO';
  valueContainer.counterAxisSizingMode = 'AUTO';
  valueContainer.itemSpacing = 0;
  valueContainer.fills = [createSolidFill(TABLE_COLORS.dataRow.background)];
  
  // Закругляем углы для последней строки
  if (isLast) {
    valueContainer.bottomLeftRadius = TABLE_CONFIG.radius.header;
    valueContainer.bottomRightRadius = TABLE_CONFIG.radius.header;
  }
  
  valueContainer.appendChild(valueCell);
  return valueContainer;
}

/**
 * Размещает таблицу в текущей видимой области пользователя
 * @param tableFrame - Фрейм таблицы для размещения
 */
function positionTableInViewport(tableFrame: FrameNode): void {
  // Размещаем таблицу в текущей видимой области (где пользователь приближен)
  figma.currentPage.appendChild(tableFrame);
  
  // Размещаем таблицу в области просмотра пользователя
  const bounds = tableFrame.absoluteBoundingBox;
  if (bounds) {
    // Размещаем таблицу в левом верхнем углу текущей видимой области с небольшим отступом
    tableFrame.x = figma.viewport.center.x - figma.viewport.bounds.width / 2 + 50;
    tableFrame.y = figma.viewport.center.y - figma.viewport.bounds.height / 2 + 50;
  }
  
  // Выбираем таблицу
  figma.currentPage.selection = [tableFrame];
  figma.viewport.scrollAndZoomIntoView([tableFrame]);
}

/**
 * Создает таблицу с переменными, разделенными по группам с повторяющимися заголовками
 * Координирующая функция, которая управляет процессом создания всей таблицы
 * @param variablesData - Массив данных переменных
 * @param modes - Массив режимов/тем
 */
async function createTableFrame(variablesData: VariableData[], modes: ModeInfo[]): Promise<void> {
  // Создаем основной фрейм для таблицы
  const tableFrame = figma.createFrame();
  tableFrame.name = 'Variables Table';
  tableFrame.layoutMode = 'HORIZONTAL';
  tableFrame.primaryAxisSizingMode = 'AUTO';
  tableFrame.counterAxisSizingMode = 'AUTO';
  tableFrame.itemSpacing = TABLE_CONFIG.spacing.section;
  tableFrame.cornerRadius = 0;
  tableFrame.fills = [];
  
  // 1. Группируем переменные по префиксам
  const groupedVariables = groupVariablesByPrefix(variablesData);
  
  // 2. Создаем основную таблицу с переменными
  const mainTableFrame = await createMainVariablesTable(groupedVariables);
  tableFrame.appendChild(mainTableFrame);
  
  // 3. Создаем группы для каждой темы
  const themeFrames = await createThemeVariablesTables(groupedVariables, modes);
  themeFrames.forEach(themeFrame => {
    tableFrame.appendChild(themeFrame);
  });
  
  // 4. Размещаем таблицу в viewport
  positionTableInViewport(tableFrame);
}

/**
 * Создает строку заголовка основной таблицы (только Design Token и Dev Token)
 * @returns FrameNode с ячейками заголовков
 */
async function createMainHeaderRow(): Promise<FrameNode> {
  const headerRow = figma.createFrame();
  headerRow.name = 'Main Header Row';
  headerRow.layoutMode = 'HORIZONTAL';
  headerRow.primaryAxisSizingMode = 'AUTO';
  headerRow.counterAxisSizingMode = 'AUTO';
  headerRow.itemSpacing = 0;
  
  // Стили заголовка
  headerRow.fills = [createSolidFill(TABLE_COLORS.header.background)];
  
  // Закругляем только верхние углы заголовка
  headerRow.topLeftRadius = TABLE_CONFIG.radius.header;
  headerRow.topRightRadius = TABLE_CONFIG.radius.header;
  headerRow.bottomLeftRadius = 0;
  headerRow.bottomRightRadius = 0;
  
  // Design Token колонка
  const designTokenHeader = await createHeaderCell('Design Token', TABLE_CONFIG.sizes.columnWidth.designToken);
  headerRow.appendChild(designTokenHeader);
  
  // Dev Token колонка
  const devTokenHeader = await createHeaderCell('Dev Token', TABLE_CONFIG.sizes.columnWidth.devToken);
  headerRow.appendChild(devTokenHeader);
  
  return headerRow;
}

/**
 * Создает строку заголовка для темы
 * @param themeName - Название темы
 * @returns FrameNode с заголовком темы
 */
async function createThemeHeaderRow(themeName: string): Promise<FrameNode> {
  const headerRow = figma.createFrame();
  headerRow.name = `Theme Header: ${themeName}`;
  headerRow.layoutMode = 'HORIZONTAL';
  headerRow.primaryAxisSizingMode = 'AUTO';
  headerRow.counterAxisSizingMode = 'AUTO';
  headerRow.itemSpacing = 0;
  
  // Стили заголовка
  headerRow.fills = [createSolidFill(TABLE_COLORS.header.background)];
  
  // Закругляем только верхние углы заголовка
  headerRow.topLeftRadius = TABLE_CONFIG.radius.header;
  headerRow.topRightRadius = TABLE_CONFIG.radius.header;
  headerRow.bottomLeftRadius = 0;
  headerRow.bottomRightRadius = 0;
  
  // Создаем заголовок темы
  const themeHeader = await createHeaderCell(themeName, TABLE_CONFIG.sizes.columnWidth.value);
  headerRow.appendChild(themeHeader);
  
  return headerRow;
}

/**
 * Создает строку данных основной таблицы (без столбцов тем)
 * @param variableData - Данные переменной
 * @param isLast - Является ли строка последней в группе
 * @returns FrameNode со строкой данных
 */
async function createMainDataRow(variableData: VariableData, isLast: boolean): Promise<FrameNode> {
  const dataRow = figma.createFrame();
  dataRow.name = `Main Data Row: ${variableData.name}`;
  dataRow.layoutMode = 'HORIZONTAL';
  dataRow.primaryAxisSizingMode = 'AUTO';
  dataRow.counterAxisSizingMode = 'AUTO';
  dataRow.itemSpacing = 0;
  
  // Стили строки данных
  dataRow.fills = [createSolidFill(TABLE_COLORS.dataRow.background)];
  
  // Закругляем только нижние углы для последней строки
  if (isLast) {
    dataRow.topLeftRadius = 0;
    dataRow.topRightRadius = 0;
    dataRow.bottomLeftRadius = TABLE_CONFIG.radius.header;
    dataRow.bottomRightRadius = TABLE_CONFIG.radius.header;
  } else {
    // Средние строки без закруглений
    dataRow.cornerRadius = 0;
  }
  
  // Design Token ячейка
  const designTokenCell = await createDataCell(formatVariableName(variableData.name), TABLE_CONFIG.sizes.columnWidth.designToken, 'design-token');
  dataRow.appendChild(designTokenCell);
  
  // Dev Token ячейка
  const devTokenCell = await createDataCell(variableData.devToken, TABLE_CONFIG.sizes.columnWidth.devToken, 'dev-token');
  dataRow.appendChild(devTokenCell);
  
  return dataRow;
}

/**
 * Создает ячейку данных для основной таблицы
 * @param text - Текст для отображения в ячейке
 * @param width - Ширина ячейки
 * @param type - Тип ячейки (design-token или dev-token)
 * @returns FrameNode с ячейкой данных
 */
async function createDataCell(text: string, width: number, type: 'design-token' | 'dev-token'): Promise<FrameNode> {
  const cell = createBaseCellMemoized(`Data Cell: ${type}`, width, 'VERTICAL');
  
  // Настраиваем выравнивание контента
  cell.primaryAxisAlignItems = 'MIN';
  cell.counterAxisAlignItems = 'MIN';
  
  // Создаем текст
  const textNodes = await createTextNodesBatch([{ text, fontType: type === 'dev-token' ? 'primary' : 'secondary' }]);
  const textNode = textNodes[0];
  textNode.fontSize = APP_CONSTANTS.TEXT_SIZE.HEADER;
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  cell.appendChild(textNode);
  return cell;
}

/**
 * Определяет какой цвет использовать для визуального индикатора в ячейке
 * Приоритизирует разрешенные цветовые значения над прямыми значениями
 * Возвращает null для не-цветовых переменных
 * @param value Значение переменной (может содержать прямой цвет)
 * @param type Тип переменной Figma
 * @param colorValue Разрешенное цветовое значение (приоритет)
 * @returns Объект RGB(A) цвета или null если цвет не определен
 */
function determineColorForIndicator(
  value: string | number | boolean | { r: number; g: number; b: number; a?: number }, 
  type: VariableResolvedDataType, 
  colorValue?: { r: number; g: number; b: number; a?: number } | null
): { r: number; g: number; b: number; a?: number } | null {
  if (type !== 'COLOR') {
    return null;
  }

  // Приоритет: сначала проверяем colorValue (разрешенный цвет)
  if (colorValue && typeof colorValue === 'object' && 'r' in colorValue) {
    return colorValue;
  }
  
  // Если colorValue нет, но value содержит цвет напрямую
  if (typeof value === 'object' && value && 'r' in value) {
    return value as { r: number; g: number; b: number; a?: number };
  }
  
  return null;
}

/**
 * Создает круглый цветовой индикатор для отображения цветовых переменных
 * Применяет привязку к переменной-алиасу если доступна, иначе использует статичный цвет
 * Добавляет тонкую границу для лучшей видимости на любом фоне
 * @param color RGB(A) цвет для заливки индикатора
 * @param type Тип переменной Figma
 * @param aliasVariable Переменная-алиас для привязки (если есть)
 * @returns Элемент EllipseNode с настроенным цветовым индикатором
 */
function createColorIndicator(
  color: { r: number; g: number; b: number; a?: number }, 
  type: VariableResolvedDataType, 
  aliasVariable?: Variable | null
): EllipseNode {
  const colorCircle = figma.createEllipse();
  colorCircle.resize(TABLE_CONFIG.sizes.colorCircle, TABLE_CONFIG.sizes.colorCircle);
  
  // Проверяем, есть ли у нас алиас переменная для применения
  if (aliasVariable && type === 'COLOR') {
    try {
      // Создаем начальный SOLID fill
      const solidFill = createSolidFill(
        { r: color.r, g: color.g, b: color.b },
        color.a !== undefined ? color.a : 1
      );
      
      // Применяем алиас переменной к fill
      const aliasedFill = figma.variables.setBoundVariableForPaint(solidFill, 'color', aliasVariable);
      colorCircle.fills = [aliasedFill];
    } catch (error) {
      // Fallback на обычный цвет
      colorCircle.fills = [createSolidFill(
        { r: color.r, g: color.g, b: color.b },
        color.a !== undefined ? color.a : 1
      )];
    }
  } else {
    // Используем обычный цвет если нет алиаса
    colorCircle.fills = [createSolidFill(
      { r: color.r, g: color.g, b: color.b },
      color.a !== undefined ? color.a : 1
    )];
  }
  
  colorCircle.strokes = [createSolidFill(TABLE_COLORS.colorCircle.stroke, 0.12)];
  colorCircle.strokeWeight = 1;
  
  return colorCircle;
}

/**
 * Форматирует различные типы значений переменных для читаемого отображения
 * Обрабатывает строки, числа, булевы значения и цветовые объекты
 * Применяет специальное форматирование для имен переменных и цветов
 * @param value Значение переменной любого поддерживаемого типа
 * @returns Отформатированная строка для отображения в таблице
 */
function formatValueForDisplay(value: string | number | boolean | { r: number; g: number; b: number; a?: number }): string {
  if (typeof value === 'string') {
    // Для строковых значений проверяем, является ли это названием переменной
    if (value.includes('/')) {
      // Это название переменной - форматируем его
      return formatVariableName(value);
    } else {
      // Обычная строка - показываем как есть
      return value;
    }
  } else if (typeof value === 'number') {
    return formatNumber(value);
  } else if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  } else if (typeof value === 'object' && value && 'r' in value) {
    // Это прямое значение цвета - показываем цвет с учетом opacity
    return formatColor(value as { r: number; g: number; b: number; a?: number });
  } else {
    return String(value);
  }
}

/**
 * Создает текстовый элемент с единообразным стилем для значений переменных
 * Применяет основной шрифт, размер и цвет согласно дизайн-системе
 * @param displayValue Отформатированное значение для отображения
 * @returns Промис с настроенным текстовым элементом
 */
async function createValueText(displayValue: string): Promise<TextNode> {
  const textNode = figma.createText();
  textNode.fontName = await loadFontWithFallback('primary');
  textNode.characters = displayValue;
  textNode.fontSize = APP_CONSTANTS.TEXT_SIZE.BODY;
  textNode.fills = [createSolidFill(TABLE_COLORS.text.primary)];
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  return textNode;
}

/**
 * Создает комплексную ячейку для отображения значения переменной
 * Включает цветовой индикатор для цветовых переменных и форматированный текст
 * Использует горизонтальный layout для размещения индикатора и текста
 * @param value Значение переменной для отображения
 * @param type Тип переменной Figma (определяет наличие цветового индикатора)
 * @param width Ширина ячейки в пикселях
 * @param colorValue Разрешенное цветовое значение (для цветовых переменных)
 * @param aliasVariable Переменная-алиас для привязки цвета (опционально)
 * @returns Промис с настроенной ячейкой значения
 */
async function createValueCell(
  value: string | number | boolean | { r: number; g: number; b: number; a?: number }, 
  type: VariableResolvedDataType, 
  width: number, 
  colorValue?: { r: number; g: number; b: number; a?: number } | null, 
  aliasVariable?: Variable | null
): Promise<FrameNode> {
  const cell = createBaseCellMemoized('Value Cell', width, 'HORIZONTAL');
  
  // Настраиваем выравнивание контента
  cell.primaryAxisAlignItems = 'MIN'; // Выравнивание по левому краю (для горизонтального layout)
  cell.counterAxisAlignItems = 'CENTER'; // Центрирование по вертикали
  
  // Определяем цвет для кружка
  const colorForCircle = determineColorForIndicator(value, type, colorValue);
  
  // Создаем цветной кружок для цветовых переменных
  if (colorForCircle) {
    const colorCircle = createColorIndicator(colorForCircle, type, aliasVariable);
    cell.appendChild(colorCircle);
  }
  
  // Форматируем и создаем текст значения
  const displayValue = formatValueForDisplay(value);
  const textNode = await createValueText(displayValue);
  cell.appendChild(textNode);
  
  return cell;
}

/**
 * Создает ячейку заголовка таблицы с единообразным стилем
 * Применяет специальный шрифт заголовка и выравнивание по левому краю
 * @param text Текст заголовка для отображения
 * @param width Ширина ячейки в пикселях
 * @returns Промис с настроенной ячейкой заголовка
 */
async function createHeaderCell(text: string, width: number): Promise<FrameNode> {
  const cell = createBaseCellMemoized(`Header: ${text}`, width, 'VERTICAL');
  
  // Настраиваем выравнивание контента
  cell.primaryAxisAlignItems = 'MIN';
  cell.counterAxisAlignItems = 'MIN';
  
  // Создаем текст
  const textNodes = await createTextNodesBatch([{ text, fontType: 'header' }]);
  const textNode = textNodes[0];
  textNode.fontSize = APP_CONSTANTS.TEXT_SIZE.HEADER;
  textNode.textAlignHorizontal = 'LEFT';
  textNode.textAlignVertical = 'CENTER';
  
  cell.appendChild(textNode);
  return cell;
}

/**
 * Специализированный класс ошибок для проблем с переменными
 * Содержит дополнительную информацию о проблемной переменной
 */
class _VariableError extends Error {
  constructor(message: string, public readonly variableName?: string) {
    super(message);
    this.name = 'VariableError';
  }
}

/**
 * Специализированный класс ошибок для проблем с коллекциями
 * Содержит дополнительную информацию о проблемной коллекции
 */
class _CollectionError extends Error {
  constructor(message: string, public readonly collectionId?: string) {
    super(message);
    this.name = 'CollectionError';
  }
}

/**
 * Логирует ошибки в консоль с временными метками и контекстом
 * Обеспечивает структурированное логирование для отладки
 * @param error Ошибка для логирования
 * @param context Дополнительный контекст выполнения
 */
function logError(error: Error, context?: string): void {
  const timestamp = new Date().toISOString();
  const contextStr = context ? ` [${context}]` : '';
  console.error(`${timestamp}${contextStr}: ${error.name}: ${error.message}`);
  if (error.stack) {
    console.error(error.stack);
  }
}

/**
 * Обертка для безопасного выполнения асинхронных операций
 * Перехватывает ошибки, логирует их и возвращает null вместо падения
 * @param fn Асинхронная функция для выполнения
 * @param context Контекст для логирования ошибок
 * @returns Промис с результатом функции или null при ошибке
 */
async function _safeExecute<T>(fn: () => Promise<T>, context?: string): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    logError(error instanceof Error ? error : new Error(String(error)), context);
    return null;
  }
}
